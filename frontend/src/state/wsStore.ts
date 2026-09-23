import type { BattleEvent, BattleOutcome, BattleView } from '@digiworld/shared/battle';
import type { PresenceUser, QueueStatus, WelcomeUser, WSServerMessage } from '@digiworld/shared/ws';
import type { WeatherConfig } from '@digiworld/shared/weather';
import { create } from 'zustand';

import { invalidateSceneDefaultsCache } from '../lib/scene-defaults';
import { invalidateScenesCache } from '../lib/api-scenes';

type ChatMessage = {
  readonly from: string;
  readonly displayName: string;
  readonly text: string;
  readonly at: number;
  readonly toUserId?: string | undefined;
};

type SystemMessage = {
  readonly text: string;
  readonly at: number;
  readonly kind: '' | 'hit' | 'item';
};

type PvpInvite = {
  readonly inviteId: string;
  readonly fromUserId: string;
  readonly fromName: string;
};

/** A remote peer opened a DM tab targeting us — their client should auto-open. */
type DmOpenedSignal = {
  readonly fromUserId: string;
  readonly fromName: string;
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
  /** Direct messages, keyed by the OTHER participant's userId. */
  readonly dmsByPeer: Record<string, ChatMessage[]>;
  readonly queue: QueueState;
  readonly activeMatchId: string | null;
  readonly activeBattle: BattleView | null;
  readonly battleEvents: BattleEvent[];
  readonly battleOutcome: BattleOutcome | null;
  readonly welcome: WelcomeState | null;
  readonly weatherOverride: WeatherOverrideState | null;
  readonly pvpInvite: PvpInvite | null;
  readonly pvpNotice: string | null;
  readonly pvpQuestsRefresh: number;
  readonly socialNotifyVersion: number;
  /** Peers that opened a DM with us; consumed by the social rail to auto-open. */
  readonly dmOpened: readonly DmOpenedSignal[];
  readonly handleServerMessage: (msg: WSServerMessage) => void;
  readonly consumeDmOpened: () => void;
  readonly clearActiveBattle: () => void;
  readonly clearRoomChat: (roomId: string) => void;
  readonly clearPvpInvite: () => void;
  readonly clearPvpNotice: () => void;
  readonly invalidatePvpQuests: () => void;
  readonly reset: () => void;
};

const MAX_LOG_MESSAGES = 200;

const initialState = {
  presence: [],
  presenceCount: 0,
  chat: [],
  chatsByRoom: {},
  dmsByPeer: {},
  queue: { status: 'idle', size: 0, since: null },
  activeMatchId: null,
  activeBattle: null,
  battleEvents: [],
  battleOutcome: null,
  welcome: null,
  weatherOverride: null,
  pvpInvite: null,
  pvpNotice: null,
  pvpQuestsRefresh: 0,
  socialNotifyVersion: 0,
  dmOpened: [],
} satisfies Omit<
  WsState,
  | 'handleServerMessage'
  | 'consumeDmOpened'
  | 'reset'
  | 'clearActiveBattle'
  | 'clearRoomChat'
  | 'clearPvpInvite'
  | 'clearPvpNotice'
  | 'invalidatePvpQuests'
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
        if (msg.toUserId !== undefined) {
          const toUserId = msg.toUserId;
          // Direct message: keep it in its own per-peer log so it never leaks
          // into the General tab. The peer is the other participant — our own
          // id lives in the welcome payload.
          set((state) => {
            const myId = state.welcome?.user.id;
            const peer = myId !== undefined && msg.from === myId ? toUserId : msg.from;
            return {
              dmsByPeer: {
                ...state.dmsByPeer,
                [peer]: [
                  ...(state.dmsByPeer[peer] ?? []),
                  { from: msg.from, displayName: msg.displayName, text: msg.text, at: msg.at, toUserId },
                ].slice(-MAX_LOG_MESSAGES),
              },
            };
          });
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
        if (msg.status === 'joined' && msg.view) {
          set({
            activeMatchId: msg.view.id,
            activeBattle: msg.view,
            battleEvents: msg.view.log ?? [],
            battleOutcome: msg.view.outcome ?? null,
          });
        } else if (msg.status === 'left') {
          set((state) =>
            state.activeMatchId === msg.view?.id
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
      case 'pvp:invite':
        set({ pvpInvite: { inviteId: msg.inviteId, fromUserId: msg.fromUserId, fromName: msg.fromName } });
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
      case 'dm:opened':
        set((state) => ({
          dmOpened: [...state.dmOpened, { fromUserId: msg.fromUserId, fromName: msg.fromName }],
        }));
        return;
      default:
        msg satisfies never;
    }
  },
  consumeDmOpened: () => {
    set({ dmOpened: [] });
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
  clearPvpInvite: () => {
    set({ pvpInvite: null });
  },
  clearPvpNotice: () => {
    set({ pvpNotice: null });
  },
  invalidatePvpQuests: () => {
    set((state) => ({ pvpQuestsRefresh: state.pvpQuestsRefresh + 1 }));
  },
}));
