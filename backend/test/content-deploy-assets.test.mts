/**
 * content-deploy asset regression: the bundle's `assetManifest` must
 * materialize file-backed content (arena GLBs) onto the target backend,
 * idempotently, on `content:deploy --apply`.
 *
 * Before this: `assetManifest` was always empty and apply wrote NO files —
 * an arena GLB edited in dev reached staging/prod only by being git-tracked
 * and re-bundled by a frontend rebuild, never via content-deploy. This test
 * proves the committed bundle now carries the arena GLBs and that the real
 * `applyArenaAssets` writes them, skips them on re-apply, reports missing
 * staged files, and rejects path-traversal rels.
 *
 * Run: pnpm --filter @digiworld/backend test:content-deploy-assets
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyArenaAssets, applySceneAssets } from '../src/content-deploy/assets.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const BUNDLE_PATH = resolve(ROOT, 'content', 'content-bundle.json');

// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}
function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function main(): void {
  const scratch = mkdtempSync(join(tmpdir(), 'dw-assets-'));

  // -------------------------------------------------------------------------
  // 1. Synthetic bundle: staged arena GLB + manifest with correct/forced sha.
  // -------------------------------------------------------------------------
  const bundleDir = join(scratch, 'bundle');
  const stageArena = join(bundleDir, 'assets', 'arenas');
  mkdirSync(stageArena, { recursive: true });
  const fakeBytes = Buffer.from('fake-glb-bytes-\x00\x01\x02arena', 'utf8');
  writeFileSync(join(stageArena, 'arena.glb'), fakeBytes);

  const destRoot = join(scratch, 'dest');
  const correctManifest = [
    { rel: 'arenas/arena.glb', bytes: fakeBytes.byteLength, sha256: sha256(fakeBytes) },
  ];

  applyArenaAssets(bundleDir, correctManifest, destRoot).then(async (s1) => {
    // --- written once ---
    const destFile = join(destRoot, 'arena.glb');
    check('1a arena.glb applied once', s1.applied.includes('arenas/arena.glb')
      && s1.skippedUnchanged.length === 0, JSON.stringify(s1));
    check('1b dest bytes match staged source', existsSync(destFile)
      && sha256(readFileSync(destFile)) === sha256(fakeBytes));
    const mtime1 = statSync(destFile).mtimeMs;
    const mtime1ns = statSync(destFile).mtimeMs;

    // --- idempotent re-apply: no rewrite ---
    const s2 = await applyArenaAssets(bundleDir, correctManifest, destRoot);
    check('2a idempotent re-apply reported unchanged', s2.skippedUnchanged.includes('arenas/arena.glb')
      && s2.applied.length === 0, JSON.stringify(s2));
    check('2b dest file not rewritten on re-apply', statSync(destFile).mtimeMs === mtime1ns);

    // --- missing staged file: reported, not written ---
    const s3 = await applyArenaAssets(
      bundleDir,
      [{ rel: 'arenas/missing.glb', bytes: 4, sha256: 'aa' }],
      destRoot,
    );
    check('3 missing staged file reported & not written',
      s3.missing.includes('arenas/missing.glb')
      && !existsSync(join(destRoot, 'missing.glb')), JSON.stringify(s3));

    // --- traversal-rel is rejected (never escapes arenas/) ---
    mkdirSync(join(bundleDir, 'assets'), { recursive: true });
    writeFileSync(join(bundleDir, 'assets', 'evil.glb'), Buffer.from('evil'));
    const s4 = await applyArenaAssets(
      bundleDir,
      [{ rel: 'arenas/../evil.glb', bytes: 4, sha256: 'aa' }],
      destRoot,
    );
    const escaped = join(destRoot, 'evil.glb');
    check('4 traversal rel rejected (not applied, nothing escaped)',
      !s4.applied.includes('arenas/../evil.glb') && !existsSync(escaped)
      && !s4.applied.some((r) => r.includes('..')), JSON.stringify(s4));
    // 2b mtime check needs our var, silence unused second capture.
    void mtime1;

    // -----------------------------------------------------------------------
    // 5. REAL committed bundle carries arena GLBs and applies correctly.
    // -----------------------------------------------------------------------
    const bundle = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8')) as {
      assetManifest: Array<{ rel: string; bytes: number; sha256: string }>;
    };
    const arenaEntries = (bundle.assetManifest ?? []).filter((e) => e.rel.startsWith('arenas/'));
    check('5 committed bundle assetManifest carries arena GLBs',
      arenaEntries.some((e) => e.rel === 'arenas/arena.glb'),
      `arenas entries=${arenaEntries.length}`);
    // Scene presets must ship in the same bundle — a staging lobby with an
    // empty scenes.json falls back to DEFAULT_ARENA_MODEL (forest biome).
    const sceneEntries = (bundle.assetManifest ?? []).filter((e) => e.rel.startsWith('scenes/'));
    check('5e committed bundle assetManifest carries scenes/scenes.json',
      sceneEntries.some((e) => e.rel === 'scenes/scenes.json'),
      `scenes entries=${sceneEntries.length}`);
    const realDest = join(scratch, 'real-dest');
    const s5 = await applyArenaAssets(join(ROOT, 'content'), bundle.assetManifest, realDest);
    check('5b committed arena.glb applied to target',
      s5.applied.includes('arenas/arena.glb')
      && existsSync(join(realDest, 'arena.glb')), JSON.stringify(s5));
    // The staged bytes must equal the git-tracked source GLB.
    const srcArena = readFileSync(join(ROOT, 'scene3d', 'assets', 'arenas', 'arena.glb'));
    check('5c applied seeded arena.glb == git-tracked scene3d arena.glb',
      sha256(readFileSync(join(realDest, 'arena.glb'))) === sha256(srcArena));
    // Re-apply the real bundle: idempotent.
    const s5b = await applyArenaAssets(join(ROOT, 'content'), bundle.assetManifest, realDest);
    check('5d re-applying real bundle is idempotent', s5b.applied.length === 0
      && s5b.skippedUnchanged.length === arenaEntries.length, JSON.stringify(s5b));

    // --- 6. scenes/scenes.json applies from the committed bundle -----------
    const scenesDest = join(scratch, 'real-scenes-dest');
    const s6 = await applySceneAssets(join(ROOT, 'content'), bundle.assetManifest, scenesDest);
    check('6a committed scenes/scenes.json applied to target',
      s6.applied.includes('scenes/scenes.json')
      && existsSync(join(scenesDest, 'scenes.json')), JSON.stringify(s6));
    // Staged scenes.json must equal the dev-authoritative scenes store file.
    const srcScenes = readFileSync(join(ROOT, 'backend', 'data', 'scenes', 'scenes.json'));
    check('6b applied scenes.json == dev scenes store file',
      sha256(readFileSync(join(scenesDest, 'scenes.json'))) === sha256(srcScenes));
    const s6b = await applySceneAssets(join(ROOT, 'content'), bundle.assetManifest, scenesDest);
    check('6c re-applying scenes idempotent', s6b.applied.length === 0
      && s6b.skippedUnchanged.length === sceneEntries.length, JSON.stringify(s6b));

    rmSync(scratch, { recursive: true, force: true });
    console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
  }).catch((e) => {
    console.error('test crashed:', e);
    process.exit(1);
  });
}

main();