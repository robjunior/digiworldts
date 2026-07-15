import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminGuard } from './admin.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RefreshTokenService } from './refresh-token.service';

/**
 * Dev-only fallback signing secret (TASK-5).
 *
 * A JWT secret is REQUIRED, but demanding one in every checkout would break
 * `pnpm dev` and the gate on a fresh clone. So — matching the house
 * `process.env.X ?? default` idiom used for `DATABASE_URL`/`PORT` (there is no
 * @nestjs/config) — we fall back to a clearly-marked non-secret string when
 * `JWT_ACCESS_SECRET` is unset. It is fine for local/test (tokens only need to
 * verify against themselves within one process) and MUST be overridden in any
 * real deployment via the env var documented in `apps/api/.env.example`. The
 * value is intentionally obvious so a leaked prod token signed with it screams
 * "misconfigured".
 */
const DEV_ONLY_ACCESS_SECRET = 'dev-only-insecure-jwt-secret-change-me';

/** Default access-token lifetime — short-lived (the durable refresh half is R-2b). */
const DEFAULT_ACCESS_TTL = '15m';

/**
 * Auth feature module (TASK-5, R-2) — home of the `/auth/*` loop.
 *
 * House feature-module shape (P-1): declares {@link AuthController}, provides the
 * {@link AuthService} rules + the {@link JwtAuthGuard}, and is registered
 * ADDITIVELY on `AppModule` (invariant 5). It imports:
 *  - {@link PrismaModule} — to inject the shared `PrismaService` (invariant 1:
 *    account data only through the datastore provider);
 *  - {@link JwtModule} via `registerAsync` — configured ONCE here so both the
 *    signing (AuthService) and verifying (JwtAuthGuard) sides share one secret +
 *    TTL. `registerAsync` (over static `register`) lets the factory read
 *    `process.env` at construction, the house config idiom — no @nestjs/config.
 *
 * R-2b (TASK-11) adds {@link RefreshTokenService} to `providers` — the rotating
 * refresh-token lifecycle behind `/auth/refresh` + `/auth/logout`. It reuses the
 * SAME injected `JwtService` configured below, but OVERRIDES the secret + TTL
 * per-call for the refresh token (the module default here is the ACCESS config), so
 * no second `JwtModule` registration is needed. It is provider-only (not exported):
 * only this module's `AuthController` uses it.
 */
@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      // No injected deps — the factory reads env directly (house idiom). Kept
      // async/registerAsync so config is resolved at module init, not import time.
      useFactory: () => ({
        secret: process.env.JWT_ACCESS_SECRET ?? DEV_ONLY_ACCESS_SECRET,
        signOptions: {
          expiresIn: process.env.JWT_ACCESS_TTL ?? DEFAULT_ACCESS_TTL,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, AdminGuard, RefreshTokenService],
  // EXPORTED so OTHER feature modules can reuse the same JWT protection without
  // re-implementing token verification or adding passport (TASK-8's DigimonModule
  // is the first such consumer — `@UseGuards(JwtAuthGuard)` on `GET /digimon`).
  //
  // Both entries are REQUIRED and this is the one genuine wiring change TASK-8
  // needs (additive — nothing is removed, so the `/auth/*` routes + the existing
  // api tests stay green; invariant 5 intact):
  //  - `JwtAuthGuard` — so an importer of `AuthModule` can inject/apply the guard.
  //  - `JwtModule` — the guard's constructor injects `JwtService`, which is
  //    configured ONLY here (via `registerAsync` above). Nest resolves a guard's
  //    dependencies in the CONTEXT of the module that USES it, so without also
  //    re-exporting `JwtModule` the importing module has no `JwtService` provider
  //    and DI fails to CONSTRUCT the guard at boot. Re-exporting the module makes
  //    its exported `JwtService` visible to importers of `AuthModule`. (If a guard
  //    ever fails to construct in a module that imports AuthModule, this is why.)
  //  - `AdminGuard` — the TASK-34 (R-14) admin-tier guard, so AdminModule can apply
  //    `@UseGuards(AdminGuard)` across the module boundary. It DELEGATES to
  //    JwtAuthGuard internally (which is why it also needs JwtModule visible, already
  //    re-exported above) then requires `request.user.role === 'admin'`.
  exports: [JwtAuthGuard, AdminGuard, JwtModule],
})
export class AuthModule {}
