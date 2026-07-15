import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { LoginResponse, MeResponse, RefreshResponse, RegisterResponse } from './auth.types';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';
import { RefreshTokenService } from './refresh-token.service';

/**
 * Name of the httpOnly refresh cookie (TASK-11, R-2b). Namespaced like the SPA's
 * `sessionStorage` key so it is unambiguous in devtools / logs.
 */
const REFRESH_COOKIE_NAME = 'digimon.refreshToken';

/**
 * Base cookie attributes for the refresh cookie (TASK-11, R-2b), shared by the
 * SET and CLEAR paths so a cookie is only cleared by a byte-identical attribute set
 * (browsers match delete-cookies on name + path + domain).
 *
 *  - `httpOnly: true`  — the SPA's JS can NEVER read it (XSS can't exfiltrate the
 *    session), which is the whole reason the durable credential lives in a cookie
 *    rather than `sessionStorage`.
 *  - `sameSite: 'lax'` — the CSRF posture for this slice: the cookie rides top-level
 *    navigations + same-site requests (so the dev proxy round-trips) but not
 *    cross-site sub-requests. No double-submit CSRF token this slice (out of scope).
 *  - `secure`          — ENV-DRIVEN and OFF in dev (friction #3): a `Secure` cookie
 *    is dropped over plain-HTTP `localhost`, which would silently break the Vite
 *    (`:5173`) → Nest (`:3000`) dev-proxy round-trip. `COOKIE_SECURE=true` in any
 *    HTTPS deployment. Read per-request so a single build serves both.
 *  - `path: '/'`       — sent to every route (so `/auth/refresh` + `/auth/logout`
 *    both receive it); no explicit `Domain`, so it stays host-only and needs no
 *    `cookieDomainRewrite` through the proxy.
 */
function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
  };
}

/** SET options: the base attributes plus an absolute `expires` (mirrors the token). */
function setCookieOptions(expiresAt: Date): CookieOptions {
  return { ...baseCookieOptions(), expires: expiresAt };
}

/**
 * Body-validation pipe pinned to {@link AuthCredentialsDto} via `expectedType`.
 *
 * WHY a parameter-scoped pipe with an EXPLICIT `expectedType` instead of relying
 * on the global `ValidationPipe` (in `createApp()`): the global pipe reads the DTO
 * class to validate from the handler parameter's reflected `design:paramtypes`
 * metadata — but the vitest/esbuild transform does NOT emit `design:paramtypes`
 * for METHOD parameters (verified: `Reflect.getMetadata('design:paramtypes',
 * AuthController.prototype, 'register')` is `undefined` under the gate). This is
 * the method-parameter analogue of the constructor-DI gap that forces `@Inject()`
 * elsewhere in this module. With no metatype, Nest's `ValidationPipe.transform`
 * hits its `if (!metatype ...) return value` short-circuit and SKIPS validation
 * entirely — so a bad email / short password would sail through as 201 under the
 * gate (only tsc-built `nest build` would catch it, diverging test from prod).
 * Setting `expectedType` makes the pipe substitute this class for the missing
 * reflected metatype (`metadata = { ...metadata, metatype: this.expectedType }`),
 * so validation fires identically under esbuild (tests) and tsc (build). Mirrors
 * the global pipe's `whitelist`/`transform` so stripping/coercion stay consistent.
 */
const validateCredentials = new ValidationPipe({
  whitelist: true,
  transform: true,
  expectedType: AuthCredentialsDto,
});

/**
 * `/auth/*` — the server-side account loop (TASK-5, R-2; TASK-11, R-2b).
 *
 * Follows the house feature-controller shape (P-1, like `HealthController`): a
 * thin HTTP layer that validates input via a DTO + the global `ValidationPipe`
 * and delegates all rules to {@link AuthService} / {@link RefreshTokenService}.
 * This is the enforced, server-authoritative half of "sign up / log in / a view
 * you can't reach signed out" — the SPA (TASK-6/TASK-12) renders it but never
 * bypasses it (invariant 1).
 *
 * R-2b (TASK-11) adds the durable-session surface ADDITIVELY (invariant 5 — the
 * register/login/me JSON bodies are UNCHANGED; the new behaviour is a `Set-Cookie`
 * header on login/register + two net-new POST routes):
 *  - login/register now ALSO set the rotating httpOnly refresh cookie;
 *  - `POST /auth/refresh` reads the cookie, rotates it, and returns a fresh
 *    `{ accessToken }` (401 if the cookie is missing/invalid/expired/revoked);
 *  - `POST /auth/logout` revokes the presented token + clears the cookie (204).
 *
 * TASK-11 introduces the FIRST `@Res({ passthrough: true })` handlers in the
 * codebase: `passthrough: true` keeps Nest serializing the returned JSON body while
 * the handler ALSO sets the cookie on the raw Express `res` — so we set the cookie
 * AND `return { accessToken }` as before (without it, Nest would stop serializing
 * the return value and expect a manual `res.json(...)`).
 */
@Controller('auth')
export class AuthController {
  // @Inject() tokens are REQUIRED here (not decoration): the vitest/esbuild
  // transform omits constructor `design:paramtypes`, so plain constructor DI
  // would inject `undefined` and every route would 500 under the gate. See the
  // longer note in auth.service.ts. Resolves identically under tsc (build).
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(RefreshTokenService)
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  /**
   * `POST /auth/register` → 201 `{ id, email }` + a rotating refresh cookie.
   *
   * The body is an {@link AuthCredentialsDto}; the {@link validateCredentials}
   * pipe rejects a bad email / short password with 400 BEFORE this runs. A
   * duplicate email surfaces as 409 from the service (never a 500). The response
   * body deliberately omits the password hash — and is UNCHANGED by TASK-11
   * (invariant 5); the durable session rides ONLY the `Set-Cookie` header.
   *
   * We set the refresh cookie on register (A-9) — not just login — so a
   * register-then-use flow is a single round-trip: the new account is immediately a
   * durable session without a mandatory follow-up login. The SPA (TASK-12) may
   * still log in after; setting it here is harmless and the login would just rotate.
   */
  @Post('register')
  // Explicit even though Nest defaults POST to 201 — the status is part of the
  // contract, so we pin it rather than rely on the framework default.
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(validateCredentials) credentials: AuthCredentialsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RegisterResponse> {
    const user = await this.authService.register(credentials.email, credentials.password);
    await this.setRefreshCookie(res, user.id);
    return user;
  }

  /**
   * `POST /auth/login` → 200 `{ accessToken }` + a rotating refresh cookie.
   *
   * Overridden to 200 (not the POST-default 201) because logging in does not
   * CREATE a resource — it returns a session token for existing credentials. Bad
   * credentials → a generic 401 from the service (no field-level leak, A-7). The
   * JSON body is UNCHANGED by TASK-11 (invariant 5); the refresh token is delivered
   * ONLY as the httpOnly cookie so the SPA's JS can never read it.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(validateCredentials) credentials: AuthCredentialsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.authService.login(credentials.email, credentials.password);
    // login already verified the credentials; decode the just-minted access token's
    // subject (the user id) to mint the paired refresh token for the same user
    // WITHOUT a second DB lookup or changing AuthService's public contract.
    const { sub } = this.authService.decodeAccessSubject(result.accessToken);
    await this.setRefreshCookie(res, sub);
    return result;
  }

  /**
   * `POST /auth/refresh` → 200 `{ accessToken }` + a ROTATED refresh cookie.
   *
   * The durable-session heart (R-2b): read the refresh cookie, single-use-rotate it
   * (mint a fresh access token + a fresh refresh token, revoke the presented one),
   * and set the successor cookie. NO `JwtAuthGuard` — the caller's ACCESS token may
   * be expired (that is WHY they are refreshing); the refresh COOKIE is the
   * credential here. Any failure (no cookie, or an invalid/expired/revoked/rotated
   * token) → 401 AND clear the stale cookie so the browser stops resending it.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponse> {
    const rawToken = this.readRefreshCookie(request);
    if (!rawToken) {
      // No cookie at all — nothing to rotate. Uniform 401 (like the guarded routes),
      // and clear defensively in case a malformed cookie is lingering.
      this.clearRefreshCookie(res);
      throw new UnauthorizedException('Missing refresh token');
    }

    try {
      const { access, refresh } = await this.refreshTokenService.rotate(rawToken);
      this.applyRefreshCookie(res, refresh);
      return access;
    } catch (error) {
      // On ANY rotation failure, clear the now-useless cookie so the browser stops
      // resending a dead token, then surface a uniform 401 (rethrow the service's
      // UnauthorizedException; wrap anything unexpected the same way — never 500 a
      // refresh into a leak of internals).
      this.clearRefreshCookie(res);
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * `POST /auth/logout` → 204, session revoked server-side + cookie cleared.
   *
   * Best-effort + idempotent: revoke the presented refresh token (STAMP `revokedAt`
   * so a replay 401s) and ALWAYS clear the cookie, whether or not a valid token was
   * present. Deliberately NO `JwtAuthGuard` — a user whose access token has expired
   * must still be able to log out via the refresh cookie. A missing/garbage cookie
   * still returns 204 (logging out is never an error).
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const rawToken = this.readRefreshCookie(request);
    if (rawToken) {
      // Best-effort — revoke() swallows a stale/garbage token internally, so this
      // never throws logout into a 500.
      await this.refreshTokenService.revoke(rawToken);
    }
    this.clearRefreshCookie(res);
  }

  /**
   * `GET /auth/me` → 200 `{ id, email }` — the protected endpoint (UNCHANGED).
   *
   * {@link JwtAuthGuard} runs first: it 401s a missing/invalid/expired token, and
   * on success pins the verified principal to `request.user`. So by the time this
   * body runs the caller is authenticated and we simply project the token's
   * identity (no DB round-trip needed to READ it — the token is authoritative for its
   * short TTL). This is the server-side "view you cannot reach signed out". TASK-11 does
   * NOT touch this route (still `Authorization: Bearer`, same body — invariant 5).
   *
   * TASK-44 (R-11) adds a pure WRITE side-effect: stamp `User.lastSeenAt = now` for the
   * caller so the social friends view can derive an `online` indicator (every authed
   * screen already hits this route on boot, so presence stays fresh with NO new
   * plumbing). The stamp is NON-FATAL — a failure must not break `/auth/me`, so it is
   * `.catch()`-swallowed — and it does NOT change the `MeResponse` WIRE shape
   * (`lastSeenAt` is never projected onto the response — invariant 5 holds; the read
   * side of this route is byte-unchanged).
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() request: AuthenticatedRequest): Promise<MeResponse> {
    // TASK-44 (R-11): refresh the caller's presence timestamp. Awaited but swallowed —
    // a failed stamp must never turn a valid `/auth/me` into an error (the caller is
    // already authenticated and expects their identity back regardless).
    await this.authService.touchLastSeen(request.user.id).catch(() => undefined);

    // TASK-35 (R-14): project `role` too (additive, invariant 5). The guard already
    // pinned `request.user.role` from the token's claim (TASK-34), so this needs no
    // DB round-trip; the SPA reads it to decide whether to show the admin control.
    const { id, email, role } = request.user;
    return { id, email, role };
  }

  /** Mint a fresh refresh token for `userId` and write it as the cookie. */
  private async setRefreshCookie(res: Response, userId: string): Promise<void> {
    const issued = await this.refreshTokenService.issueRefreshToken(userId);
    this.applyRefreshCookie(res, issued);
  }

  /** Write an already-issued refresh token as the httpOnly cookie. */
  private applyRefreshCookie(res: Response, issued: { rawToken: string; expiresAt: Date }): void {
    res.cookie(REFRESH_COOKIE_NAME, issued.rawToken, setCookieOptions(issued.expiresAt));
  }

  /**
   * Read the raw refresh token from the request cookies. `req.cookies` is populated
   * by the `cookie-parser` middleware wired in `createApp()` (TASK-11); if the
   * middleware were missing this would be `undefined` and refresh/logout could not
   * read the cookie (friction #2). Returns `undefined` when absent/empty.
   */
  private readRefreshCookie(request: Request): string | undefined {
    const value = request.cookies?.[REFRESH_COOKIE_NAME];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  /** Clear the refresh cookie using the SAME name/attributes it was set with. */
  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, baseCookieOptions());
  }
}
