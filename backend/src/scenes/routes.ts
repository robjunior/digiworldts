import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { ELEMENTS, type Element } from '@digiworld/shared/digimon';
import {
  TIME_PHASES,
  WeatherConfigZ,
} from '@digiworld/shared/weather';
import type { TimeOfDayConfig, WeatherConfig } from '@digiworld/shared/weather';

import { requireAdmin, requireAuth } from '../auth/routes.js';
import { getCluster } from '../cluster/index.js';
import { log } from '../util/log.js';
import { LobbySceneSettingsZ } from './lobby-schema.js';
import { WorldSceneSettingsZ } from './world-schema.js';
import { config } from '../config.js';
import { writeSceneRevision, MAX_SCENE_GLB_BYTES, MAX_SCENE_PROJECT_BYTES } from './assets.js';
import { resolve } from 'node:path';

export { LobbySceneSettingsZ } from './lobby-schema.js';
export { WorldSceneSettingsZ } from './world-schema.js';

import {
  copySceneEntry,
  createSceneEntry,
  deleteSceneEntry,
  getScene,
  listScenes,
  LobbySceneAlreadyAssignedError,
  NurserySceneAlreadyAssignedError,
  updateSceneEntry,
  WorldSceneAlreadyAssignedError,
} from './store.js';

const SCENES_CHANNEL = 'scene:scenes:updated';
const WEATHER_CHANNEL = 'weather:triggered';

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


const SceneAssetUrlZ = z.string().trim().min(1).max(200).refine((value) =>
  /^[A-Za-z0-9_.-]+\.glb$/i.test(value)
  || /^\/assets\/scenes\/scn_[0-9a-hjkmnp-tv-z]{26}\/rev_[a-f0-9]{32}\/scene\.glb$/.test(value),
  'Expected a bundled GLB filename or a generated scene asset URL',
);
const SceneProjectUrlZ = z.string().trim().min(1).max(200).regex(
  /^\/assets\/scenes\/scn_[0-9a-hjkmnp-tv-z]{26}\/rev_[a-f0-9]{32}\/project\.app\.json$/,
);

export const ArenaSettingsZ = z.object({
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
  // Common post-processing / atmosphere — present in EVERY scene kind.
  volumetricIntensity: z.number().min(0).max(8).optional(),
  volumetricSoftness: z.number().min(0).max(1).optional(),
  volumetricDistanceBlur: z.number().min(0).max(1).optional(),
  bloomEnabled: z.boolean().optional(),
  bloomStrength: z.number().min(0).max(5).optional(),
  bloomRadius: z.number().min(0.05).max(2).optional(),
  bloomThreshold: z.number().min(0.5).max(2).optional(),
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
  modelFile: SceneAssetUrlZ.optional(),
  editorProjectFile: SceneProjectUrlZ.optional(),
  lobby: LobbySceneSettingsZ.optional(),
  world: WorldSceneSettingsZ.optional(),
}).strict();

const SceneCreateZ = z.object({
  name: z.string().trim().min(1).max(120),
  elements: z.array(z.enum(ELEMENTS)).max(ELEMENTS.length),
  kind: z.enum(['arena', 'lobby', 'world', 'nursery']).optional(),
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
  app.post<{ Params: { id: string } }>('/api/admin/scenes/:id/assets', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const scene = await getScene(req.params.id);
    if (scene === null) return reply.code(404).send({ error: 'not-found' });

    const files = new Map<string, Buffer>();
    try {
      for await (const part of req.parts({
        limits: { files: 2, fields: 0, fileSize: MAX_SCENE_GLB_BYTES },
      })) {
        if (part.type !== 'file' || (part.fieldname !== 'project' && part.fieldname !== 'glb')) {
          return reply.code(400).send({ error: 'invalid-assets' });
        }
        if (files.has(part.fieldname)) return reply.code(400).send({ error: 'duplicate-asset' });
        const bytes = await part.toBuffer();
        if (part.fieldname === 'project' && bytes.byteLength > MAX_SCENE_PROJECT_BYTES) {
          return reply.code(413).send({ error: 'project-too-large' });
        }
        files.set(part.fieldname, bytes);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes('File too large') ? 413 : 400;
      return reply.code(status).send({ error: status === 413 ? 'asset-too-large' : 'invalid-assets' });
    }

    const projectBytes = files.get('project');
    const glbBytes = files.get('glb');
    if (projectBytes === undefined || glbBytes === undefined) {
      return reply.code(400).send({ error: 'project-and-glb-required' });
    }
    try {
      const revision = await writeSceneRevision(
        resolve(config.paths.dataDir, 'scenes', 'assets'),
        scene.id,
        projectBytes,
        glbBytes,
      );
      log.info('admin.scene.assets.upload', { adminId: admin.id, sceneId: scene.id, revision: revision.revision });
      return reply.code(201).send({ ok: true, revision });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: 'invalid-assets', details: message });
    }
  });

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
    let scene;
    try {
      scene = await createSceneEntry({
        name: parsed.data.name,
        elements: parsed.data.elements,
        ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
        settings: parsed.data.settings,
        useGlbSettings: parsed.data.useGlbSettings === true,
        weather: parsed.data.weather ?? null,
        timeOfDay: parsed.data.timeOfDay ?? null,
      });
    } catch (err) {
      if (err instanceof LobbySceneAlreadyAssignedError) {
        return reply.code(409).send({ error: err.code, sceneId: err.existingSceneId });
      }
      if (err instanceof WorldSceneAlreadyAssignedError) {
        return reply.code(409).send({ error: err.code, sceneId: err.existingSceneId });
      }
      if (err instanceof NurserySceneAlreadyAssignedError) {
        return reply.code(409).send({ error: err.code, sceneId: err.existingSceneId });
      }
      throw err;
    }
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
      kind?: 'arena' | 'lobby' | 'world' | 'nursery';
      settings?: Readonly<Record<string, unknown>>;
      useGlbSettings?: boolean;
      weather?: WeatherConfig | null;
      timeOfDay?: TimeOfDayConfig | null;
    } = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.elements !== undefined) patch.elements = parsed.data.elements;
    if (parsed.data.kind !== undefined) patch.kind = parsed.data.kind;
    if (parsed.data.settings !== undefined) patch.settings = parsed.data.settings;
    if (parsed.data.useGlbSettings !== undefined) patch.useGlbSettings = parsed.data.useGlbSettings;
    if (parsed.data.weather !== undefined) patch.weather = parsed.data.weather ?? null;
    if (parsed.data.timeOfDay !== undefined) patch.timeOfDay = parsed.data.timeOfDay ?? null;
    let scene;
    try {
      scene = await updateSceneEntry(req.params.id, patch);
    } catch (err) {
      if (err instanceof LobbySceneAlreadyAssignedError) {
        return reply.code(409).send({ error: err.code, sceneId: err.existingSceneId });
      }
      if (err instanceof WorldSceneAlreadyAssignedError) {
        return reply.code(409).send({ error: err.code, sceneId: err.existingSceneId });
      }
      if (err instanceof NurserySceneAlreadyAssignedError) {
        return reply.code(409).send({ error: err.code, sceneId: err.existingSceneId });
      }
      throw err;
    }
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
