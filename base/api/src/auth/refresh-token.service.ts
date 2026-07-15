import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, RefreshResponse, RefreshTokenPayload } from './auth.types';

/**
 * Dev-only fallback REFRESH signing secret (TASK-11, R-2b).
 *
 * MUST be DISTINCT from the access secret (`AuthModule`'s `DEV_ONLY_ACCESS_SECRET`):
 * signing the refresh token with the SAME secret + payload shape as the access
 * token would let a refresh token be replayed as a bearer access token (and vice
 * versa). Matching the house `process.env.X ?? default` idiom (there is no
 * @nestjs/config), we fall back to this clearly-marked non-secret when
 * `JWT_REFRESH_SECRET` is unset so a fresh clone / the test gate boots without a
 * `.env`. It is intentionally obvious so a leaked prod token signed with it screams
 * "misconfigured"; override it in any real deployment (see `apps/api/.env.example`).
 */
const DEV_ONLY_REFRESH_SECRET = 'dev-only-insecure-refresh-secret-change-me';

/**
 * Default refresh-token lifetime — LONG-lived (30 days), the durable half of the
 * session. This is the "stay logged in across reloads / a browser restart" window:
 * as long as the rotating cookie is presented within it, the SPA silently mints a
 * fresh short-lived access token without re-entering credentials. Overridable via
 * `JWT_REFRESH_TTL`.
 */
const DEFAULT_REFRESH_TTL = '30d';

/** A minted refresh token: the RAW value (cookie-only) + its absolute expiry. */
interface IssuedRefreshToken {
  rawToken: string;
  expiresAt: Date;
}

/**
 * Refresh-token rotation service (TASK-11, R-2b) — the server half of the durable
 * session.
 *
 * Extends the EXISTING `AuthModule` additively (P-1); it does NOT create a parallel
 * module. Its job is the rotating-refresh-token lifecycle that lets a player reload
 * the page / reopen the tab and stay logged in, and lets logout revoke the session
 * server-side:
 *  - {@link issueRefreshToken} mints + persists a new refresh token (login/register);
 *  - {@link rotate} single-use-rotates a presented token (`/auth/refresh`);
 *  - {@link revoke} soft-revokes a presented token (`/auth/logout`).
 *
 * Two security disciplines are enforced HERE, not left to the controller:
 *  - the DB stores only a HASH of the raw token (never the raw value), so a leaked
 *    DB row cannot resume a session (invariant: mirror `User.passwordHash`);
 *  - revocation STAMPS `revokedAt` (invariant 2) — a refresh token is NEVER hard
 *    DELETEd, so the rotation chain / audit trail survives.
 *
 * A-9 hashing choice: the raw refresh token IS the signed refresh JWT (already
 * high-entropy), so the stored `tokenHash` is a DETERMINISTIC sha-256 hex digest of
 * it — NOT bcrypt. Determinism is the point: `/auth/refresh` can look the row up by
 * `tokenHash` directly (an indexed point read on the `@unique` column) instead of a
 * `userId`-scoped bcrypt scan. bcrypt (with its per-hash salt) is correct for
 * low-entropy passwords where an attacker-controlled guess must be slow to verify;
 * it is the wrong tool for a high-entropy random token you must look up by value.
 * `bcryptjs` stays in use for the password only (`AuthService`).
 */
@Injectable()
export class RefreshTokenService {
  // Explicit @Inject() tokens (L-7 / P-7): the vitest/esbuild transform does NOT
  // emit constructor `design:paramtypes` (unlike the production `nest build` via
  // tsc), so plain constructor DI would inject `undefined` here and every refresh
  // route would 500 under the gate while `tsc` passed. Naming the provider directly
  // needs no reflected metadata, so it resolves identically under esbuild (tests)
  // and tsc (build). We inject the SAME shared `JwtService` AuthService/JwtAuthGuard
  // use (configured once in AuthModule against the ACCESS secret) and override the
  // secret/TTL PER CALL for the refresh token — see the signing helpers below.
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwtService: JwtService,
  ) {}

  /**
   * Mint + persist a new refresh token for `userId`.
   *
   * Signs a refresh JWT (the RAW token) with the REFRESH secret/TTL via PER-CALL
   * options — the shared `JwtService` is configured against the ACCESS secret, so a
   * bare `signAsync(payload)` would produce an access-secret token that the refresh
   * verifier rejects (friction #6). Persists only the token's sha-256 hash + the
   * owner + the JWT's absolute expiry. Returns the RAW token (which goes ONLY into
   * the httpOnly cookie) and its expiry (the controller derives the cookie maxAge).
   */
  async issueRefreshToken(userId: string): Promise<IssuedRefreshToken> {
    // `jti` is a per-token random nonce so two tokens minted for the same user in
    // the same whole second are NOT byte-identical (a JWT is otherwise fully
    // determined by payload + iat/exp seconds + secret) — without it their sha-256
    // hashes collide on the `tokenHash @unique` column (a real 500 under the gate).
    const payload: RefreshTokenPayload = { sub: userId, jti: randomUUID() };
    const rawToken = await this.jwtService.signAsync(payload, {
      secret: this.refreshSecret(),
      expiresIn: process.env.JWT_REFRESH_TTL ?? DEFAULT_REFRESH_TTL,
    });

    // Derive the absolute expiry from the JWT's own `exp` claim so the persisted
    // `expiresAt` matches the token exactly (a single source of truth for "when
    // does this stop working"). `exp` is in whole seconds since the epoch.
    const { exp } = await this.jwtService.verifyAsync<{ exp: number }>(rawToken, {
      secret: this.refreshSecret(),
    });
    const expiresAt = new Date(exp * 1000);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: this.hashToken(rawToken), expiresAt },
    });

    return { rawToken, expiresAt };
  }

  /**
   * Single-use-rotate a presented refresh token (`/auth/refresh`).
   *
   * Verifies the raw token against the REFRESH secret (a bad signature / expiry
   * throws → the caller 401s), then confirms an ACTIVE row exists for its hash
   * (`revokedAt: null` AND `expiresAt > now()` — so a revoked OR expired token is
   * rejected even if the JWT itself still verifies). Rotation is atomic and
   * single-use: in one transaction it mints a successor, STAMPS the presented row
   * `revokedAt` + `rotatedToId` (linking old → new; invariant 2 — soft-revoke, never
   * DELETE), and returns a FRESH access token (minted with the module-default ACCESS
   * config, exactly as login does) + the new refresh token for the rotated cookie.
   *
   * Replaying the now-revoked token fails the active-row check → 401 (the
   * reuse-detection SIGNAL; killing the whole chain is R-2c, paved by `rotatedToId`).
   */
  async rotate(
    rawToken: string,
  ): Promise<{ access: RefreshResponse; refresh: IssuedRefreshToken }> {
    // 1) The token must be a valid, unexpired refresh JWT (throws → caller 401s).
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(rawToken, {
        secret: this.refreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // 2) It must map to an ACTIVE row (not revoked, not past expiry). This is what
    // makes a rotated/expired/logged-out token unusable even though its JWT verifies
    // — the DB is the authority on whether a session is still live. Deterministic
    // sha-256 lets us find it by hash directly (indexed @unique point read).
    const tokenHash = this.hashToken(rawToken);
    const active = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!active) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const userId = payload.sub;

    // 3) Fetch the owner (for the access token's email claim + to be robust if the
    // account was soft-deleted between issue and refresh — a deleted user must not
    // be able to keep rotating a session, mirroring login's soft-delete awareness,
    // invariant 2). If the user is gone/soft-deleted, treat it as an invalid session.
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, role: true },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // 4) Mint the successor + rotate atomically. Issuing the successor writes a new
    // row; then we STAMP the old row revoked and link it to the successor. A
    // transaction keeps "old revoked" and "new issued" consistent — we never end up
    // with the old token revoked but no successor, nor a successor with the old
    // token still live (which would let a rotated cookie be replayed).
    const successor = await this.prisma.$transaction(async (tx) => {
      const issued = await this.issueRefreshTokenTx(tx, userId);
      await tx.refreshToken.update({
        where: { id: active.id },
        data: { revokedAt: new Date(), rotatedToId: issued.rowId },
      });
      return { rawToken: issued.rawToken, expiresAt: issued.expiresAt };
    });

    // 5) A fresh short-lived ACCESS token — minted with the module DEFAULT config (no
    // per-call override), exactly as AuthService.login does, so it carries the access
    // secret + TTL and the {sub,email,role} claims the JwtAuthGuard expects. TASK-34
    // (R-14): the `role` claim rides the refreshed token too (sourced from the just-
    // re-read user row, the DB being the source of truth for the persisted tier), so a
    // mid-session silent refresh preserves an admin's tier rather than dropping it to
    // 'user'.
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = await this.jwtService.signAsync(accessPayload);

    return { access: { accessToken }, refresh: successor };
  }

  /**
   * Best-effort revoke a presented refresh token (`/auth/logout`).
   *
   * Idempotent by design: a missing / malformed / already-revoked / expired token is
   * a NO-OP, never an error — logging out must not 500 on a stale cookie, and a user
   * with an expired access token must still be able to end their session. When the
   * token maps to an active row we STAMP `revokedAt` (invariant 2 — soft-revoke,
   * never DELETE) so a subsequent `/auth/refresh` with that cookie 401s.
   */
  async revoke(rawToken: string): Promise<void> {
    // Verify defensively; a garbage cookie should not throw out of logout. If it
    // doesn't verify it can't map to a row we'd want to revoke anyway.
    try {
      await this.jwtService.verifyAsync<RefreshTokenPayload>(rawToken, {
        secret: this.refreshSecret(),
      });
    } catch {
      return; // stale/garbage cookie — nothing to revoke, and logout still succeeds.
    }

    // updateMany (not update) so revoking an already-revoked / unknown token is a
    // no-op (count 0) rather than a P2025 "record not found" throw. Filter to the
    // still-active row so we don't re-stamp (and move) a revokedAt that already exists.
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Issue a refresh token INSIDE an existing transaction, returning the new row's id
   * too (so the caller can link `rotatedToId`). Mirrors {@link issueRefreshToken}
   * but writes via the transaction client `tx` and surfaces `rowId`.
   */
  private async issueRefreshTokenTx(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<IssuedRefreshToken & { rowId: string }> {
    const payload: RefreshTokenPayload = { sub: userId, jti: randomUUID() };
    const rawToken = await this.jwtService.signAsync(payload, {
      secret: this.refreshSecret(),
      expiresIn: process.env.JWT_REFRESH_TTL ?? DEFAULT_REFRESH_TTL,
    });
    const { exp } = await this.jwtService.verifyAsync<{ exp: number }>(rawToken, {
      secret: this.refreshSecret(),
    });
    const expiresAt = new Date(exp * 1000);
    const row = await tx.refreshToken.create({
      data: { userId, tokenHash: this.hashToken(rawToken), expiresAt },
    });
    return { rawToken, expiresAt, rowId: row.id };
  }

  /**
   * The refresh signing secret — `JWT_REFRESH_SECRET` or the dev-only fallback.
   * Read per call (not cached) so a deployment can set it via env; DISTINCT from the
   * access secret (friction #6) so refresh and access tokens can never cross-verify.
   */
  private refreshSecret(): string {
    return process.env.JWT_REFRESH_SECRET ?? DEV_ONLY_REFRESH_SECRET;
  }

  /**
   * Deterministic sha-256 hex digest of the raw refresh token — what is stored in
   * `RefreshToken.tokenHash` and what lookups query by (A-9). Deterministic so the
   * same raw token always maps to the same indexed `@unique` row. The raw token is a
   * signed JWT (high-entropy), so a plain digest is safe here — this is the FIRST
   * `node:crypto` usage in the codebase (no dependency; a Node builtin).
   */
  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
