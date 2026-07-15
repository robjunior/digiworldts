import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootHttpTestApp } from '../test/datastore';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { DAILY_REWARDS } from './daily.rewards';
import type { DailyClaimResult, DailyState } from './daily.types';

/**
 * `/daily` API contract (TASK-235, R-40) — the runnable proof of the server-authoritative
 * daily-reward claim loop: `GET /daily` reads the streak state, `POST /daily/claim` grants
 * the current streak-day's reward once per UTC calendar day (advance + CREDIT + audit),
 * refuses a second same-day claim, and 401s an unauthenticated claim.
 *
 * Harness = the shared `bootHttpTestApp()` (P-2 + P-6, the `nest-e2e-and-datastore-tests`
 * helper): boots the FULL app via `createApp()` (so the global ValidationPipe + the reused
 * JwtAuthGuard + the explicit @Inject DI are all LIVE — a bare Test-module boot would make
 * the 401/DI assertions meaningless) inside a hermetic per-run throwaway SQLite DB. NOTE
 * `baseUrl` already carries the `/api` global prefix.
 *
 * Value-move assertions read the datastore directly via `app.get(PrismaService)`: the
 * credited `ResourceBalance` row and exactly one append-only `daily-claim` `AuditLog` row
 * (invariant 3), and — the load-bearing atomic-rollback proof — that a refused second
 * same-day claim leaves the balance UNCHANGED and writes NO second audit row.
 */
describe('Daily reward API (end-to-end)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let dispose: () => Promise<void>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ds = await bootHttpTestApp('daily');
    app = ds.app;
    baseUrl = ds.baseUrl;
    dispose = ds.dispose;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await dispose();
  });

  const jsonPost = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** Register + log in a fresh account and return its access token + user id. */
  const registerAndLogin = async (
    email: string,
  ): Promise<{ token: string; userId: string }> => {
    const password = 'password123';
    const register = await jsonPost('/auth/register', { email, password });
    expect(register.status).toBe(201);
    const registered = (await register.json()) as RegisterResponse;

    const login = await jsonPost('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    expect(typeof accessToken).toBe('string');
    expect(accessToken.length).toBeGreaterThan(0);
    return { token: accessToken, userId: registered.id };
  };

  const getDaily = (token?: string) =>
    fetch(`${baseUrl}/daily`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  // The claim endpoint takes NO body — a missing token means an empty header set → 401.
  const claim = (token?: string) =>
    fetch(`${baseUrl}/daily/claim`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  const balanceAmount = async (userId: string, resource: string): Promise<number> => {
    const row = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource } },
    });
    return row?.amount ?? 0;
  };

  it('GET /daily returns the initial never-claimed streak state + the 7-entry table', async () => {
    const { token } = await registerAndLogin('daily-initial@example.com');
    const res = await getDaily(token);
    expect(res.status).toBe(200);
    const state = (await res.json()) as DailyState;
    expect(state.streakDay).toBe(0);
    expect(state.claimedToday).toBe(false);
    expect(state.nextDay).toBe(1);
    expect(state.rewards).toHaveLength(7);
    expect(state.rewards[0]).toEqual(DAILY_REWARDS[0]);
  });

  it('POST /daily/claim grants day-1 reward, credits the balance, and writes ONE audit row', async () => {
    const { token, userId } = await registerAndLogin('daily-claim@example.com');
    const day1 = DAILY_REWARDS[0];
    const before = await balanceAmount(userId, day1.resource);

    const res = await claim(token);
    expect(res.status).toBe(200);
    const result = (await res.json()) as DailyClaimResult;
    expect(result.streakDay).toBe(1);
    expect(result.claimedToday).toBe(true);
    expect(result.nextDay).toBe(2);
    expect(result.granted).toEqual(day1);

    // The credit is observable on the datastore: balance increased by exactly the amount.
    const after = await balanceAmount(userId, day1.resource);
    expect(after).toBe(before + day1.amount);

    // Exactly one append-only 'daily-claim' audit row (invariant 3), a POSITIVE delta.
    const rows = await prisma.auditLog.findMany({
      where: { userId, action: 'daily-claim' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].resource).toBe(day1.resource);
    expect(rows[0].amountAfter - rows[0].amountBefore).toBe(day1.amount);

    // GET now reflects claimedToday: true.
    const stateRes = await getDaily(token);
    const state = (await stateRes.json()) as DailyState;
    expect(state.streakDay).toBe(1);
    expect(state.claimedToday).toBe(true);
  });

  it('a SECOND same-day claim is refused (409) with NO further credit and NO second audit row', async () => {
    const { token, userId } = await registerAndLogin('daily-twice@example.com');
    const day1 = DAILY_REWARDS[0];

    const first = await claim(token);
    expect(first.status).toBe(200);
    const afterFirst = await balanceAmount(userId, day1.resource);

    const second = await claim(token);
    expect(second.status).toBe(409);

    // Atomic-rollback proof: the balance is UNCHANGED and there is still exactly ONE row.
    const afterSecond = await balanceAmount(userId, day1.resource);
    expect(afterSecond).toBe(afterFirst);
    const rows = await prisma.auditLog.findMany({
      where: { userId, action: 'daily-claim' },
    });
    expect(rows).toHaveLength(1);
  });

  it('an unauthenticated claim is refused (401 — guard active)', async () => {
    const res = await claim(); // no Authorization header
    expect(res.status).toBe(401);
  });
});
