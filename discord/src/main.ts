import { Client, Events, GatewayIntentBits } from 'discord.js';

import { commandHandlers } from './commands/index.js';
import { config } from './config.js';
import { close as closeDb } from './db.js';
import { log } from './logger.js';
import { startPurchaseSweep, type PurchaseSweep } from './purchase/sweep.js';
import { createServer } from './server.js';

async function run(): Promise<void> {
  const app = createServer();
  const client = config.DISCORD_TOKEN
    ? new Client({ intents: [GatewayIntentBits.Guilds] })
    : null;
  let shutdownStarted = false;
  let purchaseSweep: PurchaseSweep | null = startPurchaseSweep(config.PURCHASE_SWEEP_INTERVAL_MS);

  client?.once(Events.ClientReady, (readyClient) => {
    log.info('discord.client.ready', { user: readyClient.user.tag });
  });
  client?.on(Events.InteractionCreate, (interaction) => {
    void (async (): Promise<void> => {
      if (!interaction.isChatInputCommand()) return;
      const handler = commandHandlers[interaction.commandName];
      if (handler !== undefined) {
        await handler(interaction);
        return;
      }
      await interaction.reply({ content: 'This command is declared but not implemented in this wave.', ephemeral: true });
    })().catch((error: unknown) => {
      log.warn('discord.interaction.failed', { err: error instanceof Error ? error.message : 'unknown error' });
    });
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    log.info('process.shutdown.start', { signal });
    purchaseSweep?.stop();
    purchaseSweep = null;
    client?.destroy();
    await app.close();
    await closeDb();
    log.info('process.shutdown.done', { signal });
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  if (client) await client.login(config.DISCORD_TOKEN);
  await app.listen({ host: '0.0.0.0', port: config.PORT });
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  const stack = error instanceof Error ? error.stack : undefined;
  log.error('process.start.failed', { err: message, stack });
  process.exit(1);
});
