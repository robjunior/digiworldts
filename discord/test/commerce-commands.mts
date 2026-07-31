import { assert, assertEqual } from './assert.mjs';
import { setTestEnv } from './env.mjs';

import type { ProductsResponse, UserByDiscordResponse } from '../src/backendClient.js';

setTestEnv();

type FakeInteraction = {
  readonly user: { readonly id: string };
  readonly calls: string[];
  deferReply(payload: { readonly ephemeral: true }): Promise<void>;
  editReply(payload: unknown): Promise<void>;
};

function interaction(): FakeInteraction {
  const calls: string[] = [];
  return {
    user: { id: 'discord-commerce-1' },
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

function linkedUser(overrides: Partial<UserByDiscordResponse> = {}): UserByDiscordResponse {
  return {
    userId: 'usr_1',
    username: 'tester',
    displayName: 'Tester',
    discordId: 'discord-commerce-1',
    credits: 42,
    premiumUntil: 4_000,
    locale: 'en',
    ...overrides,
  };
}

async function main(): Promise<void> {
  const { BackendClientError } = await import('../src/backendClient.js');
  const { handleBalanceCommand } = await import('../src/commands/balance.js');
  const balanceInteraction = interaction();
  await handleBalanceCommand(balanceInteraction, { backendClient: { userByDiscord: async () => linkedUser() }, now: () => 1_000 });
  const balanceReply = balanceInteraction.calls.find((call) => call.startsWith('edit:')) ?? '';
  assert(balanceReply.includes('Credits: 42'), '/balance renders wallet credits');
  assert(balanceReply.includes('day(s) left'), '/balance renders premium days');

  const unlinkedInteraction = interaction();
  await handleBalanceCommand(unlinkedInteraction, {
    backendClient: { userByDiscord: async () => { throw new BackendClientError(404, 'discord-user-not-linked', { error: 'discord-user-not-linked' }); } },
  });
  assert((unlinkedInteraction.calls.find((call) => call.startsWith('edit:')) ?? '').includes('Link your DigiWorld account'), '/balance 404 renders no_link');

  const { handleShopCommand } = await import('../src/commands/shop.js');
  const emptyShop = interaction();
  await handleShopCommand(emptyShop, { backendClient: { products: async (): Promise<ProductsResponse> => ({ products: [] }) }, loadCatalog: async () => ({ products: [] }) });
  assert((emptyShop.calls.find((call) => call.startsWith('edit:')) ?? '').includes('No Discord products'), '/shop zero products renders no_products');

  const populatedShop = interaction();
  await handleShopCommand(populatedShop, {
    backendClient: { products: async (): Promise<ProductsResponse> => ({ products: [{ id: 'backend-item-1', name: 'Backend Item', description: '', priceCredits: 0, kind: 'item', class: 'product', payload: {} }] }) },
    loadCatalog: async () => ({ products: [{ sku: 'SKU_TEST_ONLY', displayName: { pt: 'Item PT', en: 'Item EN' }, priceBrlCents: 123, shopItemId: 'backend-item-1', kind: 'item', enabled: true }] }),
  });
  const shopReply = populatedShop.calls.find((call) => call.startsWith('edit:')) ?? '';
  assert(shopReply.includes('Item EN'), '/shop renders localized product name');
  assert(shopReply.includes('SKU_TEST_ONLY'), '/shop renders product SKU row');

  const pagedShop = interaction();
  await handleShopCommand(pagedShop, {
    backendClient: { products: async (): Promise<ProductsResponse> => ({ products: [{ id: 'backend-item-1', name: 'Backend Item', description: '', priceCredits: 0, kind: 'item', class: 'product', payload: {} }, { id: 'backend-item-2', name: 'Backend Item 2', description: '', priceCredits: 0, kind: 'item', class: 'product', payload: {} }] }) },
    loadCatalog: async () => ({ products: [{ sku: 'SKU_PAGE_1', displayName: { pt: 'Item PT', en: 'Item EN' }, priceBrlCents: 123, shopItemId: 'backend-item-1', kind: 'item', enabled: true }, { sku: 'SKU_PAGE_2', displayName: { pt: 'Item PT 2', en: 'Item EN 2' }, priceBrlCents: 456, shopItemId: 'backend-item-2', kind: 'item', enabled: true }] }),
    pageSize: 1,
  });
  assert((pagedShop.calls.find((call) => call.startsWith('edit:')) ?? '').includes('previous | next'), '/shop renders pagination controls for multipage product list');

  const { handlePremiumCommand } = await import('../src/commands/premium.js');
  const premiumInteraction = interaction();
  await handlePremiumCommand(premiumInteraction, { backendClient: { userByDiscord: async () => linkedUser({ premiumUntil: 173_800_000 }) }, now: () => 1_000 });
  assert((premiumInteraction.calls.find((call) => call.startsWith('edit:')) ?? '').includes('Premium is active'), '/premium renders active premium status');

  const { handleHelpCommand } = await import('../src/commands/help.js');
  const helpInteraction = interaction();
  await handleHelpCommand(helpInteraction);
  assert((helpInteraction.calls.find((call) => call.startsWith('edit:')) ?? '').includes('/balance'), '/help renders command overview');

  const { commandHandlers, commandManifest } = await import('../src/commands/index.js');
  assertEqual(commandManifest.length, 11, 'manifest still has 11 top-level commands');
  for (const name of ['balance', 'premium', 'shop', 'help']) assert(typeof commandHandlers[name] === 'function', `${name} handler wired`);

  process.stdout.write('commerce command tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
