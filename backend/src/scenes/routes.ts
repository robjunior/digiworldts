import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { ELEMENTS, type Element } from '@digiworld/shared/digimon';
import {
  PARTICLE_BLENDINGS,
  PARTICLE_GEOMETRIES,
  PARTICLE_KINDS,
  PARTICLE_SHADERS,
  SPAWN_SHAPES,
  TIME_PHASES,
  WEATHER_PRESETS,
} from '@digiworld/shared/weather';
import type { TimeOfDayConfig, WeatherConfig } from '@digiworld/shared/weather';

import { requireAdmin, requireAuth } from '../auth/routes.js';
import { getCluster } from '../cluster/index.js';
import { log } from '../util/log.js';
import {
  copySceneEntry,
  createSceneEntry,
  deleteSceneEntry,
  getScene,
  listScenes,
  updateSceneEntry,
} from './store.js';

const SCENES_CHANNEL = 'scene:scenes:updated';
const WEATHER_CHANNEL = 'weather:triggered';

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
  drag: z.number().min(0).max(1),
  spawn: ParticleSpawnZ,
  blending: z.enum(PARTICLE_BLENDINGS),
  rotationSpeed: NumRangeZ.optional(),
  collideGround: z.boolean().optional(),
  bounciness: z.number().min(0).max(1).optional(),
  softParticles: z.boolean().optional(),
  castShadow: z.boolean().optional(),
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

const WeatherConfigBaseZ = z.object({
  preset: z.enum(WEATHER_PRESETS),
  emitters: z.array(ParticleEmitterConfigZ).max(32),
  lighting: WeatherLightingOverrideZ,
  ambientAudioUrl: z.string().trim().min(1).max(300).nullable().optional(),
  transitionMs: z.number().int().min(0).max(300_000).optional(),
}).strict();

const WeatherConfigZ: z.ZodType<WeatherConfig> = WeatherConfigBaseZ.transform((value): WeatherConfig => ({
  preset: value.preset,
  emitters: value.emitters,
  lighting: value.lighting,
  ...(value.ambientAudioUrl !== undefined ? { ambientAudioUrl: value.ambientAudioUrl } : {}),
  ...(value.transitionMs !== undefined ? { transitionMs: value.transitionMs } : {}),
}));

const TimeOfDayConfigBaseZ = z.object({
  mode: z.enum(['fixed', 'auto', 'server']),
  fixedPhase: z.enum(TIME_PHASES).optional(),
  cycleDurationMs: z.number().int().min(60_000).max(24 * 3600 * 1000).optional(),
  startPhase: z.enum(TIME_PHASES).optional(),
}).strict();

const TimeOfDayConfigZ: z.ZodType<TimeOfDayConfig> = TimeOfDayConfigBaseZ.transform((value): TimeOfDayConfig => ({
  mode: value.mode,
  ...(value.fixedPhase !== undefined ? { fixedPhase: value.fixedPhase } : {}),
  ...(value.cycleDurationMs !== undefined ? { cycleDurationMs: value.cycleDurationMs } : {}),
  ...(value.startPhase !== undefined ? { startPhase: value.startPhase } : {}),
}));

const WeatherOverrideZ = z.object({
  sceneId: z.string().trim().min(1).max(120).nullish(),
  matchId: z.string().trim().min(1).max(120).nullish(),
  weather: WeatherConfigZ,
  durationMs: z.number().int().min(1000).max(300_000),
}).strict();

const ArenaSettingsZ = z.object({
  sunColor: z.number().int().min(0).max(0xffffff).optional(),
  sunIntensity: z.number().min(0).max(4).optional(),
  sunPosX: z.number().optional(),
  sunPosY: z.number().optional(),
  sunPosZ: z.number().optional(),
  shadowsEnabled: z.boolean().optional(),
  shadowRadius: z.number().min(0).max(32).optional(),
  shadowBias: z.number().min(-0.05).max(0.05).optional(),
  shadowNormalBias: z.number().min(0).max(1).optional(),
  shadowMapSize: z.number().int().min(256).max(8192).optional(),
  fogEnabled: z.boolean().optional(),
  fogMode: z.enum(['linear', 'exp2', 'height']).optional(),
  fogColor: z.number().int().min(0).max(0xffffff).optional(),
  fogNear: z.number().min(0).max(500).optional(),
  fogFar: z.number().min(0).max(500).optional(),
  fogDensity: z.number().min(0).max(2).optional(),
  fogHeight: z.number().min(-100).max(100).optional(),
  hemiSkyColor: z.number().int().min(0).max(0xffffff).optional(),
  hemiGroundColor: z.number().int().min(0).max(0xffffff).optional(),
  hemiIntensity: z.number().min(0).max(4).optional(),
  rimColor: z.number().int().min(0).max(0xffffff).optional(),
  rimIntensity: z.number().min(0).max(4).optional(),
  fillColor: z.number().int().min(0).max(0xffffff).optional(),
  fillIntensity: z.number().min(0).max(4).optional(),
  exposure: z.number().min(0).max(4).optional(),
  dustOpacity: z.number().min(0).max(1).optional(),
  camElevDeg: z.number().min(0).max(89).optional(),
  camYawDeg: z.number().min(-180).max(180).optional(),
  camDist: z.number().min(1).max(80).optional(),
  camLookAtY: z.number().min(-10).max(10).optional(),
  camFrustum: z.number().min(1).max(40).optional(),
  cameraType: z.enum(['ortho', 'perspective']).optional(),
  camFov: z.number().min(1).max(179).optional(),
  arenaSpan: z.number().min(5).max(300).optional(),
  arenaOffsetX: z.number().min(-100).max(100).optional(),
  arenaOffsetY: z.number().min(-100).max(100).optional(),
  arenaOffsetZ: z.number().min(-100).max(100).optional(),
  modelFile: z.string().trim().min(1).max(200).optional(),
}).strict();

const SceneCreateZ = z.object({
  name: z.string().trim().min(1).max(120),
  elements: z.array(z.enum(ELEMENTS)).max(ELEMENTS.length),
  settings: ArenaSettingsZ,
  useGlbSettings: z.boolean().optional(),
  weather: WeatherConfigZ.nullish(),
  timeOfDay: TimeOfDayConfigZ.nullish(),
}).strict();

const SceneUpdateZ = SceneCreateZ.partial();

async function broadcastScenesUpdated(): Promise<void> {
  const cluster = await getCluster();
  await cluster.publish(SCENES_CHANNEL, JSON.stringify({ at: Date.now() }));
}

async function broadcastWeatherTriggered(input: z.infer<typeof WeatherOverrideZ>): Promise<number> {
  const cluster = await getCluster();
  const startedAt = Date.now();
  await cluster.publish(WEATHER_CHANNEL, JSON.stringify({
    type: 'weather-triggered',
    at: Date.now(),
    sceneId: input.sceneId ?? null,
    matchId: input.matchId ?? null,
    weather: input.weather,
    durationMs: input.durationMs,
    startedAt,
  }));
  return startedAt;
}

export const scenesPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/scene/scenes', async (req, reply) => {
    await requireAuth(req, reply);
    const scenes = await listScenes();
    return reply.send({ scenes });
  });

  app.post('/api/admin/scenes', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = SceneCreateZ.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-input', issues: parsed.error.issues });
    }
    const scene = await createSceneEntry({
      name: parsed.data.name,
      elements: parsed.data.elements,
      settings: parsed.data.settings,
      useGlbSettings: parsed.data.useGlbSettings === true,
      weather: parsed.data.weather ?? null,
      timeOfDay: parsed.data.timeOfDay ?? null,
    });
    await broadcastScenesUpdated();
    log.info('admin.scene.create', { adminId: admin.id, sceneId: scene.id, name: scene.name });
    return reply.code(201).send({ ok: true, scene });
  });

  app.put<{ Params: { id: string } }>('/api/admin/scenes/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = SceneUpdateZ.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-input', issues: parsed.error.issues });
    }
    const patch: {
      name?: string;
      elements?: readonly Element[];
      settings?: Readonly<Record<string, unknown>>;
      useGlbSettings?: boolean;
      weather?: WeatherConfig | null;
      timeOfDay?: TimeOfDayConfig | null;
    } = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.elements !== undefined) patch.elements = parsed.data.elements;
    if (parsed.data.settings !== undefined) patch.settings = parsed.data.settings;
    if (parsed.data.useGlbSettings !== undefined) patch.useGlbSettings = parsed.data.useGlbSettings;
    if (parsed.data.weather !== undefined) patch.weather = parsed.data.weather ?? null;
    if (parsed.data.timeOfDay !== undefined) patch.timeOfDay = parsed.data.timeOfDay ?? null;
    const scene = await updateSceneEntry(req.params.id, patch);
    if (scene === null) return reply.code(404).send({ error: 'not-found' });
    await broadcastScenesUpdated();
    log.info('admin.scene.update', { adminId: admin.id, sceneId: scene.id });
    return reply.send({ ok: true, scene });
  });

  app.post<{ Params: { id: string } }>('/api/admin/scenes/:id/copy', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const scene = await copySceneEntry(req.params.id);
    if (scene === null) return reply.code(404).send({ error: 'not-found' });
    await broadcastScenesUpdated();
    log.info('admin.scene.copy', { adminId: admin.id, sourceId: req.params.id, newId: scene.id });
    return reply.code(201).send({ ok: true, scene });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/scenes/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const existing = await getScene(req.params.id);
    if (existing === null) return reply.code(404).send({ error: 'not-found' });
    const ok = await deleteSceneEntry(req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not-found' });
    await broadcastScenesUpdated();
    log.info('admin.scene.delete', { adminId: admin.id, sceneId: req.params.id });
    return reply.send({ ok: true });
  });

  app.post('/api/admin/weather/trigger', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = WeatherOverrideZ.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-input', issues: parsed.error.issues });
    }
    const startedAt = await broadcastWeatherTriggered(parsed.data);
    log.info('admin.weather.trigger', {
      adminId: admin.id,
      sceneId: parsed.data.sceneId ?? null,
      matchId: parsed.data.matchId ?? null,
      durationMs: parsed.data.durationMs,
      startedAt,
    });
    return reply.code(202).send({ ok: true, startedAt, durationMs: parsed.data.durationMs });
  });
};
