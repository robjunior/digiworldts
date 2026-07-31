import { assert, assertEqual } from './assert.mjs';
import { setTestEnv } from './env.mjs';

setTestEnv();

type Row = Record<string, unknown>;

class MemoryDb {
  readonly sessions = new Map<string, Row>();
  readonly events: Row[] = [];
  readonly audits: Row[] = [];
  salesPause: Row | null = null;

  async query<T extends Row>(text: string, params: readonly unknown[] = []): Promise<{ readonly rows: readonly T[]; readonly rowCount: number }> {
    if (text.includes('SELECT * FROM purchase_sessions WHERE id')) {
      const session = this.sessions.get(String(params[0]));
      return { rows: session ? [session as T] : [], rowCount: session ? 1 : 0 };
    }
    if (text.includes('UPDATE purchase_sessions SET state = $2, updated_at = $3 WHERE id')) {
      const session = this.sessions.get(String(params[0]));
      if (session !== undefined) { session.state = params[1]; session.updated_at = params[2]; }
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('INSERT INTO purchase_events')) {
      this.events.push({ id: params[0], session_id: params[1], from_state: params[2], to_state: params[3], provider_status: params[4], reason: params[5] });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('INSERT INTO audit_log')) {
      this.audits.push({ id: params[0], actor_discord_id: params[1], action: params[2], target_id: params[3], payload_json: params[4], created_at: params[5] });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('INSERT INTO sales_pause')) {
      this.salesPause = { paused: params[0], paused_at: params[1], paused_by: params[2], reason: params[3] };
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('FROM sales_pause')) {
      return { rows: (this.salesPause ? [this.salesPause] : []) as readonly T[], rowCount: this.salesPause ? 1 : 0 };
    }
    if (text.includes('COUNT(*) FILTER')) {
      const sessions = Array.from(this.sessions.values());
      const delivered = sessions.filter((s) => s.state === 'delivered');
      return {
        rows: [{
          delivered: delivered.length,
          refunded: sessions.filter((s) => s.state === 'refunded').length,
          failed: sessions.filter((s) => s.state === 'failed').length,
          expired: sessions.filter((s) => s.state === 'expired').length,
          delivered_brl_cents: delivered.reduce((sum, s) => sum + Number(s.amount_brl_cents ?? 0), 0),
        }] as unknown as readonly T[],
        rowCount: 1,
      };
    }
    throw new Error(`unexpected sql:${text}`);
  }
}

function baseSession(overrides: Partial<Row> = {}): Row {
  return { id: 'sess-1', user_id: 'user-1', discord_id: 'discord-1', guild_id: 'guild-1', sku: 'CREDITS_1000', provider: 'mercadopago', provider_payment_id: 'ORD_ORDER_1', state: 'delivered', amount_brl_cents: 1000, currency: 'BRL', idempotency_key: 'idem', qr_code: 'qr', qr_code_base64: 'base64', ticket_url: 'ticket', expires_at: 2_000, delivered_at: 3_000, metadata_json: JSON.stringify({ innerPaymentId: 'pay_inner_1', creditsAmount: 1000, creditsPerBrl: 100 }), created_at: 1_000, updated_at: 3_000, ...overrides };
}

type FakeInteraction = {
  readonly user: { readonly id: string };
  readonly member?: { readonly roles?: readonly string[] };
  readonly options: {
    readonly getSubcommand: () => string;
    readonly getString: (name: string, required?: boolean) => string | null;
    readonly getBoolean: (name: string, required?: boolean) => boolean | null;
  };
  readonly calls: string[];
  deferReply(payload: { readonly ephemeral: true }): Promise<void>;
  editReply(payload: unknown): Promise<void>;
};

function interaction(subcommand: string, options: Record<string, string | boolean | undefined>, member: { readonly roles?: readonly string[] } = { roles: ['admin-role'] }): FakeInteraction {
  const calls: string[] = [];
  return {
    user: { id: 'admin-1' },
    member,
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => { const value = options[name]; return typeof value === 'string' ? value : null; },
      getBoolean: (name) => { const value = options[name]; return typeof value === 'boolean' ? value : null; },
    },
    calls,
    async deferReply(payload) { assert(payload.ephemeral, 'ephemeral'); calls.push('defer'); },
    async editReply(payload) { calls.push(`edit:${JSON.stringify(payload)}`); },
  };
}

const backendMock = { userByDiscord: async () => ({ userId: 'user-1', username: 'tester', displayName: 'Tester', discordId: 'admin-1', credits: 0, premiumUntil: null, locale: 'en' }) };

async function main(): Promise<void> {
  const { handleAdminCommand } = await import('../src/commands/admin.js');
  const adminRoleIds = ['admin-role'];
  const paymentProvider = {
    async refund(paymentId: string, amount?: number) {
      return { provider: 'mercadopago' as const, refundId: `refund-${paymentId}`, paymentId, amount: amount ?? null, status: 'approved' };
    },
  };

  const nonAdmin = interaction('stats', {}, { roles: ['other-role'] });
  await handleAdminCommand(nonAdmin, { adminRoleIds, db: new MemoryDb(), backendClient: backendMock });
  const nonAdminReply = nonAdmin.calls.find((c) => c.startsWith('edit:')) ?? '';
  assert(nonAdminReply.includes('admin role'), 'non-admin blocked with not_authorized');

  const noRoles = interaction('stats', {}, {});
  await handleAdminCommand(noRoles, { adminRoleIds: [], db: new MemoryDb(), backendClient: backendMock });
  const noRolesReply = noRoles.calls.find((c) => c.startsWith('edit:')) ?? '';
  assert(noRolesReply.includes('admin role'), 'empty admin role list blocks everyone');

  const refundDb = new MemoryDb();
  refundDb.sessions.set('sess-1', baseSession());
  const refundNotifications: { readonly discordId: string; readonly kind: string; readonly sku?: string }[] = [];
  const refundInt = interaction('refund', { purchase_id: 'sess-1' });
  await handleAdminCommand(refundInt, {
    adminRoleIds,
    db: refundDb,
    backendClient: backendMock,
    paymentProvider,
    notifications: { sendPurchaseNotification: async (input) => { refundNotifications.push(input); } },
    now: () => 5_000,
  });
  const refundReply = refundInt.calls.find((c) => c.startsWith('edit:')) ?? '';
  assert(refundReply.includes('Refund completed'), 'refund success message');
  assertEqual(refundDb.sessions.get('sess-1')?.state, 'refunded', 'session marked refunded');
  assertEqual(refundDb.events.length, 1, 'refund event recorded');
  assertEqual(refundDb.audits.length, 1, 'refund audit recorded');
  assertEqual(refundDb.audits[0]?.action, 'refund', 'refund audit action');
  assertEqual(refundNotifications.length, 1, 'refund notification fired');
  assertEqual(refundNotifications[0]?.kind, 'refunded', 'refund notification kind');

  const dbNoInner = new MemoryDb();
  dbNoInner.sessions.set('sess-2', baseSession({ id: 'sess-2', metadata_json: JSON.stringify({ kind: 'credits' }) }));
  const noInnerInt = interaction('refund', { purchase_id: 'sess-2' });
  await handleAdminCommand(noInnerInt, { adminRoleIds, db: dbNoInner, backendClient: backendMock, paymentProvider });
  const noInnerReply = noInnerInt.calls.find((c) => c.startsWith('edit:')) ?? '';
  assert(noInnerReply.includes('no refundable payment id'), 'no innerPaymentId blocked');
  assertEqual(dbNoInner.sessions.get('sess-2')?.state, 'delivered', 'session unchanged when innerPaymentId missing');

  const notFoundInt = interaction('refund', { purchase_id: 'missing-1' });
  await handleAdminCommand(notFoundInt, { adminRoleIds, db: new MemoryDb(), backendClient: backendMock, paymentProvider });
  const notFoundReply = notFoundInt.calls.find((c) => c.startsWith('edit:')) ?? '';
  assert(notFoundReply.includes('not found'), 'missing session -> not_found');

  const pauseDb = new MemoryDb();
  const pauseInt = interaction('sales', { paused: true, reason: 'manutencao' });
  await handleAdminCommand(pauseInt, { adminRoleIds, db: pauseDb, backendClient: backendMock, now: () => 6_000 });
  const pauseReply = pauseInt.calls.find((c) => c.startsWith('edit:')) ?? '';
  assert(pauseReply.includes('PAUSED'), 'sales paused:true confirms pause');
  assertEqual(pauseDb.salesPause?.paused, true, 'sales_pause row written with paused=true');
  assertEqual(pauseDb.salesPause?.paused_by, 'admin-1', 'pause records the acting admin');
  assertEqual(pauseDb.audits.length, 1, 'pause audit recorded');
  assertEqual(pauseDb.audits[0]?.action, 'sales-pause', 'pause audit action');

  const resumeDb = new MemoryDb();
  resumeDb.salesPause = { paused: true, paused_at: 1, paused_by: 'admin-0', reason: null };
  const resumeInt = interaction('sales', { paused: false });
  await handleAdminCommand(resumeInt, { adminRoleIds, db: resumeDb, backendClient: backendMock, now: () => 6_500 });
  const resumeReply = resumeInt.calls.find((c) => c.startsWith('edit:')) ?? '';
  assert(resumeReply.includes('OPEN'), 'sales paused:false confirms resume');
  assertEqual(resumeDb.salesPause?.paused, false, 'sales_pause row written with paused=false');
  assertEqual(resumeDb.salesPause?.paused_by, null, 'resume clears the acting admin');
  assertEqual(resumeDb.audits[0]?.action, 'sales-resume', 'resume audit action');

  const statsDb = new MemoryDb();
  statsDb.sessions.set('s1', baseSession({ id: 's1', state: 'delivered', amount_brl_cents: 1000 }));
  statsDb.sessions.set('s2', baseSession({ id: 's2', state: 'delivered', amount_brl_cents: 2000 }));
  statsDb.sessions.set('s3', baseSession({ id: 's3', state: 'refunded', amount_brl_cents: 500 }));
  const statsInt = interaction('stats', {});
  await handleAdminCommand(statsInt, { adminRoleIds, db: statsDb, backendClient: backendMock, now: () => 7_000 });
  const statsReply = statsInt.calls.find((c) => c.startsWith('edit:')) ?? '';
  assert(statsReply.includes('Delivered: 2'), 'stats shows delivered count');
  assert(statsReply.includes('Refunded: 1'), 'stats shows refunded count');
  assert(statsReply.includes('30.00'), 'stats shows delivered BRL total (1000+2000 = 3000 cents = 30.00 BRL)');
  assert(statsReply.includes('Sales: open'), 'stats reports sales open when no pause row exists');
  assertEqual(statsDb.audits.length, 1, 'stats audit recorded');
  assertEqual(statsDb.audits[0]?.action, 'stats', 'stats audit action');

  const statsPausedDb = new MemoryDb();
  statsPausedDb.salesPause = { paused: true, paused_at: 1, paused_by: 'admin-1', reason: null };
  const statsPausedInt = interaction('stats', {});
  await handleAdminCommand(statsPausedInt, { adminRoleIds, db: statsPausedDb, backendClient: backendMock, now: () => 7_100 });
  assert((statsPausedInt.calls.find((c) => c.startsWith('edit:')) ?? '').includes('Sales: PAUSED'), 'stats reports sales paused when the pause row is set');

  const resendNotifications: { readonly discordId: string; readonly kind: string; readonly sku?: string }[] = [];
  const resendDb = new MemoryDb();
  resendDb.sessions.set('sess-r', baseSession({ id: 'sess-r', state: 'delivered' }));
  const resendInt = interaction('resend', { purchase_id: 'sess-r' });
  await handleAdminCommand(resendInt, {
    adminRoleIds,
    db: resendDb,
    backendClient: backendMock,
    notifications: { sendPurchaseNotification: async (input) => { resendNotifications.push(input); } },
    now: () => 8_000,
  });
  const resendReply = resendInt.calls.find((c) => c.startsWith('edit:')) ?? '';
  assert(resendReply.includes('resent'), 'resend success message');
  assertEqual(resendNotifications.length, 1, 'resend notification fired');
  assertEqual(resendNotifications[0]?.kind, 'approved', 'delivered state -> approved kind');
  assertEqual(resendDb.audits.length, 1, 'resend audit recorded');

  const wrongStateDb = new MemoryDb();
  wrongStateDb.sessions.set('sess-w', baseSession({ id: 'sess-w', state: 'awaiting_payment' }));
  const wrongInt = interaction('resend', { purchase_id: 'sess-w' });
  await handleAdminCommand(wrongInt, { adminRoleIds, db: wrongStateDb, backendClient: backendMock });
  const wrongReply = wrongInt.calls.find((c) => c.startsWith('edit:')) ?? '';
  assert(wrongReply.includes('awaiting_payment'), 'wrong state message mentions state');

  process.stdout.write('admin tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
