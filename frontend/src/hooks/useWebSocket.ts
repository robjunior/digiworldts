import type { WSClientMessage } from '@digiworld/shared/ws';
import { isServerMessage } from '@digiworld/shared/ws';
import { useCallback, useEffect, useState } from 'react';

import { useWsStore } from '../state/wsStore';
import { useAuth } from './useAuth';

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
const PING_INTERVAL_MS = 25_000;
const CLOSED_READY_STATE = 3;

type WebSocketHook = {
  readonly send: (msg: WSClientMessage) => void;
  readonly readyState: number;
};

/**
 * ONE socket per tab, shared by every caller of `useWebSocket`.
 *
 * The hook is called from App, Lobby, Spectate and Combat3DBody, several of
 * which mount at once. A per-call socket therefore opened N connections for
 * the same user, and the server keys `connections` by userId — so the newest
 * socket displaced the previous one, and the displaced socket's `close` then
 * tore down the live registration and dropped the user from the matchmaking
 * queue. Sharing one connection removes that whole class of races.
 *
 * State lives at module scope rather than in a context so the socket survives
 * component remounts, and consumers are reference-counted: it opens on the
 * first mount and closes when the last consumer unmounts.
 */
let socket: WebSocket | null = null;
let consumers = 0;
let wanted = false;
let reconnectAttempt = 0;
let reconnectTimer: number | null = null;
let pingTimer: number | null = null;
let releaseTimer: number | null = null;
const readyStateSubscribers = new Set<(state: number) => void>();

function currentReadyState(): number {
  return socket?.readyState ?? CLOSED_READY_STATE;
}

function publishReadyState(): void {
  const state = currentReadyState();
  for (const notify of readyStateSubscribers) {
    notify(state);
  }
}

function stopPing(): void {
  if (pingTimer !== null) {
    window.clearInterval(pingTimer);
    pingTimer = null;
  }
}

function stopReconnect(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function openSocket(): void {
  if (!wanted) {
    return;
  }
  if (socket !== null && socket.readyState !== CLOSED_READY_STATE) {
    return;
  }

  const next = new WebSocket(new URL('/ws', window.location.href).toString().replace(/^http/, 'ws'));
  socket = next;
  publishReadyState();

  next.addEventListener('open', () => {
    if (socket !== next) {
      return;
    }
    reconnectAttempt = 0;
    publishReadyState();
    sendRaw(next, { type: 'hello' });
    stopPing();
    pingTimer = window.setInterval(() => {
      sendRaw(next, { type: 'ping' });
    }, PING_INTERVAL_MS);
  });

  next.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      return;
    }
    const parsed = parseJson(event.data);
    if (isServerMessage(parsed)) {
      useWsStore.getState().handleServerMessage(parsed);
    }
  });

  next.addEventListener('close', () => {
    // A socket we already replaced must not clobber the current one.
    if (socket !== next) {
      return;
    }
    socket = null;
    stopPing();
    publishReadyState();
    if (!wanted) {
      return;
    }
    const delay = BACKOFF_MS[reconnectAttempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    reconnectAttempt += 1;
    stopReconnect();
    reconnectTimer = window.setTimeout(openSocket, delay);
  });

  next.addEventListener('error', () => {
    if (socket === next) {
      publishReadyState();
    }
  });
}

function closeSocket(): void {
  wanted = false;
  stopReconnect();
  stopPing();
  const closing = socket;
  socket = null;
  if (closing !== null && closing.readyState !== CLOSED_READY_STATE) {
    closing.close(1000, 'client released');
  }
  publishReadyState();
}

function acquire(): void {
  if (releaseTimer !== null) {
    window.clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  consumers += 1;
  wanted = true;
  openSocket();
}

function release(): void {
  consumers = Math.max(0, consumers - 1);
  if (consumers > 0) {
    return;
  }
  // Deferred so a route change that unmounts one consumer and mounts another
  // in the same tick — and StrictMode's double-invoke in dev — reuse the
  // socket instead of tearing it down and immediately redialing.
  if (releaseTimer !== null) {
    window.clearTimeout(releaseTimer);
  }
  releaseTimer = window.setTimeout(() => {
    releaseTimer = null;
    if (consumers === 0) {
      closeSocket();
    }
  }, 0);
}

export function useWebSocket(): WebSocketHook {
  const { status } = useAuth();
  const [readyState, setReadyState] = useState(currentReadyState);

  useEffect(() => {
    readyStateSubscribers.add(setReadyState);
    setReadyState(currentReadyState());
    return () => {
      readyStateSubscribers.delete(setReadyState);
    };
  }, []);

  useEffect(() => {
    if (status !== 'authed') {
      if (wanted) {
        closeSocket();
      }
      return;
    }
    acquire();
    return release;
  }, [status]);

  const send = useCallback((msg: WSClientMessage): void => {
    if (socket !== null && socket.readyState === WebSocket.OPEN) {
      sendRaw(socket, msg);
    }
  }, []);

  return { send, readyState };
}

function sendRaw(target: WebSocket, msg: WSClientMessage): void {
  if (target.readyState === WebSocket.OPEN) {
    target.send(JSON.stringify(msg));
  }
}

function parseJson(frame: string): unknown {
  try {
    return JSON.parse(frame) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}
