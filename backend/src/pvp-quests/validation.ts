import { z } from 'zod';
import { ELEMENTS, AILMENTS } from '@digiworld/shared/digimon';
import {
  PVP_QUEST_CATEGORIES,
  PVP_QUEST_PERIODS,
} from '@digiworld/shared/pvp-quest';
import type {
  PvpQuestCategory,
  PvpQuestParams,
  PvpQuestParamsMap,
  PvpQuestPeriod,
  PvpQuestReward,
} from '@digiworld/shared/pvp-quest';

/**
 * Zod schemas for the PvP quest surface. These validate *server-generated* data
 * before it is persisted and *admin* input before a preview is built. Player
 * clients never submit quest definitions — they only submit battle actions.
 */

const ElementSchema = z.enum(ELEMENTS as unknown as [string, ...string[]]);
const AilmentSchema = z.enum(AILMENTS as unknown as [string, ...string[]]);

const paramsSchemaFor = (category: PvpQuestCategory): z.ZodType<PvpQuestParamsMap[PvpQuestCategory]> => {
  switch (category) {
    case 'ELEMENT_KILLS':
      return z.object({ element: ElementSchema }) as unknown as z.ZodType<PvpQuestParamsMap[PvpQuestCategory]>;
    case 'DISADVANTAGE':
      return z.object({ mode: z.enum(['kill', 'victory']) }) as unknown as z.ZodType<PvpQuestParamsMap[PvpQuestCategory]>;
    case 'TEAM_SURVIVAL':
      return z
        .object({ minimumSurvivors: z.number().int().min(1).max(3).optional(), maximumSurvivors: z.number().int().min(1).max(3).optional() })
        .refine((v) => v.minimumSurvivors !== undefined || v.maximumSurvivors !== undefined, { message: 'needs at least one bound' }) as unknown as z.ZodType<PvpQuestParamsMap[PvpQuestCategory]>;
    case 'STATUS':
      return z.object({ statusType: AilmentSchema.optional() }) as unknown as z.ZodType<PvpQuestParamsMap[PvpQuestCategory]>;
    case 'DEBUFF':
      return z.object({ debuffType: AilmentSchema.optional() }) as unknown as z.ZodType<PvpQuestParamsMap[PvpQuestCategory]>;
    case 'TURNS':
      return z.object({
        operator: z.enum(['<=', '>=']),
        requiredTurns: z.number().int().min(1).max(200),
        requireWin: z.boolean().optional(),
      }) as unknown as z.ZodType<PvpQuestParamsMap[PvpQuestCategory]>;
    case 'DIVERSE_TEAM':
      return z.object({ requiredUniqueElements: z.number().int().min(2).max(3) }) as unknown as z.ZodType<PvpQuestParamsMap[PvpQuestCategory]>;
    case 'OPPONENT_COMPOSITION':
      return z
        .object({
          requiredUniqueElements: z.number().int().min(2).max(6).optional(),
          requiredSameElementPair: z.boolean().optional(),
        })
        .refine((v) => v.requiredUniqueElements !== undefined || v.requiredSameElementPair === true, { message: 'needs at least one constraint' }) as unknown as z.ZodType<PvpQuestParamsMap[PvpQuestCategory]>;
    default:
      return z.object({}).strict() as unknown as z.ZodType<PvpQuestParamsMap[PvpQuestCategory]>;
  }
};

export const PvpQuestRewardSchema: z.ZodType<PvpQuestReward> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('netcore'), amount: z.number().int().min(1).max(10_000_000) }),
  z.object({ kind: z.literal('credits'), amount: z.number().int().min(1).max(10_000_000) }),
  z.object({ kind: z.literal('item'), itemId: z.string().min(1).max(80), qty: z.number().int().min(1).max(999_999) }),
  z.object({ kind: z.literal('pvp_points'), amount: z.number().int().min(1).max(10_000_000) }),
  z.object({ kind: z.literal('xp'), amount: z.number().int().min(1).max(10_000_000) }),
  z.object({ kind: z.literal('cosmetic'), cosmeticId: z.string().min(1).max(80) }),
] as const);

export const PvpQuestTemplateSchema = z.object({
  instanceId: z.string().min(1).max(40),
  period: z.enum(PVP_QUEST_PERIODS as unknown as [PvpQuestPeriod, ...PvpQuestPeriod[]]),
  category: z.enum(PVP_QUEST_CATEGORIES as unknown as [PvpQuestCategory, ...PvpQuestCategory[]]),
  params: z.record(z.string(), z.unknown()),
  target: z.number().int().min(1).max(10_000_000),
  reward: PvpQuestRewardSchema,
});

/**
 * Validate a full template, narrowing `params` to the registered shape for the
 * category. Returns a typed template or a list of issues.
 */
export function validateTemplate(input: unknown): { ok: true; value: import('@digiworld/shared/pvp-quest').PvpQuestTemplate } | { ok: false; issues: string[] } {
  const parsed = PvpQuestTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  const t = parsed.data;
  const paramsResult = paramsSchemaFor(t.category).safeParse(t.params);
  if (!paramsResult.success) {
    return { ok: false, issues: paramsResult.error.issues.map((i) => `params.${i.path.join('.')}: ${i.message}`) };
  }
  return {
    ok: true,
    value: { ...t, params: paramsResult.data as PvpQuestParams },
  };
}
