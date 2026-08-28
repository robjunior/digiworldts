import type { WSClientMessage } from '@digiworld/shared/ws';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import { useWebSocket } from '../../hooks/useWebSocket';
import { fmtTime } from '../../lib/format';
import { useWsStore } from '../../state/wsStore';

const RATE_LIMIT_MS = 1_500;
const NO_MESSAGES: readonly { from: string; displayName: string; text: string; at: number; toUserId?: string }[] = [];
const NO_SYSTEM: readonly { text: string; at: number; kind: '' | 'hit' | 'item' }[] = [];

type ChatTab = 'dm' | 'local' | 'global' | 'system';

const TAB_LABEL: Record<ChatTab, string> = {
  dm: 'DM',
  local: 'Local',
  global: 'Global',
  system: 'System',
};

export type DungeonChatOverlayProps = {
  readonly dungeonId: string;
  /** When false the chat collapses to a message-icon the user clicks to reopen. */
  readonly open: boolean;
  readonly onClose: () => void;
};

export function DungeonChatOverlay({ dungeonId, open, onClose }: DungeonChatOverlayProps): JSX.Element {
  const [tab, setTab] = useState<ChatTab>('local');
  const [text, setText] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [closed, setClosed] = useState<Set<ChatTab>>(new Set());
  const [unread, setUnread] = useState<Record<ChatTab, number>>({ dm: 0, local: 0, global: 0, system: 0 });
  const [unreadTotal, setUnreadTotal] = useState(0);
  const globalChat = useWsStore((state) => state.chat);
  const localChat = useWsStore((state) => state.chatByDungeon[dungeonId]) ?? NO_MESSAGES;
  const systemChat = useWsStore((state) => state.dungeonSystem[dungeonId]) ?? NO_SYSTEM;
  const dmChat = useWsStore((state) => state.dmChat);
  const { send } = useWebSocket();
  const logRef = useRef<HTMLDivElement | null>(null);
  const lastSeenLen = useRef(globalChat.length + localChat.length + systemChat.length + dmChat.length);

  const tabMessages = (t: ChatTab): readonly { readonly from?: string; readonly displayName?: string; readonly text: string; readonly at: number; readonly kind?: string }[] => {
    if (t === 'dm') return dmChat;
    if (t === 'local') return localChat;
    if (t === 'global') return globalChat;
    return systemChat;
  };
  const messages = tabMessages(tab);
  const canSend = text.trim().length > 0 && Date.now() >= cooldownUntil;
  const isSystem = tab === 'system';

  // Track unread counts for background tabs.
  useEffect(() => {
    setUnread((prev) => ({ ...prev, global: globalChat.length, local: localChat.length, system: systemChat.length, dm: dmChat.length }));
  }, [globalChat.length, localChat.length, systemChat.length, dmChat.length]);

  // When a tab is closed, fall back to the first open tab.
  useEffect(() => {
    if (closed.has(tab)) {
      const next: ChatTab | undefined = (['dm', 'local', 'global', 'system'] as ChatTab[]).find((t) => !closed.has(t));
      if (next !== undefined) setTab(next);
    }
  }, [closed, tab]);

  // When collapsed, accumulate a total unread badge from new messages.
  useEffect(() => {
    const len = globalChat.length + localChat.length + systemChat.length + dmChat.length;
    if (!open) {
      const delta = Math.max(0, len - lastSeenLen.current);
      if (delta > 0) setUnreadTotal((p) => p + delta);
    }
    lastSeenLen.current = len;
  }, [globalChat.length, localChat.length, systemChat.length, dmChat.length, open]);

  // Reset the collapsed badge when reopened.
  useEffect(() => {
    if (open) {
      setUnreadTotal(0);
      lastSeenLen.current = globalChat.length + localChat.length + systemChat.length + dmChat.length;
    }
  }, [open]);

  useEffect(() => {
    const log = logRef.current;
    if (log !== null) log.scrollTop = log.scrollHeight;
  }, [messages, tab]);

  const switchTab = (t: ChatTab): void => {
    if (closed.has(t)) return;
    setTab(t);
    setUnread((prev) => ({ ...prev, [t]: 0 }));
  };

  const closeTab = (t: ChatTab): void => {
    setClosed((prev) => new Set(prev).add(t));
  };

  const reopenLast = (): void => {
    if (closed.size === 0) return;
    const arr = [...closed];
    const last = arr[arr.length - 1];
    if (last === undefined) return;
    const next = new Set(closed);
    next.delete(last);
    setClosed(next);
    setTab(last);
    setUnread((u) => ({ ...u, [last]: 0 }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!canSend || trimmed.length === 0 || isSystem) return;
    let msg: WSClientMessage;
    if (tab === 'local') msg = { type: 'chat', text: trimmed, dungeonId };
    else if (tab === 'global') msg = { type: 'chat', text: trimmed };
    else msg = { type: 'chat', text: trimmed }; // DM send target wired from context menu in-app
    send(msg);
    setText('');
    setCooldownUntil(Date.now() + RATE_LIMIT_MS);
  };

  const tabs: ChatTab[] = ['dm', 'local', 'global', 'system'];
  const showAdd = closed.size > 0;

  // Collapsed: message-icon reopener with unread badge.
  if (!open) {
    return (
      <button type="button" className="dungeon-chat-reopen" aria-label="Abrir chat" onClick={onClose}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.8A8 8 0 1 1 21 12z" />
        </svg>
        {unreadTotal > 0 ? <span className="dungeon-chat-reopen-badge">{unreadTotal > 99 ? '99+' : unreadTotal}</span> : null}
      </button>
    );
  }

  return (
    <div className="dungeon-chat" role="dialog" aria-label="Dungeon chat">
      <div className="dungeon-chat-head">
        <div className="dungeon-chat-tabs" role="tablist" aria-label="Chat channels">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t && !closed.has(t)}
              className={tab === t && !closed.has(t) ? 'is-active' : ''}
              style={closed.has(t) ? { display: 'none' } : undefined}
              onClick={() => switchTab(t)}
            >
              {TAB_LABEL[t]}
              {unread[t] > 0 && t !== tab && !closed.has(t) ? <span className="dungeon-chat-unread">{unread[t]}</span> : null}
              <span
                className="dungeon-chat-tab-x"
                role="button"
                aria-label={`Fechar ${TAB_LABEL[t]}`}
                onClick={(e) => { e.stopPropagation(); closeTab(t); }}
              >
                ✕
              </span>
            </button>
          ))}
          {showAdd ? (
            <button type="button" className="dungeon-chat-add" aria-label="Reabrir aba" title="Reabrir aba fechada" onClick={reopenLast}>
              +
            </button>
          ) : null}
        </div>
        <button type="button" className="dungeon-chat-min" onClick={onClose} aria-label="Minimizar chat" title="Minimizar">
          ▾
        </button>
      </div>
      <div className="dungeon-chat-log" ref={logRef} aria-live="polite">
        {messages.length === 0 ? (
          <div className="dungeon-chat-empty">
            {isSystem
              ? 'Movimentos e eventos da dungeon aparecem aqui.'
              : tab === 'dm'
                ? 'Sem mensagens diretas ainda.'
                : tab === 'local'
                  ? 'Nenhuma mensagem nesta dungeon ainda.'
                  : 'Nenhuma mensagem ainda — diga oi para começar.'}
          </div>
        ) : isSystem ? (
          systemChat.map((message) => (
            <div className={`dungeon-chat-msg sys${message.kind ? ` ${message.kind}` : ''}`} key={`${message.at}-${message.text}`}>
              <span className="from">»</span>
              {message.text}
              <span className="time">{fmtTime(message.at)}</span>
            </div>
          ))
        ) : (
          messages.map((message) => (
            <div className="dungeon-chat-msg" key={`${message.from}-${message.at}-${message.text}`}>
              <span className="from">{message.displayName}</span>
              {message.text}
              <span className="time">{fmtTime(message.at)}</span>
            </div>
          ))
        )}
      </div>
      <form className="dungeon-chat-form" onSubmit={handleSubmit}>
        <input
          className="input dungeon-chat-input"
          type="text"
          maxLength={300}
          autoComplete="off"
          disabled={isSystem}
          placeholder={
            isSystem
              ? 'System é somente-leitura'
              : tab === 'dm'
                ? 'Mensagem direta'
                : tab === 'local'
                  ? 'Chat da dungeon — 4 msgs / 8s'
                  : 'Chat global — 4 msgs / 8s'
          }
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <button className="btn" type="submit" disabled={!canSend || isSystem}>
          Enviar
        </button>
      </form>
    </div>
  );
}
