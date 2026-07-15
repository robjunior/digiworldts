import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AccessTokenPayload, AuthenticatedUser } from './auth.types';

/**
 * The Express request after this guard runs: the verified principal is pinned to
 * `request.user` so downstream handlers (`GET /auth/me`) read the caller's
 * identity without re-parsing the token or touching the DB.
 */
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

/**
 * JWT bearer guard (TASK-5) — a deliberately small custom `CanActivate` rather
 * than the passport stack.
 *
 * Why hand-rolled: verifying one signed access token is a few lines with
 * `JwtService`, whereas passport would pull in four packages (`passport`,
 * `@nestjs/passport`, `passport-jwt`, `@types/passport-jwt`) — none currently in
 * the tree — for no extra value on this slice (D-14 #3). If a second auth strategy
 * (OAuth, API keys) ever lands, revisiting passport is a fair trade then, not now.
 *
 * Behaviour (the "protected view you cannot reach signed out"):
 *  - No `Authorization: Bearer <token>` header, malformed header, an invalid
 *    signature, or an EXPIRED token → 401 (`JwtService.verify` throws on all of
 *    these; the short TTL means expiry is a real, tested path — but we assert it
 *    via a token we sign expired, never by sleeping; L-3).
 *  - A valid token → attach `{ id: sub, email }` to `request.user` and allow.
 *
 * The guard trusts `JwtService`'s configured secret/verification (set up in
 * `AuthModule` via `JwtModule.registerAsync`), so it needs no secret of its own —
 * a single source of truth for signing and verifying.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  // Explicit @Inject() token, matching AuthService/AuthController: the vitest
  // esbuild transform does NOT emit constructor `design:paramtypes` (unlike the
  // production `nest build` via tsc), so relying on a reflected param type would
  // inject `undefined` under the gate and every guarded route would 401→throw on
  // a missing JwtService. Naming the provider directly needs no reflected
  // metadata, so it resolves identically under esbuild (tests) and tsc (build).
  constructor(@Inject(JwtService) private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request.headers.authorization);
    if (!token) {
      // Generic message on purpose — never hint whether the token was absent vs
      // malformed vs expired (A-7: don't leak auth internals to a caller).
      throw new UnauthorizedException('Missing or invalid access token');
    }

    let payload: AccessTokenPayload;
    try {
      // verify (not decode) — checks signature AND expiry. A bad signature or an
      // expired token throws, which we translate into a uniform 401.
      payload = this.jwtService.verify<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Missing or invalid access token');
    }

    // Pin the principal for the handler. `sub` is the JWT subject (the user id).
    (request as AuthenticatedRequest).user = {
      id: payload.sub,
      email: payload.email,
      // TASK-34 (R-14): the authorization tier the JWT vouches for. Default a
      // MISSING claim to 'user' (`?? 'user'`) so an access token minted BEFORE the
      // `role` claim existed still verifies and is treated as a plain user — no
      // released session breaks (invariant 5) and no unprivileged token silently
      // gains 'admin'. AdminGuard reads this to require `role === 'admin'`.
      role: payload.role ?? 'user',
    };
    return true;
  }

  /**
   * Pull the token out of an `Authorization: Bearer <token>` header, tolerating
   * case in the scheme and stray whitespace. Returns `undefined` for anything
   * that is not a well-formed bearer header so the caller can 401 uniformly.
   */
  private extractBearerToken(header: string | undefined): string | undefined {
    if (!header) return undefined;
    const [scheme, token] = header.trim().split(/\s+/);
    if (!scheme || scheme.toLowerCase() !== 'bearer') return undefined;
    return token && token.length > 0 ? token : undefined;
  }
}
