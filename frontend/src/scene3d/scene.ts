import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';

import { RUNNERS } from './attack-runners';
import type { AnimatedElement, AttackEffect3D, Runner3D } from './attack-runners/types';
import { DEFAULT_EFFECT_DURATION_S, ELEMENT_LIGHT_COLOR } from './attack-runners/types';
import { FORMATION_SIDE_X, FORMATION_SLOT_Z_SPACING, SpriteRig, slotWorldPosition, type SpriteRigConfig, type SpriteSide } from './sprite-rig';

export type SpriteInit = SpriteRigConfig;

export type SceneSettings = {
  sunColor: number;
  sunIntensity: number;
  sunPosX: number;
  sunPosY: number;
  sunPosZ: number;
  shadowsEnabled: boolean;
  shadowRadius: number;
  shadowBias: number;
  shadowNormalBias: number;
  shadowMapSize: number;
  fogEnabled: boolean;
  fogMode: 'linear' | 'exp2' | 'height';
  fogColor: number;
  fogNear: number;
  fogFar: number;
  fogDensity: number;
  fogHeight: number;
  arenaSpan: number;
  arenaOffsetX: number;
  arenaOffsetY: number;
  arenaOffsetZ: number;
  cameraType: 'ortho' | 'perspective';
  camFov: number;
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
  rimColor: number;
  rimIntensity: number;
  fillColor: number;
  fillIntensity: number;
  exposure: number;
  dustOpacity: number;
  camElevDeg: number;
  camYawDeg: number;
  camDist: number;
  camLookAtY: number;
  camFrustum: number;
};

const FRUSTUM = 4.5;
const CAM_ELEV_DEG = 22;
const CAM_YAW_DEG = 22;
const CAM_DIST = 14;
const CAM_LOOK_AT_Y = 0.6;
const ENTRANCE_ZOOM_START = 1.55;
const ENTRANCE_DURATION_S = 1.2;
const ENTRANCE_PAN_START_X = 9;

const SKY_COLOR = 0x0f1420;
const HORIZON_COLOR = 0x1e2a44;
const GROUND_COLOR = 0x1b2130;
const FOG_NEAR = 12;
const FOG_FAR = 32;

type ArenaAtmosphere = {
  readonly key: string;
  readonly sky: number;
  readonly ground: number;
  readonly hemiIntensity: number;
  readonly keyColor: number;
  readonly keyIntensity: number;
  readonly keyPos: readonly [number, number, number];
  readonly rimColor: number;
  readonly rimIntensity: number;
  readonly fillColor: number;
  readonly fillIntensity: number;
  readonly fogColor: number;
  readonly fogNear: number;
  readonly fogFar: number;
  readonly exposure: number;
  readonly dustColor: number;
  readonly dustOpacity: number;
};

const ARENA_ATMOSPHERES: Readonly<Record<string, ArenaAtmosphere>> = {
  plant: {
    key: 'plant',
    sky: 0xffd7a8,
    ground: 0x3a5a2a,
    hemiIntensity: 0.85,
    keyColor: 0xffeac2,
    keyIntensity: 1.15,
    keyPos: [-8, 12, 6],
    rimColor: 0x8fbf5a,
    rimIntensity: 0.42,
    fillColor: 0xffb47a,
    fillIntensity: 0.32,
    fogColor: 0xd0d6b8,
    fogNear: 18,
    fogFar: 48,
    exposure: 1.12,
    dustColor: 0xfff2c8,
    dustOpacity: 0.28,
  },
  steel: {
    key: 'steel',
    sky: 0x60789a,
    ground: 0x1a2028,
    hemiIntensity: 0.55,
    keyColor: 0xffe0a8,
    keyIntensity: 1.05,
    keyPos: [-6, 12, 4],
    rimColor: 0x2c74ff,
    rimIntensity: 0.6,
    fillColor: 0xffb676,
    fillIntensity: 0.22,
    fogColor: 0x1b2230,
    fogNear: 14,
    fogFar: 40,
    exposure: 1.0,
    dustColor: 0xa8b4c8,
    dustOpacity: 0.22,
  },
  water: {
    key: 'water',
    sky: 0x9ed4ff,
    ground: 0x2d4a68,
    hemiIntensity: 0.9,
    keyColor: 0xfff2c8,
    keyIntensity: 1.1,
    keyPos: [-6, 12, 5],
    rimColor: 0x5abfff,
    rimIntensity: 0.55,
    fillColor: 0x8fd4ff,
    fillIntensity: 0.35,
    fogColor: 0xb8d4e6,
    fogNear: 20,
    fogFar: 55,
    exposure: 1.15,
    dustColor: 0xd4f0ff,
    dustOpacity: 0.24,
  },
  rock: {
    key: 'rock',
    sky: 0xffbf80,
    ground: 0x5a3820,
    hemiIntensity: 0.75,
    keyColor: 0xffd28a,
    keyIntensity: 1.2,
    keyPos: [-9, 10, 3],
    rimColor: 0xff7a4a,
    rimIntensity: 0.5,
    fillColor: 0xffb090,
    fillIntensity: 0.28,
    fogColor: 0xc48068,
    fogNear: 16,
    fogFar: 46,
    exposure: 1.08,
    dustColor: 0xffddb8,
    dustOpacity: 0.34,
  },
  dark: {
    key: 'dark',
    sky: 0x2a2440,
    ground: 0x0a0812,
    hemiIntensity: 0.35,
    keyColor: 0x8f7aff,
    keyIntensity: 0.7,
    keyPos: [-4, 10, 6],
    rimColor: 0xc74aff,
    rimIntensity: 0.65,
    fillColor: 0x4a3070,
    fillIntensity: 0.18,
    fogColor: 0x120a1e,
    fogNear: 10,
    fogFar: 32,
    exposure: 0.9,
    dustColor: 0xa88fff,
    dustOpacity: 0.32,
  },
  fire: {
    key: 'fire',
    sky: 0x2a0a0a,
    ground: 0x1a0808,
    hemiIntensity: 0.4,
    keyColor: 0xff6a2a,
    keyIntensity: 1.3,
    keyPos: [-6, 10, 4],
    rimColor: 0xff4a2a,
    rimIntensity: 0.7,
    fillColor: 0xff8060,
    fillIntensity: 0.35,
    fogColor: 0x3a0a05,
    fogNear: 12,
    fogFar: 36,
    exposure: 0.98,
    dustColor: 0xff9a4a,
    dustOpacity: 0.4,
  },
  ice: {
    key: 'ice',
    sky: 0xc8e8ff,
    ground: 0xd0e0f0,
    hemiIntensity: 1.0,
    keyColor: 0xf0f8ff,
    keyIntensity: 1.2,
    keyPos: [-7, 12, 5],
    rimColor: 0x80c8ff,
    rimIntensity: 0.55,
    fillColor: 0xa8d4ff,
    fillIntensity: 0.32,
    fogColor: 0xd8ecf5,
    fogNear: 20,
    fogFar: 60,
    exposure: 1.2,
    dustColor: 0xffffff,
    dustOpacity: 0.3,
  },
  field: {
    key: 'field',
    sky: 0xb8d8f0,
    ground: 0x4a7a3a,
    hemiIntensity: 0.9,
    keyColor: 0xffeac0,
    keyIntensity: 1.2,
    keyPos: [-8, 13, 5],
    rimColor: 0x8fc74a,
    rimIntensity: 0.5,
    fillColor: 0xffd8a0,
    fillIntensity: 0.3,
    fogColor: 0xe0e6c8,
    fogNear: 22,
    fogFar: 55,
    exposure: 1.15,
    dustColor: 0xf0e0a0,
    dustOpacity: 0.28,
  },
  null: {
    key: 'null',
    sky: 0xf0d8d8,
    ground: 0xd8c0a8,
    hemiIntensity: 0.75,
    keyColor: 0xfff0e0,
    keyIntensity: 1.0,
    keyPos: [-6, 11, 5],
    rimColor: 0xd8a8f0,
    rimIntensity: 0.4,
    fillColor: 0xffd8b8,
    fillIntensity: 0.28,
    fogColor: 0xe8d0c0,
    fogNear: 18,
    fogFar: 50,
    exposure: 1.05,
    dustColor: 0xf0c8d0,
    dustOpacity: 0.24,
  },
  wind: {
    key: 'wind',
    sky: 0xd4e8f0,
    ground: 0x8a8478,
    hemiIntensity: 0.95,
    keyColor: 0xfff4d8,
    keyIntensity: 1.15,
    keyPos: [-8, 14, 6],
    rimColor: 0xa0c8e0,
    rimIntensity: 0.5,
    fillColor: 0xb0c4d0,
    fillIntensity: 0.28,
    fogColor: 0xd8e4ec,
    fogNear: 18,
    fogFar: 55,
    exposure: 1.1,
    dustColor: 0xffffff,
    dustOpacity: 0.35,
  },
  light: {
    key: 'light',
    sky: 0xf2ead0,
    ground: 0xd9cfaa,
    hemiIntensity: 1.05,
    keyColor: 0xfff6d8,
    keyIntensity: 1.25,
    keyPos: [-7, 13, 6],
    rimColor: 0xffe08a,
    rimIntensity: 0.58,
    fillColor: 0xffefd0,
    fillIntensity: 0.32,
    fogColor: 0xf4ead0,
    fogNear: 24,
    fogFar: 62,
    exposure: 1.18,
    dustColor: 0xfff2c0,
    dustOpacity: 0.32,
  },
};

const DEFAULT_ATMOSPHERE: ArenaAtmosphere = {
  key: 'default',
  sky: 0x88a8d0,
  ground: GROUND_COLOR,
  hemiIntensity: 0.62,
  keyColor: 0xfff2d0,
  keyIntensity: 1.0,
  keyPos: [-6, 10, 5],
  rimColor: 0x2c74ff,
  rimIntensity: 0.55,
  fillColor: 0xffd18a,
  fillIntensity: 0.28,
  fogColor: HORIZON_COLOR,
  fogNear: FOG_NEAR,
  fogFar: FOG_FAR,
  exposure: 1.05,
  dustColor: 0xffffff,
  dustOpacity: 0.2,
};

function easeOutCubic(t: number): number {
  const c = 1 - t;
  return 1 - c * c * c;
}

function hashRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildGroundTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('scene: 2d context unavailable for ground texture');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.15, size / 2, size / 2, size * 0.65);
  g.addColorStop(0, '#243046');
  g.addColorStop(0.6, '#1a2334');
  g.addColorStop(1, '#0f1520');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const rng = hashRng(0x9e3779b9);
  ctx.fillStyle = 'rgba(120,150,200,0.045)';
  for (let x = 0; x < size; x += 32) {
    ctx.fillRect(x, 0, 1, size);
    ctx.fillRect(0, x, size, 1);
  }
  ctx.fillStyle = 'rgba(140,180,240,0.07)';
  for (let i = 0; i < 380; i += 1) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    const r = 1 + Math.floor(rng() * 2);
    ctx.fillRect(x, y, r, r);
  }
  ctx.fillStyle = 'rgba(240,220,180,0.03)';
  for (let i = 0; i < 60; i += 1) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    ctx.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('scene: 2d context unavailable for sky texture');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#080b13');
  g.addColorStop(0.4, '#101830');
  g.addColorStop(0.75, '#1c2a48');
  g.addColorStop(1, '#0b1220');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

export class SceneManager {
  readonly scene: THREE.Scene;
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly clock: THREE.Clock;
  private readonly hemi: THREE.HemisphereLight;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private readonly ground: THREE.Mesh;
  private readonly propsGroup: THREE.Group;
  private readonly ringsGroup: THREE.Group;
  private readonly arenaGroup: THREE.Group;
  private readonly floatingProps: Array<{ mesh: THREE.Mesh; baseY: number; rotationSpeed: number; bobSpeed: number; bobOffset: number; bobAmp: number }> = [];
  private readonly sprites: Map<string, SpriteRig> = new Map();
  private readonly effects: Map<string, { runner: Runner3D; elapsed: number; duration: number }> = new Map();
  private rafId = 0;
  private disposedFlag = false;
  private stageWidth = 1;
  private stageHeight = 1;
  private zoomMult = 1;
  private entranceElapsed = 0;
  private entranceActive = false;
  private atmosphere: ArenaAtmosphere = DEFAULT_ATMOSPHERE;
  private camElevDeg = CAM_ELEV_DEG;
  private camYawDeg = CAM_YAW_DEG;
  private camDist = CAM_DIST;
  private camLookAtY = CAM_LOOK_AT_Y;
  private camFrustum = FRUSTUM;
  private dust: THREE.Points | null = null;
  private readonly dustBaseY: Float32Array;
  private readonly dustPhase: Float32Array;
  private readonly dustBaseXZ: Float32Array;
  private skyTexture: THREE.CanvasTexture | null = null;
  private currentFogMode: 'linear' | 'exp2' | 'height' = 'linear';
  private currentFogEnabled = true;
  private currentArenaSpan = 28;
  private currentArenaOffsetX = 0;
  private currentArenaOffsetY = 0;
  private currentArenaOffsetZ = 0;
  private currentCameraType: 'ortho' | 'perspective' = 'ortho';
  private currentCamFov = 45;
  private currentArenaUrl: string | null = null;
  private currentArenaKey: string | null = null;
  private readonly heightFogUniforms = { fogHeight: { value: 2.0 } };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.skyTexture = buildSkyTexture();
    this.scene.background = this.skyTexture;
    this.scene.fog = new THREE.Fog(HORIZON_COLOR, FOG_NEAR, FOG_FAR);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.placeCameraIso();

    this.hemi = new THREE.HemisphereLight(0x88a8d0, GROUND_COLOR, 0.62);
    this.scene.add(this.hemi);

    this.keyLight = new THREE.DirectionalLight(0xfff2d0, 1.0);
    this.keyLight.position.set(-6, 10, 5);
    this.keyLight.target.position.set(0, 0, 0);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.keyLight.shadow.radius = 8;
    this.keyLight.shadow.blurSamples = 24;
    this.updateShadowCameraBounds();
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.rimLight = new THREE.DirectionalLight(0x2c74ff, 0.55);
    this.rimLight.position.set(6, 5, -6);
    this.scene.add(this.rimLight);

    this.fillLight = new THREE.DirectionalLight(0xffd18a, 0.28);
    this.fillLight.position.set(4, 3, 8);
    this.scene.add(this.fillLight);

    this.ground = this.buildGround();
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.ringsGroup = new THREE.Group();
    this.scene.add(this.ringsGroup);
    this.buildTeamSideRings();

    this.propsGroup = new THREE.Group();
    this.scene.add(this.propsGroup);
    this.buildEnvironmentProps();

    this.arenaGroup = new THREE.Group();
    this.scene.add(this.arenaGroup);

    const dustCount = 90;
    this.dustBaseY = new Float32Array(dustCount);
    this.dustPhase = new Float32Array(dustCount);
    this.dustBaseXZ = new Float32Array(dustCount * 2);
    this.dust = this.buildDust(dustCount);
    this.scene.add(this.dust);

    this.clock = new THREE.Clock();
  }

  private buildDust(count: number): THREE.Points {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const rng = hashRng(0xdadaface);
    for (let i = 0; i < count; i += 1) {
      const x = (rng() - 0.5) * 32;
      const z = (rng() - 0.5) * 24;
      const y = 0.6 + rng() * 5.2;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      this.dustBaseXZ[i * 2] = x;
      this.dustBaseXZ[i * 2 + 1] = z;
      this.dustBaseY[i] = y;
      this.dustPhase[i] = rng() * Math.PI * 2;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: DEFAULT_ATMOSPHERE.dustColor,
      size: 0.055,
      transparent: true,
      opacity: DEFAULT_ATMOSPHERE.dustOpacity,
      depthWrite: false,
      sizeAttenuation: true,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geometry, material);
  }

  private applyAtmosphere(atmosphere: ArenaAtmosphere): void {
    if (this.disposedFlag) return;
    this.atmosphere = atmosphere;
    this.hemi.color.setHex(atmosphere.sky);
    this.hemi.groundColor.setHex(atmosphere.ground);
    this.hemi.intensity = atmosphere.hemiIntensity;
    this.keyLight.color.setHex(atmosphere.keyColor);
    this.keyLight.intensity = atmosphere.keyIntensity;
    this.keyLight.position.set(atmosphere.keyPos[0], atmosphere.keyPos[1], atmosphere.keyPos[2]);
    this.rimLight.color.setHex(atmosphere.rimColor);
    this.rimLight.intensity = atmosphere.rimIntensity;
    this.fillLight.color.setHex(atmosphere.fillColor);
    this.fillLight.intensity = atmosphere.fillIntensity;
    if (this.currentFogEnabled) {
      if (this.currentFogMode === 'exp2' || this.currentFogMode === 'height') {
        const prevExp = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog.density : 0.035;
        this.scene.fog = new THREE.FogExp2(atmosphere.fogColor, prevExp);
        if (this.currentFogMode === 'height') this.applyHeightFogToScene();
      } else {
        this.scene.fog = new THREE.Fog(atmosphere.fogColor, atmosphere.fogNear, atmosphere.fogFar);
      }
    } else {
      this.scene.fog = null;
    }
    this.renderer.toneMappingExposure = atmosphere.exposure;
    if (this.dust !== null) {
      const mat = this.dust.material as THREE.PointsMaterial;
      mat.color.setHex(atmosphere.dustColor);
      mat.opacity = atmosphere.dustOpacity;
      mat.needsUpdate = true;
    }
  }

  setArenaAtmosphere(arenaKey: string | null): void {
    const atm = arenaKey !== null ? (ARENA_ATMOSPHERES[arenaKey] ?? DEFAULT_ATMOSPHERE) : DEFAULT_ATMOSPHERE;
    this.applyAtmosphere(atm);
  }

  setBackdropActive(active: boolean): void {
    if (this.disposedFlag) return;
    if (active) {
      this.scene.background = null;
      this.ground.visible = false;
      this.propsGroup.visible = false;
    } else {
      if (this.skyTexture === null) this.skyTexture = buildSkyTexture();
      this.scene.background = this.skyTexture;
      this.ground.visible = true;
      this.propsGroup.visible = true;
      this.applyAtmosphere(DEFAULT_ATMOSPHERE);
    }
  }

  private placeCameraIso(): void {
    const elev = (this.camElevDeg * Math.PI) / 180;
    const yaw = (this.camYawDeg * Math.PI) / 180;
    this.camera.position.set(
      Math.sin(yaw) * Math.cos(elev) * this.camDist,
      Math.sin(elev) * this.camDist,
      Math.cos(yaw) * Math.cos(elev) * this.camDist,
    );
    this.camera.lookAt(0, this.camLookAtY, 0);
  }

  private updateProjection(): void {
    const aspect = this.stageWidth / this.stageHeight;
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = aspect;
      this.camera.fov = this.currentCamFov;
      this.camera.zoom = 1 / this.zoomMult;
      this.camera.updateProjectionMatrix();
    } else {
      const f = this.camFrustum * this.zoomMult;
      this.camera.left = -f * aspect;
      this.camera.right = f * aspect;
      this.camera.top = f;
      this.camera.bottom = -f;
      this.camera.updateProjectionMatrix();
    }
  }

  private makeCamera(type: 'ortho' | 'perspective'): THREE.OrthographicCamera | THREE.PerspectiveCamera {
    if (type === 'perspective') {
      const aspect = this.stageWidth / Math.max(1, this.stageHeight);
      return new THREE.PerspectiveCamera(this.currentCamFov, aspect, 0.1, 100);
    }
    return new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  }

  private updateShadowCameraBounds(): void {
    const half = this.currentArenaSpan / 2 + 6;
    const cam = this.keyLight.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 0.5;
    cam.far = Math.max(45, this.currentArenaSpan * 2.5);
    cam.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
  }

  private buildGround(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(80, 80, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      map: buildGroundTexture(),
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0;
    return mesh;
  }

  private buildTeamSideRings(): void {
    const geometry = new THREE.RingGeometry(0.55, 0.62, 32);
    const buildFor = (sign: number, color: number): void => {
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, fog: false });
      for (let i = 0; i < 3; i += 1) {
        const ring = new THREE.Mesh(geometry, material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(sign * FORMATION_SIDE_X, 0.03, (i - 1) * FORMATION_SLOT_Z_SPACING);
        this.ringsGroup.add(ring);
      }
    };
    buildFor(-1, 0x1677ff);
    buildFor(1, 0xe0384a);
  }

  private buildEnvironmentProps(): void {
    const rng = hashRng(0xc0ffee);
    const rockGeom = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x3a4a6a,
      roughness: 0.75,
      metalness: 0.18,
      flatShading: true,
      emissive: 0x0a1020,
      emissiveIntensity: 0.4,
    });
    const rockPositions: ReadonlyArray<readonly [number, number, number]> = [
      [-8, 0.9, -6],
      [8.5, 1.2, -5],
      [-9, 0.7, 5.5],
      [9, 0.9, 6.5],
      [-11, 0.5, 0],
      [11, 0.6, 0.5],
      [-7, 0.35, -2],
      [7.5, 0.35, 2.5],
    ];
    for (const [x, y, z] of rockPositions) {
      const s = 0.7 + rng() * 0.9;
      const mesh = new THREE.Mesh(rockGeom, rockMat);
      mesh.scale.set(s, s * (0.7 + rng() * 0.6), s);
      mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.propsGroup.add(mesh);
    }

    const pillarGeom = new THREE.CylinderGeometry(0.28, 0.35, 3.4, 6, 1, false);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x5a6580,
      roughness: 0.6,
      metalness: 0.35,
      emissive: 0x1677ff,
      emissiveIntensity: 0.06,
    });
    const pillarPositions: ReadonlyArray<readonly [number, number]> = [
      [-4, -8],
      [4, -8],
      [-4, 8],
      [4, 8],
    ];
    for (const [x, z] of pillarPositions) {
      const pillar = new THREE.Mesh(pillarGeom, pillarMat);
      pillar.position.set(x, 1.7, z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.propsGroup.add(pillar);
    }

    const orbGeom = new THREE.SphereGeometry(0.16, 12, 12);
    const orbMats = [
      new THREE.MeshBasicMaterial({ color: 0x1677ff, fog: false }),
      new THREE.MeshBasicMaterial({ color: 0xe0384a, fog: false }),
      new THREE.MeshBasicMaterial({ color: 0xffd166, fog: false }),
    ];
    const orbPositions: ReadonlyArray<readonly [number, number, number]> = [
      [-4, 2.2, -8],
      [4, 2.2, -8],
      [-4, 2.2, 8],
      [4, 2.2, 8],
      [-11, 1.6, -1],
      [11, 1.6, 1.5],
    ];
    for (let i = 0; i < orbPositions.length; i += 1) {
      const [x, y, z] = orbPositions[i]!;
      const orb = new THREE.Mesh(orbGeom, orbMats[i % orbMats.length]!);
      orb.position.set(x, y, z);
      this.propsGroup.add(orb);
      this.floatingProps.push({
        mesh: orb,
        baseY: y,
        rotationSpeed: 0.3 + rng() * 0.4,
        bobSpeed: 0.7 + rng() * 0.6,
        bobOffset: rng() * Math.PI * 2,
        bobAmp: 0.12 + rng() * 0.08,
      });
    }
  }

  async loadArenaModel(url: string): Promise<void> {
    if (this.disposedFlag) return;
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    if (this.disposedFlag) return;
    this.disposeArenaChildren();
    const root = gltf.scene;
    this.normalizeArenaTransform(root);
    this.arenaGroup.add(root);
    this.currentArenaUrl = url;
    this.setBackdropActive(true);
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.frustumCulled = false;
    });
    if (this.currentFogMode === 'height') {
      root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => this.applyHeightFogTo(m));
        else this.applyHeightFogTo(mat);
      });
    }
  }

  async loadArenaModelWithAtmosphere(url: string, arenaKey: string): Promise<void> {
    this.currentArenaKey = arenaKey;
    this.setArenaAtmosphere(arenaKey);
    await this.loadArenaModel(url);
  }

  private normalizeArenaTransform(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const targetSpan = this.currentArenaSpan;
    const currentSpan = Math.max(size.x, size.z, 0.001);
    const scale = targetSpan / currentSpan;
    root.scale.setScalar(scale);
    root.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    root.updateMatrixWorld(true);
    const playFloorY = this.detectPlayFloorY(root);
    if (playFloorY > 0) {
      root.position.y -= playFloorY;
      root.updateMatrixWorld(true);
    }
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.frustumCulled = false;
    });
    this.renderer.shadowMap.needsUpdate = true;
  }

  private detectPlayFloorY(root: THREE.Object3D): number {
    const meshBox = new THREE.Box3();
    let bestArea = 0;
    let bestFloorY = 0;
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      meshBox.setFromObject(obj);
      const spanX = meshBox.max.x - meshBox.min.x;
      const spanZ = meshBox.max.z - meshBox.min.z;
      const spanY = meshBox.max.y - meshBox.min.y;
      if (spanY > 1.5) return;
      if (meshBox.max.y > 3.5) return;
      const area = spanX * spanZ;
      if (area > bestArea) {
        bestArea = area;
        bestFloorY = meshBox.max.y;
      }
    });
    return bestFloorY;
  }

  private disposeArenaChildren(): void {
    while (this.arenaGroup.children.length > 0) {
      const child = this.arenaGroup.children[0]!;
      this.arenaGroup.remove(child);
      child.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          const mat = node.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    }
  }

  clearArenaModel(): void {
    if (this.disposedFlag) return;
    this.disposeArenaChildren();
    this.setBackdropActive(false);
  }

  getSettings(): SceneSettings {
    const fog = this.scene.fog;
    const fogAsLinear = fog instanceof THREE.Fog ? fog : null;
    const fogAsExp = fog instanceof THREE.FogExp2 ? fog : null;
    return {
      sunColor: this.keyLight.color.getHex(),
      sunIntensity: this.keyLight.intensity,
      sunPosX: this.keyLight.position.x,
      sunPosY: this.keyLight.position.y,
      sunPosZ: this.keyLight.position.z,
      shadowsEnabled: this.renderer.shadowMap.enabled,
      shadowRadius: this.keyLight.shadow.radius,
      shadowBias: this.keyLight.shadow.bias,
      shadowNormalBias: this.keyLight.shadow.normalBias,
      shadowMapSize: this.keyLight.shadow.mapSize.x,
      fogEnabled: this.currentFogEnabled && fog !== null,
      fogMode: this.currentFogMode,
      fogColor: fogAsLinear ? fogAsLinear.color.getHex() : (fogAsExp ? fogAsExp.color.getHex() : 0x000000),
      fogNear: fogAsLinear ? fogAsLinear.near : 12,
      fogFar: fogAsLinear ? fogAsLinear.far : 32,
      fogDensity: fogAsExp ? fogAsExp.density : 0.035,
      fogHeight: this.heightFogUniforms.fogHeight.value,
      hemiSkyColor: this.hemi.color.getHex(),
      hemiGroundColor: this.hemi.groundColor.getHex(),
      hemiIntensity: this.hemi.intensity,
      rimColor: this.rimLight.color.getHex(),
      rimIntensity: this.rimLight.intensity,
      fillColor: this.fillLight.color.getHex(),
      fillIntensity: this.fillLight.intensity,
      exposure: this.renderer.toneMappingExposure,
      dustOpacity: this.dust !== null ? (this.dust.material as THREE.PointsMaterial).opacity : 0,
      camElevDeg: this.camElevDeg,
      camYawDeg: this.camYawDeg,
      camDist: this.camDist,
      camLookAtY: this.camLookAtY,
      camFrustum: this.camFrustum,
      arenaSpan: this.currentArenaSpan,
      arenaOffsetX: this.currentArenaOffsetX,
      arenaOffsetY: this.currentArenaOffsetY,
      arenaOffsetZ: this.currentArenaOffsetZ,
      cameraType: this.currentCameraType,
      camFov: this.currentCamFov,
    };
  }

  private applyHeightFogTo(material: THREE.Material): void {
    if (material.userData['_heightFogApplied'] === true) return;
    material.userData['_heightFogApplied'] = true;
    const uniforms = this.heightFogUniforms;
    material.onBeforeCompile = (shader) => {
      shader.uniforms['fogHeight'] = uniforms.fogHeight;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <fog_pars_vertex>',
          '#include <fog_pars_vertex>\nvarying vec3 vFogWorldPosition;',
        )
        .replace(
          '#include <fog_vertex>',
          '#include <fog_vertex>\nvFogWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <fog_pars_fragment>',
          '#include <fog_pars_fragment>\nvarying vec3 vFogWorldPosition;\nuniform float fogHeight;',
        )
        .replace(
          '#include <fog_fragment>',
          `#ifdef USE_FOG
  vec3 fogOrigin = cameraPosition;
  vec3 fogDirection = normalize(vFogWorldPosition - fogOrigin);
  float rayLength = distance(vFogWorldPosition, fogOrigin);
  float c1 = exp(fogDensity * (fogHeight - cameraPosition.y));
  float rayY = fogDirection.y;
  float c2 = c1 * (exp(fogDensity * rayY * rayLength) - 1.0) / (rayY + 0.0001);
  float fogFactor = clamp(1.0 - exp(-c2), 0.0, 1.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`,
        );
    };
    material.needsUpdate = true;
  }

  private removeHeightFogFrom(material: THREE.Material): void {
    if (material.userData['_heightFogApplied'] !== true) return;
    material.userData['_heightFogApplied'] = false;
    material.onBeforeCompile = () => {};
    material.needsUpdate = true;
  }

  private forEachSceneMaterial(fn: (material: THREE.Material) => void): void {
    this.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach(fn);
      else fn(mat);
    });
  }

  private applyHeightFogToScene(): void {
    this.forEachSceneMaterial((m) => this.applyHeightFogTo(m));
  }

  private removeHeightFogFromScene(): void {
    this.forEachSceneMaterial((m) => this.removeHeightFogFrom(m));
  }

  applySettings(patch: Partial<SceneSettings>): void {
    if (this.disposedFlag) return;
    if (patch.sunColor !== undefined) this.keyLight.color.setHex(patch.sunColor);
    if (patch.sunIntensity !== undefined) this.keyLight.intensity = patch.sunIntensity;
    if (patch.sunPosX !== undefined) this.keyLight.position.x = patch.sunPosX;
    if (patch.sunPosY !== undefined) this.keyLight.position.y = patch.sunPosY;
    if (patch.sunPosZ !== undefined) this.keyLight.position.z = patch.sunPosZ;
    if (patch.shadowsEnabled !== undefined) {
      this.renderer.shadowMap.enabled = patch.shadowsEnabled;
      this.keyLight.castShadow = patch.shadowsEnabled;
    }
    if (patch.shadowRadius !== undefined) this.keyLight.shadow.radius = patch.shadowRadius;
    if (patch.shadowBias !== undefined) this.keyLight.shadow.bias = patch.shadowBias;
    if (patch.shadowNormalBias !== undefined) this.keyLight.shadow.normalBias = patch.shadowNormalBias;
    if (patch.shadowMapSize !== undefined) {
      this.keyLight.shadow.mapSize.set(patch.shadowMapSize, patch.shadowMapSize);
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null;
    }
    if (patch.fogEnabled !== undefined || patch.fogMode !== undefined || patch.fogColor !== undefined || patch.fogNear !== undefined || patch.fogFar !== undefined || patch.fogDensity !== undefined || patch.fogHeight !== undefined) {
      const fog = this.scene.fog;
      const fogAsLinear = fog instanceof THREE.Fog ? fog : null;
      const fogAsExp = fog instanceof THREE.FogExp2 ? fog : null;
      const prevMode = this.currentFogMode;
      const enabled = patch.fogEnabled ?? this.currentFogEnabled;
      const mode = patch.fogMode ?? this.currentFogMode;
      this.currentFogEnabled = enabled;
      this.currentFogMode = mode;
      if (patch.fogHeight !== undefined) this.heightFogUniforms.fogHeight.value = patch.fogHeight;
      if (enabled) {
        const color = patch.fogColor ?? (fogAsLinear?.color.getHex() ?? fogAsExp?.color.getHex() ?? 0x1e2a44);
        if (mode === 'exp2' || mode === 'height') {
          const density = patch.fogDensity ?? (fogAsExp?.density ?? 0.035);
          this.scene.fog = new THREE.FogExp2(color, density);
        } else {
          const near = patch.fogNear ?? (fogAsLinear?.near ?? 12);
          const far = patch.fogFar ?? (fogAsLinear?.far ?? 32);
          this.scene.fog = new THREE.Fog(color, near, far);
        }
      } else {
        this.scene.fog = null;
      }
      if (mode === 'height' && (prevMode !== 'height' || patch.fogMode === 'height')) {
        this.applyHeightFogToScene();
      } else if (mode !== 'height' && prevMode === 'height') {
        this.removeHeightFogFromScene();
      }
    }
    if (patch.hemiSkyColor !== undefined) this.hemi.color.setHex(patch.hemiSkyColor);
    if (patch.hemiGroundColor !== undefined) this.hemi.groundColor.setHex(patch.hemiGroundColor);
    if (patch.hemiIntensity !== undefined) this.hemi.intensity = patch.hemiIntensity;
    if (patch.rimColor !== undefined) this.rimLight.color.setHex(patch.rimColor);
    if (patch.rimIntensity !== undefined) this.rimLight.intensity = patch.rimIntensity;
    if (patch.fillColor !== undefined) this.fillLight.color.setHex(patch.fillColor);
    if (patch.fillIntensity !== undefined) this.fillLight.intensity = patch.fillIntensity;
    if (patch.exposure !== undefined) this.renderer.toneMappingExposure = patch.exposure;
    if (patch.dustOpacity !== undefined && this.dust !== null) {
      (this.dust.material as THREE.PointsMaterial).opacity = patch.dustOpacity;
    }
    let cameraChanged = false;
    if (patch.camElevDeg !== undefined) { this.camElevDeg = patch.camElevDeg; cameraChanged = true; }
    if (patch.camYawDeg !== undefined) { this.camYawDeg = patch.camYawDeg; cameraChanged = true; }
    if (patch.camDist !== undefined) { this.camDist = patch.camDist; cameraChanged = true; }
    if (patch.camLookAtY !== undefined) { this.camLookAtY = patch.camLookAtY; cameraChanged = true; }
    if (patch.camFrustum !== undefined) { this.camFrustum = patch.camFrustum; this.updateProjection(); }
    if (patch.camFov !== undefined) this.currentCamFov = patch.camFov;
    if (patch.cameraType !== undefined && patch.cameraType !== this.currentCameraType) {
      this.currentCameraType = patch.cameraType;
      this.camera = this.makeCamera(patch.cameraType);
      this.placeCameraIso();
      this.updateProjection();
    } else if (patch.camFov !== undefined && this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.fov = patch.camFov;
      this.camera.updateProjectionMatrix();
    }
    if (cameraChanged) this.placeCameraIso();
    if (patch.arenaSpan !== undefined && patch.arenaSpan !== this.currentArenaSpan) {
      this.currentArenaSpan = patch.arenaSpan;
      this.updateShadowCameraBounds();
      const root = this.arenaGroup.children[0];
      if (root !== undefined) {
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        box.getSize(size);
        const worldSpan = Math.max(size.x, size.z, 0.001);
        const factor = this.currentArenaSpan / worldSpan;
        root.scale.multiplyScalar(factor);
      }
    }
    if (patch.arenaOffsetX !== undefined) this.currentArenaOffsetX = patch.arenaOffsetX;
    if (patch.arenaOffsetY !== undefined) this.currentArenaOffsetY = patch.arenaOffsetY;
    if (patch.arenaOffsetZ !== undefined) this.currentArenaOffsetZ = patch.arenaOffsetZ;
    if (patch.arenaOffsetX !== undefined || patch.arenaOffsetY !== undefined || patch.arenaOffsetZ !== undefined) {
      this.arenaGroup.position.set(this.currentArenaOffsetX, this.currentArenaOffsetY, this.currentArenaOffsetZ);
    }
  }

  resize(width: number, height: number): void {
    if (this.disposedFlag) return;
    if (width <= 0 || height <= 0) return;
    this.stageWidth = width;
    this.stageHeight = height;
    this.renderer.setSize(width, height, false);
    this.updateProjection();
  }

  runEntrance(): void {
    if (this.disposedFlag) return;
    this.entranceElapsed = 0;
    this.entranceActive = true;
    this.zoomMult = ENTRANCE_ZOOM_START;
    this.updateProjection();
  }

  addSprite(config: SpriteInit): SpriteRig {
    const existing = this.sprites.get(config.unitId);
    if (existing !== undefined) return existing;
    const sprite = new SpriteRig(this.scene, config);
    this.sprites.set(config.unitId, sprite);
    return sprite;
  }

  removeSprite(unitId: string): void {
    const sprite = this.sprites.get(unitId);
    if (sprite === undefined) return;
    sprite.dispose();
    this.sprites.delete(unitId);
  }

  getSprite(unitId: string): SpriteRig | undefined {
    return this.sprites.get(unitId);
  }

  getSpriteIds(): readonly string[] {
    return Array.from(this.sprites.keys());
  }

  clearSprites(): void {
    for (const sprite of this.sprites.values()) sprite.dispose();
    this.sprites.clear();
  }

  playEffect(
    element: AnimatedElement,
    sourceUnitId: string | null,
    targetUnitId: string,
    options: { readonly durationS?: number; readonly onImpact?: () => void } = {},
  ): string | null {
    const target = this.sprites.get(targetUnitId);
    if (target === undefined) return null;
    const source = sourceUnitId === null ? null : this.sprites.get(sourceUnitId) ?? null;
    const sourcePos = source === null
      ? target.worldPosition.clone().add(new THREE.Vector3(0, 4, 0))
      : source.worldPosition.clone();
    const targetPos = target.worldPosition.clone();
    const durationS = options.durationS ?? DEFAULT_EFFECT_DURATION_S;
    const id = `fx-${element}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const effect: AttackEffect3D = {
      id,
      element,
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      durationS,
      ...(options.onImpact ? { onImpact: options.onImpact } : {}),
    };

    if (source !== null) source.playAttack();

    const originalOnImpact = effect.onImpact;
    const wrappedEffect: AttackEffect3D = {
      ...effect,
      onImpact: () => {
        target.playHit();
        target.illuminate(ELEMENT_LIGHT_COLOR[element], 0.9, 3.5);
        originalOnImpact?.();
      },
    };

    const builder = RUNNERS[element];
    const runner = builder(this.scene, wrappedEffect);
    this.effects.set(id, { runner, elapsed: 0, duration: durationS });
    return id;
  }

  startLoop(): void {
    if (this.disposedFlag) return;
    if (this.rafId !== 0) return;
    const tick = (): void => {
      if (this.disposedFlag) return;
      const dt = this.clock.getDelta();
      const elapsed = this.clock.elapsedTime;
      if (this.entranceActive) {
        this.entranceElapsed += dt;
        const t = Math.min(1, this.entranceElapsed / ENTRANCE_DURATION_S);
        const eased = easeOutCubic(t);
        this.zoomMult = ENTRANCE_ZOOM_START + (1 - ENTRANCE_ZOOM_START) * eased;
        this.updateProjection();
        const panX = ENTRANCE_PAN_START_X * (1 - eased);
        this.camera.lookAt(panX, this.camLookAtY, 0);
        if (t >= 1) {
          this.zoomMult = 1;
          this.entranceActive = false;
          this.updateProjection();
          this.camera.lookAt(0, this.camLookAtY, 0);
        }
      }
      for (const sprite of this.sprites.values()) {
        sprite.update(dt, elapsed, this.camera.quaternion);
      }
      for (const prop of this.floatingProps) {
        prop.mesh.position.y = prop.baseY + Math.sin(elapsed * prop.bobSpeed + prop.bobOffset) * prop.bobAmp;
        prop.mesh.rotation.y += prop.rotationSpeed * dt;
      }
      if (this.dust !== null) {
        const positions = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr = positions.array as Float32Array;
        for (let i = 0; i < this.dustBaseY.length; i += 1) {
          const phase = this.dustPhase[i]! + elapsed * 0.18;
          arr[i * 3] = this.dustBaseXZ[i * 2]! + Math.sin(phase * 0.7) * 0.35;
          arr[i * 3 + 1] = this.dustBaseY[i]! + Math.sin(phase) * 0.22;
          arr[i * 3 + 2] = this.dustBaseXZ[i * 2 + 1]! + Math.cos(phase * 0.5) * 0.28;
        }
        positions.needsUpdate = true;
      }
      const swayPhase = elapsed * 0.11;
      const basePos = this.atmosphere.keyPos;
      this.keyLight.position.set(
        basePos[0] + Math.sin(swayPhase) * 0.35,
        basePos[1] + Math.sin(swayPhase * 1.7) * 0.15,
        basePos[2] + Math.cos(swayPhase) * 0.35,
      );
      this.hemi.intensity = this.atmosphere.hemiIntensity + Math.sin(elapsed * 0.28) * 0.03;
      const toRemove: string[] = [];
      for (const [id, ctx] of this.effects.entries()) {
        ctx.elapsed += dt;
        ctx.runner.tick(dt, elapsed, this.camera.quaternion);
        if (ctx.elapsed >= ctx.duration + 0.05) toRemove.push(id);
      }
      for (const id of toRemove) {
        const ctx = this.effects.get(id);
        ctx?.runner.dispose();
        this.effects.delete(id);
      }
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stopLoop(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private readonly projectScratch = new THREE.Vector3();

  projectWorldToScreen(worldPos: THREE.Vector3): { readonly x: number; readonly y: number } {
    const v = this.projectScratch.copy(worldPos);
    v.project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.stageWidth,
      y: (-v.y * 0.5 + 0.5) * this.stageHeight,
    };
  }

  dispose(): void {
    if (this.disposedFlag) return;
    this.disposedFlag = true;
    this.stopLoop();
    for (const ctx of this.effects.values()) ctx.runner.dispose();
    this.effects.clear();
    for (const sprite of this.sprites.values()) sprite.dispose();
    this.sprites.clear();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
    if (this.skyTexture !== null) {
      this.skyTexture.dispose();
      this.skyTexture = null;
    }
    this.renderer.dispose();
  }
}

export { slotWorldPosition };
export type { AnimatedElement, SpriteSide };
