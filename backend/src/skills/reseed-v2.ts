/**
 * CLI: wipe the skills_catalog table and re-seed it entirely from the
 * per-element seed files in `backend/src/skills/seeds/` (the single source of
 * truth). Uses a raw better-sqlite3 connection directly on skills_catalog so
 * the dev DB's other tables (and their migrations) are never touched.
 *
 * Meant for local dev / staging warm-up. Production deploys run the seed via
 * boot with SKILLS_V2_ENABLED=1 instead.
 *
 * Usage:
 *   pnpm tsx src/skills/reseed-v2.ts                 # dev DB (data/digiworld.db)
 *   DB_PATH=/tmp/dw-reseed-test.db \
 *     pnpm tsx src/skills/reseed-v2.ts               # isolated temp DB for validation
 */
import Database from 'better-sqlite3';
import type { Database as DatabaseHandle } from 'better-sqlite3';
import { config } from '../config.js';
import { ALL_SKILL_SEEDS } from './seeds/index.js';
import { stringifyActions, stringifyTags } from './dsl.js';
import { log } from '../util/log.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SQL_DELETE = `DELETE FROM skills_catalog`;
const SQL_UPSERT = `INSERT INTO skills_catalog
  (id, name, description, element, energy_cost, cooldown, actions_json, tags_json, animation, enabled,
   name_pt, description_pt, stage, slot_role, upgrade_of, tier_2, vfx_preset_id, signature, owner_template_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (name) DO NOTHING`;
const SQL_COUNT = `SELECT COUNT(*) as cnt FROM skills_catalog`;
const SQL_BY_ELEMENT = `SELECT element, COUNT(*) as cnt FROM skills_catalog GROUP BY element ORDER BY element`;
const SQL_SIGNATURES = `SELECT COUNT(*) as cnt FROM skills_catalog WHERE signature = 1`;
const SQL_TEMPLATES_WITH_SIG =
  `SELECT owner_template_id, COUNT(*) as cnt FROM skills_catalog WHERE signature = 1 AND owner_template_id IS NOT NULL GROUP BY owner_template_id ORDER BY owner_template_id`;

/** Validate a seed against the Skill DSL schema without touching the DB. */
function validateSeed(seed: typeof ALL_SKILL_SEEDS[number]): { ok: boolean; issues?: unknown } {
  if (!seed.name || typeof seed.name !== 'string') return { ok: false, issues: 'missing/invalid name' };
  if (!seed.element || typeof seed.element !== 'string') return { ok: false, issues: 'missing/invalid element' };
  if (!Array.isArray(seed.actions)) return { ok: false, issues: 'actions not an array' };
  return { ok: true };
}

function openRawDb(): DatabaseHandle {
  const dbPath = config.paths.db;
  mkdirSync(dirname(dbPath), { recursive: true });
  const handle = new Database(dbPath);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  return handle;
}

async function main(): Promise<void> {
  log.info('skills.reseed.start', { dbPath: config.paths.db });

  const db = openRawDb();
  const now = Date.now();

  // 1. Snapshot before.
  const before = db.prepare(SQL_COUNT).get() as { cnt: number } | undefined;
  const beforeCount = before?.cnt ?? 0;

  // 2. Wipe.
  const deleted = db.prepare(SQL_DELETE).run();
  if (deleted.changes !== beforeCount) {
    log.warn('skills.reseed.wipe.partial', { expected: beforeCount, deleted: deleted.changes });
  }

  // 3. Seed loop (synchronous on raw handle; still one insert per seed).
  let inserted = 0;
  let skipped = 0;
  const validationErrors: Array<{ id: string; issues: unknown }> = [];

  const stmt = db.prepare(SQL_UPSERT);
  for (const seed of ALL_SKILL_SEEDS) {
    const validation = validateSeed(seed);
    if (!validation.ok) {
      validationErrors.push({ id: seed.id, issues: validation.issues });
      skipped += 1;
      continue;
    }
    const outcome = stmt.run(
      seed.id,
      seed.name,
      seed.description ?? '',
      seed.element,
      seed.energyCost,
      seed.cooldown ?? 0,
      stringifyActions(seed.actions),
      stringifyTags(seed.tags ?? []),
      seed.animation ?? null,
      seed.enabled === false ? 0 : 1,
      seed.name_pt ?? '',
      seed.description_pt ?? null,
      seed.stage ?? null,
      seed.slot_role ?? null,
      seed.upgrade_of ?? null,
      seed.tier_2 === true ? 1 : 0,
      null,
      seed.signature === true ? 1 : 0,
      seed.owner_template_id ?? null,
      now,
      now,
    );
    if (outcome.changes > 0) inserted += 1;
    else skipped += 1;
  }

  // 4. Snapshot after.
  const after = db.prepare(SQL_COUNT).get() as { cnt: number } | undefined;
  const afterCount = after?.cnt ?? 0;
  const byElementRows = db.prepare(SQL_BY_ELEMENT).all() as Array<{ element: string; cnt: number }>;
  const sigCountRow = db.prepare(SQL_SIGNATURES).get() as { cnt: number } | undefined;
  const sigCount = sigCountRow?.cnt ?? 0;
  const templateRows = db.prepare(SQL_TEMPLATES_WITH_SIG).all() as Array<{ owner_template_id: string; cnt: number }>;

  log.info('skills.reseed.done', {
    beforeCount,
    afterCount,
    inserted,
    skipped,
    validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    byElement: Object.fromEntries(byElementRows.map((r) => [r.element, r.cnt])),
    signatureCount: sigCount,
    templatesWithSignatureSkills: templateRows.map((t) => ({ template: t.owner_template_id, count: t.cnt })),
  });

  db.close();
}

main().catch((err) => {
  log.error('skills.reseed.fail', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
