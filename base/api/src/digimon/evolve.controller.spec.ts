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
import { EVOLUTION_LINES } from './evolution';
import { evolutionTrainingBonus } from './training';
import { DigimonService } from './digimon.service';
import { DEFAULT_RNG, type Rng } from './rng';

/**
 * Evolve API contract (TASK-18, R-8 + TASK-24, R-8b) — the runnable proof of
 * server-authoritative evolution AND its resource cost (the game's FIRST economic
 * SPEND): a signed-in player who can AFFORD it evolves one of THEIR Rookie starters
 * (the row is mutated in place — advanced `stage`/`name`/stats — AND the cost is
 * DEBITED from their spendable balance + an `action:'evolve'` audit row is written,
 * all atomically), while an ineligible/foreign Digimon OR one the player cannot pay
 * for is blocked with a clean HTTP error and NOTHING is mutated. This is the API
 * layer TASK-25's UI drives.
 *
 * Harness = the SAME two house patterns as the sibling `digimon.controller.spec.ts`
 * (P-2 + P-6), copied VERBATIM — `POST /digimon/:id/evolve` hits the DB AND is
 * guard-protected, so both halves are needed. (The shared
 * `apps/api/src/test/datastore.ts` helper the e2e skill's primary path names does
 * not exist yet — extracting it is a separate DISTILL item — so this spec inlines
 * the throwaway-DB block per the skill's documented fallback, matching every other
 * apps/api e2e today.)
 *
 *  - P-2 (endpoint e2e): boot a REAL Nest app + `app.listen(0)` (ephemeral port,
 *    never collides) + Node's built-in `fetch` (no supertest). Exercises the true
 *    HTTP stack incl. the reused `JwtAuthGuard`.
 *  - FRICTION #1: boot via `createApp()`, NOT `Test.createTestingModule(...)`. Only
 *    `createApp()` wires the full `AppModule` (incl. `DigimonModule`, the AuthModule
 *    guard export, the global `/api` prefix, and the global `ValidationPipe`) — the
 *    same code path `main.ts` runs. A green boot here also proves the guard
 *    constructs across the module boundary.
 *  - P-6 (hermetic throwaway DB): NEVER touch the shared `apps/api/prisma/dev.db`.
 *    `DATABASE_URL` → a per-run temp SQLite file (ABSOLUTE path, set BEFORE
 *    `createApp()` — `PrismaService` reads it when `PrismaClient` is constructed).
 *    Schema applied with `prisma db push --skip-generate`. CRUCIAL cwd depth (L-6):
 *    this spec is at `src/digimon/`, so `db push` runs from
 *    `join(__dirname, '..', '..')` (= `apps/api`, where `schema.prisma` lives) —
 *    two levels up, the SAME depth as the roster spec.
 *
 * R-8b's spendable funds are set up WITHOUT a real collect/clock (L-3): after the
 * first-open starter grant we reach `PrismaService` via `app.get(PrismaService)`,
 * look the user's id up by email, and directly `create` a `ResourceBalance` row for
 * the cost resource — the SAME escape hatch `collect.controller.spec.ts` uses to
 * rewind a clock. This keeps the evolve spec from coupling to the farm's collect
 * timing (it proves the DEBIT, not how funds were earned).
 *
 * R-15: `createApp()` owns the global `/api` prefix, so the REAL external paths are
 * `/api/digimon/...` and `/api/auth/*`; `baseUrl` is prefixed once so every call
 * hits `/api/...` (this e2e is therefore also cover for the prefix — drop it and it
 * goes red).
 *
 * Teardown closes the app FIRST (PrismaService.onModuleDestroy → $disconnect frees
 * the SQLite handle) THEN removes the temp dir and restores `DATABASE_URL`.
 */
describe('Evolve API (end-to-end)', () => {
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

  /**
   * Register + log in a fresh account and return its access token — a real
   * authenticated principal, exactly as a client would obtain one. Each call uses a
   * unique email so tests get independent players (the per-user isolation check
   * depends on two genuinely separate accounts).
   */
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

  /** `POST /digimon/:id/evolve`, with an optional Bearer token (omitted → no header). */
  const postEvolve = (id: string, token?: string) =>
    fetch(`${baseUrl}/digimon/${id}/evolve`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  /**
   * TASK-188 (R-27, L-55/L-56/L-75 non-flaky discipline): call `DigimonService.evolve`
   * DIRECTLY with an injected `rng`, bypassing the HTTP boundary (which now feeds the
   * random `LIVE_RNG` and would make any drawn-FORM assertion flake). This is the SAME
   * method the controller invokes, minus the boundary entropy, still against the real
   * booted app + DB. Defaults to `DEFAULT_RNG` so the drawn form is the PRIMARY verbatim
   * (byte-identical to the pre-slice fixed target). The user id is resolved from the
   * email exactly as the balance helpers do.
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
   * Pick the roster entry whose name HAS an evolution line (a Rookie that can
   * evolve) — robust to roster ordering and to the exact starter set. Every current
   * starter (Agumon/Gabumon/Patamon) has one, so this always finds a candidate; if
   * the seed/chain ever diverge this throws a clear failure rather than a confusing
   * assertion later.
   */
  const anEvolvableStarter = (roster: OwnedDigimon[]): OwnedDigimon => {
    const candidate = roster.find((d) => EVOLUTION_LINES[d.name] !== undefined);
    if (candidate === undefined) {
      throw new Error('test fixture drift: no starter in the roster has an EVOLUTION_LINES entry');
    }
    return candidate;
  };

  /**
   * The user id for a registered email, read straight from the datastore via
   * `app.get(PrismaService)` (the same escape hatch `collect.controller.spec.ts`
   * uses). `registerAndLogin` only surfaces a token, but seeding a `ResourceBalance`
   * needs the owner's id — this looks it up. Throws a clear error if the user is
   * absent (a test-setup bug) rather than returning a misleading `null`.
   */
  const userIdForEmail = async (email: string): Promise<string> => {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findFirst({ where: { email } });
    if (user === null) {
      throw new Error(`test setup: no user registered for ${email}`);
    }
    return user.id;
  };

  /**
   * Seed a spendable balance for a user directly (L-3 — no real collect/clock in the
   * evolve spec; coupling to the farm's accrual timing would make this spec fragile
   * and about the WRONG feature). `create` (not upsert) is fine because each case
   * registers a FRESH account with no prior balance for the resource. This is the
   * exact escape hatch `collect.controller.spec.ts` uses to set up a known DB state.
   */
  const seedBalance = async (email: string, resource: string, amount: number): Promise<void> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    await prisma.resourceBalance.create({ data: { userId, resource, amount } });
  };

  /** The current banked `amount` for a (user, resource), or `undefined` if no row. */
  const balanceAmount = async (email: string, resource: string): Promise<number | undefined> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource } },
    });
    return row?.amount;
  };

  /** All `action:'evolve'` audit rows recorded against a given Digimon id. */
  const evolveAuditRows = async (digimonId: string) => {
    const prisma = app.get(PrismaService);
    return prisma.auditLog.findMany({
      where: { entity: 'Digimon', entityId: digimonId, action: 'evolve' },
    });
  };

  /**
   * TASK-195 — bump an owned Digimon's `level` directly in the DB to simulate a
   * TRAINED creature, WITHOUT running the real train clock (the same L-3 escape-hatch
   * discipline the balance helpers use — this spec proves the evolve-time COUPLING,
   * not how the levels were earned). Returns the new level.
   */
  const setLevel = async (id: string, level: number): Promise<number> => {
    const prisma = app.get(PrismaService);
    await prisma.digimon.update({ where: { id }, data: { level } });
    return level;
  };

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-evolve-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'evolve.db')}`;
    // src/digimon/ → up TWO levels to apps/api (friction / L-6). NOT a single '..'.
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
      cwd: join(__dirname, '..', '..'),
      env: process.env,
      stdio: 'pipe',
    });

    // createApp() installs the full AppModule (incl. DigimonModule + the AuthModule
    // guard export + the /api prefix). A successful boot proves the guard constructs.
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

  it('rejects POST /digimon/:id/evolve with NO Authorization header → 401', async () => {
    // The mutation is unreachable without a valid Bearer token — no unauthenticated
    // caller can advance any Digimon. The id need not exist: the guard runs first.
    const res = await postEvolve('any-id');
    expect(res.status).toBe(401);
  });

  it('rejects POST /digimon/:id/evolve with a garbage token → 401', async () => {
    const res = await postEvolve('any-id', 'not-a-real-jwt');
    expect(res.status).toBe(401);
  });

  it("evolves the player's own Rookie in place → 200 evolved OwnedDigimon (and it persists)", async () => {
    const email = 'alice-evolve@example.test';
    const token = await registerAndLogin(email);

    // Read the starter roster and grab an evolvable Rookie (e.g. Agumon).
    const roster = await getRoster(token);
    const starter = anEvolvableStarter(roster);
    expect(starter.stage).toBe('Rookie');
    const expected = EVOLUTION_LINES[starter.name];

    // R-8b: evolving now COSTS resources, so a no-balance account would 422 on
    // insufficient funds (see the dedicated case below). Seed a comfortably
    // sufficient balance for this starter's cost resource so this case proves the
    // FORM-ADVANCE contract (the debit/audit are asserted in the afford case).
    await seedBalance(email, expected.cost.resource, expected.cost.amount + 100);

    // L-55/L-56/L-75: drive the FORM-ASSERTING evolve through the service directly with
    // DEFAULT_RNG (not the now-LIVE_RNG HTTP boundary, which would randomize the drawn
    // champion and flake this exact-name assertion). DEFAULT_RNG draws the primary form
    // (Greymon) — byte-identical to the pre-slice fixed target.
    const evolved = await evolveViaService(email, starter.id);

    // Same instance identity — the SAME row was mutated in place, not replaced.
    expect(evolved.id).toBe(starter.id);
    // Advanced to the chain's target form + stage + absolute stats (e.g. Greymon).
    expect(evolved.name).toBe(expected.into.name);
    expect(evolved.stage).toBe(expected.into.stage);
    expect(evolved.stage).toBe('Champion');
    expect(evolved.hp).toBe(expected.into.hp);
    expect(evolved.atk).toBe(expected.into.atk);
    expect(evolved.def).toBe(expected.into.def);
    expect(evolved.spd).toBe(expected.into.spd);
    // A strict power bump over the Rookie form (the observable point of evolving).
    expect(evolved.hp).toBeGreaterThan(starter.hp);
    expect(evolved.atk).toBeGreaterThan(starter.atk);
    // type / element / level are NOT touched by evolution (only the form advances).
    expect(evolved.type).toBe(starter.type);
    expect(evolved.element).toBe(starter.element);
    expect(evolved.level).toBe(starter.level);

    // No internal/owner columns leak across the API boundary (invariant 1/2 hygiene,
    // same discipline the roster read and the auth surface apply).
    const leaky = evolved as Record<string, unknown>;
    expect(leaky).not.toHaveProperty('userId');
    expect(leaky).not.toHaveProperty('createdAt');
    expect(leaky).not.toHaveProperty('deletedAt');

    // The mutation PERSISTED: a fresh GET /digimon shows the roster now carries the
    // evolved form at the same id (and the roster size is unchanged — evolve mutates,
    // never adds/removes a row).
    const after = await getRoster(token);
    expect(after).toHaveLength(roster.length);
    const persisted = after.find((d) => d.id === starter.id);
    expect(persisted).toBeDefined();
    expect(persisted?.name).toBe(expected.into.name);
    expect(persisted?.stage).toBe('Champion');
  });

  it("DEBITS the evolution cost and writes an append-only 'evolve' AuditLog row (R-8b, invariant 3)", async () => {
    // The FIRST economic SPEND, exercised end-to-end: an AFFORDABLE evolve debits
    // the balance by EXACTLY the step's cost and appends an audit row (who / what /
    // when / before→after), atomically inside the evolve transaction.
    const email = 'spender-evolve@example.test';
    const token = await registerAndLogin(email);

    const roster = await getRoster(token);
    const starter = anEvolvableStarter(roster);
    const { cost } = EVOLUTION_LINES[starter.name];

    // Seed a balance strictly ABOVE the cost so we can prove an EXACT debit (not a
    // "balance emptied to zero"): starting at cost+70, after the spend it must read
    // exactly 70. A single collect-sized Meat balance (< the 1440 Meat cap) covers
    // this — the affordability the low cost (A-15) guarantees.
    const seeded = cost.amount + 70;
    await seedBalance(email, cost.resource, seeded);

    const res = await postEvolve(starter.id, token);
    expect(res.status).toBe(200);
    const evolved = (await res.json()) as OwnedDigimon;
    // The evolve still returns the advanced OwnedDigimon (the balance is NOT part of
    // this response — invariant 5 keeps the shape byte-unchanged; it is observed via
    // GET /farm). Sanity-check the form advanced (Agumon → Greymon / Champion).
    expect(evolved.id).toBe(starter.id);
    expect(evolved.stage).toBe('Champion');

    // The balance was DEBITED by EXACTLY cost.amount (seeded − cost = 70). This is
    // the core SPEND assertion — a decrement, not an upsert, not a no-op.
    const remaining = await balanceAmount(email, cost.resource);
    expect(remaining).toBe(seeded - cost.amount);

    // Invariant 3: exactly ONE append-only audit row for this evolve, read back
    // through PrismaService (the ledger is internal, not on the API). It records the
    // mutation with the correct action/entity/entityId/resource and a NEGATIVE delta
    // (a spend): amountAfter − amountBefore === −cost.amount.
    const rows = await evolveAuditRows(starter.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe('evolve');
    expect(row.entity).toBe('Digimon');
    expect(row.entityId).toBe(starter.id);
    expect(row.resource).toBe(cost.resource);
    expect(row.amountBefore).toBe(seeded);
    expect(row.amountAfter).toBe(seeded - cost.amount);
    expect(row.amountAfter - row.amountBefore).toBe(-cost.amount);
    // Append-only ledgers are time-ordered — the row carries a real creation time.
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('RANDOM VALID DIGIVOLUTION (R-27): a high stub rng writes a NON-primary valid champion + audits it; DEFAULT_RNG writes the primary verbatim', async () => {
    // TASK-188, L-55/L-56: driven through the service DIRECTLY with an injected stub rng
    // (the HTTP boundary now feeds LIVE_RNG and would flake a specific-form assertion).
    //  - a HIGH stub (→ last bucket) must land a NON-primary champion from the SEEDED
    //    set, written to the row + recorded in the audit — never an off-list form;
    //  - DEFAULT_RNG must land the PRIMARY (Greymon) verbatim (the invariant-5 anchor).
    const email = 'randomevo@example.test';
    const token = await registerAndLogin(email);
    const roster = await getRoster(token);
    const starter = roster.find((d) => d.name === 'Agumon');
    if (starter === undefined) throw new Error('test fixture drift: no Agumon in the roster');
    const step = EVOLUTION_LINES.Agumon;
    const opts = step.intoOptions!;
    const primary = step.into;
    const secondary = opts[opts.length - 1]!; // the last seeded option (a NON-primary form)
    expect(secondary.name).not.toBe(primary.name);

    await seedBalance(email, step.cost.resource, step.cost.amount + 100);

    // A high stub → Math.floor(0.999 * n) === n-1 → the LAST option.
    const highRng: Rng = () => 0.999;
    const evolved = await evolveViaService(email, starter.id, highRng);

    // The row was advanced into the DRAWN non-primary champion (name + absolute stats).
    expect(evolved.id).toBe(starter.id);
    expect(evolved.stage).toBe('Champion');
    expect(evolved.name).toBe(secondary.name);
    expect(evolved.hp).toBe(secondary.hp);
    expect(evolved.atk).toBe(secondary.atk);
    // NEVER an off-list form: the landed name is a member of the seeded set.
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // The audit row was still written (invariant 3 shape byte-unchanged — only WHICH
    // form landed varied); the debit is the step's cost regardless of the drawn option.
    const rows = await evolveAuditRows(starter.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);

    // Second player, DEFAULT_RNG → the PRIMARY (Greymon) verbatim (the identity anchor).
    const email2 = 'defaultevo@example.test';
    const token2 = await registerAndLogin(email2);
    const roster2 = await getRoster(token2);
    const starter2 = roster2.find((d) => d.name === 'Agumon');
    if (starter2 === undefined) throw new Error('test fixture drift: no Agumon in roster2');
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, starter2.id, DEFAULT_RNG);
    expect(evolved2.name).toBe(primary.name);
    expect(evolved2.hp).toBe(primary.hp);
  });

  it.each(['Gabumon', 'Patamon', 'Biyomon', 'Tentomon', 'Palmon', 'Gomamon', 'Veemon', 'Guilmon', 'Renamon', 'Terriermon'])(
    'RANDOM VALID DIGIVOLUTION (R-27a/TASK-207,TASK-208,TASK-209,TASK-210,TASK-211,TASK-212; R-29/TASK-251): %s branches to a NON-primary champion under a high stub rng + audits it; DEFAULT_RNG writes the primary verbatim',
    async (species) => {
      // TASK-207: Gabumon + Patamon join Agumon on the random-draw seam. TASK-208 adds
      // Biyomon; TASK-209 adds Tentomon; TASK-210 adds Palmon; TASK-211 adds Gomamon;
      // TASK-212 adds Veemon — the LAST previously-TERMINAL starter now given its first
      // line (Veemon: ExVeemon anchor + Veedramon/Lynxmon on higher rolls), closing the
      // whole-roster starter child. Driven through
      // the service DIRECTLY with an injected stub rng (the HTTP boundary feeds LIVE_RNG,
      // which would flake a specific-form assertion — L-55/L-56). The debit/audit shape
      // is byte-unchanged; ONLY which in-set champion lands varies with the roll.
      const email = `randomevo-${species.toLowerCase()}@example.test`;
      const token = await registerAndLogin(email);
      const roster = await getRoster(token);
      const starter = roster.find((d) => d.name === species);
      if (starter === undefined) throw new Error(`test fixture drift: no ${species} in the roster`);
      const step = EVOLUTION_LINES[species];
      const opts = step.intoOptions!;
      const primary = step.into;
      // TASK-214: Gomamon's LAST option (Shellmon) now carries a RESOURCE-VARYING
      // override (Bits 30), so drawing it would (correctly) debit Bits, not the source
      // Meat cost — breaking this loop's "debit === source cost" assertion. The
      // resource-varying case is covered end-to-end in the dedicated TASK-214 test
      // below; here we draw Gomamon's MIDDLE option (Coelamon — no override, falls back
      // to the source Meat 45) so the flat-cost assertion stays valid for it. Every
      // other species draws its last option (all no-override) exactly as before.
      const secondaryIndex = species === 'Gomamon' ? 1 : opts.length - 1;
      const secondary = opts[secondaryIndex]!; // a NON-primary form with NO cost override
      expect(secondary.name).not.toBe(primary.name);
      expect(secondary.cost).toBeUndefined();

      await seedBalance(email, step.cost.resource, step.cost.amount + 100);
      const balanceBefore = step.cost.amount + 100;

      // A high stub → Math.floor(0.999 * n) === n-1 → the LAST option (non-primary).
      // For Gomamon draw the MIDDLE option instead (Math.floor(0.5 * 3) === 1 → Coelamon).
      const highRng: Rng = species === 'Gomamon' ? () => 0.5 : () => 0.999;
      const evolved = await evolveViaService(email, starter.id, highRng);

      // The row advanced into the DRAWN non-primary champion (name + absolute stats).
      expect(evolved.id).toBe(starter.id);
      expect(evolved.stage).toBe('Champion');
      expect(evolved.name).toBe(secondary.name);
      expect(evolved.hp).toBe(secondary.hp);
      expect(evolved.atk).toBe(secondary.atk);
      // NEVER an off-list form: the landed name is a member of the seeded set.
      expect(opts.map((o) => o.name)).toContain(evolved.name);

      // Exactly ONE evolve audit row; the debit is the SOURCE-species cost regardless
      // of which option landed (invariant 3 shape byte-unchanged — ONE cost per source).
      const rows = await evolveAuditRows(starter.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.action).toBe('evolve');
      expect(rows[0]!.resource).toBe(step.cost.resource);
      expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
      expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

      // Second player, DEFAULT_RNG → the PRIMARY verbatim (the invariant-5 identity anchor).
      const email2 = `defaultevo-${species.toLowerCase()}@example.test`;
      const token2 = await registerAndLogin(email2);
      const roster2 = await getRoster(token2);
      const starter2 = roster2.find((d) => d.name === species);
      if (starter2 === undefined) throw new Error(`test fixture drift: no ${species} in roster2`);
      await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
      const evolved2 = await evolveViaService(email2, starter2.id, DEFAULT_RNG);
      expect(evolved2.name).toBe(primary.name);
      expect(evolved2.hp).toBe(primary.hp);
    },
  );

  /**
   * TASK-285 (R-17c/R-8): seed an OWNED Champion Greymon directly in the DB — the
   * SECOND-tier evolution source is NOT a starter Rookie, so it is not in the granted
   * roster (the L-3 escape hatch, like `setLevel`/`seedBalance`: this spec proves the
   * evolve-time contract, not how the Greymon was reached). Returns the owned id.
   */
  const seedOwnedGreymon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'Greymon',
        type: 'Vaccine',
        element: 'Fire',
        stage: 'Champion',
        hp: 90,
        atk: 26,
        def: 18,
        spd: 12,
        level,
      },
    });
    return row.id;
  };

  it('TASK-285 (R-17c/R-8): the FIRST Champion→Ultimate line — an owned Greymon evolves to an Ultimate; stub rng draws a NON-primary, DEFAULT_RNG writes MetalGreymon, and a below-level Greymon is refused', async () => {
    // The second evolution TIER ships end-to-end: a player who has a Greymon (e.g.
    // evolved from an Agumon via the shipped flow) can now evolve it AGAIN into a real
    // Ultimate, where today the same call is refused "Greymon has no further evolution."
    // Driven through the SERVICE directly with an injected stub rng (the HTTP boundary
    // feeds LIVE_RNG and would flake a specific-form assertion — L-55/L-56).
    const step = EVOLUTION_LINES.Greymon;
    const opts = step.intoOptions!;
    const primary = step.into; // MetalGreymon
    const secondary = opts[opts.length - 1]!; // RizeGreymon — a NON-primary Ultimate, no override
    expect(primary.name).toBe('MetalGreymon');
    expect(primary.stage).toBe('Ultimate');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (RizeGreymon).
    const email = 'greymon-ultimate@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const greymonId = await seedOwnedGreymon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, greymonId, () => 0.999);
    expect(evolved.id).toBe(greymonId);
    expect(evolved.stage).toBe('Ultimate');
    expect(evolved.name).toBe(secondary.name);
    // Stats are the drawn form's catalog spread PLUS the level-derived training bonus
    // (`evolutionTrainingBonus(level)` — the same bonus the trained-Agumon case proves);
    // the Greymon is seeded at `requiredLevel` (5), so a non-zero bonus is added on top.
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    // NEVER an off-list form: the landed name is a member of the seeded Ultimate set.
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(greymonId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Ultimate (MetalGreymon) verbatim
    //     (the invariant-5 identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'greymon-ultimate-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const greymonId2 = await seedOwnedGreymon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, greymonId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('MetalGreymon');
    expect(evolved2.stage).toBe('Ultimate');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level Greymon is refused "Requires level N" — the evolve
    //     endpoint returns 422 and the DB row is UNCHANGED (still a Champion Greymon).
    const email3 = 'greymon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const greymonId3 = await seedOwnedGreymon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res = await postEvolve(greymonId3, token3);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(String(body.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-294 (R-17c/R-8 tier-extension): seed an OWNED Ultimate MetalGreymon directly in
   * the DB — the THIRD-tier evolution source is NOT a starter Rookie, so it is not in the
   * granted roster (the L-3 escape hatch, like `setLevel`/`seedBalance`: this spec proves
   * the evolve-time contract, not how the MetalGreymon was reached). Catalog Ultimate stats
   * hp120/atk42/def30/spd20 (evolution.ts :541). Returns the owned id.
   */
  const seedOwnedMetalGreymon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'MetalGreymon',
        type: 'Vaccine',
        element: 'Fire',
        stage: 'Ultimate',
        hp: 120,
        atk: 42,
        def: 30,
        spd: 20,
        level,
      },
    });
    return row.id;
  };

  it('TASK-294 (R-17c/R-8 tier-extension): the FIRST Ultimate→Mega line — an owned MetalGreymon evolves to a Mega; stub rng draws a NON-primary, DEFAULT_RNG writes WarGreymon, and a below-level MetalGreymon is refused', async () => {
    // The THIRD (and deepest) evolution TIER ships end-to-end: a player who has a
    // MetalGreymon (reached via the shipped Agumon→Greymon→MetalGreymon flow) can now
    // evolve it a THIRD time into a real Mega, where today the same call is refused
    // "MetalGreymon has no further evolution." Driven through the SERVICE directly with an
    // injected stub rng (the HTTP boundary feeds LIVE_RNG and would flake a specific-form
    // assertion — L-55/L-56).
    const step = EVOLUTION_LINES.MetalGreymon;
    const opts = step.intoOptions!;
    const primary = step.into; // WarGreymon
    const secondary = opts[opts.length - 1]!; // VictoryGreymon — a NON-primary Mega, no override
    expect(primary.name).toBe('WarGreymon');
    expect(primary.stage).toBe('Mega');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (VictoryGreymon).
    const email = 'metalgreymon-mega@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const metalId = await seedOwnedMetalGreymon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, metalId, () => 0.999);
    expect(evolved.id).toBe(metalId);
    expect(evolved.stage).toBe('Mega');
    expect(evolved.name).toBe(secondary.name);
    // Stats are the drawn form's catalog spread PLUS the level-derived training bonus
    // (`evolutionTrainingBonus(level)`); the MetalGreymon is seeded at `requiredLevel` (7),
    // so a non-zero bonus is added on top.
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    // NEVER an off-list form: the landed name is a member of the seeded Mega set.
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(metalId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Mega (WarGreymon) verbatim
    //     (the invariant-5 identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'metalgreymon-mega-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const metalId2 = await seedOwnedMetalGreymon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, metalId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('WarGreymon');
    expect(evolved2.stage).toBe('Mega');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level MetalGreymon is refused "Requires level N" — the evolve
    //     endpoint returns 422 and the DB row is UNCHANGED (still an Ultimate MetalGreymon).
    const email3 = 'metalgreymon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const metalId3 = await seedOwnedMetalGreymon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res = await postEvolve(metalId3, token3);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(String(body.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-296 (R-17c/R-8 tier-extension): seed an OWNED Ultimate WereGarurumon directly in
   * the DB — the THIRD-tier evolution source is NOT a starter Rookie, so it is not in the
   * granted roster (the L-3 escape hatch, like seedOwnedMetalGreymon: this spec proves the
   * evolve-time contract, not how the WereGarurumon was reached). Catalog Ultimate stats
   * hp118/atk44/def26/spd24 (evolution.ts :568). Returns the owned id.
   */
  const seedOwnedWereGarurumon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'WereGarurumon',
        type: 'Vaccine',
        element: 'Ice',
        stage: 'Ultimate',
        hp: 118,
        atk: 44,
        def: 26,
        spd: 24,
        level,
      },
    });
    return row.id;
  };

  it('TASK-296 (R-17c/R-8 tier-extension): the SECOND Ultimate→Mega line — an owned WereGarurumon evolves to a Mega; stub rng draws a NON-primary, DEFAULT_RNG writes MetalGarurumon, and a below-level WereGarurumon is refused', async () => {
    // The THIRD (deepest) evolution TIER ships for a second line end-to-end: a player who has
    // a WereGarurumon (reached via the shipped Gabumon→Garurumon→WereGarurumon flow) can now
    // evolve it a THIRD time into a real Mega, where today the same call is refused
    // "WereGarurumon has no further evolution." Driven through the SERVICE directly with an
    // injected stub rng (the HTTP boundary feeds LIVE_RNG and would flake a specific-form
    // assertion — L-55/L-56).
    const step = EVOLUTION_LINES.WereGarurumon;
    const opts = step.intoOptions!;
    const primary = step.into; // MetalGarurumon
    const secondary = opts[opts.length - 1]!; // Cerberumon — a NON-primary Mega, no override
    expect(primary.name).toBe('MetalGarurumon');
    expect(primary.stage).toBe('Mega');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (Cerberumon).
    const email = 'weregarurumon-mega@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const wereId = await seedOwnedWereGarurumon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, wereId, () => 0.999);
    expect(evolved.id).toBe(wereId);
    expect(evolved.stage).toBe('Mega');
    expect(evolved.name).toBe(secondary.name);
    // Stats are the drawn form's catalog spread PLUS the level-derived training bonus
    // (`evolutionTrainingBonus(level)`); the WereGarurumon is seeded at `requiredLevel` (7),
    // so a non-zero bonus is added on top.
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    // NEVER an off-list form: the landed name is a member of the seeded Mega set.
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(wereId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Mega (MetalGarurumon) verbatim
    //     (the invariant-5 identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'weregarurumon-mega-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const wereId2 = await seedOwnedWereGarurumon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, wereId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('MetalGarurumon');
    expect(evolved2.stage).toBe('Mega');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level WereGarurumon is refused "Requires level N" — the evolve
    //     endpoint returns 422 and the DB row is UNCHANGED (still an Ultimate WereGarurumon).
    const email3 = 'weregarurumon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const wereId3 = await seedOwnedWereGarurumon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res = await postEvolve(wereId3, token3);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(String(body.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-298 (R-17c/R-8 tier-extension): seed an OWNED Ultimate MagnaAngemon directly in
   * the DB — the THIRD-tier evolution source is NOT a starter Rookie, so it is not in the
   * granted roster (the L-3 escape hatch, like seedOwnedWereGarurumon: this spec proves the
   * evolve-time contract, not how the MagnaAngemon was reached). Catalog Ultimate stats
   * hp112/atk40/def26/spd30 (evolution.ts :594). Returns the owned id.
   */
  const seedOwnedMagnaAngemon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'MagnaAngemon',
        type: 'Vaccine',
        element: 'Light',
        stage: 'Ultimate',
        hp: 112,
        atk: 40,
        def: 26,
        spd: 30,
        level,
      },
    });
    return row.id;
  };

  it('TASK-298 (R-17c/R-8 tier-extension): the THIRD Ultimate→Mega line — an owned MagnaAngemon evolves to a Mega; stub rng draws a NON-primary, DEFAULT_RNG writes Seraphimon, and a below-level MagnaAngemon is refused', async () => {
    // A player who has a MagnaAngemon (reached via the shipped Patamon→Angemon→MagnaAngemon
    // flow) can now evolve it a THIRD time into a real Mega, where today the same call is
    // refused "MagnaAngemon has no further evolution." Driven through the SERVICE directly
    // with an injected stub rng (the HTTP boundary feeds LIVE_RNG and would flake a
    // specific-form assertion — L-55/L-56).
    const step = EVOLUTION_LINES.MagnaAngemon;
    const opts = step.intoOptions!;
    const primary = step.into; // Seraphimon
    const secondary = opts[opts.length - 1]!; // Goldramon — a NON-primary Mega, no override
    expect(primary.name).toBe('Seraphimon');
    expect(primary.stage).toBe('Mega');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (Goldramon).
    const email = 'magnaangemon-mega@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const magnaId = await seedOwnedMagnaAngemon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, magnaId, () => 0.999);
    expect(evolved.id).toBe(magnaId);
    expect(evolved.stage).toBe('Mega');
    expect(evolved.name).toBe(secondary.name);
    // Stats are the drawn form's catalog spread PLUS the level-derived training bonus
    // (`evolutionTrainingBonus(level)`); the MagnaAngemon is seeded at `requiredLevel` (7),
    // so a non-zero bonus is added on top.
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    // NEVER an off-list form: the landed name is a member of the seeded Mega set.
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(magnaId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Mega (Seraphimon) verbatim
    //     (the invariant-5 identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'magnaangemon-mega-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const magnaId2 = await seedOwnedMagnaAngemon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, magnaId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('Seraphimon');
    expect(evolved2.stage).toBe('Mega');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level MagnaAngemon is refused "Requires level N" — the evolve
    //     endpoint returns 422 and the DB row is UNCHANGED (still an Ultimate MagnaAngemon).
    const email3 = 'magnaangemon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const magnaId3 = await seedOwnedMagnaAngemon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res = await postEvolve(magnaId3, token3);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(String(body.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-300 (R-17c/R-8 tier-extension): seed an OWNED Ultimate Garudamon directly in the
   * DB — the FOURTH-tier evolution source is NOT a starter Rookie, so it is not in the
   * granted roster (the L-3 escape hatch, like seedOwnedMagnaAngemon: this spec proves the
   * evolve-time contract, not how the Garudamon was reached). Catalog Ultimate stats
   * hp116/atk42/def24/spd28 (evolution.ts :622). Returns the owned id.
   */
  const seedOwnedGarudamon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'Garudamon',
        type: 'Vaccine',
        element: 'Fire',
        stage: 'Ultimate',
        hp: 116,
        atk: 42,
        def: 24,
        spd: 28,
        level,
      },
    });
    return row.id;
  };

  it('TASK-300 (R-17c/R-8 tier-extension): the FOURTH Ultimate→Mega line — an owned Garudamon evolves to a Mega; stub rng draws a NON-primary, DEFAULT_RNG writes Hououmon, and a below-level Garudamon is refused', async () => {
    // A player who has a Garudamon (reached via the shipped Biyomon→Birdramon→Garudamon flow)
    // can now evolve it a THIRD time into a real Mega, where today the same call is refused
    // "Garudamon has no further evolution." Driven through the SERVICE directly with an
    // injected stub rng (the HTTP boundary feeds LIVE_RNG and would flake a specific-form
    // assertion — L-55/L-56).
    const step = EVOLUTION_LINES.Garudamon;
    const opts = step.intoOptions!;
    const primary = step.into; // Hououmon
    const secondary = opts[opts.length - 1]!; // Ornismon — a NON-primary Mega, no override
    expect(primary.name).toBe('Hououmon');
    expect(primary.stage).toBe('Mega');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (Ornismon).
    const email = 'garudamon-mega@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const garudaId = await seedOwnedGarudamon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, garudaId, () => 0.999);
    expect(evolved.id).toBe(garudaId);
    expect(evolved.stage).toBe('Mega');
    expect(evolved.name).toBe(secondary.name);
    // Stats are the drawn form's catalog spread PLUS the level-derived training bonus
    // (`evolutionTrainingBonus(level)`); the Garudamon is seeded at `requiredLevel` (7),
    // so a non-zero bonus is added on top.
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    // NEVER an off-list form: the landed name is a member of the seeded Mega set.
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(garudaId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Mega (Hououmon) verbatim
    //     (the invariant-5 identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'garudamon-mega-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const garudaId2 = await seedOwnedGarudamon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, garudaId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('Hououmon');
    expect(evolved2.stage).toBe('Mega');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level Garudamon is refused "Requires level N" — the evolve
    //     endpoint returns 422 and the DB row is UNCHANGED (still an Ultimate Garudamon).
    const email3 = 'garudamon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const garudaId3 = await seedOwnedGarudamon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res = await postEvolve(garudaId3, token3);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(String(body.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-302 (R-17c/R-8 tier-extension): seed an OWNED Ultimate MegaKabuterimon directly in
   * the DB — the FIFTH-tier evolution source is NOT a starter Rookie, so it is not in the
   * granted roster (the L-3 escape hatch, like seedOwnedGarudamon: this spec proves the
   * evolve-time contract, not how the MegaKabuterimon was reached). Catalog Ultimate stats
   * hp122/atk44/def30/spd18 (evolution.ts :650). Returns the owned id.
   */
  const seedOwnedMegaKabuterimon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'MegaKabuterimon',
        type: 'Vaccine',
        element: 'Electric',
        stage: 'Ultimate',
        hp: 122,
        atk: 44,
        def: 30,
        spd: 18,
        level,
      },
    });
    return row.id;
  };

  it('TASK-302 (R-17c/R-8 tier-extension): the FIFTH Ultimate→Mega line — an owned MegaKabuterimon evolves to a Mega; stub rng draws a NON-primary, DEFAULT_RNG writes HerculesKabuterimon, and a below-level MegaKabuterimon is refused', async () => {
    // A player who has a MegaKabuterimon (reached via the shipped Tentomon→Kabuterimon→
    // MegaKabuterimon flow) can now evolve it a THIRD time into a real Mega, where today the
    // same call is refused "MegaKabuterimon has no further evolution." Driven through the
    // SERVICE directly with an injected stub rng (the HTTP boundary feeds LIVE_RNG and would
    // flake a specific-form assertion — L-55/L-56).
    const step = EVOLUTION_LINES.MegaKabuterimon;
    const opts = step.intoOptions!;
    const primary = step.into; // HerculesKabuterimon
    const secondary = opts[opts.length - 1]!; // TigerVespamon — a NON-primary Mega, no override
    expect(primary.name).toBe('HerculesKabuterimon');
    expect(primary.stage).toBe('Mega');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (TigerVespamon).
    const email = 'megakabuterimon-mega@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const kabuId = await seedOwnedMegaKabuterimon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, kabuId, () => 0.999);
    expect(evolved.id).toBe(kabuId);
    expect(evolved.stage).toBe('Mega');
    expect(evolved.name).toBe(secondary.name);
    // Stats are the drawn form's catalog spread PLUS the level-derived training bonus
    // (`evolutionTrainingBonus(level)`); the MegaKabuterimon is seeded at `requiredLevel` (7),
    // so a non-zero bonus is added on top.
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    // NEVER an off-list form: the landed name is a member of the seeded Mega set.
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(kabuId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Mega (HerculesKabuterimon) verbatim
    //     (the invariant-5 identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'megakabuterimon-mega-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const kabuId2 = await seedOwnedMegaKabuterimon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, kabuId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('HerculesKabuterimon');
    expect(evolved2.stage).toBe('Mega');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level MegaKabuterimon is refused "Requires level N" — the evolve
    //     endpoint returns 422 and the DB row is UNCHANGED (still an Ultimate MegaKabuterimon).
    const email3 = 'megakabuterimon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const kabuId3 = await seedOwnedMegaKabuterimon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res = await postEvolve(kabuId3, token3);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(String(body.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-304 (R-17c/R-8 tier-extension): seed an OWNED Ultimate Lillymon directly in the DB —
   * the SIXTH-tier evolution source is NOT a starter Rookie, so it is not in the granted roster
   * (the L-3 escape hatch, like seedOwnedMegaKabuterimon: this spec proves the evolve-time
   * contract, not how the Lillymon was reached). Type/element are the Palmon line's stored strings
   * ('Data'/'Nature', digimon.seed.ts:144–146). Catalog Ultimate stats hp114/atk40/def22/spd30
   * (evolution.ts :678/:698). Returns the owned id.
   */
  const seedOwnedLillymon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'Lillymon',
        type: 'Data',
        element: 'Nature',
        stage: 'Ultimate',
        hp: 114,
        atk: 40,
        def: 22,
        spd: 30,
        level,
      },
    });
    return row.id;
  };

  it('TASK-304 (R-17c/R-8 tier-extension): the SIXTH Ultimate→Mega line — an owned Lillymon evolves to a Mega; stub rng draws a NON-primary, DEFAULT_RNG writes Rosemon, and a below-level Lillymon is refused', async () => {
    // A player who has a Lillymon (reached via the shipped Palmon→Togemon→Lillymon flow) can now
    // evolve it a THIRD time into a real Mega, where today the same call is refused "Lillymon has
    // no further evolution." Driven through the SERVICE directly with an injected stub rng (the
    // HTTP boundary feeds LIVE_RNG and would flake a specific-form assertion — L-55/L-56).
    const step = EVOLUTION_LINES.Lillymon;
    const opts = step.intoOptions!;
    const primary = step.into; // Rosemon
    const secondary = opts[opts.length - 1]!; // Lilithmon — a NON-primary Mega, no override
    expect(primary.name).toBe('Rosemon');
    expect(primary.stage).toBe('Mega');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (Lilithmon).
    const email = 'lillymon-mega@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const lillyId = await seedOwnedLillymon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, lillyId, () => 0.999);
    expect(evolved.id).toBe(lillyId);
    expect(evolved.stage).toBe('Mega');
    expect(evolved.name).toBe(secondary.name);
    // Stats are the drawn form's catalog spread PLUS the level-derived training bonus
    // (`evolutionTrainingBonus(level)`); the Lillymon is seeded at `requiredLevel` (7), so a
    // non-zero bonus is added on top.
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    // NEVER an off-list form: the landed name is a member of the seeded Mega set.
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(lillyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Mega (Rosemon) verbatim (the invariant-5
    //     identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'lillymon-mega-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const lillyId2 = await seedOwnedLillymon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, lillyId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('Rosemon');
    expect(evolved2.stage).toBe('Mega');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level Lillymon is refused "Requires level N" — the evolve endpoint
    //     returns 422 and the DB row is UNCHANGED (still an Ultimate Lillymon).
    const email3 = 'lillymon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const lillyId3 = await seedOwnedLillymon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res = await postEvolve(lillyId3, token3);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(String(body.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-306 (R-17c/R-8 tier-extension): seed an OWNED Ultimate Zudomon directly in the DB —
   * the SEVENTH-tier evolution source is NOT a starter Rookie, so it is not in the granted roster
   * (the L-3 escape hatch, like seedOwnedLillymon: this spec proves the evolve-time contract, not
   * how the Zudomon was reached). Type/element are the Gomamon line's stored strings
   * ('Vaccine'/'Water', the Gomamon seed). Catalog Ultimate stats hp130/atk42/def32/spd16
   * (evolution.ts :706/:727). Returns the owned id.
   */
  const seedOwnedZudomon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'Zudomon',
        type: 'Vaccine',
        element: 'Water',
        stage: 'Ultimate',
        hp: 130,
        atk: 42,
        def: 32,
        spd: 16,
        level,
      },
    });
    return row.id;
  };

  it('TASK-306 (R-17c/R-8 tier-extension): the SEVENTH Ultimate→Mega line — an owned Zudomon evolves to a Mega; stub rng draws a NON-primary, DEFAULT_RNG writes Vikemon, and a below-level Zudomon is refused', async () => {
    // A player who has a Zudomon (reached via the shipped Gomamon→Ikkakumon→Zudomon flow) can now
    // evolve it a THIRD time into a real Mega, where today the same call is refused "Zudomon has
    // no further evolution." Driven through the SERVICE directly with an injected stub rng (the
    // HTTP boundary feeds LIVE_RNG and would flake a specific-form assertion — L-55/L-56).
    const step = EVOLUTION_LINES.Zudomon;
    const opts = step.intoOptions!;
    const primary = step.into; // Vikemon
    const secondary = opts[opts.length - 1]!; // Plesiomon — a NON-primary Mega, no override
    expect(primary.name).toBe('Vikemon');
    expect(primary.stage).toBe('Mega');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (Plesiomon).
    const email = 'zudomon-mega@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const zudoId = await seedOwnedZudomon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, zudoId, () => 0.999);
    expect(evolved.id).toBe(zudoId);
    expect(evolved.stage).toBe('Mega');
    expect(evolved.name).toBe(secondary.name);
    // Stats are the drawn form's catalog spread PLUS the level-derived training bonus
    // (`evolutionTrainingBonus(level)`); the Zudomon is seeded at `requiredLevel` (7), so a
    // non-zero bonus is added on top.
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    // NEVER an off-list form: the landed name is a member of the seeded Mega set.
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(zudoId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Mega (Vikemon) verbatim (the invariant-5
    //     identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'zudomon-mega-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const zudoId2 = await seedOwnedZudomon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, zudoId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('Vikemon');
    expect(evolved2.stage).toBe('Mega');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level Zudomon is refused "Requires level N" — the evolve endpoint
    //     returns 422 and the DB row is UNCHANGED (still an Ultimate Zudomon).
    const email3 = 'zudomon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const zudoId3 = await seedOwnedZudomon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res3 = await postEvolve(zudoId3, token3);
    expect(res3.status).toBe(422);
    const body3 = (await res3.json()) as { message?: string };
    expect(String(body3.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-308 (R-17c/R-8 tier-extension): seed an OWNED Ultimate Paildramon directly in the DB —
   * the EIGHTH-and-FINAL-primary Ultimate→Mega source is NOT a starter Rookie, so it is not in the
   * granted roster (the L-3 escape hatch, like seedOwnedZudomon: this spec proves the evolve-time
   * contract, not how the Paildramon was reached). Type/element are Veemon's stored strings
   * ('Free'/'Neutral', the Veemon seed :115/:166). Catalog Ultimate stats hp134/atk46/def28/spd20
   * (evolution.ts :735/:757). Returns the owned id.
   */
  const seedOwnedPaildramon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'Paildramon',
        type: 'Free',
        element: 'Neutral',
        stage: 'Ultimate',
        hp: 134,
        atk: 46,
        def: 28,
        spd: 20,
        level,
      },
    });
    return row.id;
  };

  it('TASK-308 (R-17c/R-8 tier-extension): the EIGHTH — and FINAL PRIMARY — Ultimate→Mega line — an owned Paildramon evolves to a Mega; stub rng draws a NON-primary, DEFAULT_RNG writes Imperialdramon, and a below-level Paildramon is refused', async () => {
    // A player who has a Paildramon (reached via the shipped Veemon→ExVeemon→Paildramon flow) can
    // now evolve it a THIRD time into a real Mega, where today the same call is refused "Paildramon
    // has no further evolution." This CLOSES the primary-Ultimate Mega set. Driven through the
    // SERVICE directly with an injected stub rng (the HTTP boundary feeds LIVE_RNG and would flake a
    // specific-form assertion — L-55/L-56).
    const step = EVOLUTION_LINES.Paildramon;
    const opts = step.intoOptions!;
    const primary = step.into; // Imperialdramon
    const secondary = opts[opts.length - 1]!; // UlforceVeedramon — a NON-primary Mega, no override
    expect(primary.name).toBe('Imperialdramon');
    expect(primary.stage).toBe('Mega');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (UlforceVeedramon).
    const email = 'paildramon-mega@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const pailId = await seedOwnedPaildramon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, pailId, () => 0.999);
    expect(evolved.id).toBe(pailId);
    expect(evolved.stage).toBe('Mega');
    expect(evolved.name).toBe(secondary.name);
    // Stats are the drawn form's catalog spread PLUS the level-derived training bonus
    // (`evolutionTrainingBonus(level)`); the Paildramon is seeded at `requiredLevel` (7), so a
    // non-zero bonus is added on top.
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    // NEVER an off-list form: the landed name is a member of the seeded Mega set.
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(pailId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Mega (Imperialdramon) verbatim (the invariant-5
    //     identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'paildramon-mega-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const pailId2 = await seedOwnedPaildramon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, pailId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('Imperialdramon');
    expect(evolved2.stage).toBe('Mega');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level Paildramon is refused "Requires level N" — the evolve endpoint
    //     returns 422 and the DB row is UNCHANGED (still an Ultimate Paildramon).
    const email3 = 'paildramon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const pailId3 = await seedOwnedPaildramon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res3 = await postEvolve(pailId3, token3);
    expect(res3.status).toBe(422);
    const body3 = (await res3.json()) as { message?: string };
    expect(String(body3.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-286 (R-17c/R-8): seed an OWNED Champion Garurumon directly (the SECOND
   * Champion→Ultimate source; like Greymon it is not a granted starter Rookie — the
   * L-3 escape hatch). Returns the owned id.
   */
  const seedOwnedGarurumon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'Garurumon',
        type: 'Vaccine',
        element: 'Ice',
        stage: 'Champion',
        hp: 88,
        atk: 28,
        def: 16,
        spd: 18,
        level,
      },
    });
    return row.id;
  };

  it('TASK-286 (R-17c/R-8): the SECOND Champion→Ultimate line — an owned Garurumon evolves to an Ultimate; stub rng draws a NON-primary, DEFAULT_RNG writes WereGarurumon, and a below-level Garurumon is refused', async () => {
    // Mirrors the shipped Greymon second-tier case one species over: a player who has a
    // Garurumon (e.g. evolved from a Gabumon via the shipped flow) can now evolve it AGAIN
    // into a real Ultimate, where today the same call is refused "Garurumon has no further
    // evolution." Driven through the SERVICE with an injected stub rng (the HTTP boundary
    // feeds LIVE_RNG and would flake a specific-form assertion — L-55/L-56).
    const step = EVOLUTION_LINES.Garurumon;
    const opts = step.intoOptions!;
    const primary = step.into; // WereGarurumon
    const secondary = opts[opts.length - 1]!; // MegaSeadramon — a NON-primary Ultimate, no override
    expect(primary.name).toBe('WereGarurumon');
    expect(primary.stage).toBe('Ultimate');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (MegaSeadramon).
    const email = 'garurumon-ultimate@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const garurumonId = await seedOwnedGarurumon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, garurumonId, () => 0.999);
    expect(evolved.id).toBe(garurumonId);
    expect(evolved.stage).toBe('Ultimate');
    expect(evolved.name).toBe(secondary.name);
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(garurumonId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Ultimate (WereGarurumon) verbatim
    //     (the invariant-5 identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'garurumon-ultimate-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const garurumonId2 = await seedOwnedGarurumon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, garurumonId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('WereGarurumon');
    expect(evolved2.stage).toBe('Ultimate');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level Garurumon is refused "Requires level N" (422, DB unchanged).
    const email3 = 'garurumon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const garurumonId3 = await seedOwnedGarurumon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res = await postEvolve(garurumonId3, token3);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(String(body.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-287 (R-17c/R-8): seed an OWNED Champion Angemon directly (the THIRD
   * Champion→Ultimate source; like Greymon/Garurumon it is not a granted starter
   * Rookie — the L-3 escape hatch). Angemon is a speed-tilted Champion. Returns the id.
   */
  const seedOwnedAngemon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'Angemon',
        type: 'Vaccine',
        element: 'Light',
        stage: 'Champion',
        hp: 82,
        atk: 24,
        def: 16,
        spd: 22,
        level,
      },
    });
    return row.id;
  };

  it('TASK-287 (R-17c/R-8): the THIRD Champion→Ultimate line — an owned Angemon evolves to an Ultimate; stub rng draws a NON-primary, DEFAULT_RNG writes MagnaAngemon, and a below-level Angemon is refused', async () => {
    // Mirrors the shipped Greymon/Garurumon second-tier cases one species over: a player
    // who has an Angemon (e.g. evolved from a Patamon via the shipped flow) can now evolve
    // it AGAIN into a real Ultimate, where today the same call is refused "Angemon has no
    // further evolution." Driven through the SERVICE with an injected stub rng (the HTTP
    // boundary feeds LIVE_RNG and would flake a specific-form assertion — L-55/L-56).
    const step = EVOLUTION_LINES.Angemon;
    const opts = step.intoOptions!;
    const primary = step.into; // MagnaAngemon
    const secondary = opts[opts.length - 1]!; // SkullSatamon — a NON-primary Ultimate, no override
    expect(primary.name).toBe('MagnaAngemon');
    expect(primary.stage).toBe('Ultimate');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (SkullSatamon).
    const email = 'angemon-ultimate@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const angemonId = await seedOwnedAngemon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, angemonId, () => 0.999);
    expect(evolved.id).toBe(angemonId);
    expect(evolved.stage).toBe('Ultimate');
    expect(evolved.name).toBe(secondary.name);
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(angemonId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Ultimate (MagnaAngemon) verbatim
    //     (the invariant-5 identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'angemon-ultimate-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const angemonId2 = await seedOwnedAngemon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, angemonId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('MagnaAngemon');
    expect(evolved2.stage).toBe('Ultimate');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level Angemon is refused "Requires level N" (422, DB unchanged).
    const email3 = 'angemon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const angemonId3 = await seedOwnedAngemon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res = await postEvolve(angemonId3, token3);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(String(body.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-288 (R-17c/R-8): seed an OWNED Champion Birdramon directly (the FOURTH
   * Champion→Ultimate source; like Greymon/Garurumon/Angemon it is not a granted
   * starter Rookie — the L-3 escape hatch). Birdramon is a fire/flying Champion
   * (hp84/atk26/def16/spd20). Returns the id.
   */
  const seedOwnedBirdramon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'Birdramon',
        type: 'Vaccine',
        element: 'Fire',
        stage: 'Champion',
        hp: 84,
        atk: 26,
        def: 16,
        spd: 20,
        level,
      },
    });
    return row.id;
  };

  it('TASK-288 (R-17c/R-8): the FOURTH Champion→Ultimate line — an owned Birdramon evolves to an Ultimate; stub rng draws a NON-primary, DEFAULT_RNG writes Garudamon, and a below-level Birdramon is refused', async () => {
    // Mirrors the shipped Greymon/Garurumon/Angemon second-tier cases one species over: a
    // player who has a Birdramon (e.g. evolved from a Biyomon via the shipped flow) can now
    // evolve it AGAIN into a real Ultimate, where today the same call is refused "Birdramon
    // has no further evolution." Driven through the SERVICE with an injected stub rng (the
    // HTTP boundary feeds LIVE_RNG and would flake a specific-form assertion — L-55/L-56).
    const step = EVOLUTION_LINES.Birdramon;
    const opts = step.intoOptions!;
    const primary = step.into; // Garudamon
    const secondary = opts[opts.length - 1]!; // Crowmon — a NON-primary Ultimate, no override
    expect(primary.name).toBe('Garudamon');
    expect(primary.stage).toBe('Ultimate');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (Crowmon).
    const email = 'birdramon-ultimate@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const birdramonId = await seedOwnedBirdramon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, birdramonId, () => 0.999);
    expect(evolved.id).toBe(birdramonId);
    expect(evolved.stage).toBe('Ultimate');
    expect(evolved.name).toBe(secondary.name);
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(birdramonId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Ultimate (Garudamon) verbatim
    //     (the invariant-5 identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'birdramon-ultimate-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const birdramonId2 = await seedOwnedBirdramon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, birdramonId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('Garudamon');
    expect(evolved2.stage).toBe('Ultimate');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level Birdramon is refused "Requires level N" (422, DB unchanged).
    const email3 = 'birdramon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const birdramonId3 = await seedOwnedBirdramon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res = await postEvolve(birdramonId3, token3);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(String(body.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-289 (R-17c/R-8): seed an OWNED Champion Kabuterimon directly (the FIFTH
   * Champion→Ultimate source; like Greymon/Garurumon/Angemon/Birdramon it is not a
   * granted starter Rookie — the L-3 escape hatch). Kabuterimon is an insect/electric
   * Champion (hp90/atk24/def22/spd14). Returns the id.
   */
  const seedOwnedKabuterimon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'Kabuterimon',
        type: 'Vaccine',
        element: 'Electric',
        stage: 'Champion',
        hp: 90,
        atk: 24,
        def: 22,
        spd: 14,
        level,
      },
    });
    return row.id;
  };

  it('TASK-289 (R-17c/R-8): the FIFTH Champion→Ultimate line — an owned Kabuterimon evolves to an Ultimate; stub rng draws a NON-primary, DEFAULT_RNG writes MegaKabuterimon, and a below-level Kabuterimon is refused', async () => {
    // Mirrors the shipped Greymon/Garurumon/Angemon/Birdramon second-tier cases one species
    // over: a player who has a Kabuterimon (e.g. evolved from a Tentomon via the shipped flow)
    // can now evolve it AGAIN into a real Ultimate, where today the same call is refused
    // "Kabuterimon has no further evolution." Driven through the SERVICE with an injected stub
    // rng (the HTTP boundary feeds LIVE_RNG and would flake a specific-form assertion — L-55/L-56).
    const step = EVOLUTION_LINES.Kabuterimon;
    const opts = step.intoOptions!;
    const primary = step.into; // MegaKabuterimon
    const secondary = opts[opts.length - 1]!; // Digitamamon — a NON-primary Ultimate, no override
    expect(primary.name).toBe('MegaKabuterimon');
    expect(primary.stage).toBe('Ultimate');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (Digitamamon).
    const email = 'kabuterimon-ultimate@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const kabuterimonId = await seedOwnedKabuterimon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, kabuterimonId, () => 0.999);
    expect(evolved.id).toBe(kabuterimonId);
    expect(evolved.stage).toBe('Ultimate');
    expect(evolved.name).toBe(secondary.name);
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(kabuterimonId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Ultimate (MegaKabuterimon) verbatim
    //     (the invariant-5 identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'kabuterimon-ultimate-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const kabuterimonId2 = await seedOwnedKabuterimon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, kabuterimonId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('MegaKabuterimon');
    expect(evolved2.stage).toBe('Ultimate');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level Kabuterimon is refused "Requires level N" (422, DB unchanged).
    const email3 = 'kabuterimon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const kabuterimonId3 = await seedOwnedKabuterimon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res = await postEvolve(kabuterimonId3, token3);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(String(body.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-290 (R-17c/R-8): seed an OWNED Champion Togemon directly (the SIXTH
   * Champion→Ultimate source; like Greymon/Garurumon/Angemon/Birdramon/Kabuterimon it is
   * not a granted starter Rookie — the L-3 escape hatch). Togemon is a nature/plant
   * Champion (hp88/atk26/def18/spd16). Returns the id.
   */
  const seedOwnedTogemon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'Togemon',
        type: 'Data',
        element: 'Plant',
        stage: 'Champion',
        hp: 88,
        atk: 26,
        def: 18,
        spd: 16,
        level,
      },
    });
    return row.id;
  };

  it('TASK-290 (R-17c/R-8): the SIXTH Champion→Ultimate line — an owned Togemon evolves to an Ultimate; stub rng draws a NON-primary, DEFAULT_RNG writes Lillymon, and a below-level Togemon is refused', async () => {
    // Mirrors the shipped Greymon/Garurumon/Angemon/Birdramon/Kabuterimon second-tier cases one
    // species over: a player who has a Togemon (e.g. evolved from a Palmon via the shipped flow)
    // can now evolve it AGAIN into a real Ultimate, where today the same call is refused
    // "Togemon has no further evolution." Driven through the SERVICE with an injected stub
    // rng (the HTTP boundary feeds LIVE_RNG and would flake a specific-form assertion — L-55/L-56).
    const step = EVOLUTION_LINES.Togemon;
    const opts = step.intoOptions!;
    const primary = step.into; // Lillymon
    const secondary = opts[opts.length - 1]!; // Cherrymon — a NON-primary Ultimate, no override
    expect(primary.name).toBe('Lillymon');
    expect(primary.stage).toBe('Ultimate');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (Cherrymon).
    const email = 'togemon-ultimate@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const togemonId = await seedOwnedTogemon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, togemonId, () => 0.999);
    expect(evolved.id).toBe(togemonId);
    expect(evolved.stage).toBe('Ultimate');
    expect(evolved.name).toBe(secondary.name);
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(togemonId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Ultimate (Lillymon) verbatim
    //     (the invariant-5 identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'togemon-ultimate-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const togemonId2 = await seedOwnedTogemon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, togemonId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('Lillymon');
    expect(evolved2.stage).toBe('Ultimate');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level Togemon is refused "Requires level N" (422, DB unchanged).
    const email3 = 'togemon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const togemonId3 = await seedOwnedTogemon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res = await postEvolve(togemonId3, token3);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(String(body.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-291 (R-17c/R-8): seed an OWNED Champion Ikkakumon directly (the SEVENTH
   * Champion→Ultimate source; like Greymon/Garurumon/Angemon/Birdramon/Kabuterimon/Togemon it is
   * not a granted starter Rookie — the L-3 escape hatch). Ikkakumon is a sea-beast/ice
   * Champion (hp92/atk28/def20/spd12). Returns the id.
   */
  const seedOwnedIkkakumon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'Ikkakumon',
        type: 'Vaccine',
        element: 'Water',
        stage: 'Champion',
        hp: 92,
        atk: 28,
        def: 20,
        spd: 12,
        level,
      },
    });
    return row.id;
  };

  it('TASK-291 (R-17c/R-8): the SEVENTH Champion→Ultimate line — an owned Ikkakumon evolves to an Ultimate; stub rng draws a NON-primary, DEFAULT_RNG writes Zudomon, and a below-level Ikkakumon is refused', async () => {
    // Mirrors the shipped Greymon/Garurumon/Angemon/Birdramon/Kabuterimon/Togemon second-tier cases
    // one species over: a player who has an Ikkakumon (e.g. evolved from a Gomamon via the shipped
    // flow) can now evolve it AGAIN into a real Ultimate, where today the same call is refused
    // "Ikkakumon has no further evolution." Driven through the SERVICE with an injected stub
    // rng (the HTTP boundary feeds LIVE_RNG and would flake a specific-form assertion — L-55/L-56).
    const step = EVOLUTION_LINES.Ikkakumon;
    const opts = step.intoOptions!;
    const primary = step.into; // Zudomon
    const secondary = opts[opts.length - 1]!; // MarineDevimon — a NON-primary Ultimate, no override
    expect(primary.name).toBe('Zudomon');
    expect(primary.stage).toBe('Ultimate');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (MarineDevimon).
    const email = 'ikkakumon-ultimate@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const ikkakumonId = await seedOwnedIkkakumon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, ikkakumonId, () => 0.999);
    expect(evolved.id).toBe(ikkakumonId);
    expect(evolved.stage).toBe('Ultimate');
    expect(evolved.name).toBe(secondary.name);
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(ikkakumonId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Ultimate (Zudomon) verbatim
    //     (the invariant-5 identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'ikkakumon-ultimate-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const ikkakumonId2 = await seedOwnedIkkakumon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, ikkakumonId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('Zudomon');
    expect(evolved2.stage).toBe('Ultimate');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level Ikkakumon is refused "Requires level N" (422, DB unchanged).
    const email3 = 'ikkakumon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const ikkakumonId3 = await seedOwnedIkkakumon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res = await postEvolve(ikkakumonId3, token3);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(String(body.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  /**
   * TASK-292 (R-17c/R-8): seed an OWNED Champion ExVeemon directly (the EIGHTH — and FINAL
   * PRIMARY — Champion→Ultimate source; like Greymon/Garurumon/Angemon/Birdramon/Kabuterimon/
   * Togemon/Ikkakumon it is not a granted starter Rookie — the L-3 escape hatch). ExVeemon is
   * a dragon-man Champion (hp90/atk28/def18/spd16, evolution.ts:433). Returns the id.
   */
  const seedOwnedExVeemon = async (email: string, level: number): Promise<string> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.digimon.create({
      data: {
        userId,
        name: 'ExVeemon',
        type: 'Free',
        element: 'Neutral',
        stage: 'Champion',
        hp: 90,
        atk: 28,
        def: 18,
        spd: 16,
        level,
      },
    });
    return row.id;
  };

  it('TASK-292 (R-17c/R-8): the EIGHTH (FINAL PRIMARY) Champion→Ultimate line — an owned ExVeemon evolves to an Ultimate; stub rng draws a NON-primary, DEFAULT_RNG writes Paildramon, and a below-level ExVeemon is refused', async () => {
    // Mirrors the shipped Greymon/Garurumon/Angemon/Birdramon/Kabuterimon/Togemon/Ikkakumon
    // second-tier cases one species over, CLOSING the whole-roster primary-Champion Ultimate child:
    // a player who has an ExVeemon (e.g. evolved from a Veemon via the shipped flow) can now evolve
    // it AGAIN into a real Ultimate, where today the same call is refused "ExVeemon has no further
    // evolution." Driven through the SERVICE with an injected stub rng (the HTTP boundary feeds
    // LIVE_RNG and would flake a specific-form assertion — L-55/L-56).
    const step = EVOLUTION_LINES.ExVeemon;
    const opts = step.intoOptions!;
    const primary = step.into; // Paildramon
    const secondary = opts[opts.length - 1]!; // Cyberdramon — a NON-primary Ultimate, no override
    expect(primary.name).toBe('Paildramon');
    expect(primary.stage).toBe('Ultimate');
    expect(secondary.name).not.toBe(primary.name);
    expect(secondary.cost).toBeUndefined();

    // (1) A high stub rng → Math.floor(0.999 * 3) === 2 → the LAST option (Cyberdramon).
    const email = 'exveemon-ultimate@example.test';
    const token = await registerAndLogin(email);
    expect(typeof token).toBe('string');
    const exveemonId = await seedOwnedExVeemon(email, step.requiredLevel);
    await seedBalance(email, step.cost.resource, step.cost.amount + 100);
    const balanceBefore = step.cost.amount + 100;

    const evolved = await evolveViaService(email, exveemonId, () => 0.999);
    expect(evolved.id).toBe(exveemonId);
    expect(evolved.stage).toBe('Ultimate');
    expect(evolved.name).toBe(secondary.name);
    const bonus = evolutionTrainingBonus(step.requiredLevel);
    expect(evolved.hp).toBe(secondary.hp + bonus.hp);
    expect(evolved.atk).toBe(secondary.atk + bonus.atk);
    expect(opts.map((o) => o.name)).toContain(evolved.name);

    // Exactly ONE evolve audit row; the debit is the SOURCE cost (invariant 3 shape
    // byte-unchanged — ONE cost per source, no per-target override this slice).
    const rows = await evolveAuditRows(exveemonId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    expect(await balanceAmount(email, step.cost.resource)).toBe(balanceBefore - step.cost.amount);

    // (2) A second player, DEFAULT_RNG → the PRIMARY Ultimate (Paildramon) verbatim
    //     (the invariant-5 identity anchor — the default-covered / HTTP-boundary form).
    const email2 = 'exveemon-ultimate-default@example.test';
    const token2 = await registerAndLogin(email2);
    expect(typeof token2).toBe('string');
    const exveemonId2 = await seedOwnedExVeemon(email2, step.requiredLevel);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const evolved2 = await evolveViaService(email2, exveemonId2, DEFAULT_RNG);
    expect(evolved2.name).toBe('Paildramon');
    expect(evolved2.stage).toBe('Ultimate');
    expect(evolved2.hp).toBe(primary.hp + bonus.hp);
    expect(evolved2.atk).toBe(primary.atk + bonus.atk);

    // (3) A below-required-level ExVeemon is refused "Requires level N" (422, DB unchanged).
    const email3 = 'exveemon-underlevel@example.test';
    const token3 = await registerAndLogin(email3);
    const exveemonId3 = await seedOwnedExVeemon(email3, step.requiredLevel - 1);
    await seedBalance(email3, step.cost.resource, step.cost.amount + 100);
    const res3 = await postEvolve(exveemonId3, token3);
    expect(res3.status).toBe(422);
    const body3 = (await res3.json()) as { message?: string };
    expect(String(body3.message)).toContain(`Requires level ${step.requiredLevel}`);
  });

  it('TASK-213 (R-27a): Veemon debits a PER-TARGET DIVERGENT cost when Veedramon is drawn (60), source cost otherwise (45)', async () => {
    // The divergent-cost slice: the middle option Veedramon carries its OWN
    // cost override (Meat 60); ExVeemon (anchor) and Lynxmon fall back to the
    // source-step Meat 45. Drive the SERVICE directly with a stub rng because the
    // HTTP boundary feeds LIVE_RNG (L-55/L-56). Math.floor(rng()*3): 0.5 → index 1
    // (Veedramon, the divergent form); 0.999 → index 2 (Lynxmon, no override);
    // DEFAULT_RNG → index 0 (ExVeemon, no override).
    const veemon = EVOLUTION_LINES.Veemon;
    const opts = veemon.intoOptions!;
    const veedramon = opts[1]!;
    const lynxmon = opts[2]!;
    expect(veedramon.name).toBe('Veedramon');
    expect(veedramon.cost).toEqual({ resource: 'Meat', amount: 60 });

    // (1) Draw Veedramon → debit its OWN cost (60), audit records -60, stats applied.
    const emailV = 'divergent-veedramon@example.test';
    const tokenV = await registerAndLogin(emailV);
    const rosterV = await getRoster(tokenV);
    const starterV = rosterV.find((d) => d.name === 'Veemon');
    if (starterV === undefined) throw new Error('test fixture drift: no Veemon in the roster');
    await seedBalance(emailV, 'Meat', 200);
    const midRng: Rng = () => 0.5;
    const evolvedV = await evolveViaService(emailV, starterV.id, midRng);
    expect(evolvedV.name).toBe('Veedramon');
    expect(evolvedV.hp).toBe(veedramon.hp);
    expect(evolvedV.atk).toBe(veedramon.atk);
    const rowsV = await evolveAuditRows(starterV.id);
    expect(rowsV).toHaveLength(1);
    expect(rowsV[0]!.action).toBe('evolve');
    expect(rowsV[0]!.resource).toBe('Meat');
    expect(rowsV[0]!.amountAfter - rowsV[0]!.amountBefore).toBe(-60);
    expect(await balanceAmount(emailV, 'Meat')).toBe(200 - 60);

    // (2) Draw Lynxmon (no override) → debit the SOURCE cost (45), not 60.
    const emailL = 'divergent-lynxmon@example.test';
    const tokenL = await registerAndLogin(emailL);
    const rosterL = await getRoster(tokenL);
    const starterL = rosterL.find((d) => d.name === 'Veemon');
    if (starterL === undefined) throw new Error('test fixture drift: no Veemon in roster (L)');
    await seedBalance(emailL, 'Meat', 200);
    const evolvedL = await evolveViaService(emailL, starterL.id, () => 0.999);
    expect(evolvedL.name).toBe(lynxmon.name);
    const rowsL = await evolveAuditRows(starterL.id);
    expect(rowsL[0]!.amountAfter - rowsL[0]!.amountBefore).toBe(-veemon.cost.amount);
    expect(veemon.cost.amount).toBe(45);
    expect(await balanceAmount(emailL, 'Meat')).toBe(200 - 45);

    // (3) DEFAULT_RNG → ExVeemon (anchor, no override) → SOURCE cost (45).
    const emailX = 'divergent-exveemon@example.test';
    const tokenX = await registerAndLogin(emailX);
    const rosterX = await getRoster(tokenX);
    const starterX = rosterX.find((d) => d.name === 'Veemon');
    if (starterX === undefined) throw new Error('test fixture drift: no Veemon in roster (X)');
    await seedBalance(emailX, 'Meat', 200);
    const evolvedX = await evolveViaService(emailX, starterX.id, DEFAULT_RNG);
    expect(evolvedX.name).toBe('ExVeemon');
    const rowsX = await evolveAuditRows(starterX.id);
    expect(rowsX[0]!.amountAfter - rowsX[0]!.amountBefore).toBe(-45);
    expect(await balanceAmount(emailX, 'Meat')).toBe(200 - 45);
  });

  it('TASK-214 (R-27a): Gomamon debits a RESOURCE-VARYING cost when Shellmon is drawn (Bits 30, a DIFFERENT currency), source Meat cost otherwise (45)', async () => {
    // The resource-varying slice: the LAST option Shellmon carries its OWN cost
    // override naming a DIFFERENT resource (Bits 30); Ikkakumon (anchor) and Coelamon
    // fall back to the source-step Meat 45. The evolve $transaction is fully
    // resource-agnostic (reads cost.resource at balance-read/guard/decrement/audit), so
    // a Bits override debits the Bits ResourceBalance row with ZERO service change.
    // Drive the SERVICE directly with a stub rng because the HTTP boundary feeds
    // LIVE_RNG (L-55/L-56). Math.floor(rng()*3): 0.999 → index 2 (Shellmon, the
    // resource-varying form); DEFAULT_RNG → index 0 (Ikkakumon, no override).
    const gomamon = EVOLUTION_LINES.Gomamon;
    const opts = gomamon.intoOptions!;
    const shellmon = opts[2]!;
    expect(shellmon.name).toBe('Shellmon');
    expect(shellmon.cost).toEqual({ resource: 'Bits', amount: 30 });

    // (1) Draw Shellmon → debit its OWN resource (Bits 30). Seed BOTH a Meat AND a Bits
    // balance to prove the debit comes out of Bits and the Meat balance is UNTOUCHED.
    const emailS = 'resourcevary-shellmon@example.test';
    const tokenS = await registerAndLogin(emailS);
    const rosterS = await getRoster(tokenS);
    const starterS = rosterS.find((d) => d.name === 'Gomamon');
    if (starterS === undefined) throw new Error('test fixture drift: no Gomamon in the roster');
    await seedBalance(emailS, 'Meat', 200);
    await seedBalance(emailS, 'Bits', 100);
    const evolvedS = await evolveViaService(emailS, starterS.id, () => 0.999);
    expect(evolvedS.name).toBe('Shellmon');
    expect(evolvedS.hp).toBe(shellmon.hp);
    expect(evolvedS.atk).toBe(shellmon.atk);
    const rowsS = await evolveAuditRows(starterS.id);
    expect(rowsS).toHaveLength(1);
    expect(rowsS[0]!.action).toBe('evolve');
    expect(rowsS[0]!.resource).toBe('Bits');
    expect(rowsS[0]!.amountAfter - rowsS[0]!.amountBefore).toBe(-30);
    // The Bits balance dropped by 30; the Meat balance is UNTOUCHED (200).
    expect(await balanceAmount(emailS, 'Bits')).toBe(100 - 30);
    expect(await balanceAmount(emailS, 'Meat')).toBe(200);

    // (2) DEFAULT_RNG → Ikkakumon (anchor, no override) → SOURCE Meat cost (45).
    const emailI = 'resourcevary-ikkakumon@example.test';
    const tokenI = await registerAndLogin(emailI);
    const rosterI = await getRoster(tokenI);
    const starterI = rosterI.find((d) => d.name === 'Gomamon');
    if (starterI === undefined) throw new Error('test fixture drift: no Gomamon in roster (I)');
    await seedBalance(emailI, 'Meat', 200);
    const evolvedI = await evolveViaService(emailI, starterI.id, DEFAULT_RNG);
    expect(evolvedI.name).toBe('Ikkakumon');
    const rowsI = await evolveAuditRows(starterI.id);
    expect(rowsI[0]!.resource).toBe('Meat');
    expect(rowsI[0]!.amountAfter - rowsI[0]!.amountBefore).toBe(-gomamon.cost.amount);
    expect(gomamon.cost.amount).toBe(45);
    expect(await balanceAmount(emailI, 'Meat')).toBe(200 - 45);
  });

  it('blocks an evolve the player cannot afford → 422 and NOTHING is mutated (atomic rollback)', async () => {
    // The insufficient-balance path: with a balance BELOW the cost, the evolve is
    // blocked with a clear 422 reason AND the whole transaction rolls back — the
    // Digimon stays a Rookie, the balance is untouched, and NO audit row is written
    // (no partial spend, no orphan ledger row — invariant 3's atomicity).
    const email = 'broke-evolve@example.test';
    const token = await registerAndLogin(email);

    const roster = await getRoster(token);
    const starter = anEvolvableStarter(roster);
    const { cost } = EVOLUTION_LINES[starter.name];
    expect(starter.stage).toBe('Rookie');

    // Seed STRICTLY below the cost (cost − 1) — a real balance row exists but cannot
    // cover the price, so the guard's `amount < cost.amount` branch fires (this also
    // proves the guard checks the AMOUNT, not merely row-existence).
    const seeded = cost.amount - 1;
    await seedBalance(email, cost.resource, seeded);

    const res = await postEvolve(starter.id, token);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(typeof body.message).toBe('string');
    // The player-facing reason names the requirement (amount + resource) so the UI
    // can surface it in a role="alert" (TASK-25).
    expect(body.message).toContain(String(cost.amount));
    expect(body.message).toContain(cost.resource);

    // Rollback proof #1: the Digimon is UNCHANGED — still the Rookie starter (a
    // fresh GET /digimon shows the original name/stage, never the Champion form).
    const afterRoster = await getRoster(token);
    const untouched = afterRoster.find((d) => d.id === starter.id);
    expect(untouched).toBeDefined();
    expect(untouched?.name).toBe(starter.name);
    expect(untouched?.stage).toBe('Rookie');

    // Rollback proof #2: the balance is UNCHANGED (the failed debit was rolled back
    // — it still reads exactly what we seeded, not seeded − cost, and certainly not
    // a negative amount).
    const remaining = await balanceAmount(email, cost.resource);
    expect(remaining).toBe(seeded);

    // Rollback proof #3: NO audit row was written for this blocked evolve — the
    // ledger records only mutations that actually committed.
    const rows = await evolveAuditRows(starter.id);
    expect(rows).toHaveLength(0);
  });

  it('TRAINED-EVOLVES-STRONGER (R-26a/TASK-195): a trained (higher-level) creature evolves with stats STRICTLY GREATER than an untrained one; the audit/debit shape is byte-unchanged', async () => {
    // The observable a player asked for (I-14): training before evolving pays off.
    //  - Player 1 evolves at the BASE level -> evolved stats == the catalog `into`
    //    verbatim (byte-identical to R-8/TASK-188 — the invariant-5 identity anchor);
    //  - Player 2 evolves the SAME species bumped to a trained level -> evolved stats
    //    are STRICTLY GREATER on each stat (== catalog `into` + evolutionTrainingBonus).
    // Driven through the service with DEFAULT_RNG so the drawn form is the primary
    // (Greymon) verbatim — the ONLY variable across the two players is the level.
    const step = EVOLUTION_LINES.Agumon;
    const into = step.into;

    // Player 1 — untrained (base level 1).
    const email1 = 'untrained-evolve@example.test';
    const token1 = await registerAndLogin(email1);
    const roster1 = await getRoster(token1);
    const base1 = roster1.find((d) => d.name === 'Agumon');
    if (base1 === undefined) throw new Error('test fixture drift: no Agumon in roster1');
    expect(base1.level).toBe(1); // the identity anchor precondition
    await seedBalance(email1, step.cost.resource, step.cost.amount + 100);
    const untrained = await evolveViaService(email1, base1.id);

    // Untrained evolve writes the verbatim catalog stats (the zero-bonus identity).
    expect(untrained.name).toBe(into.name);
    expect(untrained.hp).toBe(into.hp);
    expect(untrained.atk).toBe(into.atk);
    expect(untrained.def).toBe(into.def);
    expect(untrained.spd).toBe(into.spd);

    // Player 2 — TRAINED to a high level before evolving the same species.
    const email2 = 'trained-evolve@example.test';
    const token2 = await registerAndLogin(email2);
    const roster2 = await getRoster(token2);
    const base2 = roster2.find((d) => d.name === 'Agumon');
    if (base2 === undefined) throw new Error('test fixture drift: no Agumon in roster2');
    const trainedLevel = await setLevel(base2.id, 20);
    await seedBalance(email2, step.cost.resource, step.cost.amount + 100);
    const trained = await evolveViaService(email2, base2.id);

    // Same target FORM (DEFAULT_RNG -> primary), but stats are the catalog `into` PLUS
    // the level-derived training bonus — STRICTLY GREATER on every stat than untrained.
    const bonus = evolutionTrainingBonus(trainedLevel);
    expect(bonus.hp).toBeGreaterThan(0); // precondition: a real bonus at this level
    expect(trained.name).toBe(into.name);
    expect(trained.hp).toBe(into.hp + bonus.hp);
    expect(trained.atk).toBe(into.atk + bonus.atk);
    expect(trained.def).toBe(into.def + bonus.def);
    expect(trained.spd).toBe(into.spd + bonus.spd);
    expect(trained.hp).toBeGreaterThan(untrained.hp);
    expect(trained.atk).toBeGreaterThan(untrained.atk);
    expect(trained.def).toBeGreaterThan(untrained.def);
    expect(trained.spd).toBeGreaterThan(untrained.spd);

    // Invariant 3 shape byte-unchanged: exactly ONE 'evolve' audit row + the exact
    // cost debit, identical to an untrained evolve (a stat bonus moves NO value).
    const rows = await evolveAuditRows(base2.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('evolve');
    expect(rows[0]!.resource).toBe(step.cost.resource);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-step.cost.amount);
    const remaining = await balanceAmount(email2, step.cost.resource);
    expect(remaining).toBe(step.cost.amount + 100 - step.cost.amount);
  });

  it('blocks evolving a terminal form → 422 with the human reason', async () => {
    const email = 'blocked-evolve@example.test';
    const token = await registerAndLogin(email);

    // TASK-285: with the FIRST Champion→Ultimate line shipped, a LIVE_RNG evolve of a
    // starter Rookie can now land Greymon (which is NO LONGER terminal) — so this case
    // seeds a directly-owned Champion that IS terminal (has no EVOLUTION_LINES key)
    // rather than depending on the non-deterministic HTTP draw. Tyrannomon is a real
    // digi-api Champion form (an Agumon non-primary option) that has no further line.
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const terminal = await prisma.digimon.create({
      data: {
        userId,
        name: 'Tyrannomon',
        type: 'Data',
        element: 'Fire',
        stage: 'Champion',
        hp: 92,
        atk: 24,
        def: 20,
        spd: 10,
        level: 20,
      },
    });
    // Precondition: this form has NO further chain entry — it is terminal.
    expect(EVOLUTION_LINES[terminal.name]).toBeUndefined();

    // Seed enough balance to prove the block fires BEFORE (independent of) the cost gate.
    await seedBalance(email, 'Meat', 200);

    // Evolving a terminal form is a clean 422 carrying the player-facing reason from
    // resolveEvolution — NOT a 500, NOT a silent no-op. The terminal block fires
    // regardless of the remaining balance.
    const res = await postEvolve(terminal.id, token);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(typeof body.message).toBe('string');
    expect(body.message).toContain('no further evolution');
  });

  it("never evolves another player's Digimon → 404 (per-user isolation)", async () => {
    // Player A owns a roster; capture one of their Digimon ids.
    const tokenA = await registerAndLogin('owner-a-evolve@example.test');
    const rosterA = await getRoster(tokenA);
    const victim = anEvolvableStarter(rosterA);

    // Player B is a genuinely separate account with their OWN starters (distinct ids).
    const tokenB = await registerAndLogin('intruder-b-evolve@example.test');
    const rosterB = await getRoster(tokenB);
    const aIds = new Set(rosterA.map((d) => d.id));
    expect(rosterB.every((d) => !aIds.has(d.id))).toBe(true);

    // B attempts to evolve A's Digimon by id → 404 (owner-scoped find misses; the
    // generic not-found leaks no existence info, and A's row is never mutated).
    const res = await postEvolve(victim.id, tokenB);
    expect(res.status).toBe(404);

    // Proof of non-mutation: A re-reads and the targeted Digimon is untouched
    // (still the Rookie starter, same name/stage as before B's attempt).
    const rosterAafter = await getRoster(tokenA);
    const untouched = rosterAafter.find((d) => d.id === victim.id);
    expect(untouched).toBeDefined();
    expect(untouched?.name).toBe(victim.name);
    expect(untouched?.stage).toBe(victim.stage);
  });
});
