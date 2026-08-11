/**
 * Skill VFX preset smoke test — end-to-end library-level coverage for the
 * skill-vfx feature shipped this session. Exercises:
 *
 *   - CRUD round-trip through the file-backed store (create / list / get /
 *     update / delete) with a scratch data dir set via DATA_DIR
 *   - SkillVfxPresetWriteZ validation on valid + invalid inputs (missing
 *     required fields, out-of-range values, too many emitters, wrong
 *     trajectory enum)
 *
 * Uses the real store functions the HTTP admin routes call, so what passes
 * here is the same code path production runs.
 *
 * Run: pnpm --filter @digiworld/backend test:skill-vfx
 *   (requires DATA_DIR pointing at a scratch dir, e.g. /tmp/dw-svfx-smoke)
 */

import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ParticleEmitterConfig } from '@digiworld/shared/weather';
import { SkillVfxPresetWriteZ } from '@digiworld/shared/skill-vfx';

const DATA_DIR = process.env.DATA_DIR;
if (DATA_DIR === undefined || DATA_DIR === '') {
  console.error('DATA_DIR env var required, e.g. DATA_DIR=/tmp/dw-svfx-smoke');
  process.exit(1);
}
const PRESETS_PATH = resolve(DATA_DIR, 'scenes', 'skill-vfx-presets.json');
if (existsSync(PRESETS_PATH)) rmSync(PRESETS_PATH);

// The per-skill selector section writes to `skills_catalog`, so the database is
// a fixture too — and `test:skill-vfx` pins DB_PATH to a fixed path. Without
// this the suite passes once and then fails on `duplicate-name` forever after,
// which is how it was first shipped. Cleared here, next to the presets file, so
// both fixtures reset in the same place. Removed before any DB module is
// imported, since the connection is opened lazily on first use.
const DB_PATH = process.env.DB_PATH;
if (DB_PATH !== undefined && DB_PATH !== '') {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${DB_PATH}${suffix}`;
    if (existsSync(file)) rmSync(file);
  }
}

const {
  createSkillVfxPreset,
  deleteSkillVfxPreset,
  getSkillVfxPreset,
  invalidateSkillVfxPresetsCache,
  listSkillVfxPresets,
  updateSkillVfxPreset,
} = await import('../src/skill-vfx/store.ts');

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  PASS: ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function sampleEmitter(): ParticleEmitterConfig {
  return {
    id: 'e_sample',
    name: 'sample sparks',
    kind: 'instanced',
    geometry: 'quad',
    shader: 'default',
    emissionRate: 30,
    maxParticles: 50,
    lifetimeMs: [200, 400],
    startSize: [0.1, 0.2],
    endSize: [0.05, 0.08],
    startColor: 0xffee88,
    endColor: 0xff8800,
    startOpacity: 1,
    endOpacity: 0,
    velocity: { base: [0, 1, 0], variance: [1, 1, 1] },
    gravity: [0, -3, 0],
    wind: [0, 0, 0],
    drag: 0.1,
    spawn: { shape: 'point', size: [0, 0, 0], center: [0, 0, 0] },
    blending: 'additive',
    emissionMode: 'oneshot',
    burstCount: 30,
    totalLifetimeMs: 400,
  };
}

async function testStoreCrud(): Promise<void> {
  console.log('\n=== Store CRUD round-trip ===');

  invalidateSkillVfxPresetsCache();

  const initial = await listSkillVfxPresets();
  check('list starts empty', initial.length === 0, `got ${initial.length}`);

  const created = await createSkillVfxPreset({
    name: 'electricity — shock burst',
    element: 'electricity',
    emitters: [
      { emitter: sampleEmitter(), startAtMs: 0, followTrajectory: true },
    ],
    trajectory: 'straight',
    totalDurationMs: 900,
    impactAtMs: 500,
    light: { color: 0xffee88, intensity: 5.5, distance: 7, decayMs: 700 },
  });

  check('create returns preset with generated id', typeof created.id === 'string' && created.id.startsWith('svfx'));
  check('create trims name', created.name === 'electricity — shock burst');
  check('create preserves trajectory', created.trajectory === 'straight');
  check('create preserves element', created.element === 'electricity');
  check('create preserves light', created.light?.color === 0xffee88);
  check('create regenerates emitter id (server-controlled)', created.emitters[0]!.emitter.id !== 'e_sample' && created.emitters[0]!.emitter.id.startsWith('emt'));
  check('create sets timestamps', created.createdAt > 0 && created.updatedAt === created.createdAt);

  const listed = await listSkillVfxPresets();
  check('list returns 1 after create', listed.length === 1);

  const got = await getSkillVfxPreset(created.id);
  check('get by id returns full preset', got !== null && got.id === created.id);

  const notFound = await getSkillVfxPreset('svfx-nonexistent');
  check('get by unknown id returns null', notFound === null);

  const updated = await updateSkillVfxPreset(created.id, {
    name: 'renamed',
    trajectory: 'arc',
  });
  check('update returns the mutated preset', updated !== null && updated.name === 'renamed' && updated.trajectory === 'arc');
  check('update keeps unspecified fields', updated?.element === 'electricity' && updated?.impactAtMs === 500);
  check('update bumps updatedAt', updated !== null && updated.updatedAt >= updated.createdAt);
  check('update keeps createdAt', updated?.createdAt === created.createdAt);

  const missing = await updateSkillVfxPreset('svfx-nonexistent', { name: 'x' });
  check('update on unknown id returns null', missing === null);

  const del = await deleteSkillVfxPreset(created.id);
  check('delete returns true when preset existed', del === true);

  const delAgain = await deleteSkillVfxPreset(created.id);
  check('delete returns false on second attempt', delAgain === false);

  const afterDel = await listSkillVfxPresets();
  check('list empty after delete', afterDel.length === 0);
}

function testZodValidation(): void {
  console.log('\n=== Zod SkillVfxPresetWriteZ validation ===');

  const validBody = {
    name: 'valid preset',
    element: 'electricity' as const,
    emitters: [
      { emitter: sampleEmitter(), startAtMs: 0, followTrajectory: true },
    ],
    trajectory: 'straight' as const,
    totalDurationMs: 900,
    impactAtMs: 500,
    light: { color: 0xffffff, intensity: 4, distance: 5, decayMs: 700 },
  };

  const ok = SkillVfxPresetWriteZ.safeParse(validBody);
  check('valid body parses OK', ok.success, ok.success ? '' : JSON.stringify(ok.error.issues));

  const noEmitters = SkillVfxPresetWriteZ.safeParse({ ...validBody, emitters: [] });
  check('rejects empty emitters array', !noEmitters.success);

  const tooManyEmitters = SkillVfxPresetWriteZ.safeParse({
    ...validBody,
    emitters: [
      { emitter: sampleEmitter(), startAtMs: 0, followTrajectory: true },
      { emitter: sampleEmitter(), startAtMs: 100, followTrajectory: true },
      { emitter: sampleEmitter(), startAtMs: 200, followTrajectory: true },
      { emitter: sampleEmitter(), startAtMs: 300, followTrajectory: true },
    ],
  });
  check('rejects 4 emitters (max 3)', !tooManyEmitters.success);

  const missingName = SkillVfxPresetWriteZ.safeParse({ ...validBody, name: undefined });
  check('rejects missing name', !missingName.success);

  const badTrajectory = SkillVfxPresetWriteZ.safeParse({ ...validBody, trajectory: 'teleport' });
  check('rejects unknown trajectory', !badTrajectory.success);

  const badElement = SkillVfxPresetWriteZ.safeParse({ ...validBody, element: 'holy' });
  check('rejects unknown element', !badElement.success);

  const durationTooLong = SkillVfxPresetWriteZ.safeParse({ ...validBody, totalDurationMs: 6000 });
  check('rejects totalDurationMs > 5000', !durationTooLong.success);

  const durationTooShort = SkillVfxPresetWriteZ.safeParse({ ...validBody, totalDurationMs: 0 });
  check('rejects totalDurationMs = 0', !durationTooShort.success);

  const lightIntensityTooHigh = SkillVfxPresetWriteZ.safeParse({
    ...validBody,
    light: { color: 0, intensity: 50, distance: 5, decayMs: 700 },
  });
  check('rejects light intensity > 20', !lightIntensityTooHigh.success);

  const negativeStartAt = SkillVfxPresetWriteZ.safeParse({
    ...validBody,
    emitters: [{ emitter: sampleEmitter(), startAtMs: -100, followTrajectory: false }],
  });
  check('rejects negative startAtMs', !negativeStartAt.success);

  const missingLightOk = SkillVfxPresetWriteZ.safeParse({ ...validBody, light: undefined });
  check('accepts missing light (optional)', missingLightOk.success, missingLightOk.success ? '' : JSON.stringify(missingLightOk.error.issues));

  const missingElementOk = SkillVfxPresetWriteZ.safeParse({ ...validBody, element: undefined });
  check('accepts missing element (optional)', missingElementOk.success, missingElementOk.success ? '' : JSON.stringify(missingElementOk.error.issues));
}

async function testSkillSelector(): Promise<void> {
  console.log('\n=== Per-skill effect selection ===');
  // The selector is only useful if the id survives the write path AND a typo is
  // refused. A dangling preset id is invisible at runtime — playEffect silently
  // falls back to the element runner — so the write is the only place it can be
  // caught.
  const { createSkill, updateSkill, getSkill } = await import('../src/skills/catalog.js');
  const { createSkillVfxPreset } = await import('../src/skill-vfx/store.js');

  const preset = await createSkillVfxPreset({
    name: 'selector probe',
    emitters: [{ emitter: sampleEmitter(), startAtMs: 0, followTrajectory: true }],
    trajectory: 'straight',
    totalDurationMs: 800,
    impactAtMs: 400,
  });

  const base = {
    name: 'Selector Probe Skill',
    element: 'fire' as const,
    energyCost: 10,
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 10, scale: 'atk', factor: 1 } }],
  };

  const made = await createSkill({ ...base, vfxPresetId: preset.id });
  check('skill accepts a real preset id', made.ok, made.ok ? '' : String((made as { error: string }).error));
  if (!made.ok) return;
  const readBack = await getSkill(made.skill.id);
  check('preset id round-trips through the DB', readBack?.vfxPresetId === preset.id, `got ${String(readBack?.vfxPresetId)}`);

  const bogus = await createSkill({ ...base, name: 'Bogus Preset Skill', vfxPresetId: 'svfx_does_not_exist_000000' });
  check('unknown preset id is refused', !bogus.ok && bogus.error === 'unknown-vfx-preset',
    bogus.ok ? 'accepted' : `error=${bogus.error}`);

  const cleared = await updateSkill(made.skill.id, base);
  check('omitting the field clears it back to element fallback',
    cleared.ok && (await getSkill(made.skill.id))?.vfxPresetId === undefined);
}

try {
  await testStoreCrud();
  testZodValidation();
  await testSkillSelector();
} catch (err) {
  failed += 1;
  console.error(`\n  FATAL: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
}

console.log(`\n=== ${passed} passed / ${failed} failed ===`);
if (failed > 0) process.exit(1);
