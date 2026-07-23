-- Chat rooms and DMs.
--
-- kind='room' = named group chat (any member can chat, only owner can rename).
-- kind='dm'   = private 2-member direct message (created via find-or-create).
--
-- Membership is (room_id, user_id) with ON DELETE CASCADE on both sides so
-- deleting a user cleanly tears down their DM rows.
--
-- Global chat (`chat:global` pub/sub channel) does NOT need a row here — it's
-- a free-for-all channel that every authed WS is subscribed to.
CREATE TABLE IF NOT EXISTS chat_rooms (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('room','dm')),
  owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_owner ON chat_rooms(owner_id);

CREATE TABLE IF NOT EXISTS chat_room_members (
  room_id    TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  BIGINT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_room_members_user ON chat_room_members(user_id);
