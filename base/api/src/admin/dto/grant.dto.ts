import { IsEmail, IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator';

/**
 * Request body for `POST /api/admin/grant` (TASK-34, R-14).
 *
 * An admin credits a TARGET player's spendable balance. The target is named by
 * email (the human-facing identifier an admin has), the resource + amount say what
 * to grant. The value moved is SERVER-recorded (an audit row); the client dictates
 * only who/what/how-much, never bypasses the ledger (invariant 3).
 *
 * Validation rules (a rejection yields a 400 BEFORE the handler runs — asserted by
 * the e2e's malformed-body case, which MUST boot with the pipe active):
 *  - `targetEmail` `@IsEmail` — must be a real email shape (the lookup key).
 *  - `resource`    `@IsString @IsNotEmpty` — a non-empty resource name (e.g. 'Meat').
 *  - `amount`      `@IsInt @IsPositive` — a whole, POSITIVE unit count. A grant only
 *    ever ADDS value (a CREDIT); a negative/zero/fractional amount is malformed
 *    (a DEBIT/adjust is a carved R-14 child, not this route).
 *
 * CRITICAL (P-7): the controller MUST bind this with a PARAMETER-SCOPED
 * `@Body(new ValidationPipe({ whitelist: true, transform: true, expectedType:
 * GrantDto }))`, NOT a bare `@Body() dto: GrantDto` leaning on the global pipe.
 * Under the vitest/esbuild transform the global pipe cannot see the DTO class and
 * validation is SILENTLY SKIPPED (a bad body would pass as 2xx). The malformed-body
 * → 400 e2e case is the guard against that regressing.
 */
export class GrantDto {
  @IsEmail()
  targetEmail!: string;

  @IsString()
  @IsNotEmpty()
  resource!: string;

  @IsInt()
  @IsPositive()
  amount!: number;
}
