import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { parseAndValidateWithRefs } from './runtime.js';
import { buildCrossRefChecker } from './xref.js';
import { DIALOGUE_SCHEMA_VERSION } from '@digiworld/shared/dialogue';
import type { DialogueDiagnostic } from '@digiworld/shared/dialogue';

import { config } from '../config.js';
import { log } from '../util/log.js';
import { getDialogue, hashSource, saveDialogue } from './repo.js';

const ALLOWED_EXT = ['.twee', '.tw'];
const MAX_BYTES = 1_000_000;

export type SyncOutcome =
  | { readonly file: string; readonly status: 'imported' | 'updated'; readonly dialogueId: string; readonly warnings: readonly DialogueDiagnostic[] }
  | { readonly file: string; readonly status: 'unchanged'; readonly dialogueId: string }
  | { readonly file: string; readonly status: 'failed'; readonly errors: readonly DialogueDiagnostic[] };

export type SyncReport = {
  readonly root: string;
  readonly scanned: number;
  readonly results: readonly SyncOutcome[];
  readonly orphans: readonly string[];
};

function dialogueIdFromFile(name: string): string {
  return name.replace(/\.(twee|tw)$/i, '');
}

/** Resolve a candidate inside `root`, refusing anything that escapes it —
 *  symlinks included, since realpath collapses them before the check. */
async function safeResolve(root: string, name: string): Promise<string | null> {
  const candidate = resolve(root, name);
  try {
    const real = await realpath(candidate);
    const realRoot = await realpath(root);
    return real === realRoot || real.startsWith(realRoot + sep) ? real : null;
  } catch {
    return null;
  }
}

export async function syncDialogueFolder(): Promise<SyncReport> {
  const root = resolve(config.paths.dialogues);
  const results: SyncOutcome[] = [];
  const seen = new Set<string>();

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    log.warn('dialogue.sync.readdir.fail', { root, err: error instanceof Error ? error.message : String(error) });
    return { root, scanned: 0, results: [], orphans: [] };
  }

  const files = entries.filter((name) => ALLOWED_EXT.some((ext) => name.toLowerCase().endsWith(ext)));

  const checker = await buildCrossRefChecker();

  for (const name of files) {
    const full = await safeResolve(root, name);
    if (full === null) {
      results.push({ file: name, status: 'failed', errors: [{ line: 0, passage: null, message: 'path escapes the dialogue folder' }] });
      continue;
    }
    const info = await stat(full);
    if (!info.isFile()) continue;
    if (info.size > MAX_BYTES) {
      results.push({ file: name, status: 'failed', errors: [{ line: 0, passage: null, message: `file is larger than ${MAX_BYTES} bytes` }] });
      continue;
    }

    const source = await readFile(full, 'utf8');
    const dialogueId = dialogueIdFromFile(name);
    seen.add(dialogueId);

    const existing = await getDialogue(dialogueId);
    const upToDate = existing !== null
      && existing.sourceHash === hashSource(source)
      && existing.definition.schemaVersion === DIALOGUE_SCHEMA_VERSION;
    if (upToDate) {
      results.push({ file: name, status: 'unchanged', dialogueId });
      continue;
    }

    const parsed = parseAndValidateWithRefs(source, dialogueId, checker);
    if (parsed.definition === null) {
      results.push({ file: name, status: 'failed', errors: parsed.errors });
      continue;
    }
    await saveDialogue({ definition: parsed.definition, sourceTwee: source, sourcePath: name });
    results.push({
      file: name,
      status: existing === null ? 'imported' : 'updated',
      dialogueId,
      warnings: parsed.warnings,
    });
  }

  const { listDialogues } = await import('./repo.js');
  const stored = await listDialogues();
  const orphans = stored
    .filter((d) => d.sourcePath !== null && !seen.has(d.dialogueId))
    .map((d) => d.dialogueId);

  log.info('dialogue.sync.done', {
    root,
    scanned: files.length,
    imported: results.filter((r) => r.status === 'imported').length,
    updated: results.filter((r) => r.status === 'updated').length,
    failed: results.filter((r) => r.status === 'failed').length,
    orphans: orphans.length,
  });

  return { root, scanned: files.length, results, orphans };
}
