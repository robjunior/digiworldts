import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ELEMENTS, type Element } from '@digiworld/shared/digimon';
import { ARENA_KEY_TO_ELEMENTS, LEGACY_ARENA_KEYS, type LegacyArenaKey, type SceneEntity } from '@digiworld/shared/scene';
import type { TimeOfDayConfig, WeatherConfig } from '@digiworld/shared/weather';

import { config } from '../config.js';
import { log } from '../util/log.js';
import { newId } from '../util/ids.js';

const SCENES_PATH = resolve(config.paths.dataDir, 'scenes', 'scenes.json');
const LEGACY_DEFAULTS_PATH = resolve(config.paths.dataDir, 'scenes', 'scene-defaults.json');

type SceneFileEnvelope = {
  readonly version: 2;
  readonly scenes: readonly SceneFileRecord[];
};

type SceneFileRecord = SceneEntity & {
  readonly weather: WeatherConfig | null;
  readonly timeOfDay: TimeOfDayConfig | null;
};

let cache: readonly SceneEntity[] | null = null;

function isElement(value: unknown): value is Element {
  return typeof value === 'string' && (ELEMENTS as readonly string[]).includes(value);
}

function coerceNullableObject<T>(value: unknown): T | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...(value as T & object) } : null;
}

function coerceScene(raw: unknown): SceneEntity | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec['id'] !== 'string' || rec['id'].trim() === '') return null;
  if (typeof rec['name'] !== 'string') return null;
  const elementsRaw = rec['elements'];
  const elements: Element[] = Array.isArray(elementsRaw) ? elementsRaw.filter(isElement) : [];
  const settingsRaw = rec['settings'];
  const settings: Record<string, unknown> = typeof settingsRaw === 'object' && settingsRaw !== null && !Array.isArray(settingsRaw)
    ? { ...(settingsRaw as Record<string, unknown>) }
    : {};
  const useGlb = rec['useGlbSettings'] === true;
  const weather = coerceNullableObject<WeatherConfig>(rec['weather']);
  const timeOfDay = coerceNullableObject<TimeOfDayConfig>(rec['timeOfDay']);
  const created = typeof rec['createdAt'] === 'number' ? rec['createdAt'] : Date.now();
  const updated = typeof rec['updatedAt'] === 'number' ? rec['updatedAt'] : created;
  return {
    id: rec['id'],
    name: rec['name'],
    elements,
    settings,
    useGlbSettings: useGlb,
    weather,
    timeOfDay,
    createdAt: created,
    updatedAt: updated,
  };
}

function sceneToRecord(scene: SceneEntity): SceneFileRecord {
  return {
    ...scene,
    weather: scene.weather ?? null,
    timeOfDay: scene.timeOfDay ?? null,
  };
}

async function seedFromLegacyDefaults(): Promise<SceneEntity[]> {
  if (!existsSync(LEGACY_DEFAULTS_PATH)) return [];
  try {
    const raw = await readFile(LEGACY_DEFAULTS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return [];
    const now = Date.now();
    const seeded: SceneEntity[] = [];
    const record = parsed as Record<string, unknown>;
    for (const key of LEGACY_ARENA_KEYS) {
      const arenaSettings = record[key];
      const hasSettings = typeof arenaSettings === 'object' && arenaSettings !== null && Object.keys(arenaSettings as Record<string, unknown>).length > 0;
      if (!hasSettings) continue;
      seeded.push({
        id: newId('scn'),
        name: capitalize(key),
        elements: ARENA_KEY_TO_ELEMENTS[key as LegacyArenaKey],
        settings: { ...(arenaSettings as Record<string, unknown>) },
        useGlbSettings: false,
        weather: null,
        timeOfDay: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    return seeded;
  } catch {
    return [];
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

async function readEnvelope(): Promise<readonly SceneEntity[]> {
  if (cache !== null) return cache;
  if (!existsSync(SCENES_PATH)) {
    const seeded = await seedFromLegacyDefaults();
    await writeEnvelope(seeded);
    cache = seeded;
    log.info('scenes.store.seed', { count: seeded.length, source: seeded.length > 0 ? 'legacy-defaults' : 'empty' });
    return seeded;
  }
  try {
    const raw = await readFile(SCENES_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) throw new Error('malformed');
    const rec = parsed as Record<string, unknown>;
    const scenesRaw = rec['scenes'];
    if (!Array.isArray(scenesRaw)) throw new Error('missing-scenes');
    const scenes: SceneEntity[] = [];
    for (const item of scenesRaw) {
      const scene = coerceScene(item);
      if (scene !== null) scenes.push(scene);
    }
    cache = scenes;
    return scenes;
  } catch (err) {
    log.warn('scenes.store.read.fail', { err: err instanceof Error ? err.message : String(err) });
    cache = [];
    return [];
  }
}

async function writeEnvelope(scenes: readonly SceneEntity[]): Promise<void> {
  await mkdir(dirname(SCENES_PATH), { recursive: true });
  const envelope: SceneFileEnvelope = { version: 2, scenes: scenes.map(sceneToRecord) };
  await writeFile(SCENES_PATH, JSON.stringify(envelope, null, 2), 'utf8');
  cache = scenes;
}

export async function listScenes(): Promise<readonly SceneEntity[]> {
  return readEnvelope();
}

export async function getScene(id: string): Promise<SceneEntity | null> {
  const all = await readEnvelope();
  return all.find((s) => s.id === id) ?? null;
}

export type SceneWriteInput = {
  readonly name: string;
  readonly elements: readonly Element[];
  readonly settings: Readonly<Record<string, unknown>>;
  readonly useGlbSettings?: boolean;
  readonly weather?: WeatherConfig | null;
  readonly timeOfDay?: TimeOfDayConfig | null;
};

export async function createSceneEntry(input: SceneWriteInput): Promise<SceneEntity> {
  const all = await readEnvelope();
  const now = Date.now();
  const scene: SceneEntity = {
    id: newId('scn'),
    name: input.name.trim(),
    elements: [...input.elements],
    settings: { ...input.settings },
    useGlbSettings: input.useGlbSettings === true,
    weather: input.weather ?? null,
    timeOfDay: input.timeOfDay ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await writeEnvelope([...all, scene]);
  return scene;
}

export async function updateSceneEntry(id: string, patch: Partial<SceneWriteInput>): Promise<SceneEntity | null> {
  const all = await readEnvelope();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const existing = all[idx]!;
  const next: SceneEntity = {
    id: existing.id,
    name: patch.name !== undefined ? patch.name.trim() : existing.name,
    elements: patch.elements !== undefined ? [...patch.elements] : existing.elements,
    settings: patch.settings !== undefined ? { ...patch.settings } : existing.settings,
    useGlbSettings: patch.useGlbSettings !== undefined ? patch.useGlbSettings === true : (existing.useGlbSettings ?? false),
    weather: patch.weather !== undefined ? patch.weather : (existing.weather ?? null),
    timeOfDay: patch.timeOfDay !== undefined ? patch.timeOfDay : (existing.timeOfDay ?? null),
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  const nextList = [...all];
  nextList[idx] = next;
  await writeEnvelope(nextList);
  return next;
}

export async function copySceneEntry(id: string): Promise<SceneEntity | null> {
  const source = await getScene(id);
  if (source === null) return null;
  return createSceneEntry({
    name: `${source.name} (copy)`,
    elements: source.elements,
    settings: source.settings,
    useGlbSettings: source.useGlbSettings === true,
    weather: source.weather ?? null,
    timeOfDay: source.timeOfDay ?? null,
  });
}

export async function deleteSceneEntry(id: string): Promise<boolean> {
  const all = await readEnvelope();
  const next = all.filter((s) => s.id !== id);
  if (next.length === all.length) return false;
  await writeEnvelope(next);
  return true;
}

export function invalidateSceneCache(): void {
  cache = null;
}
