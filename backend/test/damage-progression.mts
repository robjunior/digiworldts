/**
 * Guard for damage progression across evolution stages.
 *
 * This test exists because of a specific defect that every other check in the
 * repo was blind to.
 *
 * `test:battle-sim` measures elements against each other AT A MATCHED STAGE —
 * Rookie fights Rookie, Mega fights Mega. It never compares a stage to the one
 * below it. So an element can be perfectly balanced at all four tiers while its
 * damage numbers go DOWN as the player evolves, and the suite stays green.
 *
 * That is exactly what an automated cross-element balance sweep produced. All
 * 44 element/stage cells landed inside 46-53% on neutral matchups, every
 * structural test passed, `test:element-identity` passed — and electricity's
 * strongest Mega skill hit for 90 where its Rookie skill hit for 117. A player
 * evolving to the final tier would watch their damage fall by a quarter.
 *
 * The pressure that causes it is real, not a bug in the sweep: AoE-heavy
 * elements have to carry low per-hit damage to be balanced, because clearing a
 * line is worth far more than its target count. Balance and progression pull in
 * opposite directions, and with only a balance gate in place, progression is
 * what silently gives way.
 *
 * So this asserts the thing nobody had written down: numbers must get bigger as
 * you evolve.
 *
 *   1. Total damage output per stage strictly increases.
 *   2. Peak single-hit damage strictly increases — the headline number a player
 *      actually reads off a skill.
 *   3. Growth is meaningful, not epsilon: each stage clears the previous by at
 *      least MIN_GROWTH.
 *
 * The threshold is deliberately loose. This fires on inversion and stagnation,
 * not on tuning.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SEEDS = join(import.meta.dirname, '..', 'src', 'skills', 'seeds');
const STAGES = ['Rookie', 'Champion', 'Ultimate', 'Mega'] as const;
type Stage = (typeof STAGES)[number];

/** Each stage must exceed the previous by at least this factor. */
const MIN_GROWTH = 1.1;

/**
 * Known inversions, recorded rather than hidden.
 *
 * These are real defects. They are listed so the guard can protect everything
 * else while they are outstanding, and so the debt is enumerated instead of
 * living in someone's memory. The list may only SHRINK — the test fails if a
 * new inversion appears AND if a listed one is fixed without being removed
 * here, so it cannot quietly rot.
 *
 * Root cause, common to all of them: these are the AoE-heavy elements. Clearing
 * an enemy line is worth far more than its target count, so an element whose
 * `enemy_all` breadth grows with stage must carry ever-lower per-hit damage to
 * stay balanced. Balance and progression genuinely pull apart here, and no
 * amount of damage tuning resolves it — the fix is to stop AoE breadth growing
 * with tier, which changes what these elements are and is a design decision.
 *
 * The list has been revised once. Rebalancing under a simulator that actually
 * casts support skills REPAIRED six of the original eleven — electricity
 * Ultimate->Mega, light Rookie->Champion and nullelem Champion->Ultimate — because
 * elements no longer need their damage suppressed so hard to stay in band. It
 * introduced four others at the top of the light and nullelem curves. Net 11 -> 9.
 */
const KNOWN_INVERSIONS = new Set([
  'dark total Ultimate->Mega',
  'dark peak hit Ultimate->Mega',
  'electricity total Champion->Ultimate',
  'electricity peak hit Champion->Ultimate',
  'light peak hit Champion->Ultimate',
  'light total Ultimate->Mega',
  'nullelem total Ultimate->Mega',
  'nullelem peak hit Ultimate->Mega',
  'plant peak hit Ultimate->Mega',
]);

/** Damage at this notional stat value, so `factor` is weighted sensibly against `base`. */
const REF_STAT = 100;

let passed = 0;
let failed = 0;
const stillBroken = new Set<string>();

function check(label: string, ok: boolean, detail: string): void {
  const known = KNOWN_INVERSIONS.has(label);
  if (ok) {
    if (known) {
      failed += 1;
      console.log(`  FIXED ${label} — ${detail}`);
      console.log('        Remove it from KNOWN_INVERSIONS; the debt list may only shrink.');
      return;
    }
    passed += 1;
    return;
  }
  if (known) {
    stillBroken.add(label);
    return;
  }
  failed += 1;
  console.log(`  FAIL  ${label} — ${detail}`);
}

function poolFiles(): string[] {
  return readdirSync(SEEDS)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => !f.includes('-signatures'))
    .filter((f) => f !== 'index.ts' && f !== 'types.ts');
}

interface StageDamage {
  total: number;
  peak: number;
}

function readDamage(source: string): Record<Stage, StageDamage> {
  const out = Object.fromEntries(
    STAGES.map((s) => [s, { total: 0, peak: 0 }]),
  ) as Record<Stage, StageDamage>;

  // Split on the top-level factory calls; each chunk is one skill definition.
  for (const chunk of source.split(/\n {2}[a-z]+\(\{/).slice(1)) {
    const stageMatch = /stage: '(\w+)'/.exec(chunk);
    if (!stageMatch) continue;
    const stage = stageMatch[1] as Stage;
    if (!STAGES.includes(stage)) continue;

    const damage = /kind: 'deal_damage'[^}]*base: (\d+), scale: '\w+', factor: ([\d.]+)/g;
    for (const hit of chunk.matchAll(damage)) {
      const value = Number(hit[1]) + Number(hit[2]) * REF_STAT;
      out[stage].total += value;
      out[stage].peak = Math.max(out[stage].peak, value);
    }
  }
  return out;
}

console.log('Damage progression guard\n');

for (const file of poolFiles().sort()) {
  const element = file.replace(/\.ts$/, '');
  const damage = readDamage(readFileSync(join(SEEDS, file), 'utf8'));

  for (let i = 1; i < STAGES.length; i += 1) {
    const prev = STAGES[i - 1];
    const curr = STAGES[i];

    const prevTotal = damage[prev].total;
    const currTotal = damage[curr].total;
    check(
      `${element} total ${prev}->${curr}`,
      currTotal >= prevTotal * MIN_GROWTH,
      `${prevTotal.toFixed(0)} -> ${currTotal.toFixed(0)} ` +
        `(needs >= ${(prevTotal * MIN_GROWTH).toFixed(0)})`,
    );

    const prevPeak = damage[prev].peak;
    const currPeak = damage[curr].peak;
    check(
      `${element} peak hit ${prev}->${curr}`,
      currPeak >= prevPeak * MIN_GROWTH,
      `${prevPeak.toFixed(0)} -> ${currPeak.toFixed(0)} ` +
        `(needs >= ${(prevPeak * MIN_GROWTH).toFixed(0)})`,
    );
  }
}

console.log(
  `\n=== Summary: ${passed} passed, ${failed} failed, ` +
    `${stillBroken.size} known inversions outstanding ===`,
);
if (stillBroken.size > 0) {
  console.log('\nOutstanding (see KNOWN_INVERSIONS for why these are not yet fixable by tuning):');
  for (const label of [...stillBroken].sort()) console.log(`  - ${label}`);
}
if (failed > 0) process.exit(1);
