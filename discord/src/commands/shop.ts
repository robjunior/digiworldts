import { createBackendClient, type BackendGateway } from '../backendClient.js';
import { t, type Locale } from '../i18n.js';
import { loadProductCatalog, type ProductCatalog } from '../products.js';
import { runDeferredCommand, type CommandInteraction } from './wrapper.js';

export type ShopCommandDeps = {
  readonly backendClient?: Pick<BackendGateway, 'products'>;
  readonly loadCatalog?: () => Promise<ProductCatalog>;
  readonly pageSize?: number;
};

type BackendProduct = Awaited<ReturnType<BackendGateway['products']>>['products'][number];

function price(cents: number): string {
  return (cents / 100).toFixed(2);
}

function productRows(backendProducts: readonly BackendProduct[], catalog: ProductCatalog, locale: Locale, pageSize: number): readonly string[] {
  const backendIds = new Set(backendProducts.map((product) => product.id));
  return catalog.products
    .filter((product) => product.enabled !== false && backendIds.has(product.shopItemId))
    .slice(0, pageSize)
    .map((product) => t('discord.shop.item_row', { name: product.displayName[locale], price: price(product.priceBrlCents), sku: product.sku }, locale));
}

export async function handleShopCommand(interaction: CommandInteraction, deps: ShopCommandDeps = {}): Promise<void> {
  const backendClient = deps.backendClient ?? createBackendClient();
  const loadCatalog = deps.loadCatalog ?? loadProductCatalog;
  const pageSize = deps.pageSize ?? 10;
  await runDeferredCommand(interaction, async ({ locale }) => {
    const backendProducts = await backendClient.products();
    if (backendProducts.products.length === 0) {
      await interaction.editReply({ content: t('discord.shop.no_products', {}, locale) });
      return;
    }
    const catalog = await loadCatalog();
    const rows = productRows(backendProducts.products, catalog, locale, pageSize);
    if (rows.length === 0) {
      await interaction.editReply({ content: t('discord.shop.no_products', {}, locale) });
      return;
    }
    const totalEnabled = catalog.products.filter((product) => product.enabled !== false).length;
    const pagination = totalEnabled > pageSize ? `\n\n${t('discord.shop.page_controls', { page: 1 }, locale)}` : '';
    await interaction.editReply({ embeds: [{ title: t('discord.shop.title', {}, locale), description: `${rows.join('\n')}${pagination}` }] });
  });
}
