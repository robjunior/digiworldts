/**
 * Pending buffs — shop item effects that haven't been applied to combat yet.
 *
 * Item → `POST /api/shop/apply` → row in `pending_buffs` → consumed at:
 *   - hp_pct / en_pct    → START of the next battle (per targeted mon)
 *   - xp_mult            → END of the next won match (player-wide, all rewards)
 *
 * Every insert is auditable via `source_item`; consumed rows are kept (never
 * hard-deleted) so admins can trace what got applied and when.
 *
 * Async by construction — routes through the DbAdapter (SQLite or Postgres).
 */
import { q, run, tx, type PendingBuffRow } from '../db/index.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';

export type BuffKind = 'hp_pct' | 'en_pct' | 'xp_mult';

export type PendingBuff = {
  id: string;
  userId: string;
  monId: string | null;
  effectKind: BuffKind;
  magnitude: number;
  sourceItem: string | null;
  createdAt: number;
};

const SQL_INSERT = `INSERT INTO pending_buffs (id, user_id, mon_id, effect_kind, magnitude, source_item, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`;
const SQL_ACTIVE_FOR_USER = `SELECT * FROM pending_buffs WHERE user_id = ? AND consumed_at IS NULL ORDER BY created_at`;
const SQL_ACTIVE_FOR_MON = `SELECT * FROM pending_buffs WHERE user_id = ? AND mon_id = ? AND effect_kind IN ('hp_pct','en_pct') AND consumed_at IS NULL ORDER BY created_at`;
const SQL_ACTIVE_XP_MULT = `SELECT * FROM pending_buffs WHERE user_id = ? AND mon_id IS NULL AND effect_kind = 'xp_mult' AND consumed_at IS NULL ORDER BY created_at`;
const SQL_MARK_CONSUMED = `UPDATE pending_buffs SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`;

function toBuff(r: PendingBuffRow): PendingBuff {
  return {
    id: r.id,
    userId: r.user_id,
    monId: r.mon_id,
    effectKind: r.effect_kind,
    magnitude: r.magnitude,
    sourceItem: r.source_item,
    createdAt: r.created_at,
  };
}

export async function addPendingBuff(input: {
  userId: string;
  monId?: string | null;
  effectKind: BuffKind;
  magnitude: number;
  sourceItem?: string | null;
}): Promise<string> {
  const id = newId('buf');
  await run(
    SQL_INSERT,
    id,
    input.userId,
    input.monId ?? null,
    input.effectKind,
    input.magnitude,
    input.sourceItem ?? null,
    Date.now(),
  );
  log.info('buffs.add', { id, userId: input.userId, kind: input.effectKind, monId: input.monId ?? null });
  return id;
}

export async function activeBuffsForUser(userId: string): Promise<PendingBuff[]> {
  const rows = await q<PendingBuffRow>(SQL_ACTIVE_FOR_USER, userId);
  return rows.map(toBuff);
}

/**
 * Consume every mon-targeted buff (hp_pct, en_pct) for one Digimon.
 * Atomic — the SELECT + UPDATEs run in a single transaction so we can't
 * lose a race with a parallel apply from another node.
 */
export async function consumePreBattleBuffs(userId: string, monId: string): Promise<PendingBuff[]> {
  return tx(async (t) => {
    const rows = await t.query<PendingBuffRow>(SQL_ACTIVE_FOR_MON, [userId, monId]);
    if (rows.length === 0) return [];
    const now = Date.now();
    for (const r of rows) await t.run(SQL_MARK_CONSUMED, [now, r.id]);
    log.info('buffs.consume.pre-battle', { userId, monId, count: rows.length });
    return rows.map(toBuff);
  });
}

/**
 * Consume every player-wide xp_mult buff. Called after a match win.
 * Returns the multipliers for the reward calc; the strongest wins (max).
 */
export async function consumeXpMultBuffs(userId: string): Promise<PendingBuff[]> {
  return tx(async (t) => {
    const rows = await t.query<PendingBuffRow>(SQL_ACTIVE_XP_MULT, [userId]);
    if (rows.length === 0) return [];
    const now = Date.now();
    for (const r of rows) await t.run(SQL_MARK_CONSUMED, [now, r.id]);
    log.info('buffs.consume.xp-mult', { userId, count: rows.length });
    return rows.map(toBuff);
  });
}

/** Aggregate xp multiplier from a list of xp_mult buffs. Highest wins (no stacking). */
export function xpMultOf(buffs: PendingBuff[]): number {
  let m = 1;
  for (const b of buffs) if (b.effectKind === 'xp_mult' && b.magnitude > m) m = b.magnitude;
  return m;
}
