import { createBackendClient, type BackendGateway } from '../backendClient.js';
import { query } from '../db.js';
import { normalizeLocale, t } from '../i18n.js';
import { countTerminalPurchases, listTerminalPurchases } from '../repo/purchases.js';
import type { Queryable } from '../repo/types.js';
import { runDeferredCommand, type CommandInteraction } from './wrapper.js';

const TERMINAL_STATES = ['delivered', 'refunded', 'failed', 'expired'] as const;
const DEFAULT_PAGE_SIZE = 5;

type PurchasesInteraction = CommandInteraction & {
  readonly options?: { readonly getInteger?: (name: string) => number | null };
};

export type PurchasesCommandDeps = {
  readonly backendClient?: Pick<BackendGateway, 'userByDiscord'>;
  readonly db?: Queryable;
  readonly pageSize?: number;
};

export async function handlePurchasesCommand(interaction: PurchasesInteraction, deps: PurchasesCommandDeps = {}): Promise<void> {
  const backendClient = deps.backendClient ?? createBackendClient();
  const db = deps.db ?? { query };
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  await runDeferredCommand(interaction, async () => {
    const user = await backendClient.userByDiscord(interaction.user.id);
    const locale = normalizeLocale(user.locale);
    const requestedPage = interaction.options?.getInteger?.('page') ?? null;
    const page = Math.max(1, requestedPage ?? 1);
    const total = await countTerminalPurchases(db, { userId: user.userId, states: [...TERMINAL_STATES] });
    if (total === 0) {
      await interaction.editReply({ content: t('discord.purchases.empty', {}, locale) });
      return;
    }
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const clampedPage = Math.min(page, totalPages);
    const rows = await listTerminalPurchases(db, { userId: user.userId, states: [...TERMINAL_STATES], limit: pageSize, offset: (clampedPage - 1) * pageSize });
    const lines = rows.map((row) => t('discord.purchases.row', { sku: row.sku, state: row.state, price: (row.amountBrlCents / 100).toFixed(2) }, locale));
    await interaction.editReply({
      embeds: [{
        title: t('discord.purchases.title', {}, locale),
        description: `${lines.join('\n')}\n\nPage ${clampedPage} / ${totalPages}`,
      }],
    });
  });
}
