import { assert, assertEqual } from './assert.mjs';
import { setTestEnv } from './env.mjs';

setTestEnv();

type Row = Record<string, unknown>;

function fakeDb(rows: Row[]): { readonly calls: string[]; query: (text: string, params?: readonly unknown[]) => Promise<{ readonly rows: readonly Row[]; readonly rowCount: number }> } {
  const calls: string[] = [];
  return {
    calls,
    async query(text, params) {
      calls.push(text.trim().split(/\s+/, 3).join(' '));
      if (text.includes('COUNT(*)')) {
        return { rows: [{ count: rows.length }], rowCount: 1 };
      }
      const limit = Number(params?.[2] ?? 5);
      const offset = Number(params?.[3] ?? 0);
      return { rows: rows.slice(offset, offset + limit), rowCount: rows.length };
    },
  };
}

function purchaseRow(overrides: Partial<Row> = {}): Row {
  return { id: 'sess-1', sku: 'SKU_100', state: 'delivered', amount_brl_cents: 1234, created_at: 1_700_000_000_000, ...overrides };
}

type FakeInteraction = {
  readonly user: { readonly id: string };
  readonly locale?: string;
  readonly options: { readonly getInteger: (name: string) => number | null };
  readonly calls: string[];
  deferReply(payload: { readonly ephemeral: true }): Promise<void>;
  editReply(payload: unknown): Promise<void>;
};

function interaction(page: number | null = null, locale = 'en-US'): FakeInteraction {
  const calls: string[] = [];
  return {
    user: { id: 'discord-purchases-1' },
    locale,
    options: { getInteger: (name) => (name === 'page' ? page : null) },
    calls,
    async deferReply(payload) {
      assert(payload.ephemeral, 'reply is ephemeral');
      calls.push('defer');
    },
    async editReply(payload) {
      calls.push(`edit:${JSON.stringify(payload)}`);
    },
  };
}

async function main(): Promise<void> {
  const { handlePurchasesCommand } = await import('../src/commands/purchases.js');

  const emptyInteraction = interaction();
  const emptyDb = fakeDb([]);
  await handlePurchasesCommand(emptyInteraction, {
    backendClient: { userByDiscord: async () => ({ userId: 'user-1', username: 'tester', displayName: 'Tester', discordId: 'discord-purchases-1', credits: 0, premiumUntil: null, locale: 'en' }) },
    db: emptyDb,
  });
  const emptyReply = emptyInteraction.calls.find((call) => call.startsWith('edit:')) ?? '';
  assert(emptyReply.includes('No purchases found'), '/purchases empty renders EN no-purchases message');

  const populatedInteraction = interaction();
  const populatedDb = fakeDb([purchaseRow({ id: 'sess-1', sku: 'SKU_100', state: 'delivered' }), purchaseRow({ id: 'sess-2', sku: 'SKU_500', state: 'refunded', amount_brl_cents: 5000 })]);
  await handlePurchasesCommand(populatedInteraction, {
    backendClient: { userByDiscord: async () => ({ userId: 'user-1', username: 'tester', displayName: 'Tester', discordId: 'discord-purchases-1', credits: 0, premiumUntil: null, locale: 'pt-BR' }) },
    db: populatedDb,
    pageSize: 5,
  });
  const populatedReply = populatedInteraction.calls.find((call) => call.startsWith('edit:')) ?? '';
  assert(populatedReply.includes('SKU_100'), '/purchases renders SKU rows');
  assert(populatedReply.includes('SKU_500'), '/purchases renders multiple rows');
  assert(populatedReply.includes('delivered'), '/purchases includes state label');
  assert(populatedReply.includes('12.34'), '/purchases renders BRL price with cents');
  assert(populatedReply.includes('50.00'), '/purchases renders BRL price for second row');
  assert(populatedReply.includes('Page 1 / 1'), '/purchases footer shows page 1 of 1 when total <= pageSize');
  assert(populatedReply.includes('Histórico de compras'), '/purchases title honours PT locale from M2M');

  const paginatedRows: Row[] = Array.from({ length: 12 }, (_, index) => purchaseRow({ id: `sess-${index}`, sku: `SKU_${index}`, state: 'delivered' }));
  const paginatedDb = fakeDb(paginatedRows);
  const paginatedInteraction = interaction(2);
  await handlePurchasesCommand(paginatedInteraction, {
    backendClient: { userByDiscord: async () => ({ userId: 'user-1', username: 'tester', displayName: 'Tester', discordId: 'discord-purchases-1', credits: 0, premiumUntil: null, locale: 'en' }) },
    db: paginatedDb,
    pageSize: 5,
  });
  const paginatedReply = paginatedInteraction.calls.find((call) => call.startsWith('edit:')) ?? '';
  assert(paginatedReply.includes('Page 2 / 3'), '/purchases page 2 of 12 rows at pageSize 5 -> Page 2 / 3');
  assert(paginatedReply.includes('SKU_5'), '/purchases page 2 starts at offset 5');
  assert(!paginatedReply.includes('SKU_0"'), '/purchases page 2 excludes offset 0 rows');

  const clampedInteraction = interaction(99);
  const clampedDb = fakeDb([purchaseRow()]);
  await handlePurchasesCommand(clampedInteraction, {
    backendClient: { userByDiscord: async () => ({ userId: 'user-1', username: 'tester', displayName: 'Tester', discordId: 'discord-purchases-1', credits: 0, premiumUntil: null, locale: 'en' }) },
    db: clampedDb,
    pageSize: 5,
  });
  const clampedReply = clampedInteraction.calls.find((call) => call.startsWith('edit:')) ?? '';
  assert(clampedReply.includes('Page 1 / 1'), '/purchases clamps page > totalPages to last available page');

  assertEqual(emptyDb.calls.some((c) => c.includes('COUNT')), true, 'count query fired');
  assertEqual(populatedDb.calls.some((c) => c.startsWith('SELECT id,')), true, 'list query fired');

  process.stdout.write('purchases tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
