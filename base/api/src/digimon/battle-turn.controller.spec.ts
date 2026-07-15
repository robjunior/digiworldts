import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import type { BattleTurnView, OwnedDigimon } from './digimon.types';
import { DigimonService } from './digimon.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Rng } from './rng';
import { DEFAULT_RNG } from './rng';
import {
  chooseSkill,
  scaledBattleReward,
  BATTLE_XP_REWARD,
  battleLootAmount,
  BATTLE_LOOT_RESOURCE,
  chooseSkillFinisher,
  chooseSkillMatchup,
  chooserForDifficulty,
  chooseSkillDefensive,
  chooseSkillBanking,
  deserializeFightState,
  energyAtTurnStart,
  findEnemy,
  findCombatantSkill,
  MAX_ENERGY,
  ATB_THRESHOLD,
  MAX_ATB_BONUS_ACTIONS,
  DOUBLE_STRIKE_ENERGY_COST,
  SKILLS,
  type Combatant,
  type Enemy,
  type SerializedFightState,
} from './battle';
import { lootResourceForBiome, rollLootResource, lootRarityForBiome } from '../world/encounter';
import { lossPenaltyFor } from './training';

/**
 * Interactive combat turn API (TASK-140, R-22) — the runnable proof of the FIRST genuine
 * player AGENCY in combat. Instead of the whole fight resolving server-side (the existing
 * `POST /digimon/:id/battle`, which stays byte-unchanged — invariant 5), the player drives
 * the fight ONE turn at a time via `POST /digimon/:id/battle/turn`: post the chosen
 * `skillId` (+ the mid-fight `state` carried from the previous response — A-123, no server
 * session store this slice); the server validates the choice server-authoritatively
 * (palette + affordability → 422), resolves the player turn + the enemy's automatic reply,
 * and returns the carried-forward state, this exchange's log entries, and the menu for the
 * next turn. The win reward (FREE XP — invariant 3 untriggered) is granted EXACTLY ONCE, on
 * the finishing winning turn, through the same reward curve as the whole-fight route.
 *
 * Harness = the SAME P-2 (real Nest via `createApp()`) + P-6 (throwaway SQLite DB) block
 * copied verbatim from the sibling `battle.controller.spec.ts`.
 */
describe('Interactive battle turn API (end-to-end)', () => {
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

  const registerAndLogin = async (email: string): Promise<string> => {
    const password = 'password123';
    const register = await jsonPost('/auth/register', { email, password });
    expect(register.status).toBe(201);
    (await register.json()) as RegisterResponse;
    const login = await jsonPost('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    return accessToken;
  };

  const getRoster = async (token: string): Promise<OwnedDigimon[]> => {
    const res = await fetch(`${baseUrl}/digimon`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as OwnedDigimon[];
  };

  const agumonOf = (roster: OwnedDigimon[]): OwnedDigimon =>
    roster.find((d) => d.name === 'Agumon')!;

  /** `POST /digimon/:id/battle/turn`, with an optional Bearer token. */
  const postTurn = (id: string, body: unknown, token?: string) =>
    fetch(`${baseUrl}/digimon/${id}/battle/turn`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  /**
   * Drive ONE interactive turn DETERMINISTICALLY through the SERVICE with DEFAULT_RNG
   * (= () => 0), returning the view. TASK-177 wired the HTTP controller to LIVE_RNG
   * (real Math.random), so full-fight drivers that assert a specific WIN/LOSS outcome
   * must NOT go through the HTTP boundary (a crit/evade roll would flip the fight and
   * flake the assertion — L-55/L-56 non-flaky discipline). This resolves the SAME
   * service method the controller calls, minus the entropy, so the fight is byte-reproducible
   * while still exercising the real app + DB persistence path. Used only by the outcome-
   * asserting reward drivers below; the WIRING that production feeds LIVE_RNG is proven
   * separately in `battle-turn.rng-wiring.spec.ts`.
   */
  const turnViaService = (
    userId: string,
    id: string,
    body: {
      enemyId: string;
      skillId?: string;
      state?: BattleTurnView['state'];
      action?: 'flee' | 'pass' | 'timeout';
      difficulty?: 'easy' | 'normal' | 'hard';
      enemyScale?: number;
      biome?: string;
      memberSlot?: number;
      enemyIds?: string[];
      targetEnemyIndex?: number;
    },
  ): Promise<BattleTurnView> =>
    app
      .get(DigimonService)
      .battleTurn(
        userId,
        id,
        body.enemyId,
        body.skillId,
        body.state ?? undefined,
        body.action,
        DEFAULT_RNG,
        body.difficulty,
        body.enemyScale,
        body.biome,
        undefined,
        undefined,
        body.memberSlot,
        body.enemyIds,
        body.targetEnemyIndex,
      );

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-battle-turn-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'battle-turn.db')}`;
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

  it('rejects a turn with NO Authorization header → 401', async () => {
    const res = await postTurn('any-id', { enemyId: 'numemon', skillId: 'attack' });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed body (missing enemyId) → 400', async () => {
    const token = await registerAndLogin('badbody-turn@example.test');
    const agumon = agumonOf(await getRoster(token));
    const res = await postTurn(agumon.id, { skillId: 'attack' }, token);
    expect(res.status).toBe(400);
  });

  it('START PREVIEW (no skillId) → returns the initial menu WITHOUT resolving a turn', async () => {
    const token = await registerAndLogin('preview-turn@example.test');
    const agumon = agumonOf(await getRoster(token));
    const res = await postTurn(agumon.id, { enemyId: 'numemon' }, token);
    expect(res.status).toBe(200);
    const view = (await res.json()) as BattleTurnView;
    // No turn resolved: no entries, undecided, a full carried state, a non-empty menu.
    expect(view.entries).toHaveLength(0);
    expect(view.outcome).toBeNull();
    expect(view.state).not.toBeNull();
    expect(view.playerSkills.length).toBeGreaterThan(0);
    expect(view.playerSkills.find((s) => s.id === 'attack')!.affordable).toBe(true);
    // R-34 / TASK-205: the menu projection carries the display-only element tag for
    // the player's known skills (copied through from the catalog Skill.element), so the
    // /battle menu can GROUP by element. `attack` is Neutral; `fire-breath` is Fire.
    expect(view.playerSkills.find((s) => s.id === 'attack')!.element).toBe('Neutral');
    expect(view.playerSkills.find((s) => s.id === 'fire-breath')!.element).toBe('Fire');
    // At least two DISTINCT element groups are present so the grouping is observable.
    const elements = new Set(
      view.playerSkills.map((s) => s.element).filter((e): e is string => e != null),
    );
    expect(elements.size).toBeGreaterThanOrEqual(2);
    // TASK-206 (R-28a): the in-menu stragglers guard/focus now surface their canonical
    // digi-api.com display names in the menu projection (present ≠ observable — a player
    // reading the menu SEES the relabel). The rule keys (id/energyCost) are untouched.
    expect(view.playerSkills.find((s) => s.id === 'guard')!.name).toBe('Shield of the Just');
    expect(view.playerSkills.find((s) => s.id === 'focus')!.name).toBe('Berserk Charge');
  });

  it("seeds a FRESH fight (no state) → returns a menu of affordable skills + this exchange's entries + a carried state", async () => {
    const token = await registerAndLogin('fresh-turn@example.test');
    const agumon = agumonOf(await getRoster(token));

    const res = await postTurn(agumon.id, { enemyId: 'numemon', skillId: 'attack' }, token);
    expect(res.status).toBe(200);
    const view = (await res.json()) as BattleTurnView;

    // A non-lethal opening exchange: undecided, state carried forward, menu re-offered.
    expect(view.outcome).toBeNull();
    expect(view.state).not.toBeNull();
    expect(view.entries.length).toBeGreaterThan(0);
    expect(view.enemy).toEqual({ id: 'numemon', name: 'Numemon' });
    // The menu re-offer is now control-lock-aware (TASK-153): if the enemy's reply left the player
    // control-locked, the menu is EMPTY and the lock is surfaced; otherwise the palette is offered
    // (with `attack`, cost 0, always affordable). Either way the field is present and coherent.
    if (view.playerControlLock != null) {
      expect(view.playerSkills).toEqual([]);
    } else {
      expect(view.playerSkills.length).toBeGreaterThan(0);
      const attack = view.playerSkills.find((s) => s.id === 'attack')!;
      expect(attack.affordable).toBe(true);
    }
    // Nothing persisted yet (an ongoing fight grants no reward).
    const after = agumonOf(await getRoster(token));
    expect(after.xp).toBe(agumon.xp);
    expect(after.level).toBe(agumon.level);
  });

  it('rejects an UNAFFORDABLE skill → 422 with the fight state unchanged', async () => {
    const token = await registerAndLogin('unafford-turn@example.test');
    const agumon = agumonOf(await getRoster(token));

    // Seed a fight via the START PREVIEW (no skillId → no turn resolves, so the player is not
    // control-locked by the enemy's reply — TASK-153), then find a skill they cannot afford.
    const first = await postTurn(agumon.id, { enemyId: 'numemon' }, token);
    const view = (await first.json()) as BattleTurnView;
    const unaffordable = view.playerSkills.find((s) => !s.affordable);
    expect(unaffordable).toBeDefined();

    const res = await postTurn(
      agumon.id,
      { enemyId: 'numemon', skillId: unaffordable!.id, state: view.state },
      token,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('Not enough energy');
  });

  it('rejects an unknown enemy → 422; an unknown skill → 422', async () => {
    const token = await registerAndLogin('unknown-turn@example.test');
    const agumon = agumonOf(await getRoster(token));
    expect(
      (await postTurn(agumon.id, { enemyId: 'no-such', skillId: 'attack' }, token)).status,
    ).toBe(422);
    expect(
      (await postTurn(agumon.id, { enemyId: 'numemon', skillId: 'no-such' }, token)).status,
    ).toBe(422);
  });

  it("never advances another player's Digimon → 404 (invariant 2)", async () => {
    const tokenA = await registerAndLogin('owner-turn@example.test');
    const victim = agumonOf(await getRoster(tokenA));
    const tokenB = await registerAndLogin('intruder-turn@example.test');
    const res = await postTurn(victim.id, { enemyId: 'numemon', skillId: 'attack' }, tokenB);
    expect(res.status).toBe(404);
  });

  it('driving the fight to the end (picking the strongest affordable skill each turn) → a WIN that persists XP EXACTLY once', async () => {
    const token = await registerAndLogin('win-turn@example.test');
    const before = agumonOf(await getRoster(token));
    expect(before.level).toBe(1);
    expect(before.xp).toBe(0);
    // TASK-177: the HTTP boundary now feeds LIVE_RNG (real Math.random), so a full-fight
    // outcome asserted over HTTP would flake (a crit/evade roll flips the deterministic win).
    // Drive via the service with DEFAULT_RNG (= () => 0) — the SAME method the controller
    // calls, minus the entropy — so the fight is byte-reproducible while still exercising the
    // real app + DB persistence path (L-55/L-56 non-flaky discipline). The WIRING that
    // production feeds LIVE_RNG is proven in `battle-turn.rng-wiring.spec.ts`.
    const userId = (
      await app.get(PrismaService).digimon.findFirstOrThrow({ where: { id: before.id } })
    ).userId;

    // Play turn-by-turn like a real player: each turn pick the most expensive AFFORDABLE
    // skill the menu offers (the strongest available action), carrying the state forward
    // until the fight decides. Against the weak numemon this reaches a deterministic WIN —
    // and demonstrates that the player's CHOICE drives the outcome (always-Attack loses).
    let state: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let outcome: BattleTurnView['outcome'] = null;
    // The auto-driver's FIRST player pick, from a fresh seeded state (both at MAX_ENERGY,
    // then the start-of-turn regen). Reproduces the auto-fight's opener exactly.
    const numemon = findEnemy('numemon')!;
    const player: Combatant = {
      name: before.name,
      type: before.type,
      element: before.element,
      hp: before.hp,
      maxHp: before.hp,
      atk: before.atk,
      def: before.def,
      spd: before.spd,
    };
    const seed = deserializeFightState({
      player: {
        hp: player.hp,
        energy: energyAtTurnStart(MAX_ENERGY),
        statuses: [],
        inflicted: [],
      },
      enemy: {
        hp: numemon.hp,
        energy: MAX_ENERGY,
        statuses: [],
        inflicted: [],
      },
      round: 1,
      decided: null,
    });
    let nextSkill = chooseSkill(seed.player, seed.enemy).id;
    const allEntries: BattleTurnView['entries'] = [];
    let guard = 0;
    while (outcome === null && guard < 200) {
      guard += 1;
      const view = await turnViaService(userId, before.id, {
        enemyId: 'numemon',
        skillId: nextSkill,
        state: state ?? undefined,
      });
      allEntries.push(...view.entries);
      outcome = view.outcome;
      state = view.state;
      // Mirror the auto-driver's enemy AI for the PLAYER too: pick exactly what
      // chooseSkill would pick given the carried state's player side AFTER energy regen
      // (resolveActorTurn regens first). Feeding resolveActorTurn the SAME skill it would
      // auto-select reproduces the deterministic auto-fight → the guaranteed WIN vs numemon.
      // This is the load-bearing proof that the interactive route resolves the SAME fight.
      if (view.state !== null) {
        const live = deserializeFightState(view.state as SerializedFightState);
        live.player.energy = energyAtTurnStart(live.player.energy);
        nextSkill = chooseSkill(live.player, live.enemy).id;
      }
    }

    expect(outcome).toBe('win');
    // On the finishing turn the state is null and the menu is empty.
    expect(state).toBeNull();
    expect(allEntries.length).toBeGreaterThan(0);

    // The win reward persisted EXACTLY once (level ticked up; a fresh GET is authoritative).
    const after = agumonOf(await getRoster(token));
    expect(after.level).toBeGreaterThan(before.level);
    expect(after.xp).not.toBe(before.xp);
  });

  it('TELEGRAPH (TASK-142): a LIVE turn response carries nextEnemy = chooseSkill(state.enemy, state.player); the finishing turn returns nextEnemy null', async () => {
    const token = await registerAndLogin('telegraph-turn@example.test');
    const before = agumonOf(await getRoster(token));

    // A live (unfinished) fight — the start-preview opens the fight without resolving a
    // turn, so the carried state is fresh-and-live. Its nextEnemy MUST equal what the pure
    // enemy selector picks on that exact state (the server REUSES chooseSkill, A-36 #3).
    const startRes = await postTurn(before.id, { enemyId: 'numemon' }, token);
    expect(startRes.status).toBe(200);
    const startView = (await startRes.json()) as BattleTurnView;
    expect(startView.state).not.toBeNull();
    const live = deserializeFightState(startView.state as SerializedFightState);
    // TASK-164 (R-22 slice 25): the enemy seam now injects `chooseSkillBanking` (the head of
    // the Banking → Defensive → Finisher → Matchup → chooseSkill chain), so the telegraph
    // mirrors THAT selector, not the bare `chooseSkill`. On a fresh/non-cornered/non-bankable
    // state it delegates all the way down to `chooseSkill`, but at a mid-fight bank-worthy
    // energy it legitimately diverges — so compare against the actual seam chooser.
    const numemonC = findEnemy('numemon')!;
    const playerC: Combatant = {
      name: before.name,
      type: before.type,
      element: before.element,
      hp: before.hp,
      maxHp: before.hp,
      atk: before.atk,
      def: before.def,
      spd: before.spd,
    };
    const enemyTelegraph = (s: { enemy: typeof live.enemy; player: typeof live.player }) =>
      chooseSkillBanking(s.enemy, s.player, numemonC, playerC);
    const expected = enemyTelegraph(live);
    expect(startView.nextEnemy).toMatchObject({
      skillId: expected.id,
      name: expected.name,
    });

    // Drive to the end; the finishing turn (state:null / outcome non-null) telegraphs null.
    let state: BattleTurnView['state'] = startView.state;
    let outcome: BattleTurnView['outcome'] = startView.outcome;
    let last: BattleTurnView = startView;
    let guard = 0;
    while (outcome === null && guard < 200) {
      guard += 1;
      const carried = deserializeFightState(state as SerializedFightState);
      carried.player.energy = energyAtTurnStart(carried.player.energy);
      const nextSkill = chooseSkill(carried.player, carried.enemy).id;
      const res = await postTurn(
        before.id,
        { enemyId: 'numemon', skillId: nextSkill, state: state ?? undefined },
        token,
      );
      expect(res.status).toBe(200);
      last = (await res.json()) as BattleTurnView;
      outcome = last.outcome;
      state = last.state;
      // While the fight is LIVE the telegraph stays a valid skill; once ended it is null.
      if (last.state !== null) {
        const liveNow = deserializeFightState(last.state as SerializedFightState);
        const pick = enemyTelegraph(liveNow);
        expect(last.nextEnemy).toMatchObject({ skillId: pick.id, name: pick.name });
      }
    }
    expect(outcome).not.toBeNull();
    expect(last.state).toBeNull();
    expect(last.nextEnemy ?? null).toBeNull();
  });

  it("FLEE (TASK-143): action:'flee' on a LIVE fight ends it with outcome 'fled' — one flee entry, no enemy reply, no reward", async () => {
    const token = await registerAndLogin('flee-turn@example.test');
    const before = agumonOf(await getRoster(token));

    // Open the fight and resolve one turn to obtain a mid-fight LIVE carried state.
    const start = await postTurn(before.id, { enemyId: 'numemon' }, token);
    const startView = (await start.json()) as BattleTurnView;
    const midRes = await postTurn(
      before.id,
      { enemyId: 'numemon', skillId: 'attack', state: startView.state },
      token,
    );
    const mid = (await midRes.json()) as BattleTurnView;
    expect(mid.outcome).toBeNull();
    expect(mid.state).not.toBeNull();

    // Now flee: no skillId, action:'flee', carrying the live state. Since TASK-177 wired
    // the HTTP boundary to LIVE_RNG (real Math.random), the OUTCOME of a flee ROLL over
    // HTTP is now non-deterministic — so we drive the flee through the SERVICE with the
    // deterministic DEFAULT_RNG (= () => 0 → always succeeds) to assert the fled contract
    // non-flakily (L-55/L-56 direct-service discipline). We still boot the real app + DB,
    // so this exercises the live persistence path.
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const flee = await service.battleTurn(
      row.userId,
      before.id,
      'numemon',
      undefined,
      mid.state,
      'flee',
      DEFAULT_RNG,
    );
    expect(flee.outcome).toBe('fled');
    expect(flee.state).toBeNull();
    expect(flee.playerSkills).toEqual([]);
    expect(flee.nextEnemy ?? null).toBeNull();
    expect(flee.reward.xpGained).toBe(0);
    // Exactly ONE flee entry — the enemy did NOT get a reply turn (no enemy entry after it).
    expect(flee.entries).toHaveLength(1);
    expect(flee.entries[0].actor).toBe('player');
    expect(flee.entries[0].damage).toBe(0);

    // Fleeing persists NO XP/level (contrast the drive-to-WIN test).
    const after = agumonOf(await getRoster(token));
    expect(after.xp).toBe(before.xp);
    expect(after.level).toBe(before.level);
  });

  // TASK-158 (R-22 slice 19): the FLEE-SUCCESS ROLL. Flee is no longer a guaranteed
  // escape — the outcome is decided by the pure injected-RNG `fleeSucceeds` seam. The
  // HTTP route always uses the deterministic `DEFAULT_RNG` (which succeeds — proven by
  // the byte-preserved SUCCESS test above), so to exercise a FAILED flee deterministically
  // we drive the service DIRECTLY with an injected `rng` (L-55 direct-service fallback —
  // the HTTP boundary cannot inject entropy, and every test must inject a fixed rng so the
  // suite is non-flaky, A-140/A-141). We still boot the REAL app + DB and resolve the real
  // provider, so this exercises the live transaction/persistence path.
  const alwaysFail: Rng = () => 0.99; // above every clamped flee chance → always fails
  const alwaysSucceed: Rng = () => 0; // below every clamped flee chance → always succeeds

  it('FLEE FAILED (TASK-158): an unlucky roll wastes the turn — NOT fled, the enemy replies, fight continues, nothing persisted', async () => {
    const token = await registerAndLogin('flee-fail-turn@example.test');
    const before = agumonOf(await getRoster(token));

    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = row.userId;

    // Open the fight (start preview) then resolve one skill turn to reach a mid-fight state.
    const start = await service.battleTurn(userId, before.id, 'numemon', undefined, undefined);
    expect(start.outcome).toBeNull();
    const mid = await service.battleTurn(userId, before.id, 'numemon', 'attack', start.state);
    expect(mid.outcome).toBeNull();
    expect(mid.state).not.toBeNull();

    // Now attempt to flee with an rng that FORCES failure.
    const failed = await service.battleTurn(
      userId,
      before.id,
      'numemon',
      undefined,
      mid.state,
      'flee',
      alwaysFail,
    );

    // NOT fled: the fight CONTINUES with a live carried state.
    expect(failed.outcome).not.toBe('fled');
    expect(failed.outcome).toBeNull();
    expect(failed.state).not.toBeNull();
    // The failed-flee signal is the FIRST entry; the enemy's reply follows (>1 entry).
    expect(failed.entries[0].actor).toBe('player');
    expect(failed.entries[0].damage).toBe(0);
    expect(failed.entries[0].statusEvents).toContain('You failed to flee!');
    expect(failed.entries.some((e) => e.actor === 'enemy')).toBe(true);
    expect(failed.reward.xpGained).toBe(0);

    // NOTHING persisted (flee — win or lose or fail — writes no XP/level).
    const after = agumonOf(await getRoster(token));
    expect(after.xp).toBe(before.xp);
    expect(after.level).toBe(before.level);
  });

  it('FLEE SUCCESS via injected rng (TASK-158): a lucky roll still ends the fight fled — byte-preserved contract', async () => {
    const token = await registerAndLogin('flee-succeed-turn@example.test');
    const before = agumonOf(await getRoster(token));
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });

    const start = await service.battleTurn(row.userId, before.id, 'numemon', undefined, undefined);
    const mid = await service.battleTurn(row.userId, before.id, 'numemon', 'attack', start.state);
    expect(mid.state).not.toBeNull();

    const fled = await service.battleTurn(
      row.userId,
      before.id,
      'numemon',
      undefined,
      mid.state,
      'flee',
      alwaysSucceed,
    );
    expect(fled.outcome).toBe('fled');
    expect(fled.state).toBeNull();
    expect(fled.playerSkills).toEqual([]);
    expect(fled.nextEnemy ?? null).toBeNull();
    expect(fled.reward.xpGained).toBe(0);
    expect(fled.entries).toHaveLength(1);
    expect(fled.entries[0].statusEvents).toContain('You fled the battle.');

    const after = agumonOf(await getRoster(token));
    expect(after.xp).toBe(before.xp);
    expect(after.level).toBe(before.level);
  });

  it('CRIT (TASK-159): a turn driven with an always-crit rng carries multiplied damage + crit:true; the default HTTP path never crits', async () => {
    // An rng consumed twice per strike (critRoll then evadeRoll in resolveDamageStrike):
    // HIGH for the crit roll (fires), 0 for the evade roll (never evades) — isolating the
    // crit payoff from the evade roll TASK-160 added at the SAME seam (a constant high rng
    // would ALSO evade → 0 damage).
    let critCall = 0;
    const alwaysCrit: Rng = () => (critCall++ % 2 === 0 ? 1 : 0);
    const token = await registerAndLogin('crit-turn@example.test');
    const before = agumonOf(await getRoster(token));
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = row.userId;

    // Baseline via the DEFAULT path (no injected rng): the production contract never crits.
    const start = await service.battleTurn(userId, before.id, 'numemon', undefined, undefined);
    const baseTurn = await service.battleTurn(userId, before.id, 'numemon', 'attack', start.state);
    const basePlayerHit = baseTurn.entries.find(
      (e) => e.actor === 'player' && e.skill === 'Sharp Nail',
    )!;
    expect(basePlayerHit.crit).toBeUndefined();
    const baseDamage = basePlayerHit.damage;
    expect(baseDamage).toBeGreaterThan(0);

    // Crit path: SAME opening move, but an injected always-crit rng.
    const critStart = await service.battleTurn(userId, before.id, 'numemon', undefined, undefined);
    const critTurn = await service.battleTurn(
      userId,
      before.id,
      'numemon',
      'attack',
      critStart.state,
      undefined,
      alwaysCrit,
    );
    const critPlayerHit = critTurn.entries.find(
      (e) => e.actor === 'player' && e.skill === 'Sharp Nail',
    )!;
    expect(critPlayerHit.crit).toBe(true);
    expect(critPlayerHit.damage).toBeGreaterThan(baseDamage);

    // A crit persists nothing (invariant 3 UNTRIGGERED — an undecided turn writes no XP/level).
    const after = agumonOf(await getRoster(token));
    expect(after.xp).toBe(before.xp);
    expect(after.level).toBe(before.level);
  });

  it('EVADE (TASK-160): a turn driven with an always-evade rng carries damage 0 + evaded:true (defender HP unchanged); the default HTTP path never evades', async () => {
    const alwaysEvade: Rng = () => 1; // the luckiest-for-the-defender high roll → always evades
    const token = await registerAndLogin('evade-turn@example.test');
    const before = agumonOf(await getRoster(token));
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = row.userId;

    // Baseline via the DEFAULT path (no injected rng): the production contract never evades.
    const start = await service.battleTurn(userId, before.id, 'numemon', undefined, undefined);
    const baseTurn = await service.battleTurn(userId, before.id, 'numemon', 'attack', start.state);
    const basePlayerHit = baseTurn.entries.find(
      (e) => e.actor === 'player' && e.skill === 'Sharp Nail',
    )!;
    expect(basePlayerHit.evaded).toBeUndefined();
    const baseDamage = basePlayerHit.damage;
    expect(baseDamage).toBeGreaterThan(0);

    // Evade path: SAME opening move, but an injected always-evade rng.
    const evadeStart = await service.battleTurn(userId, before.id, 'numemon', undefined, undefined);
    const enemyHpBefore = evadeStart.state!.enemy.hp;
    const evadeTurn = await service.battleTurn(
      userId,
      before.id,
      'numemon',
      'attack',
      evadeStart.state,
      undefined,
      alwaysEvade,
    );
    const evadePlayerHit = evadeTurn.entries.find(
      (e) => e.actor === 'player' && e.skill === 'Sharp Nail',
    )!;
    expect(evadePlayerHit.evaded).toBe(true);
    expect(evadePlayerHit.damage).toBe(0);
    // The defender's HP is UNCHANGED by the evaded strike.
    expect(evadeTurn.state!.enemy.hp).toBe(enemyHpBefore);

    // An evade persists nothing (invariant 3 UNTRIGGERED — an undecided turn writes no XP/level).
    const after = agumonOf(await getRoster(token));
    expect(after.xp).toBe(before.xp);
    expect(after.level).toBe(before.level);
  });

  it('RESIST (TASK-161): a turn casting an offensive status with an always-resist rng does NOT land the ailment + carries resisted:true; the default HTTP path lands it', async () => {
    // The FOURTH injected-RNG consumer (slice 22), on the status-APPLICATION seam.
    // Drive the SAME opening cast — Lullaby Hex (a PURE offensive status skill applying
    // `sleep`, cost 21 ≤ MAX_ENERGY so affordable on turn 1 and IN the palette) — twice:
    // once via the DEFAULT path (rng()===0 → never resists → the sleep LANDS on the foe,
    // the pre-resist contract) and once with an injected always-resist rng (a fixed high
    // roll near 1). The resist run must leave the foe WITHOUT the `sleep` ailment, carry
    // `resisted:true`, and push a "resists" note; the default run applies the ailment and
    // carries no resist — proving the guard (invariant 5). Injected only at the SERVICE
    // signature (the HTTP boundary always passes DEFAULT_RNG, L-55/L-56).
    const alwaysResist: Rng = () => 1; // the luckiest-for-the-defender high roll → resists
    const token = await registerAndLogin('resist-turn@example.test');
    const before = agumonOf(await getRoster(token));
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = row.userId;

    // Baseline via the DEFAULT path (no injected rng): the production contract lands the status.
    const start = await service.battleTurn(userId, before.id, 'numemon', undefined, undefined);
    const baseTurn = await service.battleTurn(
      userId,
      before.id,
      'numemon',
      'lullaby-hex',
      start.state,
    );
    const basePlayerCast = baseTurn.entries.find(
      (e) => e.actor === 'player' && e.skill === SKILLS['lullaby-hex'].name,
    )!;
    expect(basePlayerCast.resisted).toBeUndefined();
    // The status LANDED on the default path: the foe carries the `sleep` ailment.
    expect(baseTurn.state!.enemy.statuses.some((s) => s.kind === 'sleep')).toBe(true);

    // Resist path: SAME opening cast, but an injected always-resist rng.
    const resistStart = await service.battleTurn(
      userId,
      before.id,
      'numemon',
      undefined,
      undefined,
    );
    const resistTurn = await service.battleTurn(
      userId,
      before.id,
      'numemon',
      'lullaby-hex',
      resistStart.state,
      undefined,
      alwaysResist,
    );
    const resistPlayerCast = resistTurn.entries.find(
      (e) => e.actor === 'player' && e.skill === SKILLS['lullaby-hex'].name,
    )!;
    expect(resistPlayerCast.resisted).toBe(true);
    // The status did NOT land: the foe carries no `sleep` ailment.
    expect(resistTurn.state!.enemy.statuses.some((s) => s.kind === 'sleep')).toBe(false);

    // A resist persists nothing (invariant 3 UNTRIGGERED — an undecided turn writes no XP/level).
    const after = agumonOf(await getRoster(token));
    expect(after.xp).toBe(before.xp);
    expect(after.level).toBe(before.level);
  });

  it('FINISHER-PREFERRING AI (TASK-162): when the player is in KILL RANGE the enemy telegraphs AND casts a lethal finisher (diverging from its matchup pick); at full HP it plays the normal matchup skill', async () => {
    // R-22 slice 23. The enemy AI at the interactive seam is now `chooseSkillFinisher`,
    // which returns a LETHAL skill when the player is one hit from dead and otherwise
    // delegates to `chooseSkillMatchup`. Numemon (Virus/Neutral) is type-DISADVANTAGED
    // attacking Agumon (Vaccine/Fire, Vaccine>Virus ×0.75), so its matchup pick is the
    // control-cascade opener (NOT the hammer) — the finisher must DIVERGE to a lethal
    // pure-damage skill, proving observable behaviour, not a mirror.
    const token = await registerAndLogin('finisher-turn@example.test');
    const before = agumonOf(await getRoster(token));
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = row.userId;

    const numemon = findEnemy('numemon')!;
    const playerC: Combatant = {
      name: before.name,
      type: before.type,
      element: before.element,
      hp: before.hp,
      maxHp: before.hp,
      atk: before.atk,
      def: before.def,
      spd: before.spd,
    };

    // --- KILL RANGE: carry a state where the player sits at 1 HP (any enemy strike is
    // lethal — numemon is type-disadvantaged so each strike deals the ≥1 floor) with the
    // enemy at MAX_ENERGY (Double Strike affordable). ---
    const killSeed: SerializedFightState = {
      player: { hp: 1, energy: energyAtTurnStart(MAX_ENERGY), statuses: [], inflicted: [] },
      enemy: { hp: numemon.hp, energy: MAX_ENERGY, statuses: [], inflicted: [] },
      round: 1,
      decided: null,
    };
    const live = deserializeFightState(killSeed);

    // The finisher pick DIVERGES from the (disadvantaged → delegated) matchup pick.
    const finisherPick = chooseSkillFinisher(live.enemy, live.player, numemon, playerC);
    const matchupPick = chooseSkillMatchup(live.enemy, live.player, numemon, playerC);
    expect(finisherPick.id).not.toBe(matchupPick.id);
    expect(finisherPick.energyCost).toBeLessThanOrEqual(MAX_ENERGY);

    // Drive the interactive turn on the SERVICE with the carried low-HP state (L-55/L-56).
    const killTurn = await service.battleTurn(userId, before.id, 'numemon', 'attack', killSeed);
    // The enemy's reply entry is the LETHAL finisher — the enemy VISIBLY goes for the kill.
    const enemyEntry = killTurn.entries.find((e) => e.actor === 'enemy');
    expect(enemyEntry).toBeDefined();
    expect(enemyEntry!.skill).toBe(finisherPick.name);
    // The player took lethal damage and the fight decided as a LOSS (the finisher landed).
    expect(killTurn.outcome).toBe('loss');

    // --- FULL HP: same fixture but the player at full HP → no lethal skill → the enemy
    // plays its normal matchup pick (the pre-TASK-162 behaviour byte-preserved). ---
    const fullSeed: SerializedFightState = {
      player: {
        hp: playerC.hp,
        energy: energyAtTurnStart(MAX_ENERGY),
        statuses: [],
        inflicted: [],
      },
      enemy: { hp: numemon.hp, energy: MAX_ENERGY, statuses: [], inflicted: [] },
      round: 1,
      decided: null,
    };
    const fullLive = deserializeFightState(fullSeed);
    const fullFinisher = chooseSkillFinisher(fullLive.enemy, fullLive.player, numemon, playerC);
    const fullMatchup = chooseSkillMatchup(fullLive.enemy, fullLive.player, numemon, playerC);
    // At full HP the finisher delegates → byte-identical to the matchup pick.
    expect(fullFinisher).toEqual(fullMatchup);
  });

  it('DEFENSIVE AI (TASK-163): when the ENEMY itself is in KILL RANGE it telegraphs the defensive Guard/Shield (diverging from its offensive finisher pick); at full HP it plays its normal offense', async () => {
    // R-22 slice 24, the MIRROR of the finisher e2e. The enemy AI at the interactive seam is
    // now `chooseSkillDefensive`: when the ENEMY is one hit from dead (the player's strongest
    // available skill is lethal to it) and an affordable unheld Guard exists, it SHIELDS
    // instead of trading into death; otherwise it delegates to `chooseSkillFinisher`. We
    // drive the enemy-cornered case on the SERVICE with a low-enemy-HP FightState (L-55/L-56)
    // — an interactive fixture may never naturally reach enemy-kill-range (present ≠ observable).
    const token = await registerAndLogin('defensive-turn@example.test');
    const before = agumonOf(await getRoster(token));
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = row.userId;

    const numemon = findEnemy('numemon')!;
    const playerC: Combatant = {
      name: before.name,
      type: before.type,
      element: before.element,
      hp: before.hp,
      maxHp: before.hp,
      atk: before.atk,
      def: before.def,
      spd: before.spd,
    };

    // --- ENEMY IN KILL RANGE: carry a state where the ENEMY sits at 1 HP (any player strike
    // is lethal) with the player at MAX_ENERGY (a lethal skill affordable) and the enemy at
    // MAX_ENERGY (Guard @14 affordable) with no shield up. ---
    const cornerSeed: SerializedFightState = {
      player: {
        hp: playerC.hp,
        energy: energyAtTurnStart(MAX_ENERGY),
        statuses: [],
        inflicted: [],
      },
      enemy: { hp: 1, energy: MAX_ENERGY, statuses: [], inflicted: [] },
      round: 1,
      decided: null,
    };
    const live = deserializeFightState(cornerSeed);

    // The defensive pick is Guard, DIVERGING from the offense-only finisher pick.
    const defensivePick = chooseSkillDefensive(live.enemy, live.player, numemon, playerC);
    const finisherPick = chooseSkillFinisher(live.enemy, live.player, numemon, playerC);
    expect(defensivePick.id).toBe('guard');
    expect(defensivePick.id).not.toBe(finisherPick.id);

    // Drive a START PREVIEW on the SERVICE (no skillId → the fight is NOT resolved): the
    // enemy-intent telegraph (computed from the carried state via the SAME defensive
    // selector) HONESTLY shows the enemy defending when it is one hit from dead.
    const cornerTurn = await service.battleTurn(
      userId,
      before.id,
      'numemon',
      undefined,
      cornerSeed,
    );
    expect(cornerTurn.nextEnemy).toMatchObject({
      skillId: 'guard',
      name: defensivePick.name,
    });

    // --- FULL HP: same fixture but the enemy at full HP → not cornered → the enemy plays its
    // normal offensive finisher pick (the pre-TASK-163 interactive behaviour byte-preserved). ---
    const safeSeed: SerializedFightState = {
      player: {
        hp: playerC.hp,
        energy: energyAtTurnStart(MAX_ENERGY),
        statuses: [],
        inflicted: [],
      },
      enemy: { hp: numemon.hp, energy: MAX_ENERGY, statuses: [], inflicted: [] },
      round: 1,
      decided: null,
    };
    const safeLive = deserializeFightState(safeSeed);
    const safeDefensive = chooseSkillDefensive(safeLive.enemy, safeLive.player, numemon, playerC);
    const safeFinisher = chooseSkillFinisher(safeLive.enemy, safeLive.player, numemon, playerC);
    // Not cornered → the defensive wrapper delegates → byte-identical to the finisher pick.
    expect(safeDefensive).toEqual(safeFinisher);
  });

  it('BANKING AI (TASK-164): when its strongest burst is one energy-gain away the enemy telegraphs AND casts a cheaper productive HOLD, then unleashes the burst next turn; at full energy it plays normally', async () => {
    // R-22 slice 25, the THIRD composing selector and the FIRST cross-TURN planner. The enemy
    // AI at the interactive seam is now `chooseSkillBanking`: when its most-damaging burst
    // (Double Strike, cost 24) is UNAFFORDABLE this turn but reachable NEXT turn after the
    // per-turn energy gain, and neither defence nor a finish should fire, it holds a cheaper
    // productive action to bank, then bursts. We drive the bank-worthy case on the SERVICE with
    // a crafted enemy FightState (L-55/L-56) — an interactive fixture may never naturally reach
    // a bank-worthy energy state (present ≠ observable).
    const token = await registerAndLogin('banking-turn@example.test');
    const before = agumonOf(await getRoster(token));
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = row.userId;

    const numemon = findEnemy('numemon')!;
    const playerC: Combatant = {
      name: before.name,
      type: before.type,
      element: before.element,
      hp: before.hp,
      maxHp: before.hp,
      atk: before.atk,
      def: before.def,
      spd: before.spd,
    };

    // --- BANK-WORTHY: the enemy at full HP (not cornered) with 22 energy — Double Strike (24)
    // is out of reach now but 22 + regen(4) = 26 ≥ 24 next turn. The player is low on energy
    // (no lethal threat → neither defence nor a finish fires). ---
    const bankSeed: SerializedFightState = {
      player: { hp: playerC.hp, energy: 3, statuses: [], inflicted: [] },
      enemy: {
        hp: numemon.hp,
        energy: DOUBLE_STRIKE_ENERGY_COST - 2,
        statuses: [],
        inflicted: [],
      },
      round: 1,
      decided: null,
    };
    const live = deserializeFightState(bankSeed);
    const bankingPick = chooseSkillBanking(live.enemy, live.player, numemon, playerC);
    const reactivePick = chooseSkillDefensive(live.enemy, live.player, numemon, playerC);
    const burst = SKILLS['double-strike'];
    // Banking holds a cheaper productive action than the burst — and diverges from it.
    expect(bankingPick.energyCost).toBeLessThan(burst.energyCost);
    expect(bankingPick.id).not.toBe(burst.id);

    // The telegraph (computed from the carried state via the SAME banking selector) HONESTLY
    // shows the enemy holding back to bank.
    const bankTurn = await service.battleTurn(userId, before.id, 'numemon', undefined, bankSeed);
    expect(bankTurn.nextEnemy).toMatchObject({
      skillId: bankingPick.id,
      name: bankingPick.name,
    });

    // --- FULL ENERGY: same fixture but the burst is affordable NOW → nothing to bank →
    // the banking wrapper delegates VERBATIM to chooseSkillDefensive (pre-TASK-164 behaviour). ---
    const flushSeed: SerializedFightState = {
      player: { hp: playerC.hp, energy: 3, statuses: [], inflicted: [] },
      enemy: { hp: numemon.hp, energy: MAX_ENERGY, statuses: [], inflicted: [] },
      round: 1,
      decided: null,
    };
    const flushLive = deserializeFightState(flushSeed);
    expect(chooseSkillBanking(flushLive.enemy, flushLive.player, numemon, playerC)).toEqual(
      chooseSkillDefensive(flushLive.enemy, flushLive.player, numemon, playerC),
    );
    // And with the burst affordable, banking is not merely a hold — the reactive offense (or
    // the burst itself) is what plays, NOT a forced cheap hold (byte-preserved offense).
    expect(reactivePick).toBeDefined();
  });

  it('FLEE (TASK-143): a flee with NO carried state and a flee on an over/decided fight behave sanely (no 500)', async () => {
    const token = await registerAndLogin('flee-edge-turn@example.test');
    const agumon = agumonOf(await getRoster(token));
    // TASK-177 wired the HTTP boundary to LIVE_RNG, so a flee ROLL over HTTP is now
    // non-deterministic; drive flee through the SERVICE with DEFAULT_RNG (always succeeds)
    // to assert the fled/edge contract non-flakily (L-55/L-56). Real app + DB still boot.
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const userId = (await prisma.digimon.findFirstOrThrow({ where: { id: agumon.id } })).userId;

    // No carried state: the server seeds a FRESH live fight, so flee still succeeds cleanly.
    const noStateView = await service.battleTurn(
      userId,
      agumon.id,
      'numemon',
      undefined,
      undefined,
      'flee',
      DEFAULT_RNG,
    );
    expect(noStateView.outcome).toBe('fled');

    // Flee on an ALREADY-decided carried state: falls through to normal handling, no crash.
    const start = await postTurn(agumon.id, { enemyId: 'numemon' }, token);
    const startView = (await start.json()) as BattleTurnView;
    const decided = {
      ...(startView.state as SerializedFightState),
      decided: 'win' as const,
    };
    // Should not throw (the service handles an already-decided flee sanely).
    await expect(
      service.battleTurn(userId, agumon.id, 'numemon', undefined, decided, 'flee', DEFAULT_RNG),
    ).resolves.toBeDefined();
  });

  it('MATCHUP-AWARE AI (TASK-144): when the enemy holds a type/element advantage, nextEnemy names its strongest affordable damage skill AND that SAME skill is what it then casts', async () => {
    // Seed a fight where the ENEMY is matchup-advantaged over the PLAYER's Digimon.
    // Patamon is Data/Neutral; numemon is Virus/Neutral, and Virus BEATS Data on the
    // attribute triangle (×1.5) → the enemy holds the advantage. Against the default
    // Agumon (Vaccine/Fire) neither enemy is advantaged, so we deliberately pick Patamon.
    const token = await registerAndLogin('matchup-turn@example.test');
    const patamon = (await getRoster(token)).find((d) => d.name === 'Patamon')!;
    expect(patamon.type).toBe('Data');

    // Open the fight (no skillId) → a fresh LIVE state. At fight start the enemy is at
    // MAX_ENERGY, so its strongest affordable pure-damage skill (Double Strike) is
    // affordable — the matchup-aware chooser PRESSES the advantage with it, whereas the
    // flat chooseSkill would open with the Frost Bite control lock.
    const startRes = await postTurn(patamon.id, { enemyId: 'numemon' }, token);
    expect(startRes.status).toBe(200);
    const startView = (await startRes.json()) as BattleTurnView;
    expect(startView.state).not.toBeNull();

    const live = deserializeFightState(startView.state as SerializedFightState);
    const enemyC = findEnemy('numemon')!;
    const playerC: Combatant = {
      name: patamon.name,
      type: patamon.type,
      element: patamon.element,
      hp: patamon.hp,
      maxHp: patamon.hp,
      atk: patamon.atk,
      def: patamon.def,
      spd: patamon.spd,
    };

    // The telegraph names the MATCHUP-AWARE pick (Double Strike), NOT the flat cascade's
    // opener — the observable headline: the smarter enemy changes what is previewed.
    const matchupPick = chooseSkillMatchup(live.enemy, live.player, enemyC, playerC);
    const flatPick = chooseSkill(live.enemy, live.player);
    expect(startView.nextEnemy).toMatchObject({
      skillId: matchupPick.id,
      name: matchupPick.name,
    });
    // Present ≠ observable: prove the matchup chooser actually diverged from the flat one.
    expect(matchupPick.id).not.toBe(flatPick.id);
    expect(matchupPick.id).toBe('double-strike');

    // Now resolve one turn (the player attacks) → the enemy REPLIES with the SAME
    // matchup-aware chooser. Its cast must equal what the telegraph named (consistency).
    const turnRes = await postTurn(
      patamon.id,
      { enemyId: 'numemon', skillId: 'attack', state: startView.state },
      token,
    );
    expect(turnRes.status).toBe(200);
    const turn = (await turnRes.json()) as BattleTurnView;
    // The enemy reply entry (the second entry — player attack first, then the enemy) —
    // its skill label is the telegraphed matchup pick, so the enemy VISIBLY plays the
    // matchup on `/battle` (the telegraph the player read was truthful).
    const enemyEntry = turn.entries.find((e) => e.actor === 'enemy');
    expect(enemyEntry).toBeDefined();
    expect(enemyEntry!.skill).toBe(matchupPick.name);
  });

  // TASK-145 (R-22 slice 6): turn ORDER by SPD on the INTERACTIVE path. The pure
  // auto-driver has always ordered each round by effective SPD (resolveTurnOrder); the
  // interactive route was hardcoded player-first, leaving the SPD stat inert on the fight
  // the player plays. These two fights prove it now REUSES resolveTurnOrder at that seam:
  // a strictly-faster foe (Kuwagamon spd 20 ≫ Agumon spd 8) acts FIRST, while a slower foe
  // (Numemon spd 5 < Agumon spd 8) keeps the player first (and a tie → player, `>=`).
  it('a strictly FASTER enemy strikes FIRST on the interactive path (SPD-into-turn-order)', async () => {
    const token = await registerAndLogin('spd-fast-enemy@example.test');
    const agumon = agumonOf(await getRoster(token));
    // Sanity: the fixture is genuinely enemy-faster (Kuwagamon 20 > Agumon 8).
    expect(findEnemy('kuwagamon')!.spd).toBeGreaterThan(agumon.spd);

    const res = await postTurn(agumon.id, { enemyId: 'kuwagamon', skillId: 'attack' }, token);
    expect(res.status).toBe(200);
    const view = (await res.json()) as BattleTurnView;
    expect(view.entries.length).toBeGreaterThan(0);
    // The FIRST log entry of the exchange is the ENEMY's turn — it acted before the
    // player because it is faster. (Order-by-SPD, sole-sourced through resolveTurnOrder.)
    expect(view.entries[0].actor).toBe('enemy');
  });

  it('a SLOWER enemy keeps the player acting first (tie → player, `>=`)', async () => {
    const token = await registerAndLogin('spd-slow-enemy@example.test');
    const agumon = agumonOf(await getRoster(token));
    // Sanity: the fixture is genuinely player-faster (Agumon 8 > Numemon 5).
    expect(agumon.spd).toBeGreaterThan(findEnemy('numemon')!.spd);

    const res = await postTurn(agumon.id, { enemyId: 'numemon', skillId: 'attack' }, token);
    expect(res.status).toBe(200);
    const view = (await res.json()) as BattleTurnView;
    expect(view.entries.length).toBeGreaterThan(0);
    // The player is faster → the player's turn is the FIRST entry, unchanged from before.
    expect(view.entries[0].actor).toBe('player');
  });

  // TASK-148 (R-22 slice 9): the carried ATB accumulator GROWS by effectiveSpd each
  // interactive turn and round-trips on the wire. Two successive turns (player Agumon spd 8
  // > enemy Numemon spd 5) must leave the faster side's carried atb STRICTLY GREATER than
  // the slower's, and larger after two turns than one (it ACCRUES). No rule reads atb — this
  // is a carried-substrate + display gauge only (turn-order authority deliberately deferred).
  it('the carried ATB accrues by effectiveSpd each interactive turn; the faster side fills faster (TASK-148)', async () => {
    const token = await registerAndLogin('atb-accrue-turn@example.test');
    const agumon = agumonOf(await getRoster(token));
    // Fixture sanity: genuinely player-faster (Agumon 8 > Numemon 5).
    expect(agumon.spd).toBeGreaterThan(findEnemy('numemon')!.spd);

    // Turn 1 — from a fresh fight (atb seeded 0), the accumulator grows before the actors
    // resolve. The player's atb must lead the enemy's after the first turn.
    const res1 = await postTurn(agumon.id, { enemyId: 'numemon', skillId: 'attack' }, token);
    expect(res1.status).toBe(200);
    const view1 = (await res1.json()) as BattleTurnView;
    expect(view1.outcome).toBeNull();
    const s1 = deserializeFightState(view1.state as SerializedFightState);
    expect(s1.player.atb).toBeGreaterThan(0);
    expect(s1.enemy.atb).toBeGreaterThan(0);
    expect(s1.player.atb).toBeGreaterThan(s1.enemy.atb);

    // Turn 2 — carry the state back verbatim; the accumulator keeps climbing (ACCRUES),
    // so each side's atb after two turns strictly exceeds its own after one.
    const res2 = await postTurn(
      agumon.id,
      { enemyId: 'numemon', skillId: 'attack', state: view1.state },
      token,
    );
    expect(res2.status).toBe(200);
    const view2 = (await res2.json()) as BattleTurnView;
    expect(view2.outcome).toBeNull();
    const s2 = deserializeFightState(view2.state as SerializedFightState);
    expect(s2.player.atb).toBeGreaterThan(s1.player.atb);
    expect(s2.enemy.atb).toBeGreaterThan(s1.enemy.atb);
    // And the faster side still leads — and by a WIDER margin than after one turn.
    expect(s2.player.atb).toBeGreaterThan(s2.enemy.atb);
    expect(s2.player.atb - s2.enemy.atb).toBeGreaterThan(s1.player.atb - s1.enemy.atb);
  });

  // TASK-149 (R-22 slice 10): the ATB accumulator becomes TURN-ORDER-AUTHORITATIVE at the
  // interactive seam. When a side's carried `atb` crosses ATB_THRESHOLD (100), that side
  // CONSUMES the threshold (`atb -= 100`) and resolves ONE EXTRA action this turn — the
  // first slice where a RULE reads `atb`. A normal exchange yields at most one entry per
  // actor per round; the bonus strike shows up as a SECOND entry for the same actor in the
  // latest round, and its carried `atb` drops by EXACTLY the threshold (single-consume — a
  // 2×-full bar is NOT drained to 0). The pure whole-fight rules are byte-unchanged (the
  // authority lives only here) — the battle.spec fight suite staying green is that proof.
  it('a side over ATB_THRESHOLD takes EXACTLY ONE extra action and its atb drops by exactly the threshold (single-consume) (TASK-149)', async () => {
    const token = await registerAndLogin('atb-extra-action@example.test');
    const agumon = agumonOf(await getRoster(token));

    // Turn 1 from a fresh fight to obtain a real carried wire `state`.
    const res1 = await postTurn(agumon.id, { enemyId: 'numemon', skillId: 'attack' }, token);
    expect(res1.status).toBe(200);
    const view1 = (await res1.json()) as BattleTurnView;
    expect(view1.outcome).toBeNull();
    const carried = view1.state as SerializedFightState;

    // Seed the player's carried atb to 2× the threshold: this proves the consume is SINGLE
    // (one extra action, `atb -= 100`) and NOT a loop-drain to 0. (Client-carried mutable
    // state is trusted only to corrupt a fight in progress — no real value moves; the server
    // rebuilds ATK/DEF/SPD from the DB every turn. A-123.)
    const seeded: SerializedFightState = {
      ...carried,
      player: { ...carried.player, atb: ATB_THRESHOLD * 2 },
      enemy: { ...carried.enemy, atb: 0 },
    };

    const res2 = await postTurn(
      agumon.id,
      { enemyId: 'numemon', skillId: 'attack', state: seeded },
      token,
    );
    expect(res2.status).toBe(200);
    const view2 = (await res2.json()) as BattleTurnView;

    // Baseline: the SAME seed but with the player UNDER the threshold (atb 0) takes no bonus.
    const control: SerializedFightState = {
      ...carried,
      player: { ...carried.player, atb: 0 },
      enemy: { ...carried.enemy, atb: 0 },
    };
    const resC = await postTurn(
      agumon.id,
      { enemyId: 'numemon', skillId: 'attack', state: control },
      token,
    );
    expect(resC.status).toBe(200);
    const viewC = (await resC.json()) as BattleTurnView;

    // The player took STRICTLY MORE actions in the over-threshold turn than the control turn
    // (the ATB bonus strike). We compare per-actor entry counts in each turn's latest round —
    // robust to a skill logging >1 entry (a multi-hit): the DELTA is the single extra action.
    const playerEntriesIn = (v: BattleTurnView): number => {
      if (v.entries.length === 0) return 0;
      const r = v.entries[v.entries.length - 1].round;
      return v.entries.filter((e) => e.round === r && e.actor === 'player').length;
    };
    expect(playerEntriesIn(view2)).toBeGreaterThan(playerEntriesIn(viewC));
    // AUTHORITATIVE proof via the display-only flag: the over-threshold turn flagged the
    // player's ATB bonus action; the control turn did not.
    expect((view2.state as SerializedFightState).player.extraActed).toBe(true);
    expect((viewC.state as SerializedFightState).player.extraActed).toBe(false);
    // TASK-150: the single-consume became a CAPPED DRAIN-LOOP — a 2×-full bar now drains BOTH
    // thresholds (2 bonus actions), so after the turn the carried atb is below the threshold
    // (seeded 200 + effSpd − 200 = effSpd < 100). This is the widened behaviour of slice 11.
    if (view2.outcome === null) {
      const s2 = deserializeFightState(view2.state as SerializedFightState);
      expect(s2.player.atb).toBeLessThan(ATB_THRESHOLD);
      expect((view2.state as SerializedFightState).player.bonusActions).toBe(2);
    }
  });

  it('a CONTROL turn where neither side is at the threshold takes exactly ONE action per side (no extra action) (TASK-149)', async () => {
    const token = await registerAndLogin('atb-no-extra@example.test');
    const agumon = agumonOf(await getRoster(token));

    // A fresh fight: both sides seeded atb 0, and one turn's accrual (SPD 8 / 5) stays far
    // below the threshold (100) → NO side crosses → exactly one action each (slice-9 parity).
    const res = await postTurn(agumon.id, { enemyId: 'numemon', skillId: 'attack' }, token);
    expect(res.status).toBe(200);
    const view = (await res.json()) as BattleTurnView;
    expect(view.outcome).toBeNull();
    // Neither side is flagged as having taken an ATB bonus action (the authority is guarded).
    const wire = view.state as SerializedFightState;
    expect(wire.player.extraActed).toBe(false);
    expect(wire.enemy.extraActed).toBe(false);
    // Sanity: neither carried atb reached the threshold after one turn.
    const s = deserializeFightState(wire);
    expect(s.player.atb).toBeLessThan(ATB_THRESHOLD);
    expect(s.enemy.atb).toBeLessThan(ATB_THRESHOLD);
  });

  it('when the ATB bonus action KOs the enemy the fight ends cleanly — no strike resolves after a decided fight (termination safety) (TASK-149)', async () => {
    const token = await registerAndLogin('atb-bonus-ko@example.test');
    const agumon = agumonOf(await getRoster(token));

    // Drive a fight against the weakest foe to the brink, then hand the player a full ATB so
    // the bonus strike finishes it. We simply loop normal turns until the enemy is nearly dead,
    // seeding the player's atb over the threshold on the finishing turn. The fight MUST resolve
    // (outcome:'win') within MAX_ROUNDS with no post-decision strike (the loop honors decided).
    let state: SerializedFightState | undefined;
    let view: BattleTurnView | undefined;
    for (let i = 0; i < 40; i += 1) {
      const body: Record<string, unknown> = {
        enemyId: 'numemon',
        skillId: 'attack',
      };
      if (state) {
        // Keep the player's ATB pinned over the threshold each turn so a bonus strike is
        // always available — accelerating the KO and exercising the authority pass repeatedly.
        state = { ...state, player: { ...state.player, atb: ATB_THRESHOLD * 2 } };
        body.state = state;
      }
      const res = await postTurn(agumon.id, body, token);
      expect(res.status).toBe(200);
      view = (await res.json()) as BattleTurnView;
      if (view.outcome !== null) break;
      state = view.state as SerializedFightState;
    }
    expect(view).toBeDefined();
    // The fight terminated (a bonus-accelerated win, or a loss/round-cap draw) — never hung.
    expect(view!.outcome).not.toBeUndefined();
    // A decided fight carries NO state (state:null on the ending turn); the entries stop at
    // the KO — no extra strike was resolved after `state.decided !== null`.
    if (view!.outcome !== null) {
      expect(view!.state).toBeNull();
    }
  });

  // TASK-150 (R-22 slice 11): the single-consume becomes a CAPPED DRAIN-LOOP. A side whose
  // banked `atb` is a MULTIPLE of the threshold now takes MULTIPLE bonus actions this turn —
  // one per threshold, up to MAX_ATB_BONUS_ACTIONS. The wire carries the per-side COUNT in
  // `bonusActions` (DISPLAY-ONLY). No pure whole-fight rule reads `atb` — the drain-loop lives
  // at the interactive seam ONLY, so `battle.spec.ts` staying green is the invariant-5 proof.
  it('a side with atb ≥ 2× threshold (under the cap) takes EXACTLY the covered number of bonus actions and its atb drops by N × threshold (TASK-150)', async () => {
    const token = await registerAndLogin('atb-stacked@example.test');
    const agumon = agumonOf(await getRoster(token));

    const res1 = await postTurn(agumon.id, { enemyId: 'numemon', skillId: 'attack' }, token);
    expect(res1.status).toBe(200);
    const view1 = (await res1.json()) as BattleTurnView;
    expect(view1.outcome).toBeNull();
    const carried = view1.state as SerializedFightState;

    // Seed the player 2.5× the threshold (250, under the cap of 3): the drain-loop consumes one
    // threshold per bonus action → EXACTLY 2 bonus actions (250 ÷ 100 = 2 full thresholds), the
    // remaining 50 carried. Enemy under threshold so only the player stacks.
    const seeded: SerializedFightState = {
      ...carried,
      player: { ...carried.player, atb: ATB_THRESHOLD * 2 + 50 },
      enemy: { ...carried.enemy, atb: 0 },
    };
    const res2 = await postTurn(
      agumon.id,
      { enemyId: 'numemon', skillId: 'attack', state: seeded },
      token,
    );
    expect(res2.status).toBe(200);
    const view2 = (await res2.json()) as BattleTurnView;
    expect(view2.outcome).toBeNull();
    const wire2 = view2.state as SerializedFightState;

    // The per-side COUNT is exactly 2 (a stacked mini-combo), NOT slice-10's single strike.
    expect(wire2.player.bonusActions).toBe(2);
    // Backward-compatible boolean still holds (≥1 bonus action).
    expect(wire2.player.extraActed).toBe(true);
    // The carried atb dropped by exactly 2 × threshold net of the same-turn accrual: seeded 250
    // + effSpd(player) − 200. So after the turn it is (50 + effSpd) < threshold, and strictly
    // less than seeded+accrual by exactly 2× threshold → below one threshold (the remainder).
    const s2 = deserializeFightState(wire2);
    expect(s2.player.atb).toBeLessThan(ATB_THRESHOLD);
    // A control turn with the SAME seed but atb 0 takes NO bonus action — proving the drain-loop
    // is guarded on the carried atb (present ≠ observable — the count is the ATB payoff).
    const control: SerializedFightState = {
      ...carried,
      player: { ...carried.player, atb: 0 },
      enemy: { ...carried.enemy, atb: 0 },
    };
    const resC = await postTurn(
      agumon.id,
      { enemyId: 'numemon', skillId: 'attack', state: control },
      token,
    );
    const viewC = (await resC.json()) as BattleTurnView;
    expect(viewC.state as SerializedFightState).toBeDefined();
    expect((viewC.state as SerializedFightState).player.bonusActions).toBe(0);
    // And the player's carried atb after the control turn stays below the threshold (no consume).
    const sC = deserializeFightState(viewC.state as SerializedFightState);
    expect(sC.player.atb).toBeLessThan(ATB_THRESHOLD);
  });

  it('the cap HOLDS — a side seeded WAY above the cap takes EXACTLY MAX_ATB_BONUS_ACTIONS bonus actions and no more (termination-safety bound) (TASK-150)', async () => {
    const token = await registerAndLogin('atb-cap@example.test');
    const agumon = agumonOf(await getRoster(token));

    const res1 = await postTurn(agumon.id, { enemyId: 'numemon', skillId: 'attack' }, token);
    const view1 = (await res1.json()) as BattleTurnView;
    const carried = view1.state as SerializedFightState;

    // Seed 10× the threshold: without a cap this would be 10 bonus actions. The cap bounds it
    // to MAX_ATB_BONUS_ACTIONS regardless of banked atb (termination safety, A-133).
    const seeded: SerializedFightState = {
      ...carried,
      player: { ...carried.player, atb: ATB_THRESHOLD * 10 },
      enemy: { ...carried.enemy, atb: 0 },
    };
    const res2 = await postTurn(
      agumon.id,
      { enemyId: 'numemon', skillId: 'attack', state: seeded },
      token,
    );
    expect(res2.status).toBe(200);
    const view2 = (await res2.json()) as BattleTurnView;

    if (view2.outcome === null) {
      const wire2 = view2.state as SerializedFightState;
      // Exactly the cap — no more, even with 10× banked.
      expect(wire2.player.bonusActions).toBe(MAX_ATB_BONUS_ACTIONS);
      // The atb dropped by exactly MAX_ATB_BONUS_ACTIONS × threshold (net of the same-turn
      // accrual); the remainder (7× threshold + accrual) is CARRIED, not zeroed.
      const s2 = deserializeFightState(wire2);
      // seeded 1000 + effSpd − 300 → ~700+ carried remains far above the threshold.
      expect(s2.player.atb).toBeGreaterThanOrEqual(ATB_THRESHOLD * (10 - MAX_ATB_BONUS_ACTIONS));
    } else {
      // If the mini-combo KO'd the enemy the fight ended cleanly — still terminated (bounded).
      expect(view2.state).toBeNull();
    }
  });

  it('the bonusActions wire field round-trips as DISPLAY-ONLY (emitted with the count arg, ignored on deserialize) (TASK-150)', async () => {
    // Mirrors the extraActed round-trip: a control turn (no bonus) carries bonusActions 0 on
    // the wire, and deserialize→re-serialize WITHOUT the count arg drops it (never read back).
    const token = await registerAndLogin('atb-bonus-wire@example.test');
    const agumon = agumonOf(await getRoster(token));
    const res = await postTurn(agumon.id, { enemyId: 'numemon', skillId: 'attack' }, token);
    const view = (await res.json()) as BattleTurnView;
    const wire = view.state as SerializedFightState;
    // Emitted (0 on a control turn — the service always threads the count arg).
    expect(wire.player.bonusActions).toBe(0);
    expect(wire.enemy.bonusActions).toBe(0);
    // Deserialize ignores it (no rule reads it) — the live state has no bonusActions concept.
    const live = deserializeFightState(wire) as unknown as Record<string, unknown>;
    expect((live.player as Record<string, unknown>).bonusActions).toBeUndefined();
  });

  // TASK-151 (R-22 slice 12): the enemy-intent telegraph now PROJECTS how many actions the
  // stacked enemy will take next turn — `nextEnemy.projectedActions`, a display-only mirror of
  // the drain-loop bound over the enemy's carried residual `atb` + next SPD. Read at the
  // telegraph seam ONLY; the pick (skillId/name) is byte-identical to the pre-slice telegraph.
  it('TELEGRAPH projects the enemy incoming-combo count from its carried residual atb (TASK-151)', async () => {
    const token = await registerAndLogin('atb-telegraph@example.test');
    const agumon = agumonOf(await getRoster(token));

    // A fresh turn to get a real carried wire state (and the byte-identical pre-slice pick).
    const res1 = await postTurn(agumon.id, { enemyId: 'numemon', skillId: 'attack' }, token);
    const view1 = (await res1.json()) as BattleTurnView;
    expect(view1.outcome).toBeNull();
    const carried = view1.state as SerializedFightState;
    // The pick is unchanged — projectedActions is ADDITIVE.
    expect(view1.nextEnemy?.skillId).toBeDefined();
    expect(typeof view1.nextEnemy?.name).toBe('string');

    // Seed the enemy WAY over the threshold: the drain-loop caps at MAX_ATB_BONUS_ACTIONS
    // (3 thresholds) per turn, so a big banked bar leaves a HIGH post-drain residual that,
    // plus next SPD, still projects a MULTI-action combo (>= 2). (Client-carried mutable state
    // is trusted only to corrupt a fight in progress — A-123.)
    const seeded: SerializedFightState = {
      ...carried,
      enemy: { ...carried.enemy, atb: ATB_THRESHOLD * 6 },
    };
    const res2 = await postTurn(
      agumon.id,
      { enemyId: 'numemon', skillId: 'attack', state: seeded },
      token,
    );
    const view2 = (await res2.json()) as BattleTurnView;
    if (view2.outcome === null) {
      // The enemy's post-drain residual + its SPD still projects >= 2 incoming actions.
      expect(view2.nextEnemy?.projectedActions).toBeGreaterThanOrEqual(2);
      // The telegraph pick is still a real named skill (projectedActions is purely additive —
      // it never displaces skillId/name).
      expect(view2.nextEnemy?.skillId).toBeDefined();
      expect(typeof view2.nextEnemy?.name).toBe('string');
    }

    // Baseline: an enemy far BELOW one threshold projects a LOW count (0 or 1).
    const control: SerializedFightState = {
      ...carried,
      enemy: { ...carried.enemy, atb: 0 },
    };
    const resC = await postTurn(
      agumon.id,
      { enemyId: 'numemon', skillId: 'attack', state: control },
      token,
    );
    const viewC = (await resC.json()) as BattleTurnView;
    if (viewC.outcome === null) {
      expect(viewC.nextEnemy?.projectedActions).toBeLessThanOrEqual(1);
    }

    // START-PREVIEW (fresh fight, atb seeded 0) projects a low count too.
    const preview = await postTurn(agumon.id, { enemyId: 'numemon' }, token);
    const previewView = (await preview.json()) as BattleTurnView;
    expect(previewView.nextEnemy?.projectedActions).toBeLessThanOrEqual(1);
  });

  // TASK-152 (R-22 slice 13): the SYMMETRIC PLAYER-side mini-combo forecast. The turn response
  // now ALSO carries `nextPlayer.projectedActions` — the player's OWN projected next-turn
  // bonus-action count, from their carried residual `atb` + next SPD via the SAME pure
  // `projectedBonusActions` bound (a smaller sibling shape: no next skill, the player CHOOSES).
  // `nextEnemy` is UNCHANGED (independent additive sibling).
  it('FORECAST projects the PLAYER incoming-combo count from their carried residual atb (TASK-152)', async () => {
    const token = await registerAndLogin('atb-player-forecast@example.test');
    const agumon = agumonOf(await getRoster(token));

    // A fresh turn to get a real carried wire state.
    const res1 = await postTurn(agumon.id, { enemyId: 'numemon', skillId: 'attack' }, token);
    const view1 = (await res1.json()) as BattleTurnView;
    expect(view1.outcome).toBeNull();
    const carried = view1.state as SerializedFightState;
    // `nextEnemy` is untouched by this slice — still a real named enemy telegraph.
    expect(view1.nextEnemy?.skillId).toBeDefined();
    expect(typeof view1.nextEnemy?.name).toBe('string');
    // `nextPlayer` is the new independent sibling — a count, no skill.
    expect(typeof view1.nextPlayer?.projectedActions).toBe('number');

    // Seed the PLAYER WAY over the threshold: the drain-loop caps at MAX_ATB_BONUS_ACTIONS,
    // so a big banked bar leaves a HIGH post-drain residual that, plus next SPD, still projects
    // a MULTI-action combo (>= 2). (Client-carried mutable state is trusted only to corrupt a
    // fight in progress — A-123.)
    const seeded: SerializedFightState = {
      ...carried,
      player: { ...carried.player, atb: ATB_THRESHOLD * 6 },
    };
    const res2 = await postTurn(
      agumon.id,
      { enemyId: 'numemon', skillId: 'attack', state: seeded },
      token,
    );
    const view2 = (await res2.json()) as BattleTurnView;
    if (view2.outcome === null) {
      expect(view2.nextPlayer?.projectedActions).toBeGreaterThanOrEqual(2);
      // `nextEnemy` still a real named telegraph — the player forecast never displaced it.
      expect(view2.nextEnemy?.skillId).toBeDefined();
      expect(typeof view2.nextEnemy?.name).toBe('string');
    }

    // Baseline: a player far BELOW one threshold projects a LOW count (0 or 1).
    const control: SerializedFightState = {
      ...carried,
      player: { ...carried.player, atb: 0 },
    };
    const resC = await postTurn(
      agumon.id,
      { enemyId: 'numemon', skillId: 'attack', state: control },
      token,
    );
    const viewC = (await resC.json()) as BattleTurnView;
    if (viewC.outcome === null) {
      expect(viewC.nextPlayer?.projectedActions).toBeLessThanOrEqual(1);
    }

    // START-PREVIEW (fresh fight, player atb seeded 0) projects a low count too.
    const preview = await postTurn(agumon.id, { enemyId: 'numemon' }, token);
    const previewView = (await preview.json()) as BattleTurnView;
    expect(previewView.nextPlayer?.projectedActions).toBeLessThanOrEqual(1);

    // The ENDING branch returns nextPlayer: null (mirrors nextEnemy: null). Drive a flee to end.
    // TASK-177: flee is a LIVE_RNG roll over HTTP now — drive it through the service with
    // DEFAULT_RNG (always succeeds) so the fled assertion stays non-flaky (L-55/L-56).
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const userId = (await prisma.digimon.findFirstOrThrow({ where: { id: agumon.id } })).userId;
    const fledView = await service.battleTurn(
      userId,
      agumon.id,
      'numemon',
      undefined,
      carried,
      'flee',
      DEFAULT_RNG,
    );
    expect(fledView.outcome).toBe('fled');
    expect(fledView.nextPlayer ?? null).toBeNull();
  });

  // TASK-153 (R-22 slice 14): the ALREADY-BUILT control-lock ailments (stun/freeze/sleep) become
  // LEGIBLE + HONEST on the interactive path. Before this slice the menu read only energy, so a
  // control-locked player still saw a full skill grid, picked, and the engine silently discarded
  // the pick (present ≠ observable, L-17). Now the interactive seam READS the player's carried
  // statuses and surfaces the lock on `playerControlLock`, empties the menu, and advances a locked
  // turn via `action:'pass'` WITHOUT a 422 (the forced skip is honored regardless of any skill).
  // NO new ailment / skill / RNG; the pure whole-fight rules are byte-unchanged (invariant 5).
  it('a control-LOCKED player returns playerControlLock non-null with an empty menu; a pass advances it with no 422; an UNLOCKED player is null (TASK-153)', async () => {
    const token = await registerAndLogin('control-lock@example.test');
    const agumon = agumonOf(await getRoster(token));

    // Turn 1 from a fresh fight to obtain a real carried wire `state` to seed statuses onto.
    const res1 = await postTurn(agumon.id, { enemyId: 'numemon', skillId: 'attack' }, token);
    expect(res1.status).toBe(200);
    const view1 = (await res1.json()) as BattleTurnView;
    expect(view1.outcome).toBeNull();
    // The turn response ALWAYS carries the (optional) playerControlLock field on a live turn.
    expect('playerControlLock' in view1).toBe(true);
    // An explicitly UNLOCKED carried state (no control status) → playerControlLock: null + a menu.
    const base = view1.state as SerializedFightState;
    const carried: SerializedFightState = {
      ...base,
      player: { ...base.player, statuses: [] },
    };
    const unlocked = await postTurn(agumon.id, { enemyId: 'numemon', state: carried }, token);
    const unlockedView = (await unlocked.json()) as BattleTurnView;
    expect(unlockedView.playerControlLock ?? null).toBeNull();
    expect(unlockedView.playerSkills.length).toBeGreaterThan(0);

    // Seed each control-lock kind and assert the honest surfacing. (Client-carried mutable state is
    // trusted only to corrupt a fight in progress — the server rebuilds stats from the DB, A-123.)
    for (const [kind, label] of [
      ['stun', 'Stunned'],
      ['freeze', 'Frozen'],
      ['sleep', 'Asleep'],
    ] as const) {
      const seeded: SerializedFightState = {
        ...carried,
        player: {
          ...carried.player,
          statuses: [{ kind, turnsRemaining: 2 }],
        },
      };

      // A locked player: the menu is EMPTY and the lock is surfaced with the matching kind + label.
      const preview = await postTurn(agumon.id, { enemyId: 'numemon', state: seeded }, token);
      expect(preview.status).toBe(200);
      const previewView = (await preview.json()) as BattleTurnView;
      expect(previewView.playerControlLock).toEqual({ kind, label });
      expect(previewView.playerSkills).toEqual([]);

      // Advancing the locked turn via action:'pass' resolves WITHOUT a 422 (the forced skip is
      // honored regardless of any posted skill) and returns the next turn's state.
      const pass = await postTurn(
        agumon.id,
        { enemyId: 'numemon', action: 'pass', state: seeded },
        token,
      );
      expect(pass.status).toBe(200);
      const passView = (await pass.json()) as BattleTurnView;
      // The turn advanced: an entry was appended (the "cannot act" skip logs against the player).
      expect(passView.entries.length).toBeGreaterThan(0);

      // A locked player posting an UNKNOWN skill must NOT 422 either (the skip discards the pick).
      const bogus = await postTurn(
        agumon.id,
        { enemyId: 'numemon', skillId: 'not-a-real-skill', state: seeded },
        token,
      );
      expect(bogus.status).toBe(200);
    }

    // An UNLOCKED player still 422s on an unknown skill (no regression to the validation path).
    const unknown = await postTurn(
      agumon.id,
      { enemyId: 'numemon', skillId: 'not-a-real-skill', state: carried },
      token,
    );
    expect(unknown.status).toBe(422);

    // The ENDING (fled) turn returns playerControlLock: null (mirrors nextEnemy/nextPlayer).
    // TASK-177: flee is a LIVE_RNG roll over HTTP — drive it via the service with DEFAULT_RNG
    // (always succeeds) so the fled assertion is non-flaky (L-55/L-56).
    const service = app.get(DigimonService);
    const userId = (
      await app.get(PrismaService).digimon.findFirstOrThrow({ where: { id: agumon.id } })
    ).userId;
    const fledView = await service.battleTurn(
      userId,
      agumon.id,
      'numemon',
      undefined,
      carried,
      'flee',
      DEFAULT_RNG,
    );
    expect(fledView.outcome).toBe('fled');
    expect(fledView.playerControlLock ?? null).toBeNull();
  });

  // TASK-154 (R-22 slice 15): the SYMMETRIC ENEMY-side control-lock TELEGRAPH — the enemy-side MIRROR
  // of TASK-153. Before this slice `telegraphFor()` computed `nextEnemy` but NEVER read the enemy's
  // control-lock, so when the enemy carried stun/freeze/sleep into its upcoming turn the HUD still
  // read "Enemy intends: {skill}" even though `resolveActorTurn`'s symmetric `stunnedThisTurn` guard
  // will silently discard that action — the enemy forgoes its turn (present ≠ observable, L-17). Now
  // the interactive seam READS `state.enemy.statuses` via the already-exported side-agnostic
  // `activeControlLock` and surfaces the lock on `nextEnemyControlLock` ALONGSIDE the (unchanged)
  // `nextEnemy` intent. NO new ailment/skill/RNG; `battle.ts` is byte-unchanged (invariant 5).
  it('a control-LOCKED enemy returns nextEnemyControlLock non-null (kind+label) alongside nextEnemy; an UNLOCKED enemy is null; the ending turn is null (TASK-154)', async () => {
    const token = await registerAndLogin('enemy-control-lock@example.test');
    const agumon = agumonOf(await getRoster(token));
    // TASK-177 fed the HTTP boundary LIVE_RNG (real Math.random), so a seeded-status turn resolved
    // over `postTurn` can crit/evade its way to an ENDING fight — on which `nextEnemyControlLock`
    // is (correctly) null — and flake this control-lock assertion. Drive every turn here through
    // the SERVICE with DEFAULT_RNG (byte-reproducible, real app + DB) so the seeded lock preview is
    // deterministic; the fled tail below already uses this path (L-55/L-56 non-flaky discipline).
    const userId = (
      await app.get(PrismaService).digimon.findFirstOrThrow({ where: { id: agumon.id } })
    ).userId;

    // Turn 1 from a fresh fight to obtain a real carried wire `state` to seed enemy statuses onto.
    const view1 = await turnViaService(userId, agumon.id, { enemyId: 'numemon', skillId: 'attack' });
    expect(view1.outcome).toBeNull();
    // The turn response ALWAYS carries the (optional) nextEnemyControlLock field on a live turn.
    expect('nextEnemyControlLock' in view1).toBe(true);

    // An explicitly UNLOCKED enemy (no control status) → nextEnemyControlLock: null + a real nextEnemy.
    const base = view1.state as SerializedFightState;
    const carried: SerializedFightState = {
      ...base,
      enemy: { ...base.enemy, statuses: [] },
    };
    const unlockedView = await turnViaService(userId, agumon.id, {
      enemyId: 'numemon',
      skillId: 'attack',
      state: carried,
    });
    expect(unlockedView.nextEnemyControlLock ?? null).toBeNull();
    // The intent telegraph is still a real named enemy skill (untouched by this slice).
    expect(unlockedView.nextEnemy?.skillId).toBeDefined();

    // Seed each control-lock kind on the ENEMY and assert the honest enemy-side surfacing.
    for (const [kind, label] of [
      ['stun', 'Stunned'],
      ['freeze', 'Frozen'],
      ['sleep', 'Asleep'],
    ] as const) {
      const seeded: SerializedFightState = {
        ...carried,
        enemy: {
          ...carried.enemy,
          statuses: [{ kind, turnsRemaining: 2 }],
        },
      };

      // A locked enemy: nextEnemyControlLock is non-null with the matching kind + label, AND
      // nextEnemy (the intent line) is STILL present alongside it — showing both is honest.
      const previewView = await turnViaService(userId, agumon.id, {
        enemyId: 'numemon',
        skillId: 'attack',
        state: seeded,
      });
      expect(previewView.nextEnemyControlLock).toEqual({ kind, label });
      // nextEnemy stays byte-unchanged by this slice — still a real named enemy telegraph.
      expect(previewView.nextEnemy?.skillId).toBeDefined();
      expect(typeof previewView.nextEnemy?.name).toBe('string');
    }

    // The ENDING (fled) turn returns nextEnemyControlLock: null (mirrors nextEnemy/nextPlayer).
    const seededForFlee: SerializedFightState = {
      ...carried,
      enemy: { ...carried.enemy, statuses: [{ kind: 'freeze', turnsRemaining: 2 }] },
    };
    // TASK-177: flee is a LIVE_RNG roll over HTTP — drive via the service with DEFAULT_RNG
    // (always succeeds) so the fled assertion is non-flaky (L-55/L-56).
    const fled2View = await app
      .get(DigimonService)
      .battleTurn(
        userId,
        agumon.id,
        'numemon',
        undefined,
        seededForFlee,
        'flee',
        DEFAULT_RNG,
      );
    expect(fled2View.outcome).toBe('fled');
    expect(fled2View.nextEnemyControlLock ?? null).toBeNull();
    expect(fled2View.nextEnemy ?? null).toBeNull();
  });

  // TASK-154 backward-compat: the turn response round-trips WITH and WITHOUT the new field — a
  // pre-slice carried snapshot omitting `nextEnemyControlLock` deserializes cleanly (no crash, the
  // field is simply absent/undefined and degrades to "no enemy lock").
  it('the turn response deserializes cleanly whether or not nextEnemyControlLock is present (TASK-154 backward-compat)', async () => {
    const token = await registerAndLogin('enemy-lock-compat@example.test');
    const agumon = agumonOf(await getRoster(token));
    const res = await postTurn(agumon.id, { enemyId: 'numemon' }, token);
    expect(res.status).toBe(200);
    const view = (await res.json()) as BattleTurnView;
    // The field is present (optional) on a live preview; reading it with the ?? null guard is safe.
    expect(view.nextEnemyControlLock ?? null).toBeNull();
    // A fresh unlocked fight has no enemy lock — the intent telegraph carries the real next skill.
    expect(view.nextEnemy?.skillId).toBeDefined();
  });

  it('DIFFICULTY (TASK-165): opening a player-in-kill-range fight EASY makes the enemy play the FLAT chooseSkill (never presses the finisher); HARD (default) presses the smart pick — the knob changes behaviour end-to-end, and survives across a second turn', async () => {
    // R-22 slice 26. The interactive enemy AI is normally the full banking chain. The
    // difficulty knob selects WHICH existing selector the seam injects: 'easy' → the flat
    // chooseSkill (no finisher/defence/bank smarts), 'hard' → the full chain. We drive the
    // crafted kill-range case on the SERVICE (L-55/L-56 — a natural fight rarely reaches a
    // clean 1-HP-player mid-state) and open a START PREVIEW so the enemy's TELEGRAPH (computed
    // via the SAME injected selector) reveals the difficulty without needing the turn to resolve.
    const token = await registerAndLogin('difficulty-turn@example.test');
    const before = agumonOf(await getRoster(token));
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = row.userId;

    const numemon = findEnemy('numemon')!;
    const playerC: Combatant = {
      name: before.name,
      type: before.type,
      element: before.element,
      hp: before.hp,
      maxHp: before.hp,
      atk: before.atk,
      def: before.def,
      spd: before.spd,
    };

    // KILL RANGE: the player at 1 HP (any enemy strike is lethal), enemy at MAX_ENERGY so a
    // lethal Double Strike is affordable. On this state the smart chain presses the finisher
    // while the flat chooseSkill picks its ordinary control/stall skill — a clean divergence.
    const killSeed: SerializedFightState = {
      player: { hp: 1, energy: energyAtTurnStart(MAX_ENERGY), statuses: [], inflicted: [] },
      enemy: { hp: numemon.hp, energy: MAX_ENERGY, statuses: [], inflicted: [] },
      round: 1,
      decided: null,
    };
    const live = deserializeFightState(killSeed);
    const flatPick = chooseSkill(live.enemy, live.player);
    const smartPick = chooseSkillBanking(live.enemy, live.player, numemon, playerC);
    // Precondition: the difficulty genuinely bites on this fixture (the picks diverge).
    expect(flatPick.id).not.toBe(smartPick.id);

    // --- EASY start-preview: the enemy telegraphs the FLAT pick (it does NOT press the kill). ---
    const easySeed: SerializedFightState = { ...killSeed, difficulty: 'easy' };
    const easyPreview = await service.battleTurn(
      userId,
      before.id,
      'numemon',
      undefined, // start preview — no turn resolved
      easySeed,
    );
    expect(easyPreview.nextEnemy).toMatchObject({
      skillId: flatPick.id,
      name: flatPick.name,
    });
    // The carried difficulty survives the round-trip onto the returned state.
    expect((easyPreview.state as SerializedFightState).difficulty).toBe('easy');

    // --- EASY across a SECOND turn: the choice persists via the carried state with NO client
    // bookkeeping — resolve one player turn, and the enemy STILL telegraphs the flat pick. ---
    // Reset the player HP so the fight survives the exchange (still kill-range on the enemy's turn
    // would end it); use a fresh full-HP-ish seed but keep the carried difficulty from the preview.
    const secondSeed = easyPreview.state as SerializedFightState;
    expect(secondSeed.difficulty).toBe('easy');
    const secondTurn = await service.battleTurn(userId, before.id, 'numemon', 'attack', secondSeed);
    // Whatever the outcome, the carried difficulty is still 'easy' when the fight continues.
    if (secondTurn.state !== null) {
      expect((secondTurn.state as SerializedFightState).difficulty).toBe('easy');
    }

    // --- HARD start-preview (opening the SAME kill-range state): the enemy telegraphs the
    // SMART pick — it presses the finisher. Proves the knob flips behaviour end-to-end. ---
    const hardSeed: SerializedFightState = { ...killSeed, difficulty: 'hard' };
    const hardPreview = await service.battleTurn(userId, before.id, 'numemon', undefined, hardSeed);
    expect(hardPreview.nextEnemy).toMatchObject({
      skillId: smartPick.id,
      name: smartPick.name,
    });

    // --- DEFAULT (difficulty OMITTED): a carried state with no difficulty resumes as 'hard'
    // (back-compat) — the enemy telegraphs the smart pick, byte-identical to today's behaviour. ---
    const defaultPreview = await service.battleTurn(
      userId,
      before.id,
      'numemon',
      undefined,
      killSeed, // no `difficulty` field
    );
    expect(defaultPreview.nextEnemy).toMatchObject({
      skillId: smartPick.id,
      name: smartPick.name,
    });
    expect((defaultPreview.state as SerializedFightState).difficulty).toBe('hard');
  });

  it("DIFFICULTY (TASK-166): opening a player-in-kill-range fight NORMAL makes the enemy press the FINISHER (unlike EASY's flat pick) — the middle tier changes behaviour end-to-end and survives a second turn via the carried state", async () => {
    // R-22 slice 27. The MIDDLE 'normal' tier maps to chooseSkillFinisher: it presses a lethal
    // when the PLAYER is in kill range (unlike 'easy', which plays the flat chooseSkill) but does
    // NOT guard/bank like 'hard'. On a clean kill-range state the finisher pick coincides with the
    // banking chain's pick, so 'normal' telegraphs the smart finisher — diverging from 'easy'.
    const token = await registerAndLogin('difficulty-normal-turn@example.test');
    const before = agumonOf(await getRoster(token));
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = row.userId;

    const numemon = findEnemy('numemon')!;
    const playerC: Combatant = {
      name: before.name,
      type: before.type,
      element: before.element,
      hp: before.hp,
      maxHp: before.hp,
      atk: before.atk,
      def: before.def,
      spd: before.spd,
    };

    const killSeed: SerializedFightState = {
      player: { hp: 1, energy: energyAtTurnStart(MAX_ENERGY), statuses: [], inflicted: [] },
      enemy: { hp: numemon.hp, energy: MAX_ENERGY, statuses: [], inflicted: [] },
      round: 1,
      decided: null,
    };
    const live = deserializeFightState(killSeed);
    const flatPick = chooseSkill(live.enemy, live.player);
    const finisherPick = chooseSkillFinisher(live.enemy, live.player, numemon, playerC);
    // Precondition: on this kill-range fixture the finisher genuinely diverges from the flat pick.
    expect(flatPick.id).not.toBe(finisherPick.id);

    // --- NORMAL start-preview: the enemy telegraphs the FINISHER pick (it presses the kill). ---
    const normalSeed: SerializedFightState = { ...killSeed, difficulty: 'normal' };
    const normalPreview = await service.battleTurn(
      userId,
      before.id,
      'numemon',
      undefined, // start preview — no turn resolved
      normalSeed,
    );
    expect(normalPreview.nextEnemy).toMatchObject({
      skillId: finisherPick.id,
      name: finisherPick.name,
    });
    // And it DIVERGES from the flat 'easy' pick — the middle tier bites.
    expect(normalPreview.nextEnemy?.skillId).not.toBe(flatPick.id);
    // The carried difficulty survives the round-trip onto the returned state.
    expect((normalPreview.state as SerializedFightState).difficulty).toBe('normal');

    // --- NORMAL across a SECOND turn: the choice persists via the carried state. ---
    const secondSeed = normalPreview.state as SerializedFightState;
    expect(secondSeed.difficulty).toBe('normal');
    const secondTurn = await service.battleTurn(userId, before.id, 'numemon', 'attack', secondSeed);
    if (secondTurn.state !== null) {
      expect((secondTurn.state as SerializedFightState).difficulty).toBe('normal');
    }
  });

  // TASK-168 (R-22 slice 29): a biome-derived enemyScale on the opening turn makes the wild foe
  // TOUGHER — its starting HP is scaled once at the server-authoritative rebuild seam; the default
  // (no scale) opens the byte-baseline foe; the scale survives a SECOND turn (carried in state).
  it('opening with enemyScale 1.5 → the foe starts at ≈1.5× baseline HP; no scale → baseline; scale survives a second turn', async () => {
    const token = await registerAndLogin('enemy-scale-turn@example.test');
    const agumon = agumonOf(await getRoster(token));
    const baseline = findEnemy('numemon')!;

    // START PREVIEW (no skillId → no turn resolves) so the returned state's enemy HP is the
    // FRESH starting HP, uncontaminated by any strike — the cleanest boundary read of the scale.
    // DEFAULT: no enemyScale → the byte-baseline foe (prove the default-covered case over HTTP).
    const baseRes = await postTurn(agumon.id, { enemyId: 'numemon' }, token);
    expect(baseRes.status).toBe(200);
    const baseView = (await baseRes.json()) as BattleTurnView;
    expect(baseView.state!.enemy.hp).toBe(baseline.hp);

    // SCALED: enemyScale 1.5 → the foe opens with ≈1.5× the baseline HP.
    const scaledRes = await postTurn(agumon.id, { enemyId: 'numemon', enemyScale: 1.5 }, token);
    expect(scaledRes.status).toBe(200);
    const scaledView = (await scaledRes.json()) as BattleTurnView;
    expect(scaledView.state!.enemy.hp).toBe(Math.round(baseline.hp * 1.5));
    expect(scaledView.state!.enemy.hp).toBeGreaterThan(baseline.hp);
    // The scale is carried on the returned state so a continuing turn rebuilds the SAME foe.
    expect((scaledView.state as SerializedFightState).enemyScale).toBe(1.5);

    // SECOND turn: resume the scaled fight (carried state, NO fresh enemyScale) — the carried
    // scale still governs, so the (server-authoritative, maxHp-based) foe stays the tougher one.
    const secondRes = await postTurn(
      agumon.id,
      { enemyId: 'numemon', skillId: 'attack', state: scaledView.state },
      token,
    );
    expect(secondRes.status).toBe(200);
    const secondView = (await secondRes.json()) as BattleTurnView;
    if (secondView.state !== null) {
      expect((secondView.state as SerializedFightState).enemyScale).toBe(1.5);
    }
  });

  // TASK-171 (R-22 slice 32): DANGER-SCALED WIN REWARD — a win on a danger-scaled fight grants
  // proportionally MORE XP, so the shipped danger axes (biome × distance × player-level, all carried
  // on `enemyScale`) get a matching REWARD axis. The reward is `scaledBattleReward(BATTLE_XP_REWARD,
  // activeEnemyScale)` at the interactive win site; the `scale === 1` identity guard keeps a no-scale
  // win at the flat baseline (the byte-proof over HTTP). Proven end-to-end here.
  //
  // NOTE on the harness: the shipped starter beats the wild `numemon` with a KNIFE-EDGE margin
  // (4 HP at scale 1) — ANY enemy-strength scale > 1 flips the FULL fight to a loss (attrition),
  // so we CANNOT drive a whole scaled fight to a win. But the reward scale is decoupled from combat
  // balance: `activeEnemyScale` (which sizes the reward) is read from the carried state's
  // `enemyScale`, while the fight's live enemy HP is carried in that same state. So we drive an
  // UNSCALED fight to the penultimate (one-blow-from-won) state, then finish from that state with
  // `enemyScale` injected — the low carried enemy HP still dies on the final blow (scaling only
  // re-sizes the stat block's maxHp, not the carried current HP), and the WIN reward scales by the
  // injected danger — proving the risk↔reward link without needing a winnable scaled full fight.
  it('a WIN scales reward.xpGained by the carried enemyScale (scaledBattleReward) — strictly > the flat baseline; a no-scale win grants EXACTLY the baseline', async () => {
    const token = await registerAndLogin('scaled-reward-turn@example.test');
    const before = agumonOf(await getRoster(token));
    // TASK-177: the HTTP boundary now feeds LIVE_RNG, so a full-fight outcome over HTTP would
    // flake — drive this deterministic win via the service with DEFAULT_RNG (L-55/L-56).
    const userId = (await app.get(PrismaService).digimon.findFirstOrThrow({ where: { id: before.id } }))
      .userId;

    // Drive the UNSCALED fight turn-by-turn (mirroring the auto-driver's chooseSkill pick — the
    // load-bearing proof the interactive route resolves a real fight), keeping the state from BEFORE
    // each post so that when the fight ends we still hold the penultimate one-blow-from-won state.
    let state: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let prevState: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let outcome: BattleTurnView['outcome'] = null;
    let flatXp = 0;
    // TASK-172: capture the WINNING flat-fight view to assert its reward carries NO breakdown.
    let flatWinView: BattleTurnView | null = null;
    const numemon = findEnemy('numemon')!;
    const player: Combatant = {
      name: before.name,
      type: before.type,
      element: before.element,
      hp: before.hp,
      maxHp: before.hp,
      atk: before.atk,
      def: before.def,
      spd: before.spd,
    };
    const seed = deserializeFightState({
      player: { hp: player.hp, energy: energyAtTurnStart(MAX_ENERGY), statuses: [], inflicted: [] },
      enemy: { hp: numemon.hp, energy: MAX_ENERGY, statuses: [], inflicted: [] },
      round: 1,
      decided: null,
    });
    let nextSkill = chooseSkill(seed.player, seed.enemy).id;
    let guard = 0;
    while (outcome === null && guard < 200) {
      guard += 1;
      prevState = state; // the state we are about to resolve FROM (penultimate when the fight ends)
      const view = await turnViaService(userId, before.id, {
        enemyId: 'numemon',
        skillId: nextSkill,
        state: state ?? undefined,
      });
      outcome = view.outcome;
      state = view.state;
      flatXp = view.reward.xpGained;
      if (view.outcome === 'win') flatWinView = view;
      if (view.state !== null) {
        const live = deserializeFightState(view.state as SerializedFightState);
        live.player.energy = energyAtTurnStart(live.player.energy);
        nextSkill = chooseSkill(live.player, live.enemy).id;
      }
    }
    // NO-SCALE win: the identity guard grants EXACTLY the flat baseline (the byte-proof over HTTP).
    expect(outcome).toBe('win');
    expect(flatXp).toBe(BATTLE_XP_REWARD);
    // TASK-172 (R-22 slice 33): a scale-1 win carries NO danger-reward breakdown — the total is
    // byte-identical to TASK-171 and the optional fields are ABSENT (the identity byte-proof).
    expect(flatWinView).not.toBeNull();
    expect((flatWinView as BattleTurnView).reward.baseXp).toBeUndefined();
    expect((flatWinView as BattleTurnView).reward.scaleBonus).toBeUndefined();
    const afterFlat = agumonOf(await getRoster(token));
    expect(afterFlat.xp).not.toBe(before.xp);

    // SCALED win: re-finish from the penultimate (one-blow-from-won) state with a danger scale
    // injected onto the carried state. The low carried enemy HP still dies (scaling re-sizes only the
    // stat block, not the carried current HP), so the fight WINS again — and the reward scales.
    expect(prevState).not.toBeNull();
    const scale = 1.5;
    const before2 = agumonOf(await getRoster(token)); // a fresh baseline after the flat win persisted
    const scaledState = { ...(prevState as SerializedFightState), enemyScale: scale };
    // Re-derive the finishing skill from that penultimate state (post-regen), exactly as the driver.
    const prevLive = deserializeFightState(prevState as SerializedFightState);
    prevLive.player.energy = energyAtTurnStart(prevLive.player.energy);
    const finishSkill = chooseSkill(prevLive.player, prevLive.enemy).id;
    const finishView = await turnViaService(userId, before.id, {
      enemyId: 'numemon',
      skillId: finishSkill,
      state: scaledState,
    });
    expect(finishView.outcome).toBe('win');
    // The reward is the DANGER-SCALED grant — strictly greater than the flat baseline.
    expect(finishView.reward.xpGained).toBe(scaledBattleReward(BATTLE_XP_REWARD, scale));
    expect(finishView.reward.xpGained).toBeGreaterThan(BATTLE_XP_REWARD);
    // TASK-172 (R-22 slice 33): the scaled win surfaces the danger-reward BREAKDOWN so the
    // payoff is legible — baseXp = the flat base, scaleBonus = the danger-derived extra, and
    // the two sum to the (unchanged) total. Display-only decomposition of the already-granted XP.
    expect(finishView.reward.baseXp).toBe(BATTLE_XP_REWARD);
    expect(finishView.reward.scaleBonus).toBe(finishView.reward.xpGained - BATTLE_XP_REWARD);
    expect(finishView.reward.scaleBonus).toBeGreaterThan(0);
    expect((finishView.reward.baseXp as number) + (finishView.reward.scaleBonus as number)).toBe(
      finishView.reward.xpGained,
    );
    // The scaled grant persisted to the caller's own Digimon progression (FREE XP; invariant 3).
    const after2 = agumonOf(await getRoster(token));
    expect(after2.xp).not.toBe(before2.xp);
  });

  // TASK-173 (R-22 slice 34): DANGER-SCALED LOOT DROP — the FIRST danger → ECONOMIC-reward link.
  // A wild interactive WIN now credits a small SPENDABLE resource (DigiCredits) — sized by the
  // carried `enemyScale` via `battleLootAmount` — into the player's persisted `ResourceBalance`,
  // with an append-only `AuditLog` row inside the SAME win `$transaction` (invariant 3 GENUINELY
  // exercised — the first fight to move spendable value). A LOSS credits NOTHING and carries no
  // `loot`. We reuse the penultimate-then-inject-scale harness from the scaled-XP test above
  // (the starter beats numemon by a knife-edge, so a full scaled fight can't be won — but the
  // reward/loot scale reads the carried `enemyScale`, decoupled from the carried live HP).
  it('a WIN credits a danger-scaled DigiCredits drop (battleLootAmount) into ResourceBalance + one battle_loot AuditLog row; a scale-1 win credits the base; a LOSS credits nothing', async () => {
    const token = await registerAndLogin('battle-loot-turn@example.test');
    const before = agumonOf(await getRoster(token));
    const prisma = app.get(PrismaService);
    const winnerRow = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = winnerRow.userId;

    // Drive the UNSCALED fight to the penultimate (one-blow-from-won) state, holding the state
    // from BEFORE each post — exactly as the scaled-XP test does.
    let state: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let prevState: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let outcome: BattleTurnView['outcome'] = null;
    let flatWinView: BattleTurnView | null = null;
    const numemon = findEnemy('numemon')!;
    const seed = deserializeFightState({
      player: { hp: before.hp, energy: energyAtTurnStart(MAX_ENERGY), statuses: [], inflicted: [] },
      enemy: { hp: numemon.hp, energy: MAX_ENERGY, statuses: [], inflicted: [] },
      round: 1,
      decided: null,
    });
    let nextSkill = chooseSkill(seed.player, seed.enemy).id;
    let guard = 0;
    while (outcome === null && guard < 200) {
      guard += 1;
      prevState = state;
      const view = await turnViaService(userId, before.id, {
        enemyId: 'numemon',
        skillId: nextSkill,
        state: state ?? undefined,
      });
      outcome = view.outcome;
      state = view.state;
      if (view.outcome === 'win') flatWinView = view;
      if (view.state !== null) {
        const live = deserializeFightState(view.state as SerializedFightState);
        live.player.energy = energyAtTurnStart(live.player.energy);
        nextSkill = chooseSkill(live.player, live.enemy).id;
      }
    }
    expect(outcome).toBe('win');

    // NO-SCALE win: the loot is present, resource DigiCredits, amount = the BASE drop (scale 1).
    expect(flatWinView).not.toBeNull();
    const flatLoot = (flatWinView as BattleTurnView).reward.loot;
    expect(flatLoot).toBeDefined();
    expect(flatLoot!.resource).toBe(BATTLE_LOOT_RESOURCE);
    expect(flatLoot!.amount).toBe(battleLootAmount(1));
    // TASK-175: a NO-biome win reports the baseline rarity tier 'Common' (back-compat anchor).
    expect(flatLoot!.rarity).toBe('Common');

    // The balance is CREDITED by exactly that amount, and ONE battle_loot audit row exists whose
    // amountBefore → amountAfter matches the credit (invariant 3 EXERCISED, owner-scoped).
    const balAfterFlat = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource: BATTLE_LOOT_RESOURCE } },
    });
    expect(balAfterFlat?.amount).toBe(battleLootAmount(1));
    const flatAudits = await prisma.auditLog.findMany({
      where: { userId, action: 'battle_loot' },
      orderBy: { createdAt: 'asc' },
    });
    expect(flatAudits).toHaveLength(1);
    expect(flatAudits[0].resource).toBe(BATTLE_LOOT_RESOURCE);
    expect(flatAudits[0].amountBefore).toBe(0);
    expect(flatAudits[0].amountAfter).toBe(battleLootAmount(1));
    expect(flatAudits[0].amountAfter - flatAudits[0].amountBefore).toBe(battleLootAmount(1));

    // SCALED win: re-finish the penultimate state with a danger scale injected — the loot scales
    // by `battleLootAmount(scale)`, strictly greater than the base, and INCREMENTS the one row
    // (a second win sums onto it) with a SECOND append-only audit row.
    expect(prevState).not.toBeNull();
    const scale = 2;
    const scaledState = { ...(prevState as SerializedFightState), enemyScale: scale };
    const prevLive = deserializeFightState(prevState as SerializedFightState);
    prevLive.player.energy = energyAtTurnStart(prevLive.player.energy);
    const finishSkill = chooseSkill(prevLive.player, prevLive.enemy).id;
    const finishView = await turnViaService(userId, before.id, {
      enemyId: 'numemon',
      skillId: finishSkill,
      state: scaledState,
    });
    expect(finishView.outcome).toBe('win');
    const scaledLoot = finishView.reward.loot;
    expect(scaledLoot).toBeDefined();
    expect(scaledLoot!.amount).toBe(battleLootAmount(scale));
    expect(scaledLoot!.amount).toBeGreaterThan(battleLootAmount(1));
    // Upsert-increment: the one row now holds base + scaled; two audit rows total.
    const balAfterScaled = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource: BATTLE_LOOT_RESOURCE } },
    });
    expect(balAfterScaled?.amount).toBe(battleLootAmount(1) + battleLootAmount(scale));
    const scaledAudits = await prisma.auditLog.findMany({
      where: { userId, action: 'battle_loot' },
    });
    expect(scaledAudits).toHaveLength(2);

    // A LOSS credits NOTHING and carries no loot. A fresh player always-Attacks numemon (loses by
    // attrition — the always-Attack path is the documented losing line vs the auto chooseSkill win).
    const lossToken = await registerAndLogin('battle-loss-noloot@example.test');
    const lossBefore = agumonOf(await getRoster(lossToken));
    const lossRow = await prisma.digimon.findFirstOrThrow({ where: { id: lossBefore.id } });
    let lossState: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let lossOutcome: BattleTurnView['outcome'] = null;
    let lossGuard = 0;
    let lastLossView: BattleTurnView | null = null;
    while (lossOutcome === null && lossGuard < 200) {
      lossGuard += 1;
      const view = await turnViaService(lossRow.userId, lossBefore.id, {
        enemyId: 'numemon',
        skillId: 'attack',
        state: lossState ?? undefined,
      });
      lossOutcome = view.outcome;
      lossState = view.state;
      lastLossView = view;
    }
    expect(lossOutcome).toBe('loss');
    expect(lastLossView!.reward.loot).toBeUndefined();
    // No DigiCredits balance row and no battle_loot audit rows for the loser (invariant 3: no move).
    const lossBal = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId: lossRow.userId, resource: BATTLE_LOOT_RESOURCE } },
    });
    expect(lossBal).toBeNull();
    const lossAudits = await prisma.auditLog.findMany({
      where: { userId: lossRow.userId, action: 'battle_loot' },
    });
    expect(lossAudits).toHaveLength(0);
  });

  // TASK-268 (R-31e third slice): the roguelike ON-LOSS penalty now fires in the INTERACTIVE
  // `battleTurn` seam a real player DRIVES turn-by-turn — mirroring the auto `battle()` loss
  // branch (proven in battle.controller.spec.ts:233-389). Before this slice, losing the
  // menu-driven fight cost NOTHING (only the win branch persisted). We seed two distinct owned
  // stacks + xp above the penalty, drive the interactive turn seam (always-Attack vs numemon = the
  // documented losing line) to a LOSS via the SERVICE with DEFAULT_RNG (so the outcome is
  // byte-reproducible, L-55/L-56), and assert: the returned Digimon's xp dropped by
  // lossPenaltyFor(level) with a battle-loss audit row (before→after), the inventory reads empty
  // (slotsUsed 0) with a per-stack battle-loss-wipe row, all floored/never de-leveled, all in the
  // SAME turn transaction.
  it('an INTERACTIVE LOSS drops xp + wipes the whole inventory — battle-loss + per-stack battle-loss-wipe audit rows (TASK-268)', async () => {
    const token = await registerAndLogin('interactive-loss-penalty@example.test');
    const before = agumonOf(await getRoster(token));
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = row.userId;

    // Seed xp above the penalty so the SUBTRACTION (not the floor-at-0 case) is asserted, and
    // two distinct owned stacks so the soft-wipe must vanish BOTH from the rail.
    const expectedPenalty = lossPenaltyFor(before.level);
    const seededXp = expectedPenalty + 50;
    await prisma.digimon.update({ where: { id: before.id }, data: { xp: seededXp } });
    await prisma.inventoryItem.create({ data: { userId, itemId: 'heal-chip-1', quantity: 3 } });
    await prisma.inventoryItem.create({ data: { userId, itemId: 'meat-storage-1', quantity: 1 } });

    // Drive the interactive seam to a LOSS (always-Attack vs numemon loses by attrition).
    let state: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let outcome: BattleTurnView['outcome'] = null;
    let guard = 0;
    let lastView: BattleTurnView | null = null;
    while (outcome === null && guard < 200) {
      guard += 1;
      const view = await turnViaService(userId, before.id, {
        enemyId: 'numemon',
        skillId: 'attack',
        state: state ?? undefined,
      });
      outcome = view.outcome;
      state = view.state;
      lastView = view;
    }
    expect(outcome).toBe('loss');

    // No win reward on the losing turn; the returned Digimon shows the penalized xp (never de-leveled).
    expect(lastView!.reward.xpGained).toBe(0);
    const expectedXp = Math.max(0, seededXp - expectedPenalty);
    expect(lastView!.digimon.xp).toBe(expectedXp);
    expect(lastView!.digimon.level).toBe(before.level);

    // TASK-269 (R-31e fourth slice): the loss REPORTS the penalty on the wire so the player can
    // be told — `xpLost` is the real before→after drop (== lossPenaltyFor(level) here) and
    // `inventoryWiped` is true because two owned stacks were soft-zeroed.
    expect(lastView!.reward.xpLost).toBe(expectedPenalty);
    expect(lastView!.reward.xpLost).toBe(seededXp - expectedXp);
    expect(lastView!.reward.inventoryWiped).toBe(true);

    // The xp penalty PERSISTED — a fresh GET shows the same lower xp.
    const after = agumonOf(await getRoster(token));
    expect(after.xp).toBe(expectedXp);
    expect(after.level).toBe(before.level);

    // A single battle-loss audit row records before→after xp (resource null — no balance moved).
    const lossAudit = await prisma.auditLog.findMany({ where: { userId, action: 'battle-loss' } });
    expect(lossAudit).toHaveLength(1);
    expect(lossAudit[0].entity).toBe('Digimon');
    expect(lossAudit[0].entityId).toBe(before.id);
    expect(lossAudit[0].resource).toBeNull();
    expect(lossAudit[0].amountBefore).toBe(seededXp);
    expect(lossAudit[0].amountAfter).toBe(expectedXp);

    // The inventory reads EMPTY afterward — each stack soft-zeroed (rows still exist at 0).
    const invRes = await fetch(`${baseUrl}/inventory`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(invRes.status).toBe(200);
    const inv = (await invRes.json()) as { items: unknown[]; slotsUsed: number };
    expect(inv.slotsUsed).toBe(0);
    expect(inv.items).toHaveLength(0);
    const heal = await prisma.inventoryItem.findUnique({
      where: { userId_itemId: { userId, itemId: 'heal-chip-1' } },
    });
    const meat = await prisma.inventoryItem.findUnique({
      where: { userId_itemId: { userId, itemId: 'meat-storage-1' } },
    });
    expect(heal!.quantity).toBe(0);
    expect(meat!.quantity).toBe(0);

    // Each destroyed stack carries its OWN append-only battle-loss-wipe audit row (before→0).
    const wipeRows = await prisma.auditLog.findMany({
      where: { userId, action: 'battle-loss-wipe' },
      orderBy: { entityId: 'asc' },
    });
    expect(wipeRows).toHaveLength(2);
    for (const wr of wipeRows) {
      expect(wr.entity).toBe('InventoryItem');
      expect(wr.resource).toBeNull();
      expect(wr.amountAfter).toBe(0);
      expect(wr.amountBefore).toBeGreaterThan(0);
    }
    expect(wipeRows.map((r) => r.entityId).sort()).toEqual(['heal-chip-1', 'meat-storage-1']);
  });

  // A WIN / flee / undecided interactive turn leaves xp + inventory UNTOUCHED — the penalty is
  // strictly loss-scoped (no battle-loss / battle-loss-wipe rows on a non-loss).
  it('an INTERACTIVE WIN leaves inventory + xp untouched — no battle-loss/battle-loss-wipe rows (TASK-268)', async () => {
    const token = await registerAndLogin('interactive-win-nopenalty@example.test');
    const before = agumonOf(await getRoster(token));
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = row.userId;
    await prisma.inventoryItem.create({ data: { userId, itemId: 'heal-chip-1', quantity: 2 } });

    // Auto chooseSkill vs numemon is the documented WIN line (turnViaService feeds DEFAULT_RNG).
    let state: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let outcome: BattleTurnView['outcome'] = null;
    let guard = 0;
    let lastWinView: BattleTurnView | null = null;
    // Start preview, then let the enemy AI drive by passing skills — but a fresh player who
    // ATTACKS numemon while it is weak wins; drive with 'attack' and take the win path.
    while (outcome === null && guard < 200) {
      guard += 1;
      const view = await turnViaService(userId, before.id, {
        enemyId: 'numemon',
        skillId: 'attack',
        state: state ?? undefined,
        difficulty: 'easy',
      });
      outcome = view.outcome;
      state = view.state;
      lastWinView = view;
    }
    // The 'easy' flat-AI numemon fight ends decided; whatever the outcome, assert the NON-loss
    // invariant only when it is a win (a loss would penalize — the loss case is covered above).
    if (outcome === 'win') {
      // TASK-269: the loss-report fields are OMITTED on a non-loss branch (byte-frozen reward shape).
      expect(lastWinView!.reward.xpLost).toBeUndefined();
      expect(lastWinView!.reward.inventoryWiped).toBeUndefined();
      const wipeRows = await prisma.auditLog.findMany({
        where: { userId, action: 'battle-loss-wipe' },
      });
      expect(wipeRows).toHaveLength(0);
      const lossAudit = await prisma.auditLog.findMany({ where: { userId, action: 'battle-loss' } });
      expect(lossAudit).toHaveLength(0);
      const heal = await prisma.inventoryItem.findUnique({
        where: { userId_itemId: { userId, itemId: 'heal-chip-1' } },
      });
      expect(heal!.quantity).toBe(2);
    }
  });

  // The PvE gate: a PvP interactive loss (skipEconomicReward = true) applies NEITHER the xp
  // penalty NOR the inventory wipe — a ranked duel loss stays MMR-only (the MMR is applied
  // elsewhere by the PvP service). Drive the SAME losing line but with skipEconomicReward.
  it('a PvP interactive LOSS (skipEconomicReward) applies NO xp penalty + NO wipe — PvE gate (TASK-268)', async () => {
    const token = await registerAndLogin('interactive-pvp-loss-gate@example.test');
    const before = agumonOf(await getRoster(token));
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = row.userId;

    const seededXp = lossPenaltyFor(before.level) + 50;
    await prisma.digimon.update({ where: { id: before.id }, data: { xp: seededXp } });
    await prisma.inventoryItem.create({ data: { userId, itemId: 'heal-chip-1', quantity: 4 } });

    const service = app.get(DigimonService);
    // Drive to a loss via the SERVICE with skipEconomicReward = true (the PvP caller's flag).
    // battleTurn signature: (userId, digimonId, enemyId, skillId?, state?, action?, rng?,
    //  difficulty?, enemyScale?, biome?, foe?, skipEconomicReward?).
    let state: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let outcome: BattleTurnView['outcome'] = null;
    let guard = 0;
    let lastPvpView: BattleTurnView | null = null;
    while (outcome === null && guard < 200) {
      guard += 1;
      const view = await service.battleTurn(
        userId,
        before.id,
        'numemon',
        'attack',
        state ?? undefined,
        undefined,
        DEFAULT_RNG,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      );
      outcome = view.outcome;
      state = view.state;
      lastPvpView = view;
    }
    expect(outcome).toBe('loss');

    // TASK-269: the PvP loss reward carries NEITHER report field (skipEconomicReward gates the
    // whole penalty branch out → the additive-optional fields are never populated there).
    expect(lastPvpView!.reward.xpLost).toBeUndefined();
    expect(lastPvpView!.reward.inventoryWiped).toBeUndefined();

    // PvP loss is PvE-gated OFF: xp UNCHANGED, inventory UNTOUCHED, NO penalty audit rows.
    const after = agumonOf(await getRoster(token));
    expect(after.xp).toBe(seededXp);
    expect(after.level).toBe(before.level);
    const heal = await prisma.inventoryItem.findUnique({
      where: { userId_itemId: { userId, itemId: 'heal-chip-1' } },
    });
    expect(heal!.quantity).toBe(4);
    const penaltyAudits = await prisma.auditLog.findMany({
      where: { userId, action: { in: ['battle-loss', 'battle-loss-wipe'] } },
    });
    expect(penaltyAudits).toHaveLength(0);
  });

  // TASK-277 (R-31e — PvP-loss XP penalty, challenger only, XP-only, no wipe): the PvP caller
  // now passes the trailing `pvpLossXpPenalty = true` ALONGSIDE `skipEconomicReward = true`. A
  // challenger who LOSES a duel takes the SAME level-scaled+capped xp-only penalty a PvE loss
  // applies (`lossPenaltyFor(level)`) + a `battle-loss` audit row — but their INVENTORY IS
  // UNTOUCHED (NO `battle-loss-wipe` rows). Drive the SAME losing line but with BOTH flags.
  it('a PvP interactive LOSS with pvpLossXpPenalty=true drops xp + writes a battle-loss row but does NOT wipe inventory (TASK-277)', async () => {
    const token = await registerAndLogin('interactive-pvp-loss-xp-penalty@example.test');
    const before = agumonOf(await getRoster(token));
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = row.userId;

    const expectedPenalty = lossPenaltyFor(before.level);
    const seededXp = expectedPenalty + 50;
    await prisma.digimon.update({ where: { id: before.id }, data: { xp: seededXp } });
    // Two owned stacks: if the wipe LEAKED into the PvP path they would vanish — assert they DON'T.
    await prisma.inventoryItem.create({ data: { userId, itemId: 'heal-chip-1', quantity: 4 } });
    await prisma.inventoryItem.create({ data: { userId, itemId: 'meat-storage-1', quantity: 1 } });

    const service = app.get(DigimonService);
    // Drive to a loss via the SERVICE with skipEconomicReward=true AND pvpLossXpPenalty=true (the
    // PvP caller's flags). battleTurn signature (trailing): (…, foe?, skipEconomicReward?,
    //  memberSlot?, enemyIds?, targetEnemyIndex?, foeGroup?, pvpLossXpPenalty?).
    let state: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let outcome: BattleTurnView['outcome'] = null;
    let guard = 0;
    let lastView: BattleTurnView | null = null;
    while (outcome === null && guard < 200) {
      guard += 1;
      const view = await service.battleTurn(
        userId,
        before.id,
        'numemon',
        'attack',
        state ?? undefined,
        undefined,
        DEFAULT_RNG,
        undefined, // difficulty
        undefined, // enemyScale
        undefined, // biome
        undefined, // foe
        true, // skipEconomicReward (PvP)
        undefined, // memberSlot
        undefined, // enemyIds
        undefined, // targetEnemyIndex
        undefined, // foeGroup
        true, // pvpLossXpPenalty (TASK-277 — challenger XP-only penalty)
      );
      outcome = view.outcome;
      state = view.state;
      lastView = view;
    }
    expect(outcome).toBe('loss');

    // The xp penalty applied + is REPORTED on the wire (the shared defeat-notice field);
    // `inventoryWiped` is FALSE (no stack destroyed — the wipe stays PvE-only).
    const expectedXp = Math.max(0, seededXp - expectedPenalty);
    expect(lastView!.reward.xpLost).toBe(expectedPenalty);
    expect(lastView!.reward.xpLost).toBe(seededXp - expectedXp);
    expect(lastView!.reward.inventoryWiped).toBe(false);
    expect(lastView!.digimon.xp).toBe(expectedXp);
    expect(lastView!.digimon.level).toBe(before.level); // never de-leveled (A-42)

    // The xp drop PERSISTED (a fresh GET shows the lower xp, level unchanged).
    const after = agumonOf(await getRoster(token));
    expect(after.xp).toBe(expectedXp);
    expect(after.level).toBe(before.level);

    // Exactly ONE battle-loss audit row (before→after xp, resource null — no balance moved).
    const lossAudit = await prisma.auditLog.findMany({ where: { userId, action: 'battle-loss' } });
    expect(lossAudit).toHaveLength(1);
    expect(lossAudit[0].entity).toBe('Digimon');
    expect(lossAudit[0].entityId).toBe(before.id);
    expect(lossAudit[0].resource).toBeNull();
    expect(lossAudit[0].amountBefore).toBe(seededXp);
    expect(lossAudit[0].amountAfter).toBe(expectedXp);

    // INVENTORY UNTOUCHED: NO battle-loss-wipe rows + both stacks intact at full quantity.
    const wipeRows = await prisma.auditLog.findMany({
      where: { userId, action: 'battle-loss-wipe' },
    });
    expect(wipeRows).toHaveLength(0);
    const heal = await prisma.inventoryItem.findUnique({
      where: { userId_itemId: { userId, itemId: 'heal-chip-1' } },
    });
    const meat = await prisma.inventoryItem.findUnique({
      where: { userId_itemId: { userId, itemId: 'meat-storage-1' } },
    });
    expect(heal!.quantity).toBe(4);
    expect(meat!.quantity).toBe(1);
  });

  // TASK-269 (R-31e fourth slice): a PvE interactive loss by a player with an EMPTY inventory
  // still drops xp (so `xpLost > 0`) but reports `inventoryWiped === false` — the wipe was a
  // NO-OP (no owned stacks to zero). Proves the flag reflects whether anything was actually wiped.
  it('an INTERACTIVE LOSS with an EMPTY inventory reports inventoryWiped === false (TASK-269)', async () => {
    const token = await registerAndLogin('interactive-loss-empty-inv@example.test');
    const before = agumonOf(await getRoster(token));
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = row.userId;

    const expectedPenalty = lossPenaltyFor(before.level);
    const seededXp = expectedPenalty + 50;
    await prisma.digimon.update({ where: { id: before.id }, data: { xp: seededXp } });
    // NO inventory stacks seeded — the pack is empty.

    let state: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let outcome: BattleTurnView['outcome'] = null;
    let guard = 0;
    let lastView: BattleTurnView | null = null;
    while (outcome === null && guard < 200) {
      guard += 1;
      const view = await turnViaService(userId, before.id, {
        enemyId: 'numemon',
        skillId: 'attack',
        state: state ?? undefined,
      });
      outcome = view.outcome;
      state = view.state;
      lastView = view;
    }
    expect(outcome).toBe('loss');
    // XP still dropped (report present), but nothing was wiped from an empty pack.
    expect(lastView!.reward.xpLost).toBe(expectedPenalty);
    expect(lastView!.reward.inventoryWiped).toBe(false);
    // No battle-loss-wipe rows for an empty pack (the wipe loop is a NO-OP).
    const wipeRows = await prisma.auditLog.findMany({
      where: { userId, action: 'battle-loss-wipe' },
    });
    expect(wipeRows).toHaveLength(0);
  });

  // TASK-174 (R-22 slice 35): BIOME-DERIVED LOOT RESOURCE — a win's loot KIND now depends on the
  // encounter's biome (the first biome → economy-kind cross-system link). Driving the interactive
  // turn route to a WILD win with a distinctive-biome hand-off credits `lootResourceForBiome(biome)`
  // (NOT the flat `BATTLE_LOOT_RESOURCE`) into THAT resource's `ResourceBalance` row, with a matching
  // `battle_loot` audit row; a win with NO biome (back-compat) credits `BATTLE_LOOT_RESOURCE` exactly
  // (proven by the sibling slice-34 test above). Reuses the penultimate-then-finish harness — the
  // finishing turn carries the biome, so the win seam maps it to the biome-keyed resource.
  it('a WIN with a distinctive biome credits lootResourceForBiome(biome) into that resource row (not the flat default) + one matching audit row', async () => {
    const token = await registerAndLogin('battle-loot-biome@example.test');
    const before = agumonOf(await getRoster(token));
    const prisma = app.get(PrismaService);
    const winnerRow = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = winnerRow.userId;

    // A distinctive biome whose loot resource differs from the shipped default (mountain → EmberShard).
    const biome = 'mountain';
    const biomeResource = lootResourceForBiome(biome);
    expect(biomeResource).not.toBe(BATTLE_LOOT_RESOURCE);

    // Drive the unscaled fight to the penultimate (one-blow-from-won) state, holding the prev state.
    const numemon = findEnemy('numemon')!;
    const seed = deserializeFightState({
      player: { hp: before.hp, energy: energyAtTurnStart(MAX_ENERGY), statuses: [], inflicted: [] },
      enemy: { hp: numemon.hp, energy: MAX_ENERGY, statuses: [], inflicted: [] },
      round: 1,
      decided: null,
    });
    let state: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let prevState: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let outcome: BattleTurnView['outcome'] = null;
    let nextSkill = chooseSkill(seed.player, seed.enemy).id;
    let guard = 0;
    while (outcome === null && guard < 200) {
      guard += 1;
      prevState = state;
      // TASK-177: drive deterministically via the service (DEFAULT_RNG) — the HTTP boundary
      // now feeds LIVE_RNG so a full-fight outcome over HTTP would flake (L-55/L-56).
      const view = await turnViaService(userId, before.id, {
        enemyId: 'numemon',
        skillId: nextSkill,
        state: state ?? undefined,
      });
      outcome = view.outcome;
      state = view.state;
      if (view.state !== null) {
        const live = deserializeFightState(view.state as SerializedFightState);
        live.player.energy = energyAtTurnStart(live.player.energy);
        nextSkill = chooseSkill(live.player, live.enemy).id;
      }
    }
    expect(outcome).toBe('win');
    expect(prevState).not.toBeNull();
    // The drive's own (no-biome) win already credited the flat default row (the slice-34 path).
    const defaultBalFromDrive = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource: BATTLE_LOOT_RESOURCE } },
    });
    expect(defaultBalFromDrive?.amount).toBe(battleLootAmount(1));

    // Re-finish from the penultimate state, carrying the biome on the request — the SECOND win
    // credits the BIOME-KEYED resource (a DISTINCT row), not the flat default.
    const prevLive = deserializeFightState(prevState as SerializedFightState);
    prevLive.player.energy = energyAtTurnStart(prevLive.player.energy);
    const finishSkill = chooseSkill(prevLive.player, prevLive.enemy).id;
    const finishView = await turnViaService(userId, before.id, {
      enemyId: 'numemon',
      skillId: finishSkill,
      state: prevState as SerializedFightState,
      biome,
    });
    expect(finishView.outcome).toBe('win');
    // The win's loot resource is the BIOME-KEYED one (not the flat default).
    expect(finishView.reward.loot).toBeDefined();
    expect(finishView.reward.loot!.resource).toBe(biomeResource);
    expect(finishView.reward.loot!.amount).toBe(battleLootAmount(1));
    // TASK-175 (R-22 slice 36): the win's loot carries the DISPLAY-ONLY biome-derived rarity TIER
    // (mountain → 'Rare', NOT 'Common'); the resource + amount are byte-unchanged (rarity additive).
    expect(finishView.reward.loot!.rarity).toBe(lootRarityForBiome(biome));
    expect(finishView.reward.loot!.rarity).toBe('Rare');
    // The biome resource lands in its OWN row (a distinct KIND); the flat default row is unchanged
    // by the biome win (still the single drive credit) — the resource KIND is what varies.
    const biomeBal = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource: biomeResource } },
    });
    expect(biomeBal?.amount).toBe(battleLootAmount(1));
    const defaultBal = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource: BATTLE_LOOT_RESOURCE } },
    });
    expect(defaultBal?.amount).toBe(battleLootAmount(1));
    // Two battle_loot audit rows total: the drive's flat default + the biome-keyed one.
    const allAudits = await prisma.auditLog.findMany({
      where: { userId, action: 'battle_loot' },
      orderBy: { createdAt: 'asc' },
    });
    expect(allAudits).toHaveLength(2);
    const biomeAudit = allAudits.find((a) => a.resource === biomeResource);
    expect(biomeAudit).toBeDefined();
    expect(biomeAudit!.amountBefore).toBe(0);
    expect(biomeAudit!.amountAfter).toBe(battleLootAmount(1));
  });

  // TASK-176 (R-22 slice 37): ROLLED LOOT RARITY — the win's rarity tier is now DRAWN around
  // its biome baseline through the injected-RNG seam `battleTurn` already carries. On the
  // DEFAULT/HTTP path (`DEFAULT_RNG === () => 0`) the roll returns EXACTLY the biome baseline
  // (byte-identical to slice 36 — the back-compat anchor); with an injected HIGH stub rng the
  // roll upgrades to a STRICTLY-rarer tier than the biome baseline, while the credited resource,
  // amount, ResourceBalance row, and battle_loot audit row stay byte-unchanged (rarity is
  // display-only — invariant 3 shape untouched). The HTTP boundary always passes DEFAULT_RNG
  // (L-55/L-56 test-injection footgun), so the rolled-up case is driven by calling the
  // DigimonService.battleTurn method DIRECTLY with the injected stub rng.
  it('a WIN rolls its rarity tier: DEFAULT_RNG keeps the biome baseline; an injected high rng upgrades it (resource/amount/audit unchanged)', async () => {
    const token = await registerAndLogin('battle-loot-rarity-roll@example.test');
    const before = agumonOf(await getRoster(token));
    const prisma = app.get(PrismaService);
    const winnerRow = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = winnerRow.userId;
    const service = app.get(DigimonService);

    // A forest encounter: its deterministic biome baseline tier is 'Common' (the bottom of the
    // ladder), so an upgrade roll lands on a strictly-rarer tier ('Uncommon') — an unmistakable
    // difference from the baseline.
    const biome = 'forest';
    const baseRarity = lootRarityForBiome(biome);
    expect(baseRarity).toBe('Common');

    // Drive an unscaled fight to the penultimate (one-blow-from-won) state, holding the prev state.
    const numemon = findEnemy('numemon')!;
    const seed = deserializeFightState({
      player: { hp: before.hp, energy: energyAtTurnStart(MAX_ENERGY), statuses: [], inflicted: [] },
      enemy: { hp: numemon.hp, energy: MAX_ENERGY, statuses: [], inflicted: [] },
      round: 1,
      decided: null,
    });
    void seed;
    let state: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let prevState: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let outcome: BattleTurnView['outcome'] = null;
    let guard = 0;
    while (outcome === null && guard < 200) {
      guard += 1;
      prevState = state;
      const live =
        state === null || state === undefined
          ? deserializeFightState({
              player: {
                hp: before.hp,
                energy: energyAtTurnStart(MAX_ENERGY),
                statuses: [],
                inflicted: [],
              },
              enemy: { hp: numemon.hp, energy: MAX_ENERGY, statuses: [], inflicted: [] },
              round: 1,
              decided: null,
            })
          : deserializeFightState(state as SerializedFightState);
      const nextSkill = chooseSkill(live.player, live.enemy).id;
      const view = await service.battleTurn(
        userId,
        before.id,
        'numemon',
        nextSkill,
        state ?? undefined,
      );
      outcome = view.outcome;
      state = view.state;
    }
    expect(outcome).toBe('win');
    expect(prevState).not.toBeNull();

    // (1) DEFAULT_RNG path (no rng arg): re-finish from the penultimate state carrying the biome —
    // the rolled tier is EXACTLY the biome baseline (byte-identical to slice 36).
    const prevLive = deserializeFightState(prevState as SerializedFightState);
    prevLive.player.energy = energyAtTurnStart(prevLive.player.energy);
    const finishSkill = chooseSkill(prevLive.player, prevLive.enemy).id;
    const defaultView = await service.battleTurn(
      userId,
      before.id,
      'numemon',
      finishSkill,
      prevState as SerializedFightState,
      undefined,
      undefined,
      undefined,
      undefined,
      biome,
    );
    expect(defaultView.outcome).toBe('win');
    expect(defaultView.reward.loot).toBeDefined();
    expect(defaultView.reward.loot!.rarity).toBe(baseRarity); // 'Common' — the biome baseline
    const defaultLootResource = defaultView.reward.loot!.resource;
    const defaultLootAmount = defaultView.reward.loot!.amount;

    // (2) INJECTED HIGH rng path: re-finish the SAME penultimate state with a high stub rng — the
    // roll upgrades the tier to a strictly-rarer one, while resource + amount stay byte-unchanged.
    const rolledView = await service.battleTurn(
      userId,
      before.id,
      'numemon',
      finishSkill,
      prevState as SerializedFightState,
      undefined,
      () => 0.99, // a HIGH roll → upgrade fires (rng() >= 1 − RARITY_UPGRADE_CHANCE)
      undefined,
      undefined,
      biome,
    );
    expect(rolledView.outcome).toBe('win');
    expect(rolledView.reward.loot).toBeDefined();
    // The rolled tier DIFFERS from the biome baseline — a genuinely-varying drop.
    expect(rolledView.reward.loot!.rarity).not.toBe(baseRarity);
    expect(rolledView.reward.loot!.rarity).toBe('Uncommon'); // Common upgraded one rung
    // …and the AMOUNT is byte-unchanged (rarity is display-only, invariant 3 credit SHAPE intact).
    expect(rolledView.reward.loot!.amount).toBe(defaultLootAmount);
    // TASK-178 (R-22 slice 39): the loot RESOURCE is now ALSO drawn from the biome table through
    // the SAME injected rng, so a high stub rng draws forest's SECONDARY resource ('Herb') rather
    // than the DEFAULT_RNG primary ('DigiCredits'). The two draws sharing one rng is the L-58
    // multi-draw shape (rarity + resource both read `rng`); assert the resource against the
    // biome table's own high-roll draw so the co-evolution is explicit, not a silent drift.
    expect(rolledView.reward.loot!.resource).toBe(rollLootResource(biome, () => 0.99));
    expect(rolledView.reward.loot!.resource).not.toBe(defaultLootResource);
  });

  // TASK-178 (R-22 slice 39): WEIGHTED PER-DROP LOOT RESOURCE — the win's loot RESOURCE (its
  // KIND) is now DRAWN from a biome-anchored weighted table through the injected-RNG seam
  // `battleTurn` already carries. On the DEFAULT_RNG path (`() => 0`) the draw returns EXACTLY
  // the biome's PRIMARY resource (= lootResourceForBiome(biome), byte-identical to slice 35 —
  // the invariant-5 anchor), and it is credited + audited into THAT resource's ResourceBalance
  // row. With an injected HIGH stub rng the draw reaches a SECONDARY table entry — a DIFFERENT
  // resource string — which is then credited + audited into ITS OWN row. The HTTP boundary
  // always passes DEFAULT_RNG (L-55/L-56 test-injection footgun), so the varying-KIND case is
  // driven by calling DigimonService.battleTurn DIRECTLY with the injected stub rng (NOT over
  // the now-LIVE_RNG HTTP path, which would flake).
  it('a WIN draws its loot resource from the biome table: DEFAULT_RNG credits the primary; an injected high rng credits+audits a SECONDARY resource', async () => {
    const token = await registerAndLogin('battle-loot-resource-roll@example.test');
    const before = agumonOf(await getRoster(token));
    const prisma = app.get(PrismaService);
    const winnerRow = await prisma.digimon.findFirstOrThrow({ where: { id: before.id } });
    const userId = winnerRow.userId;
    const service = app.get(DigimonService);

    // A distinctive multi-entry biome: mountain's primary is EmberShard; a high roll reaches a
    // NON-primary secondary. rollLootResource(mountain, ()=>0) === lootResourceForBiome(mountain).
    const biome = 'mountain';
    const primaryResource = lootResourceForBiome(biome);
    const secondaryResource = rollLootResource(biome, () => 0.999999);
    expect(secondaryResource).not.toBe(primaryResource);

    // Drive an unscaled fight to the penultimate (one-blow-from-won) state, holding the prev state.
    const numemon = findEnemy('numemon')!;
    let state: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let prevState: BattleTurnView['state'] = undefined as BattleTurnView['state'];
    let outcome: BattleTurnView['outcome'] = null;
    let guard = 0;
    while (outcome === null && guard < 200) {
      guard += 1;
      prevState = state;
      const live =
        state === null || state === undefined
          ? deserializeFightState({
              player: {
                hp: before.hp,
                energy: energyAtTurnStart(MAX_ENERGY),
                statuses: [],
                inflicted: [],
              },
              enemy: { hp: numemon.hp, energy: MAX_ENERGY, statuses: [], inflicted: [] },
              round: 1,
              decided: null,
            })
          : deserializeFightState(state as SerializedFightState);
      const nextSkill = chooseSkill(live.player, live.enemy).id;
      const view = await service.battleTurn(
        userId,
        before.id,
        'numemon',
        nextSkill,
        state ?? undefined,
      );
      outcome = view.outcome;
      state = view.state;
    }
    expect(outcome).toBe('win');
    expect(prevState).not.toBeNull();

    const prevLive = deserializeFightState(prevState as SerializedFightState);
    prevLive.player.energy = energyAtTurnStart(prevLive.player.energy);
    const finishSkill = chooseSkill(prevLive.player, prevLive.enemy).id;

    // (1) DEFAULT_RNG path (no rng arg): the drawn resource is the biome PRIMARY, verbatim.
    const defaultView = await service.battleTurn(
      userId,
      before.id,
      'numemon',
      finishSkill,
      prevState as SerializedFightState,
      undefined,
      undefined, // rng → DEFAULT_RNG → draws the primary
      undefined,
      undefined,
      biome,
    );
    expect(defaultView.outcome).toBe('win');
    expect(defaultView.reward.loot).toBeDefined();
    expect(defaultView.reward.loot!.resource).toBe(primaryResource);
    const primaryBal = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource: primaryResource } },
    });
    expect(primaryBal?.amount).toBe(battleLootAmount(1));

    // (2) INJECTED HIGH rng path: re-finish the SAME penultimate state with a high stub rng — the
    // weighted draw reaches a SECONDARY resource, credited + audited into ITS OWN distinct row.
    const rolledView = await service.battleTurn(
      userId,
      before.id,
      'numemon',
      finishSkill,
      prevState as SerializedFightState,
      undefined,
      () => 0.999999, // a HIGH roll → the draw reaches a non-primary bucket
      undefined,
      undefined,
      biome,
    );
    expect(rolledView.outcome).toBe('win');
    expect(rolledView.reward.loot).toBeDefined();
    // The drawn KIND DIFFERS from the primary — a genuinely-varying drop.
    expect(rolledView.reward.loot!.resource).toBe(secondaryResource);
    expect(rolledView.reward.loot!.resource).not.toBe(primaryResource);
    // …the amount is unchanged (the KIND varies, not the size — invariant 3 credit SHAPE intact).
    expect(rolledView.reward.loot!.amount).toBe(battleLootAmount(1));
    // The secondary resource lands in its OWN ResourceBalance row + a matching battle_loot audit.
    const secondaryBal = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource: secondaryResource } },
    });
    expect(secondaryBal?.amount).toBe(battleLootAmount(1));
    const secondaryAudit = await prisma.auditLog.findFirst({
      where: { userId, action: 'battle_loot', resource: secondaryResource },
    });
    expect(secondaryAudit).toBeDefined();
    expect(secondaryAudit!.amountBefore).toBe(0);
    expect(secondaryAudit!.amountAfter).toBe(battleLootAmount(1));
  });

  // TASK-180 (R-23a slice 41): the OPPONENT-COMBATANT foe seam. `battleTurn` gains a trailing
  // OPTIONAL `foe?: Enemy` that SUPERSEDES the `findEnemy(enemyId)` roster lookup when supplied,
  // so the shared interactive turn engine can be driven against an arbitrary player-derived
  // `Combatant` (the PvP substrate R-23a's re-route rides on). Driven DIRECTLY through the service
  // with a deterministic `DEFAULT_RNG` (L-55/L-56 — never over the now-`LIVE_RNG` HTTP path). The
  // param is last, so we pass through the intervening optionals (rng/difficulty/enemyScale/biome)
  // explicitly to reach it.
  it('foe OMITTED → resolves against the roster enemy byte-identically (invariant-5 identity proof)', async () => {
    const token = await registerAndLogin('foe-omitted-turn@example.test');
    const before = agumonOf(await getRoster(token));
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const userId = (await prisma.digimon.findFirstOrThrow({ where: { id: before.id } })).userId;

    // The additive seam is INVISIBLE when unused: opening a fight with NO `foe` still surfaces the
    // static wild-roster species keyed by `enemyId` (numemon), exactly as before this slice.
    const view = await service.battleTurn(userId, before.id, 'numemon', undefined, undefined);
    expect(view.enemy).toEqual({ id: 'numemon', name: 'Numemon' });
    expect(view.outcome).toBeNull();
  });

  it('foe INJECTED → the shared engine resolves a turn against the arbitrary opponent Combatant', async () => {
    const token = await registerAndLogin('foe-injected-turn@example.test');
    const before = agumonOf(await getRoster(token));
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const userId = (await prisma.digimon.findFirstOrThrow({ where: { id: before.id } })).userId;

    // A DISTINCTIVE opponent stat block unlike any ENEMY_ROSTER row — exactly what a PvP
    // opponent-player `Combatant` maps to (`Enemy = Combatant & { id: string }`).
    const foe: Enemy = {
      id: 'rival-player-digimon',
      name: 'RivalGreymon',
      type: 'Vaccine',
      element: 'Fire',
      hp: 88,
      maxHp: 88,
      atk: 33,
      def: 22,
      spd: 19,
    };

    // The `enemyId` is deliberately GARBAGE: with a `foe` supplied the override SUPERSEDES the
    // roster lookup, so it still resolves (proof (c)) — and the view reflects the INJECTED foe's
    // identity, NOT a roster species.
    const view = await service.battleTurn(
      userId,
      before.id,
      'no-such-roster-id',
      undefined,
      undefined,
      undefined,
      DEFAULT_RNG,
      undefined,
      undefined,
      undefined,
      foe,
    );
    expect(view.enemy).toEqual({ id: 'rival-player-digimon', name: 'RivalGreymon' });
    // The engine seeded the fight from the injected foe's stat block: its carried HP is the foe's.
    expect(view.state!.enemy.hp).toBe(foe.hp);
    expect(view.outcome).toBeNull();
  });

  it('no foe + unknown enemyId → still 422 (the roster path is unchanged)', async () => {
    const token = await registerAndLogin('foe-absent-unknown-turn@example.test');
    const before = agumonOf(await getRoster(token));
    const service = app.get(DigimonService);
    const prisma = app.get(PrismaService);
    const userId = (await prisma.digimon.findFirstOrThrow({ where: { id: before.id } })).userId;

    await expect(
      service.battleTurn(userId, before.id, 'no-such-roster-id', undefined, undefined),
    ).rejects.toMatchObject({ status: 422 });
  });

  // TASK-185 (R-24 slice 45a): the SERVER-AUTHORITATIVE TURN-TIMEOUT RESOLVE SEAM. A per-action
  // `action:'timeout'` (no `skillId`) must resolve the player's turn with the engine's OWN default
  // pick — `chooseSkill(state.player, state.enemy)` — so an inactive player whose clock expires can
  // never HANG the fight, and the client cannot cheat WHICH skill fires (the server decides). Driven
  // through the SERVICE with DEFAULT_RNG (byte-reproducible, real app + DB) per L-55/L-56 non-flaky
  // discipline (the HTTP boundary is LIVE_RNG and would flake an outcome assert).
  it('TIMEOUT (TASK-185): action=timeout with NO skillId does NOT 422, advances the fight, and casts chooseSkill(state.player, state.enemy)', async () => {
    const token = await registerAndLogin('turn-timeout@example.test');
    const agumon = agumonOf(await getRoster(token));
    const userId = (
      await app.get(PrismaService).digimon.findFirstOrThrow({ where: { id: agumon.id } })
    ).userId;

    // Open a fresh fight (the START-PREVIEW, empty entries) to obtain a real carried mid-fight state.
    const preview = await turnViaService(userId, agumon.id, { enemyId: 'numemon' });
    expect(preview.entries).toEqual([]);
    expect(preview.outcome).toBeNull();
    const carried = preview.state as SerializedFightState;

    // Compute the deterministic default the ENGINE would pick for THIS state, in a parallel pure call
    // (the exact same server-authoritative default the timeout seam reuses).
    const rebuilt = deserializeFightState(carried);
    const expectedDefault = chooseSkill(rebuilt.player, rebuilt.enemy);

    // Post the timeout turn: no skillId, action:'timeout'.
    const view = await turnViaService(userId, agumon.id, {
      enemyId: 'numemon',
      state: carried,
      action: 'timeout',
    });

    // (a) It did NOT 422 (we got a view), (b) it ADVANCED the fight — a real turn, NOT the empty
    // START-PREVIEW shape: the player's own turn log carries the cast skill.
    expect(view.entries.length).toBeGreaterThan(0);
    const playerEntry = view.entries.find((e) => e.actor === 'player');
    expect(playerEntry).toBeDefined();
    // (c) The cast skill equals the engine's deterministic default for that state — the server picked
    // it; the player supplied no skillId and could not influence the choice (invariant 1). The turn
    // log records the skill's NAME (TurnLogEntry.skill), so compare against the default's name.
    expect(playerEntry?.skill).toBe(expectedDefault.name);
  });

  it('TIMEOUT (TASK-185): a control-LOCKED timeout is byte-identical to a locked pass (forced skip, no 422)', async () => {
    const token = await registerAndLogin('turn-timeout-locked@example.test');
    const agumon = agumonOf(await getRoster(token));
    const userId = (
      await app.get(PrismaService).digimon.findFirstOrThrow({ where: { id: agumon.id } })
    ).userId;

    // Obtain a real carried state, then seed a control-lock (stun) on the PLAYER so the turn is a
    // forced skip — both 'pass' and 'timeout' must resolve it identically (the forced free `attack`).
    const preview = await turnViaService(userId, agumon.id, { enemyId: 'numemon' });
    const base = preview.state as SerializedFightState;
    const locked: SerializedFightState = {
      ...base,
      player: { ...base.player, statuses: [{ kind: 'stun', turnsRemaining: 2 }] },
    };

    const viaPass = await turnViaService(userId, agumon.id, {
      enemyId: 'numemon',
      state: structuredClone(locked),
      action: 'pass',
    });
    const viaTimeout = await turnViaService(userId, agumon.id, {
      enemyId: 'numemon',
      state: structuredClone(locked),
      action: 'timeout',
    });

    // Byte-identical resolution (the deterministic DEFAULT_RNG path): a locked timeout IS a locked pass.
    expect(viaTimeout.entries).toEqual(viaPass.entries);
    expect(viaTimeout.outcome).toEqual(viaPass.outcome);
    expect(viaTimeout.state).toEqual(viaPass.state);
  });

  // TASK-271 (R-44 slice — team battle): the interactive turn view SURFACES the authed user's
  // ordered party. A user who set a ≤3 party sees all their members on the wire; a user with NO
  // party fights 1v1 exactly as before (partyMembers OMITTED — the byte-identical fallback).
  describe('team battle — the interactive turn surfaces the player party (TASK-271)', () => {
    const postParty = (id: string, slot: number | null, token: string) =>
      fetch(`${baseUrl}/digimon/${id}/party`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ slot }),
      });

    it('a user who SET a ≤3 party gets an ordered partyMembers list on the turn view', async () => {
      const token = await registerAndLogin('party-battle@example.test');
      const agumon = agumonOf(await getRoster(token));
      const owner = await app
        .get(PrismaService)
        .digimon.findFirstOrThrow({ where: { id: agumon.id } });
      // Seed a SECOND owned Digimon so the party has two members.
      const gabumon = await app.get(PrismaService).digimon.create({
        data: {
          userId: owner.userId,
          name: 'Gabumon',
          type: 'Data',
          element: 'Water',
          stage: 'Rookie',
          hp: 50,
          atk: 12,
          def: 11,
          spd: 9,
          level: 1,
        },
      });
      // Set an ordered party: Agumon in slot 1 (front), Gabumon in slot 2.
      expect((await postParty(agumon.id, 1, token)).status).toBe(200);
      expect((await postParty(gabumon.id, 2, token)).status).toBe(200);

      // Drive the interactive turn (a start preview is enough to carry the party on the wire).
      const view = await turnViaService(owner.userId, agumon.id, { enemyId: 'numemon' });
      expect(view.partyMembers).toBeDefined();
      expect(view.partyMembers).toEqual([
        { id: agumon.id, name: 'Agumon' },
        { id: gabumon.id, name: 'Gabumon' },
      ]);
      // The FRONT member is the same Digimon carried on `digimon` (the identity anchor).
      expect(view.partyMembers![0].id).toBe(view.digimon.id);
    });

    it('a user with NO party fights 1v1 — partyMembers is OMITTED (the byte-identical fallback)', async () => {
      const token = await registerAndLogin('no-party-battle@example.test');
      const agumon = agumonOf(await getRoster(token));
      const owner = await app
        .get(PrismaService)
        .digimon.findFirstOrThrow({ where: { id: agumon.id } });
      const view = await turnViaService(owner.userId, agumon.id, { enemyId: 'numemon' });
      // No party set → the field is entirely absent (additive/back-compat 1v1 fallback).
      expect(view.partyMembers).toBeUndefined();
    });
  });

  // TASK-273 (R-44a — multi-enemy encounter groups): the interactive turn fields a wild PACK when
  // `enemyIds` carries >1 species, surfacing `enemyMembers` + carrying `state.enemies`; a single foe
  // is today's 1v1 (enemyMembers/state.enemies OMITTED — the byte-identical fallback), and a bad pick
  // leaves the fight unchanged.
  describe('multi-enemy encounter groups — the enemy side is a list (TASK-273)', () => {
    it('a group of 2 enemyIds surfaces enemyMembers + state.enemies (the front enemy is `enemy`)', async () => {
      const token = await registerAndLogin('group-battle@example.test');
      const agumon = agumonOf(await getRoster(token));
      const owner = await app
        .get(PrismaService)
        .digimon.findFirstOrThrow({ where: { id: agumon.id } });
      const view = await turnViaService(owner.userId, agumon.id, {
        enemyId: 'numemon',
        enemyIds: ['numemon', 'kuwagamon'],
      });
      // The pack surfaces on the wire (front = numemon, coordinate-equal to the scalar `enemy`).
      expect(view.enemyMembers).toBeDefined();
      expect(view.enemyMembers).toEqual([
        { id: 'numemon', name: 'Numemon' },
        { id: 'kuwagamon', name: 'Kuwagamon' },
      ]);
      expect(view.enemyMembers![0].id).toBe(view.enemy.id);
      // The carried snapshot holds a per-enemy SideState list (>1) so the next turn resumes the pack.
      expect(view.state).not.toBeNull();
      expect(view.state!.enemies).toBeDefined();
      expect(view.state!.enemies).toHaveLength(2);
    });

    it('a single enemy fights 1v1 — enemyMembers + state.enemies are OMITTED (the byte-identical fallback)', async () => {
      const token = await registerAndLogin('single-enemy-battle@example.test');
      const agumon = agumonOf(await getRoster(token));
      const owner = await app
        .get(PrismaService)
        .digimon.findFirstOrThrow({ where: { id: agumon.id } });
      // No enemyIds (or a length-1 group) → the single-enemy identity path.
      const view = await turnViaService(owner.userId, agumon.id, {
        enemyId: 'numemon',
        enemyIds: ['numemon'],
      });
      expect(view.enemyMembers).toBeUndefined();
      expect(view.state).not.toBeNull();
      expect(view.state!.enemies).toBeUndefined();
    });

    it('a driven pack advances per enemy and resolves when one side is wiped', async () => {
      const token = await registerAndLogin('drive-group-battle@example.test');
      const agumon = agumonOf(await getRoster(token));
      const owner = await app
        .get(PrismaService)
        .digimon.findFirstOrThrow({ where: { id: agumon.id } });
      let view = await turnViaService(owner.userId, agumon.id, {
        enemyId: 'numemon',
        enemyIds: ['numemon', 'kuwagamon'],
      });
      // Drive turns until the fight resolves (bounded — the round cap guarantees termination).
      let guard = 0;
      while (view.outcome === null && guard < 60) {
        view = await turnViaService(owner.userId, agumon.id, {
          enemyId: 'numemon',
          enemyIds: ['numemon', 'kuwagamon'],
          skillId: 'attack',
          state: view.state ?? undefined,
        });
        guard += 1;
      }
      expect(view.outcome).not.toBeNull();
      expect(['win', 'loss', 'fled']).toContain(view.outcome);
    });
  });

  // TASK-272 (R-44c — team-battle interactive DRIVE): the interactive turn now DRIVES each living
  // party member (not just the front). A multi-member party carries `state.players` and resolves a
  // team exchange; a bad/downed-member pick 422s with the fight unchanged; NO party is today's 1v1
  // (`state.players` OMITTED) fallback byte-for-byte.
  describe('team battle interactive DRIVE — each living member takes its own turn (TASK-272)', () => {
    const postPartyR44c = (id: string, slot: number | null, token: string) =>
      fetch(`${baseUrl}/digimon/${id}/party`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ slot }),
      });

    const seedTwoMemberParty = async (
      email: string,
    ): Promise<{ userId: string; agumonId: string; gabumonId: string }> => {
      const token = await registerAndLogin(email);
      const agumon = agumonOf(await getRoster(token));
      const owner = await app
        .get(PrismaService)
        .digimon.findFirstOrThrow({ where: { id: agumon.id } });
      const gabumon = await app.get(PrismaService).digimon.create({
        data: {
          userId: owner.userId,
          name: 'Gabumon',
          type: 'Data',
          element: 'Water',
          stage: 'Rookie',
          hp: 50,
          atk: 12,
          def: 11,
          spd: 9,
          level: 1,
        },
      });
      expect((await postPartyR44c(agumon.id, 1, token)).status).toBe(200);
      expect((await postPartyR44c(gabumon.id, 2, token)).status).toBe(200);
      return { userId: owner.userId, agumonId: agumon.id, gabumonId: gabumon.id };
    };

    it('a multi-member party drives a TEAM exchange — state.players present, all members carried', async () => {
      const { userId, agumonId } = await seedTwoMemberParty('r44c-drive@example.test');
      // Open the fight (start preview carries the seeded party FightState with state.players).
      const preview = await turnViaService(userId, agumonId, { enemyId: 'numemon' });
      expect(preview.state).not.toBeNull();
      expect(preview.state!.players).toBeDefined();
      expect(preview.state!.players).toHaveLength(2);
      // Drive the FRONT member's turn (default acting member) with an attack.
      const t1 = await turnViaService(userId, agumonId, {
        enemyId: 'numemon',
        skillId: 'attack',
        state: preview.state,
      });
      // A real exchange resolved: this turn's log has entries and the party is still carried.
      expect(t1.entries.length).toBeGreaterThan(0);
      if (t1.state !== null) {
        expect(t1.state.players).toBeDefined();
        expect(t1.state.players).toHaveLength(2);
      }
    });

    it('the SECOND living member can be driven by memberSlot=2', async () => {
      const { userId, agumonId } = await seedTwoMemberParty('r44c-member2@example.test');
      const preview = await turnViaService(userId, agumonId, { enemyId: 'numemon' });
      const t1 = await turnViaService(userId, agumonId, {
        enemyId: 'numemon',
        skillId: 'attack',
        state: preview.state,
        memberSlot: 2,
      });
      // Slot 2 acted → the enemy took damage (a member struck it) and the fight advanced.
      expect(t1.entries.length).toBeGreaterThan(0);
    });

    it('a bad party-member pick (out-of-range slot) → 422 with the fight UNCHANGED', async () => {
      const { userId, agumonId } = await seedTwoMemberParty('r44c-badmember@example.test');
      const preview = await turnViaService(userId, agumonId, { enemyId: 'numemon' });
      await expect(
        turnViaService(userId, agumonId, {
          enemyId: 'numemon',
          skillId: 'attack',
          state: preview.state,
          memberSlot: 9, // no such slot
        }),
      ).rejects.toThrow();
    });

    it('NO party → today 1v1 fallback (state.players OMITTED, byte-identical)', async () => {
      const token = await registerAndLogin('r44c-noparty@example.test');
      const agumon = agumonOf(await getRoster(token));
      const owner = await app
        .get(PrismaService)
        .digimon.findFirstOrThrow({ where: { id: agumon.id } });
      const view = await turnViaService(owner.userId, agumon.id, { enemyId: 'numemon' });
      expect(view.state).not.toBeNull();
      expect(view.state!.players).toBeUndefined();
      expect(view.partyMembers).toBeUndefined();
    });
  });

  // TASK-274 (R-44b first slice — per-member PICKED enemy target): with a GROUP fielded (R-44a), the
  // acting member's attack lands on the CHOSEN living enemy when `targetEnemyIndex` names one; a
  // bad/out-of-range/dead index 422s the fight UNCHANGED (mirroring the memberSlot guard); an OMITTED
  // index targets the front-living enemy as today (the invariant-5 identity path). We seed a FAST,
  // hard-hitting striker (spd/atk high) so it acts FIRST and lands a real damaging strike BEFORE the
  // enemy pack can freeze/stun it — isolating the player's target choice from the enemy reply/lock.
  describe('per-member picked enemy target — the player picks WHICH enemy the acting member hits (TASK-274)', () => {
    const seedStriker = async (email: string): Promise<{ userId: string; strikerId: string }> => {
      const token = await registerAndLogin(email);
      const agumon = agumonOf(await getRoster(token));
      const owner = await app
        .get(PrismaService)
        .digimon.findFirstOrThrow({ where: { id: agumon.id } });
      const striker = await app.get(PrismaService).digimon.create({
        data: {
          userId: owner.userId,
          name: 'Striker',
          type: 'Vaccine',
          element: 'Fire',
          stage: 'Rookie',
          hp: 300,
          atk: 200,
          def: 30,
          spd: 300, // far faster than any wild foe → acts first, never frozen before it strikes
          level: 1,
        },
      });
      return { userId: owner.userId, strikerId: striker.id };
    };

    it('a valid non-front targetEnemyIndex lands the acting member attack on the CHOSEN enemy', async () => {
      const { userId, strikerId } = await seedStriker('r44b-target@example.test');
      const preview = await turnViaService(userId, strikerId, {
        enemyId: 'numemon',
        enemyIds: ['numemon', 'kuwagamon'],
      });
      expect(preview.state!.enemies).toHaveLength(2);
      const frontHpBefore = preview.state!.enemies![0].hp;
      const backHpBefore = preview.state!.enemies![1].hp;
      // Drive a turn targeting the BACK enemy (index 1) with a real damaging skill.
      const t1 = await turnViaService(userId, strikerId, {
        enemyId: 'numemon',
        enemyIds: ['numemon', 'kuwagamon'],
        skillId: 'attack',
        state: preview.state ?? undefined,
        targetEnemyIndex: 1,
      });
      expect(t1.state!.enemies).toHaveLength(2);
      // The picked BACK enemy fell strictly further than any incidental front change (the striker's
      // strike landed on index 1, the load-bearing observable).
      const backDrop = backHpBefore - t1.state!.enemies![1].hp;
      const frontDrop = frontHpBefore - t1.state!.enemies![0].hp;
      expect(backDrop).toBeGreaterThan(frontDrop);
    });

    it('a bad targetEnemyIndex (out-of-range) → 422 with the fight UNCHANGED', async () => {
      const { userId, strikerId } = await seedStriker('r44b-badtarget@example.test');
      const preview = await turnViaService(userId, strikerId, {
        enemyId: 'numemon',
        enemyIds: ['numemon', 'kuwagamon'],
      });
      await expect(
        turnViaService(userId, strikerId, {
          enemyId: 'numemon',
          enemyIds: ['numemon', 'kuwagamon'],
          skillId: 'attack',
          state: preview.state ?? undefined,
          targetEnemyIndex: 5, // no such enemy
        }),
      ).rejects.toThrow();
    });

    it('an OMITTED targetEnemyIndex targets the front-living enemy as today (identity path)', async () => {
      const { userId, strikerId } = await seedStriker('r44b-notarget@example.test');
      const preview = await turnViaService(userId, strikerId, {
        enemyId: 'numemon',
        enemyIds: ['numemon', 'kuwagamon'],
      });
      const frontHpBefore = preview.state!.enemies![0].hp;
      const backHpBefore = preview.state!.enemies![1].hp;
      const t1 = await turnViaService(userId, strikerId, {
        enemyId: 'numemon',
        enemyIds: ['numemon', 'kuwagamon'],
        skillId: 'attack',
        state: preview.state ?? undefined,
        // targetEnemyIndex OMITTED → front-living fallback
      });
      // The FRONT enemy took the acting member's strike; the back one is untouched by the player.
      const frontDrop = frontHpBefore - t1.state!.enemies![0].hp;
      const backDrop = backHpBefore - t1.state!.enemies![1].hp;
      expect(frontDrop).toBeGreaterThan(backDrop);
    });
  });

  // TASK-312 (R-44b — live-opponent action seam): a SUPPLIED `enemyAction` drives the opponent's
  // champion turn with THAT skill instead of the engine AI `enemyChooser` pick — the load-bearing
  // FIRST slice toward a two-sided interactive PvP duel. These three cases exercise the seam DIRECTLY
  // on the service (the HTTP boundary forwards it via the PvP path, proven in the pvp e2e):
  //   (1) supplied legal skill → the enemy resolves THAT skill (distinguishable from the AI pick);
  //   (2) NO enemyAction on the SAME state → the AI pick resolves (the invariant-5 identity anchor);
  //   (3) an ILLEGAL/unknown enemyAction → 422 with the fight state UNCHANGED (never a silent AI
  //       fallback — invariant 2: the wire's *choice* is validated against the palette/energy rules).
  describe('TASK-312 — a supplied enemyAction drives the opponent turn instead of the AI', () => {
    /** Drive one turn via the service with the trailing `enemyAction` param (front-only trailing args). */
    const turnWithEnemyAction = (
      userId: string,
      id: string,
      body: { enemyId: string; skillId?: string; state?: BattleTurnView['state'] },
      enemyAction: { skillId: string } | undefined,
    ): Promise<BattleTurnView> =>
      app.get(DigimonService).battleTurn(
        userId,
        id,
        body.enemyId,
        body.skillId,
        body.state ?? undefined,
        undefined, // action
        DEFAULT_RNG,
        undefined, // difficulty (→ 'hard', the full banking chain — a NON-'attack' AI pick)
        undefined, // enemyScale
        undefined, // biome
        undefined, // foe
        false, // skipEconomicReward
        undefined, // memberSlot
        undefined, // enemyIds
        undefined, // targetEnemyIndex
        undefined, // foeGroup
        false, // pvpLossXpPenalty
        enemyAction, // TASK-312 — the injected opponent action
      );

    it('a SUPPLIED legal enemyAction resolves the enemy turn with THAT skill (superseding the AI pick)', async () => {
      const token = await registerAndLogin('t312-supplied@example.test');
      const patamon = (await getRoster(token)).find((d) => d.name === 'Patamon')!;
      const userId = (
        await app.get(PrismaService).digimon.findFirstOrThrow({ where: { id: patamon.id } })
      ).userId;

      // Open the fight → a live state where the AI's hard-difficulty pick is Double Strike (a
      // NON-'attack' skill — see the matchup test above), so 'attack' is DISTINGUISHABLE from it.
      const start = await postTurn(patamon.id, { enemyId: 'numemon' }, token);
      const startView = (await start.json()) as BattleTurnView;
      const live = deserializeFightState(startView.state as SerializedFightState);
      const enemyC = findEnemy('numemon')!;
      const playerC: Combatant = {
        name: patamon.name,
        type: patamon.type,
        element: patamon.element,
        hp: patamon.hp,
        maxHp: patamon.hp,
        atk: patamon.atk,
        def: patamon.def,
        spd: patamon.spd,
      };
      const aiPick = chooserForDifficulty('hard')(live.enemy, live.player, enemyC, playerC);
      const attackSkill = findCombatantSkill('attack')!;
      // Prove the seam is OBSERVABLE: the supplied skill differs from what the AI would cast.
      expect(aiPick.id).not.toBe('attack');

      const turn = await turnWithEnemyAction(
        userId,
        patamon.id,
        { enemyId: 'numemon', skillId: 'attack', state: startView.state },
        { skillId: 'attack' },
      );
      const enemyEntry = turn.entries.find((e) => e.actor === 'enemy');
      expect(enemyEntry).toBeDefined();
      // The enemy cast the SUPPLIED skill (Attack), NOT the AI's banking-chain pick.
      expect(enemyEntry!.skill).toBe(attackSkill.name);
      expect(enemyEntry!.skill).not.toBe(aiPick.name);
    });

    it('NO enemyAction on the SAME state → the AI pick resolves (the identity anchor)', async () => {
      const token = await registerAndLogin('t312-ai@example.test');
      const patamon = (await getRoster(token)).find((d) => d.name === 'Patamon')!;
      const userId = (
        await app.get(PrismaService).digimon.findFirstOrThrow({ where: { id: patamon.id } })
      ).userId;

      const start = await postTurn(patamon.id, { enemyId: 'numemon' }, token);
      const startView = (await start.json()) as BattleTurnView;
      const live = deserializeFightState(startView.state as SerializedFightState);
      const enemyC = findEnemy('numemon')!;
      const playerC: Combatant = {
        name: patamon.name,
        type: patamon.type,
        element: patamon.element,
        hp: patamon.hp,
        maxHp: patamon.hp,
        atk: patamon.atk,
        def: patamon.def,
        spd: patamon.spd,
      };
      const aiPick = chooserForDifficulty('hard')(live.enemy, live.player, enemyC, playerC);

      const turn = await turnWithEnemyAction(
        userId,
        patamon.id,
        { enemyId: 'numemon', skillId: 'attack', state: startView.state },
        undefined, // NO enemyAction → the AI drives the enemy
      );
      const enemyEntry = turn.entries.find((e) => e.actor === 'enemy');
      expect(enemyEntry).toBeDefined();
      expect(enemyEntry!.skill).toBe(aiPick.name);
    });

    it('an ILLEGAL/unknown enemyAction → 422 with the fight state UNCHANGED', async () => {
      const token = await registerAndLogin('t312-bad@example.test');
      const patamon = (await getRoster(token)).find((d) => d.name === 'Patamon')!;
      const userId = (
        await app.get(PrismaService).digimon.findFirstOrThrow({ where: { id: patamon.id } })
      ).userId;

      const start = await postTurn(patamon.id, { enemyId: 'numemon' }, token);
      const startView = (await start.json()) as BattleTurnView;
      const stateBefore = JSON.stringify(startView.state);

      await expect(
        turnWithEnemyAction(
          userId,
          patamon.id,
          { enemyId: 'numemon', skillId: 'attack', state: startView.state },
          { skillId: 'no-such-skill' },
        ),
      ).rejects.toMatchObject({ status: 422 });

      // The fight is UNCHANGED — the passed-in carried state object was not mutated (the guard
      // rejects BEFORE any turn resolution; the rebuild is server-side, but the request refused).
      expect(JSON.stringify(startView.state)).toBe(stateBefore);
    });
  });
});
