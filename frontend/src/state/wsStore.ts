import type { BattleEvent, BattleOutcome, BattleView } from '@digiworld/shared/battle';
import type { DungeonMoveResponse } from '@digiworld/shared';
import type { DungeonRemotePlayer, PresenceUser, QueueStatus, WelcomeUser, WSServerMessage } from '@digiworld/shared/ws';
import type { WeatherConfig } from '@digiworld/shared/weather';
import { create } from 'zustand';

import { invalidateSceneDefaultsCache } from '../lib/scene-defaults';
import { invalidateScenesCache } from '../lib/api-scenes';

type ChatMessage = {
  readonly from: string;
  readonly displayName: string;
  readonly text: string;
  readonly at: number;
  readonly dungeonId?: string;
};

type PvpInvite = {
  readonly inviteId: string;
  readonly fromUserId: string;
  readonly fromName: string;
  readonly dungeonId: string;
};

type QueueState = {
  readonly status: QueueStatus;
  readonly size: number;
  readonly since: number | null;
};

type WelcomeState = {
  readonly user: WelcomeUser;
  readonly nodeId: string;
  readonly activeMatches: number;
};

export type WeatherOverrideState = {
  readonly sceneId: string | null;
  readonly matchId: string | null;
  readonly weather: WeatherConfig;
  readonly durationMs: number;
  readonly startedAt: number;
};

type WsState = {
  readonly presence: PresenceUser[];
  readonly presenceCount: number;
  readonly chat: ChatMessage[];
  readonly chatsByRoom: Record<string, ChatMessage[]>;
  readonly queue: QueueState;
  readonly activeMatchId: string | null;
  readonly activeBattle: BattleView | null;
  readonly battleEvents: BattleEvent[];
  readonly battleOutcome: BattleOutcome | null;
  readonly welcome: WelcomeState | null;
  readonly weatherOverride: WeatherOverrideState | null;
  readonly dungeonPlayers: DungeonRemotePlayer[];
  readonly pvpInvite: PvpInvite | null;
  readonly pvpNotice: string | null;
  readonly socialNotifyVersion: number;
  readonly chatByDungeon: Record<string, ChatMessage[]>;
  readonly handleServerMessage: (msg: WSServerMessage) => void;
  readonly clearActiveBattle: () => void;
  readonly clearRoomChat: (roomId: string) => void;
  readonly clearDungeonPlayers: () => void;
  readonly clearPvpInvite: () => void;
  readonly clearPvpNotice: () => void;
  readonly reset: () => void;
};

const MAX_LOG_MESSAGES = 200;

// Correlated dungeon-move replies (server → client) keyed by the client-issued
// correlationId. The Dungeon route awaits these instead of round-tripping HTTP.
type DungeonMoveResolver = {
  readonly resolve: (result: DungeonMoveResponse) => void;
  readonly reject: (error: Error) => void;
};
const pendingDungeonMoves = new Map<string, DungeonMoveResolver>();

export function registerDungeonMoveResolver(
  correlationId: string,
  resolve: (result: DungeonMoveResponse) => void,
  reject: (error: Error) => void,
): void {
  pendingDungeonMoves.set(correlationId, { resolve, reject });
}

const initialState = {
  presence: [],
  presenceCount: 0,
  chat: [],
  chatsByRoom: {},
  queue: { status: 'idle', size: 0, since: null },
  activeMatchId: null,
  activeBattle: null,
  battleEvents: [],
  battleOutcome: null,
  welcome: null,
  weatherOverride: null,
  dungeonPlayers: [],
  pvpInvite: null,
  pvpNotice: null,
  socialNotifyVersion: 0,
  chatByDungeon: {},
} satisfies Omit<
  WsState,
  | 'handleServerMessage'
  | 'reset'
  | 'clearActiveBattle'
  | 'clearRoomChat'
  | 'clearDungeonPlayers'
  | 'clearPvpInvite'
  | 'clearPvpNotice'
>;

export const useWsStore = create<WsState>((set) => ({
  ...initialState,
  handleServerMessage: (msg) => {
    switch (msg.type) {
      case 'welcome':
        set((state) => ({
          presence: msg.presence,
          presenceCount: msg.presence.length,
          welcome: { user: msg.user, nodeId: msg.nodeId, activeMatches: msg.activeMatches },
          activeMatchId: msg.matchId ?? state.activeMatchId,
        }));
        return;
      case 'presence':
        set({ presence: msg.users, presenceCount: msg.count });
        return;
      case 'chat':
        if (msg.dungeonId !== undefined) {
          const dungeonId = msg.dungeonId;
          set((state) => ({
            chatByDungeon: {
              ...state.chatByDungeon,
              [dungeonId]: [
                ...(state.chatByDungeon[dungeonId] ?? []),
                { from: msg.from, displayName: msg.displayName, text: msg.text, at: msg.at, dungeonId },
              ].slice(-MAX_LOG_MESSAGES),
            },
          }));
          return;
        }
        if (msg.room !== undefined) {
          const roomId = msg.room;
          set((state) => ({
            chatsByRoom: {
              ...state.chatsByRoom,
              [roomId]: [
                ...(state.chatsByRoom[roomId] ?? []),
                { from: msg.from, displayName: msg.displayName, text: msg.text, at: msg.at },
              ].slice(-MAX_LOG_MESSAGES),
            },
          }));
        } else {
          set((state) => ({
            chat: [...state.chat, { from: msg.from, displayName: msg.displayName, text: msg.text, at: msg.at }].slice(
              -MAX_LOG_MESSAGES,
            ),
          }));
        }
        return;
      case 'queue':
        set({ queue: { status: msg.status, size: msg.size, since: msg.since ?? null } });
        return;
      case 'match':
        set({ activeMatchId: msg.matchId, activeBattle: msg.view, battleEvents: [], battleOutcome: null });
        return;
      case 'battle':
        set((state) => (state.activeMatchId === msg.matchId ? { activeBattle: msg.view } : state));
        return;
      case 'event':
        set((state) =>
          state.activeMatchId === msg.matchId
            ? { battleEvents: [...state.battleEvents, ...msg.events].slice(-MAX_LOG_MESSAGES) }
            : state,
        );
        return;
      case 'end':
        set((state) =>
          state.activeMatchId === msg.matchId
            ? { activeBattle: msg.view, battleOutcome: msg.outcome, battleEvents: msg.view.log.slice(-MAX_LOG_MESSAGES) }
            : state,
        );
        return;
      case 'spectate':
        // Spectator join: hydrate battle state so subsequent battle/event/end
        // messages (which gate on activeMatchId matching) actually apply.
        if (msg.status === 'joined' && msg.view) {
          set({
            activeMatchId: msg.matchId,
            activeBattle: msg.view,
            battleEvents: msg.view.log ?? [],
            battleOutcome: msg.view.outcome ?? null,
          });
        } else if (msg.status === 'left') {
          set((state) =>
            state.activeMatchId === msg.matchId
              ? { activeMatchId: null, activeBattle: null, battleEvents: [], battleOutcome: null }
              : state,
          );
        }
        return;
      case 'scene-defaults-updated':
        invalidateSceneDefaultsCache();
        return;
      case 'scene-updated':
        invalidateScenesCache();
        return;
      case 'weather-triggered':
        set({
          weatherOverride: {
            sceneId: msg.sceneId,
            matchId: msg.matchId,
            weather: msg.weather,
            durationMs: msg.durationMs,
            startedAt: msg.startedAt,
          },
        });
        return;
      case 'error':
        if (msg.code.startsWith('pvp-')) {
          set({ pvpNotice: msg.message });
        }
        return;
      case 'pong':
        return;
      case 'dungeon:players':
        set({ dungeonPlayers: msg.players });
        return;
      case 'dungeon:player-update':
        set((state) => {
          const known = state.dungeonPlayers.find((p) => p.userId === msg.player.userId);
          const player = known === undefined ? msg.player : { ...known, ...msg.player };
          return {
            dungeonPlayers: known === undefined
              ? [...state.dungeonPlayers, player]
              : state.dungeonPlayers.map((p) => (p.userId === player.userId ? player : p)),
          };
        });
        return;
      case 'dungeon:player-left':
        set((state) => ({ dungeonPlayers: state.dungeonPlayers.filter((p) => p.userId !== msg.userId) }));
        return;
      case 'dungeon:move-result': {
        const resolver = pendingDungeonMoves.get(msg.correlationId);
        if (resolver !== undefined) {
          pendingDungeonMoves.delete(msg.correlationId);
          resolver.resolve(msg.result);
        }
        return;
      }
      case 'dungeon:move-error': {
        const resolver = pendingDungeonMoves.get(msg.correlationId);
        if (resolver !== undefined) {
          pendingDungeonMoves.delete(msg.correlationId);
          resolver.reject(new Error(msg.message));
        }
        return;
      }
      case 'pvp:invite':
        set({ pvpInvite: { inviteId: msg.inviteId, fromUserId: msg.fromUserId, fromName: msg.fromName, dungeonId: msg.dungeonId } });
        return;
      case 'pvp:invite-declined':
        set((state) => ({
          pvpInvite: state.pvpInvite?.inviteId === msg.inviteId ? null : state.pvpInvite,
          pvpNotice: `${msg.fromName} declined your battle invite.`,
        }));
        return;
      case 'pvp:invite-expired':
        set((state) => ({
          pvpInvite: state.pvpInvite?.inviteId === msg.inviteId ? null : state.pvpInvite,
          pvpNotice: state.pvpInvite?.inviteId === msg.inviteId ? 'Battle invite expired.' : state.pvpNotice,
        }));
        return;
      case 'social:notify':
        set((state) => ({ socialNotifyVersion: state.socialNotifyVersion + 1 }));
        return;
      default:
        msg satisfies never;
    }
  },
  reset: () => {
    set(initialState);
  },
  clearActiveBattle: () => {
    set({ activeMatchId: null, activeBattle: null, battleEvents: [], battleOutcome: null });
  },
  clearRoomChat: (roomId: string) => {
    set((state) => {
      const next = { ...state.chatsByRoom };
      delete next[roomId];
      return { chatsByRoom: next };
    });
  },
  clearDungeonPlayers: () => {
    set({ dungeonPlayers: [] });
  },
  clearPvpInvite: () => {
    set({ pvpInvite: null });
  },
  clearPvpNotice: () => {
    set({ pvpNotice: null });
  },
}));
