import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Request body for `POST /api/inventory/discard` (TASK-265, R-31b child ii).
 *
 * DISCARDING a stack names ONE thing: the catalog slug of the item to destroy
 * (`itemId`). Nothing else — the destruction rule (zero the owned stack's `quantity`)
 * is SERVER-authoritative; the client can never dictate a refund or a partial amount
 * (invariant 1 / A-36 #3). The owner scoping (the stack must belong to the caller) is
 * enforced in the service's transaction against `request.user.id`, never a
 * client-supplied userId (invariant 2).
 *
 * Validation rules (a rejection yields a 400 BEFORE the handler runs — asserted by the
 * e2e; the pipe MUST be active for that, which the shared `bootHttpTestApp()` guarantees):
 *  - `@IsString()`   — guards against non-string JSON reaching the lookup.
 *  - `@IsNotEmpty()` — an empty string is not a real slug; reject as malformed.
 *
 * CRITICAL (P-7): the controller MUST bind this with a PARAMETER-SCOPED
 * `@Body(new ValidationPipe({ whitelist: true, transform: true, expectedType:
 * DiscardItemDto }))`, NOT a bare `@Body() dto: DiscardItemDto` leaning on the global
 * pipe. Under the vitest/esbuild transform the global pipe cannot see the DTO class and
 * validation is SILENTLY SKIPPED (a bad body would pass as 2xx). Mirrors the
 * `UseItemDto` shape verbatim (minus its `digimonId` — a discard names no target).
 */
export class DiscardItemDto {
  @IsString()
  @IsNotEmpty()
  itemId!: string;
}
