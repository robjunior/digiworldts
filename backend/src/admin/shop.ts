/**
 * Shop items: admin-editable catalog of purchasable items.
 *
 *   Items live in `shop_items`. Player purchases live in `player_inventory` and
 *   are DECOUPLED after purchase. Deleting an item is a SOFT DELETE (enabled = 0);
 *   it hides it from the shop and new purchases, but keeps existing inventory usable
 *   and preserves FKs.
 */
import { one, q, run, tx, type ShopItemRow } from '../db/index.js';
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

const SQL_BUNDLE_LIST_ALL = `SELECT * FROM shop_bundles ORDER BY sort_order ASC, name ASC`;
const SQL_BUNDLE_BY_ID = `SELECT * FROM shop_bundles WHERE id = ?`;
const SQL_BUNDLE_INSERT = `INSERT INTO shop_bundles (id, name, description, currency, discount_pct, shop_category, sort_order, featured, quick_offer, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_BUNDLE_UPDATE = `UPDATE shop_bundles SET name = ?, description = ?, currency = ?, discount_pct = ?, shop_category = ?, sort_order = ?, featured = ?, quick_offer = ?, enabled = ?, updated_at = ? WHERE id = ?`;
const SQL_BUNDLE_DELETE = `DELETE FROM shop_bundles WHERE id = ?`;
const SQL_BUNDLE_ITEM_INSERT = `INSERT INTO shop_bundle_items (bundle_id, item_id, qty, sort_order) VALUES (?, ?, ?, ?)`;
const SQL_BUNDLE_ITEM_DELETE_ALL = `DELETE FROM shop_bundle_items WHERE bundle_id = ?`;
const SQL_BUNDLE_ITEM_JOIN = `SELECT bi.bundle_id, bi.item_id, bi.qty, bi.sort_order, s.name, s.description, s.price, s.currency
  FROM shop_bundle_items bi JOIN shop_items s ON s.id = bi.item_id WHERE bi.bundle_id = ? ORDER BY bi.sort_order ASC, s.name ASC`;
const SQL_ITEM_EXISTS = `SELECT id, currency FROM shop_items WHERE id = ? AND enabled = 1`;

type BundleRow = {
  id: string;
  name: string;
  description: string;
  currency: string;
  discount_pct: number;
  shop_category: string;
  sort_order: number;
  featured: number;
  quick_offer: number;
  enabled: number;
  created_at: number;
  updated_at: number;
};

type BundleItemJoinRow = {
  bundle_id: string;
  item_id: string;
  qty: number;
  sort_order: number;
  name: string;
  description: string;
  price: number;
  currency: string;
};

export type BundleAdminItem = {
  itemId: string;
  name: string;
  description: string;
  qty: number;
  unitPrice: number;
  currency: string;
  sortOrder: number;
};

export type BundleAdminView = {
  id: string;
  name: string;
  description: string;
  currency: string;
  discountPct: number;
  shopCategory: string;
  sortOrder: number;
  featured: boolean;
  quickOffer: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  items: BundleAdminItem[];
  originalPrice: number;
  discountedPrice: number;
  savings: number;
};

export type BundleItemInput = {
  itemId: string;
  qty: number;
  sortOrder?: number;
};

export type BundleInput = {
  name: string;
  description?: string;
  currency: string;
  discountPct?: number;
  shopCategory?: string;
  sortOrder?: number;
  featured?: boolean;
  quickOffer?: boolean;
  enabled?: boolean;
  items: BundleItemInput[];
};

export type BundleError =
  | 'not-found'
  | 'invalid-name'
  | 'invalid-currency'
  | 'invalid-discount'
  | 'invalid-items'
  | 'invalid-item-ref'
  | 'currency-mismatch'
  | 'duplicate-item';

export type BundleOutcome<T> =
  | { ok: true; bundle: T }
  | { ok: false; error: BundleError; message?: string };

function bundleRowToView(row: BundleRow, items: BundleAdminItem[]): BundleAdminView {
  const originalPrice = items.reduce((sum, it) => sum + it.unitPrice * it.qty, 0);
  const clamped = Math.max(0, Math.min(100, row.discount_pct));
  const discountedPrice = Math.max(0, Math.round(originalPrice * (1 - clamped / 100)));
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    currency: row.currency,
    discountPct: row.discount_pct,
    shopCategory: row.shop_category,
    sortOrder: row.sort_order,
    featured: row.featured === 1,
    quickOffer: row.quick_offer === 1,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
    originalPrice,
    discountedPrice,
    savings: originalPrice - discountedPrice,
  };
}

async function fetchBundleItems(bundleId: string): Promise<BundleAdminItem[]> {
  const rows = await q<BundleItemJoinRow>(SQL_BUNDLE_ITEM_JOIN, bundleId);
  return rows.map((r) => ({
    itemId: r.item_id,
    name: r.name,
    description: r.description,
    qty: r.qty,
    unitPrice: r.price,
    currency: r.currency,
    sortOrder: r.sort_order,
  }));
}

function validateBundleInput(input: BundleInput): BundleError | null {
  const name = input.name?.trim();
  if (!name || name.length < 2 || name.length > 64) return 'invalid-name';
  if (input.currency !== 'credits' && input.currency !== 'netcore') return 'invalid-currency';
  if (input.discountPct !== undefined && (input.discountPct < 0 || input.discountPct > 100 || !Number.isFinite(input.discountPct))) return 'invalid-discount';
  if (!Array.isArray(input.items) || input.items.length === 0) return 'invalid-items';
  const seen = new Set<string>();
  for (const it of input.items) {
    if (typeof it.itemId !== 'string' || it.itemId.length === 0) return 'invalid-items';
    if (typeof it.qty !== 'number' || it.qty < 1 || it.qty > 99 || !Number.isSafeInteger(it.qty)) return 'invalid-items';
    if (seen.has(it.itemId)) return 'duplicate-item';
    seen.add(it.itemId);
  }
  return null;
}

async function assertItemsMatchCurrency(items: BundleItemInput[], currency: string): Promise<BundleError | null> {
  for (const it of items) {
    const row = await one<{ id: string; currency: string }>(SQL_ITEM_EXISTS, it.itemId);
    if (!row) return 'invalid-item-ref';
    if (row.currency !== currency) return 'currency-mismatch';
  }
  return null;
}

export async function listBundles(): Promise<BundleAdminView[]> {
  const rows = await q<BundleRow>(SQL_BUNDLE_LIST_ALL);
  const views: BundleAdminView[] = [];
  for (const row of rows) {
    const items = await fetchBundleItems(row.id);
    views.push(bundleRowToView(row, items));
  }
  return views;
}

export async function getBundle(id: string): Promise<BundleAdminView | null> {
  const row = await one<BundleRow>(SQL_BUNDLE_BY_ID, id);
  if (!row) return null;
  const items = await fetchBundleItems(row.id);
  return bundleRowToView(row, items);
}

export async function createBundle(input: BundleInput): Promise<BundleOutcome<BundleAdminView>> {
  const validation = validateBundleInput(input);
  if (validation) return { ok: false, error: validation };
  const currencyErr = await assertItemsMatchCurrency(input.items, input.currency);
  if (currencyErr) return { ok: false, error: currencyErr };
  const id = newId('bnd');
  const now = Date.now();
  await tx(async (t) => {
    await t.run(SQL_BUNDLE_INSERT, [
      id,
      input.name.trim(),
      input.description?.trim() ?? '',
      input.currency,
      Math.max(0, Math.min(100, input.discountPct ?? 0)),
      input.shopCategory?.trim() || 'bundle',
      input.sortOrder ?? 0,
      input.featured === true ? 1 : 0,
      input.quickOffer === true ? 1 : 0,
      input.enabled === false ? 0 : 1,
      now,
      now,
    ]);
    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i]!;
      await t.run(SQL_BUNDLE_ITEM_INSERT, [id, it.itemId, it.qty, it.sortOrder ?? i]);
    }
  });
  const created = await getBundle(id);
  if (!created) return { ok: false, error: 'not-found' };
  log.info('shop.bundle.create', { id, name: created.name, itemCount: created.items.length });
  return { ok: true, bundle: created };
}

export async function updateBundle(id: string, input: BundleInput): Promise<BundleOutcome<BundleAdminView>> {
  const existing = await one<BundleRow>(SQL_BUNDLE_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  const validation = validateBundleInput(input);
  if (validation) return { ok: false, error: validation };
  const currencyErr = await assertItemsMatchCurrency(input.items, input.currency);
  if (currencyErr) return { ok: false, error: currencyErr };
  const now = Date.now();
  await tx(async (t) => {
    await t.run(SQL_BUNDLE_UPDATE, [
      input.name.trim(),
      input.description?.trim() ?? '',
      input.currency,
      Math.max(0, Math.min(100, input.discountPct ?? 0)),
      input.shopCategory?.trim() || existing.shop_category,
      input.sortOrder ?? existing.sort_order,
      input.featured === true ? 1 : 0,
      input.quickOffer === true ? 1 : 0,
      input.enabled === false ? 0 : 1,
      now,
      id,
    ]);
    await t.run(SQL_BUNDLE_ITEM_DELETE_ALL, [id]);
    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i]!;
      await t.run(SQL_BUNDLE_ITEM_INSERT, [id, it.itemId, it.qty, it.sortOrder ?? i]);
    }
  });
  const updated = await getBundle(id);
  if (!updated) return { ok: false, error: 'not-found' };
  log.info('shop.bundle.update', { id, name: updated.name, itemCount: updated.items.length });
  return { ok: true, bundle: updated };
}

export async function deleteBundle(id: string): Promise<BundleOutcome<{ id: string }>> {
  const existing = await one<BundleRow>(SQL_BUNDLE_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  await run(SQL_BUNDLE_DELETE, id);
  log.info('shop.bundle.delete', { id, name: existing.name });
  return { ok: true, bundle: { id } };
}
