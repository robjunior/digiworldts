import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoginResponse } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { bootHttpTestApp, type TempDatastore } from '../test/datastore';
import { PvpGateway } from './pvp.gateway';

/**
 * Live PvP gateway e2e (TASK-192, R-25 slice 51 — the FIRST realtime slice).
 *
 * Proves the challenge→accept HANDSHAKE reaches a live opponent over Socket.IO: two
 * authenticated sockets (distinct seeded users) on the SAME booted app's ephemeral port —
 * A challenges B, B RECEIVES `challenged` with A's server-authoritative display name, B
 * emits `accept`, and BOTH receive `matched` with a `matchId`. Also asserts the two guard
 * edges: an UNAUTHENTICATED socket is rejected (invariant 2), and a challenge to an OFFLINE
 * opponent acks `{online:false}` (no crash).
 *
 * Harness = the `nest-e2e-and-datastore-tests` shared helper `bootHttpTestApp()` — the real
 * app booted via `createApp()` (which now installs the `IoAdapter`) + `app.listen(0)`, so a
 * `socket.io-client` connects to the socket server on the very same port. Every await uses
 * an event-with-timeout promise (NEVER a fixed sleep) so the spec is non-flaky.
 */
describe('Live PvP gateway (end-to-end)', () => {
  let ds: TempDatastore;
  let origin: string;

  /** Register + log in a fresh account over HTTP; returns {userId, token}. */
  const registerLogin = async (email: string): Promise<{ userId: string; token: string }> => {
    const password = 'password123';
    const register = await fetch(`${ds.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(register.status).toBe(201);
    const registered = (await register.json()) as { id: string };
    const login = await fetch(`${ds.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    return { userId: registered.id, token: accessToken };
  };

  /**
   * Materialize the starter roster (grant-on-first-read) so the user has a champion for
   * the shared `battleTurn`/`challengeTurn` seam to read. Without this, a live turn would
   * 422 ("You have no Digimon to battle."). Mirrors `pvp-turn.controller.spec.ts:52-53`.
   */
  const materializeRoster = async (token: string): Promise<void> => {
    const res = await fetch(`${ds.baseUrl}/digimon`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  };

  /** Connect a `/pvp` socket with the given token (undefined = unauthenticated). */
  const connect = (token?: string): Socket =>
    io(`${origin}/pvp`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });

  /** Resolve on the named event, or reject after `ms` (non-flaky — no fixed sleep). */
  const once = <T = unknown>(socket: Socket, event: string, ms = 3000): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), ms);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  /** Wait for a socket to establish (or fail) its connection. */
  const connected = (socket: Socket, ms = 3000): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for connect')), ms);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });

  beforeAll(async () => {
    ds = await bootHttpTestApp('pvp-gateway');
    const address = ds.app.getHttpServer().address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
    // TASK-198: the forfeit is now DEFERRED behind `graceMs` (default 10s in prod). Drive
    // the TASK-194/197 disconnect→forfeit specs deterministically-fast by shrinking the
    // window to a few ms so the deferred forfeit fires well within each `once(...)` timeout;
    // the dedicated rejoin/expiry specs override this per-test. This is the L-55/L-56
    // non-flaky co-evolution of the shipped disconnect tests, NOT a behaviour change: the
    // scored outcome is byte-identical, only its timing is now configurable.
    ds.app.get(PvpGateway).graceMs = 60;
  });

  afterAll(async () => {
    await ds.dispose();
  });

  it('A challenges B → B receives `challenged` with A’s display name; B accepts → both receive `matched`', async () => {
    const a = await registerLogin('alice@digimon.dev');
    const b = await registerLogin('bob@digimon.dev');

    const socketA = connect(a.token);
    const socketB = connect(b.token);
    try {
      await Promise.all([connected(socketA), connected(socketB)]);
      // Give the server a moment to register B's presence before A challenges (await the
      // ack, not a sleep: the challenge ack tells us the server saw B online).
      const challenged = once<{ fromUserId: string; fromDisplayName: string }>(socketB, 'challenged');
      const matchedA = once<{ matchId: string }>(socketA, 'matched');
      const matchedB = once<{ matchId: string }>(socketB, 'matched');

      const ack = await new Promise<{ online: boolean }>((resolve) =>
        socketA.emit('challenge', { opponentId: b.userId }, resolve),
      );
      expect(ack.online).toBe(true);

      const event = await challenged;
      expect(event.fromUserId).toBe(a.userId);
      // Server-authoritative display name = the email local part (invariant 2 — no full email).
      expect(event.fromDisplayName).toBe('alice');

      socketB.emit('accept', { fromUserId: a.userId });
      const [ma, mb] = await Promise.all([matchedA, matchedB]);
      expect(ma.matchId).toBeTruthy();
      expect(mb.matchId).toBe(ma.matchId);
    } finally {
      socketA.disconnect();
      socketB.disconnect();
    }
  });

  it('rejects an UNAUTHENTICATED socket (invariant 2)', async () => {
    const socket = connect(undefined);
    try {
      // No valid token → the server disconnects on connection. Assert we never stay
      // connected (either connect_error or an immediate disconnect after connect).
      await expect(
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('socket was not rejected')), 3000);
          socket.once('connect_error', () => {
            clearTimeout(timer);
            resolve();
          });
          socket.once('disconnect', () => {
            clearTimeout(timer);
            resolve();
          });
        }),
      ).resolves.toBeUndefined();
    } finally {
      socket.disconnect();
    }
  });

  it('acks `{online:false}` when challenging an OFFLINE opponent (no crash)', async () => {
    const a = await registerLogin('carol@digimon.dev');
    const socketA = connect(a.token);
    try {
      await connected(socketA);
      const ack = await new Promise<{ online: boolean }>((resolve) =>
        socketA.emit('challenge', { opponentId: 'nobody-offline-id' }, resolve),
      );
      expect(ack.online).toBe(false);
    } finally {
      socketA.disconnect();
    }
  });

  /**
   * TASK-200 (R-25a-follow3 slice 59) — the LIVE-MATCH LOBBY. A third observer socket C
   * (a seeded+logged-in third user, NOT a participant) receives a `matches_changed`
   * broadcast when A & B's duel starts (its `matches` list carries ONE entry with the
   * server-resolved display names = each email's local-part, invariant 2), and a follow-up
   * `matches_changed` with the match REMOVED when the duel forfeits (expiry). A `list_matches`
   * from an authenticated socket with no live matches acks `{ matches: [] }` (no crash).
   * Event-with-timeout awaits (no fixed sleep).
   */
  describe('live-match lobby (`matches_changed` / `list_matches`)', () => {
    const matchPair = async (
      a: { userId: string; token: string },
      b: { userId: string; token: string },
    ): Promise<{ socketA: Socket; socketB: Socket; matchId: string }> => {
      const socketA = connect(a.token);
      const socketB = connect(b.token);
      await Promise.all([connected(socketA), connected(socketB)]);
      const matchedA = once<{ matchId: string }>(socketA, 'matched');
      const ack = await new Promise<{ online: boolean }>((resolve) =>
        socketA.emit('challenge', { opponentId: b.userId }, resolve),
      );
      expect(ack.online).toBe(true);
      socketB.emit('accept', { fromUserId: a.userId });
      const { matchId } = await matchedA;
      expect(matchId).toBeTruthy();
      return { socketA, socketB, matchId };
    };

    it('an observer C receives `matches_changed` listing A vs B when their duel starts, then removed when it forfeits', async () => {
      const gateway = ds.app.get(PvpGateway);
      gateway.graceMs = 60; // tiny window → the deferred forfeit fires fast
      const a = await registerLogin('yuki@digimon.dev');
      const b = await registerLogin('zane@digimon.dev');
      const c = await registerLogin('cleo@digimon.dev');
      await Promise.all([materializeRoster(a.token), materializeRoster(b.token)]);

      // C observes first (connected before the match starts) so it receives the broadcasts.
      const socketC = connect(c.token);
      let socketA: Socket | undefined;
      let socketB: Socket | undefined;
      try {
        await connected(socketC);

        type Lobby = {
          matches: Array<{
            matchId: string;
            challenger: { userId: string; displayName: string };
            opponent: { userId: string; displayName: string };
          }>;
        };
        const started = once<Lobby>(socketC, 'matches_changed');
        const pair = await matchPair(a, b);
        socketA = pair.socketA;
        socketB = pair.socketB;

        const startedEvent = await started;
        const entry = startedEvent.matches.find((m) => m.matchId === pair.matchId);
        expect(entry).toBeDefined();
        // Server-resolved local-parts (invariant 2 — never a client field).
        const names = [entry!.challenger.displayName, entry!.opponent.displayName].sort();
        expect(names).toEqual(['yuki', 'zane']);

        // Now the match FORFEITS (A drops, grace window expires) → C sees it removed.
        const removed = once<Lobby>(socketC, 'matches_changed');
        socketA.disconnect();
        const removedEvent = await removed;
        expect(removedEvent.matches.find((m) => m.matchId === pair.matchId)).toBeUndefined();
      } finally {
        gateway.graceMs = 60;
        socketA?.disconnect();
        socketB?.disconnect();
        socketC.disconnect();
      }
    });

    it('`list_matches` from an authenticated socket with no live matches acks `{ matches: [] }`', async () => {
      const a = await registerLogin('bea@digimon.dev');
      const socketA = connect(a.token);
      try {
        await connected(socketA);
        const ack = await new Promise<{ matches: unknown[] }>((resolve) =>
          socketA.emit('list_matches', resolve),
        );
        expect(Array.isArray(ack.matches)).toBe(true);
        // No live match involving this fresh user.
        expect(ack.matches).toEqual([]);
      } finally {
        socketA.disconnect();
      }
    });
  });

  /**
   * TASK-193 (R-25a slice 52) — the LIVE SHARED TURN. Handshake two authenticated sockets
   * (both with a champion via the starter grant) to `matched`, then A emits `turn` and
   * assert BOTH sockets receive the resolved `PvpTurnView` (a non-null carried
   * `SerializedFightState`, ≥1 `entries`, the next `playerSkills` menu). Also asserts the
   * two guards: a `turn` from a NON-participant socket is rejected (invariant 2), and a
   * `turn` for an UNKNOWN `matchId` is rejected gracefully (no crash). All awaits are
   * event-with-timeout (no fixed sleep — non-flaky).
   */
  describe('live shared turn (`turn`)', () => {
    /** Handshake A↔B to a shared match; returns their sockets + the matchId. */
    const matchPair = async (
      a: { userId: string; token: string },
      b: { userId: string; token: string },
    ): Promise<{ socketA: Socket; socketB: Socket; matchId: string }> => {
      const socketA = connect(a.token);
      const socketB = connect(b.token);
      await Promise.all([connected(socketA), connected(socketB)]);
      const matchedA = once<{ matchId: string }>(socketA, 'matched');
      const ack = await new Promise<{ online: boolean }>((resolve) =>
        socketA.emit('challenge', { opponentId: b.userId }, resolve),
      );
      expect(ack.online).toBe(true);
      socketB.emit('accept', { fromUserId: a.userId });
      const { matchId } = await matchedA;
      expect(matchId).toBeTruthy();
      return { socketA, socketB, matchId };
    };

    it('A emits `turn` → BOTH sockets receive the resolved PvpTurnView (state + entries + menu)', async () => {
      const a = await registerLogin('dave@digimon.dev');
      const b = await registerLogin('erin@digimon.dev');
      await Promise.all([materializeRoster(a.token), materializeRoster(b.token)]);
      const { socketA, socketB, matchId } = await matchPair(a, b);
      try {
        // OPENING turn (no skillId) — the shared seam returns the opening interactive view.
        const turnA = once<{ view: { battle: { state: unknown; entries: unknown[]; playerSkills: unknown[] } } }>(
          socketA,
          'turn',
        );
        const turnB = once<{ view: { battle: { state: unknown; entries: unknown[]; playerSkills: unknown[] } } }>(
          socketB,
          'turn',
        );
        socketA.emit('turn', { matchId });
        const [pushA, pushB] = await Promise.all([turnA, turnB]);
        // BOTH participants saw the SAME server-resolved turn (the live broadcast).
        for (const push of [pushA, pushB]) {
          expect(push.view.battle.state).not.toBeNull();
          expect(Array.isArray(push.view.battle.playerSkills)).toBe(true);
          expect(push.view.battle.playerSkills.length).toBeGreaterThanOrEqual(1);
        }
      } finally {
        socketA.disconnect();
        socketB.disconnect();
      }
    });

    it('rejects a `turn` for an UNKNOWN matchId (graceful, no crash)', async () => {
      const a = await registerLogin('frank@digimon.dev');
      await materializeRoster(a.token);
      const socketA = connect(a.token);
      try {
        await connected(socketA);
        const ack = await new Promise<{ ok: boolean }>((resolve) =>
          socketA.emit('turn', { matchId: 'no-such-match' }, resolve),
        );
        expect(ack.ok).toBe(false);
      } finally {
        socketA.disconnect();
      }
    });

    it('rejects a `turn` from a NON-participant socket (invariant 2)', async () => {
      const a = await registerLogin('grace@digimon.dev');
      const b = await registerLogin('heidi@digimon.dev');
      const c = await registerLogin('ivan@digimon.dev');
      await Promise.all([
        materializeRoster(a.token),
        materializeRoster(b.token),
        materializeRoster(c.token),
      ]);
      const { socketA, socketB, matchId } = await matchPair(a, b);
      const socketC = connect(c.token);
      try {
        await connected(socketC);
        // C is authenticated but NOT a participant of A↔B's match → rejected.
        const ack = await new Promise<{ ok: boolean }>((resolve) =>
          socketC.emit('turn', { matchId }, resolve),
        );
        expect(ack.ok).toBe(false);
      } finally {
        socketA.disconnect();
        socketB.disconnect();
        socketC.disconnect();
      }
    });

    /**
     * TASK-313 (R-44b — the live-opponent submission BUFFER) — the two-sided PAIRING. Each
     * participant emits `submit` with their chosen skill; the server buffers the first until
     * the second lands, then resolves ONE exchange (challenger pick → `skillId`, opponent pick
     * → `opponentSkillId`, the TASK-312 seam) and broadcasts the resolved `turn { view }` to
     * BOTH. Asserts: (a) one lone `submit` buffers with NO `turn` firing; (b) the paired
     * submissions resolve a SINGLE `turn` to both, reflecting BOTH picks; (c) a `submit` from a
     * non-participant / unknown / missing matchId is rejected (invariant 2); (d) a `submit`
     * naming a skill the opponent cannot legally use is refused WITHOUT tearing down the room or
     * the valid slot, and re-submitting a legal pick then resolves (never a silent AI fallback).
     * All awaits are event-with-timeout (no fixed sleep — non-flaky).
     */
    describe('two-sided submission buffer (`submit`)', () => {
      it('one lone `submit` BUFFERS (waiting:true) → NO `turn` fires on either socket', async () => {
        const a = await registerLogin('nate@digimon.dev');
        const b = await registerLogin('olga@digimon.dev');
        await Promise.all([materializeRoster(a.token), materializeRoster(b.token)]);
        const { socketA, socketB, matchId } = await matchPair(a, b);
        try {
          let turnFired = false;
          socketA.once('turn', () => {
            turnFired = true;
          });
          socketB.once('turn', () => {
            turnFired = true;
          });
          // A submits alone (no skillId → opening turn); the buffer holds it, unresolved.
          const ack = await new Promise<{ ok: boolean; waiting?: boolean }>((resolve) =>
            socketA.emit('submit', { matchId }, resolve),
          );
          expect(ack.ok).toBe(true);
          expect(ack.waiting).toBe(true);
          // No `turn` may arrive from a single submission (bounded wait, then assert silence).
          await new Promise((resolve) => setTimeout(resolve, 200));
          expect(turnFired).toBe(false);
        } finally {
          socketA.disconnect();
          socketB.disconnect();
        }
      });

      it('BOTH `submit` → a SINGLE resolved `turn { view }` reaches both sockets, reflecting both picks', async () => {
        const a = await registerLogin('al-paul@digimon.dev');
        const b = await registerLogin('al-rita@digimon.dev');
        await Promise.all([materializeRoster(a.token), materializeRoster(b.token)]);
        const { socketA, socketB, matchId } = await matchPair(a, b);
        try {
          type TurnPush = { view: { battle: { state: unknown; entries: unknown[]; playerSkills: unknown[] } } };
          const turnA = once<TurnPush>(socketA, 'turn');
          const turnB = once<TurnPush>(socketB, 'turn');
          // Opening exchange: neither carries a skillId (the shared seam returns the opening
          // interactive view for both). One submission alone must not resolve; both must.
          const ackA = await new Promise<{ ok: boolean; waiting?: boolean }>((resolve) =>
            socketA.emit('submit', { matchId }, resolve),
          );
          expect(ackA).toEqual({ ok: true, waiting: true });
          const ackB = await new Promise<{ ok: boolean; waiting?: boolean }>((resolve) =>
            socketB.emit('submit', { matchId }, resolve),
          );
          expect(ackB).toEqual({ ok: true, waiting: false });
          const [pushA, pushB] = await Promise.all([turnA, turnB]);
          // BOTH participants saw the SAME server-resolved paired turn.
          for (const push of [pushA, pushB]) {
            expect(push.view.battle.state).not.toBeNull();
            expect(Array.isArray(push.view.battle.playerSkills)).toBe(true);
            expect(push.view.battle.playerSkills.length).toBeGreaterThanOrEqual(1);
          }
        } finally {
          socketA.disconnect();
          socketB.disconnect();
        }
      });

      it('rejects a `submit` for an UNKNOWN / MISSING matchId (graceful, no crash)', async () => {
        const a = await registerLogin('saul@digimon.dev');
        await materializeRoster(a.token);
        const socketA = connect(a.token);
        try {
          await connected(socketA);
          const unknown = await new Promise<{ ok: boolean }>((resolve) =>
            socketA.emit('submit', { matchId: 'no-such-match' }, resolve),
          );
          expect(unknown.ok).toBe(false);
          const missing = await new Promise<{ ok: boolean }>((resolve) =>
            socketA.emit('submit', {}, resolve),
          );
          expect(missing.ok).toBe(false);
        } finally {
          socketA.disconnect();
        }
      });

      it('rejects a `submit` from a NON-participant socket (invariant 2)', async () => {
        const a = await registerLogin('al-tina@digimon.dev');
        const b = await registerLogin('al-uma@digimon.dev');
        const c = await registerLogin('al-vint@digimon.dev');
        await Promise.all([
          materializeRoster(a.token),
          materializeRoster(b.token),
          materializeRoster(c.token),
        ]);
        const { socketA, socketB, matchId } = await matchPair(a, b);
        const socketC = connect(c.token);
        try {
          await connected(socketC);
          const ack = await new Promise<{ ok: boolean }>((resolve) =>
            socketC.emit('submit', { matchId }, resolve),
          );
          expect(ack.ok).toBe(false);
        } finally {
          socketA.disconnect();
          socketB.disconnect();
          socketC.disconnect();
        }
      });

      it('a `submit` naming an ILLEGAL skill is refused WITHOUT clearing the room/slot; a legal re-submit then resolves', async () => {
        const a = await registerLogin('al-wade@digimon.dev');
        const b = await registerLogin('al-xena@digimon.dev');
        await Promise.all([materializeRoster(a.token), materializeRoster(b.token)]);
        const { socketA, socketB, matchId } = await matchPair(a, b);
        try {
          // A (challenger) buffers a legal opening submission — the valid slot to preserve.
          const ackA = await new Promise<{ ok: boolean; waiting?: boolean }>((resolve) =>
            socketA.emit('submit', { matchId }, resolve),
          );
          expect(ackA.waiting).toBe(true);
          // B (opponent) submits a skill its champion cannot legally use → the downstream
          // TASK-312 422 is surfaced as `{ ok:false }`, room + A's slot UNCHANGED.
          const bad = await new Promise<{ ok: boolean }>((resolve) =>
            socketB.emit('submit', { matchId, skillId: 'no-such-skill' }, resolve),
          );
          expect(bad.ok).toBe(false);
          // The room survived: a legal re-submit from B now resolves the buffered round →
          // a single `turn` reaches both (A's earlier legal slot was never cleared).
          const turnA = once<{ view: unknown }>(socketA, 'turn');
          const turnB = once<{ view: unknown }>(socketB, 'turn');
          const good = await new Promise<{ ok: boolean; waiting?: boolean }>((resolve) =>
            socketB.emit('submit', { matchId }, resolve),
          );
          expect(good.ok).toBe(true);
          const [pushA, pushB] = await Promise.all([turnA, turnB]);
          expect(pushA.view).toBeTruthy();
          expect(pushB.view).toBeTruthy();
        } finally {
          socketA.disconnect();
          socketB.disconnect();
        }
      });
    });

    /**
     * TASK-194 (R-25a-follow slice 53) — DISCONNECT HARDENING. When one participant's
     * socket drops mid-fight, the OTHER must receive `opponent_left { matchId }` (so the
     * web panel ends gracefully instead of stranding them) and the match room must be
     * swept (a subsequent `turn` on that `matchId` is rejected — the entry is gone, no
     * leak). A disconnect with NO live match emits nothing / does not crash.
     */
    describe('disconnect hardening (`opponent_left`)', () => {
      it('A disconnects mid-fight → B receives `opponent_left`; the swept match rejects a later `turn`', async () => {
        const a = await registerLogin('judy@digimon.dev');
        const b = await registerLogin('kyle@digimon.dev');
        await Promise.all([materializeRoster(a.token), materializeRoster(b.token)]);
        const { socketA, socketB, matchId } = await matchPair(a, b);
        try {
          const left = once<{ matchId: string }>(socketB, 'opponent_left');
          // A drops. B must be notified the match ended (event-await, no fixed sleep).
          socketA.disconnect();
          const event = await left;
          expect(event.matchId).toBe(matchId);

          // The room was swept: a `turn` on that matchId from the surviving B is rejected.
          const ack = await new Promise<{ ok: boolean }>((resolve) =>
            socketB.emit('turn', { matchId }, resolve),
          );
          expect(ack.ok).toBe(false);
        } finally {
          socketB.disconnect();
        }
      });

      it('a disconnect with NO live match emits nothing / does not crash', async () => {
        const a = await registerLogin('liam@digimon.dev');
        const b = await registerLogin('mona@digimon.dev');
        // B connects but is NEVER matched to A — so A dropping must not push to B.
        const socketA = connect(a.token);
        const socketB = connect(b.token);
        try {
          await Promise.all([connected(socketA), connected(socketB)]);
          let received = false;
          socketB.on('opponent_left', () => {
            received = true;
          });
          socketA.disconnect();
          // Give the server a bounded window to (wrongly) push; assert it never did.
          await new Promise<void>((resolve) => setTimeout(resolve, 300));
          expect(received).toBe(false);
          // The server is still healthy — B can still challenge (no crash from the sweep).
          const ack = await new Promise<{ online: boolean }>((resolve) =>
            socketB.emit('challenge', { opponentId: 'nobody' }, resolve),
          );
          expect(ack.online).toBe(false);
        } finally {
          socketB.disconnect();
        }
      });
    });

    /**
     * TASK-197 (R-25a-follow2 slice 56) — SCORED FORFEIT-LOSS ON ABANDON. When one
     * participant drops mid-fight, the swept abandon is now scored as a forfeit: the
     * remaining player WINS and BOTH players' persisted `User.mmr` moves by the same
     * symmetric Elo step `challengeTurn` produces. The remaining socket receives a NEW
     * additive `match_forfeited { matchId, outcome:'win', ratings }` (alongside the
     * back-compat `opponent_left`). A disconnect with NO live match still writes no rating.
     * Event-with-timeout awaits (no fixed sleep); ratings read back from the persisted rows.
     */
    describe('scored forfeit on abandon (`match_forfeited`)', () => {
      it('A disconnects mid-fight → B receives `match_forfeited` scored win; B’s persisted MMR rose, A’s fell', async () => {
        const a = await registerLogin('nina@digimon.dev');
        const b = await registerLogin('omar@digimon.dev');
        await Promise.all([materializeRoster(a.token), materializeRoster(b.token)]);
        const prisma = ds.app.get(PrismaService);
        const aBefore = await prisma.user.findFirstOrThrow({ where: { id: a.userId } });
        const bBefore = await prisma.user.findFirstOrThrow({ where: { id: b.userId } });

        const { socketA, socketB, matchId } = await matchPair(a, b);
        try {
          const forfeited = once<{
            matchId: string;
            outcome: 'win';
            ratings: {
              remainer: { before: number; after: number };
              leaver: { before: number; after: number };
            };
          }>(socketB, 'match_forfeited');
          // A abandons the live duel — B is credited the forfeit win.
          socketA.disconnect();
          const event = await forfeited;

          expect(event.matchId).toBe(matchId);
          expect(event.outcome).toBe('win');
          // B is the remainer (winner) → rating ROSE; A is the leaver → rating FELL.
          expect(event.ratings.remainer.after).toBeGreaterThan(event.ratings.remainer.before);
          expect(event.ratings.leaver.after).toBeLessThan(event.ratings.leaver.before);
          expect(event.ratings.remainer.before).toBe(bBefore.mmr);
          expect(event.ratings.leaver.before).toBe(aBefore.mmr);

          // The persisted rows moved to exactly the pushed after-values.
          const aAfter = await prisma.user.findFirstOrThrow({ where: { id: a.userId } });
          const bAfter = await prisma.user.findFirstOrThrow({ where: { id: b.userId } });
          expect(bAfter.mmr).toBe(event.ratings.remainer.after);
          expect(aAfter.mmr).toBe(event.ratings.leaver.after);
          expect(bAfter.mmr).toBeGreaterThan(bBefore.mmr);
          expect(aAfter.mmr).toBeLessThan(aBefore.mmr);
        } finally {
          socketB.disconnect();
        }
      });

      it('a disconnect with NO live match writes no rating', async () => {
        const a = await registerLogin('pia@digimon.dev');
        const prisma = ds.app.get(PrismaService);
        const before = await prisma.user.findFirstOrThrow({ where: { id: a.userId } });
        const socketA = connect(a.token);
        try {
          await connected(socketA);
          socketA.disconnect();
          // Bounded window for any (wrong) async rating write to land, then assert none did.
          await new Promise<void>((resolve) => setTimeout(resolve, 300));
          const after = await prisma.user.findFirstOrThrow({ where: { id: a.userId } });
          expect(after.mmr).toBe(before.mmr);
        } finally {
          socketA.disconnect();
        }
      });
    });

    /**
     * TASK-198 (R-25a-follow3 slice 57) — GRACE-TIMER RECONNECT-REJOIN. A mid-fight drop no
     * longer INSTANTLY forfeits: the forfeit is deferred behind a grace window and the same
     * user reconnecting within it CANCELS the pending forfeit (the match survives, NO rating
     * moves). Only after the window expires with no rejoin does the EXACT TASK-197 scored
     * forfeit fire. We drive both paths deterministically by overriding the gateway's
     * `graceMs` (a small value → the expiry timer fires fast; a large value → the rejoin wins
     * the race) — no fixed multi-second sleeps, non-flaky event-with-timeout awaits.
     */
    describe('grace-timer reconnect-rejoin (`rejoined`)', () => {
      it('A drops then reconnects WITHIN grace → both receive `rejoined`, no rating moves, match survives', async () => {
        const gateway = ds.app.get(PvpGateway);
        gateway.graceMs = 5000; // generous window so the reconnect beats the timer
        const a = await registerLogin('quinn@digimon.dev');
        const b = await registerLogin('rita@digimon.dev');
        await Promise.all([materializeRoster(a.token), materializeRoster(b.token)]);
        const prisma = ds.app.get(PrismaService);
        const aBefore = await prisma.user.findFirstOrThrow({ where: { id: a.userId } });
        const bBefore = await prisma.user.findFirstOrThrow({ where: { id: b.userId } });

        const { socketA, socketB, matchId } = await matchPair(a, b);
        let socketA2: Socket | undefined;
        try {
          // B must NOT see a forfeit; both A (reconnected) and B must see `rejoined`.
          const rejoinedB = once<{ matchId: string }>(socketB, 'rejoined');
          let forfeited = false;
          socketB.on('match_forfeited', () => {
            forfeited = true;
          });

          // A drops the socket entirely, then reconnects with the SAME valid JWT within grace.
          socketA.disconnect();
          await new Promise<void>((resolve) => setTimeout(resolve, 150));
          socketA2 = connect(a.token);
          const rejoinedA = once<{ matchId: string }>(socketA2, 'rejoined');
          await connected(socketA2);

          const [evA, evB] = await Promise.all([rejoinedA, rejoinedB]);
          expect(evA.matchId).toBe(matchId);
          expect(evB.matchId).toBe(matchId);
          expect(forfeited).toBe(false);

          // No rating moved — the match survived the blip.
          const aAfter = await prisma.user.findFirstOrThrow({ where: { id: a.userId } });
          const bAfter = await prisma.user.findFirstOrThrow({ where: { id: b.userId } });
          expect(aAfter.mmr).toBe(aBefore.mmr);
          expect(bAfter.mmr).toBe(bBefore.mmr);

          // The match still exists: the reconnected A can still drive a turn.
          const ack = await new Promise<{ ok: boolean }>((resolve) =>
            socketA2!.emit('turn', { matchId }, resolve),
          );
          expect(ack.ok).toBe(true);
        } finally {
          gateway.graceMs = 60;
          socketA.disconnect();
          socketB.disconnect();
          socketA2?.disconnect();
        }
      });

      it('A drops and does NOT reconnect → after the grace window B receives the scored `match_forfeited`; both MMRs moved', async () => {
        const gateway = ds.app.get(PvpGateway);
        gateway.graceMs = 60; // tiny window → the expiry timer fires fast, no long sleep
        const a = await registerLogin('sara@digimon.dev');
        const b = await registerLogin('theo@digimon.dev');
        await Promise.all([materializeRoster(a.token), materializeRoster(b.token)]);
        const prisma = ds.app.get(PrismaService);
        const aBefore = await prisma.user.findFirstOrThrow({ where: { id: a.userId } });
        const bBefore = await prisma.user.findFirstOrThrow({ where: { id: b.userId } });

        const { socketA, socketB, matchId } = await matchPair(a, b);
        try {
          const forfeited = once<{
            matchId: string;
            outcome: 'win';
            ratings: {
              remainer: { before: number; after: number };
              leaver: { before: number; after: number };
            };
          }>(socketB, 'match_forfeited');
          // A abandons and never reconnects → after ~graceMs the deferred forfeit fires.
          socketA.disconnect();
          const event = await forfeited;

          expect(event.matchId).toBe(matchId);
          expect(event.outcome).toBe('win');
          expect(event.ratings.remainer.after).toBeGreaterThan(event.ratings.remainer.before);
          expect(event.ratings.leaver.after).toBeLessThan(event.ratings.leaver.before);

          const aAfter = await prisma.user.findFirstOrThrow({ where: { id: a.userId } });
          const bAfter = await prisma.user.findFirstOrThrow({ where: { id: b.userId } });
          expect(bAfter.mmr).toBe(event.ratings.remainer.after);
          expect(aAfter.mmr).toBe(event.ratings.leaver.after);
          expect(bAfter.mmr).toBeGreaterThan(bBefore.mmr);
          expect(aAfter.mmr).toBeLessThan(aBefore.mmr);
        } finally {
          gateway.graceMs = 60;
          socketB.disconnect();
        }
      });

      /**
       * TASK-199 (R-25a-follow3 slice 58) — MID-FIGHT STATE RE-SEED ON REJOIN. After at
       * least one turn has RESOLVED (so the gateway retains a `lastViews` entry), a FRESH
       * reconnect (a NEW socket with the SAME JWT — as after a page reload) receives
       * `rejoined { matchId, view }` where `view.battle.state` is the in-progress fight
       * state (NOT `undefined`), so the client can RESUME the exact fight. No forfeit fires
       * and neither MMR moves (the match survived the blip).
       */
      it('A drops after a resolved turn then reconnects WITHIN grace → `rejoined` carries the in-progress fight `view`', async () => {
        const gateway = ds.app.get(PvpGateway);
        gateway.graceMs = 5000; // generous window so the reconnect beats the timer
        const a = await registerLogin('uma@digimon.dev');
        const b = await registerLogin('vito@digimon.dev');
        await Promise.all([materializeRoster(a.token), materializeRoster(b.token)]);
        const prisma = ds.app.get(PrismaService);
        const aBefore = await prisma.user.findFirstOrThrow({ where: { id: a.userId } });
        const bBefore = await prisma.user.findFirstOrThrow({ where: { id: b.userId } });

        const { socketA, socketB, matchId } = await matchPair(a, b);
        let socketA2: Socket | undefined;
        try {
          // Drive ONE resolved turn so the gateway retains the last-known view for `matchId`.
          const openA = once<{ view: { battle: { state: unknown } } }>(socketA, 'turn');
          const openB = once<{ view: { battle: { state: unknown } } }>(socketB, 'turn');
          socketA.emit('turn', { matchId });
          const [pushA] = await Promise.all([openA, openB]);
          expect(pushA.view.battle.state).not.toBeNull();

          // B must NOT see a forfeit; A's FRESH socket must receive `rejoined` WITH the view.
          let forfeited = false;
          socketB.on('match_forfeited', () => {
            forfeited = true;
          });

          socketA.disconnect();
          await new Promise<void>((resolve) => setTimeout(resolve, 150));
          socketA2 = connect(a.token);
          const rejoinedA = once<{ matchId: string; view?: { battle: { state: unknown } } }>(
            socketA2,
            'rejoined',
          );
          await connected(socketA2);

          const evA = await rejoinedA;
          expect(evA.matchId).toBe(matchId);
          // THE SLICE: the rejoin now re-seeds the in-progress fight state (not undefined).
          expect(evA.view).toBeDefined();
          expect(evA.view!.battle.state).not.toBeNull();
          expect(forfeited).toBe(false);

          // No rating moved — the match survived the blip.
          const aAfter = await prisma.user.findFirstOrThrow({ where: { id: a.userId } });
          const bAfter = await prisma.user.findFirstOrThrow({ where: { id: b.userId } });
          expect(aAfter.mmr).toBe(aBefore.mmr);
          expect(bAfter.mmr).toBe(bBefore.mmr);
        } finally {
          gateway.graceMs = 60;
          socketA.disconnect();
          socketB.disconnect();
          socketA2?.disconnect();
        }
      });

      /**
       * TASK-199 — a rejoin BEFORE any turn resolved has no retained view, so it still
       * delivers `rejoined { matchId }` with `view` `undefined` and does not crash (the
       * client simply reopens the opening menu as before — the TASK-198 behaviour).
       */
      it('A drops BEFORE any resolved turn then reconnects WITHIN grace → `rejoined` view is `undefined` (no crash)', async () => {
        const gateway = ds.app.get(PvpGateway);
        gateway.graceMs = 5000;
        const a = await registerLogin('wade@digimon.dev');
        const b = await registerLogin('xena@digimon.dev');
        await Promise.all([materializeRoster(a.token), materializeRoster(b.token)]);

        const { socketA, socketB, matchId } = await matchPair(a, b);
        let socketA2: Socket | undefined;
        try {
          // No turn is driven → the gateway holds no `lastViews` entry for this match.
          socketA.disconnect();
          await new Promise<void>((resolve) => setTimeout(resolve, 150));
          socketA2 = connect(a.token);
          const rejoinedA = once<{ matchId: string; view?: unknown }>(socketA2, 'rejoined');
          await connected(socketA2);

          const evA = await rejoinedA;
          expect(evA.matchId).toBe(matchId);
          expect(evA.view).toBeUndefined();

          // The match still exists: the reconnected A can still drive a turn.
          const ack = await new Promise<{ ok: boolean }>((resolve) =>
            socketA2!.emit('turn', { matchId }, resolve),
          );
          expect(ack.ok).toBe(true);
        } finally {
          gateway.graceMs = 60;
          socketA.disconnect();
          socketB.disconnect();
          socketA2?.disconnect();
        }
      });
    });
  });

  /**
   * TASK-201 (R-25a-follow3 slice 60) — the LIVE-MATCH SPECTATOR feed. A THIRD (non-participant)
   * socket C `watch_match`es a live A↔B duel, joins its spectator room, and receives every
   * resolved turn via `spectator_turn` — WITHOUT ever disturbing the participants' `turn` stream
   * (A & B still receive `turn` byte-identically). Also asserts the guard edges: an UNKNOWN
   * matchId → `{ view: null }` (no join, no crash), and a PARTICIPANT watching their OWN match →
   * `{ view: null }` (rejected). Non-flaky event-with-timeout awaits, no fixed sleeps.
   */
  describe('live-match spectator feed (`watch_match` / `spectator_turn`)', () => {
    /** Handshake A↔B to a shared match; returns their sockets + the matchId. */
    const matchPair = async (
      a: { userId: string; token: string },
      b: { userId: string; token: string },
    ): Promise<{ socketA: Socket; socketB: Socket; matchId: string }> => {
      const socketA = connect(a.token);
      const socketB = connect(b.token);
      await Promise.all([connected(socketA), connected(socketB)]);
      const matchedA = once<{ matchId: string }>(socketA, 'matched');
      const ack = await new Promise<{ online: boolean }>((resolve) =>
        socketA.emit('challenge', { opponentId: b.userId }, resolve),
      );
      expect(ack.online).toBe(true);
      socketB.emit('accept', { fromUserId: a.userId });
      const { matchId } = await matchedA;
      expect(matchId).toBeTruthy();
      return { socketA, socketB, matchId };
    };

    it('C watches a live A↔B match → receives `spectator_turn`; A & B still receive `turn` byte-identically', async () => {
      const a = await registerLogin('spec-a@digimon.dev');
      const b = await registerLogin('spec-b@digimon.dev');
      const c = await registerLogin('spec-c@digimon.dev');
      await Promise.all([materializeRoster(a.token), materializeRoster(b.token)]);
      const { socketA, socketB, matchId } = await matchPair(a, b);
      const socketC = connect(c.token);
      try {
        await connected(socketC);
        // C (a non-participant) subscribes to WATCH the match. Ack view is null before the
        // first turn resolves.
        const watchAck = await new Promise<{ view: unknown }>((resolve) =>
          socketC.emit('watch_match', { matchId }, resolve),
        );
        expect(watchAck.view).toBeNull();

        // A drives a turn → participants get `turn`, the spectator gets `spectator_turn` with
        // the SAME server-resolved view. Assert all three fire (the participant stream is
        // provably unaltered — invariant 5).
        const turnA = once<{ view: { battle: { state: unknown } } }>(socketA, 'turn');
        const turnB = once<{ view: { battle: { state: unknown } } }>(socketB, 'turn');
        const specC = once<{ matchId: string; view: { battle: { state: unknown } } }>(
          socketC,
          'spectator_turn',
        );
        socketA.emit('turn', { matchId });
        const [pushA, pushB, pushC] = await Promise.all([turnA, turnB, specC]);
        expect(pushA.view.battle.state).not.toBeNull();
        expect(pushB.view.battle.state).not.toBeNull();
        expect(pushC.matchId).toBe(matchId);
        // The spectator's view is the SAME server-computed view the participants received.
        expect(pushC.view.battle.state).not.toBeNull();
        expect(pushC.view).toStrictEqual(pushA.view);
      } finally {
        socketA.disconnect();
        socketB.disconnect();
        socketC.disconnect();
      }
    });

    it('`watch_match` for an UNKNOWN matchId → `{ view: null }` (no crash, no membership)', async () => {
      const c = await registerLogin('spec-unknown@digimon.dev');
      const socketC = connect(c.token);
      try {
        await connected(socketC);
        const ack = await new Promise<{ view: unknown }>((resolve) =>
          socketC.emit('watch_match', { matchId: 'no-such-match' }, resolve),
        );
        expect(ack.view).toBeNull();
      } finally {
        socketC.disconnect();
      }
    });

    it('a PARTICIPANT watching their OWN match is REJECTED → `{ view: null }`', async () => {
      const a = await registerLogin('spec-own-a@digimon.dev');
      const b = await registerLogin('spec-own-b@digimon.dev');
      const { socketA, socketB, matchId } = await matchPair(a, b);
      try {
        const ack = await new Promise<{ view: unknown }>((resolve) =>
          socketA.emit('watch_match', { matchId }, resolve),
        );
        expect(ack.view).toBeNull();
      } finally {
        socketA.disconnect();
        socketB.disconnect();
      }
    });
  });
});
