/**
 * Shop items: admin-editable catalog of purchasable items.
 *
 *   Items live in `shop_items`. Player purchases live in `player_inventory` and
 *   are DECOUPLED after purchase. Deleting an item is a SOFT DELETE (enabled = 0);
 *   it hides it from the shop and new purchases, but keeps existing inventory usable
 *   and preserves FKs.
 */
import { one, q, run, type ShopItemRow } from '../db/index.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';

const SQL_SELECT_ALL = `SELECT * FROM shop_items ORDER BY kind, name`;
const SQL_SELECT_BY_ID = `SELECT * FROM shop_items WHERE id = ?`;
const SQL_SELECT_BY_NAME = `SELECT * FROM shop_items WHERE name = ?`;
const SQL_INSERT = `INSERT INTO shop_items (id, name, description, price_credits, price, currency, shop_category, featured, quick_offer, one_time, sort_order, kind, class, payload, enabled, is_quest_item, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE = `UPDATE shop_items SET name = ?, description = ?, price_credits = ?, price = ?, currency = ?, shop_category = ?, featured = ?, quick_offer = ?, one_time = ?, sort_order = ?, kind = ?, class = ?, payload = ?, enabled = ?, is_quest_item = ? WHERE id = ?`;
const SQL_SOFT_DELETE = `UPDATE shop_items SET enabled = 0 WHERE id = ?`;

const VALID_KINDS = ['consumable', 'cosmetic', 'evolve', 'building_placement', 'ticket', 'revive'] as const;
type ShopKind = (typeof VALID_KINDS)[number];

const VALID_CLASSES = ['product', 'item'] as const;
type ShopClass = (typeof VALID_CLASSES)[number];

type ExtendedShopItemRow = ShopItemRow & {
  currency?: string;
  price?: number;
  shop_category?: string;
  featured?: number;
  quick_offer?: number;
  one_time?: number;
  sort_order?: number;
};

export type ShopItemView = {
  id: string;
  name: string;
  description: string;
  priceCredits: number;
  price: number;
  currency: string;
  shopCategory: string;
  featured: boolean;
  quickOffer: boolean;
  oneTime: boolean;
  sortOrder: number;
  kind: ShopKind;
  class: ShopClass;
  payload: Record<string, unknown>;
  enabled: boolean;
  isQuestItem: boolean;
  createdAt: number;
};

export type ShopItemInput = {
  name: string;
  description?: string | undefined;
  priceCredits?: number;
  price: number;
  currency: string;
  shopCategory: string;
  featured: boolean;
  quickOffer: boolean;
  oneTime: boolean;
  sortOrder: number;
  kind: ShopKind;
  class: ShopClass;
  payload?: Record<string, unknown> | undefined;
  enabled?: boolean | undefined;
  isQuestItem?: boolean | undefined;
};

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
  }
  return {};
}

function rowToView(row: ExtendedShopItemRow): ShopItemView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCredits: row.price_credits,
    price: row.price ?? row.price_credits,
    currency: row.currency ?? 'credits',
    shopCategory: row.shop_category ?? 'misc',
    featured: row.featured === 1,
    quickOffer: row.quick_offer === 1,
    oneTime: row.one_time === 1,
    sortOrder: row.sort_order ?? 0,
    kind: row.kind as ShopKind,
    class: row.class as ShopClass,
    payload: parsePayload(row.payload),
    enabled: row.enabled === 1,
    isQuestItem: row.is_quest_item === 1,
    createdAt: row.created_at,
  };
}

export async function listShopItems(): Promise<ShopItemView[]> {
  const rows = await q<ExtendedShopItemRow>(SQL_SELECT_ALL);
  return rows.map(rowToView);
}

export async function getShopItem(id: string): Promise<ShopItemView | null> {
  const row = await one<ExtendedShopItemRow>(SQL_SELECT_BY_ID, id);
  return row ? rowToView(row) : null;
}

export type ShopItemError =
  | 'invalid-name'
  | 'invalid-description'
  | 'invalid-price'
  | 'invalid-currency'
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
  if (typeof input.price !== 'number' || input.price < 0 || !Number.isFinite(input.price)) {
    return 'invalid-price';
  }
  if (input.currency !== 'credits' && input.currency !== 'netcore') {
    return 'invalid-currency';
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
  const existing = await one<ExtendedShopItemRow>(SQL_SELECT_BY_NAME, input.name.trim());
  if (existing) return { ok: false, error: 'duplicate-name' };
  const now = Date.now();
  const id = newId('itm');
  
  const price = Math.max(0, Math.floor(input.price));
  const row: ExtendedShopItemRow = {
    id,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    price_credits: price,
    price,
    currency: input.currency,
    shop_category: input.shopCategory,
    featured: input.featured ? 1 : 0,
    quick_offer: input.quickOffer ? 1 : 0,
    one_time: input.oneTime ? 1 : 0,
    sort_order: input.sortOrder ?? 0,
    kind: input.kind,
    class: input.class,
    payload: JSON.stringify(input.payload ?? {}),
    enabled: input.enabled === false ? 0 : 1,
    is_quest_item: input.isQuestItem === true ? 1 : 0,
    created_at: now,
  };
  await run(SQL_INSERT, [
    row.id, row.name, row.description, row.price_credits, row.price, row.currency, row.shop_category,
    row.featured, row.quick_offer, row.one_time, row.sort_order, row.kind, row.class, row.payload,
    row.enabled, row.is_quest_item, row.created_at,
  ]);
  log.info('shop.item.create', { id: row.id, name: row.name, kind: row.kind, class: row.class, isQuestItem: row.is_quest_item === 1 });
  return { ok: true, item: rowToView(row) };
}

export async function updateShopItem(id: string, input: ShopItemInput): Promise<ShopItemOutcome<ShopItemView>> {
  const existing = await one<ExtendedShopItemRow>(SQL_SELECT_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  const err = validateInput(input);
  if (err) return { ok: false, error: err };
  const nameCollide = await one<ExtendedShopItemRow>(SQL_SELECT_BY_NAME, input.name.trim());
  if (nameCollide && nameCollide.id !== id) return { ok: false, error: 'duplicate-name' };
  
  const price = Math.max(0, Math.floor(input.price));
  const merged: ExtendedShopItemRow = {
    ...existing,
    name: input.name.trim(),
    description: input.description?.trim() ?? existing.description,
    price_credits: price,
    price,
    currency: input.currency,
    shop_category: input.shopCategory,
    featured: input.featured ? 1 : 0,
    quick_offer: input.quickOffer ? 1 : 0,
    one_time: input.oneTime ? 1 : 0,
    sort_order: input.sortOrder ?? 0,
    kind: input.kind,
    class: input.class,
    payload: JSON.stringify(input.payload ?? parsePayload(existing.payload)),
    enabled: input.enabled === true ? 1 : input.enabled === false ? 0 : existing.enabled,
    is_quest_item: input.isQuestItem === true ? 1 : input.isQuestItem === false ? 0 : existing.is_quest_item,
  };
  await run(SQL_UPDATE, [
    merged.name, merged.description, merged.price_credits, merged.price, merged.currency,
    merged.shop_category, merged.featured, merged.quick_offer, merged.one_time, merged.sort_order,
    merged.kind, merged.class, merged.payload, merged.enabled, merged.is_quest_item, id,
  ]);
  log.info('shop.item.update', { id, name: merged.name, class: merged.class, isQuestItem: merged.is_quest_item === 1 });
  return { ok: true, item: rowToView(merged) };
}

export async function deleteShopItem(id: string): Promise<ShopItemOutcome<{ id: string }>> {
  const existing = await one<ExtendedShopItemRow>(SQL_SELECT_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  await run(SQL_SOFT_DELETE, id);
  log.info('shop.item.delete', { id, name: existing.name });
  return { ok: true, item: { id } };
}
