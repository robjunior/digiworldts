import type { DialogueDefinition, DialogueDiagnostic } from '@digiworld/shared/dialogue';

import { q } from '../db/index.js';
import { listNpcs } from '../npcs/repo.js';

/**
 * Import-time reference checker.
 *
 * The dialogue parser accepts any well-formed name (see runtime.unsupportedNames
 * for name-level validation). This checker adds a second gate: the *arguments*
 * of those names must resolve to real rows.
 *
 * A dialogue that ships `@do give_item("meat_pack")` where `meat_pack` isn't
 * a shop item silently no-ops today — the runtime finds nothing to grant, the
 * player never sees the item, and the writer never learns why their reward
 * doesn't land. Cross-referencing at import time turns that silent no-op into
 * a targeted error with the passage name and the missing id.
 *
 * Interfaces are sync (checker state is prefetched at build time) so a bulk
 * sync of N files pays for one round-trip instead of N × (per-check queries).
 */
export type CrossRefChecker = {
  readonly npcExists: (id: string) => boolean;
  readonly npcHasExpression: (id: string, expression: string) => boolean;
  readonly questExists: (id: string) => boolean;
  readonly itemExists: (id: string) => boolean;
};

const SQL_ALL_QUEST_IDS = `SELECT id FROM quests`;
const SQL_ALL_ITEM_IDS = `SELECT id FROM shop_items`;

export async function buildCrossRefChecker(): Promise<CrossRefChecker> {
  const [npcs, quests, items] = await Promise.all([
    listNpcs(),
    q<{ readonly id: string }>(SQL_ALL_QUEST_IDS),
    q<{ readonly id: string }>(SQL_ALL_ITEM_IDS),
  ]);
  const npcMap = new Map<string, Set<string>>();
  for (const npc of npcs) {
    npcMap.set(npc.id, new Set(npc.expressions.map((e) => e.key)));
  }
  const questIds = new Set(quests.map((r) => r.id));
  const itemIds = new Set(items.map((r) => r.id));
  return {
    npcExists: (id) => npcMap.has(id),
    npcHasExpression: (id, expression) => npcMap.get(id)?.has(expression) ?? false,
    questExists: (id) => questIds.has(id),
    itemExists: (id) => itemIds.has(id),
  };
}

const ITEM_ACTION_NAMES = new Set(['give_item', 'remove_item']);
const QUEST_ACTION_NAMES = new Set(['start_quest']);
const ITEM_PREDICATE_NAMES = new Set(['player_has_item']);

function firstStringArg(args: ReadonlyArray<{ readonly kind: string; readonly value?: unknown }>): string | null {
  const arg = args[0];
  if (arg === undefined || arg.kind !== 'literal' || typeof arg.value !== 'string') return null;
  return arg.value;
}

/**
 * Walks every node once and reports refs whose ids don't resolve. Runs in O(N)
 * over passages + choices + jumps; each individual lookup is a Set/Map hit.
 * Returns an empty array on a clean import, mirroring `unsupportedNames`.
 */
export function unresolvedReferences(
  definition: DialogueDefinition,
  checker: CrossRefChecker,
): readonly DialogueDiagnostic[] {
  const out: DialogueDiagnostic[] = [];
  for (const node of Object.values(definition.nodes)) {
    if (node.speaker !== null) {
      if (!checker.npcExists(node.speaker.npcId)) {
        out.push({ line: 0, passage: node.id, message: `unknown NPC "${node.speaker.npcId}"` });
      } else if (!checker.npcHasExpression(node.speaker.npcId, node.speaker.expression)) {
        out.push({
          line: 0,
          passage: node.id,
          message: `NPC "${node.speaker.npcId}" has no expression "${node.speaker.expression}"`,
        });
      }
    }
    for (const action of node.entryActions) {
      const ref = firstStringArg(action.args);
      if (ref === null) continue;
      if (ITEM_ACTION_NAMES.has(action.name) && !checker.itemExists(ref)) {
        out.push({ line: 0, passage: node.id, message: `${action.name} references unknown item "${ref}"` });
      }
      if (QUEST_ACTION_NAMES.has(action.name) && !checker.questExists(ref)) {
        out.push({ line: 0, passage: node.id, message: `${action.name} references unknown quest "${ref}"` });
      }
    }
    const predicateNodes: { readonly condition: import('@digiworld/shared/dialogue').DialogueCondition | null }[] = [
      { condition: node.condition },
      ...node.choices.map((c) => ({ condition: c.condition })),
      ...node.jumps.map((j) => ({ condition: j.condition })),
    ];
    for (const { condition } of predicateNodes) {
      if (condition === null) continue;
      collectPredicateRefs(condition, node.id, checker, out);
    }
  }
  return out;
}

function collectPredicateRefs(
  condition: import('@digiworld/shared/dialogue').DialogueCondition,
  passage: string,
  checker: CrossRefChecker,
  out: DialogueDiagnostic[],
): void {
  if (condition.kind === 'all' || condition.kind === 'any') {
    for (const part of condition.of) collectPredicateRefs(part, passage, checker, out);
    return;
  }
  if (condition.kind === 'not') {
    collectPredicateRefs(condition.of, passage, checker, out);
    return;
  }
  if (condition.kind === 'predicate' && ITEM_PREDICATE_NAMES.has(condition.name)) {
    const ref = firstStringArg(condition.args);
    if (ref !== null && !checker.itemExists(ref)) {
      out.push({ line: 0, passage, message: `${condition.name} references unknown item "${ref}"` });
    }
  }
}
