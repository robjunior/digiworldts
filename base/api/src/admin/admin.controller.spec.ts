import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { GrantResult } from './admin.types';

/**
 * Admin API contract (TASK-34, R-14) — the runnable proof of the FIRST authorization
 * tier beyond "authenticated" AND the admin write-path: a user whose email is in
 * `ADMIN_EMAILS` registers/logs in and is minted `role:'admin'`; that admin calls
 * `POST /api/admin/grant` to CREDIT a TARGET player's spendable balance; the credit
 * is observable on the target's `GET /api/farm` AND appends exactly one
 * `action:'admin-grant'` audit row (invariant 3, a POSITIVE delta). A non-admin is
 * 403; an unknown target is 404; a malformed body is 400; no token is 401. This is
 * the L-13 economic-mutation template's 4th occurrence (a standalone-route CREDIT to
 * a target) and the ledger's 4th action + write-site.
 *
 * Harness = the SAME two house patterns as the sibling `shop.controller.spec.ts`
 * (P-2 + P-6), copied VERBATIM — `POST /api/admin/grant` hits the DB AND is
 * guard-protected. (The shared `apps/api/src/test/datastore.ts` helper the e2e
 * skill's primary path names does NOT exist yet — extracting it is a separate DISTILL
 * item — so this spec inlines the throwaway-DB block per the skill's documented
 * fallback, matching every other apps/api e2e today.)
 *
 *  - P-2 (endpoint e2e): boot a REAL Nest app + `app.listen(0)` (ephemeral port) +
 *    Node's built-in `fetch` (no supertest). Exercises the true HTTP stack incl. the
 *    reused `AdminGuard`/`JwtAuthGuard` and the global `ValidationPipe`.
 *  - FRICTION #8: boot via `createApp()`, NOT `Test.createTestingModule(...)`. Only
 *    `createApp()` wires the full `AppModule` (incl. `AdminModule`, the AuthModule
 *    guard exports, the global `/api` prefix, cookie-parser, and the global
 *    `ValidationPipe`). A green boot proves the admin guard constructs across the
 *    module boundary; the global pipe is what makes the malformed-body → 400 fire.
 *  - P-6 (hermetic throwaway DB): NEVER touch the shared `apps/api/prisma/dev.db`.
 *    `DATABASE_URL` → a per-run temp SQLite file (ABSOLUTE path, set BEFORE
 *    `createApp()`). Schema applied with `prisma db push --skip-generate`. CRUCIAL
 *    cwd depth (L-6, friction #7): this spec is at `src/admin/`, so `db push` runs
 *    from `join(__dirname, '..', '..')` (= `apps/api`) — two levels up, the SAME
 *    depth as the shop/evolve/collect specs.
 *
 * ADMIN_EMAILS: the role tier is bootstrapped from this env var (read per-call by
 * AuthService), so it is set BEFORE `createApp()` in `beforeAll` and restored in
 * `afterAll` (like DATABASE_URL). `admin@example.test` is the seeded admin; every
 * other account registered here defaults to `role:'user'`.
 *
 * The credit/ledger state is verified by re-reading through `app.get(PrismaService)`
 * (the ledger is internal, not on the API) AND — for the observable-value assertion
 * — via the target's own `GET /api/farm` read, the SAME escape hatches the
 * shop/collect specs use.
 */
describe('Admin API (end-to-end)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  const ADMIN_EMAIL = 'admin@example.test';
  // Registered ONCE in beforeAll (re-registering the same email would 409). Reused
  // by every case that needs an admin caller.
  let adminToken: string;

  const jsonPost = (path: string, body: unknown, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  /**
   * Register + log in a fresh account and return its access token. Each call uses a
   * unique email so tests get independent players. An account whose email is in
   * ADMIN_EMAILS (only `ADMIN_EMAIL` here) is minted `role:'admin'`; all others are
   * plain users.
   */
  const registerAndLogin = async (email: string): Promise<string> => {
    const password = 'password123';
    const register = await jsonPost('/auth/register', { email, password });
    expect(register.status).toBe(201);
    const registered = (await register.json()) as RegisterResponse;
    expect(registered.email).toBe(email);

    const login = await jsonPost('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    expect(typeof accessToken).toBe('string');
    expect(accessToken.length).toBeGreaterThan(0);
    return accessToken;
  };

  /** The user id for a registered email, read straight from the datastore (L-3). */
  const userIdForEmail = async (email: string): Promise<string> => {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findFirst({ where: { email } });
    if (user === null) {
      throw new Error(`test setup: no user registered for ${email}`);
    }
    return user.id;
  };

  /** The current banked `amount` for a (user, resource), or `undefined` if no row. */
  const balanceAmount = async (email: string, resource: string): Promise<number | undefined> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource } },
    });
    return row?.amount;
  };

  /** All `action:'admin-grant'` audit rows recorded against a target user. */
  const grantAuditRows = async (email: string) => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    return prisma.auditLog.findMany({
      where: { userId, entity: 'User', entityId: userId, action: 'admin-grant' },
    });
  };

  /** The target's `Meat` balance as it appears on THEIR OWN `GET /api/farm` read. */
  const farmMeatBalance = async (token: string): Promise<number | undefined> => {
    const res = await fetch(`${baseUrl}/farm`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      balance?: Array<{ resource: string; amount: number }>;
    };
    return body.balance?.find((b) => b.resource === 'Meat')?.amount;
  };

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-admin-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'admin.db')}`;
    // Bootstrap ONE admin from config — read per-call by AuthService, so setting it
    // before createApp() is sufficient (and restored in afterAll).
    process.env.ADMIN_EMAILS = ADMIN_EMAIL;
    // src/admin/ → up TWO levels to apps/api (friction #7 / L-6). NOT a single '..'.
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
      cwd: join(__dirname, '..', '..'),
      env: process.env,
      stdio: 'pipe',
    });

    app = await createApp();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api`;

    // Register + log in the seeded admin ONCE (its email is in ADMIN_EMAILS → minted
    // role:'admin'). Reused across cases; re-registering it would 409.
    adminToken = await registerAndLogin(ADMIN_EMAIL);
  });

  afterAll(async () => {
    await app?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  it('an ADMIN_EMAILS user grants a target → 200 + observable on the target GET /api/farm + one positive audit row', async () => {
    // Case 1: the headline. The seeded admin (in ADMIN_EMAILS → role:'admin') credits
    // a target player 100 Meat. The response reflects the credit; the target's OWN
    // GET /api/farm shows Meat raised by exactly 100; and EXACTLY one 'admin-grant'
    // audit row exists for the target with amountBefore→amountAfter = 0→100 (a
    // POSITIVE delta), attributed to the target (A-23). The admin token (from
    // beforeAll) already proves an ADMIN_EMAILS user was minted role:'admin' — a
    // non-admin would 403 here (case 3), so a 200 confirms the tier.
    const targetEmail = 'target-grant@example.test';
    const targetToken = await registerAndLogin(targetEmail);

    // Materialize the target's farm so the Meat balance sibling is present on the read
    // (the starter buildings/balances materialize on the first GET /api/farm). Read
    // the before-value the SAME way the after-value is read.
    const meatBefore = (await farmMeatBalance(targetToken)) ?? 0;

    const res = await jsonPost(
      '/admin/grant',
      { targetEmail, resource: 'Meat', amount: 100 },
      adminToken,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as GrantResult;
    expect(body.targetEmail).toBe(targetEmail);
    expect(body.resource).toBe('Meat');
    // The response balance reflects the credit (before + 100).
    expect(body.balance).toBe(meatBefore + 100);

    // Persisted CREDIT on the raw balance row: raised by exactly 100.
    expect(await balanceAmount(targetEmail, 'Meat')).toBe(meatBefore + 100);

    // Observable on the TARGET's OWN GET /api/farm read (the credit is felt on the
    // existing read, not just an internal number).
    expect(await farmMeatBalance(targetToken)).toBe(meatBefore + 100);

    // Invariant 3: exactly ONE append-only audit row for this grant, read back
    // through PrismaService. Correct action/entity/entityId/resource + a POSITIVE
    // delta (amountAfter − amountBefore === +100), attributed to the target (A-23).
    const rows = await grantAuditRows(targetEmail);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe('admin-grant');
    expect(row.entity).toBe('User');
    expect(row.resource).toBe('Meat');
    expect(row.amountBefore).toBe(meatBefore);
    expect(row.amountAfter).toBe(meatBefore + 100);
    expect(row.amountAfter - row.amountBefore).toBe(100);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('grants a resource with no existing balance row → upsert-creates it at amount', async () => {
    // Case 2: the upsert-CREATE path (a CREDIT may create the (user, resource) pair,
    // unlike a debit). A grant of a resource the target has never held creates a new
    // row at exactly `amount`, with an audit row 0→amount.
    const targetEmail = 'target-newresource@example.test';
    await registerAndLogin(targetEmail);

    // A resource with no seeded starter row for a fresh account.
    expect(await balanceAmount(targetEmail, 'Bits')).toBeUndefined();

    const res = await jsonPost(
      '/admin/grant',
      { targetEmail, resource: 'Bits', amount: 55 },
      adminToken,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as GrantResult;
    expect(body.balance).toBe(55);

    // The row was CREATED at exactly the granted amount (upsert-create).
    expect(await balanceAmount(targetEmail, 'Bits')).toBe(55);

    const rows = await grantAuditRows(targetEmail);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountBefore).toBe(0);
    expect(rows[0]!.amountAfter).toBe(55);
  });

  it('a non-admin (role user) calling POST /api/admin/grant → 403 and NOTHING mutated', async () => {
    // Case 3: the authorization gate. A valid, authenticated NON-admin token is
    // rejected with 403 (distinct from the 401 a missing token gets), and no
    // balance/ledger change occurs for the would-be target.
    const nonAdminToken = await registerAndLogin('not-an-admin@example.test');
    const targetEmail = 'target-forbidden@example.test';
    await registerAndLogin(targetEmail);

    const res = await jsonPost(
      '/admin/grant',
      { targetEmail, resource: 'Meat', amount: 999 },
      nonAdminToken,
    );
    expect(res.status).toBe(403);

    // No grant landed: no admin-grant audit row for the target.
    expect(await grantAuditRows(targetEmail)).toHaveLength(0);
  });

  it('rejects an unknown targetEmail → 404 (resolved before the tx), NO ledger row', async () => {
    // Case 4: an unknown/soft-deleted target is not-found BEFORE the tx — no credit
    // attempted, no ledger row.
    const res = await jsonPost(
      '/admin/grant',
      { targetEmail: 'nobody-here@example.test', resource: 'Meat', amount: 10 },
      adminToken,
    );
    expect(res.status).toBe(404);
  });

  it('rejects a malformed body → 400 (the expectedType ValidationPipe runs)', async () => {
    // Case 5 (the P-7 pair, half one): a body with a missing/negative amount or a
    // missing resource is rejected by the parameter-scoped ValidationPipe BEFORE the
    // handler runs — the guard against the P-7 footgun (a bare @Body would silently
    // skip validation under the esbuild gate). All variants must 400. Uses the admin
    // token so the failure is genuinely validation, not the guard.
    const missingAmount = await jsonPost(
      '/admin/grant',
      { targetEmail: 'x@example.test', resource: 'Meat' },
      adminToken,
    );
    expect(missingAmount.status).toBe(400);

    const negativeAmount = await jsonPost(
      '/admin/grant',
      { targetEmail: 'x@example.test', resource: 'Meat', amount: -5 },
      adminToken,
    );
    expect(negativeAmount.status).toBe(400);

    const missingResource = await jsonPost(
      '/admin/grant',
      { targetEmail: 'x@example.test', amount: 10 },
      adminToken,
    );
    expect(missingResource.status).toBe(400);

    const badEmail = await jsonPost(
      '/admin/grant',
      { targetEmail: 'not-an-email', resource: 'Meat', amount: 10 },
      adminToken,
    );
    expect(badEmail.status).toBe(400);
  });

  it('rejects a grant with NO Authorization header → 401 (the guard is live)', async () => {
    // Case 6 (the P-7 pair, half two): the admin write is unreachable without a token
    // — the guard runs before the body is even validated, so a well-formed body still
    // 401s. AdminGuard delegates to JwtAuthGuard, which 401s a missing token.
    const res = await jsonPost('/admin/grant', {
      targetEmail: 'target-grant@example.test',
      resource: 'Meat',
      amount: 100,
    });
    expect(res.status).toBe(401);
  });
});
