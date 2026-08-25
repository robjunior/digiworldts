const WebSocket = require('ws');

const BASE = 'http://localhost:3100';
const WS_URL = 'ws://localhost:3100/ws';
const USER = 'ws_verify_' + Date.now();
const PASS = 'VerifyPass123!';
const CORR = 'corr-' + Date.now();
// matches .env DATABASE_URL (postgres, 127.0.0.1:5432/digiworld)
const DB_URL = 'postgres://digiworld:b86aa44d584534fc92a389684f8e19a2@127.0.0.1:5432/digiworld';

async function main() {
  // 1) register a throwaway user (ADMIN_BOOTSTRAP=open in dev .env)
  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: USER,
      password: PASS,
      firstName: 'WS',
      lastName: 'Verify',
      email: USER + '@example.com',
    }),
  });
  console.log('[register] status', reg.status);
  if (!reg.ok) {
    const t = await reg.text();
    throw new Error('register failed: ' + t);
  }

  // 2) login -> session cookie
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const setCookie = login.headers.get('set-cookie');
  if (!setCookie) throw new Error('no set-cookie from login (status ' + login.status + ')');
  const cookie = setCookie.split(';')[0];
  console.log('[login] ok, cookie len=' + cookie.length);

  // 3) WS connect with the session cookie
  const ws = new WebSocket(WS_URL, { headers: { Cookie: cookie } });
  let done = false;
  const ok = async (m) => {
    if (done) return; done = true;
    console.log('[PASS]', m);
    try { ws.close(); } catch {}
    await cleanup();
    process.exit(0);
  };
  const fail = async (m) => {
    if (done) return; done = true;
    console.error('[FAIL]', m);
    try { ws.close(); } catch {}
    await cleanup();
    process.exit(1);
  };

  ws.on('open', () => {
    console.log('[ws] open');
    ws.send(JSON.stringify({ type: 'hello' }));
    // not in any dungeon -> server must answer with a correlated response
    ws.send(JSON.stringify({ type: 'dungeon:move', dungeonId: 'dng_does_not_matter', x: 1, y: 1, correlationId: CORR }));
    console.log('[ws] sent dungeon:move (not joined) corr=' + CORR);
  });
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'welcome') { console.log('[ws] welcome received (auth ok)'); return; }
    // Either a result or an error with the matching correlationId proves the
    // dungeon:move WS message was routed to handleDungeonMove and a correlated
    // response came back. That is exactly the Bug #2 transport + correlation fix.
    if ((msg.type === 'dungeon:move-result' || msg.type === 'dungeon:move-error') && msg.correlationId === CORR) {
      ok('server echoed ' + msg.type + ' with matching correlationId'
        + (msg.code ? ' (code=' + msg.code + ')' : ''));
    }
  });
  ws.on('error', (e) => fail('ws error ' + e.message));
  ws.on('unexpected-response', (_req, res) => fail('ws upgrade rejected http ' + res.statusCode));
  setTimeout(() => fail('timeout: no correlated dungeon:move response within 6s'), 6000);
}

async function cleanup() {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: DB_URL });
    await pool.query('DELETE FROM users WHERE username = $1', [USER]);
    await pool.end();
    console.log('[cleanup] removed user', USER);
  } catch (e) {
    console.error('[cleanup] FAILED (throwaway user may remain):', USER, e.message);
  }
}

main().catch(async (e) => { console.error('[FATAL]', e); await cleanup(); process.exit(1); });
