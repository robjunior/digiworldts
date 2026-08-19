import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Npc, NpcExpression } from '@digiworld/shared/npc';
import { NPC_ID_PATTERN, NPC_EXPRESSION_PATTERN } from '@digiworld/shared/npc';

import { config } from '../config.js';
import { one, q, run } from '../db/index.js';

const SQL_SELECT_ALL = `SELECT id, display_name, expressions, created_at, updated_at FROM npcs ORDER BY id`;
const SQL_SELECT_ALL_PUBLISHED = `SELECT id, display_name, expressions, created_at, updated_at FROM npcs WHERE status = 'published' ORDER BY id`;
const SQL_SELECT_ONE = `SELECT id, display_name, expressions, created_at, updated_at FROM npcs WHERE id = ?`;
const SQL_SELECT_ONE_PUBLISHED = `SELECT id, display_name, expressions, created_at, updated_at FROM npcs WHERE id = ? AND status = 'published'`;
const SQL_UPSERT = `
  INSERT INTO npcs (id, display_name, expressions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    display_name = excluded.display_name,
    expressions  = excluded.expressions,
    updated_at   = excluded.updated_at
`;
const SQL_DELETE = `DELETE FROM npcs WHERE id = ?`;
const SQL_EXISTS = `SELECT id FROM npcs WHERE id = ?`;

type NpcRow = {
  readonly id: string;
  readonly display_name: string;
  readonly expressions: string;
  readonly created_at: number;
  readonly updated_at: number;
};

type StoredExpression = { readonly key: string; readonly label?: string };

export type NpcInput = {
  readonly id: string;
  readonly displayName: string;
  readonly expressions: readonly { readonly key: string; readonly label?: string | undefined }[];
};

export class NpcValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`invalid npc: ${issues.join('; ')}`);
    this.name = 'NpcValidationError';
  }
}

function parseExpressions(raw: string): readonly StoredExpression[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
      .map((v) => ({
        key: typeof v.key === 'string' ? v.key : '',
        ...(typeof v.label === 'string' ? { label: v.label } : {}),
      }))
      .filter((v) => v.key.length > 0);
  } catch {
    return [];
  }
}

function portraitPath(npcId: string, expression: string): string {
  return resolve(config.paths.npcPortraitsDir, npcId, `${expression}.png`);
}

export function npcPortraitFile(npcId: string, expression: string): string {
  return portraitPath(npcId, expression);
}

function hydrate(row: NpcRow): Npc {
  const stored = parseExpressions(row.expressions);
  const expressions: NpcExpression[] = stored.map((expr) => ({
    key: expr.key,
    ...(expr.label !== undefined ? { label: expr.label } : {}),
    hasPortrait: existsSync(portraitPath(row.id, expr.key)),
  }));
  return {
    id: row.id,
    displayName: row.display_name,
    expressions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listNpcs(publishedOnly = false): Promise<readonly Npc[]> {
  const rows = await q<NpcRow>(publishedOnly ? SQL_SELECT_ALL_PUBLISHED : SQL_SELECT_ALL);
  return rows.map(hydrate);
}

export async function getNpc(id: string, publishedOnly = false): Promise<Npc | null> {
  const row = await one<NpcRow>(publishedOnly ? SQL_SELECT_ONE_PUBLISHED : SQL_SELECT_ONE, id);
  return row === null ? null : hydrate(row);
}

export async function npcExists(id: string): Promise<boolean> {
  const row = await one<{ id: string }>(SQL_EXISTS, id);
  return row !== null;
}

function validateInput(input: NpcInput): readonly string[] {
  const issues: string[] = [];
  if (!NPC_ID_PATTERN.test(input.id)) {
    issues.push('id must be lowercase kebab/snake starting with a letter');
  }
  if (input.displayName.trim().length === 0 || input.displayName.length > 120) {
    issues.push('displayName must be 1-120 chars');
  }
  if (input.expressions.length === 0) {
    issues.push('at least one expression is required (typically "neutral")');
  }
  const seen = new Set<string>();
  for (const expr of input.expressions) {
    if (!NPC_EXPRESSION_PATTERN.test(expr.key)) {
      issues.push(`expression "${expr.key}" must be lowercase kebab/snake`);
    }
    if (seen.has(expr.key)) issues.push(`duplicate expression "${expr.key}"`);
    seen.add(expr.key);
    if (expr.label !== undefined && (expr.label.trim().length === 0 || expr.label.length > 64)) {
      issues.push(`expression "${expr.key}" label must be 1-64 chars when set`);
    }
  }
  return issues;
}

export async function saveNpc(input: NpcInput): Promise<Npc> {
  const issues = validateInput(input);
  if (issues.length > 0) throw new NpcValidationError(issues);
  const now = Date.now();
  const serialized = JSON.stringify(
    input.expressions.map((e) => ({ key: e.key, ...(e.label !== undefined ? { label: e.label } : {}) })),
  );
  await run(SQL_UPSERT, [input.id, input.displayName.trim(), serialized, now, now]);
  const saved = await getNpc(input.id);
  if (saved === null) throw new Error('npc-save-readback-failed');
  return saved;
}

export async function deleteNpc(id: string): Promise<boolean> {
  const result = await run(SQL_DELETE, id);
  return result.changes > 0;
}
