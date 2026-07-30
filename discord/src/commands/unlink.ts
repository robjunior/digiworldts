import type { BackendGateway } from '../backendClient.js';
import { createBackendClient } from '../backendClient.js';
import { normalizeLocale, t } from '../i18n.js';
import { markLinkUnlinked } from '../repo/index.js';
import { query } from '../db.js';
import type { CommandInteraction } from './link.js';
import type { Queryable } from '../repo/types.js';

export type UnlinkCommandDeps = {
  readonly db?: Queryable;
  readonly backendClient?: Pick<BackendGateway, 'unlink'>;
  readonly now?: () => number;
  readonly beforeWork?: () => void;
};

export async function handleUnlinkCommand(interaction: CommandInteraction, deps: UnlinkCommandDeps = {}): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  deps.beforeWork?.();
  const locale = normalizeLocale(interaction.locale);
  const backendClient = deps.backendClient ?? createBackendClient();
  await backendClient.unlink(interaction.user.id);
  await markLinkUnlinked(deps.db ?? { query }, interaction.user.id, deps.now?.() ?? Date.now());
  await interaction.editReply({ content: t('discord.unlink.done', {}, locale) });
}
