import type { WSClientMessage } from '@digiworld/shared/ws';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import { fmtTime } from '../../lib/format';

const STORAGE_KEY = 'dw:lobby:chat-drawer:collapsed';
const RATE_LIMIT_MS = 1_500;

export type ChatMessage = {
  readonly from: string;
  readonly displayName: string;
  readonly text: string;
  readonly at: number;
};

export type ChatDrawerProps = {
  readonly onlineCount: number;
  readonly chat: readonly ChatMessage[];
  readonly send: (msg: WSClientMessage) => void;
};

export function ChatDrawer({ onlineCount, chat, send }: ChatDrawerProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) !== 'false');
  const [text, setText] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canSend = text.trim().length > 0 && Date.now() >= cooldownUntil;

  useEffect(() => {
    document.body.classList.add('has-chat-drawer');
    return () => document.body.classList.remove('has-chat-drawer');
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    const log = logRef.current;
    if (log !== null) {
      log.scrollTop = log.scrollHeight;
    }
  }, [chat]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (event.key === '/' && !(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setCollapsed(false);
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <aside className={collapsed ? 'chat-drawer is-collapsed' : 'chat-drawer'} aria-label="Global chat">
      <div
        className="drawer-head"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setCollapsed((value) => !value);
          }
        }}
      >
        <h2>
          Global chat <span className="drawer-meta">· <b>{onlineCount}</b> online</span>
        </h2>
        <span className="caret">{collapsed ? '▲' : '▼'}</span>
      </div>
      <div className="drawer-body">
        <div className="chat-log" ref={logRef} aria-live="polite">
          {chat.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 4px', textAlign: 'center' }}>No messages yet — say hi to start.</div>
          ) : (
            chat.map((message) => (
              <div className="chat-msg" key={`${message.from}-${message.at}-${message.text}`}>
                <span className="from">{message.displayName}</span>
                {message.text}
                <span className="time">{fmtTime(message.at)}</span>
              </div>
            ))
          )}
        </div>
        <form className="chat-form" onSubmit={(event) => handleSubmit(event, canSend, text, send, setText, setCooldownUntil)}>
          <input
            className="input chat-input"
            ref={inputRef}
            type="text"
            maxLength={300}
            autoComplete="off"
            placeholder="Say hi — 4 msgs / 8s"
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
          />
          <button className="btn" type="submit" disabled={!canSend}>
            Send
          </button>
        </form>
      </div>
    </aside>
  );
}

function handleSubmit(
  event: FormEvent<HTMLFormElement>,
  canSend: boolean,
  text: string,
  send: (msg: WSClientMessage) => void,
  setText: (value: string) => void,
  setCooldownUntil: (value: number) => void,
): void {
  event.preventDefault();
  const trimmed = text.trim();
  if (!canSend || trimmed.length === 0) {
    return;
  }
  send({ type: 'chat', text: trimmed });
  setText('');
  setCooldownUntil(Date.now() + RATE_LIMIT_MS);
}
