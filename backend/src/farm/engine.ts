/**
 * Farm/city engine — server-authoritative production for Meat / Bits / Data.
 *
 * Storage model (see schema.sql):
 *   farm_buildings.produced   = checkpoint (units produced BEFORE last_touch)
 *   farm_buildings.last_touch = ms epoch of the last write we made
 * Computed-on-read production:
 *   accrued = min(capacity, produced + (now - last_touch) * rate_per_hour / 3_600_000)
 * On collect we bank `accrued` into `resources.amount` and reset the row.
 *
 * Seed layout (matches base/farm.html): a first-time player gets 4 buildings
 * across the 3 resource kinds so the farm page has something to render.
 *
 * Async by construction — routes through the DbAdapter (SQLite or Postgres).
 */
import { one, q, tx, type FarmBuildingRow, type FarmRecipeRow, type ResourceRow, type ShopItemRow, type WalletRow } from '../db/index.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';
import { starterBlueprintsFor } from '../admin/blueprints.js';

const MS_PER_HOUR = 3_600_000;

export type ResourceKind = 'Meat' | 'Bits' | 'Data';

export type BuildingView = {
  id: string;
  kind: string;
  resource: ResourceKind;
  level: number;
  ratePerHour: number;
  capacity: number;
  produced: number;
  upgradeCost: number;
  full: boolean;
};

export type FarmView = {
  balances: Record<ResourceKind, number>;
  credits: number;
  buildings: BuildingView[];
};

const SQL_SELECT_BUILDINGS = `SELECT * FROM farm_buildings WHERE user_id = ? ORDER BY created_at`;
const SQL_SELECT_BUILDING = `SELECT * FROM farm_buildings WHERE id = ? AND user_id = ?`;
const SQL_INSERT_BUILDING = `INSERT INTO farm_buildings (id, user_id, kind, resource, level, rate_per_hour, capacity, produced, last_touch, upgrade_cost, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_CHECKPOINT = `UPDATE farm_buildings SET produced = ?, last_touch = ? WHERE id = ?`;
const SQL_UPDATE_UPGRADE = `UPDATE farm_buildings SET level = ?, rate_per_hour = ?, capacity = ?, upgrade_cost = ?, produced = ?, last_touch = ? WHERE id = ?`;
const SQL_SELECT_WALLET = `SELECT * FROM player_wallet WHERE user_id = ?`;
const SQL_SELECT_RESOURCES = `SELECT * FROM resources WHERE user_id = ?`;
const SQL_SELECT_BITS = `SELECT amount FROM resources WHERE user_id = ? AND resource = 'Bits'`;
const SQL_DEDUCT_BITS = `UPDATE resources SET amount = amount - ?, updated_at = ? WHERE user_id = ? AND resource = 'Bits' AND amount >= ?`;
const SQL_UPSERT_RESOURCE = `INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, resource) DO UPDATE SET amount = resources.amount + excluded.amount, updated_at = excluded.updated_at`;
const SQL_SELECT_RECIPES = `SELECT r.*, s.name AS item_name, s.description AS item_description
     FROM farm_recipes r JOIN shop_items s ON s.id = r.item_id
     WHERE r.enabled = 1 AND s.enabled = 1 AND s.class = 'item'
     ORDER BY r.meat_cost + r.bits_cost + r.data_cost ASC`;
const SQL_SELECT_RECIPE = `SELECT * FROM farm_recipes WHERE id = ? AND enabled = 1`;
const SQL_INSERT_RECIPE = `INSERT INTO farm_recipes (id, item_id, meat_cost, bits_cost, data_cost, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT (id) DO NOTHING`;
const SQL_DEDUCT_RESOURCE = `UPDATE resources SET amount = amount - ?, updated_at = ? WHERE user_id = ? AND resource = ? AND amount >= ?`;
const SQL_UPSERT_INVENTORY_ITEM = `INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET qty = player_inventory.qty + 1, updated_at = excluded.updated_at`;
const SQL_SELECT_SHOP_ITEM = `SELECT * FROM shop_items WHERE id = ? AND enabled = 1 AND class = 'item'`;

function computeProduced(row: FarmBuildingRow, now: number): number {
  const elapsed = Math.max(0, now - row.last_touch);
  const accrued = row.produced + (elapsed / MS_PER_HOUR) * row.rate_per_hour;
  return Math.min(row.capacity, accrued);
}

function toView(row: FarmBuildingRow, now: number): BuildingView {
  const produced = computeProduced(row, now);
  return {
    id: row.id,
    kind: row.kind,
    resource: row.resource,
    level: row.level,
    ratePerHour: row.rate_per_hour,
    capacity: row.capacity,
    produced,
    upgradeCost: row.upgrade_cost,
    full: produced >= row.capacity,
  };
}

/** One-time seed. Called after successful register (auth/routes.ts). */
export async function seedFarmForUser(userId: string): Promise<void> {
  const existing = await q<FarmBuildingRow>(SQL_SELECT_BUILDINGS, userId);
  if (existing.length > 0) return;
  const blueprints = await starterBlueprintsFor('resource_generator');
  if (blueprints.length === 0) {
    log.warn('farm.seed.no-blueprints', { userId });
    return;
  }
  const now = Date.now();
  await tx(async (t) => {
    for (const bp of blueprints) {
      if (!bp.resource) continue;
      await t.run(SQL_INSERT_BUILDING, [
        newId('bld'),
        userId,
        bp.name,
        bp.resource,
        1,
        bp.ratePerHour,
        bp.capacity,
        0,
        now,
        bp.upgradeCost,
        now,
      ]);
    }
  });
  log.info('farm.seed.ok', { userId, count: blueprints.length });
}

/** Load the full farm view for a user. */
export async function readFarm(userId: string): Promise<FarmView> {
  const now = Date.now();
  const balances: Record<ResourceKind, number> = { Meat: 0, Bits: 0, Data: 0 };
  for (const r of await q<ResourceRow>(SQL_SELECT_RESOURCES, userId)) balances[r.resource] = r.amount;
  const wallet = await one<WalletRow>(SQL_SELECT_WALLET, userId);
  const credits = wallet?.credits ?? 0;
  const rows = await q<FarmBuildingRow>(SQL_SELECT_BUILDINGS, userId);
  const buildings = rows.map((row) => toView(row, now));
  return { balances, credits, buildings };
}

export type CollectResult = { gained: Array<{ resource: ResourceKind; amount: number }>; view: FarmView };

/** Collect one building's produced units into the player's resource balance. */
export async function collectBuilding(userId: string, buildingId: string): Promise<CollectResult | null> {
  const row = await one<FarmBuildingRow>(SQL_SELECT_BUILDING, buildingId, userId);
  if (!row) return null;
  const now = Date.now();
  const produced = Math.floor(computeProduced(row, now));
  if (produced <= 0) {
    return { gained: [], view: await readFarm(userId) };
  }
  await tx(async (t) => {
    await t.run(SQL_UPSERT_RESOURCE, [userId, row.resource, produced, now]);
    await t.run(SQL_UPDATE_CHECKPOINT, [0, now, buildingId]);
  });
  return { gained: [{ resource: row.resource, amount: produced }], view: await readFarm(userId) };
}

/** Bank every building that has ≥1 produced unit. */
export async function collectAllBuildings(userId: string): Promise<CollectResult> {
  const now = Date.now();
  const rows = await q<FarmBuildingRow>(SQL_SELECT_BUILDINGS, userId);
  const gained: Record<ResourceKind, number> = { Meat: 0, Bits: 0, Data: 0 };
  await tx(async (t) => {
    for (const row of rows) {
      const produced = Math.floor(computeProduced(row, now));
      if (produced <= 0) continue;
      gained[row.resource] += produced;
      await t.run(SQL_UPDATE_CHECKPOINT, [0, now, row.id]);
    }
    for (const res of ['Meat', 'Bits', 'Data'] as const) {
      if (gained[res] > 0) await t.run(SQL_UPSERT_RESOURCE, [userId, res, gained[res], now]);
    }
  });
  return {
    gained: (['Meat', 'Bits', 'Data'] as const)
      .filter((r) => gained[r] > 0)
      .map((r) => ({ resource: r, amount: gained[r] })),
    view: await readFarm(userId),
  };
}

export type UpgradeError = 'not-found' | 'insufficient-bits';

const SEED_RECIPES: ReadonlyArray<{ id: string; item_id: string; meat: number; bits: number; data: number }> = [
  { id: 'rcp-heal-small', item_id: 'itm-heal-small', meat: 5, bits: 10, data: 0 },
  { id: 'rcp-energy-drink', item_id: 'itm-energy-drink', meat: 0, bits: 15, data: 5 },
  { id: 'rcp-status-cure', item_id: 'itm-status-cure', meat: 10, bits: 10, data: 5 },
  { id: 'rcp-atk-buff', item_id: 'itm-atk-buff', meat: 20, bits: 20, data: 0 },
  { id: 'rcp-def-buff', item_id: 'itm-def-buff', meat: 20, bits: 20, data: 0 },
  { id: 'rcp-heal-large', item_id: 'itm-heal-large', meat: 20, bits: 40, data: 10 },
  { id: 'rcp-digi-revive', item_id: 'itm-digi-revive', meat: 30, bits: 30, data: 30 },
];

export async function seedFarmRecipes(): Promise<void> {
  const now = Date.now();
  await tx(async (t) => {
    for (const recipe of SEED_RECIPES) {
      await t.run(SQL_INSERT_RECIPE, [recipe.id, recipe.item_id, recipe.meat, recipe.bits, recipe.data, now]);
    }
  });
  log.info('farm.recipes.seed.ok', { count: SEED_RECIPES.length });
}

export type RecipeView = {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly itemDescription: string;
  readonly meatCost: number;
  readonly bitsCost: number;
  readonly dataCost: number;
  readonly canCraft: boolean;
};

export async function readRecipes(userId: string): Promise<{ recipes: RecipeView[]; balances: Record<ResourceKind, number> }> {
  const balances: Record<ResourceKind, number> = { Meat: 0, Bits: 0, Data: 0 };
  for (const r of await q<ResourceRow>(SQL_SELECT_RESOURCES, userId)) balances[r.resource] = r.amount;
  type RecipeJoinRow = FarmRecipeRow & { item_name: string; item_description: string };
  const rows = await q<RecipeJoinRow>(SQL_SELECT_RECIPES);
  const recipes: RecipeView[] = rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    itemDescription: row.item_description,
    meatCost: row.meat_cost,
    bitsCost: row.bits_cost,
    dataCost: row.data_cost,
    canCraft: balances.Meat >= row.meat_cost && balances.Bits >= row.bits_cost && balances.Data >= row.data_cost,
  }));
  return { recipes, balances };
}

export type CraftError = 'not-found' | 'item-missing' | 'insufficient-resources';

export async function craftItem(userId: string, recipeId: string): Promise<
  | { ok: true; itemId: string; itemName: string; balances: Record<ResourceKind, number> }
  | { ok: false; error: CraftError; missing?: Partial<Record<ResourceKind, number>> }
> {
  const recipe = await one<FarmRecipeRow>(SQL_SELECT_RECIPE, recipeId);
  if (!recipe) return { ok: false, error: 'not-found' };
  const item = await one<ShopItemRow>(SQL_SELECT_SHOP_ITEM, recipe.item_id);
  if (!item) return { ok: false, error: 'item-missing' };

  const now = Date.now();
  let deficit: Partial<Record<ResourceKind, number>> | null = null;

  await tx(async (t) => {
    const balances: Record<ResourceKind, number> = { Meat: 0, Bits: 0, Data: 0 };
    for (const r of await t.query<ResourceRow>(SQL_SELECT_RESOURCES, [userId])) balances[r.resource] = r.amount;
    const missing: Partial<Record<ResourceKind, number>> = {};
    if (balances.Meat < recipe.meat_cost) missing.Meat = recipe.meat_cost - balances.Meat;
    if (balances.Bits < recipe.bits_cost) missing.Bits = recipe.bits_cost - balances.Bits;
    if (balances.Data < recipe.data_cost) missing.Data = recipe.data_cost - balances.Data;
    if (Object.keys(missing).length > 0) {
      deficit = missing;
      return;
    }
    const costs: Array<[ResourceKind, number]> = [
      ['Meat', recipe.meat_cost],
      ['Bits', recipe.bits_cost],
      ['Data', recipe.data_cost],
    ];
    for (const [res, cost] of costs) {
      if (cost <= 0) continue;
      const info = await t.run(SQL_DEDUCT_RESOURCE, [cost, now, userId, res, cost]);
      if (info.changes === 0) {
        deficit = { [res]: cost };
        throw new Error('craft-race');
      }
    }
    await t.run(SQL_UPSERT_INVENTORY_ITEM, [userId, recipe.item_id, now]);
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message === 'craft-race') return;
    throw err;
  });

  if (deficit) return { ok: false, error: 'insufficient-resources', missing: deficit };

  const balancesAfter: Record<ResourceKind, number> = { Meat: 0, Bits: 0, Data: 0 };
  for (const r of await q<ResourceRow>(SQL_SELECT_RESOURCES, userId)) balancesAfter[r.resource] = r.amount;
  log.info('farm.craft.ok', { userId, recipeId, itemId: recipe.item_id });
  return { ok: true, itemId: recipe.item_id, itemName: item.name, balances: balancesAfter };
}

/**
 * Upgrade a building: +25% rate, +20% capacity, +60% next upgrade cost.
 * We CHECKPOINT the current accrued production first so the upgrade
 * doesn't lose any already-produced units.
 */
export async function upgradeBuilding(
  userId: string,
  buildingId: string,
): Promise<{ view: FarmView } | { error: UpgradeError; needed?: number }> {
  const row = await one<FarmBuildingRow>(SQL_SELECT_BUILDING, buildingId, userId);
  if (!row) return { error: 'not-found' };
  const now = Date.now();
  const produced = computeProduced(row, now);
  const newRate = Math.round(row.rate_per_hour * 1.25);
  const newCap = Math.round(row.capacity * 1.2);
  const newCost = Math.round(row.upgrade_cost * 1.6);
  let insufficient = false;
  await tx(async (t) => {
    const deductRes = await t.run(SQL_DEDUCT_BITS, [row.upgrade_cost, now, userId, row.upgrade_cost]);
    if (deductRes.changes === 0) {
      insufficient = true;
      return;
    }
    await t.run(SQL_UPDATE_UPGRADE, [row.level + 1, newRate, newCap, newCost, produced, now, buildingId]);
  });
  if (insufficient) {
    const balance = await one<{ amount: number }>(SQL_SELECT_BITS, userId);
    const have = balance?.amount ?? 0;
    return { error: 'insufficient-bits', needed: row.upgrade_cost - have };
  }
  return { view: await readFarm(userId) };
}
