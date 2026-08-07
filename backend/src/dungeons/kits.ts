import { one, q, run, tx, type DungeonKitRow, type DungeonKitItemRow } from '../db/index.js';
import type { DbExecutor } from '../db/executor.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';
import type { Kit, KitError, KitInput, KitItem } from '@digiworld/shared/dungeon';

const MAX_KIT_ITEMS = 20;
const NAME_MIN = 1;
const NAME_MAX = 64;

const SQL_LIST_BY_USER = `SELECT * FROM dungeon_kits WHERE user_id = ? ORDER BY updated_at DESC`;
const SQL_SELECT_BY_ID = `SELECT * FROM dungeon_kits WHERE id = ? AND user_id = ?`;
const SQL_SELECT_BY_NAME = `SELECT * FROM dungeon_kits WHERE user_id = ? AND name = ?`;
const SQL_INSERT_KIT = `INSERT INTO dungeon_kits (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`;
const SQL_UPDATE_KIT = `UPDATE dungeon_kits SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`;
const SQL_DELETE_KIT = `DELETE FROM dungeon_kits WHERE id = ? AND user_id = ?`;
const SQL_LIST_ITEMS = `SELECT * FROM dungeon_kit_items WHERE kit_id = ? ORDER BY slot_order ASC, item_id ASC`;
const SQL_INSERT_KIT_ITEM = `INSERT INTO dungeon_kit_items (kit_id, item_id, qty, slot_order) VALUES (?, ?, ?, ?)`;
const SQL_DELETE_KIT_ITEMS = `DELETE FROM dungeon_kit_items WHERE kit_id = ?`;

function buildListItemsSqlForKits(kitIds: readonly string[]): string {
  const placeholders = kitIds.map(() => '?').join(', ');
  return `SELECT * FROM dungeon_kit_items WHERE kit_id IN (${placeholders}) ORDER BY slot_order ASC, item_id ASC`;
}

export type KitOutcome<T> =
  | { ok: true; kit: T }
  | { ok: false; error: KitError };

function validateInput(input: KitInput): KitError | null {
  const name = input.name?.trim();
  if (!name || name.length < NAME_MIN || name.length > NAME_MAX) return 'invalid-name';
  if (!Array.isArray(input.items) || input.items.length > MAX_KIT_ITEMS) return 'invalid-items';
  const seen = new Set<string>();
  for (const it of input.items) {
    if (typeof it.itemId !== 'string' || it.itemId.length === 0) return 'invalid-items';
    if (typeof it.qty !== 'number' || it.qty < 1 || !Number.isSafeInteger(it.qty)) return 'invalid-items';
    if (typeof it.slotOrder !== 'number' || !Number.isSafeInteger(it.slotOrder)) return 'invalid-items';
    if (seen.has(it.itemId)) return 'duplicate-item';
    seen.add(it.itemId);
  }
  return null;
}

function rowToKit(row: DungeonKitRow, items: readonly KitItem[]): Kit {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    items,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function itemRowsToKitItems(rows: readonly DungeonKitItemRow[]): KitItem[] {
  return rows.map((r) => ({ itemId: r.item_id, qty: r.qty, slotOrder: r.slot_order }));
}

export async function listKitsForUser(userId: string): Promise<Kit[]> {
  const rows = await q<DungeonKitRow>(SQL_LIST_BY_USER, userId);
  if (rows.length === 0) return [];
  const sql = buildListItemsSqlForKits(rows.map((r) => r.id));
  const itemRows = await q<DungeonKitItemRow>(sql, ...rows.map((r) => r.id));
  const byKit = new Map<string, KitItem[]>();
  for (const r of itemRows) {
    const list = byKit.get(r.kit_id) ?? [];
    list.push({ itemId: r.item_id, qty: r.qty, slotOrder: r.slot_order });
    byKit.set(r.kit_id, list);
  }
  return rows.map((r) => rowToKit(r, byKit.get(r.id) ?? []));
}

export async function getKitWithItems(userId: string, kitId: string, ex?: DbExecutor): Promise<Kit | null> {
  const row = await one<DungeonKitRow>(SQL_SELECT_BY_ID, kitId, userId);
  if (!row) return null;
  const itemRows = await q<DungeonKitItemRow>(SQL_LIST_ITEMS, row.id);
  return rowToKit(row, itemRowsToKitItems(itemRows));
}

export async function createKit(userId: string, input: KitInput): Promise<KitOutcome<Kit>> {
  const err = validateInput(input);
  if (err) return { ok: false, error: err };
  const name = input.name.trim();
  const dup = await one<DungeonKitRow>(SQL_SELECT_BY_NAME, userId, name);
  if (dup) return { ok: false, error: 'duplicate-name' };
  const id = newId('kit');
  const now = Date.now();
  await tx(async (t) => {
    await t.run(SQL_INSERT_KIT, [id, userId, name, now, now]);
    for (const it of input.items) {
      await t.run(SQL_INSERT_KIT_ITEM, [id, it.itemId, it.qty, it.slotOrder]);
    }
  });
  log.info('dungeon.kit.create', { userId, kitId: id, name, itemCount: input.items.length });
  const kit = await getKitWithItems(userId, id);
  if (!kit) return { ok: false, error: 'not-found' };
  return { ok: true, kit };
}

export async function updateKit(userId: string, kitId: string, input: KitInput): Promise<KitOutcome<Kit>> {
  const existing = await one<DungeonKitRow>(SQL_SELECT_BY_ID, kitId, userId);
  if (!existing) return { ok: false, error: 'not-found' };
  const err = validateInput(input);
  if (err) return { ok: false, error: err };
  const name = input.name.trim();
  if (name !== existing.name) {
    const dup = await one<DungeonKitRow>(SQL_SELECT_BY_NAME, userId, name);
    if (dup && dup.id !== kitId) return { ok: false, error: 'duplicate-name' };
  }
  const now = Date.now();
  await tx(async (t) => {
    await t.run(SQL_UPDATE_KIT, [name, now, kitId, userId]);
    await t.run(SQL_DELETE_KIT_ITEMS, [kitId]);
    for (const it of input.items) {
      await t.run(SQL_INSERT_KIT_ITEM, [kitId, it.itemId, it.qty, it.slotOrder]);
    }
  });
  log.info('dungeon.kit.update', { userId, kitId, name, itemCount: input.items.length });
  const kit = await getKitWithItems(userId, kitId);
  if (!kit) return { ok: false, error: 'not-found' };
  return { ok: true, kit };
}

export async function deleteKit(userId: string, kitId: string): Promise<boolean> {
  const existing = await one<DungeonKitRow>(SQL_SELECT_BY_ID, kitId, userId);
  if (!existing) return false;
  await run(SQL_DELETE_KIT, kitId, userId);
  log.info('dungeon.kit.delete', { userId, kitId, name: existing.name });
  return true;
}
