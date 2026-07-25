import type { FastifyPluginAsync } from 'fastify';
import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
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
const ARENAS_CHANNEL = 'arenas:updated';
const GLB_MAGIC_LE = 0x46546c67;
const PNG_MAGIC_1 = 0x474e5089;
const PNG_MAGIC_2 = 0x0a1a0a0d;
const THUMB_MAX_BYTES = 4 * 1024 * 1024;

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

type ArenaFileMeta = {
  file: string;
  size: number;
  mtime: number;
  thumb?: { url: string; mtime: number };
};

async function listArenaFilesWithMeta(): Promise<ArenaFileMeta[]> {
  const files = await listArenaFiles();
  const out: ArenaFileMeta[] = [];
  for (const file of files) {
    try {
      const st = await stat(join(config.paths.arenasDir, file));
      const entry: ArenaFileMeta = { file, size: st.size, mtime: Math.floor(st.mtimeMs) };
      const basename = file.replace(/\.glb$/, '');
      const thumbPath = join(config.paths.arenasDir, `${basename}.png`);
      try {
        const ts = await stat(thumbPath);
        entry.thumb = { url: `/assets/arenas/${basename}.png`, mtime: Math.floor(ts.mtimeMs) };
      } catch {
      }
      out.push(entry);
    } catch {
      continue;
    }
  }
  return out;
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
    const arenas = await listArenaFilesWithMeta();
    return reply.send({ arenas });
  });

  app.get('/api/arenas', async (req, reply) => {
    await requireAuth(req, reply);
    const arenas = await listArenaFilesWithMeta();
    return reply.send({ arenas: arenas.map(({ file, mtime }) => ({ file, mtime })) });
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

  app.post('/api/admin/arenas', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    let data;
    try {
      data = await req.file();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'multipart parse error';
      return reply.code(413).send({ error: 'file-too-large', message });
    }
    if (!data) {
      return reply.code(400).send({ error: 'no-file', message: 'multipart form must include a file field' });
    }
    const filename = data.filename;
    if (!filename || !ARENA_FILENAME_RE.test(filename)) {
      return reply.code(400).send({
        error: 'bad-filename',
        message: `filename must match ${ARENA_FILENAME_RE.source}`,
      });
    }
    let buf: Buffer;
    try {
      buf = await data.toBuffer();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'file read error';
      return reply.code(413).send({ error: 'file-too-large', message });
    }
    if (buf.length < 12 || buf.readUInt32LE(0) !== GLB_MAGIC_LE) {
      return reply.code(400).send({
        error: 'invalid-glb',
        message: 'file does not start with GLB magic bytes ("glTF")',
      });
    }
    const overwrite = (req.query as { overwrite?: string }).overwrite === '1';
    const target = join(config.paths.arenasDir, filename);
    if (existsSync(target) && !overwrite) {
      return reply.code(409).send({
        error: 'file-exists',
        message: `${filename} already exists; pass ?overwrite=1 to replace`,
        file: filename,
      });
    }
    await mkdir(config.paths.arenasDir, { recursive: true });
    await writeFile(target, buf);
    const st = await stat(target);
    const cluster = await getCluster();
    await cluster.publish(ARENAS_CHANNEL, JSON.stringify({ at: Date.now() }));
    log.info('admin.arena.upload', { adminId: admin.id, file: filename, size: buf.length, overwrite });
    return reply.send({ ok: true, file: filename, size: st.size, mtime: Math.floor(st.mtimeMs) });
  });

  app.delete<{ Params: { file: string } }>('/api/admin/arenas/:file', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const file = req.params.file;
    if (!ARENA_FILENAME_RE.test(file)) {
      return reply.code(400).send({
        error: 'bad-filename',
        message: `filename must match ${ARENA_FILENAME_RE.source}`,
      });
    }
    const biomes = await readBiomeScenes();
    const usedBy = Object.entries(biomes)
      .filter(([, cfg]) => cfg?.file === file)
      .map(([biome]) => biome);
    if (usedBy.length > 0) {
      return reply.code(409).send({
        error: 'in-use',
        message: `arena '${file}' is used by ${usedBy.length} biome(s): ${usedBy.join(', ')}`,
        biomes: usedBy,
      });
    }
    const target = join(config.paths.arenasDir, file);
    if (!existsSync(target)) {
      return reply.code(404).send({ error: 'not-found', message: `${file} not found` });
    }
    await unlink(target);
    const thumbPath = join(config.paths.arenasDir, `${file.replace(/\.glb$/, '')}.png`);
    if (existsSync(thumbPath)) {
      try { await unlink(thumbPath); } catch { }
    }
    const cluster = await getCluster();
    await cluster.publish(ARENAS_CHANNEL, JSON.stringify({ at: Date.now() }));
    log.info('admin.arena.delete', { adminId: admin.id, file });
    return reply.send({ ok: true, file });
  });

  app.post<{ Params: { file: string } }>('/api/admin/arenas/:file/thumbnail', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const file = req.params.file;
    if (!ARENA_FILENAME_RE.test(file)) {
      return reply.code(400).send({
        error: 'bad-filename',
        message: `filename must match ${ARENA_FILENAME_RE.source}`,
      });
    }
    const glbPath = join(config.paths.arenasDir, file);
    if (!existsSync(glbPath)) {
      return reply.code(404).send({ error: 'not-found', message: `${file} not found; upload the .glb first` });
    }
    let data;
    try {
      data = await req.file();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'multipart parse error';
      return reply.code(413).send({ error: 'file-too-large', message });
    }
    if (!data) {
      return reply.code(400).send({ error: 'no-file', message: 'multipart form must include a file field' });
    }
    let buf: Buffer;
    try {
      buf = await data.toBuffer();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'read error';
      return reply.code(413).send({ error: 'file-too-large', message });
    }
    if (buf.length > THUMB_MAX_BYTES) {
      return reply.code(413).send({ error: 'file-too-large', message: `thumbnail must be ≤ ${THUMB_MAX_BYTES} bytes` });
    }
    if (buf.length < 8 || buf.readUInt32LE(0) !== PNG_MAGIC_1 || buf.readUInt32LE(4) !== PNG_MAGIC_2) {
      return reply.code(400).send({ error: 'invalid-png', message: 'file does not start with PNG signature' });
    }
    const thumbPath = join(config.paths.arenasDir, `${file.replace(/\.glb$/, '')}.png`);
    await writeFile(thumbPath, buf);
    const st = await stat(thumbPath);
    const cluster = await getCluster();
    await cluster.publish(ARENAS_CHANNEL, JSON.stringify({ at: Date.now() }));
    log.info('admin.arena.thumbnail.upload', { adminId: admin.id, file, size: buf.length });
    return reply.send({
      ok: true,
      file,
      thumb: { url: `/assets/arenas/${file.replace(/\.glb$/, '')}.png`, mtime: Math.floor(st.mtimeMs) },
    });
  });
};
