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
import type { OwnedDigimon } from './digimon.types';
import { DigimonService } from './digimon.service';
import { EVOLUTION_LINES } from './evolution';
import { DEFAULT_RNG, type Rng } from './rng';
import { TRAIN_DATA_FIRE_PER_ACTION, evolutionTrainingBonus } from './training';

/**
 * Adaptive Digivolution API contract (TASK-30, R-16) — the runnable proof that a
 * Digimon can be STEERED into a DIFFERENT form by what it ACCUMULATES, not just its
 * level. The core fantasy: two players with the same Agumon reach different Champion
 * forms by playing differently. This e2e proves the SERVER truth end-to-end:
 *
 *  - Training grants typed Fire Data (`dataFire` rises by exactly N * per-action).
 *  - The VARIANT branch (Agumon → Meramon) is BLOCKED below the Fire-Data threshold
 *    (422 with the clear "Requires N Fire Data …" reason; nothing mutated).
 *  - The VARIANT branch SUCCEEDS at/above the threshold — the Digimon becomes the
 *    variant form (Meramon), the Meat cost is debited, and exactly ONE negative-delta
 *    `action:'evolve'` audit row is written (a variant is just another priced step —
 *    invariant 3 unchanged).
 *  - The LINEAR/no-body evolve is BYTE-COMPATIBLE (Agumon → Greymon, exactly as
 *    before this task).
 *  - Owner-isolation 404 and no-Bearer 401 hold on both branches.
 *
 * Harness = the SAME two house patterns as the sibling `evolve.controller.spec.ts`
 * (P-2 + P-6), inlined VERBATIM per the nest-e2e-and-datastore-tests skill's
 * documented fallback (the shared `apps/api/src/test/datastore.ts` helper does not
 * exist yet — a separate DISTILL item). Boot via `createApp()` (not
 * `Test.createTestingModule`) so the global `/api` prefix AND global ValidationPipe
 * are active; a per-run throwaway SQLite DB (ABSOLUTE `file:` URL set BEFORE
 * `createApp()`) so the shared dev.db is never touched; `prisma db push
 * --skip-generate` from `join(__dirname, '..', '..')` (= apps/api, two levels up
 * from src/digimon/ — the L-6 cwd depth).
 *
 * Fire Data is set up the HONEST way (via the real `train` action) since training is
 * the actual (only) Data source in this slice — so the "training grants Data → Data
 * unlocks the branch" causal chain is proven, not stubbed. The spendable Meat the
 * variant evolve DEBITs is seeded directly via `PrismaService` (the same L-3 escape
 * hatch the evolve spec uses) so the spec proves the DEBIT, not how funds were earned.
 */
describe('Adaptive Digivolution API (end-to-end)', () => {
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
    const registered = (await register.json()) as RegisterResponse;
    expect(registered.email).toBe(email);

    const login = await jsonPost('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    expect(typeof accessToken).toBe('string');
    expect(accessToken.length).toBeGreaterThan(0);
    return accessToken;
  };

  const getRoster = async (token: string): Promise<OwnedDigimon[]> => {
    const res = await fetch(`${baseUrl}/digimon`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as OwnedDigimon[];
  };

  /**
   * `POST /digimon/:id/evolve` with an OPTIONAL branch selector and optional Bearer.
   * When `branch` is undefined NO body is sent (proving the byte-compatible no-body
   * path); otherwise a JSON `{ branch }` body is sent through the parameter-scoped
   * ValidationPipe.
   */
  const postEvolve = (id: string, opts: { token?: string; branch?: 'linear' | 'variant' } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.branch !== undefined) headers['content-type'] = 'application/json';
    return fetch(`${baseUrl}/digimon/${id}/evolve`, {
      method: 'POST',
      headers,
      body: opts.branch !== undefined ? JSON.stringify({ branch: opts.branch }) : undefined,
    });
  };

  /**
   * TASK-188 (R-27, L-55/L-56/L-75/L-76 non-flaky discipline): drive a LINEAR evolve
   * through `DigimonService.evolve(..., DEFAULT_RNG)` DIRECTLY rather than the HTTP
   * boundary. `POST :id/evolve` now feeds `LIVE_RNG` into the `pickEvolution` seam, so
   * asserting a SPECIFIC linear target form over the raw HTTP path would flake (Agumon
   * can now draw Greymon / Tyrannomon / Centarumon). `DEFAULT_RNG` (`() => 0`) draws
   * `intoOptions[0]` — the PRIMARY (Greymon) — verbatim, the invariant-5 identity anchor,
   * so the exact-name byte-compat assertion is proven on the entropy-free path (the same
   * method the controller calls, minus entropy) while the boundary stays free to roll.
   * Mirrors `evolve.controller.spec.ts`'s `evolveViaService` helper.
   */
  const evolveViaService = async (
    email: string,
    id: string,
    rng: Rng = DEFAULT_RNG,
  ): Promise<OwnedDigimon> => {
    const service = app.get(DigimonService);
    const userId = await userIdForEmail(email);
    return service.evolve(userId, id, 'linear', rng);
  };

  /**
   * TASK-215 (R-27a, A-196, L-55/L-56): drive the VARIANT evolve through
   * `DigimonService.evolve(..., 'variant', rng)` DIRECTLY with an injected stub rng.
   * The HTTP boundary always feeds `LIVE_RNG` into the now-random `pickEvolutionVariant`
   * seam, so asserting a SPECIFIC variant target over the raw HTTP path would flake
   * (the variant can now draw Meramon / Flarerizamon / Meteormon). A high stub rng
   * (`() => 0.999`) deterministically draws the LAST (non-primary) option so the
   * non-default random draw is proven at the service seam; `DEFAULT_RNG` at the HTTP
   * boundary keeps landing Meramon (intoOptions[0], the identity anchor) verbatim, which
   * the existing HTTP SUCCESS test above still asserts with NO re-pin.
   */
  const evolveVariantViaService = async (
    email: string,
    id: string,
    rng: Rng = DEFAULT_RNG,
  ): Promise<OwnedDigimon> => {
    const service = app.get(DigimonService);
    const userId = await userIdForEmail(email);
    return service.evolve(userId, id, 'variant', rng);
  };

  const postTrain = (id: string, token: string) =>
    fetch(`${baseUrl}/digimon/${id}/train`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });

  /** Pick the Agumon (the starter that HAS a variant branch in this slice). */
  const anAgumon = (roster: OwnedDigimon[]): OwnedDigimon => {
    const agumon = roster.find((d) => d.name === 'Agumon');
    if (agumon === undefined) {
      throw new Error('test fixture drift: no Agumon in the starter roster');
    }
    return agumon;
  };

  const userIdForEmail = async (email: string): Promise<string> => {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findFirst({ where: { email } });
    if (user === null) throw new Error(`test setup: no user registered for ${email}`);
    return user.id;
  };

  /** Seed a spendable balance directly (L-3 — no real collect/clock in this spec). */
  const seedBalance = async (email: string, resource: string, amount: number) => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    await prisma.resourceBalance.create({ data: { userId, resource, amount } });
  };

  const balanceAmount = async (email: string, resource: string): Promise<number | undefined> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource } },
    });
    return row?.amount;
  };

  const evolveAuditRows = async (digimonId: string) => {
    const prisma = app.get(PrismaService);
    return prisma.auditLog.findMany({
      where: { entity: 'Digimon', entityId: digimonId, action: 'evolve' },
    });
  };

  /** Train `count` times and return the roster entry for `id` afterwards. */
  const trainN = async (id: string, token: string, count: number): Promise<OwnedDigimon> => {
    for (let i = 0; i < count; i += 1) {
      const res = await postTrain(id, token);
      expect(res.status).toBe(200);
    }
    const roster = await getRoster(token);
    const found = roster.find((d) => d.id === id);
    if (found === undefined) throw new Error('trained Digimon vanished from roster');
    return found;
  };

  // The Agumon variant branch under test — the single source of the numbers asserted
  // below (threshold, cost, target form), so the spec never drifts from the data.
  const AGUMON_VARIANT = EVOLUTION_LINES.Agumon!.variant!;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-adaptive-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'adaptive.db')}`;
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

  it('rejects the variant evolve with NO Authorization header → 401', async () => {
    const res = await postEvolve('any-id', { branch: 'variant' });
    expect(res.status).toBe(401);
  });

  it('rejects the linear (no-body) evolve with NO Authorization header → 401', async () => {
    const res = await postEvolve('any-id');
    expect(res.status).toBe(401);
  });

  it('training grants Fire Data — dataFire rises by exactly N * TRAIN_DATA_FIRE_PER_ACTION', async () => {
    const email = 'data-grant@example.test';
    const token = await registerAndLogin(email);
    const agumon = anAgumon(await getRoster(token));
    // A fresh starter carries 0 Fire Data (the defaulted column).
    expect(agumon.dataFire).toBe(0);

    const N = 3;
    const trained = await trainN(agumon.id, token, N);
    // Data accrued EXACTLY N grants — proving training is the Data source and the
    // per-action amount is the constant the rule advertises.
    expect(trained.dataFire).toBe(N * TRAIN_DATA_FIRE_PER_ACTION);
  });

  it('BLOCKS the variant evolve below the Fire-Data threshold → 422, nothing mutated', async () => {
    const email = 'below-threshold@example.test';
    const token = await registerAndLogin(email);
    const agumon = anAgumon(await getRoster(token));

    // Train just ONCE — Fire Data (10) is well below the variant threshold (60), so
    // the accumulation gate must fire. Seed plenty of Meat so a 422 here can ONLY be
    // the Data gate, never an affordability shortfall.
    const trained = await trainN(agumon.id, token, 1);
    expect(trained.dataFire).toBeLessThan(AGUMON_VARIANT.requiredData);
    await seedBalance(email, AGUMON_VARIANT.cost.resource, AGUMON_VARIANT.cost.amount + 100);

    const res = await postEvolve(agumon.id, { token, branch: 'variant' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(typeof body.message).toBe('string');
    // The player-facing reason names the requirement (amount + "Fire Data").
    expect(body.message).toContain(String(AGUMON_VARIANT.requiredData));
    expect(body.message).toContain('Fire Data');

    // Nothing mutated: still Agumon/Rookie, balance untouched, no audit row.
    const after = anAgumon(await getRoster(token));
    expect(after.name).toBe('Agumon');
    expect(after.stage).toBe('Rookie');
    expect(await balanceAmount(email, AGUMON_VARIANT.cost.resource)).toBe(
      AGUMON_VARIANT.cost.amount + 100,
    );
    expect(await evolveAuditRows(agumon.id)).toHaveLength(0);
  });

  it('SUCCEEDS the variant evolve at/above the threshold → 200 + a valid variant Champion, debited + audited', async () => {
    const email = 'variant-evolve@example.test';
    const token = await registerAndLogin(email);
    const agumon = anAgumon(await getRoster(token));

    // Train enough times to CROSS the Fire-Data threshold (ceil(60/10) = 6 clicks).
    const clicks = Math.ceil(AGUMON_VARIANT.requiredData / TRAIN_DATA_FIRE_PER_ACTION);
    const trained = await trainN(agumon.id, token, clicks);
    expect(trained.dataFire).toBeGreaterThanOrEqual(AGUMON_VARIANT.requiredData);

    // Seed a Meat balance strictly ABOVE the variant cost so we can prove an EXACT
    // debit (seeded − cost), not a "drained to zero".
    const seeded = AGUMON_VARIANT.cost.amount + 70;
    await seedBalance(email, AGUMON_VARIANT.cost.resource, seeded);

    const res = await postEvolve(agumon.id, { token, branch: 'variant' });
    expect(res.status).toBe(200);
    const evolved = (await res.json()) as OwnedDigimon;

    // TASK-215 (L-121): the variant branch now draws a RANDOM valid Champion, and the
    // evolve HTTP boundary feeds LIVE_RNG (digimon.controller.ts, since TASK-188) — so
    // the RAW HTTP path is NON-DETERMINISTIC over the variant option set and must NOT
    // assert a SPECIFIC drawn form/stat here (the identity anchor only pins DEFAULT_RNG
    // callers — see the dedicated anchor test below for deterministic Meramon). This
    // fixture asserts only branch-agnostic facts: same instance, a well-formed member
    // of the real variant option set, the ONE variant debit, and the single audit row.
    const optNames = AGUMON_VARIANT.intoOptions!.map((o) => o.name);
    const drawn = AGUMON_VARIANT.intoOptions!.find((o) => o.name === evolved.name);
    const bonus = evolutionTrainingBonus(trained.level);
    expect(evolved.id).toBe(agumon.id);
    expect(optNames).toContain(evolved.name); // one of Meramon/Flarerizamon/Meteormon
    expect(drawn).toBeDefined();
    expect(evolved.stage).toBe('Champion');
    // Stats are the DRAWN form's catalog stats PLUS the level-derived training bonus
    // (6 train clicks put this creature above base level — TASK-195 co-evolution).
    expect(evolved.hp).toBe(drawn!.hp + bonus.hp);
    expect(evolved.atk).toBe(drawn!.atk + bonus.atk);
    expect(evolved.def).toBe(drawn!.def + bonus.def);
    expect(evolved.spd).toBe(drawn!.spd + bonus.spd);

    // The Meat cost was DEBITED by EXACTLY the variant cost regardless of the drawn
    // form (a variant is a priced step; ONE variant cost — invariant 3 unchanged).
    expect(await balanceAmount(email, AGUMON_VARIANT.cost.resource)).toBe(
      seeded - AGUMON_VARIANT.cost.amount,
    );

    // Exactly ONE negative-delta 'evolve' audit row for this Digimon.
    const rows = await evolveAuditRows(agumon.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe('evolve');
    expect(row.entity).toBe('Digimon');
    expect(row.entityId).toBe(agumon.id);
    expect(row.resource).toBe(AGUMON_VARIANT.cost.resource);
    expect(row.amountBefore).toBe(seeded);
    expect(row.amountAfter).toBe(seeded - AGUMON_VARIANT.cost.amount);
    expect(row.amountAfter - row.amountBefore).toBe(-AGUMON_VARIANT.cost.amount);
  });

  it('TASK-215: the VARIANT branch draws a RANDOM valid Champion at the service seam (high rng → non-primary)', async () => {
    const email = 'variant-random@example.test';
    const token = await registerAndLogin(email);
    const agumon = anAgumon(await getRoster(token));

    // Cross the Fire-Data threshold the honest way (training is the Data source).
    const clicks = Math.ceil(AGUMON_VARIANT.requiredData / TRAIN_DATA_FIRE_PER_ACTION);
    const trained = await trainN(agumon.id, token, clicks);
    expect(trained.dataFire).toBeGreaterThanOrEqual(AGUMON_VARIANT.requiredData);

    // Seed strictly above the ONE variant cost so we can prove an EXACT debit — the
    // debit is the SAME regardless of which form the random draw lands (invariant 3:
    // per-option variant costs are a separate future child; ONE variant cost here).
    const seeded = AGUMON_VARIANT.cost.amount + 70;
    await seedBalance(email, AGUMON_VARIANT.cost.resource, seeded);

    // A high stub rng draws the LAST (non-primary) variant option — a form the fixed
    // pre-slice variant could NEVER land (it always landed Meramon). Drive it via the
    // service directly (the HTTP boundary uses DEFAULT_RNG → Meramon; L-55/L-56).
    const opts = AGUMON_VARIANT.intoOptions!;
    const nonPrimary = opts[opts.length - 1]!;
    expect(nonPrimary.name).not.toBe('Meramon'); // sanity: a genuinely different form
    const bonus = evolutionTrainingBonus(trained.level);

    const evolved = await evolveVariantViaService(email, agumon.id, () => 0.999);
    expect(evolved.id).toBe(agumon.id);
    expect(evolved.name).toBe(nonPrimary.name);
    expect(evolved.stage).toBe(nonPrimary.stage);
    expect(evolved.hp).toBe(nonPrimary.hp + bonus.hp);
    expect(evolved.atk).toBe(nonPrimary.atk + bonus.atk);
    expect(evolved.def).toBe(nonPrimary.def + bonus.def);
    expect(evolved.spd).toBe(nonPrimary.spd + bonus.spd);

    // The debit equals the ONE variant cost regardless of the drawn form (invariant 3).
    expect(await balanceAmount(email, AGUMON_VARIANT.cost.resource)).toBe(
      seeded - AGUMON_VARIANT.cost.amount,
    );

    // Exactly ONE 'evolve' audit row for the variant spend.
    const rows = await evolveAuditRows(agumon.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-AGUMON_VARIANT.cost.amount);
  });

  it('TASK-215: DEFAULT_RNG variant draw still lands Meramon verbatim (identity anchor)', async () => {
    const email = 'variant-anchor@example.test';
    const token = await registerAndLogin(email);
    const agumon = anAgumon(await getRoster(token));

    const clicks = Math.ceil(AGUMON_VARIANT.requiredData / TRAIN_DATA_FIRE_PER_ACTION);
    const trained = await trainN(agumon.id, token, clicks);
    await seedBalance(email, AGUMON_VARIANT.cost.resource, AGUMON_VARIANT.cost.amount + 10);

    // DEFAULT_RNG (() => 0) draws intoOptions[0] === variant.into (Meramon) verbatim —
    // the invariant-5 anchor keeping every existing variant fixture green with NO re-pin.
    const bonus = evolutionTrainingBonus(trained.level);
    const evolved = await evolveVariantViaService(email, agumon.id);
    expect(evolved.name).toBe('Meramon');
    expect(evolved.name).toBe(AGUMON_VARIANT.into.name);
    expect(evolved.hp).toBe(AGUMON_VARIANT.into.hp + bonus.hp);
  });

  it('LINEAR (no-body) evolve is byte-compatible → 200 Greymon, exactly as before', async () => {
    const email = 'linear-compat@example.test';
    const token = await registerAndLogin(email);
    const agumon = anAgumon(await getRoster(token));
    const linear = EVOLUTION_LINES.Agumon!;

    // No training needed — the linear branch does not gate on Fire Data. Seed the
    // linear Meat cost.
    await seedBalance(email, linear.cost.resource, linear.cost.amount + 50);

    // LINEAR branch via the direct service on DEFAULT_RNG (NOT the now-LIVE_RNG HTTP
    // boundary, which would randomize the drawn champion and flake this exact-name
    // assertion). DEFAULT_RNG draws the PRIMARY (intoOptions[0] === Greymon) verbatim —
    // the invariant-5 identity anchor: byte-identical to the pre-R-27 behaviour.
    const evolved = await evolveViaService(email, agumon.id);
    expect(evolved.id).toBe(agumon.id);
    expect(evolved.name).toBe(linear.into.name);
    expect(evolved.name).toBe('Greymon');
    expect(evolved.stage).toBe('Champion');
    // The linear debit still happened (a priced step).
    expect(await balanceAmount(email, linear.cost.resource)).toBe(50);
  });

  it('rejects a malformed branch value → 400 (parameter-scoped ValidationPipe active)', async () => {
    const email = 'bad-branch@example.test';
    const token = await registerAndLogin(email);
    const agumon = anAgumon(await getRoster(token));

    // A garbage branch string must be a clean 400 (the @IsIn validation), NOT a
    // silent fall-through to a linear evolve — proving the P-7 expectedType binding.
    const res = await fetch(`${baseUrl}/digimon/${agumon.id}/evolve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ branch: 'nonsense' }),
    });
    expect(res.status).toBe(400);
  });

  it("never variant-evolves another player's Digimon → 404 (per-user isolation)", async () => {
    const tokenA = await registerAndLogin('owner-a-adaptive@example.test');
    const victim = anAgumon(await getRoster(tokenA));

    const tokenB = await registerAndLogin('intruder-b-adaptive@example.test');
    const rosterB = await getRoster(tokenB);
    const aIds = new Set((await getRoster(tokenA)).map((d) => d.id));
    expect(rosterB.every((d) => !aIds.has(d.id))).toBe(true);

    // B attempts A's Digimon on the variant branch → 404 (owner-scoped find misses
    // BEFORE any branch/Data logic), and A's row is untouched.
    const res = await postEvolve(victim.id, { token: tokenB, branch: 'variant' });
    expect(res.status).toBe(404);

    const untouched = anAgumon(await getRoster(tokenA));
    expect(untouched.name).toBe('Agumon');
    expect(untouched.stage).toBe('Rookie');
  });
});
