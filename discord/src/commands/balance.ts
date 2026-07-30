import { BackendClientError, createBackendClient, type BackendGateway, type UserByDiscordResponse } from '../backendClient.js';
import { normalizeLocale, t, type Locale } from '../i18n.js';
import { runDeferredCommand, type CommandInteraction } from './wrapper.js';

export type BalanceCommandDeps = {
  readonly backendClient?: Pick<BackendGateway, 'userByDiscord'>;
  readonly now?: () => number;
};

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function premiumLine(user: UserByDiscordResponse, now: number, locale: Locale): string {
  if (user.premiumUntil === null || user.premiumUntil <= now) return t('discord.premium.expired', {}, locale);
  const days = Math.ceil((user.premiumUntil - now) / 86_400_000);
  return `${t('discord.balance.premium_until', { premiumUntil: formatDate(user.premiumUntil) }, locale)}\n${t('discord.premium.days_left', { days }, locale)}`;
}

export async function handleBalanceCommand(interaction: CommandInteraction, deps: BalanceCommandDeps = {}): Promise<void> {
  const backendClient = deps.backendClient ?? createBackendClient();
  await runDeferredCommand(interaction, async () => {
    try {
      const user = await backendClient.userByDiscord(interaction.user.id);
      const locale = normalizeLocale(user.locale);
      await interaction.editReply({
        embeds: [{
          title: t('discord.balance.title', {}, locale),
          description: `${t('discord.balance.credits', { credits: user.credits }, locale)}\n${premiumLine(user, deps.now?.() ?? Date.now(), locale)}`,
        }],
      });
    } catch (error) {
      if (error instanceof BackendClientError && error.status === 404 && error.code === 'discord-user-not-linked') {
        await interaction.editReply({ content: t('discord.balance.no_link') });
        return;
      }
      throw error;
    }
  });
}
