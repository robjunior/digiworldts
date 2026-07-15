import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Compiled-`dist` boot-smoke test (TASK-232, R-41) — closes the source↔emit boot gap
 * that I-27 exposed ("API doesn't boot: Cannot find module './admin.guard'").
 *
 * WHY this spec exists even though `app.spec.ts` already boots the composition root:
 * `app.spec.ts` boots the TypeScript SOURCE through vitest/esbuild, which resolves
 * modules via esbuild's own graph — it can NEVER observe a source↔emit gap where `tsc`
 * type-checks clean but the emitted `dist/*.js` fails to `require()` a module at Node
 * runtime (a stale/partial incremental emit, a mis-cased path on a case-sensitive FS, a
 * file `tsc` did not flush). `GATE_BUILD` runs `tsc` (emit) but nothing asserted the
 * EMITTED artifact actually boots under Node. This spec is that missing gate: it runs
 * the emitted `dist/app.js` IN-PROCESS so the full runtime `require('./admin.guard')`
 * chain (`dist/app.js` → `dist/app.module.js` → `dist/admin/admin.module.js` →
 * `dist/auth/auth.module.js` → `require('./admin.guard')`) executes over compiled `.js`.
 * If `dist/auth/admin.guard.js` were missing/misnamed while the source still type-checks,
 * `app.init()` throws `MODULE_NOT_FOUND` HERE and this test goes red — the exact class
 * of failure I-27 hit, now gated.
 *
 * IN-PROCESS ONLY (D-495 re-decision): `await import(dist/app.js)` → `createApp()` →
 * `app.init()` (NOT `app.listen` — no port bind) → `app.close()`. Deliberately NO child
 * process / `node dist/main.js` spawn / port bind / awaited stdout log — that branch is
 * exactly what hung the gate three times (`fail-nosignal`): a child that never reaches
 * its listening log, or a process alive on exit-code `null`, leaves the await unsettled.
 * `app.init()` runs the SAME composition-root require chain with ZERO hang surface.
 */

// apps/api root (this spec sits at src/, so up ONE level).
const API_ROOT = resolve(__dirname, '..');
const DIST_APP = join(API_ROOT, 'dist', 'app.js');

let app: INestApplication | undefined;
let tmpDir: string | undefined;
let originalDatabaseUrl: string | undefined;

beforeAll(async () => {
  // Ensure a FRESH `dist/` deterministically: the gate may run `vitest` before `build`,
  // so if the emit is absent, produce it with a BOUNDED synchronous build that EXITS
  // (never a lingering server — no watch, no listen). `execFileSync` blocks until the
  // build process exits, so it cannot hang the gate.
  if (!existsSync(DIST_APP)) {
    execFileSync('pnpm', ['run', 'build'], { cwd: API_ROOT, stdio: 'pipe' });
  }

  // Throwaway migrated SQLite DB (the P-6 envelope) so `app.init()` (which triggers
  // PrismaService.onModuleInit → $connect) has a real schema to connect to WITHOUT
  // touching the shared dev.db. ABSOLUTE `file:` URL so the prisma CLI and the runtime
  // client resolve the SAME file (L-6).
  originalDatabaseUrl = process.env.DATABASE_URL;
  tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-distboot-'));
  process.env.DATABASE_URL = `file:${join(tmpDir, 'distboot.db')}`;
  execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
    cwd: API_ROOT,
    env: process.env,
    stdio: 'pipe',
  });
}, 120_000);

afterAll(async () => {
  await app?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe('compiled dist/ boots under Node (R-41 source↔emit boot gate)', () => {
  it('imports dist/app.js and app.init() resolves with NO Cannot find module / MODULE_NOT_FOUND', async () => {
    // Dynamically import the EMITTED CommonJS module (via a file:// URL so Node resolves
    // it as a real on-disk path, executing every `require()` in the composition root).
    const mod = (await import(pathToFileURL(DIST_APP).href)) as {
      createApp?: () => Promise<INestApplication>;
      default?: { createApp?: () => Promise<INestApplication> };
    };
    const createApp = mod.createApp ?? mod.default?.createApp;
    expect(typeof createApp).toBe('function');

    // Boot the real composition root over compiled JS. app.init() (NOT listen) runs the
    // full module-resolution + DI graph — the require('./admin.guard') chain fires here.
    // A missing/misnamed emitted module surfaces as a thrown MODULE_NOT_FOUND, failing
    // this expect; a clean boot resolves.
    await expect(
      (async () => {
        app = await createApp!();
        await app.init();
      })(),
    ).resolves.not.toThrow();

    // The app is live (module resolution + DI succeeded over the emitted JS).
    expect(app).toBeDefined();
  }, 120_000);
});
