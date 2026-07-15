import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, LoginResponse, RegisterResponse } from './auth.types';

/**
 * bcrypt work factor. 10 is the task floor (`>= 10 rounds`) and a sensible
 * default: high enough to be costly to brute-force, low enough that a login's
 * `compare` stays well under a request timeout. Bumping this later (as hardware
 * improves) is safe — bcrypt stores the cost in the hash, so existing hashes keep
 * verifying at their original cost.
 */
const BCRYPT_ROUNDS = 12;

/**
 * Parse the `ADMIN_EMAILS` env var (TASK-34, R-14) into a normalized lookup set.
 *
 * The FIRST admin is bootstrapped from plain local config — a comma-separated list
 * of emails, read with the house `process.env.X ?? default` idiom (there is no
 * @nestjs/config), documented in `apps/api/.env.example`. This needs NO external
 * resource (no payment key, no third-party service), so nothing PARKS (A-22): it is
 * a config default, empty by default. Emails are lowercased + trimmed so the check
 * matches `AuthService`'s `email.toLowerCase()` normalization exactly (`A@B.com` in
 * the list matches the account stored as `a@b.com`). Blank entries are dropped so a
 * trailing comma / an unset var yields an empty set (nobody is auto-admin).
 *
 * Read per-call (not cached) so a single build serves any env, matching how the
 * cookie/JWT config is read; the set is tiny, so the parse cost is irrelevant.
 */
function adminEmailSet(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

/** The two authorization tiers (TASK-34) — a plain union (SQLite has no enums, L-6). */
type Role = 'user' | 'admin';

/** The tier a given (already-normalized) email should hold, per `ADMIN_EMAILS`. */
function roleForEmail(normalizedEmail: string): Role {
  return adminEmailSet().has(normalizedEmail) ? 'admin' : 'user';
}

/**
 * Auth domain logic (TASK-5, R-2) — the server-authoritative account loop.
 *
 * Follows the house feature-service shape (an `@Injectable()` that the controller
 * delegates to, like the pattern `HealthController` will grow into): the
 * controller owns HTTP concerns (routes, status codes, the guard), this owns the
 * rules (hashing, uniqueness, credential verification, token minting). It reaches
 * the datastore ONLY through the injected {@link PrismaService} (invariant 1) and
 * mints tokens through the shared {@link JwtService} configured in `AuthModule`.
 *
 * Two security constraints are enforced here rather than left to callers:
 *  - the plaintext password is NEVER stored and the `passwordHash` NEVER leaves
 *    this layer (handlers return only `{ id, email }`);
 *  - a failed login gives ONE generic error whether the email is unknown or the
 *    password is wrong (A-7), so the endpoint can't be used to enumerate accounts.
 */
@Injectable()
export class AuthService {
  // Constructor injection uses EXPLICIT @Inject() tokens rather than relying on
  // reflected constructor parameter types. This is a house requirement, not a
  // preference: the test runner (vitest) transforms TS with esbuild, and esbuild
  // — unlike tsc, which the production `nest build` uses — does NOT emit
  // `design:paramtypes` metadata for CONSTRUCTOR parameters even with
  // emitDecoratorMetadata on (a documented esbuild limitation, verified against
  // 0.21.5). Without a token Nest's DI sees `undefined` param types under the
  // gate and injects nothing, so every handler 500s with "Cannot read properties
  // of undefined". `@Inject(Token)` names the provider directly and needs no
  // reflected metadata, so it resolves identically under esbuild (tests) and tsc
  // (build). This is the FIRST constructor-DI in the codebase — earlier modules
  // (Health, Prisma) had none, which is why the gap only surfaces now. Every new
  // injected constructor param must carry @Inject() for the same reason.
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwtService: JwtService,
  ) {}

  /**
   * Create an account: hash the password, persist a new {@link Prisma} `User`,
   * and return only its public identity. The email is lowercased so uniqueness is
   * effectively case-insensitive (`A@B.com` and `a@b.com` are one account).
   *
   * Concurrency-safe uniqueness: rather than "check then insert" (which races),
   * we let the DB's `email @unique` constraint be the arbiter and translate its
   * P2002 violation into a clean 409. This is exactly the atomic guarantee the
   * TASK-4 persistence e2e proved the schema provides — so two simultaneous
   * registrations of the same email cannot both win.
   */
  async register(email: string, password: string): Promise<RegisterResponse> {
    const normalizedEmail = email.toLowerCase();
    const passwordHash = await hash(password, BCRYPT_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        // TASK-34 (R-14): stamp the config-derived tier at creation. A brand-new
        // account whose email is in ADMIN_EMAILS is created directly as 'admin';
        // everyone else defaults to 'user' (the column's DB default — we set it
        // explicitly so register and login agree). No audit row: assigning an
        // authorization tier from static config is a provision, not a value-moving
        // economic mutation (invariant 3 is untriggered — like the starter grants).
        data: {
          email: normalizedEmail,
          passwordHash,
          role: roleForEmail(normalizedEmail),
        },
        // Project to the public fields at the query level so the hash never even
        // materialises on the object we could accidentally return.
        select: { id: true, email: true },
      });
      return user;
    } catch (error) {
      if (this.isUniqueEmailViolation(error)) {
        // 409, not 500: a duplicate email is a client-correctable conflict, not a
        // server fault. Generic message — do not confirm the email exists beyond
        // the status (A-7 account-enumeration hygiene).
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  /**
   * Verify credentials and mint a short-lived access token. On ANY failure — no
   * such (active) user, or a password mismatch — throw the SAME 401 so the caller
   * learns nothing about which accounts exist (A-7).
   *
   * Soft-delete aware (invariant 2): a user whose `deletedAt` is set is treated as
   * if it does not exist, so a deactivated account cannot authenticate.
   */
  async login(email: string, password: string): Promise<LoginResponse> {
    const normalizedEmail = email.toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email: normalizedEmail, deletedAt: null },
    });

    // Note: we still run bcrypt.compare against the fetched hash only when a user
    // exists. (A constant-time "always hash" defence against timing-based user
    // enumeration is later hardening, A-7 — out of scope for this slice.)
    const passwordMatches = user ? await compare(password, user.passwordHash) : false;
    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // TASK-34 (R-14): reconcile the persisted tier against `ADMIN_EMAILS` on every
    // login so an account added to the config AFTER it registered is promoted the
    // next time it logs in (register-time stamping alone would miss those). The
    // update is idempotent (only writes when the desired tier differs from the
    // stored one) and only ever grants the config-listed tier — it never demotes
    // toward less than the config says. Persisting it (not just minting it into the
    // token) keeps the DB the source of truth for a role a later admin-only DB read
    // would consult. No audit row: this is a config-driven provision, not an
    // economic mutation (invariant 3 untriggered).
    const desiredRole = roleForEmail(normalizedEmail);
    let role = user.role;
    if (role !== desiredRole && desiredRole === 'admin') {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { role: desiredRole },
      });
      role = desiredRole;
    }

    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      // Carry the tier in the access token so guards authorize with no DB
      // round-trip (invariant 5: an additive claim — older tokens without it default
      // to 'user' in JwtAuthGuard).
      role,
    };
    // TTL + secret come from the JwtModule config (AuthModule); signing here keeps
    // one source of truth for both signing and the guard's verification.
    const accessToken = await this.jwtService.signAsync(payload);
    return { accessToken };
  }

  /**
   * Extract the subject (user id) from an access token this service just minted.
   *
   * Used by the controller (TASK-11) to pair a refresh token to the SAME user right
   * after `login` WITHOUT widening `login`'s public `{ accessToken }` contract
   * (invariant 5) or issuing a second DB lookup. The token was signed moments ago by
   * this very service, so `decode` (structural read, no re-verification needed — the
   * signature/expiry were just produced here) is sufficient; the guard still fully
   * verifies the token on every guarded request. Throws if the token is unexpectedly
   * unreadable (it never should be, having just been signed).
   */
  decodeAccessSubject(accessToken: string): { sub: string } {
    const payload = this.jwtService.decode<AccessTokenPayload | null>(accessToken);
    if (!payload || typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return { sub: payload.sub };
  }

  /**
   * Stamp `User.lastSeenAt = now` for `userId` (TASK-44, R-11 — the social presence
   * signal). Called as a pure WRITE side-effect of every `GET /api/auth/me` (which every
   * authed screen already hits on boot / periodically), so a player's presence stays
   * fresh with NO new plumbing or client change — the friends view derives an `online`
   * boolean from this column.
   *
   * NON-FATAL by design: a failed stamp (a transient DB hiccup, a soft-deleted account
   * that vanished between the guard and here) must NEVER break the `/auth/me` read — the
   * caller is already authenticated by the token and expects their identity back
   * regardless of whether presence updated. So the caller wraps this in a swallow; here we
   * keep it a plain owner-scoped `update`, and the controller ignores a rejection.
   *
   * It does NOT touch the `MeResponse` WIRE shape (invariant 5 — `lastSeenAt` is not
   * projected onto the response; it is read only by SocialService's friends list). No
   * spendable value moves, so invariant 3 is untriggered (presence is a domain flag, like
   * `mmr`/`xp` — no ResourceBalance/AuditLog).
   */
  async touchLastSeen(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date() },
    });
  }

  /**
   * True when a thrown error is Prisma's unique-constraint violation (P2002) for
   * the email column. Narrowing on the typed error (not string-matching a
   * message) keeps this robust across Prisma versions.
   */
  private isUniqueEmailViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
