import type { DialogueAction, DialogueChoice, DialogueCondition, DialogueNode, DialogueValueRef } from '@digiworld/shared/dialogue';

import type { DbExecutor } from '../db/executor.js';
import { execRun } from '../db/executor.js';
import { tx } from '../db/index.js';
import { clearFlag, hasFlag, setFlag } from '../flags/repo.js';
import { grantItem, hasItem, removeItem } from '../items/grant.js';
import { startQuestWithin } from '../quests/repo.js';

export class DialogueRuntimeError extends Error {}

export type DialogueScalar = string | number | boolean;

export type DialogueRuntimeContext = {
  readonly userId: string;
  readonly dialogueId: string;
  readonly facts: Readonly<Record<string, DialogueScalar>>;
  readonly variables: Readonly<Record<string, DialogueScalar>>;
};

const SQL_CLAIM_ACTION = `
  INSERT INTO user_dialogue_actions (user_id, action_id, applied_at)
       VALUES (?, ?, ?)
  ON CONFLICT (user_id, action_id) DO NOTHING
`;

function resolveValue(ref: DialogueValueRef, ctx: DialogueRuntimeContext): DialogueScalar {
  if (ref.kind === 'literal') return ref.value;
  const source = ref.kind === 'variable' ? ctx.variables : ctx.facts;
  const label = ref.kind === 'variable' ? `$${ref.name}` : ref.name;
  if (!Object.hasOwn(source, ref.name)) {
    throw new DialogueRuntimeError(`dialogue referenced unknown ${ref.kind} "${label}"`);
  }
  return source[ref.name]!;
}

function asString(value: DialogueScalar, where: string): string {
  if (typeof value !== 'string') throw new DialogueRuntimeError(`${where} expects a string, got ${typeof value}`);
  return value;
}

function asCount(value: DialogueScalar | undefined, where: string): number {
  if (value === undefined) return 1;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new DialogueRuntimeError(`${where} expects a positive integer quantity`);
  }
  return value;
}

type Predicate = (ctx: DialogueRuntimeContext, args: readonly DialogueScalar[], ex?: DbExecutor) => Promise<boolean>;

const PREDICATES: Readonly<Record<string, Predicate>> = {
  flag_enabled: (ctx, args, ex) => hasFlag(ctx.userId, asString(args[0]!, 'flag_enabled'), ex),
  player_has_item: (ctx, args, ex) =>
    hasItem(ctx.userId, asString(args[0]!, 'player_has_item'), asCount(args[1], 'player_has_item'), ex),
};

/**
 * Registry, not a dynamic dispatch: an unknown name is refused rather than
 * ignored. A silently skipped predicate would open a gate the writer meant to
 * keep shut, which is the failure mode this whole tier exists to prevent.
 */
type ActionHandler = (ctx: DialogueRuntimeContext, args: readonly DialogueScalar[], ex: DbExecutor) => Promise<boolean>;

const ACTIONS: Readonly<Record<string, ActionHandler>> = {
  set_flag: async (ctx, args, ex) => {
    await setFlag(ctx.userId, asString(args[0]!, 'set_flag'), Date.now(), ex);
    return true;
  },
  clear_flag: async (ctx, args, ex) => {
    await clearFlag(ctx.userId, asString(args[0]!, 'clear_flag'), ex);
    return true;
  },
  give_item: async (ctx, args, ex) => {
    await grantItem(ctx.userId, asString(args[0]!, 'give_item'), asCount(args[1], 'give_item'), Date.now(), ex);
    return true;
  },
  remove_item: (ctx, args, ex) =>
    removeItem(ctx.userId, asString(args[0]!, 'remove_item'), asCount(args[1], 'remove_item'), Date.now(), ex),
  start_quest: async (ctx, args, ex) => {
    const started = await startQuestWithin(ex, ctx.userId, asString(args[0]!, 'start_quest'));
    return started !== null;
  },
};

export function isKnownAction(name: string): boolean {
  return Object.hasOwn(ACTIONS, name);
}

export function isKnownPredicate(name: string): boolean {
  return Object.hasOwn(PREDICATES, name);
}

function compare(left: DialogueScalar, op: string, right: DialogueScalar): boolean {
  if (op === '==') return left === right;
  if (op === '!=') return left !== right;
  if (typeof left !== 'number' || typeof right !== 'number') {
    throw new DialogueRuntimeError(`"${op}" needs two numbers`);
  }
  if (op === '<') return left < right;
  if (op === '<=') return left <= right;
  if (op === '>') return left > right;
  if (op === '>=') return left >= right;
  throw new DialogueRuntimeError(`unknown comparison "${op}"`);
}

export async function evaluateCondition(
  condition: DialogueCondition,
  ctx: DialogueRuntimeContext,
  ex?: DbExecutor,
): Promise<boolean> {
  if (condition.kind === 'all') {
    for (const part of condition.of) if (!(await evaluateCondition(part, ctx, ex))) return false;
    return true;
  }
  if (condition.kind === 'any') {
    for (const part of condition.of) if (await evaluateCondition(part, ctx, ex)) return true;
    return false;
  }
  if (condition.kind === 'not') return !(await evaluateCondition(condition.of, ctx, ex));
  if (condition.kind === 'compare') {
    return compare(resolveValue(condition.left, ctx), condition.op, resolveValue(condition.right, ctx));
  }
  const predicate = PREDICATES[condition.name];
  if (predicate === undefined) throw new DialogueRuntimeError(`unknown predicate "${condition.name}"`);
  return predicate(ctx, condition.args.map((arg) => resolveValue(arg, ctx)), ex);
}

export async function visibleChoices(
  node: DialogueNode,
  ctx: DialogueRuntimeContext,
): Promise<readonly DialogueChoice[]> {
  const out: DialogueChoice[] = [];
  for (const choice of node.choices) {
    if (choice.condition === null || (await evaluateCondition(choice.condition, ctx))) out.push(choice);
  }
  return out;
}

/**
 * The parser numbers actions per passage, so `start#a0` repeats across every
 * dialogue that names its opening passage `start` -- which all six quest
 * intros do. Qualifying by dialogue keeps one dialogue's ledger entry from
 * suppressing another's action entirely.
 */
function ledgerKey(dialogueId: string, action: DialogueAction): string {
  return `${dialogueId}:${action.id}`;
}

async function claim(ex: DbExecutor, ctx: DialogueRuntimeContext, action: DialogueAction, now: number): Promise<boolean> {
  const info = await execRun(ex, SQL_CLAIM_ACTION, [ctx.userId, ledgerKey(ctx.dialogueId, action), now]);
  return info.changes > 0;
}

/**
 * Claims each action in the ledger BEFORE running it, so the insert is the
 * mutex: a concurrent advance blocks on the primary key and then sees the row,
 * instead of both reading "not yet applied" and paying out twice. The whole
 * node lands in one transaction -- a refused remove_item rolls back the
 * give_item beside it rather than handing out the reward for free.
 */
export async function applyEntryActions(
  node: DialogueNode,
  ctx: DialogueRuntimeContext,
): Promise<readonly string[]> {
  if (node.entryActions.length === 0) return [];
  const now = Date.now();
  return tx(async (t) => {
    const applied: string[] = [];
    for (const action of node.entryActions) {
      const handler = ACTIONS[action.name];
      if (handler === undefined) throw new DialogueRuntimeError(`unknown action "${action.name}"`);
      if (!(await claim(t, ctx, action, now))) continue;
      const args = action.args.map((arg) => resolveValue(arg, ctx));
      if (!(await handler(ctx, args, t))) {
        throw new DialogueRuntimeError(`action "${action.name}" was refused`);
      }
      applied.push(action.id);
    }
    return applied;
  });
}
