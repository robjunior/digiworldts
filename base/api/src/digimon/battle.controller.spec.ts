import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import type { BattleOutcomeView, OwnedDigimon } from './digimon.types';
import { BATTLE_XP_REWARD } from './battle';
import {
  applyBattleReward,
  BATTLE_LOSS_XP_PENALTY,
  lossPenaltyFor,
  type TrainableStats,
} from './training';

/**
 * Battle API contract (TASK-32, R-7) — the runnable proof of a deterministic,
 * server-resolved PvE fight. A signed-in player sends one of THEIR starters into a
 * fight (`POST /digimon/:id/battle`): the server simulates the whole encounter
 * through the type triangle + element cycle to a WIN or LOSS and returns a turn log.
 * On a WIN the Digimon earns a FIXED XP reward (persisted — a later `GET /digimon`
 * re-reads the raised level/xp/stats, so it is server-authoritative); on a LOSS
 * nothing changes. An unknown enemy is rejected before any write, an unauthenticated
 * caller is blocked (401), a malformed body is a 400, and a player can never battle
 * another player's Digimon (404 — invariant 2).
 *
 * The win reward is a FREE XP grant (invariant 3 NOT triggered), so — like the train
 * spec — there is NO balance seeding and NO AuditLog assertion here.
 *
 * Harness = the SAME two house patterns as the sibling `train.controller.spec.ts`
 * (P-2 + P-6), copied VERBATIM (the shared `apps/api/src/test/datastore.ts` helper
 * the e2e skill names does not exist yet — this inlines the throwaway-DB block per
 * the skill's documented fallback):
 *  - P-2: boot a REAL Nest app via `createApp()` (only it wires the full AppModule
 *    incl. the guard export, the `/api` prefix, and the global ValidationPipe) +
 *    `app.listen(0)` + Node's built-in `fetch`.
 *  - P-6: a per-run throwaway SQLite DB (ABSOLUTE `file:` URL set BEFORE `createApp()`;
 *    `prisma db push --skip-generate` from `join(__dirname, '..', '..')` = `apps/api`,
 *    the CRUCIAL cwd depth — this spec sits at `src/digimon/`).
 *
 * Enemy ids used (from battle.ts's ENEMY_ROSTER): `numemon` (weak — a starter WINS)
 * and `kuwagamon` (tough — a starter LOSES). Both outcomes are deterministic, so the
 * XP delta on a win is exactly BATTLE_XP_REWARD.
 */
describe('Battle API (end-to-end)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

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
    const registered = (await register.json()) as RegisterResponse;
    expect(registered.email).toBe(email);

    const login = await jsonPost('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    expect(typeof accessToken).toBe('string');
    expect(accessToken.length).toBeGreaterThan(0);
    return accessToken;
  };

  /** `GET /digimon` for a token → the player's roster (starter-granted on first read). */
  const getRoster = async (token: string): Promise<OwnedDigimon[]> => {
    const res = await fetch(`${baseUrl}/digimon`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as OwnedDigimon[];
  };

  /** The Agumon starter (Vaccine/Fire) — the reference fighter used by these tests. */
  const agumonOf = (roster: OwnedDigimon[]): OwnedDigimon =>
    roster.find((d) => d.name === 'Agumon')!;

  /** `POST /digimon/:id/battle {enemyId}`, with an optional Bearer token. */
  const postBattle = (id: string, enemyId: unknown, token?: string) =>
    fetch(`${baseUrl}/digimon/${id}/battle`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ enemyId }),
    });

  const progressionOf = (d: OwnedDigimon): TrainableStats => ({
    level: d.level,
    xp: d.xp,
    hp: d.hp,
    atk: d.atk,
    def: d.def,
    spd: d.spd,
    dataFire: d.dataFire,
  });

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-battle-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'battle.db')}`;
    // src/digimon/ → up TWO levels to apps/api (friction / L-6). NOT a single '..'.
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

  it('rejects POST /digimon/:id/battle with NO Authorization header → 401', async () => {
    // The guard runs before the body, so the id need not exist.
    const res = await postBattle('any-id', 'numemon');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed body (missing enemyId) → 400', async () => {
    // Proves the parameter-scoped ValidationPipe({expectedType: BattleDto}) is active
    // under the gate (the P-7 footgun) — an empty enemyId fails @IsNotEmpty.
    const token = await registerAndLogin('badbody-battle@example.test');
    const roster = await getRoster(token);
    const res = await postBattle(agumonOf(roster).id, '', token);
    expect(res.status).toBe(400);
  });

  it('WIN vs the weak foe → 200 with a turn log, the XP reward, and persisted level-up', async () => {
    // R-7 headline: a signed-in player battles their starter against a weak foe and
    // wins, earning a FIXED XP reward that persists (and levels the starter up — the
    // constants make this deterministic: BATTLE_XP_REWARD=40 ≥ xpForLevel(1)=20).
    const token = await registerAndLogin('winner-battle@example.test');
    const roster = await getRoster(token);
    const agumon = agumonOf(roster);
    expect(agumon.level).toBe(1);
    expect(agumon.xp).toBe(0);

    const before = progressionOf(agumon);
    const res = await postBattle(agumon.id, 'numemon', token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const outcome = (await res.json()) as BattleOutcomeView;

    // Deterministic WIN with a non-empty turn log and the enemy echoed back.
    expect(outcome.outcome).toBe('win');
    expect(outcome.turns.length).toBeGreaterThan(0);
    expect(outcome.enemy).toEqual({ id: 'numemon', name: 'Numemon' });
    expect(outcome.reward.xpGained).toBe(BATTLE_XP_REWARD);

    // The reward is applied through the SHARED level-up rule — the returned Digimon
    // equals applying the battle reward once to the pre-battle progression.
    const expected = applyBattleReward(before, BATTLE_XP_REWARD);
    expect(outcome.digimon.id).toBe(agumon.id);
    expect(outcome.digimon.level).toBe(expected.level);
    expect(outcome.digimon.xp).toBe(expected.xp);
    expect(outcome.digimon.hp).toBe(expected.hp);
    expect(outcome.digimon.atk).toBe(expected.atk);
    expect(outcome.digimon.def).toBe(expected.def);
    expect(outcome.digimon.spd).toBe(expected.spd);
    // The observable "win → get stronger": the level ticked up.
    expect(outcome.digimon.level).toBeGreaterThan(agumon.level);
    // Fire Data is untouched by battle (only training grants it).
    expect(outcome.digimon.dataFire).toBe(agumon.dataFire);

    // Persisted + server-authoritative: a fresh GET re-reads the raised values.
    const after = await getRoster(token);
    expect(after).toHaveLength(roster.length); // battle mutates, never adds/removes
    const persisted = after.find((d) => d.id === agumon.id)!;
    expect(persisted.level).toBe(expected.level);
    expect(persisted.xp).toBe(expected.xp);
  });

  it('surfaces the R-17c engine — Bleed Strike (energy-gated) + a Bleed tick in the turn log', async () => {
    // TASK-51 (R-17c): the combat engine is OBSERVABLE on the wire. TASK-62 (the 11th
    // wave) added the 3rd DoT, Bleed, via the DAMAGING mid-ladder `bleed-strike` (cost
    // 3) — which, being damaging, actually SURFACES in the shipped winnable numemon
    // fight (unlike a pure-control skill). It DISPLACED Fire Breath from the low
    // residual energy band, so the wire-observable DoT is now Bleed: the fight casts the
    // NAMED Bleed Strike ≥ once and the Bleed status ticks ("Bleed deals N to Numemon")
    // over ≥ 2 turns, while the outcome is STILL a win with the XP reward persisted. The
    // route/DTO are byte-unchanged; the turn log just carries the additive skill/
    // statusEvents fields (Burn/Fire Breath stay unit-proven in battle.spec.ts).
    const token = await registerAndLogin('engine-battle@example.test');
    const roster = await getRoster(token);
    const agumon = agumonOf(roster);

    const res = await postBattle(agumon.id, 'numemon', token);
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as BattleOutcomeView;

    expect(outcome.outcome).toBe('win');
    // A NAMED, energy-gated Bleed Strike was cast at least once.
    expect(outcome.turns.some((t) => t.skill === 'Surudoi Tsume')).toBe(true);
    // The Bleed status appeared …
    expect(
      outcome.turns.some((t) => (t.statusEvents ?? []).some((e) => /is Bleeding/.test(e))),
    ).toBe(true);
    // … and ticked as a DoT over ≥ 2 of the foe's turns.
    const ticks = outcome.turns.filter((t) =>
      (t.statusEvents ?? []).some((e) => /Bleed deals \d+ to Numemon/.test(e)),
    );
    expect(ticks.length).toBeGreaterThanOrEqual(2);

    // The reward still persisted (win → get stronger).
    const after = await getRoster(token);
    const persisted = after.find((d) => d.id === agumon.id)!;
    expect(persisted.level).toBeGreaterThan(agumon.level);
  });

  it('LOSS vs the tough foe → 200, no reward, an XP penalty persisted, and a battle-loss audit row (TASK-249)', async () => {
    const token = await registerAndLogin('loser-battle@example.test');
    const roster = await getRoster(token);
    const agumon = agumonOf(roster);

    // Seed the starter's xp above the penalty so the SUBTRACTION (not the floor-at-0 case)
    // is what we assert — a real player who has trained then loses should visibly bleed xp.
    const prisma = app.get(PrismaService);
    const seededXp = BATTLE_LOSS_XP_PENALTY + 50;
    await prisma.digimon.update({
      where: { id: agumon.id },
      data: { xp: seededXp },
    });
    const before = { ...progressionOf(agumon), xp: seededXp };

    const res = await postBattle(agumon.id, 'kuwagamon', token);
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as BattleOutcomeView;

    expect(outcome.outcome).toBe('loss');
    expect(outcome.turns.length).toBeGreaterThan(0);
    expect(outcome.reward.xpGained).toBe(0);
    // TASK-249 (R-31e): a loss now BLEEDS xp — the returned Digimon shows the penalty,
    // but never de-levels (level unchanged) and never drops a stat.
    expect(outcome.digimon.xp).toBe(Math.max(0, before.xp - BATTLE_LOSS_XP_PENALTY));
    expect(outcome.digimon.level).toBe(before.level);
    expect(outcome.digimon.hp).toBe(before.hp);

    // The penalty PERSISTED — a fresh GET shows the same lower xp (the write landed).
    const after = await getRoster(token);
    const persisted = after.find((d) => d.id === agumon.id)!;
    expect(persisted.xp).toBe(Math.max(0, before.xp - BATTLE_LOSS_XP_PENALTY));
    expect(persisted.level).toBe(before.level);
    expect(persisted.hp).toBe(before.hp);

    // Invariant-3 posture: a battle-loss AuditLog row records the before→after xp,
    // owner-scoped to this user (no spendable resource moved → resource is null).
    const owner = await prisma.digimon.findUnique({ where: { id: agumon.id } });
    const audits = await prisma.auditLog.findMany({
      where: { userId: owner!.userId, action: 'battle-loss' },
    });
    expect(audits.length).toBe(1);
    expect(audits[0].entity).toBe('Digimon');
    expect(audits[0].entityId).toBe(agumon.id);
    expect(audits[0].resource).toBeNull();
    expect(audits[0].amountBefore).toBe(before.xp);
    expect(audits[0].amountAfter).toBe(Math.max(0, before.xp - BATTLE_LOSS_XP_PENALTY));
  });

  it('a HIGHER-level loser bleeds MORE XP than a lvl-1 loser — level-scaled penalty (TASK-267)', async () => {
    // R-31e second slice: the on-loss XP penalty now SCALES with the loser's level, so the
    // roguelike sting keeps pace with the growing XP curve. We seed a HIGH level + ample xp
    // so the SUBTRACTION (not the floor-at-0 case) is what we assert. The drop must be
    // lossPenaltyFor(level) — STRICTLY GREATER than the lvl-1 baseline of 20 — floored at 0,
    // never de-leveled, all in the SAME loss transaction (with the shipped inventory wipe +
    // battle-loss audit).
    const token = await registerAndLogin('highlevel-loser-battle@example.test');
    const roster = await getRoster(token);
    const agumon = agumonOf(roster);

    const prisma = app.get(PrismaService);
    const seededLevel = 10;
    const expectedPenalty = lossPenaltyFor(seededLevel);
    // Sanity: the derivation the client can never see must be visibly bigger than lvl-1's 20.
    expect(expectedPenalty).toBeGreaterThan(BATTLE_LOSS_XP_PENALTY);
    const seededXp = expectedPenalty + 50;
    await prisma.digimon.update({
      where: { id: agumon.id },
      data: { level: seededLevel, xp: seededXp },
    });
    const before = { level: seededLevel, xp: seededXp };

    const res = await postBattle(agumon.id, 'kuwagamon', token);
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as BattleOutcomeView;

    expect(outcome.outcome).toBe('loss');
    // The higher-level loser bled the SCALED penalty (> 20), never de-leveled.
    expect(outcome.digimon.xp).toBe(before.xp - expectedPenalty);
    expect(before.xp - outcome.digimon.xp).toBeGreaterThan(BATTLE_LOSS_XP_PENALTY);
    expect(outcome.digimon.level).toBe(before.level);
    expect(outcome.digimon.xp).toBeGreaterThanOrEqual(0);

    // The scaled penalty PERSISTED and its battle-loss audit records the real before→after.
    const owner = await prisma.digimon.findUnique({ where: { id: agumon.id } });
    const audits = await prisma.auditLog.findMany({
      where: { userId: owner!.userId, action: 'battle-loss' },
    });
    expect(audits.length).toBe(1);
    expect(audits[0].amountBefore).toBe(before.xp);
    expect(audits[0].amountAfter).toBe(before.xp - expectedPenalty);
    expect(audits[0].amountBefore - audits[0].amountAfter!).toBe(expectedPenalty);
  });

  it('LOSS wipes the WHOLE inventory — each stack soft-zeroed + a battle-loss-wipe audit row (TASK-266)', async () => {
    // R-31e headline: a PvE loss now DESTROYS the loser's whole inventory (A-248), all
    // inside the SAME loss transaction as the XP penalty. We seed two distinct owned stacks
    // directly (mirroring how the XP-penalty case seeds xp), drive a LOSS, and assert the
    // inventory reads empty, each stack is soft-zeroed with its OWN audit row, and the XP
    // penalty + battle-loss audit STILL fire.
    const token = await registerAndLogin('loss-wipe-battle@example.test');
    const roster = await getRoster(token);
    const agumon = agumonOf(roster);

    const prisma = app.get(PrismaService);
    const owner = await prisma.digimon.findUnique({ where: { id: agumon.id } });
    const userId = owner!.userId;

    // Seed two distinct owned stacks (soft-zeroing must vanish BOTH from the rail).
    await prisma.inventoryItem.create({ data: { userId, itemId: 'heal-chip-1', quantity: 3 } });
    await prisma.inventoryItem.create({ data: { userId, itemId: 'meat-storage-1', quantity: 1 } });

    const res = await postBattle(agumon.id, 'kuwagamon', token);
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as BattleOutcomeView;
    expect(outcome.outcome).toBe('loss');

    // The inventory reads EMPTY afterward — the read hides zero-quantity stacks.
    const invRes = await fetch(`${baseUrl}/inventory`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(invRes.status).toBe(200);
    const inv = (await invRes.json()) as { items: unknown[]; slotsUsed: number };
    expect(inv.slotsUsed).toBe(0);
    expect(inv.items).toHaveLength(0);

    // Each stack is soft-zeroed (NOT hard-deleted — the rows still exist at quantity 0).
    const heal = await prisma.inventoryItem.findUnique({
      where: { userId_itemId: { userId, itemId: 'heal-chip-1' } },
    });
    const meat = await prisma.inventoryItem.findUnique({
      where: { userId_itemId: { userId, itemId: 'meat-storage-1' } },
    });
    expect(heal!.quantity).toBe(0);
    expect(meat!.quantity).toBe(0);

    // Each destroyed stack has its OWN append-only battle-loss-wipe audit row (before→0).
    const wipeRows = await prisma.auditLog.findMany({
      where: { userId, action: 'battle-loss-wipe' },
      orderBy: { entityId: 'asc' },
    });
    expect(wipeRows).toHaveLength(2);
    for (const row of wipeRows) {
      expect(row.entity).toBe('InventoryItem');
      expect(row.resource).toBeNull();
      expect(row.amountAfter).toBe(0);
      expect(row.amountBefore).toBeGreaterThan(0);
    }
    expect(wipeRows.map((r) => r.entityId).sort()).toEqual(['heal-chip-1', 'meat-storage-1']);

    // The shipped XP penalty + its battle-loss audit STILL fire unchanged.
    expect(outcome.reward.xpGained).toBe(0);
    const lossAudits = await prisma.auditLog.findMany({
      where: { userId, action: 'battle-loss' },
    });
    expect(lossAudits).toHaveLength(1);
  });

  it('a WIN leaves the inventory UNTOUCHED — no battle-loss-wipe rows (TASK-266)', async () => {
    // The wipe is loss-ONLY: a win (or draw) preserves the pack byte-for-byte.
    const token = await registerAndLogin('win-nowipe-battle@example.test');
    const roster = await getRoster(token);
    const agumon = agumonOf(roster);

    const prisma = app.get(PrismaService);
    const userId = (await prisma.digimon.findUnique({ where: { id: agumon.id } }))!.userId;
    await prisma.inventoryItem.create({ data: { userId, itemId: 'heal-chip-1', quantity: 2 } });

    const res = await postBattle(agumon.id, 'numemon', token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as BattleOutcomeView).outcome).toBe('win');

    // The stack survives intact and NO wipe row was written.
    const stack = await prisma.inventoryItem.findUnique({
      where: { userId_itemId: { userId, itemId: 'heal-chip-1' } },
    });
    expect(stack!.quantity).toBe(2);
    const wipeRows = await prisma.auditLog.findMany({
      where: { userId, action: 'battle-loss-wipe' },
    });
    expect(wipeRows).toHaveLength(0);
  });

  it('a LOSS with an EMPTY inventory is a clean NO-OP — no wipe rows, no error (TASK-266)', async () => {
    // A loser who owns nothing still resolves the loss normally: no wipe rows, no throw.
    const token = await registerAndLogin('empty-loss-battle@example.test');
    const roster = await getRoster(token);
    const agumon = agumonOf(roster);

    const prisma = app.get(PrismaService);
    const userId = (await prisma.digimon.findUnique({ where: { id: agumon.id } }))!.userId;

    const res = await postBattle(agumon.id, 'kuwagamon', token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as BattleOutcomeView).outcome).toBe('loss');

    const wipeRows = await prisma.auditLog.findMany({
      where: { userId, action: 'battle-loss-wipe' },
    });
    expect(wipeRows).toHaveLength(0);
    // The loss still resolved (its battle-loss audit fired).
    const lossAudits = await prisma.auditLog.findMany({
      where: { userId, action: 'battle-loss' },
    });
    expect(lossAudits).toHaveLength(1);
  });

  it("a player's LOSS never wipes another player's inventory (owner-scoped, invariant 2) (TASK-266)", async () => {
    const tokenA = await registerAndLogin('wipe-owner-a-battle@example.test');
    const rosterA = await getRoster(tokenA);
    const agumonA = agumonOf(rosterA);

    const tokenB = await registerAndLogin('wipe-owner-b-battle@example.test');
    const rosterB = await getRoster(tokenB);
    const agumonB = agumonOf(rosterB);

    const prisma = app.get(PrismaService);
    const userIdA = (await prisma.digimon.findUnique({ where: { id: agumonA.id } }))!.userId;
    const userIdB = (await prisma.digimon.findUnique({ where: { id: agumonB.id } }))!.userId;

    // BOTH players own a stack; only A loses.
    await prisma.inventoryItem.create({ data: { userId: userIdA, itemId: 'heal-chip-1', quantity: 2 } });
    await prisma.inventoryItem.create({ data: { userId: userIdB, itemId: 'heal-chip-1', quantity: 5 } });

    const res = await postBattle(agumonA.id, 'kuwagamon', tokenA);
    expect(res.status).toBe(200);
    expect(((await res.json()) as BattleOutcomeView).outcome).toBe('loss');

    // A's stack is wiped …
    const stackA = await prisma.inventoryItem.findUnique({
      where: { userId_itemId: { userId: userIdA, itemId: 'heal-chip-1' } },
    });
    expect(stackA!.quantity).toBe(0);
    // … but B's is entirely UNTOUCHED (no wipe row for B).
    const stackB = await prisma.inventoryItem.findUnique({
      where: { userId_itemId: { userId: userIdB, itemId: 'heal-chip-1' } },
    });
    expect(stackB!.quantity).toBe(5);
    const wipeRowsB = await prisma.auditLog.findMany({
      where: { userId: userIdB, action: 'battle-loss-wipe' },
    });
    expect(wipeRowsB).toHaveLength(0);
  });

  it('rejects an unknown enemy → 422 and leaves the Digimon untouched', async () => {
    const token = await registerAndLogin('unknownfoe-battle@example.test');
    const roster = await getRoster(token);
    const agumon = agumonOf(roster);

    const res = await postBattle(agumon.id, 'no-such-monster', token);
    expect(res.status).toBe(422);

    // No partial battle: the starter is unchanged.
    const after = await getRoster(token);
    const persisted = after.find((d) => d.id === agumon.id)!;
    expect(persisted.level).toBe(agumon.level);
    expect(persisted.xp).toBe(agumon.xp);
  });

  it("never battles another player's Digimon → 404 (per-user isolation, invariant 2)", async () => {
    const tokenA = await registerAndLogin('owner-a-battle@example.test');
    const rosterA = await getRoster(tokenA);
    const victim = agumonOf(rosterA);

    const tokenB = await registerAndLogin('intruder-b-battle@example.test');
    const rosterB = await getRoster(tokenB);
    const aIds = new Set(rosterA.map((d) => d.id));
    expect(rosterB.every((d) => !aIds.has(d.id))).toBe(true);

    // B attempts to battle A's Digimon by id → 404 (owner-scoped find misses).
    const res = await postBattle(victim.id, 'numemon', tokenB);
    expect(res.status).toBe(404);

    // A's row is never mutated by B's attempt.
    const rosterAafter = await getRoster(tokenA);
    const untouched = rosterAafter.find((d) => d.id === victim.id)!;
    expect(untouched.level).toBe(victim.level);
    expect(untouched.xp).toBe(victim.xp);
  });

  // TASK-155 (R-22 slice 16): the auto-resolve POST /digimon/:id/battle now routes through
  // simulateBattleAtb, so the AUTO fight HONORS the banked ATB mini-combo — closing the
  // auto-vs-interactive divergence (present ≠ observable, L-17). Before, the auto driver ordered
  // every round PURELY by SPD and NEVER read atb, so a fast Digimon banked its extra action ONLY
  // on the interactive /battle/turn path. Here we give the starter a very high SPD (banking
  // atb >= ATB_THRESHOLD in round 1), fight the weak foe, and assert the returned turn log now
  // contains the banked EXTRA player action WITHIN round 1 (more than the one action/side/round the
  // pure SPD order allows) — the observable divergence-close through the real HTTP boundary. The
  // reward path is UNCHANGED (a FREE-XP win, invariant 3 untriggered).
  it('surfaces the banked ATB mini-combo in the AUTO-resolved turn log (TASK-155 divergence-close)', async () => {
    const token = await registerAndLogin('atb-combo-battle@example.test');
    const roster = await getRoster(token);
    const agumon = agumonOf(roster);

    // Bump the starter's SPD far above ATB_THRESHOLD so it banks >= 1 full threshold in round 1,
    // earning at least one capped bonus action the SPD-order-only path would never grant.
    const prisma = app.get(PrismaService);
    await prisma.digimon.update({
      where: { id: agumon.id },
      data: { spd: 300 },
    });

    const res = await postBattle(agumon.id, 'numemon', token);
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as BattleOutcomeView;

    // A player action that dealt damage in round 1. Under the pure SPD order simulateBattle grants
    // exactly ONE such action per round; the ATB mini-combo grants MORE.
    const round1PlayerHits = outcome.turns.filter(
      (t) => t.round === 1 && t.actor === 'player' && t.damage > 0,
    ).length;
    expect(round1PlayerHits).toBeGreaterThan(1);
  });
});
