import type { WSClientMessage } from '@digiworld/shared/ws';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import { useWebSocket } from '../../hooks/useWebSocket';
import { fmtTime } from '../../lib/format';
import { useWsStore } from '../../state/wsStore';
import { ChatIcon } from './icons';

const RATE_LIMIT_MS = 1_500;
const NO_MESSAGES: readonly { from: string; displayName: string; text: string; at: number; toUserId?: string }[] = [];
const NO_SYSTEM: readonly { readonly text: string; readonly at: number; readonly kind: '' | 'hit' | 'item' }[] = [];

type ChatTab = 'dm' | 'local' | 'global' | 'system';

const TAB_LABEL: Record<ChatTab, string> = {
  dm: 'DM',
  local: 'Local',
  global: 'Global',
  system: 'System',
};

export type DungeonChatOverlayProps = {
  readonly dungeonId: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onReopen: () => void;
};

export function DungeonChatOverlay({ dungeonId, open, onClose, onReopen }: DungeonChatOverlayProps): JSX.Element {
  const [tab, setTab] = useState<ChatTab>('local');
  const [text, setText] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [closed, setClosed] = useState<Set<ChatTab>>(new Set());
  const [unread, setUnread] = useState<Record<ChatTab, number>>({ dm: 0, local: 0, global: 0, system: 0 });
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const globalChat = useWsStore((state) => state.chat);
  const localChat = useWsStore((state) => state.chatByDungeon[dungeonId]) ?? NO_MESSAGES;
  const systemChat = useWsStore((state) => state.dungeonSystem[dungeonId]) ?? NO_SYSTEM;
  const dmChat = useWsStore((state) => state.dmChat);
  const { send } = useWebSocket();
  const logRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
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

  // Collapsed unread badge from new messages.
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
      const input = chatInputRef.current;
      if (input) {
        input.focus();
      }
    }
  }, [open, globalChat.length, localChat.length, systemChat.length, dmChat.length]);

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
    setPickerOpen(false);
  };

  const pickerClosed = (): ChatTab[] => tabs.filter((t) => closed.has(t));

  const togglePicker = (): void => setPickerOpen((prev) => !prev);

  const openClosedTab = (t: ChatTab): void => {
    const next = new Set(closed);
    next.delete(t);
    setClosed(next);
    setTab(t);
    setUnread((u) => ({ ...u, [t]: 0 }));
    setPickerOpen(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!canSend || trimmed.length === 0 || isSystem) return;
    let msg: WSClientMessage;
    if (tab === 'local') msg = { type: 'chat', text: trimmed, dungeonId };
    else if (tab === 'global') msg = { type: 'chat', text: trimmed };
    else msg = { type: 'chat', text: trimmed };
    send(msg);
    setText('');
    setCooldownUntil(Date.now() + RATE_LIMIT_MS);
  };

  const tabs: ChatTab[] = ['dm', 'local', 'global', 'system'];
  const showAdd = closed.size > 0;

  // Collapsed: horizontal chat bar in the bottom-left interior corner.
  if (!open) {
    return (
      <div
        className="dungeon-chat-reopen"
        role="button"
        tabIndex={0}
        aria-label="Abrir chat"
        onClick={onReopen}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onReopen();
          }
        }}
      >
        <ChatIcon />
        <span className="dungeon-chat-reopen-ph">Pressione Enter para falar…</span>
        {unreadTotal > 0 ? (
          <span className="dungeon-chat-reopen-badge">{unreadTotal > 99 ? '99+' : unreadTotal}</span>
        ) : null}
      </div>
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
            <div className="dungeon-chat-add-wrap">
              <button
                type="button"
                className={`dungeon-chat-add${pickerOpen ? ' is-open' : ''}`}
                aria-label="Reabrir aba fechada"
                aria-expanded={pickerOpen}
                title="Reabrir aba fechada"
                onClick={togglePicker}
              >
                +
              </button>
              {pickerOpen ? (
                <div className="dungeon-chat-add-picker" role="menu">
                  <div className="dungeon-chat-add-picker-h">Reabrir aba</div>
                  {pickerClosed().map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="menuitem"
                      className="dungeon-chat-add-picker-item"
                      onClick={() => openClosedTab(t)}
                    >
                      {TAB_LABEL[t]}
                    </button>
                  ))}
                </div>
              ) : null}
              {pickerOpen ? (
                <button
                  type="button"
                  className="dungeon-chat-add-backdrop"
                  aria-label="Fechar menu de abas"
                  tabIndex={-1}
                  onClick={() => setPickerOpen(false)}
                />
              ) : null}
            </div>
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
          ref={chatInputRef}
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
