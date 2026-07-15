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
 * RefreshToken persistence contract (TASK-10, R-2b). The runnable proof that the
 * refresh-token store persists and reads back correctly — the hard dependency
 * TASK-11's `/auth/refresh` + `/auth/logout` build on. R-2b's durable session
 * keeps a rotating refresh token in an httpOnly cookie; this table is the server's
 * record of each issued token (only a HASH of it, never the raw value). This slice
 * is the model + migration only (no controller/route/service — TASK-11), so the
 * tests exercise `PrismaService` directly rather than an HTTP endpoint.
 *
 * It reuses the TASK-4/5/7 house datastore harness (P-6 / L-6) VERBATIM — copy the
 * shape, don't re-derive it:
 *  - `DATABASE_URL` points at a per-run throwaway SQLite file (ABSOLUTE path, set
 *    BEFORE the module is constructed — `PrismaService` reads it the moment
 *    `PrismaClient` is built, and an absolute url makes the CLI, which resolves a
 *    relative url against the schema dir, and the runtime client, which resolves
 *    against CWD, agree — L-6). So the gate NEVER touches the shared dev.db.
 *  - The schema is applied with `prisma db push --skip-generate`. CRUCIAL cwd
 *    depth (L-6): this spec lives at `src/auth/`, so `db push` MUST run from
 *    `join(__dirname, '..', '..')` (= `apps/api`, where `schema.prisma` lives) —
 *    one level DEEPER than the `src/app.spec.ts` harness (`join(__dirname, '..')`).
 *    Getting this wrong points at the wrong dir and `db push` fails.
 *  - Teardown closes the app FIRST (PrismaService.onModuleDestroy → $disconnect
 *    frees the SQLite handle) THEN removes the temp dir and restores `DATABASE_URL`.
 *
 * No HTTP is booted (there is no controller this slice — that is TASK-11), so this
 * is the P-6 datastore-provider variant: `Test.createTestingModule({ imports:
 * [PrismaModule] })` rather than `createApp()` (mirrors digimon.seed.spec.ts).
 */
describe('RefreshToken store (persistence e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  // A helper to create a real owner — a refresh token is an OWNED row, so it needs
  // a User to belong to (the FK requires it). Unique email per call so the tests
  // are order-independent within the shared throwaway DB.
  const createOwner = () =>
    prisma.user.create({
      data: { email: `owner-${Date.now()}-${Math.random()}@example.test`, passwordHash: 'x' },
    });

  // One hour in ms — a convenient "not yet expired" horizon for the fresh-token
  // assertions (the exact TTL is TASK-11's concern; here we only need gt/lt now()).
  const ONE_HOUR = 60 * 60 * 1000;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-refresh-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'refresh.db')}`;
    // src/auth/ → up TWO levels to apps/api (same depth as src/digimon/). Do NOT
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

  it('persists a RefreshToken owned by a User and reads back every field (revokedAt/rotatedToId NULL on a fresh row)', async () => {
    // A refresh token belongs to exactly one user (the FK). Create the owner first,
    // then issue a token for them — exactly the shape TASK-11's login/refresh will
    // write: a hash of the raw token (never the raw token), the owner, an absolute
    // expiry in the future.
    const owner = await createOwner();
    const expiresAt = new Date(Date.now() + ONE_HOUR);
    const created = await prisma.refreshToken.create({
      data: { userId: owner.id, tokenHash: 'hash-fresh-1', expiresAt },
    });

    // Server-generated / defaulted columns populated by the write path: a cuid id,
    // a createdAt default, and — critically for invariant 2 — revokedAt NULL on a
    // freshly issued (active) token, plus rotatedToId NULL (not yet rotated).
    expect(created.id).toBeTruthy();
    expect(typeof created.id).toBe('string');
    expect(created.revokedAt).toBeNull();
    expect(created.rotatedToId).toBeNull();

    // Read it back through a FRESH query (not the create return value) to prove it
    // truly landed in — and comes back from — the datastore with all fields intact.
    const fetched = await prisma.refreshToken.findUnique({
      where: { tokenHash: 'hash-fresh-1' },
    });
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.userId).toBe(owner.id);
    expect(fetched?.tokenHash).toBe('hash-fresh-1');
    // SQLite stores DATETIME at second precision; compare on epoch-seconds so the
    // round-trip assertion does not flake on sub-second truncation.
    expect(Math.floor((fetched?.expiresAt.getTime() ?? 0) / 1000)).toBe(
      Math.floor(expiresAt.getTime() / 1000),
    );
    expect(fetched?.revokedAt).toBeNull();
    expect(fetched?.rotatedToId).toBeNull();
    expect(fetched?.createdAt).toBeInstanceOf(Date);
  });

  it('rejects a duplicate tokenHash via the @unique constraint (the DB-level guarantee rotation relies on)', async () => {
    // TASK-11's rotation depends on tokenHash being unique so a presented token
    // maps to at most one row. Prove the DB enforces it: a second create with the
    // same hash must throw (a Prisma P2002 unique violation), regardless of owner.
    const owner = await createOwner();
    const expiresAt = new Date(Date.now() + ONE_HOUR);
    await prisma.refreshToken.create({
      data: { userId: owner.id, tokenHash: 'hash-dup', expiresAt },
    });

    await expect(
      prisma.refreshToken.create({
        data: { userId: owner.id, tokenHash: 'hash-dup', expiresAt },
      }),
    ).rejects.toThrow();
  });

  it('the "active token" query returns a fresh token but NULL once soft-revoked OR expired (the /auth/refresh filter)', async () => {
    // The exact lookup TASK-11's /auth/refresh uses: a token is usable only when it
    // matches by hash AND is not revoked AND is not past its expiry.
    const owner = await createOwner();

    // Case A — a fresh, unrevoked, unexpired token: the active query FINDS it.
    const fresh = await prisma.refreshToken.create({
      data: {
        userId: owner.id,
        tokenHash: 'hash-active',
        expiresAt: new Date(Date.now() + ONE_HOUR),
      },
    });
    const activeQuery = (tokenHash: string) =>
      prisma.refreshToken.findFirst({
        where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      });
    const foundActive = await activeQuery('hash-active');
    expect(foundActive).not.toBeNull();
    expect(foundActive?.id).toBe(fresh.id);

    // Case B — soft-revoke it (STAMP revokedAt, invariant 2 — never a hard DELETE):
    // the active query now returns NULL, but the row still EXISTS (logout / rotation
    // must not destroy the audit/rotation record).
    await prisma.refreshToken.update({
      where: { id: fresh.id },
      data: { revokedAt: new Date() },
    });
    expect(await activeQuery('hash-active')).toBeNull();
    const stillThere = await prisma.refreshToken.findUnique({ where: { id: fresh.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.revokedAt).toBeInstanceOf(Date);

    // Case C — an already-expired token (expiresAt in the past, never revoked): the
    // active query returns NULL purely on the expiry filter, so a leaked-but-stale
    // cookie cannot mint new access tokens.
    const expired = await prisma.refreshToken.create({
      data: {
        userId: owner.id,
        tokenHash: 'hash-expired',
        expiresAt: new Date(Date.now() - ONE_HOUR),
      },
    });
    expect(await activeQuery('hash-expired')).toBeNull();
    // It exists — it is filtered out by expiry, not deleted.
    const expiredRow = await prisma.refreshToken.findUnique({ where: { id: expired.id } });
    expect(expiredRow).not.toBeNull();
    expect(expiredRow?.revokedAt).toBeNull();
  });

  it("scopes tokens to their owner — a second user's refresh tokens do not leak into the first user's list", async () => {
    // "Log out everywhere" / listing a user's sessions is a per-owner query
    // (WHERE userId = ?). It MUST return only the querying owner's tokens — one
    // user must never see another's session rows.
    const alice = await createOwner();
    const bob = await createOwner();

    const expiresAt = new Date(Date.now() + ONE_HOUR);
    await prisma.refreshToken.create({
      data: { userId: alice.id, tokenHash: `alice-a-${alice.id}`, expiresAt },
    });
    await prisma.refreshToken.create({
      data: { userId: alice.id, tokenHash: `alice-b-${alice.id}`, expiresAt },
    });
    await prisma.refreshToken.create({
      data: { userId: bob.id, tokenHash: `bob-a-${bob.id}`, expiresAt },
    });

    const aliceTokens = await prisma.refreshToken.findMany({ where: { userId: alice.id } });
    expect(aliceTokens).toHaveLength(2);
    // Every returned row belongs to Alice — none of Bob's leaked across.
    expect(aliceTokens.every((t) => t.userId === alice.id)).toBe(true);
    expect(aliceTokens.some((t) => t.userId === bob.id)).toBe(false);
  });

  it('records the rotation link via rotatedToId (paves R-2c reuse detection)', async () => {
    // Single-use rotation (A-9): /auth/refresh revokes the presented token and
    // issues a successor. This proves the old→new link is recordable: mint a
    // successor, then stamp the old token's rotatedToId with the successor's id and
    // revoke it. TASK-11's rotation + R-2c's replay detection read exactly this.
    const owner = await createOwner();
    const expiresAt = new Date(Date.now() + ONE_HOUR);
    const oldToken = await prisma.refreshToken.create({
      data: { userId: owner.id, tokenHash: 'hash-rot-old', expiresAt },
    });
    const newToken = await prisma.refreshToken.create({
      data: { userId: owner.id, tokenHash: 'hash-rot-new', expiresAt },
    });

    await prisma.refreshToken.update({
      where: { id: oldToken.id },
      data: { revokedAt: new Date(), rotatedToId: newToken.id },
    });

    const rotated = await prisma.refreshToken.findUnique({ where: { id: oldToken.id } });
    expect(rotated?.rotatedToId).toBe(newToken.id);
    expect(rotated?.revokedAt).toBeInstanceOf(Date);
    // The successor is active and not itself rotated yet.
    const successor = await prisma.refreshToken.findUnique({ where: { id: newToken.id } });
    expect(successor?.revokedAt).toBeNull();
    expect(successor?.rotatedToId).toBeNull();
  });
});
