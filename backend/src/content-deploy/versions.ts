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
 * Domain model: `domain` = content table name, `ref_id` = the row's
 * identity key value (from CONTENT_TABLES orderBy — PK columns, or a stable
 * unique natural key like onboarding_teams.slug; composite keys JSON-joined). This
 * maps 1:1 onto the seed artifact's `tables` object and keeps the version
 * ledger per content row.
 */
import type { DbAdapter } from '../db/adapter.js';
import { tx } from '../db/index.js';
import { CONTENT_TABLES } from '../seed-export/content-tables.js';
import { newId } from '../util/ids.js';
import { unresolvedReferences, type CrossRefChecker } from '../dialogues/xref.js';
import type { DialogueDefinition } from '@digiworld/shared/dialogue';
import type { Catalog, TemplateDigimon } from '../digimon/xml.js';

type Row = Record<string, unknown>;

/** Structured cross-reference validation issue. */
export type XrefIssue = {
  /** Domain the issue belongs to (table name or 'digimon'). */
  domain: string;
  /** Reference identifier (e.g., row id, quest id, digimon id). */
  ref: string;
  /** Human-readable message (kept byte-identical to prior strings). */
  message: string;
};

/** Digimon context for cross-domain checks (optional). */
export type DigimonXrefContext = {
  /** All digimon template ids from the catalog XML. */
  ids: ReadonlySet<string>;
  /** Per-digimon skill pool ids (local s0-s3 style ids). */
  skillsByTemplate: ReadonlyMap<string, ReadonlySet<string>>;
  /** Per-digimon signatureSkillId (when present). */
  signaturesByTemplate: ReadonlyMap<string, string>;
  /** Required items on evolutions (targetId -> requiredItemId). */
  requiredItemsByEvolve: ReadonlyMap<string, string>;
};

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

/** Build `INSERT ... ON CONFLICT(identity) DO UPDATE SET ...` for one content
 *  table. Columns come from the artifact row keys; the conflict/identity
 *  columns from CONTENT_TABLES orderBy (PK or stable unique natural key). */
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
 * consistent before it may be deployed anywhere).
 *
 * Checks (with digimon context when provided):
 *   quests.data          → talk objective npcId → npcs
 *                          collect objective itemId → shop_items
 *                          capture objective catalogId → digimon
 *                          dialogue step / introDialogueId → dialogue_definitions
 *                          finalReward items itemId → shop_items
 *                          unlocksQuestIds → quests
 *                          battle/boss step enemies[].templateId → digimon
 *                          loot step pool.items[].itemId → shop_items
 *   dialogue ir_json     → speaker npcId + expression → npcs
 *                          give_item / remove_item / player_has_item → shop_items
 *                          start_quest → quests
 *   dungeon_encounters   → digimon_data[].catalogId → digimon
 *                          loots[].itemId → shop_items
 *                          rarity_table_id → dungeon_rarity_tables
 *   dungeon_chests       → contents_json[].itemId → shop_items
 *                          locked_by_key_id → dungeon_keys
 *   dungeon_doors        → key_item_id → shop_items
 *   dungeon_warps        → target_dungeon_id → dungeons
 *   dungeon_items        → item_id → shop_items
 *   dungeon_kits         → kit_id (self)
 *   dungeon_kit_items    → kit_id → dungeon_kits, item_id → shop_items
 *   shop_bundles         → bundle_id (self)
 *   shop_bundle_items    → bundle_id → shop_bundles, item_id → shop_items
 *   catalog_loot_entries → catalog_id → digimon, item_id → shop_items
 *   farm_recipes         → item_id → shop_items
 *   world_objects        → quest_id → quests
 *   dungeons             → quest_id → quests, world_object_id → world_objects
 *   onboarding_teams     → mon_1/2/3_catalog_id → digimon
 *   skills_catalog       → upgrade_of → skills_catalog, owner_template_id → digimon
 *   digimon (XML)        → evolvesInto[].targetId → digimon
 *                          signatureSkillId → own skillPool
 *                          evolvesInto[].requiredItemId → shop_items
 *
 * Reuses `unresolvedReferences` from dialogues/xref.ts with an artifact-backed
 * checker, so dialogue validation is the same logic the dialogue importer
 * already runs against the live DB — just scoped to the artifact.
 *
 * Returns structured issues (empty = clean).
 */
export function validateXref(
  env: { tables: Record<string, Row[]> },
  digimon?: DigimonXrefContext,
  catalog?: Catalog,
): XrefIssue[] {
  const errors: XrefIssue[] = [];
  const push = (domain: string, ref: string, message: string) =>
    errors.push({ domain, ref, message });

  const table = (n: string): Map<string, Row> =>
    new Map((env.tables[n] ?? []).map((r) => [String(r[pkColumnsOf(n)[0] ?? 'id']), r]));

  // --- Build all ID sets from artifact tables ---
  const quests = env.tables['quests'] ?? [];
  const npcs = env.tables['npcs'] ?? [];
  const items = env.tables['shop_items'] ?? [];
  const dialogues = env.tables['dialogue_definitions'] ?? [];
  const dungeonEncounters = env.tables['dungeon_encounters'] ?? [];
  const dungeonChests = env.tables['dungeon_chests'] ?? [];
  const dungeonDoors = env.tables['dungeon_doors'] ?? [];
  const dungeonWarps = env.tables['dungeon_warps'] ?? [];
  const dungeonItems = env.tables['dungeon_items'] ?? [];
  const dungeonKits = env.tables['dungeon_kits'] ?? [];
  const dungeonKitItems = env.tables['dungeon_kit_items'] ?? [];
  const shopBundles = env.tables['shop_bundles'] ?? [];
  const shopBundleItems = env.tables['shop_bundle_items'] ?? [];
  const catalogLootEntries = env.tables['catalog_loot_entries'] ?? [];
  const farmRecipes = env.tables['farm_recipes'] ?? [];
  const worldObjects = env.tables['world_objects'] ?? [];
  const dungeons = env.tables['dungeons'] ?? [];
  const onboardingTeams = env.tables['onboarding_teams'] ?? [];
  const skillsCatalog = env.tables['skills_catalog'] ?? [];
  const dungeonRarityTables = env.tables['dungeon_rarity_tables'] ?? [];
  const dungeonKeys = env.tables['dungeon_keys'] ?? [];

  const questIds = new Set(quests.map((r) => String(r['id'])));
  const npcIds = new Set(npcs.map((r) => String(r['id'])));
  const itemIds = new Set(items.map((r) => String(r['id'])));
  const dialogueIds = new Set(dialogues.map((r) => String(r['dialogue_id'])));
  const dungeonEncounterIds = new Set(dungeonEncounters.map((r) => String(r['id'])));
  const dungeonChestIds = new Set(dungeonChests.map((r) => String(r['id'])));
  const dungeonDoorIds = new Set(dungeonDoors.map((r) => String(r['id'])));
  const dungeonWarpIds = new Set(dungeonWarps.map((r) => String(r['id'])));
  const dungeonItemIds = new Set(dungeonItems.map((r) => String(r['id'])));
  const dungeonKitIds = new Set(dungeonKits.map((r) => String(r['id'])));
  const shopBundleIds = new Set(shopBundles.map((r) => String(r['id'])));
  const farmRecipeIds = new Set(farmRecipes.map((r) => String(r['id'])));
  const worldObjectIds = new Set(worldObjects.map((r) => String(r['id'])));
  const dungeonIds = new Set(dungeons.map((r) => String(r['id'])));
  const onboardingTeamIds = new Set(onboardingTeams.map((r) => String(r['id'])));
  const skillIds = new Set(skillsCatalog.map((r) => String(r['id'])));
  const rarityTableIds = new Set(dungeonRarityTables.map((r) => String(r['id'])));
  const dungeonKeyIds = new Set(dungeonKeys.map((r) => String(r['id'])));

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

  // --- Helper for parsing JSON arrays safely ---
  const parseJsonArray = <T>(raw: unknown): T[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(String(raw));
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  };

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
      // Handle data that may already be an object, string, or invalid JSON
      let raw = q['data'];
      if (typeof raw === 'object' && raw !== null) {
        // Already a parsed object - use as-is
        data = raw as typeof data;
      } else if (typeof raw === 'string') {
        // Try to parse the string as JSON
        try {
          data = JSON.parse(raw) as typeof data;
        } catch {
          // Attempt to strip trailing commas and re-parse
          const cleaned = raw.replace(/,\s*\n\s*[\]\}]/g, "\n\s*[\]\]").replace(/,\s*\r?\n\s*[\]\}]/g, "\n\s*[\]\]");
          try {
            data = JSON.parse(cleaned) as typeof data;
          } catch {
            // Remove the very last comma in the string
            const lastCommaRemoved = raw.replace(/,\s*$/, "");
            try {
              data = JSON.parse(lastCommaRemoved) as typeof data;
            } catch {
              data = ({} as typeof data);
            }
          }
        }
      } else {
        // No data - use empty object
        data = ({} as typeof data);
      }
    } catch {
      push('quests', qid, `quest ${qid}: data is not valid JSON`);
      continue;
    }
    for (const obj of Array.isArray(data.objectives) ? (data.objectives as Array<Record<string, unknown>>) : []) {
      if (obj['kind'] === 'talk' && typeof obj['npcId'] === 'string' && !npcIds.has(obj['npcId'])) {
        push('quests', qid, `quest ${qid}: talk objective references unknown npc "${obj['npcId']}"`);
      }
      if (obj['kind'] === 'collect' && typeof obj['itemId'] === 'string' && !itemIds.has(obj['itemId'])) {
        push('quests', qid, `quest ${qid}: collect objective references unknown item "${obj['itemId']}"`);
      }
      // capture objective → digimon catalogId
      if (obj['kind'] === 'capture' && typeof obj['catalogId'] === 'string') {
        const catId = obj['catalogId'];
        if (digimon && !digimon.ids.has(catId)) {
          push('quests', qid, `quest ${qid}: capture objective references unknown digimon "${catId}"`);
        }
      }
    }
    for (const step of Array.isArray(data.steps) ? (data.steps as Array<Record<string, unknown>>) : []) {
      if (step['type'] === 'dialogue' && typeof step['dialogueId'] === 'string' && !dialogueIds.has(step['dialogueId'])) {
        push('quests', qid, `quest ${qid}: dialogue step references unknown dialogue "${step['dialogueId']}"`);
      }
      // battle/boss step enemies[].templateId → digimon
      if ((step['type'] === 'battle' || step['type'] === 'boss') && Array.isArray(step['enemies'])) {
        for (const enemy of step['enemies'] as Array<Record<string, unknown>>) {
          if (typeof enemy['templateId'] === 'string') {
            const tplId = enemy['templateId'];
            if (digimon && !digimon.ids.has(tplId)) {
              push('quests', qid, `quest ${qid}: ${step['type']} step references unknown digimon "${tplId}"`);
            }
          }
        }
      }
      // loot step pool.items[].itemId → shop_items
      if (step['type'] === 'loot' && step['pool'] && typeof step['pool'] === 'object') {
        const pool = step['pool'] as { items?: Array<{ itemId: unknown }> };
        for (const it of pool.items ?? []) {
          if (typeof it.itemId === 'string' && !itemIds.has(it.itemId)) {
            push('quests', qid, `quest ${qid}: loot step references unknown item "${it.itemId}"`);
          }
        }
      }
    }
    if (typeof data.introDialogueId === 'string' && !dialogueIds.has(data.introDialogueId)) {
      push('quests', qid, `quest ${qid}: introDialogueId references unknown dialogue "${data.introDialogueId}"`);
    }
    const reward = data.finalReward as { items?: Array<{ itemId: unknown }> } | undefined;
    for (const it of reward?.items ?? []) {
      if (typeof it.itemId === 'string' && !itemIds.has(it.itemId)) {
        push('quests', qid, `quest ${qid}: finalReward references unknown item "${it.itemId}"`);
      }
    }
    for (const uid of Array.isArray(data.unlocksQuestIds) ? (data.unlocksQuestIds as unknown[]) : []) {
      if (typeof uid === 'string' && !questIds.has(uid)) {
        push('quests', qid, `quest ${qid}: unlocksQuestIds references unknown quest "${uid}"`);
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
      push('dialogue_definitions', did, `dialogue ${did}: ir_json is not valid JSON`);
      continue;
    }
    for (const u of unresolvedReferences(def, checker)) {
      push('dialogue_definitions', did, `dialogue ${did}: ${u.message}`);
    }
  }

  // --- dungeon_encounters: digimon_data, loots, rarity_table_id ---
  for (const e of dungeonEncounters) {
    const eid = String(e['id']);
    const digimonData = parseJsonArray<{ catalogId?: unknown }>(e['digimon_data']);
    for (const d of digimonData) {
      if (typeof d.catalogId === 'string') {
        if (digimon && !digimon.ids.has(d.catalogId)) {
          push('dungeon_encounters', eid, `dungeon_encounters ${eid}: digimon_data references unknown digimon "${d.catalogId}"`);
        }
      }
    }
    const loots = parseJsonArray<{ itemId?: unknown; qty?: unknown; chance?: unknown }>(e['loots']);
    for (const l of loots) {
      if (typeof l.itemId === 'string' && !itemIds.has(l.itemId)) {
        push('dungeon_encounters', eid, `dungeon_encounters ${eid}: loots references unknown item "${l.itemId}"`);
      }
    }
    if (typeof e['rarity_table_id'] === 'string') {
      const rtId = String(e['rarity_table_id']);
      if (rtId && !rarityTableIds.has(rtId)) {
        push('dungeon_encounters', eid, `dungeon_encounters ${eid}: rarity_table_id references unknown rarity table "${rtId}"`);
      }
    }
  }

  // --- dungeon_chests: contents_json, locked_by_key_id ---
  for (const c of dungeonChests) {
    const cid = String(c['id']);
    const contents = parseJsonArray<{ itemId?: unknown }>(c['contents_json']);
    for (const r of contents) {
      if (typeof r.itemId === 'string' && !itemIds.has(r.itemId)) {
        push('dungeon_chests', cid, `dungeon_chests ${cid}: contents references unknown item "${r.itemId}"`);
      }
    }
    if (typeof c['locked_by_key_id'] === 'string') {
      const keyId = String(c['locked_by_key_id']);
      if (keyId && !dungeonKeyIds.has(keyId)) {
        push('dungeon_chests', cid, `dungeon_chests ${cid}: locked_by_key_id references unknown key "${keyId}"`);
      }
    }
  }

  // --- dungeon_doors: key_item_id → shop_items ---
  for (const d of dungeonDoors) {
    const did = String(d['id']);
    if (typeof d['key_item_id'] === 'string' && !itemIds.has(d['key_item_id'])) {
      push('dungeon_doors', did, `dungeon_doors ${did}: key_item_id references unknown item "${d['key_item_id']}"`);
    }
  }

  // --- dungeon_warps: target_dungeon_id → dungeons ---
  for (const w of dungeonWarps) {
    const wid = String(w['id']);
    if (typeof w['target_dungeon_id'] === 'string') {
      const tgt = String(w['target_dungeon_id']);
      if (tgt && !dungeonIds.has(tgt)) {
        push('dungeon_warps', wid, `dungeon_warps ${wid}: target_dungeon_id references unknown dungeon "${tgt}"`);
      }
    }
  }

  // --- dungeon_items: item_id → shop_items ---
  for (const i of dungeonItems) {
    const iid = String(i['id']);
    if (typeof i['item_id'] === 'string' && !itemIds.has(i['item_id'])) {
      push('dungeon_items', iid, `dungeon_items ${iid}: item_id references unknown item "${i['item_id']}"`);
    }
  }

  // --- dungeon_kit_items: kit_id → dungeon_kits, item_id → shop_items ---
  for (const ki of dungeonKitItems) {
    const key = String(ki['kit_id']) + ':' + String(ki['item_id']);
    if (typeof ki['kit_id'] === 'string' && !dungeonKitIds.has(ki['kit_id'])) {
      push('dungeon_kit_items', key, `dungeon_kit_items ${key}: kit_id references unknown kit "${ki['kit_id']}"`);
    }
    if (typeof ki['item_id'] === 'string' && !itemIds.has(ki['item_id'])) {
      push('dungeon_kit_items', key, `dungeon_kit_items ${key}: item_id references unknown item "${ki['item_id']}"`);
    }
  }

  // --- shop_bundle_items: bundle_id → shop_bundles, item_id → shop_items ---
  for (const bi of shopBundleItems) {
    const key = String(bi['bundle_id']) + ':' + String(bi['item_id']);
    if (typeof bi['bundle_id'] === 'string' && !shopBundleIds.has(bi['bundle_id'])) {
      push('shop_bundle_items', key, `shop_bundle_items ${key}: bundle_id references unknown bundle "${bi['bundle_id']}"`);
    }
    if (typeof bi['item_id'] === 'string' && !itemIds.has(bi['item_id'])) {
      push('shop_bundle_items', key, `shop_bundle_items ${key}: item_id references unknown item "${bi['item_id']}"`);
    }
  }

  // --- catalog_loot_entries: catalog_id → digimon, item_id → shop_items ---
  for (const cle of catalogLootEntries) {
    const cid = String(cle['id']);
    if (typeof cle['catalog_id'] === 'string') {
      const catId = String(cle['catalog_id']);
      if (digimon && !digimon.ids.has(catId)) {
        push('catalog_loot_entries', cid, `catalog_loot_entries ${cid}: catalog_id references unknown digimon "${catId}"`);
      }
    }
    if (typeof cle['item_id'] === 'string' && !itemIds.has(cle['item_id'])) {
      push('catalog_loot_entries', cid, `catalog_loot_entries ${cid}: item_id references unknown item "${cle['item_id']}"`);
    }
  }

  // --- farm_recipes: item_id → shop_items ---
  for (const f of farmRecipes) {
    const fid = String(f['id']);
    if (typeof f['item_id'] === 'string' && !itemIds.has(f['item_id'])) {
      push('farm_recipes', fid, `farm_recipes ${fid}: item_id references unknown item "${f['item_id']}"`);
    }
  }

  // --- world_objects: quest_id → quests ---
  for (const wo of worldObjects) {
    const wid = String(wo['id']);
    if (typeof wo['quest_id'] === 'string') {
      const qid = String(wo['quest_id']);
      if (qid && !questIds.has(qid)) {
        push('world_objects', wid, `world_objects ${wid}: quest_id references unknown quest "${qid}"`);
      }
    }
  }

  // --- dungeons: quest_id → quests, world_object_id → world_objects ---
  for (const d of dungeons) {
    const did = String(d['id']);
    if (typeof d['quest_id'] === 'string') {
      const qid = String(d['quest_id']);
      if (qid && !questIds.has(qid)) {
        push('dungeons', did, `dungeons ${did}: quest_id references unknown quest "${qid}"`);
      }
    }
    if (typeof d['world_object_id'] === 'string') {
      const woid = String(d['world_object_id']);
      if (woid && !worldObjectIds.has(woid)) {
        push('dungeons', did, `dungeons ${did}: world_object_id references unknown world_object "${woid}"`);
      }
    }
  }

  // --- onboarding_teams: mon_1/2/3_catalog_id → digimon ---
  for (const ot of onboardingTeams) {
    const oid = String(ot['id']);
    for (const col of ['mon_1_catalog_id', 'mon_2_catalog_id', 'mon_3_catalog_id'] as const) {
      if (typeof ot[col] === 'string') {
        const catId = String(ot[col]);
        if (digimon && !digimon.ids.has(catId)) {
          push('onboarding_teams', oid, `onboarding_teams ${oid}: ${col} references unknown digimon "${catId}"`);
        }
      }
    }
  }

  // --- pve_places: explore_pool / expedition_pool catalogId → digimon ---
  const pvePlaces = env.tables['pve_places'] ?? [];
  for (const pp of pvePlaces) {
    const pid = String(pp['id']);
    for (const poolCol of ['explore_pool', 'expedition_pool'] as const) {
      const raw = pp[poolCol];
      const entries = parseJsonArray<{ catalogId?: unknown }>(raw);
      for (const e of entries) {
        const catId = e?.catalogId;
        if (typeof catId === 'string' && digimon && !digimon.ids.has(catId)) {
          push('pve_places', pid, `pve_places ${pid}: ${poolCol} references unknown digimon "${catId}"`);
        }
      }
    }
  }

  // --- skills_catalog: upgrade_of → skills_catalog, owner_template_id → digimon ---
  for (const s of skillsCatalog) {
    const sid = String(s['id']);
    if (typeof s['upgrade_of'] === 'string') {
      const up = String(s['upgrade_of']);
      if (up && !skillIds.has(up)) {
        push('skills_catalog', sid, `skills_catalog ${sid}: upgrade_of references unknown skill "${up}"`);
      }
    }
    if (typeof s['owner_template_id'] === 'string') {
      const owner = String(s['owner_template_id']);
      if (owner && digimon && !digimon.ids.has(owner)) {
        push('skills_catalog', sid, `skills_catalog ${sid}: owner_template_id references unknown digimon "${owner}"`);
      }
    }
  }

  // --- Digimon catalog internal refs (when full Catalog provided) ---
  if (catalog) {
    const catalogDigimonIds = new Set(catalog.digimons.map((d) => d.id));
    // Precompute per-digimon skillPool ids and signatureSkillId
    const skillPoolById = new Map<string, Set<string>>();
    const signatureSkillById = new Map<string, string>();
    for (const d of catalog.digimons) {
      skillPoolById.set(d.id, new Set(d.skillPool.map((s) => s.id)));
      if (d.signatureSkillId) signatureSkillById.set(d.id, d.signatureSkillId);
    }

    for (const d of catalog.digimons) {
      const did = d.id;

      // evolvesInto[].targetId → digimon
      for (const ev of d.evolvesInto ?? []) {
        if (!catalogDigimonIds.has(ev.targetId)) {
          push('digimon', did, `digimon ${did}: evolution targets unknown digimon "${ev.targetId}"`);
        }
        // evolvesInto[].requiredItemId → shop_items
        if (ev.requiredItemId && !itemIds.has(ev.requiredItemId)) {
          push('digimon', did, `digimon ${did}: evolution requires unknown item "${ev.requiredItemId}"`);
        }
      }

      // signatureSkillId → own skillPool
      const sig = d.signatureSkillId;
      if (sig) {
        const ownSkills = skillPoolById.get(did) ?? new Set();
        if (!ownSkills.has(sig)) {
          push('digimon', did, `digimon ${did}: signatureSkillId references unknown skill "${sig}"`);
        }
      }

// skillPool vfxPresetId → skill-vfx presets (when skill-vfx context provided)
    }
  }

  // --- Booster tables (manual curation; §2.4/§6.3) ---
  // boosters → no cross-table refs of its own; nodes/items live under a booster.
  const boosterNodes = env.tables['booster_digimon_nodes'] ?? [];
  const boosterItems = env.tables['booster_item_entries'] ?? [];
  const boosterNodeIds = new Set(boosterNodes.map((r) => String(r['id'])));
  for (const n of boosterNodes) {
    const refId = String(n['id']);
    if (digimon && typeof n['digimon_id'] === 'string' && n['digimon_id'] && !digimon.ids.has(n['digimon_id'])) {
      push('booster_digimon_nodes', refId, `booster node ${refId}: digimon_id references unknown digimon "${n['digimon_id']}"`);
    }
    if (n['parent_node_id'] !== null && n['parent_node_id'] !== undefined && !boosterNodeIds.has(String(n['parent_node_id']))) {
      push('booster_digimon_nodes', refId, `booster node ${refId}: parent_node_id references unknown node "${n['parent_node_id']}"`);
    }
  }
  for (const it of boosterItems) {
    const refId = String(it['id']);
    if (typeof it['item_id'] === 'string' && it['item_id'] && !itemIds.has(it['item_id'])) {
      push('booster_item_entries', refId, `booster item ${refId}: item_id references unknown item "${it['item_id']}"`);
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
  /** Rows purged when `reconcile` is enabled, keyed by table name. */
  purged?: Record<string, number>;
};

/**
 * Deploy a validated seed artifact into the target DB — one transaction.
 * For every artifact table: UPSERT each row into the content table, record an
 * immutable content_versions snapshot, and point active_versions at it.
 *
 * When `opts.reconcile` is true, the same transaction ALSO deletes rows that
 * content-deploy itself previously deployed (they carry an `active_versions`
 * pointer for the domain) but are absent from the incoming bundle — so the
 * bundle-managed subset of each content table becomes an exact mirror of the
 * artifact ("only clean content"). Boot-seeded rows that content-deploy never
 * wrote (they have no version pointer) are deliberately left untouched, so a
 * stale bundle can never delete content the server depends on. Reconcile runs
 * in reverse CONTENT_TABLES order so FK dependents are deleted before their
 * parents.
 */
export async function applySeed(
  env: { tables: Record<string, Row[]> },
  opts?: { reconcile?: boolean },
): Promise<ApplySummary> {
  // The xref gate is enforced here (not just in the CLI) so apply can never be
  // reached with a broken artifact, regardless of entry point.
  const xrefErrors = validateXref(env);
  if (xrefErrors.length > 0) {
    const sample = xrefErrors.slice(0, 15).map((e) => `  - ${e.message}`).join('\n');
    throw new Error(`cross-domain references broken (${xrefErrors.length}):\n${sample}`);
  }

  const now = Date.now();
  return tx(async (t) => {
    const tables: ApplySummary['tables'] = {};
    const purged: Record<string, number> = {};
    let totalVersions = 0;

    // Iterate in CONTENT_TABLES order to respect FK dependencies
    for (const { name } of CONTENT_TABLES) {
      const rows = env.tables[name] ?? [];
      const pk = pkColumnsOf(name);
      const cols: string[] = [];
      const seen = new Set<string>();
      for (const r of rows) for (const c of Object.keys(r)) if (!seen.has(c)) { seen.add(c); cols.push(c); }
      const upsertSql = buildUpsertSql(name, cols, pk);

      // For dungeons, pre-clear any existing rows that would violate the
      // idx_dungeons_group_grid_position unique index (same grid coords, different ID)
      if (name === 'dungeons') {
        for (const row of rows) {
          const groupId = row['dungeon_group_id'];
          const gx = row['grid_x'];
          const gy = row['grid_y'];
          if (groupId && gx !== null && gx !== undefined && gy !== null && gy !== undefined) {
            // Delete any existing dungeon at this grid position with a different ID
            await t.run(
              `DELETE FROM dungeons WHERE dungeon_group_id = ? AND grid_x = ? AND grid_y = ? AND id <> ?`,
              [groupId, gx, gy, row['id']]
            );
          }
        }
      }

      for (const row of rows) {
        try {
          await t.run(upsertSql, cols.map((c) => row[c]));
        } catch (e) {
          console.error(`  FAILED upsert for table ${name}:`, e instanceof Error ? e.message : String(e));
          console.error(`  SQL: ${upsertSql}`);
          console.error(`  Params:`, cols.map((c) => row[c]));
          throw e;
        }
        await recordVersion(t, name, row, pk, now);
      }
      tables[name] = { rows: rows.length, versions: rows.length };
      totalVersions += rows.length;
    }

    // Reconcile pass — purge bundle-managed orphan rows (see docstring for the
    // safety model). Reverse order so cross-table FK dependents go first; for
    // tables with a self-referential FK column, delete child rows (leaves)
    // before their parents so the parent_node_id / similar links never dangle.
    if (opts?.reconcile) {
      for (const { name } of [...CONTENT_TABLES].reverse()) {
        const rows = env.tables[name] ?? [];
        const pk = pkColumnsOf(name);
        const bundleKeys = new Set(rows.map((r) => rowKey(r, pk)));
        const deployed = await t.query<{ ref_id: string }>(
          `SELECT ref_id FROM active_versions WHERE domain = ?`,
          [name],
        );
        // Collect the orphan ref_ids we must delete (pointer exists, absent from bundle).
        const orphans = deployed
          .map((a) => ({ refId: a.ref_id, values: parseRefId(a.ref_id, pk) }))
          .filter((o) => o.values !== null && !bundleKeys.has(o.refId));
        if (orphans.length === 0) continue;

        const selfFk = SELF_FK_COLUMN[name];
        const order = selfFk
          ? await selfFkDeleteOrder(t, name, selfFk, orphans.map((o) => o.refId), pk)
          : orphans.map((o) => o.refId);

        const deletedIds = new Set(order);
        for (const refId of order) {
          const match = orphans.find((o) => o.refId === refId);
          if (!match || match.values === null) continue;
          const where = pk.map((c) => `${qid(c)} = ?`).join(' AND ');
          await t.run(`DELETE FROM ${qid(name)} WHERE ${where}`, match.values);
          // Drop the version pointer + history so the ledger matches content reality.
          await t.run(`DELETE FROM active_versions WHERE domain = ? AND ref_id = ?`, [name, refId]);
          await t.run(`DELETE FROM content_versions WHERE domain = ? AND ref_id = ?`, [name, refId]);
        }
        purged[name] = deletedIds.size;
      }
    }

    const result: ApplySummary = { tables, totalVersions };
    if (opts?.reconcile) result.purged = purged;
    return result;
  });
}

/** Decode a version-ledger ref_id (JSON array of PK values) back into row values. */
function parseRefId(refId: string, pk: readonly string[]): unknown[] | null {
  if (pk.length === 1) {
    // Single-column keys are stored as a 1-element JSON array too ([value]).
  }
  try {
    const v = JSON.parse(refId) as unknown;
    if (Array.isArray(v) && v.length === pk.length) return v;
  } catch {
    return null;
  }
  // Legacy tolerance: a bare scalar where a scalar PK is expected.
  if (pk.length === 1) {
    try {
      const asJson = JSON.parse(refId);
      return [asJson];
    } catch {
      return [refId];
    }
  }
  return null;
}

/**
 * Content tables with a self-referential FK column (a row in the table
 * references ANOTHER row in the SAME table). During reconcile, a parent row may
 * itself be purged, so children must be deleted before their parents to avoid
 * dangling self-FK violations (this is what bit the deploy on
 * booster_digimon_nodes.parent_node_id when reverse-table order alone was used).
 *
 * Tables whose FK points to a DIFFERENT table (dungeon_kits←dungeon_kit_items,
 * shop_bundles←shop_bundle_items, boosters←booster_*) are intentionally NOT
 * here — reverse CONTENT_TABLES order already deletes the child table first.
 */
const SELF_FK_COLUMN: Readonly<Record<string, string>> = {
  booster_digimon_nodes: 'parent_node_id',
};

/**
 * Order self-referential rows to delete leaves (children) before parents so a
 * purge never trips the table's own FK. `refIds` are the intersection survivors:
 * those absent from the bundle. Returns a delete order. A row appears AFTER any
 * surviving (kept) row is irrelevant — we only ever delete members of `refIds`.
 */
async function selfFkDeleteOrder(
  t: DbAdapter,
  table: string,
  fkCol: string,
  refIds: readonly string[],
  pk: readonly string[],
): Promise<string[]> {
  // Decode each ref_id back into its PK value(s) in a STABLE way for matching.
  const idToRef = new Map<string, string>();
  const ids = new Set<string>();
  for (const ref of refIds) {
    const values = parseRefId(ref, pk);
    if (values === null) continue;
    const key = values.map((v) => String(v)).join('\u0000');
    idToRef.set(key, ref);
    ids.add(key);
  }
  if (ids.size === 0) return [...refIds];
  const pk0 = qid(pk[0] ?? 'id');
  // Build a parent -> children map, counting ONLY children that are themselves
  // in the delete set (rows the bundle keeps never block a purge).
  // parentChildren.get(P) = ids of P's children that are DERIVED to-be-deleted.
  const parentChildren = new Map<string, Set<string>>();
  const parentRows = await t.query<Record<string, unknown>>(
    `SELECT ${qid(fkCol)} AS parent, ${pk0} AS child FROM ${qid(table)} WHERE ${qid(fkCol)} IS NOT NULL`,
  );
  for (const r of parentRows) {
    const parent = String(r['parent']);
    const child = String(r['child']);
    if (!ids.has(parent) || !ids.has(child)) continue; // only both-to-be-deleted
    let s = parentChildren.get(parent);
    if (!s) { s = new Set(); parentChildren.set(parent, s); }
    s.add(child);
  }
  // Iteratively delete nodes that have NO to-be-deleted children still pending.
  // A child is consumed as soon as IT is emitted; only then does its parent
  // become a leaf — so 3+ node chains (grandparent→parent→child) are safe.
  const remaining = new Set(ids);
  const out: string[] = [];
  while (remaining.size > 0) {
    const leaves = [...remaining].filter((id) => {
      const kids = parentChildren.get(id);
      if (!kids || kids.size === 0) return true;
      // only pending children block a parent
      return [...kids].every((k) => !remaining.has(k));
    });
    // Cycle guard (shouldn't happen for a tree/DAG): break arbitrarily — pick a
    // node and drop its dependency edge so we make progress.
    if (leaves.length === 0) {
      leaves.push([...remaining][0]!);
    }
    for (const leaf of leaves) {
      out.push(idToRef.get(leaf)!);
      remaining.delete(leaf);
      // The leaf is no longer a pending child of anyone → release its parent.
      for (const [, kids] of parentChildren) kids.delete(leaf);
    }
  }
  return [...new Set(out)];
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