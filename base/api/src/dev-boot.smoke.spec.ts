import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Dev-emit→ENTRY boot-smoke test (TASK-270, R-43) — the DEV-BOOT sibling of the R-41
 * `dist-boot.smoke.spec.ts`, closing the gap that I-30 exposed: `pnpm dev` → `apps/api`
 * `nest start --watch` printed `Found 0 errors` then died with
 * `Error: Cannot find module '.../apps/api/dist/main'` (MODULE_NOT_FOUND), so the Vite
 * dev proxy hit repeated `/api/auth/refresh ECONNREFUSED`.
 *
 * WHY this spec exists ALONGSIDE `dist-boot.smoke.spec.ts`: that R-41 spec boots the
 * emitted `dist/app.js` (the composition root) IN-PROCESS, but it never exercises the
 * `dist/main.js` ENTRY the nest-watch runner actually `require()`s — the exact file the
 * I-30 crash names. The dev-watch failure was that `dist/main.js` was transiently ABSENT
 * (nest-cli's `deleteOutDir: true` wiped `dist/` then tsc-watch re-emitted ASYNCHRONOUSLY,
 * so the runner's `node <entry>` spawn could fire in the empty window). The fix drops
 * `deleteOutDir` (in-place incremental emit, no wipe window) + pins `entryFile: "main"` so
 * the runner's computed entry matches the emitted `dist/main.js`. This spec GATES that the
 * dev entry is present + Node-resolvable so the class can never silently ship green again.
 *
 * IN-PROCESS + ZERO HANG SURFACE (D-495 no-hang discipline): `dist/main.js` runs
 * `bootstrap()` → `app.listen()` at top level, so IMPORTING it would bind a port and hang
 * the gate. Instead this spec asserts the entry EXISTS on disk and that a `require.resolve`
 * of it from `apps/api` SUCCEEDS — proving the runner's require target resolves — WITHOUT
 * importing/booting it (no port bind, no child spawn, no awaited stdout). The full compiled
 * require chain is already exercised by the R-41 spec's `createApp()` + `app.init()`.
 */

// apps/api root (this spec sits at src/, so up ONE level).
const API_ROOT = resolve(__dirname, '..');
const DIST_MAIN = join(API_ROOT, 'dist', 'main.js');

describe('compiled dev entry dist/main.js is present + Node-resolvable (R-43 dev-boot entry gate)', () => {
  it('has dist/main.js on disk and require.resolve finds it (no Cannot find module for the entry)', () => {
    // Ensure a FRESH emit deterministically: the gate may run `vitest` before `build`, so
    // if the entry is absent, produce it with a BOUNDED synchronous build that EXITS (never
    // a watch/listen). `execFileSync` blocks until the build process exits — it cannot hang.
    if (!existsSync(DIST_MAIN)) {
      execFileSync('pnpm', ['run', 'build'], { cwd: API_ROOT, stdio: 'pipe' });
    }

    // (1) The exact file the I-30 crash names must exist on disk — the dev runner spawns
    //     `node dist/main`, so an absent `dist/main.js` is precisely the crash.
    expect(existsSync(DIST_MAIN)).toBe(true);

    // (2) Node's module resolver must resolve the entry from apps/api — this is the SAME
    //     resolution the nest-watch runner performs. A missing/misnamed emitted entry throws
    //     MODULE_NOT_FOUND ('Cannot find module') HERE, the exact I-30 class, WITHOUT booting
    //     a port (resolve is pure path resolution — it does not execute the module).
    const requireFromRoot = createRequire(join(API_ROOT, 'package.json'));
    expect(() => requireFromRoot.resolve('./dist/main')).not.toThrow();
    expect(requireFromRoot.resolve('./dist/main')).toBe(DIST_MAIN);
  }, 120_000);
});
