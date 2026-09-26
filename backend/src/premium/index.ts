/**
 * Premium membership — server-authoritative status + bonus multipliers.
 *
 * Premium status lives in `player_wallet.premium_until` (ms epoch or NULL).
 * A player is premium while `premium_until > now`. Premium grants a flat +50%
 * boost to every economy gain: farm resource production, adventure loot + XP,
 * battle (PVE) XP, and quest rewards.
 *
 * All multipliers live here so the +50% is a single tunable constant. When a
 * gain is boosted the server must also surface it to the client so the UI can
 * render the bonus in gold (base + "+50%" premium) — see each engine's view.
 */
import { one } from '../db/index.js';

const SQL_SELECT_PREMIUM = `SELECT premium_until FROM player_wallet WHERE user_id = ?`;

/** The flat bonus applied to all premium-boosted gains. */
export const PREMIUM_BONUS = 0.5;

/** True if the user is premium at `now`. */
export async function isUserPremium(userId: string, now: number = Date.now()): Promise<boolean> {
  const row = await one<{ premium_until: number | null }>(SQL_SELECT_PREMIUM, userId);
  return (row?.premium_until ?? 0) > now;
}

/** Return 1.5 when premium, 1.0 otherwise. */
export function premiumMult(active: boolean): number {
  return active ? 1 + PREMIUM_BONUS : 1;
}

/**
 * Apply the premium multiplier to an integer gain. Rounds to nearest whole unit;
 * a premium player always gains strictly more than the base while non-premium
 * passes the value through untouched (mult === 1 → identity).
 */
export function applyPremiumBonus(value: number, active: boolean): number {
  const mult = premiumMult(active);
  if (mult === 1) return value;
  return Math.max(0, Math.round(value * mult));
}