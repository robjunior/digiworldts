import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

/**
 * Request body for `POST /api/market/list` (TASK-42, R-10).
 *
 * A seller names the Digimon to list (by its stable per-instance id) and the
 * DigiCredits asking price — nothing else (ownership is proven server-side from the
 * authenticated `request.user.id`, never trusted from the body; a client cannot list
 * someone else's Digimon by claiming to be them).
 *
 * Validation rules (a rejection yields a 400 BEFORE the handler runs — asserted by the
 * e2e's malformed-body case, which MUST boot with the pipe active):
 *  - `digimonId` `@IsString` + `@IsNotEmpty` — a real cuid, not an empty/non-string
 *    value falling through to the owner-scoped lookup.
 *  - `priceCredits` `@IsInt` + `@Min(1)` — whole DigiCredits, at least 1 (a free/
 *    negative/fractional listing is nonsensical; this is the FIRST line of the
 *    price guard, re-asserted in the service so a direct service call is safe too).
 *
 * CRITICAL (P-7): the controller MUST bind this with a PARAMETER-SCOPED
 * `@Body(new ValidationPipe({ whitelist: true, transform: true, expectedType:
 * ListDigimonDto }))`, NOT a bare `@Body() dto: ListDigimonDto` leaning on the global
 * pipe. Under the vitest/esbuild transform the global pipe cannot see the DTO class
 * and validation is SILENTLY SKIPPED (a bad body would pass as 2xx). The malformed-
 * body → 400 e2e case is the guard against that regressing.
 */
export class ListDigimonDto {
  @IsString()
  @IsNotEmpty()
  digimonId!: string;

  @IsInt()
  @Min(1)
  priceCredits!: number;
}
