import * as THREE from 'three';

import { SKILL_VFX_NAMED_EFFECTS, type SkillVfxNamedEffect } from '@digiworld/shared/skill-vfx';

import type { AttackEffect3D, Runner3D, RunnerBuilder } from './types';
import { buildFireballRunner } from './fireball';
import { buildFrostSpikesRunner } from './frost-spikes';
import { buildIceLanceRunner } from './ice-lance';
import { buildLightningRunner } from './lightning';
import { buildTornadoRunner } from './tornado';

/** Total play duration (fallback) per named effect — the scene drops the runner
 *  when `elapsed >= duration + 0.05`. Each runner manages its own lifecycle and
 *  self-disposes, so this only bounds how long the effect stays registered. */
const NAMED_DURATIONS: Record<SkillVfxNamedEffect, number> = {
  fireball: 2.1, // 0.7 fly + ~1.4 ground fire
  'frost-spikes': 2.5,
  'ice-lance': 2.4, // 0.35 fly + 2.0 freeze
  tornado: 2.6,
  lightning: 1.7,
};

export const NAMED_RUNNERS: Record<SkillVfxNamedEffect, RunnerBuilder> = {
  fireball: buildFireballRunner,
  'frost-spikes': buildFrostSpikesRunner,
  'ice-lance': buildIceLanceRunner,
  tornado: buildTornadoRunner,
  lightning: buildLightningRunner,
};

export function isNamedEffect(id: string | undefined | null): id is SkillVfxNamedEffect {
  return id !== undefined && id !== null && (SKILL_VFX_NAMED_EFFECTS as readonly string[]).includes(id);
}

export function namedEffectDuration(id: SkillVfxNamedEffect): number {
  return NAMED_DURATIONS[id] ?? 2.0;
}

/**
 * Build a named code effect, or null when `id` is not a known named effect.
 * Returns a deferred-style runner callable wrapper (matches the lazy-build
 * convention in scene.ts so construction stays off the input frame).
 */
export function tryBuildNamedRunner(
  scene: THREE.Scene,
  effect: AttackEffect3D,
  id: string | undefined,
): (() => Runner3D) | null {
  if (!isNamedEffect(id)) return null;
  const effectId: SkillVfxNamedEffect = id;
  const build = NAMED_RUNNERS[effectId];
  return () => build!(scene, effect);
}