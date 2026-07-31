-- ============================================================================
-- DigiWorld schema — PostgreSQL 14+.
-- Translation of src/db/schema.sql. All timestamps are BIGINT (unix epoch ms)
-- so 2038 isn't a concern. Booleans stay INTEGER 0/1 for adapter parity.
-- `citext` gives case-insensitive equality on username columns without
-- forcing every WHERE clause into LOWER(...).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS citext;

-- ----------------------------------------------------------------------------
-- users
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                       TEXT PRIMARY KEY,
  username                 CITEXT NOT NULL UNIQUE,
  display_name             TEXT NOT NULL,
  password_hash            TEXT NOT NULL,
  is_admin                 INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at               BIGINT NOT NULL,
  updated_at               BIGINT NOT NULL,
  last_login_at            BIGINT,
  disabled                 INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  onboarding_completed_at  BIGINT,
  mmr                      INTEGER NOT NULL DEFAULT 1000
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS mmr INTEGER NOT NULL DEFAULT 1000;
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at);
-- Legacy over-strict index from H2 race fix: blocked admin promotion.
-- Replaced by tx-scoped SELECT COUNT + pg_advisory_xact_lock in auth/routes.ts.
DROP INDEX IF EXISTS idx_users_only_one_admin;

-- ----------------------------------------------------------------------------
-- sessions (kept for parity; Redis is authoritative when CLUSTER=redis)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL,
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- ----------------------------------------------------------------------------
-- login_attempts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id           BIGSERIAL PRIMARY KEY,
  username     CITEXT NOT NULL,
  ip           TEXT,
  attempted_at BIGINT NOT NULL,
  success      INTEGER NOT NULL CHECK (success IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user_time ON login_attempts(username, attempted_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip, attempted_at);

-- ----------------------------------------------------------------------------
-- scraped_catalog
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scraped_catalog (
  skullbot_id   INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  stage         TEXT NOT NULL,
  attribute     TEXT NOT NULL,
  portrait_url  TEXT NOT NULL,
  dot_url       TEXT NOT NULL,
  wikimon_slug  TEXT,
  raw_json      TEXT NOT NULL,
  scraped_at    BIGINT NOT NULL,
  in_catalog    INTEGER NOT NULL DEFAULT 0 CHECK (in_catalog IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_scraped_stage ON scraped_catalog(stage);
CREATE INDEX IF NOT EXISTS idx_scraped_attribute ON scraped_catalog(attribute);
CREATE INDEX IF NOT EXISTS idx_scraped_name_lower ON scraped_catalog(LOWER(name));

-- ----------------------------------------------------------------------------
-- player_roster
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_roster (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id    TEXT NOT NULL,
  nickname      TEXT NOT NULL,
  level         INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  xp            INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  hp_bonus      INTEGER NOT NULL DEFAULT 0,
  en_bonus      INTEGER NOT NULL DEFAULT 0,
  atk_bonus     INTEGER NOT NULL DEFAULT 0,
  def_bonus     INTEGER NOT NULL DEFAULT 0,
  int_bonus     INTEGER NOT NULL DEFAULT 0,
  spd_bonus     INTEGER NOT NULL DEFAULT 0,
  mood          INTEGER NOT NULL DEFAULT 50 CHECK (mood BETWEEN 0 AND 100),
  status        TEXT NOT NULL DEFAULT 'resting'
                CHECK (status IN ('resting', 'training', 'party', 'adventure', 'nursery')),
  slot_index    INTEGER,
  revive_at     BIGINT,
  pets_today    INTEGER NOT NULL DEFAULT 0,
  pets_day      TEXT,
  listed_at     BIGINT,
  evolution_history TEXT,
  equipped_skill_ids TEXT,
  stage_pools   TEXT,
  nursery_stage TEXT,
  nursery_evolve_at BIGINT,
  nursery_chain TEXT,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  CONSTRAINT roster_unique_slot UNIQUE (user_id, slot_index)
);
ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS evolution_history TEXT;
ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS equipped_skill_ids TEXT;
ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS stage_pools TEXT;
ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS nursery_stage TEXT;
ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS nursery_evolve_at BIGINT;
ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS nursery_chain TEXT;
CREATE INDEX IF NOT EXISTS idx_roster_user ON player_roster(user_id);
CREATE INDEX IF NOT EXISTS idx_roster_status ON player_roster(user_id, status);

CREATE TABLE IF NOT EXISTS player_species_data (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id  TEXT NOT NULL,
  percent     INTEGER NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  kills       INTEGER NOT NULL DEFAULT 0,
  updated_at  BIGINT NOT NULL,
  PRIMARY KEY (user_id, catalog_id)
);
CREATE INDEX IF NOT EXISTS idx_species_data_user ON player_species_data(user_id);

CREATE TABLE IF NOT EXISTS player_pending_hatches (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_catalog TEXT NOT NULL,
  rookie_catalog TEXT NOT NULL,
  chip_items     TEXT,
  hatch_at       BIGINT NOT NULL,
  created_at     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_hatches_user ON player_pending_hatches(user_id);

-- ----------------------------------------------------------------------------
-- resources
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resources (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource    TEXT NOT NULL CHECK (resource IN ('Meat', 'Bits', 'Data')),
  amount      INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at  BIGINT NOT NULL,
  PRIMARY KEY (user_id, resource)
);

-- ----------------------------------------------------------------------------
-- player_wallet
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_wallet (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  credits       INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  streak_day    INTEGER NOT NULL DEFAULT 0 CHECK (streak_day BETWEEN 0 AND 7),
  last_claim_at BIGINT,
  premium_until BIGINT,
  updated_at    BIGINT NOT NULL
);

-- ----------------------------------------------------------------------------
-- farm_buildings
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS farm_buildings (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  building_type  TEXT NOT NULL DEFAULT 'resource_generator'
                 CHECK (building_type IN ('resource_generator', 'training', 'training_premium')),
  resource       TEXT NOT NULL CHECK (resource IN ('Meat', 'Bits', 'Data')),
  level          INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  rate_per_hour  INTEGER NOT NULL CHECK (rate_per_hour > 0),
  capacity       INTEGER NOT NULL CHECK (capacity > 0),
  produced       DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (produced >= 0),
  last_touch     BIGINT NOT NULL,
  upgrade_cost   INTEGER NOT NULL CHECK (upgrade_cost > 0),
  created_at     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_farm_user ON farm_buildings(user_id);
CREATE INDEX IF NOT EXISTS idx_farm_type ON farm_buildings(user_id, building_type);

CREATE TABLE IF NOT EXISTS building_blueprints (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
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
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blueprint_type ON building_blueprints(building_type, enabled);
CREATE INDEX IF NOT EXISTS idx_blueprint_starter ON building_blueprints(starter_seed, enabled);

CREATE TABLE IF NOT EXISTS skills_catalog (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  description    TEXT NOT NULL DEFAULT '',
  element        TEXT NOT NULL CHECK (element IN ('fire', 'water', 'plant', 'ice', 'electricity', 'earth', 'steel', 'wind', 'light', 'dark', 'null')),
  energy_cost    INTEGER NOT NULL DEFAULT 0 CHECK (energy_cost >= 0),
  cooldown       INTEGER NOT NULL DEFAULT 0 CHECK (cooldown >= 0),
  actions_json   TEXT NOT NULL,
  tags_json      TEXT NOT NULL DEFAULT '[]',
  animation      TEXT,
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'skills_catalog'
      AND c.conname = 'skills_catalog_element_check'
      AND pg_get_constraintdef(c.oid) LIKE '%nature%'
  ) THEN
    ALTER TABLE skills_catalog DROP CONSTRAINT skills_catalog_element_check;
    ALTER TABLE skills_catalog ADD CONSTRAINT skills_catalog_element_check
      CHECK (element IN ('fire', 'water', 'plant', 'ice', 'electricity', 'earth', 'steel', 'wind', 'light', 'dark', 'null'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills_catalog(enabled);
CREATE INDEX IF NOT EXISTS idx_skills_element ON skills_catalog(element);

CREATE TABLE IF NOT EXISTS training_sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building_id   TEXT NOT NULL REFERENCES farm_buildings(id) ON DELETE CASCADE,
  mon_id        TEXT NOT NULL REFERENCES player_roster(id) ON DELETE CASCADE,
  stat_kinds    TEXT NOT NULL,
  started_at    BIGINT NOT NULL,
  duration_ms   BIGINT NOT NULL CHECK (duration_ms > 0),
  collected_at  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_training_user ON training_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_training_active ON training_sessions(user_id) WHERE collected_at IS NULL;
-- Only ONE ACTIVE session per building. Collected/cancelled rows are kept for history
-- but do not block re-assignment. Migration drops the pre-existing full-column constraint
-- from older deployments where it exists.
ALTER TABLE training_sessions DROP CONSTRAINT IF EXISTS training_unique_building;
CREATE UNIQUE INDEX IF NOT EXISTS training_unique_active_building
  ON training_sessions(building_id)
  WHERE collected_at IS NULL;

-- ----------------------------------------------------------------------------
-- matches
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
  id          TEXT PRIMARY KEY,
  player_a    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_b    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  winner      TEXT REFERENCES users(id) ON DELETE SET NULL,
  outcome     TEXT NOT NULL CHECK (outcome IN ('win_a', 'win_b', 'draw', 'fled_a', 'fled_b', 'abandoned')),
  rounds      INTEGER NOT NULL DEFAULT 0,
  started_at  BIGINT NOT NULL,
  ended_at    BIGINT NOT NULL,
  log         TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_matches_player_a ON matches(player_a, ended_at);
CREATE INDEX IF NOT EXISTS idx_matches_player_b ON matches(player_b, ended_at);
CREATE INDEX IF NOT EXISTS idx_matches_ended ON matches(ended_at);

-- ----------------------------------------------------------------------------
-- friendships
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS friendships (
  requester_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_friendship_addressee ON friendships(addressee_id, status);

-- ----------------------------------------------------------------------------
-- shop_items
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
  created_at    BIGINT NOT NULL
);
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS class TEXT NOT NULL DEFAULT 'product';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'shop_items' AND c.conname = 'shop_items_class_check'
  ) THEN
    ALTER TABLE shop_items ADD CONSTRAINT shop_items_class_check
      CHECK (class IN ('product', 'item'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_shop_items_class ON shop_items(class, enabled);

-- ----------------------------------------------------------------------------
-- player_inventory
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_inventory (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  qty         INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 0),
  updated_at  BIGINT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

-- ----------------------------------------------------------------------------
-- pending_buffs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_buffs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mon_id       TEXT REFERENCES player_roster(id) ON DELETE CASCADE,
  effect_kind  TEXT NOT NULL CHECK (effect_kind IN ('hp_pct','en_pct','xp_mult')),
  magnitude    DOUBLE PRECISION NOT NULL,
  source_item  TEXT,
  created_at   BIGINT NOT NULL,
  consumed_at  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_pending_buffs_active
  ON pending_buffs(user_id, mon_id, effect_kind) WHERE consumed_at IS NULL;

-- ----------------------------------------------------------------------------
-- onboarding_config: singleton (id=1) admin-editable intro dialog + background.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_config (
  id              SMALLINT PRIMARY KEY CHECK (id = 1),
  intro_dialogue  TEXT NOT NULL,
  bg_image        TEXT NOT NULL,
  updated_at      BIGINT NOT NULL
);

-- ----------------------------------------------------------------------------
-- game_settings: singleton (id=1) admin-editable global rates. xp_rate scales
-- BOTH match-end XP awards (PvP + PvE) AND training stat gains at collect time.
-- Default 1.0 = no change to existing balance. Bounded 0.1..10.0 in the API.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_settings (
  id          SMALLINT PRIMARY KEY CHECK (id = 1),
  xp_rate     DOUBLE PRECISION NOT NULL DEFAULT 1.0 CHECK (xp_rate > 0),
  updated_at  BIGINT NOT NULL
);

-- ----------------------------------------------------------------------------
-- onboarding_teams: admin-editable starter team choices (3 mons per team).
-- On player select, the engine spawns 3 player_roster rows from these ids.
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
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_onboarding_teams_enabled_order
  ON onboarding_teams(enabled, sort_order);

-- ----------------------------------------------------------------------------
-- world_position: player's current tile in the procedural overworld.
-- Biomes are deterministic from world_seed via src/world/biomes.ts (not persisted).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_position (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  world_seed    BIGINT NOT NULL,
  x             INTEGER NOT NULL DEFAULT 0,
  y             INTEGER NOT NULL DEFAULT 0,
  steps_taken   INTEGER NOT NULL DEFAULT 0,
  last_move_at  BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS quests (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  required_level INTEGER NOT NULL DEFAULT 1,
  data           JSONB NOT NULL,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS world_objects (
  id          TEXT PRIMARY KEY,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  lat         DOUBLE PRECISION NOT NULL DEFAULT 0,
  lon         DOUBLE PRECISION NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL,
  scale       DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  tint        TEXT,
  quest_id    TEXT REFERENCES quests(id) ON DELETE SET NULL,
  passable    INTEGER NOT NULL DEFAULT 0,
  label       TEXT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_objects_pos ON world_objects (x, y);

CREATE TABLE IF NOT EXISTS user_quest_progress (
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id                 TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  current_step_index       INTEGER NOT NULL,
  current_dialogue_node_id TEXT,
  choices_made             JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at               BIGINT NOT NULL,
  completed_at             BIGINT,
  PRIMARY KEY (user_id, quest_id)
);

CREATE TABLE IF NOT EXISTS market_listings (
  id             TEXT PRIMARY KEY,
  mon_id         TEXT NOT NULL REFERENCES player_roster(id) ON DELETE CASCADE,
  seller_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price_credits  INTEGER NOT NULL CHECK (price_credits > 0),
  listed_at      BIGINT NOT NULL,
  sold_at        BIGINT,
  sold_to        TEXT REFERENCES users(id) ON DELETE SET NULL,
  canceled_at    BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_active_mon
  ON market_listings(mon_id)
  WHERE sold_at IS NULL AND canceled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_market_seller
  ON market_listings(seller_id, sold_at, canceled_at);
CREATE INDEX IF NOT EXISTS idx_market_active_listed
  ON market_listings(listed_at DESC)
  WHERE sold_at IS NULL AND canceled_at IS NULL;

-- Per-catalog loot table. See schema.sql for design rationale (no FK on
-- catalog_id because the catalog is XML-driven, item_id references shop_items,
-- empty rows for a mon = engine falls back to global random drop).
CREATE TABLE IF NOT EXISTS catalog_loot_entries (
  id           TEXT PRIMARY KEY,
  catalog_id   TEXT NOT NULL,
  item_id      TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  drop_pct     INTEGER NOT NULL DEFAULT 100 CHECK (drop_pct >= 0 AND drop_pct <= 100),
  qty_min      INTEGER NOT NULL DEFAULT 1 CHECK (qty_min >= 1),
  qty_max      INTEGER NOT NULL DEFAULT 1 CHECK (qty_max >= qty_min),
  updated_at   BIGINT NOT NULL,
  UNIQUE (catalog_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_loot_catalog ON catalog_loot_entries(catalog_id);

CREATE TABLE IF NOT EXISTS farm_recipes (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  meat_cost      INTEGER NOT NULL DEFAULT 0 CHECK (meat_cost >= 0),
  bits_cost      INTEGER NOT NULL DEFAULT 0 CHECK (bits_cost >= 0),
  data_cost      INTEGER NOT NULL DEFAULT 0 CHECK (data_cost >= 0),
  craft_time_ms  BIGINT NOT NULL DEFAULT 60000 CHECK (craft_time_ms > 0),
  category       TEXT CHECK (category IN ('med', 'chip', 'rare')),
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_farm_recipes_item ON farm_recipes(item_id);

ALTER TABLE farm_recipes ADD COLUMN IF NOT EXISTS craft_time_ms BIGINT NOT NULL DEFAULT 60000 CHECK (craft_time_ms > 0);
ALTER TABLE farm_recipes ADD COLUMN IF NOT EXISTS category TEXT CHECK (category IN ('med', 'chip', 'rare', 'pantry'));
ALTER TABLE farm_recipes DROP CONSTRAINT IF EXISTS farm_recipes_category_check;
ALTER TABLE farm_recipes ADD CONSTRAINT farm_recipes_category_check
  CHECK (category IN ('med', 'chip', 'rare', 'pantry'));

CREATE TABLE IF NOT EXISTS player_factories (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  factory_type           TEXT NOT NULL CHECK (factory_type IN ('med', 'chip', 'rare', 'pantry')),
  level                  INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  upgrade_cost           INTEGER NOT NULL DEFAULT 300 CHECK (upgrade_cost > 0),
  craft_time_multiplier  DOUBLE PRECISION NOT NULL DEFAULT 1.0 CHECK (craft_time_multiplier > 0),
  created_at             BIGINT NOT NULL,
  UNIQUE (user_id, factory_type)
);
CREATE INDEX IF NOT EXISTS idx_player_factories_user ON player_factories(user_id);

ALTER TABLE player_factories ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1);
ALTER TABLE player_factories ADD COLUMN IF NOT EXISTS upgrade_cost INTEGER NOT NULL DEFAULT 300 CHECK (upgrade_cost > 0);
ALTER TABLE player_factories ADD COLUMN IF NOT EXISTS craft_time_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0 CHECK (craft_time_multiplier > 0);
ALTER TABLE player_factories DROP CONSTRAINT IF EXISTS player_factories_factory_type_check;
ALTER TABLE player_factories ADD CONSTRAINT player_factories_factory_type_check
  CHECK (factory_type IN ('med', 'chip', 'rare', 'pantry'));

CREATE TABLE IF NOT EXISTS crafting_jobs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id     TEXT NOT NULL REFERENCES farm_recipes(id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  factory_id    TEXT REFERENCES player_factories(id) ON DELETE CASCADE,
  started_at    BIGINT,
  duration_ms   BIGINT NOT NULL CHECK (duration_ms > 0),
  is_auto       INTEGER NOT NULL DEFAULT 0 CHECK (is_auto IN (0, 1)),
  collected_at  BIGINT,
  created_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crafting_user ON crafting_jobs(user_id);

ALTER TABLE crafting_jobs ADD COLUMN IF NOT EXISTS is_auto INTEGER NOT NULL DEFAULT 0 CHECK (is_auto IN (0, 1));
ALTER TABLE crafting_jobs ADD COLUMN IF NOT EXISTS factory_id TEXT REFERENCES player_factories(id) ON DELETE CASCADE;
ALTER TABLE crafting_jobs ALTER COLUMN started_at DROP NOT NULL;

-- Migration: legacy per-user active index existed before multi-factory + count queueing.
DROP INDEX IF EXISTS crafting_unique_active_user;
DELETE FROM crafting_jobs WHERE factory_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS crafting_unique_active_factory
  ON crafting_jobs(factory_id)
  WHERE collected_at IS NULL AND started_at IS NOT NULL AND factory_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crafting_factory ON crafting_jobs(factory_id);

ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS revive_at BIGINT;
ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS pets_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS pets_day TEXT;
ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS listed_at BIGINT;

ALTER TABLE player_roster DROP CONSTRAINT IF EXISTS player_roster_status_check;
ALTER TABLE player_roster ADD CONSTRAINT player_roster_status_check
  CHECK (status IN ('resting', 'training', 'party', 'adventure'));

CREATE TABLE IF NOT EXISTS adventures (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mon_ids           TEXT NOT NULL,
  distance_ms       BIGINT NOT NULL CHECK (distance_ms > 0),
  provisions_spent  INTEGER NOT NULL CHECK (provisions_spent >= 0),
  started_at        BIGINT NOT NULL,
  collected_at      BIGINT,
  seed              BIGINT NOT NULL,
  report            TEXT,
  created_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_adventures_user ON adventures(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS adventures_unique_active_user
  ON adventures(user_id)
  WHERE collected_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_roster_user_created_at ON player_roster(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_roster_user_status_slot ON player_roster(user_id, status, slot_index);
CREATE INDEX IF NOT EXISTS idx_species_user_percent_kills ON player_species_data(user_id, percent DESC, kills DESC);
CREATE INDEX IF NOT EXISTS idx_farm_user_created_at ON farm_buildings(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_shop_enabled_price ON shop_items(enabled, price_credits);
CREATE INDEX IF NOT EXISTS idx_world_objects_created_at ON world_objects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quests_created_at ON quests(created_at DESC);
