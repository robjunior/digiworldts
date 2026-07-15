import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, resolvePort } from './app';

/**
 * Foundation smoke test (TASK-1, extended in TASK-4). Proves the NestJS
 * application actually wires up and can initialise without binding a port — i.e.
 * the skeleton boots. As of TASK-4 the composition root includes PrismaModule, so
 * `app.init()` now opens a real datastore connection (PrismaService.onModuleInit);
 * therefore this suite must provision a throwaway migrated SQLite DB first, the
 * same hermetic pattern as the persistence e2e (never touch the shared dev.db,
 * fast + deterministic — L-3). An ABSOLUTE db path is used so CLI (schema-dir
 * relative) and runtime (CWD relative) resolve to the same file.
 */
describe('API application', () => {
  let app: INestApplication;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-boot-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'boot.db')}`;
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
      cwd: join(__dirname, '..'),
      env: process.env,
      stdio: 'pipe',
    });
    app = await createApp();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('boots the Nest application', () => {
    expect(app).toBeDefined();
    // getHttpAdapter throws if the app never initialised — a real liveness check
    // of the wiring, not a tautology.
    expect(app.getHttpAdapter()).toBeDefined();
  });
});

describe('resolvePort', () => {
  const original = process.env.PORT;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = original;
    }
  });

  it('defaults to 3000 when PORT is unset', () => {
    delete process.env.PORT;
    delete process.env.API_PORT;
    expect(resolvePort()).toBe(3000);
  });

  it('honours a valid PORT from the environment', () => {
    process.env.PORT = '4123';
    expect(resolvePort()).toBe(4123);
  });

  it('falls back to 3000 for a non-numeric PORT', () => {
    process.env.PORT = 'not-a-port';
    delete process.env.API_PORT;
    expect(resolvePort()).toBe(3000);
  });
});
