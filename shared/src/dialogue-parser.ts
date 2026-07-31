import {
  DIALOGUE_END_NODE,
  DIALOGUE_SCHEMA_VERSION,
  type DialogueAction,
  type DialogueChoice,
  type DialogueCondition,
  type DialogueDefinition,
  type DialogueDiagnostic,
  type DialogueJump,
  type DialogueNode,
  type DialogueParseResult,
  type DialogueSpeaker,
  type DialogueTextPart,
} from './dialogue.js';
import { DialogueExprError, parseAction, parseCondition } from './dialogue-expr.js';

const PASSAGE_RE = /^::\s*(.+?)\s*(?:\[(.*?)\])?\s*$/;
const LINK_RE = /\[\[([^\]]+)\]\]/;
const CHOICE_RE = /^\*\s*(.+)$/;
const DIRECTIVE_RE = /^@(\w+)\s*(.*)$/;
const GOTO_RE = /^\[\[([^\]]+)\]\](?:\s+if\s+(.+))?$/;
const CHOICE_META_RE = /(?:\s+#(\S+))?(?:\s*\{\s*if\s*:\s*(.+?)\s*\})?\s*$/;
const STORY_PASSAGES = new Set(['StoryTitle', 'StoryData', 'StoryStylesheet', 'StoryScript']);

type RawPassage = { readonly name: string; readonly tags: readonly string[]; readonly lines: readonly string[]; readonly startLine: number };

function splitPassages(source: string): RawPassage[] {
  const out: RawPassage[] = [];
  const lines = source.split(/\r?\n/);
  let current: { name: string; tags: string[]; lines: string[]; startLine: number } | null = null;
  lines.forEach((line, index) => {
    const header = PASSAGE_RE.exec(line);
    if (header !== null && line.startsWith('::')) {
      if (current !== null) out.push(current);
      const tags = (header[2] ?? '').split(/\s+/).filter((t) => t.length > 0);
      current = { name: header[1] ?? '', tags, lines: [], startLine: index + 1 };
      return;
    }
    if (current !== null) current.lines.push(line);
  });
  if (current !== null) out.push(current);
  return out;
}

function parseLinkTarget(raw: string): { readonly label: string; readonly target: string } {
  const arrow = raw.indexOf('->');
  if (arrow !== -1) return { label: raw.slice(0, arrow).trim(), target: raw.slice(arrow + 2).trim() };
  const pipe = raw.indexOf('|');
  if (pipe !== -1) return { label: raw.slice(0, pipe).trim(), target: raw.slice(pipe + 1).trim() };
  const trimmed = raw.trim();
  return { label: trimmed, target: trimmed };
}

function parseText(raw: string): DialogueTextPart[] {
  const parts: DialogueTextPart[] = [];
  let buffer = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '{') {
      const end = raw.indexOf('}', i + 1);
      const name = end === -1 ? '' : raw.slice(i + 1, end).trim();
      if (end !== -1 && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) {
        if (buffer.length > 0) { parts.push({ kind: 'text', value: buffer }); buffer = ''; }
        parts.push({ kind: 'variable', name });
        i = end + 1;
        continue;
      }
    }
    buffer += raw[i];
    i += 1;
  }
  if (buffer.length > 0) parts.push({ kind: 'text', value: buffer });
  return parts;
}

type NodeDraft = {
  speaker: DialogueSpeaker | null;
  condition: DialogueCondition | null;
  textLines: string[];
  entryActions: DialogueAction[];
  jumps: DialogueJump[];
  choices: DialogueChoice[];
};

function applyDirective(
  draft: NodeDraft, name: string, rest: string, node: string, line: number,
  errors: DialogueDiagnostic[],
): void {
  const fail = (message: string): void => { errors.push({ line, passage: node, message }); };
  try {
    if (name === 'speaker') {
      const [npcId, expression] = rest.split(/\s+/);
      if (npcId === undefined || npcId.length === 0) return fail('@speaker requires an NPC id');
      draft.speaker = { npcId, expression: expression ?? 'neutral' };
      return;
    }
    if (name === 'if') {
      if (rest.trim().length === 0) return fail('@if requires a condition');
      draft.condition = parseCondition(rest);
      return;
    }
    if (name === 'do') {
      if (rest.trim().length === 0) return fail('@do requires an action');
      draft.entryActions.push(parseAction(rest, `${node}#a${draft.entryActions.length}`));
      return;
    }
    if (name === 'goto') {
      const match = GOTO_RE.exec(rest.trim());
      if (match === null) return fail('@goto must be "@goto [[Target]]" optionally followed by "if <condition>"');
      const { target } = parseLinkTarget(match[1] ?? '');
      draft.jumps.push({ target, condition: match[2] === undefined ? null : parseCondition(match[2]) });
      return;
    }
    fail(`unknown directive "@${name}"`);
  } catch (error) {
    fail(error instanceof DialogueExprError ? error.message : String(error));
  }
}

function applyChoice(
  draft: NodeDraft, body: string, node: string, line: number, errors: DialogueDiagnostic[],
): void {
  const link = LINK_RE.exec(body);
  if (link === null) {
    errors.push({ line, passage: node, message: 'a choice must contain a [[Label->Target]] link' });
    return;
  }
  const { label, target } = parseLinkTarget(link[1] ?? '');
  const meta = CHOICE_META_RE.exec(body.slice(link.index + link[0].length));
  let condition: DialogueCondition | null = null;
  if (meta?.[2] !== undefined) {
    try {
      condition = parseCondition(meta[2]);
    } catch (error) {
      errors.push({ line, passage: node, message: error instanceof DialogueExprError ? error.message : String(error) });
      return;
    }
  }
  draft.choices.push({ id: meta?.[1] ?? `${node}#c${draft.choices.length}`, label, target, condition });
}

export function parseTwee(source: string, options: { readonly dialogueId: string }): DialogueParseResult {
  const errors: DialogueDiagnostic[] = [];
  const warnings: DialogueDiagnostic[] = [];
  const raw = splitPassages(source);
  const nodes: Record<string, DialogueNode> = {};
  let title = options.dialogueId;
  let startNodeId: string | null = null;

  for (const passage of raw) {
    if (passage.name === 'StoryTitle') {
      const value = passage.lines.join('\n').trim();
      if (value.length > 0) title = value;
      continue;
    }
    if (STORY_PASSAGES.has(passage.name)) continue;
    if (Object.hasOwn(nodes, passage.name)) {
      errors.push({ line: passage.startLine, passage: passage.name, message: 'duplicate passage name' });
      continue;
    }

    const draft: NodeDraft = { speaker: null, condition: null, textLines: [], entryActions: [], jumps: [], choices: [] };
    passage.lines.forEach((line, offset) => {
      const lineNo = passage.startLine + offset + 1;
      const trimmed = line.trim();
      if (trimmed.length === 0) { draft.textLines.push(''); return; }
      const directive = DIRECTIVE_RE.exec(trimmed);
      if (directive !== null) {
        applyDirective(draft, directive[1] ?? '', directive[2] ?? '', passage.name, lineNo, errors);
        return;
      }
      const choice = CHOICE_RE.exec(trimmed);
      if (choice !== null) { applyChoice(draft, choice[1] ?? '', passage.name, lineNo, errors); return; }
      if (LINK_RE.test(trimmed) && trimmed.replace(LINK_RE, '').trim().length === 0) {
        applyChoice(draft, trimmed, passage.name, lineNo, errors);
        return;
      }
      draft.textLines.push(line);
    });

    nodes[passage.name] = {
      id: passage.name,
      tags: passage.tags,
      speaker: draft.speaker,
      condition: draft.condition,
      text: parseText(draft.textLines.join('\n').trim()),
      entryActions: draft.entryActions,
      jumps: draft.jumps,
      choices: draft.choices,
    };
    if (startNodeId === null || passage.tags.includes('start')) {
      if (startNodeId === null || passage.tags.includes('start')) startNodeId = passage.name;
    }
  }

  for (const node of Object.values(nodes)) {
    const targets = [...node.choices.map((c) => c.target), ...node.jumps.map((j) => j.target)];
    for (const target of targets) {
      if (target !== DIALOGUE_END_NODE && !Object.hasOwn(nodes, target)) {
        errors.push({ line: 0, passage: node.id, message: `link points at unknown passage "${target}"` });
      }
    }
    if (node.choices.length === 0 && node.jumps.length === 0 && node.id !== DIALOGUE_END_NODE) {
      warnings.push({ line: 0, passage: node.id, message: 'node has no choices and no jumps — dialogue ends here' });
    }
  }

  if (startNodeId === null) errors.push({ line: 0, passage: null, message: 'no passages found' });

  const reachable = new Set<string>();
  if (startNodeId !== null) {
    const queue = [startNodeId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (reachable.has(id) || !Object.hasOwn(nodes, id)) continue;
      reachable.add(id);
      const node = nodes[id]!;
      for (const t of [...node.choices.map((c) => c.target), ...node.jumps.map((j) => j.target)]) queue.push(t);
    }
    for (const id of Object.keys(nodes)) {
      if (!reachable.has(id)) warnings.push({ line: 0, passage: id, message: 'passage is unreachable from the start node' });
    }
  }

  const npcIds = [...new Set(Object.values(nodes).flatMap((n) => (n.speaker === null ? [] : [n.speaker.npcId])))].sort();
  const stats = {
    nodes: Object.keys(nodes).length,
    choices: Object.values(nodes).reduce((sum, n) => sum + n.choices.length, 0),
    actions: Object.values(nodes).reduce((sum, n) => sum + n.entryActions.length, 0),
    conditions: Object.values(nodes).reduce(
      (sum, n) => sum + (n.condition === null ? 0 : 1) + n.choices.filter((c) => c.condition !== null).length
        + n.jumps.filter((j) => j.condition !== null).length, 0),
    jumps: Object.values(nodes).reduce((sum, n) => sum + n.jumps.length, 0),
    speakers: npcIds.length,
  };

  const definition: DialogueDefinition | null = errors.length > 0 || startNodeId === null ? null : {
    schemaVersion: DIALOGUE_SCHEMA_VERSION,
    dialogueId: options.dialogueId,
    title,
    startNodeId,
    npcIds,
    nodes,
  };

  return { definition, errors, warnings, stats };
}
