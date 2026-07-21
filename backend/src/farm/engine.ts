/**
 * Farm/city engine — server-authoritative production for Meat / Bits / Data,
 * plus the multi-factory crafting system.
 *
 * Storage model (see schema.sql):
 *   farm_buildings.produced   = checkpoint (units produced BEFORE last_touch)
 *   farm_buildings.last_touch = ms epoch of the last write we made
 * Computed-on-read production:
 *   accrued = min(capacity, produced + (now - last_touch) * rate_per_hour / 3_600_000)
 * On collect we bank `accrued` into `resources.amount` and reset the row.
 *
 * Crafting model (factory-typed queue):
 *   player_factories: user owns 1..N factories, each of factory_type
 *     med / chip / rare. Each type gates which recipe categories can be
 *     crafted on it. Starter user gets a free Med Factory at register.
 *   crafting_jobs: one row per queued/active/completed item. Per-factory
 *     invariants:
 *       started_at IS NULL, collected_at IS NULL          → queued
 *       started_at IS NOT NULL, collected_at IS NULL      → active
 *       collected_at IS NOT NULL                           → done
 *     A partial unique index enforces at most ONE active job per factory.
 *   Queue depth is bounded by total remaining craft time ≤ 8h.
 *   advanceFactory() runs lazily on read: marks ready jobs collected,
 *   delivers +1 item to inventory, promotes the next queued job.
 *   Premium (player_wallet.premium_until > now) unlocks per-job is_auto:
 *   when an auto job completes and its factory's queue is empty, server
 *   auto-queues one more of the same recipe (if resources allow).
 *
 * Async by construction — routes through the DbAdapter (SQLite or Postgres).
 */
import {
  one,
  q,
  run,
  tx,
  type CraftingJobRow,
  type FarmBuildingRow,
  type FarmRecipeRow,
  type PlayerFactoryRow,
  type ResourceRow,
  type ShopItemRow,
  type WalletRow,
} from '../db/index.js';
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
const SQL_INSERT_RECIPE = `INSERT INTO farm_recipes (id, item_id, meat_cost, bits_cost, data_cost, craft_time_ms, category, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT (id) DO UPDATE SET craft_time_ms = excluded.craft_time_ms, category = excluded.category`;
const SQL_DEDUCT_RESOURCE = `UPDATE resources SET amount = amount - ?, updated_at = ? WHERE user_id = ? AND resource = ? AND amount >= ?`;
const SQL_UPSERT_INVENTORY_ITEM = `INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET qty = player_inventory.qty + 1, updated_at = excluded.updated_at`;
const SQL_SELECT_SHOP_ITEM = `SELECT * FROM shop_items WHERE id = ? AND enabled = 1 AND class = 'item'`;
const SQL_SELECT_WALLET_PREMIUM = `SELECT premium_until FROM player_wallet WHERE user_id = ?`;

const SQL_SELECT_FACTORIES_USER = `SELECT * FROM player_factories WHERE user_id = ? ORDER BY created_at`;
const SQL_SELECT_FACTORY = `SELECT * FROM player_factories WHERE id = ? AND user_id = ?`;
const SQL_INSERT_FACTORY = `INSERT INTO player_factories (id, user_id, factory_type, created_at) VALUES (?, ?, ?, ?)`;
const SQL_COUNT_FACTORIES_USER = `SELECT COUNT(*) AS n FROM player_factories WHERE user_id = ? AND factory_type = ?`;

const SQL_SELECT_ACTIVE_JOB_BY_FACTORY = `SELECT j.*, s.name AS item_name
     FROM crafting_jobs j JOIN shop_items s ON s.id = j.item_id
     WHERE j.factory_id = ? AND j.started_at IS NOT NULL AND j.collected_at IS NULL`;
const SQL_SELECT_QUEUE_BY_FACTORY = `SELECT j.*, s.name AS item_name
     FROM crafting_jobs j JOIN shop_items s ON s.id = j.item_id
     WHERE j.factory_id = ? AND j.collected_at IS NULL
     ORDER BY CASE WHEN j.started_at IS NULL THEN 1 ELSE 0 END ASC, j.created_at ASC`;
const SQL_SELECT_INCOMPLETE_BY_USER = `SELECT j.*, s.name AS item_name
     FROM crafting_jobs j JOIN shop_items s ON s.id = j.item_id
     WHERE j.user_id = ? AND j.collected_at IS NULL AND j.factory_id IS NOT NULL
     ORDER BY j.factory_id, CASE WHEN j.started_at IS NULL THEN 1 ELSE 0 END ASC, j.created_at ASC`;
const SQL_SELECT_NEXT_QUEUED = `SELECT id FROM crafting_jobs
     WHERE factory_id = ? AND started_at IS NULL AND collected_at IS NULL
     ORDER BY created_at ASC LIMIT 1`;
const SQL_START_QUEUED_JOB = `UPDATE crafting_jobs SET started_at = ? WHERE id = ? AND started_at IS NULL AND collected_at IS NULL`;
const SQL_INSERT_JOB = `INSERT INTO crafting_jobs (id, user_id, recipe_id, item_id, factory_id, started_at, duration_ms, is_auto, collected_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`;
const SQL_MARK_JOB_COLLECTED = `UPDATE crafting_jobs SET collected_at = ? WHERE id = ? AND collected_at IS NULL`;
const SQL_SELECT_JOB_USER = `SELECT * FROM crafting_jobs WHERE id = ? AND user_id = ?`;
const SQL_DELETE_JOB_BY_ID = `DELETE FROM crafting_jobs WHERE id = ? AND user_id = ? AND collected_at IS NULL`;
const SQL_SELECT_JOB_JOIN_BY_ID = `SELECT j.*, s.name AS item_name FROM crafting_jobs j JOIN shop_items s ON s.id = j.item_id WHERE j.id = ?`;

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

// ============================================================================
// Factory-typed crafting: multiple factories per user, queued items, category
// gates. Advance loop runs lazily on read and auto-collects finished jobs.
// ============================================================================

export type FactoryTypeId = 'med' | 'chip' | 'rare';

export type FactoryPurchaseCost = {
  readonly meat: number;
  readonly bits: number;
  readonly data: number;
};

export type FactoryTypeInfo = {
  readonly id: FactoryTypeId;
  readonly name: string;
  readonly description: string;
  readonly cost: FactoryPurchaseCost;
};

const FACTORY_TYPE_METADATA: Record<FactoryTypeId, FactoryTypeInfo> = {
  med: {
    id: 'med',
    name: 'Med Factory',
    description: 'Assembles healing kits, status cures, and energy drinks.',
    cost: { meat: 50, bits: 100, data: 25 },
  },
  chip: {
    id: 'chip',
    name: 'Chip Factory',
    description: 'Etches combat mods — Power Chips and Guard Chips.',
    cost: { meat: 100, bits: 100, data: 50 },
  },
  rare: {
    id: 'rare',
    name: 'Rare Factory',
    description: 'Manufactures rare consumables like Digi-Revives.',
    cost: { meat: 200, bits: 200, data: 200 },
  },
};

const QUEUE_MAX_TOTAL_MS = 8 * 60 * 60 * 1000;

const SEED_RECIPES: ReadonlyArray<{
  id: string;
  item_id: string;
  meat: number;
  bits: number;
  data: number;
  craft_time_ms: number;
  category: FactoryTypeId;
}> = [
  { id: 'rcp-heal-small', item_id: 'itm-heal-small', meat: 5, bits: 10, data: 0, craft_time_ms: 60_000, category: 'med' },
  { id: 'rcp-energy-drink', item_id: 'itm-energy-drink', meat: 0, bits: 15, data: 5, craft_time_ms: 120_000, category: 'med' },
  { id: 'rcp-status-cure', item_id: 'itm-status-cure', meat: 10, bits: 10, data: 5, craft_time_ms: 180_000, category: 'med' },
  { id: 'rcp-atk-buff', item_id: 'itm-atk-buff', meat: 20, bits: 20, data: 0, craft_time_ms: 240_000, category: 'chip' },
  { id: 'rcp-def-buff', item_id: 'itm-def-buff', meat: 20, bits: 20, data: 0, craft_time_ms: 240_000, category: 'chip' },
  { id: 'rcp-heal-large', item_id: 'itm-heal-large', meat: 20, bits: 40, data: 10, craft_time_ms: 300_000, category: 'med' },
  { id: 'rcp-digi-revive', item_id: 'itm-digi-revive', meat: 30, bits: 30, data: 30, craft_time_ms: 600_000, category: 'rare' },
];

export async function seedFarmRecipes(): Promise<void> {
  const now = Date.now();
  await tx(async (t) => {
    for (const r of SEED_RECIPES) {
      await t.run(SQL_INSERT_RECIPE, [r.id, r.item_id, r.meat, r.bits, r.data, r.craft_time_ms, r.category, now]);
    }
  });
  log.info('farm.recipes.seed.ok', { count: SEED_RECIPES.length });
}

export async function seedFactoryStarterForUser(userId: string): Promise<void> {
  const existing = await q<PlayerFactoryRow>(SQL_SELECT_FACTORIES_USER, userId);
  if (existing.length > 0) return;
  const now = Date.now();
  await run(SQL_INSERT_FACTORY, newId('fac'), userId, 'med', now);
  log.info('farm.factory.seed.ok', { userId, type: 'med' });
}

const SQL_SELECT_USERS_WITHOUT_FACTORY = `SELECT u.id FROM users u
     WHERE NOT EXISTS (SELECT 1 FROM player_factories pf WHERE pf.user_id = u.id)`;

export async function backfillStarterFactoriesForExistingUsers(): Promise<{ count: number }> {
  const rows = await q<{ id: string }>(SQL_SELECT_USERS_WITHOUT_FACTORY);
  if (rows.length === 0) return { count: 0 };
  const now = Date.now();
  await tx(async (t) => {
    for (const row of rows) {
      await t.run(SQL_INSERT_FACTORY, [newId('fac'), row.id, 'med', now]);
    }
  });
  log.info('farm.factory.backfill.ok', { count: rows.length });
  return { count: rows.length };
}

export type RecipeView = {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly itemDescription: string;
  readonly meatCost: number;
  readonly bitsCost: number;
  readonly dataCost: number;
  readonly craftTimeMs: number;
  readonly category: FactoryTypeId | null;
  readonly canCraft: boolean;
};

export type CraftingJobView = {
  readonly id: string;
  readonly factoryId: string;
  readonly recipeId: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly startedAt: number | null;
  readonly durationMs: number;
  readonly finishesAt: number | null;
  readonly progressPct: number;
  readonly readyToCollect: boolean;
  readonly isAuto: boolean;
  readonly isActive: boolean;
};

export type PlayerFactoryView = {
  readonly id: string;
  readonly type: FactoryTypeId;
  readonly name: string;
  readonly description: string;
  readonly createdAt: number;
  readonly queue: readonly CraftingJobView[];
  readonly queueTotalMs: number;
  readonly queueRemainingCapMs: number;
};

export type FactoryPageView = {
  readonly balances: Record<ResourceKind, number>;
  readonly recipes: readonly RecipeView[];
  readonly ownedFactories: readonly PlayerFactoryView[];
  readonly availableFactories: readonly FactoryTypeInfo[];
  readonly queueMaxMs: number;
};

type CraftingJobJoinRow = CraftingJobRow & { item_name: string };

function jobRowToView(row: CraftingJobJoinRow, now: number): CraftingJobView {
  const started = row.started_at;
  const isActive = started !== null;
  const finishesAt = started === null ? null : started + row.duration_ms;
  const elapsed = started === null ? 0 : Math.max(0, now - started);
  const progressPct = started === null ? 0 : Math.min(100, Math.max(0, (elapsed / row.duration_ms) * 100));
  return {
    id: row.id,
    factoryId: row.factory_id ?? '',
    recipeId: row.recipe_id,
    itemId: row.item_id,
    itemName: row.item_name,
    startedAt: started,
    durationMs: row.duration_ms,
    finishesAt,
    progressPct,
    readyToCollect: finishesAt !== null && now >= finishesAt,
    isAuto: row.is_auto === 1,
    isActive,
  };
}

async function isUserPremium(userId: string, now: number = Date.now()): Promise<boolean> {
  const row = await one<{ premium_until: number | null }>(SQL_SELECT_WALLET_PREMIUM, userId);
  return (row?.premium_until ?? 0) > now;
}

const ADVANCE_LOOP_SAFETY_CAP = 200;

async function advanceFactory(userId: string, factoryId: string): Promise<void> {
  for (let i = 0; i < ADVANCE_LOOP_SAFETY_CAP; i++) {
    const now = Date.now();
    const active = await one<CraftingJobJoinRow>(SQL_SELECT_ACTIVE_JOB_BY_FACTORY, factoryId);

    if (!active) {
      const next = await one<{ id: string }>(SQL_SELECT_NEXT_QUEUED, factoryId);
      if (!next) return;
      const info = await run(SQL_START_QUEUED_JOB, now, next.id);
      if (info.changes === 0) return;
      continue;
    }

    if (active.started_at === null) return;
    if (now < active.started_at + active.duration_ms) return;

    const recipe = await one<FarmRecipeRow>(SQL_SELECT_RECIPE, active.recipe_id);
    if (!recipe) return;

    const wasAuto = active.is_auto === 1;
    let advanced = false;

    await tx(async (t) => {
      const info = await t.run(SQL_MARK_JOB_COLLECTED, [now, active.id]);
      if (info.changes === 0) return;
      await t.run(SQL_UPSERT_INVENTORY_ITEM, [userId, active.item_id, now]);
      advanced = true;

      const nextQueued = await t.query<{ id: string }>(SQL_SELECT_NEXT_QUEUED, [factoryId]);
      if (nextQueued.length > 0) {
        await t.run(SQL_START_QUEUED_JOB, [now, nextQueued[0]!.id]);
        return;
      }

      if (!wasAuto) return;
      const premium = await t.query<{ premium_until: number | null }>(SQL_SELECT_WALLET_PREMIUM, [userId]);
      const premiumUntil = premium[0]?.premium_until ?? 0;
      if (premiumUntil <= now) return;

      const balances: Record<ResourceKind, number> = { Meat: 0, Bits: 0, Data: 0 };
      for (const r of await t.query<ResourceRow>(SQL_SELECT_RESOURCES, [userId])) balances[r.resource] = r.amount;
      if (
        balances.Meat < recipe.meat_cost ||
        balances.Bits < recipe.bits_cost ||
        balances.Data < recipe.data_cost
      ) return;

      const costs: Array<[ResourceKind, number]> = [
        ['Meat', recipe.meat_cost],
        ['Bits', recipe.bits_cost],
        ['Data', recipe.data_cost],
      ];
      for (const [res, cost] of costs) {
        if (cost <= 0) continue;
        const dedInfo = await t.run(SQL_DEDUCT_RESOURCE, [cost, now, userId, res, cost]);
        if (dedInfo.changes === 0) return;
      }
      await t.run(SQL_INSERT_JOB, [
        newId('crf'),
        userId,
        recipe.id,
        recipe.item_id,
        factoryId,
        now,
        recipe.craft_time_ms,
        1,
        now,
      ]);
    });

    if (!advanced) return;
    log.info('farm.craft.advance', { userId, factoryId, jobId: active.id, itemId: active.item_id });
  }
  log.warn('farm.craft.advance.cap-hit', { userId, factoryId, cap: ADVANCE_LOOP_SAFETY_CAP });
}

async function advanceAllFactories(userId: string): Promise<void> {
  const factories = await q<PlayerFactoryRow>(SQL_SELECT_FACTORIES_USER, userId);
  for (const f of factories) {
    await advanceFactory(userId, f.id);
  }
}

function computeQueueTotalMs(queue: readonly CraftingJobView[], now: number): number {
  let total = 0;
  for (const j of queue) {
    if (j.isActive && j.finishesAt !== null) {
      total += Math.max(0, j.finishesAt - now);
    } else {
      total += j.durationMs;
    }
  }
  return total;
}

export async function getUserFactories(userId: string): Promise<PlayerFactoryView[]> {
  await advanceAllFactories(userId);
  const rows = await q<PlayerFactoryRow>(SQL_SELECT_FACTORIES_USER, userId);
  const jobRows = await q<CraftingJobJoinRow>(SQL_SELECT_INCOMPLETE_BY_USER, userId);
  const now = Date.now();

  const jobsByFactory = new Map<string, CraftingJobJoinRow[]>();
  for (const j of jobRows) {
    if (j.factory_id === null) continue;
    const arr = jobsByFactory.get(j.factory_id) ?? [];
    arr.push(j);
    jobsByFactory.set(j.factory_id, arr);
  }

  return rows.map((f) => {
    const meta = FACTORY_TYPE_METADATA[f.factory_type];
    const jobs = jobsByFactory.get(f.id) ?? [];
    const queue = jobs.map((j) => jobRowToView(j, now));
    const totalMs = computeQueueTotalMs(queue, now);
    return {
      id: f.id,
      type: f.factory_type,
      name: meta.name,
      description: meta.description,
      createdAt: f.created_at,
      queue,
      queueTotalMs: totalMs,
      queueRemainingCapMs: Math.max(0, QUEUE_MAX_TOTAL_MS - totalMs),
    };
  });
}

export type BuyFactoryError = 'invalid-type' | 'already-owned' | 'insufficient-resources';

export async function buyFactory(
  userId: string,
  type: string,
): Promise<
  | { ok: true; factory: PlayerFactoryView; balances: Record<ResourceKind, number> }
  | { ok: false; error: BuyFactoryError; missing?: Partial<Record<ResourceKind, number>> }
> {
  if (type !== 'med' && type !== 'chip' && type !== 'rare') return { ok: false, error: 'invalid-type' };
  const meta = FACTORY_TYPE_METADATA[type];
  const now = Date.now();
  const factoryId = newId('fac');
  let deficit: Partial<Record<ResourceKind, number>> | null = null;
  let alreadyOwned = false;

  await tx(async (t) => {
    const existing = await t.query<{ n: number }>(SQL_COUNT_FACTORIES_USER, [userId, type]);
    if ((existing[0]?.n ?? 0) > 0) {
      alreadyOwned = true;
      return;
    }

    const balances: Record<ResourceKind, number> = { Meat: 0, Bits: 0, Data: 0 };
    for (const r of await t.query<ResourceRow>(SQL_SELECT_RESOURCES, [userId])) balances[r.resource] = r.amount;
    const missing: Partial<Record<ResourceKind, number>> = {};
    if (balances.Meat < meta.cost.meat) missing.Meat = meta.cost.meat - balances.Meat;
    if (balances.Bits < meta.cost.bits) missing.Bits = meta.cost.bits - balances.Bits;
    if (balances.Data < meta.cost.data) missing.Data = meta.cost.data - balances.Data;
    if (Object.keys(missing).length > 0) {
      deficit = missing;
      return;
    }

    const costs: Array<[ResourceKind, number]> = [
      ['Meat', meta.cost.meat],
      ['Bits', meta.cost.bits],
      ['Data', meta.cost.data],
    ];
    for (const [res, cost] of costs) {
      if (cost <= 0) continue;
      await t.run(SQL_DEDUCT_RESOURCE, [cost, now, userId, res, cost]);
    }
    await t.run(SQL_INSERT_FACTORY, [factoryId, userId, type, now]);
  });

  if (alreadyOwned) return { ok: false, error: 'already-owned' };
  if (deficit) return { ok: false, error: 'insufficient-resources', missing: deficit };

  const balancesAfter: Record<ResourceKind, number> = { Meat: 0, Bits: 0, Data: 0 };
  for (const r of await q<ResourceRow>(SQL_SELECT_RESOURCES, userId)) balancesAfter[r.resource] = r.amount;
  const factory: PlayerFactoryView = {
    id: factoryId,
    type,
    name: meta.name,
    description: meta.description,
    createdAt: now,
    queue: [],
    queueTotalMs: 0,
    queueRemainingCapMs: QUEUE_MAX_TOTAL_MS,
  };
  log.info('farm.factory.buy', { userId, factoryId, type });
  return { ok: true, factory, balances: balancesAfter };
}

export type QueueCraftError =
  | 'factory-not-found'
  | 'recipe-not-found'
  | 'item-missing'
  | 'category-mismatch'
  | 'queue-full'
  | 'insufficient-resources'
  | 'premium-required'
  | 'invalid-count';

const QUEUE_COUNT_MAX = 100;

export async function queueItem(
  userId: string,
  factoryId: string,
  recipeId: string,
  opts?: { auto?: boolean; count?: number },
): Promise<
  | { ok: true; job: CraftingJobView; queuedCount: number; balances: Record<ResourceKind, number> }
  | {
      ok: false;
      error: QueueCraftError;
      missing?: Partial<Record<ResourceKind, number>>;
      queueRemainingCapMs?: number;
    }
> {
  const auto = opts?.auto === true;
  const requestedCount = opts?.count ?? 1;
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > QUEUE_COUNT_MAX) {
    return { ok: false, error: 'invalid-count' };
  }
  if (auto && !(await isUserPremium(userId))) return { ok: false, error: 'premium-required' };

  const factory = await one<PlayerFactoryRow>(SQL_SELECT_FACTORY, factoryId, userId);
  if (!factory) return { ok: false, error: 'factory-not-found' };

  const recipe = await one<FarmRecipeRow>(SQL_SELECT_RECIPE, recipeId);
  if (!recipe) return { ok: false, error: 'recipe-not-found' };
  const item = await one<ShopItemRow>(SQL_SELECT_SHOP_ITEM, recipe.item_id);
  if (!item) return { ok: false, error: 'item-missing' };

  if (recipe.category !== factory.factory_type) return { ok: false, error: 'category-mismatch' };

  await advanceFactory(userId, factoryId);

  const jobRows = await q<CraftingJobJoinRow>(SQL_SELECT_QUEUE_BY_FACTORY, factoryId);
  const now = Date.now();
  const currentQueue = jobRows.map((j) => jobRowToView(j, now));
  const currentTotalMs = computeQueueTotalMs(currentQueue, now);
  const remainingCapMs = Math.max(0, QUEUE_MAX_TOTAL_MS - currentTotalMs);
  if (currentTotalMs + recipe.craft_time_ms * requestedCount > QUEUE_MAX_TOTAL_MS) {
    return {
      ok: false,
      error: 'queue-full',
      queueRemainingCapMs: remainingCapMs,
    };
  }

  const totalMeat = recipe.meat_cost * requestedCount;
  const totalBits = recipe.bits_cost * requestedCount;
  const totalData = recipe.data_cost * requestedCount;

  let deficit: Partial<Record<ResourceKind, number>> | null = null;
  const insertedJobIds: string[] = [];

  await tx(async (t) => {
    const balances: Record<ResourceKind, number> = { Meat: 0, Bits: 0, Data: 0 };
    for (const r of await t.query<ResourceRow>(SQL_SELECT_RESOURCES, [userId])) balances[r.resource] = r.amount;
    const missing: Partial<Record<ResourceKind, number>> = {};
    if (balances.Meat < totalMeat) missing.Meat = totalMeat - balances.Meat;
    if (balances.Bits < totalBits) missing.Bits = totalBits - balances.Bits;
    if (balances.Data < totalData) missing.Data = totalData - balances.Data;
    if (Object.keys(missing).length > 0) {
      deficit = missing;
      return;
    }

    const costs: Array<[ResourceKind, number]> = [
      ['Meat', totalMeat],
      ['Bits', totalBits],
      ['Data', totalData],
    ];
    for (const [res, cost] of costs) {
      if (cost <= 0) continue;
      const info = await t.run(SQL_DEDUCT_RESOURCE, [cost, now, userId, res, cost]);
      if (info.changes === 0) {
        deficit = { [res]: cost };
        throw new Error('craft-race');
      }
    }

    const activeRows = await t.query<CraftingJobJoinRow>(SQL_SELECT_ACTIVE_JOB_BY_FACTORY, [factoryId]);
    const factoryHasActive = activeRows.length > 0;

    for (let i = 0; i < requestedCount; i++) {
      const isFirst = i === 0;
      const isLast = i === requestedCount - 1;
      const startedAt = isFirst && !factoryHasActive ? now : null;
      const jobIsAuto = auto && isLast ? 1 : 0;
      const id = newId('crf');
      insertedJobIds.push(id);
      await t.run(SQL_INSERT_JOB, [
        id,
        userId,
        recipe.id,
        recipe.item_id,
        factoryId,
        startedAt,
        recipe.craft_time_ms,
        jobIsAuto,
        now,
      ]);
    }
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message === 'craft-race') return;
    throw err;
  });

  if (deficit) return { ok: false, error: 'insufficient-resources', missing: deficit };
  if (insertedJobIds.length === 0) {
    return { ok: false, error: 'insufficient-resources', missing: deficit ?? {} };
  }

  const balancesAfter: Record<ResourceKind, number> = { Meat: 0, Bits: 0, Data: 0 };
  for (const r of await q<ResourceRow>(SQL_SELECT_RESOURCES, userId)) balancesAfter[r.resource] = r.amount;
  const firstId = insertedJobIds[0]!;
  const inserted = await one<CraftingJobJoinRow>(SQL_SELECT_JOB_JOIN_BY_ID, firstId);
  if (!inserted) throw new Error('queueItem: job disappeared after insert');
  const jobView = jobRowToView(inserted, Date.now());
  log.info('farm.craft.queue', {
    userId,
    factoryId,
    recipeId,
    itemId: recipe.item_id,
    auto,
    count: requestedCount,
    firstJobId: firstId,
  });
  return { ok: true, job: jobView, queuedCount: requestedCount, balances: balancesAfter };
}

export type CancelJobError = 'job-not-found';

export async function cancelJob(
  userId: string,
  jobId: string,
): Promise<
  | { ok: true; refunded: Partial<Record<ResourceKind, number>>; balances: Record<ResourceKind, number> }
  | { ok: false; error: CancelJobError }
> {
  const job = await one<CraftingJobRow>(SQL_SELECT_JOB_USER, jobId, userId);
  if (!job || job.collected_at !== null) return { ok: false, error: 'job-not-found' };
  const recipe = await one<FarmRecipeRow>(SQL_SELECT_RECIPE, job.recipe_id);
  if (!recipe) return { ok: false, error: 'job-not-found' };

  const now = Date.now();
  const refunded: Partial<Record<ResourceKind, number>> = {};
  let raced = false;

  await tx(async (t) => {
    const info = await t.run(SQL_DELETE_JOB_BY_ID, [jobId, userId]);
    if (info.changes === 0) {
      raced = true;
      return;
    }

    const costs: Array<[ResourceKind, number]> = [
      ['Meat', recipe.meat_cost],
      ['Bits', recipe.bits_cost],
      ['Data', recipe.data_cost],
    ];
    for (const [res, cost] of costs) {
      if (cost <= 0) continue;
      await t.run(SQL_UPSERT_RESOURCE, [userId, res, cost, now]);
      refunded[res] = cost;
    }

    if (job.factory_id !== null && job.started_at !== null) {
      const next = await t.query<{ id: string }>(SQL_SELECT_NEXT_QUEUED, [job.factory_id]);
      if (next.length > 0) {
        await t.run(SQL_START_QUEUED_JOB, [now, next[0]!.id]);
      }
    }
  });

  if (raced) return { ok: false, error: 'job-not-found' };
  const balances: Record<ResourceKind, number> = { Meat: 0, Bits: 0, Data: 0 };
  for (const r of await q<ResourceRow>(SQL_SELECT_RESOURCES, userId)) balances[r.resource] = r.amount;
  log.info('farm.craft.cancel', { userId, jobId, factoryId: job.factory_id, refunded });
  return { ok: true, refunded, balances };
}

export async function readFactoryPage(userId: string): Promise<FactoryPageView> {
  await advanceAllFactories(userId);
  const balances: Record<ResourceKind, number> = { Meat: 0, Bits: 0, Data: 0 };
  for (const r of await q<ResourceRow>(SQL_SELECT_RESOURCES, userId)) balances[r.resource] = r.amount;

  type RecipeJoinRow = FarmRecipeRow & { item_name: string; item_description: string };
  const recipeRows = await q<RecipeJoinRow>(SQL_SELECT_RECIPES);
  const recipes: RecipeView[] = recipeRows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    itemDescription: row.item_description,
    meatCost: row.meat_cost,
    bitsCost: row.bits_cost,
    dataCost: row.data_cost,
    craftTimeMs: row.craft_time_ms,
    category: row.category,
    canCraft: balances.Meat >= row.meat_cost && balances.Bits >= row.bits_cost && balances.Data >= row.data_cost,
  }));

  const ownedFactories = await getUserFactories(userId);
  const ownedTypes = new Set(ownedFactories.map((f) => f.type));
  const availableFactories = (['med', 'chip', 'rare'] as FactoryTypeId[])
    .filter((t) => !ownedTypes.has(t))
    .map((t) => FACTORY_TYPE_METADATA[t]);

  return {
    balances,
    recipes,
    ownedFactories,
    availableFactories,
    queueMaxMs: QUEUE_MAX_TOTAL_MS,
  };
}

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
