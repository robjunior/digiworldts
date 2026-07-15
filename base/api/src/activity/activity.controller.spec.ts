import { afterAll, beforeAll, describe, expect, it } from 'vitest';import { bootHttpTestApp } from '../test/datastore';
import type { LoginResponse } from '../auth/auth.types';
import type { ActivityFeed } from './activity.types';

/**
 * `/activity` API contract (TASK-248, R-31 — the SIXTH & LAST dual-sidebar rail) — the
 * runnable proof of the owner-scoped, READ-ONLY activity feed: `GET /activity` returns the
 * caller's recent audited actions, does NOT leak another player's rows (owner-scoping), and
 * 401s an unauthenticated request.
 *
 * Harness = the shared `bootHttpTestApp()` (P-2 + P-6, the `nest-e2e-and-datastore-tests`
 * helper): boots the FULL app via `createApp()` (so the reused JwtAuthGuard + the explicit
 * @Inject DI are LIVE — a bare Test-module boot would make the 401/DI assertions
 * meaningless) inside a hermetic per-run throwaway SQLite DB. `baseUrl` already carries the
 * `/api` global prefix.
 *
 * We seed a real audited row the honest way: drive ONE economic mutation (`POST /daily/claim`,
 * which writes a `daily-claim` AuditLog row via the L-13 template) and then read it back
 * through `GET /activity`. This proves the endpoint projects the SAME append-only ledger the
 * mutations write — it is not a fabricated shape.
 */
describe('Activity feed API (end-to-end)', () => {
  let baseUrl: string;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    const ds = await bootHttpTestApp('activity');
    baseUrl = ds.baseUrl;
    dispose = ds.dispose;
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

  /** Register + log in a fresh account and return its access token. */
  const registerAndLogin = async (email: string): Promise<string> => {
    const password = 'password123';
    const register = await jsonPost('/auth/register', { email, password });
    expect(register.status).toBe(201);
    const login = await jsonPost('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    expect(typeof accessToken).toBe('string');
    expect(accessToken.length).toBeGreaterThan(0);
    return accessToken;
  };

  const getActivity = (token?: string) =>
    fetch(`${baseUrl}/activity`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  // No-body POST — a missing token means an empty header set → 401.
  const claimDaily = (token: string) =>
    fetch(`${baseUrl}/daily/claim`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });

  it('GET /activity returns the caller\'s audited action after a real mutation', async () => {
    const token = await registerAndLogin('activity-a@example.com');

    // Fresh account: no activity yet.
    const empty = await getActivity(token);
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as ActivityFeed).entries).toHaveLength(0);

    // Drive ONE audited mutation, then read it back through the feed.
    const claim = await claimDaily(token);
    expect(claim.status).toBe(200);

    const res = await getActivity(token);
    expect(res.status).toBe(200);
    const feed = (await res.json()) as ActivityFeed;
    expect(feed.entries.length).toBeGreaterThanOrEqual(1);
    const row = feed.entries.find((e) => e.action === 'daily-claim');
    expect(row).toBeDefined();
    // The projected AuditLog row surfaces the resource + the after-half of invariant 3.
    expect(typeof row?.resource).toBe('string');
    expect(row?.amountAfter).toBeGreaterThan(row?.amountBefore ?? 0);
    expect(typeof row?.createdAt).toBe('string');
  });

  it('is owner-scoped — B does NOT see A\'s rows', async () => {
    const tokenA = await registerAndLogin('activity-owner-a@example.com');
    await claimDaily(tokenA); // A gets an audited row

    const tokenB = await registerAndLogin('activity-owner-b@example.com');
    const res = await getActivity(tokenB);
    expect(res.status).toBe(200);
    const feed = (await res.json()) as ActivityFeed;
    // B claimed nothing → B's feed is empty; A's rows never leak across the JWT boundary.
    expect(feed.entries).toHaveLength(0);
  });

  it('an unauthenticated GET /activity is refused (401 — guard active)', async () => {
    const res = await getActivity(); // no Authorization header
    expect(res.status).toBe(401);
  });
});
