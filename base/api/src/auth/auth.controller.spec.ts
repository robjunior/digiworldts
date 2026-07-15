import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { LoginResponse, MeResponse, RegisterResponse } from './auth.types';

/**
 * Auth loop contract (TASK-5, R-2). The runnable proof of the server-side account
 * loop: register → log in → reach a protected endpoint that 401s without a valid
 * token. It mirrors the mock acceptance-check curls end to end.
 *
 * Two house patterns are combined here, and two of the three build-time frictions
 * D-14 called out are defused directly:
 *
 *  - P-2 (endpoint e2e): boot a REAL Nest app + `app.listen(0)` (ephemeral port,
 *    never collides with :3000 or a parallel run) + drive it with Node's built-in
 *    `fetch` (no supertest in the toolchain). This exercises the true HTTP stack —
 *    routing, status codes, JSON, AND the guard + validation pipe.
 *
 *  - FRICTION #1 (the ValidationPipe gap — the most likely red gate): we boot via
 *    `createApp()`, NOT `Test.createTestingModule(...).createNestApplication()`.
 *    The global `ValidationPipe({ whitelist, transform })` lives ONLY in
 *    `createApp()`; the testing-module path would NOT install it, so DTO-rejection
 *    (400) assertions would silently never fire. `createApp()` wires the full
 *    `AppModule` (which now imports `AuthModule`), so the pipe, CORS and every
 *    module are exactly what production runs.
 *
 *  - P-6 + FRICTION #2 (hermetic throwaway DB): the suite must NEVER touch the
 *    shared `apps/api/prisma/dev.db` and must be fast + deterministic (L-3/L-6).
 *    So `DATABASE_URL` points at a per-run temp SQLite file (ABSOLUTE path, so the
 *    CLI — which resolves a relative url against the schema dir — and the runtime
 *    client — which resolves against CWD — agree; `createApp()` passes an already
 *    absolute file: url through untouched). We apply the schema with
 *    `prisma db push --skip-generate`. CRUCIAL cwd depth: this spec lives at
 *    `src/auth/`, so `prisma db push` must run from `join(__dirname, '..', '..')`
 *    (= `apps/api`, where `schema.prisma` is) — one level DEEPER than the
 *    `src/app.spec.ts` harness (`join(__dirname, '..')`). Getting this wrong points
 *    at the wrong dir and fails `db push`. `DATABASE_URL` is set BEFORE `createApp`
 *    because `PrismaService` reads it the moment `PrismaClient` is constructed.
 *
 * Teardown closes the app FIRST (PrismaService.onModuleDestroy → $disconnect frees
 * the SQLite handle) THEN removes the temp dir and restores `DATABASE_URL`.
 */
describe('Auth API (end-to-end)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  const validEmail = 'a@b.com';
  const validPassword = 'password123';

  const registerUrl = () => `${baseUrl}/auth/register`;
  const loginUrl = () => `${baseUrl}/auth/login`;
  const meUrl = () => `${baseUrl}/auth/me`;

  const jsonPost = (url: string, body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-auth-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'auth.db')}`;
    // src/auth/ → up two levels to apps/api (friction #2). Do NOT use '..' only.
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
      cwd: join(__dirname, '..', '..'),
      env: process.env,
      stdio: 'pipe',
    });

    // createApp() installs the global ValidationPipe (friction #1) and the full
    // AuthModule wiring — the same code path main.ts runs.
    app = await createApp();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    // R-15: the server owns the global `/api` prefix (createApp → setGlobalPrefix('api')),
    // so the REAL external addresses are /api/auth/* — the exact URLs the SPA calls over the
    // (rewrite-free) Vite dev proxy. Prefixing baseUrl once makes every `${baseUrl}/auth/...`
    // hit /api/auth/..., so this e2e is the regression cover: drop the prefix and it goes red.
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  afterAll(async () => {
    await app?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('registers a new user → 201 { id, email } and NEVER leaks the password hash', async () => {
    const res = await jsonPost(registerUrl(), {
      email: validEmail,
      password: validPassword,
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as RegisterResponse & Record<string, unknown>;
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
    expect(body.email).toBe(validEmail);
    // The credential must never cross the API boundary in any form.
    expect(body).not.toHaveProperty('passwordHash');
    expect(body).not.toHaveProperty('password');
  });

  it('rejects a duplicate email with a clean 409 (not a 500)', async () => {
    // validEmail was created by the previous test; re-registering must conflict.
    const res = await jsonPost(registerUrl(), {
      email: validEmail,
      password: validPassword,
    });
    expect(res.status).toBe(409);
  });

  it('treats email as case-insensitive when detecting duplicates', async () => {
    // Same address, different case → the service lowercases before insert, so the
    // @unique constraint still fires → 409 (proves normalization, not a new row).
    const res = await jsonPost(registerUrl(), {
      email: validEmail.toUpperCase(),
      password: validPassword,
    });
    expect(res.status).toBe(409);
  });

  it('rejects a malformed body via the ValidationPipe → 400 (proves friction #1 boot)', async () => {
    // Bad email AND a too-short password. If the ValidationPipe were not active
    // (the testing-module boot trap), this would reach the handler and NOT be a
    // 400 — so this assertion is the guard on the friction-#1 boot choice.
    const badEmail = await jsonPost(registerUrl(), {
      email: 'not-an-email',
      password: validPassword,
    });
    expect(badEmail.status).toBe(400);

    const shortPassword = await jsonPost(registerUrl(), {
      email: 'fresh@example.test',
      password: 'short',
    });
    expect(shortPassword.status).toBe(400);
  });

  it('logs in with correct credentials → 200 { accessToken } that decodes to the user', async () => {
    const res = await jsonPost(loginUrl(), {
      email: validEmail,
      password: validPassword,
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as LoginResponse;
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.length).toBeGreaterThan(0);

    // Decode (via the app's own JwtService — same secret) to prove it is a real,
    // verifiable JWT carrying the expected claims. No sleep is used anywhere to
    // test expiry (L-3); the expired-token 401 path is proven below with a token
    // we sign already-expired.
    const jwtService = app.get(JwtService);
    const payload = jwtService.verify<{ sub: string; email: string }>(body.accessToken);
    expect(payload.email).toBe(validEmail);
    expect(typeof payload.sub).toBe('string');
    expect(payload.sub.length).toBeGreaterThan(0);
  });

  it('rejects login with a wrong password → 401', async () => {
    const res = await jsonPost(loginUrl(), {
      email: validEmail,
      password: 'wrong-password-entirely',
    });
    expect(res.status).toBe(401);
  });

  it('rejects login for an unknown email → 401 (same status, no enumeration)', async () => {
    const res = await jsonPost(loginUrl(), {
      email: 'nobody@example.test',
      password: validPassword,
    });
    expect(res.status).toBe(401);
  });

  it('reaches GET /auth/me with a valid Bearer token → 200 { id, email }', async () => {
    const login = await jsonPost(loginUrl(), {
      email: validEmail,
      password: validPassword,
    });
    const { accessToken } = (await login.json()) as LoginResponse;

    const res = await fetch(meUrl(), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as MeResponse & Record<string, unknown>;
    expect(body.email).toBe(validEmail);
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('passwordHash');
  });

  it('rejects GET /auth/me with NO Authorization header → 401', async () => {
    const res = await fetch(meUrl());
    expect(res.status).toBe(401);
  });

  it('rejects GET /auth/me with a garbage token → 401', async () => {
    const res = await fetch(meUrl(), {
      headers: { authorization: 'Bearer not-a-real-jwt' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects GET /auth/me with an EXPIRED token → 401 (no sleep; token signed already-expired)', async () => {
    // Prove the expiry path deterministically: sign a token that is already past
    // its lifetime (negative expiresIn) via the app's JwtService, rather than
    // issuing a real one and sleeping past its TTL (L-3 — no slow/flaky sleeps).
    const jwtService = app.get(JwtService);
    const expiredToken = jwtService.sign(
      { sub: 'someone', email: validEmail },
      { expiresIn: '-10s' },
    );

    const res = await fetch(meUrl(), {
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(res.status).toBe(401);
  });
});
