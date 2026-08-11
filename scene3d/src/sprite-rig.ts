import * as THREE from 'three';

export type SpriteSide = 'you' | 'opp';

export type SpriteRigConfig = {
  readonly unitId: string;
  readonly side: SpriteSide;
  readonly slotIndex: number;
  readonly textureUrl: string;
  readonly initiallyDowned?: boolean;
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
  illuminate(color: THREE.Color | number, intensity: number, decayPerSec?: number): void;
  setDowned(down: boolean): void;
  setTextureUrl(url: string): void;
  setArenaBaselineY(y: number): void;
  setBasePosition(x: number, z: number): void;
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

export class SpriteRig implements SpriteRigApi {
  readonly unitId: string;
  readonly side: SpriteSide;
  readonly slotIndex: number;
  readonly worldPosition: THREE.Vector3;

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
  private gif: GifState | null = null;
  private anim: AnimState | null = null;
  private illumination: IlluminationState | null = null;
  private downed: boolean;
  private disposedFlag = false;
  private facingSign: 1 | -1 = 1;

  constructor(scene: THREE.Scene, config: SpriteRigConfig) {
    this.scene = scene;
    this.unitId = config.unitId;
    this.side = config.side;
    this.slotIndex = config.slotIndex;
    this.basePosition = slotWorldPosition(config.side, config.slotIndex);
    this.worldPosition = this.basePosition.clone();
    this.downed = config.initiallyDowned === true;

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
    this.mesh.scale.set(this.baseScale.x, this.baseScale.y, 1);
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
    });
    const shadowGeometry = new THREE.PlaneGeometry(SHADOW_MAX_WIDTH, SHADOW_MAX_WIDTH);
    this.shadow = new THREE.Mesh(shadowGeometry, shadowMat);
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
    this.basePosition.y = this.baseScale.y / 2 + GROUND_Y;
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
      this.applyAlphaBboxFromImageData(ctx.getImageData(0, 0, w, h));
    } catch {
      return;
    }
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

    if (this.gif !== null) {
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
              this.applyAlphaBboxFromImageData(gif.ctx.getImageData(0, 0, gif.canvas.width, gif.canvas.height));
              gif.bboxAnalyzed = true;
            } catch {
              gif.bboxAnalyzed = true;
            }
          }
        }
      } else if (gif.fallbackImg !== null && !gif.bboxAnalyzed) {
        gif.ctx.clearRect(0, 0, gif.canvas.width, gif.canvas.height);
        gif.ctx.drawImage(gif.fallbackImg, 0, 0);
        gif.texture.needsUpdate = true;
        try {
          this.applyAlphaBboxFromImageData(gif.ctx.getImageData(0, 0, gif.canvas.width, gif.canvas.height));
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

    this.mesh.position.x = this.basePosition.x + lungeOffset + ox;
    this.mesh.position.y = this.basePosition.y + this.arenaBaselineY;
    this.mesh.position.z = this.basePosition.z;
    this.mesh.scale.set(this.baseScale.x * this.facingSign, this.baseScale.y, 1);

    this.worldPosition.set(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z);

    this.shadow.scale.set(this.shadowWidthUnits / SHADOW_MAX_WIDTH, (this.shadowWidthUnits * SHADOW_DEPTH_RATIO) / SHADOW_MAX_WIDTH, 1);
    this.shadow.position.x = this.mesh.position.x;

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

  playAttack(): void {
    if (this.disposedFlag) return;
    this.anim = { type: 'attack', t: 0, dur: ATTACK_ANIM_S };
  }

  playHit(): void {
    if (this.disposedFlag) return;
    this.anim = { type: 'hit', t: 0, dur: HIT_ANIM_S };
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
    this.downed = down;
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
  }
}
