import { randomUUID } from 'node:crypto';

import { createBackendClient, type BackendGateway } from '../backendClient.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { t, type Locale } from '../i18n.js';
import { createMercadoPagoProvider } from '../payments/mercadopago.js';
import type { PaymentProvider } from '../payments/types.js';
import { loadProductCatalog, type ProductCatalog, type ProductConfig } from '../products.js';
import { log } from '../logger.js';
import { insertPurchaseSession } from '../repo/purchases.js';
import type { PurchaseSession, Queryable } from '../repo/types.js';
import { runDeferredCommand, type CommandInteraction } from './wrapper.js';

type BuyInteraction = CommandInteraction & {
  readonly guildId?: string | null;
  readonly options?: { readonly getString: (name: string) => string | null };
};

export type BuyCommandDeps = {
  readonly backendClient?: Pick<BackendGateway, 'products' | 'userByDiscord'>;
  readonly paymentProvider?: Pick<PaymentProvider, 'createPixPayment'>;
  readonly loadCatalog?: () => Promise<ProductCatalog>;
  readonly db?: Queryable;
  readonly now?: () => number;
  readonly payer?: { readonly email: string; readonly name: string; readonly lastName: string; readonly identificationType: string; readonly identificationNumber: string };
};

function price(cents: number): string {
  return (cents / 100).toFixed(2);
}

function enabledCatalogProducts(catalog: ProductCatalog): readonly ProductConfig[] {
  return catalog.products.filter((product) => product.enabled !== false);
}

function findSelectedProduct(catalog: ProductCatalog, sku: string): ProductConfig | null {
  return enabledCatalogProducts(catalog).find((product) => product.sku === sku) ?? null;
}

function renderSelectPrompt(products: readonly ProductConfig[], locale: Locale): string {
  const rows = products.map((product) => t('discord.shop.item_row', { name: product.displayName[locale], price: price(product.priceBrlCents), sku: product.sku }, locale));
  return `${t('discord.buy.select_prompt', {}, locale)}\n${rows.join('\n')}`;
}

function configuredPayer(): BuyCommandDeps['payer'] {
  if (!config.MP_PAYER_EMAIL || !config.MP_PAYER_NAME || !config.MP_PAYER_LAST_NAME || !config.MP_PAYER_ID_TYPE || !config.MP_PAYER_ID_NUMBER) return undefined;
  return { email: config.MP_PAYER_EMAIL, name: config.MP_PAYER_NAME, lastName: config.MP_PAYER_LAST_NAME, identificationType: config.MP_PAYER_ID_TYPE, identificationNumber: config.MP_PAYER_ID_NUMBER };
}

function createSession(input: { readonly userId: string; readonly discordId: string; readonly guildId: string; readonly product: ProductConfig; readonly paymentId: string; readonly idempotencyKey: string; readonly qrCode: string; readonly qrCodeBase64: string; readonly ticketUrl: string; readonly expiresAt: number; readonly now: number }): PurchaseSession {
  return { id: randomUUID(), userId: input.userId, discordId: input.discordId, guildId: input.guildId, sku: input.product.sku, provider: 'mercadopago', providerPaymentId: input.paymentId, state: 'awaiting_payment', amountBrlCents: input.product.priceBrlCents, currency: 'BRL', idempotencyKey: input.idempotencyKey, qrCode: input.qrCode, qrCodeBase64: input.qrCodeBase64, ticketUrl: input.ticketUrl, expiresAt: input.expiresAt, deliveredAt: null, metadataJson: JSON.stringify({ shopItemId: input.product.shopItemId, kind: input.product.kind }), createdAt: input.now, updatedAt: input.now };
}

export async function handleBuyCommand(interaction: BuyInteraction, deps: BuyCommandDeps = {}): Promise<void> {
  const backendClient = deps.backendClient ?? createBackendClient();
  const paymentProvider = deps.paymentProvider ?? createMercadoPagoProvider();
  const loadCatalog = deps.loadCatalog ?? loadProductCatalog;
  const db = deps.db ?? { query };
  const now = deps.now ?? Date.now;
  const payer = deps.payer ?? configuredPayer();
  await runDeferredCommand(interaction, async ({ locale }) => {
    const sku = interaction.options?.getString('sku') ?? null;
    const productsResponse = await backendClient.products();
    const catalog = await loadCatalog();
    const backendIds = new Set(productsResponse.products.map((product) => product.id));
    const availableProducts = enabledCatalogProducts(catalog).filter((product) => backendIds.has(product.shopItemId));
    if (sku === null) {
      await interaction.editReply({ content: availableProducts.length === 0 ? t('discord.shop.no_products', {}, locale) : renderSelectPrompt(availableProducts, locale) });
      return;
    }
    const product = findSelectedProduct({ products: availableProducts }, sku);
    if (payer === undefined) {
      log.error('discord.buy.payer_unconfigured', { missing: 'MP_PAYER_EMAIL/NAME/LAST_NAME/ID_TYPE/ID_NUMBER' });
      await interaction.editReply({ content: t('discord.buy.failed', {}, locale) });
      return;
    }
    if (product === null) {
      await interaction.editReply({ content: t('discord.buy.failed', {}, locale) });
      return;
    }
    const linkedUser = await backendClient.userByDiscord(interaction.user.id);
    const expiresAt = now() + (product.expiresMinutes ?? config.PIX_EXPIRATION_MINUTES) * 60_000;
    const payment = await paymentProvider.createPixPayment({ amountBrlCents: product.priceBrlCents, payer, description: `DigiWorld ${product.sku}`, notificationUrl: new URL('/webhooks/mercadopago', config.PUBLIC_URL).toString(), expiresAt: new Date(expiresAt) });
    const session = createSession({ userId: linkedUser.userId, discordId: interaction.user.id, guildId: interaction.guildId ?? 'dm', product, paymentId: payment.providerPaymentId, idempotencyKey: payment.idempotencyKey, qrCode: payment.qrCode, qrCodeBase64: payment.qrCodeBase64, ticketUrl: payment.ticketUrl, expiresAt, now: now() });
    await insertPurchaseSession(db, session);
    await interaction.editReply({ embeds: [{ title: t('discord.buy.qr_title', { sku: product.sku }, locale), description: `${payment.qrCode}\n${payment.ticketUrl}\n${t('discord.buy.qr_expires_in', { minutes: Math.ceil((expiresAt - now()) / 60_000) }, locale)}` }] });
  }, { kind: 'buy' });
}
