-- 045_oauth_tokens.sql
--
-- OAuth2 identity + token storage. Each row binds one (provider, provider_user_id)
-- to a DigiWorld user, so the same Discord/Google/Facebook account can never
-- belong to two DigiWorld users. Access + refresh tokens are stored so we can
-- call the provider's API later (e.g., check Discord guild membership).
--
-- Portable across SQLite and Postgres:
--   - BIGINT is 8 bytes on Postgres AND accepted by better-sqlite3, which
--     stores it as a native 64-bit integer. Millisecond timestamps are ~1.78e12
--     in the 2020s, so INTEGER (INT4, max 2.1e9) overflows on Postgres — do
--     NOT downgrade these columns. The historical INTEGER declaration was
--     patched by migration 049_oauth_tokens_bigint.pg.sql for existing dbs.
--   - `REFERENCES users(id) ON DELETE CASCADE` is standard SQL, both accept.
--   - `PRIMARY KEY (user_id, provider)` gives us one identity per user per
--     provider; the extra UNIQUE(provider, provider_user_id) guarantees the
--     inverse — one DigiWorld user per Discord ID — mirroring the semantics
--     `users.discord_id UNIQUE` already enforces for the legacy code-based
--     link flow (see backend/src/auth/discord-link.ts).

CREATE TABLE IF NOT EXISTS oauth_tokens (
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  provider_user_id  TEXT NOT NULL,
  provider_username TEXT,
  provider_avatar   TEXT,
  access_token      TEXT NOT NULL,
  refresh_token     TEXT,
  expires_at        BIGINT,
  scope             TEXT NOT NULL,
  linked_at         BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL,
  PRIMARY KEY (user_id, provider),
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_provider_user ON oauth_tokens(provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_id ON oauth_tokens(user_id);
