import type { WSClientMessage } from '@digiworld/shared/ws';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import { useWebSocket } from '../../hooks/useWebSocket';
import { fmtTime } from '../../lib/format';
import { useWsStore } from '../../state/wsStore';

const RATE_LIMIT_MS = 1_500;
const NO_MESSAGES: readonly DungeonChatMessage[] = [];

type ChatTab = 'global' | 'local';

type DungeonChatMessage = {
  readonly from: string;
  readonly displayName: string;
  readonly text: string;
  readonly at: number;
  readonly dungeonId?: string;
};

export type DungeonChatOverlayProps = {
  readonly dungeonId: string;
  readonly onClose: () => void;
};

export function DungeonChatOverlay({ dungeonId, onClose }: DungeonChatOverlayProps): JSX.Element {
  const [tab, setTab] = useState<ChatTab>('local');
  const [text, setText] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const globalChat = useWsStore((state) => state.chat);
  const localChat = useWsStore((state) => state.chatByDungeon[dungeonId]) ?? NO_MESSAGES;
  const { send } = useWebSocket();
  const logRef = useRef<HTMLDivElement | null>(null);
  const messages = tab === 'global' ? globalChat : localChat;
  const canSend = text.trim().length > 0 && Date.now() >= cooldownUntil;

  useEffect(() => {
    const log = logRef.current;
    if (log !== null) {
      log.scrollTop = log.scrollHeight;
    }
  }, [messages, tab]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!canSend || trimmed.length === 0) return;
    const msg: WSClientMessage =
      tab === 'local' ? { type: 'chat', text: trimmed, dungeonId } : { type: 'chat', text: trimmed };
    send(msg);
    setText('');
    setCooldownUntil(Date.now() + RATE_LIMIT_MS);
  };

  return (
    <div className="dungeon-chat" role="dialog" aria-label="Dungeon chat">
      <div className="dungeon-chat-head">
        <div className="dungeon-chat-tabs" role="tablist" aria-label="Chat channels">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'local'}
            className={tab === 'local' ? 'is-active' : ''}
            onClick={() => setTab('local')}
          >
            Local
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'global'}
            className={tab === 'global' ? 'is-active' : ''}
            onClick={() => setTab('global')}
          >
            Global
          </button>
        </div>
        <button type="button" className="dungeon-chat-close" onClick={onClose} aria-label="Close chat">
          ✕
        </button>
      </div>
      <div className="dungeon-chat-log" ref={logRef} aria-live="polite">
        {messages.length === 0 ? (
          <div className="dungeon-chat-empty">
            {tab === 'local' ? 'No messages in this dungeon yet.' : 'No messages yet — say hi to start.'}
          </div>
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
          placeholder={tab === 'local' ? 'Dungeon chat — 4 msgs / 8s' : 'Global chat — 4 msgs / 8s'}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <button className="btn" type="submit" disabled={!canSend}>
          Send
        </button>
      </form>
    </div>
  );
}
