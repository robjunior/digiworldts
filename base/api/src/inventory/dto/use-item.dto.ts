import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Request body for `POST /api/inventory/use` (TASK-263, R-31b child i).
 *
 * USING a consumable names TWO things: the catalog slug of the item to spend
 * (`itemId`) and the id of the owned Digimon to boost (`digimonId`). Nothing else —
 * the effect (`xpBoost`) is SERVER-authoritative, resolved from `SHOP_ITEMS` by slug;
 * a client can never dictate how much XP it grants (invariant 1 / A-36 #3). The owner
 * scoping (the item stack AND the Digimon must belong to the caller) is enforced in the
 * service's transaction against `request.user.id`, never a client-supplied userId
 * (invariant 2).
 *
 * Validation rules (a rejection yields a 400 BEFORE the handler runs — asserted by the
 * e2e; the pipe MUST be active for that, which the shared `bootHttpTestApp()` guarantees):
 *  - `@IsString()`   — guards against non-string JSON reaching the lookups.
 *  - `@IsNotEmpty()` — an empty string is not a real slug/id; reject as malformed.
 *
 * CRITICAL (P-7): the controller MUST bind this with a PARAMETER-SCOPED
 * `@Body(new ValidationPipe({ whitelist: true, transform: true, expectedType:
 * UseItemDto }))`, NOT a bare `@Body() dto: UseItemDto` leaning on the global pipe.
 * Under the vitest/esbuild transform the global pipe cannot see the DTO class and
 * validation is SILENTLY SKIPPED (a bad body would pass as 2xx). Mirrors the
 * `PurchaseDto` shape verbatim.
 */
export class UseItemDto {
  @IsString()
  @IsNotEmpty()
  itemId!: string;

  @IsString()
  @IsNotEmpty()
  digimonId!: string;
}
