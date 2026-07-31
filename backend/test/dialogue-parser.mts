import { strictEqual, deepStrictEqual, ok } from 'node:assert';

import { parseTwee } from '../../shared/src/dialogue-parser.ts';
import { parseCondition } from '../../shared/src/dialogue-expr.ts';
import type { DialogueDefinition } from '../../shared/src/dialogue.ts';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    process.stderr.write(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

const SAMPLE = `:: StoryTitle
Elder of the Forest

:: elder/start [start]
@speaker elder neutral
@if not flag_enabled("dialogue.elder.met")
@do set_flag("dialogue.elder.met")

Welcome, {player_name}. The forest remembers your footsteps.

@goto [[elder/relic]] if player_has_item("ancient_relic", 1)

* [[Who are you?->elder/who]] #ask_who
* [[Ask about the shrine->elder/shrine]] #ask_shrine {if: level >= 3}
* [[Leave->END]] #leave

:: elder/who
@speaker elder neutral

I am the one who waited.

* [[Back->elder/start]]

:: elder/shrine
@speaker elder concerned

The door opens only for those carrying proof of the old pact.

* [[I will look for it.->END]]

:: elder/relic
@speaker elder surprised
@do remove_item("ancient_relic", 1)
@do give_item("shrine_key", 1)
@do start_quest("open_the_shrine")

You carried it all this way?

[[END]]
`;

const parsed = parseTwee(SAMPLE, { dialogueId: 'elder' });

test('sample parses without errors', () => {
  deepStrictEqual(parsed.errors, []);
  ok(parsed.definition !== null, 'definition should be produced');
});

const def = parsed.definition as DialogueDefinition;

test('StoryTitle becomes the title, StoryTitle is not a node', () => {
  strictEqual(def.title, 'Elder of the Forest');
  strictEqual(Object.hasOwn(def.nodes, 'StoryTitle'), false);
});

test('the [start] tag selects the start node', () => {
  strictEqual(def.startNodeId, 'elder/start');
});

test('speaker directive is parsed with expression', () => {
  deepStrictEqual(def.nodes['elder/start']?.speaker, { npcId: 'elder', expression: 'neutral' });
  deepStrictEqual(def.nodes['elder/relic']?.speaker, { npcId: 'elder', expression: 'surprised' });
});

test('text interpolation splits into parts', () => {
  const text = def.nodes['elder/start']?.text ?? [];
  deepStrictEqual(text[0], { kind: 'text', value: 'Welcome, ' });
  deepStrictEqual(text[1], { kind: 'variable', name: 'player_name' });
  ok((text[2] as { value: string }).value.startsWith('. The forest remembers'));
});

test('@if produces a negated predicate on the node', () => {
  deepStrictEqual(def.nodes['elder/start']?.condition, {
    kind: 'not',
    of: { kind: 'predicate', name: 'flag_enabled', args: [{ kind: 'literal', value: 'dialogue.elder.met' }] },
  });
});

test('@do collects entry actions in order with stable ids', () => {
  const actions = def.nodes['elder/relic']?.entryActions ?? [];
  strictEqual(actions.length, 3);
  strictEqual(actions[0]?.name, 'remove_item');
  strictEqual(actions[1]?.name, 'give_item');
  strictEqual(actions[2]?.name, 'start_quest');
  strictEqual(actions[0]?.id, 'elder/relic#a0');
  deepStrictEqual(actions[1]?.args, [{ kind: 'literal', value: 'shrine_key' }, { kind: 'literal', value: 1 }]);
});

test('@goto becomes a conditional jump', () => {
  const jumps = def.nodes['elder/start']?.jumps ?? [];
  strictEqual(jumps.length, 1);
  strictEqual(jumps[0]?.target, 'elder/relic');
  deepStrictEqual(jumps[0]?.condition, {
    kind: 'predicate',
    name: 'player_has_item',
    args: [{ kind: 'literal', value: 'ancient_relic' }, { kind: 'literal', value: 1 }],
  });
});

test('choices keep label, target, explicit id and optional condition', () => {
  const choices = def.nodes['elder/start']?.choices ?? [];
  strictEqual(choices.length, 3);
  deepStrictEqual(choices[0], { id: 'ask_who', label: 'Who are you?', target: 'elder/who', condition: null });
  strictEqual(choices[1]?.id, 'ask_shrine');
  deepStrictEqual(choices[1]?.condition, {
    kind: 'compare',
    left: { kind: 'fact', name: 'level' },
    op: '>=',
    right: { kind: 'literal', value: 3 },
  });
  strictEqual(choices[2]?.target, 'END');
});

test('a bare [[Link]] on its own line becomes a choice', () => {
  const choices = def.nodes['elder/relic']?.choices ?? [];
  strictEqual(choices.length, 1);
  strictEqual(choices[0]?.target, 'END');
});

test('npcIds are collected and deduped', () => {
  deepStrictEqual(def.npcIds, ['elder']);
});

test('stats count the graph', () => {
  strictEqual(parsed.stats.nodes, 4);
  strictEqual(parsed.stats.choices, 6);
  strictEqual(parsed.stats.actions, 4);
  strictEqual(parsed.stats.jumps, 1);
  strictEqual(parsed.stats.speakers, 1);
});

test('a link to an unknown passage is an error, not a crash', () => {
  const result = parseTwee(':: a\n* [[go->nowhere]]\n', { dialogueId: 'x' });
  strictEqual(result.definition, null);
  ok(result.errors.some((e) => e.message.includes('nowhere')), 'should name the missing passage');
});

test('an unknown directive is an error', () => {
  const result = parseTwee(':: a\n@bogus stuff\n[[END]]\n', { dialogueId: 'x' });
  strictEqual(result.definition, null);
  ok(result.errors.some((e) => e.message.includes('@bogus')));
});

test('a malformed condition is reported with the passage name', () => {
  const result = parseTwee(':: a\n@if level >>\n[[END]]\n', { dialogueId: 'x' });
  strictEqual(result.definition, null);
  strictEqual(result.errors[0]?.passage, 'a');
});

test('duplicate passage names are rejected', () => {
  const result = parseTwee(':: a\n[[END]]\n\n:: a\n[[END]]\n', { dialogueId: 'x' });
  ok(result.errors.some((e) => e.message === 'duplicate passage name'));
});

test('empty source produces an error instead of an empty definition', () => {
  const result = parseTwee('', { dialogueId: 'x' });
  strictEqual(result.definition, null);
  ok(result.errors.some((e) => e.message === 'no passages found'));
});

test('unreachable passages warn but still parse', () => {
  const result = parseTwee(':: a [start]\n[[END]]\n\n:: orphan\n[[END]]\n', { dialogueId: 'x' });
  ok(result.definition !== null, 'unreachable is a warning, not an error');
  ok(result.warnings.some((w) => w.passage === 'orphan' && w.message.includes('unreachable')));
});

test('and/or/not compose without parentheses ambiguity', () => {
  deepStrictEqual(parseCondition('flag_enabled("a") and not flag_enabled("b")'), {
    kind: 'all',
    of: [
      { kind: 'predicate', name: 'flag_enabled', args: [{ kind: 'literal', value: 'a' }] },
      { kind: 'not', of: { kind: 'predicate', name: 'flag_enabled', args: [{ kind: 'literal', value: 'b' }] } },
    ],
  });
});

test('parentheses override precedence', () => {
  const cond = parseCondition('(flag_enabled("a") or flag_enabled("b")) and level >= 2');
  strictEqual(cond.kind, 'all');
});

test('$variables are distinguished from bare facts', () => {
  deepStrictEqual(parseCondition('$affection >= 10'), {
    kind: 'compare',
    left: { kind: 'variable', name: 'affection' },
    op: '>=',
    right: { kind: 'literal', value: 10 },
  });
});

test('a dialogue carrying actions or conditions demands the server cursor', () => {
  strictEqual(def.requiresServerAdvance, true);
  strictEqual(def.schemaVersion, 2);
});

test('a pure-text dialogue stays on the client tier', () => {
  const plain = parseTwee(`:: StoryTitle
Plain Intro

:: start
@speaker guide neutral

Nothing here mutates state.

* [[Understood->END]]
`, { dialogueId: 'plain' });
  strictEqual(plain.definition?.requiresServerAdvance, false);
  strictEqual(plain.stats.actions, 0);
  strictEqual(plain.stats.conditions, 0);
});

test('a lone gated choice is enough to demand the server cursor', () => {
  const gated = parseTwee(`:: StoryTitle
Gated

:: start
@speaker guide neutral

Pick one.

* [[Locked->END]] {if: level >= 3}
`, { dialogueId: 'gated' });
  strictEqual(gated.stats.actions, 0);
  strictEqual(gated.definition?.requiresServerAdvance, true);
});

process.stdout.write(`dialogue parser tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
