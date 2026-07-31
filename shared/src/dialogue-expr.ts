import type { DialogueAction, DialogueCondition, DialogueValueRef } from './dialogue.js';

type Token =
  | { readonly type: 'ident'; readonly value: string }
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'punct'; readonly value: string };

const PUNCT = ['(', ')', ',', '>=', '<=', '==', '!=', '>', '<'] as const;
const COMPARE_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);
const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false']);

export class DialogueExprError extends Error {}

function tokenize(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = source.indexOf(ch, i + 1);
      if (end === -1) throw new DialogueExprError(`unterminated string starting at ${i}`);
      out.push({ type: 'string', value: source.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(source[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < source.length && /[0-9.]/.test(source[j]!)) j += 1;
      const raw = source.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new DialogueExprError(`bad number "${raw}"`);
      out.push({ type: 'number', value });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_.$]/.test(source[j]!)) j += 1;
      out.push({ type: 'ident', value: source.slice(i, j) });
      i = j;
      continue;
    }
    const two = source.slice(i, i + 2);
    const matched = PUNCT.find((p) => p === two) ?? PUNCT.find((p) => p === ch);
    if (matched === undefined) throw new DialogueExprError(`unexpected character "${ch}"`);
    out.push({ type: 'punct', value: matched });
    i += matched.length;
  }
  return out;
}

class Cursor {
  private index = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  peek(): Token | null {
    return this.tokens[this.index] ?? null;
  }

  next(): Token {
    const token = this.tokens[this.index];
    if (token === undefined) throw new DialogueExprError('unexpected end of expression');
    this.index += 1;
    return token;
  }

  eatPunct(value: string): boolean {
    const token = this.peek();
    if (token !== null && token.type === 'punct' && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  expectPunct(value: string): void {
    if (!this.eatPunct(value)) throw new DialogueExprError(`expected "${value}"`);
  }

  eatKeyword(word: string): boolean {
    const token = this.peek();
    if (token !== null && token.type === 'ident' && token.value.toLowerCase() === word) {
      this.index += 1;
      return true;
    }
    return false;
  }

  atEnd(): boolean {
    return this.index >= this.tokens.length;
  }
}

function toValue(token: Token): DialogueValueRef {
  if (token.type === 'string') return { kind: 'literal', value: token.value };
  if (token.type === 'number') return { kind: 'literal', value: token.value };
  if (token.type === 'ident') {
    const lowered = token.value.toLowerCase();
    if (lowered === 'true') return { kind: 'literal', value: true };
    if (lowered === 'false') return { kind: 'literal', value: false };
    if (token.value.startsWith('$')) return { kind: 'variable', name: token.value.slice(1) };
    return { kind: 'fact', name: token.value };
  }
  throw new DialogueExprError(`expected a value, got "${token.value}"`);
}

function parseArgs(cursor: Cursor): DialogueValueRef[] {
  const args: DialogueValueRef[] = [];
  cursor.expectPunct('(');
  if (cursor.eatPunct(')')) return args;
  for (;;) {
    args.push(toValue(cursor.next()));
    if (cursor.eatPunct(')')) return args;
    cursor.expectPunct(',');
  }
}

function parsePrimary(cursor: Cursor): DialogueCondition {
  if (cursor.eatPunct('(')) {
    const inner = parseOr(cursor);
    cursor.expectPunct(')');
    return inner;
  }
  const token = cursor.next();
  const ahead = cursor.peek();

  if (token.type === 'ident' && !KEYWORDS.has(token.value.toLowerCase())
      && ahead !== null && ahead.type === 'punct' && ahead.value === '(') {
    return { kind: 'predicate', name: token.value, args: parseArgs(cursor) };
  }

  const left = toValue(token);
  const op = cursor.peek();
  if (op !== null && op.type === 'punct' && COMPARE_OPS.has(op.value)) {
    cursor.next();
    const right = toValue(cursor.next());
    return { kind: 'compare', left, op: op.value as '==' | '!=' | '<' | '<=' | '>' | '>=', right };
  }
  throw new DialogueExprError(`"${token.value}" is not a condition — use a predicate call or a comparison`);
}

function parseUnary(cursor: Cursor): DialogueCondition {
  if (cursor.eatKeyword('not')) return { kind: 'not', of: parseUnary(cursor) };
  return parsePrimary(cursor);
}

function parseAnd(cursor: Cursor): DialogueCondition {
  const parts = [parseUnary(cursor)];
  while (cursor.eatKeyword('and')) parts.push(parseUnary(cursor));
  return parts.length === 1 ? parts[0]! : { kind: 'all', of: parts };
}

function parseOr(cursor: Cursor): DialogueCondition {
  const parts = [parseAnd(cursor)];
  while (cursor.eatKeyword('or')) parts.push(parseAnd(cursor));
  return parts.length === 1 ? parts[0]! : { kind: 'any', of: parts };
}

export function parseCondition(source: string): DialogueCondition {
  const cursor = new Cursor(tokenize(source));
  const condition = parseOr(cursor);
  if (!cursor.atEnd()) throw new DialogueExprError('trailing tokens after condition');
  return condition;
}

export function parseAction(source: string, id: string): DialogueAction {
  const cursor = new Cursor(tokenize(source));
  const head = cursor.next();
  if (head.type !== 'ident') throw new DialogueExprError('action must start with a name');
  const args = cursor.peek() === null ? [] : parseArgs(cursor);
  if (!cursor.atEnd()) throw new DialogueExprError('trailing tokens after action');
  return { id, name: head.value, args };
}
