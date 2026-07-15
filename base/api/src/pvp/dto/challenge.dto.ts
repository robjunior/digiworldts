import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Request body for `POST /api/pvp/challenge` (TASK-36, R-12).
 *
 * A player challenges another real player to a ranked match. The body names only WHO
 * to fight (`opponentId`); the challenger is the authenticated caller (read from
 * `request.user.id`, never trusted from the body), the combat is resolved
 * SERVER-side by the deterministic `simulateBattle`, and the rating move is
 * SERVER-computed (the client cannot dictate an outcome or a rating).
 *
 * Validation (a rejection yields a 400 BEFORE the handler runs — asserted by the
 * e2e's malformed-body case, which MUST boot with the pipe active):
 *  - `opponentId` `@IsString @IsNotEmpty` — a non-empty user id. Whether it names a
 *    REAL, active, challengeable opponent is a service concern (a 404/422), not a
 *    validation concern; the DTO only enforces the well-formed-body contract.
 *
 * CRITICAL (P-7): the controller MUST bind this with a PARAMETER-SCOPED
 * `@Body(new ValidationPipe({ whitelist: true, transform: true, expectedType:
 * ChallengeDto }))`, NOT a bare `@Body() dto: ChallengeDto` leaning on the global
 * pipe. Under the vitest/esbuild transform the global pipe cannot see the DTO class
 * and validation is SILENTLY SKIPPED (a bad body would pass as 2xx). The
 * malformed-body → 400 e2e case is the guard against that regressing.
 */
export class ChallengeDto {
  @IsString()
  @IsNotEmpty()
  opponentId!: string;
}
