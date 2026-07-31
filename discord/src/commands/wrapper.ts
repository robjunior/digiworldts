import { BackendClientError } from '../backendClient.js';
import { normalizeLocale, t, type Locale } from '../i18n.js';
import { log } from '../logger.js';
import { enforceCommandRateLimit, type RateLimitKind } from './rate-limit.js';

export type ReplyButton = { readonly type: 2; readonly style: number; readonly label: string; readonly custom_id: string };
export type ReplyActionRow = { readonly type: 1; readonly components: readonly ReplyButton[] };
export type ReplyPayload = {
  readonly ephemeral?: boolean;
  readonly content?: string;
  readonly embeds?: readonly { readonly title: string; readonly description: string }[];
  readonly components?: readonly ReplyActionRow[];
};
export type CommandInteraction = {
  readonly user: { readonly id: string };
  readonly locale?: string;
  readonly deferred?: boolean;
  readonly replied?: boolean;
  deferReply(payload: { readonly ephemeral: true }): Promise<unknown>;
  deferUpdate?(): Promise<unknown>;
  editReply(payload: ReplyPayload): Promise<unknown>;
};

export class CommandRateLimitError extends Error {
  constructor() {
    super('discord-command-rate-limited');
    this.name = 'CommandRateLimitError';
  }
}

export type CommandContext = {
  readonly locale: Locale;
  readonly userLocale: string | null;
};

export type CommandWrapperDeps = {
  readonly resolveLocale?: (interaction: CommandInteraction) => Promise<string | null>;
  readonly kind?: RateLimitKind;
};

type CommandBody = (context: CommandContext) => Promise<void>;

function errorKey(error: unknown): string {
  if (error instanceof CommandRateLimitError) return 'discord.errors.rate_limited';
  if (error instanceof BackendClientError && error.status === 404 && error.code === 'discord-user-not-linked') return 'discord.errors.not_linked';
  return 'discord.errors.internal';
}

export async function runDeferredCommand(interaction: CommandInteraction, body: CommandBody, deps: CommandWrapperDeps = {}): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const resolved = deps.resolveLocale === undefined ? null : await deps.resolveLocale(interaction);
  const userLocale = resolved ?? interaction.locale ?? null;
  const locale = normalizeLocale(userLocale);
  try {
    enforceCommandRateLimit(interaction.user.id, deps.kind ?? 'default');
    await body({ locale, userLocale });
  } catch (error) {
    log.warn('discord.command.error', { err: error instanceof Error ? error.message : 'unknown error', discordId: interaction.user.id });
    await interaction.editReply({ content: t(errorKey(error), {}, locale) });
  }
}
