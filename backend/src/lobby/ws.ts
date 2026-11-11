/**
 * WebSocket lobby — the single /ws endpoint. Node-scoped connection registry,
 * cluster-scoped chat + presence + battle event fanout.
 *
 * Cross-node design:
 *   - `chat:global`               → pub/sub channel. One subscription per node.
 *                                    On publish, we fanout to every local WS.
 *   - `wsdeliver:{userId}`        → per-user delivery channel. Any node can
 *                                    publish; the node hosting `userId` receives
 *                                    and forwards to its WebSocket. Used by
 *                                    battle/routes to broadcast state updates
 *                                    and by the pairing loop to notify a match.
 *   - `presence:user:{userId}`    → cluster.kv with a 30s TTL. Refreshed every
 *                                    15s while the socket is alive. Deleted on
 *                                    close. Presence snapshot = read all keys.
 *
 * Wire protocol (JSON): unchanged from the single-node design — see the
 * README's "WebSocket protocol" section.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
// Side-effect import: augments RouteShorthandOptions with { websocket: true }.
import type {} from '@fastify/websocket';
import { z } from 'zod';
import { config } from '../config.js';
import { log } from '../util/log.js';
import { newId } from '../util/ids.js';
import { readSessionCookie, resolveSession } from '../auth/session.js';
import { matchmaker, type MatchPair } from '../matchmaking/queue.js';
import { PARTY_SIZE } from '../digimon/types.js';
import {
  createBattleForPair,
  dispatchAction,
  getMatchView,
  getSpectatorView,
  handleDisconnect,
  isInMatch,
  countPartyMembers,
  partyAverageLevel,
  partyTrainedness,
  activeMatchCount,
} from '../battle/routes.js';
import { joinSpectate, leaveSpectate } from '../battle/spectate.js';
import { isMember as isChatRoomMember, listMembers as listChatRoomMembers } from '../chat/rooms.js';
import { listBlockedUserIds } from '../social/friends.js';
import {
  CHAN_PATTERN as DUNGEON_CHAN_PATTERN,
  CHAN_PREFIX as DUNGEON_CHAN_PREFIX,
  dungeonPresenceScope,
  dungeonPresenceSnapshot,
  publishDungeonPayload,
  refreshDungeonPresence,
  removeDungeonPresence,
  setDungeonPresence,
  announceDungeonMove,
} from '../dungeons/presence.js';
import type { Action } from './../battle/types.js';
import { getCluster, type Unsubscribe } from '../cluster/index.js';
import { moveRun } from '../dungeons/repo.js';
import { hasActivePveBattle } from '../world/pve-battle.js';
import type { DungeonMoveResponse } from '@digiworld/shared/world';

const PRESENCE_INTERVAL_MS = 3_000;
const PRESENCE_TTL_SEC = 30;
const PRESENCE_REFRESH_MS = 15_000;
const PAIRING_INTERVAL_MS = 500;
const CHAT_WINDOW_MS = 8_000;
const CHAT_MAX_IN_WINDOW = 4;
const DISCONNECT_GRACE_MS = 15_000;
const PVP_INVITE_TTL_SEC = 30;

const CHAT_CHANNEL = 'chat:global';
const SCENE_DEFAULTS_CHANNEL = 'scene:defaults:updated';
const SCENES_CHANNEL = 'scene:scenes:updated';
const WEATHER_CHANNEL = 'weather:triggered';
const WSDELIVER_PREFIX = 'wsdeliver:';
const WSDELIVER_PATTERN = `${WSDELIVER_PREFIX}*`;
const K_PRESENCE = (userId: string): string => `presence:user:${userId}`;
const K_INVITE = (id: string): string => `pvp:invite:${id}`;

// ============================================================================
// Client → server message schemas
// ============================================================================
const ChatSchema = z.object({
  type: z.literal('chat'),
  text: z.string().trim().min(1).max(300),
  room: z.string().min(3).max(64).optional(),
  dungeonId: z.string().min(1).max(64).optional(),
  toUserId: z.string().min(3).max(64).optional(),
});
const DmOpenedSchema = z.object({
  type: z.literal('dm:opened'),
  toUserId: z.string().min(3).max(64),
});
const PvpInviteSchema = z.object({
  type: z.literal('pvp:invite'),
  targetUserId: z.string().min(3).max(64),
  dungeonId: z.string().min(1).max(64).optional(),
});
const PvpResponseSchema = z.object({
  type: z.literal('pvp:response'),
  inviteId: z.string().min(1).max(64),
  accept: z.boolean(),
});
const QueueSchema = z.object({ type: z.literal('queue'), join: z.boolean() });
const HelloSchema = z.object({ type: z.literal('hello') });
const PingSchema = z.object({ type: z.literal('ping') });

const ActionSchema: z.ZodType<Action> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fight'), unitId: z.string(), targetId: z.string() }),
  z.object({ type: z.literal('skill'), unitId: z.string(), skillId: z.string(), targetId: z.string(), extraTargetIds: z.array(z.string()).optional() }),
  z.object({ type: z.literal('capture'), unitId: z.string(), targetId: z.string() }),
  z.object({ type: z.literal('use_item'), unitId: z.string(), targetId: z.string(), itemId: z.string() }),
  z.object({ type: z.literal('guard'), unitId: z.string() }),
  z.object({ type: z.literal('flee') }),
]) as unknown as z.ZodType<Action>;

const ActSchema = z.object({ type: z.literal('act'), matchId: z.string(), action: ActionSchema });

const MAX_PUBSUB_PAYLOAD_BYTES = 64 * 1024;
const CHAT_CHANNEL_ALLOWED_TYPES = new Set(['chat']);
const WSDELIVER_ALLOWED_TYPES = new Set([
  'chat',
  'match',
  'battle',
  'event',
  'end',
  'queue',
  'presence',
  'welcome',
  'error',
  'spectate',
  'scene-defaults-updated',
  'scene-updated',
  'weather-triggered',
  'pvp:invite',
  'pvp:invite-declined',
  'pvp:invite-expired',
  'social:notify',
]);

function parsePubSubEnvelope(
  msg: string,
  allowedTypes: ReadonlySet<string>,
): { readonly type: string; readonly [k: string]: unknown } | null {
  if (msg.length > MAX_PUBSUB_PAYLOAD_BYTES) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(msg); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== 'string' || !allowedTypes.has(type)) return null;
  return parsed as { readonly type: string; readonly [k: string]: unknown };
}
const SpectateSchema = z.object({ type: z.literal('spectate'), matchId: z.string().min(1).max(64), join: z.boolean() });
const DungeonJoinSchema = z.object({
  type: z.literal('dungeon:join'),
  dungeonId: z.string().min(1).max(64),
  x: z.number().int().min(0).max(9999),
  y: z.number().int().min(0).max(9999),
  gridX: z.number().int().min(-999).max(999),
  gridY: z.number().int().min(-999).max(999),
  leaderCatalogId: z.string().min(1).max(64),
  party: z.array(z.string().min(1).max(64)).max(3),
  trail: z.array(z.object({ x: z.number().int().min(-1).max(200), y: z.number().int().min(-1).max(200) })).max(3).optional(),
});
const DungeonLeaveSchema = z.object({ type: z.literal('dungeon:leave') });
const DungeonMoveSchema = z.object({
  type: z.literal('dungeon:move'),
  correlationId: z.string().min(1).max(64),
  dungeonId: z.string().min(1).max(64),
  x: z.number().int().min(0).max(9999),
  y: z.number().int().min(0).max(9999),
  party: z.array(z.string().min(1).max(64)).max(3).optional(),
  trail: z.array(z.object({ x: z.number().int().min(-1).max(200), y: z.number().int().min(-1).max(200) })).max(3).optional(),
});

const MessageSchema = z.union([HelloSchema, PingSchema, ChatSchema, DmOpenedSchema, PvpInviteSchema, PvpResponseSchema, QueueSchema, ActSchema, SpectateSchema, DungeonJoinSchema, DungeonLeaveSchema, DungeonMoveSchema]);
type IncomingMessage = z.infer<typeof MessageSchema>;

// ============================================================================
// Node-scoped state
// ============================================================================

type PresenceEntry = {
  userId: string;
  displayName: string;
  socket: WebSocket;
  connectedAt: number;
  chatLog: number[];
  // Token bucket: refills at MSG_REFILL_PER_SEC, capped at MSG_BURST. Every
  // inbound message consumes one token. Runs on top of the per-chat window
  // so all verbs (ping/queue/act/chat) are rate-limited, not just chat.
  msgTokens: number;
  msgTokensTs: number;
  /** Presence scope this socket is joined to (group:... or dungeon:...). */
  dungeonScope: string | null;
  /** Users blocked by this player (both friendship directions). */
  blockedIds: ReadonlySet<string>;
};

const MSG_BURST = 40;
const MSG_REFILL_PER_SEC = 20;

const connections = new Map<string, PresenceEntry>();

function refillTokens(entry: PresenceEntry, nowMs: number): void {
  const dt = nowMs - entry.msgTokensTs;
  if (dt <= 0) return;
  const gained = (dt / 1000) * MSG_REFILL_PER_SEC;
  entry.msgTokens = Math.min(MSG_BURST, entry.msgTokens + gained);
  entry.msgTokensTs = nowMs;
}

function ensureUnique(userId: string, socket: WebSocket, displayName: string): PresenceEntry {
  const existing = connections.get(userId);
  if (existing && existing.socket !== socket) {
    safeSend(existing.socket, { type: 'error', code: 'displaced', message: 'signed in from another tab' });
    try { existing.socket.close(4409, 'displaced'); } catch {}
  }
  const now = Date.now();
  const entry: PresenceEntry = {
    userId, displayName, socket, connectedAt: now, chatLog: [], msgTokens: MSG_BURST, msgTokensTs: now,
    dungeonScope: null, blockedIds: new Set(),
  };
  connections.set(userId, entry);
  return entry;
}

function safeSend(socket: WebSocket, payload: unknown): void {
  try {
    if (socket.readyState === 1) socket.send(JSON.stringify(payload));
  } catch (err) {
    log.warn('ws.send.fail', { err: err instanceof Error ? err.message : String(err) });
  }
}

function broadcastLocal(payload: unknown, filter?: (e: PresenceEntry) => boolean): void {
  for (const e of connections.values()) {
    if (filter && !filter(e)) continue;
    safeSend(e.socket, payload);
  }
}

// ============================================================================
// Presence — cluster-scoped
// ============================================================================

async function presenceMarkOnline(entry: PresenceEntry): Promise<void> {
  const cluster = await getCluster();
  await cluster.set(
    K_PRESENCE(entry.userId),
    JSON.stringify({ userId: entry.userId, displayName: entry.displayName, nodeId: config.NODE_ID }),
    PRESENCE_TTL_SEC,
  );
}

async function presenceMarkOffline(userId: string): Promise<void> {
  const cluster = await getCluster();
  await cluster.del(K_PRESENCE(userId));
}

async function presenceSnapshotCluster(): Promise<Array<{ userId: string; displayName: string; nodeId: string }>> {
  const cluster = await getCluster();
  const keys = await cluster.keys(`presence:user:*`);
  const raws = await Promise.all(keys.map((k) => cluster.get(k)));
  const out: Array<{ userId: string; displayName: string; nodeId: string }> = [];
  for (const raw of raws) {
    if (!raw) continue;
    try { out.push(JSON.parse(raw) as { userId: string; displayName: string; nodeId: string }); } catch {}
  }
  return out;
}

// ============================================================================
// Cross-node WS delivery (via wsdeliver:{userId} channel + psubscribe)
// ============================================================================

/** Called by any module (battle/routes, etc.) to deliver a payload to a
 *  specific user, regardless of which node hosts their socket. */
export async function deliverToUser(userId: string, payload: unknown): Promise<void> {
  const cluster = await getCluster();
  await cluster.publish(`${WSDELIVER_PREFIX}${userId}`, JSON.stringify(payload));
}

// ============================================================================
// Reconnect grace period for in-match users
// ============================================================================
// A WS close does NOT immediately abandon the match: normal browser navigation
// (lobby.html → combat.html) closes the old socket while the user is
// mid-match. Instead we defer the abandon for DISCONNECT_GRACE_MS; if the user
// opens a new socket and sends `hello` within that window we cancel the
// pending abandon. Only real disconnects (browser closed, network down) hit
// the deferred handleDisconnect and forfeit the match.

const pendingAbandons = new Map<string, NodeJS.Timeout>();

function cancelPendingAbandon(userId: string): boolean {
  const timer = pendingAbandons.get(userId);
  if (!timer) return false;
  clearTimeout(timer);
  pendingAbandons.delete(userId);
  return true;
}

function schedulePendingAbandon(userId: string): void {
  cancelPendingAbandon(userId);
  const timer = setTimeout(() => {
    void (async () => {
      pendingAbandons.delete(userId);
      const abandoned = await handleDisconnect(userId);
      if (!abandoned) return;
      await deliverToUser(abandoned.opponentId, { type: 'battle', matchId: abandoned.matchId, view: abandoned.opponentView });
      await deliverToUser(abandoned.opponentId, {
        type: 'end',
        matchId: abandoned.matchId,
        view: abandoned.opponentView,
        outcome: abandoned.opponentView.outcome,
      });
      log.info('ws.abandon.forfeit', { userId, matchId: abandoned.matchId, nodeId: config.NODE_ID });
    })();
  }, DISCONNECT_GRACE_MS);
  timer.unref?.();
  pendingAbandons.set(userId, timer);
}

const pvpInviteExpiries = new Map<string, NodeJS.Timeout>();

function parsePvpInvite(raw: string): { fromUserId: string; toUserId: string } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (parsed === null || typeof parsed !== 'object') return null;
  const fromUserId = (parsed as { fromUserId?: unknown }).fromUserId;
  const toUserId = (parsed as { toUserId?: unknown }).toUserId;
  if (typeof fromUserId !== 'string' || typeof toUserId !== 'string') return null;
  return { fromUserId, toUserId };
}

function cancelPvpInviteExpiry(inviteId: string): boolean {
  const timer = pvpInviteExpiries.get(inviteId);
  if (!timer) return false;
  clearTimeout(timer);
  pvpInviteExpiries.delete(inviteId);
  return true;
}

function schedulePvpInviteExpiry(inviteId: string, fromUserId: string, toUserId: string): void {
  cancelPvpInviteExpiry(inviteId);
  const timer = setTimeout(() => {
    void (async () => {
      pvpInviteExpiries.delete(inviteId);
      const cluster = await getCluster();
      const raw = await cluster.get(K_INVITE(inviteId));
      if (raw === null) return;
      const invite = parsePvpInvite(raw);
      if (invite === null || invite.fromUserId !== fromUserId || invite.toUserId !== toUserId) return;
      await cluster.del(K_INVITE(inviteId));
      await deliverToUser(fromUserId, { type: 'pvp:invite-expired', inviteId });
      await deliverToUser(toUserId, { type: 'pvp:invite-expired', inviteId });
      log.info('pvp.invite.expired', { inviteId, fromUserId, toUserId, nodeId: config.NODE_ID });
    })();
  }, PVP_INVITE_TTL_SEC * 1000);
  timer.unref?.();
  pvpInviteExpiries.set(inviteId, timer);
}

// ============================================================================
// Message handlers
// ============================================================================

type Handler = (entry: PresenceEntry, msg: IncomingMessage) => Promise<void>;

const handleHello: Handler = async (entry) => {
  cancelPendingAbandon(entry.userId);
  const inMatch = await getMatchView(entry.userId);
  const presence = await presenceSnapshotCluster();
  const welcome: Record<string, unknown> = {
    type: 'welcome',
    user: { id: entry.userId, displayName: entry.displayName },
    presence: presence.map((p) => ({ userId: p.userId, displayName: p.displayName })),
    activeMatches: await activeMatchCount(),
    nodeId: config.NODE_ID,
  };
  if (inMatch) welcome.matchId = inMatch.matchId;
  safeSend(entry.socket, welcome);
  if (inMatch) safeSend(entry.socket, { type: 'match', matchId: inMatch.matchId, view: inMatch.view });
};

const handlePing: Handler = async (entry) => {
  safeSend(entry.socket, { type: 'pong' });
};

// When a user opens a DM tab with a friend, tell the friend so their client
// auto-opens the same DM chat. Mirrors direct-message routing: deliver to the
// target only, refusing draws from users the target has blocked.
const handleDmOpened: Handler = async (entry, msg) => {
  if (msg.type !== 'dm:opened') return;
  if (msg.toUserId === entry.userId) return;
  const blockedByTarget = await listBlockedUserIds(msg.toUserId);
  if (blockedByTarget.includes(entry.userId)) return;
  await deliverToUser(msg.toUserId, {
    type: 'dm:opened',
    fromUserId: entry.userId,
    fromName: entry.displayName,
  });
};

async function leaveDungeon(entry: PresenceEntry): Promise<void> {
  entry.dungeonScope = null;
  entry.blockedIds = new Set();
}

const handleDungeonJoin: Handler = async (entry, msg) => {
  if (msg.type !== 'dungeon:join') return;
  await leaveDungeon(entry);
  entry.dungeonScope = msg.dungeonId;
  entry.blockedIds = new Set(await listBlockedUserIds(entry.userId));
  safeSend(entry.socket, { type: 'dungeon:players', dungeonId: msg.dungeonId, players: [] });
};

const handleDungeonLeave: Handler = async (entry) => {
  await leaveDungeon(entry);
};

const handleDungeonMove: Handler = async (entry, msg) => {
  if (msg.type !== 'dungeon:move') return;
  if (entry.dungeonScope === null) {
    safeSend(entry.socket, { type: 'dungeon:move-error', correlationId: msg.correlationId, code: 'bad-message', message: 'Not in a dungeon.' });
    return;
  }
  const moved = await moveRun(entry.userId, msg.dungeonId, msg.x, msg.y);
  if (!moved.ok) {
    safeSend(entry.socket, { type: 'dungeon:move-error', correlationId: msg.correlationId, code: 'unknown', message: 'Move failed.' });
    return;
  }
  const result: DungeonMoveResponse = {
    run: moved.run,
    triggeredEncounterId: null,
    pickedUpItemId: null,
  };
  safeSend(entry.socket, { type: 'dungeon:move-result', correlationId: msg.correlationId, result });
};

const handleChat: Handler = async (entry, msg) => {
  if (msg.type !== 'chat') return;
  const now = Date.now();
  entry.chatLog = entry.chatLog.filter((t) => now - t < CHAT_WINDOW_MS);
  if (entry.chatLog.length >= CHAT_MAX_IN_WINDOW) {
    safeSend(entry.socket, { type: 'error', code: 'chat-rate-limit', message: 'slow down' });
    return;
  }
  entry.chatLog.push(now);
  const cluster = await getCluster();
  const basePayload = {
    type: 'chat' as const,
    from: entry.userId,
    displayName: entry.displayName,
    text: msg.text,
    at: now,
    nodeId: config.NODE_ID,
  };
  if (msg.room !== undefined && msg.dungeonId !== undefined) {
    safeSend(entry.socket, { type: 'error', code: 'bad-message', message: 'room and dungeonId are mutually exclusive' });
    return;
  }
  // Direct message: deliver only to sender + recipient (DM chat tab).
  if (msg.toUserId !== undefined && msg.toUserId !== entry.userId) {
    const blockedByTarget = await listBlockedUserIds(msg.toUserId);
    if (blockedByTarget.includes(entry.userId)) {
      safeSend(entry.socket, { type: 'error', code: 'blocked', message: 'that user has blocked you' });
      return;
    }
    const dmPayload = JSON.stringify({ ...basePayload, toUserId: msg.toUserId });
    await Promise.all([
      cluster.publish(`${WSDELIVER_PREFIX}${entry.userId}`, dmPayload),
      cluster.publish(`${WSDELIVER_PREFIX}${msg.toUserId}`, dmPayload),
    ]);
    return;
  }
  if (msg.room !== undefined) {
    const member = await isChatRoomMember(msg.room, entry.userId);
    if (!member) {
      safeSend(entry.socket, { type: 'error', code: 'not-in-room', message: 'you are not a member of that room' });
      return;
    }
    const members = await listChatRoomMembers(msg.room);
    const payload = JSON.stringify({ ...basePayload, room: msg.room });
    await Promise.all(members.map((uid) => cluster.publish(`${WSDELIVER_PREFIX}${uid}`, payload)));
    return;
  }
  if (msg.dungeonId !== undefined) {
    const expectedScope = await dungeonPresenceScope(msg.dungeonId);
    if (expectedScope === null || entry.dungeonScope !== expectedScope) {
      safeSend(entry.socket, { type: 'error', code: 'not-in-room', message: 'you are not in that dungeon' });
      return;
    }
    await publishDungeonPayload(entry.dungeonScope, { ...basePayload, dungeonId: msg.dungeonId });
    return;
  }
  await cluster.publish(CHAT_CHANNEL, JSON.stringify(basePayload));
};

const handleQueue: Handler = async (entry, msg) => {
  if (msg.type !== 'queue') return;
  if (await isInMatch(entry.userId)) {
    safeSend(entry.socket, { type: 'error', code: 'in-match', message: 'you are already in a match' });
    return;
  }
  if (msg.join) {
    const partySize = await countPartyMembers(entry.userId);
    if (partySize !== PARTY_SIZE) {
      safeSend(entry.socket, {
        type: 'error',
        code: 'party-invalid',
        message: `Ranked needs exactly ${PARTY_SIZE} Digimon in your party — you have ${partySize}.`,
      });
      safeSend(entry.socket, { type: 'queue', status: 'idle', size: await matchmaker.size() });
      return;
    }
    const level = await partyAverageLevel(entry.userId);
    const trainedness = await partyTrainedness(entry.userId);
    const result = await matchmaker.enqueue({
      userId: entry.userId,
      displayName: entry.displayName,
      averageLevel: level,
      trainedness,
      queuedAt: Date.now(),
    });
    if (result === 'full') {
      safeSend(entry.socket, { type: 'error', code: 'queue-full', message: 'try again shortly' });
    } else {
      safeSend(entry.socket, { type: 'queue', status: 'waiting', size: await matchmaker.size(), since: Date.now() });
    }
  } else {
    await matchmaker.dequeue(entry.userId);
    safeSend(entry.socket, { type: 'queue', status: 'idle', size: await matchmaker.size() });
  }
};

const handleAct: Handler = async (entry, msg) => {
  if (msg.type !== 'act') return;
  const result = await dispatchAction(entry.userId, msg.matchId, msg.action);
  if (!result.ok) {
    safeSend(entry.socket, { type: 'error', code: result.code, message: result.error });
    return;
  }
  // dispatchAction publishes state updates to wsdeliver:{userId} for both
  // players itself — no local send needed.
};

const handleSpectate: Handler = async (entry, msg) => {
  if (msg.type !== 'spectate') return;
  if (msg.join) {
    const result = await joinSpectate(msg.matchId, entry.userId);
    if (!result.ok) {
      safeSend(entry.socket, { type: 'spectate', matchId: msg.matchId, status: result.error });
      return;
    }
    if (result.status === 'already-in-match') {
      safeSend(entry.socket, { type: 'spectate', matchId: msg.matchId, status: 'already-in-match' });
      return;
    }
    const view = await getSpectatorView(msg.matchId);
    if (!view) {
      safeSend(entry.socket, { type: 'spectate', matchId: msg.matchId, status: 'not-found' });
      return;
    }
    safeSend(entry.socket, { type: 'spectate', matchId: msg.matchId, status: 'joined', view: view.view, count: result.count });
  } else {
    await leaveSpectate(msg.matchId, entry.userId);
    safeSend(entry.socket, { type: 'spectate', matchId: msg.matchId, status: 'left' });
  }
};

const handlePvpInvite: Handler = async (entry, msg) => {
  if (msg.type !== 'pvp:invite') return;
  if (msg.targetUserId === entry.userId) {
    safeSend(entry.socket, { type: 'error', code: 'pvp-self-invite', message: 'you cannot challenge yourself' });
    return;
  }
  if (await isInMatch(entry.userId)) {
    safeSend(entry.socket, { type: 'error', code: 'in-match', message: 'you are already in a match' });
    return;
  }
  const cluster = await getCluster();
  if ((await cluster.get(K_PRESENCE(msg.targetUserId))) === null) {
    safeSend(entry.socket, { type: 'error', code: 'pvp-target-offline', message: 'that player is not online' });
    return;
  }
  if (await isInMatch(msg.targetUserId)) {
    safeSend(entry.socket, { type: 'error', code: 'pvp-target-in-match', message: 'that player is already in a match' });
    return;
  }
  const blockedByMe = await listBlockedUserIds(entry.userId);
  const blockedByTarget = await listBlockedUserIds(msg.targetUserId);
  // A block in either direction kills the challenge.
  if (blockedByMe.includes(msg.targetUserId) || blockedByTarget.includes(entry.userId)) {
    safeSend(entry.socket, { type: 'error', code: 'pvp-blocked', message: 'you cannot challenge that player' });
    return;
  }
  const inviteId = newId('pvp');
  await cluster.set(
    K_INVITE(inviteId),
    JSON.stringify({ fromUserId: entry.userId, toUserId: msg.targetUserId, dungeonId: msg.dungeonId, at: Date.now() }),
    PVP_INVITE_TTL_SEC,
  );
  schedulePvpInviteExpiry(inviteId, entry.userId, msg.targetUserId);
  await deliverToUser(msg.targetUserId, {
    type: 'pvp:invite',
    inviteId,
    fromUserId: entry.userId,
    fromName: entry.displayName,
    dungeonId: msg.dungeonId,
  });
};

const handlePvpResponse: Handler = async (entry, msg) => {
  if (msg.type !== 'pvp:response') return;
  const cluster = await getCluster();
  const raw = await cluster.get(K_INVITE(msg.inviteId));
  if (raw === null) {
    safeSend(entry.socket, { type: 'error', code: 'pvp-invite-not-found', message: 'invite expired or not found' });
    return;
  }
  const invite = parsePvpInvite(raw);
  // Consume before acting — a replayed response must not reuse the invite.
  await cluster.del(K_INVITE(msg.inviteId));
  if (invite === null || invite.toUserId !== entry.userId) {
    safeSend(entry.socket, { type: 'error', code: 'pvp-invite-not-found', message: 'invite expired or not found' });
    return;
  }
  cancelPvpInviteExpiry(msg.inviteId);
  if (!msg.accept) {
    await deliverToUser(invite.fromUserId, {
      type: 'pvp:invite-declined',
      inviteId: msg.inviteId,
      fromName: entry.displayName,
    });
    return;
  }
  const outcome = await createBattleForPair(invite.fromUserId, entry.userId);
  if (!outcome.ok) {
    log.warn('pvp.response.reject', { error: outcome.error, who: outcome.who });
    if (outcome.who) {
      await deliverToUser(outcome.who, { type: 'error', code: 'loadout-invalid', message: outcome.error });
    }
    await deliverToUser(outcome.who === invite.fromUserId ? entry.userId : invite.fromUserId, {
      type: 'pvp:invite-declined',
      inviteId: msg.inviteId,
      fromName: entry.displayName,
    });
  }
};

const dispatcher: Record<IncomingMessage['type'], Handler> = {
  hello: handleHello,
  ping: handlePing,
  chat: handleChat,
  'dm:opened': handleDmOpened,
  queue: handleQueue,
  act: handleAct,
  spectate: handleSpectate,
  'dungeon:join': handleDungeonJoin,
  'dungeon:leave': handleDungeonLeave,
  'dungeon:move': handleDungeonMove,
  'pvp:invite': handlePvpInvite,
  'pvp:response': handlePvpResponse,
};

// ============================================================================
// Loops
// ============================================================================

let pairingTimer: NodeJS.Timeout | null = null;
let presenceTimer: NodeJS.Timeout | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let chatUnsub: Unsubscribe | null = null;
let sceneDefaultsUnsub: Unsubscribe | null = null;
let scenesUnsub: Unsubscribe | null = null;
let weatherUnsub: Unsubscribe | null = null;
let deliverUnsub: Unsubscribe | null = null;
let dungeonUnsub: Unsubscribe | null = null;

const DUNGEON_CHAN_ALLOWED_TYPES = new Set(['dungeon:player-update', 'dungeon:player-left', 'chat']);

async function runPairing(): Promise<void> {
  await matchmaker.purgeStale();
  for (let attempts = 0; attempts < 4; attempts++) {
    const pair: MatchPair | null = await matchmaker.tryPair();
    if (!pair) return;
    const outcome = await createBattleForPair(pair.a.userId, pair.b.userId);
    if (!outcome.ok) {
      log.warn('mm.pair.reject', { error: outcome.error, who: outcome.who });
      const guiltyId = outcome.who;
      if (guiltyId && guiltyId === pair.a.userId) {
        await matchmaker.enqueue({ ...pair.b, queuedAt: Date.now() });
      } else if (guiltyId && guiltyId === pair.b.userId) {
        await matchmaker.enqueue({ ...pair.a, queuedAt: Date.now() });
      }
      if (guiltyId) {
        await deliverToUser(guiltyId, { type: 'error', code: 'loadout-invalid', message: outcome.error });
        await deliverToUser(guiltyId, { type: 'queue', status: 'idle', size: await matchmaker.size() });
      }
      continue;
    }
    // createBattleForPair publishes the initial 'match' message to both
    // players via wsdeliver — no direct send here.
  }
}

async function runPresenceBroadcast(): Promise<void> {
  const presence = await presenceSnapshotCluster();
  broadcastLocal({
    type: 'presence',
    users: presence.map((p) => ({ userId: p.userId, displayName: p.displayName })),
    count: presence.length,
  });
}

async function runPresenceRefresh(): Promise<void> {
  const cluster = await getCluster();
  await Promise.all(
    [...connections.values()].map((entry) => cluster.expire(K_PRESENCE(entry.userId), PRESENCE_TTL_SEC)),
  );
}

async function startCloudLoops(): Promise<void> {
  const cluster = await getCluster();

  if (chatUnsub) await chatUnsub();
  chatUnsub = await cluster.subscribe(CHAT_CHANNEL, (msg) => {
    const parsed = parsePubSubEnvelope(msg, CHAT_CHANNEL_ALLOWED_TYPES);
    if (parsed === null) return;
    broadcastLocal(parsed);
  });

  if (sceneDefaultsUnsub) await sceneDefaultsUnsub();
  sceneDefaultsUnsub = await cluster.subscribe(SCENE_DEFAULTS_CHANNEL, (msg) => {
    let payload: { at?: unknown };
    try { payload = JSON.parse(msg) as { at?: unknown }; } catch { return; }
    const at = typeof payload.at === 'number' ? payload.at : Date.now();
    broadcastLocal({ type: 'scene-defaults-updated', at });
  });

  if (scenesUnsub) await scenesUnsub();
  scenesUnsub = await cluster.subscribe(SCENES_CHANNEL, (msg) => {
    let payload: { at?: unknown };
    try { payload = JSON.parse(msg) as { at?: unknown }; } catch { return; }
    const at = typeof payload.at === 'number' ? payload.at : Date.now();
    broadcastLocal({ type: 'scene-updated', at });
  });

  if (weatherUnsub) await weatherUnsub();
  weatherUnsub = await cluster.subscribe(WEATHER_CHANNEL, (msg) => {
    const parsed = parsePubSubEnvelope(msg, WSDELIVER_ALLOWED_TYPES);
    if (parsed === null) return;
    broadcastLocal(parsed);
  });

  if (deliverUnsub) await deliverUnsub();
  deliverUnsub = await cluster.psubscribe(WSDELIVER_PATTERN, (msg, channel) => {
    const userId = channel.slice(WSDELIVER_PREFIX.length);
    const entry = connections.get(userId);
    if (!entry) return;
    const parsed = parsePubSubEnvelope(msg, WSDELIVER_ALLOWED_TYPES);
    if (parsed === null) return;
    safeSend(entry.socket, parsed);
  });

  if (dungeonUnsub) await dungeonUnsub();
  dungeonUnsub = await cluster.psubscribe(DUNGEON_CHAN_PATTERN, (msg, channel) => {
    const scope = channel.slice(DUNGEON_CHAN_PREFIX.length);
    const parsed = parsePubSubEnvelope(msg, DUNGEON_CHAN_ALLOWED_TYPES);
    if (parsed === null) return;
    for (const e of connections.values()) {
      if (e.dungeonScope !== scope) continue;
      if (parsed.type === 'chat') {
        const from = parsed.from;
        if (typeof from === 'string' && e.blockedIds.has(from)) continue;
        safeSend(e.socket, parsed);
        continue;
      }
      if (parsed.type === 'dungeon:player-update') {
        const player = parsed.player as { userId?: unknown };
        const blockedBy = Array.isArray(parsed.blockedBy) ? (parsed.blockedBy as unknown[]) : [];
        if (typeof player.userId !== 'string') continue;
        if (player.userId === e.userId) continue;
        if (e.blockedIds.has(player.userId)) continue;
        if (blockedBy.includes(e.userId)) continue;
      }
      safeSend(e.socket, parsed);
    }
  });

  if (!pairingTimer) {
    pairingTimer = setInterval(() => { void runPairing(); }, PAIRING_INTERVAL_MS);
    pairingTimer.unref?.();
  }
  if (!presenceTimer) {
    presenceTimer = setInterval(() => { void runPresenceBroadcast(); }, PRESENCE_INTERVAL_MS);
    presenceTimer.unref?.();
  }
  if (!refreshTimer) {
    refreshTimer = setInterval(() => { void runPresenceRefresh(); }, PRESENCE_REFRESH_MS);
    refreshTimer.unref?.();
  }
}

/** Test / graceful-shutdown helper. */
export async function stopLobbyLoops(): Promise<void> {
  if (pairingTimer) { clearInterval(pairingTimer); pairingTimer = null; }
  if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  if (chatUnsub) { await chatUnsub(); chatUnsub = null; }
  if (sceneDefaultsUnsub) { await sceneDefaultsUnsub(); sceneDefaultsUnsub = null; }
  if (scenesUnsub) { await scenesUnsub(); scenesUnsub = null; }
  if (weatherUnsub) { await weatherUnsub(); weatherUnsub = null; }
  if (deliverUnsub) { await deliverUnsub(); deliverUnsub = null; }
  if (dungeonUnsub) { await dungeonUnsub(); dungeonUnsub = null; }
  for (const entry of connections.values()) {
    await presenceMarkOffline(entry.userId);
  }
  connections.clear();
}

/** Legacy sync accessor: reports node-local connections for the friends module. */
export function getLobbyConnectionSnapshot(): ReadonlyMap<string, { displayName: string; connectedAt: number }> {
  const out = new Map<string, { displayName: string; connectedAt: number }>();
  for (const [id, e] of connections) out.set(id, { displayName: e.displayName, connectedAt: e.connectedAt });
  return out;
}

// ============================================================================
// Plugin
// ============================================================================

export const lobbyPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  await startCloudLoops();

  app.get('/ws', { websocket: true }, async (socket: WebSocket, req: FastifyRequest) => {
    // `ws` silently drops frames that arrive while no 'message' listener is
    // attached. Auth and presence below are async, and the client sends
    // `hello` the instant the socket opens — without this buffer that frame
    // is lost and the client never receives `welcome`.
    const buffered: unknown[] = [];
    let onMessage: (raw: unknown) => void = (raw) => { buffered.push(raw); };
    socket.on('message', (raw: unknown) => { onMessage(raw); });

    // Fast-path saturation reject BEFORE session resolution: prevents an
    // unauthenticated flood from spending event-loop budget on Redis/DB
    // session lookups once the per-node cap is already met.
    if (connections.size >= config.MAX_LOBBY_CONNECTIONS) {
      safeSend(socket, { type: 'error', code: 'lobby-full', message: 'lobby full — try later' });
      try { socket.close(4503, 'lobby-full'); } catch {}
      return;
    }
    const token = readSessionCookie(req);
    const session = await resolveSession(token ?? undefined);
    if (!session) {
      safeSend(socket, { type: 'error', code: 'unauth', message: 'sign in first' });
      try { socket.close(4401, 'unauthenticated'); } catch {}
      return;
    }

    const entry = ensureUnique(session.user.id, socket, session.user.display_name);
    await presenceMarkOnline(entry);
    log.info('ws.connect', { userId: entry.userId, size: connections.size, nodeId: config.NODE_ID });

    onMessage = (raw: unknown): void => {
      let text: string;
      if (typeof raw === 'string') text = raw;
      else if (raw instanceof Buffer) text = raw.toString('utf8');
      else if (raw instanceof ArrayBuffer) text = Buffer.from(raw).toString('utf8');
      else if (Array.isArray(raw)) text = Buffer.concat(raw as Buffer[]).toString('utf8');
      else text = String(raw);
      if (text.length > 8_000) {
        safeSend(socket, { type: 'error', code: 'payload-too-large', message: 'message too big' });
        return;
      }
      refillTokens(entry, Date.now());
      if (entry.msgTokens < 1) {
        safeSend(socket, { type: 'error', code: 'rate-limit', message: 'too many messages — slow down' });
        return;
      }
      entry.msgTokens -= 1;
      let parsed: unknown;
      try { parsed = JSON.parse(text); }
      catch {
        safeSend(socket, { type: 'error', code: 'bad-json', message: 'expected JSON' });
        return;
      }
      const msgResult = MessageSchema.safeParse(parsed);
      if (!msgResult.success) {
        safeSend(socket, { type: 'error', code: 'bad-message', message: msgResult.error.issues[0]?.message ?? 'unknown' });
        return;
      }
      const handler = dispatcher[msgResult.data.type];
      void handler(entry, msgResult.data).catch((err: unknown) => {
        log.warn('ws.handler.fail', { userId: entry.userId, type: msgResult.data.type, err: err instanceof Error ? err.message : String(err) });
      });
    };
    for (const raw of buffered.splice(0)) onMessage(raw);

    socket.on('close', () => {
      void (async () => {
        // `ensureUnique` displaces the old socket on reconnect, so its close
        // lands after the replacement is registered. Cleaning up here would
        // delete the live entry and drop the user from the queue.
        if (connections.get(entry.userId) !== entry) {
          log.info('ws.close.superseded', { userId: entry.userId, nodeId: config.NODE_ID });
          return;
        }
        connections.delete(entry.userId);
        await presenceMarkOffline(entry.userId);
        await leaveDungeon(entry);
        schedulePendingAbandon(entry.userId);
        await matchmaker.dequeue(entry.userId);
        log.info('ws.close', { userId: entry.userId, size: connections.size, nodeId: config.NODE_ID });
      })();
    });

    socket.on('error', (err: Error) => {
      log.warn('ws.error', { userId: entry.userId, err: err.message });
    });
  });
};
