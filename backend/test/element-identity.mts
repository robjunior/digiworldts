/**
 * Guard for element identity in the skill pools.
 *
 * This test exists because of a specific near-miss. A balance pass asked to
 * bring cross-element win rates into range came back with perfect numbers —
 * every element inside 46-54% on neutral matchups, a flawless mirror matrix —
 * by rewriting all 396 pool skills into the SAME single `deal_damage` action
 * with identical values across every element. Parity achieved by deleting the
 * game.
 *
 * Every structural check in place at the time passed: 36 entries per file, the
 * right `tier_2` counts, all 27 `upgrade_of` links, typecheck clean, the seeder
 * inserting 1264 rows without a validation error. The boxes were all there and
 * all empty. The only thing that caught it was noticing that the mirror turn
 * counts had become identical across eleven elements.
 *
 * So this asserts the things that were only ever written in prose:
 *
 *   1. Mechanical variety — an element may not collapse into one action kind.
 *   2. Identity — each element must actually use the verbs its archetypes are
 *      built on. `light` heals, `dark` drains, `null` denies resources.
 *   3. Distinctness — two elements may not share a damage curve. Homogenisation
 *      is the failure mode this whole file is named after.
 *
 * Thresholds are set well below current values so ordinary tuning does not trip
 * them; they fire on collapse, not on drift.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SEEDS_DIR = new URL('../src/skills/seeds/', import.meta.url).pathname;

const POOL_FILES: ReadonlyArray<{ element: string; file: string }> = [
  { element: 'fire', file: 'fire.ts' },
  { element: 'water', file: 'water.ts' },
  { element: 'plant', file: 'plant.ts' },
  { element: 'ice', file: 'ice.ts' },
  { element: 'electricity', file: 'electricity.ts' },
  { element: 'earth', file: 'earth.ts' },
  { element: 'steel', file: 'steel.ts' },
  { element: 'wind', file: 'wind.ts' },
  { element: 'light', file: 'light.ts' },
  { element: 'dark', file: 'dark.ts' },
  { element: 'null', file: 'nullelem.ts' },
];

/**
 * The verbs each element's archetypes are built on, with a floor well under the
 * current count. `light` currently heals 14 times and must never drop below 4;
 * `null` denies energy 10 times and must never drop below 3.
 */
const IDENTITY: Readonly<Record<string, ReadonlyArray<{ kind: string; min: number }>>> = {
  fire: [{ kind: 'conditional', min: 4 }],
  water: [{ kind: 'heal', min: 3 }, { kind: 'shift_initiative', min: 3 }],
  plant: [{ kind: 'heal', min: 3 }, { kind: 'cleanse', min: 1 }],
  ice: [{ kind: 'shift_initiative', min: 3 }, { kind: 'modify_stat', min: 4 }],
  electricity: [{ kind: 'shift_initiative', min: 4 }],
  earth: [{ kind: 'apply_buff', min: 6 }, { kind: 'cleanse', min: 1 }],
  steel: [{ kind: 'apply_buff', min: 6 }, { kind: 'dispel', min: 1 }],
  wind: [{ kind: 'shift_initiative', min: 6 }],
  light: [{ kind: 'heal', min: 4 }, { kind: 'cleanse', min: 2 }, { kind: 'dispel', min: 2 }],
  dark: [{ kind: 'drain', min: 4 }, { kind: 'dispel', min: 1 }],
  null: [{ kind: 'consume_en', min: 3 }, { kind: 'conditional', min: 4 }],
};

const MIN_DISTINCT_KINDS = 6;
const MAX_BARE_DAMAGE_SHARE = 0.5;
const STAGES = ['Rookie', 'Champion', 'Ultimate', 'Mega'] as const;

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; return; }
  failures.push(`${name}${detail ? ' — ' + detail : ''}`);
}

type Parsed = {
  element: string;
  kinds: Set<string>;
  kindCounts: Map<string, number>;
  bareDamage: number;
  total: number;
  curve: number[];
};

function parse(element: string, file: string): Parsed {
  const src = readFileSync(join(SEEDS_DIR, file), 'utf8');
  const blocks = src.split(/\n {2}[a-z]+\(\{/).slice(1);
  const kindCounts = new Map<string, number>();
  let bareDamage = 0;
  const peak = new Map<string, number>(STAGES.map((s) => [s, 0]));

  for (const block of blocks) {
    const kinds = [...block.matchAll(/kind: '(\w+)'/g)].map((m) => m[1]!);
    for (const k of kinds) kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);
    const unique = new Set(kinds);
    if (unique.size === 1 && unique.has('deal_damage')) bareDamage += 1;

    const stage = /stage: '(\w+)'/.exec(block)?.[1];
    if (stage === undefined || !peak.has(stage)) continue;
    for (const m of block.matchAll(/kind: 'deal_damage'[^}]*base: (\d+), scale: '\w+', factor: ([\d.]+)/g)) {
      // Normalised at int=100 so curves are comparable between elements.
      peak.set(stage, Math.max(peak.get(stage)!, Number(m[1]) + Number(m[2]) * 100));
    }
  }

  return {
    element,
    kinds: new Set(kindCounts.keys()),
    kindCounts,
    bareDamage,
    total: blocks.length,
    curve: STAGES.map((s) => peak.get(s)!),
  };
}

const parsed = POOL_FILES.map(({ element, file }) => parse(element, file));

console.log('=== 1. Mechanical variety — no element collapses into one action ===');
for (const p of parsed) {
  check(
    `${p.element} uses at least ${MIN_DISTINCT_KINDS} distinct action kinds`,
    p.kinds.size >= MIN_DISTINCT_KINDS,
    `got ${p.kinds.size} (${[...p.kinds].sort().join(', ')})`,
  );
  const share = p.bareDamage / p.total;
  check(
    `${p.element} keeps bare deal_damage under ${(MAX_BARE_DAMAGE_SHARE * 100).toFixed(0)}% of its skills`,
    share <= MAX_BARE_DAMAGE_SHARE,
    `got ${p.bareDamage}/${p.total} (${(share * 100).toFixed(0)}%)`,
  );
}

console.log('=== 2. Identity — each element uses the verbs its archetypes are built on ===');
for (const p of parsed) {
  for (const { kind, min } of IDENTITY[p.element] ?? []) {
    const got = p.kindCounts.get(kind) ?? 0;
    check(`${p.element} uses '${kind}' at least ${min}x`, got >= min, `got ${got}`);
  }
}

console.log('=== 3. Distinctness — no two elements share a damage curve ===');
for (let i = 0; i < parsed.length; i += 1) {
  for (let j = i + 1; j < parsed.length; j += 1) {
    const a = parsed[i]!;
    const b = parsed[j]!;
    check(
      `${a.element} and ${b.element} have different damage curves`,
      a.curve.join('|') !== b.curve.join('|'),
      `both ${JSON.stringify(a.curve)}`,
    );
  }
}

console.log(`\n=== Summary: ${passed} passed, ${failures.length} failed ===`);
for (const f of failures) console.error(`  FAIL: ${f}`);
if (failures.length > 0) process.exit(1);
