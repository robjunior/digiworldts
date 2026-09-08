import type {
  Ailment,
  Element,
  PvpBattleResult,
  PvpQuestCategory,
  PvpQuestParams,
  PvpQuestParamsMap,
  PvpQuestPeriod,
  PvpQuestTemplate,
} from '@digiworld/shared/pvp-quest';
import { ELEMENTS } from '@digiworld/shared/digimon';

/**
 * Category registry — the single extension point of the PvP quest system.
 *
 * Each category declares:
 *   - `describe`: derive the human-readable title purely from the data tuple
 *     (category + params + target + period). No DB, no battle state.
 *   - `evaluate`: given an authoritative battle result, return the progress
 *     delta for one quest of this category *and* an updated free-form `state`
 *     (used for set-based accumulation like unique elements).
 *
 * To add a new category you add one entry here (plus the type in shared). No
 * storage, generator, route, or evaluator changes are needed — they are all
 * data-driven over `PVP_QUEST_CATEGORIES`.
 *
 * The evaluator only ever calls `evaluate` once per category per battle, so
 * cross-category double counting is by design: one Fire kill with super-effective
 * advantage simultaneously advances KILLS, ELEMENT_KILLS(FIRE) and
 * SUPER_EFFECTIVE. That is expected, not a bug.
 */

type HandlerFn<K extends PvpQuestCategory> = {
  describe: (params: PvpQuestParamsMap[K], target: number, period: PvpQuestPeriod) => string;
  evaluate: (
    result: PvpBattleResult,
    params: PvpQuestParamsMap[K],
    state: Record<string, unknown>,
  ) => { delta: number; state: Record<string, unknown> };
};

/**
 * Each `describe`/`evaluate` is written against its own strongly-typed params,
 * but stored homogenously as `HandlerFn<PvpQuestCategory>` (params widened to the
 * union). The per-entry casts below are safe: at call time `evaluateCategory`
 * always passes the params object that the category itself emitted at generation.
 */
const REGISTRY = {
  VICTORY: {
    describe: (_p: Record<string, never>, target: number, period: PvpQuestPeriod) =>
      `${cap(period.toLowerCase())}: Vença ${plural(target, 'batalha')} PvP${target === 1 ? '' : 's'}.`,
    evaluate: (r: PvpBattleResult) => ({ delta: r.valid && r.result === 'win' ? 1 : 0, state: {} }),
  } as HandlerFn<'VICTORY'>,

  WIN_STREAK: {
    describe: (_p: Record<string, never>, target: number, period: PvpQuestPeriod) =>
      `${cap(period.toLowerCase())}: Consiga uma sequência de ${target} vitória${target === 1 ? '' : 's'} consecutiva${target === 1 ? '' : 's'}.`,
    evaluate: (r: PvpBattleResult) => ({ delta: r.valid && r.result === 'win' ? 1 : 0, state: {} }),
  } as HandlerFn<'WIN_STREAK'>,

  BATTLE_COUNT: {
    describe: (_p: Record<string, never>, target: number, period: PvpQuestPeriod) =>
      `${cap(period.toLowerCase())}: Participe de ${plural(target, 'batalha')} PvP${target === 1 ? '' : 's'}.`,
    evaluate: (r: PvpBattleResult) => ({ delta: r.valid ? 1 : 0, state: {} }),
  } as HandlerFn<'BATTLE_COUNT'>,

  KILLS: {
    describe: (_p: Record<string, never>, target: number, period: PvpQuestPeriod) =>
      `${cap(period.toLowerCase())}: Derrote ${plural(target, 'Digimon')} em PvP.`,
    evaluate: (r: PvpBattleResult) => ({ delta: r.valid ? r.kills : 0, state: {} }),
  } as HandlerFn<'KILLS'>,

  ELEMENT_KILLS: {
    describe: (p: { element: Element }, target: number) =>
      `Derrote ${plural(target, `Digimon ${cap(p.element)}`)} em batalhas PvP.`,
    evaluate: (r: PvpBattleResult, p: { element: Element }) => ({
      delta: r.valid ? (r.elementKills[p.element] ?? 0) : 0,
      state: {},
    }),
  } as HandlerFn<'ELEMENT_KILLS'>,

  UNIQUE_ELEMENTS: {
    describe: (_p: Record<string, never>, target: number) =>
      `Derrote Digimons de ${target} elementos diferentes em batalhas PvP.`,
    evaluate: (r: PvpBattleResult, _p: Record<string, never>, state: Record<string, unknown>) => {
      if (!r.valid) return { delta: 0, state };
      const seen = new Set<string>((state.seen as string[] | undefined) ?? []);
      for (const el of Object.keys(r.elementKills)) seen.add(el);
      const count = seen.size;
      const prev = (state.prev as number) ?? 0;
      return { delta: Math.max(0, count - prev), state: { seen: [...seen], prev: count } };
    },
  } as HandlerFn<'UNIQUE_ELEMENTS'>,

  SUPER_EFFECTIVE: {
    describe: (_p: Record<string, never>, target: number, period: PvpQuestPeriod) =>
      `${cap(period.toLowerCase())}: Consiga ${plural(target, 'kill')} com vantagem elemental.`,
    evaluate: (r: PvpBattleResult) => ({ delta: r.valid ? r.superEffectiveKills : 0, state: {} }),
  } as HandlerFn<'SUPER_EFFECTIVE'>,

  DISADVANTAGE: {
    describe: (p: { mode: 'kill' | 'victory' }, target: number) =>
      p.mode === 'victory'
        ? `Vença ${plural(target, 'batalha')} tendo ao menos um Digimon em desvantagem elemental.`
        : `Derrote ${plural(target, 'Digimon')} enquanto estiver em desvantagem elemental.`,
    evaluate: (r: PvpBattleResult, p: { mode: 'kill' | 'victory' }) => {
      if (!r.valid) return { delta: 0, state: {} };
      if (p.mode === 'victory') return { delta: r.disadvantagedWin ? 1 : 0, state: {} };
      return { delta: r.disadvantagedKills, state: {} };
    },
  } as HandlerFn<'DISADVANTAGE'>,

  TEAM_SURVIVAL: {
    describe: (p: { minimumSurvivors?: number; maximumSurvivors?: number }) => {
      const lo = p.minimumSurvivors;
      const hi = p.maximumSurvivors;
      if (lo !== undefined && hi !== undefined && lo === hi) {
        return `Vença mantendo exatamente ${lo} Digimon${lo === 1 ? '' : 's'} vivo${lo === 1 ? '' : 's'}.`;
      }
      if (lo !== undefined) return `Vença mantendo pelo menos ${lo} Digimon${lo === 1 ? '' : 's'} vivo${lo === 1 ? '' : 's'}.`;
      if (hi !== undefined) return `Vença mantendo no máximo ${hi} Digimon${hi === 1 ? '' : 's'} vivo${hi === 1 ? '' : 's'}.`;
      return 'Vença mantendo Digimons vivos.';
    },
    evaluate: (r: PvpBattleResult, p: { minimumSurvivors?: number; maximumSurvivors?: number }) => {
      if (!r.valid || r.result !== 'win') return { delta: 0, state: {} };
      const lo = p.minimumSurvivors ?? 0;
      const hi = p.maximumSurvivors ?? 3;
      return { delta: r.survivors >= lo && r.survivors <= hi ? 1 : 0, state: {} };
    },
  } as HandlerFn<'TEAM_SURVIVAL'>,

  PERFECT_WIN: {
    describe: (_p: Record<string, never>, target: number, period: PvpQuestPeriod) =>
      `${cap(period.toLowerCase())}: Vença ${plural(target, 'batalha')} sem perder nenhum Digimon.`,
    evaluate: (r: PvpBattleResult) =>
      ({ delta: r.valid && r.result === 'win' && r.survivors === 3 ? 1 : 0, state: {} }),
  } as HandlerFn<'PERFECT_WIN'>,

  COMEBACK: {
    describe: (_p: Record<string, never>, target: number, period: PvpQuestPeriod) =>
      `${cap(period.toLowerCase())}: Vença ${plural(target, 'batalha')} após uma situação desfavorável.`,
    evaluate: (r: PvpBattleResult) =>
      ({ delta: r.valid && r.result === 'win' && r.comeback ? 1 : 0, state: {} }),
  } as HandlerFn<'COMEBACK'>,

  DAMAGE: {
    describe: (_p: Record<string, never>, target: number, period: PvpQuestPeriod) =>
      `${cap(period.toLowerCase())}: Causa ${target.toLocaleString('en-US')} de dano em PvP.`,
    evaluate: (r: PvpBattleResult) => ({ delta: r.valid ? r.damageDealt : 0, state: {} }),
  } as HandlerFn<'DAMAGE'>,

  CRITICAL: {
    describe: (_p: Record<string, never>, target: number, period: PvpQuestPeriod) =>
      `${cap(period.toLowerCase())}: Consiga ${plural(target, 'acerto crítico')}.`,
    evaluate: (r: PvpBattleResult) => ({ delta: r.valid ? r.criticalHits : 0, state: {} }),
  } as HandlerFn<'CRITICAL'>,

  STATUS: {
    describe: (p: { statusType?: Ailment }, target: number) =>
      `Aplique ${plural(target, 'efeito de status')}${p.statusType ? ` do tipo ${p.statusType}` : ''} em PvP.`,
    evaluate: (r: PvpBattleResult, p: { statusType?: Ailment }) => {
      if (!r.valid) return { delta: 0, state: {} };
      if (p.statusType) return { delta: r.statusByType?.[p.statusType] ?? 0, state: {} };
      return { delta: r.statusApplications, state: {} };
    },
  } as HandlerFn<'STATUS'>,

  DEBUFF: {
    describe: (p: { debuffType?: Ailment }, target: number) =>
      `Aplique ${plural(target, 'debuff')}${p.debuffType ? ` do tipo ${p.debuffType}` : ''} em PvP.`,
    evaluate: (r: PvpBattleResult, p: { debuffType?: Ailment }) => {
      if (!r.valid) return { delta: 0, state: {} };
      if (p.debuffType) return { delta: r.debuffByType?.[p.debuffType] ?? 0, state: {} };
      return { delta: r.debuffApplications, state: {} };
    },
  } as HandlerFn<'DEBUFF'>,

  TURNS: {
    describe: (p: { operator: '<=' | '>='; requiredTurns: number; requireWin?: boolean }) => {
      const cmp = p.operator === '<=' ? 'em até' : 'que durem pelo menos';
      const prefix = p.requireWin ? `Vença uma batalha ${cmp} ${p.requiredTurns} turnos.` : `Participe de uma batalha ${cmp} ${p.requiredTurns} turnos.`;
      return prefix;
    },
    evaluate: (r: PvpBattleResult, p: { operator: '<=' | '>='; requiredTurns: number; requireWin?: boolean }) => {
      if (!r.valid) return { delta: 0, state: {} };
      if (p.requireWin && r.result !== 'win') return { delta: 0, state: {} };
      const ok = p.operator === '<=' ? r.turns <= p.requiredTurns : r.turns >= p.requiredTurns;
      return { delta: ok ? 1 : 0, state: {} };
    },
  } as HandlerFn<'TURNS'>,

  DIVERSE_TEAM: {
    describe: (p: { requiredUniqueElements: number }, target: number) =>
      `Vença ${plural(target, 'batalha')} usando equipes com pelo menos ${p.requiredUniqueElements} elementos diferentes.`,
    evaluate: (r: PvpBattleResult, p: { requiredUniqueElements: number }) => {
      if (!r.valid || r.result !== 'win') return { delta: 0, state: {} };
      return { delta: r.myElementsUnique >= p.requiredUniqueElements ? 1 : 0, state: {} };
    },
  } as HandlerFn<'DIVERSE_TEAM'>,

  OPPONENT_COMPOSITION: {
    describe: (p: { requiredUniqueElements?: number; requiredSameElementPair?: boolean }) => {
      if (p.requiredUniqueElements !== undefined) {
        return `Vença contra um time contendo pelo menos ${p.requiredUniqueElements} elementos diferentes.`;
      }
      if (p.requiredSameElementPair) {
        return 'Derrote uma equipe contendo pelo menos 2 Digimons do mesmo elemento.';
      }
      return 'Vença contra uma composição específica do adversário.';
    },
    evaluate: (r: PvpBattleResult, p: { requiredUniqueElements?: number; requiredSameElementPair?: boolean }) => {
      if (!r.valid || r.result !== 'win') return { delta: 0, state: {} };
      if (p.requiredUniqueElements !== undefined) return { delta: r.opponentElementsUnique >= p.requiredUniqueElements ? 1 : 0, state: {} };
      if (p.requiredSameElementPair) return { delta: r.opponentHasSameElementPair ? 1 : 0, state: {} };
      return { delta: 0, state: {} };
    },
  } as HandlerFn<'OPPONENT_COMPOSITION'>,
  BATTLE_ITEM: {
    describe: (_p: Record<string, never>, target: number, period: PvpQuestPeriod) =>
      `${cap(period.toLowerCase())}: Use ${plural(target, 'battle item')} em PvP.`,
    evaluate: (r: PvpBattleResult) => ({ delta: r.valid ? 1 : 0, state: {} }),
  } as HandlerFn<'BATTLE_ITEM'>,
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const ALL_ELEMENTS = ELEMENTS.filter((e) => e !== 'null');

export function describeQuest(t: PvpQuestTemplate): string {
  const handler = REGISTRY[t.category];
  return handler.describe(t.params as never, t.target, t.period);
}

export function evaluateCategory(
  category: PvpQuestCategory,
  result: PvpBattleResult,
  params: PvpQuestParams,
  state: Record<string, unknown>,
): { delta: number; state: Record<string, unknown> } {
  const handler = REGISTRY[category];
  return handler.evaluate(result, params as never, state);
}

/** Exposed for the generator/validation so pools of valid params can be built. */
export const ELEMENT_POOL: readonly Element[] = ALL_ELEMENTS;
