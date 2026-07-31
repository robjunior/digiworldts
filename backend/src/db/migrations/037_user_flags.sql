-- 037_user_flags.sql
--
-- Durable per-player flags. The dialogue DSL already speaks this language --
-- set_flag("dialogue.elder.met") writes one, flag_enabled("dialogue.elder.met")
-- reads it -- but until now there was nowhere to put them: the only flag in the
-- schema was the ad-hoc users.tutorial_seen column, which does not generalise.
--
-- Presence is the value. A row means the flag is set; no row means it is not.
-- That maps exactly onto the boolean predicate the DSL exposes, and keeps
-- set_flag idempotent without a value column to reconcile.
--
-- Flag names are dotted namespaces (dialogue.elder.met, quest.embers.briefed)
-- so a feature can sweep its own keys with a LIKE prefix without a registry.
--
-- The (user_id, flag) primary key doubles as the per-user lookup index, so no
-- secondary index is declared here.
--
-- Portable across SQLite and Postgres: TEXT columns and a BIGINT epoch, matching
-- the convention used by the other user-scoped tables.
CREATE TABLE IF NOT EXISTS user_flags (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flag    TEXT NOT NULL,
  set_at  BIGINT NOT NULL,
  PRIMARY KEY (user_id, flag)
);
