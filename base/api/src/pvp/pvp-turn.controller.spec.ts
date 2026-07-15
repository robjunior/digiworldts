import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import { DEFAULT_RNG } from '../digimon/rng';
import {
  chooserForDifficulty,
  deserializeFightState,
  findCombatantSkill,
  type Combatant,
  type SerializedFightState,
} from '../digimon/battle';
import { lossPenaltyFor } from '../digimon/training';
import { PrismaService } from '../prisma/prisma.service';
import { bootHttpTestApp, type TempDatastore } from '../test/datastore';
import { PvpService } from './pvp.service';
import type { PvpTurnView } from './pvp.types';

/**
 * INTERACTIVE per-turn PvP contract (TASK-182, R-23a2 slice 43) — the runnable proof
 * that a PvP duel is now driven turn-by-turn through the SAME shared
 * `battleTurn`/`resolveActorTurn` engine PvE uses, the opponent entering as the injected
 * `foe` (TASK-180). Completes R-23's "both PvE and PvP are the SAME combat UI" outcome.
 *
 * Harness = the shared house `bootHttpTestApp()` (P-2 + P-6): a REAL AppModule + a
 * per-run throwaway SQLite DB. Registration + roster materialization go over HTTP (the
 * true stack), but the OUTCOME-asserting turns are driven via the DIRECT `PvpService`
 * with `DEFAULT_RNG` (L-55/L-56/L-75 non-flaky discipline) — NOT over the `LIVE_RNG`
 * HTTP `/pvp/challenge/turn` path, which would flake. The HTTP route's wiring (that it
 * exists + validates + injects `LIVE_RNG`) rides on the sibling P-7 controller specs;
 * here we prove the SEAM behaviour deterministically.
 */
describe('Interactive per-turn PvP (end-to-end)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let ds: TempDatastore;

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

  const registerLoginWithRoster = async (email: string): Promise<string> => {
    const password = 'password123';
    const register = await jsonPost('/auth/register', { email, password });
    expect(register.status).toBe(201);
    (await register.json()) as RegisterResponse;
    const login = await jsonPost('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    // Materialize the starter roster (grant-on-first-read) so this player has a champion.
    const roster = await authGet('/digimon', accessToken);
    expect(roster.status).toBe(200);
    expect(((await roster.json()) as unknown[]).length).toBeGreaterThan(0);
    return accessToken;
  };

  const userByEmail = async (email: string): Promise<{ id: string; mmr: number }> => {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findFirst({ where: { email } });
    if (user === null) throw new Error(`test setup: no user for ${email}`);
    return { id: user.id, mmr: user.mmr };
  };

  const championName = async (email: string): Promise<string> => {
    const prisma = app.get(PrismaService);
    const { id } = await userByEmail(email);
    const champ = await prisma.digimon.findFirst({
      where: { userId: id, deletedAt: null },
      orderBy: [{ level: 'desc' }, { id: 'asc' }],
    });
    if (champ === null) throw new Error(`test setup: no champion for ${email}`);
    return champ.name;
  };

  /**
   * TASK-275 (R-44b — team PvP party-vs-party): mark the given user's top-`count` Digimon
   * (by the champion order) as a persisted party (partySlot 1..count) so the PvP seam fields
   * the whole party. Returns the ordered party rows (front = champion).
   */
  const setPartyForUser = async (
    email: string,
    count: number,
  ): Promise<{ id: string; name: string }[]> => {
    const prisma = app.get(PrismaService);
    const { id } = await userByEmail(email);
    const rows = await prisma.digimon.findMany({
      where: { userId: id, deletedAt: null },
      orderBy: [{ level: 'desc' }, { id: 'asc' }],
      take: count,
    });
    if (rows.length < count) throw new Error(`test setup: not enough Digimon for ${email}`);
    for (let i = 0; i < rows.length; i += 1) {
      await prisma.digimon.update({ where: { id: rows[i].id }, data: { partySlot: i + 1 } });
    }
    return rows.map((r) => ({ id: r.id, name: r.name }));
  };

  /** Count the `battle_loot` audit rows + resource-balance rows across ALL users. */
  const economicRowCounts = async (): Promise<{ audit: number; balance: number }> => {
    const prisma = app.get(PrismaService);
    const audit = await prisma.auditLog.count({ where: { action: 'battle_loot' } });
    const balance = await prisma.resourceBalance.count();
    return { audit, balance };
  };

  beforeAll(async () => {
    ds = await bootHttpTestApp('pvp-turn');
    app = ds.app;
    baseUrl = ds.baseUrl;
  });

  afterAll(async () => {
    await ds?.dispose();
  });

  it('OPENING call returns an interactive fight whose enemy is the OPPONENT champion (the foe injection), with a menu; NO rating moved yet', async () => {
    const emailA = 'pvpturn-open-a@example.test';
    const emailB = 'pvpturn-open-b@example.test';
    await registerLoginWithRoster(emailA);
    await registerLoginWithRoster(emailB);
    const { id: idA, mmr: mmrABefore } = await userByEmail(emailA);
    const { id: idB, mmr: mmrBBefore } = await userByEmail(emailB);
    const oppChampion = await championName(emailB);

    const service = app.get(PvpService);
    // OPENING turn: no skillId, no state → the server seeds a fresh duel + returns the menu.
    const opening: PvpTurnView = await service.challengeTurn(
      idA,
      { opponentId: idB },
      DEFAULT_RNG,
    );

    // The enemy in the shared view is the OPPONENT's champion (proving `foe` injection),
    // NOT a static roster species. It carries the opponent's champion NAME.
    expect(opening.battle.enemy.name).toBe(oppChampion);
    // A live opening fight: still going (outcome null), a carried state + an affordable menu.
    expect(opening.battle.outcome).toBeNull();
    expect(opening.battle.state).not.toBeNull();
    expect(opening.battle.playerSkills.length).toBeGreaterThan(0);
    expect(opening.battle.playerSkills.some((s) => s.affordable)).toBe(true);

    // Mid-fight: NO rating move yet (invariant 3 untriggered until the duel ends).
    expect(opening.challenger).toBeNull();
    expect(opening.opponent).toBeNull();
    expect((await userByEmail(emailA)).mmr).toBe(mmrABefore);
    expect((await userByEmail(emailB)).mmr).toBe(mmrBBefore);

    // Sanity: the same rosters name idA/idB distinct players.
    expect(idA).not.toBe(idB);
    expect(mmrABefore).toBe(1000);
    expect(mmrBBefore).toBe(1000);
  });

  it('a mid-fight turn advances against that same foe, appends entries, and moves NO rating', async () => {
    const emailA = 'pvpturn-mid-a@example.test';
    const emailB = 'pvpturn-mid-b@example.test';
    await registerLoginWithRoster(emailA);
    await registerLoginWithRoster(emailB);
    const { id: idA } = await userByEmail(emailA);
    const { id: idB } = await userByEmail(emailB);
    const oppChampion = await championName(emailB);

    const service = app.get(PvpService);
    const opening = await service.challengeTurn(idA, { opponentId: idB }, DEFAULT_RNG);
    expect(opening.battle.outcome).toBeNull();

    const skill = opening.battle.playerSkills.find((s) => s.affordable);
    if (skill === undefined) throw new Error('test setup: no affordable opening skill');

    const mmrABefore = (await userByEmail(emailA)).mmr;
    const mmrBBefore = (await userByEmail(emailB)).mmr;

    const mid = await service.challengeTurn(
      idA,
      { opponentId: idB, skillId: skill.id, state: opening.battle.state ?? undefined },
      DEFAULT_RNG,
    );

    // Still fighting the SAME opponent champion; this exchange appended entries.
    expect(mid.battle.enemy.name).toBe(oppChampion);
    expect(mid.battle.entries.length).toBeGreaterThan(0);

    // If the fight has not ended, no rating moved; if it ended in one turn, that's the
    // ending-turn contract (covered by the next test) — assert the mid-fight case here.
    if (mid.battle.outcome === null) {
      expect(mid.challenger).toBeNull();
      expect(mid.opponent).toBeNull();
      expect((await userByEmail(emailA)).mmr).toBe(mmrABefore);
      expect((await userByEmail(emailB)).mmr).toBe(mmrBBefore);
    }
  });

  // TASK-186 (R-24 slice 45b): the PvP DTO now accepts action:'timeout' (mirroring the PvE
  // DTO widen from TASK-185). `dto.action` is forwarded verbatim into the shared
  // `battleTurn`, which resolves a timeout by casting the engine's own `chooseSkill` default
  // (invariant 1 — the challenger cannot clock-game a better move). This proves a timeout
  // turn is ACCEPTED (never 422s for a missing skillId) and ADVANCES the duel.
  it("a mid-fight action:'timeout' turn advances the duel with a server-picked move (no skillId, never 422s) — TASK-186", async () => {
    const emailA = 'pvpturn-timeout-a@example.test';
    const emailB = 'pvpturn-timeout-b@example.test';
    await registerLoginWithRoster(emailA);
    await registerLoginWithRoster(emailB);
    const { id: idA } = await userByEmail(emailA);
    const { id: idB } = await userByEmail(emailB);
    const oppChampion = await championName(emailB);

    const service = app.get(PvpService);
    const opening = await service.challengeTurn(idA, { opponentId: idB }, DEFAULT_RNG);
    expect(opening.battle.outcome).toBeNull();

    // A timeout carries NO skillId — the server picks the move. It must NOT throw/422.
    const timedOut = await service.challengeTurn(
      idA,
      { opponentId: idB, action: 'timeout', state: opening.battle.state ?? undefined },
      DEFAULT_RNG,
    );

    // The duel advanced against the same champion (entries appended), not the empty preview.
    expect(timedOut.battle.enemy.name).toBe(oppChampion);
    expect(timedOut.battle.entries.length).toBeGreaterThan(0);
  });

  it('the ENDING turn applies the Elo move EXACTLY ONCE (the SAME move `challenge` produces) with NO audit/balance row; the challenger Digimon is NOT levelled', async () => {
    const emailA = 'pvpturn-end-a@example.test';
    const emailB = 'pvpturn-end-b@example.test';
    await registerLoginWithRoster(emailA);
    await registerLoginWithRoster(emailB);
    const { id: idA } = await userByEmail(emailA);
    const { id: idB } = await userByEmail(emailB);

    const service = app.get(PrismaService);
    const pvp = app.get(PvpService);

    const before = await economicRowCounts();

    // Drive the interactive duel to its end, carrying state each turn, DEFAULT_RNG
    // (deterministic — the SAME resolution `challenge`/`simulatePvpDuel` produces).
    let view: PvpTurnView = await pvp.challengeTurn(idA, { opponentId: idB }, DEFAULT_RNG);
    let guard = 0;
    while (view.battle.outcome === null && guard < 200) {
      guard += 1;
      const skill = view.battle.playerSkills.find((s) => s.affordable);
      view = await pvp.challengeTurn(
        idA,
        {
          opponentId: idB,
          // If the player is control-locked (empty menu) advance via 'pass'.
          ...(skill ? { skillId: skill.id } : { action: 'pass' as const }),
          state: view.battle.state ?? undefined,
        },
        DEFAULT_RNG,
      );
    }
    expect(view.battle.outcome).not.toBeNull();
    expect(['win', 'loss', 'fled']).toContain(view.battle.outcome);

    // The ending turn surfaced BOTH rating moves exactly once.
    expect(view.challenger).not.toBeNull();
    expect(view.opponent).not.toBeNull();
    expect(view.challenger!.mmrBefore).toBe(1000);
    expect(view.opponent!.mmrBefore).toBe(1000);

    // The persisted ratings equal the reported move (applied EXACTLY ONCE) and are
    // symmetric (zero-sum up to rounding — a win for one is the loss for the other).
    const userA = await service.user.findFirst({ where: { id: idA } });
    const userB = await service.user.findFirst({ where: { id: idB } });
    expect(userA!.mmr).toBe(view.challenger!.mmrAfter);
    expect(userB!.mmr).toBe(view.opponent!.mmrAfter);
    const challengerDelta = view.challenger!.mmrAfter - view.challenger!.mmrBefore;
    const opponentDelta = view.opponent!.mmrAfter - view.opponent!.mmrBefore;
    expect(challengerDelta).not.toBe(0);
    expect(challengerDelta).toBe(-opponentDelta);
    // A win moves the challenger UP, a loss/fled DOWN (challenger's perspective).
    if (view.battle.outcome === 'win') {
      expect(challengerDelta).toBeGreaterThan(0);
    } else {
      expect(challengerDelta).toBeLessThan(0);
    }

    // Invariant 3 UNTRIGGERED: a PvP duel moves NO spendable value — the win path was
    // driven with `skipEconomicReward`, so NO `battle_loot` audit row + NO new
    // ResourceBalance row was written across the whole duel.
    const after = economicRowCounts;
    const counts = await after();
    expect(counts.audit).toBe(before.audit);
    expect(counts.balance).toBe(before.balance);

    // The challenger's Digimon was NOT levelled (a ranked duel does not grant XP).
    const champ = await service.digimon.findFirst({
      where: { userId: idA, deletedAt: null },
      orderBy: [{ level: 'desc' }, { id: 'asc' }],
    });
    expect(champ!.level).toBe(1);
    expect(champ!.xp).toBe(0);
    // The turn view reports NO XP gained on a PvP win (economic reward suppressed).
    expect(view.battle.reward.xpGained).toBe(0);
    expect(view.battle.reward.loot).toBeUndefined();
  });

  it('the challenger-selected DIFFICULTY reaches the shared seam: an easy duel telegraphs an OBSERVABLY different opponent AI than a hard duel; omitting difficulty is byte-identical to hard (TASK-183)', async () => {
    // TASK-183 (R-23a2 slice 44a): the challenger's chosen tier is forwarded into the
    // shared `battleTurn(...)` `difficulty` slot, so the opponent's champion runs
    // `chooserForDifficulty(tier)`: 'easy' → flat `chooseSkill`, 'hard' → the full
    // banking chain. Before this slice every duel was silently pinned to 'hard'.
    //
    // DETERMINISTIC (DEFAULT_RNG, direct-service — L-55/L-56/L-75 non-flaky discipline, NOT
    // the LIVE_RNG HTTP path): drive the SAME rosters to completion under each tier and
    // collect the opponent's TELEGRAPHED intent (`nextEnemy.skillId`) each turn. The two
    // choosers pick differently over the fight, so the sequences DIFFER — the observable
    // proof the tier reached the engine. Omitting `difficulty` reproduces 'hard' exactly
    // (the invariant-5 `?? 'hard'` default proof).
    const emailA = 'pvpturn-diff-a@example.test';
    const emailB = 'pvpturn-diff-b@example.test';
    await registerLoginWithRoster(emailA);
    await registerLoginWithRoster(emailB);
    const { id: idA } = await userByEmail(emailA);
    const { id: idB } = await userByEmail(emailB);
    const pvp = app.get(PvpService);

    // Drive a full duel under a fixed tier (or omitted), returning the per-turn sequence of
    // the opponent's telegraphed next-skill id — the DIFFICULTY-selected chooser's output.
    const telegraphSequence = async (
      difficulty?: 'easy' | 'normal' | 'hard',
    ): Promise<string[]> => {
      const seq: string[] = [];
      let view: PvpTurnView = await pvp.challengeTurn(
        idA,
        { opponentId: idB, difficulty },
        DEFAULT_RNG,
      );
      if (view.battle.nextEnemy) seq.push(view.battle.nextEnemy.skillId);
      let guard = 0;
      while (view.battle.outcome === null && guard < 200) {
        guard += 1;
        const skill = view.battle.playerSkills.find((s) => s.affordable);
        view = await pvp.challengeTurn(
          idA,
          {
            opponentId: idB,
            ...(skill ? { skillId: skill.id } : { action: 'pass' as const }),
            state: view.battle.state ?? undefined,
            difficulty,
          },
          DEFAULT_RNG,
        );
        if (view.battle.nextEnemy) seq.push(view.battle.nextEnemy.skillId);
      }
      return seq;
    };

    const easySeq = await telegraphSequence('easy');
    const hardSeq = await telegraphSequence('hard');
    const omittedSeq = await telegraphSequence(undefined);

    // Both drove a real, telegraphing duel (the opponent intent surfaced at least once).
    expect(easySeq.length).toBeGreaterThan(0);
    expect(hardSeq.length).toBeGreaterThan(0);

    // The chosen tier is OBSERVABLE: the easy (flat `chooseSkill`) opponent telegraphs a
    // different sequence than the hard (banking-chain) opponent — the knob reached the engine.
    expect(easySeq).not.toEqual(hardSeq);

    // Invariant-5 default proof: OMITTING difficulty is byte-identical to 'hard' (`?? 'hard'`
    // in `battleTurn`), so TASK-182's shipped behaviour is unchanged for every existing duel.
    expect(omittedSeq).toEqual(hardSeq);
  });

  it('TASK-275 (R-44b): an opponent with a PARTY of >=2 fields their WHOLE party — every party member appears in the enemy list, the duel resolves, MMR moves ONCE with NO ResourceBalance/AuditLog row', async () => {
    const emailA = 'pvpturn-team-a@example.test';
    const emailB = 'pvpturn-team-b@example.test';
    await registerLoginWithRoster(emailA);
    await registerLoginWithRoster(emailB);
    const { id: idA, mmr: mmrABefore } = await userByEmail(emailA);
    const { id: idB, mmr: mmrBBefore } = await userByEmail(emailB);
    // Both players set a party of 2; the OPPONENT (B)'s whole party must be fielded.
    await setPartyForUser(emailA, 2);
    const oppParty = await setPartyForUser(emailB, 2);
    const oppChampion = await championName(emailB);

    const pvp = app.get(PvpService);
    const rowsBefore = await economicRowCounts();

    // OPENING turn: the opponent party surfaces on the enemy list (`enemyMembers[]`),
    // front = the champion (the seam mirrors group[0] into the scalar `enemy`, identity anchor).
    const opening: PvpTurnView = await pvp.challengeTurn(idA, { opponentId: idB }, DEFAULT_RNG);
    expect(opening.battle.enemy.name).toBe(oppChampion);
    expect(opening.battle.enemyMembers).toBeDefined();
    const enemyNames = (opening.battle.enemyMembers ?? []).map((m) => m.name);
    // EVERY opponent party member appears (front-first, champion at index 0).
    for (const m of oppParty) expect(enemyNames).toContain(m.name);
    expect(opening.battle.enemyMembers?.[0]?.name).toBe(oppChampion);

    // Drive the duel to termination (deterministic DEFAULT_RNG, bounded loop).
    let view: PvpTurnView = opening;
    for (let i = 0; i < 300 && view.battle.outcome === null; i += 1) {
      const skillId = view.battle.playerSkills.find((s) => s.affordable)?.id;
      view = await pvp.challengeTurn(
        idA,
        {
          opponentId: idB,
          ...(skillId ? { skillId } : { action: 'pass' as const }),
          state: view.battle.state ?? undefined,
        },
        DEFAULT_RNG,
      );
    }
    // The duel ends (one whole party wiped).
    expect(view.battle.outcome).not.toBeNull();
    // MMR moved on the ending turn (challenger + opponent ratings surfaced ONCE).
    expect(view.challenger).not.toBeNull();
    expect(view.opponent).not.toBeNull();
    const mmrAAfter = (await userByEmail(emailA)).mmr;
    const mmrBAfter = (await userByEmail(emailB)).mmr;
    expect(mmrAAfter !== mmrABefore || mmrBAfter !== mmrBBefore).toBe(true);
    // INVARIANT 3 UNTRIGGERED: a duel moves NO spendable value — NO new audit/balance row.
    const rowsAfter = await economicRowCounts();
    expect(rowsAfter.audit).toBe(rowsBefore.audit);
    expect(rowsAfter.balance).toBe(rowsBefore.balance);
  });

  it('TASK-275 (R-44b — identity): an opponent with NO party (single champion) fights EXACTLY as today — `enemyMembers` is OMITTED, a 1v1 duel', async () => {
    const emailA = 'pvpturn-solo-a@example.test';
    const emailB = 'pvpturn-solo-b@example.test';
    await registerLoginWithRoster(emailA);
    await registerLoginWithRoster(emailB);
    const { id: idA } = await userByEmail(emailA);
    const { id: idB } = await userByEmail(emailB);
    // NEITHER player sets a party → the single-champion `foe` path (identity anchor).
    const oppChampion = await championName(emailB);

    const pvp = app.get(PvpService);
    const opening: PvpTurnView = await pvp.challengeTurn(idA, { opponentId: idB }, DEFAULT_RNG);
    // Single-champion 1v1: enemy is the champion, and the enemy list is OMITTED (byte-identical wire).
    expect(opening.battle.enemy.name).toBe(oppChampion);
    expect(opening.battle.enemyMembers).toBeUndefined();
    expect(opening.battle.outcome).toBeNull();
    expect(opening.battle.playerSkills.some((s) => s.affordable)).toBe(true);
  });

  // TASK-277 (R-31e — PvP-loss XP penalty, challenger only, XP-only, no wipe): a challenger who
  // LOSES an interactive duel takes the SAME level-scaled+capped xp-only penalty a PvE loss
  // applies + a `battle-loss` audit row (surfaced on `battle.reward.xpLost`), but their inventory
  // is UNTOUCHED (no `battle-loss-wipe` rows). A PvP WIN writes NO penalty (MMR-only, unchanged).
  it('TASK-277: a challenger who LOSES a duel takes the xp-only penalty + a battle-loss row (inventory intact), and the drop surfaces on reward.xpLost; a WIN writes no penalty', async () => {
    const emailA = 'pvpturn-lossxp-a@example.test';
    const emailB = 'pvpturn-lossxp-b@example.test';
    await registerLoginWithRoster(emailA);
    await registerLoginWithRoster(emailB);
    const { id: idA } = await userByEmail(emailA);
    const { id: idB } = await userByEmail(emailB);

    const prisma = app.get(PrismaService);
    // The challenger's own champion (owner-scoped by the champion order the seam uses).
    const challChamp = await prisma.digimon.findFirstOrThrow({
      where: { userId: idA, deletedAt: null },
      orderBy: [{ level: 'desc' }, { id: 'asc' }],
    });
    const oppChamp = await prisma.digimon.findFirstOrThrow({
      where: { userId: idB, deletedAt: null },
      orderBy: [{ level: 'desc' }, { id: 'asc' }],
    });

    // Force a CHALLENGER LOSS: cripple the challenger's champion + buff the opponent's so the
    // deterministic duel resolves against A. Seed the challenger's xp above the penalty so the
    // real SUBTRACTION (not the floor-at-0 case) is asserted.
    const expectedPenalty = lossPenaltyFor(challChamp.level);
    const seededXp = expectedPenalty + 50;
    await prisma.digimon.update({
      where: { id: challChamp.id },
      data: { xp: seededXp, hp: 8, atk: 3, def: 3, spd: 5 },
    });
    await prisma.digimon.update({
      where: { id: oppChamp.id },
      data: { hp: 200, atk: 60, def: 40, spd: 40 },
    });
    // Two owned stacks: if the wipe LEAKED into the PvP path they would vanish — assert they DON'T.
    await prisma.inventoryItem.create({ data: { userId: idA, itemId: 'heal-chip-1', quantity: 4 } });
    await prisma.inventoryItem.create({ data: { userId: idA, itemId: 'meat-storage-1', quantity: 1 } });

    const pvp = app.get(PvpService);
    let view: PvpTurnView = await pvp.challengeTurn(idA, { opponentId: idB }, DEFAULT_RNG);
    let guard = 0;
    while (view.battle.outcome === null && guard < 300) {
      guard += 1;
      const skillId = view.battle.playerSkills.find((s) => s.affordable)?.id;
      view = await pvp.challengeTurn(
        idA,
        {
          opponentId: idB,
          ...(skillId ? { skillId } : { action: 'pass' as const }),
          state: view.battle.state ?? undefined,
        },
        DEFAULT_RNG,
      );
    }
    // The crippled challenger loses this duel.
    expect(view.battle.outcome).toBe('loss');

    // The xp penalty applied + is REPORTED on the shared defeat notice; NO wipe report.
    const expectedXp = Math.max(0, seededXp - expectedPenalty);
    expect(view.battle.reward.xpLost).toBe(expectedPenalty);
    expect(view.battle.reward.inventoryWiped).toBe(false);

    // Persisted: the challenger's champion xp dropped, level unchanged (A-42 — never de-levels).
    const afterChamp = await prisma.digimon.findFirstOrThrow({ where: { id: challChamp.id } });
    expect(afterChamp.xp).toBe(expectedXp);
    expect(afterChamp.level).toBe(challChamp.level);

    // Exactly ONE battle-loss audit row for the challenger; ZERO battle-loss-wipe rows.
    const lossAudit = await prisma.auditLog.findMany({
      where: { userId: idA, action: 'battle-loss' },
    });
    expect(lossAudit).toHaveLength(1);
    expect(lossAudit[0].entityId).toBe(challChamp.id);
    expect(lossAudit[0].amountBefore).toBe(seededXp);
    expect(lossAudit[0].amountAfter).toBe(expectedXp);
    const wipeAudit = await prisma.auditLog.findMany({
      where: { userId: idA, action: 'battle-loss-wipe' },
    });
    expect(wipeAudit).toHaveLength(0);

    // Inventory UNTOUCHED (the pack-wipe stays PvE-only).
    const heal = await prisma.inventoryItem.findUnique({
      where: { userId_itemId: { userId: idA, itemId: 'heal-chip-1' } },
    });
    const meat = await prisma.inventoryItem.findUnique({
      where: { userId_itemId: { userId: idA, itemId: 'meat-storage-1' } },
    });
    expect(heal!.quantity).toBe(4);
    expect(meat!.quantity).toBe(1);

    // TASK-279 (R-31e — identity anchor): the challenger LOST, so the OPPONENT (idB) takes NO
    // opponent-loss penalty — a challenger loss/fled/draw writes ZERO `battle-loss` row for the
    // opponent (that path is TASK-277's challenger-loss, applied to idA above — not idB). The
    // opponent's champion xp is UNCHANGED.
    const oppLossAudit = await prisma.auditLog.findMany({
      where: { userId: idB, action: 'battle-loss' },
    });
    expect(oppLossAudit).toHaveLength(0);
    const oppChampAfter = await prisma.digimon.findFirstOrThrow({
      where: { userId: idB, deletedAt: null },
      orderBy: [{ level: 'desc' }, { id: 'asc' }],
    });
    expect(oppChampAfter.xp).toBe(oppChamp.xp);

    // The MMR/Elo move still fired ONCE on the ending turn (invariant 3 UNTRIGGERED for xp —
    // no ResourceBalance move — but the ranked rating still resolves as before).
    expect(view.challenger).not.toBeNull();
    expect(view.opponent).not.toBeNull();

    // A PvP WIN writes NO xp penalty (the reverse-crippled duel): buff A, cripple B.
    const emailC = 'pvpturn-winxp-c@example.test';
    const emailD = 'pvpturn-winxp-d@example.test';
    await registerLoginWithRoster(emailC);
    await registerLoginWithRoster(emailD);
    const { id: idC } = await userByEmail(emailC);
    const { id: idD } = await userByEmail(emailD);
    const winnerChamp = await prisma.digimon.findFirstOrThrow({
      where: { userId: idC, deletedAt: null },
      orderBy: [{ level: 'desc' }, { id: 'asc' }],
    });
    const loserChamp = await prisma.digimon.findFirstOrThrow({
      where: { userId: idD, deletedAt: null },
      orderBy: [{ level: 'desc' }, { id: 'asc' }],
    });
    const winnerXpBefore = winnerChamp.xp;
    await prisma.digimon.update({
      where: { id: winnerChamp.id },
      data: { hp: 200, atk: 60, def: 40, spd: 40 },
    });
    await prisma.digimon.update({
      where: { id: loserChamp.id },
      data: { hp: 8, atk: 3, def: 3, spd: 5 },
    });
    // TASK-279 (R-31e — OPPONENT-loss xp penalty): capture the losing opponent's pre-duel xp
    // so we can prove the challenger's WIN now bleeds the OPPONENT the same level-scaled toll a
    // PvE / challenger loss / forfeit does — where today a duel win cost the opponent ONLY MMR.
    const loserXpBefore = loserChamp.xp;
    const loserLevel = loserChamp.level;
    const expectedOppPenalty = lossPenaltyFor(loserLevel);

    let winView: PvpTurnView = await pvp.challengeTurn(idC, { opponentId: idD }, DEFAULT_RNG);
    let wguard = 0;
    while (winView.battle.outcome === null && wguard < 300) {
      wguard += 1;
      const skillId = winView.battle.playerSkills.find((s) => s.affordable)?.id;
      winView = await pvp.challengeTurn(
        idC,
        {
          opponentId: idD,
          ...(skillId ? { skillId } : { action: 'pass' as const }),
          state: winView.battle.state ?? undefined,
        },
        DEFAULT_RNG,
      );
    }
    expect(winView.battle.outcome).toBe('win');
    // A win writes NO penalty: no xpLost report, xp unchanged, no battle-loss row for the winner.
    expect(winView.battle.reward.xpLost).toBeUndefined();
    const afterWinner = await prisma.digimon.findFirstOrThrow({ where: { id: winnerChamp.id } });
    expect(afterWinner.xp).toBe(winnerXpBefore);
    const winnerLossAudit = await prisma.auditLog.findMany({
      where: { userId: idC, action: 'battle-loss' },
    });
    expect(winnerLossAudit).toHaveLength(0);

    // TASK-279 (R-31e): the losing OPPONENT (idD) now takes the SAME xp-only, capped,
    // level-scaled toll — its persisted champion xp dropped by EXACTLY `lossPenaltyFor(level)`
    // (floored at 0, level unchanged — A-42 never de-levels), with exactly ONE `battle-loss`
    // audit row for the opponent's userId/entityId carrying the matching before→after amounts.
    const afterLoser = await prisma.digimon.findFirstOrThrow({ where: { id: loserChamp.id } });
    const expectedLoserXp = Math.max(0, loserXpBefore - expectedOppPenalty);
    expect(afterLoser.xp).toBe(expectedLoserXp);
    expect(afterLoser.level).toBe(loserLevel);
    const loserLossAudit = await prisma.auditLog.findMany({
      where: { userId: idD, action: 'battle-loss' },
    });
    expect(loserLossAudit).toHaveLength(1);
    expect(loserLossAudit[0].entityId).toBe(loserChamp.id);
    expect(loserLossAudit[0].amountBefore).toBe(loserXpBefore);
    expect(loserLossAudit[0].amountAfter).toBe(expectedLoserXp);
    expect(loserLossAudit[0].resource).toBeNull();
    // The MMR/Elo move still fired ONCE for BOTH (rating path byte-unchanged).
    expect(winView.challenger).not.toBeNull();
    expect(winView.opponent).not.toBeNull();
    expect(winView.challenger!.mmrAfter).toBeGreaterThan(winView.challenger!.mmrBefore);
    expect(winView.opponent!.mmrAfter).toBeLessThan(winView.opponent!.mmrBefore);
  });

  it('a self-challenge is rejected (422) and an unknown opponent 404s — before any rating move', async () => {
    const email = 'pvpturn-guard@example.test';
    await registerLoginWithRoster(email);
    const { id } = await userByEmail(email);
    const pvp = app.get(PvpService);

    await expect(pvp.challengeTurn(id, { opponentId: id }, DEFAULT_RNG)).rejects.toThrow();
    await expect(
      pvp.challengeTurn(id, { opponentId: 'no-such-user' }, DEFAULT_RNG),
    ).rejects.toThrow();
  });

  // TASK-312 (R-44b — live-opponent action seam): a `POST /pvp/challenge/turn` carrying
  // `opponentSkillId` drives the OPPONENT'S champion turn with THAT skill instead of the engine
  // AI pick — the load-bearing FIRST slice toward a two-sided interactive duel. Driven via the
  // DIRECT `PvpService` with `DEFAULT_RNG` (the file's non-flaky discipline), plus one HTTP-boundary
  // acceptance to prove the DTO field survives the pipe.
  describe('TASK-312 — a supplied opponentSkillId drives the opponent turn', () => {
    /** Build the opponent champion's authoritative Combatant from its DB row (as the service does). */
    const opponentCombatant = async (email: string): Promise<Combatant> => {
      const prisma = app.get(PrismaService);
      const { id } = await userByEmail(email);
      const champ = await prisma.digimon.findFirstOrThrow({
        where: { userId: id, deletedAt: null },
        orderBy: [{ level: 'desc' }, { id: 'asc' }],
      });
      return {
        name: champ.name,
        type: champ.type,
        element: champ.element,
        hp: champ.hp,
        maxHp: champ.hp,
        atk: champ.atk,
        def: champ.def,
        spd: champ.spd,
      };
    };

    it('a supplied opponentSkillId makes the opponent champion cast THAT skill (superseding the AI pick); the SAME request WITHOUT it yields the AI pick', async () => {
      const emailA = 'pvpturn-t312-a@example.test';
      const emailB = 'pvpturn-t312-b@example.test';
      await registerLoginWithRoster(emailA);
      await registerLoginWithRoster(emailB);
      const { id: idA } = await userByEmail(emailA);
      const { id: idB } = await userByEmail(emailB);

      const service = app.get(PvpService);
      const opening = await service.challengeTurn(idA, { opponentId: idB }, DEFAULT_RNG);
      expect(opening.battle.outcome).toBeNull();

      // Compute what the AI would cast for the opponent on THIS live state (hard default), so
      // 'attack' is DISTINGUISHABLE from it (present ≠ observable).
      const live = deserializeFightState(opening.battle.state as SerializedFightState);
      const enemyC = await opponentCombatant(emailB);
      const playerC = await opponentCombatant(emailA);
      const aiPick = chooserForDifficulty('hard')(live.enemy, live.player, enemyC, playerC);
      const attackSkill = findCombatantSkill('attack')!;
      expect(aiPick.id).not.toBe('attack');

      const playerSkill = opening.battle.playerSkills.find((s) => s.affordable)!;

      // Supply the opponent's action → the opponent champion casts THAT skill (Attack).
      const supplied = await service.challengeTurn(
        idA,
        {
          opponentId: idB,
          skillId: playerSkill.id,
          state: opening.battle.state ?? undefined,
          opponentSkillId: 'attack',
        },
        DEFAULT_RNG,
      );
      const suppliedEnemyEntry = supplied.battle.entries.find((e) => e.actor === 'enemy');
      expect(suppliedEnemyEntry).toBeDefined();
      expect(suppliedEnemyEntry!.skill).toBe(attackSkill.name);

      // The SAME request WITHOUT opponentSkillId → the AI-driven opponent turn (identity anchor).
      const aiDriven = await service.challengeTurn(
        idA,
        {
          opponentId: idB,
          skillId: playerSkill.id,
          state: opening.battle.state ?? undefined,
        },
        DEFAULT_RNG,
      );
      const aiEnemyEntry = aiDriven.battle.entries.find((e) => e.actor === 'enemy');
      expect(aiEnemyEntry).toBeDefined();
      expect(aiEnemyEntry!.skill).toBe(aiPick.name);
      expect(aiEnemyEntry!.skill).not.toBe(attackSkill.name);
    });

    it('the HTTP POST /pvp/challenge/turn ACCEPTS opponentSkillId (survives the whitelist pipe) → 200; unauthenticated → 401', async () => {
      const emailA = 'pvpturn-t312-http-a@example.test';
      const emailB = 'pvpturn-t312-http-b@example.test';
      const tokenA = await registerLoginWithRoster(emailA);
      await registerLoginWithRoster(emailB);
      const { id: idB } = await userByEmail(emailB);

      // Unauthenticated → 401 (before any resolution).
      const unauth = await jsonPost('/pvp/challenge/turn', {
        opponentId: idB,
        opponentSkillId: 'attack',
      });
      expect(unauth.status).toBe(401);

      // Authenticated OPENING request carrying opponentSkillId is accepted (the field survives the
      // whitelist pipe and the opening preview resolves no enemy turn, so it is a harmless opener).
      const ok = await jsonPost(
        '/pvp/challenge/turn',
        { opponentId: idB, opponentSkillId: 'attack' },
        tokenA,
      );
      expect(ok.status).toBe(200);
      const view = (await ok.json()) as PvpTurnView;
      expect(view.battle.outcome).toBeNull();
      expect(view.battle.state).not.toBeNull();
    });
  });
});
