import type { BattleEvent, BattleOutcome, BattleView } from '@digiworld/shared/battle';
import type { PresenceUser, QueueStatus, WelcomeUser, WSServerMessage } from '@digiworld/shared/ws';
import { create } from 'zustand';

type ChatMessage = {
  readonly from: string;
  readonly displayName: string;
  readonly text: string;
  readonly at: number;
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

type WsState = {
  readonly presence: PresenceUser[];
  readonly presenceCount: number;
  readonly chat: ChatMessage[];
  readonly queue: QueueState;
  readonly activeMatchId: string | null;
  readonly activeBattle: BattleView | null;
  readonly battleEvents: BattleEvent[];
  readonly battleOutcome: BattleOutcome | null;
  readonly welcome: WelcomeState | null;
  readonly handleServerMessage: (msg: WSServerMessage) => void;
  readonly clearActiveBattle: () => void;
  readonly reset: () => void;
};

const MAX_LOG_MESSAGES = 200;

const initialState = {
  presence: [],
  presenceCount: 0,
  chat: [],
  queue: { status: 'idle', size: 0, since: null },
  activeMatchId: null,
  activeBattle: null,
  battleEvents: [],
  battleOutcome: null,
  welcome: null,
} satisfies Omit<WsState, 'handleServerMessage' | 'reset' | 'clearActiveBattle'>;

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
        set((state) => ({
          chat: [...state.chat, { from: msg.from, displayName: msg.displayName, text: msg.text, at: msg.at }].slice(
            -MAX_LOG_MESSAGES,
          ),
        }));
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
      case 'error':
        return;
      case 'pong':
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
}));
