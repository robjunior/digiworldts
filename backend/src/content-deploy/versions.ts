/**
 * Content-deploy engine — transactional version pointer swaps.
 *
 * `content:deploy --apply` promotes a seed artifact into the target DB by
 * doing three things inside a SINGLE transaction:
 *
 *   1. UPSERT every artifact row into its content table (this is the actual
 *      deploy — the artifact is the deployment unit).
 *   2. INSERT one `content_versions` row per (domain, ref_id) — an immutable,
 *      frozen JSON snapshot of the row with an incrementing version_number.
 *   3. UPSERT `active_versions` so the (domain, ref_id) pointer targets the
 *      new snapshot.
 *
 * `content:deploy --rollback` walks `active_versions`, restores each content
 * row from its PREVIOUS snapshot (definition_json) and re-points the pointer
 * to that previous version — again all in one transaction.
 *
 * Guardrails (see .omo/plans/content-lifecycle-v1.md):
 *   - Never mutates player-state tables (player_*, user_*, pending_*,
 *     wallet_*, friendships, coin_offers, sessions, resources,
 *     login_attempts) — enforced by the caller's forbidden-table check.
 *   - `--apply` refuses to run until cross-domain references inside the
 *     artifact validate cleanly (validateXref). Broken refs abort before any
 *     write touches the DB.
 *   - apply is ADDITIVE: rows present in the artifact are upserted; rows only
 *     in the DB are left untouched (deletes are reported by --diff, never
 *     executed by --apply).
 *
 * Domain model: `domain` = content table name, `ref_id` = the row's primary
 * key value (from CONTENT_TABLES orderBy, composite keys JSON-joined). This
 * maps 1:1 onto the seed artifact's `tables` object and keeps the version
 * ledger per content row.
 */
import type { DbAdapter } from '../db/adapter.js';
import { tx } from '../db/index.js';
import { CONTENT_TABLES } from '../seed-export/content-tables.js';
import { newId } from '../util/ids.js';
import { unresolvedReferences, type CrossRefChecker } from '../dialogues/xref.js';
import type { DialogueDefinition } from '@digiworld/shared/dialogue';

type Row = Record<string, unknown>;

// ============================================================================
// Version ledger SQL
// ============================================================================

const SQL_NEXT_VERSION = `SELECT COALESCE(MAX(version_number), 0) + 1 AS next
  FROM content_versions WHERE domain = ? AND ref_id = ?`;

const SQL_INSERT_VERSION = `INSERT INTO content_versions
  (id, domain, ref_id, version_number, status, definition_json, created_at, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`;

const SQL_UPSERT_ACTIVE = `INSERT INTO active_versions (domain, ref_id, version_id)
  VALUES (?, ?, ?)
  ON CONFLICT(domain, ref_id) DO UPDATE SET version_id = excluded.version_id`;

const SQL_ALL_ACTIVE = `SELECT domain, ref_id, version_id FROM active_versions ORDER BY domain, ref_id`;

const SQL_VERSION_BY_ID = `SELECT id, domain, ref_id, version_number, status, definition_json, created_at, created_by
  FROM content_versions WHERE id = ?`;

const SQL_PREV_VERSION = `SELECT id, domain, ref_id, version_number, status, definition_json, created_at, created_by
  FROM content_versions WHERE domain = ? AND ref_id = ? AND version_number < ?
  ORDER BY version_number DESC LIMIT 1`;

const SQL_UPDATE_ACTIVE = `UPDATE active_versions SET version_id = ? WHERE domain = ? AND ref_id = ?`;

// ============================================================================
// Row helpers
// ============================================================================

/** Canonical JSON serialization so row equality ignores key order. */
export function canon(row: Row): string {
  return JSON.stringify(Object.keys(row).sort().map((k) => [k, row[k]]));
}

/** PK column names for a content table (falls back to `id`). */
export function pkColumnsOf(name: string): readonly string[] {
  return CONTENT_TABLES.find((t) => t.name === name)?.orderBy ?? ['id'];
}

/** Stable per-row identity from its PK values (composite keys JSON-joined). */
export function rowKey(row: Row, pk: readonly string[]): string {
  return JSON.stringify(pk.map((col) => row[col]));
}

/** Double-quoted identifier — safe for the whitelisted CONTENT_TABLES names
 *  and artifact column names coming from `SELECT *` of the same schema. */
function qid(ident: string): string {
  return `"${ident}"`;
}

/** Build `INSERT ... ON CONFLICT(pk) DO UPDATE SET ...` for one content table.
 *  Columns come from the artifact row keys; PKs from CONTENT_TABLES. */
function buildUpsertSql(table: string, cols: readonly string[], pk: readonly string[]): string {
  const colList = cols.map(qid).join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  const conflict = pk.map(qid).join(', ');
  const updatable = cols.filter((c) => !pk.includes(c));
  const updateClause = updatable.length === 0
    ? 'DO NOTHING'
    : `DO UPDATE SET ${updatable.map((c) => `${qid(c)} = excluded.${qid(c)}`).join(', ')}`;
  return `INSERT INTO ${qid(table)} (${colList}) VALUES (${placeholders}) ON CONFLICT (${conflict}) ${updateClause}`;
}

// ============================================================================
// Cross-domain reference validation (the --apply gate)
// ============================================================================

/**
 * Validate every cross-domain reference inside the artifact against the
 * artifact's OWN tables (self-contained — the artifact must be internally
 * consistent before it may be deployed anywhere):
 *
 *   quests.data          → talk objective npcId → npcs
 *                          collect objective itemId → shop_items
 *                          dialogue step / introDialogueId → dialogue_definitions
 *                          finalReward items itemId → shop_items
 *                          unlocksQuestIds → quests
 *   dialogue ir_json     → speaker npcId + expression → npcs
 *                          give_item / remove_item / player_has_item → shop_items
 *                          start_quest → quests
 *
 * Reuses `unresolvedReferences` from dialogues/xref.ts with an artifact-backed
 * checker, so dialogue validation is the same logic the dialogue importer
 * already runs against the live DB — just scoped to the artifact.
 *
 * Returns a list of human-readable errors (empty = clean).
 */
export function validateXref(env: { tables: Record<string, Row[]> }): string[] {
  const errors: string[] = [];
  const table = (n: string): Map<string, Row> =>
    new Map((env.tables[n] ?? []).map((r) => [String(r[pkColumnsOf(n)[0] ?? 'id']), r]));

  const quests = env.tables['quests'] ?? [];
  const npcs = env.tables['npcs'] ?? [];
  const items = env.tables['shop_items'] ?? [];
  const dialogues = env.tables['dialogue_definitions'] ?? [];

  const questIds = new Set(quests.map((r) => String(r['id'])));
  const npcIds = new Set(npcs.map((r) => String(r['id'])));
  const itemIds = new Set(items.map((r) => String(r['id'])));
  const dialogueIds = new Set(dialogues.map((r) => String(r['dialogue_id'])));

  // NPC expression index for the dialogue checker.
  const npcExpressions = new Map<string, Set<string>>();
  for (const n of npcs) {
    let exprs: Array<{ key: string }> = [];
    try {
      exprs = JSON.parse(String(n['expressions'] ?? '[]')) as Array<{ key: string }>;
    } catch {
      exprs = [];
    }
    npcExpressions.set(String(n['id']), new Set(exprs.map((e) => e.key)));
  }

  // --- quest → * refs (quests.data JSON blob) ---
  for (const q of quests) {
    const qid = String(q['id']);
    let data: {
      objectives?: unknown;
      steps?: unknown;
      introDialogueId?: unknown;
      finalReward?: unknown;
      unlocksQuestIds?: unknown;
    };
    try {
      data = JSON.parse(String(q['data'] ?? '{}')) as typeof data;
    } catch {
      errors.push(`quest ${qid}: data is not valid JSON`);
      continue;
    }
    for (const obj of Array.isArray(data.objectives) ? (data.objectives as Array<Record<string, unknown>>) : []) {
      if (obj['kind'] === 'talk' && typeof obj['npcId'] === 'string' && !npcIds.has(obj['npcId'])) {
        errors.push(`quest ${qid}: talk objective references unknown npc "${obj['npcId']}"`);
      }
      if (obj['kind'] === 'collect' && typeof obj['itemId'] === 'string' && !itemIds.has(obj['itemId'])) {
        errors.push(`quest ${qid}: collect objective references unknown item "${obj['itemId']}"`);
      }
    }
    for (const step of Array.isArray(data.steps) ? (data.steps as Array<Record<string, unknown>>) : []) {
      if (step['type'] === 'dialogue' && typeof step['dialogueId'] === 'string' && !dialogueIds.has(step['dialogueId'])) {
        errors.push(`quest ${qid}: dialogue step references unknown dialogue "${step['dialogueId']}"`);
      }
    }
    if (typeof data.introDialogueId === 'string' && !dialogueIds.has(data.introDialogueId)) {
      errors.push(`quest ${qid}: introDialogueId references unknown dialogue "${data.introDialogueId}"`);
    }
    const reward = data.finalReward as { items?: Array<{ itemId: unknown }> } | undefined;
    for (const it of reward?.items ?? []) {
      if (typeof it.itemId === 'string' && !itemIds.has(it.itemId)) {
        errors.push(`quest ${qid}: finalReward references unknown item "${it.itemId}"`);
      }
    }
    for (const uid of Array.isArray(data.unlocksQuestIds) ? (data.unlocksQuestIds as unknown[]) : []) {
      if (typeof uid === 'string' && !questIds.has(uid)) {
        errors.push(`quest ${qid}: unlocksQuestIds references unknown quest "${uid}"`);
      }
    }
  }

  // --- dialogue → * refs (reuse the dialogue importer's checker) ---
  const checker: CrossRefChecker = {
    npcExists: (id) => npcIds.has(id),
    npcHasExpression: (id, expression) => npcExpressions.get(id)?.has(expression) ?? false,
    questExists: (id) => questIds.has(id),
    itemExists: (id) => itemIds.has(id),
  };
  for (const d of dialogues) {
    const did = String(d['dialogue_id']);
    let def: DialogueDefinition;
    try {
      def = JSON.parse(String(d['ir_json'])) as DialogueDefinition;
    } catch {
      errors.push(`dialogue ${did}: ir_json is not valid JSON`);
      continue;
    }
    for (const u of unresolvedReferences(def, checker)) {
      errors.push(`dialogue ${did}: ${u.message}`);
    }
  }

  return errors;
}

// ============================================================================
// Apply
// ============================================================================

export type ApplySummary = {
  tables: Record<string, { rows: number; versions: number }>;
  totalVersions: number;
};

/**
 * Deploy a validated seed artifact into the target DB — one transaction.
 * For every artifact table: UPSERT each row into the content table, record an
 * immutable content_versions snapshot, and point active_versions at it.
 */
export async function applySeed(env: { tables: Record<string, Row[]> }): Promise<ApplySummary> {
  // The xref gate is enforced here (not just in the CLI) so apply can never be
  // reached with a broken artifact, regardless of entry point.
  const xrefErrors = validateXref(env);
  if (xrefErrors.length > 0) {
    const sample = xrefErrors.slice(0, 15).map((e) => `  - ${e}`).join('\n');
    throw new Error(`cross-domain references broken (${xrefErrors.length}):\n${sample}`);
  }

  const now = Date.now();
  return tx(async (t) => {
    const tables: ApplySummary['tables'] = {};
    let totalVersions = 0;

    for (const name of Object.keys(env.tables)) {
      const rows = env.tables[name] ?? [];
      const pk = pkColumnsOf(name);
      const cols: string[] = [];
      const seen = new Set<string>();
      for (const r of rows) for (const c of Object.keys(r)) if (!seen.has(c)) { seen.add(c); cols.push(c); }
      const upsertSql = buildUpsertSql(name, cols, pk);

      for (const row of rows) {
        await t.run(upsertSql, cols.map((c) => row[c]));
        await recordVersion(t, name, row, pk, now);
      }
      tables[name] = { rows: rows.length, versions: rows.length };
      totalVersions += rows.length;
    }

    return { tables, totalVersions };
  });
}

/** INSERT a content_versions snapshot + UPSERT the active_versions pointer. */
async function recordVersion(
  t: DbAdapter,
  domain: string,
  row: Row,
  pk: readonly string[],
  now: number,
): Promise<void> {
  const refId = rowKey(row, pk);
  const next = await t.one<{ next: number }>(SQL_NEXT_VERSION, [domain, refId]);
  const versionNumber = next?.next ?? 1;
  const status = typeof row['status'] === 'string' ? String(row['status']) : 'published';
  const versionId = newId('cv');
  await t.run(SQL_INSERT_VERSION, [
    versionId,
    domain,
    refId,
    versionNumber,
    status,
    JSON.stringify(row),
    now,
  ]);
  await t.run(SQL_UPSERT_ACTIVE, [domain, refId, versionId]);
}

// ============================================================================
// Rollback
// ============================================================================

export type RollbackSummary = {
  restored: number;
  skipped: number;
  details: string[];
};

/**
 * Roll every active content row back to its PREVIOUS version snapshot — one
 * transaction. For each (domain, ref_id): restore the content table row from
 * the previous definition_json and re-point active_versions at it. Rows with
 * no previous version (first deploy) are skipped and reported.
 */
export async function rollback(): Promise<RollbackSummary> {
  return tx(async (t) => {
    const active = await t.query<{ domain: string; ref_id: string; version_id: string }>(SQL_ALL_ACTIVE);
    const details: string[] = [];
    let restored = 0;
    let skipped = 0;

    for (const a of active) {
      const current = await t.one<{ version_number: number; definition_json: string }>(SQL_VERSION_BY_ID, [a.version_id]);
      if (!current) {
        skipped += 1;
        details.push(`${a.domain}/${a.ref_id}: active pointer missing version row (skipped)`);
        continue;
      }
      const prev = await t.one<{ id: string; definition_json: string }>(
        SQL_PREV_VERSION,
        [a.domain, a.ref_id, current.version_number],
      );
      if (!prev) {
        skipped += 1;
        details.push(`${a.domain}/${a.ref_id}: no previous version (v${current.version_number}, skipped)`);
        continue;
      }

      // Restore the content row from the previous frozen snapshot.
      const row = JSON.parse(prev.definition_json) as Row;
      const pk = pkColumnsOf(a.domain);
      const cols = Object.keys(row);
      const upsertSql = buildUpsertSql(a.domain, cols, pk);
      await t.run(upsertSql, cols.map((c) => row[c]));
      await t.run(SQL_UPDATE_ACTIVE, [prev.id, a.domain, a.ref_id]);

      restored += 1;
      details.push(`${a.domain}/${a.ref_id}: v${current.version_number} → v${current.version_number - 1}`);
    }

    return { restored, skipped, details };
  });
}