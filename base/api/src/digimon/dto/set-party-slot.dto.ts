import { IsInt, Max, Min, ValidateIf } from 'class-validator';

/**
 * Request body for `POST /api/digimon/:id/party` (TASK-255, R-31a).
 *
 * The body is a single `{ slot }` — either an integer in `[1,3]` (assign that party
 * slot) or `null` (clear the Digimon from the party). Everything else (ownership, the
 * one-Digimon-per-slot rule, the persisted write) is SERVER-authoritative in
 * {@link DigimonService.setPartySlot}; the client only names which slot it wants.
 *
 * Validation:
 *  - `@ValidateIf((o) => o.slot !== null)` — `null` is a VALID value ("clear the
 *    slot"), so the `@IsInt/@Min/@Max` checks are skipped when `slot === null`. For a
 *    non-null value they enforce an integer in `[1,3]` (a `0` / `4` / `1.5` → 422).
 *
 * The service ALSO re-guards `slot` server-side (`null` or an int in `[1,3]`) so the
 * rule holds even on the direct-service path (the unit spec drives that seam), and so
 * the endpoint is safe regardless of pipe behaviour under the gate.
 *
 * CRITICAL (P-7): the controller MUST bind this with a PARAMETER-SCOPED
 * `@Body(new ValidationPipe({ whitelist: true, transform: true, expectedType:
 * SetPartySlotDto }))`, NOT a bare `@Body() dto: SetPartySlotDto` leaning on the
 * global pipe. Under the vitest/esbuild transform the global pipe cannot see the DTO
 * class and validation is SILENTLY SKIPPED (a bad body would pass as 2xx). The
 * malformed-body → 400 e2e case is the guard against that regressing (the pipe rejects
 * with 400 before the handler; the SERVICE's own guard yields 422 on the direct path).
 */
export class SetPartySlotDto {
  @ValidateIf((o: SetPartySlotDto) => o.slot !== null)
  @IsInt()
  @Min(1)
  @Max(3)
  slot!: number | null;
}
