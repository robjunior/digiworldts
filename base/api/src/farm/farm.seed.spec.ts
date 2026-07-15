import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { STARTING_BUILDINGS, type StartingBuilding } from './farm.seed';

/**
 * Building domain-model contract (TASK-14, R-4). The runnable proof that R-4's
 * resource-economy persistence foundation actually persists and reads back with
 * every field intact — the hard dependency TASK-15's `GET /farm` endpoint (and the
 * `/farm` screen after it) build on. This is running persistence code, not a
 * schema write-up: it seeds a real `Building` row from a starting-building
 * definition, owned by a real `User`, and reads it back through a fresh query.
 *
 * It reuses the TASK-4/TASK-7 house datastore harness (P-6 / L-6) verbatim — copy
 * the shape, don't re-derive it (this is the same P-6 datastore-provider variant
 * as digimon.seed.spec.ts / refresh-token.spec.ts: no controller this slice — that
 * is TASK-15 — so `Test.createTestingModule({ imports: [PrismaModule] })` rather
 * than `createApp()`):
 *  - `DATABASE_URL` points at a per-run throwaway SQLite file (ABSOLUTE path, set
 *    BEFORE the module is constructed — `PrismaService` reads it the moment
 *    `PrismaClient` is built, and an absolute url makes the CLI, which resolves a
 *    relative url against the schema dir, and the runtime client, which resolves
 *    against CWD, agree — L-6). So the gate NEVER touches the shared dev.db.
 *  - The schema is applied with `prisma db push --skip-generate`. CRUCIAL cwd
 *    depth (L-6): this spec lives at `src/farm/`, the SAME depth as `src/digimon/`
 *    and `src/auth/`, so `db push` MUST run from `join(__dirname, '..', '..')`
 *    (= `apps/api`, where `schema.prisma` lives) — one level DEEPER than the
 *    `src/app.spec.ts` harness (`join(__dirname, '..')`). Getting this wrong points
 *    at the wrong dir and `db push` fails.
 *  - Teardown closes the app FIRST (PrismaService.onModuleDestroy → $disconnect
 *    frees the SQLite handle) THEN removes the temp dir and restores `DATABASE_URL`.
 *
 * NOTE (L-6): SQLite's `DATETIME` is second-precision, so any timestamp round-trip
 * (here `lastCollectedAt`) is compared on epoch-SECONDS (`Math.floor(ms / 1000)`),
 * never raw milliseconds.
 */
describe('Building domain model (persistence e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-farm-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'farm.db')}`;
    // src/farm/ → up TWO levels to apps/api (same depth as src/digimon/ + src/auth/).
    // Do NOT use a single '..' (that is the shallower src/app.spec.ts depth and fails).
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

  it('persists a Building owned by a User (from a starting-building entry) and reads back every field', async () => {
    // A real owner first — a Building is an OWNED instance, so it needs a User to
    // belong to (the FK requires it).
    const owner = await prisma.user.create({
      data: { email: `owner-${Date.now()}@example.test`, passwordHash: 'x' },
    });

    // Grant the first starting building to that player — exactly the mapping
    // TASK-15 will do on a first empty read: spread the pure definition and attach
    // the owner. This proves a `farm.seed.ts` entry is directly usable as row data.
    const starting: StartingBuilding = STARTING_BUILDINGS[0];
    const created = await prisma.building.create({
      data: { ...starting, userId: owner.id },
    });

    // Server-generated columns populated by the write path: a cuid id, createdAt +
    // lastCollectedAt defaults, and — critically for invariant 2 — deletedAt NULL
    // on a freshly created (owned/active) building.
    expect(created.id).toBeTruthy();
    expect(typeof created.id).toBe('string');
    expect(created.deletedAt).toBeNull();

    // Read it back through a FRESH per-owner query (not the create return value),
    // filtered the way TASK-15 will filter (owner + not soft-deleted), to prove it
    // truly landed in — and comes back from — the datastore with all fields intact.
    const buildings = await prisma.building.findMany({
      where: { userId: owner.id, deletedAt: null },
    });
    expect(buildings).toHaveLength(1);

    const fetched = buildings[0];
    expect(fetched.id).toBe(created.id);
    expect(fetched.userId).toBe(owner.id);
    expect(fetched.kind).toBe(starting.kind);
    expect(fetched.resource).toBe(starting.resource);
    expect(fetched.ratePerHour).toBe(starting.ratePerHour);
    expect(fetched.capacity).toBe(starting.capacity);
    expect(fetched.createdAt).toBeInstanceOf(Date);
    expect(fetched.deletedAt).toBeNull();

    // lastCollectedAt is the accrual-clock anchor — it must be set (defaulted to
    // ~now on creation), the timestamp TASK-15's computed-on-read diff measures
    // from. SQLite DATETIME is second-precision, so assert on epoch-seconds (never
    // raw ms): it round-trips as a Date at ~the creation instant (within a small
    // clock-skew window).
    expect(fetched.lastCollectedAt).toBeInstanceOf(Date);
    const nowSec = Math.floor(Date.now() / 1000);
    const lastCollectedSec = Math.floor(fetched.lastCollectedAt.getTime() / 1000);
    expect(lastCollectedSec).toBeLessThanOrEqual(nowSec);
    expect(lastCollectedSec).toBeGreaterThanOrEqual(nowSec - 60);
  });

  it("scopes buildings to their owner — a second player's buildings do not leak in", async () => {
    // Two distinct owners, each granted the full starting set. The per-owner query
    // MUST return only the querying owner's rows (the relation + the userId filter
    // is what makes TASK-15's "the signed-in user's farm" correct and prevents one
    // player seeing another's buildings).
    const alice = await prisma.user.create({
      data: { email: `alice-${Date.now()}@example.test`, passwordHash: 'x' },
    });
    const bob = await prisma.user.create({
      data: { email: `bob-${Date.now()}@example.test`, passwordHash: 'x' },
    });

    await prisma.building.createMany({
      data: STARTING_BUILDINGS.map((b) => ({ ...b, userId: alice.id })),
    });
    await prisma.building.createMany({
      data: STARTING_BUILDINGS.map((b) => ({ ...b, userId: bob.id })),
    });

    const aliceBuildings = await prisma.building.findMany({
      where: { userId: alice.id, deletedAt: null },
    });
    expect(aliceBuildings).toHaveLength(STARTING_BUILDINGS.length);
    // Every returned row belongs to Alice — none of Bob's leaked across.
    expect(aliceBuildings.every((b) => b.userId === alice.id)).toBe(true);
    expect(aliceBuildings.some((b) => b.userId === bob.id)).toBe(false);
  });

  it('excludes a soft-deleted Building from the active read yet the row still exists (invariant 2)', async () => {
    // Soft-delete is stamp-not-DELETE: demolishing/selling a building later sets
    // deletedAt (never issues a destructive DELETE — invariant 2). Prove the farm
    // read filter `deletedAt: null` honours that, so a removed building vanishes
    // from the farm while its row (and history) survives.
    const player = await prisma.user.create({
      data: { email: `player-${Date.now()}@example.test`, passwordHash: 'x' },
    });
    const keep = await prisma.building.create({
      data: { ...STARTING_BUILDINGS[0], userId: player.id },
    });
    const removed = await prisma.building.create({
      data: { ...STARTING_BUILDINGS[1], userId: player.id },
    });

    // Stamp (not delete) the removed one.
    await prisma.building.update({
      where: { id: removed.id },
      data: { deletedAt: new Date() },
    });

    const activeBuildings = await prisma.building.findMany({
      where: { userId: player.id, deletedAt: null },
    });
    expect(activeBuildings).toHaveLength(1);
    expect(activeBuildings[0].id).toBe(keep.id);

    // The soft-deleted row still EXISTS in the datastore (was not hard-deleted) —
    // it is only filtered out of the active read.
    const stillThere = await prisma.building.findUnique({ where: { id: removed.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.deletedAt).toBeInstanceOf(Date);
  });

  it('exposes a non-empty readonly starting-building set with every required field (TASK-15 will consume it)', async () => {
    // A cheap pure-data assertion — no DB — proving the seed definition is usable
    // by TASK-15: a non-empty list where every entry carries the full field set a
    // Building row needs (minus the owner + server-generated columns).
    expect(Array.isArray(STARTING_BUILDINGS)).toBe(true);
    expect(STARTING_BUILDINGS.length).toBeGreaterThan(0);

    for (const building of STARTING_BUILDINGS) {
      expect(typeof building.kind).toBe('string');
      expect(building.kind.length).toBeGreaterThan(0);
      expect(typeof building.resource).toBe('string');
      expect(building.resource.length).toBeGreaterThan(0);
      expect(Number.isInteger(building.ratePerHour)).toBe(true);
      expect(building.ratePerHour).toBeGreaterThan(0);
      expect(Number.isInteger(building.capacity)).toBe(true);
      expect(building.capacity).toBeGreaterThan(0);
    }
  });
});
