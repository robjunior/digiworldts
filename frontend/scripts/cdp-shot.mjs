// CDP screenshotter for Phase 6 verification. Seeds a session cookie, navigates,
// screenshots, dumps DOM, and captures console/exceptions.
//
// Usage:
//   node frontend/scripts/cdp-shot.mjs <cookieValue> <url> <outPng> [waitMs]
//
// Requires the `ws` module — run from the backend workspace directory:
//   node ../frontend/scripts/cdp-shot.mjs  ...    (from backend/)
//   OR:  node -r ../backend/node_modules ...
//
// Simpler: `node backend/node_modules/.bin/tsx` isn't needed — just execute
// from repo root with `node --experimental-vm-modules frontend/scripts/cdp-shot.mjs`
// AFTER making a symlink `frontend/scripts/node_modules -> ../../backend/node_modules`.
// The recommended invocation (used by our test harness) is:
//
//   cp frontend/scripts/cdp-shot.mjs /tmp/cdp-shot.mjs && \
//   ln -sfn $PWD/backend/node_modules /tmp/node_modules && \
//   node /tmp/cdp-shot.mjs <cookie> <url> <out.png>
//
// If that's fragile in your env, use the more explicit form:
//
//   NODE_PATH=$PWD/backend/node_modules node frontend/scripts/cdp-shot.mjs ...

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import net from 'node:net';
import { WebSocket } from 'ws';

const [, , cookieValue, url, outPng, waitMsArg] = process.argv;
if (!cookieValue || !url || !outPng) {
  console.error('usage: node cdp-shot.mjs <cookieValue> <url> <outPng> [waitMs]');
  process.exit(2);
}
const WAIT_MS = Number(waitMsArg) || 3500;

const CHROME =
  process.env.DW_CHROME ||
  process.env.CHROME_PATH ||
  'chromium';
const PORT = 9222 + Math.floor(Math.random() * 800);
const UDIR = `/tmp/dw-cdp-${process.pid}-${Date.now()}`;

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--disable-features=OptimizationGuideModelDownloading,MediaRouter,AutofillServerCommunication',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${UDIR}`,
    '--window-size=1440,900',
  ],
  { stdio: 'ignore' },
);
process.on('exit', () => {
  try { chrome.kill('SIGKILL'); } catch {}
});

await new Promise((resolve, reject) => {
  const deadline = Date.now() + 10_000;
  const tick = () => {
    if (Date.now() > deadline) return reject(new Error('cdp port timeout'));
    const s = net.connect(PORT, '127.0.0.1', () => {
      s.destroy();
      resolve();
    });
    s.on('error', () => setTimeout(tick, 100));
  };
  tick();
});

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tab = list.find((t) => t.type === 'page') ?? list[0];
if (!tab?.webSocketDebuggerUrl) throw new Error('no page tab');

const ws = new WebSocket(tab.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const consoleLog = [];
const exceptions = [];

ws.on('message', (data) => {
  const msg = JSON.parse(String(data));
  if (msg.id != null) {
    const cb = pending.get(msg.id);
    pending.delete(msg.id);
    if (cb) cb(msg);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const args = (msg.params.args ?? [])
      .map((a) => a.value ?? a.description ?? JSON.stringify(a))
      .join(' ');
    consoleLog.push(`[${msg.params.type}] ${args}`);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const e = msg.params.exceptionDetails;
    exceptions.push(
      `${e.text} ${e.exception?.description ?? ''} @ ${e.url}:${e.lineNumber}`,
    );
  }
});

const cmd = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, (m) =>
      m.error
        ? reject(new Error(`${method}: ${m.error.message}`))
        : resolve(m.result),
    );
    ws.send(JSON.stringify({ id, method, params }));
  });

await new Promise((r) => ws.once('open', r));
await cmd('Page.enable');
await cmd('Network.enable');
await cmd('Runtime.enable');

for (const domain of ['127.0.0.1', 'localhost']) {
  await cmd('Network.setCookie', {
    name: 'digiworld_sid',
    value: cookieValue,
    domain,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  });
}

await cmd('Page.navigate', { url });
await new Promise((r) => setTimeout(r, WAIT_MS));

const shot = await cmd('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: false,
});
await writeFile(outPng, Buffer.from(shot.data, 'base64'));

const dom = await cmd('Runtime.evaluate', {
  expression: 'document.documentElement.outerHTML',
  returnByValue: true,
});
await writeFile(outPng.replace(/\.png$/, '.html'), dom.result.value);

console.log('=== console (' + consoleLog.length + ') ===');
consoleLog.slice(0, 30).forEach((l) => console.log(l));
console.log('=== exceptions (' + exceptions.length + ') ===');
exceptions.slice(0, 30).forEach((l) => console.log(l));
console.log(`OK ${outPng}`);

ws.close();
try { chrome.kill('SIGKILL'); } catch {}
process.exit(exceptions.length > 0 ? 3 : 0);
