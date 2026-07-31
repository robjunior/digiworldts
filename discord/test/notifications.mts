import { assert, assertEqual } from './assert.mjs';
import { setTestEnv } from './env.mjs';

setTestEnv();

type SentDM = { readonly discordId: string; readonly content: string };

async function main(): Promise<void> {
  const { createNotificationService } = await import('../src/notifications.js');

  const enSent: SentDM[] = [];
  const enService = createNotificationService({} as never, {
    discordSender: async (discordId, content) => { enSent.push({ discordId, content }); },
    localeResolver: async () => 'en',
  });
  await enService.sendPurchaseNotification({ discordId: 'user-1', kind: 'approved', sku: 'SKU_100' });
  assertEqual(enSent[0]?.discordId, 'user-1', 'approved DM sent to correct user');
  assert(enSent[0]?.content.includes('Payment confirmed'), 'approved kind renders EN confirmed string');

  const ptSent: SentDM[] = [];
  const ptService = createNotificationService({} as never, {
    discordSender: async (discordId, content) => { ptSent.push({ discordId, content }); },
    localeResolver: async () => 'pt',
  });
  await ptService.sendPurchaseNotification({ discordId: 'user-2', kind: 'approved' });
  assert(ptSent[0]?.content.includes('Pagamento confirmado'), 'approved kind renders PT confirmado string');

  const kindsSent: SentDM[] = [];
  const kindsService = createNotificationService({} as never, {
    discordSender: async (discordId, content) => { kindsSent.push({ discordId, content }); },
    localeResolver: async () => 'en',
  });
  await kindsService.sendPurchaseNotification({ discordId: 'user-k', kind: 'failed' });
  await kindsService.sendPurchaseNotification({ discordId: 'user-k', kind: 'expired' });
  await kindsService.sendPurchaseNotification({ discordId: 'user-k', kind: 'refunded' });
  assertEqual(kindsSent.length, 3, 'all 3 non-approved kinds send a DM');
  assert(kindsSent[0]?.content.includes('Payment failed'), 'failed kind maps to discord.buy.failed');
  assert(kindsSent[1]?.content.includes('expired'), 'expired kind maps to discord.buy.expired');
  assert(kindsSent[2]?.content.includes('refunded'), 'refunded kind maps to discord.buy.refunded');

  const failedSent: string[] = [];
  const failingService = createNotificationService({} as never, {
    discordSender: async () => { failedSent.push('attempted'); throw new Error('DM closed'); },
    localeResolver: async () => 'en',
  });
  await failingService.sendPurchaseNotification({ discordId: 'user-3', kind: 'approved' });
  assertEqual(failedSent.length, 1, 'DM send was attempted');

  const fallbackSent: SentDM[] = [];
  const fallbackService = createNotificationService({} as never, {
    discordSender: async (discordId, content) => { fallbackSent.push({ discordId, content }); },
    localeResolver: async () => { throw new Error('backend down'); },
  });
  await fallbackService.sendPurchaseNotification({ discordId: 'user-4', kind: 'approved' });
  assertEqual(fallbackSent.length, 1, 'DM still sent when locale resolver throws');
  assert(fallbackSent[0]?.content.includes('Payment confirmed'), 'falls back to EN when locale resolver throws');

  process.stdout.write('notifications tests passed\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
