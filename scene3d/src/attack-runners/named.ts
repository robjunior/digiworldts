import * as THREE from 'three';

import { SKILL_VFX_NAMED_EFFECTS, type SkillVfxNamedEffect, type SkillVfxRangedEffect } from '@digiworld/shared/skill-vfx';

import type { AttackEffect3D, Runner3D, RunnerBuilder } from './types';
import { buildFireballRunner } from './fireball';
import { buildFrostSpikesRunner } from './frost-spikes';
import { buildIceLanceRunner } from './ice-lance';
import { buildLightningRunner } from './lightning';
import { buildTornadoRunner } from './tornado';
import { buildDarkVoidRunner } from './dark-void';
import { buildHolySmiteRunner } from './holy-smite';
import { buildTidalSurgeRunner } from './tidal-surge';
import { buildBladeStormRunner } from './blade-storm';
import { buildStoneFallRunner } from './stone-fall';
import { buildNullPulseRunner } from './null-pulse';
import { buildVineLashRunner } from './vine-lash';

/** Total play duration (fallback) per named effect — the scene drops the runner
 *  when `elapsed >= duration + 0.05`. Each runner manages its own lifecycle and
 *  self-disposes, so this only bounds how long the effect stays registered. */
const NAMED_DURATIONS: Record<SkillVfxRangedEffect, number> = {
  fireball: 2.1, // 0.7 fly + ~1.4 ground fire
  'frost-spikes': 2.5,
  'ice-lance': 2.4, // 0.35 fly + 2.0 freeze
  tornado: 2.6,
  lightning: 1.7,
  'shadow-void': 2.4, // build 0.5 + drain at 2.3
  'holy-smite': 2.0, // 1.9 beam fade
  'tidal-surge': 1.9, // 0.5 fly + 1.3 surge
  'blade-storm': 2.1, // 2.0 blade lifetime
  'stone-fall': 2.6, // 6 boulders, ends T>=2.6
  'null-pulse': 1.4, // 0.45 fly + ~0.9 pulse
  'vine-lash': 2.3, // vines grow then retract, ends T>=2.3
};

/**
 * Ranged skill effects built as faithful code runners (named IDs selectable via
 * a skill's `vfxPresetId`). Melee (basic-attack) effects are a separate family
 * routed by element through `MELEE_RUNNERS` — they are NOT registered here, so
 * the registry stays scoped to ranged skills.
 */
export const NAMED_RUNNERS: Record<SkillVfxRangedEffect, RunnerBuilder> = {
  fireball: buildFireballRunner,
  'frost-spikes': buildFrostSpikesRunner,
  'ice-lance': buildIceLanceRunner,
  tornado: buildTornadoRunner,
  lightning: buildLightningRunner,
  'shadow-void': buildDarkVoidRunner,
  'holy-smite': buildHolySmiteRunner,
  'tidal-surge': buildTidalSurgeRunner,
  'blade-storm': buildBladeStormRunner,
  'stone-fall': buildStoneFallRunner,
  'null-pulse': buildNullPulseRunner,
  'vine-lash': buildVineLashRunner,
};

export function isNamedEffect(id: string | undefined | null): id is SkillVfxNamedEffect {
  return id !== undefined && id !== null && (SKILL_VFX_NAMED_EFFECTS as readonly string[]).includes(id);
}

export function isRangedEffect(id: string | undefined | null): id is SkillVfxRangedEffect {
  return id !== undefined && id !== null && id in NAMED_RUNNERS;
}

export function namedEffectDuration(id: SkillVfxRangedEffect): number {
  return NAMED_DURATIONS[id] ?? 2.0;
}

/**
 * Build a named RANGED code effect, or null when `id` is not a known ranged
 * effect. Returns a deferred-style runner callable wrapper (matches the lazy
 * build convention in scene.ts so construction stays off the input frame).
 * Melee ids are not handled here — they route through MELEE_RUNNERS.
 */
export function tryBuildNamedRunner(
  scene: THREE.Scene,
  effect: AttackEffect3D,
  id: string | undefined,
): (() => Runner3D) | null {
  if (!isRangedEffect(id)) return null;
  const build = NAMED_RUNNERS[id];
  return () => build(scene, effect);
}