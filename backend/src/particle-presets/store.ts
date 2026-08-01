import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type {
  ParticleEmitterConfig,
  ParticlePresetEntry,
} from '@digiworld/shared/weather';

import { config } from '../config.js';
import { log } from '../util/log.js';
import { newId } from '../util/ids.js';

const PRESETS_PATH = resolve(config.paths.dataDir, 'scenes', 'particle-presets.json');

type FileEnvelope = {
  readonly version: 1;
  readonly presets: readonly ParticlePresetEntry[];
};

let cache: readonly ParticlePresetEntry[] | null = null;

function coerceEntry(raw: unknown): ParticlePresetEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec['id'] !== 'string' || rec['id'].trim() === '') return null;
  if (typeof rec['name'] !== 'string') return null;
  const emitterRaw = rec['emitter'];
  if (typeof emitterRaw !== 'object' || emitterRaw === null) return null;
  const created = typeof rec['createdAt'] === 'number' ? rec['createdAt'] : Date.now();
  const updated = typeof rec['updatedAt'] === 'number' ? rec['updatedAt'] : created;
  return {
    id: rec['id'],
    name: rec['name'],
    emitter: emitterRaw as ParticleEmitterConfig,
    createdAt: created,
    updatedAt: updated,
  };
}

async function readEnvelope(): Promise<readonly ParticlePresetEntry[]> {
  if (cache !== null) return cache;
  if (!existsSync(PRESETS_PATH)) {
    await writeEnvelope([]);
    cache = [];
    return [];
  }
  try {
    const raw = await readFile(PRESETS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) throw new Error('malformed');
    const rec = parsed as Record<string, unknown>;
    const presetsRaw = rec['presets'];
    if (!Array.isArray(presetsRaw)) throw new Error('missing-presets');
    const presets: ParticlePresetEntry[] = [];
    for (const item of presetsRaw) {
      const entry = coerceEntry(item);
      if (entry !== null) presets.push(entry);
    }
    cache = presets;
    return presets;
  } catch (err) {
    log.warn('particle-presets.store.read.fail', { err: err instanceof Error ? err.message : String(err) });
    cache = [];
    return [];
  }
}

async function writeEnvelope(presets: readonly ParticlePresetEntry[]): Promise<void> {
  await mkdir(dirname(PRESETS_PATH), { recursive: true });
  const envelope: FileEnvelope = { version: 1, presets };
  await writeFile(PRESETS_PATH, JSON.stringify(envelope, null, 2), 'utf8');
  cache = presets;
}

export async function listParticlePresets(): Promise<readonly ParticlePresetEntry[]> {
  return readEnvelope();
}

export async function getParticlePreset(id: string): Promise<ParticlePresetEntry | null> {
  const all = await readEnvelope();
  return all.find((p) => p.id === id) ?? null;
}

export type ParticlePresetWriteInput = {
  readonly name: string;
  readonly emitter: ParticleEmitterConfig;
};

export async function createParticlePreset(input: ParticlePresetWriteInput): Promise<ParticlePresetEntry> {
  const all = await readEnvelope();
  const now = Date.now();
  const entry: ParticlePresetEntry = {
    id: newId('pfx'),
    name: input.name.trim(),
    emitter: { ...input.emitter, id: newId('emt') },
    createdAt: now,
    updatedAt: now,
  };
  await writeEnvelope([...all, entry]);
  return entry;
}

export async function updateParticlePreset(id: string, patch: Partial<ParticlePresetWriteInput>): Promise<ParticlePresetEntry | null> {
  const all = await readEnvelope();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const existing = all[idx]!;
  const next: ParticlePresetEntry = {
    id: existing.id,
    name: patch.name !== undefined ? patch.name.trim() : existing.name,
    emitter: patch.emitter !== undefined ? { ...patch.emitter, id: existing.emitter.id } : existing.emitter,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  const nextList = [...all];
  nextList[idx] = next;
  await writeEnvelope(nextList);
  return next;
}

export async function deleteParticlePreset(id: string): Promise<boolean> {
  const all = await readEnvelope();
  const next = all.filter((p) => p.id !== id);
  if (next.length === all.length) return false;
  await writeEnvelope(next);
  return true;
}

export function invalidateParticlePresetsCache(): void {
  cache = null;
}
