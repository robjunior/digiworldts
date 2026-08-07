/**
 * Admin CRUD for farm_recipes — used by the F8 admin editor panel to
 * tune recipe cost, timing, category, requires_items (input fragment
 * list), inherit_rarity_from, and unlock_condition without a redeploy.
 *
 * The seeded content (~42 recipes from F6) can be edited here just like
 * any admin-authored recipe. Deletion is soft (`enabled=0`) so historical
 * crafting_jobs still resolve back to a valid row.
 */
import { one, q, run } from '../db/index.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';

const SQL_SELECT_ALL_RECIPES = `SELECT * FROM farm_recipes ORDER BY category, item_id`;
const SQL_SELECT_RECIPE_BY_ID = `SELECT * FROM farm_recipes WHERE id = ?`;
const SQL_INSERT_ADMIN_RECIPE = `INSERT INTO farm_recipes (id, item_id, meat_cost, bits_cost, data_cost, craft_time_ms, category, requires_items, inherit_rarity_from, unlock_condition, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`;
const SQL_UPDATE_ADMIN_RECIPE = `UPDATE farm_recipes SET item_id = ?, meat_cost = ?, bits_cost = ?, data_cost = ?, craft_time_ms = ?, category = ?, requires_items = ?, inherit_rarity_from = ?, unlock_condition = ?, enabled = ? WHERE id = ?`;
const SQL_SOFT_DELETE_RECIPE = `UPDATE farm_recipes SET enabled = 0 WHERE id = ?`;

type AdminFarmRecipeRow = {
  readonly id: string;
  readonly item_id: string;
  readonly meat_cost: number;
  readonly bits_cost: number;
  readonly data_cost: number;
  readonly craft_time_ms: number;
  readonly category: string | null;
  readonly requires_items: string;
  readonly inherit_rarity_from: string | null;
  readonly unlock_condition: string | null;
  readonly enabled: 0 | 1;
  readonly created_at: number;
};

const VALID_CATEGORIES = ['med', 'chip', 'rare', 'pantry'] as const;
type FactoryCategory = (typeof VALID_CATEGORIES)[number];

export type AdminFarmRecipeView = {
  readonly id: string;
  readonly itemId: string;
  readonly meatCost: number;
  readonly bitsCost: number;
  readonly dataCost: number;
  readonly craftTimeMs: number;
  readonly category: FactoryCategory | null;
  readonly requiresItems: readonly { readonly itemId: string; readonly qty: number }[];
  readonly inheritRarityFrom: string | null;
  readonly unlockCondition: Record<string, unknown> | null;
  readonly enabled: boolean;
  readonly createdAt: number;
};

export type AdminFarmRecipeInput = {
  readonly itemId: string;
  readonly meatCost: number;
  readonly bitsCost: number;
  readonly dataCost: number;
  readonly craftTimeMs: number;
  readonly category: FactoryCategory | null;
  readonly requiresItems?: readonly { readonly itemId: string; readonly qty: number }[];
  readonly inheritRarityFrom?: string | null;
  readonly unlockCondition?: Record<string, unknown> | null;
  readonly enabled?: boolean;
};

export type AdminFarmRecipeError = 'not-found' | 'invalid-category' | 'invalid-item-id' | 'invalid-cost' | 'invalid-craft-time' | 'invalid-requires-items';

function parseRequiresItemsField(json: string): readonly { readonly itemId: string; readonly qty: number }[] {
  try {
    const raw: unknown = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    const out: { itemId: string; qty: number }[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record['itemId'] !== 'string') continue;
      if (typeof record['qty'] !== 'number' || record['qty'] < 1) continue;
      out.push({ itemId: record['itemId'], qty: Math.max(1, Math.floor(record['qty'])) });
    }
    return out;
  } catch { return []; }
}

function parseUnlockConditionField(json: string | null): Record<string, unknown> | null {
  if (json === null || json === '') return null;
  try {
    const raw: unknown = JSON.parse(json);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  } catch { /* fall through */ }
  return null;
}

function rowToView(row: AdminFarmRecipeRow): AdminFarmRecipeView {
  return {
    id: row.id,
    itemId: row.item_id,
    meatCost: row.meat_cost,
    bitsCost: row.bits_cost,
    dataCost: row.data_cost,
    craftTimeMs: row.craft_time_ms,
    category: row.category && (VALID_CATEGORIES as readonly string[]).includes(row.category) ? (row.category as FactoryCategory) : null,
    requiresItems: parseRequiresItemsField(row.requires_items),
    inheritRarityFrom: row.inherit_rarity_from,
    unlockCondition: parseUnlockConditionField(row.unlock_condition),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

function validate(input: AdminFarmRecipeInput): AdminFarmRecipeError | null {
  if (typeof input.itemId !== 'string' || input.itemId.trim().length === 0) return 'invalid-item-id';
  if (!Number.isFinite(input.meatCost) || input.meatCost < 0 || !Number.isFinite(input.bitsCost) || input.bitsCost < 0 || !Number.isFinite(input.dataCost) || input.dataCost < 0) return 'invalid-cost';
  if (!Number.isFinite(input.craftTimeMs) || input.craftTimeMs < 1000) return 'invalid-craft-time';
  if (input.category !== null && !(VALID_CATEGORIES as readonly string[]).includes(input.category)) return 'invalid-category';
  if (input.requiresItems) {
    for (const req of input.requiresItems) {
      if (!req || typeof req.itemId !== 'string' || req.itemId.length === 0 || !Number.isInteger(req.qty) || req.qty < 1) return 'invalid-requires-items';
    }
  }
  return null;
}

export async function listAdminFarmRecipes(): Promise<AdminFarmRecipeView[]> {
  const rows = await q<AdminFarmRecipeRow>(SQL_SELECT_ALL_RECIPES);
  return rows.map(rowToView);
}

export async function getAdminFarmRecipe(id: string): Promise<AdminFarmRecipeView | null> {
  const row = await one<AdminFarmRecipeRow>(SQL_SELECT_RECIPE_BY_ID, id);
  return row ? rowToView(row) : null;
}

export async function createAdminFarmRecipe(input: AdminFarmRecipeInput): Promise<{ ok: true; recipe: AdminFarmRecipeView } | { ok: false; error: AdminFarmRecipeError }> {
  const err = validate(input);
  if (err !== null) return { ok: false, error: err };
  const id = newId('rcp');
  const now = Date.now();
  await run(
    SQL_INSERT_ADMIN_RECIPE,
    id,
    input.itemId,
    Math.floor(input.meatCost),
    Math.floor(input.bitsCost),
    Math.floor(input.dataCost),
    Math.floor(input.craftTimeMs),
    input.category,
    JSON.stringify(input.requiresItems ?? []),
    input.inheritRarityFrom ?? null,
    input.unlockCondition ? JSON.stringify(input.unlockCondition) : null,
    now,
  );
  const created = await getAdminFarmRecipe(id);
  if (!created) return { ok: false, error: 'not-found' };
  log.info('admin.farm-recipe.create', { id, itemId: input.itemId, category: input.category });
  return { ok: true, recipe: created };
}

export async function updateAdminFarmRecipe(id: string, input: AdminFarmRecipeInput): Promise<{ ok: true; recipe: AdminFarmRecipeView } | { ok: false; error: AdminFarmRecipeError }> {
  const existing = await getAdminFarmRecipe(id);
  if (!existing) return { ok: false, error: 'not-found' };
  const err = validate(input);
  if (err !== null) return { ok: false, error: err };
  await run(
    SQL_UPDATE_ADMIN_RECIPE,
    input.itemId,
    Math.floor(input.meatCost),
    Math.floor(input.bitsCost),
    Math.floor(input.dataCost),
    Math.floor(input.craftTimeMs),
    input.category,
    JSON.stringify(input.requiresItems ?? []),
    input.inheritRarityFrom ?? null,
    input.unlockCondition ? JSON.stringify(input.unlockCondition) : null,
    input.enabled === false ? 0 : 1,
    id,
  );
  const updated = await getAdminFarmRecipe(id);
  if (!updated) return { ok: false, error: 'not-found' };
  log.info('admin.farm-recipe.update', { id, itemId: input.itemId });
  return { ok: true, recipe: updated };
}

export async function deleteAdminFarmRecipe(id: string): Promise<{ ok: true } | { ok: false; error: AdminFarmRecipeError }> {
  const existing = await getAdminFarmRecipe(id);
  if (!existing) return { ok: false, error: 'not-found' };
  await run(SQL_SOFT_DELETE_RECIPE, id);
  log.info('admin.farm-recipe.delete', { id });
  return { ok: true };
}
