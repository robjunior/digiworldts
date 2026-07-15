import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { bootHttpTestApp, type TempDatastore } from '../test/datastore';
import type { FriendView, FriendsResponse } from './social.types';

/**
 * Social friends API contract (TASK-44, R-11) — the runnable proof of the core social
 * fantasy: a player sends a friend request to another player BY EMAIL, the other player
 * ACCEPTS, and both then see each other in a friends list WITH a `lastSeenAt`-derived
 * `online` indicator. A self-request / unknown email / duplicate / non-addressee accept
 * is rejected and NOTHING invalid is written. It is the API TASK-45's `/friends` UI drives.
 *
 * Harness = the shared `bootHttpTestApp()` (P-2 + P-6) — the FIRST spec on the extracted
 * `apps/api/src/test/datastore.ts` helper (the e2e skill's primary path): it boots the
 * REAL app via `createApp()` (so the global ValidationPipe + the `/api` prefix are live —
 * the 400 case needs them) inside a hermetic per-run throwaway SQLite DB. The raw edge
 * rows are re-read through `app.get(PrismaService)` (they are internal, not on the API —
 * the L-3 escape hatch).
 *
 * The `online: true` proof is the load-bearing one: after player B calls `GET /auth/me`
 * (which stamps `B.lastSeenAt = now`), player A's friends list must show B online — this
 * proves BOTH the stamp side-effect on `/auth/me` AND the window derivation. A player who
 * never called `/auth/me` (A itself, only ever registering/logging in) shows offline.
 */
describe('Social friends API (end-to-end)', () => {
  let ds: TempDatastore;
  const url = (p: string) => `${ds.baseUrl}${p}`;

  const jsonPost = (path: string, body: unknown, token?: string) =>
    fetch(url(path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  /** POST a bodyless route (the accept), with an optional Bearer token. */
  const post = (path: string, token?: string) =>
    fetch(url(path), {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  /** Register + log in a fresh account → its access token (a real principal). */
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
    return accessToken;
  };

  /** `GET /api/auth/me` — its side-effect stamps the caller's `lastSeenAt = now`. */
  const callMe = async (token: string): Promise<void> => {
    const res = await fetch(url('/auth/me'), {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  };

  /** `GET /api/social/friends` → the caller's friends + incoming, with a token. */
  const getFriends = async (token?: string): Promise<Response> =>
    fetch(url('/social/friends'), {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  const friendsOf = async (token: string): Promise<FriendsResponse> => {
    const res = await getFriends(token);
    expect(res.status).toBe(200);
    return (await res.json()) as FriendsResponse;
  };

  // ── DB escape-hatch helpers (L-3) — the raw edges are internal, not on the API. ──
  const pendingEdgesBetween = async (): Promise<{ id: string; status: string }[]> => {
    const prisma = ds.app.get(PrismaService);
    return prisma.friendship.findMany({ where: { deletedAt: null } });
  };

  const edgeStatus = async (edgeId: string): Promise<string> => {
    const prisma = ds.app.get(PrismaService);
    const row = await prisma.friendship.findUnique({ where: { id: edgeId } });
    if (row === null) throw new Error(`test setup: no edge ${edgeId}`);
    return row.status;
  };

  /** Register A + B, and have A send a friend request to B → the created edge view. */
  const setUpRequest = async (
    aEmail: string,
    bEmail: string,
  ): Promise<{ aToken: string; bToken: string; edge: FriendView }> => {
    const aToken = await registerAndLogin(aEmail);
    const bToken = await registerAndLogin(bEmail);
    const res = await jsonPost('/social/friends/request', { email: bEmail }, aToken);
    expect(res.status).toBe(200);
    const edge = (await res.json()) as FriendView;
    return { aToken, bToken, edge };
  };

  beforeAll(async () => {
    ds = await bootHttpTestApp('social');
  });

  afterAll(async () => {
    await ds.dispose();
  });

  it('sends a request → 200 + exactly one pending edge, leak-safe', async () => {
    // Cases 1. A → B request creates ONE pending edge; the returned view is leak-safe (a
    // display name, never the counterpart's id/email).
    const { edge } = await setUpRequest('soc-a-req@example.test', 'soc-b-req@example.test');
    expect(edge.displayName).toBe('soc-b-req');
    const leaky = edge as unknown as Record<string, unknown>;
    expect(leaky).not.toHaveProperty('email');
    expect(leaky).not.toHaveProperty('addresseeId');

    const edges = await pendingEdgesBetween();
    expect(edges).toHaveLength(1);
    expect(edges[0]!.status).toBe('pending');
  });

  it('accept by the addressee → 200; both list the other + online derives from /auth/me', async () => {
    // Cases 2 + 3 (the headline). B accepts A's request; both then see the other as an
    // accepted friend. After B calls /auth/me (stamping B.lastSeenAt=now), A's list shows
    // B online:true — proving the stamp + the window. A never called /auth/me, so B's
    // list shows A online:false.
    const { aToken, bToken, edge } = await setUpRequest(
      'soc-a-acc@example.test',
      'soc-b-acc@example.test',
    );

    const accepted = await post(`/social/friends/${edge.id}/accept`, bToken);
    expect(accepted.status).toBe(200);
    const acceptedView = (await accepted.json()) as FriendView;
    // The addressee (B) just befriended the REQUESTER (A) → counterpart is A.
    expect(acceptedView.displayName).toBe('soc-a-acc');
    expect(await edgeStatus(edge.id)).toBe('accepted');

    // B calls /auth/me → stamps B.lastSeenAt = now (the presence side-effect).
    await callMe(bToken);

    // A's friends list: B present + online (seen within the window).
    const aFriends = await friendsOf(aToken);
    expect(aFriends.friends).toHaveLength(1);
    expect(aFriends.friends[0]!.displayName).toBe('soc-b-acc');
    expect(aFriends.friends[0]!.online).toBe(true);
    // A has no incoming requests (A was the requester).
    expect(aFriends.incoming).toHaveLength(0);

    // B's friends list: A present but offline (A only registered/logged in — never
    // called /auth/me, so A.lastSeenAt is NULL → offline).
    const bFriends = await friendsOf(bToken);
    expect(bFriends.friends).toHaveLength(1);
    expect(bFriends.friends[0]!.displayName).toBe('soc-a-acc');
    expect(bFriends.friends[0]!.online).toBe(false);
  });

  it('shows an incoming pending request to the addressee (not yet accepted)', async () => {
    // A→B request: B's list shows it under `incoming` (pending), A's shows nothing yet.
    const { aToken, bToken } = await setUpRequest(
      'soc-a-inc@example.test',
      'soc-b-inc@example.test',
    );

    const bFriends = await friendsOf(bToken);
    expect(bFriends.friends).toHaveLength(0);
    expect(bFriends.incoming).toHaveLength(1);
    expect(bFriends.incoming[0]!.displayName).toBe('soc-a-inc');

    // The requester (A) sees no incoming (they sent it) and no accepted friend yet.
    const aFriends = await friendsOf(aToken);
    expect(aFriends.friends).toHaveLength(0);
    expect(aFriends.incoming).toHaveLength(0);
  });

  it('rejects a self-request → 422 and nothing is written', async () => {
    // Case: befriending yourself is a 422 before any write.
    const email = 'soc-self@example.test';
    const token = await registerAndLogin(email);
    const res = await jsonPost('/social/friends/request', { email }, token);
    expect(res.status).toBe(422);
    // No edge created anywhere for this player.
    const prisma = ds.app.get(PrismaService);
    const user = await prisma.user.findFirst({ where: { email } });
    const edges = await prisma.friendship.findMany({
      where: { OR: [{ requesterId: user!.id }, { addresseeId: user!.id }] },
    });
    expect(edges).toHaveLength(0);
  });

  it('rejects an unknown email → 404', async () => {
    const token = await registerAndLogin('soc-unknown-sender@example.test');
    const res = await jsonPost(
      '/social/friends/request',
      { email: 'nobody-here@example.test' },
      token,
    );
    expect(res.status).toBe(404);
  });

  it('rejects a duplicate request in EITHER direction → 409', async () => {
    // A→B twice → 409; and B→A (reverse) while A→B exists → 409 (the app-level guard).
    const aEmail = 'soc-a-dup@example.test';
    const bEmail = 'soc-b-dup@example.test';
    const { aToken, bToken } = await setUpRequest(aEmail, bEmail);

    // Same-direction duplicate.
    const again = await jsonPost('/social/friends/request', { email: bEmail }, aToken);
    expect(again.status).toBe(409);

    // Reverse-direction duplicate (B→A while A→B is pending).
    const reverse = await jsonPost('/social/friends/request', { email: aEmail }, bToken);
    expect(reverse.status).toBe(409);
  });

  it('rejects an accept by a NON-addressee → 403 and the edge is unchanged', async () => {
    // The requester (A) cannot accept their own request; a third party cannot either.
    const { aToken, edge } = await setUpRequest('soc-a-403@example.test', 'soc-b-403@example.test');
    // A (the requester) tries to accept → 403.
    const byRequester = await post(`/social/friends/${edge.id}/accept`, aToken);
    expect(byRequester.status).toBe(403);

    // A third party tries to accept → 403.
    const cToken = await registerAndLogin('soc-c-403@example.test');
    const byThird = await post(`/social/friends/${edge.id}/accept`, cToken);
    expect(byThird.status).toBe(403);

    // The edge is still pending (nothing mutated).
    expect(await edgeStatus(edge.id)).toBe('pending');
  });

  it('rejects a malformed request body → 400 (the expectedType ValidationPipe runs)', async () => {
    // The P-7 guard: a missing/invalid email is rejected by the parameter-scoped
    // ValidationPipe BEFORE the handler (if silently skipped, a bad body would 2xx).
    const token = await registerAndLogin('soc-badbody@example.test');
    expect((await jsonPost('/social/friends/request', {}, token)).status).toBe(400);
    expect(
      (await jsonPost('/social/friends/request', { email: 'not-an-email' }, token)).status,
    ).toBe(400);
  });

  it('rejects unauthenticated access to all three routes → 401', async () => {
    // No Authorization header: the request, the accept, and the friends list are all
    // unreachable — the reused JwtAuthGuard is live on every route.
    expect((await jsonPost('/social/friends/request', { email: 'x@y.test' })).status).toBe(401);
    expect((await post('/social/friends/some-id/accept')).status).toBe(401);
    expect((await getFriends()).status).toBe(401);
  });
});
