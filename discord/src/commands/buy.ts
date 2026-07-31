import { randomUUID } from 'node:crypto';

import { createBackendClient, type BackendGateway } from '../backendClient.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { t, type Locale } from '../i18n.js';
import { createMercadoPagoProvider } from '../payments/mercadopago.js';
import type { PaymentProvider } from '../payments/types.js';
import { log } from '../logger.js';
import { isSalesPaused } from '../repo/admin.js';
import { getCreditDebt } from '../repo/debt.js';
import { insertPurchaseSession, updatePurchaseSessionPayment } from '../repo/purchases.js';
import type { PurchaseSession, Queryable } from '../repo/types.js';
import { runDeferredCommand, type CommandInteraction, type ReplyActionRow } from './wrapper.js';

const SHORTCUT_BRL_AMOUNTS = [10, 25, 50, 100] as const;
export const BUY_BUTTON_PREFIX = 'buy:amount:';
export const BUY_CONFIRM_PREFIX = 'buy:confirm:';

type BuyInteraction = CommandInteraction & {
  readonly guildId?: string | null;
  readonly options?: { readonly getNumber?: (name: string) => number | null };
};

type BuyButtonInteraction = CommandInteraction & {
  readonly guildId?: string | null;
  readonly customId: string;
};

export type BuyCommandDeps = {
  readonly backendClient?: Pick<BackendGateway, 'userByDiscord'>;
  readonly paymentProvider?: Pick<PaymentProvider, 'createPixPayment'>;
  readonly db?: Queryable;
  readonly now?: () => number;
  readonly payer?: { readonly email: string; readonly name: string; readonly lastName: string; readonly identificationType: string; readonly identificationNumber: string };
};

function brl(cents: number): string {
  return (cents / 100).toFixed(2);
}

function creditsForCents(amountBrlCents: number): number {
  return Math.round((amountBrlCents / 100) * config.CREDITS_PER_BRL);
}

function configuredPayer(): BuyCommandDeps['payer'] {
  if (!config.MP_PAYER_EMAIL || !config.MP_PAYER_NAME || !config.MP_PAYER_LAST_NAME || !config.MP_PAYER_ID_TYPE || !config.MP_PAYER_ID_NUMBER) return undefined;
  return { email: config.MP_PAYER_EMAIL, name: config.MP_PAYER_NAME, lastName: config.MP_PAYER_LAST_NAME, identificationType: config.MP_PAYER_ID_TYPE, identificationNumber: config.MP_PAYER_ID_NUMBER };
}

function shortcutRow(): ReplyActionRow {
  const withinLimits = SHORTCUT_BRL_AMOUNTS.filter((amount) => amount >= config.BUY_MIN_BRL && amount <= config.BUY_MAX_BRL);
  return {
    type: 1,
    components: withinLimits.map((amount) => ({
      type: 2 as const,
      style: 1,
      label: `R$ ${amount}`,
      custom_id: `${BUY_BUTTON_PREFIX}${amount * 100}`,
    })),
  };
}

export function parseBuyButtonCents(customId: string): number | null {
  if (!customId.startsWith(BUY_BUTTON_PREFIX)) return null;
  const raw = Number.parseInt(customId.slice(BUY_BUTTON_PREFIX.length), 10);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
}

export function parseBuyConfirmCents(customId: string): number | null {
  if (!customId.startsWith(BUY_CONFIRM_PREFIX)) return null;
  const raw = Number.parseInt(customId.slice(BUY_CONFIRM_PREFIX.length), 10);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
}

function confirmRow(amountBrlCents: number, locale: Locale): ReplyActionRow {
  return {
    type: 1,
    components: [{
      type: 2,
      style: 3,
      label: t('discord.buy.accept_button', {}, locale),
      custom_id: `${BUY_CONFIRM_PREFIX}${amountBrlCents}`,
    }],
  };
}

async function promptConsent(interaction: CommandInteraction, amountBrlCents: number, locale: Locale): Promise<void> {
  await interaction.editReply({
    embeds: [{
      title: t('discord.buy.terms_title', {}, locale),
      description: t('discord.buy.terms_body', {
        amount: brl(amountBrlCents),
        credits: creditsForCents(amountBrlCents),
      }, locale),
    }],
    components: [confirmRow(amountBrlCents, locale)],
  });
}

function createPendingSession(input: { readonly userId: string; readonly discordId: string; readonly guildId: string; readonly amountBrlCents: number; readonly creditsAmount: number; readonly expiresAt: number; readonly now: number }): PurchaseSession {
  return {
    id: randomUUID(),
    userId: input.userId,
    discordId: input.discordId,
    guildId: input.guildId,
    sku: `CREDITS_${input.amountBrlCents}`,
    provider: 'mercadopago',
    providerPaymentId: null,
    state: 'pending',
    amountBrlCents: input.amountBrlCents,
    currency: 'BRL',
    idempotencyKey: null,
    qrCode: null,
    qrCodeBase64: null,
    ticketUrl: null,
    expiresAt: input.expiresAt,
    deliveredAt: null,
    // creditsAmount is frozen here so a later CREDITS_PER_BRL change never
    // retroactively alters what an already-paid order delivers.
    metadataJson: JSON.stringify({ creditsAmount: input.creditsAmount, creditsPerBrl: config.CREDITS_PER_BRL }),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

async function createPixPurchase(interaction: CommandInteraction & { readonly guildId?: string | null }, amountBrlCents: number, locale: Locale, deps: BuyCommandDeps): Promise<void> {
  const backendClient = deps.backendClient ?? createBackendClient();
  const paymentProvider = deps.paymentProvider ?? createMercadoPagoProvider();
  const db = deps.db ?? { query };
  const now = deps.now ?? Date.now;
  const payer = deps.payer ?? configuredPayer();

  const minCents = Math.round(config.BUY_MIN_BRL * 100);
  const maxCents = Math.round(config.BUY_MAX_BRL * 100);
  if (amountBrlCents < minCents) {
    await interaction.editReply({ content: t('discord.buy.amount_too_low', { min: config.BUY_MIN_BRL.toFixed(2) }, locale) });
    return;
  }
  if (amountBrlCents > maxCents) {
    await interaction.editReply({ content: t('discord.buy.amount_too_high', { max: config.BUY_MAX_BRL.toFixed(2) }, locale) });
    return;
  }
  if (payer === undefined) {
    log.error('discord.buy.payer_unconfigured', { missing: 'MP_PAYER_EMAIL/NAME/LAST_NAME/ID_TYPE/ID_NUMBER' });
    await interaction.editReply({ content: t('discord.buy.failed', {}, locale) });
    return;
  }

  const creditsAmount = creditsForCents(amountBrlCents);
  const linkedUser = await backendClient.userByDiscord(interaction.user.id);

  const debt = await getCreditDebt(db, linkedUser.userId);
  if (debt !== null) {
    await interaction.editReply({ content: t('discord.buy.debt_blocked', { credits: debt.amount }, locale) });
    return;
  }

  const expiresAt = now() + config.PIX_EXPIRATION_MINUTES * 60_000;

  // The session is persisted BEFORE the provider call so a crash in between can never
  // leave a payable MercadoPago order with no row to map it back to. external_reference
  // carries the session id, which is also how an orphaned order is reconciled by hand.
  const session = createPendingSession({
    userId: linkedUser.userId,
    discordId: interaction.user.id,
    guildId: interaction.guildId ?? 'dm',
    amountBrlCents,
    creditsAmount,
    expiresAt,
    now: now(),
  });
  await insertPurchaseSession(db, session);

  const payment = await paymentProvider.createPixPayment({
    amountBrlCents,
    payer,
    description: `DigiWorld ${creditsAmount} Credits`,
    externalReference: session.id,
    notificationUrl: new URL('/webhooks/mercadopago', config.PUBLIC_URL).toString(),
    expiresAt: new Date(expiresAt),
  });

  await updatePurchaseSessionPayment(db, {
    id: session.id,
    providerPaymentId: payment.providerPaymentId,
    idempotencyKey: payment.idempotencyKey,
    qrCode: payment.qrCode,
    qrCodeBase64: payment.qrCodeBase64,
    ticketUrl: payment.ticketUrl,
    expiresAt,
    state: 'awaiting_payment',
    metadataJson: JSON.stringify({ creditsAmount, creditsPerBrl: config.CREDITS_PER_BRL, innerPaymentId: payment.innerPaymentId, termsAcceptedAt: now() }),
    updatedAt: now(),
  });

  await interaction.editReply({
    embeds: [{
      title: t('discord.buy.qr_title', { amount: brl(amountBrlCents), credits: creditsAmount }, locale),
      description: `${payment.qrCode}\n${payment.ticketUrl}\n${t('discord.buy.qr_expires_in', { minutes: Math.ceil((expiresAt - now()) / 60_000) }, locale)}`,
    }],
  });
}

async function guardSalesOpen(db: Queryable, interaction: CommandInteraction, locale: Locale): Promise<boolean> {
  if (!(await isSalesPaused(db))) return true;
  await interaction.editReply({ content: t('discord.buy.sales_paused', {}, locale) });
  return false;
}

async function guardNoDebt(db: Queryable, backendClient: Pick<BackendGateway, 'userByDiscord'>, interaction: CommandInteraction, locale: Locale): Promise<boolean> {
  const linkedUser = await backendClient.userByDiscord(interaction.user.id);
  const debt = await getCreditDebt(db, linkedUser.userId);
  if (debt === null) return true;
  await interaction.editReply({ content: t('discord.buy.debt_blocked', { credits: debt.amount }, locale) });
  return false;
}

function amountRejection(amountBrlCents: number): { readonly key: string; readonly params: Record<string, string> } | null {
  if (amountBrlCents < Math.round(config.BUY_MIN_BRL * 100)) {
    return { key: 'discord.buy.amount_too_low', params: { min: config.BUY_MIN_BRL.toFixed(2) } };
  }
  if (amountBrlCents > Math.round(config.BUY_MAX_BRL * 100)) {
    return { key: 'discord.buy.amount_too_high', params: { max: config.BUY_MAX_BRL.toFixed(2) } };
  }
  return null;
}

export async function handleBuyCommand(interaction: BuyInteraction, deps: BuyCommandDeps = {}): Promise<void> {
  const db = deps.db ?? { query };
  await runDeferredCommand(interaction, async ({ locale }) => {
    if (!(await guardSalesOpen(db, interaction, locale))) return;
    const valor = interaction.options?.getNumber?.('valor') ?? null;
    if (valor === null) {
      await interaction.editReply({
        embeds: [{
          title: t('discord.buy.guide_title', {}, locale),
          description: t('discord.buy.guide_body', {
            rate: config.CREDITS_PER_BRL,
            min: config.BUY_MIN_BRL.toFixed(2),
            max: config.BUY_MAX_BRL.toFixed(2),
          }, locale),
        }],
        components: [shortcutRow()],
      });
      return;
    }
    const amountBrlCents = Math.round(valor * 100);
    const rejection = amountRejection(amountBrlCents);
    if (rejection !== null) {
      await interaction.editReply({ content: t(rejection.key, rejection.params, locale) });
      return;
    }
    if (!(await guardNoDebt(db, deps.backendClient ?? createBackendClient(), interaction, locale))) return;
    await promptConsent(interaction, amountBrlCents, locale);
  }, { kind: 'buy' });
}

export async function handleBuyButton(interaction: BuyButtonInteraction, deps: BuyCommandDeps = {}): Promise<void> {
  const db = deps.db ?? { query };
  await runDeferredCommand(interaction, async ({ locale }) => {
    if (!(await guardSalesOpen(db, interaction, locale))) return;
    const cents = parseBuyButtonCents(interaction.customId);
    if (cents === null) {
      await interaction.editReply({ content: t('discord.errors.internal', {}, locale) });
      return;
    }
    const rejection = amountRejection(cents);
    if (rejection !== null) {
      await interaction.editReply({ content: t(rejection.key, rejection.params, locale) });
      return;
    }
    if (!(await guardNoDebt(db, deps.backendClient ?? createBackendClient(), interaction, locale))) return;
    await promptConsent(interaction, cents, locale);
  }, { kind: 'buy' });
}

export async function handleBuyConfirm(interaction: BuyButtonInteraction, deps: BuyCommandDeps = {}): Promise<void> {
  const db = deps.db ?? { query };
  await runDeferredCommand(interaction, async ({ locale }) => {
    if (!(await guardSalesOpen(db, interaction, locale))) return;
    const cents = parseBuyConfirmCents(interaction.customId);
    if (cents === null) {
      await interaction.editReply({ content: t('discord.errors.internal', {}, locale) });
      return;
    }
    await createPixPurchase(interaction, cents, locale, deps);
  }, { kind: 'buy' });
}
