/**
 * Guard for the `shift_initiative` sign convention.
 *
 * `engine.ts::shiftInitiative` adds `delta` to the unit's index in
 * `battle.turnQueue`. A LOWER index acts SOONER, so:
 *
 *   negative delta -> the unit acts sooner  (a boon)
 *   positive delta -> the unit acts later   (a penalty)
 *
 * The intuitive reading is the opposite — "negative pushes them back" — and
 * every authoring pass so far has fallen for it. At the time this guard was
 * written, 19 of 33 uses across the seed files had the sign backwards, which
 * meant skills that advertised delaying an enemy were actually handing them an
 * earlier turn.
 *
 * Invariant: enemy-facing targets take a positive delta, self/ally targets
 * take a negative one. If a skill ever legitimately needs to delay its own
 * caster as a drawback, add it to ALLOWED_EXCEPTIONS with a comment.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SEEDS_DIR = new URL('../src/skills/seeds/', import.meta.url).pathname;
const ALLOWED_EXCEPTIONS: ReadonlySet<string> = new Set();

const USE = /kind: 'shift_initiative', target: '([a-z_0-9]+)', delta: (-?\d+)/g;
const NAME = /\n {4}name: '((?:[^'\\]|\\.)*)'/;

let checked = 0;
const violations: string[] = [];

for (const file of readdirSync(SEEDS_DIR).filter((f) => f.endsWith('.ts'))) {
  const src = readFileSync(join(SEEDS_DIR, file), 'utf8');
  for (const block of src.split(/\n {2}[a-z]+\(\{/).slice(1)) {
    const name = NAME.exec(block)?.[1] ?? '(unnamed)';
    for (const [, target, raw] of block.matchAll(USE)) {
      const delta = Number(raw);
      const isEnemy = target!.startsWith('enemy') || target === 'primary_target';
      checked += 1;
      if (ALLOWED_EXCEPTIONS.has(`${file}:${name}`)) continue;
      if (isEnemy && delta < 0) {
        violations.push(`${file} — ${name}: target '${target}' with delta ${delta} makes the ENEMY act sooner. Use a positive delta to delay them.`);
      } else if (!isEnemy && delta > 0) {
        violations.push(`${file} — ${name}: target '${target}' with delta ${delta} makes the CASTER/ALLY act later. Use a negative delta to advance them.`);
      }
    }
  }
}

console.log(`=== shift_initiative sign convention ===`);
console.log(`  checked ${checked} uses across the seed files`);
for (const v of violations) console.error(`  FAIL: ${v}`);
if (violations.length > 0) {
  console.error(`\n=== ${violations.length} violation(s) ===`);
  process.exit(1);
}
console.log(`  PASS: every use matches the convention\n`);
