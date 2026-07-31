import { ApplicationCommandOptionType, ApplicationCommandType, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';

import { handleBalanceCommand } from './balance.js';
import { handleBuyCommand } from './buy.js';
import { handleHelpCommand } from './help.js';
import { handleLinkCommand } from './link.js';
import { handleUnlinkCommand } from './unlink.js';
import type { CommandInteraction } from './wrapper.js';

export const commandManifest: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  {
    name: 'link',
    description: 'Link your DigiWorld account',
    type: ApplicationCommandType.ChatInput,
    options: [{ name: 'code', description: 'One-time code from DigiWorld', type: ApplicationCommandOptionType.String, required: false }],
  },
  { name: 'unlink', description: 'Unlink your DigiWorld account', type: ApplicationCommandType.ChatInput },
  { name: 'balance', description: 'Show your DigiWorld wallet balance', type: ApplicationCommandType.ChatInput },
  { name: 'buy', description: 'Buy a DigiCredit pack', type: ApplicationCommandType.ChatInput, options: [{ name: 'sku', description: 'Credit pack SKU', type: ApplicationCommandOptionType.String, required: false }] },
  { name: 'purchases', description: 'Show your purchase history', type: ApplicationCommandType.ChatInput },
  { name: 'help', description: 'Show DigiWorld Discord help', type: ApplicationCommandType.ChatInput },
  {
    name: 'admin',
    description: 'DigiWorld commerce admin tools',
    type: ApplicationCommandType.ChatInput,
    options: [
      { name: 'refund', description: 'Refund a purchase', type: ApplicationCommandOptionType.Subcommand },
      { name: 'disable', description: 'Disable a credit pack', type: ApplicationCommandOptionType.Subcommand },
      { name: 'stats', description: 'Show commerce stats', type: ApplicationCommandOptionType.Subcommand },
      { name: 'resend', description: 'Resend purchase delivery notification', type: ApplicationCommandOptionType.Subcommand },
    ],
  },
] as const;

export type CommandHandler = (interaction: CommandInteraction) => Promise<void>;

export const commandHandlers: Readonly<Record<string, CommandHandler>> = {
  link: handleLinkCommand,
  unlink: handleUnlinkCommand,
  balance: handleBalanceCommand,
  buy: handleBuyCommand,
  help: handleHelpCommand,
} as const;
