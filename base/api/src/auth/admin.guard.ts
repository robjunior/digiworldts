import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';

/**
 * Admin-tier authorization guard (TASK-34, R-14) — the FIRST tier beyond bare
 * "authenticated". It gates a route to callers whose access token vouches for
 * `role === 'admin'` (the tier stamped from `ADMIN_EMAILS` config; see
 * AuthService). Applied via `@UseGuards(AdminGuard)` on the admin routes.
 *
 * COMPOSITION over inheritance: rather than duplicate the token-parsing, this guard
 * DELEGATES to the existing {@link JwtAuthGuard} for authentication first (it
 * verifies the Bearer token — 401 on a missing/invalid/expired one — and pins the
 * verified principal to `request.user`, INCLUDING `role`). Only once that succeeds
 * does AdminGuard apply the authorization check. So the two failure modes stay
 * distinct and correct: no/bad token → 401 (from JwtAuthGuard), a valid token for a
 * non-admin → 403 (here). This ordering is why AdminGuard need not be combined with
 * `@UseGuards(JwtAuthGuard)` at the call site — it runs JwtAuthGuard itself.
 *
 * The 403 message is deliberately GENERIC ("Admin privileges required") — it never
 * enumerates what the caller lacks beyond "you are not an admin", matching the
 * account-enumeration hygiene the auth loop applies elsewhere (A-7).
 *
 * DI: JwtAuthGuard is a provider of AuthModule, so it is injectable here (both live
 * in AuthModule). The explicit `@Inject(JwtAuthGuard)` token is REQUIRED for the
 * same esbuild reason every other constructor in this module carries one (the
 * vitest transform omits `design:paramtypes`, so a bare param would inject
 * `undefined` and the guard would 500 under the gate). AuthModule exports AdminGuard
 * (alongside JwtAuthGuard + JwtModule) so a feature module — AdminModule — can apply
 * it across the module boundary.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(JwtAuthGuard) private readonly jwtAuthGuard: JwtAuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Authenticate first: JwtAuthGuard verifies the token, 401s a bad one, and pins
    // `request.user` (with `role`). `canActivate` is synchronous here but we await
    // it defensively so a future async guard stays compatible.
    const authenticated = await this.jwtAuthGuard.canActivate(context);
    if (!authenticated) {
      // JwtAuthGuard returns true or throws — a `false` return would be unusual, but
      // treat it as a hard deny rather than silently allowing through.
      throw new ForbiddenException('Admin privileges required');
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user?.role !== 'admin') {
      // A valid, authenticated token for a NON-admin caller → 403 (authorization
      // failure), distinct from the 401 a missing/invalid token produces above.
      throw new ForbiddenException('Admin privileges required');
    }

    return true;
  }
}
