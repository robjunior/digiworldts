import { t } from '../i18n.js';
import { runDeferredCommand, type CommandInteraction } from './wrapper.js';

export async function handleHelpCommand(interaction: CommandInteraction): Promise<void> {
  await runDeferredCommand(interaction, async ({ locale }) => {
    await interaction.editReply({ content: t('discord.help.overview', {}, locale) });
  });
}
