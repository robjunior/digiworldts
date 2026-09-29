/**
 * Skill VFX Preset store — flat-file JSON persistence with in-memory cache.
 *
 * Mirror of `backend/src/particle-presets/store.ts` — same envelope pattern
 * (`{ version: 1, presets: [...] }`) written to `data/scenes/skill-vfx-presets.json`.
 * Kept as a sibling module so the two preset stores can diverge later
 * without one dragging the other.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { Element } from '@digiworld/shared/digimon';
import type {
  SkillVfxAttackType,
  SkillVfxEmitterSlot,
  SkillVfxLight,
  SkillVfxPreset,
  SkillVfxTrajectory,
} from '@digiworld/shared/skill-vfx';

import { config } from '../config.js';
import { log } from '../util/log.js';
import { newId } from '../util/ids.js';

const PRESETS_PATH = resolve(config.paths.dataDir, 'scenes', 'skill-vfx-presets.json');

type FileEnvelope = {
  readonly version: 1;
  readonly presets: readonly SkillVfxPreset[];
};

let cache: readonly SkillVfxPreset[] | null = null;

/**
 * Lightweight disk parse — checks structural presence of required fields but
 * does NOT re-run Zod. Values written by the API path are already validated;
 * this only guards against a totally malformed file replacing the envelope.
 * Malformed entries are silently skipped (logged as warn once at load).
 */
function coerceEntry(raw: unknown): SkillVfxPreset | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec['id'] !== 'string' || rec['id'].trim() === '') return null;
  if (typeof rec['name'] !== 'string') return null;
  if (!Array.isArray(rec['emitters']) || rec['emitters'].length === 0) return null;
  if (typeof rec['trajectory'] !== 'string') return null;
  if (typeof rec['totalDurationMs'] !== 'number') return null;
  if (typeof rec['impactAtMs'] !== 'number') return null;
  const created = typeof rec['createdAt'] === 'number' ? rec['createdAt'] : Date.now();
  const updated = typeof rec['updatedAt'] === 'number' ? rec['updatedAt'] : created;
  const preset: SkillVfxPreset = {
    id: rec['id'],
    name: rec['name'],
    ...(typeof rec['element'] === 'string' ? { element: rec['element'] as Element } : {}),
    ...(rec['attackType'] === 'melee' || rec['attackType'] === 'ranged'
      ? { attackType: rec['attackType'] as SkillVfxAttackType }
      : {}),
    emitters: rec['emitters'] as readonly SkillVfxEmitterSlot[],
    trajectory: rec['trajectory'] as SkillVfxTrajectory,
    totalDurationMs: rec['totalDurationMs'],
    impactAtMs: rec['impactAtMs'],
    ...(rec['light'] !== undefined && rec['light'] !== null && typeof rec['light'] === 'object'
      ? { light: rec['light'] as SkillVfxLight }
      : {}),
    createdAt: created,
    updatedAt: updated,
  };
  return preset;
}

async function readEnvelope(): Promise<readonly SkillVfxPreset[]> {
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
    const presets: SkillVfxPreset[] = [];
    for (const item of presetsRaw) {
      const entry = coerceEntry(item);
      if (entry !== null) presets.push(entry);
    }
    cache = presets;
    return presets;
  } catch (err) {
    log.warn('skill-vfx.store.read.fail', { err: err instanceof Error ? err.message : String(err) });
    cache = [];
    return [];
  }
}

async function writeEnvelope(presets: readonly SkillVfxPreset[]): Promise<void> {
  await mkdir(dirname(PRESETS_PATH), { recursive: true });
  const envelope: FileEnvelope = { version: 1, presets };
  await writeFile(PRESETS_PATH, JSON.stringify(envelope, null, 2), 'utf8');
  cache = presets;
}

export async function listSkillVfxPresets(): Promise<readonly SkillVfxPreset[]> {
  return readEnvelope();
}

export async function getSkillVfxPreset(id: string): Promise<SkillVfxPreset | null> {
  const all = await readEnvelope();
  return all.find((p) => p.id === id) ?? null;
}

export type SkillVfxPresetWriteInput = {
  readonly name: string;
  readonly element?: Element | undefined;
  readonly attackType?: SkillVfxAttackType | undefined;
  readonly emitters: readonly SkillVfxEmitterSlot[];
  readonly trajectory: SkillVfxTrajectory;
  readonly totalDurationMs: number;
  readonly impactAtMs: number;
  readonly light?: SkillVfxLight | undefined;
};

export type SkillVfxPresetWritePatch = {
  readonly [K in keyof SkillVfxPresetWriteInput]?: SkillVfxPresetWriteInput[K] | undefined;
};

export async function createSkillVfxPreset(input: SkillVfxPresetWriteInput): Promise<SkillVfxPreset> {
  const all = await readEnvelope();
  const now = Date.now();
  const entry: SkillVfxPreset = {
    id: newId('svfx'),
    name: input.name.trim(),
    ...(input.element !== undefined ? { element: input.element } : {}),
    ...(input.attackType !== undefined ? { attackType: input.attackType } : {}),
    emitters: input.emitters.map((slot) => ({
      emitter: { ...slot.emitter, id: newId('emt') },
      startAtMs: slot.startAtMs,
      followTrajectory: slot.followTrajectory,
    })),
    trajectory: input.trajectory,
    totalDurationMs: input.totalDurationMs,
    impactAtMs: input.impactAtMs,
    ...(input.light !== undefined ? { light: input.light } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await writeEnvelope([...all, entry]);
  return entry;
}

export async function updateSkillVfxPreset(
  id: string,
  patch: SkillVfxPresetWritePatch,
): Promise<SkillVfxPreset | null> {
  const all = await readEnvelope();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const existing = all[idx]!;
  const next: SkillVfxPreset = {
    id: existing.id,
    name: patch.name !== undefined ? patch.name.trim() : existing.name,
    ...(patch.element !== undefined
      ? { element: patch.element }
      : existing.element !== undefined
        ? { element: existing.element }
        : {}),
    ...(patch.attackType !== undefined
      ? { attackType: patch.attackType }
      : existing.attackType !== undefined
        ? { attackType: existing.attackType }
        : {}),
    emitters: patch.emitters !== undefined ? patch.emitters : existing.emitters,
    trajectory: patch.trajectory !== undefined ? patch.trajectory : existing.trajectory,
    totalDurationMs: patch.totalDurationMs !== undefined ? patch.totalDurationMs : existing.totalDurationMs,
    impactAtMs: patch.impactAtMs !== undefined ? patch.impactAtMs : existing.impactAtMs,
    ...(patch.light !== undefined
      ? { light: patch.light }
      : existing.light !== undefined
        ? { light: existing.light }
        : {}),
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  const nextList = [...all];
  nextList[idx] = next;
  await writeEnvelope(nextList);
  return next;
}

export async function deleteSkillVfxPreset(id: string): Promise<boolean> {
  const all = await readEnvelope();
  const next = all.filter((p) => p.id !== id);
  if (next.length === all.length) return false;
  await writeEnvelope(next);
  return true;
}

export function invalidateSkillVfxPresetsCache(): void {
  cache = null;
}
