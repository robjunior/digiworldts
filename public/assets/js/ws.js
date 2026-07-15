/* ============================================================
   DigiWorld — WebSocket client.
   Auto-reconnect with exponential backoff (capped). Simple event bus.
   Cookies flow with the upgrade so the server can resolve the session.
   ============================================================ */

const WS_URL = () => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
};

let socket = null;
let backoff = 500;
const MAX_BACKOFF = 8000;
const listeners = new Map(); // type -> Set<fn>
let manualClose = false;

function emit(type, payload) {
  const set = listeners.get(type);
  if (!set) return;
  for (const fn of set) {
    try { fn(payload); } catch (err) { console.error('[ws]', type, err); }
  }
}

function attach() {
  manualClose = false;
  const s = new WebSocket(WS_URL());
  socket = s;
  s.addEventListener('open', () => {
    backoff = 500;
    emit('open', {});
    send({ type: 'hello' });
  });
  s.addEventListener('message', (event) => {
    let msg = null;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg && typeof msg.type === 'string') emit(msg.type, msg);
  });
  s.addEventListener('close', (event) => {
    socket = null;
    emit('close', { code: event.code, reason: event.reason });
    if (manualClose) return;
    // 4401 = unauth — do not spin, let the auth guard redirect.
    if (event.code === 4401) { emit('unauth', {}); return; }
    setTimeout(attach, backoff);
    backoff = Math.min(MAX_BACKOFF, backoff * 1.7);
  });
  s.addEventListener('error', () => {
    // Actual error info arrives via close; nothing to do here.
  });
}

export const ws = {
  connect() {
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    attach();
  },
  disconnect() {
    manualClose = true;
    if (socket) socket.close();
  },
  send(msg) { return send(msg); },
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => ws.off(type, fn);
  },
  off(type, fn) {
    const set = listeners.get(type);
    if (set) set.delete(fn);
  },
  isOpen() { return socket && socket.readyState === 1; },
};

function send(msg) {
  if (!socket || socket.readyState !== 1) return false;
  try {
    socket.send(JSON.stringify(msg));
    return true;
  } catch (err) {
    console.warn('[ws] send failed', err);
    return false;
  }
}
