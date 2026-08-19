import { createHash } from 'node:crypto';

import type { DialogueDefinition } from '@digiworld/shared/dialogue';
import type { ContentStatus } from '@digiworld/shared/digimon';

import { one, q, run } from '../db/index.js';

const SQL_SELECT_ALL = `SELECT dialogue_id, title, source_path, source_hash, start_node_id, npc_ids, node_count, imported_at, updated_at, status FROM dialogue_definitions ORDER BY dialogue_id`;
const SQL_SELECT_ALL_PUBLISHED = `SELECT dialogue_id, title, source_path, source_hash, start_node_id, npc_ids, node_count, imported_at, updated_at, status FROM dialogue_definitions WHERE status = 'published' ORDER BY dialogue_id`;
const SQL_SELECT_ONE = `SELECT * FROM dialogue_definitions WHERE dialogue_id = ?`;
const SQL_SELECT_ONE_PUBLISHED = `SELECT * FROM dialogue_definitions WHERE dialogue_id = ? AND status = 'published'`;
const SQL_DELETE = `DELETE FROM dialogue_definitions WHERE dialogue_id = ?`;
const SQL_UPSERT = `
  INSERT INTO dialogue_definitions
      (dialogue_id, title, source_path, source_hash, source_twee, start_node_id, npc_ids, ir_json, node_count, imported_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (dialogue_id) DO UPDATE SET
    title = excluded.title,
    source_path = excluded.source_path,
    source_hash = excluded.source_hash,
    source_twee = excluded.source_twee,
    start_node_id = excluded.start_node_id,
    npc_ids = excluded.npc_ids,
    ir_json = excluded.ir_json,
    node_count = excluded.node_count,
    updated_at = excluded.updated_at
`;

type DialogueRow = {
  readonly dialogue_id: string;
  readonly title: string;
  readonly source_path: string | null;
  readonly source_hash: string;
  readonly source_twee: string;
  readonly start_node_id: string;
  readonly npc_ids: string;
  readonly ir_json: string;
  readonly node_count: number;
  readonly status: ContentStatus;
  readonly imported_at: number;
  readonly updated_at: number;
};

type DialogueSummaryRow = Omit<DialogueRow, 'source_twee' | 'ir_json'>;

export type DialogueSummary = {
  readonly dialogueId: string;
  readonly title: string;
  readonly sourcePath: string | null;
  readonly sourceHash: string;
  readonly startNodeId: string;
  readonly npcIds: readonly string[];
  readonly nodeCount: number;
  readonly status: ContentStatus;
  readonly importedAt: number;
  readonly updatedAt: number;
};

export type StoredDialogue = DialogueSummary & {
  readonly sourceTwee: string;
  readonly definition: DialogueDefinition;
};

export function hashSource(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function parseIds(raw: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function toSummary(row: DialogueSummaryRow): DialogueSummary {
  return {
    dialogueId: row.dialogue_id,
    title: row.title,
    sourcePath: row.source_path,
    sourceHash: row.source_hash,
    startNodeId: row.start_node_id,
    npcIds: parseIds(row.npc_ids),
    nodeCount: row.node_count,
    status: row.status,
    importedAt: row.imported_at,
    updatedAt: row.updated_at,
  };
}

export async function listDialogues(publishedOnly = false): Promise<readonly DialogueSummary[]> {
  const rows = await q<DialogueSummaryRow>(publishedOnly ? SQL_SELECT_ALL_PUBLISHED : SQL_SELECT_ALL);
  return rows.map(toSummary);
}

export async function getDialogue(dialogueId: string, publishedOnly = false): Promise<StoredDialogue | null> {
  const row = await one<DialogueRow>(publishedOnly ? SQL_SELECT_ONE_PUBLISHED : SQL_SELECT_ONE, dialogueId);
  if (row === null) return null;
  return {
    ...toSummary(row),
    sourceTwee: row.source_twee,
    definition: JSON.parse(row.ir_json) as DialogueDefinition,
  };
}

export async function saveDialogue(input: {
  readonly definition: DialogueDefinition;
  readonly sourceTwee: string;
  readonly sourcePath: string | null;
}): Promise<DialogueSummary> {
  const now = Date.now();
  const hash = hashSource(input.sourceTwee);
  const nodeCount = Object.keys(input.definition.nodes).length;
  await run(SQL_UPSERT, [
    input.definition.dialogueId,
    input.definition.title,
    input.sourcePath,
    hash,
    input.sourceTwee,
    input.definition.startNodeId,
    JSON.stringify(input.definition.npcIds),
    JSON.stringify(input.definition),
    nodeCount,
    now,
    now,
  ]);
  const saved = await getDialogue(input.definition.dialogueId);
  if (saved === null) throw new Error('dialogue-save-readback-failed');
  return saved;
}

export async function deleteDialogue(dialogueId: string): Promise<boolean> {
  const result = await run(SQL_DELETE, dialogueId);
  return result.changes > 0;
}
