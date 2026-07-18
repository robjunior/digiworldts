import type { WSClientMessage } from '@digiworld/shared/ws';
import { isServerMessage } from '@digiworld/shared/ws';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useWsStore } from '../state/wsStore';
import { useAuth } from './useAuth';

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
const PING_INTERVAL_MS = 25_000;
const CLOSED_READY_STATE = 3;

type WebSocketHook = {
  readonly send: (msg: WSClientMessage) => void;
  readonly readyState: number;
};

export function useWebSocket(): WebSocketHook {
  const { status } = useAuth();
  const handleServerMessage = useWsStore((state) => state.handleServerMessage);
  const socketRef = useRef<WebSocket | null>(null);
  const [readyState, setReadyState] = useState(CLOSED_READY_STATE);

  useEffect(() => {
    if (status !== 'authed') {
      closeSocket(socketRef.current);
      socketRef.current = null;
      setReadyState(CLOSED_READY_STATE);
      return;
    }

    let cancelled = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;

    const clearTimers = (): void => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (pingTimer !== null) {
        window.clearInterval(pingTimer);
        pingTimer = null;
      }
    };

    const connect = (): void => {
      if (cancelled) {
        return;
      }

      const socket = new WebSocket(new URL('/ws', window.location.href).toString().replace(/^http/, 'ws'));
      socketRef.current = socket;
      setReadyState(socket.readyState);

      socket.addEventListener('open', () => {
        reconnectAttempt = 0;
        setReadyState(socket.readyState);
        sendRaw(socket, { type: 'hello' });
        pingTimer = window.setInterval(() => {
          sendRaw(socket, { type: 'ping' });
        }, PING_INTERVAL_MS);
      });

      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') {
          return;
        }
        const parsed = parseJson(event.data);
        if (isServerMessage(parsed)) {
          handleServerMessage(parsed);
        }
      });

      socket.addEventListener('close', () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        if (pingTimer !== null) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        setReadyState(socket.readyState);
        if (cancelled) {
          return;
        }
        const delay = BACKOFF_MS[reconnectAttempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      });

      socket.addEventListener('error', () => {
        setReadyState(socket.readyState);
      });
    };

    connect();

    return () => {
      cancelled = true;
      clearTimers();
      closeSocket(socketRef.current);
      socketRef.current = null;
      setReadyState(CLOSED_READY_STATE);
    };
  }, [handleServerMessage, status]);

  const send = useCallback((msg: WSClientMessage): void => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      sendRaw(socket, msg);
    }
  }, []);

  return { send, readyState };
}

function sendRaw(socket: WebSocket, msg: WSClientMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function closeSocket(socket: WebSocket | null): void {
  if (socket === null) {
    return;
  }
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close(1000, 'auth state changed');
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
