import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * Request body for `POST /auth/register` and `POST /auth/login` (TASK-5).
 *
 * Both endpoints take exactly `{ email, password }`, so they share one DTO. The
 * global `ValidationPipe({ whitelist: true, transform: true })` wired in the
 * shared `createApp()` (TASK-4) enforces these decorators and — because
 * `whitelist` is on — STRIPS any other property a client tries to smuggle in
 * (defence in depth on the auth surface). These are the FIRST DTOs in the
 * project; the pipe existed since TASK-4 but had nothing to validate until now.
 *
 * Validation rules (a rejection yields a 400 from the pipe before the handler
 * runs — asserted by the e2e, which MUST boot with the pipe active; see the spec):
 *  - `@IsEmail()`  — the identity must be a syntactically valid email. The handler
 *                    additionally lowercases it (see AuthService) so the `@unique`
 *                    constraint is case-insensitive in practice.
 *  - password `@MinLength(8)` — a floor, not a policy: richer strength rules /
 *                    breach checks are later additive hardening (A-7), out of scope
 *                    here. `@IsString()` guards against non-string JSON (e.g. a
 *                    number) reaching `bcrypt`.
 *
 * Note we validate the password on `login` too even though the stored account is
 * the source of truth: a login attempt that fails the basic shape can be rejected
 * as a malformed request (400) without a needless DB lookup, and it keeps the two
 * endpoints' contracts identical.
 */
export class AuthCredentialsDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
