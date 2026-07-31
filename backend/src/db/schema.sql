-- ============================================================================
-- DigiWorld schema — SQLite (better-sqlite3, WAL mode, foreign keys enforced).
-- Single-file authoritative schema. Loaded at boot by src/db/index.ts.
-- All timestamps are UNIX epoch milliseconds (INTEGER). No NULL creation times.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- users: identity, credentials, admin flag. First registered user is admin
-- (enforced in application code, see src/auth/routes.ts).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                       TEXT PRIMARY KEY,                       -- 'usr_...'
  username                 TEXT NOT NULL UNIQUE COLLATE NOCASE,    -- case-insensitive
  display_name             TEXT NOT NULL,
  password_hash            TEXT NOT NULL,                          -- argon2id encoded string
  is_admin                 INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL,
  last_login_at            INTEGER,
  disabled                 INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  onboarding_completed_at  INTEGER,                                -- NULL until user picks a starter team
  mmr                      INTEGER NOT NULL DEFAULT 1000
);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at);
-- Legacy over-strict index from H2 race fix: blocked admin promotion.
-- Replaced by tx-scoped SELECT COUNT (SQLite BEGIN IMMEDIATE serializes) in auth/routes.ts.
DROP INDEX IF EXISTS idx_users_only_one_admin;

-- ----------------------------------------------------------------------------
-- sessions: server-issued opaque tokens. Cookie-based auth. Prunable by expiry.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,                          -- 64-char hex, from randomBytes(32)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- ----------------------------------------------------------------------------
-- login_attempts: for basic brute-force throttling (per-username sliding window).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL COLLATE NOCASE,
  ip          TEXT,
  attempted_at INTEGER NOT NULL,
  success     INTEGER NOT NULL CHECK (success IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user_time ON login_attempts(username, attempted_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip, attempted_at);

-- ----------------------------------------------------------------------------
-- scraped_catalog: mirror of what we've scraped from external sources, keyed
-- by the source ID (skullbot integer). This is the "pool" the admin can pull
-- from. Snapshot only — actual game catalog lives in the XML file.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scraped_catalog (
  skullbot_id   INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  stage         TEXT NOT NULL,                           -- Baby | In-Training | Rookie | Champion | Ultimate | Mega
  attribute     TEXT NOT NULL,                           -- Data | Vaccine | Virus | Free | Unknown
  portrait_url  TEXT NOT NULL,
  dot_url       TEXT NOT NULL,
  wikimon_slug  TEXT,                                    -- wikimon.net page slug (e.g. 'Agumon')
  raw_json      TEXT NOT NULL,                           -- full scraped record for admin display
  scraped_at    INTEGER NOT NULL,
  in_catalog    INTEGER NOT NULL DEFAULT 0 CHECK (in_catalog IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_scraped_stage ON scraped_catalog(stage);
CREATE INDEX IF NOT EXISTS idx_scraped_attribute ON scraped_catalog(attribute);
CREATE INDEX IF NOT EXISTS idx_scraped_name ON scraped_catalog(name COLLATE NOCASE);

-- ----------------------------------------------------------------------------
-- player_roster: instantiated Digimon owned by a player. `catalog_id` refers
-- to the XML catalog id (string). We keep the id string here so the DB doesn't
-- have to know about catalog schema changes — the XML file is source of truth
-- for template data (base stats, skill pool).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_roster (
  id            TEXT PRIMARY KEY,                        -- 'mon_...'
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id    TEXT NOT NULL,                           -- e.g. 'skb-317'
  nickname      TEXT NOT NULL,
  level         INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  xp            INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  hp_bonus      INTEGER NOT NULL DEFAULT 0,              -- accumulated training / ascend
  en_bonus      INTEGER NOT NULL DEFAULT 0,
  atk_bonus     INTEGER NOT NULL DEFAULT 0,
  def_bonus     INTEGER NOT NULL DEFAULT 0,
  int_bonus     INTEGER NOT NULL DEFAULT 0,
  spd_bonus     INTEGER NOT NULL DEFAULT 0,
  mood          INTEGER NOT NULL DEFAULT 50 CHECK (mood BETWEEN 0 AND 100),
  status        TEXT NOT NULL DEFAULT 'resting'          -- resting | training | party
                CHECK (status IN ('resting', 'training', 'party', 'adventure', 'nursery')),
  slot_index    INTEGER,                                 -- 0..2 if in party, else NULL
  revive_at     INTEGER,                                 -- unix ms; when set and > now, mon is downed and unusable in PVE
  pets_today    INTEGER NOT NULL DEFAULT 0,              -- nursery: count of pets given today (resets when pets_day rolls)
  pets_day      TEXT,                                    -- 'YYYY-MM-DD' of last pet; when != today, pets_today is reset
  listed_at     INTEGER,                                 -- unix ms; when NOT NULL the mon is on the player market and hidden from party/nursery/etc.
  evolution_history TEXT,                                -- JSON string[]: prior catalog_ids in evolution order (null = no history)
  equipped_skill_ids TEXT,                               -- JSON string[4]: chosen skill IDs from the learned pool; null = fallback to current template's top 4
  stage_pools   TEXT,                                    -- JSON Partial<Record<Stage,{combat,hpen}>>: per-stage bonus spent, locks on evolution
  nursery_stage TEXT,                                    -- Baby | In-Training | Rookie while status='nursery'
  nursery_evolve_at INTEGER,                             -- unix ms for next nursery stage; 0 when Rookie is ready to graduate
  nursery_chain TEXT,                                    -- JSON {babyCatalogId,inTrainingCatalogId,rookieCatalogId}
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (user_id, slot_index) ON CONFLICT ABORT         -- no two party slots collide
);
CREATE INDEX IF NOT EXISTS idx_roster_user ON player_roster(user_id);
CREATE INDEX IF NOT EXISTS idx_roster_status ON player_roster(user_id, status);

CREATE TABLE IF NOT EXISTS player_species_data (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id  TEXT NOT NULL,
  percent     INTEGER NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  kills       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, catalog_id)
);
CREATE INDEX IF NOT EXISTS idx_species_data_user ON player_species_data(user_id);

CREATE TABLE IF NOT EXISTS player_pending_hatches (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_catalog TEXT NOT NULL,
  rookie_catalog TEXT NOT NULL,
  chip_items     TEXT,
  hatch_at       INTEGER NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_hatches_user ON player_pending_hatches(user_id);

-- ----------------------------------------------------------------------------
-- resources: banked wallet balances per player. One row per (user, resource).
-- Resources: Meat, Bits, Data. Currency: DigiCredits (separate column on users
-- via player_wallet below to keep it a scalar).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resources (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource    TEXT NOT NULL CHECK (resource IN ('Meat', 'Bits', 'Data')),
  amount      INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, resource)
);

-- ----------------------------------------------------------------------------
-- player_wallet: per-player DigiCredits balance + daily-reward streak state.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_wallet (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  credits           INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  streak_day        INTEGER NOT NULL DEFAULT 0 CHECK (streak_day BETWEEN 0 AND 7),
  last_claim_at     INTEGER,                             -- last daily reward claim (ms)
  premium_until     INTEGER,                             -- ms epoch or NULL
  updated_at        INTEGER NOT NULL
);

-- ----------------------------------------------------------------------------
-- farm_buildings: player-owned production buildings. `produced` is derived
-- at read time via (now - last_touch) * ratePerHour / 3_600_000, capped at
-- capacity. Stored `produced` is a checkpoint from last collect/upgrade.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS farm_buildings (
  id             TEXT PRIMARY KEY,                       -- 'bld_...'
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,                          -- 'Meat Farm' | 'Bit Foundry' | 'Data Spire' | 'Bio Lab' | 'Training Station' | 'Premium Training Station'
  building_type  TEXT NOT NULL DEFAULT 'resource_generator'
                 CHECK (building_type IN ('resource_generator', 'training', 'training_premium')),
  resource       TEXT NOT NULL CHECK (resource IN ('Meat', 'Bits', 'Data')),
  level          INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  rate_per_hour  INTEGER NOT NULL CHECK (rate_per_hour > 0),
  capacity       INTEGER NOT NULL CHECK (capacity > 0),
  produced       REAL NOT NULL DEFAULT 0 CHECK (produced >= 0),
  last_touch     INTEGER NOT NULL,
  upgrade_cost   INTEGER NOT NULL CHECK (upgrade_cost > 0),
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_farm_user ON farm_buildings(user_id);
CREATE INDEX IF NOT EXISTS idx_farm_type ON farm_buildings(user_id, building_type);

-- ----------------------------------------------------------------------------
-- building_blueprints: admin-editable catalog of building types. Every farm or
-- training building instantiated for a player was created from a blueprint
-- (kind + building_type + resource + rate + capacity + upgrade cost). Instances
-- in `farm_buildings` are decoupled after creation: editing a blueprint does
-- NOT retroactively mutate existing player buildings.
--   starter_seed=1 → seed one for every new player at register time
--   shop_price=NULL → not buyable; INTEGER → visible in shop for that price
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS building_blueprints (
  id             TEXT PRIMARY KEY,                       -- 'bp_...'
  name           TEXT NOT NULL UNIQUE,                   -- copied to farm_buildings.kind on seed
  description    TEXT NOT NULL DEFAULT '',
  building_type  TEXT NOT NULL
                 CHECK (building_type IN ('resource_generator', 'training', 'training_premium')),
  resource       TEXT CHECK (resource IS NULL OR resource IN ('Meat', 'Bits', 'Data')),
  rate_per_hour  INTEGER NOT NULL DEFAULT 0 CHECK (rate_per_hour >= 0),
  capacity       INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  upgrade_cost   INTEGER NOT NULL DEFAULT 500 CHECK (upgrade_cost > 0),
  starter_seed   INTEGER NOT NULL DEFAULT 0 CHECK (starter_seed IN (0, 1)),
  shop_price     INTEGER CHECK (shop_price IS NULL OR shop_price > 0),
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blueprint_type ON building_blueprints(building_type, enabled);
CREATE INDEX IF NOT EXISTS idx_blueprint_starter ON building_blueprints(starter_seed, enabled);

-- ----------------------------------------------------------------------------
-- skills_catalog: admin-editable global skill definitions. Each row stores a
-- JSON DSL describing ordered actions (deal_damage, heal, apply_status,
-- modify_stat, schedule, conditional, ...) with rich target patterns
-- (enemy_all, enemy_front, enemy_first_n, self, primary_target, ...). The
-- battle engine will interpret `actions_json` at cast time. Skills are
-- referenced by digimon templates via id (future migration).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skills_catalog (
  id             TEXT PRIMARY KEY,                       -- 'sk_...'
  name           TEXT NOT NULL UNIQUE,
  description    TEXT NOT NULL DEFAULT '',
  element        TEXT NOT NULL CHECK (element IN ('fire', 'water', 'plant', 'ice', 'electricity', 'earth', 'steel', 'wind', 'light', 'dark', 'null')),
  energy_cost    INTEGER NOT NULL DEFAULT 0 CHECK (energy_cost >= 0),
  cooldown       INTEGER NOT NULL DEFAULT 0 CHECK (cooldown >= 0),
  actions_json   TEXT NOT NULL,                          -- JSON array of Action DSL
  tags_json      TEXT NOT NULL DEFAULT '[]',             -- JSON array of tag strings
  animation      TEXT,                                    -- optional asset hint
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills_catalog(enabled);
CREATE INDEX IF NOT EXISTS idx_skills_element ON skills_catalog(element);

-- ----------------------------------------------------------------------------
-- training_sessions: one active session per training building. `stat_kinds`
-- is a JSON array (basic stations train 1 stat, premium stations train 2+).
-- Reward = f(duration_ms, mon.stage, session.stat_kinds.length). On collect
-- we bump `player_roster.{stat}_bonus` and mutate `mood`.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS training_sessions (
  id            TEXT PRIMARY KEY,                        -- 'trn_...'
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building_id   TEXT NOT NULL REFERENCES farm_buildings(id) ON DELETE CASCADE,
  mon_id        TEXT NOT NULL REFERENCES player_roster(id) ON DELETE CASCADE,
  stat_kinds    TEXT NOT NULL,                           -- JSON array: ['hp'] | ['atk','int'] | ...
  started_at    INTEGER NOT NULL,
  duration_ms   INTEGER NOT NULL CHECK (duration_ms > 0),
  collected_at  INTEGER                                  -- NULL while active; set on collect/cancel
);
CREATE INDEX IF NOT EXISTS idx_training_user ON training_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_training_active ON training_sessions(user_id) WHERE collected_at IS NULL;
-- Only ONE ACTIVE session per building; collected/cancelled rows are kept for history.
-- NOTE: pre-existing SQLite dev DBs with the old inline UNIQUE(building_id) need `pnpm db:init --reset`
-- (SQLite has no DROP CONSTRAINT). New DBs and Postgres are handled automatically.
CREATE UNIQUE INDEX IF NOT EXISTS training_unique_active_building
  ON training_sessions(building_id)
  WHERE collected_at IS NULL;

-- ----------------------------------------------------------------------------
-- matches: history of 3v3 battles for the leaderboard/replay of outcomes.
-- Match state during play is in-memory in src/battle/engine.ts.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
  id             TEXT PRIMARY KEY,                       -- 'mtc_...'
  player_a       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_b       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  winner         TEXT REFERENCES users(id) ON DELETE SET NULL,    -- NULL = draw/fled/abandoned
  outcome        TEXT NOT NULL CHECK (outcome IN ('win_a', 'win_b', 'draw', 'fled_a', 'fled_b', 'abandoned')),
  rounds         INTEGER NOT NULL DEFAULT 0,
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER NOT NULL,
  log            TEXT NOT NULL DEFAULT '[]'              -- JSON array of turn events (redacted)
);
CREATE INDEX IF NOT EXISTS idx_matches_player_a ON matches(player_a, ended_at);
CREATE INDEX IF NOT EXISTS idx_matches_player_b ON matches(player_b, ended_at);
CREATE INDEX IF NOT EXISTS idx_matches_ended ON matches(ended_at);

-- ----------------------------------------------------------------------------
-- friendships: symmetric friend graph, stored asymmetrically so we can model
-- pending requests. `status`: pending | accepted | blocked.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS friendships (
  requester_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_friendship_addressee ON friendships(addressee_id, status);

-- ----------------------------------------------------------------------------
-- shop_items: catalog of purchasable items (seeded from src/social/shop.ts).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_items (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  price_credits INTEGER NOT NULL CHECK (price_credits >= 0),
  kind          TEXT NOT NULL,
  class         TEXT NOT NULL DEFAULT 'product' CHECK (class IN ('product', 'item')),
  payload       TEXT NOT NULL DEFAULT '{}',
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shop_items_class ON shop_items(class, enabled);

-- ----------------------------------------------------------------------------
-- player_inventory: purchased/received items.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_inventory (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  qty         INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 0),
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

-- ----------------------------------------------------------------------------
-- pending_buffs: unconsumed shop item effects waiting to be applied at the
-- start of a battle (hp_pct, en_pct) or on match completion (xp_mult).
-- `mon_id` NULL = player-wide (e.g. xp_mult). `magnitude` interpretation
-- depends on `effect_kind` (see src/social/buffs.ts).
-- Partial index keeps the hot query O(1) as consumed rows accumulate.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_buffs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mon_id        TEXT REFERENCES player_roster(id) ON DELETE CASCADE,
  effect_kind   TEXT NOT NULL CHECK (effect_kind IN ('hp_pct','en_pct','xp_mult')),
  magnitude     REAL NOT NULL,
  source_item   TEXT,
  created_at    INTEGER NOT NULL,
  consumed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pending_buffs_active
  ON pending_buffs(user_id, mon_id, effect_kind) WHERE consumed_at IS NULL;

-- ----------------------------------------------------------------------------
-- onboarding_config: singleton (id=1) admin-editable intro dialog + background.
-- Rendered on the onboarding page when a new user has NULL onboarding_completed_at.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_config (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  intro_dialogue  TEXT NOT NULL,
  bg_image        TEXT NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- ----------------------------------------------------------------------------
-- game_settings: singleton (id=1) admin-editable global rates. xp_rate scales
-- BOTH match-end XP awards (PvP + PvE) AND training stat gains at collect time.
-- Default 1.0 = no change to existing balance. Bounded 0.1..10.0 in the API.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  xp_rate     REAL NOT NULL DEFAULT 1.0 CHECK (xp_rate > 0),
  updated_at  INTEGER NOT NULL
);

-- ----------------------------------------------------------------------------
-- onboarding_teams: admin-editable starter team choices. Each team is exactly
-- 3 mons (mon_1/2/3_catalog_id map to entries in the XML catalog). On player
-- select, the engine spawns 3 player_roster rows from these catalog_ids.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_teams (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  mon_1_catalog_id  TEXT NOT NULL,
  mon_2_catalog_id  TEXT NOT NULL,
  mon_3_catalog_id  TEXT NOT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_onboarding_teams_enabled_order
  ON onboarding_teams(enabled, sort_order);

-- ----------------------------------------------------------------------------
-- world_position: player's current tile in the procedural overworld. Deterministic
-- from world_seed (per-user) via src/world/biomes.ts - no biome grid is persisted.
-- Wild encounters roll on each move and scale to party rating.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_position (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  world_seed    BIGINT NOT NULL,
  x             INTEGER NOT NULL DEFAULT 0,
  y             INTEGER NOT NULL DEFAULT 0,
  steps_taken   INTEGER NOT NULL DEFAULT 0,
  last_move_at  INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quests (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  required_level INTEGER NOT NULL DEFAULT 1,
  data           TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS world_objects (
  id          TEXT PRIMARY KEY,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  lat         REAL NOT NULL DEFAULT 0,
  lon         REAL NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL,
  scale       REAL NOT NULL DEFAULT 1.0,
  tint        TEXT,
  quest_id    TEXT REFERENCES quests(id) ON DELETE SET NULL,
  passable    INTEGER NOT NULL DEFAULT 0,
  label       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_objects_pos ON world_objects (x, y);

CREATE TABLE IF NOT EXISTS dungeon_warps (
  id                TEXT PRIMARY KEY,
  dungeon_id        TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x                 INTEGER NOT NULL,
  y                 INTEGER NOT NULL,
  target_dungeon_id TEXT REFERENCES dungeons(id) ON DELETE SET NULL,
  label             TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (dungeon_id, x, y)
);
CREATE INDEX IF NOT EXISTS idx_dungeon_warps_dungeon ON dungeon_warps(dungeon_id);

CREATE TABLE IF NOT EXISTS dungeon_doors (
  id            TEXT PRIMARY KEY,
  dungeon_id    TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x             INTEGER NOT NULL,
  y             INTEGER NOT NULL,
  key_item_id   TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  label         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (dungeon_id, x, y)
);
CREATE INDEX IF NOT EXISTS idx_dungeon_doors_dungeon ON dungeon_doors(dungeon_id);

CREATE TABLE IF NOT EXISTS user_quest_progress (
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id                 TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  current_step_index       INTEGER NOT NULL,
  current_dialogue_node_id TEXT,
  choices_made             TEXT NOT NULL DEFAULT '{}',
  started_at               INTEGER NOT NULL,
  completed_at             INTEGER,
  PRIMARY KEY (user_id, quest_id)
);

-- ----------------------------------------------------------------------------
-- market_listings: player-to-player marketplace for Digimon. One active listing
-- per mon_id at a time (partial unique index below). On buy the mon_id is
-- transferred to the buyer via UPDATE player_roster.user_id in the same
-- transaction that credits the seller + debits the buyer's wallet.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_listings (
  id             TEXT PRIMARY KEY,                       -- 'mkt_...'
  mon_id         TEXT NOT NULL REFERENCES player_roster(id) ON DELETE CASCADE,
  seller_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price_credits  INTEGER NOT NULL CHECK (price_credits > 0),
  listed_at      INTEGER NOT NULL,
  sold_at        INTEGER,
  sold_to        TEXT REFERENCES users(id) ON DELETE SET NULL,
  canceled_at    INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_active_mon
  ON market_listings(mon_id)
  WHERE sold_at IS NULL AND canceled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_market_seller
  ON market_listings(seller_id, sold_at, canceled_at);
CREATE INDEX IF NOT EXISTS idx_market_active_listed
  ON market_listings(listed_at DESC)
  WHERE sold_at IS NULL AND canceled_at IS NULL;

-- ----------------------------------------------------------------------------
-- Per-catalog loot table. Admin sets which shop items a given catalog mon
-- (identified by XML id, no FK because catalog is file-driven) may drop when
-- defeated, with drop_pct chance and qty_min..qty_max stack size. If a mon
-- has zero rows here the pve engine falls back to the global 20% random-item
-- drop for backward compatibility.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_loot_entries (
  id           TEXT PRIMARY KEY,
  catalog_id   TEXT NOT NULL,
  item_id      TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  drop_pct     INTEGER NOT NULL DEFAULT 100 CHECK (drop_pct >= 0 AND drop_pct <= 100),
  qty_min      INTEGER NOT NULL DEFAULT 1 CHECK (qty_min >= 1),
  qty_max      INTEGER NOT NULL DEFAULT 1 CHECK (qty_max >= qty_min),
  updated_at   INTEGER NOT NULL,
  UNIQUE (catalog_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_loot_catalog ON catalog_loot_entries(catalog_id);

CREATE TABLE IF NOT EXISTS farm_recipes (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  meat_cost      INTEGER NOT NULL DEFAULT 0 CHECK (meat_cost >= 0),
  bits_cost      INTEGER NOT NULL DEFAULT 0 CHECK (bits_cost >= 0),
  data_cost      INTEGER NOT NULL DEFAULT 0 CHECK (data_cost >= 0),
  craft_time_ms  INTEGER NOT NULL DEFAULT 60000 CHECK (craft_time_ms > 0),
  category       TEXT CHECK (category IN ('med', 'chip', 'rare', 'pantry')),
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_farm_recipes_item ON farm_recipes(item_id);

CREATE TABLE IF NOT EXISTS player_factories (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  factory_type           TEXT NOT NULL CHECK (factory_type IN ('med', 'chip', 'rare', 'pantry')),
  level                  INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  upgrade_cost           INTEGER NOT NULL DEFAULT 300 CHECK (upgrade_cost > 0),
  craft_time_multiplier  REAL NOT NULL DEFAULT 1.0 CHECK (craft_time_multiplier > 0),
  created_at             INTEGER NOT NULL,
  UNIQUE (user_id, factory_type)
);
CREATE INDEX IF NOT EXISTS idx_player_factories_user ON player_factories(user_id);

CREATE TABLE IF NOT EXISTS crafting_jobs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id     TEXT NOT NULL REFERENCES farm_recipes(id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  factory_id    TEXT REFERENCES player_factories(id) ON DELETE CASCADE,
  started_at    INTEGER,
  duration_ms   INTEGER NOT NULL CHECK (duration_ms > 0),
  is_auto       INTEGER NOT NULL DEFAULT 0 CHECK (is_auto IN (0, 1)),
  collected_at  INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crafting_user ON crafting_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_crafting_factory ON crafting_jobs(factory_id);
CREATE UNIQUE INDEX IF NOT EXISTS crafting_unique_active_factory
  ON crafting_jobs(factory_id)
  WHERE collected_at IS NULL AND started_at IS NOT NULL AND factory_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS adventures (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mon_ids           TEXT NOT NULL,
  distance_ms       INTEGER NOT NULL CHECK (distance_ms > 0),
  provisions_spent  INTEGER NOT NULL CHECK (provisions_spent >= 0),
  started_at        INTEGER NOT NULL,
  collected_at      INTEGER,
  seed              INTEGER NOT NULL,
  report            TEXT,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_adventures_user ON adventures(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS adventures_unique_active_user
  ON adventures(user_id)
  WHERE collected_at IS NULL;

-- ----------------------------------------------------------------------------
-- Views + helpful pragmas set on connection (not schema, but documented here):
--   journal_mode = WAL, synchronous = NORMAL, foreign_keys = ON, busy_timeout = 5000
-- Applied by src/db/index.ts. Do NOT set them here — they are per-connection.
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_roster_user_created_at ON player_roster(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_roster_user_status_slot ON player_roster(user_id, status, slot_index);
CREATE INDEX IF NOT EXISTS idx_species_user_percent_kills ON player_species_data(user_id, percent DESC, kills DESC);
CREATE INDEX IF NOT EXISTS idx_farm_user_created_at ON farm_buildings(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_shop_enabled_price ON shop_items(enabled, price_credits);
CREATE INDEX IF NOT EXISTS idx_world_objects_created_at ON world_objects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quests_created_at ON quests(created_at DESC);
