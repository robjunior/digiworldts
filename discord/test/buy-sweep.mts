import { assert, assertEqual } from './assert.mjs';
import { setTestEnv } from './env.mjs';

setTestEnv();

type Row = Record<string, unknown>;

class PurchaseDb {
  readonly sessions: Row[] = [];
  readonly events: Row[] = [];
  paused = false;
  debt: Row | null = null;

  async query<T extends Row>(text: string, params: readonly unknown[] = []): Promise<{ readonly rows: readonly T[]; readonly rowCount: number }> {
    if (text.includes('FROM credit_debt')) {
      return { rows: (this.debt ? [this.debt] : []) as unknown as readonly T[], rowCount: this.debt ? 1 : 0 };
    }
    if (text.includes('FROM sales_pause')) {
      return { rows: (this.paused ? [{ paused: true, paused_at: 1, paused_by: 'admin', reason: null }] : []) as unknown as readonly T[], rowCount: this.paused ? 1 : 0 };
    }
    if (text.includes('INSERT INTO purchase_sessions')) {
      this.sessions.push({ id: params[0], user_id: params[1], discord_id: params[2], guild_id: params[3], sku: params[4], provider: params[5], provider_payment_id: params[6], state: params[7], amount_brl_cents: params[8], currency: params[9], idempotency_key: params[10], qr_code: params[11], qr_code_base64: params[12], ticket_url: params[13], expires_at: params[14], delivered_at: params[15], metadata_json: params[16], created_at: params[17], updated_at: params[18] });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('UPDATE purchase_sessions') && text.includes('provider_payment_id = $2')) {
      const session = this.sessions.find((s) => s.id === params[0]);
      if (session !== undefined) {
        session.provider_payment_id = params[1];
        session.idempotency_key = params[2];
        session.qr_code = params[3];
        session.qr_code_base64 = params[4];
        session.ticket_url = params[5];
        session.expires_at = params[6];
        session.state = params[7];
        session.metadata_json = params[8];
        session.updated_at = params[9];
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('UPDATE purchase_sessions') && text.includes("state = 'expired'")) {
      const now = Number(params[0]);
      const expired = this.sessions.filter((session) => (session.state === 'pending' || session.state === 'awaiting_payment') && typeof session.expires_at === 'number' && session.expires_at < now);
      for (const session of expired) {
        session.state = 'expired';
        session.updated_at = now;
      }
      return { rows: expired as readonly T[], rowCount: expired.length };
    }
    if (text.includes('INSERT INTO purchase_events')) {
      this.events.push({ id: params[0], session_id: params[1], from_state: params[2], to_state: params[3], reason: params[5] });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected sql:${text}`);
  }
}

type FakeInteraction = {
  readonly user: { readonly id: string };
  readonly guildId: string;
  readonly options: { readonly getNumber: (name: string) => number | null };
  readonly calls: string[];
  deferReply(payload: { readonly ephemeral: true }): Promise<void>;
  editReply(payload: unknown): Promise<void>;
};

function interaction(valor: number | null = null, userId = 'discord-1'): FakeInteraction {
  const calls: string[] = [];
  return {
    user: { id: userId },
    guildId: 'guild-1',
    options: { getNumber: (name) => (name === 'valor' ? valor : null) },
    calls,
    async deferReply(payload) { assert(payload.ephemeral, 'buy reply ephemeral'); calls.push('defer'); },
    async editReply(payload) { calls.push(`edit:${JSON.stringify(payload)}`); },
  };
}

function buttonInteraction(customId: string, userId = 'discord-btn'): FakeInteraction & { readonly customId: string } {
  return { ...interaction(null, userId), customId };
}

const payer = { email: 'buyer@test.local', name: 'Test', lastName: 'Buyer', identificationType: 'CPF', identificationNumber: '12345678909' };
const backendMock = { userByDiscord: async () => ({ userId: 'user-1', displayName: 'User', discordId: 'discord-1', credits: 0, premiumUntil: null, locale: 'en' }) };

function paymentMock(captured: { amountBrlCents?: number }) {
  return {
    createPixPayment: async (input: { readonly amountBrlCents: number }) => {
      captured.amountBrlCents = input.amountBrlCents;
      return { provider: 'mercadopago' as const, providerPaymentId: 'pay_1', innerPaymentId: 'pay_inner_1', status: 'pending', qrCode: 'qr-code', qrCodeBase64: 'base64', ticketUrl: 'ticket', expiresAt: null, idempotencyKey: 'idem-1' };
    },
  };
}

function lastEdit(calls: readonly string[]): string {
  return calls.find((call) => call.startsWith('edit:')) ?? '';
}

async function main(): Promise<void> {
  const { handleBuyCommand, handleBuyButton, handleBuyConfirm, parseBuyButtonCents, BUY_BUTTON_PREFIX, BUY_CONFIRM_PREFIX } = await import('../src/commands/buy.js');

  const guideDb = new PurchaseDb();
  const guide = interaction(null, 'buyer-guide');
  await handleBuyCommand(guide, { db: guideDb, backendClient: backendMock, payer, now: () => 1_000 });
  assertEqual(guide.calls[0] ?? '', 'defer', '/buy defers before all work');
  const guideReply = lastEdit(guide.calls);
  assert(guideReply.includes('DigiCredits for every BRL'), '/buy without valor renders the rate guide');
  assert(guideReply.includes('Minimum BRL 5.00'), '/buy guide shows the configured minimum');
  assert(guideReply.includes('Maximum BRL 500.00'), '/buy guide shows the configured maximum');
  assert(guideReply.includes('"custom_id":"buy:amount:1000"'), '/buy guide offers the BRL 10 shortcut button');
  assert(guideReply.includes('"custom_id":"buy:amount:10000"'), '/buy guide offers the BRL 100 shortcut button');
  assertEqual(guideDb.sessions.length, 0, '/buy guide creates no purchase session');

  // /buy valor:X now stops at the terms. Money only moves after an explicit accept.
  const captured: { amountBrlCents?: number } = {};
  const buyDb = new PurchaseDb();
  const buy = interaction(37.5, 'buyer-ok');
  await handleBuyCommand(buy, { db: buyDb, backendClient: backendMock, paymentProvider: paymentMock(captured), payer, now: () => 1_000 });
  const termsReply = lastEdit(buy.calls);
  assert(termsReply.includes('already spent cannot be refunded'), '/buy valor shows the refund terms before taking money');
  assert(termsReply.includes('3750 DigiCredits'), '/buy terms state exactly what is being bought');
  assert(termsReply.includes(`"custom_id":"${BUY_CONFIRM_PREFIX}3750"`), '/buy terms carry an accept button for that exact amount');
  assertEqual(captured.amountBrlCents, undefined, 'no PIX order is created before the player accepts');
  assertEqual(buyDb.sessions.length, 0, 'no session is created before the player accepts');

  const confirm = buttonInteraction(`${BUY_CONFIRM_PREFIX}3750`, 'buyer-ok-confirm');
  await handleBuyConfirm(confirm, { db: buyDb, backendClient: backendMock, paymentProvider: paymentMock(captured), payer, now: () => 1_000 });
  assertEqual(captured.amountBrlCents, 3750, 'accepting the terms converts to 3750 centavos');
  assertEqual(buyDb.sessions[0]?.state, 'awaiting_payment', 'accepted purchase persists awaiting_payment');
  assertEqual(buyDb.sessions[0]?.amount_brl_cents, 3750, 'session stores the exact centavos charged');
  assertEqual(buyDb.sessions[0]?.sku, 'CREDITS_3750', 'session sku encodes the amount');
  const metadata = JSON.parse(String(buyDb.sessions[0]?.metadata_json)) as { readonly creditsAmount: number; readonly creditsPerBrl: number; readonly innerPaymentId: string; readonly termsAcceptedAt: number };
  assertEqual(metadata.creditsAmount, 3750, 'creditsAmount frozen at 100 credits per BRL (R$37.50 -> 3750)');
  assertEqual(metadata.creditsPerBrl, 100, 'rate frozen in metadata for auditability');
  assertEqual(metadata.innerPaymentId, 'pay_inner_1', 'innerPaymentId persisted for the refund path (REV-1.4)');
  assertEqual(metadata.termsAcceptedAt, 1_000, 'consent timestamp is recorded on the session');
  assert(lastEdit(confirm.calls).includes('3750 DigiCredits'), 'QR embed states the credits being bought');

  const lowDb = new PurchaseDb();
  const low = interaction(1, 'buyer-low');
  await handleBuyCommand(low, { db: lowDb, backendClient: backendMock, paymentProvider: paymentMock({}), payer, now: () => 1_000 });
  assert(lastEdit(low.calls).includes('Minimum purchase is BRL 5.00'), '/buy below minimum is rejected');
  assertEqual(lowDb.sessions.length, 0, 'below-minimum creates no session');

  const highDb = new PurchaseDb();
  const high = interaction(9_999, 'buyer-high');
  await handleBuyCommand(high, { db: highDb, backendClient: backendMock, paymentProvider: paymentMock({}), payer, now: () => 1_000 });
  assert(lastEdit(high.calls).includes('Maximum purchase is BRL 500.00'), '/buy above maximum is rejected');
  assertEqual(highDb.sessions.length, 0, 'above-maximum creates no session');

  const pausedDb = new PurchaseDb();
  pausedDb.paused = true;
  const paused = interaction(50, 'buyer-paused');
  await handleBuyCommand(paused, { db: pausedDb, backendClient: backendMock, paymentProvider: paymentMock({}), payer, now: () => 1_000 });
  assert(lastEdit(paused.calls).includes('sales are paused'), '/buy blocked while sales are paused');
  assertEqual(pausedDb.sessions.length, 0, 'paused sales create no session');

  // A chargeback that could not be fully clawed back leaves debt. Selling more credits
  // to someone who already owes us is how you get farmed.
  const debtDb = new PurchaseDb();
  debtDb.debt = { user_id: 'user-1', amount: 750, reason: 'chargeback:sess-x', purchase_session_id: 'sess-x', created_at: 1, updated_at: 1 };
  const indebted = interaction(50, 'buyer-indebted');
  await handleBuyCommand(indebted, { db: debtDb, backendClient: backendMock, paymentProvider: paymentMock({}), payer, now: () => 1_000 });
  assert(lastEdit(indebted.calls).includes('750'), '/buy tells the player how much they owe');
  assertEqual(debtDb.sessions.length, 0, '/buy is blocked while a credit debt is outstanding');

  assertEqual(parseBuyButtonCents(`${BUY_BUTTON_PREFIX}2500`), 2500, 'button custom_id parses to centavos');
  assertEqual(parseBuyButtonCents('something:else'), null, 'foreign custom_id returns null');
  assertEqual(parseBuyButtonCents(`${BUY_BUTTON_PREFIX}abc`), null, 'malformed custom_id returns null');

  // Regression guard for the orphaned-order bug: the MercadoPago order used to be
  // created BEFORE the row existed, so a crash in between left a payable QR with no
  // session to deliver against. The session must survive a provider failure.
  const orphanDb = new PurchaseDb();
  const orphan = buttonInteraction(`${BUY_CONFIRM_PREFIX}5000`, 'buyer-orphan');
  await handleBuyConfirm(orphan, {
    db: orphanDb,
    backendClient: backendMock,
    paymentProvider: { createPixPayment: async () => { throw new Error('MP down'); } },
    payer,
    now: () => 1_000,
  });
  assertEqual(orphanDb.sessions.length, 1, 'session is persisted before the provider call, so a provider failure still leaves a durable row');
  assertEqual(orphanDb.sessions[0]?.state, 'pending', 'session stranded by a provider failure stays in pending, never awaiting_payment');
  assertEqual(orphanDb.sessions[0]?.provider_payment_id, null, 'stranded session has no provider payment id');
  const orphanMeta = JSON.parse(String(orphanDb.sessions[0]?.metadata_json)) as { readonly creditsAmount: number };
  assertEqual(orphanMeta.creditsAmount, 5000, 'creditsAmount is frozen at insert time, before the provider is ever called');

  const buttonCaptured: { amountBrlCents?: number } = {};
  const buttonDb = new PurchaseDb();
  const button = buttonInteraction(`${BUY_BUTTON_PREFIX}2500`, 'buyer-shortcut');
  await handleBuyButton(button, { db: buttonDb, backendClient: backendMock, paymentProvider: paymentMock(buttonCaptured), payer, now: () => 1_000 });
  assert(lastEdit(button.calls).includes(`"custom_id":"${BUY_CONFIRM_PREFIX}2500"`), 'shortcut button routes through the terms, not straight to PIX');
  assertEqual(buttonDb.sessions.length, 0, 'shortcut button alone creates no session');

  const shortcutConfirm = buttonInteraction(`${BUY_CONFIRM_PREFIX}2500`, 'buyer-shortcut-ok');
  await handleBuyConfirm(shortcutConfirm, { db: buttonDb, backendClient: backendMock, paymentProvider: paymentMock(buttonCaptured), payer, now: () => 1_000 });
  assertEqual(buttonCaptured.amountBrlCents, 2500, 'accepting the shortcut terms creates a BRL 25 purchase');
  assertEqual(buttonDb.sessions[0]?.amount_brl_cents, 2500, 'shortcut purchase persists the right amount');

  const { startPurchaseSweep } = await import('../src/purchase/sweep.js');
  const sweepDb = new PurchaseDb();
  sweepDb.sessions.push({ id: 'expired-session', user_id: 'user-1', discord_id: 'discord-1', guild_id: 'guild-1', sku: 'CREDITS_1000', provider: 'mercadopago', provider_payment_id: 'pay_old', state: 'awaiting_payment', amount_brl_cents: 1000, currency: 'BRL', idempotency_key: 'idem-old', qr_code: 'qr', qr_code_base64: 'base64', ticket_url: 'ticket', expires_at: 500, delivered_at: null, metadata_json: '{}', created_at: 0, updated_at: 0 });
  const timer: { callback: (() => void) | null } = { callback: null };
  let cleared = false;
  const sweep = startPurchaseSweep(300_000, {
    db: sweepDb,
    now: () => 1_000,
    setIntervalFn: ((callback: () => void) => { timer.callback = callback; return { id: 'timer' }; }) as unknown as typeof setInterval,
    clearIntervalFn: (() => { cleared = true; }) as unknown as typeof clearInterval,
  });
  assert(timer.callback !== null, 'sweep interval registered');
  timer.callback();
  await sweep.runOnce();
  assertEqual(sweepDb.sessions.find((session) => session.id === 'expired-session')?.state, 'expired', 'sweep expires old awaiting payment');
  sweep.stop();
  assert(cleared, 'sweep clears interval on stop');

  process.stdout.write('buy and sweep tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
