import type { WSClientMessage } from '@digiworld/shared/ws';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { fmtTime } from '../../lib/format';
import {
  ApiError,
  chatCreateRoom,
  chatLeaveRoom,
  chatListMyRooms,
  chatOpenDm,
  type ChatRoomView,
} from '../../lib/api';
import { useWsStore } from '../../state/wsStore';

type ChatMessage = {
  readonly from: string;
  readonly displayName: string;
  readonly text: string;
  readonly at: number;
};

export type RoomsPanelProps = {
  readonly send: (msg: WSClientMessage) => void;
};

export function RoomsPanel({ send }: RoomsPanelProps): JSX.Element {
  const chatsByRoom = useWsStore((s) => s.chatsByRoom);
  const [rooms, setRooms] = useState<ChatRoomView[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [dmUsername, setDmUsername] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatListMyRooms().then((res) => setRooms(res.rooms)).catch(() => setRooms([]));
  }, []);

  const activeRoom = rooms.find((r) => r.id === activeRoomId) ?? null;
  const activeMessages: readonly ChatMessage[] = useMemo(
    () => (activeRoomId ? (chatsByRoom[activeRoomId] ?? []) : []),
    [activeRoomId, chatsByRoom],
  );

  useEffect(() => {
    const log = logRef.current;
    if (log !== null) log.scrollTop = log.scrollHeight;
  }, [activeMessages]);

  const onSubmitDm = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError('');
    const username = dmUsername.trim();
    if (username.length < 3) { setError('Enter a username (3+ chars).'); return; }
    setBusy(true);
    try {
      const result = await chatOpenDm(username);
      setRooms((prev) => (prev.some((r) => r.id === result.room.id) ? prev : [result.room, ...prev]));
      setActiveRoomId(result.room.id);
      setDmUsername('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to open DM.');
    } finally {
      setBusy(false);
    }
  };

  const onSubmitCreateRoom = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError('');
    const name = newRoomName.trim();
    if (name.length < 2) { setError('Room name too short.'); return; }
    setBusy(true);
    try {
      const result = await chatCreateRoom(name);
      setRooms((prev) => [result.room, ...prev]);
      setActiveRoomId(result.room.id);
      setNewRoomName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create room.');
    } finally {
      setBusy(false);
    }
  };

  const onLeaveRoom = async (roomId: string): Promise<void> => {
    setError('');
    try {
      await chatLeaveRoom(roomId);
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
      if (activeRoomId === roomId) setActiveRoomId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to leave room.');
    }
  };

  const onSubmitMessage = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = text.trim();
    if (activeRoomId === null || trimmed.length === 0) return;
    send({ type: 'chat', text: trimmed, room: activeRoomId });
    setText('');
  };

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, border: '1px solid var(--muted)', borderRadius: 8 }}>
      <h3 style={{ margin: 0 }}>Rooms & DMs</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
        {rooms.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>No rooms yet. Open a DM or create a room below.</div>
        ) : rooms.map((room) => (
          <div
            key={room.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '4px 8px',
              borderRadius: 4,
              background: room.id === activeRoomId ? 'rgba(255,255,255,0.06)' : 'transparent',
              cursor: 'pointer',
            }}
            onClick={() => setActiveRoomId(room.id)}
          >
            <span>
              {room.kind === 'dm' ? 'DM' : 'Room'} · {room.name}
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>({room.memberCount})</span>
            </span>
            <button
              type="button"
              className="btn"
              style={{ fontSize: 11, padding: '2px 6px' }}
              onClick={(e) => { e.stopPropagation(); void onLeaveRoom(room.id); }}
            >
              Leave
            </button>
          </div>
        ))}
      </div>

      <form className="stack" style={{ gap: 6 }} onSubmit={onSubmitDm}>
        <label className="field" style={{ margin: 0 }}>
          Open DM by username
          <input
            className="input"
            type="text"
            value={dmUsername}
            onChange={(e) => setDmUsername(e.currentTarget.value)}
            minLength={3}
            maxLength={24}
            placeholder="alice"
          />
        </label>
        <button className="btn" type="submit" disabled={busy}>Open DM</button>
      </form>

      <form className="stack" style={{ gap: 6 }} onSubmit={onSubmitCreateRoom}>
        <label className="field" style={{ margin: 0 }}>
          Create room
          <input
            className="input"
            type="text"
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.currentTarget.value)}
            minLength={2}
            maxLength={48}
            placeholder="general"
          />
        </label>
        <button className="btn" type="submit" disabled={busy}>Create</button>
      </form>

      {error ? <div className="auth-error" role="alert">{error}</div> : null}

      {activeRoom ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--muted)', paddingTop: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            #{activeRoom.name} · {activeRoom.memberCount} member{activeRoom.memberCount === 1 ? '' : 's'}
          </div>
          <div
            ref={logRef}
            aria-live="polite"
            style={{ maxHeight: 200, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, background: 'rgba(0,0,0,0.15)', borderRadius: 4, padding: 6 }}
          >
            {activeMessages.length === 0 ? (
              <div style={{ color: 'var(--muted)', textAlign: 'center' }}>No messages yet.</div>
            ) : activeMessages.map((m) => (
              <div key={`${m.from}-${m.at}-${m.text}`}>
                <b>{m.displayName}</b>: {m.text}
                <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{fmtTime(m.at)}</span>
              </div>
            ))}
          </div>
          <form onSubmit={onSubmitMessage} style={{ display: 'flex', gap: 6 }}>
            <input
              className="input"
              type="text"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              maxLength={300}
              placeholder={`Message ${activeRoom.name}`}
              style={{ flex: 1 }}
            />
            <button className="btn" type="submit" disabled={text.trim().length === 0}>Send</button>
          </form>
        </div>
      ) : null}
    </aside>
  );
}
