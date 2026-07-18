import type { Battle, BattleSide } from './types.js';

export const MMR_START = 1000;
export const MMR_K_FACTOR = 32;

export type SidePerf = {
  hpFractionAlive: number;
  aliveCount: number;
  downCount: number;
};

export type MmrOutcome = 'win' | 'loss' | 'draw';

export function sidePerformance(battle: Battle, side: BattleSide): SidePerf {
  const units = battle.units.filter((u) => u.side === side);
  let hpFractionAlive = 0;
  let aliveCount = 0;
  let downCount = 0;
  for (const unit of units) {
    if (unit.hp > 0) {
      aliveCount += 1;
      hpFractionAlive += unit.hp / unit.hpMax;
    } else {
      downCount += 1;
    }
  }
  return {
    hpFractionAlive: units.length > 0 ? hpFractionAlive / units.length : 0,
    aliveCount,
    downCount,
  };
}

export function outcomeForSide(battle: Battle, side: BattleSide): MmrOutcome {
  if (battle.outcome === 'draw' || battle.outcome === 'abandoned') return 'draw';
  if (battle.winner === side) return 'win';
  if (battle.winner === null) return 'draw';
  return 'loss';
}

export function expectedScore(myMmr: number, oppMmr: number): number {
  return 1 / (1 + Math.pow(10, (oppMmr - myMmr) / 400));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function winQuality(winner: SidePerf, loser: SidePerf): number {
  const hpFactor = clamp(winner.hpFractionAlive * 2, 0.5, 1.5);
  const speedFactor = 1;
  const koFactor = 1 + 0.15 * (loser.downCount - winner.downCount);
  return clamp(hpFactor * speedFactor * koFactor, 0.5, 2.5);
}

export function speedFactorForRound(round: number): number {
  return clamp(12 / Math.max(round, 3), 0.6, 1.4);
}

export type MmrDeltaInput = {
  myMmr: number;
  oppMmr: number;
  mySide: BattleSide;
  battle: Battle;
};

export function computeMmrDelta(input: MmrDeltaInput): number {
  const myOutcome = outcomeForSide(input.battle, input.mySide);
  const oppSide: BattleSide = input.mySide === 'a' ? 'b' : 'a';
  const myPerf = sidePerformance(input.battle, input.mySide);
  const oppPerf = sidePerformance(input.battle, oppSide);
  const expected = expectedScore(input.myMmr, input.oppMmr);
  const actual = myOutcome === 'win' ? 1 : myOutcome === 'draw' ? 0.5 : 0;
  const speed = speedFactorForRound(input.battle.round);

  let quality: number;
  if (myOutcome === 'win') {
    quality = winQuality(myPerf, oppPerf) * speed;
  } else if (myOutcome === 'loss') {
    quality = 1 / (winQuality(oppPerf, myPerf) * speed);
  } else {
    quality = 1;
  }

  const delta = MMR_K_FACTOR * quality * (actual - expected);
  const rounded = Math.round(delta);
  if (myOutcome === 'draw') {
    return rounded;
  }
  const minMagnitude = myOutcome === 'win' ? 1 : -1;
  if (myOutcome === 'win' && rounded < 1) return minMagnitude;
  if (myOutcome === 'loss' && rounded > -1) return minMagnitude;
  return rounded;
}
