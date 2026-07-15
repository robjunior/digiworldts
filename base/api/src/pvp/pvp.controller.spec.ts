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
import type { OpponentView, PvpOutcomeView } from './pvp.types';

/**
 * Ranked-PvP API contract (TASK-36, R-12) — the runnable proof of the FIRST
 * player-vs-player slice: a player lists challengeable opponents, challenges a
 * specific real player, the EXISTING deterministic `simulateBattle` resolves the
 * fight, and BOTH players' `mmr` rating moves by a symmetric Elo step (PERSISTED).
 * Proves the whole PvP fantasy end to end AND every guard/validation edge.
 *
 * Harness = the SAME two house patterns as the sibling `admin.controller.spec.ts` /
 * `shop.controller.spec.ts` (P-2 + P-6), copied VERBATIM — both routes hit the DB AND
 * are guard-protected. (The shared `apps/api/src/test/datastore.ts` helper the e2e
 * skill's primary path names does NOT exist yet — extracting it is a separate DISTILL
 * item — so this spec inlines the throwaway-DB block per the skill's documented
 * fallback, matching every other apps/api e2e today.)
 *
 *  - P-2 (endpoint e2e): boot a REAL Nest app + `app.listen(0)` (ephemeral port) +
 *    Node's built-in `fetch` (no supertest). Exercises the true HTTP stack incl. the
 *    reused `JwtAuthGuard` and the global `ValidationPipe`.
 *  - FRICTION #8: boot via `createApp()`, NOT `Test.createTestingModule(...)`. Only
 *    `createApp()` wires the full `AppModule` (incl. `PvpModule`, the AuthModule guard
 *    exports, the global `/api` prefix, and the global `ValidationPipe`). A green boot
 *    proves the pvp guard constructs across the module boundary; the global pipe is
 *    what makes the malformed-body → 400 fire.
 *  - P-6 (hermetic throwaway DB): NEVER touch the shared `apps/api/prisma/dev.db`.
 *    `DATABASE_URL` → a per-run temp SQLite file (ABSOLUTE path, set BEFORE
 *    `createApp()`). Schema applied with `prisma db push --skip-generate`. CRUCIAL cwd
 *    depth (L-6, friction #7): this spec is at `src/pvp/`, so `db push` runs from
 *    `join(__dirname, '..', '..')` (= `apps/api`) — two levels up, the SAME depth as
 *    the shop/admin/evolve specs.
 *
 * A player's roster (their champion) is materialized by hitting `GET /api/digimon`
 * once after registration (starters are granted on the first roster read, TASK-8).
 * The rating state is verified by re-reading the User rows through
 * `app.get(PrismaService)` (mmr is server-internal state, the SAME escape hatch the
 * shop/admin specs use for the ledger/balance).
 */
describe('Ranked PvP API (end-to-end)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  const jsonPost = (path: string, body: unknown, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  const authGet = (path: string, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  /**
   * Register + log in a fresh account, materialize its starter roster (so it has a
   * champion to field), and return its access token. Each call uses a unique email so
   * tests get independent players.
   */
  const registerLoginWithRoster = async (email: string): Promise<string> => {
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

    // Materialize the starter roster (grant-on-first-read) so this player has a
    // champion — a challenge/opponents-listing needs at least one owned Digimon.
    const roster = await authGet('/digimon', accessToken);
    expect(roster.status).toBe(200);
    const digimon = (await roster.json()) as unknown[];
    expect(digimon.length).toBeGreaterThan(0);
    return accessToken;
  };

  /** Register + log in a fresh account but do NOT materialize a roster (no champion). */
  const registerLoginNoRoster = async (email: string): Promise<string> => {
    const password = 'password123';
    const register = await jsonPost('/auth/register', { email, password });
    expect(register.status).toBe(201);
    const login = await jsonPost('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    return accessToken;
  };

  /** The user id + current mmr for a registered email, read straight from the DB (L-3). */
  const userByEmail = async (email: string): Promise<{ id: string; mmr: number }> => {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findFirst({ where: { email } });
    if (user === null) throw new Error(`test setup: no user for ${email}`);
    return { id: user.id, mmr: user.mmr };
  };

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-pvp-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'pvp.db')}`;
    // src/pvp/ → up TWO levels to apps/api (friction #7 / L-6). NOT a single '..'.
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
  });

  afterAll(async () => {
    await app?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('GET /api/pvp/opponents lists OTHER players (not self) with a display name + mmr:1000 + champion, no email leak', async () => {
    // Case 1: the opponents roster projects only public data. Player A lists player B
    // (with B's non-identifying displayName, seed mmr 1000, and B's champion name) and
    // does NOT list A itself; nowhere does B's full email or private state appear.
    const emailA = 'pvp-a@example.test';
    const emailB = 'pvp-b@example.test';
    const tokenA = await registerLoginWithRoster(emailA);
    await registerLoginWithRoster(emailB);
    const { id: idA } = await userByEmail(emailA);
    const { id: idB } = await userByEmail(emailB);

    const res = await authGet('/pvp/opponents', tokenA);
    expect(res.status).toBe(200);
    const opponents = (await res.json()) as OpponentView[];

    // A never lists itself; B is present.
    expect(opponents.some((o) => o.userId === idA)).toBe(false);
    const b = opponents.find((o) => o.userId === idB);
    expect(b).toBeDefined();
    expect(b!.displayName).toBe('pvp-b'); // the email's LOCAL PART, never the full email
    expect(b!.mmr).toBe(1000); // the Elo seed default
    expect(typeof b!.championName).toBe('string');
    expect(b!.championName.length).toBeGreaterThan(0);

    // No private data leaks: the whole serialized payload must not contain a full
    // email/passwordHash anywhere.
    const raw = JSON.stringify(opponents);
    expect(raw).not.toContain('@example.test');
    expect(raw.toLowerCase()).not.toContain('passwordhash');
  });

  it('POST /api/pvp/challenge → 200 + deterministic outcome + non-empty turns + BOTH ratings move symmetrically, PERSISTED', async () => {
    // Case 2: the headline. A challenges B; the fight resolves deterministically, both
    // ratings move (winner up, loser down, symmetric), and the moves are PERSISTED on
    // both User rows. The same two rosters produce the SAME outcome (RNG-free sim).
    const emailA = 'pvp-c-a@example.test';
    const emailB = 'pvp-c-b@example.test';
    const tokenA = await registerLoginWithRoster(emailA);
    await registerLoginWithRoster(emailB);
    const { id: idB } = await userByEmail(emailB);

    const beforeA = (await userByEmail(emailA)).mmr;
    const beforeB = (await userByEmail(emailB)).mmr;
    expect(beforeA).toBe(1000);
    expect(beforeB).toBe(1000);

    const res = await jsonPost('/pvp/challenge', { opponentId: idB }, tokenA);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as PvpOutcomeView;

    expect(['win', 'loss']).toContain(body.outcome);
    expect(Array.isArray(body.turns)).toBe(true);
    expect(body.turns.length).toBeGreaterThan(0);

    // The response reports both rating moves; challenger before = 1000.
    expect(body.challenger.mmrBefore).toBe(1000);
    expect(body.opponent.mmrBefore).toBe(1000);
    expect(body.opponent.displayName).toBe('pvp-c-b'); // local part, no email leak

    // Symmetric zero-sum move around 1000: the winner's gain equals the loser's loss.
    const challengerDelta = body.challenger.mmrAfter - body.challenger.mmrBefore;
    const opponentDelta = body.opponent.mmrAfter - body.opponent.mmrBefore;
    expect(challengerDelta).not.toBe(0);
    expect(challengerDelta).toBe(-opponentDelta);
    // Whoever won moved UP, the loser DOWN (outcome is the challenger's perspective).
    if (body.outcome === 'win') {
      expect(challengerDelta).toBeGreaterThan(0);
    } else {
      expect(challengerDelta).toBeLessThan(0);
    }

    // PERSISTED: re-reading BOTH User rows shows the moved ratings.
    expect((await userByEmail(emailA)).mmr).toBe(body.challenger.mmrAfter);
    expect((await userByEmail(emailB)).mmr).toBe(body.opponent.mmrAfter);

    // Deterministic: an IDENTICAL matchup (fresh A' vs the same-rostered B') yields the
    // SAME outcome — simulateBattle is RNG-free.
    const emailA2 = 'pvp-c-a2@example.test';
    const emailB2 = 'pvp-c-b2@example.test';
    const tokenA2 = await registerLoginWithRoster(emailA2);
    await registerLoginWithRoster(emailB2);
    const { id: idB2 } = await userByEmail(emailB2);
    const res2 = await jsonPost('/pvp/challenge', { opponentId: idB2 }, tokenA2);
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as PvpOutcomeView;
    expect(body2.outcome).toBe(body.outcome);
    expect(body2.turns.length).toBe(body.turns.length);
  });

  // TASK-157 (R-22 slice 18): the PvP auto-resolve callsite (pvp.service.challenge)
  // was re-pointed by TASK-156/D-319 from the frozen `simulateBattle` → the byte-frozen
  // ATB sibling `simulateBattleAtb`, so a fast challenger's banked capped mini-combo now
  // lands in a PvP challenge exactly as it does interactively and on the PvE auto-resolve
  // path (proven at battle.controller.spec.ts:298). But that re-point shipped
  // correct-but-UNEXERCISED in any spec — the pinned PvP fixtures never reach
  // ATB_THRESHOLD, so the divergence-close was REAL for fast live matchups but INVISIBLE
  // in tests (present ≠ observable, L-17/L-55). This fixture closes that gap by mirroring
  // the PvE proof: give the CHALLENGER's champion a large SPD lead over the opponent
  // (banking ≥ 1 full threshold in round 1), challenge a fresh-starter opponent it
  // reliably WINS, and assert the returned turn log shows the banked EXTRA challenger
  // action WITHIN round 1 (more than the one action/side/round the pure SPD order
  // allows). The result is from the challenger's perspective, so challenger actions are
  // logged as actor:'player'. The MMR Elo step / $transaction is UNCHANGED (invariant 3
  // untriggered — MMR is a rating, not spendable). NO production code moved — battle.ts
  // + the service callsite stay byte-frozen (this is a test-only observability guard).
  it('surfaces the banked ATB mini-combo in the PvP challenge turn log (TASK-157 divergence-close)', async () => {
    const emailA = 'pvp-atb-combo-a@example.test';
    const emailB = 'pvp-atb-combo-b@example.test';
    const tokenA = await registerLoginWithRoster(emailA);
    await registerLoginWithRoster(emailB);
    const { id: idA } = await userByEmail(emailA);
    const { id: idB } = await userByEmail(emailB);

    // Bump the CHALLENGER's champion SPD far above ATB_THRESHOLD so it banks ≥ 1 full
    // threshold in round 1, earning at least one capped bonus action the SPD-order-only
    // path would never grant. The champion is the challenger's strongest owned Digimon
    // (orderBy level desc, id asc) — the SAME row the service fields.
    const prisma = app.get(PrismaService);
    const champion = await prisma.digimon.findFirst({
      where: { userId: idA, deletedAt: null },
      orderBy: [{ level: 'desc' }, { id: 'asc' }],
    });
    if (champion === null) throw new Error('test setup: no challenger champion');
    await prisma.digimon.update({ where: { id: champion.id }, data: { spd: 300 } });

    const res = await jsonPost('/pvp/challenge', { opponentId: idB }, tokenA);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PvpOutcomeView;

    // The fast-banking challenger WINS the deterministic fight (clean, non-flaky signal).
    expect(body.outcome).toBe('win');

    // A challenger action that dealt damage in round 1 (logged actor:'player' — the
    // first-arg perspective). Under the pure SPD order simulateBattle grants exactly ONE
    // such action per round; the banked ATB mini-combo (now honored via simulateBattleAtb,
    // D-319) grants MORE.
    const round1ChallengerHits = body.turns.filter(
      (t) => t.round === 1 && t.actor === 'player' && t.damage > 0,
    ).length;
    expect(round1ChallengerHits).toBeGreaterThan(1);
  });

  it('challenging yourself (opponentId === self) → 422, no rating change', async () => {
    // Case 3: a self-challenge is rejected BEFORE any write; the caller's rating is
    // unchanged.
    const email = 'pvp-self@example.test';
    const token = await registerLoginWithRoster(email);
    const { id } = await userByEmail(email);

    const res = await jsonPost('/pvp/challenge', { opponentId: id }, token);
    expect(res.status).toBe(422);
    expect((await userByEmail(email)).mmr).toBe(1000);
  });

  it('unknown opponent → 404; opponent with no Digimon → 422; challenger with no Digimon → 422 — no rating change', async () => {
    // Case 4: the three not-a-valid-target paths, each leaving both ratings untouched.
    const challenger = await registerLoginWithRoster('pvp-chal@example.test');

    // (a) Unknown opponentId → 404.
    const unknown = await jsonPost('/pvp/challenge', { opponentId: 'no-such-user-id' }, challenger);
    expect(unknown.status).toBe(404);
    expect((await userByEmail('pvp-chal@example.test')).mmr).toBe(1000);

    // (b) A real opponent who owns NO Digimon → 422 (they cannot field a champion).
    const emptyEmail = 'pvp-empty@example.test';
    await registerLoginNoRoster(emptyEmail);
    const { id: emptyId } = await userByEmail(emptyEmail);
    const noOppDigimon = await jsonPost('/pvp/challenge', { opponentId: emptyId }, challenger);
    expect(noOppDigimon.status).toBe(422);
    expect((await userByEmail('pvp-chal@example.test')).mmr).toBe(1000);
    expect((await userByEmail(emptyEmail)).mmr).toBe(1000);

    // (c) A CHALLENGER with no Digimon challenging a rostered opponent → 422.
    const challengerNoRoster = await registerLoginNoRoster('pvp-chal-empty@example.test');
    const opponentEmail = 'pvp-opp-ok@example.test';
    await registerLoginWithRoster(opponentEmail);
    const { id: oppId } = await userByEmail(opponentEmail);
    const noChalDigimon = await jsonPost(
      '/pvp/challenge',
      { opponentId: oppId },
      challengerNoRoster,
    );
    expect(noChalDigimon.status).toBe(422);
    expect((await userByEmail('pvp-chal-empty@example.test')).mmr).toBe(1000);
    expect((await userByEmail(opponentEmail)).mmr).toBe(1000);
  });

  it('rejects a malformed body → 400 (the expectedType ValidationPipe runs)', async () => {
    // Case 5 (the P-7 pair, half one): a missing/empty opponentId is rejected by the
    // parameter-scoped ValidationPipe BEFORE the handler runs — the guard against the
    // P-7 footgun (a bare @Body would silently skip validation under the esbuild gate).
    const token = await registerLoginWithRoster('pvp-malformed@example.test');

    const missing = await jsonPost('/pvp/challenge', {}, token);
    expect(missing.status).toBe(400);

    const empty = await jsonPost('/pvp/challenge', { opponentId: '' }, token);
    expect(empty.status).toBe(400);
  });

  it('rejects both routes with NO Authorization header → 401 (the guard is live)', async () => {
    // Case 6 (the P-7 pair, half two): both PvP routes are unreachable without a token
    // — the JwtAuthGuard runs before the handler, so even a well-formed challenge 401s.
    const opponents = await authGet('/pvp/opponents');
    expect(opponents.status).toBe(401);

    const challenge = await jsonPost('/pvp/challenge', { opponentId: 'x' });
    expect(challenge.status).toBe(401);
  });
});
