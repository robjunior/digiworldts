import { assert, assertEqual } from './assert.mjs';
import { setTestEnv } from './env.mjs';

setTestEnv();

type FakeInteraction = {
  readonly user: { readonly id: string };
  readonly locale?: string;
  readonly options: { readonly getString: (name: string) => string | null };
  readonly calls: string[];
  deferReply(payload: { readonly ephemeral: true }): Promise<void>;
  editReply(payload: unknown): Promise<void>;
};

function interaction(code: string | null = null, locale?: string): FakeInteraction {
  const calls: string[] = [];
  return {
    user: { id: 'discord-command-1' },
    ...(locale === undefined ? {} : { locale }),
    options: { getString: (name) => (name === 'code' ? code : null) },
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

function fakeDb(): { readonly saved: string[]; readonly query: (text: string, params?: readonly unknown[]) => Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number }> } {
  const saved: string[] = [];
  return {
    saved,
    async query(_text, params) {
      saved.push(JSON.stringify(params ?? []));
      return { rows: [], rowCount: 1 };
    },
  };
}

async function main(): Promise<void> {
  const { handleLinkCommand } = await import('../src/commands/link.js');
  const linkInteraction = interaction();
  let networkStartedAfterDefer = false;
  const noCodeDb = fakeDb();
  await handleLinkCommand(linkInteraction, {
    db: noCodeDb,
    beforeWork: () => {
      networkStartedAfterDefer = linkInteraction.calls[0] === 'defer';
    },
  });
  assert(networkStartedAfterDefer, '/link without code defers before work');
  const linkReply = linkInteraction.calls.find((call) => call.startsWith('edit:')) ?? '';
  assert(linkReply.includes('http://game.test/api/link/discord/code'), '/link without code replies with game code URL');
  assertEqual(noCodeDb.saved.length, 0, '/link without code performs no DB write');

  const codeInteraction = interaction('DW-0000-0000-0000-0000-0000');
  let linkCompleteAfterDefer = false;
  const db = fakeDb();
  const linkBackendClient = {
    async linkComplete(input: { readonly discordId: string; readonly code: string }) {
      linkCompleteAfterDefer = codeInteraction.calls[0] === 'defer' && input.discordId === 'discord-command-1' && input.code.startsWith('DW-');
      return { linked: true, userId: 'usr-linked-command' };
    },
  };
  await handleLinkCommand(codeInteraction, { db, backendClient: linkBackendClient, now: () => 20 });
  assert(linkCompleteAfterDefer, '/link with code defers before backend call');
  assert(db.saved.some((entry) => entry.includes('usr-linked-command')), '/link with code writes commerce row after backend success');

  const { handleUnlinkCommand } = await import('../src/commands/unlink.js');
  const unlinkInteraction = interaction();
  let unlinkNetworkAfterDefer = false;
  const backendClient = {
    async unlink(discordId: string) {
      unlinkNetworkAfterDefer = unlinkInteraction.calls[0] === 'defer' && discordId === 'discord-command-1';
      return { ok: true, unlinked: true };
    },
  };
  await handleUnlinkCommand(unlinkInteraction, { db: fakeDb(), backendClient, now: () => 20 });
  assert(unlinkNetworkAfterDefer, '/unlink defers before M2M work');

  const { commandManifest } = await import('../src/commands/index.js');
  assertEqual(commandManifest.length, 7, '7 top-level commands declared (post-REV-1.1: link, unlink, balance, buy, purchases, help, admin)');
  assert(commandManifest.some((command) => command.name === 'link' && command.options?.some((option) => option.name === 'code')), '/link declares code option');
  assert(commandManifest.some((command) => command.name === 'admin' && command.options?.length === 4), 'admin subcommands declared');

  const ptLink = interaction(null, 'pt-BR');
  await handleLinkCommand(ptLink, { db: fakeDb(), now: () => 30 });
  assert(ptLink.calls.some((call) => call.includes('Abra o DigiWorld logado')), '/link honours the Discord client locale (pt-BR)');

  const enLink = interaction(null, 'en-US');
  await handleLinkCommand(enLink, { db: fakeDb(), now: () => 30 });
  assert(enLink.calls.some((call) => call.includes('Open DigiWorld while logged in')), '/link falls back to en for non-pt clients');

  const ptUnlink = interaction(null, 'pt-BR');
  await handleUnlinkCommand(ptUnlink, { db: fakeDb(), backendClient, now: () => 40 });
  assert(ptUnlink.calls.some((call) => call.includes('desvinculada')), '/unlink is localized, not a hardcoded English string');

  process.stdout.write('command handler tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
