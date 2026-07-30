CREATE SCHEMA IF NOT EXISTS commerce;

CREATE TABLE IF NOT EXISTS commerce.discord_links (
  discord_id TEXT PRIMARY KEY,
  user_id TEXT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','linked','unlinked','expired')),
  oauth_state TEXT UNIQUE,
  access_token TEXT NULL,
  refresh_token TEXT NULL,
  -- TODO phase-2: encrypt with AES-256-GCM keyed by DISCORD_TOKEN_ENCRYPTION_KEY env
  token_expires_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS commerce.purchase_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_payment_id TEXT UNIQUE,
  state TEXT NOT NULL,
  amount_brl_cents INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  idempotency_key TEXT UNIQUE,
  qr_code TEXT,
  qr_code_base64 TEXT,
  ticket_url TEXT,
  expires_at BIGINT,
  delivered_at BIGINT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS commerce.purchase_events (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES commerce.purchase_sessions(id),
  from_state TEXT,
  to_state TEXT NOT NULL,
  provider_status TEXT,
  reason TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS commerce.promo_codes (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fixed_brl')),
  discount_brl_cents INT NOT NULL,
  max_uses INT NULL,
  uses_count INT NOT NULL DEFAULT 0,
  starts_at BIGINT,
  expires_at BIGINT,
  disabled_at BIGINT,
  created_by TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS commerce.promo_redemptions (
  user_id TEXT NOT NULL,
  code_id TEXT REFERENCES commerce.promo_codes(id),
  purchase_session_id TEXT,
  redeemed_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, code_id)
);

CREATE TABLE IF NOT EXISTS commerce.tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  discord_id TEXT,
  guild_id TEXT,
  channel_id TEXT UNIQUE,
  last_purchase_session_id TEXT,
  status TEXT NOT NULL,
  transcript TEXT,
  opened_at BIGINT NOT NULL,
  closed_at BIGINT,
  last_activity_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS commerce.webhook_events (
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT,
  payload_json TEXT NOT NULL,
  processed_at BIGINT NOT NULL,
  PRIMARY KEY (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS commerce.audit_log (
  id TEXT PRIMARY KEY,
  actor_discord_id TEXT,
  action TEXT NOT NULL,
  target_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);
