import { BackendClientError, createBackendClient, type BackendGateway } from '../backendClient.js';
import { normalizeLocale, t } from '../i18n.js';
import { runDeferredCommand, type CommandInteraction } from './wrapper.js';

export type BalanceCommandDeps = {
  readonly backendClient?: Pick<BackendGateway, 'userByDiscord'>;
};

export async function handleBalanceCommand(interaction: CommandInteraction, deps: BalanceCommandDeps = {}): Promise<void> {
  const backendClient = deps.backendClient ?? createBackendClient();
  await runDeferredCommand(interaction, async () => {
    try {
      const user = await backendClient.userByDiscord(interaction.user.id);
      const locale = normalizeLocale(user.locale);
      await interaction.editReply({
        embeds: [{
          title: t('discord.balance.title', {}, locale),
          description: t('discord.balance.credits', { credits: user.credits }, locale),
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
