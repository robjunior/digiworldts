/**
 * Skill VFX Preset — particle-based one-shot effects tied to skill catalog IDs.
 *
 * A `SkillVfxPreset` composes 1-3 `ParticleEmitterConfig`s (from weather.ts),
 * an optional `THREE.PointLight` envelope, a source→target trajectory, and
 * timing. The runtime instantiates a preset runner from `AttackEffect3D` that
 * plays the composed effect once and auto-disposes.
 *
 * Presets live in `data/scenes/skill-vfx-presets.json` (mirror of
 * `particle-presets.json`). Skills reference by opaque `vfxPresetId`; a missing
 * preset falls back silently to the element's hardcoded shader runner.
 *
 * This module is symmetric with weather.ts — same `.strict()` + `.transform()`
 * Zod pattern, same "types + write schema for API input" split.
 */

import { z } from 'zod';

import { ELEMENTS, type Element } from './digimon.js';
import {
  ParticleEmitterConfigZ,
  type ParticleEmitterConfig,
} from './weather.js';

export const SKILL_VFX_TRAJECTORIES = ['instant', 'straight', 'arc', 'homing'] as const;
export type SkillVfxTrajectory = (typeof SKILL_VFX_TRAJECTORIES)[number];

/**
 * How the skill is DELIVERED — purely a visual/effect distinction, it never
 * affects combat mechanics. `melee` makes the caster advance to face the
 * receiver and the camera follow that movement; `ranged` keeps the caster in
 * place and the camera follows the projectile/effect instead. Missing on a
 * stored preset (legacy files) defaults to `ranged` at read time.
 */
export const SKILL_VFX_ATTACK_TYPES = ['ranged', 'melee'] as const;
export type SkillVfxAttackType = (typeof SKILL_VFX_ATTACK_TYPES)[number];

export type SkillVfxLight = {
  readonly color: number;
  readonly intensity: number;
  readonly distance: number;
  readonly decayMs: number;
};

/**
 * One layer of a preset. `startAtMs` offsets the spawn from t=0 (so a "smoke"
 * emitter can fire after a "spark" emitter). `followTrajectory` = true means
 * the emitter's spawn center rides source→target; false means it plays at the
 * spawn's static center (typical for impact bursts).
 */
export type SkillVfxEmitterSlot = {
  readonly emitter: ParticleEmitterConfig;
  readonly startAtMs: number;
  readonly followTrajectory: boolean;
};

export type SkillVfxPreset = {
  readonly id: string;
  readonly name: string;
  readonly element?: Element;
  /** How the effect is delivered — visual only. See `SKILL_VFX_ATTACK_TYPES`.
   *  Optional for legacy stored presets; `?? 'ranged'` at read time. */
  readonly attackType?: SkillVfxAttackType;
  readonly emitters: readonly SkillVfxEmitterSlot[];
  readonly trajectory: SkillVfxTrajectory;
  readonly totalDurationMs: number;
  readonly impactAtMs: number;
  readonly light?: SkillVfxLight;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type SkillVfxPresetListResponse = {
  readonly presets: readonly SkillVfxPreset[];
};

export type SkillVfxPresetMutationResponse = {
  readonly ok: true;
  readonly preset: SkillVfxPreset;
};

const SkillVfxLightBaseZ = z.object({
  color: z.number().int().min(0).max(0xffffff),
  intensity: z.number().min(0).max(20),
  distance: z.number().min(0).max(100),
  decayMs: z.number().int().min(0).max(10_000),
}).strict();

export const SkillVfxLightZ: z.ZodType<SkillVfxLight> = SkillVfxLightBaseZ.transform((v): SkillVfxLight => ({
  color: v.color,
  intensity: v.intensity,
  distance: v.distance,
  decayMs: v.decayMs,
}));

const SkillVfxEmitterSlotBaseZ = z.object({
  emitter: ParticleEmitterConfigZ,
  startAtMs: z.number().int().min(0).max(10_000),
  followTrajectory: z.boolean(),
}).strict();

const SkillVfxEmitterSlotZ: z.ZodType<SkillVfxEmitterSlot> = SkillVfxEmitterSlotBaseZ.transform((v): SkillVfxEmitterSlot => ({
  emitter: v.emitter,
  startAtMs: v.startAtMs,
  followTrajectory: v.followTrajectory,
}));

/**
 * Body for POST /api/admin/skill-vfx-presets and (via `.partial()`) PUT.
 * Omits id + createdAt + updatedAt — those are server-generated. Backend uses
 * `SkillVfxPresetWriteZ.partial()` for the PUT body, mirroring the pattern in
 * `backend/src/particle-presets/routes.ts`.
 */
export const SkillVfxPresetWriteZ = z.object({
  name: z.string().trim().min(1).max(120),
  element: z.enum(ELEMENTS).optional(),
  attackType: z.enum(SKILL_VFX_ATTACK_TYPES).optional(),
  emitters: z.array(SkillVfxEmitterSlotZ).min(1).max(3),
  trajectory: z.enum(SKILL_VFX_TRAJECTORIES),
  totalDurationMs: z.number().int().min(1).max(5_000),
  impactAtMs: z.number().int().min(0).max(5_000),
  light: SkillVfxLightZ.optional(),
}).strict();
