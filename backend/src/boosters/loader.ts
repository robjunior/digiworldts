/**
 * Booster seed loader — scan / parse / validate / transform.
 *
 * This is the "Loader de seeds" from the spec (§3). It owns:
 *   - scan:      read all `*.booster.json` from a directory
 *   - parse:     JSON.parse + schema-level shape checks (Zod mirror of the
 *                JSON Schema; the file is shipped for editor tooling)
 *   - validate:  semantic rules (§2.4/§6.2) + cross-file rules (§6.3)
 *   - transform: `ref`-index resolution into deterministic runtime rows
 *                (`code:ref` node ids), used by the bundle extractor and the
 *                persistence layer.
 *
 * The loader NEVER infers parent->child from the global evolution graph and
 * NEVER persists `evolutionId`. The bundle/extractor step is responsible for
 * writing rows into the seed bundle (content/content-bundle.json) which the
 * content-deploy `--apply` step then persists transactionally (see
 * digimon-content-deploy skill for that half of the pipeline).
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type {
  BoosterSeed,
  BoosterDigimonEntry,
  BoosterItemEntry,
  BoosterRuntime,
  BoosterDigimonNode,
  BoosterItemRow,
} from './types.js';

export type BoosterIssue = {
  /** File the issue belongs to (relative path or inline "<inline>"). */
  file: string;
  /** Rule key (matches §2.4 / §6 labels). */
  rule: string;
  /** Human-readable message. */
  message: string;
};

export type BoosterLoaded = {
  seeds: BoosterSeed[];
  issues: BoosterIssue[];
  valid: boolean;
};

// ---------------------------------------------------------------------------
// Parse — Zod mirror of booster.schema.json
// ---------------------------------------------------------------------------

const RarityZ = z.enum(['common', 'uncommon', 'rare', 'ultra-rare']);
const StatusZ = z.enum(['draft', 'review', 'published', 'archived']);

const DigimonEntryZ = z.object({
  ref: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  digimonId: z.string().min(1),
  parentRef: z.string().nullable(),
  rarity: RarityZ,
  weight: z.number().int().min(1),
  order: z.number().int().min(0),
});

const ItemEntryZ = z.object({
  ref: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  itemId: z.string().min(1),
  rarity: RarityZ,
  weight: z.number().int().min(1),
  order: z.number().int().min(0),
});

const BoosterSeedZ = z.object({
  code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  name: z.string().min(1),
  set: z.string().min(1),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().optional(),
  status: StatusZ,
  tags: z.array(z.string()).optional(),
  digimonPool: z.array(DigimonEntryZ).default([]),
  itemPool: z.array(ItemEntryZ).default([]),
});

// ---------------------------------------------------------------------------
// Semantic + cross-file validation
// ---------------------------------------------------------------------------

function cycleWouldForm(nodes: BoosterDigimonEntry[], from: string, to: string | null): boolean {
  if (to === null) return false;
  let current: string | null = to;
  const seen = new Set<string>();
  while (current !== null) {
    if (current === from) return true;
    if (seen.has(current)) return true; // defensive: pre-existing cycle caught separately
    seen.add(current);
    current = nodes.find((n) => n.ref === current)?.parentRef ?? null;
  }
  return false;
}

function validateSeed(seed: BoosterSeed, file: string): BoosterIssue[] {
  const issues: BoosterIssue[] = [];
  const push = (rule: string, message: string) => issues.push({ file, rule, message });

  const refs = new Set<string>();
  for (const n of seed.digimonPool) {
    if (refs.has(n.ref)) push('ref-unique', `digimonPool: duplicate ref "${n.ref}"`);
    refs.add(n.ref);
  }

  const refSet = new Set(refs);
  for (const n of seed.digimonPool) {
    if (n.parentRef !== null && !refSet.has(n.parentRef)) {
      push('parent-ref', `digimonPool node "${n.ref}" has dangling parentRef "${n.parentRef}"`);
    }
  }

  if (seed.digimonPool.length > 0 && !seed.digimonPool.some((n) => n.parentRef === null)) {
    push('root', 'digimonPool must contain at least one root (parentRef: null)');
  }

  for (const n of seed.digimonPool) {
    if (cycleWouldForm(seed.digimonPool, n.ref, n.parentRef)) {
      push('cycle', `digimonPool node "${n.ref}" would create a cycle via parentRef "${n.parentRef}"`);
    }
  }

  const itemRefs = new Set<string>();
  for (const it of seed.itemPool) {
    if (itemRefs.has(it.ref)) push('ref-unique', `itemPool: duplicate ref "${it.ref}"`);
    itemRefs.add(it.ref);
  }

  return issues;
}

/**
 * Cross-file validation — `code` unique across all seeds, and every
 * digimonId/itemId exists in the given catalogs (when provided).
 */
export function validateCrossFile(
  seeds: BoosterSeed[],
  knownCodes: ReadonlyArray<string>,
  knownDigimonIds: ReadonlySet<string>,
  knownItemIds: ReadonlySet<string>,
): BoosterIssue[] {
  const issues: BoosterIssue[] = [];
  const seenCodes = new Set<string>();

  for (const s of seeds) {
    const file = s.$fileName ?? `<inline:${s.code}>`;
    if (seenCodes.has(s.code)) issues.push({ file, rule: 'code-unique', message: `duplicate code "${s.code}" across seed files` });
    seenCodes.add(s.code);
    if (knownCodes.includes(s.code)) issues.push({ file, rule: 'code-unique', message: `code "${s.code}" collides with an existing booster` });

    for (const n of s.digimonPool) {
      if (!knownDigimonIds.has(n.digimonId)) {
        issues.push({ file, rule: 'digimon-exists', message: `digimonId "${n.digimonId}" (${n.ref}) not found in global catalog` });
      }
    }
    for (const it of s.itemPool) {
      if (!knownItemIds.has(it.itemId)) {
        issues.push({ file, rule: 'item-exists', message: `itemId "${it.itemId}" (${it.ref}) not found in item catalog` });
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Transform — deterministic runtime rows
// ---------------------------------------------------------------------------

function slugToId(code: string): string {
  return code.toLowerCase();
}

export function transformSeed(seed: BoosterSeed, seedHash?: string, loadedAt = Date.now()): {
  booster: BoosterRuntime;
  nodes: BoosterDigimonNode[];
  items: BoosterItemRow[];
} {
  const id = slugToId(seed.code);
  const booster: BoosterRuntime = {
    id,
    code: seed.code,
    name: seed.name,
    set: seed.set,
    release_date: seed.releaseDate,
    ...(seed.description !== undefined ? { description: seed.description } : {}),
    status: seed.status,
    ...(seed.tags !== undefined ? { tags: JSON.stringify(seed.tags) } : {}),
    seed_hash: seedHash ?? '',
    loaded_at: loadedAt,
  };

  const nodeId = (ref: string) => `${id}:${ref}`;
  const nodes: BoosterDigimonNode[] = seed.digimonPool.map((n) => ({
    id: nodeId(n.ref),
    booster_id: id,
    ref: n.ref,
    digimon_id: n.digimonId,
    parent_node_id: n.parentRef === null ? null : nodeId(n.parentRef),
    rarity: n.rarity,
    weight: n.weight,
    order: n.order,
  }));

  const items: BoosterItemRow[] = seed.itemPool.map((it) => ({
    id: `${id}:item:${it.ref}`,
    booster_id: id,
    ref: it.ref,
    item_id: it.itemId,
    rarity: it.rarity,
    weight: it.weight,
    order: it.order,
  }));

  return { booster, nodes, items };
}

/** Seed-hash for idempotency — stable SHA-256 of the normalized file bytes. */
export async function seedHashOf(filePath: string): Promise<string> {
  const buf = await readFile(filePath, 'utf8');
  return createHash('sha256').update(buf).digest('hex');
}

export function seedHashOfText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// ---------------------------------------------------------------------------
// Loader entry point
// ---------------------------------------------------------------------------

export type LoaderCatalogs =
  | { digimonIds: ReadonlySet<string>; itemIds: ReadonlySet<string>; codes: ReadonlyArray<string> }
  | undefined;

/**
 * Scan + parse + validate all `*.booster.json` in a directory.
 *
 * Returns per-file issues (schema + semantic), then cross-file issues. A seed
 * with any schema/semantic issue is excluded from `seeds` (it cannot be
 * transformed safely); cross-file issues FILE them but still surface the seed
 * so a build can report precisely which catalog ref is broken.
 */
export async function loadBoosters(
  dir: string,
  catalogs: LoaderCatalogs = undefined,
  opts: { failOnInvalid?: boolean } = {},
): Promise<BoosterLoaded> {
  const issues: BoosterIssue[] = [];
  const seeds: BoosterSeed[] = [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.booster.json'));

  for (const file of files.sort()) {
    const filePath = join(dir, file);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (err) {
      issues.push({ file, rule: 'parse', message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    const parsed = BoosterSeedZ.safeParse(raw);
    if (!parsed.success) {
      issues.push({ file, rule: 'schema', message: `schema violation: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}` });
      continue;
    }
    const base = parsed.data;
    const seed: BoosterSeed = {
      code: base.code,
      name: base.name,
      set: base.set,
      releaseDate: base.releaseDate,
      ...(base.description !== undefined ? { description: base.description } : {}),
      status: base.status,
      ...(base.tags !== undefined ? { tags: base.tags } : {}),
      digimonPool: base.digimonPool,
      itemPool: base.itemPool,
      $fileName: file,
    };
    const semantic = validateSeed(seed, file);
    if (semantic.length > 0) {
      issues.push(...semantic);
      continue;
    }
    seeds.push(seed);
  }

  if (catalogs) {
    issues.push(...validateCrossFile(seeds, catalogs.codes, catalogs.digimonIds, catalogs.itemIds));
  }

  // valid == no schema/semantic/parse/cross-file issues at all.
  const valid = issues.length === 0;
  if (opts.failOnInvalid && !valid) {
    const msg = issues.map((i) => `  - [${i.file}] ${i.rule}: ${i.message}`).join('\n');
    throw new Error(`Booster seeds invalid:\n${msg}`);
  }

  return { seeds, issues, valid };
}