import type { FastifyPluginAsync } from 'fastify';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { ARENA_FILES, BIOMES } from '@digiworld/shared/world';
import { requireAdmin, requireAuth } from '../auth/routes.js';
import { config } from '../config.js';
import { log } from '../util/log.js';
import { getCluster } from '../cluster/index.js';
import { getGameSettings, updateGameSettings } from './engine.js';

const SCENE_DEFAULTS_PATH = resolve(config.paths.dataDir, 'scene-defaults.json');
const BIOME_SCENES_PATH = resolve(config.paths.dataDir, 'biome-scenes.json');

const ARENA_KEYS = ['plant', 'steel', 'water', 'rock', 'dark', 'fire', 'ice', 'field', 'null', 'wind', 'light'] as const;
const ARENA_FILENAME_RE = /^[a-zA-Z0-9_-]+\.glb$/;

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
}).strict();

const PerArenaSceneDefaultsZ = z.partialRecord(z.enum(ARENA_KEYS), ArenaSettingsZ);
type PerArenaSceneDefaults = Partial<z.infer<typeof PerArenaSceneDefaultsZ>>;

const BiomeSceneConfigZ = z.object({
  file: z.string().regex(ARENA_FILENAME_RE, 'file must be a safe .glb filename'),
  settings: ArenaSettingsZ,
}).strict();

const PerBiomeSceneDefaultsZ = z.partialRecord(z.enum(BIOMES), BiomeSceneConfigZ);
type PerBiomeSceneDefaults = Partial<z.infer<typeof PerBiomeSceneDefaultsZ>>;

async function readSceneDefaults(): Promise<PerArenaSceneDefaults> {
  if (!existsSync(SCENE_DEFAULTS_PATH)) return {};
  try {
    const raw = await readFile(SCENE_DEFAULTS_PATH, 'utf8');
    const json = JSON.parse(raw) as unknown;
    const parsed = PerArenaSceneDefaultsZ.safeParse(json);
    return parsed.success ? (parsed.data as PerArenaSceneDefaults) : {};
  } catch {
    return {};
  }
}

async function writeSceneDefaults(next: PerArenaSceneDefaults): Promise<void> {
  await mkdir(dirname(SCENE_DEFAULTS_PATH), { recursive: true });
  await writeFile(SCENE_DEFAULTS_PATH, JSON.stringify(next, null, 2), 'utf8');
}

async function readBiomeScenes(): Promise<PerBiomeSceneDefaults> {
  if (!existsSync(BIOME_SCENES_PATH)) return {};
  try {
    const raw = await readFile(BIOME_SCENES_PATH, 'utf8');
    const json = JSON.parse(raw) as unknown;
    const parsed = PerBiomeSceneDefaultsZ.safeParse(json);
    return parsed.success ? (parsed.data as PerBiomeSceneDefaults) : {};
  } catch {
    return {};
  }
}

async function writeBiomeScenes(next: PerBiomeSceneDefaults): Promise<void> {
  await mkdir(dirname(BIOME_SCENES_PATH), { recursive: true });
  await writeFile(BIOME_SCENES_PATH, JSON.stringify(next, null, 2), 'utf8');
}

async function listArenaFiles(): Promise<string[]> {
  if (!existsSync(config.paths.arenasDir)) return [];
  try {
    const entries = await readdir(config.paths.arenasDir);
    return entries.filter((name) => ARENA_FILENAME_RE.test(name)).sort();
  } catch {
    return [];
  }
}

export const gameSettingsPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/game-settings', async (req, reply) => {
    await requireAdmin(req, reply);
    return reply.send({ settings: await getGameSettings() });
  });

  app.put<{ Body: { xpRate?: number; damageRate?: number } }>('/api/admin/game-settings', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const body = req.body ?? {};
    if (body.xpRate !== undefined && typeof body.xpRate !== 'number') {
      return reply.code(400).send({ error: 'invalid-input', message: 'xpRate must be a number' });
    }
    if (body.damageRate !== undefined && typeof body.damageRate !== 'number') {
      return reply.code(400).send({ error: 'invalid-input', message: 'damageRate must be a number' });
    }
    if (body.xpRate === undefined && body.damageRate === undefined) {
      return reply.code(400).send({ error: 'invalid-input', message: 'must provide xpRate and/or damageRate' });
    }
    const patch: { xpRate?: number; damageRate?: number } = {};
    if (body.xpRate !== undefined) patch.xpRate = body.xpRate;
    if (body.damageRate !== undefined) patch.damageRate = body.damageRate;
    const result = await updateGameSettings(patch);
    if (!result.ok) {
      return reply.code(400).send({ error: result.error, message: result.message });
    }
    log.info('admin.game.settings.update', {
      adminId: admin.id,
      xpRate: result.value.xpRate,
      damageRate: result.value.damageRate,
    });
    return reply.send({ settings: result.value });
  });

  app.get('/api/scene/defaults', async (req, reply) => {
    await requireAuth(req, reply);
    const defaults = await readSceneDefaults();
    return reply.send({ defaults });
  });

  app.post('/api/admin/scene-defaults', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = PerArenaSceneDefaultsZ.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-input', issues: parsed.error.issues });
    }
    await writeSceneDefaults(parsed.data);
    // Broadcast to every WS client via the cluster so their scene-defaults
    // cache invalidates immediately — no need to wait for the 30s TTL.
    const cluster = await getCluster();
    const at = Date.now();
    await cluster.publish('scene:defaults:updated', JSON.stringify({ at }));
    log.info('admin.scene.defaults.update', {
      adminId: admin.id,
      arenas: Object.keys(parsed.data),
      totalKeys: Object.values(parsed.data).reduce<number>((n, v) => n + (v ? Object.keys(v).length : 0), 0),
    });
    return reply.send({ ok: true, defaults: parsed.data });
  });

  app.get('/api/scene/biomes', async (req, reply) => {
    await requireAuth(req, reply);
    const biomes = await readBiomeScenes();
    return reply.send({ biomes });
  });

  app.get('/api/admin/arenas', async (req, reply) => {
    await requireAdmin(req, reply);
    const arenas = await listArenaFiles();
    return reply.send({ arenas });
  });

  app.post('/api/admin/biome-scenes', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = PerBiomeSceneDefaultsZ.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-input', issues: parsed.error.issues });
    }
    const available = new Set(await listArenaFiles());
    for (const [biome, cfg] of Object.entries(parsed.data)) {
      if (cfg && !available.has(cfg.file)) {
        return reply.code(400).send({ error: 'invalid-arena-file', message: `arena file '${cfg.file}' not found in ${config.paths.arenasDir}`, biome });
      }
    }
    await writeBiomeScenes(parsed.data);
    const cluster = await getCluster();
    const at = Date.now();
    await cluster.publish('biome:scenes:updated', JSON.stringify({ at }));
    log.info('admin.biome.scenes.update', {
      adminId: admin.id,
      biomes: Object.keys(parsed.data),
    });
    return reply.send({ ok: true, biomes: parsed.data });
  });
};
