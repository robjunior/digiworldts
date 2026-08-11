/**
 * Battle simulator — Rookie L40 mirrored template, statBonus is the only
 * variable. Answers: how much does full training dominate zero training?
 *
 * Fixed template both sides:
 *   Rookie, Vaccine, fire, base stats { hp:500, en:30, atk:100, def:80, int:90, spd:100 }
 *   4-skill pool: Basic (power 20, 0 EN), Ember (fire 210, 12 EN),
 *                 Slash (null 140, 8 EN), Overheat (fire 320, 20 EN)
 *
 * statBonus shapes:
 *   untrained   → all zeros
 *   trained     → hp+900 en+70 atk+30 def+30 int+40 spd+30
 *                 (saturates STAGE_COMBAT_POOL=500 with base+bonus=500 combat
 *                  and STAGE_HPEN_POOL=1500 with base+bonus=1500 hp+en)
 *
 * AI: strongest affordable skill on the first-alive enemy unit. Deterministic
 * given the RNG stream — variance/crit/miss come from Math.random which we
 * leave unstubbed for realistic variance.
 *
 * Runs `RUNS` (default 1000) battles per matchup. Reports win rate + avg
 * turns to KO + avg total damage dealt.
 *
 * Run: pnpm --filter @digiworld/backend test:battle-sim
 *   (or:  RUNS=5000 pnpm --filter @digiworld/backend test:battle-sim)
 */
import { initBattle, applyAction } from '../src/battle/engine.ts';
import type { Loadout, LoadoutMember } from '../src/battle/engine.ts';
import type { BaseStats, Skill, Stage, TemplateDigimon } from '../src/digimon/types.ts';
import type { Element } from '@digiworld/shared/digimon';
import type { Action, Battle, BattleSide } from '../src/battle/types.ts';
import { defaultStatsForStage } from '../src/digimon/element.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { seedSkillsCatalogV2 } from '../src/skills/seed-catalog.ts';
import { getDefaultEquippedForStage, resolveCatalogSkills } from '../src/skills/pool.ts';
import { affinity } from '../src/digimon/element.ts';

const RUNS = Number(process.env.RUNS ?? '1000');
const DAMAGE_RATE = Number(process.env.DAMAGE_RATE ?? '1.0');
const LEVEL = Number(process.env.LEVEL ?? '40');

const SKILL_POOL: Skill[] = [
  { id: 's0', name: 'Basic',    element: 'null', energyCost: 0,  power: 20  },
  { id: 's1', name: 'Slash',    element: 'null', energyCost: 8,  power: 140 },
  { id: 's2', name: 'Ember',    element: 'fire', energyCost: 12, power: 210 },
  { id: 's3', name: 'Overheat', element: 'fire', energyCost: 20, power: 320 },
];

function tmpl(id: string, element: Element = 'fire', stage: Stage = 'Rookie'): TemplateDigimon {
  return {
    id,
    name: id,
    stage,
    attribute: 'Vaccine',
    element,
    baseStats: stage === 'Rookie' && element === 'fire'
      ? { hp: 500, en: 30, atk: 100, def: 80, int: 90, spd: 100 }
      : defaultStatsForStage(stage),
    skillPool: SKILL_POOL,
    assets: { portrait: '', dot: '' },
  };
}

function mkLoadout(playerId: string, bonus: BaseStats): Loadout {
  return {
    playerId,
    members: [0, 1, 2].map((i): LoadoutMember => ({
      monId: `${playerId}-${i}`,
      templateId: `t-${playerId}-${i}`,
      template: tmpl(`t-${playerId}-${i}`),
      level: LEVEL,
      nickname: `${playerId}-${i}`,
      statBonus: bonus,
    })),
  };
}

function mkCatalogLoadout(playerId: string, bonus: BaseStats, skills: Skill[], element: Element = 'fire', stage: Stage = 'Rookie'): Loadout {
  return {
    playerId,
    members: [0, 1, 2].map((i): LoadoutMember => ({
      monId: `${playerId}-${i}`,
      templateId: `t-${playerId}-${i}`,
      template: tmpl(`t-${playerId}-${i}`, element, stage),
      level: LEVEL,
      nickname: `${playerId}-${i}`,
      statBonus: bonus,
      equippedSkills: skills,
    })),
  };
}

const UNTRAINED: BaseStats = { hp: 0,   en: 0,  atk: 0,  def: 0,  int: 0,  spd: 0  };
// Saturates the rebalanced STAGE_COMBAT_POOL=700 and STAGE_HPEN_POOL=1000:
//   Rookie combatSum base = 370 → +330 room = ~80 per stat
//   Rookie hpenSum base   = 530 → +470 room = 400 hp + 70 en
const TRAINED:   BaseStats = { hp: 400, en: 70, atk: 80, def: 80, int: 90, spd: 80 };

function isDamageSkill(skill: Skill): boolean {
  if (Array.isArray(skill.actions) && skill.actions.length > 0) {
    for (const raw of skill.actions) {
      const a = raw as { kind?: string };
      if (a?.kind === 'deal_damage' || a?.kind === 'drain') return true;
    }
    return false;
  }
  return skill.power > 0;
}

function pickAction(battle: Battle, side: BattleSide): Action | null {
  const active = battle.turnQueue[battle.turnCursor];
  if (active === undefined || active.side !== side) return null;
  const unit = battle.units.find((u) => u.id === active.unitId);
  if (unit === undefined || unit.hp <= 0) return null;

  const enemy = battle.units.find((u) => u.side !== side && u.hp > 0);
  if (enemy === undefined) return null;

  // A silenced unit cannot use skills — engine.ts::applyAction rejects the
  // action outright rather than degrading it, and the sim treats any rejection
  // as an aborted battle. A real player picks a basic attack instead; so does
  // this AI, otherwise every silence-heavy element reads as a false draw.
  if (unit.ailments.some((a) => a.kind === 'silence')) {
    return { type: 'fight', unitId: unit.id, targetId: enemy.id };
  }

  const affordable = unit.skills
    .filter((s) => s.energyCost > 0 && s.energyCost <= unit.en)
    .filter((s) => (unit.skillCooldowns?.[s.id] ?? 0) === 0);
  const damageSkills = affordable.filter(isDamageSkill).sort((a, b) => b.energyCost - a.energyCost);
  const fallback = affordable.sort((a, b) => b.energyCost - a.energyCost);
  const best = damageSkills[0] ?? fallback[0];
  if (best !== undefined) {
    return { type: 'skill', unitId: unit.id, skillId: best.id, targetId: enemy.id };
  }
  return { type: 'fight', unitId: unit.id, targetId: enemy.id };
}

type Result = {
  winner: BattleSide | 'draw';
  turns: number;
  rounds: number;
  dmgA: number;
  dmgB: number;
  aAlive: number;
  bAlive: number;
};

async function runOne(loadA: Loadout, loadB: Loadout, rate: number): Promise<Result> {
  const battle = await initBattle({ loadoutA: loadA, loadoutB: loadB, damageRate: rate });
  let turns = 0;
  const MAX_TURNS = 600;
  while (battle.status !== 'ended' && turns < MAX_TURNS) {
    const active = battle.turnQueue[battle.turnCursor];
    if (active === undefined) break;
    const action = pickAction(battle, active.side);
    if (action === null) break;
    const r = applyAction(battle, active.side, action);
    if (!r.ok) break;
    turns++;
  }
  let dmgA = 0;
  let dmgB = 0;
  for (const evt of battle.log) {
    if (evt.type === 'action' && evt.damage !== undefined && evt.actor !== null) {
      const actorSide = evt.actor.startsWith('a:') ? 'a' : 'b';
      if (actorSide === 'a') dmgA += evt.damage;
      else dmgB += evt.damage;
    } else if (evt.type === 'ailment-tick' && typeof evt.damage === 'number' && evt.damage > 0) {
      const targetSide = evt.unit.startsWith('a:') ? 'a' : 'b';
      if (targetSide === 'a') dmgB += evt.damage;
      else dmgA += evt.damage;
    }
  }
  return {
    winner: battle.winner ?? 'draw',
    turns,
    rounds: battle.round,
    dmgA,
    dmgB,
    aAlive: battle.units.filter((u) => u.side === 'a' && u.hp > 0).length,
    bAlive: battle.units.filter((u) => u.side === 'b' && u.hp > 0).length,
  };
}

type Agg = {
  wins: { a: number; b: number; draw: number };
  turns: number[];
  dmgA: number[];
  dmgB: number[];
  aAlive: number[];
  bAlive: number[];
};

function agg(): Agg {
  return { wins: { a: 0, b: 0, draw: 0 }, turns: [], dmgA: [], dmgB: [], aAlive: [], bAlive: [] };
}

function push(a: Agg, r: Result): void {
  a.wins[r.winner]++;
  a.turns.push(r.turns);
  a.dmgA.push(r.dmgA);
  a.dmgB.push(r.dmgB);
  a.aAlive.push(r.aAlive);
  a.bAlive.push(r.bAlive);
}

function mean(xs: number[]): number { return xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length); }
function pct(n: number, d: number): string { return `${((n / d) * 100).toFixed(1)}%`; }

function reportMatchup(label: string, a: Agg, aStats: BaseStats, bStats: BaseStats): void {
  console.log(`\n╔═ ${label} ══════════════════════════════════════════════════════════`);
  console.log(`║ Side A bonus: hp+${aStats.hp} atk+${aStats.atk} def+${aStats.def} int+${aStats.int} spd+${aStats.spd} en+${aStats.en}`);
  console.log(`║ Side B bonus: hp+${bStats.hp} atk+${bStats.atk} def+${bStats.def} int+${bStats.int} spd+${bStats.spd} en+${bStats.en}`);
  console.log(`║ ─────────────────────────────────────────────────────────────`);
  console.log(`║ Win rate    A: ${pct(a.wins.a, RUNS).padStart(6)}   B: ${pct(a.wins.b, RUNS).padStart(6)}   draws: ${pct(a.wins.draw, RUNS).padStart(6)}`);
  console.log(`║ Avg turns   ${mean(a.turns).toFixed(1).padStart(6)}   (rounds ≈ ${(mean(a.turns) / 6).toFixed(1)})`);
  console.log(`║ Avg dmg dealt   A→B: ${Math.round(mean(a.dmgA)).toString().padStart(6)}   B→A: ${Math.round(mean(a.dmgB)).toString().padStart(6)}`);
  console.log(`║ Avg survivors   A: ${mean(a.aAlive).toFixed(2)} / 3   B: ${mean(a.bAlive).toFixed(2)} / 3`);
  console.log(`╚════════════════════════════════════════════════════════════════`);
}

function scaledStats(base: BaseStats, level: number, bonus: BaseStats): BaseStats {
  const factor = 1 + 0.06 * (level - 1);
  return {
    hp: Math.floor(base.hp * factor) + bonus.hp,
    en: Math.floor(base.en * factor) + bonus.en,
    atk: Math.floor(base.atk * factor) + bonus.atk,
    def: Math.floor(base.def * factor) + bonus.def,
    int: Math.floor(base.int * factor) + bonus.int,
    spd: Math.floor(base.spd * factor) + bonus.spd,
  };
}

async function main(): Promise<void> {
  const t = tmpl('sample');
  const untr = scaledStats(t.baseStats, LEVEL, UNTRAINED);
  const trnd = scaledStats(t.baseStats, LEVEL, TRAINED);

  console.log(`Battle simulation — Rookie L${LEVEL} mirrored templates, ${RUNS} battles per matchup, damageRate=${DAMAGE_RATE}`);
  console.log(`\nEffective per-unit stats (scaleForLevel + bonus):`);
  console.log(`  Untrained: hp=${untr.hp}  en=${untr.en}  atk=${untr.atk}  def=${untr.def}  int=${untr.int}  spd=${untr.spd}`);
  console.log(`  Trained:   hp=${trnd.hp}  en=${trnd.en}  atk=${trnd.atk}  def=${trnd.def}  int=${trnd.int}  spd=${trnd.spd}`);
  console.log(`  Deltas:    hp +${((trnd.hp / untr.hp - 1) * 100).toFixed(0)}%  atk +${((trnd.atk / untr.atk - 1) * 100).toFixed(0)}%  def +${((trnd.def / untr.def - 1) * 100).toFixed(0)}%  int +${((trnd.int / untr.int - 1) * 100).toFixed(0)}%  spd +${((trnd.spd / untr.spd - 1) * 100).toFixed(0)}%`);

  const scenarios: Array<{ label: string; a: BaseStats; b: BaseStats }> = [
    { label: 'Untrained vs Untrained (baseline)', a: UNTRAINED, b: UNTRAINED },
    { label: 'Trained   vs Untrained',            a: TRAINED,   b: UNTRAINED },
    { label: 'Untrained vs Trained (mirror)',     a: UNTRAINED, b: TRAINED   },
    { label: 'Trained   vs Trained (control)',    a: TRAINED,   b: TRAINED   },
  ];

  for (const s of scenarios) {
    const loadA = mkLoadout('a', s.a);
    const loadB = mkLoadout('b', s.b);
    const a = agg();
    for (let i = 0; i < RUNS; i++) push(a, await runOne(loadA, loadB, DAMAGE_RATE));
    reportMatchup(s.label, a, s.a, s.b);
  }

  if (process.env.DB_PATH) {
    await getDb();
    const seed = await seedSkillsCatalogV2();
    if (seed.validationErrors.length > 0) {
      console.error(`FAIL: seed had ${seed.validationErrors.length} validation errors`);
      process.exit(1);
    }
    const fireRookieIds = ['sk-fire-pa-r', 'sk-fire-sd-r', 'sk-fire-ct-r', 'sk-fire-bs-r'];
    const catalogSkills = await resolveCatalogSkills(fireRookieIds);
    console.log(`\n══════════════════════════════════════════════════════════════════`);
    console.log(`  CATALOG SKILL MATCHUPS (P5 Day 7 — DSL runtime dispatch)`);
    console.log(`  Skills: ${catalogSkills.map((s) => `${s.name}(EN${s.energyCost}${s.cooldown ? ',CD' + s.cooldown : ''})`).join(', ')}`);
    console.log(`══════════════════════════════════════════════════════════════════`);
    for (const s of scenarios) {
      const loadA = mkCatalogLoadout('a', s.a, catalogSkills);
      const loadB = mkCatalogLoadout('b', s.b, catalogSkills);
      const a = agg();
      for (let i = 0; i < RUNS; i++) push(a, await runOne(loadA, loadB, DAMAGE_RATE));
      reportMatchup(`[catalog] ${s.label}`, a, s.a, s.b);
    }

    console.log(`\n══════════════════════════════════════════════════════════════════`);
    console.log(`  MATRIX: 11 elements × 4 stages, Trained-vs-Trained mirror (${RUNS} battles each)`);
    console.log(`  Uses getDefaultEquippedForStage — the P4d default equip per stage.`);
    console.log(`══════════════════════════════════════════════════════════════════`);
    const elements: Element[] = ['fire', 'water', 'plant', 'ice', 'electricity', 'earth', 'steel', 'wind', 'light', 'dark', 'null'];
    const stages: Stage[] = ['Rookie', 'Champion', 'Ultimate', 'Mega'];
    console.log(`\n  Element        ${stages.map((s) => s.padEnd(19)).join(' ')}`);
    console.log(`  ─────────────  ${stages.map(() => '─'.repeat(19)).join(' ')}`);
    for (const el of elements) {
      const row: string[] = [];
      for (const stage of stages) {
        const defaults = await getDefaultEquippedForStage(el, stage);
        if (defaults.length === 0) {
          row.push('(no skills)'.padEnd(19));
          continue;
        }
        const skills = await resolveCatalogSkills(defaults);
        const orderedSkills = defaults
          .map((id) => skills.find((s) => s.id === id))
          .filter((s): s is Skill => Boolean(s));
        const loadA = mkCatalogLoadout('a', TRAINED, orderedSkills, el, stage);
        const loadB = mkCatalogLoadout('b', TRAINED, orderedSkills, el, stage);
        const a = agg();
        for (let i = 0; i < RUNS; i++) push(a, await runOne(loadA, loadB, DAMAGE_RATE));
        const winA = ((a.wins.a / RUNS) * 100).toFixed(0);
        const winB = ((a.wins.b / RUNS) * 100).toFixed(0);
        const draws = ((a.wins.draw / RUNS) * 100).toFixed(0);
        row.push(`${winA}/${winB}/${draws}%  ${Math.round(mean(a.turns)).toString().padStart(3)}t`.padEnd(19));
      }
      console.log(`  ${el.padEnd(13)}  ${row.join(' ')}`);
    }
    console.log(`\n  Format: A/B/draws % — turns to resolve`);
    console.log(`  Perfect balance: 50/50/0 (mirror match). Draws should be low (<5%) for a well-resolved matchup.`);
    console.log(`  Turns much lower than 600 (cap) means battles conclude cleanly.\n`);

    // ─────────────────────────────────────────────────────────────────────
    // Cross-element parity.
    //
    // The mirror matrix above validates each element against ITSELF. It cannot
    // see an element that is uniformly over- or under-tuned, because both
    // sides carry the same inflation and the split stays 50/50 — only the turn
    // count hints at it. Wind sat roughly 2.5x over the field's damage-per-
    // energy at Rookie for a long time while showing a clean mirror row; the
    // only visible symptom was a 17-turn Rookie against everyone else's 39-50.
    //
    // Affinity makes a naive "everyone should average 50%" wrong: an element
    // deals 1.5x to its WEAK target and 0.5x to its RESIST target, and the
    // graph is not symmetric — `null` has neither, `light` and `dark` have a
    // weakness to exploit but nothing they are resisted by. So the honest
    // power reading comes from NEUTRAL pairs only: matchups where neither side
    // has an affinity relation to the other. There, win rate is raw power.
    // ─────────────────────────────────────────────────────────────────────
    const CROSS_RUNS = Math.max(50, Math.floor(RUNS / 5));
    console.log(`══════════════════════════════════════════════════════════════════`);
    console.log(`  CROSS-ELEMENT PARITY (${CROSS_RUNS} battles per pair, Trained vs Trained)`);
    console.log(`  Neutral pairs only = no affinity either way = raw power comparison.`);
    console.log(`══════════════════════════════════════════════════════════════════`);

    const loadoutCache = new Map<string, Loadout>();
    async function loadoutFor(side: 'a' | 'b', el: Element, stage: Stage): Promise<Loadout | null> {
      const key = `${side}:${el}:${stage}`;
      const hit = loadoutCache.get(key);
      if (hit) return hit;
      const defaults = await getDefaultEquippedForStage(el, stage);
      if (defaults.length === 0) return null;
      const skills = await resolveCatalogSkills(defaults);
      const ordered = defaults.map((id) => skills.find((s) => s.id === id)).filter((s): s is Skill => Boolean(s));
      const lo = mkCatalogLoadout(side, TRAINED, ordered, el, stage);
      loadoutCache.set(key, lo);
      return lo;
    }

    for (const stage of stages) {
      const overall = new Map<Element, { w: number; n: number }>();
      const neutral = new Map<Element, { w: number; n: number }>();
      for (const el of elements) { overall.set(el, { w: 0, n: 0 }); neutral.set(el, { w: 0, n: 0 }); }

      for (let i = 0; i < elements.length; i++) {
        for (let j = i + 1; j < elements.length; j++) {
          const ea = elements[i]!;
          const eb = elements[j]!;
          const loadA = await loadoutFor('a', ea, stage);
          const loadB = await loadoutFor('b', eb, stage);
          if (!loadA || !loadB) continue;
          const agg1 = agg();
          for (let k = 0; k < CROSS_RUNS; k++) push(agg1, await runOne(loadA, loadB, DAMAGE_RATE));
          const isNeutral = affinity(ea, eb) === null && affinity(eb, ea) === null;
          const oa = overall.get(ea)!;
          const ob = overall.get(eb)!;
          oa.w += agg1.wins.a; oa.n += CROSS_RUNS;
          ob.w += agg1.wins.b; ob.n += CROSS_RUNS;
          if (isNeutral) {
            const na = neutral.get(ea)!;
            const nb = neutral.get(eb)!;
            na.w += agg1.wins.a; na.n += CROSS_RUNS;
            nb.w += agg1.wins.b; nb.n += CROSS_RUNS;
          }
        }
      }

      console.log(`\n  ── ${stage} ──`);
      console.log(`  ${'element'.padEnd(13)} ${'vs field'.padStart(9)} ${'neutral only'.padStart(13)}   power index`);
      const offenders: string[] = [];
      for (const el of elements) {
        const o = overall.get(el)!;
        const n = neutral.get(el)!;
        if (o.n === 0) continue;
        const oPct = (o.w / o.n) * 100;
        const nPct = n.n > 0 ? (n.w / n.n) * 100 : NaN;
        const flag = Number.isFinite(nPct) && (nPct < 45 || nPct > 55) ? '  <-- OUT OF BAND' : '';
        if (flag) offenders.push(`${el} ${nPct.toFixed(0)}%`);
        console.log(`  ${el.padEnd(13)} ${oPct.toFixed(0).padStart(8)}% ${(Number.isFinite(nPct) ? nPct.toFixed(0) : '—').padStart(12)}%${flag}`);
      }
      console.log(`  ${stage}: ${offenders.length === 0 ? 'every element inside 45-55% on neutral matchups' : 'out of band -> ' + offenders.join(', ')}`);
    }
    console.log(`\n  "vs field" includes affinity, so it is expected to deviate — light and dark`);
    console.log(`  have a weakness to exploit and nothing that resists them, null has neither.`);
    console.log(`  "neutral only" strips affinity out and is the number to judge power by.\n`);

    await closeDbAdapter();
  } else {
    console.log(`\n(Set DB_PATH env to also run catalog-skill matchups — e.g. DB_PATH=/tmp/dw-sim.db pnpm test:battle-sim)`);
  }
}

main().catch((err: unknown) => {
  console.error('FATAL:', err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
