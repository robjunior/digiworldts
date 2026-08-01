import type {
  DialogueAction, DialogueCondition, DialogueDefinition, DialogueNode,
  DialogueSpeaker, DialogueTextPart, DialogueValueRef,
} from '@digiworld/shared/dialogue';
import { DIALOGUE_END_NODE } from '@digiworld/shared/dialogue';

import { getDialogue } from './repo.js';

export type SimulatorScalar = string | number | boolean;

export type SimulatorFactOverrides = {
  readonly level?: number | undefined;
  readonly playerName?: string | undefined;
  readonly flags?: readonly string[] | undefined;
  readonly items?: Readonly<Record<string, number>> | undefined;
};

export type SimulatorStep = {
  readonly nodeId: string;
  readonly choiceId: string;
};

export type SimulatorRequest = {
  readonly dialogueId: string;
  readonly overrides: SimulatorFactOverrides;
  readonly history: readonly SimulatorStep[];
};

export type SimulatedActionPreview = {
  readonly id: string;
  readonly name: string;
  readonly args: readonly SimulatorScalar[];
  readonly appliedSuccessfully: boolean;
  readonly note: string | null;
};

export type SimulatedChoicePreview = {
  readonly id: string;
  readonly label: string;
  readonly target: string;
  readonly visible: boolean;
  readonly conditionSummary: string | null;
};

export type SimulatorView = {
  readonly nodeId: string;
  readonly speaker: DialogueSpeaker | null;
  readonly tags: readonly string[];
  readonly text: string;
  readonly actionsAtEntry: readonly SimulatedActionPreview[];
  readonly choices: readonly SimulatedChoicePreview[];
  readonly done: boolean;
  readonly jumpTrail: readonly string[];
  readonly flags: readonly string[];
  readonly items: Readonly<Record<string, number>>;
};

export type SimulatorFailure =
  | { readonly kind: 'unknown-dialogue' }
  | { readonly kind: 'unknown-node'; readonly nodeId: string }
  | { readonly kind: 'invalid-history'; readonly step: number; readonly reason: string }
  | { readonly kind: 'evaluation-error'; readonly step: number; readonly reason: string };

export type SimulatorResult =
  | { readonly ok: true; readonly view: SimulatorView }
  | { readonly ok: false; readonly failure: SimulatorFailure };

type State = {
  readonly facts: Record<string, SimulatorScalar>;
  readonly variables: Record<string, SimulatorScalar>;
  readonly flags: Set<string>;
  readonly items: Map<string, number>;
};

function initialState(overrides: SimulatorFactOverrides): State {
  return {
    facts: { level: overrides.level ?? 1 },
    variables: { player_name: overrides.playerName ?? 'Player' },
    flags: new Set(overrides.flags ?? []),
    items: new Map(Object.entries(overrides.items ?? {})),
  };
}

function resolveValue(ref: DialogueValueRef, state: State): SimulatorScalar {
  if (ref.kind === 'literal') return ref.value;
  const source = ref.kind === 'variable' ? state.variables : state.facts;
  if (!Object.hasOwn(source, ref.name)) {
    throw new Error(`simulator missing ${ref.kind} "${ref.name}"`);
  }
  return source[ref.name]!;
}

function asString(v: SimulatorScalar): string {
  return String(v);
}

function asCount(v: SimulatorScalar | undefined): number {
  if (v === undefined) return 1;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 1;
}

function compare(op: string, l: SimulatorScalar, r: SimulatorScalar): boolean {
  if (op === '==') return l === r;
  if (op === '!=') return l !== r;
  if (typeof l !== 'number' || typeof r !== 'number') return false;
  if (op === '<') return l < r;
  if (op === '<=') return l <= r;
  if (op === '>') return l > r;
  if (op === '>=') return l >= r;
  return false;
}

function evaluate(condition: DialogueCondition, state: State): boolean {
  if (condition.kind === 'all') return condition.of.every((p) => evaluate(p, state));
  if (condition.kind === 'any') return condition.of.some((p) => evaluate(p, state));
  if (condition.kind === 'not') return !evaluate(condition.of, state);
  if (condition.kind === 'compare') {
    return compare(condition.op, resolveValue(condition.left, state), resolveValue(condition.right, state));
  }
  const args = condition.args.map((a) => resolveValue(a, state));
  if (condition.name === 'flag_enabled') return state.flags.has(asString(args[0]!));
  if (condition.name === 'player_has_item') {
    return (state.items.get(asString(args[0]!)) ?? 0) >= asCount(args[1]);
  }
  return false;
}

function renderValue(v: DialogueValueRef): string {
  if (v.kind === 'literal') return typeof v.value === 'string' ? `"${v.value}"` : String(v.value);
  if (v.kind === 'variable') return `$${v.name}`;
  return v.name;
}

function renderCondition(c: DialogueCondition): string {
  if (c.kind === 'all') return c.of.map(renderCondition).join(' and ');
  if (c.kind === 'any') return c.of.map(renderCondition).join(' or ');
  if (c.kind === 'not') return `not (${renderCondition(c.of)})`;
  if (c.kind === 'compare') return `${renderValue(c.left)} ${c.op} ${renderValue(c.right)}`;
  return `${c.name}(${c.args.map(renderValue).join(', ')})`;
}

function renderText(parts: readonly DialogueTextPart[], state: State): string {
  return parts.map((p) => {
    if (p.kind === 'text') return p.value;
    const v = state.variables[p.name];
    return v !== undefined ? String(v) : `{${p.name}}`;
  }).join('');
}

function applyAction(action: DialogueAction, state: State): SimulatedActionPreview {
  const args = action.args.map((a) => resolveValue(a, state));
  const base = { id: action.id, name: action.name, args };
  if (action.name === 'set_flag') {
    state.flags.add(asString(args[0]!));
    return { ...base, appliedSuccessfully: true, note: null };
  }
  if (action.name === 'clear_flag') {
    state.flags.delete(asString(args[0]!));
    return { ...base, appliedSuccessfully: true, note: null };
  }
  if (action.name === 'give_item') {
    const id = asString(args[0]!);
    const qty = asCount(args[1]);
    state.items.set(id, (state.items.get(id) ?? 0) + qty);
    return { ...base, appliedSuccessfully: true, note: null };
  }
  if (action.name === 'remove_item') {
    const id = asString(args[0]!);
    const qty = asCount(args[1]);
    const current = state.items.get(id) ?? 0;
    if (current < qty) {
      return { ...base, appliedSuccessfully: false, note: `has ${current}, needs ${qty}` };
    }
    state.items.set(id, current - qty);
    return { ...base, appliedSuccessfully: true, note: null };
  }
  if (action.name === 'start_quest') {
    return { ...base, appliedSuccessfully: true, note: 'quest would be started' };
  }
  return { ...base, appliedSuccessfully: false, note: 'unknown action (parser gate should have caught this)' };
}

function resolveNode(
  definition: DialogueDefinition,
  nodeId: string,
  state: State,
): { readonly node: DialogueNode | null; readonly trail: readonly string[] } {
  const trail: string[] = [];
  const seen = new Set<string>();
  let current = nodeId;
  for (;;) {
    if (current === DIALOGUE_END_NODE || seen.has(current)) return { node: null, trail };
    seen.add(current);
    const node = definition.nodes[current];
    if (node === undefined) return { node: null, trail };
    let jumped: string | null = null;
    for (const jump of node.jumps) {
      if (jump.condition === null || evaluate(jump.condition, state)) {
        jumped = jump.target;
        break;
      }
    }
    if (jumped === null) return { node, trail };
    trail.push(current);
    current = jumped;
  }
}

function buildView(
  node: DialogueNode,
  actionsAtEntry: readonly SimulatedActionPreview[],
  trail: readonly string[],
  state: State,
): SimulatorView {
  const choices: SimulatedChoicePreview[] = node.choices.map((c) => ({
    id: c.id,
    label: c.label,
    target: c.target,
    visible: c.condition === null || evaluate(c.condition, state),
    conditionSummary: c.condition === null ? null : renderCondition(c.condition),
  }));
  return {
    nodeId: node.id,
    speaker: node.speaker,
    tags: node.tags,
    text: renderText(node.text, state),
    actionsAtEntry,
    choices,
    done: false,
    jumpTrail: trail,
    flags: [...state.flags].sort(),
    items: Object.fromEntries([...state.items.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function endView(trail: readonly string[], state: State): SimulatorView {
  return {
    nodeId: DIALOGUE_END_NODE,
    speaker: null,
    tags: [],
    text: '(dialogue ended)',
    actionsAtEntry: [],
    choices: [],
    done: true,
    jumpTrail: trail,
    flags: [...state.flags].sort(),
    items: Object.fromEntries([...state.items.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

export async function simulate(request: SimulatorRequest): Promise<SimulatorResult> {
  const stored = await getDialogue(request.dialogueId);
  if (stored === null) return { ok: false, failure: { kind: 'unknown-dialogue' } };

  const state = initialState(request.overrides);
  const definition = stored.definition;

  let currentResolved = resolveNode(definition, definition.startNodeId, state);
  if (currentResolved.node === null) {
    return { ok: false, failure: { kind: 'unknown-node', nodeId: definition.startNodeId } };
  }
  let node: DialogueNode = currentResolved.node;
  let trail: readonly string[] = currentResolved.trail;
  let actionsAtEntry: SimulatedActionPreview[] = [];
  try {
    for (const action of node.entryActions) {
      actionsAtEntry.push(applyAction(action, state));
    }
  } catch (err) {
    return { ok: false, failure: { kind: 'evaluation-error', step: 0, reason: err instanceof Error ? err.message : String(err) } };
  }

  for (let i = 0; i < request.history.length; i += 1) {
    const step = request.history[i]!;
    if (step.nodeId !== node.id) {
      return { ok: false, failure: { kind: 'invalid-history', step: i, reason: `expected node "${node.id}", got "${step.nodeId}"` } };
    }
    const choice = node.choices.find((c) => c.id === step.choiceId);
    if (choice === undefined) {
      return { ok: false, failure: { kind: 'invalid-history', step: i, reason: `choice "${step.choiceId}" not defined on node "${node.id}"` } };
    }
    try {
      if (choice.condition !== null && !evaluate(choice.condition, state)) {
        return { ok: false, failure: { kind: 'invalid-history', step: i, reason: `choice "${step.choiceId}" not visible under current state` } };
      }
    } catch (err) {
      return { ok: false, failure: { kind: 'evaluation-error', step: i, reason: err instanceof Error ? err.message : String(err) } };
    }
    const nextResolved = resolveNode(definition, choice.target, state);
    trail = nextResolved.trail;
    if (nextResolved.node === null) {
      return { ok: true, view: endView(trail, state) };
    }
    node = nextResolved.node;
    actionsAtEntry = [];
    try {
      for (const action of node.entryActions) {
        actionsAtEntry.push(applyAction(action, state));
      }
    } catch (err) {
      return { ok: false, failure: { kind: 'evaluation-error', step: i, reason: err instanceof Error ? err.message : String(err) } };
    }
  }

  return { ok: true, view: buildView(node, actionsAtEntry, trail, state) };
}
