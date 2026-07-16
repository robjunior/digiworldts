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
  onboarding_completed_at  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at);

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
                CHECK (status IN ('resting', 'training', 'party')),
  slot_index    INTEGER,
  revive_at     BIGINT,
  pets_today    INTEGER NOT NULL DEFAULT 0,
  pets_day      TEXT,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  CONSTRAINT roster_unique_slot UNIQUE (user_id, slot_index)
);
CREATE INDEX IF NOT EXISTS idx_roster_user ON player_roster(user_id);
CREATE INDEX IF NOT EXISTS idx_roster_status ON player_roster(user_id, status);

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
  element        TEXT NOT NULL CHECK (element IN ('fire', 'water', 'nature', 'electric', 'neutral')),
  energy_cost    INTEGER NOT NULL DEFAULT 0 CHECK (energy_cost >= 0),
  cooldown       INTEGER NOT NULL DEFAULT 0 CHECK (cooldown >= 0),
  actions_json   TEXT NOT NULL,
  tags_json      TEXT NOT NULL DEFAULT '[]',
  animation      TEXT,
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
);
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
  collected_at  BIGINT,
  CONSTRAINT training_unique_building UNIQUE (building_id)
);
CREATE INDEX IF NOT EXISTS idx_training_user ON training_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_training_active ON training_sessions(user_id) WHERE collected_at IS NULL;

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
  payload       TEXT NOT NULL DEFAULT '{}',
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at    BIGINT NOT NULL
);

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
-- active_matches (kept for parity; Redis is authoritative when CLUSTER=redis)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS active_matches (
  id           TEXT PRIMARY KEY,
  player_a     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_b     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot     TEXT NOT NULL,
  round        INTEGER NOT NULL DEFAULT 1,
  active_side  TEXT NOT NULL CHECK (active_side IN ('a','b')),
  started_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_active_matches_pa ON active_matches(player_a);
CREATE INDEX IF NOT EXISTS idx_active_matches_pb ON active_matches(player_b);

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
-- matchmaking_queue (kept for parity; Redis is authoritative when CLUSTER=redis)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matchmaking_queue (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name   TEXT NOT NULL,
  average_level  INTEGER NOT NULL CHECK (average_level >= 1),
  queued_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queued_at ON matchmaking_queue(queued_at);

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
  world_seed    INTEGER NOT NULL,
  x             INTEGER NOT NULL DEFAULT 0,
  y             INTEGER NOT NULL DEFAULT 0,
  steps_taken   INTEGER NOT NULL DEFAULT 0,
  last_move_at  BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);

ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS revive_at BIGINT;
ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS pets_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS pets_day TEXT;
