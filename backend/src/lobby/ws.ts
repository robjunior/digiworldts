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
import { readSessionCookie, resolveSession } from '../auth/session.js';
import { matchmaker, type MatchPair } from '../matchmaking/queue.js';
import {
  createBattleForPair,
  dispatchAction,
  getMatchView,
  getSpectatorView,
  handleDisconnect,
  isInMatch,
  partyAverageLevel,
  activeMatchCount,
} from '../battle/routes.js';
import { joinSpectate, leaveSpectate } from '../battle/spectate.js';
import type { Action } from './../battle/types.js';
import { getCluster, type Unsubscribe } from '../cluster/index.js';

const PRESENCE_INTERVAL_MS = 3_000;
const PRESENCE_TTL_SEC = 30;
const PRESENCE_REFRESH_MS = 15_000;
const PAIRING_INTERVAL_MS = 500;
const CHAT_WINDOW_MS = 8_000;
const CHAT_MAX_IN_WINDOW = 4;
const DISCONNECT_GRACE_MS = 15_000;

const CHAT_CHANNEL = 'chat:global';
const WSDELIVER_PREFIX = 'wsdeliver:';
const WSDELIVER_PATTERN = `${WSDELIVER_PREFIX}*`;
const K_PRESENCE = (userId: string): string => `presence:user:${userId}`;

// ============================================================================
// Client → server message schemas
// ============================================================================
const ChatSchema = z.object({ type: z.literal('chat'), text: z.string().trim().min(1).max(300) });
const QueueSchema = z.object({ type: z.literal('queue'), join: z.boolean() });
const HelloSchema = z.object({ type: z.literal('hello') });
const PingSchema = z.object({ type: z.literal('ping') });

const ActionSchema: z.ZodType<Action> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fight'), unitId: z.string(), targetId: z.string() }),
  z.object({ type: z.literal('skill'), unitId: z.string(), skillId: z.string(), targetId: z.string() }),
  z.object({ type: z.literal('guard'), unitId: z.string() }),
  z.object({ type: z.literal('flee') }),
]) as unknown as z.ZodType<Action>;

const ActSchema = z.object({ type: z.literal('act'), matchId: z.string(), action: ActionSchema });
const SpectateSchema = z.object({ type: z.literal('spectate'), matchId: z.string().min(1).max(64), join: z.boolean() });

const MessageSchema = z.union([HelloSchema, PingSchema, ChatSchema, QueueSchema, ActSchema, SpectateSchema]);
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
  const entry: PresenceEntry = { userId, displayName, socket, connectedAt: now, chatLog: [], msgTokens: MSG_BURST, msgTokensTs: now };
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

const handlePing: Handler = async (entry) => safeSend(entry.socket, { type: 'pong' });

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
  await cluster.publish(CHAT_CHANNEL, JSON.stringify({
    type: 'chat', from: entry.userId, displayName: entry.displayName, text: msg.text, at: now, nodeId: config.NODE_ID,
  }));
};

const handleQueue: Handler = async (entry, msg) => {
  if (msg.type !== 'queue') return;
  if (await isInMatch(entry.userId)) {
    safeSend(entry.socket, { type: 'error', code: 'in-match', message: 'you are already in a match' });
    return;
  }
  if (msg.join) {
    const level = await partyAverageLevel(entry.userId);
    const result = await matchmaker.enqueue({
      userId: entry.userId,
      displayName: entry.displayName,
      averageLevel: level,
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

const dispatcher: Record<IncomingMessage['type'], Handler> = {
  hello: handleHello,
  ping: handlePing,
  chat: handleChat,
  queue: handleQueue,
  act: handleAct,
  spectate: handleSpectate,
};

// ============================================================================
// Loops
// ============================================================================

let pairingTimer: NodeJS.Timeout | null = null;
let presenceTimer: NodeJS.Timeout | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let chatUnsub: Unsubscribe | null = null;
let deliverUnsub: Unsubscribe | null = null;

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
    let parsed: unknown;
    try { parsed = JSON.parse(msg); } catch { return; }
    broadcastLocal(parsed);
  });

  if (deliverUnsub) await deliverUnsub();
  deliverUnsub = await cluster.psubscribe(WSDELIVER_PATTERN, (msg, channel) => {
    const userId = channel.slice(WSDELIVER_PREFIX.length);
    const entry = connections.get(userId);
    if (!entry) return;
    let parsed: unknown;
    try { parsed = JSON.parse(msg); } catch { return; }
    safeSend(entry.socket, parsed);
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
  if (deliverUnsub) { await deliverUnsub(); deliverUnsub = null; }
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
    const token = readSessionCookie(req);
    const session = await resolveSession(token ?? undefined);
    if (!session) {
      safeSend(socket, { type: 'error', code: 'unauth', message: 'sign in first' });
      try { socket.close(4401, 'unauthenticated'); } catch {}
      return;
    }
    if (connections.size >= config.MAX_LOBBY_CONNECTIONS) {
      safeSend(socket, { type: 'error', code: 'lobby-full', message: 'lobby full — try later' });
      try { socket.close(4503, 'lobby-full'); } catch {}
      return;
    }

    const entry = ensureUnique(session.user.id, socket, session.user.display_name);
    await presenceMarkOnline(entry);
    log.info('ws.connect', { userId: entry.userId, size: connections.size, nodeId: config.NODE_ID });

    socket.on('message', (raw: unknown) => {
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
    });

    socket.on('close', () => {
      void (async () => {
        connections.delete(entry.userId);
        await presenceMarkOffline(entry.userId);
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
