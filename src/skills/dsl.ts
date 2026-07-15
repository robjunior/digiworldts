/**
 * Skill effect DSL (Domain-Specific Language).
 *
 * A skill is a sequence of typed Actions. Each Action targets units via rich
 * pattern strings (self, primary_target, enemy_all, enemy_first_two, ...) and
 * carries typed parameters. Actions can be nested via `schedule` (delayed
 * trigger) and `conditional` (branching on target state), giving the admin a
 * combinator-style language where fewer skills express more mechanics.
 *
 * Runtime interpretation is NOT part of this file — the battle engine
 * consumes `actions_json` in a future ship. This file only:
 *   - Defines the Zod schemas that validate any submitted DSL
 *   - Exports TypeScript types the admin routes + engine will share
 *   - Provides `parseActions` / `stringifyActions` helpers for DB round-trip
 */
import { z } from 'zod';
import { AILMENTS, ELEMENTS, MAX_ENERGY } from '../digimon/types.js';

// ---------------------------------------------------------------------------
// Target patterns — resolved to concrete units at cast time by the engine.
// ---------------------------------------------------------------------------
export const TARGETS = [
  'self',
  'primary_target',
  'caster_ally_all',
  'caster_ally_lowest_hp',
  'caster_ally_slot_0',
  'caster_ally_slot_1',
  'caster_ally_slot_2',
  'enemy_all',
  'enemy_front',
  'enemy_back',
  'enemy_center',
  'enemy_random',
  'enemy_first_two',
  'enemy_last_two',
  'enemy_slot_0',
  'enemy_slot_1',
  'enemy_slot_2',
] as const;
export type Target = (typeof TARGETS)[number];
const TargetSchema = z.enum(TARGETS);

// ---------------------------------------------------------------------------
// Stat scaling: an action's amount may be a flat integer OR scaled from a
// stat of the caster (e.g. `atk * 1.4 + 30`).
// ---------------------------------------------------------------------------
export const SCALE_STATS = ['atk', 'int', 'spd', 'def', 'hp'] as const;
export type ScaleStat = (typeof SCALE_STATS)[number];

const ScaledAmountSchema = z.object({
  base: z.number().int(),
  scale: z.enum(SCALE_STATS),
  factor: z.number().min(-10).max(10),
});
const AmountSchema = z.union([z.number().int(), ScaledAmountSchema]);
export type Amount = z.infer<typeof AmountSchema>;

// ---------------------------------------------------------------------------
// Modifiable stats (for buffs/debuffs).
// ---------------------------------------------------------------------------
export const MODIFIABLE_STATS = ['atk', 'def', 'spd', 'int'] as const;

// ---------------------------------------------------------------------------
// Conditions — small predicates for the `conditional` action.
// ---------------------------------------------------------------------------
const ConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('has_status'), status: z.enum(AILMENTS) }),
  z.object({ kind: z.literal('hp_below_pct'), pct: z.number().min(0).max(100) }),
  z.object({ kind: z.literal('hp_above_pct'), pct: z.number().min(0).max(100) }),
]);
export type Condition = z.infer<typeof ConditionSchema>;

// ---------------------------------------------------------------------------
// Action — the core recursive discriminated union.
// Recursive Zod schemas need z.lazy + explicit ZodType<Action> annotation.
// ---------------------------------------------------------------------------
export type Action =
  | { kind: 'deal_damage'; target: Target; amount: Amount; element?: (typeof ELEMENTS)[number] | undefined; ignore_defense?: boolean | undefined }
  | { kind: 'heal'; target: Target; amount: Amount }
  | { kind: 'apply_status'; target: Target; status: (typeof AILMENTS)[number]; chance: number; turns: number }
  | { kind: 'modify_stat'; target: Target; stat: (typeof MODIFIABLE_STATS)[number]; delta: number; turns: number }
  | { kind: 'consume_en'; target: Target; amount: number }
  | { kind: 'restore_en'; target: Target; amount: number }
  | { kind: 'schedule'; delay: number; action: Action }
  | { kind: 'conditional'; if: Condition; then: Action[]; else?: Action[] | undefined };

export const ActionSchema: z.ZodType<Action> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('deal_damage'),
      target: TargetSchema,
      amount: AmountSchema,
      element: z.enum(ELEMENTS).optional(),
      ignore_defense: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal('heal'),
      target: TargetSchema,
      amount: AmountSchema,
    }),
    z.object({
      kind: z.literal('apply_status'),
      target: TargetSchema,
      status: z.enum(AILMENTS),
      chance: z.number().min(0).max(1),
      turns: z.number().int().min(1).max(20),
    }),
    z.object({
      kind: z.literal('modify_stat'),
      target: TargetSchema,
      stat: z.enum(MODIFIABLE_STATS),
      delta: z.number().int().min(-999).max(999),
      turns: z.number().int().min(1).max(20),
    }),
    z.object({
      kind: z.literal('consume_en'),
      target: TargetSchema,
      amount: z.number().int().min(1).max(MAX_ENERGY),
    }),
    z.object({
      kind: z.literal('restore_en'),
      target: TargetSchema,
      amount: z.number().int().min(1).max(MAX_ENERGY),
    }),
    z.object({
      kind: z.literal('schedule'),
      delay: z.number().int().min(1).max(10),
      action: ActionSchema,
    }),
    z.object({
      kind: z.literal('conditional'),
      if: ConditionSchema,
      then: z.array(ActionSchema).min(1).max(20),
      else: z.array(ActionSchema).max(20).optional(),
    }),
  ]),
);

// ---------------------------------------------------------------------------
// Full skill definition — what admin submits to POST/PUT.
// ---------------------------------------------------------------------------
export const SkillInputSchema = z.object({
  name: z.string().trim().min(2).max(48),
  description: z.string().max(400).optional(),
  element: z.enum(ELEMENTS),
  energyCost: z.number().int().min(0).max(MAX_ENERGY),
  cooldown: z.number().int().min(0).max(10).optional(),
  actions: z.array(ActionSchema).min(1).max(20),
  tags: z.array(z.string().min(1).max(24)).max(10).optional(),
  animation: z.string().max(80).optional(),
  enabled: z.boolean().optional(),
});
export type SkillInput = z.infer<typeof SkillInputSchema>;

// ---------------------------------------------------------------------------
// Storage view — what admin GETs back (includes server-managed fields).
// ---------------------------------------------------------------------------
export type SkillDefinition = SkillInput & {
  id: string;
  createdAt: number;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// DB round-trip helpers. Skills persist as `actions_json` + `tags_json` TEXT
// columns; these helpers marshal to/from the typed shape.
// ---------------------------------------------------------------------------
export function stringifyActions(actions: Action[]): string {
  return JSON.stringify(actions);
}

export function parseActions(json: string): Action[] {
  const parsed = JSON.parse(json) as unknown;
  const check = z.array(ActionSchema).safeParse(parsed);
  if (!check.success) throw new Error(`invalid actions_json: ${check.error.issues[0]?.message ?? 'unknown'}`);
  return check.data;
}

export function stringifyTags(tags: string[] | undefined): string {
  return JSON.stringify(tags ?? []);
}

export function parseTags(json: string): string[] {
  try {
    const raw = JSON.parse(json) as unknown;
    return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}
