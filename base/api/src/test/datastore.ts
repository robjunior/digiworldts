import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createApp } from '../app';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Shared apps/api e2e/datastore harness (P-2 + P-6) — extracted TASK-44.
 *
 * The throwaway-DB block (mkdtemp + `prisma db push` + close-before-delete +
 * env-restore) had been hand-copied VERBATIM across ≥12 specs with only the temp-dir
 * label differing (the shape is dead-stable, far past the extraction threshold). This
 * is that block, factored out once so a new spec IMPORTS it instead of re-hand-rolling
 * ~70 lines. It is ordinary test-support code (build owns it; distill owns the SKILL,
 * not the code).
 *
 * A hermetic PER-RUN throwaway SQLite datastore: points `DATABASE_URL` at a fresh temp
 * file (ABSOLUTE `file:` URL so the prisma CLI and the runtime client resolve the SAME
 * file — L-6), creates the schema with `prisma db push --skip-generate`, and returns a
 * `dispose()` that closes the app FIRST (releasing the SQLite handle via `$disconnect`)
 * then deletes the temp dir and restores the env.
 *
 * It ALSO kills the cwd-depth footgun permanently: this file lives at a FIXED depth
 * (`src/test/`), so its `db push` cwd is `join(__dirname, '..', '..')` = `apps/api`
 * (where `schema.prisma` lives) regardless of how deep the CALLING spec sits. A spec
 * that imports the helper never reasons about its own `..` count again.
 */
export interface TempDatastore {
  app: INestApplication;
  /** Base URL incl. the `/api` global prefix, ready for the built-in `fetch`. */
  baseUrl: string;
  dispose: () => Promise<void>;
}

type BootMode = 'http' | 'prisma-only';

async function boot(mode: BootMode, label: string): Promise<TempDatastore> {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const tmpDir = mkdtempSync(join(tmpdir(), `digimon-api-${label}-`));
  process.env.DATABASE_URL = `file:${join(tmpDir, `${label}.db`)}`;

  // src/test/ → up TWO levels to apps/api (where schema.prisma lives). Computed from
  // THIS file's __dirname, so it is permanently correct for every caller.
  execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
    cwd: join(__dirname, '..', '..'),
    env: process.env,
    stdio: 'pipe',
  });

  let app: INestApplication;
  let baseUrl = '';
  if (mode === 'http') {
    // createApp() wires the FULL AppModule incl. the global ValidationPipe and the
    // /api prefix — the ONLY boot that makes a 400-on-bad-body assertion real (P-7,
    // friction #8). NOT Test.createTestingModule (which omits the global pipe).
    app = await createApp();
    await app.init();
    await app.listen(0); // ephemeral port, never collides with :3000 or a parallel run
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  } else {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init(); // triggers PrismaService.onModuleInit -> $connect
  }

  const dispose = async () => {
    await app?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  };

  return { app, baseUrl, dispose };
}

/** HTTP + DB: boots the full app via `createApp()` inside the throwaway-DB envelope. */
export const bootHttpTestApp = (label = 'http'): Promise<TempDatastore> => boot('http', label);

/** DB only: bare `PrismaModule` inside the throwaway-DB envelope (no HTTP). */
export const withTempDatastore = (label = 'db'): Promise<TempDatastore> =>
  boot('prisma-only', label);
