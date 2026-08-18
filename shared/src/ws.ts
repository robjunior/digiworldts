/**
 * DigiWorld — WebSocket wire protocol (source of truth for backend + frontend).
 *
 * Single endpoint: GET /ws (session cookie required on the upgrade request).
 * Every message is a JSON object with a `type` discriminator.
 *
 * Backend send/receive lives in backend/src/lobby/ws.ts, plus battle/routes.ts,
 * matchmaking/queue.ts fanning out via deliverToUser().
 *
 * Frontend consumes these in frontend/src/hooks/useWebSocket.ts.
 */

import type { Action, BattleEvent, BattleOutcome, BattleView } from './battle.js';
import type { WeatherConfig } from './weather.js';

// ============================================================================
// Presence
// ============================================================================

export type PresenceUser = {
  userId: string;
  displayName: string;
};

/** Another player visible in a dungeon (presence-only payload). */
export type DungeonRemotePlayer = {
  userId: string;
  displayName: string;
  x: number;
  y: number;
  gridX: number;
  gridY: number;
  /** Leader digimon dot. Absent on move deltas — receivers keep the known value. */
  leaderCatalogId?: string;
  /** Ordered party catalogIds (leader first). */
  party?: string[];
  /** Previous leader cells, trail[i] maps to party[i]; trail[0] is the leader's own cell. */
  trail?: { x: number; y: number }[];
};

// ============================================================================
// Client → Server
// ============================================================================

export type WSClientMessage =
  | { type: 'hello' }
  | { type: 'ping' }
  | { type: 'chat'; text: string; room?: string; dungeonId?: string }
  | { type: 'queue'; join: boolean }
  | { type: 'pvp:invite'; targetUserId: string; dungeonId: string }
  | { type: 'pvp:response'; inviteId: string; accept: boolean }
  | { type: 'act'; matchId: string; action: Action }
  | { type: 'spectate'; matchId: string; join: boolean }
  | {
      type: 'dungeon:join';
      dungeonId: string;
      x: number;
      y: number;
      gridX: number;
      gridY: number;
      leaderCatalogId: string;
      party: string[];
      trail: { x: number; y: number }[];
    }
  | { type: 'dungeon:leave' };

// ============================================================================
// Server → Client
// ============================================================================

export type WelcomeUser = {
  id: string;
  displayName: string;
};

export type QueueStatus = 'idle' | 'waiting' | 'matched';

export type WSErrorCode =
  | 'unauth'
  | 'displaced'
  | 'bad-json'
  | 'bad-message'
  | 'chat-rate-limit'
  | 'lobby-full'
  | 'queue-full'
  | 'in-match'
  | 'loadout-invalid'
  | 'payload-too-large'
  | 'not-your-turn'
  | 'not-your-unit'
  | 'unit-down'
  | 'not-enough-energy'
  | 'skill-not-found'
  | 'target-invalid'
  | 'target-down'
  | 'match-not-found'
  | 'match-ended'
  | 'pvp-self-invite'
  | 'pvp-target-offline'
  | 'pvp-target-in-match'
  | 'pvp-blocked'
  | 'pvp-invite-not-found'
  | 'internal-error'
  | (string & {});

export type SpectateStatus = 'joined' | 'left' | 'full' | 'not-found' | 'already-in-match';

export type WSServerMessage =
  | {
      type: 'welcome';
      user: WelcomeUser;
      presence: PresenceUser[];
      activeMatches: number;
      nodeId: string;
      /** Present iff this user has a live match on reconnect. */
      matchId?: string;
    }
  | { type: 'pong' }
  | { type: 'presence'; users: PresenceUser[]; count: number }
  | {
      type: 'chat';
      from: string;
      displayName: string;
      text: string;
      at: number;
      nodeId: string;
      /** Present iff this is a per-room message. Absent = global chat. */
      room?: string;
      /** Present iff this is a dungeon-local message (fanout via dungeon scope). */
      dungeonId?: string;
    }
  | {
      type: 'queue';
      status: QueueStatus;
      size: number;
      /** ms epoch when the user joined the queue; only sent on `waiting`. */
      since?: number;
    }
  | { type: 'match'; matchId: string; view: BattleView }
  | { type: 'battle'; matchId: string; view: BattleView }
  | { type: 'event'; matchId: string; events: BattleEvent[] }
  | {
      type: 'end';
      matchId: string;
      view: BattleView;
      outcome: BattleOutcome;
    }
  | {
      type: 'spectate';
      matchId: string;
      status: SpectateStatus;
      /** Present only when `status === 'joined'` (initial view). */
      view?: BattleView;
      /** Total spectators after this join. */
      count?: number;
    }
  | {
      type: 'scene-defaults-updated';
      /** ms epoch when the admin's write completed on the server. */
      at: number;
    }
  | {
      type: 'scene-updated';
      /** ms epoch when the scene CRUD write completed on the server. */
      at: number;
    }
  | {
      type: 'weather-triggered';
      at: number;
      sceneId: string | null;
      matchId: string | null;
      weather: WeatherConfig;
      durationMs: number;
      startedAt: number;
    }
  | { type: 'error'; code: WSErrorCode; message: string }
  | { type: 'dungeon:players'; dungeonId: string; players: DungeonRemotePlayer[] }
  | { type: 'dungeon:player-update'; dungeonId: string; player: DungeonRemotePlayer }
  | { type: 'dungeon:player-left'; userId: string; dungeonId?: string }
  | { type: 'pvp:invite'; inviteId: string; fromUserId: string; fromName: string; dungeonId: string }
  | { type: 'pvp:invite-declined'; inviteId: string; fromName: string }
  | { type: 'pvp:invite-expired'; inviteId: string }
  | { type: 'social:notify'; kind: 'friend-request'; fromName: string; fromUserId: string };

// ============================================================================
// Narrowing helpers (frontend convenience)
// ============================================================================

export function isServerMessage(m: unknown): m is WSServerMessage {
  return typeof m === 'object' && m !== null && 'type' in m && typeof (m as { type: unknown }).type === 'string';
}

export type WSServerMessageType = WSServerMessage['type'];
export type WSServerMessageOf<T extends WSServerMessageType> = Extract<WSServerMessage, { type: T }>;

export type WSClientMessageType = WSClientMessage['type'];
export type WSClientMessageOf<T extends WSClientMessageType> = Extract<WSClientMessage, { type: T }>;
