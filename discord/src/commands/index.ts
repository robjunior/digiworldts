import { ApplicationCommandOptionType, ApplicationCommandType, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';

import { createAdminCommandHandler } from './admin.js';
import { handleBalanceCommand } from './balance.js';
import { handleBuyCommand } from './buy.js';
import { handleHelpCommand } from './help.js';
import { handleLinkCommand } from './link.js';
import { handlePurchasesCommand } from './purchases.js';
import { handleUnlinkCommand } from './unlink.js';
import { config } from '../config.js';
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
  {
    name: 'buy',
    description: `Buy DigiCredits with PIX (${config.CREDITS_PER_BRL} credits per BRL 1.00)`,
    type: ApplicationCommandType.ChatInput,
    options: [{
      name: 'valor',
      description: `Amount in BRL (min ${config.BUY_MIN_BRL}, max ${config.BUY_MAX_BRL}). Omit to see the guide.`,
      type: ApplicationCommandOptionType.Number,
      required: false,
      min_value: config.BUY_MIN_BRL,
      max_value: config.BUY_MAX_BRL,
    }],
  },
  {
    name: 'purchases',
    description: 'Show your purchase history',
    type: ApplicationCommandType.ChatInput,
    options: [{ name: 'page', description: 'Page number (1-based)', type: ApplicationCommandOptionType.Integer, required: false, min_value: 1 }],
  },
  { name: 'help', description: 'Show DigiWorld Discord help', type: ApplicationCommandType.ChatInput },
  {
    name: 'admin',
    description: 'DigiWorld commerce admin tools',
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        name: 'refund',
        description: 'Refund a purchase',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'purchase_id', description: 'Purchase session id to refund', type: ApplicationCommandOptionType.String, required: true }],
      },
      {
        name: 'sales',
        description: 'Pause or resume all credit sales',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'paused', description: 'True pauses sales, false resumes them', type: ApplicationCommandOptionType.Boolean, required: true },
          { name: 'reason', description: 'Optional reason', type: ApplicationCommandOptionType.String, required: false },
        ],
      },
      { name: 'stats', description: 'Show commerce stats', type: ApplicationCommandOptionType.Subcommand },
      {
        name: 'resend',
        description: 'Resend purchase delivery notification',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'purchase_id', description: 'Purchase session id whose notification to resend', type: ApplicationCommandOptionType.String, required: true }],
      },
    ],
  },
] as const;

export type CommandHandler = (interaction: CommandInteraction) => Promise<void>;

export const commandHandlers: Readonly<Record<string, CommandHandler>> = {
  link: handleLinkCommand,
  unlink: handleUnlinkCommand,
  balance: handleBalanceCommand,
  buy: handleBuyCommand,
  purchases: handlePurchasesCommand,
  help: handleHelpCommand,
} as const;

export { createAdminCommandHandler };
