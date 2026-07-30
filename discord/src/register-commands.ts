import { REST, Routes } from 'discord.js';

import { commandManifest } from './commands/index.js';

function readArg(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    process.stdout.write(`${JSON.stringify(commandManifest, null, 2)}\n`);
    return;
  }
  const token = process.env.DISCORD_TOKEN;
  const clientId = readArg('--client-id') ?? process.env.DISCORD_CLIENT_ID;
  const guildId = readArg('--guild-id') ?? process.env.DISCORD_GUILD_ID;
  if (!token || !clientId || !guildId) {
    process.stderr.write('Missing DISCORD_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID for guild command registration. Use --dry-run for offline validation.\n');
    process.exit(1);
  }
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandManifest });
  process.stdout.write(`Registered ${commandManifest.length} guild commands for guild ${guildId}.\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'unknown command registration failure'}\n`);
  process.exit(1);
});
