/**
 * better-sqlite3 wrapper with typed helpers. One connection per process; we
 * use WAL for concurrent readers and NORMAL synchronous for reasonable
 * durability with 20-100× write throughput vs FULL.
 *
 * All prepared statements live here so the query graph is centralized and
 * easy to audit. Higher layers get typed row shapes.
 */
import Database, { type Database as DatabaseHandle, type Statement } from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { log } from '../util/log.js';
import { applyColumnMigrations } from './sqlite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, 'schema.sql');

let dbInstance: DatabaseHandle | null = null;

/** Get (and lazily open) the process-wide SQLite handle.
 *  Only for legacy sync callers — new code should use the async q/one/run/tx
 *  helpers below, which route through the DbAdapter and work with Postgres too.
 */
export function db(): DatabaseHandle {
  if (config.DATABASE !== 'sqlite') {
    throw new Error(
      `db() sync accessor requires DATABASE=sqlite (got '${config.DATABASE}'). ` +
      `Use q()/one()/run()/tx() from src/db/index.ts instead — they route through the DbAdapter.`,
    );
  }
  if (dbInstance) return dbInstance;
  mkdirSync(dirname(config.paths.db), { recursive: true });
  const handle = new Database(config.paths.db);
  handle.pragma('journal_mode = WAL');
  handle.pragma('synchronous = NORMAL');
  handle.pragma('foreign_keys = ON');
  handle.pragma('busy_timeout = 5000');
  handle.pragma('temp_store = MEMORY');
  handle.pragma('cache_size = -20000'); // 20MB page cache
  applySchema(handle);
  dbInstance = handle;
  log.info('db.opened', { path: config.paths.db });
  return handle;
}

/** Apply schema idempotently. All CREATE TABLEs use IF NOT EXISTS. The
 *  legacy SQLite column backfill and numbered migrations both run via the
 *  async SqliteAdapter — this sync path is a compatibility shim for the
 *  `db:init` CLI and legacy `prep()` callers. */
function applySchema(handle: DatabaseHandle): void {
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  handle.exec(sql);
  applyColumnMigrations(handle);
}

/** Close the connection (used in tests). */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// ============================================================================
// Row types — mirror the schema. Keep in sync with schema.sql.
// ============================================================================

export type UserRow = {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  is_admin: 0 | 1;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
  disabled: 0 | 1;
  onboarding_completed_at: number | null;
  mmr: number;
  locale_pref: string | null;
};

export type SessionRow = {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  user_agent: string | null;
  ip: string | null;
};

export type ScrapedRow = {
  skullbot_id: number;
  name: string;
  stage: string;
  attribute: string;
  portrait_url: string;
  dot_url: string;
  wikimon_slug: string | null;
  raw_json: string;
  scraped_at: number;
  in_catalog: 0 | 1;
};

export type RosterRow = {
  id: string;
  user_id: string;
  catalog_id: string;
  nickname: string;
  level: number;
  xp: number;
  hp_bonus: number;
  en_bonus: number;
  atk_bonus: number;
  def_bonus: number;
  int_bonus: number;
  spd_bonus: number;
  mood: number;
  status: 'resting' | 'training' | 'party' | 'adventure';
  slot_index: number | null;
  revive_at: number | null;
  pets_today: number;
  pets_day: string | null;
  listed_at: number | null;
  evolution_history: string | null;
  equipped_skill_ids: string | null;
  stage_pools: string | null;
  created_at: number;
  updated_at: number;
};

export type MarketListingRow = {
  id: string;
  mon_id: string;
  seller_id: string;
  price_credits: number;
  listed_at: number;
  sold_at: number | null;
  sold_to: string | null;
  canceled_at: number | null;
};

export type ResourceRow = {
  user_id: string;
  resource: 'Meat' | 'Bits' | 'Data';
  amount: number;
  updated_at: number;
};

export type WalletRow = {
  user_id: string;
  credits: number;
  streak_day: number;
  last_claim_at: number | null;
  premium_until: number | null;
  updated_at: number;
};

export type FarmBuildingRow = {
  id: string;
  user_id: string;
  kind: string;
  building_type: 'resource_generator' | 'training' | 'training_premium';
  resource: 'Meat' | 'Bits' | 'Data';
  level: number;
  rate_per_hour: number;
  capacity: number;
  produced: number;
  last_touch: number;
  upgrade_cost: number;
  created_at: number;
};

export type TrainingSessionRow = {
  id: string;
  user_id: string;
  building_id: string;
  mon_id: string;
  stat_kinds: string;
  started_at: number;
  duration_ms: number;
  collected_at: number | null;
};

export type BuildingBlueprintRow = {
  id: string;
  name: string;
  description: string;
  building_type: 'resource_generator' | 'training' | 'training_premium';
  resource: 'Meat' | 'Bits' | 'Data' | null;
  rate_per_hour: number;
  capacity: number;
  upgrade_cost: number;
  starter_seed: 0 | 1;
  shop_price: number | null;
  enabled: 0 | 1;
  created_at: number;
  updated_at: number;
};

export type SkillCatalogRow = {
  id: string;
  name: string;
  description: string;
  element: 'fire' | 'water' | 'plant' | 'ice' | 'electricity' | 'earth' | 'steel' | 'wind' | 'light' | 'dark' | 'null';
  energy_cost: number;
  cooldown: number;
  actions_json: string;
  tags_json: string;
  animation: string | null;
  enabled: 0 | 1;
  created_at: number;
  updated_at: number;
  name_pt: string;
  description_pt: string | null;
  stage: 'Baby' | 'In-Training' | 'Rookie' | 'Champion' | 'Ultimate' | 'Mega' | null;
  slot_role: string | null;
  upgrade_of: string | null;
  tier_2: 0 | 1;
};

export type MatchRow = {
  id: string;
  player_a: string;
  player_b: string;
  winner: string | null;
  outcome: 'win_a' | 'win_b' | 'draw' | 'fled_a' | 'fled_b' | 'abandoned';
  rounds: number;
  started_at: number;
  ended_at: number;
  log: string;
};

export type FriendshipRow = {
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: number;
  updated_at: number;
};

export type ShopItemRow = {
  id: string;
  name: string;
  description: string;
  price_credits: number;
  kind: string;
  class: 'product' | 'item';
  payload: string;
  enabled: 0 | 1;
  is_quest_item: 0 | 1;
  created_at: number;
};

export type InventoryRow = {
  user_id: string;
  item_id: string;
  qty: number;
  updated_at: number;
};

export type PendingBuffRow = {
  id: string;
  user_id: string;
  mon_id: string | null;
  effect_kind: 'hp_pct' | 'en_pct' | 'xp_mult';
  magnitude: number;
  source_item: string | null;
  created_at: number;
  consumed_at: number | null;
};

export type OnboardingConfigRow = {
  id: 1;
  intro_dialogue: string;
  bg_image: string;
  updated_at: number;
};

export type GameSettingsRow = {
  id: 1;
  xp_rate: number;
  damage_rate: number;
  updated_at: number;
};

export type OnboardingTeamRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  mon_1_catalog_id: string;
  mon_2_catalog_id: string;
  mon_3_catalog_id: string;
  sort_order: number;
  enabled: 0 | 1;
  created_at: number;
  updated_at: number;
};

export type WorldPositionRow = {
  user_id: string;
  world_seed: number;
  x: number;
  y: number;
  steps_taken: number;
  last_move_at: number;
  updated_at: number;
};

export type SpeciesDataRow = {
  user_id: string;
  catalog_id: string;
  percent: number;
  kills: number;
  updated_at: number;
};

export type PendingHatchRow = {
  id: string;
  user_id: string;
  target_catalog: string;
  rookie_catalog: string;
  chip_items: string | null;
  hatch_at: number;
  created_at: number;
};

export type CatalogLootRow = {
  id: string;
  catalog_id: string;
  item_id: string;
  drop_pct: number;
  qty_min: number;
  qty_max: number;
  updated_at: number;
};

export type FarmRecipeRow = {
  id: string;
  item_id: string;
  meat_cost: number;
  bits_cost: number;
  data_cost: number;
  craft_time_ms: number;
  category: 'med' | 'chip' | 'rare' | 'pantry' | null;
  enabled: 0 | 1;
  created_at: number;
};

export type PlayerFactoryRow = {
  id: string;
  user_id: string;
  factory_type: 'med' | 'chip' | 'rare' | 'pantry';
  level: number;
  upgrade_cost: number;
  craft_time_multiplier: number;
  created_at: number;
};

export type CraftingJobRow = {
  id: string;
  user_id: string;
  recipe_id: string;
  item_id: string;
  factory_id: string | null;
  started_at: number | null;
  duration_ms: number;
  is_auto: 0 | 1;
  collected_at: number | null;
  created_at: number;
};

export type AdventureRow = {
  id: string;
  user_id: string;
  mon_ids: string;
  distance_ms: number;
  provisions_spent: number;
  started_at: number;
  collected_at: number | null;
  seed: number;
  report: string | null;
  created_at: number;
};

export type DungeonWarpRow = {
  id: string;
  dungeon_id: string;
  x: number;
  y: number;
  target_dungeon_id: string | null;
  label: string | null;
  created_at: number;
  updated_at: number;
};

export type DungeonDoorRow = {
  id: string;
  dungeon_id: string;
  x: number;
  y: number;
  key_item_id: string;
  label: string | null;
  created_at: number;
  updated_at: number;
};

// ============================================================================
// Lazy prepared-statement helper. Statements bind to the current db handle;
// we prepare on first use to avoid open-before-ready hazards during tests.
// ============================================================================

type PreparedCache = Map<string, Statement>;
const cache: PreparedCache = new Map();

export function prep<TRow = unknown>(sql: string): Statement<unknown[], TRow> {
  if (config.DATABASE !== 'sqlite') {
    throw new Error(
      `prep() requires DATABASE=sqlite (got '${config.DATABASE}'). ` +
      `Use q()/one()/run() from src/db/index.ts instead.`,
    );
  }
  const hit = cache.get(sql);
  if (hit) return hit as Statement<unknown[], TRow>;
  const stmt = db().prepare<unknown[], TRow>(sql);
  cache.set(sql, stmt);
  return stmt;
}

// ============================================================================
// Async helpers — route through the DbAdapter (SQLite or Postgres).
// New code + anything that must run in Postgres mode MUST use these.
// SQL uses `?` placeholders regardless of backend — the pg adapter translates.
// ============================================================================

import { getDb, closeDbAdapter, type DbAdapter, type RunResult } from './adapter.js';

/** Both `helper(sql, a, b, c)` and `helper(sql, [a, b, c])` are used across
 *  the codebase. better-sqlite3's spread/array duality tolerates either but
 *  pg's driver strictly needs a flat array — one caller wrapping the array
 *  a second time silently landed as 1 param on Postgres. Normalize here so
 *  every legacy call site keeps working on both backends. */
function normalizeParams(params: unknown[]): unknown[] {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

/** Multi-row read. `params` are positional `?` bindings. */
export async function q<TRow = Record<string, unknown>>(
  sql: string,
  ...params: unknown[]
): Promise<TRow[]> {
  return (await getDb()).query<TRow>(sql, normalizeParams(params));
}

/** Single-row read; `null` when nothing matched. */
export async function one<TRow = Record<string, unknown>>(
  sql: string,
  ...params: unknown[]
): Promise<TRow | null> {
  return (await getDb()).one<TRow>(sql, normalizeParams(params));
}

/** INSERT/UPDATE/DELETE. Returns `{ changes, lastInsertId }`. */
export async function run(sql: string, ...params: unknown[]): Promise<RunResult> {
  return (await getDb()).run(sql, normalizeParams(params));
}

/** DDL / multi-statement — no params. */
export async function exec(sql: string): Promise<void> {
  return (await getDb()).exec(sql);
}

/**
 * Wrap a batch of operations in a transaction. Inside the callback ALL
 * work MUST go through the passed `tx` (not the outer q/run/one) — Postgres
 * needs the same physical connection for the whole tx.
 */
export async function tx<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
  return (await getDb()).transaction(fn);
}

/** Re-exported for symmetry with `closeDb()` — closes the adapter too. */
export { closeDbAdapter };
