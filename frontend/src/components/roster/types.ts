import type { CSSProperties } from 'react';

import type { Element, MoodState, Stage, StagePools, TrainingStat } from '@digiworld/shared/digimon';
import { STAGES, STAGE_COMBAT_POOL, STAGE_HPEN_POOL, combatCapFor, combatSum, hpenCapFor, hpenSum } from '@digiworld/shared/digimon';

const STAGE_STAT_TRAINING_CAP: Record<Stage, number> = {
  Baby: 200,
  'In-Training': 300,
  Rookie: 500,
  Champion: 750,
  Ultimate: 1100,
  Mega: 1500,
};

import type { RosterView } from '../../lib/api';
import type { TrainingActiveView } from '../../lib/api-roster';

export type RosterMon = RosterView;

export type ElementStyle = CSSProperties & {
  readonly '--el': string;
};

export type PercentStyle = CSSProperties & {
  readonly '--pct': string;
};

export type RosterActions = {
  readonly onPickForSlot: (slot: number) => void;
  readonly onAssign: (monId: string, slot: number) => void;
  readonly onRemoveSlot: (slot: number) => void;
  readonly onAddToParty: (mon: RosterMon) => void;
  readonly onEvolve: (monId: string) => void;
  readonly onRename: (mon: RosterMon) => void;
  readonly onRevive: (monId: string) => void;
};

export type ActivityByMon = ReadonlyMap<string, TrainingActiveView>;

export function elementStyle(element: Element | 'null' | undefined): ElementStyle {
  return { '--el': `var(--el-${element ?? 'null'})` };
}

export function percentStyle(value: number): PercentStyle {
  return { '--pct': `${Math.max(0, Math.min(100, value))}%` };
}

export function totalStats(mon: RosterMon): { readonly hp: number; readonly en: number; readonly atk: number; readonly def: number; readonly int: number; readonly spd: number } {
  const base = mon.template?.baseStats;
  return {
    hp: (base?.hp ?? 0) + mon.statBonus.hp,
    en: (base?.en ?? 0) + mon.statBonus.en,
    atk: (base?.atk ?? 0) + mon.statBonus.atk,
    def: (base?.def ?? 0) + mon.statBonus.def,
    int: (base?.int ?? 0) + mon.statBonus.int,
    spd: (base?.spd ?? 0) + mon.statBonus.spd,
  };
}

function scaleForLevel(base: number, level: number): number {
  const l = Math.max(1, Math.min(99, level));
  return Math.floor(base * (1 + 0.06 * (l - 1)));
}

export function scaledStats(mon: RosterMon): { readonly hp: number; readonly en: number; readonly atk: number; readonly def: number; readonly int: number; readonly spd: number } {
  const base = mon.template?.baseStats;
  const level = mon.level;
  return {
    hp: mon.hpMax || (scaleForLevel(base?.hp ?? 0, level) + mon.statBonus.hp),
    en: mon.enMax || (scaleForLevel(base?.en ?? 0, level) + mon.statBonus.en),
    atk: scaleForLevel(base?.atk ?? 0, level) + mon.statBonus.atk,
    def: scaleForLevel(base?.def ?? 0, level) + mon.statBonus.def,
    int: scaleForLevel(base?.int ?? 0, level) + mon.statBonus.int,
    spd: scaleForLevel(base?.spd ?? 0, level) + mon.statBonus.spd,
  };
}

export function xpPct(mon: RosterMon): number {
  const span = mon.xpNext - mon.xpFloor;
  if (span <= 0) {
    return 100;
  }
  return Math.round(((mon.xp - mon.xpFloor) / span) * 100);
}

export type PoolProgress = {
  readonly filled: number;
  readonly cap: number;
  readonly pct: number;
};

export type TrainingProgress = {
  readonly stage: Stage;
  readonly combat: PoolProgress;
  readonly hpen: PoolProgress;
  readonly overallPct: number;
};

export function trainingProgress(mon: RosterMon): TrainingProgress | null {
  const stage = mon.template?.stage;
  if (stage === undefined) return null;
  const priorPools: StagePools = (mon.stagePools ?? {}) as StagePools;
  const priorCombatCap = combatCapFor(stage, priorPools) - STAGE_COMBAT_POOL[stage];
  const priorHpenCap = hpenCapFor(stage, priorPools) - STAGE_HPEN_POOL[stage];
  const currentCombatFilled = Math.max(0, combatSum(mon.statBonus) - priorCombatCap);
  const currentHpenFilled = Math.max(0, hpenSum(mon.statBonus) - priorHpenCap);
  const combatCap = STAGE_COMBAT_POOL[stage];
  const hpenCap = STAGE_HPEN_POOL[stage];
  const combatPct = combatCap === 0 ? 0 : Math.min(100, Math.round((currentCombatFilled / combatCap) * 100));
  const hpenPct = hpenCap === 0 ? 0 : Math.min(100, Math.round((currentHpenFilled / hpenCap) * 100));
  const overallPct = combatCap + hpenCap === 0
    ? 0
    : Math.min(100, Math.round(((currentCombatFilled + currentHpenFilled) / (combatCap + hpenCap)) * 100));
  return {
    stage,
    combat: { filled: currentCombatFilled, cap: combatCap, pct: combatPct },
    hpen: { filled: currentHpenFilled, cap: hpenCap, pct: hpenPct },
    overallPct,
  };
}

export type PerStatTraining = Record<TrainingStat, PoolProgress>;

/**
 * Per-stat current-stage training progress. Each stat's `filled` is the
 * bonus trained during the CURRENT stage (subtracting an estimate of what
 * was already trained at prior stages); `cap` is the stage's per-stat
 * training ceiling from STAGE_STAT_TRAINING_CAP. Bars reset to 0 on evolve
 * and fill toward the current stage's cap independently per stat.
 *
 * Prior-stage per-stat contribution is estimated pro-rata from the mon's
 * pool history (`stagePools[stage].combat/hpen`), matching the backend's
 * `defaultMaxedPools` assumption (missing entries treated as fully spent).
 * Without per-stat historical data on the backend the estimate biases
 * conservative: the bar can lag the true current-stage progress if the
 * mon evolved before saturating prior stages' per-stat caps.
 *
 * Returns null when the mon has no template (nothing to gate stage on).
 */
export function perStatTrainingProgress(mon: RosterMon): PerStatTraining | null {
  const stage = mon.template?.stage;
  if (stage === undefined) return null;
  const priorPools: StagePools = mon.stagePools ?? {};
  const bonus = mon.statBonus;
  const currentStageCap = STAGE_STAT_TRAINING_CAP[stage];

  const share = (statKey: TrainingStat, poolKind: 'combat' | 'hpen'): PoolProgress => {
    let priorStatCap = 0;
    for (const s of STAGES) {
      if (s === stage) break;
      const alloc = priorPools[s];
      const totalPool = poolKind === 'combat' ? STAGE_COMBAT_POOL[s] : STAGE_HPEN_POOL[s];
      const spentPool = alloc ? (poolKind === 'combat' ? alloc.combat : alloc.hpen) : totalPool;
      const prop = totalPool === 0 ? 0 : Math.min(1, Math.max(0, spentPool / totalPool));
      priorStatCap += STAGE_STAT_TRAINING_CAP[s] * prop;
    }
    const rawCurrent = bonus[statKey] - priorStatCap;
    const currentStageTrained = Math.max(0, Math.min(currentStageCap, rawCurrent));
    const pct = currentStageCap === 0 ? 0 : Math.min(100, Math.round((currentStageTrained / currentStageCap) * 100));
    return { filled: Math.round(currentStageTrained), cap: currentStageCap, pct };
  };

  return {
    hp:  share('hp',  'hpen'),
    en:  share('en',  'hpen'),
    atk: share('atk', 'combat'),
    def: share('def', 'combat'),
    int: share('int', 'combat'),
    spd: share('spd', 'combat'),
  };
}

export function moodInfo(mon: RosterMon): { readonly label: string; readonly state: MoodState } {
  if (mon.mood >= 80) return { label: 'Happy', state: 'happy' };
  if (mon.mood >= 60) return { label: 'Content', state: 'content' };
  if (mon.mood >= 40) return { label: 'Neutral', state: 'neutral' };
  if (mon.mood >= 20) return { label: 'Sad', state: 'sad' };
  return { label: 'Miserable', state: 'miserable' };
}

export function isDowned(mon: RosterMon, now: number): boolean {
  return mon.reviveAt !== null && mon.reviveAt > now;
}

export function formatRemaining(reviveAt: number | null, now: number): string {
  const ms = Math.max(0, (reviveAt ?? 0) - now);
  const seconds = Math.ceil(ms / 1000);
  const minutesPart = Math.floor(seconds / 60);
  const secondsPart = seconds % 60;
  return `${minutesPart}:${secondsPart.toString().padStart(2, '0')}`;
}
