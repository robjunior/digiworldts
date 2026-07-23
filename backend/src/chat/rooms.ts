/**
 * Chat rooms + DMs — SQL layer.
 *
 * Rooms are group chats with an owner + N members. DMs are the same shape
 * with `kind = 'dm'` and exactly 2 members; find-or-create keeps them
 * idempotent so the client can `openDm(username)` without racing itself.
 *
 * Fanout is NOT in this file — the WS handler publishes to each member's
 * wsdeliver:{userId} channel using the same substrate as battle events.
 * See src/lobby/ws.ts::handleChat.
 */
import { newId } from '../util/ids.js';
import { one, q, run, type UserRow } from '../db/index.js';

export type RoomKind = 'room' | 'dm';

export type ChatRoomRow = {
  id: string;
  name: string;
  kind: RoomKind;
  owner_id: string | null;
  created_at: number;
};

export type ChatRoomMemberRow = {
  room_id: string;
  user_id: string;
  joined_at: number;
};

export type RoomView = {
  id: string;
  name: string;
  kind: RoomKind;
  ownerId: string | null;
  createdAt: number;
  memberCount: number;
};

const SQL_INSERT_ROOM = `INSERT INTO chat_rooms (id, name, kind, owner_id, created_at) VALUES (?, ?, ?, ?, ?)`;
const SQL_INSERT_MEMBER = `INSERT INTO chat_room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)`;
const SQL_DELETE_MEMBER = `DELETE FROM chat_room_members WHERE room_id = ? AND user_id = ?`;
const SQL_ROOM_BY_ID = `SELECT * FROM chat_rooms WHERE id = ?`;
const SQL_IS_MEMBER = `SELECT 1 AS ok FROM chat_room_members WHERE room_id = ? AND user_id = ?`;
const SQL_MEMBERS = `SELECT user_id FROM chat_room_members WHERE room_id = ?`;
const SQL_MY_ROOMS = `
  SELECT r.id, r.name, r.kind, r.owner_id, r.created_at,
         (SELECT COUNT(*) FROM chat_room_members m2 WHERE m2.room_id = r.id) AS member_count
    FROM chat_rooms r
    JOIN chat_room_members m ON m.room_id = r.id
   WHERE m.user_id = ?
   ORDER BY r.created_at DESC
`;
const SQL_USER_BY_USERNAME = `SELECT id, display_name FROM users WHERE username = ?`;
// Find an existing DM containing exactly the two given user_ids.
const SQL_FIND_DM = `
  SELECT r.id, r.name, r.kind, r.owner_id, r.created_at
    FROM chat_rooms r
   WHERE r.kind = 'dm'
     AND EXISTS (SELECT 1 FROM chat_room_members m WHERE m.room_id = r.id AND m.user_id = ?)
     AND EXISTS (SELECT 1 FROM chat_room_members m WHERE m.room_id = r.id AND m.user_id = ?)
     AND (SELECT COUNT(*) FROM chat_room_members m WHERE m.room_id = r.id) = 2
   LIMIT 1
`;

function rowToView(row: ChatRoomRow, memberCount: number): RoomView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    memberCount,
  };
}

export async function createRoom(ownerId: string, name: string): Promise<RoomView> {
  const id = newId('rm');
  const now = Date.now();
  await run(SQL_INSERT_ROOM, [id, name, 'room', ownerId, now]);
  await run(SQL_INSERT_MEMBER, [id, ownerId, now]);
  return { id, name, kind: 'room', ownerId, createdAt: now, memberCount: 1 };
}

export type DmOpenError = 'user-not-found' | 'self-dm';
export type DmOpenResult =
  | { ok: true; room: RoomView; created: boolean; otherUser: { id: string; displayName: string } }
  | { ok: false; error: DmOpenError };

export async function openDm(userId: string, otherUsername: string): Promise<DmOpenResult> {
  const other = await one<Pick<UserRow, 'id' | 'display_name'>>(SQL_USER_BY_USERNAME, otherUsername);
  if (!other) return { ok: false, error: 'user-not-found' };
  if (other.id === userId) return { ok: false, error: 'self-dm' };
  const existing = await one<ChatRoomRow>(SQL_FIND_DM, userId, other.id);
  if (existing) {
    return {
      ok: true,
      room: rowToView(existing, 2),
      created: false,
      otherUser: { id: other.id, displayName: other.display_name },
    };
  }
  const id = newId('dm');
  const now = Date.now();
  const label = `DM: ${other.display_name}`;
  await run(SQL_INSERT_ROOM, [id, label, 'dm', userId, now]);
  await run(SQL_INSERT_MEMBER, [id, userId, now]);
  await run(SQL_INSERT_MEMBER, [id, other.id, now]);
  return {
    ok: true,
    room: { id, name: label, kind: 'dm', ownerId: userId, createdAt: now, memberCount: 2 },
    created: true,
    otherUser: { id: other.id, displayName: other.display_name },
  };
}

export async function joinRoom(roomId: string, userId: string): Promise<'ok' | 'not-found' | 'is-dm'> {
  const room = await one<ChatRoomRow>(SQL_ROOM_BY_ID, roomId);
  if (!room) return 'not-found';
  if (room.kind === 'dm') return 'is-dm';
  const already = await one<{ ok: number }>(SQL_IS_MEMBER, roomId, userId);
  if (already) return 'ok';
  await run(SQL_INSERT_MEMBER, [roomId, userId, Date.now()]);
  return 'ok';
}

export async function leaveRoom(roomId: string, userId: string): Promise<'ok' | 'not-found'> {
  const room = await one<ChatRoomRow>(SQL_ROOM_BY_ID, roomId);
  if (!room) return 'not-found';
  await run(SQL_DELETE_MEMBER, [roomId, userId]);
  return 'ok';
}

export async function isMember(roomId: string, userId: string): Promise<boolean> {
  const row = await one<{ ok: number }>(SQL_IS_MEMBER, roomId, userId);
  return row !== null;
}

export async function listMembers(roomId: string): Promise<string[]> {
  const rows = await q<{ user_id: string }>(SQL_MEMBERS, roomId);
  return rows.map((r) => r.user_id);
}

export async function listMyRooms(userId: string): Promise<RoomView[]> {
  const rows = await q<ChatRoomRow & { member_count: number }>(SQL_MY_ROOMS, userId);
  return rows.map((r) => rowToView(r, r.member_count));
}

export async function getRoom(roomId: string): Promise<RoomView | null> {
  const row = await one<ChatRoomRow>(SQL_ROOM_BY_ID, roomId);
  if (!row) return null;
  const members = await listMembers(roomId);
  return rowToView(row, members.length);
}
