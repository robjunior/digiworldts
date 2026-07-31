import { setImmediate as flushImmediate } from 'node:timers/promises';

import { assert, assertEqual } from './assert.mjs';
import { setTestEnv } from './env.mjs';

setTestEnv();

type Row = Record<string, unknown>;

class MemoryDb {
  readonly sessions = new Map<string, Row>();
  readonly webhooks = new Set<string>();
  readonly events: Row[] = [];

  async query<T extends Row>(text: string, params: readonly unknown[] = []): Promise<{ readonly rows: readonly T[]; readonly rowCount: number }> {
    if (text.includes('INSERT INTO webhook_events')) {
      const key = `${String(params[0])}:${String(params[1])}`;
      if (this.webhooks.has(key)) return { rows: [], rowCount: 0 };
      this.webhooks.add(key);
      return { rows: [{ provider_event_id: params[1] } as T], rowCount: 1 };
    }
    if (text.includes('SELECT * FROM purchase_sessions WHERE provider =')) {
      const row = [...this.sessions.values()].find((session) => session.provider === params[0] && session.provider_payment_id === params[1]);
      return { rows: row === undefined ? [] : [row as T], rowCount: row === undefined ? 0 : 1 };
    }
    if (text.includes('UPDATE purchase_sessions SET state = $2')) {
      const session = this.sessions.get(String(params[0]));
      if (session !== undefined) session.state = params[1];
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('UPDATE purchase_sessions SET state = $2, delivered_at')) {
      const session = this.sessions.get(String(params[0]));
      if (session !== undefined) {
        session.state = params[1];
        session.delivered_at = params[2];
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('INSERT INTO purchase_events')) {
      this.events.push({ id: params[0], session_id: params[1], from_state: params[2], to_state: params[3], provider_status: params[4], reason: params[5] });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected sql:${text}`);
  }
}

function session(state: string): Row {
  return { id: 'session-1', user_id: 'user-1', discord_id: 'discord-1', guild_id: 'guild-1', sku: 'CREDITS_2500', provider: 'mercadopago', provider_payment_id: 'pay_1', state, amount_brl_cents: 2500, currency: 'BRL', idempotency_key: 'idem', qr_code: 'qr', qr_code_base64: 'base64', ticket_url: 'ticket', expires_at: 2_000, delivered_at: null, metadata_json: JSON.stringify({ creditsAmount: 2500, creditsPerBrl: 100, innerPaymentId: 'pay_inner_1' }), created_at: 1_000, updated_at: 1_000 };
}

async function main(): Promise<void> {
  const { MercadoPagoProvider, signMercadoPagoWebhook } = await import('../src/payments/mercadopago.js');
  const { processMercadoPagoPayment } = await import('../src/purchase/orchestrator.js');
  const { createServer } = await import('../src/server.js');
  const db = new MemoryDb();
  db.sessions.set('session-1', session('awaiting_payment'));
  const grants: { readonly key: string; readonly amount: number }[] = [];
  const notifications: { readonly discordId: string; readonly kind: string; readonly sku?: string }[] = [];
  await processMercadoPagoPayment('pay_1', {
    db,
    now: () => 3_000,
    paymentProvider: { getStatus: async () => ({ provider: 'mercadopago', providerPaymentId: 'pay_1', status: 'approved', raw: { status: 'approved' } }) },
    backendClient: {
      walletCredit: async (input) => { grants.push({ key: input.idempotencyKey, amount: input.amount }); return { ok: true, userId: input.userId, amount: input.amount, credits: input.amount, reason: input.reason }; },
    },
    notifications: { sendPurchaseNotification: async (input) => { notifications.push(input); } },
  });
  assertEqual(grants.length, 1, 'approved payment grants exactly once');
  assertEqual(grants[0]?.key ?? '', 'purchase:session-1:reward', 'deterministic reward idempotency key');
  assertEqual(grants[0]?.amount, 2500, 'credits come from the frozen metadata creditsAmount, not a catalog lookup');
  assertEqual(db.sessions.get('session-1')?.state, 'delivered', 'approved payment reaches delivered');
  assertEqual(notifications.length, 1, 'approved payment fires exactly one notification');
  assertEqual(notifications[0]?.kind, 'approved', 'notification kind is approved');
  assertEqual(notifications[0]?.discordId, 'discord-1', 'notification targets session discord id');

  const fallbackDb = new MemoryDb();
  fallbackDb.sessions.set('session-2', { ...session('awaiting_payment'), id: 'session-2', provider_payment_id: 'pay_2', amount_brl_cents: 1000, metadata_json: '{}' });
  const fallbackGrants: number[] = [];
  await processMercadoPagoPayment('pay_2', {
    db: fallbackDb,
    now: () => 3_000,
    paymentProvider: { getStatus: async () => ({ provider: 'mercadopago', providerPaymentId: 'pay_2', status: 'approved', raw: { status: 'approved' } }) },
    backendClient: {
      walletCredit: async (input) => { fallbackGrants.push(input.amount); return { ok: true, userId: input.userId, amount: input.amount, credits: input.amount, reason: input.reason }; },
    },
  });
  assertEqual(fallbackGrants[0], 1000, 'session without frozen creditsAmount recomputes from amountBrlCents x CREDITS_PER_BRL');

  const processCalls: string[] = [];
  const provider = new MercadoPagoProvider({ accessToken: 'TEST-token', webhookSecret: 'secret', baseUrl: 'http://127.0.0.1:1' });
  const app = createServer({ mercadoPagoWebhook: { db, paymentProvider: provider, now: () => 5_000, processPayment: async (paymentId) => { processCalls.push(paymentId); } } });
  const ts = '12345';
  const signature = signMercadoPagoWebhook({ dataId: 'pay_2', requestId: 'req_1', ts, secret: 'secret' });
  const payload = { id: 'evt_1', type: 'payment', action: 'payment.updated', data: { id: 'pay_2' }, live_mode: false, date_created: '2026-07-30T14:00:00.000Z' };
  const first = await app.inject({ method: 'POST', url: '/webhooks/mercadopago', headers: { 'x-signature': `ts=${ts},v1=${signature}`, 'x-request-id': 'req_1' }, payload });
  assertEqual(first.statusCode, 200, 'first webhook ACKs 200');
  await flushImmediate();
  const second = await app.inject({ method: 'POST', url: '/webhooks/mercadopago', headers: { 'x-signature': `ts=${ts},v1=${signature}`, 'x-request-id': 'req_1' }, payload });
  assertEqual(second.statusCode, 200, 'duplicate webhook ACKs 200');
  await flushImmediate();
  assertEqual(processCalls.length, 1, 'duplicate webhook does not process twice');
  const bad = await app.inject({ method: 'POST', url: '/webhooks/mercadopago', headers: { 'x-signature': `ts=${ts},v1=${signature}` }, payload: { ...payload, data: { id: 'tampered' } } });
  assertEqual(bad.statusCode, 401, 'bad signature rejected');

  const orderId = 'ORDTST01KYT58NXVRNAW452K715R7RF2';
  const orderSignature = signMercadoPagoWebhook({ dataId: orderId, requestId: 'req_2', ts, secret: 'secret' });
  const queryOnly = await app.inject({
    method: 'POST',
    url: `/webhooks/mercadopago?type=order&data.id=${orderId}&data.external_reference=digiworld-purchase-42`,
    headers: { 'x-signature': `ts=${ts},v1=${orderSignature}`, 'x-request-id': 'req_2' },
    payload: '',
  });
  assertEqual(queryOnly.statusCode, 200, 'orders API — query-string-only notification ACKs 200');
  await flushImmediate();
  assertEqual(processCalls.length, 2, 'orders API — new notification triggers exactly one process call');
  assertEqual(processCalls[1], orderId, 'orders API — processPayment receives the order_id from data.id query param');

  const missingBoth = await app.inject({ method: 'POST', url: '/webhooks/mercadopago', payload: {} });
  assertEqual(missingBoth.statusCode, 400, 'no type + no data.id anywhere returns 400');

  await app.close();
  process.stdout.write('webhook and orchestrator tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
