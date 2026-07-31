import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

export type LocaleText = Readonly<{ readonly pt: string; readonly en: string }>;

const LocaleTextSchema = z.object({ pt: z.string().min(1), en: z.string().min(1) }).strict();
const ProductSchema = z.object({
  sku: z.string().min(1),
  displayName: LocaleTextSchema,
  description: LocaleTextSchema.optional(),
  priceBrlCents: z.number().int().min(0),
  currency: z.literal('BRL').optional(),
  shopItemId: z.string().min(1),
  kind: z.literal('credits'),
  creditsAmount: z.number().int().positive(),
  expiresMinutes: z.number().int().positive().optional(),
  enabled: z.boolean().default(true),
}).strict();
const ProductCatalogSchema = z.object({ _readme: z.string().optional(), products: z.array(ProductSchema) }).strict();

export type ProductConfig = z.infer<typeof ProductSchema>;
export type ProductCatalog = z.infer<typeof ProductCatalogSchema>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PRODUCTS_PATH = resolve(__dirname, '..', 'config', 'products.json');

export class ProductCatalogError extends Error {
  constructor(message: string, readonly errorCause: unknown) {
    super(message);
    this.name = 'ProductCatalogError';
  }
}

export function parseProductCatalog(value: unknown): ProductCatalog {
  return ProductCatalogSchema.parse(value);
}

export async function loadProductCatalog(path = DEFAULT_PRODUCTS_PATH): Promise<ProductCatalog> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isFileNotFound(error)) return { products: [] };
    throw new ProductCatalogError(`Unable to read Discord product catalog at ${path}`, error);
  }
  try {
    return parseProductCatalog(JSON.parse(raw));
  } catch (error) {
    throw new ProductCatalogError(`Invalid Discord product catalog at ${path}`, error);
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
