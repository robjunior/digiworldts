import { one, run, type GameSettingsRow } from '../db/index.js';
import { log } from '../util/log.js';

const SQL_GET_SETTINGS = `SELECT * FROM game_settings WHERE id = 1`;
const SQL_UPSERT_SETTINGS = `
  INSERT INTO game_settings (id, xp_rate, updated_at)
       VALUES (1, ?, ?)
    ON CONFLICT (id) DO UPDATE
       SET xp_rate    = excluded.xp_rate,
           updated_at = excluded.updated_at
`;

export const DEFAULT_XP_RATE = 1.0;
export const MIN_XP_RATE = 0.1;
export const MAX_XP_RATE = 10.0;

export type GameSettingsView = {
  readonly xpRate: number;
  readonly updatedAt: number;
};

export type SettingsOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: 'invalid-input'; readonly message: string };

function rowToView(row: GameSettingsRow | null): GameSettingsView {
  if (row === null) {
    return { xpRate: DEFAULT_XP_RATE, updatedAt: 0 };
  }
  const rate = Number(row.xp_rate);
  return {
    xpRate: Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_XP_RATE,
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

export async function updateGameSettings(input: { xpRate: number }): Promise<SettingsOutcome<GameSettingsView>> {
  const xpRate = Number(input.xpRate);
  if (!Number.isFinite(xpRate)) {
    return { ok: false, error: 'invalid-input', message: 'xpRate must be a finite number' };
  }
  if (xpRate < MIN_XP_RATE || xpRate > MAX_XP_RATE) {
    return {
      ok: false,
      error: 'invalid-input',
      message: `xpRate must be between ${MIN_XP_RATE} and ${MAX_XP_RATE}`,
    };
  }
  const rounded = Math.round(xpRate * 100) / 100;
  const now = Date.now();
  await run(SQL_UPSERT_SETTINGS, [rounded, now]);
  log.info('game.settings.update', { xpRate: rounded });
  return { ok: true, value: await getGameSettings() };
}

export async function seedDefaultGameSettings(): Promise<{ seeded: boolean }> {
  const existing = await one<GameSettingsRow>(SQL_GET_SETTINGS);
  if (existing !== null) return { seeded: false };
  await run(SQL_UPSERT_SETTINGS, [DEFAULT_XP_RATE, Date.now()]);
  return { seeded: true };
}
