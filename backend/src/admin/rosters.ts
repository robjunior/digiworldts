/**
 * Player roster admin: read/edit/spawn/delete individual mons.
 *
 *   Backing table: `player_roster`. Every field the schema stores is exposed
 *   via `updateRoster()` — nickname, level, xp, all 6 stat bonuses (hp/en/atk/
 *   def/int/spd), mood, status ('resting'|'training'|'party'), slot_index.
 *
 *   Party slot writes go through a lightweight transaction that first frees
 *   any pre-existing occupant of the same (user_id, slot_index) so the
 *   UNIQUE constraint never fires.
 *
 *   Spawn validates catalog_id against the loaded XML catalog — the schema
 *   has no FK on catalog_id, so orphans are our problem to prevent.
 */
import { loadCatalog } from '../digimon/xml.js';
import { one, q, run, tx, type RosterRow, type UserRow } from '../db/index.js';
import { getDefaultEquippedForStage } from '../skills/pool.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';

const SQL_SELECT_BY_USER = `SELECT * FROM player_roster WHERE user_id = ? ORDER BY created_at`;
const SQL_SELECT_BY_ID = `SELECT * FROM player_roster WHERE id = ?`;
const SQL_SELECT_USER = `SELECT * FROM users WHERE id = ?`;
const SQL_INSERT = `
  INSERT INTO player_roster
      (id, user_id, catalog_id, nickname,
       level, xp,
       hp_bonus, en_bonus, atk_bonus, def_bonus, int_bonus, spd_bonus,
       mood, status, slot_index, equipped_skill_ids,
       created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const SQL_UPDATE = `
  UPDATE player_roster
     SET nickname = ?, level = ?, xp = ?,
         hp_bonus = ?, en_bonus = ?, atk_bonus = ?, def_bonus = ?, int_bonus = ?, spd_bonus = ?,
         mood = ?, status = ?, slot_index = ?,
         updated_at = ?
   WHERE id = ?
`;
const SQL_CLEAR_SLOT = `
  UPDATE player_roster
     SET status = 'resting', slot_index = NULL, updated_at = ?
   WHERE user_id = ? AND slot_index = ? AND id != ?
`;
const SQL_DELETE = `DELETE FROM player_roster WHERE id = ?`;

export type AdminStatBonus = { hp: number; en: number; atk: number; def: number; int: number; spd: number };

export type AdminRosterView = {
  id: string;
  userId: string;
  ownerUsername: string | null;
  catalogId: string;
  catalogName: string | null;
  catalogStage: string | null;
  catalogPortrait: string | null;
  nickname: string;
  level: number;
  xp: number;
  statBonus: AdminStatBonus;
  mood: number;
  status: 'resting' | 'training' | 'party' | 'adventure';
  slot: number | null;
  createdAt: number;
  updatedAt: number;
};

export type RosterInput = {
  nickname?: string | undefined;
  level?: number | undefined;
  xp?: number | undefined;
  statBonus?: Partial<AdminStatBonus> | undefined;
  mood?: number | undefined;
  status?: 'resting' | 'training' | 'party' | undefined;
  slot?: number | null | undefined;
};

export type SpawnInput = {
  userId: string;
  catalogId: string;
  nickname?: string | undefined;
  level?: number | undefined;
};

export type RosterError =
  | 'not-found'
  | 'user-not-found'
  | 'catalog-not-found'
  | 'invalid-input'
  | 'invalid-status'
  | 'invalid-slot';

export type RosterOutcome<T> = { ok: true; mon: T } | { ok: false; error: RosterError; message?: string };

// ============================================================================
// Enrichment
// ============================================================================

type CatalogMeta = {
  nameById: Map<string, string>;
  stageById: Map<string, string>;
  portraitById: Map<string, string>;
};

function loadCatalogMeta(): CatalogMeta {
  const catalog = loadCatalog();
  const nameById = new Map<string, string>();
  const stageById = new Map<string, string>();
  const portraitById = new Map<string, string>();
  for (const t of catalog.digimons) {
    nameById.set(t.id, t.name);
    stageById.set(t.id, t.stage);
    portraitById.set(t.id, t.assets.portrait);
  }
  return { nameById, stageById, portraitById };
}

function rowToView(row: RosterRow, ownerUsername: string | null, meta: CatalogMeta): AdminRosterView {
  return {
    id: row.id,
    userId: row.user_id,
    ownerUsername,
    catalogId: row.catalog_id,
    catalogName: meta.nameById.get(row.catalog_id) ?? null,
    catalogStage: meta.stageById.get(row.catalog_id) ?? null,
    catalogPortrait: meta.portraitById.get(row.catalog_id) ?? null,
    nickname: row.nickname,
    level: row.level,
    xp: row.xp,
    statBonus: {
      hp: row.hp_bonus,
      en: row.en_bonus,
      atk: row.atk_bonus,
      def: row.def_bonus,
      int: row.int_bonus,
      spd: row.spd_bonus,
    },
    mood: row.mood,
    status: row.status,
    slot: row.slot_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// Reads
// ============================================================================

export async function listRosterForUser(userId: string): Promise<AdminRosterView[]> {
  const user = await one<UserRow>(SQL_SELECT_USER, userId);
  if (!user) return [];
  const rows = await q<RosterRow>(SQL_SELECT_BY_USER, userId);
  const meta = loadCatalogMeta();
  return rows.map((r) => rowToView(r, user.username, meta));
}

export async function getRoster(monId: string): Promise<AdminRosterView | null> {
  const row = await one<RosterRow>(SQL_SELECT_BY_ID, monId);
  if (!row) return null;
  const owner = await one<UserRow>(SQL_SELECT_USER, row.user_id);
  const meta = loadCatalogMeta();
  return rowToView(row, owner?.username ?? null, meta);
}

// ============================================================================
// Validation
// ============================================================================

function clampBonus(v: number | undefined, existing: number): number {
  if (v == null || typeof v !== 'number' || !Number.isFinite(v)) return existing;
  return Math.max(-9999, Math.min(9999, Math.floor(v)));
}

function validateSlot(slot: number | null | undefined, status: 'resting' | 'training' | 'party' | 'adventure'): RosterError | null {
  if (status === 'party') {
    if (slot == null) return 'invalid-slot';
    if (!Number.isInteger(slot) || slot < 0 || slot > 2) return 'invalid-slot';
  } else if (slot != null) {
    return 'invalid-slot';
  }
  return null;
}

// ============================================================================
// Update
// ============================================================================

export async function updateRoster(monId: string, input: RosterInput): Promise<RosterOutcome<AdminRosterView>> {
  const existing = await one<RosterRow>(SQL_SELECT_BY_ID, monId);
  if (!existing) return { ok: false, error: 'not-found' };

  const nickname = input.nickname?.trim() || existing.nickname;
  if (nickname.length < 1 || nickname.length > 32) return { ok: false, error: 'invalid-input', message: 'nickname 1-32 chars' };

  const level = input.level != null ? Math.max(1, Math.min(999, Math.floor(input.level))) : existing.level;
  const xp = input.xp != null ? Math.max(0, Math.floor(input.xp)) : existing.xp;
  const mood = input.mood != null ? Math.max(0, Math.min(100, Math.floor(input.mood))) : existing.mood;

  const status = input.status ?? existing.status;
  if (!['resting', 'training', 'party'].includes(status)) return { ok: false, error: 'invalid-status' };

  // Determine desired slot. If status changed to non-party, clear slot.
  const desiredSlot = status === 'party'
    ? (input.slot !== undefined ? input.slot : existing.slot_index)
    : null;

  const slotErr = validateSlot(desiredSlot, status);
  if (slotErr) return { ok: false, error: slotErr };

  const sb = input.statBonus ?? {};
  const hp = clampBonus(sb.hp, existing.hp_bonus);
  const en = clampBonus(sb.en, existing.en_bonus);
  const atk = clampBonus(sb.atk, existing.atk_bonus);
  const def = clampBonus(sb.def, existing.def_bonus);
  const intB = clampBonus(sb.int, existing.int_bonus);
  const spd = clampBonus(sb.spd, existing.spd_bonus);

  const now = Date.now();

  // If assigning to a party slot, first free that slot on any other mon owned by the same user.
  await tx(async (t) => {
    if (status === 'party' && desiredSlot != null) {
      await t.run(SQL_CLEAR_SLOT, [now, existing.user_id, desiredSlot, monId]);
    }
    await t.run(SQL_UPDATE, [
      nickname, level, xp,
      hp, en, atk, def, intB, spd,
      mood, status, desiredSlot,
      now, monId,
    ]);
  });

  log.info('admin.roster.update', { monId, nickname, status, slot: desiredSlot });
  const detail = await getRoster(monId);
  if (!detail) return { ok: false, error: 'not-found' };
  return { ok: true, mon: detail };
}

// ============================================================================
// Spawn
// ============================================================================

export async function spawnRoster(input: SpawnInput): Promise<RosterOutcome<AdminRosterView>> {
  const user = await one<UserRow>(SQL_SELECT_USER, input.userId);
  if (!user) return { ok: false, error: 'user-not-found' };

  const meta = loadCatalogMeta();
  const catalogName = meta.nameById.get(input.catalogId);
  if (!catalogName) return { ok: false, error: 'catalog-not-found' };
  const catalog = loadCatalog();
  const tpl = catalog.digimons.find((t) => t.id === input.catalogId);
  if (!tpl) return { ok: false, error: 'catalog-not-found' };

  const nickname = (input.nickname?.trim() || catalogName).slice(0, 32);
  const level = input.level != null ? Math.max(1, Math.min(999, Math.floor(input.level))) : 5;
  const now = Date.now();
  const id = newId('mon');
  const equippedJson = JSON.stringify(await getDefaultEquippedForStage(tpl.element, tpl.stage));

  await run(SQL_INSERT, [
    id, input.userId, input.catalogId, nickname,
    level, 0,
    0, 0, 0, 0, 0, 0,   // 6 bonuses default 0
    50, 'resting', null, equippedJson, // mood 50, resting, no slot, catalog defaults
    now, now,
  ]);

  log.info('admin.roster.spawn', { monId: id, userId: input.userId, catalogId: input.catalogId, nickname });

  const detail = await getRoster(id);
  if (!detail) return { ok: false, error: 'not-found' };
  return { ok: true, mon: detail };
}

// ============================================================================
// Delete
// ============================================================================

export async function deleteRoster(monId: string): Promise<RosterOutcome<{ id: string }>> {
  const existing = await one<RosterRow>(SQL_SELECT_BY_ID, monId);
  if (!existing) return { ok: false, error: 'not-found' };
  await run(SQL_DELETE, monId);
  log.info('admin.roster.delete', { monId, catalogId: existing.catalog_id });
  return { ok: true, mon: { id: monId } };
}
