import { BackendClientError, createBackendClient, type BackendGateway } from '../backendClient.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { normalizeLocale, t, type Locale } from '../i18n.js';
import { markLinkLinked } from '../repo/index.js';
import type { Queryable } from '../repo/types.js';

export type ReplyPayload = { readonly ephemeral?: boolean; readonly content?: string; readonly embeds?: readonly { readonly title: string; readonly description: string }[] };
export type CommandInteraction = {
  readonly user: { readonly id: string };
  readonly locale?: string;
  readonly options?: { readonly getString: (name: string) => string | null };
  deferReply(payload: { readonly ephemeral: true }): Promise<unknown>;
  editReply(payload: ReplyPayload): Promise<unknown>;
};

export type LinkCommandDeps = {
  readonly db?: Queryable;
  readonly backendClient?: Pick<BackendGateway, 'linkComplete'>;
  readonly now?: () => number;
  readonly beforeWork?: () => void;
};

export async function handleLinkCommand(interaction: CommandInteraction, deps: LinkCommandDeps = {}): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  deps.beforeWork?.();
  const locale = normalizeLocale(interaction.locale);
  const code = interaction.options?.getString('code');
  if (code === undefined || code === null || code.trim().length === 0) {
    const url = new URL('/api/link/discord/code', config.GAME_PUBLIC_URL).toString();
    await interaction.editReply({ content: t('discord.link.code_instructions', { url }, locale) });
    return;
  }

  const db = deps.db ?? { query };
  const backendClient = deps.backendClient ?? createBackendClient();
  try {
    const response = await backendClient.linkComplete({ discordId: interaction.user.id, code });
    await markLinkLinked(db, { discordId: interaction.user.id, userId: response.userId, accessToken: null, refreshToken: null, tokenExpiresAt: null, now: deps.now?.() ?? Date.now() });
    await interaction.editReply({ content: response.alreadyLinked === true ? t('discord.link.already_linked', {}, locale) : t('discord.link.success', {}, locale) });
  } catch (error) {
    if (error instanceof BackendClientError) {
      await interaction.editReply({ content: linkErrorMessage(error, locale) });
      return;
    }
    throw error;
  }
}

function linkErrorMessage(error: BackendClientError, locale: Locale): string {
  switch (error.code) {
    case 'discord-already-linked':
      return t('discord.link.discord_already_linked', {}, locale);
    case 'game-user-already-linked':
      return t('discord.link.game_user_already_linked', {}, locale);
    case 'link-code-busy':
      return t('discord.link.code_busy', {}, locale);
    case 'link-code-expired':
      return t('discord.link.code_expired', {}, locale);
    case 'link-code-rate-limited':
      return t('discord.link.rate_limited', {}, locale);
    case 'user-not-found':
      return t('discord.link.user_not_found', {}, locale);
    default:
      return t('discord.link.failure', {}, locale);
  }
}
