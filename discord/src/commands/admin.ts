import { randomUUID } from 'node:crypto';

import { createBackendClient, type BackendGateway } from '../backendClient.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { normalizeLocale, t, type Locale } from '../i18n.js';
import { log } from '../logger.js';
import { createMercadoPagoProvider } from '../payments/mercadopago.js';
import type { PaymentProvider } from '../payments/types.js';
import type { NotificationService } from '../notifications.js';
import { aggregatePurchaseStats, listDisabledPacks, upsertDisabledPack } from '../repo/admin.js';
import { insertAuditLog } from '../repo/audit.js';
import { getPurchaseSession, insertPurchaseEvent, updatePurchaseSessionState } from '../repo/purchases.js';
import type { Queryable } from '../repo/types.js';
import { runDeferredCommand, type CommandInteraction } from './wrapper.js';

type AdminMemberRoles = readonly string[] | { readonly cache?: { readonly has?: (id: string) => boolean } } | undefined;

type AdminInteraction = CommandInteraction & {
  readonly member?: { readonly roles?: AdminMemberRoles };
  readonly options?: {
    readonly getSubcommand?: () => string | null;
    readonly getString?: (name: string, required?: boolean) => string | null;
  };
};

export type AdminCommandDeps = {
  readonly db?: Queryable;
  readonly backendClient?: Pick<BackendGateway, 'userByDiscord'>;
  readonly paymentProvider?: Pick<PaymentProvider, 'refund'>;
  readonly notifications?: Pick<NotificationService, 'sendPurchaseNotification'>;
  readonly now?: () => number;
  readonly adminRoleIds?: readonly string[];
};

function adminRolesConfigured(deps: AdminCommandDeps): readonly string[] {
  if (deps.adminRoleIds !== undefined) return deps.adminRoleIds;
  return config.DISCORD_ADMIN_ROLE_IDS.split(',').map((id) => id.trim()).filter((id) => id.length > 0);
}

function memberHasAdminRole(member: AdminInteraction['member'], adminRoleIds: readonly string[]): boolean {
  if (adminRoleIds.length === 0) return false;
  const roles = member?.roles;
  if (roles === undefined) return false;
  const roleSet = new Set(adminRoleIds);
  if (Array.isArray(roles)) {
    for (const id of roles) if (roleSet.has(id)) return true;
    return false;
  }
  const cache = (roles as { readonly cache?: { readonly has?: (id: string) => boolean } }).cache;
  const has = cache?.has;
  if (typeof has !== 'function') return false;
  for (const id of adminRoleIds) if (has.call(cache, id)) return true;
  return false;
}

function stateToNotificationKind(state: string): 'approved' | 'failed' | 'expired' | 'refunded' | null {
  if (state === 'delivered') return 'approved';
  if (state === 'failed') return 'failed';
  if (state === 'expired') return 'expired';
  if (state === 'refunded') return 'refunded';
  return null;
}

async function resolveLocale(deps: AdminCommandDeps, discordId: string): Promise<Locale> {
  const backendClient = deps.backendClient ?? createBackendClient();
  try {
    const user = await backendClient.userByDiscord(discordId);
    return normalizeLocale(user.locale);
  } catch {
    return 'en';
  }
}

async function handleRefund(interaction: AdminInteraction, deps: AdminCommandDeps, locale: Locale): Promise<void> {
  const db = deps.db ?? { query };
  const paymentProvider = deps.paymentProvider ?? createMercadoPagoProvider();
  const now = deps.now ?? Date.now;
  const sessionId = interaction.options?.getString?.('purchase_id', true) ?? null;
  if (sessionId === null) {
    await interaction.editReply({ content: t('discord.errors.internal', {}, locale) });
    return;
  }
  const session = await getPurchaseSession(db, sessionId);
  if (session === null) {
    await interaction.editReply({ content: t('discord.admin.session_not_found', { purchaseId: sessionId }, locale) });
    return;
  }
  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(session.metadataJson) as Record<string, unknown>;
  } catch {
    await interaction.editReply({ content: t('discord.admin.refund.no_inner_payment', { purchaseId: session.id }, locale) });
    return;
  }
  const innerPaymentId = typeof metadata['innerPaymentId'] === 'string' ? metadata['innerPaymentId'] : null;
  if (innerPaymentId === null) {
    await interaction.editReply({ content: t('discord.admin.refund.no_inner_payment', { purchaseId: session.id }, locale) });
    return;
  }
  try {
    const refund = await paymentProvider.refund(innerPaymentId, session.amountBrlCents);
    const timestamp = now();
    await updatePurchaseSessionState(db, session.id, 'refunded', timestamp);
    await insertPurchaseEvent(db, { id: randomUUID(), sessionId: session.id, fromState: session.state, toState: 'refunded', providerStatus: refund.status, reason: 'admin-refund', payloadJson: JSON.stringify({ refundId: refund.refundId, innerPaymentId }), createdAt: timestamp });
    await insertAuditLog(db, { id: randomUUID(), actorDiscordId: interaction.user.id, action: 'refund', targetId: session.id, payloadJson: JSON.stringify({ refundId: refund.refundId, status: refund.status, sku: session.sku, innerPaymentId }), createdAt: timestamp });
    if (deps.notifications) {
      await deps.notifications.sendPurchaseNotification({ discordId: session.discordId, kind: 'refunded', sku: session.sku });
    }
    await interaction.editReply({ content: t('discord.admin.refund.done', { purchaseId: session.id }, locale) });
  } catch (error) {
    log.warn('discord.admin.refund.failed', { sessionId: session.id, err: error instanceof Error ? error.message : 'unknown' });
    await interaction.editReply({ content: t('discord.admin.refund.error', { error: error instanceof Error ? error.message : 'unknown' }, locale) });
  }
}

async function handleDisable(interaction: AdminInteraction, deps: AdminCommandDeps, locale: Locale): Promise<void> {
  const db = deps.db ?? { query };
  const now = deps.now ?? Date.now;
  const sku = interaction.options?.getString?.('sku', true) ?? null;
  const reason = interaction.options?.getString?.('reason', false) ?? null;
  if (sku === null) {
    await interaction.editReply({ content: t('discord.errors.internal', {}, locale) });
    return;
  }
  const timestamp = now();
  await upsertDisabledPack(db, { sku, disabledAt: timestamp, disabledBy: interaction.user.id, reason });
  await insertAuditLog(db, { id: randomUUID(), actorDiscordId: interaction.user.id, action: 'disable-sku', targetId: sku, payloadJson: JSON.stringify({ reason }), createdAt: timestamp });
  await interaction.editReply({ content: t('discord.admin.disable.done', { sku }, locale) });
}

async function handleStats(interaction: AdminInteraction, deps: AdminCommandDeps, locale: Locale): Promise<void> {
  const db = deps.db ?? { query };
  const now = deps.now ?? Date.now;
  const stats = await aggregatePurchaseStats(db);
  const disabled = await listDisabledPacks(db);
  const timestamp = now();
  await insertAuditLog(db, { id: randomUUID(), actorDiscordId: interaction.user.id, action: 'stats', targetId: null, payloadJson: JSON.stringify({}), createdAt: timestamp });
  await interaction.editReply({
    embeds: [{
      title: t('discord.admin.stats.title', {}, locale),
      description: t('discord.admin.stats.body', {
        delivered: stats.delivered,
        refunded: stats.refunded,
        failed: stats.failed,
        expired: stats.expired,
        total: (stats.deliveredBrlCents / 100).toFixed(2),
        disabled: disabled.length,
      }, locale),
    }],
  });
}

async function handleResend(interaction: AdminInteraction, deps: AdminCommandDeps, locale: Locale): Promise<void> {
  const db = deps.db ?? { query };
  const now = deps.now ?? Date.now;
  const sessionId = interaction.options?.getString?.('purchase_id', true) ?? null;
  if (sessionId === null) {
    await interaction.editReply({ content: t('discord.errors.internal', {}, locale) });
    return;
  }
  const session = await getPurchaseSession(db, sessionId);
  if (session === null) {
    await interaction.editReply({ content: t('discord.admin.session_not_found', { purchaseId: sessionId }, locale) });
    return;
  }
  const kind = stateToNotificationKind(session.state);
  if (kind === null) {
    await interaction.editReply({ content: t('discord.admin.resend.wrong_state', { state: session.state }, locale) });
    return;
  }
  if (deps.notifications) {
    await deps.notifications.sendPurchaseNotification({ discordId: session.discordId, kind, sku: session.sku });
  }
  await insertAuditLog(db, { id: randomUUID(), actorDiscordId: interaction.user.id, action: 'resend', targetId: session.id, payloadJson: JSON.stringify({ kind }), createdAt: now() });
  await interaction.editReply({ content: t('discord.admin.resend.done', { purchaseId: session.id }, locale) });
}

export async function handleAdminCommand(interaction: AdminInteraction, deps: AdminCommandDeps = {}): Promise<void> {
  await runDeferredCommand(interaction, async () => {
    const adminRoleIds = adminRolesConfigured(deps);
    const locale = await resolveLocale(deps, interaction.user.id);
    if (!memberHasAdminRole(interaction.member, adminRoleIds)) {
      await interaction.editReply({ content: t('discord.admin.not_authorized', {}, locale) });
      return;
    }
    const subcommand = interaction.options?.getSubcommand?.() ?? null;
    switch (subcommand) {
      case 'refund':
        return handleRefund(interaction, deps, locale);
      case 'disable':
        return handleDisable(interaction, deps, locale);
      case 'stats':
        return handleStats(interaction, deps, locale);
      case 'resend':
        return handleResend(interaction, deps, locale);
      default:
        await interaction.editReply({ content: t('discord.errors.internal', {}, locale) });
    }
  });
}

export function createAdminCommandHandler(deps: AdminCommandDeps = {}): (interaction: CommandInteraction) => Promise<void> {
  return (interaction) => handleAdminCommand(interaction as AdminInteraction, deps);
}
