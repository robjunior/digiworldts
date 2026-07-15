import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { STARTER_DIGIMON, type StarterDigimon } from './digimon.seed';

/**
 * Digimon domain-model contract (TASK-7, R-3). The runnable proof that the
 * project's FIRST owned domain model persists and reads back with every field
 * intact — the hard dependency TASK-8's `GET /digimon` endpoint and TASK-9's
 * collection screen build on. This is running persistence code, not a schema
 * write-up: it seeds a real `Digimon` row from a starter definition, owned by a
 * real `User`, and reads it back through a fresh query.
 *
 * It reuses the TASK-4/TASK-5 house datastore harness (P-6 / L-6) verbatim — copy
 * the shape, don't re-derive it:
 *  - `DATABASE_URL` points at a per-run throwaway SQLite file (ABSOLUTE path, set
 *    BEFORE the module is constructed — `PrismaService` reads it the moment
 *    `PrismaClient` is built, and an absolute url makes the CLI, which resolves a
 *    relative url against the schema dir, and the runtime client, which resolves
 *    against CWD, agree — L-6). So the gate NEVER touches the shared dev.db.
 *  - The schema is applied with `prisma db push --skip-generate`. CRUCIAL cwd
 *    depth (L-6): this spec lives at `src/digimon/`, the SAME depth as `src/auth/`,
 *    so `db push` MUST run from `join(__dirname, '..', '..')` (= `apps/api`, where
 *    `schema.prisma` lives) — one level DEEPER than the `src/app.spec.ts` harness
 *    (`join(__dirname, '..')`). Getting this wrong points at the wrong dir and
 *    `db push` fails.
 *  - Teardown closes the app FIRST (PrismaService.onModuleDestroy → $disconnect
 *    frees the SQLite handle) THEN removes the temp dir and restores `DATABASE_URL`.
 *
 * No HTTP is booted (there is no controller this slice — that is TASK-8), so this
 * is the P-6 datastore-provider variant: `Test.createTestingModule({ imports:
 * [PrismaModule] })` rather than `createApp()`.
 */
describe('Digimon domain model (persistence e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-digimon-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'digimon.db')}`;
    // src/digimon/ → up TWO levels to apps/api (same depth as src/auth/). Do NOT
    // use a single '..' (that is the shallower src/app.spec.ts depth and fails).
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
      cwd: join(__dirname, '..', '..'),
      env: process.env,
      stdio: 'pipe',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init(); // triggers PrismaService.onModuleInit -> $connect
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('persists a Digimon owned by a User (from a starter entry) and reads back every field', async () => {
    // A real owner first — a Digimon is an OWNED instance, so it needs a User to
    // belong to (the FK requires it).
    const owner = await prisma.user.create({
      data: { email: `owner-${Date.now()}@example.test`, passwordHash: 'x' },
    });

    // Grant the first starter to that player — exactly the mapping TASK-8 will do
    // on a first empty read: spread the pure starter definition and attach the
    // owner. This proves a `digimon.seed.ts` entry is directly usable as row data.
    const starter: StarterDigimon = STARTER_DIGIMON[0];
    const created = await prisma.digimon.create({
      data: { ...starter, userId: owner.id },
    });

    // Server-generated columns populated by the write path: a cuid id, a
    // createdAt default, and — critically for invariant 2 — deletedAt NULL on a
    // freshly created (owned/active) instance.
    expect(created.id).toBeTruthy();
    expect(typeof created.id).toBe('string');
    expect(created.deletedAt).toBeNull();

    // Read it back through a FRESH roster query (not the create return value),
    // filtered the way TASK-8 will filter (owner + not soft-deleted), to prove it
    // truly landed in — and comes back from — the datastore with all fields intact.
    const roster = await prisma.digimon.findMany({
      where: { userId: owner.id, deletedAt: null },
    });
    expect(roster).toHaveLength(1);

    const fetched = roster[0];
    expect(fetched.id).toBe(created.id);
    expect(fetched.userId).toBe(owner.id);
    expect(fetched.name).toBe(starter.name);
    expect(fetched.type).toBe(starter.type);
    expect(fetched.element).toBe(starter.element);
    expect(fetched.stage).toBe(starter.stage);
    expect(fetched.hp).toBe(starter.hp);
    expect(fetched.atk).toBe(starter.atk);
    expect(fetched.def).toBe(starter.def);
    expect(fetched.spd).toBe(starter.spd);
    expect(fetched.level).toBe(starter.level);
    expect(fetched.createdAt).toBeInstanceOf(Date);
    expect(fetched.deletedAt).toBeNull();
  });

  it("scopes the roster to its owner — a second player's Digimon do not leak in", async () => {
    // Two distinct owners, each granted the full starter trio. The roster query
    // MUST return only the querying owner's rows (the relation + the userId filter
    // is what makes TASK-8's "the signed-in user's roster" correct and prevents
    // one player seeing another's Digimon).
    const alice = await prisma.user.create({
      data: { email: `alice-${Date.now()}@example.test`, passwordHash: 'x' },
    });
    const bob = await prisma.user.create({
      data: { email: `bob-${Date.now()}@example.test`, passwordHash: 'x' },
    });

    await prisma.digimon.createMany({
      data: STARTER_DIGIMON.map((d) => ({ ...d, userId: alice.id })),
    });
    await prisma.digimon.createMany({
      data: STARTER_DIGIMON.map((d) => ({ ...d, userId: bob.id })),
    });

    const aliceRoster = await prisma.digimon.findMany({
      where: { userId: alice.id, deletedAt: null },
    });
    expect(aliceRoster).toHaveLength(STARTER_DIGIMON.length);
    // Every returned row belongs to Alice — none of Bob's leaked across.
    expect(aliceRoster.every((d) => d.userId === alice.id)).toBe(true);
    expect(aliceRoster.some((d) => d.userId === bob.id)).toBe(false);
  });

  it('excludes soft-deleted Digimon from the roster read (invariant 2)', async () => {
    // Soft-delete is stamp-not-DELETE: releasing a Digimon later sets deletedAt
    // (never issues a destructive DELETE — invariant 2). Prove the roster filter
    // `deletedAt: null` honours that, so a released Digimon vanishes from the
    // roster while its row (and history) survives.
    const trainer = await prisma.user.create({
      data: { email: `trainer-${Date.now()}@example.test`, passwordHash: 'x' },
    });
    const keep = await prisma.digimon.create({
      data: { ...STARTER_DIGIMON[0], userId: trainer.id },
    });
    const released = await prisma.digimon.create({
      data: { ...STARTER_DIGIMON[1], userId: trainer.id },
    });

    // Stamp (not delete) the released one.
    await prisma.digimon.update({
      where: { id: released.id },
      data: { deletedAt: new Date() },
    });

    const activeRoster = await prisma.digimon.findMany({
      where: { userId: trainer.id, deletedAt: null },
    });
    expect(activeRoster).toHaveLength(1);
    expect(activeRoster[0].id).toBe(keep.id);

    // The soft-deleted row still EXISTS in the datastore (was not hard-deleted) —
    // it is only filtered out of the active roster.
    const stillThere = await prisma.digimon.findUnique({ where: { id: released.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.deletedAt).toBeInstanceOf(Date);
  });

  it('exposes a non-empty readonly starter roster with every required field (TASK-8 will consume it)', async () => {
    // A cheap pure-data assertion — no DB — proving the seed definition is usable
    // by TASK-8: a non-empty list where every entry carries the full field set a
    // Digimon row needs (minus the owner + server-generated columns).
    expect(Array.isArray(STARTER_DIGIMON)).toBe(true);
    expect(STARTER_DIGIMON.length).toBeGreaterThan(0);

    for (const starter of STARTER_DIGIMON) {
      expect(typeof starter.name).toBe('string');
      expect(starter.name.length).toBeGreaterThan(0);
      expect(typeof starter.type).toBe('string');
      expect(typeof starter.element).toBe('string');
      expect(typeof starter.stage).toBe('string');
      expect(Number.isInteger(starter.hp)).toBe(true);
      expect(Number.isInteger(starter.atk)).toBe(true);
      expect(Number.isInteger(starter.def)).toBe(true);
      expect(Number.isInteger(starter.spd)).toBe(true);
      expect(Number.isInteger(starter.level)).toBe(true);
    }
  });

  it('includes canonical first-3-season species beyond the founding trio (TASK-190, R-29)', () => {
    // The observable headline of R-29 slice 49: a new player's starter catalog now
    // surfaces real Adventure/02/Tamers species, not just the founding Agumon/
    // Gabumon/Patamon trio. Assert by canonical name (the player-visible identity)
    // that the first-3-season batch is present — this presence pin IS the
    // observable-change evidence for the slice.
    const names = STARTER_DIGIMON.map((d) => d.name);

    // The founding trio is still present (existing players' expectations unchanged).
    expect(names).toContain('Agumon');
    expect(names).toContain('Gabumon');
    expect(names).toContain('Patamon');

    // At least one new canonical first-3-season species now exists in the catalog.
    const firstSeasonBatch = ['Biyomon', 'Tentomon', 'Palmon', 'Gomamon', 'Veemon'];
    for (const species of firstSeasonBatch) {
      expect(names).toContain(species);
    }
    // Tamers (season 3) protagonists now exist too — R-29 first-THREE-seasons coverage.
    const tamersBatch = ['Guilmon', 'Renamon', 'Terriermon'];
    for (const species of tamersBatch) {
      expect(names).toContain(species);
    }
    // The catalog genuinely GREW beyond the original three.
    expect(STARTER_DIGIMON.length).toBeGreaterThan(3);

    // Every row is a level-1 Rookie with valid union members (field-type contract),
    // and names are unique (no accidental duplicate species).
    const validTypes = ['Vaccine', 'Virus', 'Data', 'Free'];
    const validElements = ['Fire', 'Water', 'Nature', 'Electric', 'Neutral'];
    const validStages = ['Fresh', 'In-Training', 'Rookie', 'Champion', 'Ultimate', 'Mega'];
    for (const starter of STARTER_DIGIMON) {
      expect(validTypes).toContain(starter.type);
      expect(validElements).toContain(starter.element);
      expect(validStages).toContain(starter.stage);
      expect(starter.level).toBe(1);
      expect(starter.hp).toBeGreaterThan(0);
      expect(starter.atk).toBeGreaterThan(0);
      expect(starter.def).toBeGreaterThan(0);
      expect(starter.spd).toBeGreaterThan(0);
    }
    expect(new Set(names).size).toBe(names.length);
  });
});
