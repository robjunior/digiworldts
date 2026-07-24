import { one, run, type GameSettingsRow } from '../db/index.js';
import { log } from '../util/log.js';

const SQL_GET_SETTINGS = `SELECT * FROM game_settings WHERE id = 1`;
const SQL_UPSERT_SETTINGS = `
  INSERT INTO game_settings (id, xp_rate, damage_rate, updated_at)
       VALUES (1, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE
       SET xp_rate     = excluded.xp_rate,
           damage_rate = excluded.damage_rate,
           updated_at  = excluded.updated_at
`;

export const DEFAULT_XP_RATE = 1.0;
export const MIN_XP_RATE = 0.1;
export const MAX_XP_RATE = 10.0;

export const DEFAULT_DAMAGE_RATE = 1.0;
export const MIN_DAMAGE_RATE = 0.25;
export const MAX_DAMAGE_RATE = 5.0;

export type GameSettingsView = {
  readonly xpRate: number;
  readonly damageRate: number;
  readonly updatedAt: number;
};

export type SettingsOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: 'invalid-input'; readonly message: string };

function rowToView(row: GameSettingsRow | null): GameSettingsView {
  if (row === null) {
    return { xpRate: DEFAULT_XP_RATE, damageRate: DEFAULT_DAMAGE_RATE, updatedAt: 0 };
  }
  const xp = Number(row.xp_rate);
  const dmg = Number(row.damage_rate);
  return {
    xpRate: Number.isFinite(xp) && xp > 0 ? xp : DEFAULT_XP_RATE,
    damageRate: Number.isFinite(dmg) && dmg > 0 ? dmg : DEFAULT_DAMAGE_RATE,
    updatedAt: row.updated_at,
  };
}

export async function getGameSettings(): Promise<GameSettingsView> {
  const row = await one<GameSettingsRow>(SQL_GET_SETTINGS);
  return rowToView(row);
}

export async function getXpRate(): Promise<number> {
  const view = await getGameSettings();
  return view.xpRate;
}

export async function getDamageRate(): Promise<number> {
  const view = await getGameSettings();
  return view.damageRate;
}

export async function updateGameSettings(
  input: { xpRate?: number; damageRate?: number },
): Promise<SettingsOutcome<GameSettingsView>> {
  const current = await getGameSettings();
  const nextXpRate = input.xpRate !== undefined ? Number(input.xpRate) : current.xpRate;
  const nextDamageRate = input.damageRate !== undefined ? Number(input.damageRate) : current.damageRate;

  if (!Number.isFinite(nextXpRate)) {
    return { ok: false, error: 'invalid-input', message: 'xpRate must be a finite number' };
  }
  if (nextXpRate < MIN_XP_RATE || nextXpRate > MAX_XP_RATE) {
    return { ok: false, error: 'invalid-input', message: `xpRate must be between ${MIN_XP_RATE} and ${MAX_XP_RATE}` };
  }
  if (!Number.isFinite(nextDamageRate)) {
    return { ok: false, error: 'invalid-input', message: 'damageRate must be a finite number' };
  }
  if (nextDamageRate < MIN_DAMAGE_RATE || nextDamageRate > MAX_DAMAGE_RATE) {
    return { ok: false, error: 'invalid-input', message: `damageRate must be between ${MIN_DAMAGE_RATE} and ${MAX_DAMAGE_RATE}` };
  }

  const roundedXp = Math.round(nextXpRate * 100) / 100;
  const roundedDmg = Math.round(nextDamageRate * 100) / 100;
  const now = Date.now();
  await run(SQL_UPSERT_SETTINGS, [roundedXp, roundedDmg, now]);
  log.info('game.settings.update', { xpRate: roundedXp, damageRate: roundedDmg });
  return { ok: true, value: await getGameSettings() };
}

export async function seedDefaultGameSettings(): Promise<{ seeded: boolean }> {
  const existing = await one<GameSettingsRow>(SQL_GET_SETTINGS);
  if (existing !== null) return { seeded: false };
  await run(SQL_UPSERT_SETTINGS, [DEFAULT_XP_RATE, DEFAULT_DAMAGE_RATE, Date.now()]);
  return { seeded: true };
}
