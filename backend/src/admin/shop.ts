/**
 * Shop items: admin-editable catalog of purchasable items.
 *
 *   Items live in `shop_items`. Player purchases live in `player_inventory` and
 *   are DECOUPLED after purchase (deleting an item does not refund; disabling
 *   an item only hides it from the shop — existing inventory stays usable).
 *
 *   Valid kinds seen elsewhere in the codebase (src/social/shop.ts):
 *     'consumable'         → payload { heal_pct? en_pct? xp_mult? matches? }
 *     'cosmetic'           → payload { badge?: string }
 *     'evolve'             → payload { stage: 'Champion'|'Ultimate'|'Mega' }
 *     'building_placement' → payload { buildingType, kind }
 *     'ticket'             → payload { ... } (reserved, not currently issued)
 *
 *   Payload is stored as a JSON string; this engine round-trips it as an object
 *   at the API boundary and validates JSON.parse succeeds on write.
 */
import { one, q, run, type ShopItemRow } from '../db/index.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';

const SQL_SELECT_ALL = `SELECT * FROM shop_items ORDER BY kind, name`;
const SQL_SELECT_BY_ID = `SELECT * FROM shop_items WHERE id = ?`;
const SQL_SELECT_BY_NAME = `SELECT * FROM shop_items WHERE name = ?`;
const SQL_INSERT = `INSERT INTO shop_items (id, name, description, price_credits, kind, class, payload, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE = `UPDATE shop_items SET name = ?, description = ?, price_credits = ?, kind = ?, class = ?, payload = ?, enabled = ? WHERE id = ?`;
const SQL_DELETE = `DELETE FROM shop_items WHERE id = ?`;

const VALID_KINDS = ['consumable', 'cosmetic', 'evolve', 'building_placement', 'ticket', 'revive'] as const;
type ShopKind = (typeof VALID_KINDS)[number];

const VALID_CLASSES = ['product', 'item'] as const;
type ShopClass = (typeof VALID_CLASSES)[number];

export type ShopItemView = {
  id: string;
  name: string;
  description: string;
  priceCredits: number;
  kind: ShopKind;
  class: ShopClass;
  payload: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
};

export type ShopItemInput = {
  name: string;
  description?: string | undefined;
  priceCredits: number;
  kind: ShopKind;
  class: ShopClass;
  payload?: Record<string, unknown> | undefined;
  enabled?: boolean | undefined;
};

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

function rowToView(row: ShopItemRow): ShopItemView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCredits: row.price_credits,
    kind: row.kind as ShopKind,
    class: row.class as ShopClass,
    payload: parsePayload(row.payload),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

export async function listShopItems(): Promise<ShopItemView[]> {
  const rows = await q<ShopItemRow>(SQL_SELECT_ALL);
  return rows.map(rowToView);
}

export async function getShopItem(id: string): Promise<ShopItemView | null> {
  const row = await one<ShopItemRow>(SQL_SELECT_BY_ID, id);
  return row ? rowToView(row) : null;
}

export type ShopItemError =
  | 'invalid-name'
  | 'invalid-description'
  | 'invalid-price'
  | 'invalid-kind'
  | 'invalid-class'
  | 'invalid-payload'
  | 'duplicate-name'
  | 'not-found';

export type ShopItemOutcome<T> =
  | { ok: true; item: T }
  | { ok: false; error: ShopItemError };

function validateInput(input: ShopItemInput): ShopItemError | null {
  const name = input.name?.trim();
  if (!name || name.length < 2 || name.length > 64) return 'invalid-name';
  const desc = input.description?.trim();
  if (desc != null && desc.length > 400) return 'invalid-description';
  if (typeof input.priceCredits !== 'number' || input.priceCredits < 0 || !Number.isFinite(input.priceCredits)) {
    return 'invalid-price';
  }
  if (!VALID_KINDS.includes(input.kind)) return 'invalid-kind';
  if (!VALID_CLASSES.includes(input.class)) return 'invalid-class';
  if (input.payload != null && (typeof input.payload !== 'object' || Array.isArray(input.payload))) {
    return 'invalid-payload';
  }
  return null;
}

export async function createShopItem(input: ShopItemInput): Promise<ShopItemOutcome<ShopItemView>> {
  const err = validateInput(input);
  if (err) return { ok: false, error: err };
  const existing = await one<ShopItemRow>(SQL_SELECT_BY_NAME, input.name.trim());
  if (existing) return { ok: false, error: 'duplicate-name' };
  const now = Date.now();
  const id = newId('itm');
  const row: ShopItemRow = {
    id,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    price_credits: Math.max(0, Math.floor(input.priceCredits)),
    kind: input.kind,
    class: input.class,
    payload: JSON.stringify(input.payload ?? {}),
    enabled: input.enabled === false ? 0 : 1,
    created_at: now,
  };
  await run(SQL_INSERT, [
    row.id, row.name, row.description, row.price_credits, row.kind, row.class, row.payload, row.enabled, row.created_at,
  ]);
  log.info('shop.item.create', { id: row.id, name: row.name, kind: row.kind, class: row.class });
  return { ok: true, item: rowToView(row) };
}

export async function updateShopItem(id: string, input: ShopItemInput): Promise<ShopItemOutcome<ShopItemView>> {
  const existing = await one<ShopItemRow>(SQL_SELECT_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  const err = validateInput(input);
  if (err) return { ok: false, error: err };
  const nameCollide = await one<ShopItemRow>(SQL_SELECT_BY_NAME, input.name.trim());
  if (nameCollide && nameCollide.id !== id) return { ok: false, error: 'duplicate-name' };
  const merged: ShopItemRow = {
    ...existing,
    name: input.name.trim(),
    description: input.description?.trim() ?? existing.description,
    price_credits: Math.max(0, Math.floor(input.priceCredits)),
    kind: input.kind,
    class: input.class,
    payload: JSON.stringify(input.payload ?? parsePayload(existing.payload)),
    enabled: input.enabled === true ? 1 : input.enabled === false ? 0 : existing.enabled,
  };
  await run(SQL_UPDATE, [
    merged.name, merged.description, merged.price_credits, merged.kind, merged.class, merged.payload, merged.enabled, id,
  ]);
  log.info('shop.item.update', { id, name: merged.name, class: merged.class });
  return { ok: true, item: rowToView(merged) };
}

export async function deleteShopItem(id: string): Promise<ShopItemOutcome<{ id: string }>> {
  const existing = await one<ShopItemRow>(SQL_SELECT_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  await run(SQL_DELETE, id);
  log.info('shop.item.delete', { id, name: existing.name });
  return { ok: true, item: { id } };
}
