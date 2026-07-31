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
      return { rows: [{ provider_event_id: params[1] }] as unknown as readonly T[], rowCount: 1 };
    }
    if (text.includes('SELECT * FROM purchase_sessions WHERE provider =')) {
      const row = [...this.sessions.values()].find((session) => session.provider === params[0] && session.provider_payment_id === params[1]);
      return { rows: row === undefined ? [] : [row as T], rowCount: row === undefined ? 0 : 1 };
    }
    if (text.includes('UPDATE purchase_sessions SET state = $2, delivered_at')) {
      const session = this.sessions.get(String(params[0]));
      if (session === undefined || session.state !== params[3]) return { rows: [], rowCount: 0 };
      session.state = params[1];
      session.delivered_at = params[2];
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('UPDATE purchase_sessions SET state = $2')) {
      const session = this.sessions.get(String(params[0]));
      if (session === undefined || session.state !== params[3]) return { rows: [], rowCount: 0 };
      session.state = params[1];
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
  const { MercadoPagoProvider, signMercadoPagoWebhook, MercadoPagoHttpError } = await import('../src/payments/mercadopago.js');
  const { processMercadoPagoPayment } = await import('../src/purchase/orchestrator.js');
  const { createServer } = await import('../src/server.js');
  const db = new MemoryDb();
  db.sessions.set('session-1', session('awaiting_payment'));
  const grants: { readonly key: string; readonly amount: number }[] = [];
  const notifications: { readonly discordId: string; readonly kind: string; readonly sku?: string }[] = [];
  await processMercadoPagoPayment('pay_1', {
    db,
    now: () => 3_000,
    paymentProvider: { getStatus: async () => ({ provider: 'mercadopago', providerPaymentId: 'pay_1', status: 'approved', paidAmountBrlCents: 2500, raw: { status: 'approved' } }) },
    backendClient: {
      walletCredit: async (input) => { grants.push({ key: input.idempotencyKey, amount: input.amount }); return { ok: true, userId: input.userId, amount: input.amount, credits: input.amount, reason: input.reason }; },
      walletDebit: async (input) => ({ ok: true, userId: input.userId, requested: input.amount, debited: input.amount, shortfall: 0, credits: 0, reason: input.reason }),
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
    paymentProvider: { getStatus: async () => ({ provider: 'mercadopago', providerPaymentId: 'pay_2', status: 'approved', paidAmountBrlCents: 1000, raw: { status: 'approved' } }) },
    backendClient: {
      walletCredit: async (input) => { fallbackGrants.push(input.amount); return { ok: true, userId: input.userId, amount: input.amount, credits: input.amount, reason: input.reason }; },
      walletDebit: async (input) => ({ ok: true, userId: input.userId, requested: input.amount, debited: input.amount, shortfall: 0, credits: 0, reason: input.reason }),
    },
  });
  assertEqual(fallbackGrants[0], 1000, 'session without frozen creditsAmount recomputes from amountBrlCents x CREDITS_PER_BRL');

  // The provider is the authority on what was charged. If it disagrees with the session
  // we booked, delivering would mint currency nobody paid for.
  const mismatchDb = new MemoryDb();
  mismatchDb.sessions.set('session-3', { ...session('awaiting_payment'), id: 'session-3', provider_payment_id: 'pay_3', amount_brl_cents: 2500 });
  const mismatchGrants: number[] = [];
  await processMercadoPagoPayment('pay_3', {
    db: mismatchDb,
    now: () => 3_000,
    paymentProvider: { getStatus: async () => ({ provider: 'mercadopago', providerPaymentId: 'pay_3', status: 'approved', paidAmountBrlCents: 100, raw: { status: 'approved', total_amount: '1.00' } }) },
    backendClient: {
      walletCredit: async (input) => { mismatchGrants.push(input.amount); return { ok: true, userId: input.userId, amount: input.amount, credits: input.amount, reason: input.reason }; },
      walletDebit: async (input) => ({ ok: true, userId: input.userId, requested: input.amount, debited: input.amount, shortfall: 0, credits: 0, reason: input.reason }),
    },
  });
  assertEqual(mismatchGrants.length, 0, 'provider reporting a different paid amount must NOT mint any credits');
  assertEqual(mismatchDb.sessions.get('session-3')?.state, 'disputed', 'amount mismatch parks the session in disputed for a human');
  assert(mismatchDb.events.some((e) => e.reason === 'amount-mismatch'), 'amount mismatch is recorded as a purchase event');

  // A 500 makes MercadoPago retry. An order it does not know about will never resolve,
  // so it must not become an infinite retry loop.
  let unknownThrew = false;
  try {
    await processMercadoPagoPayment('ORD_DOES_NOT_EXIST', {
      db: new MemoryDb(),
      now: () => 3_000,
      paymentProvider: { getStatus: async () => { throw new MercadoPagoHttpError(404, { message: 'not found' }); } },
    });
  } catch {
    unknownThrew = true;
  }
  assert(!unknownThrew, 'an order MercadoPago does not know is swallowed, not retried forever');

  let transientThrew = false;
  try {
    await processMercadoPagoPayment('ORD_PROVIDER_DOWN', {
      db: new MemoryDb(),
      now: () => 3_000,
      paymentProvider: { getStatus: async () => { throw new MercadoPagoHttpError(503, { message: 'unavailable' }); } },
    });
  } catch {
    transientThrew = true;
  }
  assert(transientThrew, 'a transient provider failure still propagates so the webhook returns 500 and MercadoPago retries');

  const processCalls: string[] = [];
  const provider = new MercadoPagoProvider({ accessToken: 'TEST-token', webhookSecret: 'secret', baseUrl: 'http://127.0.0.1:1' });
  const app = createServer({ mercadoPagoWebhook: { db, paymentProvider: provider, now: () => 5_000, processPayment: async (paymentId) => { processCalls.push(paymentId); } } });
  const ts = '12345';
  const signature = signMercadoPagoWebhook({ dataId: 'pay_2', requestId: 'req_1', ts, secret: 'secret' });
  const payload = { id: 'evt_1', type: 'payment', action: 'payment.updated', data: { id: 'pay_2' }, live_mode: false, date_created: '2026-07-30T14:00:00.000Z' };
  const first = await app.inject({ method: 'POST', url: '/webhooks/mercadopago', headers: { 'x-signature': `ts=${ts},v1=${signature}`, 'x-request-id': 'req_1' }, payload });
  assertEqual(first.statusCode, 200, 'first webhook ACKs 200');
  await flushImmediate();

  // Regression guard. MercadoPago sends several notifications per order carrying the
  // SAME data.id (action_required, then processed). An earlier build deduped on that
  // id, so the notification that actually reported payment was swallowed and the
  // player paid for nothing. Every signed notification must reach processPayment.
  const second = await app.inject({ method: 'POST', url: '/webhooks/mercadopago', headers: { 'x-signature': `ts=${ts},v1=${signature}`, 'x-request-id': 'req_1' }, payload });
  assertEqual(second.statusCode, 200, 'repeat notification for the same data.id still ACKs 200');
  await flushImmediate();
  assertEqual(processCalls.length, 2, 'same data.id arriving twice is processed BOTH times (status may have changed to paid)');

  const bad = await app.inject({ method: 'POST', url: '/webhooks/mercadopago', headers: { 'x-signature': `ts=${ts},v1=${signature}` }, payload: { ...payload, data: { id: 'tampered' } } });
  assertEqual(bad.statusCode, 401, 'bad signature rejected');

  const failingApp = createServer({
    mercadoPagoWebhook: {
      db,
      paymentProvider: provider,
      now: () => 5_000,
      processPayment: async () => { throw new Error('backend down'); },
    },
  });
  const failSig = signMercadoPagoWebhook({ dataId: 'pay_fail', requestId: 'req_f', ts, secret: 'secret' });
  const failed = await failingApp.inject({
    method: 'POST',
    url: '/webhooks/mercadopago',
    headers: { 'x-signature': `ts=${ts},v1=${failSig}`, 'x-request-id': 'req_f' },
    payload: { type: 'payment', action: 'payment.updated', data: { id: 'pay_fail' } },
  });
  assertEqual(failed.statusCode, 500, 'delivery failure returns non-2xx so MercadoPago retries instead of dropping a paid order');
  await failingApp.close();

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
  assertEqual(processCalls.length, 3, 'orders API — query-string notification processed on top of the two body notifications');
  assertEqual(processCalls[2], orderId, 'orders API — processPayment receives the order_id from data.id query param');

  const missingBoth = await app.inject({ method: 'POST', url: '/webhooks/mercadopago', payload: {} });
  assertEqual(missingBoth.statusCode, 400, 'no type + no data.id anywhere returns 400');

  await app.close();
  process.stdout.write('webhook and orchestrator tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
