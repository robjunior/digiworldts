import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { LoginResponse, RefreshResponse } from './auth.types';

/**
 * Refresh-loop contract (TASK-11, R-2b). The runnable proof of the durable-session
 * server half: login sets a rotating httpOnly refresh cookie; `/auth/refresh`
 * rotates it (a new access token + a new cookie, the old one revoked); replaying a
 * rotated/logged-out/expired/missing cookie 401s; `/auth/logout` revokes + clears.
 * It mirrors the acceptance-check curls end to end.
 *
 * Harness copied VERBATIM from auth.controller.spec.ts (the house P-2 + P-6/L-6
 * shape) — copy the shape, don't re-derive it:
 *  - boot the REAL app via `createApp()` (NOT `Test.createTestingModule`) so the
 *    global `ValidationPipe` AND — critically for THIS suite — the `cookie-parser`
 *    middleware (both wired only in `createApp()`) are live; then `app.listen(0)`
 *    (ephemeral port) + drive it with Node's built-in `fetch` (no supertest);
 *  - `DATABASE_URL` → a per-run throwaway SQLite file (ABSOLUTE path, set BEFORE
 *    `createApp()` since `PrismaService` reads it when `PrismaClient` is built), the
 *    schema applied with `prisma db push --skip-generate` from `join(__dirname,
 *    '..', '..')` (= `apps/api`; this spec is at `src/auth/`, one level DEEPER than
 *    the `src/app.spec.ts` harness) so the gate never touches the shared dev.db;
 *  - teardown closes the app FIRST (frees the SQLite handle) THEN removes the temp
 *    dir and restores `DATABASE_URL`.
 *
 * The refresh cookie is read off the response via Node 26's `Headers.getSetCookie()`
 * and replayed as a `Cookie` request header — no cookie jar / no browser needed.
 * Expiry + rotation are proven WITHOUT sleeping (L-3): the expired path signs an
 * already-expired refresh JWT; the rotation path replays the OLD cookie after a
 * refresh and asserts 401.
 */
describe('Auth refresh loop (end-to-end)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  const validEmail = 'refresh@b.com';
  const validPassword = 'password123';

  const registerUrl = () => `${baseUrl}/auth/register`;
  const loginUrl = () => `${baseUrl}/auth/login`;
  const refreshUrl = () => `${baseUrl}/auth/refresh`;
  const logoutUrl = () => `${baseUrl}/auth/logout`;
  const meUrl = () => `${baseUrl}/auth/me`;

  const COOKIE_NAME = 'digimon.refreshToken';

  const jsonPost = (url: string, body: unknown, cookie?: string) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });

  /**
   * Pull the refresh cookie's `name=value` pair out of a response's Set-Cookie
   * header(s) so it can be replayed as a `Cookie` request header. `getSetCookie()`
   * (Node 18.14+/26) returns every Set-Cookie line intact; we take the first
   * attribute segment (before the first `;`) of the one for our cookie.
   */
  const extractRefreshCookie = (res: Response): string | undefined => {
    const setCookies = res.headers.getSetCookie();
    const line = setCookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));
    return line ? line.split(';')[0] : undefined;
  };

  /** True if the response's Set-Cookie CLEARS the refresh cookie (empty value). */
  const clearsRefreshCookie = (res: Response): boolean =>
    res.headers.getSetCookie().some((c) => c.startsWith(`${COOKIE_NAME}=;`));

  /** Register (once) then log in, returning the login response + its refresh cookie. */
  const login = async (): Promise<{ res: Response; cookie: string }> => {
    const res = await jsonPost(loginUrl(), {
      email: validEmail,
      password: validPassword,
    });
    const cookie = extractRefreshCookie(res);
    if (!cookie) throw new Error('login did not set a refresh cookie');
    return { res, cookie };
  };

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-refresh-e2e-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'refresh.db')}`;
    // src/auth/ → up two levels to apps/api (friction #2). Do NOT use '..' only.
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
      cwd: join(__dirname, '..', '..'),
      env: process.env,
      stdio: 'pipe',
    });

    // createApp() installs the global ValidationPipe AND cookie-parser (friction #2)
    // + the full AuthModule wiring — the same code path main.ts runs.
    app = await createApp();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    // R-15: the server owns the global `/api` prefix (createApp → setGlobalPrefix('api')),
    // so the REAL external addresses are /api/auth/* — the exact URLs the SPA calls over the
    // (rewrite-free) Vite dev proxy. Prefixing baseUrl once makes every `${baseUrl}/auth/...`
    // hit /api/auth/..., so this e2e is the regression cover: drop the prefix and it goes red.
    baseUrl = `http://127.0.0.1:${address.port}/api`;

    // One account the whole suite reuses (order-independent: every test either logs
    // in fresh or drives from a cookie it just obtained).
    const reg = await jsonPost(registerUrl(), {
      email: validEmail,
      password: validPassword,
    });
    expect(reg.status).toBe(201);
  });

  afterAll(async () => {
    await app?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('register sets a refresh cookie (HttpOnly, SameSite=Lax, Path=/) AND keeps the { id, email } body (invariant 5)', async () => {
    // A fresh account: register must both return the UNCHANGED body and set the cookie
    // so a register-then-use flow is durable in a single round-trip.
    const res = await jsonPost(registerUrl(), {
      email: 'fresh-register@b.com',
      password: validPassword,
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.id).toBe('string');
    expect(body.email).toBe('fresh-register@b.com');
    // The refresh token must NEVER appear in the JSON body — cookie only.
    expect(body).not.toHaveProperty('refreshToken');
    expect(body).not.toHaveProperty('accessToken'); // register returns id/email only

    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`));
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    // secure OFF in dev (COOKIE_SECURE unset in the gate) so the dev proxy works.
    expect(setCookie).not.toContain('Secure');
  });

  it('login returns { accessToken } UNCHANGED AND sets a refresh cookie', async () => {
    const res = await jsonPost(loginUrl(), {
      email: validEmail,
      password: validPassword,
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as LoginResponse & Record<string, unknown>;
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.length).toBeGreaterThan(0);
    // invariant 5: the login JSON is exactly { accessToken } — the refresh token is
    // cookie-only, never in the body.
    expect(body).not.toHaveProperty('refreshToken');

    const cookie = extractRefreshCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie?.startsWith(`${COOKIE_NAME}=`)).toBe(true);
  });

  it('POST /auth/refresh with the cookie → 200, a NEW access token, and a NEW rotated cookie', async () => {
    const { cookie } = await login();

    const res = await jsonPost(refreshUrl(), {}, cookie);
    expect(res.status).toBe(200);

    const body = (await res.json()) as RefreshResponse;
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.length).toBeGreaterThan(0);

    // The refresh minted a fresh access token that VERIFIES (via the app's own
    // JwtService, the access secret) and identifies the same user by email — proving
    // it is a real, usable session token, not an echo.
    const jwtService = app.get(JwtService);
    const payload = jwtService.verify<{ sub: string; email: string }>(body.accessToken);
    expect(payload.email).toBe(validEmail);

    // A new refresh cookie is set (rotation), and it DIFFERS from the presented one.
    const rotated = extractRefreshCookie(res);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(cookie);

    // And the new cookie itself works for a subsequent refresh (the chain continues).
    const again = await jsonPost(refreshUrl(), {}, rotated);
    expect(again.status).toBe(200);
  });

  it('replaying the OLD (rotated) cookie after a refresh → 401 (single-use rotation) and clears it', async () => {
    const { cookie } = await login();

    // First refresh consumes `cookie` and returns a successor.
    const first = await jsonPost(refreshUrl(), {}, cookie);
    expect(first.status).toBe(200);

    // Replaying the now-REVOKED original cookie must fail — its DB row was stamped
    // revokedAt during rotation, so the active-row lookup rejects it (no sleep; the
    // revocation is what makes it dead, not time). This is the reuse-detection signal.
    const replay = await jsonPost(refreshUrl(), {}, cookie);
    expect(replay.status).toBe(401);
    // The dead cookie is cleared so the browser stops resending it.
    expect(clearsRefreshCookie(replay)).toBe(true);
  });

  it('POST /auth/logout → 204, clears the cookie, and a subsequent refresh with that cookie → 401', async () => {
    const { cookie } = await login();

    const out = await jsonPost(logoutUrl(), {}, cookie);
    expect(out.status).toBe(204);
    expect(clearsRefreshCookie(out)).toBe(true);

    // The session is revoked server-side: the same cookie can no longer refresh.
    const afterLogout = await jsonPost(refreshUrl(), {}, cookie);
    expect(afterLogout.status).toBe(401);
  });

  it('POST /auth/logout with NO cookie → still 204 (idempotent) and clears', async () => {
    const out = await jsonPost(logoutUrl(), {});
    expect(out.status).toBe(204);
    expect(clearsRefreshCookie(out)).toBe(true);
  });

  it('POST /auth/refresh with NO cookie → 401', async () => {
    const res = await jsonPost(refreshUrl(), {});
    expect(res.status).toBe(401);
  });

  it('POST /auth/refresh with a GARBAGE cookie → 401', async () => {
    const res = await jsonPost(refreshUrl(), {}, `${COOKIE_NAME}=not-a-real-jwt`);
    expect(res.status).toBe(401);
  });

  it('POST /auth/refresh with an EXPIRED refresh cookie → 401 (no sleep; signed already-expired — L-3)', async () => {
    // Sign a refresh token that is already past its lifetime, using the SAME secret
    // the service verifies with (JWT_REFRESH_SECRET or its dev fallback). It verifies
    // structurally but fails the expiry check → 401, proving the expiry path without
    // a real wait. (Even had it not expired, no active DB row exists for it → 401.)
    const jwtService = app.get(JwtService);
    const refreshSecret =
      process.env.JWT_REFRESH_SECRET ?? 'dev-only-insecure-refresh-secret-change-me';
    const expired = jwtService.sign(
      { sub: 'someone' },
      { secret: refreshSecret, expiresIn: '-10s' },
    );

    const res = await jsonPost(refreshUrl(), {}, `${COOKIE_NAME}=${expired}`);
    expect(res.status).toBe(401);
  });

  it('GET /auth/me is UNCHANGED — reachable with a Bearer token minted via the refresh flow (invariant 5)', async () => {
    // The whole point: the access token obtained through refresh is a normal Bearer
    // token the UNCHANGED guarded route accepts, so the durable session is real.
    const { cookie } = await login();
    const refreshed = await jsonPost(refreshUrl(), {}, cookie);
    const { accessToken } = (await refreshed.json()) as RefreshResponse;

    const res = await fetch(meUrl(), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string };
    expect(body.email).toBe(validEmail);
  });
});
