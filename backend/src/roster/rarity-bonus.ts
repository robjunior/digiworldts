/**
 * Rarity evolution bonuses — F7 of the dungeon extraction refactor.
 *
 * When a Digimon evolves using a rarity-tagged Cypher (evolution_key from F6),
 * the consumed item's rarity grants a permanent stat bonus per this curve:
 *
 *   Common     (0): +0 hp,  +0 en,  +0 atk, +0 def, +0 int, +0 spd (no change)
 *   Uncommon   (1): +5 hp,  +5 en,  +2 atk, +2 def, +2 int, +2 spd
 *   Rare       (2): +15 hp, +10 en, +5 atk, +5 def, +5 int, +5 spd
 *   Epic       (3): +30 hp, +20 en, +10 atk, +10 def, +10 int, +10 spd
 *   Legendary  (4): +50 hp, +30 en, +15 atk, +15 def, +15 int, +15 spd
 *
 * The player_roster hp_bonus / en_bonus / atk_bonus / def_bonus / int_bonus /
 * spd_bonus columns absorb these deltas directly. freezeCurrentStagePool in
 * evolve.ts already interprets those columns as the current-stage allocation,
 * so a rarity bonus applied at Champion evolution will roll into the frozen
 * Champion pool at the next evolution. This is intentional: the bonus persists
 * across future evolutions rather than being erased when the mon evolves again.
 *
 * Feature-flagged: `flag:rarity-bonuses` OFF (or item not carrying a rarity)
 * short-circuits every path here to a no-op, matching pre-F1 behavior.
 */
import type { DbExecutor } from '../db/executor.js';
import { execRun } from '../db/executor.js';
import { RARITY_BY_RANK, type Rarity } from '@digiworld/shared/item-rarity';

export type StatBonusCurve = {
  readonly hp: number;
  readonly en: number;
  readonly atk: number;
  readonly def: number;
  readonly int: number;
  readonly spd: number;
};

const CURVE: Record<Rarity, StatBonusCurve> = {
  common:    { hp: 0,  en: 0,  atk: 0,  def: 0,  int: 0,  spd: 0 },
  uncommon:  { hp: 5,  en: 5,  atk: 2,  def: 2,  int: 2,  spd: 2 },
  rare:      { hp: 15, en: 10, atk: 5,  def: 5,  int: 5,  spd: 5 },
  epic:      { hp: 30, en: 20, atk: 10, def: 10, int: 10, spd: 10 },
  legendary: { hp: 50, en: 30, atk: 15, def: 15, int: 15, spd: 15 },
};

export function bonusCurveFor(rarity: Rarity): StatBonusCurve {
  return CURVE[rarity];
}

export function bonusCurveForRank(rank: number): StatBonusCurve | null {
  const rarity = RARITY_BY_RANK[rank];
  return rarity ? CURVE[rarity] : null;
}

const SQL_APPLY_BONUS = `UPDATE player_roster SET hp_bonus = hp_bonus + ?, en_bonus = en_bonus + ?, atk_bonus = atk_bonus + ?, def_bonus = def_bonus + ?, int_bonus = int_bonus + ?, spd_bonus = spd_bonus + ?, updated_at = ? WHERE id = ? AND user_id = ?`;

export async function applyRarityEvolutionBonus(
  monId: string,
  userId: string,
  rarity: Rarity,
  now: number,
  ex?: DbExecutor,
): Promise<StatBonusCurve> {
  const curve = CURVE[rarity];
  if (curve.hp === 0 && curve.en === 0 && curve.atk === 0 && curve.def === 0 && curve.int === 0 && curve.spd === 0) {
    return curve;
  }
  await execRun(ex, SQL_APPLY_BONUS, [curve.hp, curve.en, curve.atk, curve.def, curve.int, curve.spd, now, monId, userId]);
  return curve;
}
