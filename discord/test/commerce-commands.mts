import { assert, assertEqual } from './assert.mjs';
import { setTestEnv } from './env.mjs';

import type { UserByDiscordResponse } from '../src/backendClient.js';

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
  await handleBalanceCommand(balanceInteraction, { backendClient: { userByDiscord: async () => linkedUser() } });
  const balanceReply = balanceInteraction.calls.find((call) => call.startsWith('edit:')) ?? '';
  assert(balanceReply.includes('Credits: 42'), '/balance renders wallet credits');

  const unlinkedInteraction = interaction();
  await handleBalanceCommand(unlinkedInteraction, {
    backendClient: { userByDiscord: async () => { throw new BackendClientError(404, 'discord-user-not-linked', { error: 'discord-user-not-linked' }); } },
  });
  assert((unlinkedInteraction.calls.find((call) => call.startsWith('edit:')) ?? '').includes('Link your DigiWorld account'), '/balance 404 renders no_link');

  const { handleHelpCommand } = await import('../src/commands/help.js');
  const helpInteraction = interaction();
  await handleHelpCommand(helpInteraction);
  assert((helpInteraction.calls.find((call) => call.startsWith('edit:')) ?? '').includes('/balance'), '/help renders command overview');

  const { commandHandlers, commandManifest } = await import('../src/commands/index.js');
  assertEqual(commandManifest.length, 7, 'manifest has 7 top-level commands post-REV-1.1 (link, unlink, balance, buy, purchases, help, admin)');
  for (const name of ['link', 'unlink', 'balance', 'buy', 'purchases', 'help']) assert(typeof commandHandlers[name] === 'function', `${name} handler wired`);

  process.stdout.write('commerce command tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
