import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { bootHttpTestApp, type TempDatastore } from '../test/datastore';
import { PvpService } from './pvp.service';
import { elo } from './rating';
import { lossPenaltyFor } from '../digimon/training';

/**
 * `PvpService.forfeitMatch` unit (TASK-197, R-25a-follow2 slice 56).
 *
 * Proves the SCORED forfeit-loss the gateway applies when a player abandons a live duel:
 * the remainer WINS, the leaver LOSES, both persisted `User.mmr` rows move by the EXACT
 * symmetric `elo(...)` step `challengeTurn` uses on a terminal outcome.
 *
 * TASK-278 (R-31e — forfeit/leaver xp penalty): a leaver ALSO takes the same level-scaled,
 * capped xp toll (`lossPenaltyFor`) a PvE / challenger-PvP loss applies (xp-only, NO wipe),
 * with a `battle-loss` `AuditLog` row — but ONLY when they own a champion. Both sides are
 * proven: (a) a leaver WITH a Digimon → xp drops by exactly `lossPenaltyFor(level)` + one
 * `battle-loss` row + MMR STILL the exact `elo` values (the MMR path byte-unchanged); (b) a
 * leaver with NO Digimon → NO `AuditLog` row + MMR-only moves (the invariant-5 identity path,
 * byte-identical to before this slice). Invariant 3 UNTRIGGERED (xp is FREE progress,
 * `resource:null`, no `ResourceBalance` move; A-176/A-179).
 *
 * Harness = the shared `bootHttpTestApp()` throwaway-DB helper (a real DB + DI-wired
 * `PvpService`), resolving the provider directly and driving `forfeitMatch` without any
 * socket — the correctness of the pure rating write is asserted at the service boundary.
 */
describe('PvpService.forfeitMatch', () => {
  let ds: TempDatastore;
  let prisma: PrismaService;
  let service: PvpService;

  /** Register a fresh user over HTTP + set a known starting MMR; returns its id. */
  const seedUser = async (email: string, mmr: number): Promise<string> => {
    const register = await fetch(`${ds.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    expect(register.status).toBe(201);
    const { id } = (await register.json()) as { id: string };
    await prisma.user.update({ where: { id }, data: { mmr } });
    return id;
  };

  beforeAll(async () => {
    ds = await bootHttpTestApp('pvp-service');
    prisma = ds.app.get(PrismaService);
    service = ds.app.get(PvpService);
  });

  afterAll(async () => {
    await ds.dispose();
  });

  it('leaver with NO Digimon: scores the remainer a win + leaver a loss by the exact `elo` step; persists both rows; writes NO AuditLog (invariant-5 identity path)', async () => {
    const remainerId = await seedUser('remainer@digimon.dev', 1200);
    const leaverId = await seedUser('leaver@digimon.dev', 1000);
    const auditBefore = await prisma.auditLog.count();

    const result = await service.forfeitMatch(remainerId, leaverId);

    // The returned ratings equal the shared symmetric Elo step (remainer WON).
    const expected = elo(1200, 1000, true);
    expect(result.outcome).toBe('win');
    expect(result.ratings.remainer).toEqual({ before: 1200, after: expected.a });
    expect(result.ratings.leaver).toEqual({ before: 1000, after: expected.b });
    // A forfeit win still moves the ladder the right direction.
    expect(result.ratings.remainer.after).toBeGreaterThan(1200);
    expect(result.ratings.leaver.after).toBeLessThan(1000);

    // Both rows persisted to exactly the returned after-values.
    const rem = await prisma.user.findFirstOrThrow({ where: { id: remainerId } });
    const lev = await prisma.user.findFirstOrThrow({ where: { id: leaverId } });
    expect(rem.mmr).toBe(expected.a);
    expect(lev.mmr).toBe(expected.b);

    // The leaver owns NO Digimon → the TASK-278 xp-penalty block is skipped → NO ledger
    // row is written. Byte-identical to the pre-TASK-278 behaviour (the identity anchor).
    expect(await prisma.auditLog.count()).toBe(auditBefore);
  });

  it('leaver WITH a Digimon: bleeds exactly `lossPenaltyFor(level)` xp + writes ONE battle-loss AuditLog; MMR path unchanged', async () => {
    const remainerId = await seedUser('remainer2@digimon.dev', 1200);
    const leaverId = await seedUser('leaver2@digimon.dev', 1000);

    // Seed the leaver a champion at a known level/xp in the throwaway DB. Level 5 makes
    // the level-scaled penalty > the flat base so the scaling is exercised; xp is set well
    // above the penalty so the drop is unambiguous (and never floors at 0 here).
    const level = 5;
    const startXp = 500;
    const champ = await prisma.digimon.create({
      data: {
        userId: leaverId,
        name: 'Agumon',
        type: 'Vaccine',
        element: 'Fire',
        stage: 'Rookie',
        hp: 50,
        atk: 12,
        def: 8,
        spd: 10,
        level,
        xp: startXp,
      },
    });
    const auditBefore = await prisma.auditLog.count();

    const result = await service.forfeitMatch(remainerId, leaverId);

    // The MMR/Elo path is BYTE-UNCHANGED (the xp penalty is additive, never touches rating).
    const expected = elo(1200, 1000, true);
    expect(result.outcome).toBe('win');
    expect(result.ratings.remainer).toEqual({ before: 1200, after: expected.a });
    expect(result.ratings.leaver).toEqual({ before: 1000, after: expected.b });
    const rem = await prisma.user.findFirstOrThrow({ where: { id: remainerId } });
    const lev = await prisma.user.findFirstOrThrow({ where: { id: leaverId } });
    expect(rem.mmr).toBe(expected.a);
    expect(lev.mmr).toBe(expected.b);

    // The leaver's champion bled EXACTLY `lossPenaltyFor(level)` xp; level UNCHANGED (the
    // pure fn never de-levels — A-42), stats untouched (xp-only, no wipe).
    const penalty = lossPenaltyFor(level);
    const after = await prisma.digimon.findFirstOrThrow({ where: { id: champ.id } });
    expect(after.xp).toBe(Math.max(0, startXp - penalty));
    expect(after.level).toBe(level);
    expect(after.hp).toBe(50);
    expect(after.atk).toBe(12);
    expect(after.def).toBe(8);
    expect(after.spd).toBe(10);

    // Exactly ONE `battle-loss` AuditLog row for THIS champion/user, with the xp-only shape
    // (resource:null; amountBefore/After = the xp move). Invariant 3 UNTRIGGERED.
    const rows = await prisma.auditLog.findMany({
      where: { userId: leaverId, entityId: champ.id, action: 'battle-loss' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].entity).toBe('Digimon');
    expect(rows[0].resource).toBeNull();
    expect(rows[0].amountBefore).toBe(startXp);
    expect(rows[0].amountAfter).toBe(Math.max(0, startXp - penalty));
    // Exactly one new ledger row overall (no stray writes on the MMR/remainer side).
    expect(await prisma.auditLog.count()).toBe(auditBefore + 1);
  });
});
