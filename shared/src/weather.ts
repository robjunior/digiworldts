/**
 * Weather + particle system types shared between backend and frontend.
 *
 * The particle model is intentionally generic (not just weather): a
 * `ParticleEmitterConfig` describes one three.js InstancedMesh emitter with
 * spawn, lifecycle, motion, appearance and shader-kind fields. The standalone
 * particle editor and the weather presets both compose from the same shape,
 * so weather effects and custom battle FX share the same runtime.
 *
 * A `WeatherConfig` bundles emitters + lighting overrides + optional ambient
 * audio + optional thunder-flash schedule. Scenes reference either a
 * built-in preset (rain / thunderstorm / …) or a hand-authored config.
 *
 * `TimeOfDayConfig` drives the sun colour/intensity/position cycle. `auto`
 * uses the server clock so every client sees the same phase; `fixed` pins
 * a scene to a phase permanently.
 */

export const PARTICLE_KINDS = ['instanced', 'points', 'streak', 'sprite'] as const;
export type ParticleKind = (typeof PARTICLE_KINDS)[number];

export const PARTICLE_GEOMETRIES = ['sphere', 'plane', 'cube', 'streak', 'quad'] as const;
export type ParticleGeometry = (typeof PARTICLE_GEOMETRIES)[number];

export const PARTICLE_BLENDINGS = ['normal', 'additive', 'multiply'] as const;
export type ParticleBlending = (typeof PARTICLE_BLENDINGS)[number];

export const PARTICLE_SHADERS = [
  'default',
  'rainStreak',
  'wetSpark',
  'sandHaze',
  'thunderCore',
  'snowFlake',
  'hailShard',
] as const;
export type ParticleShaderKind = (typeof PARTICLE_SHADERS)[number];

export const SPAWN_SHAPES = ['box', 'disc', 'sphere', 'point', 'cone'] as const;
export type SpawnShape = (typeof SPAWN_SHAPES)[number];

export type ParticleSpawn = {
  readonly shape: SpawnShape;
  /** Half-extents / radii per axis; interpretation depends on shape. */
  readonly size: readonly [number, number, number];
  /** Offset from the scene origin. Rain typically spawns high above. */
  readonly center: readonly [number, number, number];
  /**
   * When true the spawn volume follows the camera XZ each tick, so long-lived
   * particles (rain, snow, sand) stay in view without infinite buffers.
   */
  readonly followCamera?: boolean;
  /**
   * How high above the camera to keep the spawn ceiling. Only used when
   * followCamera is true. Defaults to `size[1]`.
   */
  readonly cameraOffsetY?: number;
};

export type Vec3Range = {
  /** Mean per axis. */
  readonly base: readonly [number, number, number];
  /** Symmetric ± variance per axis added to base at spawn time. */
  readonly variance: readonly [number, number, number];
};

export type NumRange = readonly [number, number];

export type ParticleEmitterConfig = {
  readonly id: string;
  readonly name: string;
  readonly kind: ParticleKind;
  readonly geometry: ParticleGeometry;
  readonly shader: ParticleShaderKind;
  /** Optional texture URL under public/. Only sampled by shaders that use it. */
  readonly textureUrl?: string | null;

  readonly emissionRate: number;
  readonly maxParticles: number;
  readonly lifetimeMs: NumRange;

  readonly startSize: NumRange;
  readonly endSize: NumRange;

  readonly startColor: number;
  readonly endColor: number;

  readonly startOpacity: number;
  readonly endOpacity: number;

  readonly velocity: Vec3Range;
  readonly gravity: readonly [number, number, number];
  readonly wind: readonly [number, number, number];
  readonly drag: number;

  readonly spawn: ParticleSpawn;

  readonly blending: ParticleBlending;
  readonly rotationSpeed?: NumRange;

  /** When true, particles collide with the ground plane at y=0 (hail bounce). */
  readonly collideGround?: boolean;
  readonly bounciness?: number;

  readonly softParticles?: boolean;
  readonly castShadow?: boolean;
};

export const WEATHER_PRESETS = [
  'clear',
  'rain',
  'thunderstorm',
  'hailstorm',
  'lightstorm',
  'sandstorm',
  'snow',
  'blizzard',
  'breeze',
  'fog',
  'ashfall',
] as const;
export type WeatherPreset = (typeof WEATHER_PRESETS)[number];

export type ThunderFlashConfig = {
  readonly enabled: boolean;
  /** Random flash cadence in ms - min/max. */
  readonly intervalMs: NumRange;
  readonly flashColor: number;
  /** Peak keyLight intensity spike during a flash. */
  readonly flashIntensity: number;
  /** Total flash envelope duration in ms. */
  readonly durationMs: number;
  /** Rendered as chained sub-flashes for a stutter look. */
  readonly stutterCount: number;
};

export type WeatherLightingOverride = {
  readonly sunColor?: number;
  /** Multiplier applied to the current sunIntensity. */
  readonly sunIntensityMult?: number;
  readonly ambientTint?: number;
  /** Multiplier applied to hemi intensity. */
  readonly ambientDimMult?: number;
  readonly fogEnabled?: boolean;
  readonly fogColor?: number;
  readonly fogDensity?: number;
  readonly exposureMult?: number;
  readonly thunder?: ThunderFlashConfig;
};

export type WeatherConfig = {
  readonly preset: WeatherPreset;
  /**
   * Inline emitters. When empty the runtime uses the built-in preset emitters.
   * Non-empty lists REPLACE the preset (fully custom composition).
   */
  readonly emitters: readonly ParticleEmitterConfig[];
  readonly lighting: WeatherLightingOverride;
  readonly ambientAudioUrl?: string | null;
  /**
   * Crossfade window when switching TO this weather. Default 2000 ms.
   */
  readonly transitionMs?: number;
};

export const TIME_PHASES = [
  'dawn',
  'morning',
  'noon',
  'afternoon',
  'dusk',
  'evening',
  'night',
  'midnight',
] as const;
export type TimePhase = (typeof TIME_PHASES)[number];

export type TimeOfDayConfig = {
  /**
   * fixed: scene stays at fixedPhase.
   * auto:  client clock cycles through phases every cycleDurationMs.
   * server: reads server-broadcast phase (`time-of-day-tick`).
   */
  readonly mode: 'fixed' | 'auto' | 'server';
  readonly fixedPhase?: TimePhase;
  readonly cycleDurationMs?: number;
  /** For auto mode: which phase the cycle starts at when the client mounts. */
  readonly startPhase?: TimePhase;
};

export type WeatherOverride = {
  /** Runtime override targeting a live combat. */
  readonly sceneId?: string | null;
  readonly matchId?: string | null;
  readonly weather: WeatherConfig;
  /** How long the override lasts before reverting to the scene's default. */
  readonly durationMs: number;
  /** Server epoch ms when the override started. */
  readonly startedAt: number;
};

export type ParticlePresetEntry = {
  readonly id: string;
  readonly name: string;
  readonly emitter: ParticleEmitterConfig;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type ParticlePresetListResponse = {
  readonly presets: readonly ParticlePresetEntry[];
};

export type ParticlePresetMutationResponse = {
  readonly ok: true;
  readonly preset: ParticlePresetEntry;
};
