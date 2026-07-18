/**
 * Building blueprints: admin-editable catalog of building types.
 *
 *   Every farm/training building instantiated for a player was CREATED FROM
 *   a blueprint (kind + building_type + resource + rate + capacity + upgrade
 *   cost). Instances in farm_buildings are DECOUPLED after creation — editing
 *   a blueprint does NOT retroactively mutate existing player buildings.
 *
 *   starter_seed=1 → seed one for every new player at register time
 *   shop_price=INTEGER → surface in shop as buyable for that many credits
 *
 * `seedInitialBlueprints()` is idempotent (INSERT OR IGNORE by unique name)
 * and populates the 7 baseline blueprints that mirror the previously-hardcoded
 * SEED_BUILDINGS + the Training Ground / Training Station / Premium variants.
 */
import { one, q, run, type BuildingBlueprintRow } from '../db/index.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';

const SQL_SELECT_ALL = `SELECT * FROM building_blueprints ORDER BY building_type, name`;
const SQL_SELECT_BY_ID = `SELECT * FROM building_blueprints WHERE id = ?`;
const SQL_SELECT_BY_NAME = `SELECT * FROM building_blueprints WHERE name = ?`;
const SQL_SELECT_STARTER = `SELECT * FROM building_blueprints WHERE starter_seed = 1 AND enabled = 1 AND building_type = ? ORDER BY created_at`;
const SQL_INSERT = `INSERT INTO building_blueprints (id, name, description, building_type, resource, rate_per_hour, capacity, upgrade_cost, starter_seed, shop_price, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_INSERT_IF_ABSENT = `INSERT INTO building_blueprints (id, name, description, building_type, resource, rate_per_hour, capacity, upgrade_cost, starter_seed, shop_price, enabled, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM building_blueprints WHERE name = ?)`;
const SQL_UPDATE = `UPDATE building_blueprints SET name = ?, description = ?, building_type = ?, resource = ?, rate_per_hour = ?, capacity = ?, upgrade_cost = ?, starter_seed = ?, shop_price = ?, enabled = ?, updated_at = ? WHERE id = ?`;
const SQL_DELETE = `DELETE FROM building_blueprints WHERE id = ?`;

export type BlueprintView = {
  id: string;
  name: string;
  description: string;
  buildingType: 'resource_generator' | 'training' | 'training_premium';
  resource: 'Meat' | 'Bits' | 'Data' | null;
  ratePerHour: number;
  capacity: number;
  upgradeCost: number;
  starterSeed: boolean;
  shopPrice: number | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type BlueprintInput = {
  name: string;
  description?: string | undefined;
  buildingType: 'resource_generator' | 'training' | 'training_premium';
  resource?: 'Meat' | 'Bits' | 'Data' | null | undefined;
  ratePerHour?: number | undefined;
  capacity?: number | undefined;
  upgradeCost?: number | undefined;
  starterSeed?: boolean | undefined;
  shopPrice?: number | null | undefined;
  enabled?: boolean | undefined;
};

function rowToView(row: BuildingBlueprintRow): BlueprintView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    buildingType: row.building_type,
    resource: row.resource,
    ratePerHour: row.rate_per_hour,
    capacity: row.capacity,
    upgradeCost: row.upgrade_cost,
    starterSeed: row.starter_seed === 1,
    shopPrice: row.shop_price,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listBlueprints(): Promise<BlueprintView[]> {
  const rows = await q<BuildingBlueprintRow>(SQL_SELECT_ALL);
  return rows.map(rowToView);
}

export async function getBlueprint(id: string): Promise<BlueprintView | null> {
  const row = await one<BuildingBlueprintRow>(SQL_SELECT_BY_ID, id);
  return row ? rowToView(row) : null;
}

export async function starterBlueprintsFor(
  buildingType: 'resource_generator' | 'training' | 'training_premium',
): Promise<BlueprintView[]> {
  const rows = await q<BuildingBlueprintRow>(SQL_SELECT_STARTER, buildingType);
  return rows.map(rowToView);
}

export type BlueprintError =
  | 'invalid-name'
  | 'invalid-building-type'
  | 'invalid-resource'
  | 'duplicate-name'
  | 'not-found'
  | 'resource-required'
  | 'resource-not-allowed';

export type BlueprintOutcome<T> =
  | { ok: true; blueprint: T }
  | { ok: false; error: BlueprintError };

function validateInput(input: BlueprintInput): BlueprintError | null {
  const name = input.name?.trim();
  if (!name || name.length < 2 || name.length > 48) return 'invalid-name';
  if (!['resource_generator', 'training', 'training_premium'].includes(input.buildingType)) {
    return 'invalid-building-type';
  }
  if (input.resource != null && !['Meat', 'Bits', 'Data'].includes(input.resource)) {
    return 'invalid-resource';
  }
  if (input.buildingType === 'resource_generator' && (input.resource == null)) {
    return 'resource-required';
  }
  if (input.buildingType !== 'resource_generator' && input.resource != null) {
    return 'resource-not-allowed';
  }
  return null;
}

export async function createBlueprint(input: BlueprintInput): Promise<BlueprintOutcome<BlueprintView>> {
  const err = validateInput(input);
  if (err) return { ok: false, error: err };
  const existing = await one<BuildingBlueprintRow>(SQL_SELECT_BY_NAME, input.name.trim());
  if (existing) return { ok: false, error: 'duplicate-name' };
  const now = Date.now();
  const id = newId('bp');
  const row: BuildingBlueprintRow = {
    id,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    building_type: input.buildingType,
    resource: input.resource ?? null,
    rate_per_hour: Math.max(0, Math.floor(input.ratePerHour ?? 0)),
    capacity: Math.max(0, Math.floor(input.capacity ?? 0)),
    upgrade_cost: Math.max(1, Math.floor(input.upgradeCost ?? 500)),
    starter_seed: input.starterSeed ? 1 : 0,
    shop_price: input.shopPrice != null && input.shopPrice > 0 ? Math.floor(input.shopPrice) : null,
    enabled: input.enabled === false ? 0 : 1,
    created_at: now,
    updated_at: now,
  };
  await run(SQL_INSERT, [
    row.id, row.name, row.description, row.building_type, row.resource,
    row.rate_per_hour, row.capacity, row.upgrade_cost,
    row.starter_seed, row.shop_price, row.enabled,
    row.created_at, row.updated_at,
  ]);
  log.info('blueprint.create', { id: row.id, name: row.name, type: row.building_type });
  return { ok: true, blueprint: rowToView(row) };
}

export async function updateBlueprint(id: string, input: BlueprintInput): Promise<BlueprintOutcome<BlueprintView>> {
  const existing = await one<BuildingBlueprintRow>(SQL_SELECT_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  const err = validateInput(input);
  if (err) return { ok: false, error: err };
  const nameCollide = await one<BuildingBlueprintRow>(SQL_SELECT_BY_NAME, input.name.trim());
  if (nameCollide && nameCollide.id !== id) return { ok: false, error: 'duplicate-name' };
  const now = Date.now();
  const merged: BuildingBlueprintRow = {
    ...existing,
    name: input.name.trim(),
    description: input.description?.trim() ?? existing.description,
    building_type: input.buildingType,
    resource: input.resource ?? null,
    rate_per_hour: Math.max(0, Math.floor(input.ratePerHour ?? existing.rate_per_hour)),
    capacity: Math.max(0, Math.floor(input.capacity ?? existing.capacity)),
    upgrade_cost: Math.max(1, Math.floor(input.upgradeCost ?? existing.upgrade_cost)),
    starter_seed: input.starterSeed === true ? 1 : input.starterSeed === false ? 0 : existing.starter_seed,
    shop_price: input.shopPrice === null ? null : input.shopPrice != null && input.shopPrice > 0 ? Math.floor(input.shopPrice) : existing.shop_price,
    enabled: input.enabled === true ? 1 : input.enabled === false ? 0 : existing.enabled,
    updated_at: now,
  };
  await run(SQL_UPDATE, [
    merged.name, merged.description, merged.building_type, merged.resource,
    merged.rate_per_hour, merged.capacity, merged.upgrade_cost,
    merged.starter_seed, merged.shop_price, merged.enabled,
    merged.updated_at, id,
  ]);
  log.info('blueprint.update', { id, name: merged.name });
  return { ok: true, blueprint: rowToView(merged) };
}

export async function deleteBlueprint(id: string): Promise<BlueprintOutcome<{ id: string }>> {
  const existing = await one<BuildingBlueprintRow>(SQL_SELECT_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  await run(SQL_DELETE, id);
  log.info('blueprint.delete', { id, name: existing.name });
  return { ok: true, blueprint: { id } };
}

type SeedRow = Omit<BlueprintInput, 'starterSeed'> & { starterSeed: boolean };

const INITIAL_BLUEPRINTS: SeedRow[] = [
  {
    name: 'Meat Farm',
    description: 'Produces Meat at 120/hr, capacity 960. Fuels basic combat items and mon feeding.',
    buildingType: 'resource_generator',
    resource: 'Meat',
    ratePerHour: 120,
    capacity: 960,
    upgradeCost: 900,
    starterSeed: true,
  },
  {
    name: 'Bit Foundry',
    description: 'Produces Bits at 80/hr, capacity 640. Bits fund shop purchases and upgrades.',
    buildingType: 'resource_generator',
    resource: 'Bits',
    ratePerHour: 80,
    capacity: 640,
    upgradeCost: 650,
    starterSeed: true,
  },
  {
    name: 'Data Spire',
    description: 'Produces Data at 45/hr, capacity 540. Rare resource used for high-tier upgrades.',
    buildingType: 'resource_generator',
    resource: 'Data',
    ratePerHour: 45,
    capacity: 540,
    upgradeCost: 1200,
    starterSeed: true,
  },
  {
    name: 'Bio Lab',
    description: 'Produces Meat at 60/hr, capacity 480. Secondary Meat source with lower upgrade cost.',
    buildingType: 'resource_generator',
    resource: 'Meat',
    ratePerHour: 60,
    capacity: 480,
    upgradeCost: 520,
    starterSeed: true,
  },
  {
    name: 'Training Ground',
    description: 'Free starter training slot. Trains one stat at a time.',
    buildingType: 'training',
    upgradeCost: 500,
    starterSeed: true,
  },
  {
    name: 'Training Station',
    description: 'Additional single-slot training facility. Trains one stat at a time.',
    buildingType: 'training',
    upgradeCost: 500,
    starterSeed: false,
    shopPrice: 500,
  },
  {
    name: 'Premium Training Station',
    description: 'Advanced facility. Trains two stats simultaneously for faster progression.',
    buildingType: 'training_premium',
    upgradeCost: 2000,
    starterSeed: false,
    shopPrice: 2000,
  },
];

export async function seedInitialBlueprints(): Promise<number> {
  const now = Date.now();
  let inserted = 0;
  for (const bp of INITIAL_BLUEPRINTS) {
    const id = newId('bp');
    const result = await run(SQL_INSERT_IF_ABSENT, [
      id, bp.name, bp.description ?? '', bp.buildingType, bp.resource ?? null,
      bp.ratePerHour ?? 0, bp.capacity ?? 0, bp.upgradeCost ?? 500,
      bp.starterSeed ? 1 : 0,
      bp.shopPrice != null ? bp.shopPrice : null,
      1,
      now, now,
      bp.name,
    ]);
    if (result.changes > 0) inserted += 1;
  }
  if (inserted > 0) log.info('blueprint.seed.ok', { inserted, total: INITIAL_BLUEPRINTS.length });
  return inserted;
}
