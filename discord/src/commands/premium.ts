import { BackendClientError, createBackendClient, type BackendGateway } from '../backendClient.js';
import { normalizeLocale, t, type Locale } from '../i18n.js';
import { runDeferredCommand, type CommandInteraction } from './wrapper.js';

export type PremiumCommandDeps = {
  readonly backendClient?: Pick<BackendGateway, 'userByDiscord'>;
  readonly now?: () => number;
};

function premiumStatus(premiumUntil: number | null, now: number, locale: Locale): string {
  if (premiumUntil === null || premiumUntil <= now) return t('discord.premium.expired', {}, locale);
  const days = Math.ceil((premiumUntil - now) / 86_400_000);
  return `${t('discord.premium.active', { premiumUntil: new Date(premiumUntil).toISOString().slice(0, 10) }, locale)}\n${t('discord.premium.days_left', { days }, locale)}`;
}

export async function handlePremiumCommand(interaction: CommandInteraction, deps: PremiumCommandDeps = {}): Promise<void> {
  const backendClient = deps.backendClient ?? createBackendClient();
  await runDeferredCommand(interaction, async () => {
    try {
      const user = await backendClient.userByDiscord(interaction.user.id);
      const locale = normalizeLocale(user.locale);
      await interaction.editReply({ content: premiumStatus(user.premiumUntil, deps.now?.() ?? Date.now(), locale) });
    } catch (error) {
      if (error instanceof BackendClientError && error.status === 404 && error.code === 'discord-user-not-linked') {
        await interaction.editReply({ content: t('discord.balance.no_link') });
        return;
      }
      throw error;
    }
  });
}
