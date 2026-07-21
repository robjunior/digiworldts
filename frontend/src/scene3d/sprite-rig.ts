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
  update(dt: number, elapsedS: number, cameraQuat: THREE.Quaternion): void;
  playAttack(): void;
  playHit(): void;
  illuminate(color: THREE.Color | number, intensity: number, decayPerSec?: number): void;
  setDowned(down: boolean): void;
  setTextureUrl(url: string): void;
  dispose(): void;
};

const SPRITE_WIDTH = 0.9;
const SPRITE_HEIGHT = 1.125;
const SHADOW_MAX_WIDTH = 0.95;
const SHADOW_DEPTH_RATIO = 0.55;
const BASE_Y = 0.585;
const GROUND_Y = 0.02;
const ATTACK_ANIM_S = 0.5;
const HIT_ANIM_S = 0.35;
const ATTACK_LUNGE_UNITS = 1.2;
const ATTACK_JUMP_UNITS = 0.25;
const HIT_SHAKE_UNITS = 0.07;
const IDLE_BOB_AMP = 0.03;
const IDLE_BOB_FREQ = 2;
const BASE_EMISSIVE_HEX = 0x0a0e16;
const BASE_EMISSIVE_INTENSITY = 0.35;
const ALPHA_THRESHOLD = 24;

export const FORMATION_SIDE_X = 3.0;
export const FORMATION_SLOT_Z_SPACING = 2.4;

export function slotWorldPosition(side: SpriteSide, slotIndex: number): THREE.Vector3 {
  const sign = side === 'you' ? -1 : 1;
  const x = sign * FORMATION_SIDE_X;
  const z = (slotIndex - 1) * FORMATION_SLOT_Z_SPACING;
  return new THREE.Vector3(x, BASE_Y, z);
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

type GifState = {
  readonly img: HTMLImageElement;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  bboxAnalyzed: boolean;
  frameCount: number;
};

type AnimState = { type: 'attack' | 'hit'; t: number; dur: number };

type IlluminationState = {
  readonly baseHex: number;
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
  private readonly mesh: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly mat: THREE.MeshLambertMaterial;
  private readonly baseEmissive: THREE.Color;
  private readonly basePosition: THREE.Vector3;
  private readonly phase: number;
  private shadowWidthUnits = SHADOW_MAX_WIDTH;
  private gif: GifState | null = null;
  private anim: AnimState | null = null;
  private illumination: IlluminationState | null = null;
  private downed: boolean;
  private disposedFlag = false;

  constructor(scene: THREE.Scene, config: SpriteRigConfig) {
    this.scene = scene;
    this.unitId = config.unitId;
    this.side = config.side;
    this.slotIndex = config.slotIndex;
    this.basePosition = slotWorldPosition(config.side, config.slotIndex);
    this.worldPosition = this.basePosition.clone();
    this.phase = Math.random() * Math.PI * 2;
    this.downed = config.initiallyDowned === true;

    const placeholder = makePlaceholderTexture();
    this.baseEmissive = new THREE.Color(BASE_EMISSIVE_HEX);
    this.mat = new THREE.MeshLambertMaterial({
      map: placeholder,
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      emissive: this.baseEmissive.clone(),
      emissiveIntensity: BASE_EMISSIVE_INTENSITY,
    });
    const geometry = new THREE.PlaneGeometry(SPRITE_WIDTH, SPRITE_HEIGHT);
    this.mesh = new THREE.Mesh(geometry, this.mat);
    this.mesh.position.copy(this.basePosition);
    this.mesh.castShadow = false;
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
      previous?.dispose();
      this.analyzeStaticAlphaBbox(tex);
    });
  }

  private loadGif(url: string): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (this.disposedFlag) return;
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
      previous?.dispose();
      this.gif = { img, canvas, ctx, texture, bboxAnalyzed: false, frameCount: 0 };
    };
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

  update(dt: number, elapsedS: number, cameraQuat: THREE.Quaternion): void {
    if (this.disposedFlag || !this.mesh.visible) return;
    this.mesh.quaternion.copy(cameraQuat);

    if (this.gif !== null) {
      const gif = this.gif;
      gif.ctx.clearRect(0, 0, gif.canvas.width, gif.canvas.height);
      gif.ctx.drawImage(gif.img, 0, 0);
      gif.texture.needsUpdate = true;
      gif.frameCount += 1;
      if (!gif.bboxAnalyzed && gif.frameCount >= 2) {
        try {
          this.applyAlphaBboxFromImageData(gif.ctx.getImageData(0, 0, gif.canvas.width, gif.canvas.height));
          gif.bboxAnalyzed = true;
        } catch {
          gif.bboxAnalyzed = true;
        }
      }
    }

    let y = this.basePosition.y;
    let sx = 1;
    let sy = 1;
    let ox = 0;
    let lift = 0;
    const bob = Math.sin(elapsedS * IDLE_BOB_FREQ + this.phase) * IDLE_BOB_AMP;
    y += bob;
    lift = bob;

    if (this.anim !== null) {
      this.anim.t += dt;
      const p = Math.min(this.anim.t / this.anim.dur, 1);
      if (this.anim.type === 'attack') {
        const dir = this.side === 'you' ? 1 : -1;
        const lunge = Math.sin(p * Math.PI);
        this.mesh.position.x = this.basePosition.x + dir * lunge * ATTACK_LUNGE_UNITS;
        const jump = Math.sin(p * Math.PI) * ATTACK_JUMP_UNITS;
        y += jump;
        lift += jump;
        if (p > 0.6) {
          sy = 1 - (p - 0.6) * 0.6;
          sx = 1 + (p - 0.6) * 0.5;
        }
      } else if (this.anim.type === 'hit') {
        ox = Math.sin(p * Math.PI * 6) * HIT_SHAKE_UNITS * (1 - p);
      }
      if (p >= 1) {
        this.anim = null;
        this.mesh.position.x = this.basePosition.x;
      }
    }

    if (this.anim === null || this.anim.type !== 'attack') {
      this.mesh.position.x = this.basePosition.x + ox;
    }
    this.mesh.position.y = y;
    this.mesh.scale.set(sx, sy, 1);

    this.worldPosition.set(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z);

    const k = Math.max(0, 1 - lift * 1.6);
    const shadowWidth = this.shadowWidthUnits * (0.85 + k * 0.15) * sx;
    const shadowDepth = this.shadowWidthUnits * SHADOW_DEPTH_RATIO * (0.85 + k * 0.15);
    this.shadow.scale.set(shadowWidth / SHADOW_MAX_WIDTH, shadowDepth / SHADOW_MAX_WIDTH, 1);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.9 * (0.45 + k * 0.55);
    this.shadow.position.x = this.mesh.position.x;

    if (this.illumination !== null) {
      const illum = this.illumination;
      illum.intensity = Math.max(0, illum.intensity - illum.decayPerSec * dt);
      if (illum.intensity <= 0.001) {
        this.mat.emissive.setHex(illum.baseHex);
        this.mat.emissiveIntensity = BASE_EMISSIVE_INTENSITY;
        this.illumination = null;
      } else {
        this.mat.emissive.copy(this.baseEmissive).lerp(illum.color, Math.min(1, illum.intensity));
        this.mat.emissiveIntensity = BASE_EMISSIVE_INTENSITY + illum.intensity * 0.9;
      }
    }
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
      baseHex: BASE_EMISSIVE_HEX,
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
      this.gif.texture.dispose();
    }
  }
}
