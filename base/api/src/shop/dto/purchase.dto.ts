import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Request body for `POST /api/shop/purchase` (TASK-26, R-13).
 *
 * The purchase names the item to buy by its stable catalog slug — nothing else
 * (the price + effect are SERVER-authoritative, resolved from `SHOP_ITEMS`; a
 * client can never dictate what it pays or what effect applies). So the body is a
 * single `{ itemId }`.
 *
 * Validation rules (a rejection yields a 400 BEFORE the handler runs — asserted by
 * the e2e's malformed-body case, which MUST boot with the pipe active):
 *  - `@IsString()`   — guards against non-string JSON (e.g. `{ itemId: 123 }`)
 *                      reaching the catalog lookup.
 *  - `@IsNotEmpty()` — an empty string is not a real slug; reject it as malformed
 *                      rather than letting it fall through to a 404.
 *
 * CRITICAL (P-7): the controller MUST bind this with a PARAMETER-SCOPED
 * `@Body(new ValidationPipe({ whitelist: true, transform: true, expectedType:
 * PurchaseDto }))`, NOT a bare `@Body() dto: PurchaseDto` leaning on the global
 * pipe. Under the vitest/esbuild transform the global pipe cannot see the DTO class
 * and validation is SILENTLY SKIPPED (a bad body would pass as 2xx). The
 * malformed-body → 400 e2e case is the guard against that regressing.
 */
export class PurchaseDto {
  @IsString()
  @IsNotEmpty()
  itemId!: string;
}
