import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";

import type {
  ParticleEmitterConfig,
  TimeOfDayConfig,
  WeatherConfig,
} from "@digiworld/shared/weather";

import { RUNNERS } from "./attack-runners";
import { buildPresetRunner } from "./attack-runners/preset";
import type {
  AnimatedElement,
  AttackEffect3D,
  Runner3D,
} from "./attack-runners/types";
import {
  DEFAULT_EFFECT_DURATION_S,
  ELEMENT_LIGHT_COLOR,
} from "./attack-runners/types";
import {
  buildImpactController,
  shakeForElement,
  nextShakeOffset,
  IMPACT_SHAKE_DURATION_S,
} from "./attack-runners/impact";

/**
 * Where a skill effect leaves the attacker and where it lands on the receiver,
 * as fractions of each sprite's own size so they scale with the art rather than
 * being tuned per Digimon.
 *
 * Heights are measured from the sprite's centre, which is what `worldPosition`
 * reports; forward is a fraction of half-width, so ~0.9 sits just inside the
 * silhouette's leading edge instead of detaching from it.
 */
const EMIT_HEIGHT_RATIO = 0.18;
const EMIT_FORWARD_RATIO = 0.45;
const IMPACT_HEIGHT_RATIO = 0.08;
/** Fallback when no source unit is known: the effect falls from overhead. */
const UNSOURCED_DROP_HEIGHT = 4;
import { resolveSkillVfxPreset } from "./skill-vfx-resolver";
import {
  FORMATION_SIDE_X,
  FORMATION_SLOT_Z_SPACING,
  SpriteRig,
  slotWorldPosition,
  type SpriteRigConfig,
  type SpriteSide,
} from "./sprite-rig";
import { ParticleEmitter } from "./particles/ParticleEmitter";
import { ThunderFlashController } from "./particles/ThunderFlashController";
import { WEATHER_EMITTER_PRESETS } from "./particles/presets";
import { prewarmParticleMaterials } from "./particles/shaders";
import type { ParticleShaderKind } from "@digiworld/shared/weather";
import {
  TimeOfDayDriver,
  interpolatePhases,
  type PhasePreset,
} from "./time-of-day";

export type SpriteInit = SpriteRigConfig & {
  readonly onClick: (() => void | undefined) | undefined;
};

/**
 * Wraps a deferred attack-runner build so the (allocating) construction of
 * ParticleEmitters / ShaderMaterials happens on the next render tick, never on
 * the input/click frame. `playEffect` returns immediately with a runner-shaped
 * object; the real `Runner3D` is built lazily on first `tick`. This is what
 * removes the stutter on the first skill cast — the heavy work moves off the
 * frame that also handles input + sprite animation.
 */
function createDeferredRunner(build: () => Runner3D): Runner3D {
  let inner: Runner3D | null = null;
  let disposed = false;
  return {
    tick(dtS: number, elapsedS: number, cameraQuat: THREE.Quaternion): void {
      if (inner === null) {
        if (disposed) return;
        inner = build();
      }
      inner.tick(dtS, elapsedS, cameraQuat);
    },
    dispose(): void {
      disposed = true;
      if (inner !== null) inner.dispose();
    },
  };
}

function forceTransparencyIfAlpha(mat: THREE.Material): void {
  if (!("alphaMap" in mat)) return;
  const m = mat as THREE.MeshStandardMaterial;
  if (m.transparent) return;
  if (m.alphaMap === null || m.alphaMap === undefined) return;
  if (m.alphaTest === 0) m.alphaTest = 0.5;
  m.needsUpdate = true;
}

const FLOOR_NAME_PATTERNS: readonly RegExp[] = [
  /floor/i,
  /ground/i,
  /terrain/i,
  /surface/i,
  /platform/i,
  /base(?!ment)/i,
];

function isFloorNamed(mesh: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = mesh;
  while (node !== null) {
    const name = node.name;
    if (name.length > 0 && FLOOR_NAME_PATTERNS.some((p) => p.test(name)))
      return true;
    node = node.parent;
  }
  return false;
}

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
  fogMode: "linear" | "exp2" | "height";
  fogColor: number;
  fogNear: number;
  fogFar: number;
  fogDensity: number;
  fogHeight: number;
  arenaSpan: number;
  arenaOffsetX: number;
  arenaOffsetY: number;
  arenaOffsetZ: number;
  cameraType: "ortho" | "perspective";
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
  /** Filename picked by the admin scene editor (e.g. "my_scene.glb"). Persisted
   *  with the rest of the per-arena settings and consumed by Combat3DScene when
   *  choosing the arena mesh URL. SceneManager.applySettings ignores this field —
   *  it's a selector, not a runtime scene property. */
  modelFile?: string;
  /** Optional configuration for the LOBBY scene (the CSS-3D backdrop of the
   *  home/lobby screen). Defined here so the admin scene editor can persist it
   *  in the same SceneEntity, but ignored entirely by the combat SceneManager. */
  lobby?: LobbySceneSettings;
};

/**
 * Knobs for the lobby's 3D backdrop, edited in the admin scene editor under a
 * scene of `kind: 'lobby'`. The lobby's ENVIRONMENT always comes from the scene's
 * `modelFile` GLB (there is intentionally no procedural fallback stage — if a
 * lobby scene has no modelFile, the frontend falls back to the default arena
 * GLB, never to a generated set). These settings only shape the party stage
 * (fan formation + camera drift) on top of the GLB.
 *
 * Editor-split note: the scene editor is planned to be broken apart per
 * consumer (nursery / city / lobby / combat) reusing the same CRUD + zod
 * surface. Each `SceneKind` will bind its own `settings` subset; this type is
 * the `lobby` subset. Formatting knobs that the renderer does not yet consume
 * (e.g. `sideTiltDeg`) stay in the schema so the editor is stable and the
 * renderer can adopt them without a migration.
 */
export type LobbySceneSettings = {
  /** fan spread in px (256) — renderer divides by 108 for world units */
  pedestalSpacing: number;
  /** global pedestal scale 0.5..1.5 (1) */
  pedestalScale: number;
  /** side pedestal yaw in degrees (17) — reserved for the fan tilt pass */
  sideTiltDeg: number;
  /** center pedestal scale vs sides (1.1) */
  centerScale: number;
  /** center pedestal forward lift, px (36) — rendered as a "+z" offset */
  centerLift: number;
  /** Vertical world-offset of the party (pedestals + sprites) so the digimons
   *  actually seat on the scene's ground/ring — each GLB floors at a different
   *  height, and the admin needs a knob to realign. Range ≈ -3..3. */
  partyHeight: number;
  /** camera drift strength 0..2 (1); 0 disables the slow idle orbit.
   *  No effect while the GLB's embedded camera is adopted (useGlbSettings). */
  driftIntensity: number;
};

/** SceneEntity.name the Lobby screen looks up when no scene has kind 'lobby'. */
export const LOBBY_SCENE_NAME = "Lobby";

export const DEFAULT_LOBBY_SCENE: LobbySceneSettings = {
  pedestalSpacing: 256,
  pedestalScale: 1,
  sideTiltDeg: 17,
  centerScale: 1.1,
  centerLift: 36,
  partyHeight: 0,
  driftIntensity: 1,
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
    key: "plant",
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
    key: "steel",
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
    key: "water",
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
    key: "rock",
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
    key: "dark",
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
    key: "fire",
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
    key: "ice",
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
    key: "field",
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
    key: "null",
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
    key: "wind",
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
    key: "light",
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
  key: "default",
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

/**
 * GLB → arena-atmosphere override for the GLB-default fallback (see
 * `loadArenaModelBare`). Used when a GLB carries no punctual lights, so the
 * scene still gets a coherent atmosphere instead of the generic default.
 *
 * `arena.glb` is the neutral cyber/factory arena — dark steel panels, cable
 * trays, HDD/terminal props and self-lit screens — so its fallback is the
 * `steel` industrial look. This is the "atmosphere the GLB uses": it ships no
 * real lights (only `KHR_materials_emissive_strength` emissive surfaces), so
 * the closest keyed mood for it is `steel`.
 */
const GLB_ATMOSPHERE_BY_FILENAME: Readonly<Record<string, string>> = {
  'arena.glb': 'steel',
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
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null)
    throw new Error("scene: 2d context unavailable for ground texture");
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.15,
    size / 2,
    size / 2,
    size * 0.65,
  );
  g.addColorStop(0, "#243046");
  g.addColorStop(0.6, "#1a2334");
  g.addColorStop(1, "#0f1520");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const rng = hashRng(0x9e3779b9);
  ctx.fillStyle = "rgba(120,150,200,0.045)";
  for (let x = 0; x < size; x += 32) {
    ctx.fillRect(x, 0, 1, size);
    ctx.fillRect(0, x, size, 1);
  }
  ctx.fillStyle = "rgba(140,180,240,0.07)";
  for (let i = 0; i < 380; i += 1) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    const r = 1 + Math.floor(rng() * 2);
    ctx.fillRect(x, y, r, r);
  }
  ctx.fillStyle = "rgba(240,220,180,0.03)";
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
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (ctx === null)
    throw new Error("scene: 2d context unavailable for sky texture");
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#080b13");
  g.addColorStop(0.4, "#101830");
  g.addColorStop(0.75, "#1c2a48");
  g.addColorStop(1, "#0b1220");
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
  private readonly clock: THREE.Timer;
  private readonly hemi: THREE.HemisphereLight;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private readonly ground: THREE.Mesh;
  private readonly propsGroup: THREE.Group;
  private readonly ringsGroup: THREE.Group;
  private readonly arenaGroup: THREE.Group;
  private readonly floatingProps: Array<{
    mesh: THREE.Mesh;
    baseY: number;
    rotationSpeed: number;
    bobSpeed: number;
    bobOffset: number;
    bobAmp: number;
  }> = [];
  private readonly sprites: Map<string, SpriteRig> = new Map();
  private readonly effects: Map<
    string,
    { runner: Runner3D; elapsed: number; duration: number }
  > = new Map();
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
  // Camera base position (no shake). Shake offsets are added on top each frame
  // and recomputed from this, so they never accumulate across frames.
  private readonly cameraBasePos = new THREE.Vector3(0, 0, 0);
  private camLookAtY = CAM_LOOK_AT_Y;
  private cameraLookOffset = new THREE.Vector3(0, 0, 0);
  private camFrustum = FRUSTUM;
  private dust: THREE.Points | null = null;
  private readonly dustBaseY: Float32Array;
  private readonly dustPhase: Float32Array;
  private readonly dustBaseXZ: Float32Array;
  private skyTexture: THREE.CanvasTexture | null = null;
  private currentFogMode: "linear" | "exp2" | "height" = "linear";
  private currentFogEnabled = true;
  private currentArenaSpan = 28;
  private currentArenaOffsetX = 0;
  private currentArenaOffsetY = 0;
  private currentArenaOffsetZ = 0;
  private currentCameraType: "ortho" | "perspective" = "ortho";
  private currentCamFov = 45;

  // Screen-shake state: a transient positional offset applied to the camera
  // right before each render, decaying to zero over IMPACT_SHAKE_DURATION_S.
  // Triggered on skill impact so a landed hit jolts the stage.
  private shakeAmplitude = 0;
  private shakeElapsed = 0;
  private shakeActive = false;

  private readonly activeEmitters: Map<string, ParticleEmitter> = new Map();
  private readonly fadingEmitters: Array<{
    emitter: ParticleEmitter;
    elapsedS: number;
    durationS: number;
  }> = [];
  private currentWeather: WeatherConfig | null = null;
  private thunder: ThunderFlashController | null = null;
  private weatherFade: {
    elapsedS: number;
    durationS: number;
    active: boolean;
  } = { elapsedS: 0, durationS: 0, active: false };
  private baseSunColor = 0xfff2d0;
  private baseSunIntensity = 1.0;
  private baseHemiIntensity = 0.62;
  private timeDriver: TimeOfDayDriver | null = null;
  private phaseBlend: {
    fromPreset: PhasePreset;
    toPreset: PhasePreset;
    elapsedS: number;
    durationS: number;
    active: boolean;
  } | null = null;
  private currentArenaUrl: string | null = null;
  private currentArenaKey: string | null = null;
  private readonly heightFogUniforms = { fogHeight: { value: 2.0 } };
  private lastAppliedPatch: Partial<SceneSettings> = {};
  private isApplyingFromAtmosphere = false;
  /** Reused across ray picks (sprite screen hits, arena floor detection) so we
   *  don't allocate a fresh Raycaster on every call. */
  private readonly raycaster = new THREE.Raycaster();

  // --- Optional perf HUD (off by default; zero cost when disabled) ---
  private hudEnabled = false;
  private hudEl: HTMLDivElement | null = null;
  private hudAccumS = 0;
  private hudFrames = 0;
  private hudLastMs = 0;
  private hudLastDrawCalls = 0;
  private hudLastTriangles = 0;
  private hudParent: HTMLElement = document.body;

  /** Whether the shadow map has been rendered at least once this loop run.
   *  Combined with `autoUpdate = false`, we prime it on the first frame and
   *  then only re-render when a shadow-affecting change requests a refresh. */
  private shadowPrimed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setClearColor(0x0b1220, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // On-demand shadows. The shadow map is expensive to rebuild (2048² PCF over
    // every caster), so we DON'T re-render it every frame. It is only refreshed
    // on discrete shadow-affecting changes (arena load, sprite add/remove,
    // attack/hit anim windows, light/settings changes, time-of-day). Idle
    // frames skip a full shadow pass entirely — this is the main stutter fix.
    this.renderer.shadowMap.autoUpdate = false;

    // Anchor the perf HUD into the canvas's parent so it can't be hidden behind
    // the WebGL canvas or lost inside a transformed/portaled container.
    if (canvas.parentElement !== null) this.hudParent = canvas.parentElement;

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

    this.clock = new THREE.Timer();

    // Global escape hatch: `window.__sceneHud()` toggles the perf HUD from the
    // devtools console, regardless of URL params. Useful when ?hud=1 doesn't
    // survive a route redirect.
    try {
      (window as unknown as { __sceneHud?: () => boolean }).__sceneHud = () =>
        this.toggleHud();
    } catch {
      /* window unavailable — skip */
    }
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
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
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
    this.keyLight.position.set(
      atmosphere.keyPos[0],
      atmosphere.keyPos[1],
      atmosphere.keyPos[2],
    );
    this.rimLight.color.setHex(atmosphere.rimColor);
    this.rimLight.intensity = atmosphere.rimIntensity;
    this.fillLight.color.setHex(atmosphere.fillColor);
    this.fillLight.intensity = atmosphere.fillIntensity;
    if (this.currentFogEnabled) {
      if (this.currentFogMode === "exp2" || this.currentFogMode === "height") {
        const prevExp =
          this.scene.fog instanceof THREE.FogExp2
            ? this.scene.fog.density
            : 0.035;
        this.scene.fog = new THREE.FogExp2(atmosphere.fogColor, prevExp);
        if (this.currentFogMode === "height") this.applyHeightFogToScene();
      } else {
        this.scene.fog = new THREE.Fog(
          atmosphere.fogColor,
          atmosphere.fogNear,
          atmosphere.fogFar,
        );
      }
    } else {
      this.scene.fog = null;
    }
    this.renderer.toneMappingExposure = atmosphere.exposure;
    // Key light position (a shadow caster) changed: rebuild the shadow map.
    this.requestShadowRefresh();
    if (this.dust !== null) {
      const mat = this.dust.material as THREE.PointsMaterial;
      mat.color.setHex(atmosphere.dustColor);
      mat.opacity = atmosphere.dustOpacity;
      mat.needsUpdate = true;
    }
    if (Object.keys(this.lastAppliedPatch).length > 0) {
      this.isApplyingFromAtmosphere = true;
      try {
        this.applySettings(this.lastAppliedPatch);
      } finally {
        this.isApplyingFromAtmosphere = false;
      }
    }
  }

  setArenaAtmosphere(arenaKey: string | null): void {
    const atm =
      arenaKey !== null
        ? (ARENA_ATMOSPHERES[arenaKey] ?? DEFAULT_ATMOSPHERE)
        : DEFAULT_ATMOSPHERE;
    this.applyAtmosphere(atm);
  }

  setBackdropActive(active: boolean): void {
    if (this.disposedFlag) return;
    if (active) {
      this.scene.background = null;
      this.propsGroup.visible = false;
    } else {
      if (this.skyTexture === null) this.skyTexture = buildSkyTexture();
      this.scene.background = this.skyTexture;
      this.ground.visible = true;
      this.propsGroup.visible = true;
      this.applyAtmosphere(DEFAULT_ATMOSPHERE);
    }
  }

  setCameraLookOffset(x: number, y: number, z: number): void {
    if (this.disposedFlag) return;
    this.cameraLookOffset.set(x, y, z);
    this.placeCameraIso();
  }

  private placeCameraIso(): void {
    const elev = (this.camElevDeg * Math.PI) / 180;
    const yaw = (this.camYawDeg * Math.PI) / 180;
    this.cameraBasePos.set(
      Math.sin(yaw) * Math.cos(elev) * this.camDist + this.cameraLookOffset.x,
      Math.sin(elev) * this.camDist + this.cameraLookOffset.y,
      Math.cos(yaw) * Math.cos(elev) * this.camDist + this.cameraLookOffset.z,
    );
    this.camera.position.copy(this.cameraBasePos);
    this.camera.lookAt(
      this.cameraLookOffset.x,
      this.camLookAtY + this.cameraLookOffset.y,
      this.cameraLookOffset.z,
    );
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

  private makeCamera(
    type: "ortho" | "perspective",
  ): THREE.OrthographicCamera | THREE.PerspectiveCamera {
    if (type === "perspective") {
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

  /**
   * Request a single shadow-map re-render on the next frame. With
   * `autoUpdate = false`, the shadow map is only rebuilt when this is called,
   * so callers must invoke it on every shadow-affecting change (sprite add/
   * remove, attack/hit animation windows, light or settings changes, time-of-
   * day transitions, arena swaps). Cheap: just flips a flag the renderer reads.
   */
  requestShadowRefresh(): void {
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
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        fog: false,
      });
      for (let i = 0; i < 3; i += 1) {
        const ring = new THREE.Mesh(geometry, material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(
          sign * FORMATION_SIDE_X,
          0.03,
          (i - 1) * FORMATION_SLOT_Z_SPACING,
        );
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
    if (this.currentArenaUrl !== null && this.currentArenaUrl !== url) {
      THREE.Cache.remove(this.currentArenaUrl);
    }
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    if (this.disposedFlag) return;
    this.disposeArenaChildren();
    const root = gltf.scene;
    this.normalizeArenaTransform(root);
    this.arenaGroup.add(root);
    this.arenaRoot = root;
    this.currentArenaUrl = url;
    this.setBackdropActive(true);
    let hasFloorMesh = false;
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.frustumCulled = false;
      if (isFloorNamed(obj)) hasFloorMesh = true;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!(mat instanceof THREE.Material)) continue;
        forceTransparencyIfAlpha(mat);
      }
    });
    this.ground.visible = !hasFloorMesh;
    if (this.currentFogMode === "height") {
      root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => this.applyHeightFogTo(m));
        else this.applyHeightFogTo(mat);
      });
    }
  }

  async loadArenaModelWithAtmosphere(
    url: string,
    arenaKey: string,
  ): Promise<void> {
    this.currentArenaKey = arenaKey;
    this.setArenaAtmosphere(arenaKey);
    await this.loadArenaModel(url);
  }

  /**
   * Apply an atmosphere's LIGHTING only (hemi/key/rim/fill/exposure dust),
   * leaving `scene.fog` untouched. Used by the GLB-default fallback: with the
   * GLB driving the look, fog stays disabled (the GLB's own volume/atmosphere
   * meshes own the haze), but the lights still need a coherent mood.
   */
  private applyAtmosphereLighting(atmosphere: ArenaAtmosphere): void {
    if (this.disposedFlag) return;
    this.hemi.color.setHex(atmosphere.sky);
    this.hemi.groundColor.setHex(atmosphere.ground);
    this.hemi.intensity = atmosphere.hemiIntensity;
    this.keyLight.color.setHex(atmosphere.keyColor);
    this.keyLight.intensity = atmosphere.keyIntensity;
    this.keyLight.position.set(
      atmosphere.keyPos[0],
      atmosphere.keyPos[1],
      atmosphere.keyPos[2],
    );
    this.rimLight.color.setHex(atmosphere.rimColor);
    this.rimLight.intensity = atmosphere.rimIntensity;
    this.fillLight.color.setHex(atmosphere.fillColor);
    this.fillLight.intensity = atmosphere.fillIntensity;
    this.renderer.toneMappingExposure = atmosphere.exposure;
    // Key light position (a shadow caster) changed: rebuild the shadow map.
    this.requestShadowRefresh();
    if (this.dust !== null) {
      const mat = this.dust.material as THREE.PointsMaterial;
      mat.color.setHex(atmosphere.dustColor);
      mat.opacity = atmosphere.dustOpacity;
      mat.needsUpdate = true;
    }
  }

  /**
   * "Bare" arena load: intended for scenes with `useGlbSettings=true`.
   * Skips `setArenaAtmosphere` so the GLB drives the look, and disables scene
   * fog so the GLB's own volume/atmosphere owns the haze.
   * The manager's own rig is only surrendered when the GLB actually ships
   * KHR_lights_punctual lights; most biome exports carry none, and dimming
   * unconditionally left those arenas rendering in near-darkness.
   *
   * When the GLB ships no lights, the fallback lighting comes from the arena's
   * keyed atmosphere (`arenaKey`), with a per-filename override for known
   * bare-geometry arenas like `arena.glb` (→ `steel`). This is what makes
   * selecting a GLB as default render with a coherent mood even though most
   * GLBs embed no lights.
   */
  async loadArenaModelBare(
    url: string,
    arenaKey?: string | null,
  ): Promise<void> {
    this.currentArenaKey = arenaKey ?? null;
    await this.loadArenaModel(url);
    let glbLightCount = 0;
    this.arenaGroup.traverse((obj) => {
      if (obj instanceof THREE.Light) glbLightCount += 1;
    });
    const filename = url.split('/').pop() ?? '';
    const fallbackKey =
      GLB_ATMOSPHERE_BY_FILENAME[filename] ??
      (arenaKey !== undefined && arenaKey !== null ? arenaKey : null);
    const fallback: ArenaAtmosphere =
      fallbackKey !== null
        ? (ARENA_ATMOSPHERES[fallbackKey] ?? DEFAULT_ATMOSPHERE)
        : DEFAULT_ATMOSPHERE;
    if (glbLightCount > 0) {
      this.hemi.intensity = 0.15;
      this.keyLight.intensity = 0.35;
      this.rimLight.intensity = 0.0;
      this.fillLight.intensity = 0.0;
    } else {
      this.applyAtmosphereLighting(fallback);
    }
    this.scene.fog = null;
  }

  /**
   * Apply a weather config: install new particle emitters, fade out old ones,
   * apply lighting override, wire the thunder controller when requested.
   * A null config clears weather back to the current scene atmosphere.
   */
  setWeather(config: WeatherConfig | null): void {
    if (this.disposedFlag) return;

    // Fade out current emitters over the transitionMs of the OUTGOING config
    // (fall back to the incoming one, then a safe default).
    const outgoingFadeMs =
      this.currentWeather?.transitionMs ?? config?.transitionMs ?? 2000;
    for (const emitter of this.activeEmitters.values()) {
      this.fadingEmitters.push({
        emitter,
        elapsedS: 0,
        durationS: outgoingFadeMs / 1000,
      });
    }
    this.activeEmitters.clear();

    if (this.thunder !== null) {
      this.thunder.dispose();
      this.thunder = null;
    }

    if (config === null) {
      this.currentWeather = null;
      this.weatherFade = {
        elapsedS: 0,
        durationS: outgoingFadeMs / 1000,
        active: true,
      };
      return;
    }

    // Resolve emitter list — inline emitters replace preset; empty falls back to preset.
    const emitters: readonly ParticleEmitterConfig[] =
      config.emitters.length > 0
        ? config.emitters
        : (WEATHER_EMITTER_PRESETS[config.preset]?.emitters ?? []);

    for (const emCfg of emitters) {
      const emitter = new ParticleEmitter(this.scene, emCfg);
      emitter.setCameraReference(this.camera);
      emitter.setOpacityMultiplier(0);
      this.activeEmitters.set(emCfg.id, emitter);
    }

    this.applyWeatherLighting(config);

    if (config.lighting.thunder?.enabled === true) {
      this.thunder = new ThunderFlashController(
        config.lighting.thunder,
        this.keyLight,
        this.hemi,
      );
    }

    this.currentWeather = config;
    const transitionMs = config.transitionMs ?? 2000;
    this.weatherFade = {
      elapsedS: 0,
      durationS: transitionMs / 1000,
      active: true,
    };
  }

  private applyWeatherLighting(config: WeatherConfig): void {
    const lighting = config.lighting;
    if (lighting.sunColor !== undefined)
      this.keyLight.color.setHex(lighting.sunColor);
    if (lighting.sunIntensityMult !== undefined) {
      this.keyLight.intensity =
        this.baseSunIntensity * lighting.sunIntensityMult;
    }
    if (lighting.ambientTint !== undefined)
      this.hemi.color.setHex(lighting.ambientTint);
    if (lighting.ambientDimMult !== undefined) {
      this.hemi.intensity = this.baseHemiIntensity * lighting.ambientDimMult;
    }
    if (lighting.fogEnabled === true) {
      const color = lighting.fogColor ?? this.atmosphere.fogColor;
      const density = lighting.fogDensity ?? 0.04;
      this.scene.fog = new THREE.FogExp2(color, density);
    } else if (lighting.fogEnabled === false) {
      this.scene.fog = null;
    }
    if (lighting.exposureMult !== undefined) {
      this.renderer.toneMappingExposure =
        this.atmosphere.exposure * lighting.exposureMult;
    }
  }

  /**
   * Configure the time-of-day driver. Null clears it and restores the current
   * atmosphere's baseline. A change kicks off a crossfade between the last
   * phase preset and the new driver's first preset.
   */
  setTimeOfDay(config: TimeOfDayConfig | null): void {
    if (this.disposedFlag) return;
    if (config === null) {
      this.timeDriver = null;
      this.phaseBlend = null;
      return;
    }
    const nextDriver = new TimeOfDayDriver(config);
    nextDriver.tick(performance.now());
    const from =
      this.phaseBlend?.toPreset ??
      this.timeDriver?.currentPreset ??
      nextDriver.currentPreset;
    this.timeDriver = nextDriver;
    this.phaseBlend = {
      fromPreset: from,
      toPreset: nextDriver.currentPreset,
      elapsedS: 0,
      durationS: 2.0,
      active: true,
    };
  }

  private tickWeather(dt: number): void {
    const OPACITY_FLOOR = 0.001;
    if (this.weatherFade.active) {
      this.weatherFade.elapsedS += dt;
      const t = Math.min(
        1,
        this.weatherFade.elapsedS /
          Math.max(0.0001, this.weatherFade.durationS),
      );
      for (const emitter of this.activeEmitters.values())
        emitter.setOpacityMultiplier(t);
      if (t >= 1) this.weatherFade.active = false;
    }
    for (const emitter of this.activeEmitters.values()) emitter.tick(dt);

    for (let i = this.fadingEmitters.length - 1; i >= 0; i -= 1) {
      const entry = this.fadingEmitters[i]!;
      entry.elapsedS += dt;
      const t =
        1 - Math.min(1, entry.elapsedS / Math.max(0.0001, entry.durationS));
      entry.emitter.setOpacityMultiplier(t);
      entry.emitter.tick(dt);
      if (t <= OPACITY_FLOOR) {
        entry.emitter.dispose();
        this.fadingEmitters.splice(i, 1);
      }
    }

    if (this.thunder !== null) this.thunder.tick(dt, performance.now());
  }

  private tickTimeOfDay(dt: number): void {
    if (this.timeDriver === null) return;
    this.timeDriver.tick(performance.now());

    let preset = this.timeDriver.currentPreset;
    if (this.phaseBlend?.active === true) {
      this.phaseBlend.elapsedS += dt;
      const t = Math.min(
        1,
        this.phaseBlend.elapsedS / this.phaseBlend.durationS,
      );
      preset = interpolatePhases(
        this.phaseBlend.fromPreset,
        this.phaseBlend.toPreset,
        t,
      );
      // Transition: the key light moves through the blend, so refresh the
      // shadow map once per frame while the blend is active.
      this.requestShadowRefresh();
      if (t >= 1) {
        this.phaseBlend.active = false;
        this.phaseBlend.fromPreset = this.phaseBlend.toPreset;
      }
    }

    // Apply preset to sun / hemi / exposure. Weather lighting overrides these,
    // so time-of-day only writes when NO weather is currently active.
    if (this.currentWeather === null) {
      this.keyLight.color.setHex(preset.sunColor);
      this.keyLight.intensity = preset.sunIntensity;
      this.keyLight.position.set(
        preset.sunPosition[0],
        preset.sunPosition[1],
        preset.sunPosition[2],
      );
      this.hemi.color.setHex(preset.hemiSky);
      this.hemi.groundColor.setHex(preset.hemiGround);
      this.hemi.intensity = preset.hemiIntensity;
      this.renderer.toneMappingExposure =
        this.atmosphere.exposure * preset.exposureMultiplier;
      this.baseSunColor = preset.sunColor;
      this.baseSunIntensity = preset.sunIntensity;
      this.baseHemiIntensity = preset.hemiIntensity;
    }
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
    // Arena caster geometry changed: ensure shadows are rebuilt on-demand.
    this.requestShadowRefresh();
  }

  private detectPlayFloorY(root: THREE.Object3D): number {
    const allMeshes: THREE.Mesh[] = [];
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) allMeshes.push(obj);
    });
    if (allMeshes.length === 0) return 0;
    const floorNamed = allMeshes.filter((m) => isFloorNamed(m));
    const targets = floorNamed.length > 0 ? floorNamed : allMeshes;
    const spawns: readonly THREE.Vector3[] = [
      slotWorldPosition("you", 0),
      slotWorldPosition("you", 1),
      slotWorldPosition("you", 2),
      slotWorldPosition("opp", 0),
      slotWorldPosition("opp", 1),
      slotWorldPosition("opp", 2),
    ];
    const raycaster = new THREE.Raycaster();
    const downward = new THREE.Vector3(0, -1, 0);
    const floorYs: number[] = [];
    for (const spawn of spawns) {
      raycaster.set(new THREE.Vector3(spawn.x, 20, spawn.z), downward);
      const hits = raycaster.intersectObjects(targets, false);
      const topmost =
        floorNamed.length > 0 ? hits[0] : hits.find((h) => h.point.y <= 3.5);
      if (topmost) floorYs.push(topmost.point.y);
    }
    if (floorYs.length === 0) return 0;
    const sorted = [...floorYs].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
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
    this.arenaRoot = null;
    // Arena casters removed: rebuild the shadow map next frame.
    this.requestShadowRefresh();
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
      fogColor: fogAsLinear
        ? fogAsLinear.color.getHex()
        : fogAsExp
          ? fogAsExp.color.getHex()
          : 0x000000,
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
      dustOpacity:
        this.dust !== null
          ? (this.dust.material as THREE.PointsMaterial).opacity
          : 0,
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
    if (material.userData["_heightFogApplied"] === true) return;
    material.userData["_heightFogApplied"] = true;
    const uniforms = this.heightFogUniforms;
    material.onBeforeCompile = (shader) => {
      shader.uniforms["fogHeight"] = uniforms.fogHeight;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <fog_pars_vertex>",
          "#include <fog_pars_vertex>\nvarying vec3 vFogWorldPosition;",
        )
        .replace(
          "#include <fog_vertex>",
          "#include <fog_vertex>\nvFogWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <fog_pars_fragment>",
          "#include <fog_pars_fragment>\nvarying vec3 vFogWorldPosition;\nuniform float fogHeight;",
        )
        .replace(
          "#include <fog_fragment>",
          `#ifdef USE_FOG
  vec3 fogOrigin = cameraPosition;
  vec3 fogDirection = normalize(vFogWorldPosition - fogOrigin);
  float rayLength = distance(vFogWorldPosition, fogOrigin);
  float c1 = exp(fogDensity * (fogHeight - cameraPosition.y));
  float rayY = fogDirection.y;
  float c2 = c1 * (1.0 - exp(-fogDensity * rayY * rayLength)) / (rayY + 0.0001);
  float fogFactor = clamp(1.0 - exp(-c2), 0.0, 1.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`,
        );
    };
    material.needsUpdate = true;
  }

  private removeHeightFogFrom(material: THREE.Material): void {
    if (material.userData["_heightFogApplied"] !== true) return;
    material.userData["_heightFogApplied"] = false;
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
    this.applyLighting(patch);
    this.applyShadows(patch);
    this.applyFog(patch);
    this.applyCamera(patch);
    this.applyArena(patch);
    if (!this.isApplyingFromAtmosphere) {
      this.recordPatch(patch);
    }
  }

  private applyLighting(patch: Partial<SceneSettings>): void {
    if (patch.sunColor !== undefined)
      this.keyLight.color.setHex(patch.sunColor);
    if (patch.sunIntensity !== undefined)
      this.keyLight.intensity = patch.sunIntensity;
    if (patch.sunPosX !== undefined) this.keyLight.position.x = patch.sunPosX;
    if (patch.sunPosY !== undefined) this.keyLight.position.y = patch.sunPosY;
    if (patch.sunPosZ !== undefined) this.keyLight.position.z = patch.sunPosZ;
    if (patch.hemiSkyColor !== undefined)
      this.hemi.color.setHex(patch.hemiSkyColor);
    if (patch.hemiGroundColor !== undefined)
      this.hemi.groundColor.setHex(patch.hemiGroundColor);
    if (patch.hemiIntensity !== undefined)
      this.hemi.intensity = patch.hemiIntensity;
    if (patch.rimColor !== undefined)
      this.rimLight.color.setHex(patch.rimColor);
    if (patch.rimIntensity !== undefined)
      this.rimLight.intensity = patch.rimIntensity;
    if (patch.fillColor !== undefined)
      this.fillLight.color.setHex(patch.fillColor);
    if (patch.fillIntensity !== undefined)
      this.fillLight.intensity = patch.fillIntensity;
    if (patch.exposure !== undefined)
      this.renderer.toneMappingExposure = patch.exposure;
    if (patch.dustOpacity !== undefined && this.dust !== null) {
      (this.dust.material as THREE.PointsMaterial).opacity = patch.dustOpacity;
    }
  }

  private applyShadows(patch: Partial<SceneSettings>): void {
    if (patch.shadowsEnabled !== undefined) {
      this.renderer.shadowMap.enabled = patch.shadowsEnabled;
      this.keyLight.castShadow = patch.shadowsEnabled;
    }
    if (patch.shadowRadius !== undefined)
      this.keyLight.shadow.radius = patch.shadowRadius;
    if (patch.shadowBias !== undefined)
      this.keyLight.shadow.bias = patch.shadowBias;
    if (patch.shadowNormalBias !== undefined)
      this.keyLight.shadow.normalBias = patch.shadowNormalBias;
    if (patch.shadowMapSize !== undefined) {
      this.keyLight.shadow.mapSize.set(
        patch.shadowMapSize,
        patch.shadowMapSize,
      );
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null;
    }
    // Any shadow-related setting changed: rebuild the map once next frame.
    if (
      patch.shadowsEnabled !== undefined ||
      patch.shadowRadius !== undefined ||
      patch.shadowBias !== undefined ||
      patch.shadowNormalBias !== undefined ||
      patch.shadowMapSize !== undefined
    ) {
      this.requestShadowRefresh();
    }
  }

  private applyFog(patch: Partial<SceneSettings>): void {
    const fogPatch =
      patch.fogEnabled !== undefined ||
      patch.fogMode !== undefined ||
      patch.fogColor !== undefined ||
      patch.fogNear !== undefined ||
      patch.fogFar !== undefined ||
      patch.fogDensity !== undefined ||
      patch.fogHeight !== undefined;
    if (!fogPatch) return;
    const fog = this.scene.fog;
    const fogAsLinear = fog instanceof THREE.Fog ? fog : null;
    const fogAsExp = fog instanceof THREE.FogExp2 ? fog : null;
    const prevMode = this.currentFogMode;
    const enabled = patch.fogEnabled ?? this.currentFogEnabled;
    const mode = patch.fogMode ?? this.currentFogMode;
    this.currentFogEnabled = enabled;
    this.currentFogMode = mode;
    if (patch.fogHeight !== undefined)
      this.heightFogUniforms.fogHeight.value = patch.fogHeight;
    if (enabled) {
      const color =
        patch.fogColor ??
        fogAsLinear?.color.getHex() ??
        fogAsExp?.color.getHex() ??
        0x1e2a44;
      if (mode === "exp2" || mode === "height") {
        const density = patch.fogDensity ?? fogAsExp?.density ?? 0.035;
        const clamped = Math.max(0.001, Math.min(1, density));
        this.scene.fog = new THREE.FogExp2(color, clamped);
      } else {
        const near = patch.fogNear ?? fogAsLinear?.near ?? 12;
        const far = patch.fogFar ?? fogAsLinear?.far ?? 32;
        this.scene.fog = new THREE.Fog(color, near, far);
      }
    } else {
      this.scene.fog = null;
    }
    if (
      mode === "height" &&
      (prevMode !== "height" || patch.fogMode === "height")
    ) {
      this.applyHeightFogToScene();
    } else if (mode !== "height" && prevMode === "height") {
      this.removeHeightFogFromScene();
    }
  }

  private applyCamera(patch: Partial<SceneSettings>): void {
    let cameraChanged = false;
    if (patch.camElevDeg !== undefined) {
      this.camElevDeg = patch.camElevDeg;
      cameraChanged = true;
    }
    if (patch.camYawDeg !== undefined) {
      this.camYawDeg = patch.camYawDeg;
      cameraChanged = true;
    }
    if (patch.camDist !== undefined) {
      this.camDist = patch.camDist;
      cameraChanged = true;
    }
    if (patch.camLookAtY !== undefined) {
      this.camLookAtY = patch.camLookAtY;
      cameraChanged = true;
    }
    if (patch.camFrustum !== undefined) {
      this.camFrustum = patch.camFrustum;
      this.updateProjection();
    }
    if (patch.camFov !== undefined) this.currentCamFov = patch.camFov;
    if (
      patch.cameraType !== undefined &&
      patch.cameraType !== this.currentCameraType
    ) {
      this.currentCameraType = patch.cameraType;
      this.camera = this.makeCamera(patch.cameraType);
      this.placeCameraIso();
      this.updateProjection();
    } else if (
      patch.camFov !== undefined &&
      this.camera instanceof THREE.PerspectiveCamera
    ) {
      this.camera.fov = patch.camFov;
      this.camera.updateProjectionMatrix();
    }
    if (cameraChanged) this.placeCameraIso();
  }

  private applyArena(patch: Partial<SceneSettings>): void {
    if (
      patch.arenaSpan !== undefined &&
      patch.arenaSpan !== this.currentArenaSpan
    ) {
      this.currentArenaSpan = patch.arenaSpan;
      this.updateShadowCameraBounds();
      const root = this.arenaRoot;
      if (root !== null) {
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        box.getSize(size);
        const worldSpan = Math.max(size.x, size.z, 0.001);
        const factor = this.currentArenaSpan / worldSpan;
        root.scale.multiplyScalar(factor);
      }
    }
    if (patch.arenaOffsetX !== undefined)
      this.currentArenaOffsetX = patch.arenaOffsetX;
    if (patch.arenaOffsetY !== undefined)
      this.currentArenaOffsetY = patch.arenaOffsetY;
    if (patch.arenaOffsetZ !== undefined)
      this.currentArenaOffsetZ = patch.arenaOffsetZ;
    if (
      patch.arenaOffsetX !== undefined ||
      patch.arenaOffsetY !== undefined ||
      patch.arenaOffsetZ !== undefined
    ) {
      this.arenaGroup.position.set(
        this.currentArenaOffsetX,
        this.currentArenaOffsetY,
        this.currentArenaOffsetZ,
      );
    }
    if (patch.arenaOffsetY !== undefined) {
      // Sprites live on scene root (not under arenaGroup) so shifting arenaGroup.y
      // alone would leave them at fixed world Y ≈ 0.37 while the arena floor
      // moves up/down — sprites appear to sink through the floor. Mirror the
      // arena Y offset onto every sprite's baseline so admin position edits
      // move the whole play field together. The team-side rings live on their
      // own ringsGroup at world Y ≈ 0.03 — sprites stand on them, so the rings
      // must ride the same offset or sprites float above / sink through them.
      // The default ground plane is our fallback floor for arenas whose GLB
      // has holes at sprite positions (empty clearings, hollow interiors) —
      // position it 0.01 below the arena floor so real arena floor mesh
      // wins the z-test where present and ground shows through the gaps.
      this.ringsGroup.position.y = this.currentArenaOffsetY;
      this.ground.position.y = this.currentArenaOffsetY - 0.01;
      for (const sprite of this.sprites.values()) {
        sprite.setArenaBaselineY(this.currentArenaOffsetY);
      }
    }
  }

  /** Cache the most recently loaded arena root so span recompute / disposal
   *  can read it without re-indexing arenaGroup.children. */
  private arenaRoot: THREE.Object3D | null = null;

  private recordPatch(patch: Partial<SceneSettings>): void {
    for (const key of Object.keys(patch) as (keyof SceneSettings)[]) {
      if (patch[key] !== undefined) {
        (this.lastAppliedPatch as Record<string, unknown>)[key] = patch[key];
      }
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

  async addSprite(config: SpriteInit): Promise<SpriteRig> {
    const existing = this.sprites.get(config.unitId);
    if (existing !== undefined) return existing;
    const sprite = new SpriteRig(this.scene, config);
    sprite.setArenaBaselineY(this.currentArenaOffsetY);
    this.sprites.set(config.unitId, sprite);
    // New caster added: rebuild the shadow map once next frame.
    this.requestShadowRefresh();
    return sprite;
  }

  removeSprite(unitId: string): void {
    const sprite = this.sprites.get(unitId);
    if (sprite === undefined) return;
    sprite.dispose();
    this.sprites.delete(unitId);
    // Caster removed: rebuild the shadow map once next frame.
    this.requestShadowRefresh();
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
    options: {
      readonly durationS?: number;
      readonly onImpact?: () => void;
      readonly vfxPresetId?: string;
    } = {},
  ): string | null {
    const target = this.sprites.get(targetUnitId);
    if (target === undefined) return null;
    const source =
      sourceUnitId === null ? null : (this.sprites.get(sourceUnitId) ?? null);

    // `worldPosition` is the billboard's centre, so anchoring an effect to it
    // makes the projectile leave the middle of the attacker and land in the
    // middle of the receiver. Offsetting by the sprite's own extents puts the
    // origin on its leading edge at roughly chest height, and the impact just
    // above the receiver's centre — read as "thrown at them" rather than
    // "passing through them".
    const targetPos = target.worldPosition
      .clone()
      .add(new THREE.Vector3(0, target.spriteSize.y * IMPACT_HEIGHT_RATIO, 0));
    const sourcePos =
      source === null
        ? targetPos.clone().add(new THREE.Vector3(0, UNSOURCED_DROP_HEIGHT, 0))
        : (() => {
            // Face the receiver in XZ only: lifting the emitter must not tilt the
            // direction it fires in.
            const forward = targetPos.clone().sub(source.worldPosition);
            forward.y = 0;
            if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
            else forward.normalize();
            return source.worldPosition
              .clone()
              .add(
                new THREE.Vector3(
                  0,
                  source.spriteSize.y * EMIT_HEIGHT_RATIO,
                  0,
                ),
              )
              .add(
                forward.multiplyScalar(
                  source.spriteSize.x * EMIT_FORWARD_RATIO,
                ),
              );
          })();
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
    // Attacker lunges during its attack window: refresh the shadow map once so
    // the moving silhouette casts a correct (on-demand) shadow for that moment.
    this.requestShadowRefresh();

    const originalOnImpact = effect.onImpact;
    const wrappedEffect: AttackEffect3D = {
      ...effect,
      onImpact: () => {
        target.playHit();
        target.illuminate(ELEMENT_LIGHT_COLOR[element], 0.9, 3.5);
        // Receiver shakes on hit: refresh the shadow map once for the hit pose.
        this.requestShadowRefresh();
        // Centralized ability-impact polish: a shared element-colored ring +
        // spark burst plays on every landed hit (all 11 element runners and the
        // SkillVfxPreset runner funnel through this callback), and the camera
        // jolts once so the hit reads physically.
        this.spawnImpact(element, targetPos);
        this.triggerShake(shakeForElement(element));
        originalOnImpact?.();
      },
    };

    if (options.vfxPresetId !== undefined) {
      const preset = resolveSkillVfxPreset(options.vfxPresetId);
      if (preset !== null) {
        // Defer the (allocating) runner construction off the input/click frame.
        // Previously `buildPresetRunner` allocated a ParticleEmitter per slot
        // (InstancedMesh + 8 attributes + ShaderMaterial) synchronously here, so
        // the first skill cast paid a multi-ms GC + GPU upload hitch. The
        // DeferredRunner builds it lazily on the next render tick instead.
        const runner = createDeferredRunner(() =>
          buildPresetRunner(this.scene, wrappedEffect, preset),
        );
        this.effects.set(id, {
          runner,
          elapsed: 0,
          duration: preset.totalDurationMs / 1000,
        });
        return id;
      }
    }

    const builder = RUNNERS[element];
    const runner = createDeferredRunner(() =>
      builder(this.scene, wrappedEffect),
    );
    this.effects.set(id, { runner, elapsed: 0, duration: durationS });
    return id;
  }

  /**
   * Spawn the shared element-colored impact flourish (ring + spark burst +
   * light pulse) at a landed hit. Registered as an ordinary effect so the
   * render loop ticks + disposes it exactly like a runner. No-op when the
   * element is unknown (buildImpactController returns null defensively).
   */
  private spawnImpact(element: AnimatedElement, position: THREE.Vector3): void {
    const controller = buildImpactController(this.scene, { element, position });
    if (controller === null) return;
    this.effects.set(controller.id, {
      runner: controller.runner,
      elapsed: 0,
      duration: controller.duration,
    });
  }

  /**
   * Kick off a one-shot camera screen-shake. Repeated hits refresh the timer so
   * a flurry of blows keeps the stage jolting rather than cutting the shake
   * short. Amplitude comes from the element's tuning (0 = no shake requested).
   */
  private triggerShake(amplitude: number): void {
    if (amplitude <= 0) return;
    this.shakeAmplitude = amplitude;
    this.shakeElapsed = 0;
    this.shakeActive = true;
  }

  /** Advance + apply the screen-shake camera offset for this frame. */
  private applyShake(dtS: number): void {
    if (!this.shakeActive) return;
    this.shakeElapsed += dtS;
    const { x, y } = nextShakeOffset(
      this.shakeAmplitude,
      this.shakeElapsed,
      IMPACT_SHAKE_DURATION_S,
    );
    if (x === 0 && y === 0) {
      this.shakeActive = false;
      // Re-place the camera cleanly so the offset doesn't stick at a residue.
      this.placeCameraIso();
      return;
    }
    // Reset to the jitter-free base, then offset: keeps the shake from
    // accumulating across frames (which would drift the camera off-stage).
    this.camera.position.copy(this.cameraBasePos);
    this.camera.position.x += x;
    this.camera.position.y += y;
  }

  /**
   * Dust is "enabled" only when the points cloud exists and is actually
   * visible. We also treat opacity ≤ ~0 as disabled so an admin-driven fade to
   * zero (dustOpacity) stops the per-frame position rewrite, letting the loop
   * skip a useless buffer upload.
   */
  private isDustEnabled(): boolean {
    if (this.dust === null) return false;
    if (!this.dust.visible) return false;
    const mat = this.dust.material as THREE.PointsMaterial;
    return mat.opacity > 0.001;
  }

  startLoop(): void {
    if (this.disposedFlag) return;
    if (this.rafId !== 0) return;
    const tick = (rafTimestamp: number): void => {
      if (this.disposedFlag) return;
      // `THREE.Timer` only advances its internal delta/elapsed when `update()`
      // is called each frame — unlike the old `THREE.Clock`. Without this,
      // `getDelta()`/`getElapsed()` return 0 forever, freezing the entrance
      // camera pan/zoom, sprite movement, and effect runners (all advanced by dt).
      this.clock.update(rafTimestamp);
      const dt = this.clock.getDelta();
      const elapsed = this.clock.getElapsed();
      // On-demand shadows: prime the map on the very first frame so the first
      // painted frame already has correct shadows, then never rebuild unless a
      // shadow-affecting change calls requestShadowRefresh().
      if (!this.shadowPrimed) {
        this.renderer.shadowMap.needsUpdate = true;
        this.shadowPrimed = true;
      }
      if (this.entranceActive) {
        this.entranceElapsed += dt;
        const t = Math.min(1, this.entranceElapsed / ENTRANCE_DURATION_S);
        const eased = easeOutCubic(t);
        this.zoomMult = ENTRANCE_ZOOM_START + (1 - ENTRANCE_ZOOM_START) * eased;
        this.updateProjection();
        const panX = ENTRANCE_PAN_START_X * (1 - eased);
        this.camera.lookAt(
          panX + this.cameraLookOffset.x,
          this.camLookAtY + this.cameraLookOffset.y,
          this.cameraLookOffset.z,
        );
        if (t >= 1) {
          this.zoomMult = 1;
          this.entranceActive = false;
          this.updateProjection();
          this.camera.lookAt(
            this.cameraLookOffset.x,
            this.camLookAtY + this.cameraLookOffset.y,
            this.cameraLookOffset.z,
          );
        }
      }
      for (const sprite of this.sprites.values()) {
        sprite.update(dt, elapsed, this.camera.quaternion);
      }
      // While any sprite is mid attack/hit it actually translates (lunge) or
      // shakes, so its shadow must track the motion across the whole anim
      // window — not just on the first frame. Refresh on each such frame.
      // This is bounded by the short anim durations, so idle frames (the 99%
      // case) still skip the shadow pass entirely.
      let anyAnimating = false;
      for (const sprite of this.sprites.values()) {
        if (sprite.animating) {
          anyAnimating = true;
          break;
        }
      }
      if (anyAnimating) this.requestShadowRefresh();
      for (const prop of this.floatingProps) {
        prop.mesh.position.y =
          prop.baseY +
          Math.sin(elapsed * prop.bobSpeed + prop.bobOffset) * prop.bobAmp;
        prop.mesh.rotation.y += prop.rotationSpeed * dt;
      }
      if (this.isDustEnabled()) {
        const positions = this.dust!.geometry.getAttribute(
          "position",
        ) as THREE.BufferAttribute;
        const arr = positions.array as Float32Array;
        for (let i = 0; i < this.dustBaseY.length; i += 1) {
          const phase = this.dustPhase[i]! + elapsed * 0.18;
          arr[i * 3] = this.dustBaseXZ[i * 2]! + Math.sin(phase * 0.7) * 0.35;
          arr[i * 3 + 1] = this.dustBaseY[i]! + Math.sin(phase) * 0.22;
          arr[i * 3 + 2] =
            this.dustBaseXZ[i * 2 + 1]! + Math.cos(phase * 0.5) * 0.28;
        }
        positions.needsUpdate = true;
      }
      // Key light + hemi sit at a fixed position each frame. Previously the
      // key light was jiggled by a sine sway here, which forced the shadow map
      // to recompute every frame (autoUpdate). With on-demand shadows the light
      // is instead set once in applyAtmosphere/normalizeArenaTransform and only
      // when a shadow-affecting change calls requestShadowRefresh().
      const basePos = this.atmosphere.keyPos;
      this.keyLight.position.set(basePos[0], basePos[1], basePos[2]);
      this.hemi.intensity =
        this.atmosphere.hemiIntensity + Math.sin(elapsed * 0.28) * 0.03;
      this.tickTimeOfDay(dt);
      this.tickWeather(dt);
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
      // Apply the one-shot impact screen-shake (if active) just before draw, so
      // the jolt is visible this frame and recomputed from the camera base next
      // frame (no accumulation).
      this.applyShake(dt);
      this.renderer.render(this.scene, this.camera);
      this.sampleHud(dt);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  renderOnce(): void {
    if (this.disposedFlag) return;
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Toggle the on-screen perf HUD (FPS, frame ms, draw calls, triangles).
   * Off by default. Use `scene.setHud(true)` / `scene.toggleHud()`, or pass
   * `?hud=1` / `?hud=0` from the host (e.g. the combat3d debug route).
   * Zero cost when disabled — sampling only runs while enabled.
   */
  setHud(on: boolean): void {
    this.hudEnabled = on;
    if (!on) {
      if (this.hudEl !== null) {
        this.hudEl.remove();
        this.hudEl = null;
      }
      return;
    }
    if (this.hudEl === null) {
      const el = document.createElement("div");
      el.style.cssText =
        "position:absolute;left:8px;top:8px;z-index:2147483647;padding:6px 8px;" +
        "font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#9effa0;" +
        "background:rgba(0,0,0,0.65);border:1px solid rgba(120,255,140,0.45);" +
        "border-radius:4px;pointer-events:none;white-space:pre;text-align:left;";
      el.textContent = "HUD…";
      this.hudParent.appendChild(el);
      this.hudEl = el;
    }
  }

  toggleHud(): boolean {
    this.setHud(!this.hudEnabled);
    return this.hudEnabled;
  }

  private sampleHud(dt: number): void {
    if (!this.hudEnabled || this.hudEl === null) return;
    this.hudFrames += 1;
    this.hudAccumS += dt;
    if (this.hudAccumS < 0.5) return;
    const fps = this.hudFrames / this.hudAccumS;
    const ms = (this.hudAccumS / this.hudFrames) * 1000;
    const info = this.renderer.info;
    this.hudLastMs = ms;
    this.hudLastDrawCalls = info.render.calls;
    this.hudLastTriangles = info.render.triangles;
    this.hudEl.textContent =
      `FPS ${fps.toFixed(0)}  ${ms.toFixed(1)} ms/frame\n` +
      `draws ${this.hudLastDrawCalls}  tris ${this.hudLastTriangles.toLocaleString()}\n` +
      `shadow ${this.renderer.shadowMap.enabled ? this.keyLight.shadow.mapSize.x + "²" : "off"}`;
    this.hudFrames = 0;
    this.hudAccumS = 0;
  }

  stopLoop(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private readonly projectScratch = new THREE.Vector3();

  projectWorldToScreen(worldPos: THREE.Vector3): {
    readonly x: number;
    readonly y: number;
  } {
    const v = this.projectScratch.copy(worldPos);
    v.project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.stageWidth,
      y: (-v.y * 0.5 + 0.5) * this.stageHeight,
    };
  }

  getSpriteAtScreenPosition(
    screenX: number,
    screenY: number,
  ): { unitId: string; side: SpriteSide; downed: boolean } | null {
    const ndc = new THREE.Vector2(
      (screenX / this.stageWidth) * 2 - 1,
      -(screenY / this.stageHeight) * 2 + 1,
    );

    this.raycaster.setFromCamera(ndc, this.camera);

    const spriteMeshes: THREE.Mesh[] = [];
    for (const sprite of this.sprites.values()) {
      spriteMeshes.push(sprite.mesh);
    }

    if (spriteMeshes.length === 0) return null;

    const intersects = this.raycaster.intersectObjects(spriteMeshes, false);
    if (intersects.length === 0) return null;

    const hitMesh = intersects[0]?.object;
    if (!hitMesh) return null;
    const unitId = hitMesh.userData?.spriteRig?.unitId;
    if (!unitId) return null;

    const sprite = this.sprites.get(unitId);
    if (!sprite) return null;

    return {
      unitId: sprite.unitId,
      side: sprite.side,
      downed: sprite.downed,
    };
  }

  /**
   * Pre-compile the attack/skill particle materials so the first cast never pays
   * a ShaderMaterial allocation or a synchronous GLSL compile on the click
   * frame. Call once during scene init (while a loading screen is up). The
   * material objects are cached by `createEmitterMaterial`, so every subsequent
   * skill cast reuses them.
   */
  prewarmAttackVfx(shaderKinds: readonly ParticleShaderKind[]): void {
    prewarmParticleMaterials(shaderKinds);
  }

  dispose(): void {
    if (this.disposedFlag) return;
    this.disposedFlag = true;
    this.stopLoop();
    for (const emitter of this.activeEmitters.values()) emitter.dispose();
    this.activeEmitters.clear();
    for (const entry of this.fadingEmitters) entry.emitter.dispose();
    this.fadingEmitters.length = 0;
    if (this.thunder !== null) {
      this.thunder.dispose();
      this.thunder = null;
    }
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
