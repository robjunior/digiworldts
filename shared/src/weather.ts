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

import { z } from 'zod';

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

export const PARTICLE_EMISSION_MODES = ['continuous', 'burst', 'oneshot'] as const;
export type ParticleEmissionMode = (typeof PARTICLE_EMISSION_MODES)[number];

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

  /**
   * How the emitter releases particles over its life.
   *   `continuous` (default) — steady stream at `emissionRate` particles/s.
   *   `burst`      — spawn `burstCount` at t=0, then nothing more.
   *   `oneshot`    — same as `burst` PLUS auto-dispose at `totalLifetimeMs`.
   * Continuous is the weather idiom; burst/oneshot are the skill-VFX idiom.
   */
  readonly emissionMode?: ParticleEmissionMode;
  readonly burstCount?: number;
  readonly totalLifetimeMs?: number;
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

const Vec3Z = z.tuple([z.number(), z.number(), z.number()]);
const NumRangeZ = z.tuple([z.number(), z.number()]);

const Vec3RangeZ = z.object({
  base: Vec3Z,
  variance: Vec3Z,
}).strict();

const ParticleSpawnBaseZ = z.object({
  shape: z.enum(SPAWN_SHAPES),
  size: Vec3Z,
  center: Vec3Z,
  followCamera: z.boolean().optional(),
  cameraOffsetY: z.number().min(-1000).max(1000).optional(),
}).strict();

const ParticleSpawnZ: z.ZodType<WeatherConfig['emitters'][number]['spawn']> = ParticleSpawnBaseZ.transform((value): WeatherConfig['emitters'][number]['spawn'] => ({
  shape: value.shape,
  size: value.size,
  center: value.center,
  ...(value.followCamera !== undefined ? { followCamera: value.followCamera } : {}),
  ...(value.cameraOffsetY !== undefined ? { cameraOffsetY: value.cameraOffsetY } : {}),
}));

const ParticleEmitterConfigBaseZ = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(PARTICLE_KINDS),
  geometry: z.enum(PARTICLE_GEOMETRIES),
  shader: z.enum(PARTICLE_SHADERS),
  textureUrl: z.string().trim().min(1).max(300).nullable().optional(),
  emissionRate: z.number().min(0).max(10_000),
  maxParticles: z.number().int().min(0).max(10_000),
  lifetimeMs: NumRangeZ,
  startSize: NumRangeZ,
  endSize: NumRangeZ,
  startColor: z.number().int().min(0).max(0xffffff),
  endColor: z.number().int().min(0).max(0xffffff),
  startOpacity: z.number().min(0).max(1),
  endOpacity: z.number().min(0).max(1),
  velocity: Vec3RangeZ,
  gravity: Vec3Z,
  wind: Vec3Z,
  drag: z.number().min(0).max(10),
  spawn: ParticleSpawnZ,
  blending: z.enum(PARTICLE_BLENDINGS),
  rotationSpeed: NumRangeZ.optional(),
  collideGround: z.boolean().optional(),
  bounciness: z.number().min(0).max(1).optional(),
  softParticles: z.boolean().optional(),
  castShadow: z.boolean().optional(),
  emissionMode: z.enum(PARTICLE_EMISSION_MODES).optional(),
  burstCount: z.number().int().min(1).max(1_000).optional(),
  totalLifetimeMs: z.number().int().min(1).max(10_000).optional(),
}).strict();

export const ParticleEmitterConfigZ: z.ZodType<WeatherConfig['emitters'][number]> = ParticleEmitterConfigBaseZ.transform((value): WeatherConfig['emitters'][number] => ({
  id: value.id,
  name: value.name,
  kind: value.kind,
  geometry: value.geometry,
  shader: value.shader,
  ...(value.textureUrl !== undefined ? { textureUrl: value.textureUrl } : {}),
  emissionRate: value.emissionRate,
  maxParticles: value.maxParticles,
  lifetimeMs: value.lifetimeMs,
  startSize: value.startSize,
  endSize: value.endSize,
  startColor: value.startColor,
  endColor: value.endColor,
  startOpacity: value.startOpacity,
  endOpacity: value.endOpacity,
  velocity: value.velocity,
  gravity: value.gravity,
  wind: value.wind,
  drag: value.drag,
  spawn: value.spawn,
  blending: value.blending,
  ...(value.rotationSpeed !== undefined ? { rotationSpeed: value.rotationSpeed } : {}),
  ...(value.collideGround !== undefined ? { collideGround: value.collideGround } : {}),
  ...(value.bounciness !== undefined ? { bounciness: value.bounciness } : {}),
  ...(value.softParticles !== undefined ? { softParticles: value.softParticles } : {}),
  ...(value.castShadow !== undefined ? { castShadow: value.castShadow } : {}),
  ...(value.emissionMode !== undefined ? { emissionMode: value.emissionMode } : {}),
  ...(value.burstCount !== undefined ? { burstCount: value.burstCount } : {}),
  ...(value.totalLifetimeMs !== undefined ? { totalLifetimeMs: value.totalLifetimeMs } : {}),
}));

const ThunderFlashConfigZ = z.object({
  enabled: z.boolean(),
  intervalMs: NumRangeZ,
  flashColor: z.number().int().min(0).max(0xffffff),
  flashIntensity: z.number().min(0).max(20),
  durationMs: z.number().int().min(1).max(60_000),
  stutterCount: z.number().int().min(1).max(20),
}).strict();

const WeatherLightingOverrideBaseZ = z.object({
  sunColor: z.number().int().min(0).max(0xffffff).optional(),
  sunIntensityMult: z.number().min(0).max(10).optional(),
  ambientTint: z.number().int().min(0).max(0xffffff).optional(),
  ambientDimMult: z.number().min(0).max(10).optional(),
  fogEnabled: z.boolean().optional(),
  fogColor: z.number().int().min(0).max(0xffffff).optional(),
  fogDensity: z.number().min(0).max(2).optional(),
  exposureMult: z.number().min(0).max(10).optional(),
  thunder: ThunderFlashConfigZ.optional(),
}).strict();

const WeatherLightingOverrideZ: z.ZodType<WeatherConfig['lighting']> = WeatherLightingOverrideBaseZ.transform((value): WeatherConfig['lighting'] => ({
  ...(value.sunColor !== undefined ? { sunColor: value.sunColor } : {}),
  ...(value.sunIntensityMult !== undefined ? { sunIntensityMult: value.sunIntensityMult } : {}),
  ...(value.ambientTint !== undefined ? { ambientTint: value.ambientTint } : {}),
  ...(value.ambientDimMult !== undefined ? { ambientDimMult: value.ambientDimMult } : {}),
  ...(value.fogEnabled !== undefined ? { fogEnabled: value.fogEnabled } : {}),
  ...(value.fogColor !== undefined ? { fogColor: value.fogColor } : {}),
  ...(value.fogDensity !== undefined ? { fogDensity: value.fogDensity } : {}),
  ...(value.exposureMult !== undefined ? { exposureMult: value.exposureMult } : {}),
  ...(value.thunder !== undefined ? { thunder: value.thunder } : {}),
}));

export const WeatherConfigBaseZ = z.object({
  preset: z.enum(WEATHER_PRESETS),
  emitters: z.array(ParticleEmitterConfigZ).max(32),
  lighting: WeatherLightingOverrideZ,
  ambientAudioUrl: z.string().trim().min(1).max(300).nullable().optional(),
  transitionMs: z.number().int().min(0).max(300_000).optional(),
}).strict();

export const WeatherConfigZ: z.ZodType<WeatherConfig> = WeatherConfigBaseZ.transform((value): WeatherConfig => ({
  preset: value.preset,
  emitters: value.emitters,
  lighting: value.lighting,
  ...(value.ambientAudioUrl !== undefined ? { ambientAudioUrl: value.ambientAudioUrl } : {}),
  ...(value.transitionMs !== undefined ? { transitionMs: value.transitionMs } : {}),
}));
