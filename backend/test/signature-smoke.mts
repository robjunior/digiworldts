/**
 * Signature skill spike — smoke test.
 *
 * Verifies:
 *   1. The element→archetype→slot_role map (skills/archetypes.ts) is coherent:
 *      every archetype uses only known slot_roles.
 *   2. Content integrity: every signature=1 row in skills_catalog represents one
 *      of its ELEMENT's archetypes (the rule the selection endpoint enforces).
 *   3. buildSkillPoolFromCatalog no longer dumps signatures into the generic
 *      pool (which broke single-selection); it returns only element+stage skills.
 *   4. The roster carries the scalar signature_skill_id column (exactly ONE
 *      selection is structurally possible).
 *
 * Run: DB_PATH=/tmp/dw-signature-smoke.db pnpm --filter @digiworld/backend test:signature
 */
import { existsSync, unlinkSync } from 'node:fs';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { q } from '../src/db/index.ts';
import { seedSkillsCatalogV2 } from '../src/skills/seed-catalog.ts';
import { EQUIPPED_SLOTS_PER_STAGE } from '@digiworld/shared/digimon';
import { ELEMENT_ARCHETYPES, SLOT_ROLES, elementAllowedSlotRoles, signatureRepresentsElementArchetype, slotRoleToArchetype } from '../src/skills/archetypes.ts';
import { buildSkillPoolFromCatalog } from '../src/skills/pool.ts';

const DB_PATH = process.env.DB_PATH!;
if (!DB_PATH) {
  console.error('FAIL: set DB_PATH env (e.g. /tmp/dw-signature-smoke.db)');
  process.exit(1);
}

for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}

await getDb();
const seed = await seedSkillsCatalogV2();
console.log(`  skill seed: ${seed.inserted} inserted, ${seed.skipped} skipped (catalog may already be seeded)`);
if (seed.validationErrors.length > 0) {
  console.error('FAIL: seed validation errors', seed.validationErrors);
  process.exit(1);
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`  PASS: ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('\n=== 1. Element archetype map coherence ===');
const elements = Object.keys(ELEMENT_ARCHETYPES) as (keyof typeof ELEMENT_ARCHETYPES)[];
for (const el of elements) {
  const archs = ELEMENT_ARCHETYPES[el];
  check(
    `[${el}] has ≥1 archetype`,
    archs.length > 0,
    `${archs.length} archetypes`,
  );
  const allowed = elementAllowedSlotRoles(el);
  for (const arch of archs) {
    check(
      `[${el}] ${arch.name} uses only known slot_roles`,
      arch.slotRoles.every((r) => SLOT_ROLES.includes(r)),
      JSON.stringify(arch.slotRoles),
    );
  }
  check(
    `[${el}] every allowed role maps back to an archetype`,
    [...allowed].every((r) => slotRoleToArchetype(el, r) !== null),
  );
}

console.log('\n=== 2. Signature content integrity (each signature = element archetype) ===');
const signatures = await q<{ id: string; element: string; slot_role: string | null }>(
  `SELECT id, element, slot_role FROM skills_catalog WHERE signature = 1 AND enabled = 1`,
);
console.log(`  ... ${signatures.length} signature skills seeded`);
check(
  'every signature with a slot_role represents an element archetype',
  signatures.every((s) => s.slot_role === null || signatureRepresentsElementArchetype(s.element as never, s.slot_role)),
);

console.log('\n=== 3. buildSkillPoolFromCatalog returns generic pool only (no signatures) ===');
const sigSet = new Set(signatures.map((s) => s.id));
const sample = await q<{ template_id: string; element: string; stage: string }>(
  `SELECT owner_template_id AS template_id, element, stage
     FROM skills_catalog WHERE signature = 1 AND enabled = 1 AND owner_template_id IS NOT NULL
     GROUP BY owner_template_id, element, stage LIMIT 1`,
);
let genericSampleChecked = false;
if (sample[0]) {
  const pool = await buildSkillPoolFromCatalog(sample[0].template_id, sample[0].element as never, sample[0].stage as never);
  const cap = EQUIPPED_SLOTS_PER_STAGE[sample[0].stage as never];
  const hasSignature = pool.some((s) => sigSet.has(s.id));
  check(
    `generic pool excludes all signatures`,
    !hasSignature,
    `${pool.length} skills, none signature`,
  );
  check(
    `generic pool fills the stage cap`,
    pool.length === cap,
    `got ${pool.length}, cap ${cap}`,
  );
  genericSampleChecked = true;
}
// If no owner_template_id sample exists, the check is vacuous — but signatures were found, so it should not trigger.
check('sample signature template resolved for pool test', genericSampleChecked);

console.log('\n=== 4. Roster carries the scalar signature column (single selection) ===');
// Portable column check: selecting the column succeeds iff it exists (SQLite + Postgres).
let signatureColumnPresent = false;
try {
  await q<{ n: number }>(`SELECT signature_skill_id FROM player_roster LIMIT 0`);
  signatureColumnPresent = true;
} catch {
  signatureColumnPresent = false;
}
check(
  'player_roster.signature_skill_id exists',
  signatureColumnPresent,
  signatureColumnPresent ? 'scalar TEXT column (one selection)' : 'missing',
);

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
await closeDbAdapter();
if (failed > 0) process.exit(1);