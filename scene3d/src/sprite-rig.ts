import * as THREE from 'three';

import {
  cellRect,
  cycleCells,
  resolveSheetLayout,
  type SheetLayout,
  type SpriteCycle,
} from './sheet-layout';

export type SpriteSide = 'you' | 'opp';

export type SpriteRigConfig = {
  readonly unitId: string;
  readonly side: SpriteSide;
  readonly slotIndex: number;
  readonly textureUrl: string;
  /**
   * Treat `textureUrl` as a spritesheet laid out as a 2×2 grid of 32×32 px
   * frames (a 64×64 image). The top row holds the walk cycle:
   *   frames 0,1 = WALK cycle — always loops,
   *   frame  2   = TAKE_HIT (taking a hit / recoil),
   *   frame  3   = ATTACK   (giving a hit) — played via playAttack().
   * When false (the default), the legacy path applies: a single image / GIF is
   * loaded as one texture (dot.gif portraits, pen sprites, admin previews).
   * Combat passes `isSpritesheet: true`; everything else keeps the old path.
   */
  readonly isSpritesheet?: boolean;
  /** When true (default), the walk frames loop automatically (idle bob).
   *  Combat units pass false so they stand still until an action plays. */
  readonly idleAnimated?: boolean;
  /**
   * Optional extra scale applied to the whole billboard, kept stable across
   * `update()` (which otherwise re-applies `baseScale` every frame and would
   * wipe an external `mesh.scale` write). Feet stay planted on `GROUND_Y`:
   * the anchor point grows with the scale. Default 1 (combat).
   */
  readonly unitScale?: number;
  readonly initiallyDowned?: boolean;
  readonly onClick?: (() => void | undefined) | undefined;
};

export type SpriteRigApi = {
  readonly unitId: string;
  readonly side: SpriteSide;
  readonly slotIndex: number;
  readonly worldPosition: THREE.Vector3;
  /**
   * Live sprite dimensions in world units (x = width, y = height).
   *
   * `worldPosition` is the billboard's CENTRE, so an effect anchored to it
   * leaves and lands at the middle of the silhouette. Callers need the extents
   * to place an emission point on the sprite's leading edge at chest height
   * instead. Live like `worldPosition`: `applyAspect` rewrites it whenever the
   * texture's aspect ratio resolves.
   */
  readonly spriteSize: THREE.Vector2;
  update(dt: number, elapsedS: number, cameraQuat: THREE.Quaternion): void;
  playAttack(): void;
  playHit(): void;
  /** Drive the sad (negative-status) cycle on new-layout sheets. */
  setSad(sad: boolean): void;
  /** Mark the rig as moving so the walk cycle plays on new-layout sheets. */
  setMoving(moving: boolean): void;
  illuminate(color: THREE.Color | number, intensity: number, decayPerSec?: number): void;
  setDowned(down: boolean): void;
  setTextureUrl(url: string): void;
  setArenaBaselineY(y: number): void;
  setBasePosition(x: number, z: number): void;
  /** Resize the billboard (kept by `update()`); re-anchors feet on the ground. */
  setUnitScale(v: number): void;
  setFacingDirection(sign: 1 | -1): void;
  dispose(): void;
};

const SPRITE_MAX_DIMENSION = 0.7;
const SHADOW_MAX_WIDTH = 0.75;
const SHADOW_DEPTH_RATIO = 0.55;
const GROUND_Y = 0.02;
const ATTACK_ANIM_S = 0.5;
const HIT_ANIM_S = 0.35;
const ATTACK_LUNGE_UNITS = 1.2;
const HIT_SHAKE_UNITS = 0.07;
const ALPHA_THRESHOLD = 24;

// Spritesheet cycle durations (ms per frame).
const WALK_FRAME_MS = 320;
const HIT_FRAME_MS = 160;

// Transient single-cycle reaction windows for the new 12-frame sheets.
const MOOD_FRAME_MS = 220;

// Legacy frame indices (2×2 layout): 3 = attack (bottom-right), 2 = take-hit.
const ATTACK_FRAME_INDEX = 3;
const TAKE_HIT_FRAME_INDEX = 2;

// Subtle "alive" breathing for combat units (idleAnimated: false). No frame
// swap and no horizontal hop — just a gentle vertical scale + lift so a unit
// standing still between actions doesn't read as frozen / broken.
const BREATHE_HZ = 0.5;          // breaths per second
const BREATHE_SCALE_AMP = 0.03;   // ±3% height
const BREATHE_LIFT = 0.012;       // ±lift as a fraction of sprite height

// Render-time white-balance for mostly-white digimons. The rig draws sprites
// with an UNLIT MeshBasicMaterial at color white, so a pale/white sprite
// renders at pure 255 brightness while colored sprites read naturally darker.
// applyBrightnessTint normalizes the material color so very-bright sprites
// match their colored peers' perceived brightness instead of blowing out.
//
// Metric: the mean luminance of ALL opaque pixels is misleading — a white body
// with dark outlines + translucent edges averages low (the brightest real sheet
// is ~0.68) and never trips a mean-based trigger. What identifies a white
// digimon is the FRACTION of opaque pixels that are near-white (the bulk white
// body at ~255). Trigger on that; dim so the near-white body's luminance lands
// near the perceived brightness of colored sprites.
const BRIGHTNESS_NEAR_WHITE_LUM = 0.8; // a pixel counts as "near-white"
const BRIGHTNESS_NEAR_WHITE_FRAC = 0.30; // ≥30% near-white opaque px → "mostly white"
const BRIGHTNESS_TINT_TARGET = 0.5;      // pull the white body's luminance toward this
const BRIGHTNESS_DIM_FLOOR = 0.5;        // never dim below 50% (keep it readable)

// Spritesheet layout is resolved from the sheet's actual pixel dimensions via
// `resolveSheetLayout` (shared with the 2D component) — square = legacy 2×2,
// non-square = new 3×4 twelve-frame layout. No hardcoded cell size here.

export const FORMATION_SIDE_X = 3.0;
export const FORMATION_SLOT_Z_SPACING = 2.4;

let gifCacheContainer: HTMLDivElement | null = null;
function ensureGifCache(): HTMLDivElement {
  if (gifCacheContainer !== null) return gifCacheContainer;
  if (typeof document === 'undefined') {
    throw new Error('sprite-rig: gif cache requires a document');
  }
  const div = document.createElement('div');
  div.setAttribute('aria-hidden', 'true');
  div.setAttribute('data-role', 'c3d-gif-cache');
  div.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;opacity:0;z-index:-1;contain:layout paint;';
  document.body.appendChild(div);
  gifCacheContainer = div;
  return div;
}

export function slotWorldPosition(side: SpriteSide, slotIndex: number): THREE.Vector3 {
  const sign = side === 'you' ? -1 : 1;
  const x = sign * FORMATION_SIDE_X;
  const z = (slotIndex - 1) * FORMATION_SLOT_Z_SPACING;
  return new THREE.Vector3(x, SPRITE_MAX_DIMENSION / 2 + GROUND_Y, z);
}

function makeShadowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('sprite-rig: 2d context unavailable for shadow texture');
  }
  const grd = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2 - 2);
  grd.addColorStop(0, 'rgba(10,14,22,0.55)');
  grd.addColorStop(0.6, 'rgba(10,14,22,0.28)');
  grd.addColorStop(1, 'rgba(10,14,22,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let sharedShadowTexture: THREE.CanvasTexture | null = null;
function shadowTexture(): THREE.CanvasTexture {
  sharedShadowTexture ??= makeShadowTexture();
  return sharedShadowTexture;
}

function makePlaceholderTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 40;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('sprite-rig: 2d context unavailable for placeholder texture');
  }
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#8faad0';
  ctx.fillRect(8, 14, 16, 20);
  ctx.fillRect(10, 4, 12, 12);
  ctx.fillRect(9, 34, 5, 4);
  ctx.fillRect(18, 34, 5, 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

type GifFrame = {
  readonly bitmap: ImageBitmap;
  readonly durationMs: number;
};

type GifState = {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  frames: readonly GifFrame[];
  currentFrame: number;
  elapsedMsInFrame: number;
  bboxAnalyzed: boolean;
  fallbackImg: HTMLImageElement | null;
};

type AnimState = { type: 'attack' | 'hit'; t: number; dur: number };

type IlluminationState = {
  readonly color: THREE.Color;
  intensity: number;
  decayPerSec: number;
};

const SPRITE_SHEET_SERVER_PREFIX = '/assets/sprites/';
const SPRITE_SHEET_STATIC_PREFIX = '/assets/sprites-static/';
const SKULLBOT_DOT_PREFIX = '/assets/digimon/';

/**
 * Resolve the 2×2 four-frame sprite-sheet URL for a digimon (walk row + hit row).
 * Sheets live at `/assets/sprites/<skullbotId>.png`, keyed by the integer the
 * catalog id encodes (`skb-317` → `317`), matching `data/sprites/dot317.PNG`.
 * The rig (and the 2D/Phaser consumers) fall back to dot.gif on a 404.
 */
export function unitSpriteSheetUrl(templateId: string): string {
  const numeric = templateId.replace(/^skb-/, '');
  return `${SPRITE_SHEET_SERVER_PREFIX}${numeric}.png`;
}

/**
 * Resolve the static (frame-0) sprite URL for a digimon — a single 32×32 cell
 * cut from the same sheet, used by still/2D surfaces (roster, lobby, cards...)
 * so every display of a digimon reads from the generated sheet rather than the
 * legacy `dot.gif`. Falls back to dot.gif when the cell is missing.
 */
export function unitSpriteStaticUrl(templateId: string): string {
  const numeric = templateId.replace(/^skb-/, '');
  return `${SPRITE_SHEET_STATIC_PREFIX}${numeric}.png`;
}

/** Legacy single-frame dot.gif URL; kept as the universal fallback. */
export function unitDotUrl(templateId: string): string {
  return `${SKULLBOT_DOT_PREFIX}${templateId}/dot.gif`;
}

/**
 * Spritesheet playback state. The source image grid (legacy 2×2, or the new
 * 3×4 twelve-frame layout) is resolved from the sheet's real dimensions.
 *
 * Playback is cycle-driven:
 *  - legacy sheets keep the old contract (walk loop + single-frame hit/attack),
 *  - 12-frame sheets run a persistent cycle (happy = default, walk, sad, death)
 *    that a transient reaction (attack → angry) overrides, then returns to.
 */
type SheetState = {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly image: HTMLImageElement;
  readonly layout: SheetLayout;
  /** Persistent cycle driving this sheet (happy/walk/sad/death). */
  cycle: SpriteCycle;
  /** Index into `cycleCells` for the current cell (or legacy frame index). */
  step: number;
  /** ms elapsed in the current frame. */
  elapsed: number;
  /** True while a transient reaction (attack) overrides the persistent cycle. */
  reaction: 'attack' | 'hit' | null;
  /** Index into the reaction's cycle cells; legacy uses a single frame. */
  reactionStep: number;
  /** ms elapsed in the current reaction. */
  reactionElapsed: number;
  /** Sad state (affected by a negative status). Drives cycle → 'sad'. */
  sad: boolean;
  /** Walk state (moved this frame). Drives cycle → 'walk' when not sad/dead. */
  moved: boolean;
};

export class SpriteRig implements SpriteRigApi {
  readonly unitId: string;
  readonly side: SpriteSide;
  readonly slotIndex: number;
  readonly worldPosition: THREE.Vector3;

  get downed(): boolean {
    return this._downed;
  }

  /** True while an attack/hit animation is mid-flight. The billboard actually
   *  translates (lunge) or shakes during these, so the scene must refresh the
   *  shadow map across the whole window rather than just on the first frame. */
  get animating(): boolean {
    return this.anim !== null;
  }

  private readonly scene: THREE.Scene;
  readonly mesh: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly baseColor: THREE.Color;
  private readonly basePosition: THREE.Vector3;
  private readonly baseScale: THREE.Vector2 = new THREE.Vector2(SPRITE_MAX_DIMENSION, SPRITE_MAX_DIMENSION);
  /** Same object as `baseScale`, surfaced read-only through `SpriteRigApi`. */
  readonly spriteSize: THREE.Vector2 = this.baseScale;
  private shadowWidthUnits = SHADOW_MAX_WIDTH;
  private arenaBaselineY = 0;
  private unitScale = 1;
  private gif: GifState | null = null;
  private anim: AnimState | null = null;
  private sheet: SheetState | null = null;
  private illumination: IlluminationState | null = null;
  private _downed: boolean;
  private disposedFlag = false;
  private onClick: ((unitId: string) => void | undefined) | undefined;
  private facingSign: 1 | -1 = 1;
  private readonly isSpritesheet: boolean;
  private idleAnimated: boolean;
  /** Per-rig phase so units don't breathe in lockstep. */
  private readonly breathePhase = Math.random() * Math.PI * 2;

  constructor(scene: THREE.Scene, config: SpriteRigConfig) {
    this.scene = scene;
    this.unitId = config.unitId;
    this.side = config.side;
    this.slotIndex = config.slotIndex;
    this.basePosition = slotWorldPosition(config.side, config.slotIndex);
    this.worldPosition = this.basePosition.clone();
    this.unitScale = config.unitScale ?? 1;
    this._downed = config.initiallyDowned === true;
    this.onClick = config.onClick ?? undefined;
    this.isSpritesheet = config.isSpritesheet === true;
    this.idleAnimated = config.idleAnimated !== false;

    const placeholder = makePlaceholderTexture();
    this.baseColor = new THREE.Color(0xffffff);
    this.mat = new THREE.MeshBasicMaterial({
      map: placeholder,
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      color: this.baseColor.clone(),
      fog: false,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.Mesh(geometry, this.mat);
    this.mesh.position.copy(this.basePosition);
    this.mesh.scale.set(this.baseScale.x * this.unitScale, this.baseScale.y * this.unitScale, 1);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
      map: placeholder,
      alphaTest: 0.5,
      depthPacking: THREE.RGBADepthPacking,
    });
    this.mesh.userData = { spriteRig: this };

    this.scene.add(this.mesh);

    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
      // Coplanar com o piso (arena GLB opaca) -> sem polygonOffset o chão
      // vence no depth e a sombra some. Empurra o blob pra frente do depth.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const shadowGeometry = new THREE.PlaneGeometry(SHADOW_MAX_WIDTH, SHADOW_MAX_WIDTH);
    this.shadow = new THREE.Mesh(shadowGeometry, shadowMat);
    this.shadow.renderOrder = 10;
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(this.basePosition.x, GROUND_Y, this.basePosition.z);
    this.scene.add(this.shadow);

    if (this.downed) {
      this.mesh.visible = false;
      this.shadow.visible = false;
    }

    this.loadTexture(config.textureUrl);
  }

  setTextureUrl(url: string): void {
    if (this.disposedFlag) return;
    this.loadTexture(url);
  }

  private applyFacingFlip(texture: THREE.Texture): void {
    if (this.side !== 'you') return;
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.x = -1;
    texture.offset.x = 1;
  }

  private applyAspect(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const aspect = width / height;
    if (aspect >= 1) {
      this.baseScale.set(SPRITE_MAX_DIMENSION, SPRITE_MAX_DIMENSION / aspect);
    } else {
      this.baseScale.set(SPRITE_MAX_DIMENSION * aspect, SPRITE_MAX_DIMENSION);
    }
    this.basePosition.y = (this.baseScale.y * this.unitScale) / 2 + GROUND_Y;
    this.shadowWidthUnits = Math.min(SHADOW_MAX_WIDTH, this.baseScale.x * 1.05);
  }

  private syncDepthMap(): void {
    const depth = this.mesh.customDepthMaterial as THREE.MeshDepthMaterial | undefined;
    if (depth === undefined) return;
    if (depth.map !== this.mat.map) {
      depth.map = this.mat.map;
      depth.needsUpdate = true;
    }
  }

  private loadTexture(url: string): void {
    if (this.isSpritesheet) {
      this.loadSpritesheet(url);
      return;
    }
    if (/\.gif(\?|$)/i.test(url)) {
      this.loadGif(url);
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.load(url, (tex) => {
      if (this.disposedFlag) {
        tex.dispose();
        return;
      }
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.applyFacingFlip(tex);
      const previous = this.mat.map;
      this.mat.map = tex;
      this.mat.needsUpdate = true;
      this.syncDepthMap();
      previous?.dispose();
      const image = tex.image as { width?: number; height?: number } | undefined;
      if (image && typeof image.width === 'number' && typeof image.height === 'number') {
        this.applyAspect(image.width, image.height);
      }
      this.analyzeStaticAlphaBbox(tex);
    });
  }

  private loadSpritesheet(url: string): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      if (this.disposedFlag) {
        img.remove();
        return;
      }
      const w = img.naturalWidth || 64;
      const h = img.naturalHeight || 64;
      // Layout + cell size are derived from the SOURCE sheet, independent of the
      // canvas: square → legacy 2×2, non-square → new 3×4 twelve-frame layout.
      const layout = resolveSheetLayout(w, h);
      const { cellW, cellH } = layout;
      // The texture holds exactly ONE cell (1:1, no upscale). Stretching a small
      // cell into a bigger canvas and using that as the texture is what made
      // frames look chunky/cropped through alphaTest.
      const canvas = document.createElement('canvas');
      canvas.width = cellW;
      canvas.height = cellH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx === null) {
        img.remove();
        return;
      }
      ctx.imageSmoothingEnabled = false;
      const texture = new THREE.CanvasTexture(canvas);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      // Spritesheet is authored facing the 'opp' side (right); flip for 'you'.
      this.applyFacingFlip(texture);
      const previous = this.mat.map;
      this.mat.map = texture;
      this.mat.needsUpdate = true;
      this.syncDepthMap();
      previous?.dispose();
      this.applyAspect(cellW, cellH);
      const sheet: SheetState = {
        canvas,
        ctx,
        texture,
        image: img,
        layout,
        // Legacy walk starts at frame 0; new layout defaults to happy (idle).
        cycle: layout.version === 'cycles12' ? 'happy' : 'walk',
        step: 0,
        elapsed: 0,
        reaction: null,
        reactionStep: 0,
        reactionElapsed: 0,
        sad: false,
        moved: false,
      };
      this.sheet = sheet;
      this.drawCurrentSheetFrame(sheet);
      // If the unit started downed, resolve its persistence now that the sheet
      // layout is known (cycles12 → death cycle stays visible; legacy → hidden).
      if (this._downed) this.setDowned(true);
      try {
        const imageData = ctx.getImageData(0, 0, cellW, cellH);
        this.applyAlphaBboxFromImageData(imageData);
        this.applyBrightnessTint(imageData);
      } catch {
        /* bbox analysis is best-effort */
      }
    };
    img.onerror = () => {
      // Sheet failed: keep the placeholder so the unit still renders.
      img.remove();
    };
    img.src = url;
  }

  /** Draw the sheet's current cycle cell (or reaction cell) into the canvas at 1:1. */
  private drawCurrentSheetFrame(sheet: SheetState): void {
    const cells =
      sheet.reaction !== null
        ? this.reactionCells(sheet)
        : cycleCells(sheet.layout, sheet.cycle);
    const cell = sheet.reaction !== null
      ? cells[sheet.reactionStep] ?? cells[0] ?? 0
      : cells[sheet.step] ?? cells[0] ?? 0;
    this.drawSheetCell(sheet, cell);
  }

  /** The single-frame or transient-cycle cells for the active reaction. */
  private reactionCells(sheet: SheetState): readonly number[] {
    if (sheet.reaction === 'attack') {
      // Legacy: attack is the single bottom-right frame (cell 3). New layout:
      // attack = angry cycle (all three angry cells).
      return sheet.layout.version === 'cycles12'
        ? cycleCells(sheet.layout, 'angry')
        : [ATTACK_FRAME_INDEX];
    }
    if (sheet.reaction === 'hit') {
      // Legacy: hit is the single bottom-left frame (cell 2). The new layout has
      // no dedicated take-hit frame; use the sad cycle (the "status hit" state)
      // so a damage reaction still visibly changes pose.
      return sheet.layout.version === 'cycles12'
        ? cycleCells(sheet.layout, 'sad')
        : [TAKE_HIT_FRAME_INDEX];
    }
    return [0];
  }

  /** Draw one cell of the sheet into the canvas at 1:1 using the shared layout. */
  private drawSheetCell(sheet: SheetState, cell: number): void {
    const rect = cellRect(sheet.layout, cell);
    sheet.ctx.clearRect(0, 0, sheet.canvas.width, sheet.canvas.height);
    sheet.ctx.drawImage(
      sheet.image,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      0,
      0,
      rect.w,
      rect.h,
    );
    sheet.texture.needsUpdate = true;
  }

  private loadGif(url: string): void {
    if (typeof globalThis.ImageDecoder !== 'undefined') {
      this.loadGifViaDecoder(url).catch(() => this.loadGifViaImgFallback(url));
      return;
    }
    this.loadGifViaImgFallback(url);
  }

  private async loadGifViaDecoder(url: string): Promise<void> {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`gif fetch failed: ${response.status}`);
    const blob = await response.blob();
    if (this.disposedFlag) return;
    const decoder = new ImageDecoder({ data: blob.stream(), type: blob.type || 'image/gif' });
    await decoder.tracks.ready;
    if (this.disposedFlag) { decoder.close(); return; }
    const track = decoder.tracks.selectedTrack;
    if (track === null) { decoder.close(); throw new Error('gif has no track'); }
    const frameCount = Math.max(1, track.frameCount);
    const frames: GifFrame[] = [];
    let w = 0;
    let h = 0;
    for (let i = 0; i < frameCount; i++) {
      const result = await decoder.decode({ frameIndex: i });
      if (this.disposedFlag) { result.image.close(); break; }
      w = result.image.displayWidth;
      h = result.image.displayHeight;
      const bitmap = await createImageBitmap(result.image);
      const durationMs = (result.image.duration ?? 100000) / 1000;
      frames.push({ bitmap, durationMs: Math.max(20, durationMs) });
      result.image.close();
    }
    decoder.close();
    if (this.disposedFlag || frames.length === 0 || w <= 0 || h <= 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return;
    ctx.imageSmoothingEnabled = false;
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    this.applyFacingFlip(texture);
    const previous = this.mat.map;
    this.mat.map = texture;
    this.mat.needsUpdate = true;
    this.syncDepthMap();
    previous?.dispose();
    this.applyAspect(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(frames[0]!.bitmap, 0, 0);
    texture.needsUpdate = true;
    this.gif = { canvas, ctx, texture, frames, currentFrame: 0, elapsedMsInFrame: 0, bboxAnalyzed: false, fallbackImg: null };
  }

  private loadGifViaImgFallback(url: string): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const cache = ensureGifCache();
    img.style.cssText = 'display:block;width:auto;height:auto;';
    img.onload = () => {
      if (this.disposedFlag) {
        img.remove();
        return;
      }
      const cw = img.naturalWidth || 64;
      const ch = img.naturalHeight || 64;
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx === null) return;
      ctx.imageSmoothingEnabled = false;
      const texture = new THREE.CanvasTexture(canvas);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      this.applyFacingFlip(texture);
      const previous = this.mat.map;
      this.mat.map = texture;
      this.mat.needsUpdate = true;
      this.syncDepthMap();
      previous?.dispose();
      this.applyAspect(cw, ch);
      this.gif = { canvas, ctx, texture, frames: [], currentFrame: 0, elapsedMsInFrame: 0, bboxAnalyzed: false, fallbackImg: img };
    };
    cache.appendChild(img);
    img.src = url;
  }

  private analyzeStaticAlphaBbox(tex: THREE.Texture): void {
    const image = tex.image as HTMLImageElement | HTMLCanvasElement | ImageBitmap | undefined;
    if (image === undefined) return;
    const w = 'width' in image ? Number(image.width) : 0;
    const h = 'height' in image ? Number(image.height) : 0;
    if (w <= 0 || h <= 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return;
    try {
      ctx.drawImage(image as CanvasImageSource, 0, 0);
      const imageData = ctx.getImageData(0, 0, w, h);
      this.applyAlphaBboxFromImageData(imageData);
      this.applyBrightnessTint(imageData);
    } catch {
      return;
    }
  }

  /**
   * Render-time brightness normalization for mostly-white digimons.
   *
   * The rig draws sprites with an UNLIT MeshBasicMaterial at color white, so a
   * texture that is mostly white/pale renders at pure 255 while colored sprites
   * read naturally darker — white digimons look blown out in combat. We measure
   * the fraction of opaque pixels that are near-white (the bulk white body).
   * When that crosses the "mostly white" threshold, dim the material so the
   * white body's luminance lands near TARGET, matching colored peers' perceived
   * brightness. Never brightens (dark sprites are untouched) and never tints
   * toward a hue — only a neutral gray multiplier, so colors stay true.
   */
  private applyBrightnessTint(imageData: ImageData): void {
    const { data, width, height } = imageData;
    let opaque = 0;
    let nearWhite = 0;
    let nearWhiteLumSum = 0;
    for (let y = 0; y < height; y += 1) {
      const row = y * width * 4;
      for (let x = 0; x < width; x += 1) {
        const i = row + x * 4;
        if ((data[i + 3] ?? 0) <= ALPHA_THRESHOLD) continue;
        const r = (data[i] ?? 0) / 255;
        const g = (data[i + 1] ?? 0) / 255;
        const b = (data[i + 2] ?? 0) / 255;
        opaque += 1;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lum > BRIGHTNESS_NEAR_WHITE_LUM) {
          nearWhite += 1;
          nearWhiteLumSum += lum;
        }
      }
    }
    if (opaque === 0) return;
    const nearWhiteFrac = nearWhite / opaque;
    // Not predominantly white — leave the sprite at full unlit brightness (the
    // mean-luminance approach never fired: white bodies with dark outlines and
    // translucent edges average well below the trigger; the bulk-white-body
    // fraction is the discriminator).
    if (nearWhiteFrac < BRIGHTNESS_NEAR_WHITE_FRAC) return;
    const bodyLum = nearWhiteLumSum / nearWhite;
    // Bring the white body's luminance down toward TARGET (e.g. a 0.92 body →
    // factor ≈ 0.54), floored so it stays readable.
    const factor = Math.max(BRIGHTNESS_DIM_FLOOR, BRIGHTNESS_TINT_TARGET / bodyLum);
    this.baseColor.setScalar(factor);
    if (this.illumination === null) this.mat.color.copy(this.baseColor);
  }

  private applyAlphaBboxFromImageData(imageData: ImageData): void {
    const { data, width, height } = imageData;
    let minX = width;
    let maxX = -1;
    for (let y = 0; y < height; y += 1) {
      const row = y * width * 4;
      for (let x = 0; x < width; x += 1) {
        const alpha = data[row + x * 4 + 3] ?? 0;
        if (alpha > ALPHA_THRESHOLD) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    if (maxX < 0 || minX >= width) return;
    const pixelWidth = maxX - minX + 1;
    const widthFraction = Math.max(0.15, Math.min(1, pixelWidth / width));
    this.shadowWidthUnits = SHADOW_MAX_WIDTH * widthFraction;
  }

  setFacingDirection(sign: 1 | -1): void {
    this.facingSign = sign;
  }

  update(dt: number, elapsedS: number, cameraQuat: THREE.Quaternion): void {
    if (this.disposedFlag || !this.mesh.visible) return;
    this.mesh.quaternion.copy(cameraQuat);

    if (this.sheet !== null) {
      this.updateSheet(this.sheet, dt);
    } else if (this.gif !== null) {
      const gif = this.gif;
      if (gif.frames.length > 0) {
        gif.elapsedMsInFrame += dt * 1000;
        const currentFrame = gif.frames[gif.currentFrame]!;
        if (gif.elapsedMsInFrame >= currentFrame.durationMs) {
          gif.elapsedMsInFrame -= currentFrame.durationMs;
          gif.currentFrame = (gif.currentFrame + 1) % gif.frames.length;
          const nextFrame = gif.frames[gif.currentFrame]!;
          gif.ctx.clearRect(0, 0, gif.canvas.width, gif.canvas.height);
          gif.ctx.drawImage(nextFrame.bitmap, 0, 0);
          gif.texture.needsUpdate = true;
          if (!gif.bboxAnalyzed) {
            try {
              const imageData = gif.ctx.getImageData(0, 0, gif.canvas.width, gif.canvas.height);
              this.applyAlphaBboxFromImageData(imageData);
              this.applyBrightnessTint(imageData);
            } catch {
              /* best-effort */
            }
            gif.bboxAnalyzed = true;
          }
        }
      } else if (gif.fallbackImg !== null && !gif.bboxAnalyzed) {
        gif.ctx.clearRect(0, 0, gif.canvas.width, gif.canvas.height);
        gif.ctx.drawImage(gif.fallbackImg, 0, 0);
        gif.texture.needsUpdate = true;
        try {
          const imageData = gif.ctx.getImageData(0, 0, gif.canvas.width, gif.canvas.height);
          this.applyAlphaBboxFromImageData(imageData);
          this.applyBrightnessTint(imageData);
        } catch {}
        gif.bboxAnalyzed = true;
      }
    }

    let ox = 0;
    let lungeOffset = 0;

    if (this.anim !== null) {
      this.anim.t += dt;
      const p = Math.min(this.anim.t / this.anim.dur, 1);
      if (this.anim.type === 'attack') {
        const dir = this.side === 'you' ? 1 : -1;
        const lunge = Math.sin(p * Math.PI);
        lungeOffset = dir * lunge * ATTACK_LUNGE_UNITS;
      } else if (this.anim.type === 'hit') {
        ox = Math.sin(p * Math.PI * 6) * HIT_SHAKE_UNITS * (1 - p);
      }
      if (p >= 1) {
        this.anim = null;
      }
    }

    // Gentle breathing so a still unit (combat passes idleAnimated:false) looks
    // alive instead of frozen/broken. No frame swap, no horizontal "jump".
    const breathe = Math.sin((elapsedS * BREATHE_HZ + this.breathePhase) * Math.PI * 2);
    const breatheScaleY = 1 + breathe * BREATHE_SCALE_AMP;
    const breatheLift = breathe * BREATHE_LIFT * this.baseScale.y;

    this.mesh.position.x = this.basePosition.x + lungeOffset + ox;
    this.mesh.position.y = this.basePosition.y + this.arenaBaselineY + breatheLift;
    this.mesh.position.z = this.basePosition.z;
    this.mesh.scale.set(this.baseScale.x * this.facingSign * this.unitScale, this.baseScale.y * breatheScaleY * this.unitScale, 1);

    this.worldPosition.set(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z);

    this.shadow.scale.set(this.shadowWidthUnits / SHADOW_MAX_WIDTH, (this.shadowWidthUnits * SHADOW_DEPTH_RATIO) / SHADOW_MAX_WIDTH, 1);
    this.shadow.position.x = this.mesh.position.x;
    // O depth do blob já segue via position.y (setArenaBaselineY); o z ficava
    // PRESO no slot de combate do construtor — no lobby, onde setBasePosition
    // espalha a party ao longo de z (±1.3/1.7), a sombra ficava 1-4u atrás do
    // digimon ("digimons não estão castando sombra"). Espelha o z do mesh.
    this.shadow.position.z = this.mesh.position.z;

    if (this.illumination !== null) {
      const illum = this.illumination;
      illum.intensity = Math.max(0, illum.intensity - illum.decayPerSec * dt);
      if (illum.intensity <= 0.001) {
        this.mat.color.copy(this.baseColor);
        this.illumination = null;
      } else {
        this.mat.color.copy(this.baseColor).lerp(illum.color, Math.min(1, illum.intensity));
      }
    }
    void elapsedS;
  }

  /**
   * Advance spritesheet playback (cycle loop, or a transient reaction while
   * one is active). Empties into whichever persistent cycle is current once
   * the reaction finishes.
   */
  private updateSheet(sheet: SheetState, dt: number): void {
    // Active reaction: advance through its frames, then return to the cycle.
    if (sheet.reaction !== null) {
      sheet.reactionElapsed += dt * 1000;
      const cells = this.reactionCells(sheet);
      const perFrame = sheet.layout.version === 'cycles12' ? MOOD_FRAME_MS : HIT_FRAME_MS;
      if (sheet.reactionElapsed >= perFrame) {
        sheet.reactionElapsed -= perFrame;
        sheet.reactionStep += 1;
        if (sheet.reactionStep >= cells.length) {
          // Reaction done — clear it and settle on the first frame of the
          // persistent cycle (so the pose snaps back, not mid-anim).
          sheet.reaction = null;
          sheet.step = 0;
          sheet.elapsed = 0;
          this.drawCurrentSheetFrame(sheet);
        } else {
          this.drawCurrentSheetFrame(sheet);
        }
      }
      return;
    }

    // New 12-frame layout: drive the persistent cycle from rig state.
    if (sheet.layout.version === 'cycles12') {
      this.updateCycle12(sheet, dt);
      return;
    }

    // Legacy: walk loop while idleAnimated; combat units stand still on frame 0.
    if (!this.idleAnimated) return;
    sheet.elapsed += dt * 1000;
    if (sheet.elapsed >= WALK_FRAME_MS) {
      sheet.elapsed -= WALK_FRAME_MS;
      const walk = cycleCells(sheet.layout, 'walk');
      sheet.step = (sheet.step + 1) % walk.length;
      this.drawCurrentSheetFrame(sheet);
    }
  }

  /** Persistent-cycle playback for the new 3×4 twelve-frame layout. */
  private updateCycle12(sheet: SheetState, dt: number): void {
    // Death overrides everything and persists: a dead digimon stays in the
    // death cycle (loops its two frames so it reads as a lingering corpse).
    // Sad comes before walk; walk before happy. Priority handled below.
    let target: SpriteCycle = 'happy';
    if (this._downed) target = 'death';
    else if (sheet.sad) target = 'sad';
    else if (sheet.moved) target = 'walk';

    // Combat passes idleAnimated:false → the idle happy pose holds static
    // (frame 0) unless the unit is moving/sad/dead, which must keep animating.
    const shouldAnimate = this.idleAnimated || target === 'walk' || target === 'death';

    if (sheet.cycle !== target) {
      sheet.cycle = target;
      sheet.step = 0;
      sheet.elapsed = 0;
      this.drawCurrentSheetFrame(sheet);
      return;
    }
    const cells = cycleCells(sheet.layout, target);
    if (cells.length < 1) return;
    if (!shouldAnimate && cells.length > 1) {
      // Static resting pose on frame 0.
      if (sheet.step !== 0) {
        sheet.step = 0;
        this.drawCurrentSheetFrame(sheet);
      }
      return;
    }
    sheet.elapsed += dt * 1000;
    if (sheet.elapsed >= WALK_FRAME_MS) {
      sheet.elapsed -= WALK_FRAME_MS;
      sheet.step = (sheet.step + 1) % cells.length;
      this.drawCurrentSheetFrame(sheet);
    }
  }

  playAttack(): void {
    if (this.disposedFlag) return;
    // Lunge transform (kept for spatial weight) + the sheet's attack reaction:
    // legacy → single ATTACK frame (3); new layout → angry cycle.
    this.anim = { type: 'attack', t: 0, dur: ATTACK_ANIM_S };
    if (this.sheet !== null) {
      this.sheet.reaction = 'attack';
      this.sheet.reactionStep = 0;
      this.sheet.reactionElapsed = 0;
      this.drawCurrentSheetFrame(this.sheet);
    }
  }

  playHit(): void {
    if (this.disposedFlag) return;
    // Shake-on-take-damage (spatial) + the sheet's hit reaction:
    // legacy → single TAKE_HIT frame (2); new layout → sad (status-hit) cycle.
    this.anim = { type: 'hit', t: 0, dur: HIT_ANIM_S };
    if (this.sheet !== null) {
      this.sheet.reaction = 'hit';
      this.sheet.reactionStep = 0;
      this.sheet.reactionElapsed = 0;
      this.drawCurrentSheetFrame(this.sheet);
    }
  }

  /** Drive the sad (negative-status) cycle for new-layout sheets. No-op on legacy. */
  setSad(sad: boolean): void {
    if (this.disposedFlag || this.sheet === null) return;
    this.sheet.sad = sad;
    // Re-derive the persistent cycle immediately (clearing sad snaps back to
    // whatever the unit should be showing — happy, or walk/death if engaged).
    this.updateCycle12(this.sheet, 0);
  }

  /** Mark the rig as moving (drives the walk cycle on new-layout sheets). */
  setMoving(moving: boolean): void {
    if (this.disposedFlag || this.sheet === null) return;
    this.sheet.moved = moving;
    this.updateCycle12(this.sheet, 0);
  }

  illuminate(color: THREE.Color | number, intensity: number, decayPerSec = 4): void {
    if (this.disposedFlag) return;
    const c = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
    this.illumination = {
      color: c,
      intensity: Math.max(0, intensity),
      decayPerSec: Math.max(0.1, decayPerSec),
    };
  }

  setDowned(down: boolean): void {
    if (this.disposedFlag) return;
    this._downed = down;
    if (this.sheet !== null && this.sheet.layout.version === 'cycles12') {
      // New layout: a dead digimon persists in the death cycle (visible), so an
      // ally revive can pull it back. Keep the mesh + shadow on stage.
      this.mesh.visible = true;
      this.shadow.visible = true;
      this.sheet.cycle = down ? 'death' : 'happy';
      this.sheet.step = 0;
      this.sheet.elapsed = 0;
      this.drawCurrentSheetFrame(this.sheet);
      return;
    }
    // Legacy fallback: downed units are removed from the stage entirely.
    this.mesh.visible = !down;
    this.shadow.visible = !down;
  }

  setArenaBaselineY(y: number): void {
    if (this.disposedFlag) return;
    this.arenaBaselineY = y;
    this.mesh.position.y = this.basePosition.y + y;
    this.shadow.position.y = GROUND_Y + y;
    this.worldPosition.y = this.mesh.position.y;
  }

  setBasePosition(x: number, z: number): void {
    this.basePosition.x = x;
    this.basePosition.z = z;
    // Move o blob de contato junto (a sombra é o contato COM o piso — ela não
    // pode esperar o próximo update(). Nada tocava z antes: no lobby o blob
    // ficava preso no z do slot de combate do construtor.
    this.shadow.position.set(x, this.shadow.position.y, z);
  }

  setUnitScale(v: number): void {
    if (this.disposedFlag || v <= 0) return;
    this.unitScale = v;
    this.basePosition.y = (this.baseScale.y * v) / 2 + GROUND_Y;
    this.mesh.position.y = this.basePosition.y + this.arenaBaselineY;
    this.worldPosition.y = this.mesh.position.y;
  }

  dispose(): void {
    if (this.disposedFlag) return;
    this.disposedFlag = true;
    this.scene.remove(this.mesh);
    this.scene.remove(this.shadow);
    this.mesh.geometry.dispose();
    this.shadow.geometry.dispose();
    this.mat.map?.dispose();
    this.mat.dispose();
    (this.shadow.material as THREE.MeshBasicMaterial).dispose();
    if (this.gif !== null) {
      this.gif.fallbackImg?.remove();
      this.gif.texture.dispose();
      for (const frame of this.gif.frames) frame.bitmap.close();
    }
    if (this.sheet !== null) {
      this.sheet.image.remove();
      this.sheet.texture.dispose();
    }
  }
}
