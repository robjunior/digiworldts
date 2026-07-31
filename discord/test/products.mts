import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { assert, assertEqual } from './assert.mjs';

type JsonObject = Readonly<Record<string, unknown>>;

function objectValue(value: unknown, message: string): JsonObject {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value), message);
  return value;
}

function schemaAccepts(value: unknown): boolean {
  const parsed = objectValue(value, 'catalog is object');
  const products = parsed['products'];
  if (!Array.isArray(products)) return false;
  return products.every((entry) => {
    const product = objectValue(entry, 'product is object');
    if (typeof product['sku'] !== 'string') return false;
    if (typeof product['shopItemId'] !== 'string') return false;
    if (product['kind'] !== 'credits') return false;
    if (!Number.isInteger(product['creditsAmount']) || Number(product['creditsAmount']) < 1) return false;
    if (!localizedTextAccepts(product['displayName'])) return false;
    if (product['description'] !== undefined && !localizedTextAccepts(product['description'])) return false;
    if (!Number.isInteger(product['priceBrlCents']) || Number(product['priceBrlCents']) < 0) return false;
    if (product['currency'] !== undefined && product['currency'] !== 'BRL') return false;
    return true;
  });
}

function localizedTextAccepts(value: unknown): boolean {
  const text = objectValue(value, 'localized text is object');
  return typeof text['pt'] === 'string' && text['pt'].length > 0 && typeof text['en'] === 'string' && text['en'].length > 0;
}

async function main(): Promise<void> {
  const rawExample = await readFile('config/products.example.json', 'utf8');
  const example = JSON.parse(rawExample) as unknown;
  const schema = JSON.parse(await readFile('config/products.schema.json', 'utf8')) as JsonObject;
  const { parseProductCatalog } = await import('../src/products.js');

  assertEqual(schema['$schema'], 'http://json-schema.org/draft-07/schema#', 'schema is draft-07');
  assert(schemaAccepts(example), 'schema accepts credits-only example catalog');
  parseProductCatalog(example);

  assert(!schemaAccepts({ products: [{ sku: 'x', displayName: { pt: 'pt', en: 'en' }, priceBrlCents: 0, kind: 'credits', creditsAmount: 100 }] }), 'schema rejects missing shopItemId');
  assertRejects(() => parseProductCatalog({ products: [{ sku: 'x', displayName: { pt: 'pt', en: 'en' }, priceBrlCents: 0, kind: 'credits', creditsAmount: 100 }] }), 'loader rejects missing shopItemId');
  assert(!schemaAccepts({ products: [{ sku: 'x', displayName: { pt: 'pt', en: 'en' }, priceBrlCents: 0, currency: 'USD', shopItemId: 'item-x', kind: 'credits', creditsAmount: 100 }] }), 'schema rejects non-BRL currency');
  assertRejects(() => parseProductCatalog({ products: [{ sku: 'x', displayName: { pt: 'pt', en: 'en' }, priceBrlCents: 0, currency: 'USD', shopItemId: 'item-x', kind: 'credits', creditsAmount: 100 }] }), 'loader rejects non-BRL currency');
  assert(!schemaAccepts({ products: [{ sku: 'x', displayName: { pt: 'pt', en: 'en' }, priceBrlCents: 0, shopItemId: 'item-x', kind: 'credits' }] }), 'schema rejects credits without creditsAmount');
  assertRejects(() => parseProductCatalog({ products: [{ sku: 'x', displayName: { pt: 'pt', en: 'en' }, priceBrlCents: 0, shopItemId: 'item-x', kind: 'credits' }] }), 'loader rejects credits without creditsAmount');
  assert(!schemaAccepts({ products: [{ sku: 'x', displayName: { pt: 'pt', en: 'en' }, priceBrlCents: 0, shopItemId: 'item-x', kind: 'item' }] }), 'schema rejects dropped kind=item (REV-1.1)');
  assertRejects(() => parseProductCatalog({ products: [{ sku: 'x', displayName: { pt: 'pt', en: 'en' }, priceBrlCents: 0, shopItemId: 'item-x', kind: 'item' }] }), 'loader rejects dropped kind=item (REV-1.1)');
  assert(!schemaAccepts({ products: [{ sku: 'x', displayName: { pt: 'pt', en: 'en' }, priceBrlCents: 0, shopItemId: 'item-x', kind: 'premium', premiumDays: 30 }] }), 'schema rejects dropped kind=premium (REV-1.1)');
  assertRejects(() => parseProductCatalog({ products: [{ sku: 'x', displayName: { pt: 'pt', en: 'en' }, priceBrlCents: 0, shopItemId: 'item-x', kind: 'premium', premiumDays: 30 }] }), 'loader rejects dropped kind=premium (REV-1.1)');

  await loaderCases();
  process.stdout.write('product schema tests passed\n');
}

async function loaderCases(): Promise<void> {
  const { loadProductCatalog, ProductCatalogError } = await import('../src/products.js');

  const absent = await loadProductCatalog('/nonexistent/path/products.json');
  assertEqual(absent.products.length, 0, 'missing products.json yields an empty catalog, not an error');

  const badPath = new URL('./fixtures/malformed-products.json', import.meta.url);
  await mkdir(new URL('./fixtures/', import.meta.url), { recursive: true });
  await writeFile(badPath, '{ this is not valid json', 'utf8');
  let threw = false;
  try {
    await loadProductCatalog(fileURLToPath(badPath));
  } catch (error) {
    threw = error instanceof ProductCatalogError;
  }
  assert(threw, 'malformed products.json still throws ProductCatalogError');
  await rm(badPath, { force: true });
}

function assertRejects(action: () => void, message: string): void {
  try {
    action();
  } catch (error) {
    assert(error instanceof Error, `${message} threw Error`);
    return;
  }
  throw new Error(message);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'unknown error'}\n`);
  process.exit(1);
});
