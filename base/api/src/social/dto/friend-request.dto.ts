import { IsEmail, IsNotEmpty } from 'class-validator';

/**
 * Request body for `POST /api/social/friends/request` (TASK-44, R-11).
 *
 * A player names ONLY the target's email — nothing else (the requester's identity is
 * proven server-side from the authenticated `request.user.id`, never trusted from the
 * body; a client cannot send a request AS someone else by claiming to be them).
 *
 * Validation rules (a rejection yields a 400 BEFORE the handler runs — asserted by the
 * e2e's malformed-body path, which MUST boot with the pipe active):
 *  - `email` `@IsEmail` + `@IsNotEmpty` — a syntactically valid, non-empty email. The
 *    service additionally lowercases it (mirroring AuthService's normalization) so the
 *    lookup matches regardless of the caller's casing.
 *
 * CRITICAL (P-7): the controller MUST bind this with a PARAMETER-SCOPED
 * `@Body(new ValidationPipe({ whitelist: true, transform: true, expectedType:
 * FriendRequestDto }))`, NOT a bare `@Body() dto: FriendRequestDto` leaning on the
 * global pipe. Under the vitest/esbuild transform the global pipe cannot see the DTO
 * class and validation is SILENTLY SKIPPED (a bad body would pass as 2xx). The
 * malformed-body → 400 e2e case is the guard against that regressing.
 */
export class FriendRequestDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
