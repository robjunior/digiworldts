import type { CSSProperties } from 'react';

import type { Element, MoodState, Stage, StagePools } from '@digiworld/shared/digimon';
import { STAGE_COMBAT_POOL, STAGE_HPEN_POOL, combatCapFor, combatSum, hpenCapFor, hpenSum } from '@digiworld/shared/digimon';

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

export const STAT_MAX: Record<'hp' | 'en' | 'atk' | 'def' | 'int' | 'spd', number> = {
  hp: 1400, en: 41, atk: 260, def: 200, int: 160, spd: 160,
};

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
