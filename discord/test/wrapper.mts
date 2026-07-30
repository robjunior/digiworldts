import { assert } from './assert.mjs';
import { setTestEnv } from './env.mjs';

setTestEnv();

async function main(): Promise<void> {
  const { CommandRateLimitError, runDeferredCommand } = await import('../src/commands/wrapper.js');
  const calls: string[] = [];
  const interaction = {
    user: { id: 'discord-wrapper-1' },
    async deferReply(payload: { readonly ephemeral: true }): Promise<void> {
      assert(payload.ephemeral, 'wrapper defer is ephemeral');
      calls.push('defer');
    },
    async editReply(payload: unknown): Promise<void> {
      calls.push(`edit:${JSON.stringify(payload)}`);
    },
  };

  await runDeferredCommand(interaction, async () => {
    calls.push(calls[0] === 'defer' ? 'body-after-defer' : 'body-before-defer');
  });
  assert(calls.join('|').startsWith('defer|body-after-defer'), 'deferReply happens before command body');

  const failedCalls: string[] = [];
  const failedInteraction = {
    user: { id: 'discord-wrapper-2' },
    async deferReply(payload: { readonly ephemeral: true }): Promise<void> {
      assert(payload.ephemeral, 'wrapper failure defer is ephemeral');
      failedCalls.push('defer');
    },
    async editReply(payload: unknown): Promise<void> {
      failedCalls.push(`edit:${JSON.stringify(payload)}`);
    },
  };
  await runDeferredCommand(failedInteraction, async () => {
    throw new Error('boom');
  });
  assert((failedCalls.find((call) => call.startsWith('edit:')) ?? '').includes('Something went wrong'), 'thrown error becomes localized internal reply');

  const rateLimitCalls: string[] = [];
  await runDeferredCommand({
    user: { id: 'discord-wrapper-3' },
    async deferReply(payload: { readonly ephemeral: true }): Promise<void> {
      assert(payload.ephemeral, 'wrapper rate limit defer is ephemeral');
      rateLimitCalls.push('defer');
    },
    async editReply(payload: unknown): Promise<void> {
      rateLimitCalls.push(`edit:${JSON.stringify(payload)}`);
    },
  }, async () => {
    throw new CommandRateLimitError();
  });
  assert((rateLimitCalls.find((call) => call.startsWith('edit:')) ?? '').includes('too quickly'), 'rate-limit error renders localized rate-limit reply');

  process.stdout.write('wrapper tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
