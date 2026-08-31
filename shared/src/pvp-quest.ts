import type { Ailment, Element } from './digimon.js';

export type { Ailment, Element };


/**
 * Procedural PvP quest system — shared data contracts.
 *
 * The design goal is a SMALL set of typed rules that generate a LARGE number
 * of quests. A quest is never stored as free text: it is a (category, params,
 * target, period, reward) tuple, and the displayed text is *derived* from that
 * tuple. Adding a new category means adding an entry to the backend category
 * registry — no storage, route, or generator changes required.
 *
 * Progress is fed only from authoritative server battle state (see
 * `PvpBattleResult`), never from client-sent events.
 */

export type PvpQuestPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export const PVP_QUEST_PERIODS: readonly PvpQuestPeriod[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

/**
 * Every quest category the system understands. Extend this union and register a
 * handler in the backend category registry (`pvp-quests/registry.ts`) to add a
 * new kind of quest. All other layers (storage, generator, routes, evaluator)
 * are data-driven over this union.
 */
export type PvpQuestCategory =
  | 'VICTORY'
  | 'WIN_STREAK'
  | 'BATTLE_COUNT'
  | 'KILLS'
  | 'ELEMENT_KILLS'
  | 'UNIQUE_ELEMENTS'
  | 'SUPER_EFFECTIVE'
  | 'DISADVANTAGE'
  | 'TEAM_SURVIVAL'
  | 'PERFECT_WIN'
  | 'COMEBACK'
  | 'DAMAGE'
  | 'CRITICAL'
  | 'STATUS'
  | 'DEBUFF'
  | 'TURNS'
  | 'DIVERSE_TEAM'
  | 'OPPONENT_COMPOSITION';

export const PVP_QUEST_CATEGORIES: readonly PvpQuestCategory[] = [
  'VICTORY',
  'WIN_STREAK',
  'BATTLE_COUNT',
  'KILLS',
  'ELEMENT_KILLS',
  'UNIQUE_ELEMENTS',
  'SUPER_EFFECTIVE',
  'DISADVANTAGE',
  'TEAM_SURVIVAL',
  'PERFECT_WIN',
  'COMEBACK',
  'DAMAGE',
  'CRITICAL',
  'STATUS',
  'DEBUFF',
  'TURNS',
  'DIVERSE_TEAM',
  'OPPONENT_COMPOSITION',
];

/**
 * Per-category *qualifier* parameters. The numeric "required N" is deliberately
 * NOT here — it lives in the separate `target` field so the same category can
 * be reused at any magnitude. This matches the spec's data model:
 *   { category: 'ELEMENT_KILLS', parameters: { element: 'FIRE' }, target: 10 }
 */
export interface PvpQuestParamsMap {
  VICTORY: Record<string, never>;
  WIN_STREAK: Record<string, never>;
  BATTLE_COUNT: Record<string, never>;
  KILLS: Record<string, never>;
  ELEMENT_KILLS: { element: Element };
  UNIQUE_ELEMENTS: Record<string, never>;
  SUPER_EFFECTIVE: Record<string, never>;
  DISADVANTAGE: { mode: 'kill' | 'victory' };
  TEAM_SURVIVAL: { minimumSurvivors?: number; maximumSurvivors?: number };
  PERFECT_WIN: Record<string, never>;
  COMEBACK: Record<string, never>;
  DAMAGE: Record<string, never>;
  CRITICAL: Record<string, never>;
  STATUS: { statusType?: Ailment };
  DEBUFF: { debuffType?: Ailment };
  TURNS: { operator: '<=' | '>='; requiredTurns: number; requireWin?: boolean };
  DIVERSE_TEAM: { requiredUniqueElements: number };
  OPPONENT_COMPOSITION: { requiredUniqueElements?: number; requiredSameElementPair?: boolean };
}

export type PvpQuestParams = {
  [K in PvpQuestCategory]: PvpQuestParamsMap[K];
}[PvpQuestCategory];

/**
 * Decoupled reward declaration. The quest only *declares* what is awarded; the
 * single claim handler in `pvp-quests/repo.ts` is the only place that knows how
 * to grant each kind. New reward kinds are added there without touching quests.
 */
export type PvpQuestReward =
  | { kind: 'netcore'; amount: number }
  | { kind: 'credits'; amount: number }
  | { kind: 'item'; itemId: string; qty: number }
  | { kind: 'pvp_points'; amount: number }
  | { kind: 'xp'; amount: number }
  | { kind: 'cosmetic'; cosmeticId: string };

/**
 * A single generated quest definition. Persisted as one row on the period board.
 * `title` is derived on read from (category, params, target, period).
 */
export interface PvpQuestTemplate {
  instanceId: string;
  period: PvpQuestPeriod;
  category: PvpQuestCategory;
  params: PvpQuestParams;
  target: number;
  reward: PvpQuestReward;
}

/** Per-user progress for one board quest instance. */
export interface PvpQuestAssignment {
  userId: string;
  instanceId: string;
  progress: number;
  /** Free-form per-quest accumulator (e.g. the set of distinct elements killed). */
  state: Record<string, unknown>;
  completedAt: number | null;
  claimedAt: number | null;
  createdAt: number;
}

export type PvpQuestState = 'active' | 'completed' | 'claimed';

export interface PvpQuestWithProgress {
  instanceId: string;
  period: PvpQuestPeriod;
  category: PvpQuestCategory;
  params: PvpQuestParams;
  target: number;
  reward: PvpQuestReward;
  title: string;
  progress: number;
  state: PvpQuestState;
  completedAt: number | null;
  claimedAt: number | null;
}

/**
 * Authoritative, server-derived summary of one player's participation in a PvP
 * battle. The evaluator consumes this; it is NEVER constructed from client
 * input. `valid: false` means the battle must not grant any quest progress
 * (draw / abandon / surrender / disconnect / cancel / bot / friendly).
 */
export interface PvpBattleResult {
  battleId: string;
  userId: string;
  opponentId: string;
  result: 'win' | 'loss' | 'draw';
  valid: boolean;
  cause:
    | 'valid'
    | 'draw'
    | 'abandon'
    | 'surrender'
    | 'disconnect'
    | 'cancelled'
    | 'bot'
    | 'friendly';
  turns: number;
  durationMs: number;
  kills: number;
  survivors: number;
  damageDealt: number;
  criticalHits: number;
  statusApplications: number;
  statusByType?: Partial<Record<Ailment, number>>;
  debuffApplications: number;
  debuffByType?: Partial<Record<Ailment, number>>;
  myElementsUnique: number;
  opponentElementsUnique: number;
  opponentHasSameElementPair: boolean;
  elementKills: Partial<Record<Element, number>>;
  uniqueElementsKilled: number;
  superEffectiveKills: number;
  disadvantagedKills: number;
  disadvantagedWin: boolean;
  comeback: boolean;
}

/** Ailments treated as debuffs (vs. control effects) for the DEBUFF category. */
export const DEBUFF_AILMENTS: readonly Ailment[] = [
  'burn',
  'poison',
  'weaken',
  'blind',
  'silence',
  'root',
  'curse',
  'corruption',
];
