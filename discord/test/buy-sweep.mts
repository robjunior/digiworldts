import { assert, assertEqual } from './assert.mjs';
import { setTestEnv } from './env.mjs';

setTestEnv();

type Row = Record<string, unknown>;

class PurchaseDb {
  readonly sessions: Row[] = [];
  readonly events: Row[] = [];
  async query<T extends Row>(text: string, params: readonly unknown[] = []): Promise<{ readonly rows: readonly T[]; readonly rowCount: number }> {
    if (text.includes('INSERT INTO purchase_sessions')) {
      this.sessions.push({ id: params[0], user_id: params[1], discord_id: params[2], guild_id: params[3], sku: params[4], provider: params[5], provider_payment_id: params[6], state: params[7], amount_brl_cents: params[8], currency: params[9], idempotency_key: params[10], qr_code: params[11], qr_code_base64: params[12], ticket_url: params[13], expires_at: params[14], delivered_at: params[15], metadata_json: params[16], created_at: params[17], updated_at: params[18] });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('SELECT sku FROM disabled_credit_packs')) {
      return { rows: [] as readonly T[], rowCount: 0 };
    }
    if (text.includes("UPDATE purchase_sessions") && text.includes("state = 'expired'")) {
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

function interaction(): { readonly user: { readonly id: string }; readonly guildId: string; readonly options: { readonly getString: () => string | null }; readonly calls: string[]; deferReply(payload: { readonly ephemeral: true }): Promise<void>; editReply(payload: unknown): Promise<void> } {
  const calls: string[] = [];
  return { user: { id: 'discord-1' }, guildId: 'guild-1', options: { getString: () => 'SKU_ITEM' }, calls, async deferReply(payload) { assert(payload.ephemeral, 'buy reply ephemeral'); calls.push('defer'); }, async editReply(payload) { calls.push(`edit:${JSON.stringify(payload)}`); } };
}

async function main(): Promise<void> {
  const { handleBuyCommand } = await import('../src/commands/buy.js');
  const db = new PurchaseDb();
  const calls: string[] = [];
  const buy = interaction();
  await handleBuyCommand(buy, {
    db,
    now: () => 1_000,
    payer: { email: 'buyer@test.local', name: 'Test', lastName: 'Buyer', identificationType: 'CPF', identificationNumber: '12345678909' },
    backendClient: { products: async () => { calls.push('products'); return { products: [{ id: 'backend-item', name: 'Backend Item', description: '', priceCredits: 0, kind: 'item', class: 'product', payload: {} }] }; }, userByDiscord: async () => { calls.push('userByDiscord'); return { userId: 'user-1', displayName: 'User', discordId: 'discord-1', credits: 0, premiumUntil: null, locale: 'en' }; } },
    loadCatalog: async () => ({ products: [{ sku: 'SKU_ITEM', displayName: { pt: 'Item', en: 'Item' }, priceBrlCents: 100, shopItemId: 'backend-item', kind: 'item', enabled: true }] }),
    paymentProvider: { createPixPayment: async () => { calls.push('payment'); return { provider: 'mercadopago', providerPaymentId: 'pay_1', innerPaymentId: 'pay_inner_1', status: 'pending', qrCode: 'qr-code', qrCodeBase64: 'base64', ticketUrl: 'ticket', expiresAt: null, idempotencyKey: 'idem-1' }; } },
  });
  assertEqual(buy.calls[0] ?? '', 'defer', '/buy defers before all work');
  assertEqual(calls.join('|'), 'products|userByDiscord|payment', '/buy network order is products then user then payment');
  assertEqual(db.sessions[0]?.state, 'awaiting_payment', '/buy persists awaiting_payment');

  const { startPurchaseSweep } = await import('../src/purchase/sweep.js');
  db.sessions.push({ id: 'expired-session', user_id: 'user-1', discord_id: 'discord-1', guild_id: 'guild-1', sku: 'SKU_ITEM', provider: 'mercadopago', provider_payment_id: 'pay_old', state: 'awaiting_payment', amount_brl_cents: 100, currency: 'BRL', idempotency_key: 'idem-old', qr_code: 'qr', qr_code_base64: 'base64', ticket_url: 'ticket', expires_at: 500, delivered_at: null, metadata_json: '{}', created_at: 0, updated_at: 0 });
  let intervalCallback: (() => void) | null = null;
  let cleared = false;
  const sweep = startPurchaseSweep(300_000, { db, now: () => 1_000, setIntervalFn: (callback: () => void) => { intervalCallback = callback; return { id: 'timer' }; }, clearIntervalFn: () => { cleared = true; } });
  assert(intervalCallback !== null, 'sweep interval registered');
  intervalCallback();
  await sweep.runOnce();
  assertEqual(db.sessions.find((session) => session.id === 'expired-session')?.state, 'expired', 'sweep expires old awaiting payment');
  sweep.stop();
  assert(cleared, 'sweep clears interval on stop');
  process.stdout.write('buy and sweep tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
