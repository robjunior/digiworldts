---
tags:
  - digiworld/system
  - digiworld/api
aliases:
  - Chat
  - Rooms
  - DMs
  - Direct Messages
  - Chat Rooms
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - backend/src/chat/routes.ts
  - backend/src/chat/rooms.ts
  - backend/src/lobby/ws.ts
  - shared/src/ws.ts
  - backend/src/db/migrations/002_chat_rooms.sql
verified-at-commit: 13dc16b
---

# Chat

> [!info] TL;DR
> Three lanes: **global chat** (fire-and-forget broadcast on `chat:global`
> pub/sub), **rooms** (owner + N members, SQL-backed membership,
> per-member fanout via `wsdeliver:{userId}`), and **DMs** (rooms with
> `kind='dm'` and exactly 2 members, find-or-create). All three use the
> SAME `chat` WS message on the wire — `room?` field discriminates.

## Data model — `chat/rooms.ts`

```typescript
export type RoomKind = 'room' | 'dm';

export type ChatRoomRow = {
  id: string;
  name: string;
  kind: RoomKind;
  owner_id: string | null;   // NULL for DMs (no ownership)
  created_at: number;
};

export type ChatRoomMemberRow = {
  room_id: string;
  user_id: string;
  joined_at: number;
};
```

Two DDL tables landed via [migration `002_chat_rooms.sql`](backend/src/db/migrations/002_chat_rooms.sql):

- **`chat_rooms`** — one row per group/DM
- **`chat_room_members`** — the join table; a user is a member iff a row
  exists here

## The three lanes

### 1. Global chat

WS `{ type: 'chat', text: '...' }` with **no `room`** field. Server
publishes to `chat:global`; every node's WS lobby subscribes and fans
out to every local socket. See [[WebSocket Protocol#Cross-node delivery]].

Zero DB writes. Fire-and-forget: if you're offline, you don't see it.

### 2. Rooms

Group chats. Anyone can create + join by ID (no invite gating currently).
WS `{ type: 'chat', text: '...', room: 'rm_...' }` triggers:

1. Server validates the sender is in `chat_room_members`.
2. Server queries the room's members.
3. For each member, publishes to `wsdeliver:{userId}` — same substrate as
   battle events + match starts.

### 3. DMs

Rooms with `kind='dm'` and exactly 2 members. Find-or-create semantics:
`POST /api/chat/dm/open { username }` returns the existing DM if one
exists, mints one otherwise. The client can call it idempotently.

Owner column stores the DM initiator for auditing but doesn't grant
special privileges — DMs have no owner-only actions.

## HTTP surface — [`chat/routes.ts`](backend/src/chat/routes.ts)

Every route is auth-gated on cookie.

| Method | Path                             | Body                | Response                         | Errors                                 |
| ------ | -------------------------------- | ------------------- | -------------------------------- | -------------------------------------- |
| POST   | `/api/chat/room/create`          | `{ name }`          | `{ room }`                       | 400 invalid-input                       |
| POST   | `/api/chat/room/join`            | `{ roomId }`        | `{ ok }`                         | 404 room-not-found, 400 cannot-join-dm  |
| POST   | `/api/chat/room/leave`           | `{ roomId }`        | `{ ok }`                         | 404 room-not-found                      |
| GET    | `/api/chat/rooms/mine`           | —                   | `{ rooms }` (with member counts) | —                                      |
| POST   | `/api/chat/dm/open`              | `{ username }`      | `{ room, created, otherUser }`   | 404 user-not-found, 400 self-dm          |

Zod schemas ([`routes.ts:20-25`](backend/src/chat/routes.ts:20)):

```typescript
const RoomNameSchema = z.string().trim().min(2).max(48);
const UsernameSchema = z.string().trim().min(3).max(24);
const RoomIdSchema   = z.string().min(3).max(64);
```

Room name is 2–48 chars (post-trim); short room ids like `rm_x` are
rejected by the `min(3)` guard on the parameter side.

## WS message extension

From [`shared/src/ws.ts:32`](shared/src/ws.ts:32):

```typescript
| { type: 'chat'; text: string; room?: string }
```

Server → client shape ([`shared/src/ws.ts:86-95`](shared/src/ws.ts:86)):

```typescript
| {
    type: 'chat';
    from: string;         // userId
    displayName: string;
    text: string;
    at: number;
    room?: string;         // undefined for global
  }
```

The `room?` on both directions is the discriminator. `undefined` →
global; string → per-room fanout.

## Find-or-create DM (idempotency)

The single-query find-or-create is in
[`rooms.ts::openDm`](backend/src/chat/rooms.ts). SQL scans `chat_rooms`
for a `kind='dm'` room where both user ids are members AND total member
count = 2:

```sql
SELECT r.id, r.name, r.kind, r.owner_id, r.created_at
  FROM chat_rooms r
 WHERE r.kind = 'dm'
   AND EXISTS (SELECT 1 FROM chat_room_members m WHERE m.room_id = r.id AND m.user_id = ?)
   AND EXISTS (SELECT 1 FROM chat_room_members m WHERE m.room_id = r.id AND m.user_id = ?)
   AND (SELECT COUNT(*) FROM chat_room_members m WHERE m.room_id = r.id) = 2
 LIMIT 1
```

Hit → return `{ created: false, room }`. Miss → INSERT a fresh
`chat_rooms` row with `kind='dm'`, INSERT both member rows, return
`{ created: true, room }`.

> [!info] `LIMIT 1` is defensive
> If two `openDm` calls race against a fresh pair, both may miss the
> SELECT and both may INSERT — leaving TWO DM rooms for the same pair.
> The `LIMIT 1` on future SELECTs keeps `openDm` idempotent even in that
> case, but the duplicate room lingers. A followup UNIQUE constraint on
> (kind='dm', sorted(a,b)) would prevent this cleanly.

## Fanout code path

See [`backend/src/lobby/ws.ts::handleChat`](backend/src/lobby/ws.ts) for
the exact fanout — abbreviated:

```typescript
if (msg.room) {
  const member = await isMember(msg.room, sender.id);
  if (!member) return sendError(socket, 'not-a-member');
  const members = await listMembers(msg.room);
  const payload = JSON.stringify({ type: 'chat', from: sender.id, ..., room: msg.room });
  await Promise.all(members.map((uid) => cluster.publish(`wsdeliver:${uid}`, payload)));
} else {
  await cluster.publish('chat:global', payload);
}
```

## Rate limits

Chat is capped at **4 messages per 8-second sliding window per user** —
see [[WebSocket Protocol#Rate limits]]. Fifth message returns
`{code:'chat-rate-limit'}`. The counter is per-user, so a chatty user
can't drown a room by hopping between global and rooms.

## What can go wrong

> [!warning] Sender no longer a member on delivery
> Between "send" and "fanout", the sender COULD have left the room. The
> `handleChat` check is at send time; if a race is theoretically
> possible, the delivered message will still fan out to the CURRENT
> members, which may include people the sender didn't know were there.
> Not a security issue (rooms are opt-in membership), but worth being
> aware of.

> [!warning] `wsdeliver:*` psubscribe misconfigured
> If ONE node fails to psubscribe `wsdeliver:*` at boot, chat messages
> intended for users on that node silently disappear. Verify at boot via
> `mm.hydrate.ok` + a chat smoke test after every deploy. See
> [[Cluster Coordination Layer#Cross-node WS delivery]].

## What's NOT here (roadmap)

- **Message persistence.** Neither global nor room chat writes messages
  to disk. Refreshing loses the backlog. Adding a `chat_messages` table
  is a follow-up.
- **Moderation.** No mute, no ban, no report. When persistence lands,
  moderation actions become tractable.
- **Presence per room.** `presence:user:{userId}` is global. There's no
  "who's active in room X right now" query.
- **Notifications.** No unread counts, no push notifications, no bell
  chime. All in follow-ups.

## Related

- [[WebSocket Protocol]] — the `chat` message shape end-to-end
- [[HTTP Surface#Chat]]
- [[Cluster Coordination Layer]] — `chat:global` + `wsdeliver:{userId}`
- [[Session cookies]] — the auth on `/api/chat/*` + WS
