import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { assert, assertEqual } from './assert.mjs';
import { setTestEnv } from './env.mjs';

setTestEnv();

type CapturedRequest = { readonly method: string; readonly url: string; readonly authorization: string | undefined; readonly body: string };

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function main(): Promise<void> {
  const captured: CapturedRequest[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      captured.push({ method: req.method ?? '', url: req.url ?? '', authorization: req.headers.authorization, body });
      if (req.url === '/api/service/user-by-discord/discord-1') sendJson(res, 200, { userId: 'user-1', displayName: 'Rob', discordId: 'discord-1', credits: 7, premiumUntil: null, locale: 'pt-BR' });
      else if (req.url === '/api/service/wallet-credit') sendJson(res, 200, { ok: true, userId: 'user-1', amount: 5, credits: 12, reason: 'test' });
      else if (req.url === '/api/service/products') sendJson(res, 200, { products: [] });
      else if (req.url === '/api/service/link-init') sendJson(res, 200, { linked: false });
      else if (req.url === '/api/service/link-complete') sendJson(res, 200, { linked: true, userId: 'user-1' });
      else if (req.url === '/api/service/unlink') sendJson(res, 200, { ok: true, unlinked: true });
      else sendJson(res, 409, { error: 'duplicate-idempotency-key' });
    })().catch((error: unknown) => sendJson(res, 500, { error: error instanceof Error ? error.message : 'unknown' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(typeof address === 'object' && address !== null, 'server address is available');
  const { BackendClient, BackendClientError } = await import('../src/backendClient.js');
  const client = new BackendClient({ baseUrl: `http://127.0.0.1:${address.port}`, serviceToken: 'token-123', timeoutMs: 1000 });
  assertEqual((await client.userByDiscord('discord-1')).credits, 7, 'user-by-discord parsed');
  await client.walletCredit({ userId: 'user-1', amount: 5, idempotencyKey: 'idem-1', reason: 'test' });
  await client.products();
  await client.linkInit('discord-1');
  await client.linkComplete({ discordId: 'discord-1', code: 'DW-0000-0000-0000-0000-0000' });
  await client.unlink('discord-1');
  assert(captured.every((req) => req.authorization === 'Bearer token-123'), 'Authorization header sent on every request');
  assert(captured.some((req) => req.url === '/api/service/wallet-credit' && req.body.includes('idem-1')), 'wallet idempotency key sent');
  assert(captured.some((req) => req.url === '/api/service/link-complete' && req.body.includes('DW-0000')), 'link-complete sends one-time code');
  let duplicateMapped = false;
  try {
    await client.userByDiscord('missing');
  } catch (error) {
    duplicateMapped = error instanceof BackendClientError && error.status === 409 && error.code === 'duplicate-idempotency-key';
  }
  assert(duplicateMapped, 'non-2xx maps to typed error');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  process.stdout.write(`backend client test passed (${captured.length} requests)\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
