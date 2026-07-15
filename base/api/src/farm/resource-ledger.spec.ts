import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resource-economy persistence contract (TASK-21, R-4b). The runnable proof that
 * the economy's TWO foundation tables persist and behave as their invariants
 * require — the hard dependency TASK-22's `POST /farm/collect` mutation (the
 * DB→API→UI chain) builds on. This is running persistence code, NOT a schema
 * write-up: it round-trips a real `ResourceBalance` credit and a real `AuditLog`
 * row against a throwaway SQLite DB, and asserts the FOUR shape guarantees that
 * make R-4b safe to build the collect on:
 *
 *   1. a fresh `ResourceBalance` defaults `amount` to 0 and `deletedAt` to null;
 *   2. crediting the SAME (userId, resource) twice via `upsert` lands on ONE row
 *      whose amount is the SUM — the `@@unique([userId, resource])` guarantee that
 *      makes TASK-22's collect-as-upsert a one-row-per-pair operation (NOT two rows);
 *   3. an `AuditLog` row round-trips ALL fields and is retrievable by BOTH its
 *      access-path indexes (`@@index([userId])` and `@@index([entity, entityId])`) —
 *      the invariant-3 ledger TASK-22 appends the collect's before→after evidence to;
 *   4. a second user's balance + audit rows do NOT leak into the first user's
 *      owner-scoped read (invariant 2 isolation), and a soft-deleted balance is
 *      EXCLUDED from the active read yet still EXISTS (invariant 2 soft-delete).
 *
 * WHY no controller / no route here: this slice is the STORE only (TASK-22 owns the
 * write path, TASK-23 the UI). So — like `digimon.seed.spec.ts` — there is no HTTP
 * to boot; this is the P-6 datastore-provider variant:
 * `Test.createTestingModule({ imports: [PrismaModule] })` + `app.get(PrismaService)`,
 * NOT `createApp()` (nothing validates a body, so the global ValidationPipe is moot).
 *
 * Harness = the SAME house throwaway-DB pattern (P-6 / L-6) as
 * `digimon.seed.spec.ts` / `farm.controller.spec.ts`, hand-rolled VERBATIM (the
 * shared `apps/api/src/test/datastore.ts` helper the sibling
 * `nest-e2e-and-datastore-tests` skill names as its primary path DOES NOT EXIST —
 * extracting it is a distill concern, out of this task's scope — so this takes the
 * skill's documented fallback and copies the ~inline block):
 *  - `DATABASE_URL` → a per-run throwaway SQLite file, ABSOLUTE path, set BEFORE the
 *    module is constructed (PrismaService reads it the moment PrismaClient is built,
 *    and an absolute url makes the CLI, which resolves relative urls against the
 *    schema dir, and the runtime client, which resolves against CWD, agree — L-6).
 *    So the gate NEVER touches the shared `apps/api/prisma/dev.db`.
 *  - Schema applied with `prisma db push --skip-generate`. CRUCIAL cwd depth (L-6):
 *    this spec lives at `src/farm/` (the SAME depth as `src/digimon/` / `src/auth/`),
 *    so `db push` MUST run from `join(__dirname, '..', '..')` (= `apps/api`, where
 *    `schema.prisma` lives) — TWO levels up, NOT the single `..` a `src/app.spec.ts`
 *    uses. Getting this wrong points at the wrong dir and `db push` fails.
 *  - Teardown closes the app FIRST (PrismaService.onModuleDestroy → $disconnect
 *    frees the SQLite handle) THEN removes the temp dir and restores `DATABASE_URL`.
 *
 * SQLite `DATETIME` is SECOND-precision, so every timestamp round-trip below is
 * asserted on epoch-SECONDS, never milliseconds (L-6).
 */
describe('Resource economy persistence (ResourceBalance + AuditLog, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  // Create a fresh owner. A balance / audit row is an OWNED instance, so it needs a
  // real User to belong to (the FK requires it). Unique email per call keeps every
  // test's players independent (the per-user isolation checks below rely on that).
  const createUser = () =>
    prisma.user.create({
      data: {
        email: `ledger-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: 'x',
      },
    });

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-ledger-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'ledger.db')}`;
    // src/farm/ → up TWO levels to apps/api (same depth as src/digimon/). Do NOT
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

  it('persists a ResourceBalance owned by a User — amount defaults to 0, deletedAt null on a fresh row', async () => {
    const owner = await createUser();

    // Create a balance for this user WITHOUT specifying amount — proving the
    // schema default (0) applies (TASK-22 creates a balance the first time a
    // resource is collected, then increments it on subsequent collects).
    const created = await prisma.resourceBalance.create({
      data: { userId: owner.id, resource: 'Meat' },
    });

    // Server-generated / defaulted columns populated by the write path: a cuid id,
    // amount = 0 (the @default), createdAt + updatedAt stamps, and — critically for
    // invariant 2 — deletedAt NULL on a freshly created (active) balance.
    expect(created.id).toBeTruthy();
    expect(typeof created.id).toBe('string');
    expect(created.amount).toBe(0);
    expect(created.deletedAt).toBeNull();

    // Read it back through a FRESH owner-scoped query (not the create return value),
    // filtered the way TASK-22/23 will filter (owner + not soft-deleted), to prove
    // it truly landed in — and comes back from — the datastore with every field.
    const balances = await prisma.resourceBalance.findMany({
      where: { userId: owner.id, deletedAt: null },
    });
    expect(balances).toHaveLength(1);

    const fetched = balances[0];
    expect(fetched.id).toBe(created.id);
    expect(fetched.userId).toBe(owner.id);
    expect(fetched.resource).toBe('Meat');
    expect(fetched.amount).toBe(0);
    expect(fetched.createdAt).toBeInstanceOf(Date);
    expect(fetched.updatedAt).toBeInstanceOf(Date);
    expect(fetched.deletedAt).toBeNull();
  });

  it('crediting the SAME (userId, resource) twice via upsert yields ONE summed row — the @@unique([userId, resource]) guarantee', async () => {
    // This is the exact operation TASK-22's collect performs: an UPSERT keyed on the
    // composite unique, incrementing amount. Two credits to the same (user, resource)
    // MUST converge on a single row whose amount is the SUM — never two split rows.
    // If the @@unique were missing, the second upsert would INSERT a second row and
    // a player would end up with fragmented balances they cannot spend atomically.
    const owner = await createUser();

    // First collect: the balance does not exist yet → create at 30.
    await prisma.resourceBalance.upsert({
      where: { userId_resource: { userId: owner.id, resource: 'Bits' } },
      create: { userId: owner.id, resource: 'Bits', amount: 30 },
      update: { amount: { increment: 30 } },
    });
    // Second collect of the SAME resource: the balance now exists → increment by 12.
    await prisma.resourceBalance.upsert({
      where: { userId_resource: { userId: owner.id, resource: 'Bits' } },
      create: { userId: owner.id, resource: 'Bits', amount: 12 },
      update: { amount: { increment: 12 } },
    });

    // Exactly ONE Bits row for this user (not two), holding the SUM (30 + 12 = 42).
    const bits = await prisma.resourceBalance.findMany({
      where: { userId: owner.id, resource: 'Bits' },
    });
    expect(bits).toHaveLength(1);
    expect(bits[0].amount).toBe(42);

    // The composite unique is enforced at the DB level: a raw create of a duplicate
    // (userId, resource) is REJECTED (Prisma P2002). This is what makes the upsert
    // key sound — proving the guarantee, not just observing the upsert happened to
    // collapse. A DIFFERENT resource for the same user is allowed (distinct pair).
    await expect(
      prisma.resourceBalance.create({ data: { userId: owner.id, resource: 'Bits', amount: 1 } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    const other = await prisma.resourceBalance.create({
      data: { userId: owner.id, resource: 'Data', amount: 7 },
    });
    expect(other.resource).toBe('Data');
  });

  it('appends an AuditLog row that round-trips ALL fields and is retrievable by BOTH index access paths (invariant 3 ledger)', async () => {
    // The invariant-3 ledger: a "collect" mutation records who / what / when /
    // before→after. TASK-22 will write exactly this shape inside the collect's
    // $transaction. Here we prove the row persists every field and comes back
    // through the two access paths the schema indexes (owner history + entity trail).
    const owner = await createUser();
    const buildingId = 'bld_' + Math.random().toString(36).slice(2);

    const entry = await prisma.auditLog.create({
      data: {
        userId: owner.id,
        action: 'collect',
        entity: 'Building',
        entityId: buildingId,
        resource: 'Meat',
        amountBefore: 100,
        amountAfter: 160,
      },
    });
    expect(entry.id).toBeTruthy();
    expect(entry.createdAt).toBeInstanceOf(Date);

    // Access path 1 — the owner history (`@@index([userId])`): TASK-22/R-14 read a
    // player's audit trail this way. Read back through a FRESH query and assert
    // every field survived the round-trip intact.
    const byUser = await prisma.auditLog.findMany({ where: { userId: owner.id } });
    expect(byUser).toHaveLength(1);
    const fetched = byUser[0];
    expect(fetched.id).toBe(entry.id);
    expect(fetched.userId).toBe(owner.id);
    expect(fetched.action).toBe('collect');
    expect(fetched.entity).toBe('Building');
    expect(fetched.entityId).toBe(buildingId);
    expect(fetched.resource).toBe('Meat');
    expect(fetched.amountBefore).toBe(100);
    expect(fetched.amountAfter).toBe(160);
    // SECOND-precision DATETIME: compare the createdAt round-trip on epoch-seconds,
    // never milliseconds (SQLite truncates sub-second precision — L-6).
    expect(Math.floor(fetched.createdAt.getTime() / 1000)).toBe(
      Math.floor(entry.createdAt.getTime() / 1000),
    );

    // Access path 2 — the per-record trail (`@@index([entity, entityId])`): "every
    // mutation against building X". This is how an auditor (or R-14) pulls one
    // record's whole history without scanning by user.
    const byEntity = await prisma.auditLog.findMany({
      where: { entity: 'Building', entityId: buildingId },
    });
    expect(byEntity).toHaveLength(1);
    expect(byEntity[0].id).toBe(entry.id);

    // The nullable `resource` really is optional (not every future action names a
    // single resource — e.g. an admin action). Prove a null round-trips.
    const noResource = await prisma.auditLog.create({
      data: {
        userId: owner.id,
        action: 'admin-note',
        entity: 'User',
        entityId: owner.id,
        amountBefore: 0,
        amountAfter: 0,
      },
    });
    const fetchedNull = await prisma.auditLog.findUnique({ where: { id: noResource.id } });
    expect(fetchedNull?.resource).toBeNull();
  });

  it("scopes balances AND audit rows per owner — a second user does not leak into the first user's reads (invariant 2)", async () => {
    // Two distinct owners, each given their own balance + audit row. The owner-scoped
    // reads (`where: { userId }`) MUST return only the querying owner's rows — the
    // isolation that keeps one player from seeing another's economy (invariant 2).
    const alice = await createUser();
    const bob = await createUser();

    await prisma.resourceBalance.create({
      data: { userId: alice.id, resource: 'Meat', amount: 5 },
    });
    await prisma.resourceBalance.create({ data: { userId: bob.id, resource: 'Meat', amount: 9 } });
    await prisma.auditLog.create({
      data: {
        userId: alice.id,
        action: 'collect',
        entity: 'Building',
        entityId: 'a',
        amountBefore: 0,
        amountAfter: 5,
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: bob.id,
        action: 'collect',
        entity: 'Building',
        entityId: 'b',
        amountBefore: 0,
        amountAfter: 9,
      },
    });

    // Alice's active balance read returns ONLY Alice's row — none of Bob's leaks in.
    const aliceBalances = await prisma.resourceBalance.findMany({
      where: { userId: alice.id, deletedAt: null },
    });
    expect(aliceBalances).toHaveLength(1);
    expect(aliceBalances.every((b) => b.userId === alice.id)).toBe(true);
    expect(aliceBalances[0].amount).toBe(5);

    // Same isolation for the ledger.
    const aliceAudit = await prisma.auditLog.findMany({ where: { userId: alice.id } });
    expect(aliceAudit).toHaveLength(1);
    expect(aliceAudit.every((a) => a.userId === alice.id)).toBe(true);
  });

  it('excludes a soft-deleted ResourceBalance from the active read yet the row still EXISTS (invariant 2 soft-delete)', async () => {
    // Soft-delete is stamp-not-DELETE (invariant 2: economic rows are NEVER hard
    // DELETEd). Prove the active-read filter `deletedAt: null` hides a stamped
    // balance while its row (and history) survives in the datastore. Note AuditLog
    // is deliberately NOT part of this: it is append-only (no deletedAt column at
    // all), so a ledger row is never soft-deleted either — its immutability IS the
    // invariant-3 guarantee.
    const owner = await createUser();
    const keep = await prisma.resourceBalance.create({
      data: { userId: owner.id, resource: 'Meat', amount: 3 },
    });
    const retired = await prisma.resourceBalance.create({
      data: { userId: owner.id, resource: 'Bits', amount: 8 },
    });

    // Stamp (not delete) the retired balance.
    await prisma.resourceBalance.update({
      where: { id: retired.id },
      data: { deletedAt: new Date() },
    });

    // The active read (deletedAt: null) returns only the kept balance.
    const active = await prisma.resourceBalance.findMany({
      where: { userId: owner.id, deletedAt: null },
    });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(keep.id);

    // The soft-deleted row still EXISTS (was not hard-deleted) — only filtered out.
    const stillThere = await prisma.resourceBalance.findUnique({ where: { id: retired.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.deletedAt).toBeInstanceOf(Date);
    expect(stillThere?.amount).toBe(8);
  });
});
