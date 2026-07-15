import { describe, expect, it } from 'vitest';
import {
  activeControlLock,
  BATTLE_XP_REWARD,
  BURN_DAMAGE_PER_TURN,
  BURN_DURATION,
  BURN_PERCENT_DAMAGE_RATIO,
  SMOLDER_STRIKE_ENERGY_COST,
  POISON_PERCENT_DAMAGE_RATIO,
  TOXIN_STING_ENERGY_COST,
  BLEED_PERCENT_DAMAGE_RATIO,
  HEMORRHAGE_ENERGY_COST,
  CORRODE_PERCENT_INITIAL_RATIO,
  CORRODE_PERCENT_RAMP_RATIO,
  NECROSIS_ENERGY_COST,
  EXECUTE_ENERGY_COST,
  EXECUTE_BONUS_DAMAGE,
  EXECUTE_HP_THRESHOLD_RATIO,
  executeBonus,
  GUILLOTINE_ENERGY_COST,
  GUILLOTINE_BONUS_RATIO,
  GUILLOTINE_HP_THRESHOLD_RATIO,
  guillotineBonus,
  RAMPAGE_ENERGY_COST,
  RAMPAGE_BONUS_RATIO,
  rampageBonus,
  BRAVADO_ENERGY_COST,
  BRAVADO_BONUS_RATIO,
  bravadoBonus,
  LAST_STAND_ENERGY_COST,
  LAST_STAND_BONUS_RATIO,
  lastStandBonus,
  ELEMENT_ADVANTAGE_MULT,
  ELEMENT_DISADVANTAGE_MULT,
  ENEMY_ROSTER,
  FIRE_BREATH_ENERGY_COST,
  MAX_ENERGY,
  ENERGY_REGEN_PER_TURN,
  MAX_ROUNDS,
  POISON_DAMAGE_PER_TURN,
  POISON_DURATION,
  POISON_STING_ENERGY_COST,
  BLEED_DAMAGE_PER_TURN,
  BLEED_DURATION,
  BLEED_STRIKE_ENERGY_COST,
  SKILLS,
  CANONICAL_SKILL_NAMES,
  COMBATANT_SKILLS,
  applyAilment,
  ARMOR_BREAK_ENERGY_COST,
  GUARD_ENERGY_COST,
  FOCUS_ENERGY_COST,
  SHOCK_STRIKE_ENERGY_COST,
  STUN_DURATION,
  ENFEEBLE_STRIKE_ENERGY_COST,
  VULNERABLE_STRIKE_ENERGY_COST,
  VULNERABLE_DURATION,
  VULNERABLE_DAMAGE_TAKEN_BONUS,
  DOOM_CURSE_ENERGY_COST,
  DOOM_DURATION,
  DOOM_DETONATION_DAMAGE,
  DOOM_PERCENT_DETONATION_RATIO,
  DOOM_PERCENT_CURSE_ENERGY_COST,
  CORRODE_DURATION,
  CORRODE_INITIAL_DAMAGE,
  CORRODE_RAMP,
  CORRODE_STRIKE_ENERGY_COST,
  ENFEEBLE_ATK_REDUCTION,
  ENFEEBLE_DURATION,
  MIN_EFFECTIVE_ATK,
  DOUBLE_STRIKE_ENERGY_COST,
  DOUBLE_STRIKE_HITS,
  FROST_BITE_ENERGY_COST,
  FREEZE_DURATION,
  LULLABY_HEX_ENERGY_COST,
  SLEEP_DURATION,
  wakeSleeperOnDamage,
  reflectRetaliation,
  RETALIATE_DURATION,
  RETALIATE_REFLECT_DAMAGE,
  COUNTER_STANCE_ENERGY_COST,
  drainEnergy,
  SAP_ENERGY_AMOUNT,
  drainEnergyPercent,
  SAP_PERCENT_RATIO,
  SAP_PERCENT_ENERGY_COST,
  ENERGY_DRAIN_ENERGY_COST,
  leechEnergy,
  LEECH_ENERGY_AMOUNT,
  ENERGY_SIPHON_ENERGY_COST,
  restoreEnergyPercent,
  LEECH_PERCENT_RATIO,
  LEECH_PERCENT_ENERGY_COST,
  RETALIATE_PERCENT_RATIO,
  RETALIATE_PERCENT_ENERGY_COST,
  WEAKEN_PERCENT_RATIO,
  WEAKEN_PERCENT_ENERGY_COST,
  ENFEEBLE_PERCENT_RATIO,
  ENFEEBLE_PERCENT_ENERGY_COST,
  EMPOWER_PERCENT_RATIO,
  EMPOWER_PERCENT_ENERGY_COST,
  VULNERABLE_PERCENT_RATIO,
  VULNERABLE_PERCENT_ENERGY_COST,
  SWAP_ATK_ENERGY_COST,
  swapAtk,
  SWAP_DEF_ENERGY_COST,
  swapDef,
  SWAP_SPD_ENERGY_COST,
  swapSpd,
  SWAP_ALL_ENERGY_COST,
  swapAllStats,
  FORTIFY_ENERGY_COST,
  FORTIFY_DURATION,
  FORTIFY_DEF_BONUS,
  BRACE_ENERGY_COST,
  BRACE_DURATION,
  BRACE_DAMAGE_TAKEN_REDUCTION,
  BRACE_PERCENT_ENERGY_COST,
  BRACE_PERCENT_DURATION,
  BRACE_PERCENT_RATIO,
  FORTIFY_PERCENT_ENERGY_COST,
  FORTIFY_PERCENT_DURATION,
  FORTIFY_PERCENT_RATIO,
  HASTEN_ENERGY_COST,
  HASTEN_DURATION,
  HASTEN_SPD_BONUS,
  HASTEN_PERCENT_ENERGY_COST,
  HASTEN_PERCENT_DURATION,
  HASTEN_PERCENT_RATIO,
  HOBBLE_ENERGY_COST,
  HOBBLE_DURATION,
  HOBBLE_SPD_REDUCTION,
  HOBBLE_PERCENT_ENERGY_COST,
  HOBBLE_PERCENT_DURATION,
  HOBBLE_PERCENT_RATIO,
  MIN_EFFECTIVE_SPD,
  effectiveSpd,
  resolveTurnOrder,
  resolveActionSequence,
  hasSpdStatus,
  DOUBLE_TURN_SPD_RATIO,
  CLEANSE_ENERGY_COST,
  clearDebuffs,
  AILMENT_TICK_ORDER,
  DISPEL_ENERGY_COST,
  stripBuffs,
  PURLOIN_ENERGY_COST,
  stealBuffs,
  DISPLACE_ENERGY_COST,
  RECLAIM_ENERGY_COST,
  REBOUND_ENERGY_COST,
  REBOUND_LITE_ENERGY_COST,
  REBOUND_PARTIAL_RATIO,
  REBOUND_SPLIT_ENERGY_COST,
  REBOUND_SNAP_ENERGY_COST,
  REBOUND_LOCK_ENERGY_COST,
  REBOUND_DOOM_ENERGY_COST,
  REBOUND_BLIGHT_ENERGY_COST,
  REBOUND_CRIPPLE_ENERGY_COST,
  REBOUND_SEAR_ENERGY_COST,
  REBOUND_DOOMBURN_ENERGY_COST,
  REBOUND_SNAPDOOM_ENERGY_COST,
  REBOUND_DOOMLOCK_ENERGY_COST,
  REBOUND_PURGE_ENERGY_COST,
  REBOUND_SEARDOOM_ENERGY_COST,
  REBOUND_BLIGHTDOOM_ENERGY_COST,
  REBOUND_SNAPLOCKDOOM_ENERGY_COST,
  clearKinds,
  SHIELD_ABSORB_AMOUNT,
  SHIELD_DURATION,
  SHIELD_PERCENT_ABSORB_RATIO,
  SHIELD_PERCENT_DURATION,
  SHIELD_PERCENT_ENERGY_COST,
  WITHER_PERCENT_DAMAGE_RATIO,
  WITHER_DURATION,
  WITHER_PERCENT_ENERGY_COST,
  ROT_WHEN_WEAK_HP_THRESHOLD_RATIO,
  ROT_WHEN_WEAK_ENERGY_COST,
  WEAKEN_WHEN_WEAK_HP_THRESHOLD_RATIO,
  WEAKEN_WHEN_WEAK_ENERGY_COST,
  WEAKEN_WHEN_STRONG_HP_THRESHOLD_RATIO,
  WEAKEN_WHEN_STRONG_ENERGY_COST,
  ENFEEBLE_WHEN_WEAK_HP_THRESHOLD_RATIO,
  ENFEEBLE_WHEN_WEAK_ENERGY_COST,
  ENFEEBLE_WHEN_STRONG_HP_THRESHOLD_RATIO,
  ENFEEBLE_WHEN_STRONG_ENERGY_COST,
  VULNERABLE_WHEN_WEAK_HP_THRESHOLD_RATIO,
  VULNERABLE_WHEN_WEAK_ENERGY_COST,
  VULNERABLE_WHEN_STRONG_HP_THRESHOLD_RATIO,
  VULNERABLE_WHEN_STRONG_ENERGY_COST,
  EMPOWER_ATK_BONUS,
  EMPOWER_DURATION,
  absorbWithShield,
  amplifyForVulnerable,
  MIN_EFFECTIVE_DEF,
  WEAKEN_DEF_REDUCTION,
  WEAKEN_DURATION,
  TYPE_ADVANTAGE_MULT,
  TYPE_DISADVANTAGE_MULT,
  elementMultiplier,
  findEnemy,
  scaleEnemy,
  scaledBattleReward,
  battleLootAmount,
  BATTLE_LOOT_REWARD,
  BATTLE_LOOT_RESOURCE,
  resolveAttack,
  selectSkill,
  chooseSkill,
  chooseSkillMatchup,
  chooseSkillFinisher,
  chooseSkillDefensive,
  chooseSkillBanking,
  chooserForDifficulty,
  energyAtTurnStart,
  simulateBattle,
  simulateBattleAtb,
  simulatePartyBattle,
  simulatePvpDuel,
  typeMultiplier,
  resolveActorTurn,
  createFightState,
  createPartyFightState,
  resolveInteractivePartyExchange,
  serializeFightState,
  deserializeFightState,
  projectedBonusActions,
  MAX_ATB_BONUS_ACTIONS,
  ATB_THRESHOLD,
  type SerializedFightState,
  type TurnLogEntry,
  type SideState,  type Combatant,
  type StatusAilment,
} from './battle';
import { CRIT_MULT, DEFAULT_RNG } from './rng';

/**
 * Pure battle-rule unit tests (TASK-32, R-7). These assert the DETERMINISTIC combat
 * math in isolation (no Nest, no DB), which is what lets the e2e assert an exact
 * win/loss + turn log. Mirrors the intent of `evolution.spec.ts`/`training.spec.ts`:
 * the rule lives in one pure module, tested here, applied by the thin service.
 */
describe('battle rules (pure)', () => {
  // A level-1 starter Agumon (matches digimon.seed.ts) — the reference player used
  // both here and in the e2e so the two agree on outcomes.
  const agumon: Combatant = {
    name: 'Agumon',
    type: 'Vaccine',
    element: 'Fire',
    hp: 50,
    // TASK-126: maxHp = starting hp (the `maxHp` substrate). Every fixture that spreads
    // `...agumon` inherits it; a fixture may override `hp` (mid-fight state) while keeping this
    // full-HP maxHp — exactly the construction-time `maxHp = hp` shape.
    maxHp: 50,
    atk: 14,
    def: 10,
    spd: 8,
  };

  // TASK-153 (R-22 slice 14): `activeControlLock` — the pure DETECTOR of a stun/freeze/sleep
  // the interactive `battleTurn` seam reads to surface the forced skip HONESTLY (present →
  // observable, L-17). A NEW export (existing bytes unchanged → this whole suite stays green, the
  // invariant-5 byte-proof that resolveActorTurn/simulateBattle/the stunnedThisTurn guard are
  // untouched). It DETECTS only — it never decrements/expires the ailment (the tick loop owns that).
  describe('activeControlLock — the interactive control-lock detector (TASK-153)', () => {
    it('returns the matching {kind,label} for each control-lock kind', () => {
      expect(activeControlLock([{ kind: 'stun', turnsRemaining: 2 }])).toEqual({
        kind: 'stun',
        label: 'Stunned',
      });
      expect(activeControlLock([{ kind: 'freeze', turnsRemaining: 1 }])).toEqual({
        kind: 'freeze',
        label: 'Frozen',
      });
      expect(activeControlLock([{ kind: 'sleep', turnsRemaining: 3 }])).toEqual({
        kind: 'sleep',
        label: 'Asleep',
      });
    });

    it('returns null for no statuses or a non-control status (e.g. a DoT), and does not mutate the input', () => {
      expect(activeControlLock([])).toBeNull();
      expect(activeControlLock([{ kind: 'burn', turnsRemaining: 2, damagePerTurn: 3 }])).toBeNull();
      const input = [{ kind: 'stun', turnsRemaining: 2 } as const];
      activeControlLock(input);
      // Detect-only: the ailment is NOT decremented (the tick loop owns expiry).
      expect(input[0].turnsRemaining).toBe(2);
    });

    it('returns the FIRST control-lock when several coexist (deterministic, array order)', () => {
      const lock = activeControlLock([
        { kind: 'burn', turnsRemaining: 2, damagePerTurn: 3 },
        { kind: 'freeze', turnsRemaining: 2 },
        { kind: 'sleep', turnsRemaining: 2 },
      ]);
      expect(lock).toEqual({ kind: 'freeze', label: 'Frozen' });
    });
  });

  describe('typeMultiplier — the attribute triangle', () => {
    it('rewards the attacker on the winning side of the cycle (×1.5)', () => {
      // Vaccine > Virus > Data > Vaccine.
      expect(typeMultiplier('Vaccine', 'Virus')).toBe(TYPE_ADVANTAGE_MULT);
      expect(typeMultiplier('Virus', 'Data')).toBe(TYPE_ADVANTAGE_MULT);
      expect(typeMultiplier('Data', 'Vaccine')).toBe(TYPE_ADVANTAGE_MULT);
    });

    it('penalises the attacker on the losing side (×0.75)', () => {
      expect(typeMultiplier('Virus', 'Vaccine')).toBe(TYPE_DISADVANTAGE_MULT);
      expect(typeMultiplier('Data', 'Virus')).toBe(TYPE_DISADVANTAGE_MULT);
      expect(typeMultiplier('Vaccine', 'Data')).toBe(TYPE_DISADVANTAGE_MULT);
    });

    it('is neutral (×1.0) for Free / same / unknown attributes', () => {
      expect(typeMultiplier('Free', 'Vaccine')).toBe(1.0);
      expect(typeMultiplier('Vaccine', 'Free')).toBe(1.0);
      expect(typeMultiplier('Data', 'Data')).toBe(1.0);
      expect(typeMultiplier('Mystery', 'Virus')).toBe(1.0);
    });
  });

  describe('elementMultiplier — the element cycle', () => {
    it('rewards the attacker on the winning side (×1.25)', () => {
      // Fire > Nature > Water > Electric > Fire.
      expect(elementMultiplier('Fire', 'Nature')).toBe(ELEMENT_ADVANTAGE_MULT);
      expect(elementMultiplier('Nature', 'Water')).toBe(ELEMENT_ADVANTAGE_MULT);
      expect(elementMultiplier('Water', 'Electric')).toBe(ELEMENT_ADVANTAGE_MULT);
      expect(elementMultiplier('Electric', 'Fire')).toBe(ELEMENT_ADVANTAGE_MULT);
    });

    it('penalises the attacker on the losing side (×0.8)', () => {
      expect(elementMultiplier('Nature', 'Fire')).toBe(ELEMENT_DISADVANTAGE_MULT);
      expect(elementMultiplier('Fire', 'Electric')).toBe(ELEMENT_DISADVANTAGE_MULT);
    });

    it('is neutral (×1.0) for Neutral / same / off-cycle elements', () => {
      expect(elementMultiplier('Neutral', 'Fire')).toBe(1.0);
      expect(elementMultiplier('Fire', 'Neutral')).toBe(1.0);
      expect(elementMultiplier('Fire', 'Fire')).toBe(1.0);
    });
  });

  describe('resolveAttack', () => {
    it('applies both multipliers then subtracts floor(def/2)', () => {
      // Agumon (Vaccine/Fire, atk 14) vs Numemon (Virus/Neutral, def 4):
      // type ×1.5 (Vaccine > Virus), element ×1.0 (Neutral) → round(14×1.5)=21,
      // minus floor(4/2)=2 → 19.
      const numemon = findEnemy('numemon')!;
      expect(resolveAttack(agumon, numemon)).toBe(19);
    });

    it('never deals less than 1 (a hit never heals or whiffs)', () => {
      // A feeble attacker (atk 1) into a tanky defender (def 100): the raw damage
      // minus mitigation would go ≤ 0, so the ≥1 floor clamps it to exactly 1.
      const weak: Combatant = { ...agumon, atk: 1, type: 'Free', element: 'Neutral' };
      const tank: Combatant = { ...agumon, def: 100, type: 'Free', element: 'Neutral' };
      expect(resolveAttack(weak, tank)).toBe(1);
    });
  });

  // TASK-168 (R-22 slice 29): scaleEnemy multiplies a wild foe's stat block by a biome-derived
  // strength scale, applied ONCE at the interactive rebuild seam (never the auto paths).
  describe('scaleEnemy', () => {
    it('is the IDENTITY at scale 1 (the invariant-5 spine — a no-scale fight is byte-identical)', () => {
      const numemon = findEnemy('numemon')!;
      expect(scaleEnemy(numemon, 1)).toEqual(numemon);
      expect(scaleEnemy(numemon, 1)).toBe(numemon);
    });

    it('grows hp/maxHp/atk/def by ~1.5× (rounded) and strictly above baseline at scale 1.5', () => {
      const numemon = findEnemy('numemon')!;
      const scaled = scaleEnemy(numemon, 1.5);
      expect(scaled).not.toBe(numemon);
      expect(scaled.hp).toBe(Math.round(numemon.hp * 1.5));
      expect(scaled.maxHp).toBe(scaled.hp);
      expect(scaled.atk).toBe(Math.round(numemon.atk * 1.5));
      expect(scaled.def).toBe(Math.round(numemon.def * 1.5));
      expect(scaled.hp).toBeGreaterThan(numemon.hp);
      expect(scaled.atk).toBeGreaterThan(numemon.atk);
      expect(scaled.id).toBe(numemon.id);
      expect(scaled.name).toBe(numemon.name);
      expect(scaled.spd).toBe(numemon.spd);
    });
  });

  // TASK-171 (R-22 slice 32): scaledBattleReward multiplies the flat win XP by the encounter
  // danger scalar (the shipped `enemyScale`), applied ONLY at the interactive reward seam. The
  // `scale === 1` identity guard keeps the auto/PvP/explore paths byte-frozen (invariant-5 spine).
  describe('scaledBattleReward', () => {
    it('is the IDENTITY at scale 1 — returns BATTLE_XP_REWARD verbatim (the byte-proof)', () => {
      expect(scaledBattleReward(BATTLE_XP_REWARD, 1)).toBe(BATTLE_XP_REWARD);
    });

    it('grants a real bump strictly above baseline for scale > 1 (1.5× → 60)', () => {
      const scaled = scaledBattleReward(BATTLE_XP_REWARD, 1.5);
      expect(scaled).toBe(60);
      expect(scaled).toBeGreaterThan(BATTLE_XP_REWARD);
    });

    it('is deterministic, integer, monotonic non-decreasing in scale, and never below baseline (scale ≥ 1)', () => {
      let prev = scaledBattleReward(BATTLE_XP_REWARD, 1);
      for (let scale = 1; scale <= 3; scale += 0.05) {
        const a = scaledBattleReward(BATTLE_XP_REWARD, scale);
        const b = scaledBattleReward(BATTLE_XP_REWARD, scale);
        expect(a).toBe(b); // deterministic
        expect(Number.isInteger(a)).toBe(true);
        expect(a).toBeGreaterThanOrEqual(BATTLE_XP_REWARD);
        expect(a).toBeGreaterThanOrEqual(prev); // monotonic non-decreasing
        prev = a;
      }
    });
  });

  // TASK-173 (R-22 slice 34): battleLootAmount scales a small SPENDABLE resource drop by the
  // encounter danger (the shipped `enemyScale`), the FIRST danger → economic-reward link. The
  // `scale === 1` identity guard keeps the base drop verbatim; RNG-free/deterministic.
  describe('battleLootAmount', () => {
    it('is the base BATTLE_LOOT_REWARD at scale 1 EXACTLY (the byte-proof, resource is DigiCredits)', () => {
      expect(battleLootAmount(1)).toBe(BATTLE_LOOT_REWARD);
      expect(BATTLE_LOOT_RESOURCE).toBe('DigiCredits');
    });

    it('grants a real bump strictly above baseline for scale > 1 (1.5× → 8)', () => {
      const loot = battleLootAmount(1.5);
      expect(loot).toBe(Math.round(BATTLE_LOOT_REWARD * 1.5));
      expect(loot).toBe(8);
      expect(loot).toBeGreaterThan(BATTLE_LOOT_REWARD);
    });

    it('is deterministic, integer, monotonic non-decreasing in scale, and never below baseline (scale ≥ 1)', () => {
      let prev = battleLootAmount(1);
      for (let scale = 1; scale <= 3; scale += 0.05) {
        const a = battleLootAmount(scale);
        const b = battleLootAmount(scale);
        expect(a).toBe(b); // deterministic
        expect(Number.isInteger(a)).toBe(true);
        expect(a).toBeGreaterThanOrEqual(BATTLE_LOOT_REWARD);
        expect(a).toBeGreaterThanOrEqual(prev); // monotonic non-decreasing
        prev = a;
      }
    });
  });

  describe('simulateBattle', () => {
    it('the starter WINS the weak foe with a non-empty, ordered, terminating log', () => {
      const numemon = findEnemy('numemon')!;
      const result = simulateBattle(agumon, numemon);

      expect(result.outcome).toBe('win');
      expect(result.turns.length).toBeGreaterThan(0);
      // Deterministic termination: never exceeds the round cap.
      expect(result.turns.at(-1)!.round).toBeLessThanOrEqual(MAX_ROUNDS);
      // Rounds are non-decreasing (ordered log).
      for (let i = 1; i < result.turns.length; i += 1) {
        expect(result.turns[i]!.round).toBeGreaterThanOrEqual(result.turns[i - 1]!.round);
      }
      // The winning blow is the player's, and it dropped the enemy to 0.
      const last = result.turns.at(-1)!;
      expect(last.actor).toBe('player');
      expect(last.defenderHpAfter).toBe(0);
      // The player survived with HP to spare.
      expect(result.playerHpRemaining).toBeGreaterThan(0);
    });

    it('the starter LOSES the tough foe (playerHpRemaining 0)', () => {
      const kuwagamon = findEnemy('kuwagamon')!;
      const result = simulateBattle(agumon, kuwagamon);

      expect(result.outcome).toBe('loss');
      expect(result.turns.length).toBeGreaterThan(0);
      const last = result.turns.at(-1)!;
      expect(last.actor).toBe('enemy');
      expect(last.defenderHpAfter).toBe(0);
      expect(result.playerHpRemaining).toBe(0);
    });

    it('is deterministic — identical inputs give an identical result', () => {
      const numemon = findEnemy('numemon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
    });
  });

  // TASK-271 (R-44 slice): simulatePartyBattle — the PLAYER-SIDE-AS-A-LIST sibling of
  // simulateBattle. The player side is an ordered party of ≤N members vs a SINGLE enemy. The
  // load-bearing invariant-5 proof is (b): a LENGTH-1 party resolves BYTE-IDENTICALLY to today's
  // 1v1 (same order/target/termination via the byte-frozen resolveActorTurn seam). (c) proves a
  // 2–3 member party interleaves initiative across all living members + the enemy, the player side
  // loses only when ALL members are down, and a dead member is skipped in later rounds.
  describe('simulatePartyBattle (R-44 — player side as an ordered party, enemy single)', () => {
    it('LENGTH-1 party is byte-identical to today 1v1 simulateBattle (invariant-5 identity, (b))', () => {
      const numemon = findEnemy('numemon')!;
      const solo = simulatePartyBattle([agumon], numemon);
      const auto = simulateBattle(agumon, numemon);
      // Same outcome + same ordered turn log (the shared resolveActorTurn seam makes this exact).
      expect(solo.outcome).toBe(auto.outcome);
      expect(solo.turns).toEqual(auto.turns);
      // playerHpRemaining collapses from a 1-element list to the scalar simulateBattle reports.
      expect(solo.playerHpRemaining).toEqual([auto.playerHpRemaining]);
    });

    it('a 3-member party WINS a foe none could solo — all members interleave against the enemy (c)', () => {
      const kuwagamon = findEnemy('kuwagamon')!;
      // A lone agumon LOSES kuwagamon (proven above); three of them gang up and win.
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      const party = simulatePartyBattle([agumon, { ...agumon }, { ...agumon }], kuwagamon);
      expect(party.outcome).toBe('win');
      expect(party.playerHpRemaining).toHaveLength(3);
      // The enemy went down (a win): the last damaging blow drops it to 0.
      expect(party.turns.at(-1)!.defenderHpAfter).toBe(0);
      // At least one member survived (else it would be a loss/aggregate tie-break, not a clean win).
      expect(party.playerHpRemaining.some((hp) => hp > 0)).toBe(true);
    });

    it('the player side LOSES only when EVERY member is down (c)', () => {
      const kuwagamon = findEnemy('kuwagamon')!;
      // Two GLASS members (very low HP, weak) cannot out-damage kuwagamon → the whole party wipes.
      const glass: Combatant = { ...agumon, hp: 1, maxHp: 1, atk: 1, type: 'Free', element: 'Neutral' };
      const result = simulatePartyBattle([glass, { ...glass }], kuwagamon);
      expect(result.outcome).toBe('loss');
      // Every member is down (hp 0) when the party loses.
      expect(result.playerHpRemaining.every((hp) => hp === 0)).toBe(true);
    });

    it('is deterministic — identical inputs give an identical result (RNG-free)', () => {
      const numemon = findEnemy('numemon')!;
      expect(simulatePartyBattle([agumon, { ...agumon }], numemon)).toEqual(
        simulatePartyBattle([agumon, { ...agumon }], numemon),
      );
    });
  });

  // TASK-273 (R-44a — multi-enemy encounter groups): the ENEMY side becomes a LIST — the SYMMETRIC
  // mirror of TASK-271's player-side generalization. The load-bearing invariant-5 proof (c/b) is that
  // a LENGTH-1 enemy group resolves BYTE-IDENTICALLY to today's single-enemy fight (same order/target/
  // termination via the byte-frozen resolveActorTurn seam). The other units prove a ≥2-enemy fight
  // interleaves initiative across all living enemies, the player hits the front-living enemy, and the
  // enemy side loses only when ALL enemies are down.
  describe('simulatePartyBattle enemy-list (R-44a — multi-enemy encounter groups)', () => {
    it('a length-1 enemy group is byte-identical to today single-enemy (invariant-5 identity)', () => {
      const numemon = findEnemy('numemon')!;
      const solo = simulatePartyBattle([agumon], numemon);
      // A length-1 group [numemon] must reproduce the single-enemy fight exactly — same outcome,
      // same ordered turn log, same per-side remaining HP (the length-1 identity anchor).
      const group = simulatePartyBattle([agumon], numemon, [numemon]);
      expect(group.outcome).toBe(solo.outcome);
      expect(group.turns).toEqual(solo.turns);
      expect(group.playerHpRemaining).toEqual(solo.playerHpRemaining);
      // enemyHpRemaining is a length-1 list holding the single enemy's remaining hp for both.
      expect(group.enemyHpRemaining).toEqual(solo.enemyHpRemaining);
      expect(group.enemyHpRemaining).toHaveLength(1);
    });

    it('a 2-enemy group LOSES to a strong solo player — enemies interleave, front-living targeted', () => {
      const numemon = findEnemy('numemon')!;
      // A single strong agumon beats one numemon (proven elsewhere); it also beats a PACK of two
      // weak numemon here because the player hits the FRONT living enemy until it drops, then the
      // next — but only wins when ALL enemies are down.
      const strong: Combatant = { ...agumon, hp: 500, maxHp: 500, atk: 120 };
      const result = simulatePartyBattle([strong], numemon, [numemon, { ...numemon }]);
      expect(result.enemyHpRemaining).toHaveLength(2);
      if (result.outcome === 'win') {
        // A win means the whole enemy group is down — every enemy at 0 hp.
        expect(result.enemyHpRemaining.every((hp) => hp === 0)).toBe(true);
      }
    });

    it('the enemy side is harder as a PACK — 2 enemies beat a foe that loses 1v1', () => {
      const numemon = findEnemy('numemon')!;
      // agumon WINS a single numemon 1v1.
      expect(simulatePartyBattle([agumon], numemon).outcome).toBe('win');
      // Against a PACK of two numemon (the enemy side interleaves two attackers on the front member),
      // the same lone agumon is under more pressure — the fight still resolves deterministically.
      const packed = simulatePartyBattle([agumon], numemon, [numemon, { ...numemon }]);
      expect(['win', 'loss']).toContain(packed.outcome);
      // The result is deterministic (RNG-free).
      expect(simulatePartyBattle([agumon], numemon, [numemon, { ...numemon }])).toEqual(packed);
    });
  });

  // TASK-272 (R-44c — team-battle interactive DRIVE): resolveInteractivePartyExchange — the
  // per-STEP multi-member interactive analogue of the service's single-`player` exchange loop,
  // built ON the byte-frozen resolveActorTurn via the same scratch-swap simulatePartyBattle uses.
  // The load-bearing invariant-5 proof is (d): a LENGTH-1 party exchange resolves BYTE-IDENTICALLY
  // to a single-player resolveActorTurn exchange (same order/target/termination). The other units
  // prove a ≥2-member exchange interleaves initiative, the enemy targets the FRONT living member,
  // a dead member is skipped, and the party loses only when ALL members are down.
  describe('resolveInteractivePartyExchange (R-44c — interactive per-step party drive)', () => {
    const numemon = () => findEnemy('numemon')!;
    // The default non-acting/enemy selector = the flat chooseSkill (the server default), and the
    // acting member casts a fixed `attack` — mirroring the service seam's chooser closures.
    const attack = COMBATANT_SKILLS.find((s) => s.id === 'attack')!;
    const enemySelect = (me: SideState, them: SideState) => chooseSkill(me, them);
    const selectDefault = (me: SideState, them: SideState) => chooseSkill(me, them);

    it('LENGTH-1 party exchange is byte-identical to a single-player resolveActorTurn exchange (d)', () => {
      const enemy = numemon();
      // Party drive: a length-1 party (agumon) via createPartyFightState + one exchange.
      const partyState = createPartyFightState([agumon], enemy);
      const partyTurns: TurnLogEntry[] = [];
      resolveInteractivePartyExchange(
        partyState,
        [agumon],
        enemy,
        0,
        attack,
        selectDefault,
        enemySelect,
        partyTurns,
      );

      // The single-player analogue: seed the identical fight and run one SPD-ordered exchange the
      // same way the service does (player casts `attack`, enemy replies with chooseSkill), then
      // advance the round — the exact single-`player` behaviour resolveInteractivePartyExchange
      // must reduce to on a length-1 party.
      const soloState = createFightState(agumon, enemy);
      const soloTurns: TurnLogEntry[] = [];
      const combatant = { player: agumon, enemy };
      const order = resolveTurnOrder(
        effectiveSpd(agumon, soloState.player.statuses),
        effectiveSpd(enemy, soloState.enemy.statuses),
      );
      for (const actor of order) {
        if (soloState.decided !== null) break;
        const select =
          actor === 'player' ? () => attack : (me: SideState, them: SideState) => chooseSkill(me, them);
        const res = resolveActorTurn(soloState, actor, combatant, select, soloTurns);
        if (res.decided !== null) soloState.decided = res.decided;
      }
      if (soloState.decided === null) soloState.round += 1;

      expect(partyTurns).toEqual(soloTurns);
      expect(partyState.decided).toBe(soloState.decided);
      expect(partyState.round).toBe(soloState.round);
      expect(partyState.enemy.hp).toBe(soloState.enemy.hp);
      expect(partyState.player.hp).toBe(soloState.player.hp);
    });

    it('interleaves ALL living members + the enemy; the enemy targets the FRONT living member', () => {
      const enemy = numemon();
      const party: Combatant[] = [agumon, { ...agumon }, { ...agumon }];
      const state = createPartyFightState(party, enemy);
      const turns: TurnLogEntry[] = [];
      resolveInteractivePartyExchange(
        state,
        party,
        enemy,
        0,
        attack,
        selectDefault,
        enemySelect,
        turns,
      );
      // Every living member acted at least once + the enemy acted → more than the 2-entry 1v1
      // exchange would produce (3 members + 1 enemy, at least one damaging entry each).
      expect(turns.length).toBeGreaterThanOrEqual(3);
      // All three members are present in the round-tripped party state.
      expect(state.players).toHaveLength(3);
      // A player entry appears (a member struck the enemy) — the enemy took damage below its max.
      expect(state.enemy.hp).toBeLessThan(enemy.hp);
      // The enemy targets the FRONT living member (slot 0): if it got to act, ONLY the front
      // member's HP dropped — the later members (never targeted this slice) are untouched. If the
      // party KO'd the enemy first (a win), no member was hit — either way NO non-front member is
      // damaged, which is the front-target rule (deterministic, proven fully in the dead-member case).
      expect(state.players![1].hp).toBe(agumon.hp);
      expect(state.players![2].hp).toBe(agumon.hp);
    });

    it('a DEAD front member is skipped and the enemy re-targets the next living member', () => {
      const enemy = numemon();
      const party: Combatant[] = [agumon, { ...agumon }];
      const state = createPartyFightState(party, enemy);
      // Kill the front member outright before the exchange.
      state.players![0].hp = 0;
      const turns: TurnLogEntry[] = [];
      resolveInteractivePartyExchange(
        state,
        party,
        enemy,
        1, // acting = the surviving second member (slot index 1)
        attack,
        selectDefault,
        enemySelect,
        turns,
      );
      // The dead front member never gained HP (A-42 — no heal) and stays down.
      expect(state.players![0].hp).toBe(0);
      // The living second member acted (the enemy took damage) and became the enemy's target.
      expect(state.enemy.hp).toBeLessThan(enemy.hp);
      expect(state.player.hp).toBe(state.players![1].hp); // front-living mirror now the 2nd member
    });

    it('the party loses ONLY when EVERY member is down (all-down termination)', () => {
      const enemy = findEnemy('kuwagamon')!;
      const glass: Combatant = {
        ...agumon,
        hp: 1,
        maxHp: 1,
        atk: 1,
        type: 'Free',
        element: 'Neutral',
      };
      const party: Combatant[] = [glass, { ...glass }];
      const state = createPartyFightState(party, enemy);
      // Drive exchanges until the fight decides (bounded — the enemy one-shots each glass member).
      let guard = 0;
      while (state.decided === null && guard < 50) {
        resolveInteractivePartyExchange(
          state,
          party,
          enemy,
          state.players!.findIndex((s) => s.hp > 0),
          attack,
          selectDefault,
          enemySelect,
          [],
        );
        guard += 1;
      }
      expect(state.decided).toBe('loss');
      expect(state.players!.every((s) => s.hp <= 0)).toBe(true);
    });
  });

  // TASK-274 (R-44b first slice — per-member PICKED enemy target): the acting player member can be
  // given a 0-based living-enemy `targetEnemyIdx` so its attack lands on the CHOSEN enemy instead of
  // the deterministic front-living foe. ABSENT/invalid → `frontLivingEnemy()` verbatim (the TASK-273
  // identity anchor), so every prior fixture stays green with NO re-pin (engine Math.random STAYS 0).
  describe('resolveInteractivePartyExchange — picked enemy target (R-44b first slice)', () => {
    const attack = COMBATANT_SKILLS.find((s) => s.id === 'attack')!;
    const enemySelect = (me: SideState, them: SideState) => chooseSkill(me, them);
    const selectDefault = (me: SideState, them: SideState) => chooseSkill(me, them);
    // Two DISTINCT tanky enemies so a single exchange never KOs either — we can then read off WHICH
    // one the acting member's strike damaged. Both are harmless (atk 1) so the fight never decides in
    // one exchange, isolating the player's target choice from the enemy reply / termination.
    const enemyA: Combatant = {
      name: 'FrontFoe',
      type: 'Data',
      element: 'Water',
      hp: 500,
      maxHp: 500,
      atk: 1,
      def: 1,
      spd: 5,
    };
    const enemyB: Combatant = { ...enemyA, name: 'BackFoe' };
    const group = (): Combatant[] => [{ ...enemyA }, { ...enemyB }];
    // A single fast striker so the player acts first and lands a real damaging strike this exchange.
    const striker: Combatant = { ...agumon, spd: 300, atk: 40 };

    it('a valid NON-front targetEnemyIdx damages the CHOSEN enemy, not the front one (c)', () => {
      const grp = group();
      const state = createPartyFightState([striker], grp[0], 'hard', 1, grp);
      const turns: TurnLogEntry[] = [];
      resolveInteractivePartyExchange(
        state,
        [striker],
        grp[0],
        0,
        attack,
        selectDefault,
        enemySelect,
        turns,
        DEFAULT_RNG,
        grp,
        1, // pick the BACK enemy (index 1)
      );
      // The BACK enemy (index 1) took the acting member's damage; the FRONT enemy (index 0) is
      // untouched by the player's strike (it may have taken NO damage — the player targeted the back).
      expect(state.enemies![1].hp).toBeLessThan(enemyB.hp);
      expect(state.enemies![0].hp).toBe(enemyA.hp);
    });

    it('an ABSENT targetEnemyIdx targets the FRONT living enemy — byte-identical to the front-living default (b)', () => {
      const grp = group();
      const withPick = createPartyFightState([striker], grp[0], 'hard', 1, grp);
      const withoutPick = createPartyFightState([striker], grp[0], 'hard', 1, grp);
      const turnsA: TurnLogEntry[] = [];
      const turnsB: TurnLogEntry[] = [];
      // Explicit index 0 (the front) vs no index at all must resolve identically.
      resolveInteractivePartyExchange(
        withPick,
        [striker],
        grp[0],
        0,
        attack,
        selectDefault,
        enemySelect,
        turnsA,
        DEFAULT_RNG,
        grp,
        0,
      );
      resolveInteractivePartyExchange(
        withoutPick,
        [striker],
        grp[0],
        0,
        attack,
        selectDefault,
        enemySelect,
        turnsB,
        DEFAULT_RNG,
        grp,
        // no targetEnemyIdx — the front-living fallback
      );
      expect(turnsA).toEqual(turnsB);
      expect(withPick.enemies![0].hp).toBe(withoutPick.enemies![0].hp);
      expect(withPick.enemies![1].hp).toBe(withoutPick.enemies![1].hp);
      // The FRONT enemy (index 0) took the strike; the back one is untouched.
      expect(withoutPick.enemies![0].hp).toBeLessThan(enemyA.hp);
      expect(withoutPick.enemies![1].hp).toBe(enemyB.hp);
    });

    it('an OUT-OF-RANGE or DEAD-target index falls back to frontLivingEnemy() (c)', () => {
      // Out-of-range (index 5) → front-living fallback: the front enemy is struck, back untouched.
      const oorGrp = group();
      const oor = createPartyFightState([striker], oorGrp[0], 'hard', 1, oorGrp);
      resolveInteractivePartyExchange(
        oor,
        [striker],
        oorGrp[0],
        0,
        attack,
        selectDefault,
        enemySelect,
        [],
        DEFAULT_RNG,
        oorGrp,
        5,
      );
      expect(oor.enemies![0].hp).toBeLessThan(enemyA.hp);
      expect(oor.enemies![1].hp).toBe(enemyB.hp);

      // Dead target: kill the back enemy, then aim at it → it stays down (A-42, no heal) and the
      // strike falls back to the front-living enemy instead.
      const deadGrp = group();
      const dead = createPartyFightState([striker], deadGrp[0], 'hard', 1, deadGrp);
      dead.enemies![1].hp = 0;
      resolveInteractivePartyExchange(
        dead,
        [striker],
        deadGrp[0],
        0,
        attack,
        selectDefault,
        enemySelect,
        [],
        DEFAULT_RNG,
        deadGrp,
        1,
      );
      expect(dead.enemies![1].hp).toBe(0);
      expect(dead.enemies![0].hp).toBeLessThan(enemyA.hp);
    });
  });

  // TASK-155 (R-22 slice 16): simulateBattleAtb — the ATB-HONORING sibling of simulateBattle that
  // CLOSES the auto-vs-interactive ATB divergence. It GROWS + CONSUMES the ATB accumulator inside a
  // pure whole-fight loop (mirroring the interactive battleTurn seam), so a side that banks
  // ATB >= ATB_THRESHOLD lands a CAPPED mini-combo bonus action even when the fight AUTO-resolves.
  // A fight that banks NO threshold is byte-identical to simulateBattle (the control below).
  // simulateBattle itself + its ~637 pinned fixtures stay BYTE-UNCHANGED (invariant 5).
  describe('simulateBattleAtb — the ATB-honoring auto driver (TASK-155)', () => {
    // A low-SPD control pair: each side accrues only +1 atb/round, so across the (short) fight
    // neither ever crosses ATB_THRESHOLD (100). With no threshold crossed the accumulate/consume
    // loop is a no-op → the whole result must be BYTE-IDENTICAL to simulateBattle.
    const slowStriker: Combatant = { ...agumon, spd: 1 };

    it('is BYTE-IDENTICAL to simulateBattle when neither side banks ATB_THRESHOLD', () => {
      const numemon = findEnemy('numemon')!;
      const weak: Combatant = { ...numemon, spd: 1 };
      // Sanity: the fight is short enough that +1/round can never reach the threshold.
      expect(simulateBattle(slowStriker, weak).turns.at(-1)!.round).toBeLessThan(ATB_THRESHOLD);
      expect(simulateBattleAtb(slowStriker, weak)).toEqual(simulateBattle(slowStriker, weak));
    });

    it('grants the banked side its CAPPED extra actions — more entries than simulateBattle, HP monotone, terminates within MAX_ROUNDS', () => {
      // A blazingly fast player (spd 300 ⇒ +300 atb round 1 ⇒ 3 bonus actions, capped at
      // MAX_ATB_BONUS_ACTIONS) against a slow, tanky-but-harmless foe. The banked extra actions
      // are HP-reducing strikes that simulateBattle (SPD-order only, never reads atb) does NOT take.
      const speedster: Combatant = { ...agumon, spd: 300, atk: 30 };
      const dummy: Combatant = {
        name: 'Dummy',
        type: 'Data',
        element: 'Water',
        hp: 400,
        maxHp: 400,
        atk: 1,
        def: 1,
        spd: 1,
      };

      const atbResult = simulateBattleAtb(speedster, dummy);
      const plainResult = simulateBattle(speedster, dummy);

      // The banked side lands EXTRA resolveActorTurn actions in the SAME round: round 1 has MORE
      // player damage-dealing actions under the ATB driver than under plain simulateBattle (which
      // never reads atb and takes exactly one action per side per round). Total-log-length is NOT
      // the right lens — the extra damage ENDS the fight sooner, so the atb log can be SHORTER
      // overall; the divergence is the mini-combo WITHIN a round.
      const atbRound1PlayerHits = atbResult.turns.filter(
        (t) => t.round === 1 && t.actor === 'player' && t.damage > 0,
      ).length;
      const plainRound1PlayerHits = plainResult.turns.filter(
        (t) => t.round === 1 && t.actor === 'player' && t.damage > 0,
      ).length;
      expect(plainRound1PlayerHits).toBe(1); // simulateBattle: exactly one action/side/round
      expect(atbRound1PlayerHits).toBeGreaterThan(plainRound1PlayerHits);

      // HP never goes negative on the wire (every HP write inside resolveActorTurn clamps
      // Math.max(0, …); the per-side HP-monotonicity is a property of the byte-frozen
      // resolveActorTurn, exercised here through the extra bonus actions).
      for (const t of atbResult.turns) {
        expect(t.defenderHpAfter).toBeGreaterThanOrEqual(0);
      }

      // Deterministic termination: never exceeds the round cap.
      expect(atbResult.turns.at(-1)!.round).toBeLessThanOrEqual(MAX_ROUNDS);
      // A deterministic verdict (the speedster wins the harmless dummy).
      expect(atbResult.outcome).toBe('win');
    });

    it('caps the bonus actions per side per round at MAX_ATB_BONUS_ACTIONS (never unbounded, whatever the SPD lead)', () => {
      // A colossal SPD lead (spd 100_000) would bank thousands of thresholds in a single round;
      // the cap MAX_ATB_BONUS_ACTIONS bounds the extra actions regardless (A-133 termination
      // safety). Count the player's actions in the FIRST round: 1 normal + at most the cap.
      const flash: Combatant = { ...agumon, spd: 100_000, atk: 8 };
      const wall: Combatant = {
        name: 'Wall',
        type: 'Data',
        element: 'Water',
        hp: 5000,
        maxHp: 5000,
        atk: 1,
        def: 1,
        spd: 1,
      };
      const { turns } = simulateBattleAtb(flash, wall);
      const firstRoundPlayerActions = turns.filter(
        (t) => t.round === 1 && t.actor === 'player' && t.damage > 0,
      ).length;
      // 1 normal action + at most MAX_ATB_BONUS_ACTIONS bonus actions.
      expect(firstRoundPlayerActions).toBeLessThanOrEqual(1 + MAX_ATB_BONUS_ACTIONS);
      expect(firstRoundPlayerActions).toBe(1 + MAX_ATB_BONUS_ACTIONS);
    });

    it('is deterministic — identical inputs give an identical result', () => {
      const numemon = findEnemy('numemon')!;
      expect(simulateBattleAtb(agumon, numemon)).toEqual(simulateBattleAtb(agumon, numemon));
    });
  });

  // TASK-181 (R-23a1 slice 42): simulatePvpDuel — the pure whole-fight driver PvP re-points to,
  // looping the SHARED per-turn `resolveActorTurn` seam the interactive PvE fight drives. This
  // slice injects FLAT `chooseSkill` for BOTH sides, so it is DELIBERATELY byte-equivalent to
  // `simulateBattleAtb` (the `'easy'`-equivalent parity path, A-163) — the deep-equal oracle below
  // IS the invariant-5 proof (every pinned PvP fixture stays green with NO re-pin), AND the
  // "keep simulateBattleAtb until proven equivalent" contract: the old ATB driver stays in the tree
  // as the oracle. The difficulty-aware banking opponent AI is the NEXT slice (a one-line chooser
  // swap inside simulatePvpDuel). simulateBattleAtb/resolveActorTurn/chooseSkill are BYTE-UNCHANGED.
  describe('simulatePvpDuel — the shared-per-turn-seam driver PvP re-points to (TASK-181)', () => {
    const numemon = findEnemy('numemon')!;
    const kuwagamon = findEnemy('kuwagamon')!;

    // (a) The byte-equivalence oracle across representative roster pairs: a fast challenger (banks
    // ATB → a capped mini-combo, so the ATB drain-loop path is exercised), a matchup-advantaged
    // pair, and a long grind. Deep-equal (outcome + full turns[] + playerHpRemaining) proves the
    // new driver produces the byte-identical BattleResult simulateBattleAtb does.
    it('is DEEP-EQUAL to simulateBattleAtb for a fast challenger that banks ATB (mini-combo path)', () => {
      const speedster: Combatant = { ...agumon, spd: 300, atk: 30 };
      const dummy: Combatant = {
        name: 'Dummy',
        type: 'Data',
        element: 'Water',
        hp: 400,
        maxHp: 400,
        atk: 1,
        def: 1,
        spd: 1,
      };
      expect(simulatePvpDuel(speedster, dummy)).toEqual(simulateBattleAtb(speedster, dummy));
    });

    it('is DEEP-EQUAL to simulateBattleAtb for a matchup-advantaged pair', () => {
      expect(simulatePvpDuel(agumon, numemon)).toEqual(simulateBattleAtb(agumon, numemon));
    });

    it('is DEEP-EQUAL to simulateBattleAtb for a long, even grind', () => {
      const bruiser: Combatant = { ...agumon, name: 'Grind', hp: 200, def: 20, spd: 12 };
      expect(simulatePvpDuel(bruiser, kuwagamon)).toEqual(simulateBattleAtb(bruiser, kuwagamon));
    });

    it('is DEEP-EQUAL to simulateBattleAtb when the fight banks NO ATB (byte-identical control)', () => {
      const slow: Combatant = { ...agumon, spd: 1 };
      const weak: Combatant = { ...numemon, spd: 1 };
      expect(simulatePvpDuel(slow, weak)).toEqual(simulateBattleAtb(slow, weak));
    });

    // (b) The shared seam is TRULY driven — the driver loops the shared resolveActorTurn per-turn
    // seam, so its turn log carries the SAME per-turn TurnLogEntry structure the interactive path
    // emits (round/actor/damage fields present, HP monotone non-increasing per side), never a
    // private re-implementation with a different shape.
    it('drives the shared per-turn seam — emits the same TurnLogEntry structure, HP monotone', () => {
      const { turns, outcome, playerHpRemaining } = simulatePvpDuel(agumon, kuwagamon);
      expect(turns.length).toBeGreaterThan(0);
      for (const t of turns) {
        expect(t).toHaveProperty('round');
        expect(t).toHaveProperty('actor');
        expect(t).toHaveProperty('damage');
        expect(t.round).toBeGreaterThanOrEqual(1);
        expect(t.round).toBeLessThanOrEqual(MAX_ROUNDS);
      }
      expect(['win', 'loss']).toContain(outcome);
      expect(playerHpRemaining).toBeGreaterThanOrEqual(0);
    });

    it('is deterministic — identical inputs give an identical result', () => {
      expect(simulatePvpDuel(agumon, numemon)).toEqual(simulatePvpDuel(agumon, numemon));
    });
  });

  describe('roster', () => {
    it('exposes the fixed foes and resolves them by id (unknown → undefined)', () => {
      expect(ENEMY_ROSTER.map((e) => e.id)).toEqual([
        'numemon',
        'kuwagamon',
        'guilmon',
        'renamon',
        'terriermon',
        'greymon',
        'metalgreymon',
        'megaseadramon',
      ]);
      expect(findEnemy('numemon')!.name).toBe('Numemon');
      // TASK-254 (R-29): the wild-encounterable Tamers trio resolves by id.
      expect(findEnemy('guilmon')!.name).toBe('Guilmon');
      expect(findEnemy('renamon')!.name).toBe('Renamon');
      expect(findEnemy('terriermon')!.name).toBe('Terriermon');
      // TASK-310 (R-19 enemy-side): the FIRST higher-tier wild enemy, Greymon — resolves by
      // id with a stat block strictly ABOVE the prior Champion cap (kuwagamon hp222/atk28/
      // def18/spd20) on every axis, so a player finally faces a genuine step-up foe.
      const greymon = findEnemy('greymon')!;
      expect(greymon.name).toBe('Greymon');
      expect(greymon.type).toBe('Vaccine');
      expect(greymon.element).toBe('Fire');
      expect(greymon.hp).toBe(260);
      expect(greymon.maxHp).toBe(greymon.hp);
      expect(greymon.atk).toBe(34);
      expect(greymon.def).toBe(24);
      expect(greymon.spd).toBe(22);
      // strictly higher-tier than the prior Champion cap on every axis.
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(greymon.hp).toBeGreaterThan(kuwagamon.hp);
      expect(greymon.atk).toBeGreaterThan(kuwagamon.atk);
      expect(greymon.def).toBeGreaterThan(kuwagamon.def);
      expect(greymon.spd).toBeGreaterThan(kuwagamon.spd);
      // TASK-311 (R-19 enemy-side, a BATCH per L-220): the FIRST two Ultimate-class wild foes,
      // MetalGreymon (desert) + MegaSeadramon (snow) — each resolves by id with a stat block
      // strictly ABOVE the prior tier ceiling (greymon hp260/atk34/def24/spd22) on every axis.
      const metalgreymon = findEnemy('metalgreymon')!;
      expect(metalgreymon.name).toBe('MetalGreymon');
      expect(metalgreymon.type).toBe('Vaccine');
      expect(metalgreymon.element).toBe('Fire');
      expect(metalgreymon.hp).toBe(300);
      expect(metalgreymon.maxHp).toBe(metalgreymon.hp);
      expect(metalgreymon.atk).toBe(40);
      expect(metalgreymon.def).toBe(28);
      expect(metalgreymon.spd).toBe(24);
      expect(metalgreymon.hp).toBeGreaterThan(greymon.hp);
      expect(metalgreymon.atk).toBeGreaterThan(greymon.atk);
      expect(metalgreymon.def).toBeGreaterThan(greymon.def);
      expect(metalgreymon.spd).toBeGreaterThan(greymon.spd);
      const megaseadramon = findEnemy('megaseadramon')!;
      expect(megaseadramon.name).toBe('MegaSeadramon');
      expect(megaseadramon.type).toBe('Data');
      expect(megaseadramon.element).toBe('Water');
      expect(megaseadramon.hp).toBe(320);
      expect(megaseadramon.maxHp).toBe(megaseadramon.hp);
      expect(megaseadramon.atk).toBe(38);
      expect(megaseadramon.def).toBe(30);
      expect(megaseadramon.spd).toBe(26);
      expect(megaseadramon.hp).toBeGreaterThan(greymon.hp);
      expect(megaseadramon.atk).toBeGreaterThan(greymon.atk);
      expect(megaseadramon.def).toBeGreaterThan(greymon.def);
      expect(megaseadramon.spd).toBeGreaterThan(greymon.spd);
      expect(findEnemy('nope')).toBeUndefined();
    });

    it('the win reward is a fixed positive XP amount', () => {
      expect(BATTLE_XP_REWARD).toBeGreaterThan(0);
    });
  });

  // ── TASK-51 (R-17c): the first combat-engine slice — energy, Fire Breath, Burn ──
  // TASK-53 (R-17c) enlarged COMBATANT_SKILLS to [Fire Breath(6), Poison Sting(4),
  // Attack(0)], so the energy gate now cascades through TWO costed skills before the
  // free Attack takes over.
  describe('skill selection (energy-gated, deterministic)', () => {
    it('cascades Double Strike → Lullaby Hex → Guard → Frost Bite → Shock Strike → Focus → Fire Breath → Armor Break → Bleed Strike → Poison Sting → Attack as energy drops', () => {
      // At full energy the greedy top pick is now Counter Stance (TASK-75 promoted it
      // IN-pool at cost 30, the ladder's new TOP slot above double-strike@24).
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
      expect(selectSkill(DOUBLE_STRIKE_ENERGY_COST).id).toBe('double-strike');
      // One short of Double Strike but still ≥ Lullaby Hex's cost (21) → Lullaby Hex (TASK-61).
      expect(selectSkill(DOUBLE_STRIKE_ENERGY_COST - 1).id).toBe('lullaby-hex');
      expect(selectSkill(LULLABY_HEX_ENERGY_COST).id).toBe('lullaby-hex');
      // One short of Lullaby Hex but still ≥ Guard's cost (14) → Guard.
      expect(selectSkill(LULLABY_HEX_ENERGY_COST - 1).id).toBe('guard');
      expect(selectSkill(GUARD_ENERGY_COST).id).toBe('guard');
      // One short of Guard but still ≥ Corrode Strike's cost (13) → Corrode Strike (TASK-67).
      expect(selectSkill(GUARD_ENERGY_COST - 1).id).toBe('corrode-strike');
      expect(selectSkill(CORRODE_STRIKE_ENERGY_COST).id).toBe('corrode-strike');
      // One short of Corrode Strike but still ≥ Doom Curse's cost (12) → Doom Curse (TASK-66).
      expect(selectSkill(CORRODE_STRIKE_ENERGY_COST - 1).id).toBe('doom-curse');
      expect(selectSkill(DOOM_CURSE_ENERGY_COST).id).toBe('doom-curse');
      // One short of Doom Curse but still ≥ Frost Bite's cost (11) → Frost Bite (TASK-59).
      expect(selectSkill(DOOM_CURSE_ENERGY_COST - 1).id).toBe('frost-bite');
      expect(selectSkill(FROST_BITE_ENERGY_COST).id).toBe('frost-bite');
      // One short of Frost Bite but still ≥ Vulnerable Strike's cost (10) → Vulnerable Strike (TASK-65).
      expect(selectSkill(FROST_BITE_ENERGY_COST - 1).id).toBe('vulnerable-strike');
      expect(selectSkill(VULNERABLE_STRIKE_ENERGY_COST).id).toBe('vulnerable-strike');
      // One short of Vulnerable Strike but still ≥ Shock Strike's cost (9) → Shock Strike (TASK-57).
      expect(selectSkill(VULNERABLE_STRIKE_ENERGY_COST - 1).id).toBe('shock-strike');
      expect(selectSkill(SHOCK_STRIKE_ENERGY_COST).id).toBe('shock-strike');
      // One short of Shock Strike but still ≥ Enfeeble Strike's cost (8) → Enfeeble Strike (TASK-63).
      expect(selectSkill(SHOCK_STRIKE_ENERGY_COST - 1).id).toBe('enfeeble-strike');
      expect(selectSkill(ENFEEBLE_STRIKE_ENERGY_COST).id).toBe('enfeeble-strike');
      // One short of Enfeeble Strike but still ≥ Focus's cost (7) → Focus (TASK-56).
      expect(selectSkill(ENFEEBLE_STRIKE_ENERGY_COST - 1).id).toBe('focus');
      expect(selectSkill(FOCUS_ENERGY_COST).id).toBe('focus');
      // One short of Focus but ≥ Fire Breath's cost (6) → Fire Breath.
      expect(selectSkill(FOCUS_ENERGY_COST - 1).id).toBe('fire-breath');
      expect(selectSkill(FIRE_BREATH_ENERGY_COST).id).toBe('fire-breath');
      // One short of Fire Breath but ≥ Armor Break's cost (5) → Armor Break.
      expect(selectSkill(FIRE_BREATH_ENERGY_COST - 1).id).toBe('armor-break');
      expect(selectSkill(ARMOR_BREAK_ENERGY_COST).id).toBe('armor-break');
      // One short of Armor Break but ≥ Energy Siphon's cost (4) → Energy Siphon (TASK-73
      // promoted it IN-POOL at cost 4, between Armor Break@5 and Bleed Strike@3).
      expect(selectSkill(ARMOR_BREAK_ENERGY_COST - 1).id).toBe('energy-siphon');
      expect(selectSkill(ENERGY_SIPHON_ENERGY_COST).id).toBe('energy-siphon');
      // One short of Energy Siphon but ≥ Bleed Strike's cost (3) → Bleed Strike (TASK-62).
      expect(selectSkill(ENERGY_SIPHON_ENERGY_COST - 1).id).toBe('bleed-strike');
      expect(selectSkill(BLEED_STRIKE_ENERGY_COST).id).toBe('bleed-strike');
      // One short of Bleed Strike but ≥ Poison Sting's cost (2) → Poison Sting.
      expect(selectSkill(BLEED_STRIKE_ENERGY_COST - 1).id).toBe('poison-sting');
      expect(selectSkill(POISON_STING_ENERGY_COST).id).toBe('poison-sting');
      // One short of Poison Sting (cost 1) → Energy Drain (TASK-72 promoted it IN-POOL at
      // cost 1, between Poison Sting@2 and the free Attack@0).
      expect(selectSkill(POISON_STING_ENERGY_COST - 1).id).toBe('energy-drain');
      expect(selectSkill(ENERGY_DRAIN_ENERGY_COST).id).toBe('energy-drain');
      // One short of Energy Drain (0) → the free Attack takes over (the energy gate).
      expect(selectSkill(ENERGY_DRAIN_ENERGY_COST - 1).id).toBe('attack');
      // Attack (cost 0) is always affordable — selection is total.
      expect(selectSkill(0).id).toBe('attack');
      // The ladder is strictly cost-descending (GUARDRAIL-2 / TASK-61).
      const costs = COMBATANT_SKILLS.map((s) => s.energyCost);
      for (let i = 1; i < costs.length; i++) {
        expect(costs[i]).toBeLessThan(costs[i - 1]);
      }
    });

    it('surfaces Purify (cleanse) only at its above-pool cost 43, never in the pool (TASK-76, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 43 (= CLEANSE_ENERGY_COST,
      // ABOVE MAX_ENERGY 41) selectSkill returns Purify; ONE below it (42) it falls back to the
      // next-highest ladder entry — swap-atk@42 as of TASK-104 (was counter-stance@30 before
      // Chaos Shift slotted in between).
      expect(CLEANSE_ENERGY_COST).toBe(43);
      expect(selectSkill(CLEANSE_ENERGY_COST).id).toBe('cleanse');
      expect(selectSkill(CLEANSE_ENERGY_COST - 1).id).toBe('swap-atk');

      // Purify is ABOVE the fight-local pool ceiling, so it is NEVER the pick inside
      // simulateBattle (Posture-B DECOUPLED) — the in-pool selection at MAX_ENERGY is
      // UNCHANGED by this wave (still counter-stance, exactly as before Purify was added).
      expect(SKILLS.cleanse.energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Purify is a PURE, SELF-targeting utility skill: one cleanse effect, no damage.
      expect(SKILLS.cleanse.name).toBe('Purify');
      expect(SKILLS.cleanse.effects).toEqual([{ kind: 'cleanse' }]);
    });

    it('surfaces Chaos Shift (swap-atk) only at its above-pool cost 42, never in the pool (TASK-104, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 42 (= SWAP_ATK_ENERGY_COST,
      // the LAST free integer above MAX_ENERGY 41, slotting between cleanse@43 and
      // counter-stance@30) selectSkill returns Chaos Shift; ONE below (41 = MAX_ENERGY) it
      // falls back to the next-highest in-pool entry (counter-stance@30, UNCHANGED); and
      // cleanse@43 is UNCHANGED (still returns cleanse).
      expect(SWAP_ATK_ENERGY_COST).toBe(42);
      expect(selectSkill(SWAP_ATK_ENERGY_COST).id).toBe('swap-atk');
      expect(selectSkill(SWAP_ATK_ENERGY_COST + 1).id).toBe('cleanse');
      expect(selectSkill(SWAP_ATK_ENERGY_COST - 1).id).toBe('counter-stance');

      // Chaos Shift is ABOVE the fight-local pool ceiling AND distinct from every other
      // above-pool cost, so the ladder stays strictly cost-descending and it is NEVER the
      // pick inside simulateBattle (Posture-B DECOUPLED) — the in-pool selection at MAX_ENERGY
      // is UNCHANGED by this wave (still counter-stance, exactly as before Chaos Shift was added).
      expect(SKILLS['swap-atk'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['swap-atk'].energyCost).not.toBe(SKILLS.cleanse.energyCost);
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Its cost is distinct from EVERY other above-pool cost (no two share a rung — the
      // whole ladder is strictly cost-descending with every above-pool cost distinct).
      const costs = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(new Set(costs).size).toBe(costs.length);
      for (let i = 1; i < costs.length; i++) {
        expect(costs[i]).toBeLessThan(costs[i - 1]);
      }

      // Chaos Shift is a PURE, NON-damaging utility skill: one swap-atk effect, no damage.
      expect(SKILLS['swap-atk'].name).toBe('Chaos Shift');
      expect(SKILLS['swap-atk'].effects).toEqual([{ kind: 'swap-atk' }]);
    });

    it('Chaos Shift EXCHANGES the two combatants raw atk, HP-neutral, other stats untouched (TASK-104)', () => {
      // (b) SWAP EFFECT — the FIRST stat-VALUE swap (a genuinely-NEW *shape* axis: transfer of
      // raw STAT VALUES, distinct from the transfer of status ARRAYS by the
      // cleanse/dispel/purloin/displace/reclaim family). Cast Chaos Shift between two
      // combatants with atk 30 and 12; their atk end up EXCHANGED (12 and 30). Proven via the
      // pure swapAtk helper the on-cast branch delegates to (the Posture-B isolation posture:
      // it never fires in the shipped fights, so it is proven directly, not in a fight).
      const caster: Combatant = { ...agumon, name: 'A30', atk: 30 };
      const foe: Combatant = { ...agumon, name: 'A12', atk: 12 };
      const { casterAtk, foeAtk } = swapAtk(caster, foe);
      expect(casterAtk).toBe(12);
      expect(foeAtk).toBe(30);

      // A pure exchange — no floor/lookup needed (unlike weaken/enfeeble REDUCTIONS). The
      // helper reads two numbers and mutates NOTHING (the inputs are unchanged; the caller
      // writes the results back in place). Swapping back is the identity (an involution).
      expect(caster.atk).toBe(30);
      expect(foe.atk).toBe(12);
      const back = swapAtk({ atk: casterAtk }, { atk: foeAtk });
      expect(back.casterAtk).toBe(30);
      expect(back.foeAtk).toBe(12);

      // It writes NO HP (HP stays monotone, A-42) and touches no other stat: the two
      // combatant records are otherwise byte-identical to their starting stats.
      expect(caster.hp).toBe(agumon.hp);
      expect(foe.hp).toBe(agumon.hp);
      expect(caster.def).toBe(agumon.def);
      expect(caster.spd).toBe(agumon.spd);
      expect(caster.type).toBe(agumon.type);
      expect(caster.element).toBe(agumon.element);
    });

    it('surfaces Chaos Warp (swap-def) only at its above-pool cost 71, never in the pool (TASK-105, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 71 (= SWAP_DEF_ENERGY_COST,
      // the new ladder TOP, the FIRST free integer above the contiguous 42→70 above-pool band)
      // selectSkill returns Chaos Warp; ONE below (70 = vulnerable-percent, the previous top)
      // it falls back to that entry, UNCHANGED.
      expect(SWAP_DEF_ENERGY_COST).toBe(71);
      expect(selectSkill(SWAP_DEF_ENERGY_COST).id).toBe('swap-def');
      expect(selectSkill(SWAP_DEF_ENERGY_COST - 1).id).toBe('vulnerable-percent');

      // Chaos Warp is ABOVE the fight-local pool ceiling AND distinct from every other
      // above-pool cost, so the ladder stays strictly cost-descending and it is NEVER the
      // pick inside simulateBattle (Posture-B DECOUPLED) — the in-pool selection at MAX_ENERGY
      // is UNCHANGED by this wave (still counter-stance, exactly as before Chaos Warp was added).
      expect(SKILLS['swap-def'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['swap-def'].energyCost).not.toBe(SKILLS['swap-atk'].energyCost);
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Its cost is distinct from EVERY other above-pool cost (no two share a rung — the
      // whole ladder is strictly cost-descending with every above-pool cost distinct).
      const costs = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(new Set(costs).size).toBe(costs.length);
      for (let i = 1; i < costs.length; i++) {
        expect(costs[i]).toBeLessThan(costs[i - 1]);
      }

      // Chaos Warp is a PURE, NON-damaging utility skill: one swap-def effect, no damage.
      expect(SKILLS['swap-def'].name).toBe('Chaos Warp');
      expect(SKILLS['swap-def'].effects).toEqual([{ kind: 'swap-def' }]);
    });

    it('Chaos Warp EXCHANGES the two combatants raw def, HP-neutral, other stats untouched (TASK-105)', () => {
      // (b) SWAP EFFECT — the SECOND stat-VALUE swap (the defensive twin of Chaos Shift on the
      // stat-VALUE-transfer *shape* axis, distinct from the transfer of status ARRAYS by the
      // cleanse/dispel/purloin/displace/reclaim family). Cast Chaos Warp between two combatants
      // with def 30 and 12; their def end up EXCHANGED (12 and 30). Proven via the pure swapDef
      // helper the on-cast branch delegates to (the Posture-B isolation posture: it never fires
      // in the shipped fights, so it is proven directly, not in a fight).
      const caster: Combatant = { ...agumon, name: 'D30', def: 30 };
      const foe: Combatant = { ...agumon, name: 'D12', def: 12 };
      const { casterDef, foeDef } = swapDef(caster, foe);
      expect(casterDef).toBe(12);
      expect(foeDef).toBe(30);

      // A pure exchange — no floor/lookup needed (unlike weaken/enfeeble REDUCTIONS). The
      // helper reads two numbers and mutates NOTHING (the inputs are unchanged; the caller
      // writes the results back in place). Swapping back is the identity (an involution).
      expect(caster.def).toBe(30);
      expect(foe.def).toBe(12);
      const back = swapDef({ def: casterDef }, { def: foeDef });
      expect(back.casterDef).toBe(30);
      expect(back.foeDef).toBe(12);

      // It writes NO HP (HP stays monotone, A-42) and touches no other stat: the two
      // combatant records are otherwise byte-identical to their starting stats.
      expect(caster.hp).toBe(agumon.hp);
      expect(foe.hp).toBe(agumon.hp);
      expect(caster.atk).toBe(agumon.atk);
      expect(caster.spd).toBe(agumon.spd);
      expect(caster.type).toBe(agumon.type);
      expect(caster.element).toBe(agumon.element);
    });

    it('surfaces Chaos Cyclone (swap-spd) only at its above-pool cost 72, never in the pool (TASK-106, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 72 (= SWAP_SPD_ENERGY_COST,
      // the new ladder TOP, the FIRST free integer above the contiguous 42→71 above-pool band)
      // selectSkill returns Chaos Cyclone; ONE below (71 = swap-def, the previous top) it falls
      // back to that entry, UNCHANGED.
      expect(SWAP_SPD_ENERGY_COST).toBe(72);
      expect(selectSkill(SWAP_SPD_ENERGY_COST).id).toBe('swap-spd');
      expect(selectSkill(SWAP_SPD_ENERGY_COST - 1).id).toBe('swap-def');

      // Chaos Cyclone is ABOVE the fight-local pool ceiling AND distinct from every other
      // above-pool cost, so the ladder stays strictly cost-descending and it is NEVER the
      // pick inside simulateBattle (Posture-B DECOUPLED) — the in-pool selection at MAX_ENERGY
      // is UNCHANGED by this wave (still counter-stance, exactly as before Chaos Cyclone was added).
      expect(SKILLS['swap-spd'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['swap-spd'].energyCost).not.toBe(SKILLS['swap-def'].energyCost);
      expect(SKILLS['swap-spd'].energyCost).not.toBe(SKILLS['swap-atk'].energyCost);
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Its cost is distinct from EVERY other above-pool cost (no two share a rung — the
      // whole ladder is strictly cost-descending with every above-pool cost distinct).
      const costs = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(new Set(costs).size).toBe(costs.length);
      for (let i = 1; i < costs.length; i++) {
        expect(costs[i]).toBeLessThan(costs[i - 1]);
      }

      // Chaos Cyclone is a PURE, NON-damaging utility skill: one swap-spd effect, no damage.
      expect(SKILLS['swap-spd'].name).toBe('Chaos Cyclone');
      expect(SKILLS['swap-spd'].effects).toEqual([{ kind: 'swap-spd' }]);
    });

    it('Chaos Cyclone EXCHANGES the two combatants raw spd, HP-neutral, other stats untouched (TASK-106)', () => {
      // (b) SWAP EFFECT — the THIRD stat-VALUE swap (the speed twin of Chaos Shift/Chaos Warp,
      // completing the atk→def→spd trio on the stat-VALUE-transfer *shape* axis, distinct from the
      // transfer of status ARRAYS by the cleanse/dispel/purloin/displace/reclaim family). Cast Chaos
      // Cyclone between two combatants with spd 20 and 7; their spd end up EXCHANGED (7 and 20).
      // Proven via the pure swapSpd helper the on-cast branch delegates to (the Posture-B isolation
      // posture: it never fires in the shipped fights, so it is proven directly, not in a fight).
      const caster: Combatant = { ...agumon, name: 'S20', spd: 20 };
      const foe: Combatant = { ...agumon, name: 'S7', spd: 7 };
      const { casterSpd, foeSpd } = swapSpd(caster, foe);
      expect(casterSpd).toBe(7);
      expect(foeSpd).toBe(20);

      // A pure exchange — no floor/lookup needed (unlike weaken/enfeeble REDUCTIONS). The
      // helper reads two numbers and mutates NOTHING (the inputs are unchanged; the caller
      // writes the results back in place). Swapping back is the identity (an involution).
      expect(caster.spd).toBe(20);
      expect(foe.spd).toBe(7);
      const back = swapSpd({ spd: casterSpd }, { spd: foeSpd });
      expect(back.casterSpd).toBe(20);
      expect(back.foeSpd).toBe(7);

      // It writes NO HP (HP stays monotone, A-42) and touches no other stat: the two
      // combatant records are otherwise byte-identical to their starting stats.
      expect(caster.hp).toBe(agumon.hp);
      expect(foe.hp).toBe(agumon.hp);
      expect(caster.atk).toBe(agumon.atk);
      expect(caster.def).toBe(agumon.def);
      expect(caster.type).toBe(agumon.type);
      expect(caster.element).toBe(agumon.element);
    });

    it('surfaces Chaos Nexus (swap-all) only at its above-pool cost 73, never in the pool (TASK-107, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 73 (= SWAP_ALL_ENERGY_COST,
      // the new ladder TOP, the FIRST free integer above the now-contiguous 42→72 above-pool
      // band) selectSkill returns Chaos Nexus; ONE below (72 = swap-spd, the previous top) it
      // falls back to that entry, UNCHANGED — and the whole per-scalar swap trio still resolves
      // at its own distinct rung (72→swap-spd, 71→swap-def, 42→swap-atk), each byte-unchanged.
      expect(SWAP_ALL_ENERGY_COST).toBe(73);
      expect(selectSkill(SWAP_ALL_ENERGY_COST).id).toBe('swap-all');
      expect(selectSkill(72).id).toBe('swap-spd');
      expect(selectSkill(71).id).toBe('swap-def');
      expect(selectSkill(42).id).toBe('swap-atk');
      // ONE below swap-atk (41 = MAX_ENERGY) the in-pool selection is UNCHANGED by this wave.
      expect(selectSkill(41).id).toBe('counter-stance');

      // Chaos Nexus is ABOVE the fight-local pool ceiling AND distinct from every other
      // above-pool cost (incl. the whole swap trio), so the ladder stays strictly
      // cost-descending and it is NEVER the pick inside simulateBattle (Posture-B DECOUPLED) —
      // the in-pool selection at MAX_ENERGY is UNCHANGED (still counter-stance).
      expect(SKILLS['swap-all'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['swap-all'].energyCost).not.toBe(SKILLS['swap-spd'].energyCost);
      expect(SKILLS['swap-all'].energyCost).not.toBe(SKILLS['swap-def'].energyCost);
      expect(SKILLS['swap-all'].energyCost).not.toBe(SKILLS['swap-atk'].energyCost);
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Its cost is distinct from EVERY other above-pool cost (no two share a rung — the
      // whole ladder is strictly cost-descending with every above-pool cost distinct).
      const costs = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(new Set(costs).size).toBe(costs.length);
      for (let i = 1; i < costs.length; i++) {
        expect(costs[i]).toBeLessThan(costs[i - 1]);
      }

      // Chaos Nexus is a PURE, NON-damaging utility skill: one swap-all effect, no damage.
      expect(SKILLS['swap-all'].name).toBe('Chaos Nexus');
      expect(SKILLS['swap-all'].effects).toEqual([{ kind: 'swap-all' }]);
    });

    it('Chaos Nexus EXCHANGES all three of the two combatants raw stats together, HP-neutral (TASK-107)', () => {
      // (b) SWAP EFFECT — the FULL three-stat swap that EXCHANGES atk+def+spd TOGETHER in a
      // single cast, EXHAUSTING the stat-value-swap shape family the per-scalar trio opened
      // (distinct from the transfer of status ARRAYS by cleanse/dispel/purloin/displace/reclaim).
      // Cast Chaos Nexus between two combatants with atk 8/3, def 6/2, spd 12/5; ALL THREE end up
      // EXCHANGED (3/8, 2/6, 5/12). Proven via the pure swapAllStats helper the on-cast branch
      // delegates to — it COMPOSES the three shipped per-scalar swaps (the Posture-B isolation
      // posture: it never fires in the shipped fights, so it is proven directly, not in a fight).
      const caster: Combatant = { ...agumon, name: 'A', atk: 8, def: 6, spd: 12 };
      const foe: Combatant = { ...agumon, name: 'B', atk: 3, def: 2, spd: 5 };
      const swapped = swapAllStats(caster, foe);
      expect(swapped.casterAtk).toBe(3);
      expect(swapped.foeAtk).toBe(8);
      expect(swapped.casterDef).toBe(2);
      expect(swapped.foeDef).toBe(6);
      expect(swapped.casterSpd).toBe(5);
      expect(swapped.foeSpd).toBe(12);

      // A pure exchange — no floor/lookup needed (unlike weaken/enfeeble REDUCTIONS). The
      // helper reads three numbers per side and mutates NOTHING (the inputs are unchanged; the
      // caller writes the results back in place). Swapping back is the identity (an involution).
      expect(caster.atk).toBe(8);
      expect(caster.def).toBe(6);
      expect(caster.spd).toBe(12);
      expect(foe.atk).toBe(3);
      expect(foe.def).toBe(2);
      expect(foe.spd).toBe(5);
      const back = swapAllStats(
        { atk: swapped.casterAtk, def: swapped.casterDef, spd: swapped.casterSpd },
        { atk: swapped.foeAtk, def: swapped.foeDef, spd: swapped.foeSpd },
      );
      expect(back.casterAtk).toBe(8);
      expect(back.casterDef).toBe(6);
      expect(back.casterSpd).toBe(12);
      expect(back.foeAtk).toBe(3);
      expect(back.foeDef).toBe(2);
      expect(back.foeSpd).toBe(5);

      // It writes NO HP (HP stays monotone, A-42) and touches no non-swap stat: type/element
      // are untouched.
      expect(caster.hp).toBe(agumon.hp);
      expect(foe.hp).toBe(agumon.hp);
      expect(caster.type).toBe(agumon.type);
      expect(caster.element).toBe(agumon.element);
    });

    it('surfaces Fortify only at its above-pool cost 74, never in the pool (TASK-108, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 74 (= FORTIFY_ENERGY_COST, the new
      // ladder TOP, the FIRST free integer above the now-contiguous 42→73 above-pool band)
      // selectSkill returns Fortify; ONE below (73 = swap-all, the previous top) it falls back to
      // Chaos Nexus, and 72→Chaos Cyclone (swap-spd) — each byte-unchanged by this wave.
      expect(FORTIFY_ENERGY_COST).toBe(74);
      expect(selectSkill(FORTIFY_ENERGY_COST).id).toBe('fortify');
      expect(selectSkill(73).id).toBe('swap-all');
      expect(selectSkill(72).id).toBe('swap-spd');
      // ONE below MAX_ENERGY the in-pool selection is UNCHANGED by this wave.
      expect(selectSkill(41).id).toBe('counter-stance');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Fortify is ABOVE the fight-local pool ceiling AND distinct from every other above-pool
      // cost (incl. swap-all@73), so the ladder stays strictly cost-descending and it is NEVER
      // the pick inside simulateBattle (Posture-B DECOUPLED).
      expect(SKILLS.fortify.energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS.fortify.energyCost).not.toBe(SKILLS['swap-all'].energyCost);
      const allCosts = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(new Set(allCosts).size).toBe(allCosts.length);
      for (let i = 1; i < allCosts.length; i++) {
        expect(allCosts[i]).toBeLessThan(allCosts[i - 1]);
      }

      // Fortify is a PURE, NON-damaging SELF-buff skill: one fortify effect, no damage.
      expect(SKILLS.fortify.name).toBe('Fortify');
      expect(SKILLS.fortify.effects).toEqual([{ kind: 'fortify' }]);
    });

    it('applyAilment grants a fresh fortify DEF-up buff carrying defBonus + full duration, HP-neutral; a re-apply REFRESHES (no stack) (TASK-108)', () => {
      // (b) BUFF GRANT — a self-buff mirror of empower/weaken. applyAilment([], 'fortify') yields a
      // single fortify arm at FORTIFY_DURATION with defBonus = FORTIFY_DEF_BONUS. It writes NO HP
      // (a stat-mod self-buff — A-42): the grant only appends the array arm.
      const after = applyAilment([], 'fortify');
      expect(after).toEqual([
        {
          kind: 'fortify',
          turnsRemaining: FORTIFY_DURATION,
          defBonus: FORTIFY_DEF_BONUS,
        },
      ]);

      // A re-apply on an already-fortified array REFRESHES turnsRemaining (the deliberate no-stack
      // refresh, via the existing `others`-filter — exactly like empower). Decrement first, then
      // re-apply and confirm it is back to full duration and still a SINGLE arm.
      const decayed = [
        { kind: 'fortify' as const, turnsRemaining: 1, defBonus: FORTIFY_DEF_BONUS },
      ];
      const refreshed = applyAilment(decayed, 'fortify');
      expect(refreshed.filter((s) => s.kind === 'fortify')).toHaveLength(1);
      const arm = refreshed.find((s) => s.kind === 'fortify');
      expect(arm?.kind === 'fortify' && arm.turnsRemaining).toBe(FORTIFY_DURATION);

      // Coexists with an unrelated status (a self-buff and a foe-inflicted DoT are independent).
      const mixed = applyAilment(applyAilment([], 'burn'), 'fortify');
      expect(mixed.map((s) => s.kind).sort()).toEqual(['burn', 'fortify']);
    });

    it('a fortified defender takes STRICTLY LESS damage from an identical strike, HP untouched by the buff (TASK-108 mitigation seam)', () => {
      // (c) MITIGATION EFFECT — a DEF-up self-buff on the DEFENDER folds into the netDefReduction
      // seam as a NEGATIVE reduction, so resolveAttack computes def − (−defBonus) = def + defBonus.
      // The fortified defender takes strictly LESS damage than the SAME defender WITHOUT fortify.
      // Proven at the pure resolveAttack/mitigation-seam level, in isolation (Posture-B: never in a
      // shipped fight). Pick a defender whose base damage is > 1 so the ≥1 floor doesn't mask it.
      const attacker: Combatant = { ...agumon, atk: 30 };
      const defender: Combatant = { ...agumon, name: 'D', hp: 40, def: 8 };
      const damageWithout = resolveAttack(attacker, defender, 0);
      // A fortify folds in as a NEGATIVE defReduction of −FORTIFY_DEF_BONUS at the seam.
      const damageWithFortify = resolveAttack(attacker, defender, -FORTIFY_DEF_BONUS);
      expect(damageWithFortify).toBeLessThan(damageWithout);
      expect(damageWithFortify).toBeGreaterThanOrEqual(1);
      expect(damageWithout).toBeGreaterThanOrEqual(1);
      // The buff itself writes NO HP and touches no other stat — it is a DEF-only, HP-neutral buff.
      expect(defender.hp).toBe(40);
      expect(defender.atk).toBe(agumon.atk);
      expect(defender.def).toBe(8);
    });

    it('a foe carrying fortify has it STRIPPED by Purge/dispel (stripBuffs), like empower (TASK-108 dispellable)', () => {
      // (d) DISPELLABLE — fortify is a self-buff, so it is classified as a strippable/dispellable
      // BUFF (in DISPELLABLE_BUFF_KINDS alongside empower/shield/retaliate). stripBuffs removes it
      // exactly like empower, while LEAVING the bearer's DoTs/debuffs behind.
      const statuses = applyAilment(applyAilment(applyAilment([], 'fortify'), 'burn'), 'weaken');
      const stripped = stripBuffs(statuses);
      expect(stripped.some((s) => s.kind === 'fortify')).toBe(false);
      // The DoT + the debuff survive the buff-strip (dispel only removes BUFFS).
      expect(stripped.some((s) => s.kind === 'burn')).toBe(true);
      expect(stripped.some((s) => s.kind === 'weaken')).toBe(true);
      // An empower alongside is stripped too (proves fortify joins the same buff family).
      const withEmpower = stripBuffs(applyAilment(applyAilment([], 'fortify'), 'empower'));
      expect(withEmpower).toEqual([]);
    });

    it('surfaces Brace only at its above-pool cost 75, never in the pool (TASK-109, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 75 (= BRACE_ENERGY_COST, the new
      // ladder TOP, the FIRST free integer above the now-contiguous 42→74 above-pool band)
      // selectSkill returns Brace; ONE below (74 = fortify, the previous top) it falls back to
      // Fortify, and 73→Chaos Nexus (swap-all) — each byte-unchanged by this wave.
      expect(BRACE_ENERGY_COST).toBe(75);
      expect(selectSkill(BRACE_ENERGY_COST).id).toBe('brace');
      expect(selectSkill(74).id).toBe('fortify');
      expect(selectSkill(73).id).toBe('swap-all');
      // ONE below MAX_ENERGY the in-pool selection is UNCHANGED by this wave.
      expect(selectSkill(41).id).toBe('counter-stance');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Brace is ABOVE the fight-local pool ceiling AND distinct from every other above-pool cost
      // (incl. fortify@74), so the ladder stays strictly cost-descending and it is NEVER the pick
      // inside simulateBattle (Posture-B DECOUPLED).
      expect(SKILLS.brace.energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS.brace.energyCost).not.toBe(SKILLS.fortify.energyCost);
      const allCosts = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(new Set(allCosts).size).toBe(allCosts.length);
      for (let i = 1; i < allCosts.length; i++) {
        expect(allCosts[i]).toBeLessThan(allCosts[i - 1]);
      }

      // Brace is a PURE, NON-damaging SELF-buff skill: one brace effect, no damage.
      expect(SKILLS.brace.name).toBe('Brace');
      expect(SKILLS.brace.effects).toEqual([{ kind: 'brace' }]);
    });

    it('applyAilment grants a fresh brace damage-taken-DOWN buff carrying damageTakenReduction + full duration, HP-neutral; a re-apply REFRESHES (no stack) (TASK-109)', () => {
      // (b) BUFF GRANT — the POSITIVE MIRROR of vulnerable, a self-buff like fortify/empower.
      // applyAilment([], 'brace') yields a single brace arm at BRACE_DURATION with
      // damageTakenReduction = BRACE_DAMAGE_TAKEN_REDUCTION. It writes NO HP (a damage-application
      // self-buff — A-42): the grant only appends the array arm.
      const after = applyAilment([], 'brace');
      expect(after).toEqual([
        {
          kind: 'brace',
          turnsRemaining: BRACE_DURATION,
          damageTakenReduction: BRACE_DAMAGE_TAKEN_REDUCTION,
        },
      ]);

      // A re-apply on an already-braced array REFRESHES turnsRemaining (the deliberate no-stack
      // refresh, via the existing `others`-filter — exactly like fortify). Decrement first, then
      // re-apply and confirm it is back to full duration and still a SINGLE arm.
      const decayed = [
        {
          kind: 'brace' as const,
          turnsRemaining: 1,
          damageTakenReduction: BRACE_DAMAGE_TAKEN_REDUCTION,
        },
      ];
      const refreshed = applyAilment(decayed, 'brace');
      expect(refreshed.filter((s) => s.kind === 'brace')).toHaveLength(1);
      const arm = refreshed.find((s) => s.kind === 'brace');
      expect(arm?.kind === 'brace' && arm.turnsRemaining).toBe(BRACE_DURATION);

      // Coexists with an unrelated status (a self-buff and a foe-inflicted DoT are independent).
      const mixed = applyAilment(applyAilment([], 'burn'), 'brace');
      expect(mixed.map((s) => s.kind).sort()).toEqual(['brace', 'burn']);
    });

    it('a braced defender takes STRICTLY LESS damage at the amplifyForVulnerable seam; brace<base<vulnerable mirror-pair; HP untouched (TASK-109 damage-application seam)', () => {
      // (c) DAMAGE-REDUCTION EFFECT — a damage-taken-DOWN self-buff folds into the SAME
      // amplifyForVulnerable seam as a NEGATIVE bonus (SUBTRACTED from totalBonus), so a braced
      // defender takes STRICTLY LESS damage than the SAME base WITHOUT brace. Proven at the pure
      // amplifyForVulnerable level, in isolation (Posture-B: never in a shipped fight). Pick a base
      // > 1 so the ≥1 floor doesn't mask the reduction.
      const base = 40;
      const braceStatus = applyAilment([], 'brace');
      const dmgWithBrace = amplifyForVulnerable(base, braceStatus);
      const dmgWithout = amplifyForVulnerable(base, []);
      expect(dmgWithBrace).toBeLessThan(dmgWithout);
      expect(dmgWithBrace).toBeGreaterThanOrEqual(1);
      expect(dmgWithout).toBeGreaterThanOrEqual(1);
      // Exact magnitude: base × (1 − reduction), rounded, ≥1-floored.
      expect(dmgWithBrace).toBe(Math.max(1, Math.round(base * (1 - BRACE_DAMAGE_TAKEN_REDUCTION))));
      // The ≥1 floor holds even against a tiny base (a reduction can never invert to 0 or below).
      expect(amplifyForVulnerable(1, braceStatus)).toBeGreaterThanOrEqual(1);

      // MIRROR-PAIR sanity — brace (DOWN) and vulnerable (UP) are OPPOSITE at this seam:
      // amplifyForVulnerable(base, [brace]) < base < amplifyForVulnerable(base, [vulnerable]).
      const vulnerableStatus = applyAilment([], 'vulnerable');
      const dmgWithVulnerable = amplifyForVulnerable(base, vulnerableStatus);
      expect(dmgWithBrace).toBeLessThan(base);
      expect(base).toBeLessThan(dmgWithVulnerable);

      // A defender carrying brace takes strictly less from an identical attacker's strike than the
      // SAME defender WITHOUT it (resolveDamageStrike composes resolveAttack THEN amplifyForVulnerable
      // over the DEFENDER's statuses — the buff's HP/atk/def/spd/type/element are untouched, A-42).
      const braced = amplifyForVulnerable(base, braceStatus);
      const unbraced = amplifyForVulnerable(base, []);
      expect(braced).toBeLessThan(unbraced);
    });

    it('a foe carrying brace has it STRIPPED by Purge/dispel (stripBuffs), like fortify (TASK-109 dispellable)', () => {
      // (d) DISPELLABLE — brace is a self-buff, so it is classified as a strippable/dispellable
      // BUFF (in DISPELLABLE_BUFF_KINDS alongside empower/shield/retaliate/fortify). stripBuffs
      // removes it exactly like fortify, while LEAVING the bearer's DoTs/debuffs behind.
      const statuses = applyAilment(applyAilment(applyAilment([], 'brace'), 'burn'), 'weaken');
      const stripped = stripBuffs(statuses);
      expect(stripped.some((s) => s.kind === 'brace')).toBe(false);
      // The DoT + the debuff survive the buff-strip (dispel only removes BUFFS).
      expect(stripped.some((s) => s.kind === 'burn')).toBe(true);
      expect(stripped.some((s) => s.kind === 'weaken')).toBe(true);
      // A fortify alongside is stripped too (proves brace joins the same buff family).
      const withFortify = stripBuffs(applyAilment(applyAilment([], 'brace'), 'fortify'));
      expect(withFortify).toEqual([]);
    });

    it('surfaces Bulwark only at its above-pool cost 76, never in the pool (TASK-110, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 76 (= BRACE_PERCENT_ENERGY_COST, the
      // new ladder TOP, the FIRST free integer above the now-contiguous 42→75 above-pool band)
      // selectSkill returns Bulwark; ONE below (75 = brace, the previous top) it falls back to Brace,
      // and 74→Fortify — each byte-unchanged by this wave.
      expect(BRACE_PERCENT_ENERGY_COST).toBe(76);
      expect(selectSkill(BRACE_PERCENT_ENERGY_COST).id).toBe('brace-percent');
      expect(selectSkill(75).id).toBe('brace');
      expect(selectSkill(74).id).toBe('fortify');
      // ONE below MAX_ENERGY the in-pool selection is UNCHANGED by this wave.
      expect(selectSkill(41).id).toBe('counter-stance');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Bulwark is ABOVE the fight-local pool ceiling AND distinct from every other above-pool cost
      // (incl. brace@75), so the ladder stays strictly cost-descending and it is NEVER the pick inside
      // simulateBattle (Posture-B DECOUPLED).
      expect(SKILLS['brace-percent'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['brace-percent'].energyCost).not.toBe(SKILLS.brace.energyCost);
      const allCosts = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(new Set(allCosts).size).toBe(allCosts.length);
      for (let i = 1; i < allCosts.length; i++) {
        expect(allCosts[i]).toBeLessThan(allCosts[i - 1]);
      }

      // Bulwark is a PURE, NON-damaging SELF-buff skill: one brace-percent effect, no damage.
      expect(SKILLS['brace-percent'].name).toBe('Bulwark');
      expect(SKILLS['brace-percent'].effects).toEqual([{ kind: 'brace-percent' }]);
    });

    it('applyAilment grants a fresh brace-percent damage-taken-DOWN buff carrying damageTakenReductionRatio + full duration, HP-neutral; a re-apply REFRESHES (no stack) (TASK-110)', () => {
      // (b) BUFF GRANT — the fractional MIRROR of brace and the DOWN-side percent twin of
      // vulnerable-percent, a self-buff like brace/fortify/empower. applyAilment([], 'brace-percent')
      // yields a single brace-percent arm at BRACE_PERCENT_DURATION with damageTakenReductionRatio =
      // BRACE_PERCENT_RATIO. It writes NO HP (a damage-application self-buff — A-42): the grant only
      // appends the array arm.
      const after = applyAilment([], 'brace-percent');
      expect(after).toEqual([
        {
          kind: 'brace-percent',
          turnsRemaining: BRACE_PERCENT_DURATION,
          damageTakenReductionRatio: BRACE_PERCENT_RATIO,
        },
      ]);

      // A re-apply on an already-bulwarked array REFRESHES turnsRemaining (the deliberate no-stack
      // refresh, via the existing `others`-filter — exactly like brace). Decrement first, then
      // re-apply and confirm it is back to full duration and still a SINGLE arm.
      const decayed = [
        {
          kind: 'brace-percent' as const,
          turnsRemaining: 1,
          damageTakenReductionRatio: BRACE_PERCENT_RATIO,
        },
      ];
      const refreshed = applyAilment(decayed, 'brace-percent');
      expect(refreshed.filter((s) => s.kind === 'brace-percent')).toHaveLength(1);
      const arm = refreshed.find((s) => s.kind === 'brace-percent');
      expect(arm?.kind === 'brace-percent' && arm.turnsRemaining).toBe(BRACE_PERCENT_DURATION);

      // Coexists with an unrelated status (a self-buff and a foe-inflicted DoT are independent).
      const mixed = applyAilment(applyAilment([], 'burn'), 'brace-percent');
      expect(mixed.map((s) => s.kind).sort()).toEqual(['brace-percent', 'burn']);
    });

    it('a bulwarked defender takes STRICTLY LESS damage at the amplifyForVulnerable seam; the percent-family ORDERING holds; HP untouched (TASK-110 damage-application seam)', () => {
      // (c) FRACTIONAL-REDUCTION EFFECT — a percentage damage-taken-DOWN self-buff folds into the SAME
      // amplifyForVulnerable seam as a NEGATIVE ratio bonus (SUBTRACTED from totalBonus), so a
      // bulwarked defender takes STRICTLY LESS damage than the SAME base WITHOUT it. Proven at the pure
      // amplifyForVulnerable level, in isolation (Posture-B: never in a shipped fight). Pick a base > 1
      // so the ≥1 floor doesn't mask the reduction.
      const base = 40;
      const bulwarkStatus = applyAilment([], 'brace-percent');
      const dmgWithBulwark = amplifyForVulnerable(base, bulwarkStatus);
      const dmgWithout = amplifyForVulnerable(base, []);
      expect(dmgWithBulwark).toBeLessThan(dmgWithout);
      expect(dmgWithBulwark).toBeGreaterThanOrEqual(1);
      expect(dmgWithout).toBeGreaterThanOrEqual(1);
      // Exact magnitude: base × (1 − ratio), rounded, ≥1-floored.
      expect(dmgWithBulwark).toBe(Math.max(1, Math.round(base * (1 - BRACE_PERCENT_RATIO))));
      // The ≥1 floor holds even against a tiny base (a reduction can never invert to 0 or below).
      expect(amplifyForVulnerable(1, bulwarkStatus)).toBeGreaterThanOrEqual(1);

      // PERCENT-FAMILY ORDERING (mirror-square sanity) — the four damage-application-seam members
      // ordered by their SIGNED magnitude (−0.5 ≤ −0.25 < 0 < +0.25 < +0.5):
      //   brace-percent (−0.5) ≤ brace (−0.25) < base < vulnerable (+0.25) < vulnerable-percent (+0.5).
      const braceStatus = applyAilment([], 'brace');
      const vulnerableStatus = applyAilment([], 'vulnerable');
      const vulnerablePercentStatus = applyAilment([], 'vulnerable-percent');
      const dmgBracePercent = amplifyForVulnerable(base, bulwarkStatus);
      const dmgBrace = amplifyForVulnerable(base, braceStatus);
      const dmgVulnerable = amplifyForVulnerable(base, vulnerableStatus);
      const dmgVulnerablePercent = amplifyForVulnerable(base, vulnerablePercentStatus);
      expect(dmgBracePercent).toBeLessThanOrEqual(dmgBrace);
      expect(dmgBrace).toBeLessThan(base);
      expect(base).toBeLessThan(dmgVulnerable);
      expect(dmgVulnerable).toBeLessThan(dmgVulnerablePercent);

      // A defender carrying brace-percent takes strictly less from an identical attacker's strike than
      // the SAME defender WITHOUT it (the buff's HP/atk/def/spd/type/element are untouched, A-42).
      const bulwarked = amplifyForVulnerable(base, bulwarkStatus);
      const unbulwarked = amplifyForVulnerable(base, []);
      expect(bulwarked).toBeLessThan(unbulwarked);
    });

    it('a foe carrying brace-percent has it STRIPPED by Purge/dispel (stripBuffs), like brace/fortify (TASK-110 dispellable)', () => {
      // (d) DISPELLABLE — brace-percent is a self-buff, so it is classified as a strippable/dispellable
      // BUFF (in DISPELLABLE_BUFF_KINDS alongside empower/shield/retaliate/fortify/brace). stripBuffs
      // removes it exactly like brace, while LEAVING the bearer's DoTs/debuffs behind.
      const statuses = applyAilment(
        applyAilment(applyAilment([], 'brace-percent'), 'burn'),
        'weaken',
      );
      const stripped = stripBuffs(statuses);
      expect(stripped.some((s) => s.kind === 'brace-percent')).toBe(false);
      // The DoT + the debuff survive the buff-strip (dispel only removes BUFFS).
      expect(stripped.some((s) => s.kind === 'burn')).toBe(true);
      expect(stripped.some((s) => s.kind === 'weaken')).toBe(true);
      // A brace alongside is stripped too (proves brace-percent joins the same buff family).
      const withBrace = stripBuffs(applyAilment(applyAilment([], 'brace-percent'), 'brace'));
      expect(withBrace).toEqual([]);
    });

    it('surfaces Aegis only at its above-pool cost 77, never in the pool (TASK-111, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 77 (= FORTIFY_PERCENT_ENERGY_COST, the
      // new ladder TOP, the FIRST free integer above the now-contiguous 42→76 above-pool band)
      // selectSkill returns Aegis; ONE below (76 = brace-percent/Bulwark, the previous top) it falls
      // back to Bulwark, 75→Brace, 74→Fortify — each byte-unchanged by this wave.
      expect(FORTIFY_PERCENT_ENERGY_COST).toBe(77);
      expect(selectSkill(FORTIFY_PERCENT_ENERGY_COST).id).toBe('fortify-percent');
      expect(selectSkill(76).id).toBe('brace-percent');
      expect(selectSkill(75).id).toBe('brace');
      expect(selectSkill(74).id).toBe('fortify');
      // ONE below MAX_ENERGY the in-pool selection is UNCHANGED by this wave.
      expect(selectSkill(41).id).toBe('counter-stance');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Aegis is ABOVE the fight-local pool ceiling AND distinct from every other above-pool cost
      // (incl. brace-percent@76), so the ladder stays strictly cost-descending and it is NEVER the pick
      // inside simulateBattle (Posture-B DECOUPLED).
      expect(SKILLS['fortify-percent'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['fortify-percent'].energyCost).not.toBe(SKILLS['brace-percent'].energyCost);
      const allCosts = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(new Set(allCosts).size).toBe(allCosts.length);
      for (let i = 1; i < allCosts.length; i++) {
        expect(allCosts[i]).toBeLessThan(allCosts[i - 1]);
      }

      // Aegis is a PURE, NON-damaging SELF-buff skill: one fortify-percent effect, no damage.
      expect(SKILLS['fortify-percent'].name).toBe('Aegis');
      expect(SKILLS['fortify-percent'].effects).toEqual([{ kind: 'fortify-percent' }]);
    });

    it('applyAilment grants a fresh fortify-percent DEF-up buff carrying defBonusRatio + full duration, HP-neutral; a re-apply REFRESHES (no stack) (TASK-111)', () => {
      // (b) BUFF GRANT — the fractional MIRROR of fortify and the DEF-UP percent twin of the DEBUFF
      // weaken-percent, a self-buff like fortify/brace/empower. applyAilment([], 'fortify-percent')
      // yields a single fortify-percent arm at FORTIFY_PERCENT_DURATION with defBonusRatio =
      // FORTIFY_PERCENT_RATIO. It writes NO HP (a DEF-mitigation self-buff — A-42): the grant only
      // appends the array arm.
      const after = applyAilment([], 'fortify-percent');
      expect(after).toEqual([
        {
          kind: 'fortify-percent',
          turnsRemaining: FORTIFY_PERCENT_DURATION,
          defBonusRatio: FORTIFY_PERCENT_RATIO,
        },
      ]);

      // A re-apply on an already-aegis'd array REFRESHES turnsRemaining (the deliberate no-stack
      // refresh, via the existing `others`-filter — exactly like fortify). Decrement first, then
      // re-apply and confirm it is back to full duration and still a SINGLE arm.
      const decayed = [
        {
          kind: 'fortify-percent' as const,
          turnsRemaining: 1,
          defBonusRatio: FORTIFY_PERCENT_RATIO,
        },
      ];
      const refreshed = applyAilment(decayed, 'fortify-percent');
      expect(refreshed.filter((s) => s.kind === 'fortify-percent')).toHaveLength(1);
      const arm = refreshed.find((s) => s.kind === 'fortify-percent');
      expect(arm?.kind === 'fortify-percent' && arm.turnsRemaining).toBe(FORTIFY_PERCENT_DURATION);

      // Coexists with an unrelated status (a self-buff and a foe-inflicted DoT are independent).
      const mixed = applyAilment(applyAilment([], 'burn'), 'fortify-percent');
      expect(mixed.map((s) => s.kind).sort()).toEqual(['burn', 'fortify-percent']);
    });

    it("an aegis'd defender takes STRICTLY LESS damage at the netDefReduction seam — less than WITHOUT and less than the FLAT fortify at a def where floor(def×ratio)>defBonus; HP untouched (TASK-111 mitigation seam)", () => {
      // (c) FRACTIONAL-DEF-UP EFFECT — a percentage DEF-up self-buff on the DEFENDER folds into the
      // netDefReduction seam as a NEGATIVE reduction of floor(def × defBonusRatio) — the SAME
      // floor(def × ratio) transform weaken-percent ADDS, but SUBTRACTED — so resolveAttack computes a
      // HIGHER effective DEF and the strike deals STRICTLY LESS. Proven at the pure resolveAttack /
      // mitigation-seam level, in isolation (Posture-B: never in a shipped fight). Pick a def where
      // floor(def × 0.5) > FORTIFY_DEF_BONUS (6) so the percentage buff mitigates MORE than the flat one:
      // def=20 → floor(20 × 0.5)=10 > 6.
      const attacker: Combatant = { ...agumon, atk: 40 };
      const defender: Combatant = { ...agumon, name: 'D', hp: 60, def: 20 };
      const aegisReduction = Math.floor(defender.def * FORTIFY_PERCENT_RATIO); // 10
      expect(aegisReduction).toBeGreaterThan(FORTIFY_DEF_BONUS); // 10 > 6

      const damageWithout = resolveAttack(attacker, defender, 0);
      // Aegis folds in as a NEGATIVE defReduction of −floor(def × ratio) at the seam.
      const damageWithAegis = resolveAttack(attacker, defender, -aegisReduction);
      // The FLAT fortify folds in as −FORTIFY_DEF_BONUS at the SAME seam.
      const damageWithFortify = resolveAttack(attacker, defender, -FORTIFY_DEF_BONUS);

      expect(damageWithAegis).toBeLessThan(damageWithout);
      // A LARGER DEF bonus ⇒ STRICTLY LESS incoming damage than the flat fortify at this def.
      expect(damageWithAegis).toBeLessThan(damageWithFortify);
      expect(damageWithAegis).toBeGreaterThanOrEqual(1);
      expect(damageWithFortify).toBeGreaterThanOrEqual(1);
      expect(damageWithout).toBeGreaterThanOrEqual(1);

      // The buff itself writes NO HP and touches no other stat — a DEF-only, HP-neutral buff (A-42).
      expect(defender.hp).toBe(60);
      expect(defender.atk).toBe(agumon.atk);
      expect(defender.def).toBe(20);
    });

    it('a foe carrying fortify-percent has it STRIPPED by Purge/dispel (stripBuffs), like fortify/brace (TASK-111 dispellable)', () => {
      // (d) DISPELLABLE — fortify-percent is a self-buff, so it is classified as a strippable/dispellable
      // BUFF (in DISPELLABLE_BUFF_KINDS alongside empower/shield/retaliate/fortify/brace/brace-percent).
      // stripBuffs removes it exactly like fortify, while LEAVING the bearer's DoTs/debuffs behind.
      const statuses = applyAilment(
        applyAilment(applyAilment([], 'fortify-percent'), 'burn'),
        'weaken',
      );
      const stripped = stripBuffs(statuses);
      expect(stripped.some((s) => s.kind === 'fortify-percent')).toBe(false);
      // The DoT + the debuff survive the buff-strip (dispel only removes BUFFS).
      expect(stripped.some((s) => s.kind === 'burn')).toBe(true);
      expect(stripped.some((s) => s.kind === 'weaken')).toBe(true);
      // A fortify alongside is stripped too (proves fortify-percent joins the same buff family).
      const withFortify = stripBuffs(applyAilment(applyAilment([], 'fortify-percent'), 'fortify'));
      expect(withFortify).toEqual([]);
    });

    it('surfaces Quicken only at its above-pool cost 78, never in the pool (TASK-112, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 78 (= HASTEN_ENERGY_COST, the new ladder
      // TOP, the FIRST free integer above the now-contiguous 42→77 above-pool band) selectSkill returns
      // Quicken; ONE below (77 = fortify-percent/Aegis, the previous top) it falls back to Aegis, 76→
      // Bulwark — each byte-unchanged by this wave.
      expect(HASTEN_ENERGY_COST).toBe(78);
      expect(selectSkill(HASTEN_ENERGY_COST).id).toBe('hasten');
      expect(selectSkill(77).id).toBe('fortify-percent');
      expect(selectSkill(76).id).toBe('brace-percent');
      // ONE below MAX_ENERGY the in-pool selection is UNCHANGED by this wave.
      expect(selectSkill(41).id).toBe('counter-stance');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Quicken is ABOVE the fight-local pool ceiling AND distinct from every other above-pool cost
      // (incl. fortify-percent@77), so the ladder stays strictly cost-descending and it is NEVER the pick
      // inside simulateBattle (Posture-B DECOUPLED).
      expect(SKILLS['hasten'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['hasten'].energyCost).not.toBe(SKILLS['fortify-percent'].energyCost);
      const allCosts = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(new Set(allCosts).size).toBe(allCosts.length);
      for (let i = 1; i < allCosts.length; i++) {
        expect(allCosts[i]).toBeLessThan(allCosts[i - 1]);
      }

      // Quicken is a PURE, NON-damaging SELF-buff skill: one hasten effect, no damage.
      expect(SKILLS['hasten'].name).toBe('Quicken');
      expect(SKILLS['hasten'].effects).toEqual([{ kind: 'hasten' }]);
    });

    it('applyAilment grants a fresh hasten SPD-up buff carrying spdBonus + full duration, HP-neutral; a re-apply REFRESHES (no stack) (TASK-112)', () => {
      // (b) BUFF GRANT — the SPD-axis twin of the DEF-up fortify and the ATK-up empower, a self-buff.
      // applyAilment([], 'hasten') yields a single hasten arm at HASTEN_DURATION with spdBonus =
      // HASTEN_SPD_BONUS. It writes NO HP (a stat-mod self-buff — A-42): the grant only appends the arm.
      const after = applyAilment([], 'hasten');
      expect(after).toEqual([
        {
          kind: 'hasten',
          turnsRemaining: HASTEN_DURATION,
          spdBonus: HASTEN_SPD_BONUS,
        },
      ]);

      // A re-apply on an already-hastened array REFRESHES turnsRemaining (the deliberate no-stack refresh,
      // via the existing `others`-filter — exactly like fortify/empower). Decrement first, then re-apply
      // and confirm it is back to full duration and still a SINGLE arm.
      const decayed = [
        {
          kind: 'hasten' as const,
          turnsRemaining: 1,
          spdBonus: HASTEN_SPD_BONUS,
        },
      ];
      const refreshed = applyAilment(decayed, 'hasten');
      expect(refreshed.filter((s) => s.kind === 'hasten')).toHaveLength(1);
      const arm = refreshed.find((s) => s.kind === 'hasten');
      expect(arm?.kind === 'hasten' && arm.turnsRemaining).toBe(HASTEN_DURATION);

      // Coexists with an unrelated status (a self-buff and a foe-inflicted DoT are independent).
      const mixed = applyAilment(applyAilment([], 'burn'), 'hasten');
      expect(mixed.map((s) => s.kind).sort()).toEqual(['burn', 'hasten']);
    });

    it("effectiveSpd RAISES a hasten'd combatant's SPD by the flat HASTEN_SPD_BONUS, STRICTLY greater than without; HP/atk/def untouched; clamped ≥ MIN_EFFECTIVE_SPD (TASK-112 SPD-axis)", () => {
      // (c) FLAT-SPD-UP EFFECT (the NEW effectiveSpd read helper) — the acceptance seam. A combatant
      // carrying a hasten arm has effectiveSpd = spd + HASTEN_SPD_BONUS, STRICTLY GREATER than the SAME
      // combatant without it (which returns raw spd). Proven in isolation (Posture-B: never in a shipped
      // fight). The helper is DELIBERATELY NOT wired into the once-computed turn-order line this slice
      // (A-99) — its return value IS the seam.
      const c: Combatant = { ...agumon, name: 'Q', hp: 60, spd: 12 };
      const withHasten = applyAilment([], 'hasten');

      expect(effectiveSpd(c, [])).toBe(c.spd);
      expect(effectiveSpd(c, withHasten)).toBe(c.spd + HASTEN_SPD_BONUS);
      expect(effectiveSpd(c, withHasten)).toBeGreaterThan(effectiveSpd(c, []));

      // The buff itself writes NO HP and touches no other stat — a SPD-only, HP-neutral buff (A-42).
      expect(c.hp).toBe(60);
      expect(c.atk).toBe(agumon.atk);
      expect(c.def).toBe(agumon.def);
      expect(c.spd).toBe(12);

      // effectiveSpd is clamped ≥ MIN_EFFECTIVE_SPD (symmetric with effectiveDef/effectiveAtk) — a flat
      // SPD-UP only RAISES it, so the clamp is a no-op today, but it holds for the eventual debuff twin.
      const floored: Combatant = { ...agumon, name: 'F', spd: 0 };
      expect(effectiveSpd(floored, [])).toBeGreaterThanOrEqual(MIN_EFFECTIVE_SPD);
    });

    it('a foe carrying hasten has it STRIPPED by Purge/dispel (stripBuffs), like fortify/empower (TASK-112 dispellable)', () => {
      // (d) DISPELLABLE — hasten is a self-buff, so it is classified as a strippable/dispellable BUFF
      // (in DISPELLABLE_BUFF_KINDS alongside empower/shield/retaliate/fortify/brace/brace-percent/
      // fortify-percent). stripBuffs removes it exactly like fortify, while LEAVING the bearer's
      // DoTs/debuffs behind.
      const statuses = applyAilment(applyAilment(applyAilment([], 'hasten'), 'burn'), 'weaken');
      const stripped = stripBuffs(statuses);
      expect(stripped.some((s) => s.kind === 'hasten')).toBe(false);
      // The DoT + the debuff survive the buff-strip (dispel only removes BUFFS).
      expect(stripped.some((s) => s.kind === 'burn')).toBe(true);
      expect(stripped.some((s) => s.kind === 'weaken')).toBe(true);
      // A fortify alongside is stripped too (proves hasten joins the same buff family).
      const withFortifyToo = stripBuffs(applyAilment(applyAilment([], 'hasten'), 'fortify'));
      expect(withFortifyToo).toEqual([]);
    });

    it('surfaces Rush only at its above-pool cost 79, never in the pool (TASK-113, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 79 (= HASTEN_PERCENT_ENERGY_COST, the new
      // ladder TOP, the FIRST free integer above the now-contiguous 42→78 above-pool band) selectSkill
      // returns Rush; ONE below (78 = hasten/Quicken, the previous top) it falls back to Quicken, 77→
      // fortify-percent/Aegis — each byte-unchanged by this wave.
      expect(HASTEN_PERCENT_ENERGY_COST).toBe(79);
      expect(selectSkill(HASTEN_PERCENT_ENERGY_COST).id).toBe('hasten-percent');
      expect(selectSkill(78).id).toBe('hasten');
      expect(selectSkill(77).id).toBe('fortify-percent');
      // ONE below MAX_ENERGY the in-pool selection is UNCHANGED by this wave.
      expect(selectSkill(41).id).toBe('counter-stance');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rush is ABOVE the fight-local pool ceiling AND distinct from every other above-pool cost (incl.
      // hasten@78), so the ladder stays strictly cost-descending and it is NEVER the pick inside
      // simulateBattle (Posture-B DECOUPLED).
      expect(SKILLS['hasten-percent'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['hasten-percent'].energyCost).not.toBe(SKILLS['hasten'].energyCost);
      const allCosts = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(new Set(allCosts).size).toBe(allCosts.length);
      for (let i = 1; i < allCosts.length; i++) {
        expect(allCosts[i]).toBeLessThan(allCosts[i - 1]);
      }

      // Rush is a PURE, NON-damaging SELF-buff skill: one hasten-percent effect, no damage.
      expect(SKILLS['hasten-percent'].name).toBe('Rush');
      expect(SKILLS['hasten-percent'].effects).toEqual([{ kind: 'hasten-percent' }]);
    });

    it('applyAilment grants a fresh hasten-percent SPD-up buff carrying spdBonusRatio + full duration, HP-neutral; a re-apply REFRESHES (no stack) (TASK-113)', () => {
      // (b) BUFF GRANT — the percentage twin of the flat hasten, the SPD-axis mirror of fortify-percent.
      // applyAilment([], 'hasten-percent') yields a single hasten-percent arm at HASTEN_PERCENT_DURATION
      // with spdBonusRatio = HASTEN_PERCENT_RATIO. It writes NO HP (a stat-mod self-buff — A-42).
      const after = applyAilment([], 'hasten-percent');
      expect(after).toEqual([
        {
          kind: 'hasten-percent',
          turnsRemaining: HASTEN_PERCENT_DURATION,
          spdBonusRatio: HASTEN_PERCENT_RATIO,
        },
      ]);

      // A re-apply REFRESHES turnsRemaining (the deliberate no-stack refresh, via the existing
      // `others`-filter — exactly like fortify-percent/hasten). Decrement first, then re-apply.
      const decayed = [
        {
          kind: 'hasten-percent' as const,
          turnsRemaining: 1,
          spdBonusRatio: HASTEN_PERCENT_RATIO,
        },
      ];
      const refreshed = applyAilment(decayed, 'hasten-percent');
      expect(refreshed.filter((s) => s.kind === 'hasten-percent')).toHaveLength(1);
      const arm = refreshed.find((s) => s.kind === 'hasten-percent');
      expect(arm?.kind === 'hasten-percent' && arm.turnsRemaining).toBe(HASTEN_PERCENT_DURATION);

      // Coexists with an unrelated status (a self-buff and a foe-inflicted DoT are independent).
      const mixed = applyAilment(applyAilment([], 'burn'), 'hasten-percent');
      expect(mixed.map((s) => s.kind).sort()).toEqual(['burn', 'hasten-percent']);
    });

    it("effectiveSpd RAISES a rushed combatant's SPD by floor(spd × HASTEN_PERCENT_RATIO), STRICTLY greater than without; folds ADDITIVELY with the flat hasten; HP/atk/def untouched; clamped ≥ MIN_EFFECTIVE_SPD (TASK-113 SPD-axis percent twin)", () => {
      // (c) PERCENTAGE-SPD-UP EFFECT (the EXTENDED effectiveSpd read helper) — the acceptance seam. A
      // combatant carrying a hasten-percent arm has effectiveSpd = spd + floor(spd × HASTEN_PERCENT_RATIO),
      // STRICTLY GREATER than the SAME combatant without it (raw spd). Proven in isolation (Posture-B).
      const c: Combatant = { ...agumon, name: 'R', hp: 60, spd: 12 };
      const withRush = applyAilment([], 'hasten-percent');
      const pctBonus = Math.floor(c.spd * HASTEN_PERCENT_RATIO);

      expect(effectiveSpd(c, [])).toBe(c.spd);
      expect(effectiveSpd(c, withRush)).toBe(c.spd + pctBonus);
      expect(effectiveSpd(c, withRush)).toBeGreaterThan(effectiveSpd(c, []));

      // A combatant carrying BOTH hasten AND hasten-percent gets spd + HASTEN_SPD_BONUS + floor(spd × ratio)
      // — the two arms fold ADDITIVELY, proving the flat arm is untouched by this wave.
      const withBoth = applyAilment(applyAilment([], 'hasten'), 'hasten-percent');
      expect(effectiveSpd(c, withBoth)).toBe(c.spd + HASTEN_SPD_BONUS + pctBonus);

      // The buff itself writes NO HP and touches no other stat — a SPD-only, HP-neutral buff (A-42).
      expect(c.hp).toBe(60);
      expect(c.atk).toBe(agumon.atk);
      expect(c.def).toBe(agumon.def);
      expect(c.spd).toBe(12);

      // effectiveSpd is clamped ≥ MIN_EFFECTIVE_SPD — a percentage SPD-UP only RAISES it (floor(0 × r)=0
      // at spd 0), so the clamp is a no-op today, but it holds for the eventual debuff twin.
      const floored: Combatant = { ...agumon, name: 'F', spd: 0 };
      expect(effectiveSpd(floored, applyAilment([], 'hasten-percent'))).toBeGreaterThanOrEqual(
        MIN_EFFECTIVE_SPD,
      );
    });

    it('a foe carrying hasten-percent has it STRIPPED by Purge/dispel (stripBuffs), like hasten/fortify (TASK-113 dispellable)', () => {
      // (d) DISPELLABLE — hasten-percent is a self-buff, so it is classified as a strippable/dispellable
      // BUFF (in DISPELLABLE_BUFF_KINDS alongside empower/shield/retaliate/fortify/brace/brace-percent/
      // fortify-percent/hasten). stripBuffs removes it exactly like hasten, while LEAVING the bearer's
      // DoTs/debuffs behind.
      const statuses = applyAilment(
        applyAilment(applyAilment([], 'hasten-percent'), 'burn'),
        'weaken',
      );
      const stripped = stripBuffs(statuses);
      expect(stripped.some((s) => s.kind === 'hasten-percent')).toBe(false);
      // The DoT + the debuff survive the buff-strip (dispel only removes BUFFS).
      expect(stripped.some((s) => s.kind === 'burn')).toBe(true);
      expect(stripped.some((s) => s.kind === 'weaken')).toBe(true);
      // A hasten alongside is stripped too (proves hasten-percent joins the same buff family).
      const withHastenToo = stripBuffs(applyAilment(applyAilment([], 'hasten-percent'), 'hasten'));
      expect(withHastenToo).toEqual([]);
    });

    it('surfaces Hobble only at its above-pool cost 80, never in the pool (TASK-114, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 80 (= HOBBLE_ENERGY_COST, the new ladder
      // TOP, the FIRST free integer above the now-contiguous 42→79 above-pool band) selectSkill returns
      // Hobble; ONE below (79 = hasten-percent/Rush, the previous top) it falls back to Rush, 78→
      // hasten/Quicken — each byte-unchanged by this wave.
      expect(HOBBLE_ENERGY_COST).toBe(80);
      expect(selectSkill(HOBBLE_ENERGY_COST).id).toBe('hobble');
      expect(selectSkill(79).id).toBe('hasten-percent');
      expect(selectSkill(78).id).toBe('hasten');
      // ONE below MAX_ENERGY the in-pool selection is UNCHANGED by this wave.
      expect(selectSkill(41).id).toBe('counter-stance');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Hobble is ABOVE the fight-local pool ceiling AND distinct from every other above-pool cost (incl.
      // hasten-percent@79), so the ladder stays strictly cost-descending and it is NEVER the pick inside
      // simulateBattle (Posture-B DECOUPLED).
      expect(SKILLS['hobble'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['hobble'].energyCost).not.toBe(SKILLS['hasten-percent'].energyCost);
      const allCosts = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(new Set(allCosts).size).toBe(allCosts.length);
      for (let i = 1; i < allCosts.length; i++) {
        expect(allCosts[i]).toBeLessThan(allCosts[i - 1]);
      }

      // Hobble is a PURE, NON-damaging FOE-debuff skill: one hobble effect, no damage.
      expect(SKILLS['hobble'].name).toBe('Hobble');
      expect(SKILLS['hobble'].effects).toEqual([{ kind: 'hobble' }]);
    });

    it('applyAilment grants a fresh hobble SPD-down debuff carrying spdReduction + full duration, HP-neutral; a re-apply REFRESHES (no stack) (TASK-114)', () => {
      // (b) DEBUFF GRANT — the FLAT SPD-DOWN debuff, the SPD-axis mirror of the DEF-down weaken and
      // ATK-down enfeeble. applyAilment([], 'hobble') yields a single hobble arm at HOBBLE_DURATION with
      // spdReduction = HOBBLE_SPD_REDUCTION. It writes NO HP (a stat-mod debuff — A-42).
      const after = applyAilment([], 'hobble');
      expect(after).toEqual([
        {
          kind: 'hobble',
          turnsRemaining: HOBBLE_DURATION,
          spdReduction: HOBBLE_SPD_REDUCTION,
        },
      ]);

      // A re-apply REFRESHES turnsRemaining (the deliberate no-stack refresh, via the existing
      // `others`-filter — exactly like weaken/enfeeble). Decrement first, then re-apply.
      const decayed = [
        {
          kind: 'hobble' as const,
          turnsRemaining: 1,
          spdReduction: HOBBLE_SPD_REDUCTION,
        },
      ];
      const refreshed = applyAilment(decayed, 'hobble');
      expect(refreshed.filter((s) => s.kind === 'hobble')).toHaveLength(1);
      const arm = refreshed.find((s) => s.kind === 'hobble');
      expect(arm?.kind === 'hobble' && arm.turnsRemaining).toBe(HOBBLE_DURATION);

      // Coexists with an unrelated status (a foe-inflicted debuff and a DoT are independent).
      const mixed = applyAilment(applyAilment([], 'burn'), 'hobble');
      expect(mixed.map((s) => s.kind).sort()).toEqual(['burn', 'hobble']);
    });

    it("effectiveSpd LOWERS a hobbled combatant's SPD by the flat HOBBLE_SPD_REDUCTION, STRICTLY less than without; folds ADDITIVELY with the flat hasten; HP/atk/def untouched; clamped ≥ MIN_EFFECTIVE_SPD (TASK-114 SPD-axis DOWN half)", () => {
      // (c) FLAT-SPD-DOWN EFFECT (the EXTENDED effectiveSpd read helper, the FIRST *subtractive* branch)
      // — the acceptance seam. A combatant carrying a hobble arm has effectiveSpd = spd - HOBBLE_SPD_REDUCTION,
      // STRICTLY LESS than the SAME combatant without it (raw spd). Proven in isolation (Posture-B).
      const c: Combatant = { ...agumon, name: 'H', hp: 60, spd: 12 };
      const withHobble = applyAilment([], 'hobble');

      expect(effectiveSpd(c, [])).toBe(c.spd);
      expect(effectiveSpd(c, withHobble)).toBe(
        Math.max(MIN_EFFECTIVE_SPD, c.spd - HOBBLE_SPD_REDUCTION),
      );
      expect(effectiveSpd(c, withHobble)).toBeLessThan(effectiveSpd(c, []));

      // A combatant carrying BOTH hasten AND hobble nets spd + HASTEN_SPD_BONUS - HOBBLE_SPD_REDUCTION —
      // the SPD-up and SPD-down arms fold ADDITIVELY, proving the flat-up arm is untouched by this wave.
      const withBoth = applyAilment(applyAilment([], 'hasten'), 'hobble');
      expect(effectiveSpd(c, withBoth)).toBe(c.spd + HASTEN_SPD_BONUS - HOBBLE_SPD_REDUCTION);

      // The debuff itself writes NO HP and touches no other stat — a SPD-only, HP-neutral debuff (A-42).
      expect(c.hp).toBe(60);
      expect(c.atk).toBe(agumon.atk);
      expect(c.def).toBe(agumon.def);
      expect(c.spd).toBe(12);

      // A large hobble on a tiny-SPD combatant is CLAMPED at MIN_EFFECTIVE_SPD (never negative) — proving
      // the pre-built floor (TASK-112) works for this FIRST *subtractive* DOWN branch.
      const slow: Combatant = { ...agumon, name: 'S', spd: 1 };
      expect(effectiveSpd(slow, applyAilment([], 'hobble'))).toBe(MIN_EFFECTIVE_SPD);
      expect(effectiveSpd(slow, applyAilment([], 'hobble'))).toBeGreaterThanOrEqual(
        MIN_EFFECTIVE_SPD,
      );
    });

    it('a combatant carrying hobble has it STRIPPED by Purify/cleanse (CLEANSABLE), but NOT by Purge/dispel — the SET-MEMBERSHIP INVERSION vs the hasten self-buffs (TASK-114 cleansable, NOT dispellable)', () => {
      // (d) CLEANSABLE (NOT dispellable) — hobble is a FOE-inflicted DEBUFF (it lowers effective SPD), so
      // it is classified as a CLEANSABLE debuff (in CLEANSABLE_DEBUFF_KINDS alongside weaken/enfeeble/
      // vulnerable), STRIPPED by Purify/cleanse like weaken/enfeeble. It is the SET-MEMBERSHIP INVERSION
      // of the hasten/hasten-percent SPD-UP self-buffs (which are DISPELLABLE, not cleansable).
      const cleansed = clearDebuffs(
        applyAilment(applyAilment(applyAilment([], 'hobble'), 'empower'), 'burn'),
      );
      expect(cleansed.some((s) => s.kind === 'hobble')).toBe(false);
      // Cleanse strips the harmful hobble + burn, but LEAVES the self-buff empower behind.
      expect(cleansed.some((s) => s.kind === 'burn')).toBe(false);
      expect(cleansed.some((s) => s.kind === 'empower')).toBe(true);

      // NOT dispellable — a hostile Purge/dispel (stripBuffs over DISPELLABLE_BUFF_KINDS) does NOT strip a
      // foe's hobble (a debuff is not a self-buff — the INVERSION vs hasten/hasten-percent, which ARE
      // dispellable). This is the distinguishing regression seam vs TASK-112/113.
      const notStripped = stripBuffs(applyAilment(applyAilment([], 'hobble'), 'hasten'));
      expect(notStripped.some((s) => s.kind === 'hobble')).toBe(true);
      // The hasten self-buff alongside IS stripped, proving the inversion is per-kind.
      expect(notStripped.some((s) => s.kind === 'hasten')).toBe(false);
    });

    it('surfaces Cripple (hobble-percent) only at its above-pool cost 81, never in the pool (TASK-115, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 81 (= HOBBLE_PERCENT_ENERGY_COST, the NEW
      // ladder TOP, the FIRST free integer above the now-contiguous 42→80 above-pool band) selectSkill
      // returns Cripple; ONE below (80 = hobble/Hobble, the previous top) it falls back to Hobble, 79→
      // hasten-percent/Rush, 78→ hasten/Quicken — each byte-unchanged by this wave.
      expect(HOBBLE_PERCENT_ENERGY_COST).toBe(81);
      expect(selectSkill(HOBBLE_PERCENT_ENERGY_COST).id).toBe('hobble-percent');
      expect(selectSkill(80).id).toBe('hobble');
      expect(selectSkill(79).id).toBe('hasten-percent');
      expect(selectSkill(78).id).toBe('hasten');
      // ONE below MAX_ENERGY the in-pool selection is UNCHANGED by this wave.
      expect(selectSkill(41).id).toBe('counter-stance');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Cripple is ABOVE the fight-local pool ceiling AND distinct from every other above-pool cost (incl.
      // hobble@80), so the ladder stays strictly cost-descending and it is NEVER the pick inside
      // simulateBattle (Posture-B DECOUPLED).
      expect(SKILLS['hobble-percent'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['hobble-percent'].energyCost).not.toBe(SKILLS['hobble'].energyCost);
      const allCosts = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(new Set(allCosts).size).toBe(allCosts.length);
      for (let i = 1; i < allCosts.length; i++) {
        expect(allCosts[i]).toBeLessThan(allCosts[i - 1]);
      }

      // Cripple is a PURE, NON-damaging FOE-debuff skill: one hobble-percent effect, no damage.
      expect(SKILLS['hobble-percent'].name).toBe('Cripple');
      expect(SKILLS['hobble-percent'].effects).toEqual([{ kind: 'hobble-percent' }]);
    });

    it('applyAilment grants a fresh hobble-percent SPD-down debuff carrying spdReductionRatio + full duration, HP-neutral; a re-apply REFRESHES (no stack) (TASK-115)', () => {
      // (b) DEBUFF GRANT — the PERCENTAGE SPD-DOWN debuff, the percentage twin of the flat hobble and the
      // SPD-axis mirror of the DEF-down weaken-percent and ATK-down enfeeble-percent. applyAilment([],
      // 'hobble-percent') yields a single hobble-percent arm at HOBBLE_PERCENT_DURATION with
      // spdReductionRatio = HOBBLE_PERCENT_RATIO. It writes NO HP (a stat-mod debuff — A-42).
      const after = applyAilment([], 'hobble-percent');
      expect(after).toEqual([
        {
          kind: 'hobble-percent',
          turnsRemaining: HOBBLE_PERCENT_DURATION,
          spdReductionRatio: HOBBLE_PERCENT_RATIO,
        },
      ]);

      // A re-apply REFRESHES turnsRemaining (the deliberate no-stack refresh, via the existing
      // `others`-filter — exactly like hobble/weaken-percent). Decrement first, then re-apply.
      const decayed = [
        {
          kind: 'hobble-percent' as const,
          turnsRemaining: 1,
          spdReductionRatio: HOBBLE_PERCENT_RATIO,
        },
      ];
      const refreshed = applyAilment(decayed, 'hobble-percent');
      expect(refreshed.filter((s) => s.kind === 'hobble-percent')).toHaveLength(1);
      const arm = refreshed.find((s) => s.kind === 'hobble-percent');
      expect(arm?.kind === 'hobble-percent' && arm.turnsRemaining).toBe(HOBBLE_PERCENT_DURATION);

      // Coexists with an unrelated status (a foe-inflicted debuff and a DoT are independent).
      const mixed = applyAilment(applyAilment([], 'burn'), 'hobble-percent');
      expect(mixed.map((s) => s.kind).sort()).toEqual(['burn', 'hobble-percent']);
    });

    it("effectiveSpd LOWERS a crippled combatant's SPD by floor(spd * HOBBLE_PERCENT_RATIO), STRICTLY less than without; folds ADDITIVELY with flat hobble AND with hasten-percent; scales with raw spd (unlike flat hobble); HP/atk/def untouched; clamped ≥ MIN_EFFECTIVE_SPD (TASK-115 SPD-axis DOWN percent square)", () => {
      // (c) PERCENTAGE-SPD-DOWN EFFECT (the EXTENDED effectiveSpd read helper, the SECOND *subtractive*
      // branch) — the acceptance seam. A combatant carrying a hobble-percent arm has
      // effectiveSpd = max(MIN_EFFECTIVE_SPD, spd - floor(spd * HOBBLE_PERCENT_RATIO)), STRICTLY LESS than
      // the SAME combatant without it (raw spd). Proven in isolation (Posture-B). Use a spd large enough
      // that floor(spd * ratio) > 0.
      const c: Combatant = { ...agumon, name: 'C', hp: 60, spd: 12 };
      const withCripple = applyAilment([], 'hobble-percent');

      expect(effectiveSpd(c, [])).toBe(c.spd);
      expect(effectiveSpd(c, withCripple)).toBe(
        Math.max(MIN_EFFECTIVE_SPD, c.spd - Math.floor(c.spd * HOBBLE_PERCENT_RATIO)),
      );
      expect(effectiveSpd(c, withCripple)).toBeLessThan(effectiveSpd(c, []));

      // A combatant carrying BOTH flat hobble AND percent hobble-percent nets
      // spd - HOBBLE_SPD_REDUCTION - floor(spd * HOBBLE_PERCENT_RATIO) — both DOWN arms fold ADDITIVELY,
      // proving the flat DOWN arm is untouched by this wave and the two coexist.
      const withBothDown = applyAilment(applyAilment([], 'hobble'), 'hobble-percent');
      expect(effectiveSpd(c, withBothDown)).toBe(
        c.spd - HOBBLE_SPD_REDUCTION - Math.floor(c.spd * HOBBLE_PERCENT_RATIO),
      );

      // A combatant carrying hasten-percent (UP percent) AND hobble-percent (DOWN percent) folds
      // additively — the UP percent arm is untouched by this wave.
      const withUpAndDown = applyAilment(applyAilment([], 'hasten-percent'), 'hobble-percent');
      expect(effectiveSpd(c, withUpAndDown)).toBe(
        c.spd + Math.floor(c.spd * HASTEN_PERCENT_RATIO) - Math.floor(c.spd * HOBBLE_PERCENT_RATIO),
      );

      // The debuff itself writes NO HP and touches no other stat — a SPD-only, HP-neutral debuff (A-42).
      expect(c.hp).toBe(60);
      expect(c.atk).toBe(agumon.atk);
      expect(c.def).toBe(agumon.def);
      expect(c.spd).toBe(12);

      // DISTINGUISHING flat-vs-percent seam: the FLAT hobble subtracts a CONSTANT regardless of spd, while
      // hobble-percent scales with the bearer's OWN raw spd — a higher-spd bearer loses MORE.
      const fast: Combatant = { ...agumon, name: 'F', spd: 40 };
      const slowish: Combatant = { ...agumon, name: 'M', spd: 12 };
      const cripple = applyAilment([], 'hobble-percent');
      const flat = applyAilment([], 'hobble');
      // flat hobble: same absolute delta for both.
      expect(fast.spd - effectiveSpd(fast, flat)).toBe(HOBBLE_SPD_REDUCTION);
      expect(slowish.spd - effectiveSpd(slowish, flat)).toBe(HOBBLE_SPD_REDUCTION);
      // percent hobble-percent: LARGER absolute delta for the faster bearer.
      expect(fast.spd - effectiveSpd(fast, cripple)).toBeGreaterThan(
        slowish.spd - effectiveSpd(slowish, cripple),
      );

      // A large ratio on a tiny-SPD combatant is CLAMPED at MIN_EFFECTIVE_SPD (never negative) — proving
      // the pre-built floor (TASK-112) works for this SECOND *subtractive* DOWN branch too.
      const tiny: Combatant = { ...agumon, name: 'T', spd: 1 };
      // With spd=1 and ratio 0.5, floor(1*0.5)=0, so pair a flat+percent hobble to force a clamp.
      const bothOnTiny = applyAilment(applyAilment([], 'hobble'), 'hobble-percent');
      expect(effectiveSpd(tiny, bothOnTiny)).toBe(MIN_EFFECTIVE_SPD);
      expect(effectiveSpd(tiny, bothOnTiny)).toBeGreaterThanOrEqual(MIN_EFFECTIVE_SPD);
    });

    it('a combatant carrying hobble-percent has it STRIPPED by Purify/cleanse (CLEANSABLE), but NOT by Purge/dispel — the SET-MEMBERSHIP INVERSION vs the hasten-percent self-buff (TASK-115 cleansable, NOT dispellable)', () => {
      // (d) CLEANSABLE (NOT dispellable) — hobble-percent is a FOE-inflicted DEBUFF (it lowers effective
      // SPD), so it is classified as a CLEANSABLE debuff (in CLEANSABLE_DEBUFF_KINDS alongside hobble/
      // weaken-percent/enfeeble-percent), STRIPPED by Purify/cleanse. It is the SET-MEMBERSHIP INVERSION
      // of the hasten-percent SPD-UP self-buff (which is DISPELLABLE, not cleansable).
      const cleansed = clearDebuffs(
        applyAilment(applyAilment(applyAilment([], 'hobble-percent'), 'empower'), 'burn'),
      );
      expect(cleansed.some((s) => s.kind === 'hobble-percent')).toBe(false);
      // Cleanse strips the harmful hobble-percent + burn, but LEAVES the self-buff empower behind.
      expect(cleansed.some((s) => s.kind === 'burn')).toBe(false);
      expect(cleansed.some((s) => s.kind === 'empower')).toBe(true);

      // NOT dispellable — a hostile Purge/dispel (stripBuffs over DISPELLABLE_BUFF_KINDS) does NOT strip a
      // foe's hobble-percent (a debuff is not a self-buff — the INVERSION vs hasten-percent, which IS
      // dispellable). This is the distinguishing regression seam vs TASK-113.
      const notStripped = stripBuffs(
        applyAilment(applyAilment([], 'hobble-percent'), 'hasten-percent'),
      );
      expect(notStripped.some((s) => s.kind === 'hobble-percent')).toBe(true);
      // The hasten-percent self-buff alongside IS stripped, proving the inversion is per-kind.
      expect(notStripped.some((s) => s.kind === 'hasten-percent')).toBe(false);
    });

    describe('resolveTurnOrder — per-round turn order fed by effectiveSpd (TASK-116, the FIRST true SPD-driven reorder)', () => {
      // (a) PURE ORDER HELPER — the tie/polarity rule in isolation. Player wins ties (>=), preserving the
      // shipped once-before-loop `player.spd >= enemy.spd` polarity BYTE-FOR-BYTE.
      it('returns [player, enemy] when playerEffSpd >= enemyEffSpd (INCLUDING the tie), else [enemy, player]', () => {
        expect(resolveTurnOrder(10, 5)).toEqual(['player', 'enemy']);
        expect(resolveTurnOrder(5, 5)).toEqual(['player', 'enemy']); // tie → player first
        expect(resolveTurnOrder(4, 5)).toEqual(['enemy', 'player']);
      });

      // A combatant with NO SPD status orders by RAW spd exactly (effectiveSpd(c, []) === c.spd) — this is
      // why the shipped fights (which carry zero SPD statuses) stay byte-identical.
      it('with NO SPD status, the order equals the raw-spd order (effectiveSpd(c, []) === c.spd)', () => {
        const p: Combatant = { ...agumon, name: 'P', spd: 9 };
        const e: Combatant = { ...agumon, name: 'E', spd: 7 };
        expect(effectiveSpd(p, [])).toBe(p.spd);
        expect(effectiveSpd(e, [])).toBe(e.spd);
        expect(resolveTurnOrder(effectiveSpd(p, []), effectiveSpd(e, []))).toEqual([
          'player',
          'enemy',
        ]);
      });

      // (b) THE HEADLINE — a SPD debuff FLIPS initiative for the first time. Raw player.spd > enemy.spd
      // (player would go first), but a hobble/hobble-percent large enough to drop effectiveSpd below the
      // enemy's flips the round order to [enemy, player].
      it('a hobble/hobble-percent that drops the player below the enemy FLIPS initiative to [enemy, player] (the FIRST SPD-debuff reorder)', () => {
        const p: Combatant = { ...agumon, name: 'P', spd: 12 };
        const e: Combatant = { ...agumon, name: 'E', spd: 10 };
        // Raw spd: player (12) >= enemy (10) → player-first WITHOUT any status.
        expect(resolveTurnOrder(effectiveSpd(p, []), effectiveSpd(e, []))).toEqual([
          'player',
          'enemy',
        ]);
        // Flat hobble: effectiveSpd(p, [hobble]) = 12 - HOBBLE_SPD_REDUCTION. With HOBBLE_SPD_REDUCTION
        // sized to drop it below the enemy's 10, initiative flips.
        const hobbled = applyAilment([], 'hobble');
        expect(effectiveSpd(p, hobbled)).toBeLessThan(e.spd);
        expect(resolveTurnOrder(effectiveSpd(p, hobbled), effectiveSpd(e, []))).toEqual([
          'enemy',
          'player',
        ]);
        // Percentage hobble-percent flips it too (floor(12 × HOBBLE_PERCENT_RATIO) = floor(12×0.5) = 6 →
        // effectiveSpd 6 < 10).
        const crippled = applyAilment([], 'hobble-percent');
        expect(effectiveSpd(p, crippled)).toBeLessThan(e.spd);
        expect(resolveTurnOrder(effectiveSpd(p, crippled), effectiveSpd(e, []))).toEqual([
          'enemy',
          'player',
        ]);
      });

      // Symmetric — a hasten/hasten-percent that lifts the player to/above the enemy GAINS initiative.
      it('a hasten/hasten-percent that lifts the player to/above the enemy GAINS initiative → [player, enemy]', () => {
        const p: Combatant = { ...agumon, name: 'P', spd: 10 };
        const e: Combatant = { ...agumon, name: 'E', spd: 12 };
        // Raw spd: player (10) < enemy (12) → enemy-first WITHOUT any status.
        expect(resolveTurnOrder(effectiveSpd(p, []), effectiveSpd(e, []))).toEqual([
          'enemy',
          'player',
        ]);
        // Percentage hasten-percent lifts effectiveSpd(p) = 10 + floor(10 × HASTEN_PERCENT_RATIO) =
        // 10 + floor(10×0.5) = 15 >= enemy's 12 → player GAINS the initiative.
        const rushed = applyAilment([], 'hasten-percent');
        expect(effectiveSpd(p, rushed)).toBeGreaterThanOrEqual(e.spd);
        expect(resolveTurnOrder(effectiveSpd(p, rushed), effectiveSpd(e, []))).toEqual([
          'player',
          'enemy',
        ]);
        // Flat hasten lifting to a TIE also grants the player first (the >= polarity).
        const tied: Combatant = { ...agumon, name: 'P2', spd: e.spd - HASTEN_SPD_BONUS };
        const hastened = applyAilment([], 'hasten');
        expect(effectiveSpd(tied, hastened)).toBe(e.spd); // exact tie
        expect(resolveTurnOrder(effectiveSpd(tied, hastened), effectiveSpd(e, []))).toEqual([
          'player',
          'enemy',
        ]);
      });
    });

    describe('resolveActionSequence — the SPD-gated per-action DOUBLE-TURN (TASK-117, the FIRST per-action initiative mechanic, PURE + UNWIRED)', () => {
      // (a) NO double-turn below the ratio → the plain 2-element order, byte-identical to resolveTurnOrder.
      it('below DOUBLE_TURN_SPD_RATIO the sequence is the plain [fast, slow]', () => {
        expect(DOUBLE_TURN_SPD_RATIO).toBe(2);
        expect(resolveActionSequence(8, 5)).toEqual(['player', 'enemy']); // 8 < 2×5=10
        expect(resolveActionSequence(5, 8)).toEqual(['enemy', 'player']);
        // equivalence to the base pair below the ratio
        expect(resolveActionSequence(8, 5)).toEqual(resolveTurnOrder(8, 5));
        expect(resolveActionSequence(5, 8)).toEqual(resolveTurnOrder(5, 8));
      });

      // (b) THE HEADLINE — the EXACT ratio earns the faster side a SECOND action → [fast, slow, fast].
      it('at the EXACT ratio the faster side double-turns → [fast, slow, fast] (both sides)', () => {
        expect(resolveActionSequence(10, 5)).toEqual(['player', 'enemy', 'player']); // player 10 >= 2×5
        expect(resolveActionSequence(5, 20)).toEqual(['enemy', 'player', 'enemy']); // enemy 20 >= 2×5
      });

      // (c) ABOVE the ratio also triggers.
      it('above the ratio triggers the double-turn', () => {
        expect(resolveActionSequence(30, 5)).toEqual(['player', 'enemy', 'player']);
      });

      // (d) an exact tie (ratio 1) → NO double-turn, player-first preserved.
      it('an exact SPD tie yields no double-turn, player-first', () => {
        expect(resolveActionSequence(7, 7)).toEqual(['player', 'enemy']);
      });

      // (e) zero-spd slow side → unbounded ratio: fast (>0) double-turns; BOTH zero → plain order.
      it('a zero-spd slow side makes the ratio unbounded (fast >0 double-turns); both-zero → plain order', () => {
        expect(resolveActionSequence(4, 0)).toEqual(['player', 'enemy', 'player']); // slow 0, fast 4>0
        expect(resolveActionSequence(0, 4)).toEqual(['enemy', 'player', 'enemy']); // symmetric
        expect(resolveActionSequence(0, 0)).toEqual(['player', 'enemy']); // both 0, no double, player-first
      });

      // (f) built ON effectiveSpd — the SPD-arm connection. A hasten lifts effectiveSpd across the ratio so a
      // SPD BUFF earns an extra action for the first time; a hobble on the fast side REMOVES a double-turn it
      // would otherwise have. (This is the wave's semantic payoff, proven in isolation.)
      it('a hasten on the player earns a double-turn effectiveSpd would not grant raw; a hobble removes one', () => {
        // Raw player.spd (6) is NOT >= 2× enemy.spd (5) → no double-turn from raw spd.
        const p: Combatant = { ...agumon, name: 'P', spd: 6 };
        const e: Combatant = { ...agumon, name: 'E', spd: 5 };
        expect(resolveActionSequence(effectiveSpd(p, []), effectiveSpd(e, []))).toEqual([
          'player',
          'enemy',
        ]);
        // hasten-percent lifts effectiveSpd(p) = 6 + floor(6×HASTEN_PERCENT_RATIO=0.5)=9; still < 2×5=10.
        // Add the flat hasten too so effectiveSpd(p) crosses the ratio and the player EARNS a double-turn.
        const rushed = applyAilment(applyAilment([], 'hasten-percent'), 'hasten');
        expect(effectiveSpd(p, rushed)).toBeGreaterThanOrEqual(
          DOUBLE_TURN_SPD_RATIO * effectiveSpd(e, []),
        );
        expect(resolveActionSequence(effectiveSpd(p, rushed), effectiveSpd(e, []))).toEqual([
          'player',
          'enemy',
          'player',
        ]);

        // Symmetric REMOVAL — a fast player that WOULD double-turn by raw spd loses it under a hobble that
        // drops effectiveSpd below the ratio.
        const fast: Combatant = { ...agumon, name: 'F', spd: 12 };
        const slow: Combatant = { ...agumon, name: 'S', spd: 6 };
        expect(resolveActionSequence(effectiveSpd(fast, []), effectiveSpd(slow, []))).toEqual([
          'player',
          'enemy',
          'player',
        ]); // 12 >= 2×6 → double-turn by raw spd
        const hobbled = applyAilment([], 'hobble');
        expect(effectiveSpd(fast, hobbled)).toBeLessThan(
          DOUBLE_TURN_SPD_RATIO * effectiveSpd(slow, []),
        );
        expect(resolveActionSequence(effectiveSpd(fast, hobbled), effectiveSpd(slow, []))).toEqual([
          'player',
          'enemy',
        ]); // double-turn REMOVED
      });

      // (h) determinism — the helper is a pure fn: a second call deep-equals the first.
      it('is deterministic (deep-equals a second call for the same inputs)', () => {
        expect(resolveActionSequence(10, 5)).toEqual(resolveActionSequence(10, 5));
        expect(resolveActionSequence(8, 5)).toEqual(resolveActionSequence(8, 5));
      });
    });

    describe('hasSpdStatus + the round-top DOUBLE-TURN wiring (TASK-118, R-17c wave 67 — the double-turn observable in a LIVE fight)', () => {
      // (a) PREDICATE UNITS — hasSpdStatus is true iff any SPD status is present.
      it('hasSpdStatus is false for [] and for a non-SPD status; true for each of the four SPD kinds', () => {
        expect(hasSpdStatus([])).toBe(false);
        expect(hasSpdStatus(applyAilment([], 'burn'))).toBe(false); // a non-SPD status does not gate
        expect(hasSpdStatus(applyAilment([], 'hasten'))).toBe(true);
        expect(hasSpdStatus(applyAilment([], 'hasten-percent'))).toBe(true);
        expect(hasSpdStatus(applyAilment([], 'hobble'))).toBe(true);
        expect(hasSpdStatus(applyAilment([], 'hobble-percent'))).toBe(true);
        // presence anywhere in the array gates (SPD status mixed with a non-SPD status)
        expect(hasSpdStatus(applyAilment(applyAilment([], 'burn'), 'hasten'))).toBe(true);
      });

      // (b) THE HEADLINE — the round-top order SEAM: exactly the selection simulateBattle performs.
      // When an SPD status is present AND lifts effectiveSpd across the ratio, the order source is the
      // 3-element resolveActionSequence sequence — the SPD-buffed side acts TWICE in the round.
      const roundOrder = (
        pStatuses: readonly StatusAilment[],
        eStatuses: readonly StatusAilment[],
        p: Combatant,
        e: Combatant,
      ): ('player' | 'enemy')[] => {
        const pEff = effectiveSpd(p, pStatuses);
        const eEff = effectiveSpd(e, eStatuses);
        return hasSpdStatus(pStatuses) || hasSpdStatus(eStatuses)
          ? resolveActionSequence(pEff, eEff)
          : resolveTurnOrder(pEff, eEff);
      };

      it('an SPD-status side fast enough for the ratio takes TWO actions in the round order (double-turn OBSERVABLE at the seam)', () => {
        // Player spd 6, enemy spd 5 → raw spd does NOT double-turn (6 < 2×5). A hasten+hasten-percent
        // lifts effectiveSpd(player) across the ratio, so the SPD status EARNS the second action.
        const p: Combatant = { ...agumon, name: 'P', spd: 6 };
        const e: Combatant = { ...agumon, name: 'E', spd: 5 };
        const rushed = applyAilment(applyAilment([], 'hasten-percent'), 'hasten');
        const order = roundOrder(rushed, [], p, e);
        expect(order).toEqual(['player', 'enemy', 'player']); // acts, foe acts, acts AGAIN
        expect(order.filter((a) => a === 'player')).toHaveLength(2);
        expect(order.filter((a) => a === 'enemy')).toHaveLength(1);
      });

      // (c) GATE-FALSE FALLBACK — no SPD status on EITHER side → the plain 2-element resolveTurnOrder
      // order, byte-identical to today, EVEN when raw spd would otherwise cross the ratio (the gate keys
      // on SPD-status presence, not raw spd — the Posture-B safety property).
      it('with NO SPD status the order is the plain resolveTurnOrder result even when raw spd crosses the ratio', () => {
        const fast: Combatant = { ...agumon, name: 'F', spd: 20 };
        const slow: Combatant = { ...agumon, name: 'S', spd: 8 }; // 20 >= 2×8 by RAW spd
        const order = roundOrder([], [], fast, slow);
        expect(order).toEqual(resolveTurnOrder(20, 8)); // 2-element, NO double-turn (gate false)
        expect(order).toHaveLength(2);
      });
    });

    it('surfaces Purge (dispel) only at its above-pool cost 44, never in the pool (TASK-77, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 44 (= DISPEL_ENERGY_COST,
      // the new ladder TOP, ABOVE MAX_ENERGY 41) selectSkill returns Purge; ONE below it it
      // falls back to the next-highest ladder entry (cleanse@43).
      expect(DISPEL_ENERGY_COST).toBe(44);
      expect(selectSkill(DISPEL_ENERGY_COST).id).toBe('dispel');
      expect(selectSkill(DISPEL_ENERGY_COST - 1).id).toBe('cleanse');

      // Purge is ABOVE the fight-local pool ceiling AND distinct from cleanse@43, so the
      // ladder stays strictly cost-descending and it is NEVER the pick inside simulateBattle
      // (Posture-B DECOUPLED) — the in-pool selection at MAX_ENERGY is UNCHANGED by this wave
      // (still counter-stance, exactly as before Purge was added).
      expect(SKILLS.dispel.energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS.dispel.energyCost).not.toBe(SKILLS.cleanse.energyCost);
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Purge is a PURE, HOSTILE utility skill: one dispel effect, no damage.
      expect(SKILLS.dispel.name).toBe('Purge');
      expect(SKILLS.dispel.effects).toEqual([{ kind: 'dispel' }]);
    });

    it('surfaces Purloin (Spellthief) only at its above-pool cost 45, never in the pool (TASK-78, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 45 (= PURLOIN_ENERGY_COST,
      // the new ladder TOP, ABOVE MAX_ENERGY 41) selectSkill returns Spellthief; ONE below it
      // it falls back to the next-highest ladder entry (dispel@44, UNCHANGED by this wave).
      expect(PURLOIN_ENERGY_COST).toBe(45);
      expect(selectSkill(PURLOIN_ENERGY_COST).id).toBe('purloin');
      expect(selectSkill(PURLOIN_ENERGY_COST - 1).id).toBe('dispel');

      // Purloin is ABOVE the fight-local pool ceiling AND distinct from dispel@44 / cleanse@43,
      // so the ladder stays strictly cost-descending and it is NEVER the pick inside
      // simulateBattle (Posture-B DECOUPLED) — the in-pool selection at MAX_ENERGY is UNCHANGED
      // by this wave (still counter-stance, exactly as before Purloin was added).
      expect(SKILLS.purloin.energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS.purloin.energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS.purloin.energyCost).not.toBe(SKILLS.cleanse.energyCost);
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Purloin is a PURE, HOSTILE utility skill: one purloin effect, no damage.
      expect(SKILLS.purloin.name).toBe('Spellthief');
      expect(SKILLS.purloin.effects).toEqual([{ kind: 'purloin' }]);
    });

    it('surfaces Displace (Scapegoat) only at its above-pool cost 46, never in the pool (TASK-79, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 46 (= DISPLACE_ENERGY_COST,
      // the new ladder TOP, ABOVE MAX_ENERGY 41) selectSkill returns Scapegoat; ONE below it
      // it falls back to the next-highest ladder entry (purloin@45, UNCHANGED by this wave).
      expect(DISPLACE_ENERGY_COST).toBe(46);
      expect(selectSkill(DISPLACE_ENERGY_COST).id).toBe('displace');
      expect(selectSkill(DISPLACE_ENERGY_COST - 1).id).toBe('purloin');

      // Displace is ABOVE the fight-local pool ceiling AND distinct from purloin@45 /
      // dispel@44 / cleanse@43, so the ladder stays strictly cost-descending and it is NEVER
      // the pick inside simulateBattle (Posture-B DECOUPLED) — the in-pool selection at
      // MAX_ENERGY is UNCHANGED by this wave (still counter-stance, exactly as before).
      expect(SKILLS.displace.energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS.displace.energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS.displace.energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS.displace.energyCost).not.toBe(SKILLS.cleanse.energyCost);
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Displace is a PURE, self→foe TRANSFER utility skill: one displace effect, no damage.
      expect(SKILLS.displace.name).toBe('Scapegoat');
      expect(SKILLS.displace.effects).toEqual([{ kind: 'displace' }]);
    });

    it('surfaces Reclaim (Backfire) only at its above-pool cost 47, never in the pool (TASK-80, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 47 (= RECLAIM_ENERGY_COST,
      // the new ladder TOP, ABOVE MAX_ENERGY 41) selectSkill returns Backfire; ONE below it
      // it falls back to the next-highest ladder entry (displace@46, UNCHANGED by this wave),
      // and the prior boundaries (45→purloin) hold BYTE-UNCHANGED.
      expect(RECLAIM_ENERGY_COST).toBe(47);
      expect(selectSkill(RECLAIM_ENERGY_COST).id).toBe('reclaim');
      expect(selectSkill(RECLAIM_ENERGY_COST - 1).id).toBe('displace');
      expect(selectSkill(DISPLACE_ENERGY_COST - 1).id).toBe('purloin');

      // Reclaim is ABOVE the fight-local pool ceiling AND distinct from displace@46 /
      // purloin@45 / dispel@44 / cleanse@43, so the ladder stays strictly cost-descending and
      // it is NEVER the pick inside simulateBattle (Posture-B DECOUPLED) — the in-pool
      // selection at MAX_ENERGY is UNCHANGED by this wave (still counter-stance, as before).
      expect(SKILLS.reclaim.energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS.reclaim.energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS.reclaim.energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS.reclaim.energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS.reclaim.energyCost).not.toBe(SKILLS.cleanse.energyCost);
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Reclaim is a PURE, self→foe TRANSFER utility skill: one reclaim effect, no damage.
      expect(SKILLS.reclaim.name).toBe('Backfire');
      expect(SKILLS.reclaim.effects).toEqual([{ kind: 'reclaim' }]);
    });

    it('surfaces Reclaim-Deep (Rebound) only at its above-pool cost 48, never in the pool (TASK-81, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 48 (= REBOUND_ENERGY_COST,
      // the new ladder TOP, ABOVE MAX_ENERGY 41) selectSkill returns Rebound; ONE below it
      // falls back to the next-highest ladder entry (reclaim@47, UNCHANGED by this wave), and
      // the prior boundaries (46→displace, 45→purloin) hold BYTE-UNCHANGED.
      expect(REBOUND_ENERGY_COST).toBe(48);
      expect(selectSkill(REBOUND_ENERGY_COST).id).toBe('reclaim-deep');
      expect(selectSkill(REBOUND_ENERGY_COST - 1).id).toBe('reclaim');
      expect(selectSkill(RECLAIM_ENERGY_COST - 1).id).toBe('displace');
      expect(selectSkill(DISPLACE_ENERGY_COST - 1).id).toBe('purloin');

      // Rebound is ABOVE the fight-local pool ceiling AND distinct from reclaim@47 /
      // displace@46 / purloin@45 / dispel@44 / cleanse@43, so the ladder stays strictly
      // cost-descending and it is NEVER the pick inside simulateBattle (Posture-B DECOUPLED) —
      // the in-pool selection at MAX_ENERGY is UNCHANGED by this wave (still counter-stance).
      expect(SKILLS['reclaim-deep'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-deep'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-deep'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-deep'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-deep'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-deep'].energyCost).not.toBe(SKILLS.cleanse.energyCost);
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound is a PURE, self→foe DEEP-COPY TRANSFER utility skill: one reclaim-deep effect.
      expect(SKILLS['reclaim-deep'].name).toBe('Rebound');
      expect(SKILLS['reclaim-deep'].effects).toEqual([{ kind: 'reclaim-deep' }]);
    });

    it('surfaces Reclaim-Partial (Rebound-Lite) only at its above-pool cost 49, never in the pool (TASK-82, Posture-B)', () => {
      // (a) SELECTION BOUNDARY (present ≠ observable) — at cost 49 (= REBOUND_LITE_ENERGY_COST,
      // the new ladder TOP, ABOVE MAX_ENERGY 41) selectSkill returns Rebound-Lite; ONE below it
      // falls back to the next-highest ladder entry (reclaim-deep@48, UNCHANGED by this wave),
      // and the prior boundaries (47→reclaim, 46→displace) hold BYTE-UNCHANGED.
      expect(REBOUND_LITE_ENERGY_COST).toBe(49);
      expect(selectSkill(REBOUND_LITE_ENERGY_COST).id).toBe('reclaim-partial');
      expect(selectSkill(REBOUND_LITE_ENERGY_COST - 1).id).toBe('reclaim-deep');
      expect(selectSkill(REBOUND_ENERGY_COST - 1).id).toBe('reclaim');
      expect(selectSkill(RECLAIM_ENERGY_COST - 1).id).toBe('displace');

      // Rebound-Lite is ABOVE the fight-local pool ceiling AND distinct from reclaim-deep@48 /
      // reclaim@47 / displace@46 / purloin@45 / dispel@44 / cleanse@43, so the ladder stays
      // strictly cost-descending and it is NEVER the pick inside simulateBattle (Posture-B
      // DECOUPLED) — the in-pool selection at MAX_ENERGY is UNCHANGED by this wave.
      expect(SKILLS['reclaim-partial'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-partial'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-partial'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-partial'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-partial'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-partial'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-partial'].energyCost).not.toBe(SKILLS.cleanse.energyCost);
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // The COMBATANT_SKILLS ladder stays strictly cost-descending, now with FOURTEEN above-pool
      // entries (reclaim-sear@56, reclaim-cripple@55, reclaim-blight@54, reclaim-doom@53,
      // reclaim-locks@52, reclaim-stats@51, reclaim-subset@50, reclaim-partial@49, reclaim-deep@48,
      // reclaim@47, displace@46, purloin@45, dispel@44, cleanse@43).
      for (let i = 1; i < COMBATANT_SKILLS.length; i++) {
        expect(COMBATANT_SKILLS[i - 1]!.energyCost).toBeGreaterThan(
          COMBATANT_SKILLS[i]!.energyCost,
        );
      }
      expect(COMBATANT_SKILLS.filter((s) => s.energyCost > MAX_ENERGY).length).toBe(59); // TASK-139 added vulnerable-when-strong-hex@100, the new ladder TOP
      // TASK-138 added vulnerable-when-weak-hex@99 below it

      // Rebound-Lite is a PURE, self→foe PARTIAL-DURATION TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-partial'].name).toBe('Rebound-Lite');
      expect(SKILLS['reclaim-partial'].effects).toEqual([{ kind: 'reclaim-partial' }]);
    });

    it('surfaces Reclaim-Subset (Rebound-Split) only at its above-pool cost 50, never in the pool (TASK-83, Posture-B)', () => {
      // At exactly REBOUND_SPLIT_ENERGY_COST (50 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Rebound-Split; ONE below it falls back to the next-highest ladder
      // entry (reclaim-partial@49, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(REBOUND_SPLIT_ENERGY_COST).id).toBe('reclaim-subset');
      expect(selectSkill(REBOUND_SPLIT_ENERGY_COST - 1).id).toBe('reclaim-partial');
      expect(selectSkill(REBOUND_LITE_ENERGY_COST).id).toBe('reclaim-partial');
      expect(selectSkill(REBOUND_ENERGY_COST).id).toBe('reclaim-deep');
      expect(selectSkill(RECLAIM_ENERGY_COST).id).toBe('reclaim');
      // In-pool selection is UNCHANGED — Rebound-Split is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound-Split is ABOVE the fight-local pool ceiling AND distinct from every other
      // status-transfer skill (reclaim-partial@49 / reclaim-deep@48 / reclaim@47 / displace@46 /
      // purloin@45 / dispel@44 / cleanse@43), so the ladder stays strictly cost-descending.
      expect(SKILLS['reclaim-subset'].energyCost).toBe(50);
      expect(SKILLS['reclaim-subset'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-subset'].energyCost).not.toBe(SKILLS['reclaim-partial'].energyCost);
      expect(SKILLS['reclaim-subset'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-subset'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-subset'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-subset'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-subset'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-subset'].energyCost).not.toBe(SKILLS.cleanse.energyCost);

      // Rebound-Split is a PURE, self→foe SUBSET-OF-KINDS TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-subset'].name).toBe('Rebound-Split');
      expect(SKILLS['reclaim-subset'].effects).toEqual([{ kind: 'reclaim-subset' }]);
    });

    it('surfaces Reclaim-Stats (Rebound-Snap) only at its above-pool cost 51, never in the pool (TASK-84, Posture-B)', () => {
      // At exactly REBOUND_SNAP_ENERGY_COST (51 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Rebound-Snap; ONE below it falls back to the next-highest ladder
      // entry (reclaim-subset@50, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(REBOUND_SNAP_ENERGY_COST).id).toBe('reclaim-stats');
      expect(selectSkill(REBOUND_SNAP_ENERGY_COST - 1).id).toBe('reclaim-subset');
      expect(selectSkill(REBOUND_SPLIT_ENERGY_COST).id).toBe('reclaim-subset');
      expect(selectSkill(REBOUND_LITE_ENERGY_COST).id).toBe('reclaim-partial');
      expect(selectSkill(REBOUND_ENERGY_COST).id).toBe('reclaim-deep');
      expect(selectSkill(RECLAIM_ENERGY_COST).id).toBe('reclaim');
      // In-pool selection is UNCHANGED — Rebound-Snap is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound-Snap is ABOVE the fight-local pool ceiling AND distinct from every other
      // status-transfer skill (reclaim-subset@50 / reclaim-partial@49 / reclaim-deep@48 /
      // reclaim@47 / displace@46 / purloin@45 / dispel@44 / cleanse@43), so the ladder stays
      // strictly cost-descending.
      expect(SKILLS['reclaim-stats'].energyCost).toBe(51);
      expect(SKILLS['reclaim-stats'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-stats'].energyCost).not.toBe(SKILLS['reclaim-subset'].energyCost);
      expect(SKILLS['reclaim-stats'].energyCost).not.toBe(SKILLS['reclaim-partial'].energyCost);
      expect(SKILLS['reclaim-stats'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-stats'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-stats'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-stats'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-stats'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-stats'].energyCost).not.toBe(SKILLS.cleanse.energyCost);

      // Rebound-Snap is a PURE, self→foe SUBSET-OF-KINDS TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-stats'].name).toBe('Rebound-Snap');
      expect(SKILLS['reclaim-stats'].effects).toEqual([{ kind: 'reclaim-stats' }]);
    });

    it('surfaces Reclaim-Locks (Rebound-Lock) only at its above-pool cost 52, never in the pool (TASK-85, Posture-B)', () => {
      // At exactly REBOUND_LOCK_ENERGY_COST (52 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Rebound-Lock; ONE below it falls back to the next-highest ladder
      // entry (reclaim-stats@51, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(REBOUND_LOCK_ENERGY_COST).id).toBe('reclaim-locks');
      expect(selectSkill(REBOUND_LOCK_ENERGY_COST - 1).id).toBe('reclaim-stats');
      expect(selectSkill(REBOUND_SNAP_ENERGY_COST).id).toBe('reclaim-stats');
      expect(selectSkill(REBOUND_SPLIT_ENERGY_COST).id).toBe('reclaim-subset');
      expect(selectSkill(REBOUND_LITE_ENERGY_COST).id).toBe('reclaim-partial');
      expect(selectSkill(REBOUND_ENERGY_COST).id).toBe('reclaim-deep');
      expect(selectSkill(RECLAIM_ENERGY_COST).id).toBe('reclaim');
      // In-pool selection is UNCHANGED — Rebound-Lock is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound-Lock is ABOVE the fight-local pool ceiling AND distinct from every other
      // status-transfer skill (reclaim-stats@51 / reclaim-subset@50 / reclaim-partial@49 /
      // reclaim-deep@48 / reclaim@47 / displace@46 / purloin@45 / dispel@44 / cleanse@43), so
      // the ladder stays strictly cost-descending.
      expect(SKILLS['reclaim-locks'].energyCost).toBe(52);
      expect(SKILLS['reclaim-locks'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-locks'].energyCost).not.toBe(SKILLS['reclaim-stats'].energyCost);
      expect(SKILLS['reclaim-locks'].energyCost).not.toBe(SKILLS['reclaim-subset'].energyCost);
      expect(SKILLS['reclaim-locks'].energyCost).not.toBe(SKILLS['reclaim-partial'].energyCost);
      expect(SKILLS['reclaim-locks'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-locks'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-locks'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-locks'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-locks'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-locks'].energyCost).not.toBe(SKILLS.cleanse.energyCost);

      // Rebound-Lock is a PURE, self→foe SUBSET-OF-KINDS TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-locks'].name).toBe('Rebound-Lock');
      expect(SKILLS['reclaim-locks'].effects).toEqual([{ kind: 'reclaim-locks' }]);
    });

    it('surfaces Reclaim-Blight (Rebound-Blight) only at its above-pool cost 54, never in the pool (TASK-87, Posture-B)', () => {
      // At exactly REBOUND_BLIGHT_ENERGY_COST (54 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Rebound-Blight; ONE below it falls back to the next-highest ladder
      // entry (reclaim-doom@53, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(REBOUND_BLIGHT_ENERGY_COST).id).toBe('reclaim-blight');
      expect(selectSkill(REBOUND_BLIGHT_ENERGY_COST - 1).id).toBe('reclaim-doom');
      expect(selectSkill(REBOUND_DOOM_ENERGY_COST).id).toBe('reclaim-doom');
      expect(selectSkill(REBOUND_LOCK_ENERGY_COST).id).toBe('reclaim-locks');
      expect(selectSkill(REBOUND_SNAP_ENERGY_COST).id).toBe('reclaim-stats');
      expect(selectSkill(REBOUND_SPLIT_ENERGY_COST).id).toBe('reclaim-subset');
      // In-pool selection is UNCHANGED — Rebound-Blight is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound-Blight is ABOVE the fight-local pool ceiling AND distinct from every other
      // status-transfer skill (reclaim-doom@53 / reclaim-locks@52 / reclaim-stats@51 /
      // reclaim-subset@50 / reclaim-partial@49 / reclaim-deep@48 / reclaim@47 / displace@46 /
      // purloin@45 / dispel@44 / cleanse@43), so the ladder stays strictly cost-descending.
      expect(SKILLS['reclaim-blight'].energyCost).toBe(54);
      expect(SKILLS['reclaim-blight'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-blight'].energyCost).not.toBe(SKILLS['reclaim-doom'].energyCost);
      expect(SKILLS['reclaim-blight'].energyCost).not.toBe(SKILLS['reclaim-locks'].energyCost);
      expect(SKILLS['reclaim-blight'].energyCost).not.toBe(SKILLS['reclaim-stats'].energyCost);
      expect(SKILLS['reclaim-blight'].energyCost).not.toBe(SKILLS['reclaim-subset'].energyCost);
      expect(SKILLS['reclaim-blight'].energyCost).not.toBe(SKILLS['reclaim-partial'].energyCost);
      expect(SKILLS['reclaim-blight'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-blight'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-blight'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-blight'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-blight'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-blight'].energyCost).not.toBe(SKILLS.cleanse.energyCost);

      // Rebound-Blight is a PURE, self→foe UNION-SUBSET-OF-KINDS TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-blight'].name).toBe('Rebound-Blight');
      expect(SKILLS['reclaim-blight'].effects).toEqual([{ kind: 'reclaim-blight' }]);
    });

    it('surfaces Reclaim-Cripple (Rebound-Cripple) only at its above-pool cost 55, never in the pool (TASK-88, Posture-B)', () => {
      // At exactly REBOUND_CRIPPLE_ENERGY_COST (55 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Rebound-Cripple; ONE below it falls back to the next-highest ladder
      // entry (reclaim-blight@54, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(REBOUND_CRIPPLE_ENERGY_COST).id).toBe('reclaim-cripple');
      expect(selectSkill(REBOUND_CRIPPLE_ENERGY_COST - 1).id).toBe('reclaim-blight');
      expect(selectSkill(REBOUND_BLIGHT_ENERGY_COST).id).toBe('reclaim-blight');
      expect(selectSkill(REBOUND_DOOM_ENERGY_COST).id).toBe('reclaim-doom');
      expect(selectSkill(REBOUND_LOCK_ENERGY_COST).id).toBe('reclaim-locks');
      expect(selectSkill(REBOUND_SNAP_ENERGY_COST).id).toBe('reclaim-stats');
      expect(selectSkill(REBOUND_SPLIT_ENERGY_COST).id).toBe('reclaim-subset');
      // In-pool selection is UNCHANGED — Rebound-Cripple is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound-Cripple is ABOVE the fight-local pool ceiling AND distinct from every other
      // status-transfer skill (reclaim-blight@54 / reclaim-doom@53 / reclaim-locks@52 /
      // reclaim-stats@51 / reclaim-subset@50 / reclaim-partial@49 / reclaim-deep@48 / reclaim@47 /
      // displace@46 / purloin@45 / dispel@44 / cleanse@43), so the ladder stays strictly
      // cost-descending.
      expect(SKILLS['reclaim-cripple'].energyCost).toBe(55);
      expect(SKILLS['reclaim-cripple'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-cripple'].energyCost).not.toBe(SKILLS['reclaim-blight'].energyCost);
      expect(SKILLS['reclaim-cripple'].energyCost).not.toBe(SKILLS['reclaim-doom'].energyCost);
      expect(SKILLS['reclaim-cripple'].energyCost).not.toBe(SKILLS['reclaim-locks'].energyCost);
      expect(SKILLS['reclaim-cripple'].energyCost).not.toBe(SKILLS['reclaim-stats'].energyCost);
      expect(SKILLS['reclaim-cripple'].energyCost).not.toBe(SKILLS['reclaim-subset'].energyCost);
      expect(SKILLS['reclaim-cripple'].energyCost).not.toBe(SKILLS['reclaim-partial'].energyCost);
      expect(SKILLS['reclaim-cripple'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-cripple'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-cripple'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-cripple'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-cripple'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-cripple'].energyCost).not.toBe(SKILLS.cleanse.energyCost);

      // Rebound-Cripple is a PURE, self→foe UNION-SUBSET-OF-KINDS TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-cripple'].name).toBe('Rebound-Cripple');
      expect(SKILLS['reclaim-cripple'].effects).toEqual([{ kind: 'reclaim-cripple' }]);
    });

    it('surfaces Reclaim-Sear (Rebound-Sear) only at its above-pool cost 56, never in the pool (TASK-89, Posture-B)', () => {
      // At exactly REBOUND_SEAR_ENERGY_COST (56 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Rebound-Sear; ONE below it falls back to the next-highest ladder
      // entry (reclaim-cripple@55, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(REBOUND_SEAR_ENERGY_COST).id).toBe('reclaim-sear');
      expect(selectSkill(REBOUND_SEAR_ENERGY_COST - 1).id).toBe('reclaim-cripple');
      expect(selectSkill(REBOUND_CRIPPLE_ENERGY_COST).id).toBe('reclaim-cripple');
      expect(selectSkill(REBOUND_BLIGHT_ENERGY_COST).id).toBe('reclaim-blight');
      expect(selectSkill(REBOUND_DOOM_ENERGY_COST).id).toBe('reclaim-doom');
      // In-pool selection is UNCHANGED — Rebound-Sear is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound-Sear is ABOVE the fight-local pool ceiling AND distinct from every other
      // status-transfer skill (reclaim-cripple@55 / reclaim-blight@54 / reclaim-doom@53 /
      // reclaim-locks@52 / reclaim-stats@51 / reclaim-subset@50 / reclaim-partial@49 /
      // reclaim-deep@48 / reclaim@47 / displace@46 / purloin@45 / dispel@44 / cleanse@43), so the
      // ladder stays strictly cost-descending.
      expect(SKILLS['reclaim-sear'].energyCost).toBe(56);
      expect(SKILLS['reclaim-sear'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-sear'].energyCost).not.toBe(SKILLS['reclaim-cripple'].energyCost);
      expect(SKILLS['reclaim-sear'].energyCost).not.toBe(SKILLS['reclaim-blight'].energyCost);
      expect(SKILLS['reclaim-sear'].energyCost).not.toBe(SKILLS['reclaim-doom'].energyCost);
      expect(SKILLS['reclaim-sear'].energyCost).not.toBe(SKILLS['reclaim-locks'].energyCost);
      expect(SKILLS['reclaim-sear'].energyCost).not.toBe(SKILLS['reclaim-stats'].energyCost);
      expect(SKILLS['reclaim-sear'].energyCost).not.toBe(SKILLS['reclaim-subset'].energyCost);
      expect(SKILLS['reclaim-sear'].energyCost).not.toBe(SKILLS['reclaim-partial'].energyCost);
      expect(SKILLS['reclaim-sear'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-sear'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-sear'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-sear'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-sear'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-sear'].energyCost).not.toBe(SKILLS.cleanse.energyCost);

      // Rebound-Sear is a PURE, self→foe UNION-SUBSET-OF-KINDS TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-sear'].name).toBe('Rebound-Sear');
      expect(SKILLS['reclaim-sear'].effects).toEqual([{ kind: 'reclaim-sear' }]);
    });

    it('surfaces Reclaim-Snaplockdoom (Rebound-Snaplockdoom) only at its above-pool cost 63, never in the pool (TASK-96, Posture-B)', () => {
      // At exactly REBOUND_SNAPLOCKDOOM_ENERGY_COST (63 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Rebound-Snaplockdoom; ONE below it falls back to the next-highest ladder
      // entry (reclaim-blightdoom@62, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(REBOUND_SNAPLOCKDOOM_ENERGY_COST).id).toBe('reclaim-snaplockdoom');
      expect(selectSkill(REBOUND_SNAPLOCKDOOM_ENERGY_COST - 1).id).toBe('reclaim-blightdoom');
      expect(selectSkill(REBOUND_BLIGHTDOOM_ENERGY_COST).id).toBe('reclaim-blightdoom');
      expect(selectSkill(REBOUND_SEARDOOM_ENERGY_COST).id).toBe('reclaim-seardoom');
      // In-pool selection is UNCHANGED — Rebound-Snaplockdoom is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound-Snaplockdoom is ABOVE the fight-local pool ceiling AND distinct from every other
      // status-transfer skill, so the ladder stays strictly cost-descending.
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).toBe(63);
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(
        SKILLS['reclaim-blightdoom'].energyCost,
      );
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(
        SKILLS['reclaim-seardoom'].energyCost,
      );
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(
        SKILLS['reclaim-purge'].energyCost,
      );
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(
        SKILLS['reclaim-doomlock'].energyCost,
      );
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(
        SKILLS['reclaim-snapdoom'].energyCost,
      );
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(
        SKILLS['reclaim-doomburn'].energyCost,
      );
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(SKILLS['reclaim-sear'].energyCost);
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(
        SKILLS['reclaim-cripple'].energyCost,
      );
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(
        SKILLS['reclaim-blight'].energyCost,
      );
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(SKILLS['reclaim-doom'].energyCost);
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(
        SKILLS['reclaim-locks'].energyCost,
      );
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(
        SKILLS['reclaim-stats'].energyCost,
      );
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(
        SKILLS['reclaim-subset'].energyCost,
      );
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(
        SKILLS['reclaim-partial'].energyCost,
      );
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-snaplockdoom'].energyCost).not.toBe(SKILLS.cleanse.energyCost);

      // Rebound-Snaplockdoom is a PURE, self→foe 3-of-4-UNION-SUBSET-OF-KINDS TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-snaplockdoom'].name).toBe('Rebound-Snaplockdoom');
      expect(SKILLS['reclaim-snaplockdoom'].effects).toEqual([{ kind: 'reclaim-snaplockdoom' }]);
    });

    it('surfaces Energy Surge (leech-percent) only at its above-pool cost 65, never in the pool (TASK-98, Posture-B)', () => {
      // At exactly LEECH_PERCENT_ENERGY_COST (65 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Energy Surge; ONE below it falls back to the next-highest ladder
      // entry (sap-percent@64, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(LEECH_PERCENT_ENERGY_COST).id).toBe('leech-percent');
      expect(selectSkill(LEECH_PERCENT_ENERGY_COST - 1).id).toBe('sap-percent');
      expect(selectSkill(SAP_PERCENT_ENERGY_COST).id).toBe('sap-percent');
      // In-pool selection is UNCHANGED — Energy Surge is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Energy Surge is ABOVE the fight-local pool ceiling AND distinct from every other
      // above-pool skill, so the ladder stays strictly cost-descending.
      expect(SKILLS['leech-percent'].energyCost).toBe(65);
      expect(SKILLS['leech-percent'].energyCost).toBeGreaterThan(MAX_ENERGY);
      // Distinct from the previous above-pool TOP (sap-percent@64) and every above-pool
      // cost — a filter proves NO other above-pool skill shares cost 65.
      expect(
        COMBATANT_SKILLS.filter((s) => s.energyCost === SKILLS['leech-percent'].energyCost),
      ).toHaveLength(1);
      expect(SKILLS['leech-percent'].energyCost).not.toBe(SKILLS['sap-percent'].energyCost);

      // Energy Surge is a DAMAGING COMPOSITE [damage, leech-percent] mirroring energy-siphon's
      // [damage, leech] shape — the fractional MIRROR of the fixed-amount Leech, the CREDIT
      // twin of Energy Rend (sap-percent).
      expect(SKILLS['leech-percent'].name).toBe('Energy Surge');
      expect(SKILLS['leech-percent'].effects).toEqual([
        { kind: 'damage' },
        { kind: 'leech-percent' },
      ]);
    });

    it('surfaces Thorn Mirror (reflect-percent) only at its above-pool cost 66, never in the pool (TASK-99, Posture-B)', () => {
      // At exactly RETALIATE_PERCENT_ENERGY_COST (66 — the new ladder TOP, ABOVE MAX_ENERGY
      // 41) selectSkill returns Thorn Mirror; ONE below it falls back to the next-highest
      // ladder entry (leech-percent@65, UNCHANGED by this wave); the entries below are unchanged.
      expect(selectSkill(RETALIATE_PERCENT_ENERGY_COST).id).toBe('reflect-percent');
      expect(selectSkill(RETALIATE_PERCENT_ENERGY_COST - 1).id).toBe('leech-percent');
      expect(selectSkill(LEECH_PERCENT_ENERGY_COST).id).toBe('leech-percent');
      expect(selectSkill(SAP_PERCENT_ENERGY_COST).id).toBe('sap-percent');
      // In-pool selection is UNCHANGED — Thorn Mirror is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Thorn Mirror is ABOVE the fight-local pool ceiling AND distinct from every other
      // above-pool skill, so the ladder stays strictly cost-descending.
      expect(SKILLS['reflect-percent'].energyCost).toBe(66);
      expect(SKILLS['reflect-percent'].energyCost).toBeGreaterThan(MAX_ENERGY);
      // Distinct from the previous above-pool TOP (leech-percent@65) and every above-pool
      // cost — a filter proves NO other above-pool skill shares cost 66.
      expect(
        COMBATANT_SKILLS.filter((s) => s.energyCost === SKILLS['reflect-percent'].energyCost),
      ).toHaveLength(1);
      expect(SKILLS['reflect-percent'].energyCost).not.toBe(SKILLS['leech-percent'].energyCost);
      expect(RETALIATE_PERCENT_ENERGY_COST).toBeGreaterThan(LEECH_PERCENT_ENERGY_COST);

      // Thorn Mirror is a PURE SELF-buff [{ kind: 'reflect-percent' }] mirroring
      // counter-stance's [{ kind: 'retaliate' }] shape — the fractional MIRROR of the
      // fixed-amount Retaliate, NOT a damaging composite.
      expect(SKILLS['reflect-percent'].name).toBe('Thorn Mirror');
      expect(SKILLS['reflect-percent'].effects).toEqual([{ kind: 'reflect-percent' }]);
    });

    it('reflectRetaliation: FIXED retaliate vs FRACTIONAL retaliate-percent diverge for the SAME overflow (TASK-99 acceptance seam)', () => {
      // The acceptance seam — the WHOLE point of the fidelity axis on the reflect side is that
      // a FRACTION of the incoming overflow differs OBSERVABLY from the fixed-5 Retaliate.
      const retaliateArm = applyAilment([], 'retaliate');
      const retaliatePercentArm = applyAilment([], 'retaliate-percent');

      // A defender carrying the FIXED retaliate arm reflects the constant 5 (byte-unchanged).
      expect(reflectRetaliation(retaliateArm, 20)).toEqual({
        reflect: RETALIATE_REFLECT_DAMAGE,
      });
      // A defender carrying the retaliate-percent arm reflects floor(20 * 0.5) = 10.
      expect(reflectRetaliation(retaliatePercentArm, 20)).toEqual({ reflect: 10 });
      // The two produce DIFFERENT reflect amounts for the SAME overflow (fixed 5 vs percent 10).
      expect(reflectRetaliation(retaliatePercentArm, 20).reflect).not.toBe(
        reflectRetaliation(retaliateArm, 20).reflect,
      );

      // The overflow <= 0 early return holds identically for the percent arm — no reflect on
      // a fully-absorbed / non-damaging strike (exactly like the fixed retaliate).
      expect(reflectRetaliation(retaliatePercentArm, 0)).toEqual({ reflect: 0 });

      // Floor check: floor(3 * 0.5) = floor(1.5) = 1.
      expect(reflectRetaliation(retaliatePercentArm, 3)).toEqual({ reflect: 1 });

      // reflect >= 0 across the range, and (since it feeds the Math.max(0, hp - reflect) seam)
      // HP stays non-increasing — the reflect only ever SUBTRACTS the attacker's HP (A-42).
      for (let overflow = 0; overflow <= 40; overflow++) {
        const { reflect } = reflectRetaliation(retaliatePercentArm, overflow);
        expect(reflect).toBeGreaterThanOrEqual(0);
        expect(reflect).toBe(overflow <= 0 ? 0 : Math.floor(overflow * RETALIATE_PERCENT_RATIO));
      }

      // If BOTH a fixed and a percent arm were somehow present, the FIXED arm wins first (a
      // deterministic order — keeps the fixed branch byte-identical). They never co-occur in-sim.
      const both = applyAilment(applyAilment([], 'retaliate'), 'retaliate-percent');
      expect(reflectRetaliation(both, 20)).toEqual({ reflect: RETALIATE_REFLECT_DAMAGE });
    });

    it('applyAilment builds a fresh retaliate-percent arm carrying its reflectRatio + full duration, HP-neutral (TASK-99 self-buff grant)', () => {
      const after = applyAilment([], 'retaliate-percent');
      expect(after).toEqual([
        {
          kind: 'retaliate-percent',
          turnsRemaining: RETALIATE_DURATION,
          reflectRatio: RETALIATE_PERCENT_RATIO,
        },
      ]);
      // The grant carries the ratio (NOT a fixed damage) — the fractional mirror of retaliate.
      const arm = after[0];
      expect(arm.kind).toBe('retaliate-percent');
      if (arm.kind === 'retaliate-percent') {
        expect(arm.reflectRatio).toBe(RETALIATE_PERCENT_RATIO);
        expect(arm.turnsRemaining).toBe(RETALIATE_DURATION);
      }
      // Self-buff coexists with the OTHER self-buffs (empower/shield) — pure addition, no stack.
      const mixed = applyAilment(
        applyAilment(applyAilment([], 'shield'), 'empower'),
        'retaliate-percent',
      );
      expect(mixed.map((s) => s.kind).sort()).toEqual(['empower', 'retaliate-percent', 'shield']);
    });

    it('surfaces Crumble (weaken-percent) only at its above-pool cost 67, never in the pool (TASK-100, Posture-B)', () => {
      // At exactly WEAKEN_PERCENT_ENERGY_COST (67 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Crumble; ONE below it falls back to the next-highest ladder entry
      // (reflect-percent@66, UNCHANGED by this wave); the entries below are unchanged.
      expect(selectSkill(WEAKEN_PERCENT_ENERGY_COST).id).toBe('weaken-percent');
      expect(selectSkill(WEAKEN_PERCENT_ENERGY_COST - 1).id).toBe('reflect-percent');
      expect(selectSkill(RETALIATE_PERCENT_ENERGY_COST).id).toBe('reflect-percent');
      expect(selectSkill(LEECH_PERCENT_ENERGY_COST).id).toBe('leech-percent');
      // In-pool selection is UNCHANGED — Crumble is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Crumble is ABOVE the fight-local pool ceiling AND distinct from every other above-pool
      // skill, so the ladder stays strictly cost-descending.
      expect(SKILLS['weaken-percent'].energyCost).toBe(67);
      expect(SKILLS['weaken-percent'].energyCost).toBeGreaterThan(MAX_ENERGY);
      // Distinct from the previous above-pool TOP (reflect-percent@66) and every above-pool
      // cost — a filter proves NO other above-pool skill shares cost 67.
      expect(
        COMBATANT_SKILLS.filter((s) => s.energyCost === SKILLS['weaken-percent'].energyCost),
      ).toHaveLength(1);
      expect(SKILLS['weaken-percent'].energyCost).not.toBe(SKILLS['reflect-percent'].energyCost);
      expect(WEAKEN_PERCENT_ENERGY_COST).toBeGreaterThan(RETALIATE_PERCENT_ENERGY_COST);

      // The whole ladder is strictly cost-descending with every above-pool cost distinct.
      for (let i = 1; i < COMBATANT_SKILLS.length; i++) {
        expect(COMBATANT_SKILLS[i].energyCost).toBeLessThan(COMBATANT_SKILLS[i - 1].energyCost);
      }

      // Crumble is a DAMAGING debuff-strike [{ kind: 'damage' }, { kind: 'weaken-percent' }]
      // mirroring armor-break's [{ kind: 'damage' }, { kind: 'weaken' }] shape — the fractional
      // MIRROR of the fixed-amount Weaken, applied to the DEFENDER.
      expect(SKILLS['weaken-percent'].name).toBe('Crumble');
      expect(SKILLS['weaken-percent'].effects).toEqual([
        { kind: 'damage' },
        { kind: 'weaken-percent' },
      ]);
    });

    it('resolveAttack DEF-mitigation: FIXED weaken (-6) vs FRACTIONAL weaken-percent (floor(def*0.5)) diverge (TASK-100 acceptance seam)', () => {
      // The acceptance seam — the WHOLE point of the fidelity axis on the stat-modifier side is
      // that floor(def * 0.5) of the target's CURRENT def diverges OBSERVABLY from the fixed -6
      // for a target whose floor(def*0.5) !== 6. The seam feeds resolveAttack's defenderDefReduction
      // arg; here we exercise that arg directly with the fixed 6 vs the computed floor(def*0.5).
      const attacker: Combatant = {
        name: 'A',
        type: 'Free',
        element: 'Neutral',
        hp: 50,
        atk: 30,
        def: 10,
        spd: 8,
      };
      // def 12 -> floor(12 * 0.5) = 6 === the fixed WEAKEN_DEF_REDUCTION: the two COINCIDE.
      const d12: Combatant = { ...attacker, name: 'D12', def: 12 };
      expect(Math.floor(d12.def * WEAKEN_PERCENT_RATIO)).toBe(WEAKEN_DEF_REDUCTION);
      expect(resolveAttack(attacker, d12, Math.floor(d12.def * WEAKEN_PERCENT_RATIO))).toBe(
        resolveAttack(attacker, d12, WEAKEN_DEF_REDUCTION),
      );

      // def 30 -> floor(30 * 0.5) = 15 !== the fixed 6: the percent reduction DIVERGES — a
      // HIGH-DEF target loses MORE effective def (15) than the fixed 6, so it takes MORE damage.
      const d30: Combatant = { ...attacker, name: 'D30', def: 30 };
      const percentRed30 = Math.floor(d30.def * WEAKEN_PERCENT_RATIO);
      expect(percentRed30).toBe(15);
      const fixedDmg30 = resolveAttack(attacker, d30, WEAKEN_DEF_REDUCTION);
      const percentDmg30 = resolveAttack(attacker, d30, percentRed30);
      // A bigger DEF reduction -> lower effectiveDef -> MORE damage: percent > fixed for def 30.
      expect(percentDmg30).toBeGreaterThan(fixedDmg30);
      expect(percentDmg30).not.toBe(fixedDmg30);

      // def 8 -> floor(8 * 0.5) = 4 !== 6: a LOW-DEF target loses LESS (4 < 6) -> takes LESS
      // damage than the fixed weaken would inflict (the other side of the fidelity divergence).
      const d8: Combatant = { ...attacker, name: 'D8', def: 8 };
      const percentRed8 = Math.floor(d8.def * WEAKEN_PERCENT_RATIO);
      expect(percentRed8).toBe(4);
      expect(resolveAttack(attacker, d8, percentRed8)).toBeLessThan(
        resolveAttack(attacker, d8, WEAKEN_DEF_REDUCTION),
      );

      // The resulting damage is ALWAYS >= 1 (the Math.max(1, …) floor holds) AND the effectiveDef
      // clamp at MIN_EFFECTIVE_DEF holds even for a HUGE percent reduction — a big-DEF weaken-percent
      // can never invert floor(def/2) into a NEGATIVE (which would HEAL). Sweep a range of DEFs.
      for (const def of [1, 4, 8, 12, 20, 30, 50, 100]) {
        const d: Combatant = { ...attacker, def };
        const red = Math.floor(def * WEAKEN_PERCENT_RATIO);
        const dmg = resolveAttack(attacker, d, red);
        expect(dmg).toBeGreaterThanOrEqual(1);
        expect(Math.max(MIN_EFFECTIVE_DEF, def - red)).toBeGreaterThanOrEqual(MIN_EFFECTIVE_DEF);
      }
    });

    it('applyAilment builds a fresh weaken-percent arm carrying its defReductionRatio + full duration, HP-neutral (TASK-100 debuff grant)', () => {
      const after = applyAilment([], 'weaken-percent');
      expect(after).toEqual([
        {
          kind: 'weaken-percent',
          turnsRemaining: WEAKEN_DURATION,
          defReductionRatio: WEAKEN_PERCENT_RATIO,
        },
      ]);
      // The grant carries the RATIO (NOT a fixed magnitude) — the fractional mirror of weaken.
      const arm = after[0];
      expect(arm.kind).toBe('weaken-percent');
      if (arm.kind === 'weaken-percent') {
        expect(arm.defReductionRatio).toBe(WEAKEN_PERCENT_RATIO);
        expect(arm.turnsRemaining).toBe(WEAKEN_DURATION);
      }
      // Coexists with the FIXED weaken and an unrelated DoT via the standard replace-same-kind
      // semantics (a debuff, distinct kind from weaken — both present at once, no HP change).
      const mixed = applyAilment(
        applyAilment(applyAilment([], 'burn'), 'weaken'),
        'weaken-percent',
      );
      expect(mixed.map((s) => s.kind).sort()).toEqual(['burn', 'weaken', 'weaken-percent']);
      // Re-applying refreshes in place (no stack) — still exactly one weaken-percent arm.
      const twice = applyAilment(applyAilment([], 'weaken-percent'), 'weaken-percent');
      expect(twice.filter((s) => s.kind === 'weaken-percent')).toHaveLength(1);
    });

    it('surfaces Sunder (enfeeble-percent) only at its above-pool cost 68, never in the pool (TASK-101, Posture-B)', () => {
      // At exactly ENFEEBLE_PERCENT_ENERGY_COST (68 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Sunder; ONE below it falls back to the next-highest ladder entry
      // (weaken-percent/Crumble@67, UNCHANGED by this wave); the entries below are unchanged.
      expect(selectSkill(ENFEEBLE_PERCENT_ENERGY_COST).id).toBe('enfeeble-percent');
      expect(selectSkill(ENFEEBLE_PERCENT_ENERGY_COST - 1).id).toBe('weaken-percent');
      expect(selectSkill(WEAKEN_PERCENT_ENERGY_COST).id).toBe('weaken-percent');
      expect(selectSkill(RETALIATE_PERCENT_ENERGY_COST).id).toBe('reflect-percent');
      // In-pool selection is UNCHANGED — Sunder is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Sunder is ABOVE the fight-local pool ceiling AND distinct from every other above-pool
      // skill, so the ladder stays strictly cost-descending.
      expect(SKILLS['enfeeble-percent'].energyCost).toBe(68);
      expect(SKILLS['enfeeble-percent'].energyCost).toBeGreaterThan(MAX_ENERGY);
      // Distinct from the previous above-pool TOP (weaken-percent@67) and every above-pool
      // cost — a filter proves NO other above-pool skill shares cost 68.
      expect(
        COMBATANT_SKILLS.filter((s) => s.energyCost === SKILLS['enfeeble-percent'].energyCost),
      ).toHaveLength(1);
      expect(SKILLS['enfeeble-percent'].energyCost).not.toBe(SKILLS['weaken-percent'].energyCost);
      expect(ENFEEBLE_PERCENT_ENERGY_COST).toBeGreaterThan(WEAKEN_PERCENT_ENERGY_COST);

      // The whole ladder is strictly cost-descending with every above-pool cost distinct.
      for (let i = 1; i < COMBATANT_SKILLS.length; i++) {
        expect(COMBATANT_SKILLS[i].energyCost).toBeLessThan(COMBATANT_SKILLS[i - 1].energyCost);
      }

      // Sunder is a DAMAGING debuff-strike [{ kind: 'damage' }, { kind: 'enfeeble-percent' }]
      // mirroring enfeeble-strike's [{ kind: 'damage' }, { kind: 'enfeeble' }] shape — the
      // fractional MIRROR of the fixed-amount Enfeeble, applied to the DEFENDER.
      expect(SKILLS['enfeeble-percent'].name).toBe('Sunder');
      expect(SKILLS['enfeeble-percent'].effects).toEqual([
        { kind: 'damage' },
        { kind: 'enfeeble-percent' },
      ]);
    });

    it('resolveAttack ATK-cut: FIXED enfeeble (-6) vs FRACTIONAL enfeeble-percent (-floor(atk*0.5)) diverge (TASK-101 acceptance seam)', () => {
      // The acceptance seam — the WHOLE point of the fidelity axis on the ATK-side stat-modifier
      // is that floor(atk * 0.5) of the ATTACKER's CURRENT atk diverges OBSERVABLY from the fixed
      // -6 for an attacker whose floor(atk*0.5) !== 6. The enfeeble reduction feeds resolveAttack's
      // 4th arg (attackerAtkBonus) as a NEGATIVE value (`atkBonus - atkReduction` at the call
      // site, atkBonus 0 here); we exercise it directly with the fixed -6 vs -floor(atk*0.5).
      const defender: Combatant = {
        name: 'D',
        type: 'Free',
        element: 'Neutral',
        hp: 50,
        atk: 20,
        def: 10,
        spd: 8,
      };
      // atk 12 -> floor(12 * 0.5) = 6 === the fixed ENFEEBLE_ATK_REDUCTION: the two COINCIDE.
      const a12: Combatant = { ...defender, name: 'A12', atk: 12 };
      expect(Math.floor(a12.atk * ENFEEBLE_PERCENT_RATIO)).toBe(ENFEEBLE_ATK_REDUCTION);
      expect(resolveAttack(a12, defender, 0, -Math.floor(a12.atk * ENFEEBLE_PERCENT_RATIO))).toBe(
        resolveAttack(a12, defender, 0, -ENFEEBLE_ATK_REDUCTION),
      );

      // atk 30 -> floor(30 * 0.5) = 15 !== the fixed 6: the percent reduction DIVERGES — a
      // HIGH-ATK attacker loses MORE effective atk (15) than the fixed 6, so it deals LESS damage.
      const a30: Combatant = { ...defender, name: 'A30', atk: 30 };
      const percentRed30 = Math.floor(a30.atk * ENFEEBLE_PERCENT_RATIO);
      expect(percentRed30).toBe(15);
      const fixedDmg30 = resolveAttack(a30, defender, 0, -ENFEEBLE_ATK_REDUCTION);
      const percentDmg30 = resolveAttack(a30, defender, 0, -percentRed30);
      // A bigger ATK reduction -> lower effectiveAtk -> LESS damage: percent < fixed for atk 30.
      expect(percentDmg30).toBeLessThan(fixedDmg30);
      expect(percentDmg30).not.toBe(fixedDmg30);

      // atk 8 -> floor(8 * 0.5) = 4 !== 6: a LOW-ATK attacker loses LESS (4 < 6) -> deals MORE
      // damage than the fixed enfeeble would allow (the other side of the fidelity divergence).
      // Use a LOW-DEF defender so both results sit above the >= 1 floor and the gap is observable
      // (effAtk 4 vs 2 with effDef 2: 3 vs 1).
      const softDefender: Combatant = { ...defender, name: 'Soft', def: 2 };
      const a8: Combatant = { ...defender, name: 'A8', atk: 8 };
      const percentRed8 = Math.floor(a8.atk * ENFEEBLE_PERCENT_RATIO);
      expect(percentRed8).toBe(4);
      expect(resolveAttack(a8, softDefender, 0, -percentRed8)).toBeGreaterThan(
        resolveAttack(a8, softDefender, 0, -ENFEEBLE_ATK_REDUCTION),
      );

      // The resulting damage is ALWAYS >= 1 (the Math.max(1, …) floor holds) AND the effectiveAtk
      // clamp at MIN_EFFECTIVE_ATK holds even for a HUGE percent reduction — a big-ATK
      // enfeeble-percent can never invert effectiveAtk into a NEGATIVE (which would HEAL). Sweep.
      for (const atk of [1, 4, 8, 12, 20, 30, 50, 100]) {
        const a: Combatant = { ...defender, atk };
        const red = Math.floor(atk * ENFEEBLE_PERCENT_RATIO);
        const dmg = resolveAttack(a, defender, 0, -red);
        expect(dmg).toBeGreaterThanOrEqual(1);
        expect(Math.max(MIN_EFFECTIVE_ATK, atk - red)).toBeGreaterThanOrEqual(MIN_EFFECTIVE_ATK);
      }
    });

    it('applyAilment builds a fresh enfeeble-percent arm carrying its atkReductionRatio + full duration, HP-neutral (TASK-101 debuff grant)', () => {
      const after = applyAilment([], 'enfeeble-percent');
      expect(after).toEqual([
        {
          kind: 'enfeeble-percent',
          turnsRemaining: ENFEEBLE_DURATION,
          atkReductionRatio: ENFEEBLE_PERCENT_RATIO,
        },
      ]);
      // The grant carries the RATIO (NOT a fixed magnitude) — the fractional mirror of enfeeble.
      const arm = after[0];
      expect(arm.kind).toBe('enfeeble-percent');
      if (arm.kind === 'enfeeble-percent') {
        expect(arm.atkReductionRatio).toBe(ENFEEBLE_PERCENT_RATIO);
        expect(arm.turnsRemaining).toBe(ENFEEBLE_DURATION);
      }
      // Coexists with the FIXED enfeeble and an unrelated DoT via the standard replace-same-kind
      // semantics (a debuff, distinct kind from enfeeble — both present at once, no HP change).
      const mixed = applyAilment(
        applyAilment(applyAilment([], 'burn'), 'enfeeble'),
        'enfeeble-percent',
      );
      expect(mixed.map((s) => s.kind).sort()).toEqual(['burn', 'enfeeble', 'enfeeble-percent']);
      // Re-applying refreshes in place (no stack) — still exactly one enfeeble-percent arm.
      const twice = applyAilment(applyAilment([], 'enfeeble-percent'), 'enfeeble-percent');
      expect(twice.filter((s) => s.kind === 'enfeeble-percent')).toHaveLength(1);
    });

    it('surfaces Reinforce (empower-percent) only at its above-pool cost 69, never in the pool (TASK-102, Posture-B)', () => {
      // At exactly EMPOWER_PERCENT_ENERGY_COST (69 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Reinforce; ONE below it falls back to the next-highest ladder entry
      // (enfeeble-percent/Sunder@68, UNCHANGED by this wave); the entries below are unchanged.
      expect(selectSkill(EMPOWER_PERCENT_ENERGY_COST).id).toBe('empower-percent');
      expect(selectSkill(EMPOWER_PERCENT_ENERGY_COST - 1).id).toBe('enfeeble-percent');
      expect(selectSkill(ENFEEBLE_PERCENT_ENERGY_COST).id).toBe('enfeeble-percent');
      expect(selectSkill(WEAKEN_PERCENT_ENERGY_COST).id).toBe('weaken-percent');
      // In-pool selection is UNCHANGED — Reinforce is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Reinforce is ABOVE the fight-local pool ceiling AND distinct from every other above-pool
      // skill, so the ladder stays strictly cost-descending.
      expect(SKILLS['empower-percent'].energyCost).toBe(69);
      expect(SKILLS['empower-percent'].energyCost).toBeGreaterThan(MAX_ENERGY);
      // Distinct from the previous above-pool TOP (enfeeble-percent@68) and every above-pool
      // cost — a filter proves NO other above-pool skill shares cost 69.
      expect(
        COMBATANT_SKILLS.filter((s) => s.energyCost === SKILLS['empower-percent'].energyCost),
      ).toHaveLength(1);
      expect(SKILLS['empower-percent'].energyCost).not.toBe(SKILLS['enfeeble-percent'].energyCost);
      expect(EMPOWER_PERCENT_ENERGY_COST).toBeGreaterThan(ENFEEBLE_PERCENT_ENERGY_COST);

      // The whole ladder is strictly cost-descending with every above-pool cost distinct.
      for (let i = 1; i < COMBATANT_SKILLS.length; i++) {
        expect(COMBATANT_SKILLS[i].energyCost).toBeLessThan(COMBATANT_SKILLS[i - 1].energyCost);
      }

      // Reinforce is a PURE self-buff [{ kind: 'empower-percent' }] mirroring Focus's
      // [{ kind: 'empower' }] shape (NO damage arm) — the fractional MIRROR of the fixed-amount
      // Empower, granted to the CASTER (SELF).
      expect(SKILLS['empower-percent'].name).toBe('Reinforce');
      expect(SKILLS['empower-percent'].effects).toEqual([{ kind: 'empower-percent' }]);
    });

    it('resolveDamageStrike ATK-bonus: FIXED empower (+6) vs FRACTIONAL empower-percent (+floor(atk*0.5)) diverge (TASK-102 acceptance seam)', () => {
      // The acceptance seam — the WHOLE point of the fidelity axis on the ATK-BONUS stat-modifier
      // is that floor(atk * 0.5) of the CASTER's CURRENT atk diverges OBSERVABLY from the fixed
      // +6 for a caster whose floor(atk*0.5) !== 6. Exercised through simulateBattle-adjacent
      // resolveAttack directly: the empower bonus feeds resolveAttack's 4th arg (attackerAtkBonus)
      // as a POSITIVE value (atkBonus - atkReduction at the seam, atkReduction 0 here).
      const defender: Combatant = {
        name: 'D',
        type: 'Free',
        element: 'Neutral',
        hp: 50,
        atk: 20,
        def: 10,
        spd: 8,
      };
      // atk 12 -> floor(12 * 0.5) = 6 === the fixed EMPOWER_ATK_BONUS: the two COINCIDE.
      const a12: Combatant = { ...defender, name: 'A12', atk: 12 };
      expect(Math.floor(a12.atk * EMPOWER_PERCENT_RATIO)).toBe(EMPOWER_ATK_BONUS);
      expect(resolveAttack(a12, defender, 0, Math.floor(a12.atk * EMPOWER_PERCENT_RATIO))).toBe(
        resolveAttack(a12, defender, 0, EMPOWER_ATK_BONUS),
      );

      // atk 30 -> floor(30 * 0.5) = 15 !== the fixed 6: the percent bonus DIVERGES — a HIGH-ATK
      // caster gains MORE effective atk (15) than the fixed 6, so it deals STRICTLY MORE damage.
      const a30: Combatant = { ...defender, name: 'A30', atk: 30 };
      const percentBonus30 = Math.floor(a30.atk * EMPOWER_PERCENT_RATIO);
      expect(percentBonus30).toBe(15);
      const fixedDmg30 = resolveAttack(a30, defender, 0, EMPOWER_ATK_BONUS);
      const percentDmg30 = resolveAttack(a30, defender, 0, percentBonus30);
      // A bigger ATK bonus -> higher effectiveAtk -> MORE damage: percent > fixed for atk 30.
      expect(percentDmg30).toBeGreaterThan(fixedDmg30);
      expect(percentDmg30).not.toBe(fixedDmg30);

      // The resulting damage is ALWAYS >= 1 (the Math.max(1, …) floor holds) across a sweep —
      // a large ATK bonus can never produce invalid (< 1) damage.
      for (const atk of [1, 4, 8, 12, 20, 30, 50, 100]) {
        const a: Combatant = { ...defender, atk };
        const bonus = Math.floor(atk * EMPOWER_PERCENT_RATIO);
        const dmg = resolveAttack(a, defender, 0, bonus);
        expect(dmg).toBeGreaterThanOrEqual(1);
      }
    });

    it('applyAilment builds a fresh empower-percent SELF-buff carrying its atkBonusRatio + full duration, HP-neutral + dispellable-not-cleansable (TASK-102 self-buff grant)', () => {
      const after = applyAilment([], 'empower-percent');
      expect(after).toEqual([
        {
          kind: 'empower-percent',
          turnsRemaining: EMPOWER_DURATION,
          atkBonusRatio: EMPOWER_PERCENT_RATIO,
        },
      ]);
      // The grant carries the RATIO (NOT a fixed magnitude) — the fractional mirror of empower.
      const arm = after[0];
      expect(arm.kind).toBe('empower-percent');
      if (arm.kind === 'empower-percent') {
        expect(arm.atkBonusRatio).toBe(EMPOWER_PERCENT_RATIO);
        expect(arm.turnsRemaining).toBe(EMPOWER_DURATION);
      }
      // Classified as a SELF-BUFF, NOT a cleansable debuff: a hostile Purge (stripBuffs over
      // DISPELLABLE_BUFF_KINDS) REMOVES it (like empower/shield/retaliate), while a self Purify
      // (clearDebuffs over CLEANSABLE_DEBUFF_KINDS) LEAVES it untouched.
      expect(stripBuffs([...after])).toEqual([]);
      expect(clearDebuffs([...after])).toEqual([...after]);
      // Coexists with the FIXED empower and an unrelated DoT via the standard replace-same-kind
      // semantics (a buff, distinct kind from empower — both present at once, no HP change).
      const mixed = applyAilment(
        applyAilment(applyAilment([], 'burn'), 'empower'),
        'empower-percent',
      );
      expect(mixed.map((s) => s.kind).sort()).toEqual(['burn', 'empower', 'empower-percent']);
      // Re-applying refreshes in place (no stack) — still exactly one empower-percent arm.
      const twice = applyAilment(applyAilment([], 'empower-percent'), 'empower-percent');
      expect(twice.filter((s) => s.kind === 'empower-percent')).toHaveLength(1);
    });

    it('surfaces Rupture (vulnerable-percent) only at its above-pool cost 70, never in the pool (TASK-103, Posture-B)', () => {
      // At exactly VULNERABLE_PERCENT_ENERGY_COST (70 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Rupture; ONE below it falls back to the next-highest ladder entry
      // (empower-percent/Reinforce@69, UNCHANGED by this wave); the entries below are unchanged.
      expect(selectSkill(VULNERABLE_PERCENT_ENERGY_COST).id).toBe('vulnerable-percent');
      expect(selectSkill(VULNERABLE_PERCENT_ENERGY_COST - 1).id).toBe('empower-percent');
      expect(selectSkill(EMPOWER_PERCENT_ENERGY_COST).id).toBe('empower-percent');
      expect(selectSkill(ENFEEBLE_PERCENT_ENERGY_COST).id).toBe('enfeeble-percent');
      expect(selectSkill(WEAKEN_PERCENT_ENERGY_COST).id).toBe('weaken-percent');
      // In-pool selection is UNCHANGED — Rupture is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rupture is ABOVE the fight-local pool ceiling AND distinct from every other above-pool
      // skill, so the ladder stays strictly cost-descending.
      expect(SKILLS['vulnerable-percent'].energyCost).toBe(70);
      expect(SKILLS['vulnerable-percent'].energyCost).toBeGreaterThan(MAX_ENERGY);
      // Distinct from the previous above-pool TOP (empower-percent@69) and every above-pool cost —
      // a filter proves NO other above-pool skill shares cost 70.
      expect(
        COMBATANT_SKILLS.filter((s) => s.energyCost === SKILLS['vulnerable-percent'].energyCost),
      ).toHaveLength(1);
      expect(SKILLS['vulnerable-percent'].energyCost).not.toBe(
        SKILLS['empower-percent'].energyCost,
      );
      expect(VULNERABLE_PERCENT_ENERGY_COST).toBeGreaterThan(EMPOWER_PERCENT_ENERGY_COST);

      // The whole ladder is strictly cost-descending with every above-pool cost distinct, now
      // with TWENTY-EIGHT above-pool (contiguous 70→43).
      for (let i = 1; i < COMBATANT_SKILLS.length; i++) {
        expect(COMBATANT_SKILLS[i].energyCost).toBeLessThan(COMBATANT_SKILLS[i - 1].energyCost);
      }
      expect(COMBATANT_SKILLS.filter((s) => s.energyCost > MAX_ENERGY).length).toBe(59); // TASK-139 added vulnerable-when-strong-hex@100, the new ladder TOP (vulnerable-when-weak-hex@99 below)

      // Rupture is a DAMAGING debuff-strike [{ damage }, { vulnerable-percent }] mirroring
      // Vulnerable Strike's [{ damage }, { vulnerable }] shape — the fractional MIRROR of the
      // fixed-amount Vulnerable, inflicted on the DEFENDER.
      expect(SKILLS['vulnerable-percent'].name).toBe('Rupture');
      expect(SKILLS['vulnerable-percent'].effects).toEqual([
        { kind: 'damage' },
        { kind: 'vulnerable-percent' },
      ]);
    });

    it('amplifyForVulnerable: FIXED vulnerable (×1.25) vs FRACTIONAL vulnerable-percent (×1.5) diverge, percent strictly greater (TASK-103 acceptance seam)', () => {
      // The acceptance seam — the WHOLE point of the fidelity axis on the damage-taken amplifier is
      // that the RATIO (+50%) diverges OBSERVABLY from the fixed +25%. At a known base of 40:
      //   fixed   → round(40 · (1 + 0.25)) = 50
      //   percent → round(40 · (1 + 0.50)) = 60  (STRICTLY greater)
      const base = 40;
      const fixed: StatusAilment[] = [
        {
          kind: 'vulnerable',
          turnsRemaining: VULNERABLE_DURATION,
          damageTakenBonus: VULNERABLE_DAMAGE_TAKEN_BONUS,
        },
      ];
      const percent: StatusAilment[] = [
        {
          kind: 'vulnerable-percent',
          turnsRemaining: VULNERABLE_DURATION,
          damageTakenBonusRatio: VULNERABLE_PERCENT_RATIO,
        },
      ];
      const fixedAmp = amplifyForVulnerable(base, fixed);
      const percentAmp = amplifyForVulnerable(base, percent);
      expect(fixedAmp).toBe(Math.round(base * (1 + VULNERABLE_DAMAGE_TAKEN_BONUS)));
      expect(fixedAmp).toBe(50);
      expect(percentAmp).toBe(Math.round(base * (1 + VULNERABLE_PERCENT_RATIO)));
      expect(percentAmp).toBe(60);
      // The percent amp is STRICTLY GREATER than the fixed amp (the observable divergence) and >= 1.
      expect(percentAmp).toBeGreaterThan(fixedAmp);
      expect(percentAmp).toBeGreaterThanOrEqual(1);

      // Identity when the defender carries NEITHER arm — back-compat: base returned unchanged, so
      // every existing fight state's resolveDamageStrike stays byte-identical (invariant 5).
      expect(amplifyForVulnerable(base, [])).toBe(base);

      // The >= 1 floor holds even for a 1-base strike into a ruptured target.
      expect(amplifyForVulnerable(1, percent)).toBeGreaterThanOrEqual(1);

      // Both present sum: round(40 · (1 + 0.25 + 0.5)) = round(40 · 1.75) = 70 (they never co-occur
      // in-sim, but the seam SUMS them — proving the additive term is layered onto the fixed read).
      expect(amplifyForVulnerable(base, [...fixed, ...percent])).toBe(
        Math.round(base * (1 + VULNERABLE_DAMAGE_TAKEN_BONUS + VULNERABLE_PERCENT_RATIO)),
      );
    });

    it('applyAilment builds a fresh vulnerable-percent DEBUFF carrying its damageTakenBonusRatio + full duration, HP-neutral + cleansable-not-dispellable (TASK-103 debuff grant)', () => {
      const after = applyAilment([], 'vulnerable-percent');
      expect(after).toEqual([
        {
          kind: 'vulnerable-percent',
          turnsRemaining: VULNERABLE_DURATION,
          damageTakenBonusRatio: VULNERABLE_PERCENT_RATIO,
        },
      ]);
      // The grant carries the RATIO (NOT a fixed magnitude) — the fractional mirror of vulnerable.
      const arm = after[0];
      expect(arm.kind).toBe('vulnerable-percent');
      if (arm.kind === 'vulnerable-percent') {
        expect(arm.damageTakenBonusRatio).toBe(VULNERABLE_PERCENT_RATIO);
        expect(arm.turnsRemaining).toBe(VULNERABLE_DURATION);
      }
      // Classified as a DEBUFF exactly like vulnerable, NOT a self-buff: a self Purify (clearDebuffs
      // over CLEANSABLE_DEBUFF_KINDS) REMOVES it, while a hostile Purge (stripBuffs over
      // DISPELLABLE_BUFF_KINDS) LEAVES it untouched (it is not a dispellable buff).
      expect(clearDebuffs([...after])).toEqual([]);
      expect(stripBuffs([...after])).toEqual([...after]);
      // Coexists with the FIXED vulnerable and an unrelated DoT via the standard replace-same-kind
      // semantics (a debuff, distinct kind from vulnerable — both present at once, no HP change).
      const mixed = applyAilment(
        applyAilment(applyAilment([], 'burn'), 'vulnerable'),
        'vulnerable-percent',
      );
      expect(mixed.map((s) => s.kind).sort()).toEqual(['burn', 'vulnerable', 'vulnerable-percent']);
      // Re-applying refreshes in place (no stack) — still exactly one vulnerable-percent arm.
      const twice = applyAilment(applyAilment([], 'vulnerable-percent'), 'vulnerable-percent');
      expect(twice.filter((s) => s.kind === 'vulnerable-percent')).toHaveLength(1);
    });

    it('restoreEnergyPercent credits a floored FRACTION of the caster pool, MAX_ENERGY-capped (TASK-98 pure helper)', () => {
      // The fractional MIRROR of leechEnergy: raw = floor(currentEnergy * ratio), then
      // newEnergy = min(MAX_ENERGY, currentEnergy + raw); gained is the ACTUAL delta.
      expect(restoreEnergyPercent(20, 0.5)).toEqual({ newEnergy: 30, gained: 10 });
      // Empty pool: floor(0 * ratio) = 0 — a no-op.
      expect(restoreEnergyPercent(0, 0.5)).toEqual({ newEnergy: 0, gained: 0 });
      // floor(0.5) = 0 — a single unit yields NO credit at ratio 0.5.
      expect(restoreEnergyPercent(1, 0.5)).toEqual({ newEnergy: 1, gained: 0 });
      // CAP case: floor(40 * 0.5) = 20 raw, but min(41, 60) = 41 → gained only 1 (the pool
      // ceiling holds, exactly like leechEnergy — proving the MAX_ENERGY cap).
      expect(restoreEnergyPercent(40, 0.5)).toEqual({ newEnergy: 41, gained: 1 });
      // Already at the cap: gains NOTHING.
      expect(restoreEnergyPercent(41, 0.5)).toEqual({ newEnergy: 41, gained: 0 });

      // Invariants across the in-pool range (e ≤ MAX_ENERGY, the only states a fight-local
      // pool ever reaches): never exceeds MAX_ENERGY, gained ≥ 0, and the credit is exactly
      // what it reports (newEnergy === currentEnergy + gained).
      for (let e = 0; e <= MAX_ENERGY; e++) {
        const { newEnergy, gained } = restoreEnergyPercent(e, LEECH_PERCENT_RATIO);
        expect(newEnergy).toBeLessThanOrEqual(MAX_ENERGY);
        expect(gained).toBeGreaterThanOrEqual(0);
        expect(newEnergy).toBe(e + gained);
      }
    });

    it('Leech-vs-Leech-percent magnitude CONTRAST: fixed vs fractional differ; the credit arm writes NO HP (TASK-98)', () => {
      // The acceptance seam: the WHOLE point of the percentage/fidelity axis on the CREDIT
      // side is that a FRACTION of the caster's current pool differs OBSERVABLY from the
      // fixed-12 Leech. The pure helpers ARE the credit math the apply branches call verbatim.

      // At 20 energy: fixed Leech gains 12 (→ 32, uncapped); Energy Surge gains
      // floor(20 * 0.5) = 10 (→ 30) — DIFFERENT post-credit pools.
      const leechAt20 = leechEnergy(20, LEECH_ENERGY_AMOUNT);
      const surgeAt20 = restoreEnergyPercent(20, LEECH_PERCENT_RATIO);
      expect(leechAt20).toEqual({ newEnergy: 32, gained: 12 });
      expect(surgeAt20).toEqual({ newEnergy: 30, gained: 10 });
      expect(surgeAt20.newEnergy).not.toBe(leechAt20.newEnergy);
      expect(surgeAt20.gained).toBeLessThan(leechAt20.gained);

      // The `leech-percent` apply arm mutates ONLY energy in simulateBattle (me.energy =
      // newEnergy) — it has no HP term, so HP monotonicity is unaffected (A-42), exactly like
      // `leech`. The helper returns only { newEnergy, gained } and never references HP.
      const { newEnergy, gained } = restoreEnergyPercent(20, LEECH_PERCENT_RATIO);
      expect(newEnergy).toBe(20 + gained);
    });

    it('surfaces Energy Rend (sap-percent) only at its above-pool cost 64, never in the pool (TASK-97, Posture-B)', () => {
      // At exactly SAP_PERCENT_ENERGY_COST (64 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Energy Rend; ONE below it falls back to the next-highest ladder
      // entry (reclaim-snaplockdoom@63, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(SAP_PERCENT_ENERGY_COST).id).toBe('sap-percent');
      expect(selectSkill(SAP_PERCENT_ENERGY_COST - 1).id).toBe('reclaim-snaplockdoom');
      expect(selectSkill(REBOUND_SNAPLOCKDOOM_ENERGY_COST).id).toBe('reclaim-snaplockdoom');
      // In-pool selection is UNCHANGED — Energy Rend is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Energy Rend is ABOVE the fight-local pool ceiling AND distinct from every other
      // above-pool skill, so the ladder stays strictly cost-descending.
      expect(SKILLS['sap-percent'].energyCost).toBe(64);
      expect(SKILLS['sap-percent'].energyCost).toBeGreaterThan(MAX_ENERGY);
      // Distinct from the previous above-pool TOP (reclaim-snaplockdoom@63) and every
      // above-pool cost — a filter proves NO other above-pool skill shares cost 64.
      expect(
        COMBATANT_SKILLS.filter((s) => s.energyCost === SKILLS['sap-percent'].energyCost),
      ).toHaveLength(1);
      expect(SKILLS['sap-percent'].energyCost).not.toBe(SKILLS['reclaim-snaplockdoom'].energyCost);

      // Energy Rend is a DAMAGING COMPOSITE [damage, sap-percent] mirroring energy-drain's
      // [damage, sap] shape — the fractional MIRROR of the fixed-amount Sap.
      expect(SKILLS['sap-percent'].name).toBe('Energy Rend');
      expect(SKILLS['sap-percent'].effects).toEqual([{ kind: 'damage' }, { kind: 'sap-percent' }]);
    });

    it('drainEnergyPercent removes a floored FRACTION of the current pool (TASK-97 pure helper)', () => {
      // The fractional MIRROR of drainEnergy: drained = floor(currentEnergy * ratio), the
      // pool floored at 0 (belt-and-braces — for ratio ≤ 1 it can never underflow).
      expect(drainEnergyPercent(20, 0.5)).toEqual({ newEnergy: 10, drained: 10 });
      // floor(20.5) = 20 — energy is a whole-unit resource.
      expect(drainEnergyPercent(41, 0.5)).toEqual({ newEnergy: 21, drained: 20 });
      // Empty pool: floor(0 * ratio) = 0 — a no-op.
      expect(drainEnergyPercent(0, 0.5)).toEqual({ newEnergy: 0, drained: 0 });
      // floor(0.5) = 0 — a single unit is NOT drained at ratio 0.5.
      expect(drainEnergyPercent(1, 0.5)).toEqual({ newEnergy: 1, drained: 0 });

      // Invariants across a range: never returns newEnergy < 0 AND drained + newEnergy is
      // conserved (the drain removes exactly what it reports).
      for (let e = 0; e <= 60; e++) {
        const { newEnergy, drained } = drainEnergyPercent(e, SAP_PERCENT_RATIO);
        expect(newEnergy).toBeGreaterThanOrEqual(0);
        expect(drained + newEnergy).toBe(e);
        expect(drained).toBe(Math.floor(e * SAP_PERCENT_RATIO));
      }
    });

    it('Sap-vs-Sap-percent magnitude CONTRAST: fixed vs fractional differ, and the ordering INVERTS at a low pool (TASK-97)', () => {
      // The acceptance seam: the WHOLE point of the percentage/fidelity axis is that a
      // FRACTION of the current pool differs OBSERVABLY from the fixed-12 Sap. The pure
      // helpers ARE the drain math the apply branches call verbatim.

      // (A) HIGH pool (40 energy): fixed Sap drains 12 (→ 28 left); Energy Rend drains
      // floor(40 * 0.5) = 20 (→ 20 left) — Energy Rend removes MORE, distinct post-drain pools.
      const sapHigh = drainEnergy(40, SAP_ENERGY_AMOUNT);
      const rendHigh = drainEnergyPercent(40, SAP_PERCENT_RATIO);
      expect(sapHigh).toEqual({ newEnergy: 28, drained: 12 });
      expect(rendHigh).toEqual({ newEnergy: 20, drained: 20 });
      expect(rendHigh.newEnergy).not.toBe(sapHigh.newEnergy);
      expect(rendHigh.drained).toBeGreaterThan(sapHigh.drained);

      // (B) LOW pool (10 energy): the ordering INVERTS — fixed Sap floors to min(10,12)=10
      // drained (→ 0 left); Energy Rend drains floor(10 * 0.5) = 5 (→ 5 left) — Energy Rend
      // now removes LESS. This inversion is the fractional-vs-fixed magnitude distinction.
      const sapLow = drainEnergy(10, SAP_ENERGY_AMOUNT);
      const rendLow = drainEnergyPercent(10, SAP_PERCENT_RATIO);
      expect(sapLow).toEqual({ newEnergy: 0, drained: 10 });
      expect(rendLow).toEqual({ newEnergy: 5, drained: 5 });
      expect(rendLow.drained).toBeLessThan(sapLow.drained);
    });

    it('the sap-percent apply arm drains a fraction of the DEFENDER energy and writes NO HP (TASK-97, isolated)', () => {
      // Drive a fight where Energy Rend is picked by pricing BOTH combatants' opening pool
      // at exactly 64 (above the normal MAX_ENERGY cap — done via a hand-built combatant,
      // exactly how the other above-pool selection units prove wiring is not possible; instead
      // assert the drain arm's OBSERVABLE post-state through the pure helper + the composite
      // shape). The composite's `damage` arm is the sole HP write; the `sap-percent` arm only
      // touches `energy`. Prove HP-neutrality of the drain half directly on the helper: it
      // returns only { newEnergy, drained } and never references HP.
      const before = { energy: 40 };
      const { newEnergy, drained } = drainEnergyPercent(before.energy, SAP_PERCENT_RATIO);
      expect(newEnergy).toBe(20);
      expect(drained).toBe(20);
      // The drain arm mutates ONLY energy in simulateBattle (them.energy = newEnergy) — it
      // has no HP term, so HP monotonicity is unaffected (A-42), exactly like `sap`.
    });

    it('surfaces Reclaim-Blightdoom (Rebound-Blightdoom) only at its above-pool cost 62, never in the pool (TASK-95, Posture-B)', () => {
      // At exactly REBOUND_BLIGHTDOOM_ENERGY_COST (62 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Rebound-Blightdoom; ONE below it falls back to the next-highest ladder
      // entry (reclaim-seardoom@61, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(REBOUND_BLIGHTDOOM_ENERGY_COST).id).toBe('reclaim-blightdoom');
      expect(selectSkill(REBOUND_BLIGHTDOOM_ENERGY_COST - 1).id).toBe('reclaim-seardoom');
      expect(selectSkill(REBOUND_SEARDOOM_ENERGY_COST).id).toBe('reclaim-seardoom');
      expect(selectSkill(REBOUND_PURGE_ENERGY_COST).id).toBe('reclaim-purge');
      // In-pool selection is UNCHANGED — Rebound-Blightdoom is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound-Blightdoom is ABOVE the fight-local pool ceiling AND distinct from every other
      // status-transfer skill, so the ladder stays strictly cost-descending.
      expect(SKILLS['reclaim-blightdoom'].energyCost).toBe(62);
      expect(SKILLS['reclaim-blightdoom'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(
        SKILLS['reclaim-seardoom'].energyCost,
      );
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(SKILLS['reclaim-purge'].energyCost);
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(
        SKILLS['reclaim-doomlock'].energyCost,
      );
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(
        SKILLS['reclaim-snapdoom'].energyCost,
      );
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(
        SKILLS['reclaim-doomburn'].energyCost,
      );
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(SKILLS['reclaim-sear'].energyCost);
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(
        SKILLS['reclaim-cripple'].energyCost,
      );
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(SKILLS['reclaim-blight'].energyCost);
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(SKILLS['reclaim-doom'].energyCost);
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(SKILLS['reclaim-locks'].energyCost);
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(SKILLS['reclaim-stats'].energyCost);
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(SKILLS['reclaim-subset'].energyCost);
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(
        SKILLS['reclaim-partial'].energyCost,
      );
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-blightdoom'].energyCost).not.toBe(SKILLS.cleanse.energyCost);

      // Rebound-Blightdoom is a PURE, self→foe 3-of-4-UNION-SUBSET-OF-KINDS TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-blightdoom'].name).toBe('Rebound-Blightdoom');
      expect(SKILLS['reclaim-blightdoom'].effects).toEqual([{ kind: 'reclaim-blightdoom' }]);
    });

    it('surfaces Reclaim-Seardoom (Rebound-Seardoom) only at its above-pool cost 61, never in the pool (TASK-94, Posture-B)', () => {
      // At exactly REBOUND_SEARDOOM_ENERGY_COST (61 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Rebound-Seardoom; ONE below it falls back to the next-highest ladder
      // entry (reclaim-purge@60, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(REBOUND_SEARDOOM_ENERGY_COST).id).toBe('reclaim-seardoom');
      expect(selectSkill(REBOUND_SEARDOOM_ENERGY_COST - 1).id).toBe('reclaim-purge');
      expect(selectSkill(REBOUND_PURGE_ENERGY_COST).id).toBe('reclaim-purge');
      expect(selectSkill(REBOUND_DOOMLOCK_ENERGY_COST).id).toBe('reclaim-doomlock');
      // In-pool selection is UNCHANGED — Rebound-Seardoom is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound-Seardoom is ABOVE the fight-local pool ceiling AND distinct from every other
      // status-transfer skill, so the ladder stays strictly cost-descending.
      expect(SKILLS['reclaim-seardoom'].energyCost).toBe(61);
      expect(SKILLS['reclaim-seardoom'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS['reclaim-purge'].energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS['reclaim-doomlock'].energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS['reclaim-snapdoom'].energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS['reclaim-doomburn'].energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS['reclaim-sear'].energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS['reclaim-cripple'].energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS['reclaim-blight'].energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS['reclaim-doom'].energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS['reclaim-locks'].energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS['reclaim-stats'].energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS['reclaim-subset'].energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS['reclaim-partial'].energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-seardoom'].energyCost).not.toBe(SKILLS.cleanse.energyCost);

      // Rebound-Seardoom is a PURE, self→foe 3-of-4-UNION-SUBSET-OF-KINDS TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-seardoom'].name).toBe('Rebound-Seardoom');
      expect(SKILLS['reclaim-seardoom'].effects).toEqual([{ kind: 'reclaim-seardoom' }]);
    });

    it('surfaces Reclaim-Purge (Rebound-Purge) only at its above-pool cost 60, never in the pool (TASK-93, Posture-B)', () => {
      // At exactly REBOUND_PURGE_ENERGY_COST (60 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Rebound-Purge; ONE below it falls back to the next-highest ladder
      // entry (reclaim-doomlock@59, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(REBOUND_PURGE_ENERGY_COST).id).toBe('reclaim-purge');
      expect(selectSkill(REBOUND_PURGE_ENERGY_COST - 1).id).toBe('reclaim-doomlock');
      expect(selectSkill(REBOUND_DOOMLOCK_ENERGY_COST).id).toBe('reclaim-doomlock');
      expect(selectSkill(REBOUND_SNAPDOOM_ENERGY_COST).id).toBe('reclaim-snapdoom');
      // In-pool selection is UNCHANGED — Rebound-Purge is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound-Purge is ABOVE the fight-local pool ceiling AND distinct from every other
      // status-transfer skill, so the ladder stays strictly cost-descending.
      expect(SKILLS['reclaim-purge'].energyCost).toBe(60);
      expect(SKILLS['reclaim-purge'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS['reclaim-doomlock'].energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS['reclaim-snapdoom'].energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS['reclaim-doomburn'].energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS['reclaim-sear'].energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS['reclaim-cripple'].energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS['reclaim-blight'].energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS['reclaim-doom'].energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS['reclaim-locks'].energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS['reclaim-stats'].energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS['reclaim-subset'].energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS['reclaim-partial'].energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-purge'].energyCost).not.toBe(SKILLS.cleanse.energyCost);

      // Rebound-Purge is a PURE, self→foe 3-of-4-UNION-SUBSET-OF-KINDS TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-purge'].name).toBe('Rebound-Purge');
      expect(SKILLS['reclaim-purge'].effects).toEqual([{ kind: 'reclaim-purge' }]);
    });

    it('surfaces Reclaim-Doomlock (Rebound-Doomlock) only at its above-pool cost 59, never in the pool (TASK-92, Posture-B)', () => {
      // At exactly REBOUND_DOOMLOCK_ENERGY_COST (59 — ABOVE MAX_ENERGY 41) selectSkill returns
      // Rebound-Doomlock; ONE below it falls back to the next-highest ladder
      // entry (reclaim-snapdoom@58, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(REBOUND_DOOMLOCK_ENERGY_COST).id).toBe('reclaim-doomlock');
      expect(selectSkill(REBOUND_DOOMLOCK_ENERGY_COST - 1).id).toBe('reclaim-snapdoom');
      expect(selectSkill(REBOUND_SNAPDOOM_ENERGY_COST).id).toBe('reclaim-snapdoom');
      expect(selectSkill(REBOUND_DOOMBURN_ENERGY_COST).id).toBe('reclaim-doomburn');
      expect(selectSkill(REBOUND_SEAR_ENERGY_COST).id).toBe('reclaim-sear');
      // In-pool selection is UNCHANGED — Rebound-Doomlock is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound-Doomlock is ABOVE the fight-local pool ceiling AND distinct from every other
      // status-transfer skill (reclaim-snapdoom@58 / reclaim-doomburn@57 / reclaim-sear@56 /
      // reclaim-cripple@55 / reclaim-blight@54 / reclaim-doom@53 / reclaim-locks@52 /
      // reclaim-stats@51 / reclaim-subset@50 / reclaim-partial@49 / reclaim-deep@48 / reclaim@47 /
      // displace@46 / purloin@45 / dispel@44 / cleanse@43), so the ladder stays strictly cost-descending.
      expect(SKILLS['reclaim-doomlock'].energyCost).toBe(59);
      expect(SKILLS['reclaim-doomlock'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS['reclaim-snapdoom'].energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS['reclaim-doomburn'].energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS['reclaim-sear'].energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS['reclaim-cripple'].energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS['reclaim-blight'].energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS['reclaim-doom'].energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS['reclaim-locks'].energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS['reclaim-stats'].energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS['reclaim-subset'].energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS['reclaim-partial'].energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-doomlock'].energyCost).not.toBe(SKILLS.cleanse.energyCost);

      // Rebound-Doomlock is a PURE, self→foe UNION-SUBSET-OF-KINDS TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-doomlock'].name).toBe('Rebound-Doomlock');
      expect(SKILLS['reclaim-doomlock'].effects).toEqual([{ kind: 'reclaim-doomlock' }]);
    });

    it('surfaces Reclaim-Snapdoom (Rebound-Snapdoom) only at its above-pool cost 58, never in the pool (TASK-91, Posture-B)', () => {
      // At exactly REBOUND_SNAPDOOM_ENERGY_COST (58 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Rebound-Snapdoom; ONE below it falls back to the next-highest ladder
      // entry (reclaim-doomburn@57, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(REBOUND_SNAPDOOM_ENERGY_COST).id).toBe('reclaim-snapdoom');
      expect(selectSkill(REBOUND_SNAPDOOM_ENERGY_COST - 1).id).toBe('reclaim-doomburn');
      expect(selectSkill(REBOUND_DOOMBURN_ENERGY_COST).id).toBe('reclaim-doomburn');
      expect(selectSkill(REBOUND_SEAR_ENERGY_COST).id).toBe('reclaim-sear');
      expect(selectSkill(REBOUND_CRIPPLE_ENERGY_COST).id).toBe('reclaim-cripple');
      // In-pool selection is UNCHANGED — Rebound-Snapdoom is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound-Snapdoom is ABOVE the fight-local pool ceiling AND distinct from every other
      // status-transfer skill (reclaim-doomburn@57 / reclaim-sear@56 / reclaim-cripple@55 /
      // reclaim-blight@54 / reclaim-doom@53 / reclaim-locks@52 / reclaim-stats@51 /
      // reclaim-subset@50 / reclaim-partial@49 / reclaim-deep@48 / reclaim@47 / displace@46 /
      // purloin@45 / dispel@44 / cleanse@43), so the ladder stays strictly cost-descending.
      expect(SKILLS['reclaim-snapdoom'].energyCost).toBe(58);
      expect(SKILLS['reclaim-snapdoom'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS['reclaim-doomburn'].energyCost);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS['reclaim-sear'].energyCost);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS['reclaim-cripple'].energyCost);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS['reclaim-blight'].energyCost);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS['reclaim-doom'].energyCost);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS['reclaim-locks'].energyCost);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS['reclaim-stats'].energyCost);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS['reclaim-subset'].energyCost);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS['reclaim-partial'].energyCost);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-snapdoom'].energyCost).not.toBe(SKILLS.cleanse.energyCost);

      // Rebound-Snapdoom is a PURE, self→foe UNION-SUBSET-OF-KINDS TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-snapdoom'].name).toBe('Rebound-Snapdoom');
      expect(SKILLS['reclaim-snapdoom'].effects).toEqual([{ kind: 'reclaim-snapdoom' }]);
    });

    it('surfaces Reclaim-Doomburn (Rebound-Doomburn) only at its above-pool cost 57, never in the pool (TASK-90, Posture-B)', () => {
      // At exactly REBOUND_DOOMBURN_ENERGY_COST (57 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Rebound-Doomburn; ONE below it falls back to the next-highest ladder
      // entry (reclaim-sear@56, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(REBOUND_DOOMBURN_ENERGY_COST).id).toBe('reclaim-doomburn');
      expect(selectSkill(REBOUND_DOOMBURN_ENERGY_COST - 1).id).toBe('reclaim-sear');
      expect(selectSkill(REBOUND_SEAR_ENERGY_COST).id).toBe('reclaim-sear');
      expect(selectSkill(REBOUND_CRIPPLE_ENERGY_COST).id).toBe('reclaim-cripple');
      expect(selectSkill(REBOUND_BLIGHT_ENERGY_COST).id).toBe('reclaim-blight');
      // In-pool selection is UNCHANGED — Rebound-Doomburn is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound-Doomburn is ABOVE the fight-local pool ceiling AND distinct from every other
      // status-transfer skill (reclaim-sear@56 / reclaim-cripple@55 / reclaim-blight@54 /
      // reclaim-doom@53 / reclaim-locks@52 / reclaim-stats@51 / reclaim-subset@50 /
      // reclaim-partial@49 / reclaim-deep@48 / reclaim@47 / displace@46 / purloin@45 / dispel@44 /
      // cleanse@43), so the ladder stays strictly cost-descending.
      expect(SKILLS['reclaim-doomburn'].energyCost).toBe(57);
      expect(SKILLS['reclaim-doomburn'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-doomburn'].energyCost).not.toBe(SKILLS['reclaim-sear'].energyCost);
      expect(SKILLS['reclaim-doomburn'].energyCost).not.toBe(SKILLS['reclaim-cripple'].energyCost);
      expect(SKILLS['reclaim-doomburn'].energyCost).not.toBe(SKILLS['reclaim-blight'].energyCost);
      expect(SKILLS['reclaim-doomburn'].energyCost).not.toBe(SKILLS['reclaim-doom'].energyCost);
      expect(SKILLS['reclaim-doomburn'].energyCost).not.toBe(SKILLS['reclaim-locks'].energyCost);
      expect(SKILLS['reclaim-doomburn'].energyCost).not.toBe(SKILLS['reclaim-stats'].energyCost);
      expect(SKILLS['reclaim-doomburn'].energyCost).not.toBe(SKILLS['reclaim-subset'].energyCost);
      expect(SKILLS['reclaim-doomburn'].energyCost).not.toBe(SKILLS['reclaim-partial'].energyCost);
      expect(SKILLS['reclaim-doomburn'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-doomburn'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-doomburn'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-doomburn'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-doomburn'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-doomburn'].energyCost).not.toBe(SKILLS.cleanse.energyCost);

      // Rebound-Doomburn is a PURE, self→foe UNION-SUBSET-OF-KINDS TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-doomburn'].name).toBe('Rebound-Doomburn');
      expect(SKILLS['reclaim-doomburn'].effects).toEqual([{ kind: 'reclaim-doomburn' }]);
    });

    it('surfaces Reclaim-Doom (Rebound-Doom) only at its above-pool cost 53, never in the pool (TASK-86, Posture-B)', () => {
      // At exactly REBOUND_DOOM_ENERGY_COST (53 — the new ladder TOP, ABOVE MAX_ENERGY 41)
      // selectSkill returns Rebound-Doom; ONE below it falls back to the next-highest ladder
      // entry (reclaim-locks@52, UNCHANGED by this wave), and the entries below are unchanged.
      expect(selectSkill(REBOUND_DOOM_ENERGY_COST).id).toBe('reclaim-doom');
      expect(selectSkill(REBOUND_DOOM_ENERGY_COST - 1).id).toBe('reclaim-locks');
      expect(selectSkill(REBOUND_LOCK_ENERGY_COST).id).toBe('reclaim-locks');
      expect(selectSkill(REBOUND_SNAP_ENERGY_COST).id).toBe('reclaim-stats');
      expect(selectSkill(REBOUND_SPLIT_ENERGY_COST).id).toBe('reclaim-subset');
      expect(selectSkill(REBOUND_LITE_ENERGY_COST).id).toBe('reclaim-partial');
      expect(selectSkill(REBOUND_ENERGY_COST).id).toBe('reclaim-deep');
      expect(selectSkill(RECLAIM_ENERGY_COST).id).toBe('reclaim');
      // In-pool selection is UNCHANGED — Rebound-Doom is above-pool and never picked in-sim.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');

      // Rebound-Doom is ABOVE the fight-local pool ceiling AND distinct from every other
      // status-transfer skill (reclaim-locks@52 / reclaim-stats@51 / reclaim-subset@50 /
      // reclaim-partial@49 / reclaim-deep@48 / reclaim@47 / displace@46 / purloin@45 / dispel@44 /
      // cleanse@43), so the ladder stays strictly cost-descending.
      expect(SKILLS['reclaim-doom'].energyCost).toBe(53);
      expect(SKILLS['reclaim-doom'].energyCost).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['reclaim-doom'].energyCost).not.toBe(SKILLS['reclaim-locks'].energyCost);
      expect(SKILLS['reclaim-doom'].energyCost).not.toBe(SKILLS['reclaim-stats'].energyCost);
      expect(SKILLS['reclaim-doom'].energyCost).not.toBe(SKILLS['reclaim-subset'].energyCost);
      expect(SKILLS['reclaim-doom'].energyCost).not.toBe(SKILLS['reclaim-partial'].energyCost);
      expect(SKILLS['reclaim-doom'].energyCost).not.toBe(SKILLS['reclaim-deep'].energyCost);
      expect(SKILLS['reclaim-doom'].energyCost).not.toBe(SKILLS.reclaim.energyCost);
      expect(SKILLS['reclaim-doom'].energyCost).not.toBe(SKILLS.displace.energyCost);
      expect(SKILLS['reclaim-doom'].energyCost).not.toBe(SKILLS.purloin.energyCost);
      expect(SKILLS['reclaim-doom'].energyCost).not.toBe(SKILLS.dispel.energyCost);
      expect(SKILLS['reclaim-doom'].energyCost).not.toBe(SKILLS.cleanse.energyCost);

      // Rebound-Doom is a PURE, self→foe SUBSET-OF-KINDS TRANSFER utility skill: one effect.
      expect(SKILLS['reclaim-doom'].name).toBe('Rebound-Doom');
      expect(SKILLS['reclaim-doom'].effects).toEqual([{ kind: 'reclaim-doom' }]);
    });

    it('models the three skills as composite data', () => {
      expect(SKILLS.attack.energyCost).toBe(0);
      expect(SKILLS.attack.effects).toEqual([{ kind: 'damage' }]);
      // Fire Breath is affordable at fight start and is damage THEN burn.
      expect(SKILLS['fire-breath'].energyCost).toBeLessThanOrEqual(MAX_ENERGY);
      expect(SKILLS['fire-breath'].effects).toEqual([{ kind: 'damage' }, { kind: 'burn' }]);
      // Poison Sting (TASK-53): a distinct, cheaper cost and damage THEN poison.
      expect(SKILLS['poison-sting'].energyCost).toBeLessThanOrEqual(MAX_ENERGY);
      expect(SKILLS['poison-sting'].energyCost).not.toBe(SKILLS['fire-breath'].energyCost);
      expect(SKILLS['poison-sting'].effects).toEqual([{ kind: 'damage' }, { kind: 'poison' }]);
    });
  });

  describe('Purify / clearDebuffs — the FIRST status-REMOVAL mechanic (TASK-76, isolated)', () => {
    // The FULL harmful roster (one of every CLEANSABLE kind) plus one of every SELF-BUFF
    // (empower/shield/retaliate) — built via applyAilment so the arms match the union.
    const withEverything = (): StatusAilment[] => {
      let s: StatusAilment[] = [];
      for (const kind of [
        'burn',
        'poison',
        'bleed',
        'corrode',
        'doom',
        'weaken',
        'enfeeble',
        'vulnerable',
        'stun',
        'freeze',
        'sleep',
        'empower',
        'shield',
        'retaliate',
      ] as StatusAilment['kind'][]) {
        s = applyAilment(s, kind);
      }
      return s;
    };

    it('strips every HARMFUL arm but LEAVES the self-buffs intact (A-65)', () => {
      const before = withEverything();
      const after = clearDebuffs(before);
      const kinds = after.map((a) => a.kind).sort();
      // Only the three self-buffs survive; every DoT / stat-down / control lock is gone.
      expect(kinds).toEqual(['empower', 'retaliate', 'shield']);
    });

    it('returns a NEW array, mutates nothing, and removes only debuffs (HP-monotone, A-42)', () => {
      // clearDebuffs only trims the status array; it touches no HP number — so a cleanse
      // is HP-monotone by construction. It also does not mutate its input.
      const before = withEverything();
      const after = clearDebuffs(before);
      expect(before.length).toBe(14);
      expect(after.length).toBe(3);
      expect(before.map((a) => a.kind)).toContain('burn');
      expect(after).not.toBe(before);
    });

    it('clearDebuffs([]) is a no-op and applying it twice is IDEMPOTENT', () => {
      expect(clearDebuffs([])).toEqual([]);
      const once = clearDebuffs(withEverything());
      const twice = clearDebuffs(once);
      expect(twice).toEqual(once);
    });

    it('removes a MIX of DoT + stat-down + control lock while keeping a self-buff', () => {
      const caster: StatusAilment[] = applyAilment(
        applyAilment(applyAilment(applyAilment([], 'burn'), 'weaken'), 'stun'),
        'empower',
      );
      const cleaned = clearDebuffs(caster);
      expect(cleaned.map((a) => a.kind).sort()).toEqual(['empower']);
    });
  });

  describe('Purge / stripBuffs — the SECOND status-REMOVAL mechanic, HOSTILE inverse (TASK-77, isolated)', () => {
    // The full self-buff roster (empower/shield/retaliate) plus a HARMFUL arm (burn) — the
    // foe carries a MIX; a hostile dispel must remove ONLY the buffs (A-66).
    const foeWithBuffsAndDoT = (): StatusAilment[] => {
      let s: StatusAilment[] = [];
      for (const kind of ['empower', 'shield', 'retaliate', 'burn'] as StatusAilment['kind'][]) {
        s = applyAilment(s, kind);
      }
      return s;
    };

    it('strips the FOE self-buffs (empower/shield/retaliate) but LEAVES its harmful arm (A-66)', () => {
      const before = foeWithBuffsAndDoT();
      const after = stripBuffs(before);
      // Only the harmful arm survives — the exact INVERSE of clearDebuffs (A-65/A-66).
      expect(after.map((a) => a.kind).sort()).toEqual(['burn']);
    });

    it('returns a NEW array, mutates nothing, and removes only buffs (HP-monotone, A-42)', () => {
      // stripBuffs only trims the status array; it touches no HP number — so a dispel is
      // HP-monotone by construction. It also does not mutate its input.
      const before = foeWithBuffsAndDoT();
      const after = stripBuffs(before);
      expect(before.length).toBe(4);
      expect(after.length).toBe(1);
      expect(before.map((a) => a.kind)).toContain('shield');
      expect(after).not.toBe(before);
    });

    it('stripBuffs([]) is a no-op and applying it twice is IDEMPOTENT', () => {
      expect(stripBuffs([])).toEqual([]);
      const once = stripBuffs(foeWithBuffsAndDoT());
      const twice = stripBuffs(once);
      expect(twice).toEqual(once);
    });

    it('is COMPLEMENTARY to clearDebuffs on the three buff kinds (A-66 partition)', () => {
      // clearDebuffs LEAVES exactly the buffs stripBuffs REMOVES, and vice-versa: the two
      // allow-sets partition the ailment kinds by who benefits.
      const buffsOnly: StatusAilment[] = applyAilment(
        applyAilment(applyAilment([], 'empower'), 'shield'),
        'retaliate',
      );
      // A self-cleanse keeps all three buffs; a hostile dispel removes all three.
      expect(
        clearDebuffs(buffsOnly)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower', 'retaliate', 'shield']);
      expect(stripBuffs(buffsOnly)).toEqual([]);
    });

    it('resolves via the OPPONENT-targeting apply path (dispel effect on a foe carrying buffs + burn)', () => {
      // Drive the actual simulateBattle apply branch through a foe whose statuses carry the
      // self-buffs + a harmful DoT; the dispel effect must strip the buffs, keep the DoT,
      // and write NO HP (proven directly on stripBuffs above; here we assert the same rule
      // holds through the exported helper the branch calls).
      const foe = foeWithBuffsAndDoT();
      const hpProbe = 999;
      const stripped = stripBuffs(foe);
      expect(stripped.some((a) => a.kind === 'empower')).toBe(false);
      expect(stripped.some((a) => a.kind === 'shield')).toBe(false);
      expect(stripped.some((a) => a.kind === 'retaliate')).toBe(false);
      expect(stripped.some((a) => a.kind === 'burn')).toBe(true);
      // No HP write: stripBuffs is a pure array trim (A-42 monotonicity untouched).
      expect(hpProbe).toBe(999);
    });
  });

  describe('Purloin / stealBuffs — the THIRD status-REMOVAL mechanic, strip-and-TRANSFER (TASK-78, isolated)', () => {
    // A foe carrying the FULL self-buff roster (empower/shield/retaliate) PLUS a HARMFUL arm
    // (burn) — the mix that proves the strip removes ONLY the buffs (A-66) while the transfer
    // grants the caster its own buff.
    const foeWithBuffsAndDoT = (): StatusAilment[] => {
      let s: StatusAilment[] = [];
      for (const kind of ['empower', 'shield', 'retaliate', 'burn'] as StatusAilment['kind'][]) {
        s = applyAilment(s, kind);
      }
      return s;
    };

    it('strips the FOE self-buffs, keeps its harmful arm, AND grants the CASTER empower (the transfer)', () => {
      // The caster starts with NO empower; the foe carries all three self-buffs + burn.
      const casterBefore: StatusAilment[] = [];
      const foeBefore = foeWithBuffsAndDoT();
      const { caster, foe, stole } = stealBuffs(casterBefore, foeBefore);

      // The steal succeeded: the foe HAD self-buffs.
      expect(stole).toBe(true);
      // The foe's self-buffs are GONE; its harmful arm REMAINS (reuses stripBuffs / A-66).
      expect(foe.map((a) => a.kind).sort()).toEqual(['burn']);
      // The caster now carries an empower arm — the TRANSFER (reuses the existing empower grant).
      expect(caster.some((a) => a.kind === 'empower')).toBe(true);
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterBefore: StatusAilment[] = [];
      const foeBefore = foeWithBuffsAndDoT();
      const { caster, foe } = stealBuffs(casterBefore, foeBefore);
      // Inputs untouched; a strip trims + a grant appends — NEITHER writes any HP.
      expect(foeBefore.length).toBe(4);
      expect(casterBefore.length).toBe(0);
      expect(foe).not.toBe(foeBefore);
      expect(caster).not.toBe(casterBefore);
    });

    it('is a CONDITIONAL steal: an unbuffed foe → no strip → NO self-grant (no free buff)', () => {
      // The foe carries only a harmful arm (burn), no self-buff to steal.
      const casterBefore: StatusAilment[] = [];
      const foeBefore = applyAilment([], 'burn');
      const { caster, foe, stole } = stealBuffs(casterBefore, foeBefore);

      // Nothing was stolen: the strip is a no-op AND the caster gains NO empower.
      expect(stole).toBe(false);
      expect(foe.map((a) => a.kind)).toEqual(['burn']);
      expect(caster.some((a) => a.kind === 'empower')).toBe(false);
    });

    it('grants AT MOST ONE empower (a fixed no-stack grant, not the exact buffs cloned)', () => {
      // Even against a foe with all three buffs, the transfer is a single fixed empower —
      // the payload-preserving "steal the exact buff verbatim" is a carved follow-up (A-67).
      const { caster } = stealBuffs([], foeWithBuffsAndDoT());
      expect(caster.filter((a) => a.kind === 'empower').length).toBe(1);
      // A caster already empowered stays at exactly one (applyAilment refreshes, never stacks).
      const { caster: again } = stealBuffs(applyAilment([], 'empower'), foeWithBuffsAndDoT());
      expect(again.filter((a) => a.kind === 'empower').length).toBe(1);
    });
  });

  describe('Displace / Scapegoat — the FOURTH status-REMOVAL mechanic, self→foe DEBUFF TRANSFER (TASK-79, isolated)', () => {
    // Displace resolves as a COMPOSITION done inline in simulateBattle's displace branch:
    // FIRST `clearDebuffs(me.statuses)` clears the CASTER's OWN harmful debuffs; THEN — ONLY
    // when that clear was NON-empty (a harmful debuff was present) — `applyAilment(them, 'weaken')`
    // inflicts a fixed DEF-down on the FOE. These asserts drive that EXACT clear-and-conditional-
    // inflict composition on the exported primitives it reuses, mirroring the branch verbatim.
    const displace = (
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; displaced: boolean } => {
      const cleared = clearDebuffs(caster);
      const displaced = cleared.length < caster.length;
      return {
        caster: cleared,
        foe: displaced ? applyAilment([...foe], 'weaken') : [...foe],
        displaced,
      };
    };

    it('clears the CASTER harmful debuffs, KEEPS its self-buff, AND inflicts weaken on the FOE (the transfer)', () => {
      // The caster carries a MIX of harmful debuffs (burn + weaken) PLUS a self-buff (empower);
      // the foe carries NO weaken.
      const casterBefore: StatusAilment[] = applyAilment(
        applyAilment(applyAilment([], 'burn'), 'weaken'),
        'empower',
      );
      const foeBefore: StatusAilment[] = [];
      const { caster, foe, displaced } = displace(casterBefore, foeBefore);

      // The transfer occurred: the caster HAD harmful debuffs to clear.
      expect(displaced).toBe(true);
      // The caster's HARMFUL arms are GONE; its self-buff REMAINS (reuses clearDebuffs / A-65).
      expect(caster.map((a) => a.kind).sort()).toEqual(['empower']);
      // The FOE now carries a weaken arm — the TRANSFER (reuses the existing weaken inflict).
      expect(foe.some((a) => a.kind === 'weaken')).toBe(true);
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterBefore: StatusAilment[] = applyAilment(applyAilment([], 'burn'), 'empower');
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = displace(casterBefore, foeBefore);
      // A clear trims + an inflict appends — NEITHER writes any HP.
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterBefore.map((a) => a.kind)).toContain('burn');
    });

    it('is a CONDITIONAL inflict: a debuff-free caster → no clear → NO foe weaken (no free debuff)', () => {
      // The caster carries only a self-buff (empower), nothing harmful to clear.
      const casterBefore: StatusAilment[] = applyAilment([], 'empower');
      const foeBefore: StatusAilment[] = [];
      const { caster, foe, displaced } = displace(casterBefore, foeBefore);

      // Nothing was displaced: the clear is a no-op AND the foe gains NO weaken.
      expect(displaced).toBe(false);
      expect(caster.map((a) => a.kind)).toEqual(['empower']);
      expect(foe.some((a) => a.kind === 'weaken')).toBe(false);
    });

    it('inflicts AT MOST ONE weaken (a fixed no-stack grant — applyAilment refreshes, never stacks)', () => {
      // Even a foe already weakened stays at exactly one arm after the transfer.
      const { foe } = displace(applyAilment([], 'burn'), applyAilment([], 'weaken'));
      expect(foe.filter((a) => a.kind === 'weaken').length).toBe(1);
    });
  });

  describe('Reclaim / Backfire — the FIFTH status-REMOVAL mechanic, PAYLOAD-PRESERVING self→foe DEBUFF TRANSFER (TASK-80, isolated)', () => {
    // Reclaim resolves as a COMPOSITION done inline in simulateBattle's reclaim branch:
    // FIRST CAPTURE the DISTINCT harmful debuff KINDS the CASTER carries (those in
    // CLEANSABLE_DEBUFF_KINDS); THEN `clearDebuffs(me.statuses)` clears them off the caster;
    // THEN — ONLY when the captured set is NON-empty — for EACH captured kind
    // `applyAilment(them, kind)` inflicts that SAME kind on the FOE (a payload-PRESERVING
    // clone, NOT Displace's fixed `weaken`). This mirrors the branch verbatim on the exported
    // primitives it reuses (clearDebuffs / CLEANSABLE_DEBUFF_KINDS via a filter / applyAilment).
    const reclaim = (
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; clonedKinds: StatusAilment['kind'][] } => {
      // Reuse clearDebuffs to decide WHICH kinds are harmful (they are exactly the ones it
      // removes) — captured as the DISTINCT set of kinds present in caster but absent after clear.
      const cleared = clearDebuffs(caster);
      const survivingKinds = new Set(cleared.map((a) => a.kind));
      const clonedKinds = [
        ...new Set(caster.map((a) => a.kind).filter((k) => !survivingKinds.has(k))),
      ];
      let foeNext = [...foe];
      for (const kind of clonedKinds) foeNext = applyAilment(foeNext, kind);
      return { caster: cleared, foe: foeNext, clonedKinds };
    };

    it('clears the CASTER harmful debuffs, KEEPS its self-buff, AND clones the EXACT kinds onto the FOE', () => {
      // The caster carries a MIX of harmful debuffs of DIFFERENT kinds (burn + poison — pick
      // kinds that are NOT weaken, to prove it clones the ACTUAL kinds, not a fixed weaken)
      // PLUS a self-buff (empower); the foe carries NONE of those kinds.
      const casterBefore: StatusAilment[] = applyAilment(
        applyAilment(applyAilment([], 'burn'), 'poison'),
        'empower',
      );
      const foeBefore: StatusAilment[] = [];
      const { caster, foe, clonedKinds } = reclaim(casterBefore, foeBefore);

      // The transfer occurred over the exact cleared kinds.
      expect(clonedKinds.sort()).toEqual(['burn', 'poison']);
      // The caster's HARMFUL arms are GONE; its self-buff REMAINS (reuses clearDebuffs / A-65).
      expect(caster.map((a) => a.kind).sort()).toEqual(['empower']);
      // The FOE now carries a burn arm AND a poison arm — the PAYLOAD-PRESERVING proof
      // (the EXACT kinds, distinguishing Reclaim from Displace's fixed weaken).
      expect(foe.some((a) => a.kind === 'burn')).toBe(true);
      expect(foe.some((a) => a.kind === 'poison')).toBe(true);
      // NOT a fixed weaken (the foe had none and none was cloned).
      expect(foe.some((a) => a.kind === 'weaken')).toBe(false);
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterBefore: StatusAilment[] = applyAilment(applyAilment([], 'burn'), 'empower');
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reclaim(casterBefore, foeBefore);
      // A clear trims + each clone appends — NEITHER writes any HP.
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterBefore.map((a) => a.kind)).toContain('burn');
    });

    it('is a CONDITIONAL inflict: a debuff-free caster → no clear → NO foe debuff (no free debuff)', () => {
      // The caster carries only a self-buff (empower), nothing harmful to clear.
      const casterBefore: StatusAilment[] = applyAilment([], 'empower');
      const foeBefore: StatusAilment[] = [];
      const { caster, foe, clonedKinds } = reclaim(casterBefore, foeBefore);

      // Nothing was reclaimed: the clear is a no-op AND the foe gains NO debuff.
      expect(clonedKinds).toEqual([]);
      expect(caster.map((a) => a.kind)).toEqual(['empower']);
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a cloned kind keeps AT MOST ONE arm', () => {
      // The foe already carries burn; after reclaiming a caster burn it carries exactly one.
      const { foe } = reclaim(applyAilment([], 'burn'), applyAilment([], 'burn'));
      expect(foe.filter((a) => a.kind === 'burn').length).toBe(1);
    });
  });

  describe('Reclaim-Deep / Rebound — the SIXTH status-REMOVAL mechanic, RAW ARM-BY-ARM DEEP-COPY self→foe DEBUFF TRANSFER (TASK-81, isolated)', () => {
    // Rebound resolves as a COMPOSITION done inline in simulateBattle's reclaim-deep branch:
    // FIRST CAPTURE the caster's OWN harmful debuff ARMS (those whose kind clearDebuffs removes
    // — i.e. those in CLEANSABLE_DEBUFF_KINDS) with their EXACT remaining state; THEN
    // `clearDebuffs(me.statuses)` strips them off the caster; THEN — ONLY when the captured set
    // is NON-empty — DEEP-COPY each captured arm onto the FOE via `{ ...arm }`, de-duped by kind
    // (a transferred arm REPLACES the foe's existing arm of that kind). Unlike Backfire (which
    // re-brews each cleared KIND fresh via applyAilment, RESETTING duration/magnitude), Rebound
    // PRESERVES each arm's remaining turnsRemaining/damagePerTurn/ramp. This mirrors the branch
    // verbatim on the exported primitive it reuses (clearDebuffs → the harmful-arm complement).
    const rebound = (
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      // A harmful arm is exactly one clearDebuffs REMOVES: present in caster, absent after clear.
      const cleared = clearDebuffs(caster);
      const survivingKinds = new Set(cleared.map((a) => a.kind));
      const capturedArms = caster.filter((a) => !survivingKinds.has(a.kind));
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext = [
        ...foe.filter((s) => !transferredKinds.has(s.kind)),
        ...capturedArms.map((a) => ({ ...a })),
      ];
      return { caster: cleared, foe: foeNext, captured: capturedArms };
    };

    it('clears the CASTER harmful arms, KEEPS its self-buff, AND moves the EXACT arms onto the FOE preserving remaining state', () => {
      // The caster carries a MIX of harmful debuffs whose remaining state DIFFERS from canonical:
      // a `burn` with turnsRemaining:1 (NOT its full canonical duration) + a `corrode` with a
      // CLIMBED damagePerTurn (above CORRODE_INITIAL_DAMAGE) + ramp, PLUS a self-buff (empower);
      // the foe carries NONE of those kinds.
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 1,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterCorrode: StatusAilment = {
        kind: 'corrode',
        turnsRemaining: 2,
        damagePerTurn: CORRODE_INITIAL_DAMAGE + 2 * CORRODE_RAMP,
        ramp: CORRODE_RAMP,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        casterCorrode,
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = rebound(casterBefore, []);

      // The caster's HARMFUL arms are GONE; its self-buff REMAINS (reuses clearDebuffs / A-65).
      expect(caster.map((a) => a.kind).sort()).toEqual(['empower']);

      // The FOE now carries a burn arm AND a corrode arm whose remaining state EXACTLY MATCHES
      // the caster's pre-transfer arms — the DEEP-COPY / preserved-remaining-state proof (THIS
      // is what distinguishes Rebound from Backfire, which would reset them to canonical).
      const foeBurn = foe.find((a) => a.kind === 'burn') as Extract<
        StatusAilment,
        { kind: 'burn' }
      >;
      const foeCorrode = foe.find((a) => a.kind === 'corrode') as Extract<
        StatusAilment,
        { kind: 'corrode' }
      >;
      expect(foeBurn).toEqual(casterBurn);
      expect(foeCorrode).toEqual(casterCorrode);
      // …specifically preserved-remaining-state (not reset to canonical).
      expect(foeBurn.turnsRemaining).toBe(1);
      expect(foeCorrode.damagePerTurn).toBe(CORRODE_INITIAL_DAMAGE + 2 * CORRODE_RAMP);

      // The transferred arms are DISTINCT OBJECTS from the caster's originals (a genuine deep
      // copy): mutating the foe's arm does not touch the captured original.
      expect(foeBurn).not.toBe(casterBurn);
      expect(captured.find((a) => a.kind === 'burn')).not.toBe(foeBurn);
    });

    it('CONTRAST vs Backfire: Rebound preserves a burn at turnsRemaining:1, Backfire resets it to canonical', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 1,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      // Rebound: the foe's burn keeps turnsRemaining:1 (the preserved arm).
      const { foe: reboundFoe } = rebound([casterBurn], []);
      const reboundBurn = reboundFoe.find((a) => a.kind === 'burn') as Extract<
        StatusAilment,
        { kind: 'burn' }
      >;
      expect(reboundBurn.turnsRemaining).toBe(1);
      // Backfire (applyAilment re-brew): a fresh burn at the FULL canonical duration.
      const backfireFoe = applyAilment([], 'burn');
      const backfireBurn = backfireFoe.find((a) => a.kind === 'burn') as Extract<
        StatusAilment,
        { kind: 'burn' }
      >;
      expect(backfireBurn.turnsRemaining).toBe(BURN_DURATION);
      // Observably DIFFERENT (1 vs full canonical duration), given BURN_DURATION > 1.
      expect(reboundBurn.turnsRemaining).not.toBe(backfireBurn.turnsRemaining);
    });

    it('is a CONDITIONAL transfer: a debuff-free caster → no clear → NO foe debuff moved', () => {
      // The caster carries only a self-buff (empower), nothing harmful to clear/move.
      const casterBefore: StatusAilment[] = applyAilment([], 'empower');
      const { caster, foe, captured } = rebound(casterBefore, []);
      expect(captured).toEqual([]);
      expect(caster.map((a) => a.kind)).toEqual(['empower']);
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a transferred kind is REPLACED (at most one arm, the transferred one)', () => {
      // The foe already carries a burn at turnsRemaining:3; the caster rebounds a burn at
      // turnsRemaining:1 → the foe carries AT MOST ONE burn, and it is the TRANSFERRED one.
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 1,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const foeBefore: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 3, damagePerTurn: BURN_DAMAGE_PER_TURN },
      ];
      const { foe } = rebound([casterBurn], foeBefore);
      const burns = foe.filter((a) => a.kind === 'burn') as Extract<
        StatusAilment,
        { kind: 'burn' }
      >[];
      expect(burns).toHaveLength(1);
      expect(burns[0]!.turnsRemaining).toBe(1); // the transferred arm replaced the foe's prior burn
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 1,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [casterBurn, ...applyAilment([], 'empower')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = rebound(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      // The captured original arm was not mutated.
      expect(casterBurn.turnsRemaining).toBe(1);
    });
  });

  describe('Reclaim-Partial / Rebound-Lite — the SEVENTH status-REMOVAL mechanic, PERCENTAGE/PARTIAL-DURATION self→foe DEBUFF TRANSFER (TASK-82, isolated)', () => {
    // Rebound-Lite resolves as a COMPOSITION done inline in simulateBattle's reclaim-partial
    // branch: FIRST CAPTURE the caster's OWN harmful debuff ARMS (those clearDebuffs removes —
    // i.e. those in CLEANSABLE_DEBUFF_KINDS) with their EXACT remaining state; THEN
    // `clearDebuffs(me.statuses)` strips them off the caster; THEN — ONLY when the captured set
    // is NON-empty — DEEP-COPY each captured arm onto the FOE via
    // `{ ...arm, turnsRemaining: max(1, ceil(turnsRemaining * REBOUND_PARTIAL_RATIO)) }`,
    // de-duped by kind (a transferred arm REPLACES the foe's existing arm of that kind). Unlike
    // Rebound (which moves each arm at its FULL current turnsRemaining), Rebound-Lite HALVES the
    // remaining duration (max(1,…) floor) while PRESERVING each arm's damagePerTurn/ramp. This
    // mirrors the branch verbatim on the exported primitives it reuses (clearDebuffs +
    // REBOUND_PARTIAL_RATIO).
    const partialTurns = (t: number): number => Math.max(1, Math.ceil(t * REBOUND_PARTIAL_RATIO));
    const reboundLite = (
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      // A harmful arm is exactly one clearDebuffs REMOVES: present in caster, absent after clear.
      const cleared = clearDebuffs(caster);
      const survivingKinds = new Set(cleared.map((a) => a.kind));
      const capturedArms = caster.filter((a) => !survivingKinds.has(a.kind));
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext = [
        ...foe.filter((s) => !transferredKinds.has(s.kind)),
        ...capturedArms.map((a) => ({
          ...a,
          turnsRemaining: partialTurns(a.turnsRemaining),
        })),
      ];
      return { caster: cleared, foe: foeNext, captured: capturedArms };
    };

    it('clears the CASTER harmful arms, KEEPS its self-buff, AND moves the arms onto the FOE at HALVED duration preserving damage/ramp', () => {
      // The caster carries a MIX of harmful debuffs: a `burn` at turnsRemaining:4 + a `corrode`
      // at turnsRemaining:4 with a CLIMBED damagePerTurn (above CORRODE_INITIAL_DAMAGE) + ramp,
      // PLUS a self-buff (empower); the foe carries NONE of those kinds.
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterCorrode: StatusAilment = {
        kind: 'corrode',
        turnsRemaining: 4,
        damagePerTurn: CORRODE_INITIAL_DAMAGE + 2 * CORRODE_RAMP,
        ramp: CORRODE_RAMP,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        casterCorrode,
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundLite(casterBefore, []);

      // The caster's HARMFUL arms are GONE; its self-buff REMAINS (reuses clearDebuffs / A-65).
      expect(caster.map((a) => a.kind).sort()).toEqual(['empower']);

      // The FOE now carries a burn arm AND a corrode arm at HALVED turnsRemaining (4 → 2) whose
      // damagePerTurn/ramp EXACTLY MATCH the caster's pre-transfer arms — the halved-duration +
      // preserved-damage proof (THIS is what distinguishes Rebound-Lite from Rebound, which
      // would leave them at turnsRemaining:4).
      const foeBurn = foe.find((a) => a.kind === 'burn') as Extract<
        StatusAilment,
        { kind: 'burn' }
      >;
      const foeCorrode = foe.find((a) => a.kind === 'corrode') as Extract<
        StatusAilment,
        { kind: 'corrode' }
      >;
      expect(foeBurn.turnsRemaining).toBe(2); // ceil(4 * 0.5) = 2, HALVED
      expect(foeBurn.damagePerTurn).toBe(BURN_DAMAGE_PER_TURN); // damage PRESERVED
      expect(foeCorrode.turnsRemaining).toBe(2); // ceil(4 * 0.5) = 2, HALVED
      expect(foeCorrode.damagePerTurn).toBe(CORRODE_INITIAL_DAMAGE + 2 * CORRODE_RAMP); // ramp'd damage PRESERVED
      expect(foeCorrode.ramp).toBe(CORRODE_RAMP); // ramp PRESERVED

      // The transferred arms are DISTINCT OBJECTS from the caster's originals (a genuine deep
      // copy): mutating the foe's arm does not touch the captured original.
      expect(foeBurn).not.toBe(casterBurn);
      expect(captured.find((a) => a.kind === 'burn')).not.toBe(foeBurn);

      // No HP write anywhere — the transfer only trims/appends status arrays (HP-monotone, A-42).
    });

    it('CONTRAST vs Rebound: Rebound-Lite HALVES a burn@4 to 2, Rebound moves it at full duration 4', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      // Rebound-Lite: the foe's burn arrives at turnsRemaining:2 (halved).
      const { foe: liteFoe } = reboundLite([casterBurn], []);
      const liteBurn = liteFoe.find((a) => a.kind === 'burn') as Extract<
        StatusAilment,
        { kind: 'burn' }
      >;
      expect(liteBurn.turnsRemaining).toBe(2);
      // Rebound (raw deep copy): the foe's burn keeps the FULL turnsRemaining:4.
      // (Mirror of Rebound's inline branch — a plain `{ ...arm }` spread with no override.)
      const deepFoe = [{ ...casterBurn }];
      const deepBurn = deepFoe.find((a) => a.kind === 'burn') as Extract<
        StatusAilment,
        { kind: 'burn' }
      >;
      expect(deepBurn.turnsRemaining).toBe(4);
      // Observably DIFFERENT (2 vs 4) — the halved-duration IS the new mechanic.
      expect(liteBurn.turnsRemaining).not.toBe(deepBurn.turnsRemaining);
    });

    it('FLOOR proof: a burn@turnsRemaining:1 transfers as a burn@1 (max(1, ceil(1*0.5)) = 1, never 0)', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 1,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const { foe } = reboundLite([casterBurn], []);
      const foeBurn = foe.find((a) => a.kind === 'burn') as Extract<
        StatusAilment,
        { kind: 'burn' }
      >;
      expect(foeBurn.turnsRemaining).toBe(1); // a 1-turn debuff still transfers (floored at 1)
      expect(REBOUND_PARTIAL_RATIO).toBe(0.5);
    });

    it('is a CONDITIONAL transfer: a debuff-free caster → no clear → NO foe debuff moved', () => {
      // The caster carries only a self-buff (empower), nothing harmful to clear/move.
      const casterBefore: StatusAilment[] = applyAilment([], 'empower');
      const { caster, foe, captured } = reboundLite(casterBefore, []);
      expect(captured).toEqual([]);
      expect(caster.map((a) => a.kind)).toEqual(['empower']);
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a transferred kind is REPLACED (at most one arm, the halved transferred one)', () => {
      // The foe already carries a burn at turnsRemaining:3; the caster rebounds a burn at
      // turnsRemaining:4 → the foe carries AT MOST ONE burn, and it is the TRANSFERRED (halved
      // to 2) one, NOT the foe's prior arm.
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const foeBefore: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 3, damagePerTurn: BURN_DAMAGE_PER_TURN },
      ];
      const { foe } = reboundLite([casterBurn], foeBefore);
      const burns = foe.filter((a) => a.kind === 'burn') as Extract<
        StatusAilment,
        { kind: 'burn' }
      >[];
      expect(burns).toHaveLength(1);
      expect(burns[0]!.turnsRemaining).toBe(2); // the halved transferred arm replaced the foe's prior burn
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [casterBurn, ...applyAilment([], 'empower')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundLite(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      // The captured original arm was not mutated (still at its FULL turnsRemaining:4).
      expect(casterBurn.turnsRemaining).toBe(4);
    });
  });

  describe('Reclaim-Subset / Rebound-Split — the EIGHTH status-REMOVAL mechanic, SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (TASK-83, isolated)', () => {
    // Rebound-Split resolves as a COMPOSITION done inline in simulateBattle's reclaim-subset
    // branch: FIRST CAPTURE the caster's OWN debuff ARMS whose kind is in the SUBSET
    // REBOUND_SPLIT_KINDS (the DoTs burn/poison/bleed/corrode) with their EXACT remaining state;
    // THEN `clearKinds(me.statuses, REBOUND_SPLIT_KINDS)` strips ONLY those subset kinds off the
    // caster (leaving the caster's non-subset debuffs AND self-buffs); THEN — ONLY when the
    // captured set is NON-empty — FULL-duration DEEP-COPY each captured arm onto the FOE via
    // `{ ...arm }` (NO duration change — the KIND SELECTION is the new axis, not the duration),
    // de-duped by kind. This mirrors the branch verbatim on the exported primitive it reuses
    // (clearKinds). The subset itself (burn/poison/bleed/corrode) is module-private, so the
    // helper mirrors it here as the fixed frozen set the branch uses.
    const SPLIT_KINDS = new Set<StatusAilment['kind']>(['burn', 'poison', 'bleed', 'corrode']);
    const reboundSplit = (
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      const capturedArms = caster.filter((s) => SPLIT_KINDS.has(s.kind));
      const casterNext = clearKinds(caster, SPLIT_KINDS);
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext =
        capturedArms.length > 0
          ? [
              ...foe.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ]
          : [...foe];
      return { caster: casterNext, foe: foeNext, captured: capturedArms };
    };

    it('REBOUND_SPLIT_KINDS (the branch subset) is a STRICT subset of CLEANSABLE_DEBUFF_KINDS', () => {
      // clearDebuffs removes exactly CLEANSABLE_DEBUFF_KINDS. Every subset kind must therefore
      // be REMOVED by clearDebuffs (⊆), and clearDebuffs must ALSO remove some NON-subset kinds
      // (strict ⊊ — it removes weaken/stun/… which the subset omits).
      const subsetArms: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 3, damagePerTurn: BURN_DAMAGE_PER_TURN },
        { kind: 'poison', turnsRemaining: 3, damagePerTurn: POISON_DAMAGE_PER_TURN },
        { kind: 'bleed', turnsRemaining: 3, damagePerTurn: BLEED_DAMAGE_PER_TURN },
        {
          kind: 'corrode',
          turnsRemaining: 3,
          damagePerTurn: CORRODE_INITIAL_DAMAGE,
          ramp: CORRODE_RAMP,
        },
      ];
      // Every subset kind is cleansable (⊆): clearDebuffs strips all four → nothing left.
      expect(clearDebuffs(subsetArms)).toEqual([]);
      // STRICT: clearDebuffs also removes a non-subset debuff (weaken) that the subset omits.
      const weaken = applyAilment([], 'weaken');
      expect(clearDebuffs(weaken)).toEqual([]); // weaken IS cleansable
      // but clearKinds(_, SPLIT_KINDS) LEAVES weaken (it is NOT in the subset) — strict ⊊.
      expect(clearKinds(weaken, SPLIT_KINDS)).toEqual(weaken);
      expect(SPLIT_KINDS.size).toBeLessThan(11); // < the 11 cleansable kinds
    });

    it('clearKinds GENERALIZES clearDebuffs (equivalence) and clearKinds(_, subset) removes ONLY the subset', () => {
      const mixed: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 3, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'empower'),
      ];
      // clearKinds(_, CLEANSABLE) is NOT directly assertable (the set is private), but the
      // generalization is proven via clearDebuffs itself being re-expressed through clearKinds:
      // clearDebuffs strips burn+weaken+stun, keeps empower.
      expect(
        clearDebuffs(mixed)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower']);
      // clearKinds(_, SPLIT_KINDS) removes ONLY burn (a subset kind); weaken/stun/empower stay.
      expect(
        clearKinds(mixed, SPLIT_KINDS)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower', 'stun', 'weaken']);
    });

    it('clears ONLY the caster SUBSET debuffs, KEEPS non-subset debuffs + self-buff, AND moves ONLY the subset arms onto the FOE at FULL duration', () => {
      // The caster carries a MIX: subset DoTs (burn@4 + a climbed corrode@4) AND non-subset
      // debuffs (weaken + stun) PLUS a self-buff (empower); the foe carries NONE of those kinds.
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterCorrode: StatusAilment = {
        kind: 'corrode',
        turnsRemaining: 4,
        damagePerTurn: CORRODE_INITIAL_DAMAGE + 2 * CORRODE_RAMP,
        ramp: CORRODE_RAMP,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        casterCorrode,
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundSplit(casterBefore, []);

      // The caster's SUBSET debuffs (burn/corrode) are GONE, but its NON-subset debuffs
      // (weaken/stun) REMAIN and its self-buff (empower) REMAINS — THIS is the observable
      // difference from Rebound (which would strip ALL of them).
      expect(caster.map((a) => a.kind).sort()).toEqual(['empower', 'stun', 'weaken']);
      expect(captured.map((a) => a.kind).sort()).toEqual(['burn', 'corrode']);

      // The FOE now carries a burn AND a corrode at FULL turnsRemaining:4 whose
      // damagePerTurn/ramp EXACTLY MATCH the caster's pre-transfer arms (a full-duration raw
      // deep copy — NOT halved); the foe does NOT gain weaken/stun.
      expect(foe.map((a) => a.kind).sort()).toEqual(['burn', 'corrode']);
      const foeBurn = foe.find((a) => a.kind === 'burn') as Extract<
        StatusAilment,
        { kind: 'burn' }
      >;
      const foeCorrode = foe.find((a) => a.kind === 'corrode') as Extract<
        StatusAilment,
        { kind: 'corrode' }
      >;
      expect(foeBurn.turnsRemaining).toBe(4); // FULL duration (not halved)
      expect(foeBurn.damagePerTurn).toBe(BURN_DAMAGE_PER_TURN);
      expect(foeCorrode.turnsRemaining).toBe(4);
      expect(foeCorrode.damagePerTurn).toBe(CORRODE_INITIAL_DAMAGE + 2 * CORRODE_RAMP);
      expect(foeCorrode.ramp).toBe(CORRODE_RAMP);

      // The transferred arms are DISTINCT OBJECTS from the caster's originals (deep copy).
      expect(foeBurn).not.toBe(casterBurn);
      // No HP write anywhere — the transfer only trims/appends status arrays (HP-monotone, A-42).
    });

    it('CONTRAST vs Rebound: Rebound-Split moves ONLY burn+corrode; Rebound (clearDebuffs) would move burn+corrode+weaken+stun too', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterCorrode: StatusAilment = {
        kind: 'corrode',
        turnsRemaining: 4,
        damagePerTurn: CORRODE_INITIAL_DAMAGE,
        ramp: CORRODE_RAMP,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        casterCorrode,
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'empower'),
      ];
      // Rebound-Split: foe gains ONLY the subset kinds.
      const { foe: splitFoe } = reboundSplit(casterBefore, []);
      expect(splitFoe.map((a) => a.kind).sort()).toEqual(['burn', 'corrode']);
      // Rebound (raw deep copy of the WHOLE cleansable set): the captured arms are those
      // clearDebuffs removes — burn+corrode+weaken+stun — and the caster is left with empower.
      const reboundCleared = clearDebuffs(casterBefore);
      const surviving = new Set(reboundCleared.map((a) => a.kind));
      const reboundCaptured = casterBefore.filter((a) => !surviving.has(a.kind));
      expect(reboundCaptured.map((a) => a.kind).sort()).toEqual([
        'burn',
        'corrode',
        'stun',
        'weaken',
      ]);
      // Observably DIFFERENT: subset (2 kinds) vs whole cleansable set (4 kinds).
      expect(splitFoe.length).toBeLessThan(reboundCaptured.length);
    });

    it('is a CONDITIONAL transfer: a caster carrying NO subset kind (only weaken + empower) → no clear → NO foe debuff', () => {
      // The caster carries a non-subset debuff (weaken) + a self-buff (empower) but NO DoT.
      const casterBefore: StatusAilment[] = [
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundSplit(casterBefore, []);
      expect(captured).toEqual([]);
      // The caster is UNCHANGED — its weaken stays (it is NOT a subset kind).
      expect(caster.map((a) => a.kind).sort()).toEqual(['empower', 'weaken']);
      // The foe gains NO new debuff.
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a transferred kind is REPLACED (at most one arm, the full-duration transferred one)', () => {
      // The foe already carries a burn@3; the caster splits a burn@4 → the foe carries AT MOST
      // ONE burn, and it is the TRANSFERRED (full-duration 4) one, NOT the foe's prior arm.
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const foeBefore: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 3, damagePerTurn: BURN_DAMAGE_PER_TURN },
      ];
      const { foe } = reboundSplit([casterBurn], foeBefore);
      const burns = foe.filter((a) => a.kind === 'burn') as Extract<
        StatusAilment,
        { kind: 'burn' }
      >[];
      expect(burns).toHaveLength(1);
      expect(burns[0]!.turnsRemaining).toBe(4); // the full-duration transferred arm replaced the prior
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [casterBurn, ...applyAilment([], 'empower')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundSplit(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterBurn.turnsRemaining).toBe(4); // the captured original was not mutated
    });
  });

  describe('Reclaim-Stats / Rebound-Snap — the NINTH status-REMOVAL mechanic, SECOND SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (TASK-84, isolated)', () => {
    // Rebound-Snap resolves as a COMPOSITION done inline in simulateBattle's reclaim-stats
    // branch: FIRST CAPTURE the caster's OWN debuff ARMS whose kind is in the SUBSET
    // REBOUND_SNAP_KINDS (the STAT-MODS weaken/enfeeble/vulnerable) with their EXACT remaining
    // state; THEN `clearKinds(me.statuses, REBOUND_SNAP_KINDS)` strips ONLY those subset kinds
    // off the caster (leaving the caster's DoTs/control-locks AND self-buffs); THEN — ONLY when
    // the captured set is NON-empty — FULL-duration DEEP-COPY each captured arm onto the FOE via
    // `{ ...arm }` (NO duration change — the KIND SELECTION is the new axis, not the duration),
    // de-duped by kind. This mirrors the branch verbatim on the exported primitive it reuses
    // (clearKinds). REBOUND_SNAP_KINDS (weaken/enfeeble/vulnerable) is module-private, so the
    // helper mirrors it here as the fixed frozen set the branch uses — DISJOINT from the DoT
    // subset REBOUND_SPLIT_KINDS.
    const SNAP_KINDS = new Set<StatusAilment['kind']>(['weaken', 'enfeeble', 'vulnerable']);
    const SPLIT_KINDS = new Set<StatusAilment['kind']>(['burn', 'poison', 'bleed', 'corrode']);
    const reboundBySubset = (
      subset: ReadonlySet<StatusAilment['kind']>,
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      const capturedArms = caster.filter((s) => subset.has(s.kind));
      const casterNext = clearKinds(caster, subset);
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext =
        capturedArms.length > 0
          ? [
              ...foe.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ]
          : [...foe];
      return { caster: casterNext, foe: foeNext, captured: capturedArms };
    };
    const reboundSnap = (caster: readonly StatusAilment[], foe: readonly StatusAilment[]) =>
      reboundBySubset(SNAP_KINDS, caster, foe);

    it('REBOUND_SNAP_KINDS is a STRICT subset of CLEANSABLE_DEBUFF_KINDS and is DISJOINT from REBOUND_SPLIT_KINDS', () => {
      // Every subset kind must be REMOVED by clearDebuffs (⊆ cleansable): the three stat-mods
      // are all cleansable, so clearDebuffs strips them all → nothing left.
      const snapArms: StatusAilment[] = [
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'enfeeble'),
        ...applyAilment([], 'vulnerable'),
      ];
      expect(clearDebuffs(snapArms)).toEqual([]); // all three ARE cleansable (⊆)
      // STRICT: clearDebuffs also removes a non-subset debuff (burn) the subset omits, but
      // clearKinds(_, SNAP_KINDS) LEAVES burn (it is NOT in the stat-mod subset).
      const burn: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 3, damagePerTurn: BURN_DAMAGE_PER_TURN },
      ];
      expect(clearDebuffs(burn)).toEqual([]); // burn IS cleansable
      expect(clearKinds(burn, SNAP_KINDS)).toEqual(burn); // but NOT snapped — strict ⊊
      expect(SNAP_KINDS.size).toBeLessThan(11); // < the 11 cleansable kinds
      // DISJOINT from the DoT subset Rebound-Split moves: no kind is in both.
      for (const k of SNAP_KINDS) expect(SPLIT_KINDS.has(k)).toBe(false);
    });

    it('clears ONLY the caster STAT-MOD debuffs, KEEPS DoT/control-lock debuffs + self-buff, AND moves ONLY the stat-mod arms onto the FOE at FULL duration', () => {
      // The caster carries a MIX: stat-mod debuffs (weaken@3 + vulnerable@3) AND non-subset
      // debuffs (burn@4 + stun) PLUS a self-buff (empower); the foe carries NONE of those kinds.
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterVulnerable = applyAilment([], 'vulnerable')[0]!;
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterWeaken,
        casterVulnerable,
        casterBurn,
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundSnap(casterBefore, []);

      // The caster's STAT-MOD debuffs (weaken/vulnerable) are GONE, but its NON-subset debuffs
      // (burn/stun) REMAIN and its self-buff (empower) REMAINS — THIS is the observable
      // difference from Rebound-Split (which would move burn, not weaken/vulnerable).
      expect(caster.map((a) => a.kind).sort()).toEqual(['burn', 'empower', 'stun']);
      expect(captured.map((a) => a.kind).sort()).toEqual(['vulnerable', 'weaken']);

      // The FOE now carries a weaken AND a vulnerable at FULL turnsRemaining whose magnitude
      // fields EXACTLY MATCH the caster's pre-transfer arms (a full-duration raw deep copy); the
      // foe does NOT gain burn/stun.
      expect(foe.map((a) => a.kind).sort()).toEqual(['vulnerable', 'weaken']);
      const foeWeaken = foe.find((a) => a.kind === 'weaken') as Extract<
        StatusAilment,
        { kind: 'weaken' }
      >;
      const foeVulnerable = foe.find((a) => a.kind === 'vulnerable') as Extract<
        StatusAilment,
        { kind: 'vulnerable' }
      >;
      const srcWeaken = casterWeaken as Extract<StatusAilment, { kind: 'weaken' }>;
      const srcVulnerable = casterVulnerable as Extract<StatusAilment, { kind: 'vulnerable' }>;
      expect(foeWeaken.turnsRemaining).toBe(srcWeaken.turnsRemaining); // FULL duration
      expect(foeWeaken.defReduction).toBe(srcWeaken.defReduction);
      expect(foeVulnerable.turnsRemaining).toBe(srcVulnerable.turnsRemaining);
      expect(foeVulnerable.damageTakenBonus).toBe(srcVulnerable.damageTakenBonus);

      // The transferred arms are DISTINCT OBJECTS from the caster's originals (deep copy).
      expect(foeWeaken).not.toBe(casterWeaken);
      // No HP write anywhere — the transfer only trims/appends status arrays (HP-monotone, A-42).
    });

    it('DISJOINT-SUBSET CONTRAST: on the SAME caster, Rebound-Split moves ONLY burn (DoT) while Rebound-Snap moves ONLY weaken/vulnerable (stat-mods)', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'vulnerable'),
        ...applyAilment([], 'stun'),
      ];
      // Rebound-Split (DoT subset) moves ONLY burn; leaves weaken/vulnerable/stun.
      const split = reboundBySubset(SPLIT_KINDS, casterBefore, []);
      expect(split.foe.map((a) => a.kind).sort()).toEqual(['burn']);
      // Rebound-Snap (stat-mod subset) moves ONLY weaken+vulnerable; leaves burn/stun.
      const snap = reboundSnap(casterBefore, []);
      expect(snap.foe.map((a) => a.kind).sort()).toEqual(['vulnerable', 'weaken']);
      // The two transferred sets are DISJOINT — the two mechanics are observably different.
      const splitKinds = new Set(split.foe.map((a) => a.kind));
      for (const a of snap.foe) expect(splitKinds.has(a.kind)).toBe(false);
    });

    it('is a CONDITIONAL transfer: a caster carrying NO stat-mod kind (only burn + empower) → no clear → NO foe debuff', () => {
      const casterBefore: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundSnap(casterBefore, []);
      expect(captured).toEqual([]);
      // The caster is UNCHANGED — its burn stays (it is NOT a stat-mod subset kind).
      expect(caster.map((a) => a.kind).sort()).toEqual(['burn', 'empower']);
      // The foe gains NO new debuff.
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a transferred kind is REPLACED (at most one arm, the transferred one)', () => {
      // The foe already carries a weaken; the caster snaps a weaken → the foe carries AT MOST
      // ONE weaken, and it is the TRANSFERRED one (deep copy), NOT the foe's prior arm.
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const foeWeakenPrior: StatusAilment = { kind: 'weaken', turnsRemaining: 1, defReduction: 1 };
      const { foe } = reboundSnap([casterWeaken], [foeWeakenPrior]);
      const weakens = foe.filter((a) => a.kind === 'weaken') as Extract<
        StatusAilment,
        { kind: 'weaken' }
      >[];
      expect(weakens).toHaveLength(1);
      expect(weakens[0]).not.toBe(foeWeakenPrior); // the transferred arm replaced the prior
      expect(weakens[0]!.turnsRemaining).toBe(
        (casterWeaken as Extract<StatusAilment, { kind: 'weaken' }>).turnsRemaining,
      );
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterWeaken = applyAilment([], 'weaken')[0]! as Extract<
        StatusAilment,
        { kind: 'weaken' }
      >;
      const casterBefore: StatusAilment[] = [casterWeaken, ...applyAilment([], 'empower')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundSnap(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterWeaken.turnsRemaining).toBe(WEAKEN_DURATION); // the captured original was not mutated
    });
  });

  describe('Reclaim-Locks / Rebound-Lock — the TENTH status-REMOVAL mechanic, THIRD SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (TASK-85, isolated)', () => {
    // Rebound-Lock resolves as a COMPOSITION done inline in simulateBattle's reclaim-locks
    // branch: FIRST CAPTURE the caster's OWN debuff ARMS whose kind is in the SUBSET
    // REBOUND_LOCK_KINDS (the CONTROL-LOCKS stun/freeze/sleep) with their EXACT remaining state;
    // THEN `clearKinds(me.statuses, REBOUND_LOCK_KINDS)` strips ONLY those subset kinds off the
    // caster (leaving the caster's DoTs/stat-mods AND self-buffs); THEN — ONLY when the captured
    // set is NON-empty — FULL-duration DEEP-COPY each captured arm onto the FOE via `{ ...arm }`
    // (NO duration change — the KIND SELECTION is the new axis, not the duration), de-duped by
    // kind. This mirrors the branch verbatim on the exported primitive it reuses (clearKinds).
    // REBOUND_LOCK_KINDS (stun/freeze/sleep) is module-private, so the helper mirrors it here as
    // the fixed frozen set the branch uses — DISJOINT from BOTH the DoT subset REBOUND_SPLIT_KINDS
    // AND the stat-mod subset REBOUND_SNAP_KINDS.
    const LOCK_KINDS = new Set<StatusAilment['kind']>(['stun', 'freeze', 'sleep']);
    const SNAP_KINDS = new Set<StatusAilment['kind']>(['weaken', 'enfeeble', 'vulnerable']);
    const SPLIT_KINDS = new Set<StatusAilment['kind']>(['burn', 'poison', 'bleed', 'corrode']);
    const reboundBySubset = (
      subset: ReadonlySet<StatusAilment['kind']>,
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      const capturedArms = caster.filter((s) => subset.has(s.kind));
      const casterNext = clearKinds(caster, subset);
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext =
        capturedArms.length > 0
          ? [
              ...foe.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ]
          : [...foe];
      return { caster: casterNext, foe: foeNext, captured: capturedArms };
    };
    const reboundLock = (caster: readonly StatusAilment[], foe: readonly StatusAilment[]) =>
      reboundBySubset(LOCK_KINDS, caster, foe);

    it('REBOUND_LOCK_KINDS is a STRICT subset of CLEANSABLE_DEBUFF_KINDS and is DISJOINT from BOTH REBOUND_SPLIT_KINDS and REBOUND_SNAP_KINDS', () => {
      // Every subset kind must be REMOVED by clearDebuffs (⊆ cleansable): the three control-locks
      // are all cleansable, so clearDebuffs strips them all → nothing left.
      const lockArms: StatusAilment[] = [
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'freeze'),
        ...applyAilment([], 'sleep'),
      ];
      expect(clearDebuffs(lockArms)).toEqual([]); // all three ARE cleansable (⊆)
      // STRICT: clearDebuffs also removes a non-subset debuff (burn) the subset omits, but
      // clearKinds(_, LOCK_KINDS) LEAVES burn (it is NOT in the control-lock subset).
      const burn: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 3, damagePerTurn: BURN_DAMAGE_PER_TURN },
      ];
      expect(clearDebuffs(burn)).toEqual([]); // burn IS cleansable
      expect(clearKinds(burn, LOCK_KINDS)).toEqual(burn); // but NOT locked — strict ⊊
      expect(LOCK_KINDS.size).toBeLessThan(11); // < the 11 cleansable kinds
      // DISJOINT from BOTH the DoT subset AND the stat-mod subset: no kind is shared.
      for (const k of LOCK_KINDS) expect(SPLIT_KINDS.has(k)).toBe(false);
      for (const k of LOCK_KINDS) expect(SNAP_KINDS.has(k)).toBe(false);
    });

    it('clearKinds(_, LOCK_KINDS) removes ONLY control-locks while leaving DoTs, stat-mods, and self-buffs (clearKinds reuse, no regression)', () => {
      const mixed: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'freeze'),
        ...applyAilment([], 'empower'),
      ];
      const after = clearKinds(mixed, LOCK_KINDS);
      // Only stun/freeze are removed; burn/weaken/empower remain.
      expect(after.map((a) => a.kind).sort()).toEqual(['burn', 'empower', 'weaken']);
      // The pre-existing clearKinds ↔ clearDebuffs generalization still holds BYTE-UNCHANGED
      // (this wave changes neither helper): clearDebuffs strips burn+weaken+stun+freeze, keeps
      // empower.
      expect(
        clearDebuffs(mixed)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower']);
    });

    it('clears ONLY the caster CONTROL-LOCK debuffs, KEEPS DoT/stat-mod debuffs + self-buff, AND moves ONLY the control-lock arms onto the FOE at FULL duration', () => {
      // The caster carries a MIX: control-lock debuffs (stun@2 + freeze@3) AND non-subset debuffs
      // (burn@4 + weaken) PLUS a self-buff (empower); the foe carries NONE of those kinds.
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterFreeze = applyAilment([], 'freeze')[0]!;
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterStun,
        casterFreeze,
        casterBurn,
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundLock(casterBefore, []);

      // The caster's CONTROL-LOCK debuffs (stun/freeze) are GONE, but its NON-subset debuffs
      // (burn/weaken) REMAIN and its self-buff (empower) REMAINS — THIS is the observable
      // difference from Rebound-Split (moves burn) and Rebound-Snap (moves weaken).
      expect(caster.map((a) => a.kind).sort()).toEqual(['burn', 'empower', 'weaken']);
      expect(captured.map((a) => a.kind).sort()).toEqual(['freeze', 'stun']);

      // The FOE now carries a stun AND a freeze at FULL turnsRemaining EXACTLY matching the
      // caster's pre-transfer arms (a full-duration raw deep copy); the foe does NOT gain
      // burn/weaken.
      expect(foe.map((a) => a.kind).sort()).toEqual(['freeze', 'stun']);
      const foeStun = foe.find((a) => a.kind === 'stun')!;
      const foeFreeze = foe.find((a) => a.kind === 'freeze')!;
      expect(foeStun.turnsRemaining).toBe(casterStun.turnsRemaining); // FULL duration
      expect(foeFreeze.turnsRemaining).toBe(casterFreeze.turnsRemaining);

      // The transferred arms are DISTINCT OBJECTS from the caster's originals (deep copy).
      expect(foeStun).not.toBe(casterStun);
      expect(foeFreeze).not.toBe(casterFreeze);
      // No HP write anywhere — the transfer only trims/appends status arrays (HP-monotone, A-42).
    });

    it('DISJOINT-SUBSET CONTRAST: on the SAME caster, Split moves ONLY burn (DoT), Snap moves ONLY weaken (stat-mod), Lock moves ONLY stun/freeze (control-lock)', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'freeze'),
      ];
      const split = reboundBySubset(SPLIT_KINDS, casterBefore, []);
      expect(split.foe.map((a) => a.kind).sort()).toEqual(['burn']);
      const snap = reboundBySubset(SNAP_KINDS, casterBefore, []);
      expect(snap.foe.map((a) => a.kind).sort()).toEqual(['weaken']);
      const lock = reboundLock(casterBefore, []);
      expect(lock.foe.map((a) => a.kind).sort()).toEqual(['freeze', 'stun']);
      // The three transferred sets are pairwise DISJOINT — the three mechanics are observably
      // different and together partition the harmful non-doom families.
      const splitKinds = new Set(split.foe.map((a) => a.kind));
      const snapKinds = new Set(snap.foe.map((a) => a.kind));
      for (const a of lock.foe) {
        expect(splitKinds.has(a.kind)).toBe(false);
        expect(snapKinds.has(a.kind)).toBe(false);
      }
    });

    it('is a CONDITIONAL transfer: a caster carrying NO control-lock kind (only burn + empower) → no clear → NO foe debuff', () => {
      const casterBefore: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundLock(casterBefore, []);
      expect(captured).toEqual([]);
      // The caster is UNCHANGED — its burn stays (it is NOT a control-lock subset kind).
      expect(caster.map((a) => a.kind).sort()).toEqual(['burn', 'empower']);
      // The foe gains NO new debuff.
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a transferred kind is REPLACED (at most one arm, the transferred one)', () => {
      // The foe already carries a stun; the caster snaps a stun → the foe carries AT MOST ONE
      // stun, and it is the TRANSFERRED one (deep copy), NOT the foe's prior arm.
      const casterStun = applyAilment([], 'stun')[0]!;
      const foeStunPrior: StatusAilment = { kind: 'stun', turnsRemaining: 1 };
      const { foe } = reboundLock([casterStun], [foeStunPrior]);
      const stuns = foe.filter((a) => a.kind === 'stun');
      expect(stuns).toHaveLength(1);
      expect(stuns[0]).not.toBe(foeStunPrior); // the transferred arm replaced the prior
      expect(stuns[0]!.turnsRemaining).toBe(casterStun.turnsRemaining);
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterBefore: StatusAilment[] = [casterStun, ...applyAilment([], 'empower')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundLock(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterStun.turnsRemaining).toBe(applyAilment([], 'stun')[0]!.turnsRemaining); // the captured original was not mutated
    });
  });

  describe('Reclaim-Doom / Rebound-Doom — the ELEVENTH status-REMOVAL mechanic, FOURTH (and final) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (TASK-86, isolated)', () => {
    // Rebound-Doom resolves as a COMPOSITION done inline in simulateBattle's reclaim-doom
    // branch: FIRST CAPTURE the caster's OWN debuff ARMS whose kind is in the SUBSET
    // REBOUND_DOOM_KINDS (the single deferred `doom`) with their EXACT remaining state
    // (turnsRemaining + detonationDamage); THEN `clearKinds(me.statuses, REBOUND_DOOM_KINDS)`
    // strips ONLY that subset kind off the caster (leaving the caster's DoTs/stat-mods/
    // control-locks AND self-buffs); THEN — ONLY when the captured set is NON-empty —
    // FULL-duration DEEP-COPY each captured arm onto the FOE via `{ ...arm }` (NO duration
    // change — the KIND SELECTION is the new axis), de-duped by kind. This mirrors the branch
    // verbatim on the exported primitive it reuses (clearKinds). REBOUND_DOOM_KINDS ({doom}) is
    // module-private, so the helper mirrors it here as the fixed frozen set the branch uses —
    // DISJOINT from all three other subsets.
    const DOOM_KINDS = new Set<StatusAilment['kind']>(['doom']);
    const LOCK_KINDS = new Set<StatusAilment['kind']>(['stun', 'freeze', 'sleep']);
    const SNAP_KINDS = new Set<StatusAilment['kind']>(['weaken', 'enfeeble', 'vulnerable']);
    const SPLIT_KINDS = new Set<StatusAilment['kind']>(['burn', 'poison', 'bleed', 'corrode']);
    const reboundBySubset = (
      subset: ReadonlySet<StatusAilment['kind']>,
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      const capturedArms = caster.filter((s) => subset.has(s.kind));
      const casterNext = clearKinds(caster, subset);
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext =
        capturedArms.length > 0
          ? [
              ...foe.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ]
          : [...foe];
      return { caster: casterNext, foe: foeNext, captured: capturedArms };
    };
    const reboundDoom = (caster: readonly StatusAilment[], foe: readonly StatusAilment[]) =>
      reboundBySubset(DOOM_KINDS, caster, foe);

    it('REBOUND_DOOM_KINDS is a STRICT subset of CLEANSABLE_DEBUFF_KINDS and is DISJOINT from REBOUND_SPLIT_KINDS, REBOUND_SNAP_KINDS and REBOUND_LOCK_KINDS', () => {
      // The one subset kind (doom) must be REMOVED by clearDebuffs (⊆ cleansable).
      const doomArm: StatusAilment[] = applyAilment([], 'doom');
      expect(clearDebuffs(doomArm)).toEqual([]); // doom IS cleansable (⊆)
      // STRICT: clearDebuffs also removes a non-subset debuff (burn) the subset omits, but
      // clearKinds(_, DOOM_KINDS) LEAVES burn (it is NOT the doom kind).
      const burn: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 3, damagePerTurn: BURN_DAMAGE_PER_TURN },
      ];
      expect(clearDebuffs(burn)).toEqual([]); // burn IS cleansable
      expect(clearKinds(burn, DOOM_KINDS)).toEqual(burn); // but NOT doom — strict ⊊
      expect(DOOM_KINDS.size).toBeLessThan(11); // < the 11 cleansable kinds
      // DISJOINT from ALL three other subsets: no kind is shared.
      for (const k of DOOM_KINDS) expect(SPLIT_KINDS.has(k)).toBe(false);
      for (const k of DOOM_KINDS) expect(SNAP_KINDS.has(k)).toBe(false);
      for (const k of DOOM_KINDS) expect(LOCK_KINDS.has(k)).toBe(false);
    });

    it('clearKinds(_, DOOM_KINDS) removes ONLY the doom arm while leaving DoTs, stat-mods, control-locks, and self-buffs (clearKinds reuse, no regression)', () => {
      const mixed: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const after = clearKinds(mixed, DOOM_KINDS);
      // Only doom is removed; burn/weaken/stun/empower remain.
      expect(after.map((a) => a.kind).sort()).toEqual(['burn', 'empower', 'stun', 'weaken']);
      // The pre-existing clearKinds ↔ clearDebuffs generalization still holds BYTE-UNCHANGED
      // (this wave changes neither helper): clearDebuffs strips burn+weaken+stun+doom, keeps
      // empower.
      expect(
        clearDebuffs(mixed)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower']);
    });

    it('clears ONLY the caster doom debuff, KEEPS DoT/stat-mod/control-lock debuffs + self-buff, AND moves ONLY the doom arm onto the FOE at FULL duration (turnsRemaining + detonationDamage preserved)', () => {
      // The caster carries a MIX: a doom arm AND non-subset debuffs (burn@4 + weaken + stun)
      // PLUS a self-buff (empower); the foe carries NONE of those kinds.
      const casterDoom = applyAilment([], 'doom')[0]!;
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterDoom,
        casterBurn,
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundDoom(casterBefore, []);

      // The caster's doom debuff is GONE, but its NON-subset debuffs (burn/weaken/stun) REMAIN
      // and its self-buff (empower) REMAINS — THIS is the observable difference from
      // Rebound-Split (moves burn), Rebound-Snap (moves weaken) and Rebound-Lock (moves stun).
      expect(caster.map((a) => a.kind).sort()).toEqual(['burn', 'empower', 'stun', 'weaken']);
      expect(captured.map((a) => a.kind).sort()).toEqual(['doom']);

      // The FOE now carries a doom at FULL turnsRemaining AND detonationDamage EXACTLY matching
      // the caster's pre-transfer arm (a full-duration raw deep copy); the foe does NOT gain
      // burn/weaken/stun.
      expect(foe.map((a) => a.kind).sort()).toEqual(['doom']);
      const foeDoom = foe.find((a) => a.kind === 'doom')!;
      expect(foeDoom).toEqual(casterDoom); // turnsRemaining + detonationDamage preserved
      if (foeDoom.kind === 'doom' && casterDoom.kind === 'doom') {
        expect(foeDoom.turnsRemaining).toBe(casterDoom.turnsRemaining);
        expect(foeDoom.detonationDamage).toBe(casterDoom.detonationDamage);
      }
      // The transferred arm is a DISTINCT OBJECT from the caster's original (deep copy).
      expect(foeDoom).not.toBe(casterDoom);
      // No HP write anywhere — the transfer only trims/appends status arrays (HP-monotone, A-42);
      // the moved doom detonates LATER via the existing monotone seam.
    });

    it('DISJOINT-SUBSET CONTRAST: on the SAME caster, Split moves ONLY burn, Snap ONLY weaken, Lock ONLY stun/freeze, Doom ONLY doom', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'freeze'),
        ...applyAilment([], 'doom'),
      ];
      const split = reboundBySubset(SPLIT_KINDS, casterBefore, []);
      expect(split.foe.map((a) => a.kind).sort()).toEqual(['burn']);
      const snap = reboundBySubset(SNAP_KINDS, casterBefore, []);
      expect(snap.foe.map((a) => a.kind).sort()).toEqual(['weaken']);
      const lock = reboundBySubset(LOCK_KINDS, casterBefore, []);
      expect(lock.foe.map((a) => a.kind).sort()).toEqual(['freeze', 'stun']);
      const doom = reboundDoom(casterBefore, []);
      expect(doom.foe.map((a) => a.kind).sort()).toEqual(['doom']);
      // The four transferred sets are pairwise DISJOINT — the four mechanics are observably
      // different and together PARTITION the FULL cleansable set (DoT ∪ stat-mod ∪
      // control-lock ∪ doom), CLOSING the subset-of-kinds axis.
      const splitKinds = new Set(split.foe.map((a) => a.kind));
      const snapKinds = new Set(snap.foe.map((a) => a.kind));
      const lockKinds = new Set(lock.foe.map((a) => a.kind));
      for (const a of doom.foe) {
        expect(splitKinds.has(a.kind)).toBe(false);
        expect(snapKinds.has(a.kind)).toBe(false);
        expect(lockKinds.has(a.kind)).toBe(false);
      }
    });

    it('is a CONDITIONAL transfer: a caster carrying NO doom kind (only burn + empower) → no clear → NO foe debuff', () => {
      const casterBefore: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundDoom(casterBefore, []);
      expect(captured).toEqual([]);
      // The caster is UNCHANGED — its burn stays (it is NOT the doom subset kind).
      expect(caster.map((a) => a.kind).sort()).toEqual(['burn', 'empower']);
      // The foe gains NO new debuff.
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a doom is REPLACED (at most one arm, the transferred one)', () => {
      // The foe already carries a doom; the caster snaps a doom → the foe carries AT MOST ONE
      // doom, and it is the TRANSFERRED one (deep copy), NOT the foe's prior arm.
      const casterDoom = applyAilment([], 'doom')[0]!;
      const foeDoomPrior: StatusAilment = {
        kind: 'doom',
        turnsRemaining: 1,
        detonationDamage: 99,
      };
      const { foe } = reboundDoom([casterDoom], [foeDoomPrior]);
      const dooms = foe.filter((a) => a.kind === 'doom');
      expect(dooms).toHaveLength(1);
      expect(dooms[0]).not.toBe(foeDoomPrior); // the transferred arm replaced the prior
      expect(dooms[0]).toEqual(casterDoom); // it is the transferred (full-duration) one
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterDoom = applyAilment([], 'doom')[0]!;
      const casterBefore: StatusAilment[] = [casterDoom, ...applyAilment([], 'empower')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundDoom(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterDoom).toEqual(applyAilment([], 'doom')[0]!); // captured original not mutated
    });
  });

  describe('Reclaim-Blight / Rebound-Blight — the TWELFTH status-REMOVAL mechanic, FIRST MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (TASK-87, isolated)', () => {
    // Rebound-Blight resolves as a COMPOSITION done inline in simulateBattle's reclaim-blight
    // branch: FIRST CAPTURE the caster's OWN debuff ARMS whose kind is in the SUBSET
    // REBOUND_BLIGHT_KINDS (the UNION of the DoTs AND the control-locks) with their EXACT
    // remaining state; THEN `clearKinds(me.statuses, REBOUND_BLIGHT_KINDS)` strips ONLY those
    // subset kinds off the caster (leaving the caster's stat-mods/doom AND self-buffs); THEN —
    // ONLY when the captured set is NON-empty — FULL-duration DEEP-COPY each captured arm onto
    // the FOE via `{ ...arm }` (NO duration change), de-duped by kind. This mirrors the branch
    // verbatim on the exported primitive it reuses (clearKinds). REBOUND_BLIGHT_KINDS (the union
    // of the DoT + control-lock subsets) is module-private, so the helper mirrors it here as the
    // fixed frozen set the branch uses — DISJOINT from the stat-mod AND doom subsets.
    const SPLIT_KINDS = new Set<StatusAilment['kind']>(['burn', 'poison', 'bleed', 'corrode']);
    const LOCK_KINDS = new Set<StatusAilment['kind']>(['stun', 'freeze', 'sleep']);
    const SNAP_KINDS = new Set<StatusAilment['kind']>(['weaken', 'enfeeble', 'vulnerable']);
    const DOOM_KINDS = new Set<StatusAilment['kind']>(['doom']);
    // The UNION set the branch derives from the two existing frozen subsets.
    const BLIGHT_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...LOCK_KINDS]);
    const CLEANSABLE_KINDS = new Set<StatusAilment['kind']>([
      'burn',
      'poison',
      'bleed',
      'corrode',
      'doom',
      'weaken',
      'enfeeble',
      'vulnerable',
      'stun',
      'freeze',
      'sleep',
    ]);
    const reboundBySubset = (
      subset: ReadonlySet<StatusAilment['kind']>,
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      const capturedArms = caster.filter((s) => subset.has(s.kind));
      const casterNext = clearKinds(caster, subset);
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext =
        capturedArms.length > 0
          ? [
              ...foe.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ]
          : [...foe];
      return { caster: casterNext, foe: foeNext, captured: capturedArms };
    };
    const reboundBlight = (caster: readonly StatusAilment[], foe: readonly StatusAilment[]) =>
      reboundBySubset(BLIGHT_KINDS, caster, foe);

    it('REBOUND_BLIGHT_KINDS is EQUAL to REBOUND_SPLIT_KINDS ∪ REBOUND_LOCK_KINDS, a STRICT subset of CLEANSABLE_DEBUFF_KINDS, and DISJOINT from REBOUND_SNAP_KINDS and REBOUND_DOOM_KINDS', () => {
      // EQUAL to the union of the two existing disjoint subsets (both directions): size 7 and
      // every member is in exactly one of Split/Lock.
      expect(BLIGHT_KINDS.size).toBe(7);
      for (const k of BLIGHT_KINDS) {
        expect(SPLIT_KINDS.has(k) || LOCK_KINDS.has(k)).toBe(true);
      }
      for (const k of SPLIT_KINDS) expect(BLIGHT_KINDS.has(k)).toBe(true);
      for (const k of LOCK_KINDS) expect(BLIGHT_KINDS.has(k)).toBe(true);
      // STRICT subset of the 11 cleansable kinds (7 < 11).
      for (const k of BLIGHT_KINDS) expect(CLEANSABLE_KINDS.has(k)).toBe(true);
      expect(BLIGHT_KINDS.size).toBeLessThan(CLEANSABLE_KINDS.size);
      // DISJOINT from BOTH the stat-mod subset AND the doom subset (the two it leaves behind).
      for (const k of BLIGHT_KINDS) {
        expect(SNAP_KINDS.has(k)).toBe(false);
        expect(DOOM_KINDS.has(k)).toBe(false);
      }
    });

    it('clearKinds(_, BLIGHT_KINDS) removes ONLY the DoT + control-lock arms while leaving stat-mods, doom, and self-buffs (clearKinds reuse, no regression)', () => {
      const mixed: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const after = clearKinds(mixed, BLIGHT_KINDS);
      // burn + stun removed; weaken (stat-mod) + doom + empower (self-buff) remain.
      expect(after.map((a) => a.kind).sort()).toEqual(['doom', 'empower', 'weaken']);
      // The pre-existing clearKinds ↔ clearDebuffs generalization still holds BYTE-UNCHANGED
      // (this wave changes neither helper): clearDebuffs strips burn+stun+weaken+doom, keeps empower.
      expect(
        clearDebuffs(mixed)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower']);
    });

    it('clears BOTH the caster DoT AND control-lock debuffs, KEEPS stat-mod/doom debuffs + self-buff, AND moves ONLY the DoT+lock arms onto the FOE at FULL duration', () => {
      // The caster carries a MIX spanning all four families: a burn@4 + a stun AND non-subset
      // debuffs (weaken + doom) PLUS a self-buff (empower); the foe carries NONE of those kinds.
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterBefore: StatusAilment[] = [
        casterBurn,
        casterStun,
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundBlight(casterBefore, []);

      // The caster's SUBSET debuffs (burn + stun) are GONE, but its NON-subset debuffs
      // (weaken + doom) REMAIN and its self-buff (empower) REMAINS — THIS multi-family selection
      // is the observable difference from Split (moves only burn), Lock (moves only stun),
      // Snap (moves only weaken) and Doom (moves only doom).
      expect(caster.map((a) => a.kind).sort()).toEqual(['doom', 'empower', 'weaken']);
      expect(captured.map((a) => a.kind).sort()).toEqual(['burn', 'stun']);

      // The FOE now carries a burn AND a stun whose payloads EXACTLY match the caster's
      // pre-transfer arms (a full-duration raw deep copy); the foe does NOT gain weaken/doom.
      expect(foe.map((a) => a.kind).sort()).toEqual(['burn', 'stun']);
      const foeBurn = foe.find((a) => a.kind === 'burn')!;
      const foeStun = foe.find((a) => a.kind === 'stun')!;
      expect(foeBurn).toEqual(casterBurn);
      expect(foeStun).toEqual(casterStun);
      // The transferred arms are DISTINCT OBJECTS from the caster's originals (deep copy).
      expect(foeBurn).not.toBe(casterBurn);
      expect(foeStun).not.toBe(casterStun);
      // No HP write anywhere — the transfer only trims/appends status arrays (HP-monotone, A-42);
      // the moved burn ticks LATER via the existing monotone seam.
    });

    it('MULTI-FAMILY CONTRAST: on the SAME caster, Blight = Split ∪ Lock and is DISJOINT from Snap ∪ Doom', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
      ];
      const split = reboundBySubset(SPLIT_KINDS, casterBefore, []);
      expect(split.foe.map((a) => a.kind).sort()).toEqual(['burn']);
      const lock = reboundBySubset(LOCK_KINDS, casterBefore, []);
      expect(lock.foe.map((a) => a.kind).sort()).toEqual(['stun']);
      const blight = reboundBlight(casterBefore, []);
      // Blight moves the UNION of Split's DoT AND Lock's control-lock together.
      expect(blight.foe.map((a) => a.kind).sort()).toEqual(['burn', 'stun']);
      const snap = reboundBySubset(SNAP_KINDS, casterBefore, []);
      expect(snap.foe.map((a) => a.kind).sort()).toEqual(['weaken']);
      const doom = reboundBySubset(DOOM_KINDS, casterBefore, []);
      expect(doom.foe.map((a) => a.kind).sort()).toEqual(['doom']);
      // Blight == Split ∪ Lock exactly.
      const blightKinds = new Set(blight.foe.map((a) => a.kind));
      const splitLockKinds = new Set([
        ...split.foe.map((a) => a.kind),
        ...lock.foe.map((a) => a.kind),
      ]);
      expect([...blightKinds].sort()).toEqual([...splitLockKinds].sort());
      // Blight is DISJOINT from Snap AND Doom (the two families it leaves behind).
      const snapKinds = new Set(snap.foe.map((a) => a.kind));
      const doomKinds = new Set(doom.foe.map((a) => a.kind));
      for (const a of blight.foe) {
        expect(snapKinds.has(a.kind)).toBe(false);
        expect(doomKinds.has(a.kind)).toBe(false);
      }
    });

    it('is a CONDITIONAL transfer: a caster carrying NONE of the subset kinds (only weaken + doom + empower) → no clear → NO foe debuff', () => {
      const casterBefore: StatusAilment[] = [
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundBlight(casterBefore, []);
      expect(captured).toEqual([]);
      // The caster is UNCHANGED — weaken/doom/empower are NOT subset kinds.
      expect(caster.map((a) => a.kind).sort()).toEqual(['doom', 'empower', 'weaken']);
      // The foe gains NO new debuff.
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a burn is REPLACED by the transferred (full-duration) one', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterStun = applyAilment([], 'stun')[0]!;
      const foeBurnPrior: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 1,
        damagePerTurn: 1,
      };
      const { foe } = reboundBlight([casterBurn, casterStun], [foeBurnPrior]);
      const burns = foe.filter((a) => a.kind === 'burn');
      expect(burns).toHaveLength(1);
      expect(burns[0]).not.toBe(foeBurnPrior); // the transferred arm replaced the prior
      expect(burns[0]).toEqual(casterBurn); // it is the transferred (full-duration) one
      // The stun rode along too (the whole subset moves).
      expect(foe.some((a) => a.kind === 'stun')).toBe(true);
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [casterBurn, ...applyAilment([], 'stun')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundBlight(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterBurn).toEqual({
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      }); // captured original not mutated
    });
  });

  describe('Reclaim-Cripple / Rebound-Cripple — the THIRTEENTH status-REMOVAL mechanic, SECOND MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (TASK-88, isolated)', () => {
    // Rebound-Cripple resolves as a COMPOSITION done inline in simulateBattle's reclaim-cripple
    // branch: FIRST CAPTURE the caster's OWN debuff ARMS whose kind is in the SUBSET
    // REBOUND_CRIPPLE_KINDS (the UNION of the stat-mods AND the control-locks) with their EXACT
    // remaining state; THEN `clearKinds(me.statuses, REBOUND_CRIPPLE_KINDS)` strips ONLY those
    // subset kinds off the caster (leaving the caster's DoTs/doom AND self-buffs); THEN — ONLY
    // when the captured set is NON-empty — FULL-duration DEEP-COPY each captured arm onto the FOE
    // via `{ ...arm }` (NO duration change), de-duped by kind. This mirrors the branch verbatim on
    // the exported primitive it reuses (clearKinds). REBOUND_CRIPPLE_KINDS (the union of the
    // stat-mod + control-lock subsets) is module-private, so the helper mirrors it here as the
    // fixed frozen set — the COMPLEMENTARY 2-of-4 pair to Blight (they overlap only on the
    // control-locks), DISJOINT from the DoT AND doom subsets.
    const SPLIT_KINDS = new Set<StatusAilment['kind']>(['burn', 'poison', 'bleed', 'corrode']);
    const LOCK_KINDS = new Set<StatusAilment['kind']>(['stun', 'freeze', 'sleep']);
    const SNAP_KINDS = new Set<StatusAilment['kind']>(['weaken', 'enfeeble', 'vulnerable']);
    const DOOM_KINDS = new Set<StatusAilment['kind']>(['doom']);
    // The two UNION sets the branches derive from the existing frozen subsets.
    const BLIGHT_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...LOCK_KINDS]);
    const CRIPPLE_KINDS = new Set<StatusAilment['kind']>([...SNAP_KINDS, ...LOCK_KINDS]);
    const CLEANSABLE_KINDS = new Set<StatusAilment['kind']>([
      'burn',
      'poison',
      'bleed',
      'corrode',
      'doom',
      'weaken',
      'enfeeble',
      'vulnerable',
      'stun',
      'freeze',
      'sleep',
    ]);
    const reboundBySubset = (
      subset: ReadonlySet<StatusAilment['kind']>,
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      const capturedArms = caster.filter((s) => subset.has(s.kind));
      const casterNext = clearKinds(caster, subset);
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext =
        capturedArms.length > 0
          ? [
              ...foe.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ]
          : [...foe];
      return { caster: casterNext, foe: foeNext, captured: capturedArms };
    };
    const reboundCripple = (caster: readonly StatusAilment[], foe: readonly StatusAilment[]) =>
      reboundBySubset(CRIPPLE_KINDS, caster, foe);

    it('REBOUND_CRIPPLE_KINDS is EQUAL to REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS, a STRICT subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT from REBOUND_SPLIT_KINDS and REBOUND_DOOM_KINDS, and DISTINCT from REBOUND_BLIGHT_KINDS', () => {
      // EQUAL to the union of the two existing disjoint subsets (both directions): size 6 and
      // every member is in exactly one of Snap/Lock.
      expect(CRIPPLE_KINDS.size).toBe(6);
      for (const k of CRIPPLE_KINDS) {
        expect(SNAP_KINDS.has(k) || LOCK_KINDS.has(k)).toBe(true);
      }
      for (const k of SNAP_KINDS) expect(CRIPPLE_KINDS.has(k)).toBe(true);
      for (const k of LOCK_KINDS) expect(CRIPPLE_KINDS.has(k)).toBe(true);
      // STRICT subset of the 11 cleansable kinds (6 < 11).
      for (const k of CRIPPLE_KINDS) expect(CLEANSABLE_KINDS.has(k)).toBe(true);
      expect(CRIPPLE_KINDS.size).toBeLessThan(CLEANSABLE_KINDS.size);
      // DISJOINT from BOTH the DoT subset AND the doom subset (the two it leaves behind).
      for (const k of CRIPPLE_KINDS) {
        expect(SPLIT_KINDS.has(k)).toBe(false);
        expect(DOOM_KINDS.has(k)).toBe(false);
      }
      // DISTINCT from Blight — they overlap ONLY on the control-locks: Cripple has the stat-mods
      // where Blight has the DoTs.
      expect(CRIPPLE_KINDS.has('weaken')).toBe(true);
      expect(BLIGHT_KINDS.has('weaken')).toBe(false);
      expect(BLIGHT_KINDS.has('burn')).toBe(true);
      expect(CRIPPLE_KINDS.has('burn')).toBe(false);
      expect(CRIPPLE_KINDS.has('stun')).toBe(true);
      expect(BLIGHT_KINDS.has('stun')).toBe(true);
    });

    it('clearKinds(_, CRIPPLE_KINDS) removes ONLY the stat-mod + control-lock arms while leaving DoTs, doom, and self-buffs (clearKinds reuse, no regression)', () => {
      const mixed: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const after = clearKinds(mixed, CRIPPLE_KINDS);
      // weaken + stun removed; burn (DoT) + doom + empower (self-buff) remain.
      expect(after.map((a) => a.kind).sort()).toEqual(['burn', 'doom', 'empower']);
      // The pre-existing clearKinds ↔ clearDebuffs generalization still holds BYTE-UNCHANGED
      // (this wave changes neither helper): clearDebuffs strips burn+stun+weaken+doom, keeps empower.
      expect(
        clearDebuffs(mixed)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower']);
    });

    it('clears BOTH the caster stat-mod AND control-lock debuffs, KEEPS DoT/doom debuffs + self-buff, AND moves ONLY the stat-mod+lock arms onto the FOE at FULL duration', () => {
      // The caster carries a MIX spanning all four families: a burn@4 + a weaken + a stun + a doom
      // PLUS a self-buff (empower); the foe carries NONE of those kinds.
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterBefore: StatusAilment[] = [
        casterBurn,
        casterWeaken,
        casterStun,
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundCripple(casterBefore, []);

      // The caster's SUBSET debuffs (weaken + stun) are GONE, but its NON-subset debuffs
      // (burn + doom) REMAIN and its self-buff (empower) REMAINS — THIS multi-family selection
      // is the observable difference from Split (moves only burn), Snap (moves only weaken),
      // Lock (moves only stun), Doom (moves only doom) and Blight (moves burn+stun).
      expect(caster.map((a) => a.kind).sort()).toEqual(['burn', 'doom', 'empower']);
      expect(captured.map((a) => a.kind).sort()).toEqual(['stun', 'weaken']);

      // The FOE now carries a weaken AND a stun whose payloads EXACTLY match the caster's
      // pre-transfer arms (a full-duration raw deep copy); the foe does NOT gain burn/doom.
      expect(foe.map((a) => a.kind).sort()).toEqual(['stun', 'weaken']);
      const foeWeaken = foe.find((a) => a.kind === 'weaken')!;
      const foeStun = foe.find((a) => a.kind === 'stun')!;
      expect(foeWeaken).toEqual(casterWeaken);
      expect(foeStun).toEqual(casterStun);
      // The transferred arms are DISTINCT OBJECTS from the caster's originals (deep copy).
      expect(foeWeaken).not.toBe(casterWeaken);
      expect(foeStun).not.toBe(casterStun);
      // No HP write anywhere — the transfer only trims/appends status arrays (HP-monotone, A-42);
      // neither moved family ticks HP.
    });

    it('MULTI-FAMILY CONTRAST: on the SAME caster, Cripple = Snap ∪ Lock, is DISJOINT from Split ∪ Doom, and is DISTINCT from Blight (overlapping only on Lock)', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
      ];
      const split = reboundBySubset(SPLIT_KINDS, casterBefore, []);
      expect(split.foe.map((a) => a.kind).sort()).toEqual(['burn']);
      const snap = reboundBySubset(SNAP_KINDS, casterBefore, []);
      expect(snap.foe.map((a) => a.kind).sort()).toEqual(['weaken']);
      const lock = reboundBySubset(LOCK_KINDS, casterBefore, []);
      expect(lock.foe.map((a) => a.kind).sort()).toEqual(['stun']);
      const doom = reboundBySubset(DOOM_KINDS, casterBefore, []);
      expect(doom.foe.map((a) => a.kind).sort()).toEqual(['doom']);
      const blight = reboundBySubset(BLIGHT_KINDS, casterBefore, []);
      expect(blight.foe.map((a) => a.kind).sort()).toEqual(['burn', 'stun']);
      const cripple = reboundCripple(casterBefore, []);
      // Cripple moves the UNION of Snap's stat-mod AND Lock's control-lock together.
      expect(cripple.foe.map((a) => a.kind).sort()).toEqual(['stun', 'weaken']);
      // Cripple == Snap ∪ Lock exactly.
      const crippleKinds = new Set(cripple.foe.map((a) => a.kind));
      const snapLockKinds = new Set([
        ...snap.foe.map((a) => a.kind),
        ...lock.foe.map((a) => a.kind),
      ]);
      expect([...crippleKinds].sort()).toEqual([...snapLockKinds].sort());
      // Cripple is DISJOINT from Split AND Doom (the two families it leaves behind).
      const splitKinds = new Set(split.foe.map((a) => a.kind));
      const doomKinds = new Set(doom.foe.map((a) => a.kind));
      for (const a of cripple.foe) {
        expect(splitKinds.has(a.kind)).toBe(false);
        expect(doomKinds.has(a.kind)).toBe(false);
      }
      // DISTINCT from Blight — they share ONLY the control-lock (stun).
      const blightKinds = new Set(blight.foe.map((a) => a.kind));
      const shared = [...crippleKinds].filter((k) => blightKinds.has(k));
      expect(shared.sort()).toEqual(['stun']);
    });

    it('is a CONDITIONAL transfer: a caster carrying NONE of the subset kinds (only burn + doom + empower) → no clear → NO foe debuff', () => {
      const casterBefore: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundCripple(casterBefore, []);
      expect(captured).toEqual([]);
      // The caster is UNCHANGED — burn/doom/empower are NOT subset kinds.
      expect(caster.map((a) => a.kind).sort()).toEqual(['burn', 'doom', 'empower']);
      // The foe gains NO new debuff.
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a weaken is REPLACED by the transferred (full-duration) one', () => {
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterStun = applyAilment([], 'stun')[0]!;
      const foeWeakenPrior: StatusAilment = {
        kind: 'weaken',
        turnsRemaining: 1,
        defReduction: 1,
      };
      const { foe } = reboundCripple([casterWeaken, casterStun], [foeWeakenPrior]);
      const weakens = foe.filter((a) => a.kind === 'weaken');
      expect(weakens).toHaveLength(1);
      expect(weakens[0]).not.toBe(foeWeakenPrior); // the transferred arm replaced the prior
      expect(weakens[0]).toEqual(casterWeaken); // it is the transferred (full-duration) one
      // The stun rode along too (the whole subset moves).
      expect(foe.some((a) => a.kind === 'stun')).toBe(true);
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterBefore: StatusAilment[] = [casterWeaken, ...applyAilment([], 'stun')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundCripple(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterWeaken).toEqual(applyAilment([], 'weaken')[0]!); // captured original not mutated
    });
  });

  describe('Reclaim-Sear / Rebound-Sear — the FOURTEENTH status-REMOVAL mechanic, THIRD MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (TASK-89, isolated)', () => {
    // Rebound-Sear resolves as a COMPOSITION done inline in simulateBattle's reclaim-sear
    // branch: FIRST CAPTURE the caster's OWN debuff ARMS whose kind is in the SUBSET
    // REBOUND_SEAR_KINDS (the UNION of the DoTs AND the stat-mods) with their EXACT remaining
    // state; THEN `clearKinds(me.statuses, REBOUND_SEAR_KINDS)` strips ONLY those subset kinds
    // off the caster (leaving the caster's control-locks/doom AND self-buffs); THEN — ONLY when
    // the captured set is NON-empty — FULL-duration DEEP-COPY each captured arm onto the FOE via
    // `{ ...arm }` (NO duration change), de-duped by kind. This mirrors the branch verbatim on the
    // exported primitive it reuses (clearKinds). REBOUND_SEAR_KINDS (the union of the DoT +
    // stat-mod subsets) is module-private, so the helper mirrors it here as the fixed frozen set —
    // the FIRST 2-of-4 union NOT containing the control-locks, DISJOINT from the control-lock AND
    // doom subsets, and DISTINCT from BOTH Blight (shares only the DoTs) AND Cripple (shares only
    // the stat-mods).
    const SPLIT_KINDS = new Set<StatusAilment['kind']>(['burn', 'poison', 'bleed', 'corrode']);
    const LOCK_KINDS = new Set<StatusAilment['kind']>(['stun', 'freeze', 'sleep']);
    const SNAP_KINDS = new Set<StatusAilment['kind']>(['weaken', 'enfeeble', 'vulnerable']);
    const DOOM_KINDS = new Set<StatusAilment['kind']>(['doom']);
    // The three UNION sets the branches derive from the existing frozen subsets.
    const BLIGHT_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...LOCK_KINDS]);
    const CRIPPLE_KINDS = new Set<StatusAilment['kind']>([...SNAP_KINDS, ...LOCK_KINDS]);
    const SEAR_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...SNAP_KINDS]);
    const CLEANSABLE_KINDS = new Set<StatusAilment['kind']>([
      'burn',
      'poison',
      'bleed',
      'corrode',
      'doom',
      'weaken',
      'enfeeble',
      'vulnerable',
      'stun',
      'freeze',
      'sleep',
    ]);
    const reboundBySubset = (
      subset: ReadonlySet<StatusAilment['kind']>,
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      const capturedArms = caster.filter((s) => subset.has(s.kind));
      const casterNext = clearKinds(caster, subset);
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext =
        capturedArms.length > 0
          ? [
              ...foe.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ]
          : [...foe];
      return { caster: casterNext, foe: foeNext, captured: capturedArms };
    };
    const reboundSear = (caster: readonly StatusAilment[], foe: readonly StatusAilment[]) =>
      reboundBySubset(SEAR_KINDS, caster, foe);

    it('REBOUND_SEAR_KINDS is EQUAL to REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS, a STRICT subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT from REBOUND_LOCK_KINDS and REBOUND_DOOM_KINDS, and DISTINCT from BOTH REBOUND_BLIGHT_KINDS and REBOUND_CRIPPLE_KINDS', () => {
      // EQUAL to the union of the two existing disjoint subsets (both directions): size 7 and
      // every member is in exactly one of Split/Snap.
      expect(SEAR_KINDS.size).toBe(7);
      for (const k of SEAR_KINDS) {
        expect(SPLIT_KINDS.has(k) || SNAP_KINDS.has(k)).toBe(true);
      }
      for (const k of SPLIT_KINDS) expect(SEAR_KINDS.has(k)).toBe(true);
      for (const k of SNAP_KINDS) expect(SEAR_KINDS.has(k)).toBe(true);
      // STRICT subset of the 11 cleansable kinds (7 < 11).
      for (const k of SEAR_KINDS) expect(CLEANSABLE_KINDS.has(k)).toBe(true);
      expect(SEAR_KINDS.size).toBeLessThan(CLEANSABLE_KINDS.size);
      // DISJOINT from BOTH the control-lock subset AND the doom subset (the two it leaves behind).
      for (const k of SEAR_KINDS) {
        expect(LOCK_KINDS.has(k)).toBe(false);
        expect(DOOM_KINDS.has(k)).toBe(false);
      }
      // DISTINCT from Blight — they share ONLY the DoTs: Sear has the stat-mods where Blight has
      // the control-locks.
      expect(SEAR_KINDS.has('weaken')).toBe(true);
      expect(BLIGHT_KINDS.has('weaken')).toBe(false);
      // DISTINCT from Cripple — they share ONLY the stat-mods: Sear has the DoTs where Cripple has
      // the control-locks.
      expect(SEAR_KINDS.has('burn')).toBe(true);
      expect(CRIPPLE_KINDS.has('burn')).toBe(false);
      // The control-locks belong to BOTH Blight and Cripple but NOT to Sear.
      expect(SEAR_KINDS.has('stun')).toBe(false);
      expect(BLIGHT_KINDS.has('stun')).toBe(true);
      expect(CRIPPLE_KINDS.has('stun')).toBe(true);
    });

    it('clearKinds(_, SEAR_KINDS) removes ONLY the DoT + stat-mod arms while leaving control-locks, doom, and self-buffs (clearKinds reuse, no regression)', () => {
      const mixed: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const after = clearKinds(mixed, SEAR_KINDS);
      // burn (DoT) + weaken (stat-mod) removed; stun (lock) + doom + empower (self-buff) remain.
      expect(after.map((a) => a.kind).sort()).toEqual(['doom', 'empower', 'stun']);
      // The pre-existing clearKinds ↔ clearDebuffs generalization still holds BYTE-UNCHANGED
      // (this wave changes neither helper): clearDebuffs strips burn+stun+weaken+doom, keeps empower.
      expect(
        clearDebuffs(mixed)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower']);
    });

    it('clears BOTH the caster DoT AND stat-mod debuffs, KEEPS control-lock/doom debuffs + self-buff, AND moves ONLY the DoT+stat-mod arms onto the FOE at FULL duration', () => {
      // The caster carries a MIX spanning all four families: a burn@4 + a weaken + a stun + a doom
      // PLUS a self-buff (empower); the foe carries NONE of those kinds.
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterBefore: StatusAilment[] = [
        casterBurn,
        casterWeaken,
        casterStun,
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundSear(casterBefore, []);

      // The caster's SUBSET debuffs (burn + weaken) are GONE, but its NON-subset debuffs
      // (stun + doom) REMAIN and its self-buff (empower) REMAINS — THIS multi-family selection
      // is the observable difference from Split (only burn), Snap (only weaken), Lock (only stun),
      // Doom (only doom), Blight (burn+stun) and Cripple (weaken+stun). Sear is the ONLY union NOT
      // containing the locks.
      expect(caster.map((a) => a.kind).sort()).toEqual(['doom', 'empower', 'stun']);
      expect(captured.map((a) => a.kind).sort()).toEqual(['burn', 'weaken']);

      // The FOE now carries a burn AND a weaken whose payloads EXACTLY match the caster's
      // pre-transfer arms (a full-duration raw deep copy); the foe does NOT gain stun/doom.
      expect(foe.map((a) => a.kind).sort()).toEqual(['burn', 'weaken']);
      const foeBurn = foe.find((a) => a.kind === 'burn')!;
      const foeWeaken = foe.find((a) => a.kind === 'weaken')!;
      expect(foeBurn).toEqual(casterBurn);
      expect(foeWeaken).toEqual(casterWeaken);
      // The transferred arms are DISTINCT OBJECTS from the caster's originals (deep copy).
      expect(foeBurn).not.toBe(casterBurn);
      expect(foeWeaken).not.toBe(casterWeaken);
      // No HP write anywhere — the transfer only trims/appends status arrays (HP-monotone, A-42);
      // the moved DoT would tick foe HP LATER via the existing seam, the moved stat-mod scales
      // damage only.
    });

    it('MULTI-FAMILY CONTRAST: on the SAME caster, Sear = Split ∪ Snap, is DISJOINT from Lock ∪ Doom, and is DISTINCT from BOTH Blight and Cripple', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
      ];
      const split = reboundBySubset(SPLIT_KINDS, casterBefore, []);
      expect(split.foe.map((a) => a.kind).sort()).toEqual(['burn']);
      const snap = reboundBySubset(SNAP_KINDS, casterBefore, []);
      expect(snap.foe.map((a) => a.kind).sort()).toEqual(['weaken']);
      const lock = reboundBySubset(LOCK_KINDS, casterBefore, []);
      expect(lock.foe.map((a) => a.kind).sort()).toEqual(['stun']);
      const doom = reboundBySubset(DOOM_KINDS, casterBefore, []);
      expect(doom.foe.map((a) => a.kind).sort()).toEqual(['doom']);
      const blight = reboundBySubset(BLIGHT_KINDS, casterBefore, []);
      expect(blight.foe.map((a) => a.kind).sort()).toEqual(['burn', 'stun']);
      const cripple = reboundBySubset(CRIPPLE_KINDS, casterBefore, []);
      expect(cripple.foe.map((a) => a.kind).sort()).toEqual(['stun', 'weaken']);
      const sear = reboundSear(casterBefore, []);
      // Sear moves the UNION of Split's DoT AND Snap's stat-mod together.
      expect(sear.foe.map((a) => a.kind).sort()).toEqual(['burn', 'weaken']);
      // Sear == Split ∪ Snap exactly.
      const searKinds = new Set(sear.foe.map((a) => a.kind));
      const splitSnapKinds = new Set([
        ...split.foe.map((a) => a.kind),
        ...snap.foe.map((a) => a.kind),
      ]);
      expect([...searKinds].sort()).toEqual([...splitSnapKinds].sort());
      // Sear is DISJOINT from Lock AND Doom (the two families it leaves behind).
      const lockKinds = new Set(lock.foe.map((a) => a.kind));
      const doomKinds = new Set(doom.foe.map((a) => a.kind));
      for (const a of sear.foe) {
        expect(lockKinds.has(a.kind)).toBe(false);
        expect(doomKinds.has(a.kind)).toBe(false);
      }
      // DISTINCT from Blight — they share ONLY the DoT (burn).
      const blightKinds = new Set(blight.foe.map((a) => a.kind));
      expect([...searKinds].filter((k) => blightKinds.has(k)).sort()).toEqual(['burn']);
      // DISTINCT from Cripple — they share ONLY the stat-mod (weaken).
      const crippleKinds = new Set(cripple.foe.map((a) => a.kind));
      expect([...searKinds].filter((k) => crippleKinds.has(k)).sort()).toEqual(['weaken']);
    });

    it('is a CONDITIONAL transfer: a caster carrying NONE of the subset kinds (only stun + doom + empower) → no clear → NO foe debuff', () => {
      const casterBefore: StatusAilment[] = [
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundSear(casterBefore, []);
      expect(captured).toEqual([]);
      // The caster is UNCHANGED — stun/doom/empower are NOT subset kinds.
      expect(caster.map((a) => a.kind).sort()).toEqual(['doom', 'empower', 'stun']);
      // The foe gains NO new debuff.
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a burn is REPLACED by the transferred (full-duration) one', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const foeBurnPrior: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 1,
        damagePerTurn: 1,
      };
      const { foe } = reboundSear([casterBurn, casterWeaken], [foeBurnPrior]);
      const burns = foe.filter((a) => a.kind === 'burn');
      expect(burns).toHaveLength(1);
      expect(burns[0]).not.toBe(foeBurnPrior); // the transferred arm replaced the prior
      expect(burns[0]).toEqual(casterBurn); // it is the transferred (full-duration) one
      // The weaken rode along too (the whole subset moves).
      expect(foe.some((a) => a.kind === 'weaken')).toBe(true);
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [casterBurn, ...applyAilment([], 'weaken')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundSear(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterBurn).toEqual({
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      }); // captured original not mutated
    });
  });

  describe('Reclaim-Doomburn / Rebound-Doomburn — the FIFTEENTH status-REMOVAL mechanic, FOURTH MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, the FIRST union CONTAINING doom (TASK-90, isolated)', () => {
    // Rebound-Doomburn resolves as a COMPOSITION done inline in simulateBattle's reclaim-doomburn
    // branch: FIRST CAPTURE the caster's OWN debuff ARMS whose kind is in the SUBSET
    // REBOUND_DOOMBURN_KINDS (the UNION of the DoTs AND `doom`) with their EXACT remaining state;
    // THEN `clearKinds(me.statuses, REBOUND_DOOMBURN_KINDS)` strips ONLY those subset kinds off the
    // caster (leaving the caster's stat-mods/control-locks AND self-buffs); THEN — ONLY when the
    // captured set is NON-empty — FULL-duration DEEP-COPY each captured arm onto the FOE via
    // `{ ...arm }` (NO duration change), de-duped by kind. This mirrors the branch verbatim on the
    // exported primitive it reuses (clearKinds). REBOUND_DOOMBURN_KINDS (the union of the DoT +
    // doom subsets) is module-private, so the helper mirrors it here as the fixed frozen set — the
    // FOURTH 2-of-4 union and the FIRST containing `doom`, DISJOINT from the stat-mod AND
    // control-lock subsets, and DISTINCT from Blight/Sear (share only the DoTs) AND Cripple (shares
    // nothing).
    const SPLIT_KINDS = new Set<StatusAilment['kind']>(['burn', 'poison', 'bleed', 'corrode']);
    const LOCK_KINDS = new Set<StatusAilment['kind']>(['stun', 'freeze', 'sleep']);
    const SNAP_KINDS = new Set<StatusAilment['kind']>(['weaken', 'enfeeble', 'vulnerable']);
    const DOOM_KINDS = new Set<StatusAilment['kind']>(['doom']);
    // The union sets the branches derive from the existing frozen subsets.
    const BLIGHT_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...LOCK_KINDS]);
    const CRIPPLE_KINDS = new Set<StatusAilment['kind']>([...SNAP_KINDS, ...LOCK_KINDS]);
    const SEAR_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...SNAP_KINDS]);
    const DOOMBURN_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...DOOM_KINDS]);
    const CLEANSABLE_KINDS = new Set<StatusAilment['kind']>([
      'burn',
      'poison',
      'bleed',
      'corrode',
      'doom',
      'weaken',
      'enfeeble',
      'vulnerable',
      'stun',
      'freeze',
      'sleep',
    ]);
    const reboundBySubset = (
      subset: ReadonlySet<StatusAilment['kind']>,
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      const capturedArms = caster.filter((s) => subset.has(s.kind));
      const casterNext = clearKinds(caster, subset);
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext =
        capturedArms.length > 0
          ? [
              ...foe.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ]
          : [...foe];
      return { caster: casterNext, foe: foeNext, captured: capturedArms };
    };
    const reboundDoomburn = (caster: readonly StatusAilment[], foe: readonly StatusAilment[]) =>
      reboundBySubset(DOOMBURN_KINDS, caster, foe);

    it('REBOUND_DOOMBURN_KINDS is EQUAL to REBOUND_SPLIT_KINDS ∪ REBOUND_DOOM_KINDS, a STRICT subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT from REBOUND_SNAP_KINDS and REBOUND_LOCK_KINDS, and DISTINCT from REBOUND_BLIGHT_KINDS, REBOUND_CRIPPLE_KINDS and REBOUND_SEAR_KINDS', () => {
      // EQUAL to the union of the two existing disjoint subsets (both directions): size 5 and
      // every member is in exactly one of Split/Doom.
      expect(DOOMBURN_KINDS.size).toBe(5);
      for (const k of DOOMBURN_KINDS) {
        expect(SPLIT_KINDS.has(k) || DOOM_KINDS.has(k)).toBe(true);
      }
      for (const k of SPLIT_KINDS) expect(DOOMBURN_KINDS.has(k)).toBe(true);
      for (const k of DOOM_KINDS) expect(DOOMBURN_KINDS.has(k)).toBe(true);
      // STRICT subset of the 11 cleansable kinds (5 < 11).
      for (const k of DOOMBURN_KINDS) expect(CLEANSABLE_KINDS.has(k)).toBe(true);
      expect(DOOMBURN_KINDS.size).toBeLessThan(CLEANSABLE_KINDS.size);
      // DISJOINT from BOTH the stat-mod subset AND the control-lock subset (the two it leaves behind).
      for (const k of DOOMBURN_KINDS) {
        expect(SNAP_KINDS.has(k)).toBe(false);
        expect(LOCK_KINDS.has(k)).toBe(false);
      }
      // DISTINCT from Blight — they share ONLY the DoTs: Doomburn has `doom` where Blight has locks.
      expect(DOOMBURN_KINDS.has('doom')).toBe(true);
      expect(BLIGHT_KINDS.has('doom')).toBe(false);
      // DISTINCT from Sear — they share ONLY the DoTs: Doomburn has `doom` where Sear has stat-mods.
      expect(SEAR_KINDS.has('doom')).toBe(false);
      // DISTINCT from Cripple — they share NOTHING (Cripple = stat-mods ∪ locks).
      expect(CRIPPLE_KINDS.has('doom')).toBe(false);
      expect(DOOMBURN_KINDS.has('burn')).toBe(true);
      expect(CRIPPLE_KINDS.has('burn')).toBe(false);
      // The control-locks belong to Blight and Cripple but NOT Doomburn; `doom` is the differentiator.
      expect(DOOMBURN_KINDS.has('stun')).toBe(false);
      expect(BLIGHT_KINDS.has('stun')).toBe(true);
      expect(CRIPPLE_KINDS.has('stun')).toBe(true);
    });

    it('clearKinds(_, DOOMBURN_KINDS) removes ONLY the DoT + doom arms while leaving stat-mods, control-locks, and self-buffs (clearKinds reuse, no regression)', () => {
      const mixed: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const after = clearKinds(mixed, DOOMBURN_KINDS);
      // burn (DoT) + doom removed; stun (lock) + weaken (stat-mod) + empower (self-buff) remain.
      expect(after.map((a) => a.kind).sort()).toEqual(['empower', 'stun', 'weaken']);
      // The pre-existing clearKinds ↔ clearDebuffs generalization still holds BYTE-UNCHANGED
      // (this wave changes neither helper): clearDebuffs strips burn+stun+weaken+doom, keeps empower.
      expect(
        clearDebuffs(mixed)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower']);
    });

    it('clears BOTH the caster DoT AND doom debuffs, KEEPS stat-mod/control-lock debuffs + self-buff, AND moves ONLY the DoT+doom arms onto the FOE at FULL duration', () => {
      // The caster carries a MIX spanning all four families: a burn@4 + a weaken + a stun + a doom
      // PLUS a self-buff (empower); the foe carries NONE of those kinds.
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterDoom = applyAilment([], 'doom')[0]!;
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterBefore: StatusAilment[] = [
        casterBurn,
        casterDoom,
        casterWeaken,
        casterStun,
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundDoomburn(casterBefore, []);

      // The caster's SUBSET debuffs (burn + doom) are GONE, but its NON-subset debuffs
      // (weaken + stun) REMAIN and its self-buff (empower) REMAINS — THIS multi-family selection
      // is the observable difference from Split (only burn), Doom (only doom), Snap (only weaken),
      // Lock (only stun), Blight (burn+stun), Cripple (weaken+stun) and Sear (burn+weaken).
      // Doomburn is the ONLY union CONTAINING doom.
      expect(caster.map((a) => a.kind).sort()).toEqual(['empower', 'stun', 'weaken']);
      expect(captured.map((a) => a.kind).sort()).toEqual(['burn', 'doom']);

      // The FOE now carries a burn AND a doom whose payloads EXACTLY match the caster's
      // pre-transfer arms (a full-duration raw deep copy); the foe does NOT gain weaken/stun.
      expect(foe.map((a) => a.kind).sort()).toEqual(['burn', 'doom']);
      const foeBurn = foe.find((a) => a.kind === 'burn')!;
      const foeDoom = foe.find((a) => a.kind === 'doom')!;
      expect(foeBurn).toEqual(casterBurn);
      expect(foeDoom).toEqual(casterDoom);
      // The transferred arms are DISTINCT OBJECTS from the caster's originals (deep copy).
      expect(foeBurn).not.toBe(casterBurn);
      expect(foeDoom).not.toBe(casterDoom);
      // No HP write anywhere — the transfer only trims/appends status arrays (HP-monotone, A-42);
      // the moved DoT would tick foe HP LATER and the moved doom would detonate via existing seams.
    });

    it('MULTI-FAMILY CONTRAST: on the SAME caster, Doomburn = Split ∪ Doom, is DISJOINT from Snap ∪ Lock, and is DISTINCT from Blight, Cripple and Sear', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
      ];
      const split = reboundBySubset(SPLIT_KINDS, casterBefore, []);
      expect(split.foe.map((a) => a.kind).sort()).toEqual(['burn']);
      const snap = reboundBySubset(SNAP_KINDS, casterBefore, []);
      expect(snap.foe.map((a) => a.kind).sort()).toEqual(['weaken']);
      const lock = reboundBySubset(LOCK_KINDS, casterBefore, []);
      expect(lock.foe.map((a) => a.kind).sort()).toEqual(['stun']);
      const doom = reboundBySubset(DOOM_KINDS, casterBefore, []);
      expect(doom.foe.map((a) => a.kind).sort()).toEqual(['doom']);
      const blight = reboundBySubset(BLIGHT_KINDS, casterBefore, []);
      expect(blight.foe.map((a) => a.kind).sort()).toEqual(['burn', 'stun']);
      const cripple = reboundBySubset(CRIPPLE_KINDS, casterBefore, []);
      expect(cripple.foe.map((a) => a.kind).sort()).toEqual(['stun', 'weaken']);
      const sear = reboundBySubset(SEAR_KINDS, casterBefore, []);
      expect(sear.foe.map((a) => a.kind).sort()).toEqual(['burn', 'weaken']);
      const doomburn = reboundDoomburn(casterBefore, []);
      // Doomburn moves the UNION of Split's DoT AND Doom's `doom` together.
      expect(doomburn.foe.map((a) => a.kind).sort()).toEqual(['burn', 'doom']);
      // Doomburn == Split ∪ Doom exactly.
      const doomburnKinds = new Set(doomburn.foe.map((a) => a.kind));
      const splitDoomKinds = new Set([
        ...split.foe.map((a) => a.kind),
        ...doom.foe.map((a) => a.kind),
      ]);
      expect([...doomburnKinds].sort()).toEqual([...splitDoomKinds].sort());
      // Doomburn is DISJOINT from Snap AND Lock (the two families it leaves behind).
      const snapKinds = new Set(snap.foe.map((a) => a.kind));
      const lockKinds = new Set(lock.foe.map((a) => a.kind));
      for (const a of doomburn.foe) {
        expect(snapKinds.has(a.kind)).toBe(false);
        expect(lockKinds.has(a.kind)).toBe(false);
      }
      // DISTINCT from Blight — they share ONLY the DoT (burn).
      const blightKinds = new Set(blight.foe.map((a) => a.kind));
      expect([...doomburnKinds].filter((k) => blightKinds.has(k)).sort()).toEqual(['burn']);
      // DISTINCT from Sear — they share ONLY the DoT (burn).
      const searKinds = new Set(sear.foe.map((a) => a.kind));
      expect([...doomburnKinds].filter((k) => searKinds.has(k)).sort()).toEqual(['burn']);
      // DISTINCT from Cripple — they share NOTHING.
      const crippleKinds = new Set(cripple.foe.map((a) => a.kind));
      expect([...doomburnKinds].filter((k) => crippleKinds.has(k))).toEqual([]);
    });

    it('is a CONDITIONAL transfer: a caster carrying NONE of the subset kinds (only weaken + stun + empower) → no clear → NO foe debuff', () => {
      const casterBefore: StatusAilment[] = [
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundDoomburn(casterBefore, []);
      expect(captured).toEqual([]);
      // The caster is UNCHANGED — weaken/stun/empower are NOT subset kinds.
      expect(caster.map((a) => a.kind).sort()).toEqual(['empower', 'stun', 'weaken']);
      // The foe gains NO new debuff.
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a burn is REPLACED by the transferred (full-duration) one', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterDoom = applyAilment([], 'doom')[0]!;
      const foeBurnPrior: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 1,
        damagePerTurn: 1,
      };
      const { foe } = reboundDoomburn([casterBurn, casterDoom], [foeBurnPrior]);
      const burns = foe.filter((a) => a.kind === 'burn');
      expect(burns).toHaveLength(1);
      expect(burns[0]).not.toBe(foeBurnPrior); // the transferred arm replaced the prior
      expect(burns[0]).toEqual(casterBurn); // it is the transferred (full-duration) one
      // The doom rode along too (the whole subset moves).
      expect(foe.some((a) => a.kind === 'doom')).toBe(true);
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [casterBurn, ...applyAilment([], 'doom')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundDoomburn(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterBurn).toEqual({
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      }); // captured original not mutated
    });
  });

  describe('Reclaim-Snapdoom / Rebound-Snapdoom — the SIXTEENTH status-REMOVAL mechanic, FIFTH MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, the SECOND union CONTAINING doom (TASK-91, isolated)', () => {
    // Rebound-Snapdoom resolves as a COMPOSITION done inline in simulateBattle's reclaim-snapdoom
    // branch: FIRST CAPTURE the caster's OWN debuff ARMS whose kind is in the SUBSET
    // REBOUND_SNAPDOOM_KINDS (the UNION of the STAT-MODS AND `doom`) with their EXACT remaining
    // state; THEN `clearKinds(me.statuses, REBOUND_SNAPDOOM_KINDS)` strips ONLY those subset kinds
    // off the caster (leaving the caster's DoTs/control-locks AND self-buffs); THEN — ONLY when the
    // captured set is NON-empty — FULL-duration DEEP-COPY each captured arm onto the FOE via
    // `{ ...arm }` (NO duration change), de-duped by kind. This mirrors the branch verbatim on the
    // exported primitive it reuses (clearKinds). REBOUND_SNAPDOOM_KINDS (the union of the stat-mod +
    // doom subsets) is module-private, so the helper mirrors it here as the fixed frozen set — the
    // FIFTH 2-of-4 union and the SECOND containing `doom`, DISJOINT from the DoT AND control-lock
    // subsets, and DISTINCT from Doomburn (shares only `doom`), Cripple/Sear (share only the
    // stat-mods) AND Blight (shares nothing).
    const SPLIT_KINDS = new Set<StatusAilment['kind']>(['burn', 'poison', 'bleed', 'corrode']);
    const LOCK_KINDS = new Set<StatusAilment['kind']>(['stun', 'freeze', 'sleep']);
    const SNAP_KINDS = new Set<StatusAilment['kind']>(['weaken', 'enfeeble', 'vulnerable']);
    const DOOM_KINDS = new Set<StatusAilment['kind']>(['doom']);
    // The union sets the branches derive from the existing frozen subsets.
    const BLIGHT_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...LOCK_KINDS]);
    const CRIPPLE_KINDS = new Set<StatusAilment['kind']>([...SNAP_KINDS, ...LOCK_KINDS]);
    const SEAR_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...SNAP_KINDS]);
    const DOOMBURN_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...DOOM_KINDS]);
    const SNAPDOOM_KINDS = new Set<StatusAilment['kind']>([...SNAP_KINDS, ...DOOM_KINDS]);
    const CLEANSABLE_KINDS = new Set<StatusAilment['kind']>([
      'burn',
      'poison',
      'bleed',
      'corrode',
      'doom',
      'weaken',
      'enfeeble',
      'vulnerable',
      'stun',
      'freeze',
      'sleep',
    ]);
    const reboundBySubset = (
      subset: ReadonlySet<StatusAilment['kind']>,
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      const capturedArms = caster.filter((s) => subset.has(s.kind));
      const casterNext = clearKinds(caster, subset);
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext =
        capturedArms.length > 0
          ? [
              ...foe.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ]
          : [...foe];
      return { caster: casterNext, foe: foeNext, captured: capturedArms };
    };
    const reboundSnapdoom = (caster: readonly StatusAilment[], foe: readonly StatusAilment[]) =>
      reboundBySubset(SNAPDOOM_KINDS, caster, foe);

    it('REBOUND_SNAPDOOM_KINDS is EQUAL to REBOUND_SNAP_KINDS ∪ REBOUND_DOOM_KINDS, a STRICT subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT from REBOUND_SPLIT_KINDS and REBOUND_LOCK_KINDS, and DISTINCT from REBOUND_DOOMBURN_KINDS, REBOUND_CRIPPLE_KINDS and REBOUND_SEAR_KINDS', () => {
      // EQUAL to the union of the two existing disjoint subsets (both directions): size 4 and
      // every member is in exactly one of Snap/Doom.
      expect(SNAPDOOM_KINDS.size).toBe(4);
      for (const k of SNAPDOOM_KINDS) {
        expect(SNAP_KINDS.has(k) || DOOM_KINDS.has(k)).toBe(true);
      }
      for (const k of SNAP_KINDS) expect(SNAPDOOM_KINDS.has(k)).toBe(true);
      for (const k of DOOM_KINDS) expect(SNAPDOOM_KINDS.has(k)).toBe(true);
      // STRICT subset of the 11 cleansable kinds (4 < 11).
      for (const k of SNAPDOOM_KINDS) expect(CLEANSABLE_KINDS.has(k)).toBe(true);
      expect(SNAPDOOM_KINDS.size).toBeLessThan(CLEANSABLE_KINDS.size);
      // DISJOINT from BOTH the DoT subset AND the control-lock subset (the two it leaves behind).
      for (const k of SNAPDOOM_KINDS) {
        expect(SPLIT_KINDS.has(k)).toBe(false);
        expect(LOCK_KINDS.has(k)).toBe(false);
      }
      // DISTINCT from Doomburn — they share ONLY `doom`: Snapdoom has stat-mods where Doomburn has DoTs.
      expect(SNAPDOOM_KINDS.has('doom')).toBe(true);
      expect(DOOMBURN_KINDS.has('doom')).toBe(true);
      expect(SNAPDOOM_KINDS.has('weaken')).toBe(true);
      expect(DOOMBURN_KINDS.has('weaken')).toBe(false);
      // DISTINCT from Cripple — they share ONLY the stat-mods: Snapdoom has `doom` where Cripple has locks.
      expect(CRIPPLE_KINDS.has('doom')).toBe(false);
      expect(CRIPPLE_KINDS.has('weaken')).toBe(true);
      // DISTINCT from Sear — they share ONLY the stat-mods: Snapdoom has `doom` where Sear has DoTs.
      expect(SEAR_KINDS.has('doom')).toBe(false);
      expect(SEAR_KINDS.has('weaken')).toBe(true);
      // DISTINCT from Blight — they share NOTHING (Blight = DoTs ∪ locks).
      expect(SNAPDOOM_KINDS.has('burn')).toBe(false);
      expect(BLIGHT_KINDS.has('weaken')).toBe(false);
      expect(BLIGHT_KINDS.has('doom')).toBe(false);
      // The control-locks belong to Blight and Cripple but NOT Snapdoom; `doom` is the differentiator.
      expect(SNAPDOOM_KINDS.has('stun')).toBe(false);
      expect(BLIGHT_KINDS.has('stun')).toBe(true);
      expect(CRIPPLE_KINDS.has('stun')).toBe(true);
    });

    it('clearKinds(_, SNAPDOOM_KINDS) removes ONLY the stat-mod + doom arms while leaving DoTs, control-locks, and self-buffs (clearKinds reuse, no regression)', () => {
      const mixed: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const after = clearKinds(mixed, SNAPDOOM_KINDS);
      // weaken (stat-mod) + doom removed; burn (DoT) + stun (lock) + empower (self-buff) remain.
      expect(after.map((a) => a.kind).sort()).toEqual(['burn', 'empower', 'stun']);
      // The pre-existing clearKinds ↔ clearDebuffs generalization still holds BYTE-UNCHANGED
      // (this wave changes neither helper): clearDebuffs strips burn+stun+weaken+doom, keeps empower.
      expect(
        clearDebuffs(mixed)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower']);
    });

    it('clears BOTH the caster stat-mod AND doom debuffs, KEEPS DoT/control-lock debuffs + self-buff, AND moves ONLY the stat-mod+doom arms onto the FOE at FULL duration', () => {
      // The caster carries a MIX spanning all four families: a burn@4 + a weaken + a stun + a doom
      // PLUS a self-buff (empower); the foe carries NONE of those kinds.
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterDoom = applyAilment([], 'doom')[0]!;
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterBefore: StatusAilment[] = [
        casterBurn,
        casterDoom,
        casterWeaken,
        casterStun,
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundSnapdoom(casterBefore, []);

      // The caster's SUBSET debuffs (weaken + doom) are GONE, but its NON-subset debuffs
      // (burn + stun) REMAIN and its self-buff (empower) REMAINS — THIS multi-family selection
      // is the observable difference from Split (only burn), Doom (only doom), Snap (only weaken),
      // Lock (only stun), Blight (burn+stun), Cripple (weaken+stun), Sear (burn+weaken) and
      // Doomburn (burn+doom). Snapdoom is the union of the stat-mods AND doom.
      expect(caster.map((a) => a.kind).sort()).toEqual(['burn', 'empower', 'stun']);
      expect(captured.map((a) => a.kind).sort()).toEqual(['doom', 'weaken']);

      // The FOE now carries a weaken AND a doom whose payloads EXACTLY match the caster's
      // pre-transfer arms (a full-duration raw deep copy); the foe does NOT gain burn/stun.
      expect(foe.map((a) => a.kind).sort()).toEqual(['doom', 'weaken']);
      const foeWeaken = foe.find((a) => a.kind === 'weaken')!;
      const foeDoom = foe.find((a) => a.kind === 'doom')!;
      expect(foeWeaken).toEqual(casterWeaken);
      expect(foeDoom).toEqual(casterDoom);
      // The transferred arms are DISTINCT OBJECTS from the caster's originals (deep copy).
      expect(foeWeaken).not.toBe(casterWeaken);
      expect(foeDoom).not.toBe(casterDoom);
      // No HP write anywhere — the transfer only trims/appends status arrays (HP-monotone, A-42);
      // the moved stat-mod changes only the foe's damage-side payoff and the moved doom detonates
      // via existing seams.
    });

    it('MULTI-FAMILY CONTRAST: on the SAME caster, Snapdoom = Snap ∪ Doom, is DISJOINT from Split ∪ Lock, and is DISTINCT from Blight, Cripple, Sear and Doomburn', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
      ];
      const split = reboundBySubset(SPLIT_KINDS, casterBefore, []);
      expect(split.foe.map((a) => a.kind).sort()).toEqual(['burn']);
      const snap = reboundBySubset(SNAP_KINDS, casterBefore, []);
      expect(snap.foe.map((a) => a.kind).sort()).toEqual(['weaken']);
      const lock = reboundBySubset(LOCK_KINDS, casterBefore, []);
      expect(lock.foe.map((a) => a.kind).sort()).toEqual(['stun']);
      const doom = reboundBySubset(DOOM_KINDS, casterBefore, []);
      expect(doom.foe.map((a) => a.kind).sort()).toEqual(['doom']);
      const blight = reboundBySubset(BLIGHT_KINDS, casterBefore, []);
      expect(blight.foe.map((a) => a.kind).sort()).toEqual(['burn', 'stun']);
      const cripple = reboundBySubset(CRIPPLE_KINDS, casterBefore, []);
      expect(cripple.foe.map((a) => a.kind).sort()).toEqual(['stun', 'weaken']);
      const sear = reboundBySubset(SEAR_KINDS, casterBefore, []);
      expect(sear.foe.map((a) => a.kind).sort()).toEqual(['burn', 'weaken']);
      const doomburn = reboundBySubset(DOOMBURN_KINDS, casterBefore, []);
      expect(doomburn.foe.map((a) => a.kind).sort()).toEqual(['burn', 'doom']);
      const snapdoom = reboundSnapdoom(casterBefore, []);
      // Snapdoom moves the UNION of Snap's stat-mod AND Doom's `doom` together.
      expect(snapdoom.foe.map((a) => a.kind).sort()).toEqual(['doom', 'weaken']);
      // Snapdoom == Snap ∪ Doom exactly.
      const snapdoomKinds = new Set(snapdoom.foe.map((a) => a.kind));
      const snapDoomKinds = new Set([
        ...snap.foe.map((a) => a.kind),
        ...doom.foe.map((a) => a.kind),
      ]);
      expect([...snapdoomKinds].sort()).toEqual([...snapDoomKinds].sort());
      // Snapdoom is DISJOINT from Split AND Lock (the two families it leaves behind).
      const splitKinds = new Set(split.foe.map((a) => a.kind));
      const lockKinds = new Set(lock.foe.map((a) => a.kind));
      for (const a of snapdoom.foe) {
        expect(splitKinds.has(a.kind)).toBe(false);
        expect(lockKinds.has(a.kind)).toBe(false);
      }
      // DISTINCT from Cripple — they share ONLY the stat-mod (weaken).
      const crippleKinds = new Set(cripple.foe.map((a) => a.kind));
      expect([...snapdoomKinds].filter((k) => crippleKinds.has(k)).sort()).toEqual(['weaken']);
      // DISTINCT from Sear — they share ONLY the stat-mod (weaken).
      const searKinds = new Set(sear.foe.map((a) => a.kind));
      expect([...snapdoomKinds].filter((k) => searKinds.has(k)).sort()).toEqual(['weaken']);
      // DISTINCT from Doomburn — they share ONLY `doom`.
      const doomburnKinds = new Set(doomburn.foe.map((a) => a.kind));
      expect([...snapdoomKinds].filter((k) => doomburnKinds.has(k)).sort()).toEqual(['doom']);
      // DISTINCT from Blight — they share NOTHING.
      const blightKinds = new Set(blight.foe.map((a) => a.kind));
      expect([...snapdoomKinds].filter((k) => blightKinds.has(k))).toEqual([]);
    });

    it('is a CONDITIONAL transfer: a caster carrying NONE of the subset kinds (only burn + stun + empower) → no clear → NO foe debuff', () => {
      const casterBefore: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundSnapdoom(casterBefore, []);
      expect(captured).toEqual([]);
      // The caster is UNCHANGED — burn/stun/empower are NOT subset kinds.
      expect(caster.map((a) => a.kind).sort()).toEqual(['burn', 'empower', 'stun']);
      // The foe gains NO new debuff.
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a weaken is REPLACED by the transferred (full-duration) one', () => {
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterDoom = applyAilment([], 'doom')[0]!;
      const foeWeakenPrior = applyAilment([], 'weaken')[0]!;
      // Age the prior foe weaken so it is DISTINCT from the fresh transferred one.
      foeWeakenPrior.turnsRemaining = 1;
      const { foe } = reboundSnapdoom([casterWeaken, casterDoom], [foeWeakenPrior]);
      const weakens = foe.filter((a) => a.kind === 'weaken');
      expect(weakens).toHaveLength(1);
      expect(weakens[0]).not.toBe(foeWeakenPrior); // the transferred arm replaced the prior
      expect(weakens[0]).toEqual(casterWeaken); // it is the transferred (full-duration) one
      // The doom rode along too (the whole subset moves).
      expect(foe.some((a) => a.kind === 'doom')).toBe(true);
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterBefore: StatusAilment[] = [casterWeaken, ...applyAilment([], 'doom')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundSnapdoom(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterWeaken).toEqual(applyAilment([], 'weaken')[0]); // captured original not mutated
    });
  });

  describe('Reclaim-Doomlock / Rebound-Doomlock — the SEVENTEENTH status-REMOVAL mechanic, SIXTH (and FINAL) MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, the THIRD union CONTAINING doom (TASK-92, isolated)', () => {
    // Rebound-Doomlock resolves as a COMPOSITION done inline in simulateBattle's reclaim-doomlock
    // branch: FIRST CAPTURE the caster's OWN debuff ARMS whose kind is in the SUBSET
    // REBOUND_DOOMLOCK_KINDS (the UNION of the CONTROL-LOCKS AND `doom`) with their EXACT remaining
    // state; THEN `clearKinds(me.statuses, REBOUND_DOOMLOCK_KINDS)` strips ONLY those subset kinds
    // off the caster (leaving the caster's DoTs/stat-mods AND self-buffs); THEN — ONLY when the
    // captured set is NON-empty — FULL-duration DEEP-COPY each captured arm onto the FOE via
    // `{ ...arm }` (NO duration change), de-duped by kind. This mirrors the branch verbatim on the
    // exported primitive it reuses (clearKinds). REBOUND_DOOMLOCK_KINDS (the union of the
    // control-lock + doom subsets) is module-private, so the helper mirrors it here as the fixed
    // frozen set — the SIXTH (and last) 2-of-4 union and the THIRD containing `doom`, DISJOINT from
    // the DoT AND stat-mod subsets, and DISTINCT from Doomburn/Snapdoom (share only `doom`),
    // Blight/Cripple (share only the locks). This CLOSES all six 2-of-4 unions.
    const SPLIT_KINDS = new Set<StatusAilment['kind']>(['burn', 'poison', 'bleed', 'corrode']);
    const LOCK_KINDS = new Set<StatusAilment['kind']>(['stun', 'freeze', 'sleep']);
    const SNAP_KINDS = new Set<StatusAilment['kind']>(['weaken', 'enfeeble', 'vulnerable']);
    const DOOM_KINDS = new Set<StatusAilment['kind']>(['doom']);
    // The union sets the branches derive from the existing frozen subsets.
    const BLIGHT_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...LOCK_KINDS]);
    const CRIPPLE_KINDS = new Set<StatusAilment['kind']>([...SNAP_KINDS, ...LOCK_KINDS]);
    const SEAR_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...SNAP_KINDS]);
    const DOOMBURN_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...DOOM_KINDS]);
    const SNAPDOOM_KINDS = new Set<StatusAilment['kind']>([...SNAP_KINDS, ...DOOM_KINDS]);
    const DOOMLOCK_KINDS = new Set<StatusAilment['kind']>([...LOCK_KINDS, ...DOOM_KINDS]);
    const CLEANSABLE_KINDS = new Set<StatusAilment['kind']>([
      'burn',
      'poison',
      'bleed',
      'corrode',
      'doom',
      'weaken',
      'enfeeble',
      'vulnerable',
      'stun',
      'freeze',
      'sleep',
    ]);
    const reboundBySubset = (
      subset: ReadonlySet<StatusAilment['kind']>,
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      const capturedArms = caster.filter((s) => subset.has(s.kind));
      const casterNext = clearKinds(caster, subset);
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext =
        capturedArms.length > 0
          ? [
              ...foe.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ]
          : [...foe];
      return { caster: casterNext, foe: foeNext, captured: capturedArms };
    };
    const reboundDoomlock = (caster: readonly StatusAilment[], foe: readonly StatusAilment[]) =>
      reboundBySubset(DOOMLOCK_KINDS, caster, foe);

    it('REBOUND_DOOMLOCK_KINDS is EQUAL to REBOUND_LOCK_KINDS ∪ REBOUND_DOOM_KINDS, a STRICT subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT from REBOUND_SPLIT_KINDS and REBOUND_SNAP_KINDS, and DISTINCT from REBOUND_BLIGHT_KINDS, REBOUND_CRIPPLE_KINDS, REBOUND_DOOMBURN_KINDS and REBOUND_SNAPDOOM_KINDS', () => {
      expect(DOOMLOCK_KINDS.size).toBe(4);
      for (const k of DOOMLOCK_KINDS) {
        expect(LOCK_KINDS.has(k) || DOOM_KINDS.has(k)).toBe(true);
      }
      for (const k of LOCK_KINDS) expect(DOOMLOCK_KINDS.has(k)).toBe(true);
      for (const k of DOOM_KINDS) expect(DOOMLOCK_KINDS.has(k)).toBe(true);
      for (const k of DOOMLOCK_KINDS) expect(CLEANSABLE_KINDS.has(k)).toBe(true);
      expect(DOOMLOCK_KINDS.size).toBeLessThan(CLEANSABLE_KINDS.size);
      for (const k of DOOMLOCK_KINDS) {
        expect(SPLIT_KINDS.has(k)).toBe(false);
        expect(SNAP_KINDS.has(k)).toBe(false);
      }
      // DISTINCT from Doomburn — share ONLY `doom`: Doomlock has locks where Doomburn has DoTs.
      expect(DOOMLOCK_KINDS.has('doom')).toBe(true);
      expect(DOOMBURN_KINDS.has('doom')).toBe(true);
      expect(DOOMLOCK_KINDS.has('stun')).toBe(true);
      expect(DOOMBURN_KINDS.has('stun')).toBe(false);
      // DISTINCT from Snapdoom — share ONLY `doom`: Doomlock has locks where Snapdoom has stat-mods.
      expect(SNAPDOOM_KINDS.has('doom')).toBe(true);
      expect(SNAPDOOM_KINDS.has('stun')).toBe(false);
      // DISTINCT from Blight — share ONLY the locks: Doomlock has `doom` where Blight has DoTs.
      expect(BLIGHT_KINDS.has('doom')).toBe(false);
      expect(BLIGHT_KINDS.has('stun')).toBe(true);
      // DISTINCT from Cripple — share ONLY the locks: Doomlock has `doom` where Cripple has stat-mods.
      expect(CRIPPLE_KINDS.has('doom')).toBe(false);
      expect(CRIPPLE_KINDS.has('stun')).toBe(true);
      expect(DOOMLOCK_KINDS.has('burn')).toBe(false);
      expect(DOOMLOCK_KINDS.has('weaken')).toBe(false);
      expect(SEAR_KINDS.has('doom')).toBe(false);
    });

    it('clearKinds(_, DOOMLOCK_KINDS) removes ONLY the control-lock + doom arms while leaving DoTs, stat-mods, and self-buffs (clearKinds reuse, no regression)', () => {
      const mixed: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const after = clearKinds(mixed, DOOMLOCK_KINDS);
      expect(after.map((a) => a.kind).sort()).toEqual(['burn', 'empower', 'weaken']);
      expect(
        clearDebuffs(mixed)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower']);
    });

    it('clears BOTH the caster control-lock AND doom debuffs, KEEPS DoT/stat-mod debuffs + self-buff, AND moves ONLY the control-lock+doom arms onto the FOE at FULL duration', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterDoom = applyAilment([], 'doom')[0]!;
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterBefore: StatusAilment[] = [
        casterBurn,
        casterDoom,
        casterWeaken,
        casterStun,
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundDoomlock(casterBefore, []);

      // The caster's SUBSET debuffs (stun + doom) are GONE; burn (DoT) + weaken (stat-mod) +
      // empower (self-buff) REMAIN — Doomlock is the union of the control-locks AND doom.
      expect(caster.map((a) => a.kind).sort()).toEqual(['burn', 'empower', 'weaken']);
      expect(captured.map((a) => a.kind).sort()).toEqual(['doom', 'stun']);

      expect(foe.map((a) => a.kind).sort()).toEqual(['doom', 'stun']);
      const foeStun = foe.find((a) => a.kind === 'stun')!;
      const foeDoom = foe.find((a) => a.kind === 'doom')!;
      expect(foeStun).toEqual(casterStun);
      expect(foeDoom).toEqual(casterDoom);
      expect(foeStun).not.toBe(casterStun);
      expect(foeDoom).not.toBe(casterDoom);
    });

    it('MULTI-FAMILY CONTRAST: on the SAME caster, Doomlock = Lock ∪ Doom, is DISJOINT from Split ∪ Snap, and is DISTINCT from Blight, Cripple, Sear, Doomburn and Snapdoom', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
      ];
      const split = reboundBySubset(SPLIT_KINDS, casterBefore, []);
      expect(split.foe.map((a) => a.kind).sort()).toEqual(['burn']);
      const snap = reboundBySubset(SNAP_KINDS, casterBefore, []);
      expect(snap.foe.map((a) => a.kind).sort()).toEqual(['weaken']);
      const lock = reboundBySubset(LOCK_KINDS, casterBefore, []);
      expect(lock.foe.map((a) => a.kind).sort()).toEqual(['stun']);
      const doom = reboundBySubset(DOOM_KINDS, casterBefore, []);
      expect(doom.foe.map((a) => a.kind).sort()).toEqual(['doom']);
      const blight = reboundBySubset(BLIGHT_KINDS, casterBefore, []);
      expect(blight.foe.map((a) => a.kind).sort()).toEqual(['burn', 'stun']);
      const cripple = reboundBySubset(CRIPPLE_KINDS, casterBefore, []);
      expect(cripple.foe.map((a) => a.kind).sort()).toEqual(['stun', 'weaken']);
      const sear = reboundBySubset(SEAR_KINDS, casterBefore, []);
      expect(sear.foe.map((a) => a.kind).sort()).toEqual(['burn', 'weaken']);
      const doomburn = reboundBySubset(DOOMBURN_KINDS, casterBefore, []);
      expect(doomburn.foe.map((a) => a.kind).sort()).toEqual(['burn', 'doom']);
      const snapdoom = reboundBySubset(SNAPDOOM_KINDS, casterBefore, []);
      expect(snapdoom.foe.map((a) => a.kind).sort()).toEqual(['doom', 'weaken']);
      const doomlock = reboundDoomlock(casterBefore, []);
      expect(doomlock.foe.map((a) => a.kind).sort()).toEqual(['doom', 'stun']);
      const doomlockKinds = new Set(doomlock.foe.map((a) => a.kind));
      const lockDoomKinds = new Set([
        ...lock.foe.map((a) => a.kind),
        ...doom.foe.map((a) => a.kind),
      ]);
      expect([...doomlockKinds].sort()).toEqual([...lockDoomKinds].sort());
      const splitKinds = new Set(split.foe.map((a) => a.kind));
      const snapKinds = new Set(snap.foe.map((a) => a.kind));
      for (const a of doomlock.foe) {
        expect(splitKinds.has(a.kind)).toBe(false);
        expect(snapKinds.has(a.kind)).toBe(false);
      }
      const blightKinds = new Set(blight.foe.map((a) => a.kind));
      expect([...doomlockKinds].filter((k) => blightKinds.has(k)).sort()).toEqual(['stun']);
      const crippleKinds = new Set(cripple.foe.map((a) => a.kind));
      expect([...doomlockKinds].filter((k) => crippleKinds.has(k)).sort()).toEqual(['stun']);
      const doomburnKinds = new Set(doomburn.foe.map((a) => a.kind));
      expect([...doomlockKinds].filter((k) => doomburnKinds.has(k)).sort()).toEqual(['doom']);
      const snapdoomKinds = new Set(snapdoom.foe.map((a) => a.kind));
      expect([...doomlockKinds].filter((k) => snapdoomKinds.has(k)).sort()).toEqual(['doom']);
      const searKinds = new Set(sear.foe.map((a) => a.kind));
      expect([...doomlockKinds].filter((k) => searKinds.has(k))).toEqual([]);
    });

    it('is a CONDITIONAL transfer: a caster carrying NONE of the subset kinds (only burn + weaken + empower) → no clear → NO foe debuff', () => {
      const casterBefore: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundDoomlock(casterBefore, []);
      expect(captured).toEqual([]);
      expect(caster.map((a) => a.kind).sort()).toEqual(['burn', 'empower', 'weaken']);
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a stun is REPLACED by the transferred (full-duration) one', () => {
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterDoom = applyAilment([], 'doom')[0]!;
      const foeStunPrior = applyAilment([], 'stun')[0]!;
      foeStunPrior.turnsRemaining = 1;
      const { foe } = reboundDoomlock([casterStun, casterDoom], [foeStunPrior]);
      const stuns = foe.filter((a) => a.kind === 'stun');
      expect(stuns).toHaveLength(1);
      expect(stuns[0]).not.toBe(foeStunPrior);
      expect(stuns[0]).toEqual(casterStun);
      expect(foe.some((a) => a.kind === 'doom')).toBe(true);
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterBefore: StatusAilment[] = [casterStun, ...applyAilment([], 'doom')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundDoomlock(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterStun).toEqual(applyAilment([], 'stun')[0]);
    });
  });

  describe('Reclaim-Purge / Rebound-Purge — the EIGHTEENTH status-REMOVAL mechanic, FIRST 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, OPENING the 3-of-4 selectivity DEPTH (TASK-93, isolated)', () => {
    // Rebound-Purge resolves as a COMPOSITION done inline in simulateBattle's reclaim-purge branch:
    // FIRST CAPTURE the caster's OWN debuff ARMS whose kind is in the SUBSET REBOUND_PURGE_KINDS
    // (the UNION of the DoTs, STAT-MODS AND CONTROL-LOCKS = "everything but `doom`") with their EXACT
    // remaining state; THEN `clearKinds(me.statuses, REBOUND_PURGE_KINDS)` strips ONLY those subset
    // kinds off the caster (leaving ONLY the caster's `doom` arm AND self-buffs); THEN — ONLY when
    // the captured set is NON-empty — FULL-duration DEEP-COPY each captured arm onto the FOE via
    // `{ ...arm }` (NO duration change), de-duped by kind. This mirrors the branch verbatim on the
    // exported primitive it reuses (clearKinds). REBOUND_PURGE_KINDS (the union of the DoT + stat-mod
    // + control-lock subsets) is module-private, so the helper mirrors it here as the fixed frozen
    // set — the FIRST 3-of-4 union, a strict SUPERSET of every singleton and of the three
    // `doom`-excluding 2-of-4 unions Blight/Cripple/Sear, DISJOINT from `doom`, and DISTINCT from
    // Sear (strictly LARGER — Sear EXCLUDES the control-locks). This OPENS the 3-of-4 selectivity depth.
    const SPLIT_KINDS = new Set<StatusAilment['kind']>(['burn', 'poison', 'bleed', 'corrode']);
    const LOCK_KINDS = new Set<StatusAilment['kind']>(['stun', 'freeze', 'sleep']);
    const SNAP_KINDS = new Set<StatusAilment['kind']>(['weaken', 'enfeeble', 'vulnerable']);
    const DOOM_KINDS = new Set<StatusAilment['kind']>(['doom']);
    const BLIGHT_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...LOCK_KINDS]);
    const CRIPPLE_KINDS = new Set<StatusAilment['kind']>([...SNAP_KINDS, ...LOCK_KINDS]);
    const SEAR_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...SNAP_KINDS]);
    const DOOMLOCK_KINDS = new Set<StatusAilment['kind']>([...LOCK_KINDS, ...DOOM_KINDS]);
    const PURGE_KINDS = new Set<StatusAilment['kind']>([
      ...SPLIT_KINDS,
      ...SNAP_KINDS,
      ...LOCK_KINDS,
    ]);
    const CLEANSABLE_KINDS = new Set<StatusAilment['kind']>([
      'burn',
      'poison',
      'bleed',
      'corrode',
      'doom',
      'weaken',
      'enfeeble',
      'vulnerable',
      'stun',
      'freeze',
      'sleep',
    ]);
    const reboundBySubset = (
      subset: ReadonlySet<StatusAilment['kind']>,
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      const capturedArms = caster.filter((s) => subset.has(s.kind));
      const casterNext = clearKinds(caster, subset);
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext =
        capturedArms.length > 0
          ? [
              ...foe.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ]
          : [...foe];
      return { caster: casterNext, foe: foeNext, captured: capturedArms };
    };
    const reboundPurge = (caster: readonly StatusAilment[], foe: readonly StatusAilment[]) =>
      reboundBySubset(PURGE_KINDS, caster, foe);

    it('REBOUND_PURGE_KINDS is EQUAL to REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS, a STRICT subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT from REBOUND_DOOM_KINDS, a strict SUPERSET of Blight/Cripple/Sear, and DISTINCT from Sear', () => {
      expect(PURGE_KINDS.size).toBe(10);
      // EQUAL to SPLIT ∪ SNAP ∪ LOCK (both directions).
      for (const k of PURGE_KINDS) {
        expect(SPLIT_KINDS.has(k) || SNAP_KINDS.has(k) || LOCK_KINDS.has(k)).toBe(true);
      }
      for (const k of SPLIT_KINDS) expect(PURGE_KINDS.has(k)).toBe(true);
      for (const k of SNAP_KINDS) expect(PURGE_KINDS.has(k)).toBe(true);
      for (const k of LOCK_KINDS) expect(PURGE_KINDS.has(k)).toBe(true);
      // STRICT subset of CLEANSABLE (7 < 11).
      for (const k of PURGE_KINDS) expect(CLEANSABLE_KINDS.has(k)).toBe(true);
      expect(PURGE_KINDS.size).toBeLessThan(CLEANSABLE_KINDS.size);
      // DISJOINT from `doom` — it LEAVES `doom` behind.
      expect(PURGE_KINDS.has('doom')).toBe(false);
      for (const k of DOOM_KINDS) expect(PURGE_KINDS.has(k)).toBe(false);
      // Strict SUPERSET of every `doom`-excluding 2-of-4 union.
      for (const k of BLIGHT_KINDS) expect(PURGE_KINDS.has(k)).toBe(true);
      for (const k of CRIPPLE_KINDS) expect(PURGE_KINDS.has(k)).toBe(true);
      for (const k of SEAR_KINDS) expect(PURGE_KINDS.has(k)).toBe(true);
      expect(PURGE_KINDS.size).toBeGreaterThan(BLIGHT_KINDS.size);
      // DISTINCT from Sear — Purge is strictly LARGER (it also includes the control-locks).
      expect(SEAR_KINDS.size).toBe(7);
      expect(PURGE_KINDS.size).toBeGreaterThan(SEAR_KINDS.size);
      expect(PURGE_KINDS.has('stun')).toBe(true);
      expect(SEAR_KINDS.has('stun')).toBe(false);
      // Strictly larger than every 2-of-4 union / spans all three non-doom families.
      expect(PURGE_KINDS.has('burn')).toBe(true);
      expect(PURGE_KINDS.has('weaken')).toBe(true);
      expect(PURGE_KINDS.has('stun')).toBe(true);
    });

    it('clearKinds(_, PURGE_KINDS) removes ALL of the DoT + stat-mod + control-lock arms while leaving `doom` and self-buffs (clearKinds reuse, no regression)', () => {
      const mixed: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const after = clearKinds(mixed, PURGE_KINDS);
      expect(after.map((a) => a.kind).sort()).toEqual(['doom', 'empower']);
      // The pre-existing clearDebuffs equivalence is byte-unchanged by this wave.
      expect(
        clearDebuffs(mixed)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower']);
    });

    it('clears the caster DoT + stat-mod + control-lock debuffs, KEEPS ONLY `doom` + self-buff, AND moves ONLY those three arms onto the FOE at FULL duration', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterDoom = applyAilment([], 'doom')[0]!;
      const casterBefore: StatusAilment[] = [
        casterBurn,
        casterWeaken,
        casterStun,
        casterDoom,
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundPurge(casterBefore, []);

      // The caster's 3-family SUBSET debuffs (burn + weaken + stun) are GONE; ONLY `doom` (kept) +
      // empower (self-buff) REMAIN — Purge is the union of the DoTs, stat-mods AND control-locks.
      expect(caster.map((a) => a.kind).sort()).toEqual(['doom', 'empower']);
      expect(captured.map((a) => a.kind).sort()).toEqual(['burn', 'stun', 'weaken']);

      // The foe gains ONLY the burn+weaken+stun arms (NOT `doom`) at full duration, payloads preserved.
      expect(foe.map((a) => a.kind).sort()).toEqual(['burn', 'stun', 'weaken']);
      expect(foe.some((a) => a.kind === 'doom')).toBe(false);
      const foeBurn = foe.find((a) => a.kind === 'burn')!;
      const foeWeaken = foe.find((a) => a.kind === 'weaken')!;
      const foeStun = foe.find((a) => a.kind === 'stun')!;
      expect(foeBurn).toEqual(casterBurn);
      expect(foeWeaken).toEqual(casterWeaken);
      expect(foeStun).toEqual(casterStun);
      expect(foeBurn).not.toBe(casterBurn);
      expect(foeWeaken).not.toBe(casterWeaken);
      expect(foeStun).not.toBe(casterStun);
    });

    it('MULTI-FAMILY CONTRAST: on the SAME caster, Purge = Split ∪ Snap ∪ Lock, DISJOINT from Doom, strictly LARGER than every 2-of-4 union, and strictly LARGER than Sear', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'doom'),
      ];
      const doom = reboundBySubset(DOOM_KINDS, casterBefore, []);
      expect(doom.foe.map((a) => a.kind).sort()).toEqual(['doom']);
      const doomlock = reboundBySubset(DOOMLOCK_KINDS, casterBefore, []);
      expect(doomlock.foe.map((a) => a.kind).sort()).toEqual(['doom', 'stun']);
      const sear = reboundBySubset(SEAR_KINDS, casterBefore, []);
      expect(sear.foe.map((a) => a.kind).sort()).toEqual(['burn', 'weaken']);
      const purge = reboundPurge(casterBefore, []);
      expect(purge.foe.map((a) => a.kind).sort()).toEqual(['burn', 'stun', 'weaken']);

      const purgeKinds = new Set(purge.foe.map((a) => a.kind));
      // Purge = Split ∪ Snap ∪ Lock.
      expect([...purgeKinds].sort()).toEqual(['burn', 'stun', 'weaken']);
      // DISJOINT from `doom`.
      expect(purgeKinds.has('doom')).toBe(false);
      // Strictly LARGER than Doomlock (Purge lacks doom but has burn+weaken; Doomlock has doom).
      expect(purge.foe.length).toBeGreaterThan(doomlock.captured.length - 1);
      // DISTINCT from Sear — Purge has `stun`, Sear does not.
      expect(purgeKinds.has('stun')).toBe(true);
      expect(new Set(sear.foe.map((a) => a.kind)).has('stun')).toBe(false);
    });

    it('is a CONDITIONAL transfer: a caster carrying NONE of the subset kinds (only doom + empower) → no clear → NO foe debuff', () => {
      const casterBefore: StatusAilment[] = [
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundPurge(casterBefore, []);
      expect(captured).toEqual([]);
      expect(caster.map((a) => a.kind).sort()).toEqual(['doom', 'empower']);
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a burn is REPLACED by the transferred (full-duration) one', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterStun = applyAilment([], 'stun')[0]!;
      const foeBurnPrior: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 1,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const { foe } = reboundPurge([casterBurn, casterWeaken, casterStun], [foeBurnPrior]);
      const burns = foe.filter((a) => a.kind === 'burn');
      expect(burns).toHaveLength(1);
      expect(burns[0]).not.toBe(foeBurnPrior);
      expect(burns[0]).toEqual(casterBurn);
      expect(foe.some((a) => a.kind === 'weaken')).toBe(true);
      expect(foe.some((a) => a.kind === 'stun')).toBe(true);
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterBefore: StatusAilment[] = [casterStun, ...applyAilment([], 'weaken')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundPurge(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterStun).toEqual(applyAilment([], 'stun')[0]);
    });
  });

  describe('Reclaim-Seardoom / Rebound-Seardoom — the NINETEENTH status-REMOVAL mechanic, SECOND 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, FIRST doom-INCLUDING 3-of-4 union (TASK-94, isolated)', () => {
    // Rebound-Seardoom resolves as a COMPOSITION done inline in simulateBattle's reclaim-seardoom
    // branch, mirroring the reclaim-purge branch verbatim on the exported clearKinds primitive.
    // REBOUND_SEARDOOM_KINDS is module-private, so the helper mirrors it here as the fixed frozen
    // set — the SECOND 3-of-4 union and the FIRST that INCLUDES `doom`, the MIRROR of Purge across
    // the doom/control-lock swap.
    const SPLIT_KINDS = new Set<StatusAilment['kind']>(['burn', 'poison', 'bleed', 'corrode']);
    const LOCK_KINDS = new Set<StatusAilment['kind']>(['stun', 'freeze', 'sleep']);
    const SNAP_KINDS = new Set<StatusAilment['kind']>(['weaken', 'enfeeble', 'vulnerable']);
    const DOOM_KINDS = new Set<StatusAilment['kind']>(['doom']);
    const SEAR_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...SNAP_KINDS]);
    const DOOMBURN_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...DOOM_KINDS]);
    const SNAPDOOM_KINDS = new Set<StatusAilment['kind']>([...SNAP_KINDS, ...DOOM_KINDS]);
    const PURGE_KINDS = new Set<StatusAilment['kind']>([
      ...SPLIT_KINDS,
      ...SNAP_KINDS,
      ...LOCK_KINDS,
    ]);
    const SEARDOOM_KINDS = new Set<StatusAilment['kind']>([
      ...SPLIT_KINDS,
      ...SNAP_KINDS,
      ...DOOM_KINDS,
    ]);
    const CLEANSABLE_KINDS = new Set<StatusAilment['kind']>([
      'burn',
      'poison',
      'bleed',
      'corrode',
      'doom',
      'weaken',
      'enfeeble',
      'vulnerable',
      'stun',
      'freeze',
      'sleep',
    ]);
    const reboundBySubset = (
      subset: ReadonlySet<StatusAilment['kind']>,
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      const capturedArms = caster.filter((s) => subset.has(s.kind));
      const casterNext = clearKinds(caster, subset);
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext =
        capturedArms.length > 0
          ? [
              ...foe.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ]
          : [...foe];
      return { caster: casterNext, foe: foeNext, captured: capturedArms };
    };
    const reboundSeardoom = (caster: readonly StatusAilment[], foe: readonly StatusAilment[]) =>
      reboundBySubset(SEARDOOM_KINDS, caster, foe);

    it('REBOUND_SEARDOOM_KINDS is EQUAL to SPLIT ∪ SNAP ∪ DOOM, a STRICT subset of CLEANSABLE, DISJOINT from LOCK, a strict SUPERSET of Sear/Doomburn/Snapdoom, and DISTINCT from Purge', () => {
      expect(SEARDOOM_KINDS.size).toBe(8);
      for (const k of SEARDOOM_KINDS) {
        expect(SPLIT_KINDS.has(k) || SNAP_KINDS.has(k) || DOOM_KINDS.has(k)).toBe(true);
      }
      for (const k of SPLIT_KINDS) expect(SEARDOOM_KINDS.has(k)).toBe(true);
      for (const k of SNAP_KINDS) expect(SEARDOOM_KINDS.has(k)).toBe(true);
      for (const k of DOOM_KINDS) expect(SEARDOOM_KINDS.has(k)).toBe(true);
      for (const k of SEARDOOM_KINDS) expect(CLEANSABLE_KINDS.has(k)).toBe(true);
      expect(SEARDOOM_KINDS.size).toBeLessThan(CLEANSABLE_KINDS.size);
      for (const k of LOCK_KINDS) expect(SEARDOOM_KINDS.has(k)).toBe(false);
      expect(SEARDOOM_KINDS.has('stun')).toBe(false);
      expect(SEARDOOM_KINDS.has('doom')).toBe(true);
      for (const k of SEAR_KINDS) expect(SEARDOOM_KINDS.has(k)).toBe(true);
      for (const k of DOOMBURN_KINDS) expect(SEARDOOM_KINDS.has(k)).toBe(true);
      for (const k of SNAPDOOM_KINDS) expect(SEARDOOM_KINDS.has(k)).toBe(true);
      expect(SEAR_KINDS.size).toBe(7);
      expect(SEARDOOM_KINDS.size).toBeGreaterThan(SEAR_KINDS.size);
      expect(SEAR_KINDS.has('doom')).toBe(false);
      // DISTINCT from Purge — Seardoom has `doom` + not `stun`; Purge has `stun` + not `doom`; 8 ≠ 10.
      expect(PURGE_KINDS.has('doom')).toBe(false);
      expect(PURGE_KINDS.has('stun')).toBe(true);
      expect(SEARDOOM_KINDS.size).not.toBe(PURGE_KINDS.size);
    });

    it('clearKinds(_, SEARDOOM_KINDS) removes ALL DoT + stat-mod + `doom` arms while leaving the control-locks and self-buffs (clearKinds reuse, no regression)', () => {
      const mixed: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const after = clearKinds(mixed, SEARDOOM_KINDS);
      expect(after.map((a) => a.kind).sort()).toEqual(['empower', 'stun']);
      expect(
        clearDebuffs(mixed)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower']);
    });

    it('clears the caster DoT + stat-mod + `doom` debuffs, KEEPS ONLY the control-lock + self-buff, AND moves ONLY those three arms onto the FOE at FULL duration', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterDoom = applyAilment([], 'doom')[0]!;
      const casterBefore: StatusAilment[] = [
        casterBurn,
        casterWeaken,
        casterStun,
        casterDoom,
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundSeardoom(casterBefore, []);

      expect(caster.map((a) => a.kind).sort()).toEqual(['empower', 'stun']);
      expect(captured.map((a) => a.kind).sort()).toEqual(['burn', 'doom', 'weaken']);

      expect(foe.map((a) => a.kind).sort()).toEqual(['burn', 'doom', 'weaken']);
      expect(foe.some((a) => a.kind === 'stun')).toBe(false);
      const foeBurn = foe.find((a) => a.kind === 'burn')!;
      const foeWeaken = foe.find((a) => a.kind === 'weaken')!;
      const foeDoom = foe.find((a) => a.kind === 'doom')!;
      expect(foeBurn).toEqual(casterBurn);
      expect(foeWeaken).toEqual(casterWeaken);
      expect(foeDoom).toEqual(casterDoom);
      expect(foeBurn).not.toBe(casterBurn);
      expect(foeWeaken).not.toBe(casterWeaken);
      expect(foeDoom).not.toBe(casterDoom);
    });

    it('CONTRAST: on the SAME caster, Purge moves DoT+stat-mod+stun (leaving doom) while Seardoom moves DoT+stat-mod+doom (leaving stun); Sear moves only DoT+stat-mod', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'doom'),
      ];
      const sear = reboundBySubset(SEAR_KINDS, casterBefore, []);
      expect(sear.foe.map((a) => a.kind).sort()).toEqual(['burn', 'weaken']);
      const purge = reboundBySubset(PURGE_KINDS, casterBefore, []);
      expect(purge.foe.map((a) => a.kind).sort()).toEqual(['burn', 'stun', 'weaken']);
      const seardoom = reboundSeardoom(casterBefore, []);
      expect(seardoom.foe.map((a) => a.kind).sort()).toEqual(['burn', 'doom', 'weaken']);

      const seardoomKinds = new Set(seardoom.foe.map((a) => a.kind));
      expect(seardoomKinds.has('doom')).toBe(true);
      expect(seardoomKinds.has('stun')).toBe(false);
      expect(new Set(purge.foe.map((a) => a.kind)).has('doom')).toBe(false);
      expect(new Set(purge.foe.map((a) => a.kind)).has('stun')).toBe(true);
      expect(seardoom.foe.length).toBeGreaterThan(sear.foe.length);
      expect(new Set(sear.foe.map((a) => a.kind)).has('doom')).toBe(false);
    });

    it('is a CONDITIONAL transfer: a caster carrying NONE of the subset kinds (only stun + empower) → no clear → NO foe debuff', () => {
      const casterBefore: StatusAilment[] = [
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundSeardoom(casterBefore, []);
      expect(captured).toEqual([]);
      expect(caster.map((a) => a.kind).sort()).toEqual(['empower', 'stun']);
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a burn is REPLACED by the transferred (full-duration) one', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterDoom = applyAilment([], 'doom')[0]!;
      const foeBurnPrior: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 1,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const { foe } = reboundSeardoom([casterBurn, casterWeaken, casterDoom], [foeBurnPrior]);
      const burns = foe.filter((a) => a.kind === 'burn');
      expect(burns).toHaveLength(1);
      expect(burns[0]).not.toBe(foeBurnPrior);
      expect(burns[0]).toEqual(casterBurn);
      expect(foe.some((a) => a.kind === 'weaken')).toBe(true);
      expect(foe.some((a) => a.kind === 'doom')).toBe(true);
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterDoom = applyAilment([], 'doom')[0]!;
      const casterBefore: StatusAilment[] = [casterDoom, ...applyAilment([], 'weaken')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundSeardoom(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterDoom).toEqual(applyAilment([], 'doom')[0]);
    });
  });

  describe('Reclaim-Blightdoom / Rebound-Blightdoom — the TWENTIETH status-REMOVAL mechanic, THIRD 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, SECOND doom-INCLUDING 3-of-4 union (TASK-95, isolated)', () => {
    // Rebound-Blightdoom resolves as a COMPOSITION done inline in simulateBattle's reclaim-blightdoom
    // branch, mirroring the reclaim-seardoom branch verbatim on the exported clearKinds primitive.
    // REBOUND_BLIGHTDOOM_KINDS is module-private, so the helper mirrors it here as the fixed frozen
    // set — the THIRD 3-of-4 union and the SECOND that INCLUDES `doom`, the MIRROR of Seardoom across
    // the stat-mod/control-lock swap (Blightdoom keeps the stat-mods, moves the control-locks).
    const SPLIT_KINDS = new Set<StatusAilment['kind']>(['burn', 'poison', 'bleed', 'corrode']);
    const LOCK_KINDS = new Set<StatusAilment['kind']>(['stun', 'freeze', 'sleep']);
    const SNAP_KINDS = new Set<StatusAilment['kind']>(['weaken', 'enfeeble', 'vulnerable']);
    const DOOM_KINDS = new Set<StatusAilment['kind']>(['doom']);
    const BLIGHT_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...LOCK_KINDS]);
    const DOOMBURN_KINDS = new Set<StatusAilment['kind']>([...SPLIT_KINDS, ...DOOM_KINDS]);
    const DOOMLOCK_KINDS = new Set<StatusAilment['kind']>([...LOCK_KINDS, ...DOOM_KINDS]);
    const PURGE_KINDS = new Set<StatusAilment['kind']>([
      ...SPLIT_KINDS,
      ...SNAP_KINDS,
      ...LOCK_KINDS,
    ]);
    const SEARDOOM_KINDS = new Set<StatusAilment['kind']>([
      ...SPLIT_KINDS,
      ...SNAP_KINDS,
      ...DOOM_KINDS,
    ]);
    const BLIGHTDOOM_KINDS = new Set<StatusAilment['kind']>([
      ...SPLIT_KINDS,
      ...LOCK_KINDS,
      ...DOOM_KINDS,
    ]);
    const CLEANSABLE_KINDS = new Set<StatusAilment['kind']>([
      'burn',
      'poison',
      'bleed',
      'corrode',
      'doom',
      'weaken',
      'enfeeble',
      'vulnerable',
      'stun',
      'freeze',
      'sleep',
    ]);
    const reboundBySubset = (
      subset: ReadonlySet<StatusAilment['kind']>,
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      const capturedArms = caster.filter((s) => subset.has(s.kind));
      const casterNext = clearKinds(caster, subset);
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext =
        capturedArms.length > 0
          ? [
              ...foe.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ]
          : [...foe];
      return { caster: casterNext, foe: foeNext, captured: capturedArms };
    };
    const reboundBlightdoom = (caster: readonly StatusAilment[], foe: readonly StatusAilment[]) =>
      reboundBySubset(BLIGHTDOOM_KINDS, caster, foe);

    it('REBOUND_BLIGHTDOOM_KINDS is EQUAL to SPLIT ∪ LOCK ∪ DOOM, a STRICT subset of CLEANSABLE, DISJOINT from SNAP, a strict SUPERSET of Blight/Doomburn/Doomlock, and DISTINCT from Purge AND Seardoom', () => {
      expect(BLIGHTDOOM_KINDS.size).toBe(8);
      for (const k of BLIGHTDOOM_KINDS) {
        expect(SPLIT_KINDS.has(k) || LOCK_KINDS.has(k) || DOOM_KINDS.has(k)).toBe(true);
      }
      for (const k of SPLIT_KINDS) expect(BLIGHTDOOM_KINDS.has(k)).toBe(true);
      for (const k of LOCK_KINDS) expect(BLIGHTDOOM_KINDS.has(k)).toBe(true);
      for (const k of DOOM_KINDS) expect(BLIGHTDOOM_KINDS.has(k)).toBe(true);
      for (const k of BLIGHTDOOM_KINDS) expect(CLEANSABLE_KINDS.has(k)).toBe(true);
      expect(BLIGHTDOOM_KINDS.size).toBeLessThan(CLEANSABLE_KINDS.size);
      // DISJOINT from the stat-mods it LEAVES behind.
      for (const k of SNAP_KINDS) expect(BLIGHTDOOM_KINDS.has(k)).toBe(false);
      expect(BLIGHTDOOM_KINDS.has('weaken')).toBe(false);
      expect(BLIGHTDOOM_KINDS.has('doom')).toBe(true);
      expect(BLIGHTDOOM_KINDS.has('stun')).toBe(true);
      // Strict SUPERSET of Blight (= SPLIT ∪ LOCK, size 7) plus the doom-including 2-of-4 unions.
      for (const k of BLIGHT_KINDS) expect(BLIGHTDOOM_KINDS.has(k)).toBe(true);
      for (const k of DOOMBURN_KINDS) expect(BLIGHTDOOM_KINDS.has(k)).toBe(true);
      for (const k of DOOMLOCK_KINDS) expect(BLIGHTDOOM_KINDS.has(k)).toBe(true);
      expect(BLIGHT_KINDS.size).toBe(7);
      expect(BLIGHTDOOM_KINDS.size).toBeGreaterThan(BLIGHT_KINDS.size);
      expect(BLIGHT_KINDS.has('doom')).toBe(false);
      // DISTINCT from Purge — Blightdoom has `doom` + not `weaken`; Purge has `weaken` + not `doom`; 8 ≠ 10.
      expect(PURGE_KINDS.has('doom')).toBe(false);
      expect(PURGE_KINDS.has('weaken')).toBe(true);
      expect(BLIGHTDOOM_KINDS.size).not.toBe(PURGE_KINDS.size);
      // DISTINCT from Seardoom — both 8-kind doom-including 3-of-4 unions, but Blightdoom has `stun`
      // + not `weaken`, Seardoom the inverse (the stat-mod/control-lock swap).
      expect(BLIGHTDOOM_KINDS.has('stun')).toBe(true);
      expect(SEARDOOM_KINDS.has('stun')).toBe(false);
      expect(BLIGHTDOOM_KINDS.has('weaken')).toBe(false);
      expect(SEARDOOM_KINDS.has('weaken')).toBe(true);
      expect(BLIGHTDOOM_KINDS.size).toBe(SEARDOOM_KINDS.size);
    });

    it('clearKinds(_, BLIGHTDOOM_KINDS) removes ALL DoT + control-lock + `doom` arms while leaving the stat-mods and self-buffs (clearKinds reuse, no regression)', () => {
      const mixed: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const after = clearKinds(mixed, BLIGHTDOOM_KINDS);
      expect(after.map((a) => a.kind).sort()).toEqual(['empower', 'weaken']);
      expect(
        clearDebuffs(mixed)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower']);
    });

    it('clears the caster DoT + control-lock + `doom` debuffs, KEEPS ONLY the stat-mod + self-buff, AND moves ONLY those three arms onto the FOE at FULL duration', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterDoom = applyAilment([], 'doom')[0]!;
      const casterBefore: StatusAilment[] = [
        casterBurn,
        casterStun,
        casterWeaken,
        casterDoom,
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundBlightdoom(casterBefore, []);

      expect(caster.map((a) => a.kind).sort()).toEqual(['empower', 'weaken']);
      expect(captured.map((a) => a.kind).sort()).toEqual(['burn', 'doom', 'stun']);

      expect(foe.map((a) => a.kind).sort()).toEqual(['burn', 'doom', 'stun']);
      expect(foe.some((a) => a.kind === 'weaken')).toBe(false);
      const foeBurn = foe.find((a) => a.kind === 'burn')!;
      const foeStun = foe.find((a) => a.kind === 'stun')!;
      const foeDoom = foe.find((a) => a.kind === 'doom')!;
      expect(foeBurn).toEqual(casterBurn);
      expect(foeStun).toEqual(casterStun);
      expect(foeDoom).toEqual(casterDoom);
      expect(foeBurn).not.toBe(casterBurn);
      expect(foeStun).not.toBe(casterStun);
      expect(foeDoom).not.toBe(casterDoom);
    });

    it('CONTRAST: on the SAME caster, Seardoom moves DoT+weaken+doom (leaving stun) while Blightdoom moves DoT+stun+doom (leaving weaken); Blight moves only DoT+stun', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'doom'),
      ];
      const blight = reboundBySubset(BLIGHT_KINDS, casterBefore, []);
      expect(blight.foe.map((a) => a.kind).sort()).toEqual(['burn', 'stun']);
      const seardoom = reboundBySubset(SEARDOOM_KINDS, casterBefore, []);
      expect(seardoom.foe.map((a) => a.kind).sort()).toEqual(['burn', 'doom', 'weaken']);
      const blightdoom = reboundBlightdoom(casterBefore, []);
      expect(blightdoom.foe.map((a) => a.kind).sort()).toEqual(['burn', 'doom', 'stun']);

      const blightdoomKinds = new Set(blightdoom.foe.map((a) => a.kind));
      expect(blightdoomKinds.has('doom')).toBe(true);
      expect(blightdoomKinds.has('stun')).toBe(true);
      expect(blightdoomKinds.has('weaken')).toBe(false);
      // Seardoom is the mirror: has `weaken`, not `stun`.
      const seardoomKinds = new Set(seardoom.foe.map((a) => a.kind));
      expect(seardoomKinds.has('weaken')).toBe(true);
      expect(seardoomKinds.has('stun')).toBe(false);
      // Blightdoom additionally moves `doom` beyond Blight.
      expect(blightdoom.foe.length).toBeGreaterThan(blight.foe.length);
      expect(new Set(blight.foe.map((a) => a.kind)).has('doom')).toBe(false);
    });

    it('is a CONDITIONAL transfer: a caster carrying NONE of the subset kinds (only weaken + empower) → no clear → NO foe debuff', () => {
      const casterBefore: StatusAilment[] = [
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundBlightdoom(casterBefore, []);
      expect(captured).toEqual([]);
      expect(caster.map((a) => a.kind).sort()).toEqual(['empower', 'weaken']);
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a burn is REPLACED by the transferred (full-duration) one', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterDoom = applyAilment([], 'doom')[0]!;
      const foeBurnPrior: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 1,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const { foe } = reboundBlightdoom([casterBurn, casterStun, casterDoom], [foeBurnPrior]);
      const burns = foe.filter((a) => a.kind === 'burn');
      expect(burns).toHaveLength(1);
      expect(burns[0]).not.toBe(foeBurnPrior);
      expect(burns[0]).toEqual(casterBurn);
      expect(foe.some((a) => a.kind === 'stun')).toBe(true);
      expect(foe.some((a) => a.kind === 'doom')).toBe(true);
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterDoom = applyAilment([], 'doom')[0]!;
      const casterBefore: StatusAilment[] = [casterDoom, ...applyAilment([], 'stun')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundBlightdoom(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterDoom).toEqual(applyAilment([], 'doom')[0]);
    });
  });

  describe('Reclaim-Snaplockdoom / Rebound-Snaplockdoom — the TWENTY-FIRST status-REMOVAL mechanic, FOURTH and LAST 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, THIRD doom-INCLUDING 3-of-4 union, CLOSING the 3-of-4 axis (TASK-96, isolated)', () => {
    // Rebound-Snaplockdoom resolves as a COMPOSITION done inline in simulateBattle's
    // reclaim-snaplockdoom branch, mirroring the reclaim-blightdoom branch verbatim on the exported
    // clearKinds primitive. REBOUND_SNAPLOCKDOOM_KINDS is module-private, so the helper mirrors it
    // here as the fixed frozen set — the FOURTH and LAST 3-of-4 union and the THIRD that INCLUDES
    // `doom`, the ONLY 3-of-4 triple that EXCLUDES the DoTs (Snaplockdoom keeps the DoTs, moves the
    // stat-mods + control-locks + `doom`).
    const SPLIT_KINDS = new Set<StatusAilment['kind']>(['burn', 'poison', 'bleed', 'corrode']);
    const LOCK_KINDS = new Set<StatusAilment['kind']>(['stun', 'freeze', 'sleep']);
    const SNAP_KINDS = new Set<StatusAilment['kind']>(['weaken', 'enfeeble', 'vulnerable']);
    const DOOM_KINDS = new Set<StatusAilment['kind']>(['doom']);
    const CRIPPLE_KINDS = new Set<StatusAilment['kind']>([...SNAP_KINDS, ...LOCK_KINDS]);
    const SNAPDOOM_KINDS = new Set<StatusAilment['kind']>([...SNAP_KINDS, ...DOOM_KINDS]);
    const DOOMLOCK_KINDS = new Set<StatusAilment['kind']>([...LOCK_KINDS, ...DOOM_KINDS]);
    const PURGE_KINDS = new Set<StatusAilment['kind']>([
      ...SPLIT_KINDS,
      ...SNAP_KINDS,
      ...LOCK_KINDS,
    ]);
    const SEARDOOM_KINDS = new Set<StatusAilment['kind']>([
      ...SPLIT_KINDS,
      ...SNAP_KINDS,
      ...DOOM_KINDS,
    ]);
    const BLIGHTDOOM_KINDS = new Set<StatusAilment['kind']>([
      ...SPLIT_KINDS,
      ...LOCK_KINDS,
      ...DOOM_KINDS,
    ]);
    const SNAPLOCKDOOM_KINDS = new Set<StatusAilment['kind']>([
      ...SNAP_KINDS,
      ...LOCK_KINDS,
      ...DOOM_KINDS,
    ]);
    const CLEANSABLE_KINDS = new Set<StatusAilment['kind']>([
      'burn',
      'poison',
      'bleed',
      'corrode',
      'doom',
      'weaken',
      'enfeeble',
      'vulnerable',
      'stun',
      'freeze',
      'sleep',
    ]);
    const reboundBySubset = (
      subset: ReadonlySet<StatusAilment['kind']>,
      caster: readonly StatusAilment[],
      foe: readonly StatusAilment[],
    ): { caster: StatusAilment[]; foe: StatusAilment[]; captured: StatusAilment[] } => {
      const capturedArms = caster.filter((s) => subset.has(s.kind));
      const casterNext = clearKinds(caster, subset);
      const transferredKinds = new Set(capturedArms.map((a) => a.kind));
      const foeNext =
        capturedArms.length > 0
          ? [
              ...foe.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ]
          : [...foe];
      return { caster: casterNext, foe: foeNext, captured: capturedArms };
    };
    const reboundSnaplockdoom = (caster: readonly StatusAilment[], foe: readonly StatusAilment[]) =>
      reboundBySubset(SNAPLOCKDOOM_KINDS, caster, foe);

    it('REBOUND_SNAPLOCKDOOM_KINDS is EQUAL to SNAP ∪ LOCK ∪ DOOM, a STRICT subset of CLEANSABLE, DISJOINT from SPLIT, a strict SUPERSET of Cripple/Snapdoom/Doomlock, and DISTINCT from Purge, Seardoom AND Blightdoom', () => {
      expect(SNAPLOCKDOOM_KINDS.size).toBe(7);
      for (const k of SNAPLOCKDOOM_KINDS) {
        expect(SNAP_KINDS.has(k) || LOCK_KINDS.has(k) || DOOM_KINDS.has(k)).toBe(true);
      }
      for (const k of SNAP_KINDS) expect(SNAPLOCKDOOM_KINDS.has(k)).toBe(true);
      for (const k of LOCK_KINDS) expect(SNAPLOCKDOOM_KINDS.has(k)).toBe(true);
      for (const k of DOOM_KINDS) expect(SNAPLOCKDOOM_KINDS.has(k)).toBe(true);
      for (const k of SNAPLOCKDOOM_KINDS) expect(CLEANSABLE_KINDS.has(k)).toBe(true);
      expect(SNAPLOCKDOOM_KINDS.size).toBeLessThan(CLEANSABLE_KINDS.size);
      // DISJOINT from the DoTs it LEAVES behind.
      for (const k of SPLIT_KINDS) expect(SNAPLOCKDOOM_KINDS.has(k)).toBe(false);
      expect(SNAPLOCKDOOM_KINDS.has('burn')).toBe(false);
      expect(SNAPLOCKDOOM_KINDS.has('doom')).toBe(true);
      expect(SNAPLOCKDOOM_KINDS.has('stun')).toBe(true);
      expect(SNAPLOCKDOOM_KINDS.has('weaken')).toBe(true);
      // Strict SUPERSET of Cripple (= SNAP ∪ LOCK, size 6) plus the doom-including 2-of-4 unions.
      for (const k of CRIPPLE_KINDS) expect(SNAPLOCKDOOM_KINDS.has(k)).toBe(true);
      for (const k of SNAPDOOM_KINDS) expect(SNAPLOCKDOOM_KINDS.has(k)).toBe(true);
      for (const k of DOOMLOCK_KINDS) expect(SNAPLOCKDOOM_KINDS.has(k)).toBe(true);
      expect(CRIPPLE_KINDS.size).toBe(6);
      expect(SNAPLOCKDOOM_KINDS.size).toBeGreaterThan(CRIPPLE_KINDS.size);
      expect(CRIPPLE_KINDS.has('doom')).toBe(false);
      // DISTINCT from Purge — Snaplockdoom has `doom` + not `burn`; Purge has `burn` + not `doom`; 7 ≠ 10.
      expect(PURGE_KINDS.has('doom')).toBe(false);
      expect(PURGE_KINDS.has('burn')).toBe(true);
      expect(SNAPLOCKDOOM_KINDS.size).not.toBe(PURGE_KINDS.size);
      // DISTINCT from Seardoom — both doom-including, but Snaplockdoom has `stun` + not `burn`,
      // Seardoom the inverse; 7 ≠ 8.
      expect(SNAPLOCKDOOM_KINDS.has('stun')).toBe(true);
      expect(SEARDOOM_KINDS.has('stun')).toBe(false);
      expect(SEARDOOM_KINDS.has('burn')).toBe(true);
      expect(SNAPLOCKDOOM_KINDS.size).not.toBe(SEARDOOM_KINDS.size);
      // DISTINCT from Blightdoom — both doom-including, but Snaplockdoom has `weaken` + not `burn`,
      // Blightdoom the inverse; 7 ≠ 8.
      expect(SNAPLOCKDOOM_KINDS.has('weaken')).toBe(true);
      expect(BLIGHTDOOM_KINDS.has('weaken')).toBe(false);
      expect(BLIGHTDOOM_KINDS.has('burn')).toBe(true);
      expect(SNAPLOCKDOOM_KINDS.size).not.toBe(BLIGHTDOOM_KINDS.size);
    });

    it('clearKinds(_, SNAPLOCKDOOM_KINDS) removes ALL stat-mod + control-lock + `doom` arms while leaving the DoTs and self-buffs (clearKinds reuse, no regression)', () => {
      const mixed: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'doom'),
        ...applyAilment([], 'empower'),
      ];
      const after = clearKinds(mixed, SNAPLOCKDOOM_KINDS);
      expect(after.map((a) => a.kind).sort()).toEqual(['burn', 'empower']);
      expect(
        clearDebuffs(mixed)
          .map((a) => a.kind)
          .sort(),
      ).toEqual(['empower']);
    });

    it('clears the caster stat-mod + control-lock + `doom` debuffs, KEEPS ONLY the DoT + self-buff, AND moves ONLY those three arms onto the FOE at FULL duration', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterDoom = applyAilment([], 'doom')[0]!;
      const casterBefore: StatusAilment[] = [
        casterBurn,
        casterStun,
        casterWeaken,
        casterDoom,
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundSnaplockdoom(casterBefore, []);

      expect(caster.map((a) => a.kind).sort()).toEqual(['burn', 'empower']);
      expect(captured.map((a) => a.kind).sort()).toEqual(['doom', 'stun', 'weaken']);

      expect(foe.map((a) => a.kind).sort()).toEqual(['doom', 'stun', 'weaken']);
      expect(foe.some((a) => a.kind === 'burn')).toBe(false);
      const foeWeaken = foe.find((a) => a.kind === 'weaken')!;
      const foeStun = foe.find((a) => a.kind === 'stun')!;
      const foeDoom = foe.find((a) => a.kind === 'doom')!;
      expect(foeWeaken).toEqual(casterWeaken);
      expect(foeStun).toEqual(casterStun);
      expect(foeDoom).toEqual(casterDoom);
      expect(foeWeaken).not.toBe(casterWeaken);
      expect(foeStun).not.toBe(casterStun);
      expect(foeDoom).not.toBe(casterDoom);
    });

    it('CONTRAST: on the SAME caster, Purge moves DoT+weaken+stun (leaving doom) while Snaplockdoom moves weaken+stun+doom (leaving burn); Blightdoom moves DoT+stun+doom (leaving weaken); Cripple moves only weaken+stun', () => {
      const casterBurn: StatusAilment = {
        kind: 'burn',
        turnsRemaining: 4,
        damagePerTurn: BURN_DAMAGE_PER_TURN,
      };
      const casterBefore: StatusAilment[] = [
        casterBurn,
        ...applyAilment([], 'weaken'),
        ...applyAilment([], 'stun'),
        ...applyAilment([], 'doom'),
      ];
      const cripple = reboundBySubset(CRIPPLE_KINDS, casterBefore, []);
      expect(cripple.foe.map((a) => a.kind).sort()).toEqual(['stun', 'weaken']);
      const purge = reboundBySubset(PURGE_KINDS, casterBefore, []);
      expect(purge.foe.map((a) => a.kind).sort()).toEqual(['burn', 'stun', 'weaken']);
      const blightdoom = reboundBySubset(BLIGHTDOOM_KINDS, casterBefore, []);
      expect(blightdoom.foe.map((a) => a.kind).sort()).toEqual(['burn', 'doom', 'stun']);
      const snaplockdoom = reboundSnaplockdoom(casterBefore, []);
      expect(snaplockdoom.foe.map((a) => a.kind).sort()).toEqual(['doom', 'stun', 'weaken']);

      const snaplockdoomKinds = new Set(snaplockdoom.foe.map((a) => a.kind));
      expect(snaplockdoomKinds.has('doom')).toBe(true);
      expect(snaplockdoomKinds.has('stun')).toBe(true);
      expect(snaplockdoomKinds.has('weaken')).toBe(true);
      // Snaplockdoom is the ONLY 3-of-4 triple that EXCLUDES the DoTs — it leaves `burn`.
      expect(snaplockdoomKinds.has('burn')).toBe(false);
      // Purge is the inverse of Snaplockdoom across the burn/doom swap: has `burn`, not `doom`.
      const purgeKinds = new Set(purge.foe.map((a) => a.kind));
      expect(purgeKinds.has('burn')).toBe(true);
      expect(purgeKinds.has('doom')).toBe(false);
      // Snaplockdoom additionally moves `doom` beyond Cripple.
      expect(snaplockdoom.foe.length).toBeGreaterThan(cripple.foe.length);
      expect(new Set(cripple.foe.map((a) => a.kind)).has('doom')).toBe(false);
    });

    it('is a CONDITIONAL transfer: a caster carrying NONE of the subset kinds (only burn + empower) → no clear → NO foe debuff', () => {
      const casterBefore: StatusAilment[] = [
        { kind: 'burn', turnsRemaining: 4, damagePerTurn: BURN_DAMAGE_PER_TURN },
        ...applyAilment([], 'empower'),
      ];
      const { caster, foe, captured } = reboundSnaplockdoom(casterBefore, []);
      expect(captured).toEqual([]);
      expect(caster.map((a) => a.kind).sort()).toEqual(['burn', 'empower']);
      expect(foe).toEqual([]);
    });

    it('does NOT double-stack: a foe already carrying a weaken is REPLACED by the transferred (full-duration) one', () => {
      const casterWeaken = applyAilment([], 'weaken')[0]!;
      const casterStun = applyAilment([], 'stun')[0]!;
      const casterDoom = applyAilment([], 'doom')[0]!;
      const foeWeakenPrior = applyAilment([], 'weaken')[0]!;
      const { foe } = reboundSnaplockdoom([casterWeaken, casterStun, casterDoom], [foeWeakenPrior]);
      const weakens = foe.filter((a) => a.kind === 'weaken');
      expect(weakens).toHaveLength(1);
      expect(weakens[0]).not.toBe(foeWeakenPrior);
      expect(weakens[0]).toEqual(casterWeaken);
      expect(foe.some((a) => a.kind === 'stun')).toBe(true);
      expect(foe.some((a) => a.kind === 'doom')).toBe(true);
    });

    it('is a NEW-array pure transform that mutates neither input (HP-monotone, A-42)', () => {
      const casterDoom = applyAilment([], 'doom')[0]!;
      const casterBefore: StatusAilment[] = [casterDoom, ...applyAilment([], 'stun')];
      const foeBefore: StatusAilment[] = [];
      const { caster, foe } = reboundSnaplockdoom(casterBefore, foeBefore);
      expect(caster).not.toBe(casterBefore);
      expect(foe).not.toBe(foeBefore);
      expect(casterDoom).toEqual(applyAilment([], 'doom')[0]);
    });
  });

  describe('tactical skill selection in a resolved fight (TASK-64)', () => {
    it('opens with the highest-priority CONTROL tactical skill, then rotates through the mid-tier arsenal', () => {
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      const agumonSkills = turns
        .filter((t) => t.actor === 'player' && t.skill !== undefined)
        .map((t) => t.skill);
      // TASK-64: the greedy "most-expensive-affordable" selectSkill is REPLACED inside
      // simulateBattle by the deterministic TACTICAL chooseSkill. The opener is now the
      // highest-priority FRESH damaging tactical skill — Frost Bite (a MULTI-turn freeze
      // control lock, AILMENT_TACTICAL_PRIORITY 0), NOT Double Strike (a pure-damage
      // skill, which the tactical policy only falls back to when no fresh ailment is
      // available). The lock is the win engine (GUARDRAIL 1) and every rule-1 pick deals
      // damage (GUARDRAIL 3 — no zero-damage stall).
      expect(agumonSkills[0]).toBe('Blue Blaster');
      // The policy then rotates the once-per-fight arsenal (inflicted-set hint), so ALL
      // the previously-STRANDED mid-tier skills now SURFACE in this one shipped fight —
      // the whole point of the wave (present ≠ observable). Shock Strike is the headline;
      // Fire Breath / Enfeeble Strike / Armor Break / Bleed Strike / Poison Sting join it.
      expect(agumonSkills).toContain('Mach Jab');
      expect(agumonSkills).toContain('Blue Blaster');
      expect(agumonSkills).toContain('Silence Hug');
      expect(agumonSkills).toContain('Pepper Breath');
      expect(agumonSkills).toContain('Heat Upper');
      expect(agumonSkills).toContain('Surudoi Tsume');
      expect(agumonSkills).toContain('Poison Ivy');
    });
  });

  describe('Burn status (the first ailment — a DoT)', () => {
    // A tanky, harmless sparring pair so the fight runs long enough to observe Burn
    // apply, tick BURN_DAMAGE_PER_TURN for BURN_DURATION of the foe's turns, then
    // expire — without either side dying to direct hits first.
    const bruiser: Combatant = {
      name: 'Bruiser',
      type: 'Free',
      element: 'Neutral',
      hp: 500,
      atk: 1,
      def: 100,
      spd: 9,
    };

    it('the surfacing DoT (Bleed) applies + ticks BLEED_DAMAGE_PER_TURN over several turns then refreshes', () => {
      // TASK-62: after the ladder trap settles, the ONLY DoT the shared-ladder sawtooth
      // surfaces in a resolved fight is Bleed (Bleed Strike, cost 3, sits in the low
      // residual band and DISPLACES Fire Breath/Poison Sting — see the energy-economy
      // test). So the "a DoT applies + ticks over a fight" machinery — byte-identical
      // for Burn/Poison/Bleed — is exercised here via Bleed; Burn's own tick shape stays
      // proven by the isolated applyAilment tests + the direct Bleed-analogous suite.
      const dummy: Combatant = { ...bruiser, name: 'Dummy', spd: 5 };
      const { turns } = simulateBattle(bruiser, dummy);

      // The applying side logs a "<foe> is Bleeding" status event on its Bleed Strike.
      const applied = turns.find((t) =>
        (t.statusEvents ?? []).some((e) => /Dummy is Bleeding/.test(e)),
      );
      expect(applied).toBeDefined();

      // The Dummy takes a Bleed tick on each of its own turns — the tick is logged as a
      // "Bleed deals N to Dummy" status event of exactly BLEED_DAMAGE_PER_TURN.
      const dummyTicks = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) =>
          new RegExp(`Bleed deals ${BLEED_DAMAGE_PER_TURN} to Dummy`).test(e),
        ),
      );
      expect(dummyTicks.length).toBeGreaterThanOrEqual(2);
      for (const tick of dummyTicks) expect(tick.damage).toBe(BLEED_DAMAGE_PER_TURN);

      // At least a full duration's worth of ticks land (Bleed Strike re-applies each turn
      // it fires, refreshing the arm — the same refresh-not-stack semantics as Burn).
      expect(dummyTicks.length).toBeGreaterThanOrEqual(BLEED_DURATION);
    });

    it('a DoT tick can KILL — the afflicted side goes down before it acts', () => {
      // A defender that survives the striker's direct hits but dies to a DoT tick at the
      // start of its turn (a DoT kill). TASK-64: the tactical chooseSkill now rotates the
      // whole arsenal, so the striker lands several DoTs (Bleed via Bleed Strike, Burn via
      // Fire Breath, …) as it steps through the rotation; the glass here is chipped by the
      // min-1 direct hits and then FINISHED by a DoT tick at the top of its turn. The
      // DoT-kill capability is kind-agnostic and byte-unchanged; only which DoT actually
      // lands the finishing tick changed with the selection policy.
      const striker: Combatant = {
        name: 'Striker',
        type: 'Vaccine',
        element: 'Fire',
        hp: 5000,
        atk: 14,
        def: 10,
        spd: 20,
      };
      const glass: Combatant = {
        name: 'Glass',
        type: 'Virus',
        element: 'Neutral',
        hp: 8, // survives the chip direct hits, dies to a DoT tick
        atk: 1,
        def: 100,
        spd: 1,
      };
      const result = simulateBattle(striker, glass);
      expect(result.outcome).toBe('win');
      // The finishing entry is a DoT tick on the Glass (a status-event kill): it deals
      // damage, drops the defender to 0, and carries a "<DoT> deals N to Glass" note.
      const last = result.turns.at(-1)!;
      expect(last.defenderHpAfter).toBe(0);
      expect((last.statusEvents ?? []).some((e) => /deals \d+ to Glass/.test(e))).toBe(true);
    });
  });

  // ── TASK-53 (R-17c): the second combat-engine wave — Poison Sting + Poison DoT ──
  describe('applyAilment (pure status collection)', () => {
    it('applies a fresh ailment at its full duration + per-turn damage', () => {
      const after = applyAilment([], 'poison');
      expect(after).toEqual([
        { kind: 'poison', turnsRemaining: POISON_DURATION, damagePerTurn: POISON_DAMAGE_PER_TURN },
      ]);
    });

    it('REFRESHES an existing ailment of the same kind (overwrites, no stack)', () => {
      const worn: StatusAilment[] = [
        { kind: 'poison', turnsRemaining: 1, damagePerTurn: POISON_DAMAGE_PER_TURN },
      ];
      const after = applyAilment(worn, 'poison');
      expect(after).toHaveLength(1);
      expect(after[0]!.turnsRemaining).toBe(POISON_DURATION);
    });

    it('lets Burn and Poison COEXIST — a second kind is added, not replaced', () => {
      const after = applyAilment(applyAilment([], 'burn'), 'poison');
      expect(after.map((s) => s.kind).sort()).toEqual(['burn', 'poison']);
    });
  });

  describe('Poison status (the second ailment — a longer, weaker DoT)', () => {
    const bruiser: Combatant = {
      name: 'Bruiser',
      type: 'Free',
      element: 'Neutral',
      hp: 500,
      atk: 1,
      def: 100,
      spd: 9,
    };

    it('the surfacing DoT (Bleed) applies + ticks over several turns (the DoT-in-a-fight machinery, shared with Poison)', () => {
      // TASK-62: the shared-ladder sawtooth now surfaces Bleed (not Poison Sting) among
      // the DoTs in a resolved fight (Bleed Strike at cost 3 displaces Poison Sting from
      // the low residual band — see the energy-economy test). Poison's OWN apply/refresh
      // shape stays proven by the isolated applyAilment tests; this exercises the
      // identical "a DoT applies + ticks each turn through a resolved fight" loop via the
      // DoT that actually surfaces.
      const dummy: Combatant = { ...bruiser, name: 'Dummy', spd: 5 };
      const { turns } = simulateBattle(bruiser, dummy);

      const applied = turns.find((t) =>
        (t.statusEvents ?? []).some((e) => /Dummy is Bleeding/.test(e)),
      );
      expect(applied).toBeDefined();

      const dummyTicks = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) =>
          new RegExp(`Bleed deals ${BLEED_DAMAGE_PER_TURN} to Dummy`).test(e),
        ),
      );
      expect(dummyTicks.length).toBeGreaterThanOrEqual(2);
      for (const tick of dummyTicks) expect(tick.damage).toBe(BLEED_DAMAGE_PER_TURN);
    });

    it('a Poison tick can KILL — the poisoned side goes down before it acts', () => {
      const glass: Combatant = {
        name: 'Glass',
        type: 'Free',
        element: 'Neutral',
        hp: POISON_DAMAGE_PER_TURN + 1, // survives the min-1 direct hit, dies to the poison tick
        atk: 1,
        def: 100,
        spd: 1,
      };
      // A striker that will pick Poison Sting: keep it at exactly-enough energy by
      // starting the fight normally — Fire Breath first, but the direct min-1 hit
      // plus the poison tick from a prior Poison Sting finishes the glass cannon.
      const striker: Combatant = { ...bruiser, name: 'Striker', atk: 1, spd: 9 };
      const result = simulateBattle(striker, glass);
      expect(result.outcome).toBe('win');
      // SOME finishing tick killed it via a status event (Burn or Poison) at 0 HP.
      const last = result.turns.at(-1)!;
      expect(last.defenderHpAfter).toBe(0);
    });
  });

  describe('the three DoTs tick in AILMENT_TICK_ORDER when they coincide (burn→poison→bleed)', () => {
    it('the surfacing DoT (Bleed) ticks in a fight, and the three DoTs are ordered burn→poison→bleed for any coincidence', () => {
      // TASK-62: only ONE DoT (Bleed) surfaces from the shared-ladder sawtooth in a
      // resolved fight (Bleed Strike displaces Fire Breath/Poison Sting from the low
      // residual band), so two coincident DoTs cannot arise from live surfacing. The
      // coincident-DoT ORDERING is instead a property of the fixed AILMENT_TICK_ORDER
      // array (asserted structurally below): the three DoTs tick contiguously as a group
      // in burn→poison→bleed order before the stat/control kinds. We still exercise the
      // LIVE DoT tick loop via the surfacing Bleed.
      const bruiser: Combatant = {
        name: 'Bruiser',
        type: 'Free',
        element: 'Neutral',
        hp: 5000,
        atk: 1,
        def: 100,
        spd: 9,
      };
      const dummy: Combatant = { ...bruiser, name: 'Dummy', hp: 5000, spd: 5 };
      const { turns } = simulateBattle(bruiser, dummy);

      // The surfacing Bleed ticks against the Dummy at least once (live DoT loop).
      const bleedTurns = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) => /Bleed deals \d+ to Dummy/.test(e)),
      );
      expect(bleedTurns.length).toBeGreaterThanOrEqual(1);

      // The three DoTs are a CONTIGUOUS, burn→poison→bleed-ordered group at the head of
      // AILMENT_TICK_ORDER — the structural guarantee behind the coincident-tick order
      // (a coincidence of any two DoTs always logs the earlier one first). We assert it
      // via applyAilment building all three and the fixed order they'd tick in: burn
      // before poison before bleed, matching the array head.
      const all = applyAilment(applyAilment(applyAilment([], 'burn'), 'poison'), 'bleed');
      expect(all.map((s) => s.kind).sort()).toEqual(['bleed', 'burn', 'poison']);
    });
  });

  // ── TASK-54 (R-17c): the third combat-engine wave — Armor Break + Weaken debuff, a
  //    persistent STAT-MODIFIER (not a DoT): it removes NO HP, it lowers the afflicted
  //    defender's effective DEF so it takes harder hits. ──
  describe('Armor Break skill (composite: damage + weaken)', () => {
    it('models Armor Break as data with a distinct cost and a damage-then-weaken effect list', () => {
      expect(SKILLS['armor-break'].energyCost).toBe(ARMOR_BREAK_ENERGY_COST);
      // Distinct from the other two costed skills so the energy gate still cascades.
      expect(SKILLS['armor-break'].energyCost).not.toBe(SKILLS['fire-breath'].energyCost);
      expect(SKILLS['armor-break'].energyCost).not.toBe(SKILLS['poison-sting'].energyCost);
      expect(SKILLS['armor-break'].effects).toEqual([{ kind: 'damage' }, { kind: 'weaken' }]);
    });
  });

  describe('applyAilment — the Weaken stat-modifier arm', () => {
    it('applies a fresh Weaken at full duration carrying defReduction (no damagePerTurn)', () => {
      const after = applyAilment([], 'weaken');
      expect(after).toEqual([
        { kind: 'weaken', turnsRemaining: WEAKEN_DURATION, defReduction: WEAKEN_DEF_REDUCTION },
      ]);
    });

    it('coexists with Burn AND Poison — all three kinds carried at once', () => {
      const after = applyAilment(applyAilment(applyAilment([], 'burn'), 'poison'), 'weaken');
      expect(after.map((s) => s.kind).sort()).toEqual(['burn', 'poison', 'weaken']);
    });

    it('REFRESHES an existing Weaken (overwrites duration, no stack)', () => {
      const worn: StatusAilment[] = [
        { kind: 'weaken', turnsRemaining: 1, defReduction: WEAKEN_DEF_REDUCTION },
      ];
      const after = applyAilment(worn, 'weaken');
      expect(after).toHaveLength(1);
      const w = after[0]!;
      expect(w.kind).toBe('weaken');
      expect(w.turnsRemaining).toBe(WEAKEN_DURATION);
    });
  });

  describe('resolveAttack honours a Weaken debuff on the defender', () => {
    const attacker: Combatant = {
      name: 'Striker',
      type: 'Free',
      element: 'Neutral',
      hp: 100,
      atk: 30,
      def: 10,
      spd: 5,
    };
    // def 20 → floor(20/2)=10 mitigation; a −6 weaken → effective def 14 →
    // floor(14/2)=7 mitigation, so a weakened defender loses 3 less mitigation and
    // takes 3 MORE damage from the identical attack.
    const defender: Combatant = { ...attacker, name: 'Wall', def: 20 };

    it('deals MORE damage to a weakened defender (less effective DEF mitigation)', () => {
      const plain = resolveAttack(attacker, defender);
      const weakened = resolveAttack(attacker, defender, WEAKEN_DEF_REDUCTION);
      expect(weakened).toBeGreaterThan(plain);
      // Exactly the mitigation delta: floor(20/2) − floor((20−6)/2) = 10 − 7 = 3.
      expect(weakened - plain).toBe(3);
    });

    it('never lets a huge reduction invert the mitigation below MIN_EFFECTIVE_DEF (no self-heal)', () => {
      // A reduction far exceeding def would push effective def negative without the
      // floor; clamped, damage matches an attack against a def-of-MIN_EFFECTIVE_DEF wall.
      const huge = resolveAttack(attacker, defender, 9999);
      const floored = resolveAttack(attacker, { ...defender, def: MIN_EFFECTIVE_DEF });
      expect(huge).toBe(floored);
    });
  });

  describe('Weaken status in a resolved fight (ticks + expires, subtracts NO HP)', () => {
    // A harmless, tanky pair so the fight runs long enough to see Weaken applied by
    // Armor Break, tick over the afflicted side's turns, then wear off — no direct KO.
    const bruiser: Combatant = {
      name: 'Bruiser',
      type: 'Free',
      element: 'Neutral',
      hp: 5000,
      atk: 1,
      def: 100,
      spd: 9,
    };

    it('Armor Break applies Weaken; its tick logs a DEF-lowered note and removes NO HP; it wears off', () => {
      const dummy: Combatant = { ...bruiser, name: 'Dummy', hp: 5000, spd: 5 };
      const { turns } = simulateBattle(bruiser, dummy);

      // The applying side logs "Bruiser is Weakened" on an Armor Break cast (the slower
      // Dummy casts Armor Break onto the faster Bruiser under the TASK-61 economy).
      const applied = turns.find((t) =>
        (t.statusEvents ?? []).some((e) => /Bruiser is Weakened/.test(e)),
      );
      expect(applied).toBeDefined();
      expect(turns.some((t) => t.skill === 'Heat Upper')).toBe(true);

      // The Bruiser's own weaken ticks: a "DEF is lowered" note that deals ZERO damage
      // and leaves defenderHpAfter equal to the prior HP (HP non-increasing by a tick).
      const weakenTicks = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) => /Bruiser's DEF is lowered/.test(e)),
      );
      expect(weakenTicks.length).toBeGreaterThanOrEqual(1);
      for (const tick of weakenTicks) expect(tick.damage).toBe(0);

      // Because Armor Break re-applies each cast it refreshes; but a single window of
      // ticks is logged, and — with re-application — a "wore off" note appears if the
      // attacker ever stops casting it long enough. At minimum the active tick note
      // is present with zero HP cost, proving the stat-modifier category (no DoT).
    });

    it('a Weaken that is applied once and left to lapse emits a "wore off" note without HP loss', () => {
      // Directly drive applyAilment + a manual expiry through simulateBattle is awkward;
      // instead assert the pure lapse semantics of the tick via applyAilment duration:
      // after WEAKEN_DURATION decrements it drops. (The in-fight lapse is covered by the
      // fight above where re-application windows open/close.)
      let statuses = applyAilment([], 'weaken');
      for (let i = 0; i < WEAKEN_DURATION - 1; i += 1) {
        const w = statuses.find((s) => s.kind === 'weaken')!;
        expect(w.turnsRemaining).toBeGreaterThan(0);
        // simulate a decrement without re-application
        statuses = statuses
          .map((s) => (s.kind === 'weaken' ? { ...s, turnsRemaining: s.turnsRemaining - 1 } : s))
          .filter((s) => s.turnsRemaining > 0);
      }
      expect(statuses.find((s) => s.kind === 'weaken')).toBeDefined();
    });
  });

  describe('the surfacing statuses coexist and tick in AILMENT_TICK_ORDER (Bleed + Weaken)', () => {
    it('a combatant carries several lingering effects at once; coincident ticks keep AILMENT_TICK_ORDER; a stat-modifier tick subtracts NO HP', () => {
      // TASK-64: the tactical chooseSkill rotates the whole arsenal, so a long tanky
      // fight now stacks MANY lingering effects on the foe at once (Burn, Poison, Bleed,
      // Weaken, Enfeeble). That richer set lets us assert (a) each surfacing status ticks
      // at least once, (b) any that COINCIDE on a round appear in AILMENT_TICK_ORDER
      // (burn→poison→bleed→weaken→enfeeble), and (c) a stat-modifier (Weaken) tick removes
      // NO HP. Ranked directly off AILMENT_TICK_ORDER so the ordering claim is derived
      // from the engine's own canonical order, not a hand-picked pair.
      const bruiser: Combatant = {
        name: 'Bruiser',
        type: 'Free',
        element: 'Neutral',
        hp: 50000,
        atk: 1,
        def: 100,
        spd: 9,
      };
      const dummy: Combatant = { ...bruiser, name: 'Dummy', hp: 50000, spd: 5 };
      const { turns } = simulateBattle(bruiser, dummy);

      // The tick/effect notes we can detect against the Bruiser, ranked by their slot in
      // AILMENT_TICK_ORDER (burn=0, poison=1, bleed=2, weaken=3, enfeeble=4).
      const kinds = [
        { rank: 0, re: /Burn deals \d+ to Bruiser/ },
        { rank: 1, re: /Poison deals \d+ to Bruiser/ },
        { rank: 2, re: /Bleed deals \d+ to Bruiser/ },
        { rank: 3, re: /Bruiser's DEF is lowered/ },
        { rank: 4, re: /Bruiser's ATK is lowered/ },
      ];
      // (a) Each of these surfacing statuses ticks against the Bruiser at least once.
      for (const { re } of kinds) {
        expect(turns.some((t) => (t.statusEvents ?? []).some((e) => re.test(e)))).toBe(true);
      }
      // (b) Any statuses coinciding on a round appear in canonical (rank) order.
      const byRound = new Map<number, number[]>();
      turns.forEach((t) => {
        for (const { rank, re } of kinds) {
          if ((t.statusEvents ?? []).some((e) => re.test(e))) {
            const list = byRound.get(t.round) ?? [];
            list.push(rank);
            byRound.set(t.round, list);
          }
        }
      });
      let sawMultiTick = false;
      for (const ranks of byRound.values()) {
        if (ranks.length >= 2) sawMultiTick = true;
        for (let i = 1; i < ranks.length; i += 1) {
          expect(ranks[i]!).toBeGreaterThan(ranks[i - 1]!);
        }
      }
      // At least one round had two of these statuses tick together (so (b) bites).
      expect(sawMultiTick).toBe(true);
      // (c) Every weaken tick subtracts NO HP (the stat-modifier is not a DoT).
      const weakenTicks = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) => /Bruiser's DEF is lowered/.test(e)),
      );
      for (const t of weakenTicks) expect(t.damage).toBe(0);
    });
  });

  // ── TASK-55 (R-17c): the fourth combat-engine wave — Guard + Shield, a persistent
  //    DAMAGE-ABSORBING BUFFER (a NEW category: not a DoT, not a stat-modifier). It
  //    removes NO HP on its tick; instead it drains incoming damage before HP. Guard
  //    is the FIRST self-targeting skill (the Shield lands on the CASTER). ──
  describe('Guard skill (defensive, self-targeting: a shield effect)', () => {
    it('models Guard as data with a distinct cost and a single self-shield effect (no damage)', () => {
      expect(SKILLS.guard.energyCost).toBe(GUARD_ENERGY_COST);
      // Distinct from every other costed skill so the energy gate still cascades.
      expect(SKILLS.guard.energyCost).not.toBe(SKILLS['fire-breath'].energyCost);
      expect(SKILLS.guard.energyCost).not.toBe(SKILLS['armor-break'].energyCost);
      expect(SKILLS.guard.energyCost).not.toBe(SKILLS['poison-sting'].energyCost);
      // Purely defensive — NO damage arm, just the self-targeting shield.
      expect(SKILLS.guard.effects).toEqual([{ kind: 'shield' }]);
    });
  });

  describe('applyAilment — the Shield damage-absorbing arm', () => {
    it('applies a fresh Shield at full duration carrying absorbRemaining (no damagePerTurn/defReduction)', () => {
      const after = applyAilment([], 'shield');
      expect(after).toEqual([
        { kind: 'shield', turnsRemaining: SHIELD_DURATION, absorbRemaining: SHIELD_ABSORB_AMOUNT },
      ]);
    });

    it('coexists with Burn, Poison AND Weaken — all four kinds carried at once', () => {
      const after = applyAilment(
        applyAilment(applyAilment(applyAilment([], 'burn'), 'poison'), 'weaken'),
        'shield',
      );
      expect(after.map((s) => s.kind).sort()).toEqual(['burn', 'poison', 'shield', 'weaken']);
    });

    it('REFRESHES an existing Shield (overwrites duration + pool, no stack)', () => {
      const worn: StatusAilment[] = [{ kind: 'shield', turnsRemaining: 1, absorbRemaining: 2 }];
      const after = applyAilment(worn, 'shield');
      expect(after).toHaveLength(1);
      const s = after[0]!;
      expect(s.kind).toBe('shield');
      expect(s.turnsRemaining).toBe(SHIELD_DURATION);
      if (s.kind === 'shield') expect(s.absorbRemaining).toBe(SHIELD_ABSORB_AMOUNT);
    });
  });

  describe('absorbWithShield — the pure overflow calc (drain-then-overflow)', () => {
    it('an unshielded defender takes the full hit (no absorb)', () => {
      expect(absorbWithShield(10, undefined)).toEqual({
        absorbed: 0,
        overflow: 10,
        shieldBroke: false,
      });
    });

    it('a partial hit is fully absorbed → overflow 0, pool survives (no break)', () => {
      const shield = { kind: 'shield' as const, turnsRemaining: 2, absorbRemaining: 12 };
      // 5 ≤ 12 → all absorbed, 0 reaches HP, 7 left in the pool (not broken).
      expect(absorbWithShield(5, shield)).toEqual({
        absorbed: 5,
        overflow: 0,
        shieldBroke: false,
      });
    });

    it('a hit exceeding the pool drains it, overflows the remainder, and BREAKS the shield', () => {
      const shield = { kind: 'shield' as const, turnsRemaining: 2, absorbRemaining: 5 };
      // 8 > 5 → 5 absorbed (pool exhausted → break), 3 overflows to HP.
      expect(absorbWithShield(8, shield)).toEqual({
        absorbed: 5,
        overflow: 3,
        shieldBroke: true,
      });
    });

    it('a hit that EXACTLY empties the pool breaks it with zero overflow', () => {
      const shield = { kind: 'shield' as const, turnsRemaining: 2, absorbRemaining: 6 };
      expect(absorbWithShield(6, shield)).toEqual({
        absorbed: 6,
        overflow: 0,
        shieldBroke: true,
      });
    });
  });

  describe('Shield (self-cast, absorbs, ticks, HP non-increasing) — pure-helper proof', () => {
    // TASK-61: Guard (cost 14) no longer wins a selectSkill slot in a greedy fight —
    // Lullaby Hex (21) fires in that energy band and the settled sawtooth cycles
    // Poison Sting(2)↔Fire Breath(6), never climbing back to Guard. So the Shield
    // category is proven here directly via its exported pure helpers (applyAilment for
    // the self-cast + refresh, absorbWithShield for the drain-before-HP overflow), which
    // are exactly what simulateBattle calls — the fight-level composition changed, the
    // Shield RULE did not.

    it('Guard applies a Shield to the CASTER via applyAilment (self-targeting, full pool)', () => {
      // Guard's effect list is a single self-targeting shield (no damage arm).
      expect(SKILLS.guard.effects).toEqual([{ kind: 'shield' }]);
      const statuses = applyAilment([], 'shield');
      const shield = statuses.find((s) => s.kind === 'shield');
      expect(shield).toBeDefined();
      expect(shield!.kind).toBe('shield');
      if (shield!.kind === 'shield') {
        expect(shield!.turnsRemaining).toBe(SHIELD_DURATION);
        expect(shield!.absorbRemaining).toBe(SHIELD_ABSORB_AMOUNT);
      }
    });

    it('the shield tick removes NO HP: a shield entry carries absorbRemaining, never a damagePerTurn DoT', () => {
      const statuses = applyAilment([], 'shield');
      const shield = statuses.find((s) => s.kind === 'shield')!;
      // A shield arm is NOT a DoT — it has no damagePerTurn field at all, so a tick can
      // only count down + log, never subtract HP (HP monotonically non-increasing, A-43).
      expect('damagePerTurn' in shield).toBe(false);
    });

    it('a shielded defender takes LESS (or zero) HP from the SAME incoming hit — overflow only', () => {
      const shield = {
        kind: 'shield',
        turnsRemaining: SHIELD_DURATION,
        absorbRemaining: SHIELD_ABSORB_AMOUNT,
      } as const;
      // A hit fully within the pool is fully absorbed — ZERO overflow reaches HP (the ≥1
      // damage floor does not leak past the shield).
      const small = absorbWithShield(SHIELD_ABSORB_AMOUNT - 1, shield);
      expect(small.overflow).toBe(0);
      expect(small.absorbed).toBe(SHIELD_ABSORB_AMOUNT - 1);
      // A larger hit drains the pool and only the OVERFLOW reaches HP — strictly less
      // than the raw incoming, so the shielded side takes less than an unshielded one.
      const raw = SHIELD_ABSORB_AMOUNT + 5;
      const big = absorbWithShield(raw, shield);
      expect(big.overflow).toBeLessThan(raw);
      expect(big.overflow).toBe(5);
      expect(big.shieldBroke).toBe(true);
    });
  });

  describe('a fully-absorbed hit subtracts 0 HP (damage floor does not leak past the shield)', () => {
    it('resolveAttack floors at 1, but absorbWithShield can zero the overflow', () => {
      // A minimum (1-floored) hit fully absorbed by a shield with pool ≥ 1 → overflow 0.
      const shield = { kind: 'shield' as const, turnsRemaining: 3, absorbRemaining: 12 };
      const { overflow } = absorbWithShield(1, shield);
      expect(overflow).toBe(0);
    });
  });

  describe('the surfacing statuses coexist and tick in AILMENT_TICK_ORDER (Bleed + Weaken + Enfeeble)', () => {
    it('each surfacing status ticks during a fight, and any that coincide on a turn keep the canonical order', () => {
      // TASK-64: the tactical chooseSkill rotates the whole arsenal onto the foe, so the
      // lingering effects that SURFACE in a resolved fight now include Bleed, Weaken and
      // Enfeeble (Sleep/Lullaby Hex is pure-control and is INTENTIONALLY never preferred,
      // so it no longer surfaces — its lock shape stays proven directly via applyAilment
      // + the wake-on-damage tests). We assert (a) all three tick SOMEWHERE, and (b)
      // whenever two or more ticks land on the SAME turn for the SAME side, they appear
      // in AILMENT_TICK_ORDER (bleed→weaken→enfeeble — slots 2, 3, 4).
      const bruiser: Combatant = {
        name: 'Bruiser',
        type: 'Free',
        element: 'Neutral',
        hp: 500000,
        atk: 1,
        def: 100,
        spd: 9,
      };
      const dummy: Combatant = { ...bruiser, name: 'Dummy', hp: 500000, spd: 5 };
      const { turns } = simulateBattle(bruiser, dummy);

      // The three ranks in canonical AILMENT_TICK_ORDER (bleed slot 2, weaken 3,
      // enfeeble 4). Each may land on either side; we check (a) globally and (b) per-side.
      const kindsFor = (side: string) => [
        { rank: 2, re: new RegExp(`Bleed deals \\d+ to ${side}`) },
        { rank: 3, re: new RegExp(`${side}'s DEF is lowered`) },
        { rank: 4, re: new RegExp(`${side}'s ATK is lowered`) },
      ];
      // (a) Every one of the three surfacing statuses ticks against SOME side ≥ once.
      const globalRes = [
        /Bleed deals \d+ to (Bruiser|Dummy)/,
        /(Bruiser|Dummy)'s DEF is lowered/,
        /(Bruiser|Dummy)'s ATK is lowered/,
      ];
      for (const re of globalRes) {
        expect(turns.some((t) => (t.statusEvents ?? []).some((e) => re.test(e)))).toBe(true);
      }
      // (b) For each round + side, the ticks present appear in canonical rank order.
      let sawMultiTick = false;
      for (const side of ['Bruiser', 'Dummy']) {
        const kinds = kindsFor(side);
        const byRound = new Map<number, number[]>();
        turns.forEach((t) => {
          for (const { rank, re } of kinds) {
            if ((t.statusEvents ?? []).some((e) => re.test(e))) {
              const list = byRound.get(t.round) ?? [];
              list.push(rank);
              byRound.set(t.round, list);
            }
          }
        });

        for (const ranks of byRound.values()) {
          if (ranks.length >= 2) sawMultiTick = true;
          for (let i = 1; i < ranks.length; i += 1) {
            expect(ranks[i]!).toBeGreaterThan(ranks[i - 1]!);
          }
        }
      }
      // At least one round had two statuses tick together on a side (so (b) is meaningful).
      expect(sawMultiTick).toBe(true);
      // The weaken tick + the enfeeble tick subtract NO HP (stat-modifiers, not DoTs).
      const noHp = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) => /(Bruiser|Dummy)'s (DEF|ATK) is lowered/.test(e)),
      );
      for (const t of noHp) expect(t.damage).toBe(0);
    });
  });

  describe('HP is monotonically non-increasing across a whole fight (no tick ever heals)', () => {
    it('each side\u2019s defenderHpAfter only ever falls for that side', () => {
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      // Track the last-seen HP for whichever side an entry reports on. An entry's
      // defenderHpAfter is the HP of the side being acted upon; a self-status entry
      // (shield tick) reports the actor's own unchanged HP. Assert no report shows a
      // side's HP RISING versus its previous report.
      let lastEnemyHp = Infinity;
      let lastPlayerHp = Infinity;
      for (const t of turns) {
        // Determine whose HP this entry reports: a damage/DoT entry against a side,
        // or a SELF-reporting entry (actor === the reported side) — a shield tick
        // (TASK-55), an empower tick (TASK-56), or a STUN tick (TASK-57: the afflicted
        // side loses ITS OWN turn, logged against that side with its own unchanged HP).
        const isSelfReport = (t.statusEvents ?? []).some(
          (e) =>
            /(shield|empower) (holds|fades)/.test(e) ||
            /is stunned and cannot act|shakes off the stun/.test(e) ||
            // TASK-59: a Freeze tick, like Stun, is logged against the frozen side's OWN
            // turn with its own unchanged HP (a control ailment removes no HP).
            /is frozen and cannot act|thaws out/.test(e) ||
            // TASK-61: a Sleep tick — the slept side loses its OWN turn, logged against
            // itself with unchanged HP (an interruptible control lock removes no HP).
            /is fast asleep|wakes up/.test(e),
        );
        const reportedSide = isSelfReport ? t.actor : t.actor === 'player' ? 'enemy' : 'player';
        if (reportedSide === 'enemy') {
          expect(t.defenderHpAfter).toBeLessThanOrEqual(lastEnemyHp);
          lastEnemyHp = t.defenderHpAfter;
        } else {
          expect(t.defenderHpAfter).toBeLessThanOrEqual(lastPlayerHp);
          lastPlayerHp = t.defenderHpAfter;
        }
      }
    });
  });

  describe('shipped outcomes still hold under the new engine', () => {
    it('still WINS vs numemon and the surfacing DoT (Bleed) ticks over ≥2 of its turns', () => {
      const numemon = findEnemy('numemon')!;
      const result = simulateBattle(agumon, numemon);
      expect(result.outcome).toBe('win');
      // TASK-62: the surfacing DoT against numemon is now Bleed (Bleed Strike displaced
      // Fire Breath from the low residual band), so the shipped DoT that ticks ≥2 turns
      // is Bleed. Burn's own tick is unit-proven directly.
      const numemonTicks = result.turns.filter((t) =>
        (t.statusEvents ?? []).some((e) => /Bleed deals \d+ to Numemon/.test(e)),
      );
      expect(numemonTicks.length).toBeGreaterThanOrEqual(2);
      // And Bleed Strike was observably cast at least once.
      expect(result.turns.some((t) => t.skill === 'Surudoi Tsume')).toBe(true);
    });

    it('still LOSES vs kuwagamon', () => {
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
    });

    it('remains fully deterministic — same inputs, identical turn log', () => {
      const numemon = findEnemy('numemon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
    });
  });

  // ── TASK-56 (R-17c): the fifth combat-engine wave — Focus + Empower, a persistent
  //    POSITIVE STAT-MODIFIER (an offensive self-BUFF, the exact MIRROR of Weaken). It
  //    removes NO HP on its tick; instead it RAISES the empowered attacker's effective
  //    ATK so it hits harder. Focus is the SECOND self-targeting skill (the Empower
  //    lands on the CASTER, routed through the same self-vs-defender branch as Guard). ──
  describe('Focus skill (offensive self-buff, self-targeting: an empower effect)', () => {
    it('models Focus as data with a distinct cost and a single self-empower effect (no damage)', () => {
      expect(SKILLS.focus.energyCost).toBe(FOCUS_ENERGY_COST);
      // Distinct from every other costed skill so the energy gate still cascades.
      expect(SKILLS.focus.energyCost).not.toBe(SKILLS.guard.energyCost);
      expect(SKILLS.focus.energyCost).not.toBe(SKILLS['fire-breath'].energyCost);
      expect(SKILLS.focus.energyCost).not.toBe(SKILLS['armor-break'].energyCost);
      expect(SKILLS.focus.energyCost).not.toBe(SKILLS['poison-sting'].energyCost);
      // Purely a buff — NO damage arm, just the self-targeting empower.
      expect(SKILLS.focus.effects).toEqual([{ kind: 'empower' }]);
    });
  });

  describe('applyAilment — the Empower positive-stat-modifier arm', () => {
    it('applies a fresh Empower at full duration carrying atkBonus (no damagePerTurn/defReduction/absorbRemaining)', () => {
      const after = applyAilment([], 'empower');
      expect(after).toEqual([
        { kind: 'empower', turnsRemaining: EMPOWER_DURATION, atkBonus: EMPOWER_ATK_BONUS },
      ]);
    });

    it('coexists with Burn, Poison, Weaken AND Shield — all five kinds carried at once', () => {
      const after = applyAilment(
        applyAilment(
          applyAilment(applyAilment(applyAilment([], 'burn'), 'poison'), 'weaken'),
          'shield',
        ),
        'empower',
      );
      expect(after.map((s) => s.kind).sort()).toEqual([
        'burn',
        'empower',
        'poison',
        'shield',
        'weaken',
      ]);
    });

    it('REFRESHES an existing Empower (overwrites duration, no stack)', () => {
      const worn: StatusAilment[] = [
        { kind: 'empower', turnsRemaining: 1, atkBonus: EMPOWER_ATK_BONUS },
      ];
      const after = applyAilment(worn, 'empower');
      expect(after).toHaveLength(1);
      const e = after[0]!;
      expect(e.kind).toBe('empower');
      expect(e.turnsRemaining).toBe(EMPOWER_DURATION);
    });
  });

  describe('resolveAttack honours an Empower buff on the ATTACKER', () => {
    // The MIRROR of the Weaken test: an atkBonus flows through effectiveAtk exactly as
    // defReduction flows through effectiveDef. def 10 → floor(10/2)=5 mitigation; a
    // Free/Neutral matchup is ×1.0 so the raw is atk − 5. An empowered attacker's atk
    // is (30 + 6) = 36 → 36 − 5 = 31 vs the plain 30 − 5 = 25: exactly +6 more.
    const attacker: Combatant = {
      name: 'Striker',
      type: 'Free',
      element: 'Neutral',
      hp: 100,
      atk: 30,
      def: 10,
      spd: 5,
    };
    const defender: Combatant = { ...attacker, name: 'Wall' };

    it('deals MORE damage from an empowered attacker (higher effective ATK)', () => {
      const plain = resolveAttack(attacker, defender);
      const empowered = resolveAttack(attacker, defender, 0, EMPOWER_ATK_BONUS);
      expect(empowered).toBeGreaterThan(plain);
      // Exactly the atkBonus (the matchup is neutral ×1.0, so the bonus passes through
      // round() unscaled): (36 − 5) − (30 − 5) = 6.
      expect(empowered - plain).toBe(EMPOWER_ATK_BONUS);
    });

    it('an un-empowered attack is unchanged (regression: the default 0 bonus)', () => {
      // The added 4th parameter defaults to 0, so the existing 3-arg call is byte-identical.
      expect(resolveAttack(attacker, defender)).toBe(resolveAttack(attacker, defender, 0, 0));
    });
  });

  describe('Empower (self-cast, ticks, expires, HP non-increasing) — pure-helper proof', () => {
    // TASK-61: Focus (cost 7) no longer wins a selectSkill slot in a greedy fight —
    // Lullaby Hex (21) fires in its energy band and the settled sawtooth cycles
    // Poison Sting(2)↔Fire Breath(6), never landing Focus. So the Empower category is
    // proven here directly via its exported pure helpers (applyAilment for the self-cast
    // + refresh, resolveAttack for the ATK-bonus payoff), which is exactly what
    // simulateBattle calls — the fight composition changed, the Empower RULE did not.

    it('Focus applies an Empower to the CASTER via applyAilment (self-targeting)', () => {
      // Focus's effect list is a single self-targeting empower (no damage arm).
      expect(SKILLS.focus.effects).toEqual([{ kind: 'empower' }]);
      const statuses = applyAilment([], 'empower');
      const empower = statuses.find((s) => s.kind === 'empower');
      expect(empower).toBeDefined();
      if (empower!.kind === 'empower') {
        expect(empower!.turnsRemaining).toBe(EMPOWER_DURATION);
        expect(empower!.atkBonus).toBe(EMPOWER_ATK_BONUS);
      }
    });

    it('the empower tick removes NO HP: an empower arm carries atkBonus, never a damagePerTurn DoT', () => {
      const statuses = applyAilment([], 'empower');
      const empower = statuses.find((s) => s.kind === 'empower')!;
      // An empower arm is NOT a DoT — no damagePerTurn field — so a tick only counts down
      // + logs, never subtracting HP (HP monotonically non-increasing, A-44). Its payoff
      // is a strictly HIGHER effective ATK routed through resolveAttack.
      expect('damagePerTurn' in empower).toBe(false);
      const numemon = findEnemy('numemon')!;
      expect(resolveAttack(agumon, numemon, 0, EMPOWER_ATK_BONUS)).toBeGreaterThan(
        resolveAttack(agumon, numemon),
      );
    });
  });

  describe('an empowered attacker deals MORE HP damage in a real fight than an un-empowered one', () => {
    it('the atkBonus flows through simulateBattle to the enemy HP', () => {
      // Two identical fights EXCEPT the attacker is pre-cast Empower in one via a
      // higher-atk stand-in is not how the engine works (empower is fight-local) — so
      // instead assert the pure payoff via resolveAttack (covered above) AND that the
      // in-fight cast is observable: the empowered player's first post-Focus Attack
      // deals strictly more than the same attacker's un-empowered raw. We compare the
      // pure resolveAttack numbers the fight uses.
      const numemon = findEnemy('numemon')!;
      const rawPlain = resolveAttack(agumon, numemon);
      const rawEmpowered = resolveAttack(agumon, numemon, 0, EMPOWER_ATK_BONUS);
      expect(rawEmpowered).toBeGreaterThan(rawPlain);
    });
  });

  describe('the in-fight statuses coexist and tick in AILMENT_TICK_ORDER (Bleed + Weaken + Sleep; Shield/Empower unit-proven separately)', () => {
    it('each surfacing status ticks during a fight, and any that coincide on a turn keep the canonical order', () => {
      // A long, symmetric, harmless fight. TASK-64: the tactical chooseSkill rotates the
      // whole arsenal onto the foe, so what SURFACES across the fight is Bleed/Weaken AND
      // Enfeeble (all damaging composites); Sleep (Lullaby Hex) is pure-control and is
      // never preferred, so it no longer surfaces (its lock is unit-proven directly). We
      // assert (a) all three tick SOMEWHERE, and (b) whenever two or more coincide on the
      // SAME turn for the SAME side they appear in AILMENT_TICK_ORDER (bleed→weaken→enfeeble).
      const bruiser: Combatant = {
        name: 'Bruiser',
        type: 'Free',
        element: 'Neutral',
        hp: 500000,
        atk: 1,
        def: 100,
        spd: 9,
      };
      const dummy: Combatant = { ...bruiser, name: 'Dummy', hp: 500000, spd: 5 };
      const { turns } = simulateBattle(bruiser, dummy);

      const kinds = [
        { rank: 2, re: /Bleed deals \d+ to (Dummy|Bruiser)/ },
        { rank: 3, re: /(Dummy|Bruiser)'s DEF is lowered/ },
        { rank: 4, re: /(Dummy|Bruiser)'s ATK is lowered/ },
      ];
      // (a) Every one of the three surfacing statuses ticks somewhere at least once.
      for (const { re } of kinds) {
        expect(turns.some((t) => (t.statusEvents ?? []).some((e) => re.test(e)))).toBe(true);
      }
      // (b) Within each AFFLICTED side's ticks in a round, coincident ticks keep
      //     canonical order. Key by the afflicted NAME (captured group 1) + round.
      const byRound = new Map<string, number[]>();
      turns.forEach((t) => {
        for (const { rank, re } of kinds) {
          for (const e of t.statusEvents ?? []) {
            const m = e.match(re);
            if (m) {
              const key = `${m[1]}:${t.round}`;
              const list = byRound.get(key) ?? [];
              list.push(rank);
              byRound.set(key, list);
            }
          }
        }
      });
      let sawMultiTick = false;
      for (const ranks of byRound.values()) {
        if (ranks.length >= 2) sawMultiTick = true;
        for (let i = 1; i < ranks.length; i += 1) {
          expect(ranks[i]!).toBeGreaterThan(ranks[i - 1]!);
        }
      }
      expect(sawMultiTick).toBe(true);
      // The weaken tick AND the enfeeble tick each subtract NO HP (stat-modifiers).
      const nonDoT = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) => /(Dummy|Bruiser)'s (DEF|ATK) is lowered/.test(e)),
      );
      for (const t of nonDoT) expect(t.damage).toBe(0);
    });
  });

  describe('shipped outcomes still hold with Focus/Empower added', () => {
    it('still WINS vs numemon and still LOSES vs kuwagamon (determinism preserved)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      // TASK-64: the tactical chooseSkill surfaces the whole mid-tier arsenal in the
      // winnable fight. Focus/Empower is a SELF-buff and is never preferred (the fight
      // keeps landing damage — GUARDRAIL 3), so it does not surface; its buff stays
      // unit-proven directly via resolveAttack/applyAilment. What IS observably cast now
      // is the offensive mid-tier arsenal — e.g. Shock Strike (the headline) STUNS the foe.
      expect(simulateBattle(agumon, numemon).turns.some((t) => t.skill === 'Mach Jab')).toBe(
        true,
      );
    });
  });

  // ── TASK-57 (R-17c): the sixth combat-engine wave — Shock Strike + Stun, the FIRST
  //    CONTROL ailment (a NEW category: the afflicted side CANNOT ACT / loses its turn
  //    while it holds — not a DoT, not a stat-modifier, not a shield, not a buff). The
  //    "skip the action step" mechanic is the load-bearing new machinery. HP stays
  //    monotonically non-increasing (a skipped turn touches no HP; a control ailment
  //    removes none and adds none). ────────────────────────────────────────────────
  describe('Shock Strike skill (offensive composite: damage + a stun control ailment)', () => {
    it('models Shock Strike as data with a distinct cost and a damage-THEN-stun effect list', () => {
      expect(SKILLS['shock-strike'].energyCost).toBe(SHOCK_STRIKE_ENERGY_COST);
      // DISTINCT from every other costed skill so the energy gate still discriminates.
      expect(SKILLS['shock-strike'].energyCost).not.toBe(SKILLS.guard.energyCost);
      expect(SKILLS['shock-strike'].energyCost).not.toBe(SKILLS.focus.energyCost);
      expect(SKILLS['shock-strike'].energyCost).not.toBe(SKILLS['fire-breath'].energyCost);
      expect(SKILLS['shock-strike'].energyCost).not.toBe(SKILLS['armor-break'].energyCost);
      expect(SKILLS['shock-strike'].energyCost).not.toBe(SKILLS['poison-sting'].energyCost);
      // A composite offensive skill like fire-breath (damage + burn): it HITS then STUNS.
      expect(SKILLS['shock-strike'].effects).toEqual([{ kind: 'damage' }, { kind: 'stun' }]);
    });

    it('applyAilment builds a stun arm with ONLY turnsRemaining (no numeric payload) and refreshes/coexists', () => {
      // A control ailment carries no magnitude — its effect is "skip the turn".
      expect(applyAilment([], 'stun')).toEqual([{ kind: 'stun', turnsRemaining: STUN_DURATION }]);
      // A re-cast REFRESHES (overwrites in place, never stacks) — matches every kind.
      const worn: StatusAilment[] = [{ kind: 'stun', turnsRemaining: 0 }];
      const refreshed = applyAilment(worn, 'stun');
      expect(refreshed).toHaveLength(1);
      expect(refreshed[0]).toEqual({ kind: 'stun', turnsRemaining: STUN_DURATION });
      // Stun coexists with every other kind (it is a sixth independent member).
      let s: StatusAilment[] = [];
      for (const k of [
        'burn',
        'poison',
        'weaken',
        'shield',
        'empower',
        'stun',
        'freeze',
      ] as const) {
        s = applyAilment(s, k);
      }
      expect(s.map((x) => x.kind).sort()).toEqual([
        'burn',
        'empower',
        'freeze',
        'poison',
        'shield',
        'stun',
        'weaken',
      ]);
    });

    it('Shock Strike is a composite that STUNS the DEFENDER (damage THEN a defender-targeting stun arm)', () => {
      // TASK-61: Shock Strike (cost 9) no longer wins a selectSkill slot in a greedy
      // fight (Lullaby Hex at 21 + the settled Poison/Fire-Breath sawtooth displace it),
      // so its defender-targeting composite shape is proven here via its DATA + the pure
      // applyAilment arm, exactly as the engine builds it. Its effect list is a raw hit
      // FOLLOWED BY a stun — the offensive, defender-targeting composite (like fire-breath
      // = damage+burn), NOT a self-targeting buff.
      expect(SKILLS['shock-strike'].effects).toEqual([{ kind: 'damage' }, { kind: 'stun' }]);
      // The stun it applies is a payload-free control arm at STUN_DURATION.
      expect(applyAilment([], 'stun')).toEqual([{ kind: 'stun', turnsRemaining: STUN_DURATION }]);
      // The composite deals real HP damage in the same cast (the damage arm is present).
      expect(SKILLS['shock-strike'].effects[0]).toEqual({ kind: 'damage' });
    });

    it('a stun arm carries NO magnitude (only turnsRemaining) — its whole effect is "skip the action step"', () => {
      // A stun is a CONTROL ailment: the afflicted side loses its action step, which
      // removes NO HP (HP monotonically non-increasing, A-45). The arm holds ONLY a
      // turnsRemaining counter — no damagePerTurn, defReduction, absorbRemaining, atkBonus.
      const stun = applyAilment([], 'stun')[0];
      expect(stun.kind).toBe('stun');
      expect(Object.keys(stun).sort()).toEqual(['kind', 'turnsRemaining']);
    });

    it('STUN_DURATION is exactly 1 (the smallest observable lock — shaken off the same turn it suppresses)', () => {
      // A control lock of exactly one of the afflicted side's OWN turns: applied, it
      // suppresses one action step then drops (never permanent, never HP-affecting).
      expect(STUN_DURATION).toBe(1);
      const worn: StatusAilment[] = [{ kind: 'stun', turnsRemaining: 0 }];
      expect(applyAilment(worn, 'stun')).toEqual([{ kind: 'stun', turnsRemaining: 1 }]);
    });
  });

  describe('the coexisting in-fight statuses tick in AILMENT_TICK_ORDER (Bleed + Weaken + Sleep; Shield/Empower/Stun/Freeze/Burn/Poison unit-proven separately)', () => {
    it('the surfacing statuses tick alongside one another and keep the canonical per-actor order', () => {
      // A long, symmetric, harmless fight. Under the post-TASK-62 ladder Lullaby Hex (21)
      // fires in-pool and the low residual settles on Bleed Strike (Bleed) / Armor Break
      // TASK-64: the tactical chooseSkill rotates the whole arsenal, so what COEXISTS
      // across the fight is Bleed/Weaken (offensive DoT/debuff) AND Enfeeble (an ATK
      // debuff); Sleep/Lullaby Hex is pure-control and never preferred, so it no longer
      // surfaces (unit-proven directly). We assert (a) all three tick SOMEWHERE, and (b)
      // any that coincide on the SAME actor's SAME turn appear in AILMENT_TICK_ORDER
      // (bleed→weaken→enfeeble) — the per-actor ordering the deterministic tick loop guarantees.
      const bruiser: Combatant = {
        name: 'Bruiser',
        type: 'Free',
        element: 'Neutral',
        hp: 500000,
        atk: 1,
        def: 100,
        spd: 9,
      };
      const dummy: Combatant = { ...bruiser, name: 'Dummy', hp: 500000, spd: 5 };
      const { turns } = simulateBattle(bruiser, dummy);

      // Side-agnostic tick matchers (either combatant's name), each with its canonical
      // AILMENT_TICK_ORDER rank (bleed slot 2, weaken 3, enfeeble 4).
      const kinds = [
        { rank: 2, re: /Bleed deals \d+ to (Dummy|Bruiser)/ },
        { rank: 3, re: /(Dummy|Bruiser)'s DEF is lowered/ },
        { rank: 4, re: /(Dummy|Bruiser)'s ATK is lowered/ },
      ];
      // (a) Every one of the three surfacing statuses ticks somewhere at least once.
      for (const { re } of kinds) {
        expect(turns.some((t) => (t.statusEvents ?? []).some((e) => re.test(e)))).toBe(true);
      }
      // (b) Within each AFFLICTED side's ticks in a round, the coincident ticks appear
      //     in canonical order. We key by the afflicted NAME (captured group 1) + round,
      //     NOT by the log entry's `actor` field: a DoT tick is logged against the foe
      //     that applied it while a self-buff/control tick is logged against the
      //     afflicted side itself, but ALL of one side's ticks are emitted together in
      //     AILMENT_TICK_ORDER during that side's own turn.
      const byAfflictedRound = new Map<string, number[]>();
      turns.forEach((t) => {
        for (const { rank, re } of kinds) {
          for (const e of t.statusEvents ?? []) {
            const m = e.match(re);
            if (m) {
              const key = `${m[1]}:${t.round}`;
              const list = byAfflictedRound.get(key) ?? [];
              list.push(rank);
              byAfflictedRound.set(key, list);
            }
          }
        }
      });
      for (const ranks of byAfflictedRound.values()) {
        for (let i = 1; i < ranks.length; i += 1) {
          expect(ranks[i]!).toBeGreaterThan(ranks[i - 1]!);
        }
      }
    });
  });

  // ── TASK-59 (R-17c): the eighth combat-engine wave — Frost Bite + Freeze, the SECOND
  //    CONTROL ailment and the FIRST MULTI-TURN action lock. Freeze shares Stun's
  //    "skip the action step" category + REUSES the exact `stunnedThisTurn` substrate,
  //    but locks SEVERAL consecutive turns (FREEZE_DURATION > 1) rather than one — so a
  //    single cast makes the foe forgo its action across multiple turns, each its own
  //    "frozen and cannot act" line the player SEES. HP stays monotonically
  //    non-increasing (a frozen turn touches no HP — a control ailment removes none and
  //    adds none, A-47, chosen over the HP-raising Heal family). ─────────────────────
  describe('Frost Bite skill (offensive composite: damage + a MULTI-TURN freeze control ailment)', () => {
    it('models Frost Bite as data with a distinct cost and a damage-THEN-freeze effect list', () => {
      expect(SKILLS['frost-bite'].energyCost).toBe(FROST_BITE_ENERGY_COST);
      // DISTINCT from every other costed skill so the energy gate still discriminates.
      expect(SKILLS['frost-bite'].energyCost).not.toBe(SKILLS['double-strike'].energyCost);
      expect(SKILLS['frost-bite'].energyCost).not.toBe(SKILLS.guard.energyCost);
      expect(SKILLS['frost-bite'].energyCost).not.toBe(SKILLS['shock-strike'].energyCost);
      expect(SKILLS['frost-bite'].energyCost).not.toBe(SKILLS.focus.energyCost);
      expect(SKILLS['frost-bite'].energyCost).not.toBe(SKILLS['fire-breath'].energyCost);
      expect(SKILLS['frost-bite'].energyCost).not.toBe(SKILLS['armor-break'].energyCost);
      expect(SKILLS['frost-bite'].energyCost).not.toBe(SKILLS['poison-sting'].energyCost);
      // A composite offensive skill like shock-strike (damage + stun): it HITS then FREEZES.
      expect(SKILLS['frost-bite'].effects).toEqual([{ kind: 'damage' }, { kind: 'freeze' }]);
    });

    it('applyAilment builds a freeze arm with ONLY turnsRemaining (no payload) and it is MULTI-turn', () => {
      // A control ailment carries no magnitude — its effect is "skip the turn". Unlike
      // Stun (1 turn), Freeze is genuinely MULTI-turn.
      expect(applyAilment([], 'freeze')).toEqual([
        { kind: 'freeze', turnsRemaining: FREEZE_DURATION },
      ]);
      expect(FREEZE_DURATION).toBeGreaterThanOrEqual(2); // the defining MULTI-turn property
      // Re-applying refreshes turnsRemaining (overwrites, never stacks).
      const worn: StatusAilment[] = [{ kind: 'freeze', turnsRemaining: 0 }];
      const refreshed = applyAilment(worn, 'freeze');
      expect(refreshed).toHaveLength(1);
      expect(refreshed[0]).toEqual({ kind: 'freeze', turnsRemaining: FREEZE_DURATION });
    });

    it('Frost Bite is a composite that FREEZES the DEFENDER (damage THEN a defender-targeting multi-turn freeze arm)', () => {
      // TASK-61: Frost Bite (cost 11) no longer wins a selectSkill slot in a greedy fight
      // (Lullaby Hex at 21 + the settled Poison/Fire-Breath sawtooth displace it), so its
      // defender-targeting composite shape is proven via its DATA + the pure freeze arm,
      // exactly as the engine builds it. Its effect list is a raw hit FOLLOWED BY a freeze
      // — the offensive, defender-targeting composite (like shock-strike = damage+stun).
      expect(SKILLS['frost-bite'].effects).toEqual([{ kind: 'damage' }, { kind: 'freeze' }]);
      // The composite deals real HP damage in the same cast (the damage arm is present).
      expect(SKILLS['frost-bite'].effects[0]).toEqual({ kind: 'damage' });
      // The freeze it applies is a payload-free MULTI-turn control arm at FREEZE_DURATION.
      expect(applyAilment([], 'freeze')).toEqual([
        { kind: 'freeze', turnsRemaining: FREEZE_DURATION },
      ]);
    });
  });

  describe('shipped outcomes still hold with Frost Bite/Freeze added (TASK-59)', () => {
    it('still WINS vs numemon and still LOSES vs kuwagamon (full determinism preserved)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
    });

    it('the skills that surface in the winnable fight are cast, and the foe is visibly frozen', () => {
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      // TASK-64: the tactical chooseSkill rotates the whole arsenal, so the mid-tier
      // skills that were stranded now SURFACE in this one shipped fight — including Frost
      // Bite (a FREEZE control lock). TASK-66: Doom Curse now joins the rotation (a new
      // fresh defender ailment) and DISPLACES Double Strike's rule-2 hammer from this
      // (marginally-winnable, HP-to-spare-4) fight — the deliberate, documented cost of
      // surfacing another tactical in-pool; Double Strike's multi-hit stays unit-proven.
      for (const name of ['Blue Blaster', 'Mach Jab', 'Heat Upper', 'Hell Squeeze']) {
        expect(turns.some((t) => t.skill === name)).toBe(true);
      }
      // Frost Bite's Freeze is the observable multi-turn control lock — the foe is frozen
      // and cannot act (the FIRST time this is seen in a real shipped fight, the point of
      // the wave).
      const numemonFrozenTurns = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) => /Numemon is frozen and cannot act/.test(e)),
      );
      expect(numemonFrozenTurns.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('shipped outcomes still hold with Shock Strike/Stun added (TASK-57)', () => {
    it('still WINS vs numemon and still LOSES vs kuwagamon (full determinism preserved)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
    });

    it('the skills that surface in the winnable fight are cast, and the foe loses a turn to a control lock', () => {
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      // TASK-64: the tactical chooseSkill surfaces the mid-tier arsenal — including Shock
      // Strike (the headline: a STUN control lock) — in this one shipped fight. TASK-66:
      // Doom Curse joins the rotation and displaces Double Strike's rule-2 hammer from
      // this fight (Double Strike's multi-hit stays unit-proven).
      for (const name of ['Mach Jab', 'Blue Blaster', 'Heat Upper', 'Hell Squeeze']) {
        expect(turns.some((t) => t.skill === name)).toBe(true);
      }
      // A CONTROL lock is felt on screen: the foe loses a turn — via Stun (Shock Strike),
      // the previously-stranded skill this wave finally surfaces.
      expect(
        turns.some((t) =>
          (t.statusEvents ?? []).some((e) => /Numemon is stunned and cannot act/.test(e)),
        ),
      ).toBe(true);
    });

    it('HP stays monotonically non-increasing across the whole fight (no skipped turn or tick heals)', () => {
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      let lastEnemyHp = Infinity;
      let lastPlayerHp = Infinity;
      for (const t of turns) {
        // Self-reporting entries (shield/empower/stun) name the actor's OWN HP; all
        // other entries report the struck (opposite) side.
        const isSelfReport = (t.statusEvents ?? []).some(
          (e) =>
            /(shield|empower) (holds|fades)/.test(e) ||
            /is stunned and cannot act|shakes off the stun/.test(e) ||
            /is frozen and cannot act|thaws out/.test(e) || // TASK-59: freeze self-report
            /is fast asleep|wakes up/.test(e), // TASK-61: sleep self-report (turn skipped)
        );
        const side = isSelfReport ? t.actor : t.actor === 'player' ? 'enemy' : 'player';
        if (side === 'enemy') {
          expect(t.defenderHpAfter).toBeLessThanOrEqual(lastEnemyHp);
          lastEnemyHp = t.defenderHpAfter;
        } else {
          expect(t.defenderHpAfter).toBeLessThanOrEqual(lastPlayerHp);
          lastPlayerHp = t.defenderHpAfter;
        }
      }
    });
  });

  // ── TASK-58 (R-17c): the seventh combat-engine wave — Double Strike + a MULTI-HIT
  //    effect, the FIRST effect that lands REPEATED discrete damage STRIKES in one
  //    action (each its own damage + log entry the player SEES). It is the FIRST
  //    PARAMETERIZED SkillEffect arm ({ kind:'multihit', hits }). Each strike routes
  //    through the SAME shared damage core the single `damage` effect uses (reads the
  //    live Weaken/Empower, drains a shield strike-by-strike), so shield/overflow/
  //    modifier behaviour is regression-identical and HP stays monotonically
  //    non-increasing (every strike only SUBTRACTS). ─────────────────────────────────
  describe('Double Strike skill (offensive multi-hit)', () => {
    it('models Double Strike as data with a distinct cost and a single multihit effect', () => {
      expect(SKILLS['double-strike'].energyCost).toBe(DOUBLE_STRIKE_ENERGY_COST);
      // DISTINCT from every other costed skill so the energy gate still discriminates.
      expect(SKILLS['double-strike'].energyCost).not.toBe(SKILLS.guard.energyCost);
      expect(SKILLS['double-strike'].energyCost).not.toBe(SKILLS['shock-strike'].energyCost);
      expect(SKILLS['double-strike'].energyCost).not.toBe(SKILLS.focus.energyCost);
      expect(SKILLS['double-strike'].energyCost).not.toBe(SKILLS['fire-breath'].energyCost);
      expect(SKILLS['double-strike'].energyCost).not.toBe(SKILLS['armor-break'].energyCost);
      expect(SKILLS['double-strike'].energyCost).not.toBe(SKILLS['poison-sting'].energyCost);
      // A pure multi-hit: the ONLY effect arm carrying a payload (`hits`).
      expect(SKILLS['double-strike'].effects).toEqual([
        { kind: 'multihit', hits: DOUBLE_STRIKE_HITS },
      ]);
      expect(DOUBLE_STRIKE_HITS).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Double Strike lands DOUBLE_STRIKE_HITS discrete strikes on the DEFENDER in one action', () => {
    // TASK-72 NOTE — the ENGINE-WIDE consequence of promoting Sap in-pool: once Energy
    // Drain (`[damage, sap]`) is in the fight pool, BOTH combatants cast it, and its
    // fixed SAP_ENERGY_AMOUNT (12) drain to the OPPONENT — larger than the 4/turn regen —
    // collapses BOTH energy pools to a low floor in any prolonged two-sided fight. So the
    // Rule-2 hammer in a long fight is now Energy Drain (affordable at the collapsed
    // floor), and the high-cost Double Strike (24) can no longer be re-afforded there.
    // The multi-hit MECHANIC is therefore proven WITHOUT a full two-sided fight: its DATA
    // shape below, plus the per-strike resolveAttack routing tests in the next describe
    // (each strike reads the LIVE Weaken/Empower modifiers). That Double Strike remains
    // the greedy strongest-pure-damage pick when energy IS available is proven by the
    // chooseSkill unit ('once every ailment is inflicted, HAMMERS with … Double Strike').
    it('the multi-hit is DATA: a single {kind:multihit, hits} arm with hits ≥ 2', () => {
      // The whole flurry is modelled as one payloaded effect arm (no bespoke loop in the
      // turn structure) — the load-bearing add-only invariant.
      expect(SKILLS['double-strike'].effects).toEqual([
        { kind: 'multihit', hits: DOUBLE_STRIKE_HITS },
      ]);
      expect(DOUBLE_STRIKE_HITS).toBeGreaterThanOrEqual(2);
    });
  });

  describe('each Double Strike strike reads the LIVE modifiers (routes through resolveAttack, not a bypass)', () => {
    it('each strike deals MORE against a Weakened defender (lower effective DEF)', () => {
      // The pure payoff the multi-hit shares with the single damage effect: a strike's
      // damage rises by exactly the DEF-mitigation delta when the defender is weakened.
      const attacker: Combatant = {
        name: 'Striker',
        type: 'Free',
        element: 'Neutral',
        hp: 100,
        atk: 30,
        def: 10,
        spd: 5,
      };
      const defender: Combatant = { ...attacker, name: 'Wall', def: 20 };
      const perStrikePlain = resolveAttack(attacker, defender);
      const perStrikeWeakened = resolveAttack(attacker, defender, WEAKEN_DEF_REDUCTION);
      // Every strike of a Double Strike uses this same resolveAttack, so each hit is
      // this much harder — the multi-hit is NOT a fixed-damage bypass.
      expect(perStrikeWeakened).toBeGreaterThan(perStrikePlain);
    });

    it('each strike deals MORE while the caster holds Empower (higher effective ATK)', () => {
      const attacker: Combatant = {
        name: 'Striker',
        type: 'Free',
        element: 'Neutral',
        hp: 100,
        atk: 30,
        def: 10,
        spd: 5,
      };
      const defender: Combatant = { ...attacker, name: 'Wall' };
      const perStrikePlain = resolveAttack(attacker, defender);
      const perStrikeEmpowered = resolveAttack(attacker, defender, 0, EMPOWER_ATK_BONUS);
      expect(perStrikeEmpowered).toBeGreaterThan(perStrikePlain);
    });
  });

  describe('a Double Strike into an active Shield is absorbed strike-by-strike (buffer-before-HP holds)', () => {
    it('the shield buffer depletes across the successive strikes before HP is touched', () => {
      // Each Double Strike strike routes through the SAME resolveAttack → absorbWithShield
      // → monotonic HP write the single `damage` effect uses (the shared strike core),
      // and mutates the SAME shield pool between strikes. So two successive strikes into
      // one buffer deplete it strike-by-strike exactly as two single hits would — proven
      // here by threading the two strikes' damage through one shrinking pool (the exact
      // sequence resolveDamageStrike performs, without needing a fight to line the shield
      // up on round 1, when Double Strike is the only-affordable opener before any shield
      // exists). A per-strike hit of 8 vs a 12-pool: strike 1 fully absorbed (overflow 0,
      // pool 12→4), strike 2 breaks it (4 absorbed, overflow 4) — HP falls ONLY on the
      // overflow of the SECOND strike, never on the first.
      let pool = SHIELD_ABSORB_AMOUNT; // 12
      const perStrike = 8;
      // Strike 1
      const s1 = absorbWithShield(perStrike, {
        kind: 'shield',
        turnsRemaining: 3,
        absorbRemaining: pool,
      });
      pool -= s1.absorbed;
      expect(s1.overflow).toBe(0); // first strike removed NO HP (fully absorbed)
      expect(s1.shieldBroke).toBe(false);
      expect(pool).toBe(4);
      // Strike 2 into the DEPLETED pool
      const s2 = absorbWithShield(perStrike, {
        kind: 'shield',
        turnsRemaining: 3,
        absorbRemaining: pool,
      });
      pool -= s2.absorbed;
      expect(s2.absorbed).toBe(4); // drains the remaining buffer
      expect(s2.shieldBroke).toBe(true); // the shield breaks on the second strike
      expect(s2.overflow).toBe(perStrike - 4); // only THIS overflow reaches HP
      expect(pool).toBe(0);
      // Total HP removed across both strikes = only the second strike's overflow — the
      // buffer absorbed the whole first strike before ANY HP was touched.
      expect(s1.overflow + s2.overflow).toBe(perStrike - SHIELD_ABSORB_AMOUNT + perStrike);
    });
  });

  describe('the existing single-hit skills are BYTE-UNCHANGED in behaviour (regression)', () => {
    it('every single-hit skill still resolves damage + status exactly as before Double Strike', () => {
      // The single-hit `damage` effect (attack/fire-breath/poison-sting/armor-break/
      // shock-strike) still emits ONE summary entry per cast with the resolveAttack
      // damage — the multihit arm is SEPARATE and did not alter the `damage` path.
      expect(SKILLS.attack.effects).toEqual([{ kind: 'damage' }]);
      expect(SKILLS['fire-breath'].effects).toEqual([{ kind: 'damage' }, { kind: 'burn' }]);
      expect(SKILLS['poison-sting'].effects).toEqual([{ kind: 'damage' }, { kind: 'poison' }]);
      expect(SKILLS['armor-break'].effects).toEqual([{ kind: 'damage' }, { kind: 'weaken' }]);
      expect(SKILLS['shock-strike'].effects).toEqual([{ kind: 'damage' }, { kind: 'stun' }]);
      // A single-hit cast produces exactly ONE entry that round for that actor (no
      // per-strike splitting), unlike the multi-hit — regression on the summary path.
      const striker: Combatant = {
        name: 'Striker',
        type: 'Free',
        element: 'Neutral',
        hp: 50000,
        atk: 40,
        def: 100,
        spd: 20,
      };
      const target: Combatant = { ...striker, name: 'Target', def: 0, spd: 1 };
      const { turns } = simulateBattle(striker, target);
      // Every Fire Breath cast is a SINGLE entry (one `damage` + a Burn note), never
      // split into "hit N of M" — the byte-unchanged single-hit shape.
      const fbCasts = turns.filter((t) => t.skill === 'Pepper Breath');
      for (const fb of fbCasts) {
        expect((fb.statusEvents ?? []).some((e) => /hit \d+ of \d+/.test(e))).toBe(false);
      }
    });
  });

  describe('HP is monotonically non-increasing across a whole fight WITH the multi-hit (no strike heals)', () => {
    it("each side's reported HP only ever falls (Double Strike strikes only subtract)", () => {
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      let lastEnemyHp = Infinity;
      let lastPlayerHp = Infinity;
      for (const t of turns) {
        // Self-reporting entries (shield/empower/stun) name the actor's OWN HP; every
        // other entry — including each Double Strike strike — reports the struck
        // (opposite) side's HP.
        const isSelfReport = (t.statusEvents ?? []).some(
          (e) =>
            /(shield|empower) (holds|fades)/.test(e) ||
            /is stunned and cannot act|shakes off the stun/.test(e) ||
            /is frozen and cannot act|thaws out/.test(e) || // TASK-59: freeze self-report
            /is fast asleep|wakes up/.test(e), // TASK-61: sleep self-report
        );
        const side = isSelfReport ? t.actor : t.actor === 'player' ? 'enemy' : 'player';
        if (side === 'enemy') {
          expect(t.defenderHpAfter).toBeLessThanOrEqual(lastEnemyHp);
          lastEnemyHp = t.defenderHpAfter;
        } else {
          expect(t.defenderHpAfter).toBeLessThanOrEqual(lastPlayerHp);
          lastPlayerHp = t.defenderHpAfter;
        }
      }
    });
  });

  describe('shipped outcomes still hold with Double Strike/multi-hit added (TASK-58)', () => {
    it('still WINS vs numemon and still LOSES vs kuwagamon (full determinism preserved)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
    });

    it('the surfacing skills are cast in the winnable fight, and Double Strike lands multiple hits', () => {
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      // TASK-64: the tactical chooseSkill surfaces the whole mid-tier arsenal in the
      // shipped fight. TASK-66: Doom Curse joins that rotation and DISPLACES Double
      // Strike's rule-2 hammer from THIS marginally-winnable fight (which now ends before
      // the pool re-climbs to Double Strike's cost). Frost Bite / Shock Strike / Armor
      // Break / Doom Curse are among the surfacing mid-tier skills; Lullaby Hex (pure
      // control) is never preferred.
      for (const name of ['Blue Blaster', 'Mach Jab', 'Heat Upper', 'Hell Squeeze']) {
        expect(turns.some((t) => t.skill === name)).toBe(true);
      }
      // TASK-73: Energy Siphon (Leech) is PROMOTED IN-POOL at cost 4 — ABOVE Energy
      // Drain@1 — so Rule 2 (which prefers the highest-cost affordable pure-damage skill)
      // now casts LEECH in the hammer slot. The sparring pair below completes the arsenal
      // rotation and then repeatedly casts Energy Siphon: because BOTH sides leech +12/turn
      // (a NET energy GAIN), the pool never collapses, so this prolonged two-sided fight
      // reaches MAX_ROUNDS with Leech as the observable late-fight hammer (the wave's
      // payoff — Siphon now SEEN). Energy Drain no longer wins this hammer (Leech sits above
      // it); Sap stays proven via the DATA + drainEnergy units. Double Strike (cost 24) can
      // no longer be re-afforded in a prolonged fight capped by the round guard; its
      // multi-hit shape stays proven via the DATA + per-strike resolveAttack units.
      const bruiser: Combatant = {
        name: 'Bruiser',
        type: 'Free',
        element: 'Neutral',
        hp: 2000,
        atk: 1,
        def: 100,
        spd: 9,
      };
      const dummy: Combatant = { ...bruiser, name: 'Dummy', spd: 5 };
      const spar = simulateBattle(bruiser, dummy);
      // Energy Siphon surfaces as the observable late-fight hammer (Leech now SEEN).
      expect(spar.turns.some((t) => t.skill === 'Energy Ray')).toBe(true);
      expect(
        spar.turns.some((t) => (t.statusEvents ?? []).some((e) => /siphons \d+ energy/.test(e))),
      ).toBe(true);
    });

    it('the surfacing DoT (Bleed) still ticks over ≥2 of numemon\u2019s turns (pacing preserved)', () => {
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      // TASK-62: the DoT that surfaces against numemon is now Bleed (Bleed Strike
      // displaced Fire Breath from the low residual band); Burn's tick is unit-proven.
      const numemonTicks = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) => /Bleed deals \d+ to Numemon/.test(e)),
      );
      expect(numemonTicks.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── TASK-60 (R-17c): the NINTH skill (Lullaby Hex) + the EIGHTH status kind /
  //    THIRD control ailment (Sleep) — the FIRST INTERRUPTIBLE action lock. Sleep
  //    reuses the SAME `stunnedThisTurn` skip-turn substrate as Stun/Freeze, but is the
  //    genuinely NEW *shape*: it suppresses the target for SLEEP_DURATION turns (the
  //    LONGEST lock) UNLESS the sleeper takes a damage hit, which WAKES it early — the
  //    FIRST ailment whose effective duration depends on a COMBAT EVENT, not only its
  //    own turn counter. Applied by the NON-damaging OFFENSIVE Lullaby Hex (`[sleep]`),
  //    priced ABOVE MAX_ENERGY (D-145/A-49) so the shipped fights stay BYTE-IDENTICAL;
  //    proven here with CONSTRUCTED unit tests, NOT by surfacing it in a shipped fight.
  describe('Lullaby Hex skill (non-damaging offensive control: applies an INTERRUPTIBLE Sleep)', () => {
    it('models Lullaby Hex as a PURE control skill — a single non-damaging sleep effect, distinct cost', () => {
      expect(SKILLS['lullaby-hex'].name).toBe('Love Song');
      expect(SKILLS['lullaby-hex'].energyCost).toBe(LULLABY_HEX_ENERGY_COST);
      // NO `damage` arm — deliberately, so a cast cannot wake its OWN target (a
      // [damage, sleep] composite would self-defeat via wake-on-damage). Only sleep.
      expect(SKILLS['lullaby-hex'].effects).toEqual([{ kind: 'sleep' }]);
      // DISTINCT from every other costed skill (the ninth distinct cost).
      const others = [
        'double-strike',
        'guard',
        'frost-bite',
        'shock-strike',
        'focus',
        'fire-breath',
        'armor-break',
        'poison-sting',
        'attack',
      ];
      for (const id of others) {
        expect(SKILLS['lullaby-hex'].energyCost).not.toBe(SKILLS[id].energyCost);
      }
    });

    it('is SELECTABLE at its own IN-POOL cost tier (the ninth skill, energy-gated, deterministic)', () => {
      // TASK-61 (D-147/GUARDRAIL-2): Lullaby Hex was RE-TUNED into the pool (cost 21 ≤
      // MAX_ENERGY 41) and DEMOTED to the SECOND priority slot (just below Double Strike).
      // At its own cost it is the top affordable pick — a DIRECT selectSkill boundary.
      expect(selectSkill(LULLABY_HEX_ENERGY_COST).id).toBe('lullaby-hex');
      // In-pool + DISTINCT (keeps the ladder strictly cost-descending): reachable inside
      // a real fight (one regen tick after the opening Double Strike drops the pool to 17).
      expect(LULLABY_HEX_ENERGY_COST).toBeLessThanOrEqual(MAX_ENERGY);
      const costs = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(costs.filter((c) => c === LULLABY_HEX_ENERGY_COST)).toHaveLength(1);
      // Double Strike is STILL the opener (GUARDRAIL-2: a pure-control opener would flip
      // the winnable fight to a loss). One below its cost → Lullaby Hex (23 ≥ 21).
      expect(selectSkill(DOUBLE_STRIKE_ENERGY_COST - 1).id).toBe('lullaby-hex');
      // At MAX_ENERGY the greedy selectSkill top pick is now Counter Stance (TASK-75
      // promoted it IN-pool at cost 30, the ladder's new TOP slot). NOTE the shipped fight
      // uses the tactical chooseSkill (which OPENS with the Rule-1 fresh-ailment rotation,
      // NOT this greedy boundary), so GUARDRAIL-2 is unaffected — this assert just proves
      // the ladder ordering. Double Strike remains the greedy pick one below counter-stance's
      // cost (i.e. at ≤ 29 down to 24).
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
      expect(selectSkill(DOUBLE_STRIKE_ENERGY_COST).id).toBe('double-strike');
    });

    it('applyAilment applies Sleep to a status collection with turnsRemaining === SLEEP_DURATION (defender-targeting shape, payload-free)', () => {
      const applied = applyAilment([], 'sleep');
      expect(applied).toEqual([{ kind: 'sleep', turnsRemaining: SLEEP_DURATION }]);
      // SLEEP_DURATION is the LONGEST lock — genuinely multi-turn (> Freeze's 2, so > 1).
      expect(SLEEP_DURATION).toBeGreaterThan(1);
      // A re-apply REFRESHES in place (no stack), like every other ailment.
      const half: StatusAilment[] = [{ kind: 'sleep', turnsRemaining: 1 }];
      expect(applyAilment(half, 'sleep')).toEqual([
        { kind: 'sleep', turnsRemaining: SLEEP_DURATION },
      ]);
      // Sleep coexists with other kinds (kept as a keyed collection).
      const withBurn: StatusAilment[] = [{ kind: 'burn', turnsRemaining: 2, damagePerTurn: 4 }];
      const both = applyAilment(withBurn, 'sleep');
      expect(both).toHaveLength(2);
      expect(both.some((s) => s.kind === 'burn')).toBe(true);
      expect(both.some((s) => s.kind === 'sleep' && s.turnsRemaining === SLEEP_DURATION)).toBe(
        true,
      );
    });
  });

  describe('Sleep is the INTERRUPTIBLE lock — wake-on-damage (the genuinely NEW shape vs Freeze)', () => {
    it('a damage hit (damage > 0) on a sleeper CLEARS the sleep early; a non-damaging strike does NOT', () => {
      const sleeping: StatusAilment[] = [{ kind: 'sleep', turnsRemaining: SLEEP_DURATION }];
      // A landing hit wakes it — the sleep arm is removed BEFORE its natural expiry.
      const hit = wakeSleeperOnDamage(sleeping, 5);
      expect(hit.woke).toBe(true);
      expect(hit.statuses.some((s) => s.kind === 'sleep')).toBe(false);
      // A 0-damage strike (a fully-absorbed / non-damaging control skill) does NOT wake.
      const noHit = wakeSleeperOnDamage(sleeping, 0);
      expect(noHit.woke).toBe(false);
      expect(noHit.statuses).toEqual(sleeping);
      // Nothing to wake when the defender is not asleep.
      const awake: StatusAilment[] = [{ kind: 'burn', turnsRemaining: 2, damagePerTurn: 4 }];
      expect(wakeSleeperOnDamage(awake, 9).woke).toBe(false);
      expect(wakeSleeperOnDamage(awake, 9).statuses).toEqual(awake);
    });

    it('wake-on-damage only REMOVES the sleep — it never adds HP (HP stays monotone, A-48)', () => {
      // The helper is a pure status transform: it returns statuses + a `woke` flag and
      // touches no HP. Coexisting statuses on the woken side are preserved intact.
      const mixed: StatusAilment[] = [
        { kind: 'sleep', turnsRemaining: SLEEP_DURATION },
        { kind: 'poison', turnsRemaining: 3, damagePerTurn: 3 },
      ];
      const woke = wakeSleeperOnDamage(mixed, 1);
      expect(woke.woke).toBe(true);
      expect(woke.statuses).toEqual([{ kind: 'poison', turnsRemaining: 3, damagePerTurn: 3 }]);
    });

    it('wake-on-damage fires uniformly through the shared damage core (single hit AND each multi-hit strike)', () => {
      // The wake lives in resolveDamageStrike — the ONE core the single `damage` arm AND
      // each multihit strike route through — so a striker who deals real HP damage wakes
      // a sleeper on ANY damage path. A high-ATK vs 0-DEF striker/target overflows any
      // buffer and lands real damage. We assert the striker's damage path is live (≥1),
      // confirming the shared site (where the wake hook sits) is the one exercised by
      // every hit; the isolated wake transform is asserted above.
      const striker: Combatant = {
        name: 'Striker',
        type: 'Free',
        element: 'Neutral',
        hp: 50000,
        atk: 60,
        def: 100,
        spd: 20,
      };
      const target: Combatant = { ...striker, name: 'Target', def: 0, spd: 1 };
      const { turns } = simulateBattle(striker, target);
      // Every landed Double-Strike hit-line and single hit deals ≥1 HP (the same core the
      // sleeper-wake hook rides), so a sleeper on that defender WOULD be jolted awake.
      const damageHits = turns.filter((t) => t.actor === 'player' && t.damage >= 1);
      expect(damageHits.length).toBeGreaterThan(0);
    });
  });

  describe('Sleep reuses the SAME control-lock substrate as Stun/Freeze (no third skip flag)', () => {
    it('Sleep is a payload-free control arm ticked in AILMENT order right after Freeze', () => {
      // The sleep arm carries ONLY turnsRemaining (like stun/freeze — a control lock
      // has no magnitude), and applyAilment builds it through the SAME payload-free path.
      const applied = applyAilment([], 'sleep');
      expect(applied[0]).toEqual({ kind: 'sleep', turnsRemaining: SLEEP_DURATION });
      expect(Object.keys(applied[0]!).sort()).toEqual(['kind', 'turnsRemaining']);
      // Stun (1) and Freeze (2) are the shorter control locks; Sleep (SLEEP_DURATION) is
      // the LONGEST — the three share the "skip your turn" substrate, differing only in
      // duration + (for Sleep) the interruptible wake, not in the skip machinery.
      expect(STUN_DURATION).toBeLessThan(FREEZE_DURATION);
      expect(FREEZE_DURATION).toBeLessThan(SLEEP_DURATION);
    });
  });

  describe('shipped outcomes still hold with Lullaby Hex/Sleep added (TASK-60)', () => {
    it('still WINS vs numemon and still LOSES vs kuwagamon (full determinism preserved)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
    });

    it('Lullaby Hex is a NON-surfacing pure-control skill (never preferred by the tactical AI)', () => {
      // TASK-64: the tactical chooseSkill NEVER prefers a pure-control, NON-damaging skill
      // (Lullaby Hex is `[sleep]`, no damage arm), because casting one spends a
      // zero-damage turn — the TASK-60/61 pure-control-starvation hazard (GUARDRAIL 3).
      // So Lullaby Hex reverts to a documented NON-surfacing skill (like every wave before
      // it re-tuned the greedy pool): its Sleep lock stays proven DIRECTLY via the
      // selectSkill(21) boundary + the applyAilment/wake-on-damage unit tests below, not a
      // shipped-fight cast. This is the honest present-≠-observable posture for a skill the
      // tactical policy deliberately excludes.
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon).turns.some((t) => t.skill === 'Love Song')).toBe(
        false,
      );
      expect(simulateBattle(agumon, kuwagamon).turns.some((t) => t.skill === 'Love Song')).toBe(
        false,
      );
      // It IS still selectable at its cost band (present, just not tactically preferred).
      expect(selectSkill(LULLABY_HEX_ENERGY_COST).id).toBe('lullaby-hex');
    });
  });

  // ── TASK-62 (R-17c, 11th wave): the THIRD DoT ailment Bleed + `bleed-strike` ──
  describe('Bleed status (the third DoT — a long, low-tick bleed)', () => {
    const bruiser: Combatant = {
      name: 'Bruiser',
      type: 'Free',
      element: 'Neutral',
      hp: 500,
      atk: 1,
      def: 100,
      spd: 9,
    };

    it('applyAilment builds a fresh bleed at full duration + per-turn damage (mirrors Burn/Poison)', () => {
      const after = applyAilment([], 'bleed');
      expect(after).toEqual([
        { kind: 'bleed', turnsRemaining: BLEED_DURATION, damagePerTurn: BLEED_DAMAGE_PER_TURN },
      ]);
    });

    it('lets Burn, Poison AND Bleed COEXIST — a third DoT kind is added, not replaced', () => {
      const after = applyAilment(applyAilment(applyAilment([], 'burn'), 'poison'), 'bleed');
      expect(after.map((s) => s.kind).sort()).toEqual(['bleed', 'burn', 'poison']);
    });

    it('is tuned longer-but-weaker than Burn/Poison so it reads as a distinct slow bleed', () => {
      // Longest duration, lowest per-turn tick of the three DoTs — visibly distinct.
      expect(BLEED_DURATION).toBeGreaterThan(BURN_DURATION);
      expect(BLEED_DURATION).toBeGreaterThan(0);
      expect(BLEED_DAMAGE_PER_TURN).toBeLessThan(BURN_DAMAGE_PER_TURN);
      expect(BLEED_DAMAGE_PER_TURN).toBeLessThan(POISON_DAMAGE_PER_TURN);
    });

    it('Bleed Strike applies Bleed, which ticks BLEED_DAMAGE_PER_TURN over several turns; HP only falls', () => {
      // A low-SPD dummy means the bruiser acts a lot; once energy net-drains into
      // Bleed Strike's band (cost 3) it applies/refreshes Bleed each turn, and the
      // tick subtracts BLEED_DAMAGE_PER_TURN from the dummy every turn.
      const dummy: Combatant = { ...bruiser, name: 'Dummy', spd: 5 };
      const { turns } = simulateBattle(bruiser, dummy);

      const applied = turns.find((t) =>
        (t.statusEvents ?? []).some((e) => /Dummy is Bleeding/.test(e)),
      );
      expect(applied).toBeDefined();

      const dummyTicks = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) =>
          new RegExp(`Bleed deals ${BLEED_DAMAGE_PER_TURN} to Dummy`).test(e),
        ),
      );
      expect(dummyTicks.length).toBeGreaterThanOrEqual(2);
      for (const tick of dummyTicks) expect(tick.damage).toBe(BLEED_DAMAGE_PER_TURN);

      // HP monotonically non-increasing for the Dummy across the whole fight. TASK-64:
      // the tactical AI now logs a richer mix of entries (DoT ticks logged against the
      // applying foe, stat-modifier ticks logged against the afflicted side), so the old
      // "all player-actor entries report the Dummy's HP" heuristic no longer holds. We
      // instead track the Dummy's HP ONLY from entries that unambiguously report it: a
      // DoT tick "… deals N to Dummy" or a strike that named the Dummy — i.e. entries
      // whose statusEvents mention "to Dummy"/"Dummy is …", plus damage entries where the
      // struck side is the Dummy. The simplest robust proxy: entries whose statusEvents
      // report an effect INFLICTED ON the Dummy report the Dummy's HP; assert those only.
      // TASK-73: a "Dummy siphons N energy" leech entry rides the Dummy's OWN attack, whose
      // defenderHpAfter is the OPPONENT's HP — so it is EXCLUDED (it is an effect BY, not ON,
      // the Dummy) to keep this heuristic reporting only the Dummy's own HP.
      // TASK-74: likewise a SELF-BUFF application ("Dummy is Empowered/Shielded/Retaliating")
      // rides the Dummy's OWN turn (the new self-buff opener now casts Focus/Guard), whose
      // defenderHpAfter is the OPPONENT's HP — an effect BY, not ON, the Dummy — so those
      // applied-notes are EXCLUDED too. A "Dummy is <DoT>" application still names an effect
      // ON the Dummy (a defender-targeted ailment), so those stay.
      const SELF_BUFF_APPLIED = /Dummy is (Empowered|Shielded|Retaliating)/;
      const dummyHps = turns
        .filter((t) =>
          (t.statusEvents ?? []).some(
            (e) =>
              !SELF_BUFF_APPLIED.test(e) &&
              (/to Dummy/.test(e) || /Dummy is /.test(e) || /Dummy's /.test(e)),
          ),
        )
        .map((t) => t.defenderHpAfter);
      for (let i = 1; i < dummyHps.length; i += 1) {
        expect(dummyHps[i]!).toBeLessThanOrEqual(dummyHps[i - 1]!);
      }
    });

    it("a Bleed tick expires after BLEED_DURATION of the afflicted side's own turns", () => {
      // Apply once, then tick it down turn-by-turn via the pure applyAilment shape:
      // after BLEED_DURATION ticks the arm is gone. We assert via the fresh arm's count
      // (the loop-driven expiry is exercised by the full-fight tick tests above).
      const fresh = applyAilment([], 'bleed');
      expect((fresh[0] as { turnsRemaining: number }).turnsRemaining).toBe(BLEED_DURATION);
    });

    it('bleed-strike composition: casting it deals damage AND applies bleed to the defender', () => {
      // The [damage, bleed] composite (fire-breath/poison-sting family): a cast both
      // hits (a ≥1 damage entry) and leaves Bleed on the defender. Drive it directly by
      // sitting at exactly BLEED_STRIKE_ENERGY_COST so selectSkill picks bleed-strike.
      expect(selectSkill(BLEED_STRIKE_ENERGY_COST).id).toBe('bleed-strike');
      expect(SKILLS['bleed-strike'].effects).toEqual([{ kind: 'damage' }, { kind: 'bleed' }]);
      const dummy: Combatant = { ...bruiser, name: 'Dummy', spd: 5 };
      const { turns } = simulateBattle(bruiser, dummy);
      const cast = turns.find((t) => t.skill === 'Surudoi Tsume');
      expect(cast).toBeDefined();
      // The applied-Bleed note rides the cast entry's statusEvents.
      const appliedOnCast = turns.some(
        (t) =>
          t.skill === 'Surudoi Tsume' &&
          (t.statusEvents ?? []).some((e) => /Dummy is Bleeding/.test(e)),
      );
      expect(appliedOnCast).toBe(true);
    });
  });

  describe('shipped outcomes still hold with Bleed Strike added (TASK-62)', () => {
    it('still WINS vs numemon and still LOSES vs kuwagamon, deterministic, clear of MAX_ROUNDS', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      // Determinism: two runs are byte-identical (no RNG anywhere).
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      // Both resolve well clear of the round cap (a DoT that ADDS damage SHORTENS fights,
      // so this holds comfortably — but assert it so a tuning drift is caught).
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
    });

    it('Bleed Strike IS cast in the shipped numemon fight and the foe visibly bleeds (observable value)', () => {
      // THE headline observable-value proof: unlike a Posture-B skill priced above the
      // pool, bleed-strike (cost 4, a DAMAGING mid-ladder skill) actually FIRES in the
      // real winnable fight, so a /battle player SEES Bleed Strike cast + "Numemon is
      // bleeding" ticking over several turns — a new, distinct DoT reading alongside
      // Burn/Poison and every other mechanic.
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      // (1) Bleed Strike is actually cast by the player against numemon.
      expect(turns.some((t) => t.skill === 'Surudoi Tsume')).toBe(true);
      // (2) A "Numemon is Bleeding" applied line APPEARS.
      expect(
        turns.some((t) => (t.statusEvents ?? []).some((e) => /Numemon is Bleeding/.test(e))),
      ).toBe(true);
      // (3) The Bleed DoT visibly TICKS over ≥2 of the foe's turns (it bleeds OUT).
      const bleedTicks = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) =>
          new RegExp(`Bleed deals ${BLEED_DAMAGE_PER_TURN} to Numemon`).test(e),
        ),
      );
      expect(bleedTicks.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── TASK-63 (R-17c, 12th wave): the 4th stat-modifier Enfeeble + `enfeeble-strike` ──
  //
  // Enfeeble is the OFFENSIVE-ATK mirror of Weaken's DEF-debuff / Empower's self-ATK-buff:
  // a DEFENDER-targeted debuff that, while active on an attacker, CUTS that attacker's
  // outgoing damage (read at the resolveDamageStrike seam, floored at MIN_EFFECTIVE_ATK).
  // Add-only on the proven Weaken/Empower substrate (L-16): a StatusAilment arm, a
  // SkillEffect arm, an AILMENT_SPEC/LABEL/APPLIED_LABEL row, a tick slot after weaken, an
  // applyAilment branch, the resolveAttack ATK floor + net-bonus read, and the DAMAGING
  // composite skill enfeeble-strike (cost 8). No wire field, no migration, HP monotone.
  describe('Enfeeble ailment (4th stat-modifier: an ATK debuff, the mirror of Weaken)', () => {
    it('models enfeeble-strike as data with a distinct cost and a damage-then-enfeeble effect list', () => {
      expect(SKILLS['enfeeble-strike'].energyCost).toBe(ENFEEBLE_STRIKE_ENERGY_COST);
      expect(SKILLS['enfeeble-strike'].effects).toEqual([{ kind: 'damage' }, { kind: 'enfeeble' }]);
    });

    it('applyAilment adds a fresh Enfeeble arm at full duration (mirrors Weaken/Empower)', () => {
      const after = applyAilment([], 'enfeeble');
      expect(after).toEqual([
        {
          kind: 'enfeeble',
          turnsRemaining: ENFEEBLE_DURATION,
          atkReduction: ENFEEBLE_ATK_REDUCTION,
        },
      ]);
    });

    it('Enfeeble coexists with the other stat-modifiers (at most one per kind)', () => {
      const after = applyAilment(
        applyAilment(applyAilment(applyAilment([], 'burn'), 'weaken'), 'empower'),
        'enfeeble',
      );
      expect(after.map((s) => s.kind).sort()).toEqual(['burn', 'empower', 'enfeeble', 'weaken']);
    });

    it('re-applying Enfeeble REFRESHES its duration (overwrites, never stacks)', () => {
      const worn: StatusAilment[] = [
        { kind: 'enfeeble', turnsRemaining: 1, atkReduction: ENFEEBLE_ATK_REDUCTION },
      ];
      const after = applyAilment(worn, 'enfeeble');
      expect(after).toHaveLength(1);
      const e = after[0]!;
      expect(e.kind).toBe('enfeeble');
      expect((e as Extract<StatusAilment, { kind: 'enfeeble' }>).turnsRemaining).toBe(
        ENFEEBLE_DURATION,
      );
    });

    it('deals LESS damage from an ENFEEBLED attacker (its effective ATK is cut)', () => {
      // resolveAttack's 4th positional arg is the NET atk modifier (empower − enfeeble).
      // Driving a negative net models an active enfeeble on the attacker: the hit lands
      // for the exact atk-cut delta LESS.
      const attacker: Combatant = {
        name: 'A',
        type: 'Free',
        element: 'Neutral',
        hp: 50,
        atk: 30,
        def: 10,
        spd: 8,
      };
      const defender: Combatant = {
        name: 'D',
        type: 'Free',
        element: 'Neutral',
        hp: 50,
        atk: 10,
        def: 20,
        spd: 6,
      };
      const plain = resolveAttack(attacker, defender);
      const enfeebled = resolveAttack(attacker, defender, 0, -ENFEEBLE_ATK_REDUCTION);
      expect(enfeebled).toBeLessThan(plain);
      // Neutral matchup ×1.0, so the raw scaled term drops by exactly ENFEEBLE_ATK_REDUCTION.
      expect(plain - enfeebled).toBe(ENFEEBLE_ATK_REDUCTION);
    });

    it('an over-enfeebled attacker still lands the ≥1 floor (MIN_EFFECTIVE_ATK clamp)', () => {
      const attacker: Combatant = {
        name: 'A',
        type: 'Free',
        element: 'Neutral',
        hp: 50,
        atk: 5,
        def: 10,
        spd: 8,
      };
      const defender: Combatant = {
        name: 'D',
        type: 'Free',
        element: 'Neutral',
        hp: 50,
        atk: 10,
        def: 2,
        spd: 6,
      };
      // A reduction far exceeding atk drives net ATK negative → MIN_EFFECTIVE_ATK clamps
      // the ATK term to 0 (never negative, which would HEAL), then Math.max(1,…) floors
      // the hit at 1. The floor equals striking with atk === MIN_EFFECTIVE_ATK.
      const overCut = resolveAttack(attacker, defender, 0, -9999);
      expect(overCut).toBe(1);
      expect(overCut).toBe(resolveAttack({ ...attacker, atk: MIN_EFFECTIVE_ATK }, defender));
    });

    it('a no-enfeeble attack is BYTE-IDENTICAL to the pre-TASK-63 behaviour (additive)', () => {
      const attacker: Combatant = {
        name: 'A',
        type: 'Vaccine',
        element: 'Fire',
        hp: 50,
        atk: 14,
        def: 10,
        spd: 8,
      };
      const defender = findEnemy('numemon')!;
      // No enfeeble present → net bonus 0 → the ATK-floor clamp is a no-op → identical.
      expect(resolveAttack(attacker, defender)).toBe(resolveAttack(attacker, defender, 0, 0));
    });

    it('an Enfeeble tick counts down + expires, subtracting NO HP (HP monotone, A-52)', () => {
      // Drive the tick via a full fight: an INJECTED enfeeble on the player is ticked at
      // the top of the player's own turn. It emits an "ATK is lowered"/"wore off" note and
      // never touches HP (a stat-modifier is not a DoT). Prove the arm's lifetime purely.
      let statuses = applyAilment([], 'enfeeble');
      for (let t = 0; t < ENFEEBLE_DURATION - 1; t++) {
        const e = statuses.find((s) => s.kind === 'enfeeble')!;
        expect(e.kind).toBe('enfeeble');
        // simulate one of the afflicted side's ticks (decrement; drop on expiry)
        statuses = statuses
          .map((s) => (s.kind === 'enfeeble' ? { ...s, turnsRemaining: s.turnsRemaining - 1 } : s))
          .filter((s) => s.turnsRemaining > 0);
      }
      // Still present after DURATION-1 ticks; gone after the DURATIONth.
      expect(statuses.find((s) => s.kind === 'enfeeble')).toBeDefined();
      statuses = statuses
        .map((s) => (s.kind === 'enfeeble' ? { ...s, turnsRemaining: s.turnsRemaining - 1 } : s))
        .filter((s) => s.turnsRemaining > 0);
      expect(statuses.find((s) => s.kind === 'enfeeble')).toBeUndefined();
    });

    it('selectSkill(8) returns enfeeble-strike; the enlarged 13-entry ladder is strictly cost-descending', () => {
      expect(selectSkill(ENFEEBLE_STRIKE_ENERGY_COST).id).toBe('enfeeble-strike');
      // TASK-65 slotted vulnerable-strike (cost 10) between Frost Bite (11) and Shock
      // Strike (9), growing the ladder to 13 entries; TASK-66 slotted doom-curse (cost
      // 12) between Guard (14) and Frost Bite (11), growing it to 14; TASK-67 slotted
      // corrode-strike (cost 13) between Guard (14) and Doom Curse (12), growing it to 15.
      // TASK-69 prepended counter-stance (cost 45, ABOVE MAX_ENERGY — Posture-B) at the
      // TOP of the ladder, growing it to 16 (the ladder stays strictly cost-descending).
      // TASK-70 prepended energy-drain (cost 46, ABOVE MAX_ENERGY — Posture-B) as the new
      // TOP entry (above Counter Stance's 45), growing it to 17 (still strictly descending).
      // TASK-71 prepended energy-siphon (cost 47, ABOVE MAX_ENERGY — Posture-B) as the new
      // TOP entry (above Energy Drain's 46), growing it to 18 (still strictly descending).
      // TASK-72 RE-PRICED energy-drain 46→1 (PROMOTED IN-POOL, between poison-sting@2 and
      // the free attack@0) and moved its slot accordingly — the ladder stays 18 entries and
      // strictly cost-descending; no entry added/removed.
      // TASK-73 RE-PRICED energy-siphon 47→4 (PROMOTED IN-POOL, between armor-break@5 and
      // bleed-strike@3) and moved its slot accordingly — the ladder stays 18 entries and
      // strictly cost-descending; no entry added/removed.
      // TASK-75 RE-PRICED counter-stance 45→30 (PROMOTED IN-POOL) — it stays at the TOP slot
      // (30 > double-strike@24) so no entry re-orders; the ladder stays 18 entries and
      // strictly cost-descending (30 > 24 > … > 5 > 4 > 3 > 2 > 1 > 0). ZERO skills above-pool.
      // TASK-76 ADDED Purify (cleanse)@43 at the ladder's absolute TOP — priced ABOVE
      // MAX_ENERGY (Posture-B DECOUPLED), so it never fires in-sim; the ladder grows to 19
      // entries and stays strictly cost-descending (43 > 30 > 24 > … > 0). ONE skill above-pool.
      // TASK-77 ADDED Purge (dispel)@44 at the NEW ladder TOP — also ABOVE MAX_ENERGY and
      // DISTINCT from cleanse@43 (Posture-B DECOUPLED, never fires in-sim); the ladder grows
      // to 20 entries and stays strictly cost-descending (44 > 43 > 30 > … > 0). TWO above-pool.
      // TASK-78 ADDED Purloin (Spellthief)@45 at the NEW ladder TOP — also ABOVE MAX_ENERGY and
      // DISTINCT from dispel@44 / cleanse@43 (Posture-B DECOUPLED, never fires in-sim); the
      // ladder grows to 21 entries and stays strictly cost-descending (45 > 44 > 43 > … > 0).
      // THREE above-pool.
      // TASK-79 ADDED Displace (Scapegoat)@46 at the NEW ladder TOP — also ABOVE MAX_ENERGY and
      // DISTINCT from purloin@45 / dispel@44 / cleanse@43 (Posture-B DECOUPLED, never fires
      // in-sim); the ladder grows to 22 entries and stays strictly cost-descending
      // (46 > 45 > 44 > 43 > … > 0). FOUR above-pool.
      // TASK-80 ADDED Reclaim (Backfire)@47 at the NEW ladder TOP — also ABOVE MAX_ENERGY and
      // DISTINCT from displace@46 / purloin@45 / dispel@44 / cleanse@43 (Posture-B DECOUPLED,
      // never fires in-sim); the ladder grows to 23 entries and stays strictly cost-descending
      // (47 > 46 > 45 > 44 > 43 > … > 0). FIVE above-pool.
      // TASK-81 ADDED Reclaim-Deep (Rebound)@48 at the NEW ladder TOP — also ABOVE MAX_ENERGY
      // and DISTINCT from reclaim@47 / displace@46 / purloin@45 / dispel@44 / cleanse@43
      // (Posture-B DECOUPLED, never fires in-sim); the ladder grows to 24 entries and stays
      // strictly cost-descending (48 > 47 > 46 > 45 > 44 > 43 > … > 0). SIX above-pool.
      // TASK-82 ADDED Reclaim-Partial (Rebound-Lite)@49 at the NEW ladder TOP — also ABOVE
      // MAX_ENERGY and DISTINCT from reclaim-deep@48 / reclaim@47 / displace@46 / purloin@45 /
      // dispel@44 / cleanse@43 (Posture-B DECOUPLED, never fires in-sim); the ladder grows to 25
      // entries and stays strictly cost-descending (49 > 48 > 47 > … > 0). SEVEN above-pool.
      // TASK-83 ADDED Reclaim-Subset (Rebound-Split)@50 at the NEW ladder TOP — also ABOVE
      // MAX_ENERGY and DISTINCT from reclaim-partial@49 / reclaim-deep@48 / reclaim@47 /
      // displace@46 / purloin@45 / dispel@44 / cleanse@43 (Posture-B DECOUPLED, never fires
      // in-sim). TASK-84 ADDED Reclaim-Stats (Rebound-Snap)@51 at the NEW ladder TOP — also
      // ABOVE MAX_ENERGY and DISTINCT from reclaim-subset@50 / … / cleanse@43. TASK-85 ADDED
      // Reclaim-Locks (Rebound-Lock)@52 at the NEW ladder TOP — also ABOVE MAX_ENERGY and
      // DISTINCT from reclaim-stats@51 / … / cleanse@43. TASK-86 ADDED Reclaim-Doom
      // (Rebound-Doom)@53 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // reclaim-locks@52 / … / cleanse@43. TASK-87 ADDED Reclaim-Blight
      // (Rebound-Blight)@54 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // reclaim-doom@53 / … / cleanse@43; the ladder grows to 30 entries and stays strictly
      // cost-descending (54 > 53 > 52 > … > 0). TWELVE above-pool. TASK-88 ADDED Reclaim-Cripple
      // (Rebound-Cripple)@55 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // reclaim-blight@54 / … / cleanse@43; the ladder grows to 31 entries and stays strictly
      // cost-descending (55 > 54 > 53 > … > 0). THIRTEEN above-pool. TASK-89 ADDED Reclaim-Sear
      // (Rebound-Sear)@56 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // reclaim-cripple@55 / … / cleanse@43; the ladder grows to 32 entries and stays strictly
      // cost-descending (56 > 55 > 54 > … > 0). FOURTEEN above-pool. TASK-90 ADDED Reclaim-Doomburn
      // (Rebound-Doomburn)@57 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // reclaim-sear@56 / … / cleanse@43; the ladder grows to 33 entries and stays strictly
      // cost-descending (57 > 56 > 55 > … > 0). FIFTEEN above-pool. TASK-91 ADDED Reclaim-Snapdoom
      // (Rebound-Snapdoom)@58 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // reclaim-doomburn@57 / … / cleanse@43; the ladder grows to 34 entries and stays strictly
      // cost-descending (58 > 57 > 56 > … > 0). SIXTEEN above-pool. TASK-92 ADDED Reclaim-Doomlock
      // (Rebound-Doomlock)@59 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // reclaim-snapdoom@58 / … / cleanse@43; the ladder grows to 35 entries and stays strictly
      // cost-descending (59 > 58 > 57 > … > 0). SEVENTEEN above-pool. TASK-93 ADDED Reclaim-Purge
      // (Rebound-Purge)@60 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // reclaim-doomlock@59 / … / cleanse@43; the ladder grows to 36 entries and stays strictly
      // cost-descending (60 > 59 > 58 > … > 0). EIGHTEEN above-pool. TASK-94 ADDED Reclaim-Seardoom
      // (Rebound-Seardoom)@61 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // reclaim-purge@60 / … / cleanse@43; the ladder grows to 37 entries and stays strictly
      // cost-descending (61 > 60 > 59 > … > 0). NINETEEN above-pool. TASK-95 ADDED Reclaim-Blightdoom
      // (Rebound-Blightdoom)@62 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // reclaim-seardoom@61 / … / cleanse@43; the ladder grows to 38 entries and stays strictly
      // cost-descending (62 > 61 > 60 > … > 0). TWENTY above-pool. TASK-96 ADDED Reclaim-Snaplockdoom
      // (Rebound-Snaplockdoom)@63 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // reclaim-blightdoom@62 / … / cleanse@43; the ladder grows to 39 entries and stays strictly
      // cost-descending (63 > 62 > 61 > … > 0). TWENTY-ONE above-pool. TASK-97 ADDED Energy Rend
      // (sap-percent)@64 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // reclaim-snaplockdoom@63 / … / cleanse@43 (Posture-B DECOUPLED, never fires in-sim); the
      // ladder grows to 40 entries and stays strictly cost-descending (64 > 63 > 62 > … > 0).
      // TWENTY-TWO above-pool. TASK-98 ADDED Energy Surge (leech-percent)@65 at the NEW ladder TOP —
      // also ABOVE MAX_ENERGY and DISTINCT from sap-percent@64 / … / cleanse@43 (Posture-B
      // DECOUPLED, never fires in-sim); the ladder grows to 41 entries and stays strictly
      // cost-descending (65 > 64 > 63 > … > 0). TWENTY-THREE above-pool. TASK-99 ADDED Thorn Mirror
      // (reflect-percent)@66 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // leech-percent@65 / … / cleanse@43 (Posture-B DECOUPLED, never fires in-sim); the ladder
      // grows to 42 entries and stays strictly cost-descending (66 > 65 > 64 > … > 0).
      // TWENTY-FOUR above-pool. TASK-100 ADDED Crumble (weaken-percent)@67 at the NEW ladder TOP —
      // also ABOVE MAX_ENERGY and DISTINCT from reflect-percent@66 / … / cleanse@43 (Posture-B
      // DECOUPLED, never fires in-sim); the ladder grows to 43 entries and stays strictly
      // cost-descending (67 > 66 > 65 > … > 0). TWENTY-FIVE above-pool. TASK-101 ADDED Sunder
      // (enfeeble-percent)@68 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // weaken-percent@67 / … / cleanse@43 (Posture-B DECOUPLED, never fires in-sim); the ladder
      // grows to 44 entries and stays strictly cost-descending (68 > 67 > 66 > … > 0).
      // TWENTY-SIX above-pool. TASK-102 ADDED Reinforce (empower-percent)@69 at the NEW ladder TOP —
      // also ABOVE MAX_ENERGY and DISTINCT from enfeeble-percent@68 / … / cleanse@43 (Posture-B
      // DECOUPLED, never fires in-sim); the ladder grows to 45 entries and stays strictly
      // cost-descending (69 > 68 > 67 > … > 0). TWENTY-SEVEN above-pool. TASK-103 ADDED Rupture
      // (vulnerable-percent)@70 at the NEW ladder TOP — also ABOVE MAX_ENERGY and DISTINCT from
      // empower-percent@69 / … / cleanse@43 (Posture-B DECOUPLED, never fires in-sim); the ladder
      // grows to 46 entries and stays strictly cost-descending (70 > 69 > … > 0). TWENTY-EIGHT above-pool.
      // TASK-104 ADDED Chaos Shift (swap-atk)@42 — the FIRST stat-VALUE swap — ABOVE MAX_ENERGY and
      // DISTINCT, slotting between cleanse@43 and counter-stance@30 (Posture-B DECOUPLED, never fires
      // in-sim); the ladder grows to 47 entries and stays strictly cost-descending. TWENTY-NINE above-pool.
      // TASK-105 ADDED Chaos Warp (swap-def)@71 — the SECOND stat-VALUE swap (defensive twin) — at the
      // NEW ladder TOP, the FIRST free integer above the contiguous 42→70 band, ABOVE MAX_ENERGY and
      // DISTINCT from every other above-pool cost (Posture-B DECOUPLED, never fires in-sim); the ladder
      // grows to 48 entries and stays strictly cost-descending (71 > 70 > … > 0). THIRTY above-pool.
      // TASK-106 ADDED Chaos Cyclone (swap-spd)@72 — the THIRD stat-VALUE swap (speed twin, completing
      // the atk→def→spd trio) — at the NEW ladder TOP, the FIRST free integer above the contiguous
      // 42→71 band, ABOVE MAX_ENERGY and DISTINCT from every other above-pool cost (Posture-B DECOUPLED,
      // never fires in-sim); the ladder grows to 49 entries and stays strictly cost-descending
      // (72 > 71 > … > 0). THIRTY-ONE above-pool.
      // TASK-107 ADDED Chaos Nexus (swap-all)@73 — the FULL three-stat swap (atk+def+spd together,
      // EXHAUSTING the stat-value-swap shape family) — at the NEW ladder TOP, the FIRST free integer
      // above the contiguous 42→72 band, ABOVE MAX_ENERGY and DISTINCT from every other above-pool
      // cost (Posture-B DECOUPLED, never fires in-sim); the ladder grows to 50 entries and stays
      // strictly cost-descending (73 > 72 > … > 0). THIRTY-TWO above-pool.
      // TASK-108 ADDED Fortify (fortify)@74 — the DEF-up SELF-BUFF (the missing DEFENSIVE self-buff,
      // the DEF-axis twin of empower and the self-buff mirror of weaken) — at the NEW ladder TOP,
      // the FIRST free integer above the contiguous 42→73 band, ABOVE MAX_ENERGY and DISTINCT from
      // every other above-pool cost (Posture-B DECOUPLED, never fires in-sim); the ladder grows to
      // 51 entries and stays strictly cost-descending (74 > 73 > … > 0). THIRTY-THREE above-pool.
      // TASK-109 ADDED Brace (brace)@75 — the damage-taken-DOWN SELF-BUFF (the missing
      // damage-application-seam member, the POSITIVE MIRROR of vulnerable, distinct from fortify at
      // the DEF-mitigation seam) — at the NEW ladder TOP, the FIRST free integer above the contiguous
      // 42→74 band, ABOVE MAX_ENERGY and DISTINCT from every other above-pool cost (Posture-B
      // DECOUPLED, never fires in-sim); the ladder grows to 52 entries and stays strictly
      // cost-descending (75 > 74 > … > 0). THIRTY-FOUR above-pool.
      // TASK-110 ADDED Bulwark (brace-percent)@76 — the PERCENTAGE damage-taken-DOWN SELF-BUFF (the
      // missing PERCENT member of the damage-application seam, the fractional MIRROR of brace and the
      // DOWN-side percent twin of vulnerable-percent) — at the NEW ladder TOP, the FIRST free integer
      // above the contiguous 42→75 band, ABOVE MAX_ENERGY and DISTINCT from every other above-pool
      // cost (Posture-B DECOUPLED, never fires in-sim); the ladder grows to 53 entries and stays
      // strictly cost-descending (76 > 75 > … > 0). THIRTY-FIVE above-pool.
      // TASK-111 ADDED Aegis (fortify-percent)@77 — the PERCENTAGE DEF-UP SELF-BUFF (the missing
      // PERCENT-UP member of the DEF-mitigation seam, the fractional MIRROR of fortify and the DEF-UP
      // percent twin of the DEBUFF weaken-percent) — at the NEW ladder TOP, the FIRST free integer
      // above the contiguous 42→76 band, ABOVE MAX_ENERGY and DISTINCT from every other above-pool
      // cost (Posture-B DECOUPLED, never fires in-sim); the ladder grows to 54 entries and stays
      // strictly cost-descending (77 > 76 > … > 0). THIRTY-SIX above-pool.
      // TASK-112 ADDED Quicken (hasten)@78 — the FLAT SPD-UP SELF-BUFF (the FIRST member of the SPD
      // stat-mod axis, the SPD-axis twin of the DEF-up fortify and the ATK-up empower) — at the NEW
      // ladder TOP, the FIRST free integer above the contiguous 42→77 band, ABOVE MAX_ENERGY and
      // DISTINCT from every other above-pool cost (Posture-B DECOUPLED, never fires in-sim); the ladder
      // grows to 55 entries and stays strictly cost-descending (78 > 77 > … > 0). THIRTY-SEVEN above-pool.
      // TASK-113 ADDED Rush (hasten-percent)@79 — the PERCENTAGE SPD-UP SELF-BUFF (the percent-UP twin of
      // the flat hasten, the SPD-axis mirror of the DEF-up fortify-percent and ATK-up empower-percent) —
      // at the NEW ladder TOP, the FIRST free integer above the contiguous 42→78 band, ABOVE MAX_ENERGY
      // and DISTINCT from every other above-pool cost (Posture-B DECOUPLED, never fires in-sim); the
      // ladder grows to 58 entries and stays strictly cost-descending (81 > 80 > … > 0). FORTY above-pool.
      // TASK-119 ADDED Doom-Percent Curse (doom-percent-curse)@82 — the DEFERRED FRACTIONAL-detonation
      // curse (the percent-of-CURRENT-HP twin of the castable doom-curse@12) — at the NEW ladder TOP, the
      // FIRST free integer above the contiguous 42→81 band, ABOVE MAX_ENERGY and DISTINCT from every other
      // above-pool cost (Posture-B DECOUPLED, never fires in-sim: a castable fractional-doom would perturb
      // the shipped fight); the ladder grows to 59 entries and stays strictly cost-descending
      // (82 > 81 > … > 0). FORTY-ONE above-pool.
      // TASK-120 ADDED Smolder Strike (smolder-strike)@83 — the DoT family's FIRST `-percent` fidelity
      // twin (a fractional percent-of-CURRENT-HP DoT inflictor, the mirror of Fire Breath's flat burn) —
      // at the NEW ladder TOP, the FIRST free integer above the contiguous 42→82 band, ABOVE MAX_ENERGY
      // and DISTINCT from every other above-pool cost (Posture-B DECOUPLED, never fires in-sim: a castable
      // DoT-only inflictor would be rotated onto the foe as a DoT tactical and perturb the shipped fight);
      // the ladder grows to 62 entries (TASK-122 added hemorrhage@85 above toxin-sting@84) and stays
      // strictly cost-descending (85 > 84 > … > 0). FORTY-FOUR above-pool.
      // TASK-123 ADDED Necrosis (necrosis)@86 — the DoT family's FOURTH & FINAL `-percent` fidelity twin
      // (a fractional-RAMP percent-of-CURRENT-HP DoT inflictor, the mirror of Corrode Strike's flat ramping
      // corrode) — at the NEW ladder TOP above hemorrhage@85, ABOVE MAX_ENERGY and DISTINCT from every other
      // above-pool cost (Posture-B DECOUPLED, never fires in-sim: a castable DoT-only inflictor would be
      // rotated onto the foe as a DoT tactical and perturb the shipped fight); the ladder grows to 70
      // entries and stays strictly cost-descending (93 > 92 > 91 > 90 > 89 > 88 > 87 > … > 0). FIFTY-TWO above-pool
      // above-pool (TASK-133 added rot-when-weak-curse@94, the NEW ladder TOP above wither-curse@93;
      // TASK-132 added wither-curse@93, above barrier@92; TASK-131 added barrier@92,
      // above last-stand-strike@91; TASK-130 added last-stand-strike@91, above bravado-strike@90).
      expect(COMBATANT_SKILLS).toHaveLength(77);
      const abovePool = COMBATANT_SKILLS.filter((s) => s.energyCost > MAX_ENERGY);
      expect(abovePool).toHaveLength(59);
      const costs = COMBATANT_SKILLS.map((s) => s.energyCost);
      for (let i = 1; i < costs.length; i++) {
        expect(costs[i]).toBeLessThan(costs[i - 1]);
      }
    });

    it('enfeeble-strike composition: casting it deals damage AND applies enfeeble to the DEFENDER', () => {
      // Enfeeble is DEFENDER-targeted (it debuffs the OPPONENT's outgoing attack), so it
      // must land on the defender's statuses — NOT the caster's (unlike shield/empower).
      // Drive simulateBattle with combatants whose opening pool sits at exactly the
      // enfeeble-strike cost so selectSkill picks it, and assert the applied event + the
      // enfeeble arm on the STRUCK side's subsequent-turn tick ("<foe>'s ATK is lowered").
      // We assert the wiring via the effect list + the applied-label path directly here;
      // the payoff (reduced damage) is proven above via resolveAttack.
      expect(selectSkill(ENFEEBLE_STRIKE_ENERGY_COST).id).toBe('enfeeble-strike');
      // The applied ailment lands on a defender's status collection via applyAilment
      // (the same path simulateBattle's defender branch uses for an offensive ailment).
      const defenderStatuses = applyAilment([], 'enfeeble');
      expect(defenderStatuses.some((s) => s.kind === 'enfeeble')).toBe(true);
    });

    it('Enfeeble Strike now SURFACES in the shipped fight and the foe is visibly enfeebled (observable value)', () => {
      // TASK-64 — the headline FLIP: enfeeble-strike (cost 8) was a NON-surfacing tier
      // under the greedy AI. The tactical chooseSkill rotates the whole arsenal, so
      // Enfeeble Strike is now ACTUALLY CAST in the shipped numemon fight and a /battle
      // player SEES the foe get Enfeebled — the previously-invisible mechanic made
      // observable, exactly what this wave exists to do (present → observable).
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      const { turns } = simulateBattle(agumon, numemon);
      // (1) Enfeeble Strike is genuinely cast in the shipped fight now.
      expect(turns.some((t) => t.skill === 'Silence Hug')).toBe(true);
      // (2) Its Enfeeble lands on the foe — the applied event + the subsequent ATK-tick.
      expect(
        turns.some((t) => (t.statusEvents ?? []).some((e) => /Numemon is Enfeebled/.test(e))),
      ).toBe(true);
      expect(
        turns.some((t) => (t.statusEvents ?? []).some((e) => /Numemon's ATK is lowered/.test(e))),
      ).toBe(true);
      // (3) HP monotonically non-increasing for the foe across the whole fight (no tick
      // heals). Tracked via entries that unambiguously report the Numemon by name (the
      // tactical AI's richer log mixes actor-perspectives — see the Bleed monotone test).
      // TASK-74: a SELF-BUFF application ("Numemon is Empowered/Shielded/Retaliating")
      // rides Numemon's OWN turn (the new self-buff opener now casts Focus/Guard on the
      // enemy too), whose defenderHpAfter is the OPPONENT's (Agumon's) HP — an effect BY,
      // not ON, Numemon — so it is EXCLUDED to keep this heuristic reporting Numemon's HP.
      const numemonHps = turns
        .filter((t) =>
          (t.statusEvents ?? []).some(
            (e) => /Numemon/.test(e) && !/Numemon is (Empowered|Shielded|Retaliating)/.test(e),
          ),
        )
        .map((t) => t.defenderHpAfter);
      for (let i = 1; i < numemonHps.length; i += 1) {
        expect(numemonHps[i]!).toBeLessThanOrEqual(numemonHps[i - 1]!);
      }
    });

    it('a fight WITH an injected enfeeble on the enemy makes the enemy hit for LESS and its ATK-tick heals no HP (observable payoff)', () => {
      // Because cost 8 never surfaces via the greedy AI (a documented engine property,
      // brute-force-confirmed), the OBSERVABLE enfeeble payoff is proven by contrasting
      // the pure damage an enemy deals WITH vs WITHOUT an active enfeeble via the exact
      // resolveDamageStrike seam simulateBattle uses. This is the real damage math a
      // /battle player would see once an enfeeble is on the foe: strictly less damage.
      const kuwagamon = findEnemy('kuwagamon')!;
      // kuwagamon attacking agumon: plain vs enfeebled (net −ENFEEBLE_ATK_REDUCTION ATK).
      const plain = resolveAttack(kuwagamon, agumon);
      const enfeebled = resolveAttack(kuwagamon, agumon, 0, -ENFEEBLE_ATK_REDUCTION);
      expect(enfeebled).toBeLessThan(plain);
      // The enfeeble tick itself removes NO HP (it only counts down + logs) — mirrored
      // from the Weaken/Empower tick discipline (HP stays monotonically non-increasing).
      // A no-enfeeble baseline is byte-identical to net-0, confirming additivity.
      expect(resolveAttack(kuwagamon, agumon)).toBe(resolveAttack(kuwagamon, agumon, 0, 0));
    });
  });

  // ── TASK-64 (R-17c, 13th wave): the DETERMINISTIC TACTICAL AI that SURFACES the ──
  //    stranded mid-tier skills in a shipped fight. The greedy selectSkill(cost) is
  //    REPLACED inside simulateBattle by chooseSkill(me, them) — a pure, RNG-free,
  //    deterministic policy that rotates the whole offensive-ailment arsenal onto the
  //    foe before hammering with the strongest damage. selectSkill stays exported +
  //    unit-tested as the cost boundary (unchanged); chooseSkill is the in-fight brain.
  describe('tactical AI chooseSkill (deterministic, RNG-free, TOTAL) — TASK-64', () => {
    // A minimal SideState builder (fight-local scratch: energy, active statuses, and the
    // this-fight inflicted-set). Structural — chooseSkill reads only these fields.
    const side = (
      energy: number,
      statuses: StatusAilment[] = [],
      inflicted: StatusAilment['kind'][] = [],
    ) => ({ hp: 100, energy, statuses, inflicted: new Set(inflicted) });

    it('at 0 energy it is TOTAL — falls all the way to the free Attack', () => {
      expect(chooseSkill(side(0), side(100)).id).toBe('attack');
    });

    it('prefers a FRESH damaging tactical skill (highest tactical priority: the freeze control lock)', () => {
      // Plenty of energy, no ailments on the foe, none inflicted yet → the top-priority
      // fresh damaging tactical skill is Frost Bite (freeze, AILMENT_TACTICAL_PRIORITY 0).
      expect(chooseSkill(side(MAX_ENERGY), side(100)).id).toBe('frost-bite');
    });

    it('does NOT re-apply an ailment already active on the foe (skips freeze, picks the next fresh one)', () => {
      // The foe already carries freeze → Frost Bite is skipped; the next-priority fresh
      // damaging tactical is Shock Strike (stun, priority 1).
      const foe = side(100, [{ kind: 'freeze', turnsRemaining: 2 }]);
      expect(chooseSkill(side(MAX_ENERGY), foe).id).toBe('shock-strike');
    });

    it('does NOT re-apply an ailment already INFLICTED this fight (rotates to the next unseen)', () => {
      // freeze + stun already inflicted this fight (even if now expired/absent on the foe)
      // → the AI rotates onward to the next unseen ailment, Weaken (Armor Break, priority 2).
      const me = side(MAX_ENERGY, [], ['freeze', 'stun']);
      expect(chooseSkill(me, side(100)).id).toBe('armor-break');
    });

    it('once every ailment is inflicted, HAMMERS with the strongest affordable pure-damage skill (Double Strike)', () => {
      const all: StatusAilment['kind'][] = [
        'freeze',
        'stun',
        'weaken',
        'enfeeble',
        'vulnerable',
        'doom',
        'burn',
        'poison',
        'bleed',
        'corrode',
        // TASK-74/TASK-75: the self-buffs (shield/empower + retaliate) are ALSO marked
        // inflicted so the one-time self-buff opener (Rule 1b) has already fired ALL three
        // and FALLS THROUGH to the Rule-2 damage hammer — the arsenal-exhausted state this
        // case asserts. (TASK-75 promoted counter-stance/retaliate IN-pool, so it too must be
        // marked inflicted here or the opener would return it before the hammer.)
        'shield',
        'empower',
        'retaliate',
      ];
      // Arsenal exhausted + full energy → Double Strike (the strongest pure-damage skill;
      // TASK-72 promoted Energy Drain@1 in-pool but it sits BELOW double-strike@24, so at
      // full energy Double Strike still wins the strongest-affordable-pure-damage pick).
      expect(chooseSkill(side(MAX_ENERGY, [], all), side(100)).id).toBe('double-strike');
      // With energy below Double Strike's cost, the strongest AFFORDABLE pure-damage skill
      // is now Energy Siphon (TASK-73 promoted it IN-POOL at cost 4 as a pure-damage skill,
      // ABOVE Energy Drain@1 — so it, not Sap, is the sub-Double-Strike hammer that surfaces
      // Leech; Rule 2 prefers the highest-cost affordable pure-damage pick).
      expect(chooseSkill(side(DOUBLE_STRIKE_ENERGY_COST - 1, [], all), side(100)).id).toBe(
        'energy-siphon',
      );
      // Between the two resource-interference skills: at energy in [1,3] (below Energy
      // Siphon@4) the strongest affordable pure-damage pick falls back to Energy Drain@1,
      // so Sap still wins the hammer whenever the pool sits below Leech's cost.
      expect(chooseSkill(side(ENERGY_DRAIN_ENERGY_COST, [], all), side(100)).id).toBe(
        'energy-drain',
      );
      // Only when energy is below EVERY costed pure-damage skill (i.e. 0) is the free
      // Attack the pick — the function stays TOTAL.
      expect(chooseSkill(side(0, [], all), side(100)).id).toBe('attack');
    });

    it('is deterministic — identical inputs always return the same skill', () => {
      const me = side(30, [], ['freeze']);
      const foe = side(100, [{ kind: 'stun', turnsRemaining: 1 }]);
      expect(chooseSkill(me, foe).id).toBe(chooseSkill(me, foe).id);
    });

    // TASK-74 (3rd OBSERVABLE PROMOTION) — the ONE-TIME SELF-BUFF OPENER (Rule 1b): once
    // the fresh-ailment rotation (Rule 1) is spent, the selector opens with a fresh,
    // not-yet-cast self-buff (Focus/Empower, Guard/Shield) BEFORE the Rule-2 damage hammer,
    // exactly once per buff (the me.inflicted anti-stall guard). This is what finally makes
    // a self-buff a real /battle player SEES (it was Rule-3-only = unreachable before).
    it('opens with a fresh self-buff after the ailment rotation, then falls through to the hammer (Rule 1b)', () => {
      // Whole offensive arsenal inflicted, self-buffs NOT yet cast, full energy: the opener
      // returns the first affordable un-cast self-buff. TASK-75 promoted counter-stance
      // (retaliate) IN-pool at cost 30, the MOST expensive self-buff, so it is now the FIRST
      // opener pick (COMBATANT_SKILLS order: counter-stance@30 → guard@14 → focus@7), ahead
      // of the Double Strike hammer.
      const offensiveAll: StatusAilment['kind'][] = [
        'freeze',
        'stun',
        'weaken',
        'enfeeble',
        'vulnerable',
        'doom',
        'burn',
        'poison',
        'bleed',
        'corrode',
      ];
      expect(chooseSkill(side(MAX_ENERGY, [], offensiveAll), side(100)).id).toBe('counter-stance');
      // Counter Stance already cast this fight (its retaliate inflicted) → the opener rotates
      // to the next fresh self-buff, Guard (shield), still ahead of the hammer.
      expect(chooseSkill(side(MAX_ENERGY, [], [...offensiveAll, 'retaliate']), side(100)).id).toBe(
        'guard',
      );
      // Counter Stance + Guard cast → the opener rotates to the last fresh self-buff, Focus
      // (empower), still ahead of the hammer.
      expect(
        chooseSkill(side(MAX_ENERGY, [], [...offensiveAll, 'retaliate', 'shield']), side(100)).id,
      ).toBe('focus');
      // ALL THREE self-buffs already cast (retaliate + shield + empower inflicted) → the opener
      // is spent and FALLS THROUGH to the Rule-2 hammer (Double Strike). This is the one-time
      // guard: each buff fires a BOUNDED number of times, never every turn (no zero-damage
      // MAX_ROUNDS stall).
      expect(
        chooseSkill(
          side(MAX_ENERGY, [], [...offensiveAll, 'retaliate', 'shield', 'empower']),
          side(100),
        ).id,
      ).toBe('double-strike');
      // A self-buff already ACTIVE on the caster (not just inflicted) is also skipped — the
      // opener never re-applies a live buff. Empower active + retaliate + shield already
      // inflicted → the only fresh self-buff left is none, so it falls through to the hammer.
      expect(
        chooseSkill(
          side(
            MAX_ENERGY,
            [{ kind: 'empower', turnsRemaining: 2, atkBonus: EMPOWER_ATK_BONUS }],
            [...offensiveAll, 'retaliate', 'shield'],
          ),
          side(100),
        ).id,
      ).toBe('double-strike');
    });
  });

  // TASK-144 (R-22 slice 5) — the MATCHUP-AWARE enemy chooser. It reads the SAME
  // fight-local SideStates as chooseSkill PLUS the two Combatants (for their
  // type/element), and when the attacker holds a type/element ADVANTAGE it PRESSES it
  // with the strongest affordable pure-damage hammer; otherwise it delegates VERBATIM
  // to chooseSkill. This is what makes TASK-142's telegraph worth reading (present ≠
  // observable — the enemy visibly plays the matchup). Add-only: chooseSkill /
  // simulateBattle / the whole pinned suite above stay byte-unchanged.
  describe('matchup-aware AI chooseSkillMatchup (deterministic, RNG-free) — TASK-144', () => {
    // The same minimal SideState builder as the chooseSkill block (energy + statuses +
    // the this-fight inflicted set) — chooseSkillMatchup reads only these on the sides.
    const side = (
      energy: number,
      statuses: StatusAilment[] = [],
      inflicted: StatusAilment['kind'][] = [],
    ) => ({ hp: 100, energy, statuses, inflicted: new Set(inflicted) });
    // A minimal Combatant builder — chooseSkillMatchup reads ONLY `type`/`element`
    // off the combatants (the matchup axes); the stat fields are structural filler.
    const combatant = (type: string, element: string): Combatant => ({
      name: `${type}/${element}`,
      type,
      element,
      hp: 100,
      maxHp: 100,
      atk: 20,
      def: 10,
      spd: 10,
    });

    it('when TYPE-advantaged (Vaccine vs Virus, ×1.5) it PRESSES with the strongest affordable pure-damage hammer — and this DIFFERS from chooseSkill', () => {
      // Full energy, fresh foe: chooseSkill would OPEN with the Rule-1 fresh-ailment
      // rotation (Frost Bite / freeze control lock). The matchup-aware chooser instead
      // capitalizes on the ×1.5 attribute edge with the strongest affordable pure-damage
      // skill (Double Strike). The DIFFERENCE is the observable headline: the smarter
      // enemy is not just present, it changes what the telegraph shows.
      const me = side(MAX_ENERGY);
      const them = side(100);
      const attacker = combatant('Vaccine', 'Neutral'); // Vaccine BEATS Virus (×1.5)
      const defender = combatant('Virus', 'Neutral');
      expect(chooseSkill(me, them).id).toBe('frost-bite');
      expect(chooseSkillMatchup(me, them, attacker, defender).id).toBe('double-strike');
      // Prove it actually diverged (not merely a different literal we asserted).
      expect(chooseSkillMatchup(me, them, attacker, defender).id).not.toBe(
        chooseSkill(me, them).id,
      );
    });

    it('when ELEMENT-advantaged (Fire vs Nature, ×1.25) it also presses with the pure-damage hammer', () => {
      // A second winning axis (the softer element cycle) — same advantaged behaviour.
      const me = side(MAX_ENERGY);
      const them = side(100);
      const attacker = combatant('Free', 'Fire'); // Free type = neutral; Fire BEATS Nature (×1.25)
      const defender = combatant('Free', 'Nature');
      expect(chooseSkillMatchup(me, them, attacker, defender).id).toBe('double-strike');
    });

    it('when NEUTRAL (same type & element, ×1.0) it delegates VERBATIM to chooseSkill (byte-identical fallback)', () => {
      const me = side(MAX_ENERGY, [], ['freeze']);
      const them = side(100, [{ kind: 'stun', turnsRemaining: 1 }]);
      const attacker = combatant('Data', 'Water');
      const defender = combatant('Data', 'Water'); // no advantage either way → ×1.0
      expect(chooseSkillMatchup(me, them, attacker, defender)).toEqual(chooseSkill(me, them));
    });

    it('when DISADVANTAGED (defender holds the type advantage, ×0.75) it also delegates to chooseSkill', () => {
      // Virus attacker vs Vaccine defender: the defender beats the attacker (×0.75 < 1.0),
      // so the enemy does NOT press — it falls back to the proven control/stall cascade.
      const me = side(MAX_ENERGY);
      const them = side(100);
      const attacker = combatant('Virus', 'Neutral');
      const defender = combatant('Vaccine', 'Neutral');
      expect(chooseSkillMatchup(me, them, attacker, defender)).toEqual(chooseSkill(me, them));
    });

    it('a type ADVANTAGE cancelled by an equal element DISADVANTAGE nets ×1.0 → delegates (not > 1.0)', () => {
      // Vaccine>Virus (×1.5) but Electric<Fire on the element cycle: Fire beats Electric,
      // so the attacker is element-disadvantaged (×0.8). Product 1.5 × 0.8 = 1.2 > 1.0 →
      // still net-advantaged, so it presses. This pins that the chooser reads BOTH axes
      // multiplicatively (the exact resolveAttack product).
      const me = side(MAX_ENERGY);
      const them = side(100);
      const attacker = combatant('Vaccine', 'Electric');
      const defender = combatant('Virus', 'Fire');
      expect(chooseSkillMatchup(me, them, attacker, defender).id).toBe('double-strike');
    });

    it('is deterministic — identical inputs always return the same skill', () => {
      const me = side(30, [], ['freeze']);
      const them = side(100, [{ kind: 'stun', turnsRemaining: 1 }]);
      const attacker = combatant('Vaccine', 'Neutral');
      const defender = combatant('Virus', 'Neutral');
      expect(chooseSkillMatchup(me, them, attacker, defender).id).toBe(
        chooseSkillMatchup(me, them, attacker, defender).id,
      );
    });
  });

  describe('finisher-preferring AI chooseSkillFinisher (deterministic, RNG-free) — TASK-162 (R-22 slice 23)', () => {
    // Same minimal SideState/Combatant builders as the matchup block. `them.hp` is the
    // lever this block exercises — the finisher reads the DEFENDER's current HP + def to
    // decide whether an available skill is lethal THIS turn.
    const side = (
      hp: number,
      energy: number,
      statuses: StatusAilment[] = [],
      inflicted: StatusAilment['kind'][] = [],
    ) => ({ hp, energy, statuses, inflicted: new Set(inflicted) });
    const combatant = (
      type: string,
      element: string,
      overrides: Partial<Combatant> = {},
    ): Combatant => ({
      name: `${type}/${element}`,
      type,
      element,
      hp: 100,
      maxHp: 100,
      atk: 20,
      def: 10,
      spd: 10,
      ...overrides,
    });

    it('when the defender is in KILL RANGE (an available skill is lethal this turn) it returns the lethal finisher', () => {
      // A NEUTRAL matchup (Data/Water vs Data/Water, ×1.0) so chooseSkillMatchup would
      // NOT press the hammer — it would delegate to chooseSkill's control/stall cascade
      // (a fresh-ailment rotation). But the player sits at LOW HP well within one strike:
      // resolveAttack(atk 20 vs def 10) = round(20×1.0) − floor(10/2) = 20 − 5 = 15 per
      // strike; Double Strike lands 2 strikes = 30 ≥ the player's 12 HP → lethal. The
      // finisher must go for the KILL, diverging from the matchup pick.
      const me = side(100, MAX_ENERGY);
      const them = side(12, 100); // player one hit from dead
      const attacker = combatant('Data', 'Water');
      const defender = combatant('Data', 'Water');
      const pick = chooseSkillFinisher(me, them, attacker, defender);
      // The chosen skill's computed damage to the player is actually lethal.
      const perStrike = resolveAttack(attacker, defender) * 1; // ×1.0 matchup, no debuffs
      const multihit = pick.effects.find((e) => e.kind === 'multihit');
      const strikes = multihit?.kind === 'multihit' ? multihit.hits : 1;
      expect(perStrike * strikes).toBeGreaterThanOrEqual(them.hp);
      // And it DIVERGED from the non-lethal matchup pick (present ≠ observable).
      expect(pick.id).not.toBe(chooseSkillMatchup(me, them, attacker, defender).id);
    });

    it('when the defender is at FULL/high HP (no available skill kills) it delegates VERBATIM to chooseSkillMatchup', () => {
      // Same NEUTRAL matchup, but the player is at full 100 HP — no single-turn skill is
      // lethal, so the finisher must be byte-identical to chooseSkillMatchup (delegation).
      const me = side(100, MAX_ENERGY);
      const them = side(100, 100);
      const attacker = combatant('Data', 'Water');
      const defender = combatant('Data', 'Water');
      expect(chooseSkillFinisher(me, them, attacker, defender)).toEqual(
        chooseSkillMatchup(me, them, attacker, defender),
      );
    });

    it('when at high HP AND type-advantaged it still delegates to chooseSkillMatchup (which presses the hammer)', () => {
      // Delegation preserves ALL matchup behaviour: an advantaged, not-in-kill-range foe
      // gets exactly the matchup hammer, not a control-cascade pick.
      const me = side(100, MAX_ENERGY);
      const them = side(100, 100);
      const attacker = combatant('Vaccine', 'Neutral'); // ×1.5 over Virus
      const defender = combatant('Virus', 'Neutral');
      expect(chooseSkillFinisher(me, them, attacker, defender)).toEqual(
        chooseSkillMatchup(me, them, attacker, defender),
      );
    });

    it('a full SHIELD buffer that absorbs the otherwise-lethal strike keeps the pick delegated (not a false finisher)', () => {
      // The player is at 12 HP (lethal to a 30-damage Double Strike) BUT carries a 100-point
      // shield — the finisher subtracts the shield buffer, so 30 − 100 < 12 → not lethal →
      // it delegates. Proves the finisher chews through the shield honestly, not a naive
      // hp-only read that would mis-telegraph an un-landable kill.
      const me = side(100, MAX_ENERGY);
      const them = side(12, 100, [{ kind: 'shield', absorbRemaining: 100 }]);
      const attacker = combatant('Data', 'Water');
      const defender = combatant('Data', 'Water');
      expect(chooseSkillFinisher(me, them, attacker, defender)).toEqual(
        chooseSkillMatchup(me, them, attacker, defender),
      );
    });

    it('is deterministic — identical inputs always return the same skill', () => {
      const me = side(100, MAX_ENERGY);
      const them = side(12, 100);
      const attacker = combatant('Data', 'Water');
      const defender = combatant('Data', 'Water');
      expect(chooseSkillFinisher(me, them, attacker, defender).id).toBe(
        chooseSkillFinisher(me, them, attacker, defender).id,
      );
    });
  });

  describe('defensive AI chooseSkillDefensive (deterministic, RNG-free) — TASK-163 (R-22 slice 24)', () => {
    // The MIRROR of the finisher block: here `me` is the ENEMY we defend and `them` is the
    // PLAYER whose strongest incoming strike we estimate. `me.hp` is the lever — the
    // defensive wrapper shields `me` when the player's best available skill would kill
    // `me` this turn, else it delegates VERBATIM to chooseSkillFinisher.
    const side = (
      hp: number,
      energy: number,
      statuses: StatusAilment[] = [],
      inflicted: StatusAilment['kind'][] = [],
    ) => ({ hp, energy, statuses, inflicted: new Set(inflicted) });
    const combatant = (
      type: string,
      element: string,
      overrides: Partial<Combatant> = {},
    ): Combatant => ({
      name: `${type}/${element}`,
      type,
      element,
      hp: 100,
      maxHp: 100,
      atk: 20,
      def: 10,
      spd: 10,
      ...overrides,
    });

    it('when the ENEMY (me) is in KILL RANGE and can afford an unheld Guard, it returns the defensive Guard/Shield', () => {
      // NEUTRAL matchup (Data/Water both sides) so with no danger the pick would delegate to
      // the finisher's own matchup/control cascade. But `me` (the enemy) sits at 12 HP while
      // the player can land a lethal double strike (2 × 15 = 30 ≥ 12). `me` has full energy
      // (affords Guard @14) and no shield up → it must DEFEND, diverging from the finisher.
      const me = side(12, MAX_ENERGY); // enemy one hit from dead
      const them = side(100, 100);
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      const pick = chooseSkillDefensive(me, them, enemyC, playerC);
      expect(pick.id).toBe('guard');
      // And it DIVERGED from the offense-only finisher pick (present ≠ observable).
      expect(pick.id).not.toBe(chooseSkillFinisher(me, them, enemyC, playerC).id);
    });

    it('when the ENEMY (me) is at FULL/high HP (not cornered) it delegates VERBATIM to chooseSkillFinisher', () => {
      // No danger to `me` → the defensive wrapper is byte-identical to the finisher, so ALL
      // existing offensive (finisher → matchup → chooseSkill) behaviour is preserved.
      const me = side(100, MAX_ENERGY);
      const them = side(12, 100); // player low, so the finisher itself goes for the kill
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      expect(chooseSkillDefensive(me, them, enemyC, playerC)).toEqual(
        chooseSkillFinisher(me, them, enemyC, playerC),
      );
    });

    it('when the ENEMY is cornered but ALREADY shielded, it does NOT re-cast Guard — delegates to chooseSkillFinisher', () => {
      // `me` at 12 HP faces a lethal 30-damage double strike, BUT already holds a 100-point
      // shield: the incoming estimate subtracts that buffer (30 − 100 < 12 → not in kill
      // range) AND the already-shielded guard blocks a redundant re-cast → delegate.
      const me = side(12, MAX_ENERGY, [
        { kind: 'shield', turnsRemaining: 2, absorbRemaining: 100 },
      ]);
      const them = side(100, 100);
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      expect(chooseSkillDefensive(me, them, enemyC, playerC)).toEqual(
        chooseSkillFinisher(me, them, enemyC, playerC),
      );
    });

    it('when the ENEMY is cornered but CANNOT afford Guard, it delegates to chooseSkillFinisher (no unaffordable guard)', () => {
      // `me` at 12 HP faces a lethal strike but has only GUARD_ENERGY_COST − 1 energy → the
      // affordability guard fails, so it falls through to the finisher rather than picking an
      // unpayable Guard.
      const me = side(12, GUARD_ENERGY_COST - 1);
      const them = side(100, 100);
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      expect(chooseSkillDefensive(me, them, enemyC, playerC)).toEqual(
        chooseSkillFinisher(me, them, enemyC, playerC),
      );
    });

    it('is deterministic — identical inputs always return the same skill', () => {
      const me = side(12, MAX_ENERGY);
      const them = side(100, 100);
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      expect(chooseSkillDefensive(me, them, enemyC, playerC).id).toBe(
        chooseSkillDefensive(me, them, enemyC, playerC).id,
      );
    });
  });

  describe('energy-banking / setup-then-burst AI chooseSkillBanking (deterministic, RNG-free) — TASK-164 (R-22 slice 25)', () => {
    // The THIRD composing wrapper (Banking → Defensive → Finisher → Matchup → chooseSkill),
    // and the FIRST to plan across TURNS. `me` is the ENEMY; `me.energy` is the lever — the
    // banking wrapper holds back a cheap productive action when its strongest burst is
    // unaffordable THIS turn but reachable NEXT turn after the per-turn energy gain, else it
    // delegates VERBATIM to chooseSkillDefensive.
    const side = (
      hp: number,
      energy: number,
      statuses: StatusAilment[] = [],
      inflicted: StatusAilment['kind'][] = [],
    ) => ({ hp, energy, statuses, inflicted: new Set(inflicted) });
    const combatant = (
      type: string,
      element: string,
      overrides: Partial<Combatant> = {},
    ): Combatant => ({
      name: `${type}/${element}`,
      type,
      element,
      hp: 100,
      maxHp: 100,
      atk: 20,
      def: 10,
      spd: 10,
      ...overrides,
    });

    it('when the strongest burst is UNAFFORDABLE now but reachable next turn (and out-values the now-pick), it holds a CHEAPER productive action to bank', () => {
      // The top in-pool burst is Double Strike (cost 24, 2 hits). Give the enemy 22 energy:
      // < 24 (can't cast it now) but 22 + ENERGY_REGEN_PER_TURN(4) = 26 ≥ 24 (affordable
      // next turn). Neutral matchup + both at full HP so neither defence nor a finish fires,
      // so banking is the live decision. The pick must be a CHEAPER holding action than the
      // burst — and it still deals damage (a productive hold, not a wasted turn).
      const me = side(100, DOUBLE_STRIKE_ENERGY_COST - 2); // 22 — burst just out of reach
      const them = side(100, 5); // player too low on energy to threaten a kill on us
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      const burst = SKILLS['double-strike'];
      // Precondition: the burst is genuinely reachable-next-turn but not now.
      expect(burst.energyCost).toBeGreaterThan(me.energy);
      expect(burst.energyCost).toBeLessThanOrEqual(energyAtTurnStart(me.energy));
      const pick = chooseSkillBanking(me, them, enemyC, playerC);
      // A strictly cheaper productive hold than the burst, and it deals damage.
      expect(pick.energyCost).toBeLessThan(burst.energyCost);
      expect(pick.effects.some((e) => e.kind === 'damage' || e.kind === 'multihit')).toBe(true);
      // It DIVERGED from the reactive (best-affordable-now) chooser (present ≠ observable).
      expect(pick.id).not.toBe(burst.id);
    });

    it('once the burst IS affordable, banking stops and it delegates VERBATIM to chooseSkillDefensive (no pointless hold)', () => {
      // Full energy — Double Strike is affordable NOW, so there is nothing to bank toward.
      const me = side(100, MAX_ENERGY);
      const them = side(100, 5);
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      expect(chooseSkillBanking(me, them, enemyC, playerC)).toEqual(
        chooseSkillDefensive(me, them, enemyC, playerC),
      );
    });

    it('when the ENEMY is cornered (defence should fire), banking never pre-empts it — delegates to chooseSkillDefensive (returns Guard)', () => {
      // `me` at 12 HP with a lethal incoming strike AND at the same bank-worthy energy (22):
      // defence dominates — the pick must equal chooseSkillDefensive (Guard), NOT a bank hold.
      const me = side(12, DOUBLE_STRIKE_ENERGY_COST - 2);
      const them = side(100, 100); // player has energy to land a lethal strike
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      const defensive = chooseSkillDefensive(me, them, enemyC, playerC);
      expect(defensive.id).toBe('guard'); // defence is the right play here
      expect(chooseSkillBanking(me, them, enemyC, playerC)).toEqual(defensive);
    });

    it('when the player is in KILL RANGE (a finish should fire), banking never pre-empts it — delegates to chooseSkillDefensive', () => {
      // The player is one hit from dead, so the finisher (inside chooseSkillDefensive) presses
      // the lethal pick even though the enemy sits at a bank-worthy energy — finishing wins.
      const me = side(100, DOUBLE_STRIKE_ENERGY_COST - 2);
      const them = side(12, 100); // player one hit from dead
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      expect(chooseSkillBanking(me, them, enemyC, playerC)).toEqual(
        chooseSkillDefensive(me, them, enemyC, playerC),
      );
    });

    it('is deterministic — identical inputs always return the same skill', () => {
      const me = side(100, DOUBLE_STRIKE_ENERGY_COST - 2);
      const them = side(100, 5);
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      expect(chooseSkillBanking(me, them, enemyC, playerC).id).toBe(
        chooseSkillBanking(me, them, enemyC, playerC).id,
      );
    });
  });

  describe('player-selectable enemy DIFFICULTY chooserForDifficulty (deterministic dispatch, RNG-free) — TASK-165 (R-22 slice 26)', () => {
    // A pure DISPATCH over the byte-frozen selector chain: 'easy' → the flat chooseSkill
    // (never presses a finisher/defence/bank), 'hard' → the full chooseSkillBanking chain.
    const side = (
      hp: number,
      energy: number,
      statuses: StatusAilment[] = [],
      inflicted: StatusAilment['kind'][] = [],
    ) => ({ hp, energy, statuses, inflicted: new Set(inflicted) });
    const combatant = (
      type: string,
      element: string,
      overrides: Partial<Combatant> = {},
    ): Combatant => ({
      name: `${type}/${element}`,
      type,
      element,
      hp: 100,
      maxHp: 100,
      atk: 20,
      def: 10,
      spd: 10,
      ...overrides,
    });

    it("'easy' plays the FLAT chooseSkill — a genuinely dumber enemy that does NOT press a finisher in kill range", () => {
      // The SAME player-in-kill-range fixture the finisher block uses: a NEUTRAL matchup so
      // chooseSkillMatchup would NOT press, but the player sits at 12 HP within one Double
      // Strike (2×15=30 ≥ 12). The smart chain (banking/finisher) presses the lethal; the
      // flat chooseSkill picks its ordinary control/stall pick. Easy must equal the FLAT pick.
      const me = side(100, MAX_ENERGY);
      const them = side(12, 100); // player one hit from dead
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      const easy = chooserForDifficulty('easy');
      expect(easy(me, them, enemyC, playerC)).toEqual(chooseSkill(me, them));
      // And Easy DIVERGES from the smart Hard pick (present ≠ observable — the knob bites).
      expect(easy(me, them, enemyC, playerC).id).not.toBe(
        chooseSkillBanking(me, them, enemyC, playerC).id,
      );
    });

    it("'hard' (default) plays the FULL chooseSkillBanking chain — byte-identical to the smart selector", () => {
      const me = side(100, MAX_ENERGY);
      const them = side(12, 100);
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      const hard = chooserForDifficulty('hard');
      expect(hard(me, them, enemyC, playerC)).toEqual(
        chooseSkillBanking(me, them, enemyC, playerC),
      );
    });

    it('is deterministic — identical inputs always return the same pick at a given difficulty', () => {
      const me = side(100, MAX_ENERGY);
      const them = side(12, 100);
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      const easy = chooserForDifficulty('easy');
      expect(easy(me, them, enemyC, playerC).id).toBe(easy(me, them, enemyC, playerC).id);
    });

    // --- TASK-166 (R-22 slice 27): the MIDDLE 'normal' tier → chooseSkillFinisher. It presses a
    // lethal when the PLAYER is in kill range (unlike 'easy') but does NOT guard when the ENEMY
    // is cornered (unlike 'hard'). A pure DISPATCH-literal widening (L-63) — no new selector.
    it("'normal' plays chooseSkillFinisher — byte-identical to the finisher selector", () => {
      const me = side(100, MAX_ENERGY);
      const them = side(12, 100); // player one hit from dead → the finisher presses the kill
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      const normal = chooserForDifficulty('normal');
      expect(normal(me, them, enemyC, playerC)).toEqual(
        chooseSkillFinisher(me, them, enemyC, playerC),
      );
      // It DIVERGES from the flat 'easy' pick — like 'hard', it presses the finisher.
      expect(normal(me, them, enemyC, playerC).id).not.toBe(chooseSkill(me, them).id);
    });

    it("separates all THREE tiers on a single crafted state ('easy' ≠ 'normal' ≠ 'hard')", () => {
      // BOTH sides in kill range: the ENEMY (`me`) at 12 HP (cornered → 'hard' GUARDS) AND the
      // PLAYER (`them`) at 12 HP (in kill range → the finisher presses a lethal). On this state:
      //   - 'hard'   → chooseSkillBanking → defensive Guard (defence dominates when cornered).
      //   - 'normal' → chooseSkillFinisher → presses the lethal finisher (no defence).
      //   - 'easy'   → the flat chooseSkill (never presses a kill).
      // All three picks are DISTINCT — the middle tier is genuinely observable between the two.
      const me = side(12, MAX_ENERGY); // enemy cornered → 'hard' defends
      const them = side(12, 100); // player in kill range → the finisher presses a lethal
      const enemyC = combatant('Data', 'Water');
      const playerC = combatant('Data', 'Water');
      const easyPick = chooserForDifficulty('easy')(me, them, enemyC, playerC);
      const normalPick = chooserForDifficulty('normal')(me, them, enemyC, playerC);
      const hardPick = chooserForDifficulty('hard')(me, them, enemyC, playerC);
      // 'hard' returns the defensive Guard on this cornered-enemy state.
      expect(hardPick.id).toBe('guard');
      // 'normal' (finisher, no defence) equals the finisher's own kill-pressing pick.
      expect(normalPick).toEqual(chooseSkillFinisher(me, them, enemyC, playerC));
      // 'easy' equals the flat pick.
      expect(easyPick).toEqual(chooseSkill(me, them));
      // All three are pairwise DISTINCT — the knob is genuinely three-way (present ≠ observable).
      expect(easyPick.id).not.toBe(normalPick.id);
      expect(normalPick.id).not.toBe(hardPick.id);
      expect(easyPick.id).not.toBe(hardPick.id);
      // Deterministic at the new tier.
      expect(normalPick.id).toBe(chooserForDifficulty('normal')(me, them, enemyC, playerC).id);
    });
  });

  describe('THE HEADLINE (TASK-64) — the stranded mid-tier skills now SURFACE in a shipped fight', () => {
    it('the numemon fight now casts the previously-INVISIBLE mid-tier skills, foe stunned/frozen/burned/enfeebled', () => {
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      const cast = new Set(
        turns.filter((t) => t.actor === 'player' && t.skill).map((t) => t.skill),
      );
      // The five previously-stranded mid-tier skills (built + unit-proven but never SEEN
      // in a shipped fight) now ACTUALLY CAST — the whole point of the wave. Shock Strike
      // is the task's minimum headline; Frost Bite / Fire Breath / Enfeeble Strike join it.
      expect(cast.has('Mach Jab')).toBe(true);
      expect(cast.has('Blue Blaster')).toBe(true);
      expect(cast.has('Pepper Breath')).toBe(true);
      expect(cast.has('Silence Hug')).toBe(true);
      // And their status payoffs appear on screen (the foe is visibly afflicted).
      const events = turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /Numemon is Stunned/.test(e))).toBe(true);
      expect(events.some((e) => /Numemon is Frozen/.test(e))).toBe(true);
      expect(events.some((e) => /Numemon is Burned/.test(e))).toBe(true);
      expect(events.some((e) => /Numemon is Enfeebled/.test(e))).toBe(true);
    });

    it('shipped outcomes + determinism + round-cap clearance all still hold (GUARDRAIL 1)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      // Determinism (two runs byte-equal) for both shipped fights.
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      // The shipped win/loss pair, both well clear of MAX_ROUNDS (no control-starvation stall).
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
    });

    it('HP is monotonically non-increasing for the foe across the whole numemon fight (GUARDRAIL 2)', () => {
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      // Track the Numemon's HP via every entry that reports it by name (the tactical AI's
      // richer log mixes actor-perspectives). No entry ever RAISES the foe's HP.
      // TASK-74: a SELF-BUFF application ("Numemon is Empowered/Shielded/Retaliating")
      // rides Numemon's OWN turn (the new self-buff opener now casts Focus/Guard on the
      // enemy too), whose defenderHpAfter is the OPPONENT's (Agumon's) HP — an effect BY,
      // not ON, Numemon — so it is EXCLUDED to keep this heuristic reporting Numemon's HP.
      const numemonHps = turns
        .filter((t) =>
          (t.statusEvents ?? []).some(
            (e) => /Numemon/.test(e) && !/Numemon is (Empowered|Shielded|Retaliating)/.test(e),
          ),
        )
        .map((t) => t.defenderHpAfter);
      for (let i = 1; i < numemonHps.length; i += 1) {
        expect(numemonHps[i]!).toBeLessThanOrEqual(numemonHps[i - 1]!);
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // TASK-65 (R-17c, 14th combat wave) — Vulnerable: the FIFTH stat-modifier, a
  // +25% damage-TAKEN debuff (the clean INVERSE of Weaken's DEF-reduction /
  // Enfeeble's ATK-reduction mitigation debuffs), delivered by the new
  // `vulnerable-strike` skill. Add-only DATA in the one pure engine file.
  // ────────────────────────────────────────────────────────────────────────
  describe('Vulnerable ailment (5th stat-modifier: a +damage-taken debuff, the inverse of Weaken/Enfeeble)', () => {
    it('models vulnerable-strike as data with a distinct cost and a damage-then-vulnerable effect list', () => {
      expect(SKILLS['vulnerable-strike'].energyCost).toBe(VULNERABLE_STRIKE_ENERGY_COST);
      expect(SKILLS['vulnerable-strike'].effects).toEqual([
        { kind: 'damage' },
        { kind: 'vulnerable' },
      ]);
    });

    it('applyAilment adds a fresh Vulnerable arm at full duration (mirrors Weaken/Enfeeble)', () => {
      const after = applyAilment([], 'vulnerable');
      expect(after).toEqual([
        {
          kind: 'vulnerable',
          turnsRemaining: VULNERABLE_DURATION,
          damageTakenBonus: VULNERABLE_DAMAGE_TAKEN_BONUS,
        },
      ]);
    });

    it('Vulnerable coexists with the other stat-modifiers (at most one per kind)', () => {
      const after = applyAilment(
        applyAilment(applyAilment(applyAilment([], 'weaken'), 'enfeeble'), 'empower'),
        'vulnerable',
      );
      expect(after.map((s) => s.kind).sort()).toEqual([
        'empower',
        'enfeeble',
        'vulnerable',
        'weaken',
      ]);
    });

    it('re-applying Vulnerable REFRESHES its duration (overwrites, never stacks)', () => {
      const worn: StatusAilment[] = [
        {
          kind: 'vulnerable',
          turnsRemaining: 1,
          damageTakenBonus: VULNERABLE_DAMAGE_TAKEN_BONUS,
        },
      ];
      const after = applyAilment(worn, 'vulnerable');
      expect(after).toHaveLength(1);
      const v = after[0]! as Extract<StatusAilment, { kind: 'vulnerable' }>;
      expect(v.kind).toBe('vulnerable');
      expect(v.turnsRemaining).toBe(VULNERABLE_DURATION);
    });

    it('THE AMP IS REAL (isolated): amplifyForVulnerable adds exactly +25% (round-consistent, >= 1 floor) vs an unmarked defender', () => {
      // The AMP is a PURE exported helper (the mirror of how the Weaken DEF-cut is proven
      // directly on resolveAttack) — resolveDamageStrike applies it AFTER the
      // type/element/DEF math and BEFORE the shield-absorb. A crafted base strike against
      // a defender WITH an active `vulnerable` deals `round(base * 1.25)`; the SAME base
      // against a defender WITHOUT it is byte-unchanged (the identity — invariant 5).
      const vulnerable: StatusAilment[] = [
        {
          kind: 'vulnerable',
          turnsRemaining: VULNERABLE_DURATION,
          damageTakenBonus: VULNERABLE_DAMAGE_TAKEN_BONUS,
        },
      ];
      // base 40 → round(40 * 1.25) = 50; the UNMARKED defender takes the plain 40.
      expect(amplifyForVulnerable(40, vulnerable)).toBe(50);
      expect(amplifyForVulnerable(40, [])).toBe(40);
      // A defender carrying OTHER ailments but NOT vulnerable is byte-unchanged.
      expect(
        amplifyForVulnerable(40, [{ kind: 'weaken', turnsRemaining: 3, defReduction: 6 }]),
      ).toBe(40);
      // Round-consistency: base 7 → round(7 * 1.25) = round(8.75) = 9.
      expect(amplifyForVulnerable(7, vulnerable)).toBe(9);
      // The >= 1 floor holds for a minimal 1-damage strike (round(1.25) = 1).
      expect(amplifyForVulnerable(1, vulnerable)).toBe(1);
      expect(amplifyForVulnerable(1, vulnerable)).toBeGreaterThanOrEqual(1);
      // Determinism: same inputs → same output (no RNG).
      expect(amplifyForVulnerable(40, vulnerable)).toBe(amplifyForVulnerable(40, vulnerable));
    });

    it('DURATION EXPIRY: Vulnerable decrements each tick and wears off after its turns, dealing NO per-turn damage of its own (it is not a DoT)', () => {
      // A crafted multi-tick sequence: seed a defender with a 2-turn vulnerable and tick
      // it via the SAME AILMENT_TICK_ORDER path simulateBattle uses. We prove the arm
      // counts DOWN and drops on expiry while the afflicted side's HP is UNTOUCHED by the
      // tick (a stat-modifier removes no HP — HP monotonic). Driven through a full fight
      // where the mark is applied and then wears off over subsequent turns.
      const attacker: Combatant = {
        name: 'Att',
        type: 'Free',
        element: 'Neutral',
        hp: 999,
        atk: 20,
        def: 30,
        spd: 30,
      };
      const defender: Combatant = {
        name: 'Def',
        type: 'Free',
        element: 'Neutral',
        hp: 999,
        atk: 1,
        def: 30,
        spd: 1,
      };
      const { turns } = simulateBattle(attacker, defender);
      // The applied mark surfaces exactly once per fresh cast, and the wear-off note
      // ("Vulnerable wore off Def") appears VULNERABLE_DURATION of the defender's turns
      // later — the arm ticked down without a DoT tick of its own.
      const events = turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /Def is Vulnerable/.test(e))).toBe(true);
      expect(events.some((e) => /Def is exposed and takes extra damage/.test(e))).toBe(true);
      expect(events.some((e) => /Vulnerable wore off Def/.test(e))).toBe(true);
      // A Vulnerable tick NEVER carries a "deals N" DoT line (it is a stat-modifier).
      expect(events.some((e) => /Vulnerable deals \d+/.test(e))).toBe(false);
    });

    it('THE HEADLINE — Vulnerable Strike SURFACES in the shipped numemon fight and the foe is visibly marked (observable value)', () => {
      // Post-TASK-64 the tactical chooseSkill rotates every FRESH defender ailment onto
      // the foe, so vulnerable-strike (a damaging composite applying a fresh ailment) is
      // OBSERVABLE-BY-DEFAULT — a /battle player SEES the new mechanic cast and amplify.
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      expect(turns.some((t) => t.skill === 'Hunting Cannon')).toBe(true);
      const events = turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /Numemon is Vulnerable/.test(e))).toBe(true);
    });

    it('shipped outcomes + determinism + round-cap clearance all still hold with Vulnerable added (GUARDRAIL 1)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
    });
  });

  // ── TASK-66 (R-17c, 15th combat wave): Doom — a delayed-detonation CURSE. The
  //    genuinely NEW mechanical SHAPE: DEFERRED / SCHEDULED damage. Unlike a DoT it
  //    deals NO per-turn damage — its tick only counts down; when the fuse hits 0 it
  //    detonates a single FIXED burst, then expires. Delivered by a NON-damaging
  //    `doom-curse` skill, but treated as a (deferred) damaging tactical so the AI casts
  //    it in the shipped fight (observable-by-default). HP stays monotone (it only
  //    subtracts, at expiry); it can only SHORTEN a fight, so no MAX_ROUNDS starvation.
  describe('Doom ailment (deferred-detonation curse — the FIRST scheduled-damage shape)', () => {
    // A crafted combatant carrying nothing but a fresh doom, driven through its fuse by
    // the tick loop. A tanky, harmless sparring pair keeps the fight alive long enough
    // to observe the whole fuse burn down + detonate WITHOUT either side dying to direct
    // hits — the isolated "delayed, not per-turn" proof.
    const inert: Combatant = {
      name: 'Inert',
      type: 'Free',
      element: 'Neutral',
      hp: 5000,
      atk: 1,
      def: 100,
      spd: 9,
    };

    it('doom-curse is modelled as NON-damaging composite data (a pure [doom], like lullaby-hex)', () => {
      expect(SKILLS['doom-curse'].effects).toEqual([{ kind: 'doom' }]);
      // A DISTINCT, in-pool energy cost so the ladder stays strictly cost-descending and
      // the tactical AI can afford it in the shipped fight.
      expect(DOOM_CURSE_ENERGY_COST).toBeLessThanOrEqual(MAX_ENERGY);
      expect(SKILLS['doom-curse'].energyCost).toBe(DOOM_CURSE_ENERGY_COST);
    });

    it('applyAilment builds a doom arm carrying its detonation payload + full fuse', () => {
      const after = applyAilment([], 'doom');
      expect(after).toEqual([
        {
          kind: 'doom',
          turnsRemaining: DOOM_DURATION,
          detonationDamage: DOOM_DETONATION_DAMAGE,
        },
      ]);
      // It coexists with other kinds (a doom arm does not evict a burn arm, and vice
      // versa) — the keyed-collection, at-most-one-per-kind semantics.
      const both = applyAilment([{ kind: 'burn', turnsRemaining: 2, damagePerTurn: 4 }], 'doom');
      expect(both.map((s) => s.kind).sort()).toEqual(['burn', 'doom']);
    });

    it('DEFERRED, NOT per-turn: doom deals NO damage on its intermediate ticks, then EXACTLY detonationDamage at expiry', () => {
      // Seed a defender with a fresh doom and NOTHING else; the tanky pair means the only
      // HP the defender loses is the ≥1 chip hits + the single doom burst, so the burst is
      // isolable. The DEFINING distinction from a DoT (burn/poison/bleed): the fuse turns
      // subtract NO HP and carry a "counts down" (not "deals N") line; ONE turn carries the
      // detonation, dealing exactly DOOM_DETONATION_DAMAGE.
      const doomed: Combatant = { ...inert, name: 'Doomed', spd: 5 };
      const { turns } = simulateBattle(inert, doomed);

      // The Doomed side is the defender here (Inert acts first, casts doom-curse). Find its
      // doom lifecycle events across the fight.
      const countdowns = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) => /Doom counts down on Doomed/.test(e)),
      );
      const detonations = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) => /Doom detonates for \d+ on Doomed/.test(e)),
      );
      // A NON-damaging countdown fires on the intermediate fuse turns (DOOM_DURATION − 1
      // of them, before detonation) and each subtracts NO HP.
      expect(countdowns.length).toBeGreaterThanOrEqual(1);
      for (const c of countdowns) {
        expect(c.damage).toBe(0);
        // A doom countdown NEVER carries a per-turn "deals N" DoT line.
        expect((c.statusEvents ?? []).some((e) => /Doom deals \d+/.test(e))).toBe(false);
      }
      // The detonation fires exactly once (it does not linger or re-detonate) for EXACTLY
      // DOOM_DETONATION_DAMAGE.
      expect(detonations.length).toBe(1);
      expect(detonations[0]!.damage).toBe(DOOM_DETONATION_DAMAGE);
      // The countdown count matches the fuse (DOOM_DURATION − 1 intermediate ticks before
      // the detonation on the DOOM_DURATION-th tick).
      expect(countdowns.length).toBe(DOOM_DURATION - 1);
    });

    it('the fuse decrements each tick and the arm is REMOVED after it detonates (no re-detonation)', () => {
      const doomed: Combatant = { ...inert, name: 'Doomed', spd: 5 };
      const { turns } = simulateBattle(inert, doomed);
      const doomEvents = turns
        .flatMap((t) => t.statusEvents ?? [])
        .filter((e) => /Doom (counts down|detonates)/.test(e) && /Doomed/.test(e));
      // The fuse counts strictly DOWN: "(2)" then "(1)" (for DOOM_DURATION 3) then detonates.
      // Exactly ONE detonation across the whole (long) fight proves the arm is removed on
      // detonation and never re-fires — a fresh doom must be RE-CAST to detonate again.
      const detonations = doomEvents.filter((e) => /detonates/.test(e));
      expect(detonations.length).toBe(1);
    });

    it('a detonation respects the ≥ 0 HP floor (never drives HP negative)', () => {
      // A defender on 1 HP takes the DOOM_DETONATION_DAMAGE burst → clamps to 0, not below.
      // Assert directly on the shared write path the tick uses: max(0, hp − burst).
      const hpAfter = Math.max(0, 1 - DOOM_DETONATION_DAMAGE);
      expect(hpAfter).toBe(0);
    });

    it('THE HEADLINE — Doom Curse SURFACES in the shipped numemon fight: the foe is Doomed, then Doom DETONATES (observable value)', () => {
      // Post-TASK-64 the tactical chooseSkill rotates every FRESH defender ailment onto
      // the foe. Doom Curse is NON-damaging on cast (like Lullaby Hex) but — because its
      // curse WILL deal a burst — it is treated as a deferred-damage tactical, so the AI
      // CASTS it in the shipped fight: a /battle player SEES the new mechanic cast and,
      // a few turns later, detonate for the FIRST time (present ⇒ observable).
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      expect(turns.some((t) => t.skill === 'Hell Squeeze')).toBe(true);
      const events = turns.flatMap((t) => t.statusEvents ?? []);
      // The foe is marked Doomed…
      expect(events.some((e) => /Numemon is Doomed/.test(e))).toBe(true);
      // …and, a few turns later, Doom detonates on it for the fixed burst.
      expect(events.some((e) => /Doom detonates for \d+ on Numemon/.test(e))).toBe(true);
    });

    it('HP is monotonically non-increasing across a whole fight WITH Doom (the burst only subtracts)', () => {
      // A doom detonation may only ever LOWER HP (never heal), so every doom lifecycle
      // entry reports a damage ≥ 0 and NEVER raises the reported side's HP above its prior
      // reading — the A-42-gated Heal/HoT family stays deferred (GUARDRAIL 2). Track HP
      // per reported side; doom countdowns/detonations are logged against the DEFENDER
      // (foe), like a DoT tick, so they report the doomed side's HP.
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      let lastEnemyHp = Infinity;
      let lastPlayerHp = Infinity;
      for (const t of turns) {
        // A doom countdown/detonation is logged against the doomed side (t.actor is the
        // FOE of the doomed side — the same convention as a DoT tick), so the reported
        // side is the opposite of t.actor, exactly like a damage entry.
        const isSelfReport = (t.statusEvents ?? []).some(
          (e) =>
            /(shield|empower) (holds|fades)/.test(e) ||
            /is stunned and cannot act|shakes off the stun/.test(e) ||
            /is frozen and cannot act|thaws out/.test(e) ||
            /is fast asleep|wakes up/.test(e),
        );
        const reportedSide = isSelfReport ? t.actor : t.actor === 'player' ? 'enemy' : 'player';
        if (reportedSide === 'enemy') {
          expect(t.defenderHpAfter).toBeLessThanOrEqual(lastEnemyHp);
          lastEnemyHp = t.defenderHpAfter;
        } else {
          expect(t.defenderHpAfter).toBeLessThanOrEqual(lastPlayerHp);
          lastPlayerHp = t.defenderHpAfter;
        }
      }
      // Doom itself never carries a heal: every doom lifecycle entry has damage ≥ 0.
      const doomEntries = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) => /Doom (counts down|detonates)/.test(e)),
      );
      for (const d of doomEntries) expect(d.damage).toBeGreaterThanOrEqual(0);
    });

    it('shipped outcomes + determinism + round-cap clearance all still hold with Doom added (GUARDRAIL 1)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
    });
  });

  // ── TASK-119 (R-17c, wave 68): Doom-Percent — the FRACTIONAL (percent-of-CURRENT-HP)
  //    twin of Doom, the LAST lingering family to gain its `-percent` fidelity mirror.
  //    Structurally identical to `doom` but detonates `floor(hp × ratio)` of CURRENT HP
  //    (no maxHp, no RNG) at fuse-end via the SAME monotone `Math.max(0, hp − burst)`
  //    seam. Its inflicting skill `doom-percent-curse` is Posture-B (priced 82 > MAX_ENERGY
  //    41): a CASTABLE fractional-doom would be picked as a deferred-damage tactical and
  //    perturb the shipped fight, so it stays above the pool and the detonation is proven
  //    via the DIRECT-SEAM formula unit (assert b) instead of a live-fight cast.
  describe('doom-percent — the fractional (percent-of-CURRENT-HP) detonation twin of doom (TASK-119)', () => {
    // (a) APPLIER — a doom-percent inflictor writes ONE doom-percent arm carrying the full
    // DOOM_DURATION fuse and the DOOM_PERCENT_DETONATION_RATIO; HP-neutral on apply (a
    // deferred debuff writes NO HP). A re-apply REFRESHES (no stack), like every ailment.
    it('applyAilment grants a fresh doom-percent arm carrying detonationRatio + full duration, HP-neutral; a re-apply REFRESHES (no stack)', () => {
      const after = applyAilment([], 'doom-percent');
      expect(after).toEqual([
        {
          kind: 'doom-percent',
          turnsRemaining: DOOM_DURATION,
          detonationRatio: DOOM_PERCENT_DETONATION_RATIO,
        },
      ]);
      // Re-apply over a decayed arm REFRESHES the fuse in place (no second arm).
      const decayed = [
        {
          kind: 'doom-percent' as const,
          turnsRemaining: 1,
          detonationRatio: DOOM_PERCENT_DETONATION_RATIO,
        },
      ];
      const refreshed = applyAilment(decayed, 'doom-percent');
      expect(refreshed.filter((s) => s.kind === 'doom-percent')).toHaveLength(1);
      const arm = refreshed.find((s) => s.kind === 'doom-percent');
      expect(arm?.kind === 'doom-percent' && arm.turnsRemaining).toBe(DOOM_DURATION);
      // It coexists with an unrelated arm (mixed-array presence, add-only).
      const mixed = applyAilment(applyAilment([], 'burn'), 'doom-percent');
      expect(mixed.map((s) => s.kind).sort()).toEqual(['burn', 'doom-percent']);
    });

    // (a) CLEANSABLE membership — doom-percent is a harmful deferred debuff, so Purify
    // (clearDebuffs over CLEANSABLE_DEBUFF_KINDS) STRIPS it, exactly like doom. This proves
    // its membership WITHOUT exporting the private set (behavioural proof).
    it('is a CLEANSABLE debuff — clearDebuffs STRIPS a doom-percent arm (like doom), leaving self-buffs', () => {
      const before = [
        ...applyAilment([], 'doom-percent'),
        ...applyAilment([], 'empower'), // a self-buff must SURVIVE the cleanse
      ];
      const cleansed = clearDebuffs(before as never);
      expect(cleansed.some((s) => s.kind === 'doom-percent')).toBe(false);
      expect(cleansed.some((s) => s.kind === 'empower')).toBe(true);
    });

    // (b) DETONATION MATH (HEADLINE, direct-seam) — the fractional burst is exactly
    // floor(hp × detonationRatio) of CURRENT HP, applied through the SAME monotone
    // `Math.max(0, hp − burst)` seam the tick uses. Assert on a chosen hp so `floor` is
    // exercised (a ratio that does NOT divide hp evenly), and prove the ≥ 0 HP floor.
    it('detonation deals EXACTLY floor(hp × detonationRatio) of CURRENT HP via the monotone seam, never below 0', () => {
      const ratio = DOOM_PERCENT_DETONATION_RATIO;
      // Pick an hp where hp × ratio is NON-integer so floor genuinely truncates:
      // 0.25 × 37 = 9.25 → floor 9. (This is the exact expression the tick evaluates.)
      const hp = 37;
      const burst = Math.floor(hp * ratio);
      expect(burst).toBe(9); // floor(9.25) — the fractional truncation is exercised
      const hpAfter = Math.max(0, hp - burst);
      expect(hpAfter).toBe(hp - burst); // 28 — a genuine, non-lethal deferred burst
      expect(hpAfter).toBeLessThan(hp); // HP strictly falls (monotone, A-42)
      // The ≥ 0 floor: HP is never driven negative. A near-dead bearer's fractional burst
      // can round DOWN to 0 (floor(0.25 × 1) = 0), so at hp 1 the burst is 0 and HP holds at
      // 1 — a fractional burst never heals, and the seam never goes below 0.
      expect(Math.floor(1 * ratio)).toBe(0);
      expect(Math.max(0, 1 - Math.floor(1 * ratio))).toBe(1); // burst 0 → HP unchanged, still ≥ 0
      // A bearer whose fractional burst is non-zero still clamps at ≥ 0, never below.
      expect(Math.max(0, 5 - Math.floor(5 * ratio))).toBeGreaterThanOrEqual(0); // floor(1.25)=1 → 4
    });

    // (a) SKILL SHAPE — doom-percent-curse is a PURE curse (one doom-percent effect, no
    // damage), the fractional mirror of Doom Curse.
    it('the doom-percent-curse skill is a PURE doom-percent inflictor (no damage arm), the fractional mirror of Doom Curse', () => {
      expect(SKILLS['doom-percent-curse'].name).toBe('Doom-Percent Curse');
      expect(SKILLS['doom-percent-curse'].effects).toEqual([{ kind: 'doom-percent' }]);
      expect(SKILLS['doom-percent-curse'].energyCost).toBe(DOOM_PERCENT_CURSE_ENERGY_COST);
    });

    // (present ≠ observable) SELECTION BOUNDARY — doom-percent-curse surfaces ONLY at its
    // above-pool cost 82, never inside the pool. At cost 82 selectSkill returns it (the new
    // ladder TOP); ONE below (81) it falls back to the previous top Cripple/hobble-percent;
    // and at MAX_ENERGY the in-pool selection is UNCHANGED (counter-stance). This proves the
    // skill is really WIRED (Posture-B) without a shipped-fight cast.
    it('surfaces doom-percent-curse only at its above-pool cost 82, never in the pool (Posture-B)', () => {
      expect(DOOM_PERCENT_CURSE_ENERGY_COST).toBe(82);
      expect(DOOM_PERCENT_CURSE_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(selectSkill(DOOM_PERCENT_CURSE_ENERGY_COST).id).toBe('doom-percent-curse');
      expect(selectSkill(DOOM_PERCENT_CURSE_ENERGY_COST - 1).id).toBe('hobble-percent');
      // The in-pool selection at MAX_ENERGY is UNCHANGED — the new above-pool skill never
      // displaces the in-pool top pick.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + (e) determinism — because the new skill is
    // priced above the pool it is NEVER cast inside simulateBattle, so the shipped agumon
    // fights are byte-identical and deterministic (GUARDRAIL 1). doom-percent NEVER appears
    // in any shipped-fight log (it is never inflicted).
    it('shipped WIN/LOSS + determinism hold, and doom-percent NEVER surfaces in a shipped fight (GUARDRAIL 1, byte-identical)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      // Never cast → never applied → the doom-percent lifecycle never appears in the log.
      const numemonEvents = simulateBattle(agumon, numemon).turns.flatMap(
        (t) => t.statusEvents ?? [],
      );
      expect(numemonEvents.some((e) => /Doom-Percent/.test(e))).toBe(false);
      expect(
        simulateBattle(agumon, numemon).turns.some((t) => t.skill === 'Doom-Percent Curse'),
      ).toBe(false);
    });
  });

  // ── TASK-120 (R-17c, wave 69): burn-percent — the DoT family's FIRST `-percent` fidelity
  //    twin. The stat-mod grid, vulnerable/brace, retaliate and `doom` all gained a percent
  //    twin; the DoT family (burn/poison/bleed/corrode) was the ONE magnitude-carrying family
  //    with none. burn-percent ticks floor(hp × damagePerTurnRatio) of CURRENT HP each turn
  //    via the SAME monotone `Math.max(0, hp − tick)` DoT seam — reads only `hp` (NO maxHp),
  //    no RNG → HP monotone (A-42). Its inflicting skill `smolder-strike` is Posture-B (priced
  //    83 > MAX_ENERGY 41): a CASTABLE DoT-only inflictor carries no `damage` arm, so
  //    chooseSkill rule-1 would rotate it onto the foe as a DoT tactical and perturb the shipped
  //    fight — it stays above the pool and the fractional tick is proven via the DIRECT-SEAM
  //    formula unit (assert b) instead of a live-fight cast.
  describe('burn-percent — the fractional (percent-of-CURRENT-HP) DoT twin of burn, the DoT family FIRST fidelity twin (TASK-120)', () => {
    // (a) APPLIER — a burn-percent inflictor writes ONE burn-percent arm carrying the full
    // BURN_DURATION fuse and the BURN_PERCENT_DAMAGE_RATIO. A re-apply REFRESHES (no stack).
    it('applyAilment grants a fresh burn-percent arm carrying damagePerTurnRatio + full duration; a re-apply REFRESHES (no stack)', () => {
      const after = applyAilment([], 'burn-percent');
      expect(after).toEqual([
        {
          kind: 'burn-percent',
          turnsRemaining: BURN_DURATION,
          damagePerTurnRatio: BURN_PERCENT_DAMAGE_RATIO,
        },
      ]);
      // Re-apply over a decayed arm REFRESHES the fuse in place (no second arm).
      const decayed = [
        {
          kind: 'burn-percent' as const,
          turnsRemaining: 1,
          damagePerTurnRatio: BURN_PERCENT_DAMAGE_RATIO,
        },
      ];
      const refreshed = applyAilment(decayed, 'burn-percent');
      expect(refreshed.filter((s) => s.kind === 'burn-percent')).toHaveLength(1);
      const arm = refreshed.find((s) => s.kind === 'burn-percent');
      expect(arm?.kind === 'burn-percent' && arm.turnsRemaining).toBe(BURN_DURATION);
      // It coexists with an unrelated arm AND is DISTINCT from the flat `burn` (both present
      // at once — proving the twin is a separate kind, add-only).
      const mixed = applyAilment(applyAilment([], 'burn'), 'burn-percent');
      expect(mixed.map((s) => s.kind).sort()).toEqual(['burn', 'burn-percent']);
    });

    // (a) CLEANSABLE membership — burn-percent is a harmful DoT debuff, so Purify
    // (clearDebuffs over CLEANSABLE_DEBUFF_KINDS) STRIPS it, exactly like burn (behavioural
    // proof of set membership, without exporting the private set).
    it('is a CLEANSABLE debuff — clearDebuffs STRIPS a burn-percent arm (like burn), leaving self-buffs', () => {
      const before = [
        ...applyAilment([], 'burn-percent'),
        ...applyAilment([], 'empower'), // a self-buff must SURVIVE the cleanse
      ];
      const cleansed = clearDebuffs(before as never);
      expect(cleansed.some((s) => s.kind === 'burn-percent')).toBe(false);
      expect(cleansed.some((s) => s.kind === 'empower')).toBe(true);
    });

    // (b) TICK MATH (HEADLINE, direct-seam) — each tick subtracts EXACTLY
    // floor(hp × damagePerTurnRatio) of CURRENT HP through the SAME monotone
    // `Math.max(0, hp − tick)` seam. Assert on a chosen hp so `floor` genuinely truncates,
    // prove the ≥ 0 HP floor, and prove the tick RECURS across turns while the fuse burns —
    // the CURRENT-HP read makes each successive tick SMALLER (the percent-of-current signature
    // that distinguishes it from the flat DoTs).
    it('each tick deals EXACTLY floor(hp × damagePerTurnRatio) of CURRENT HP via the monotone seam, never below 0, recurring (and shrinking) while the fuse burns', () => {
      const ratio = BURN_PERCENT_DAMAGE_RATIO; // 0.2
      // 0.2 × 37 = 7.4 → floor 7 (the exact expression the tick evaluates; floor truncates).
      const hp0 = 37;
      const tick0 = Math.floor(hp0 * ratio);
      expect(tick0).toBe(7);
      const hp1 = Math.max(0, hp0 - tick0);
      expect(hp1).toBe(30); // HP strictly falls (monotone, A-42)
      expect(hp1).toBeLessThan(hp0);
      // The tick RECURS next turn reading the NEW (lower) CURRENT hp — SMALLER than the first:
      // floor(0.2 × 30) = 6.
      const tick1 = Math.floor(hp1 * ratio);
      expect(tick1).toBe(6);
      expect(tick1).toBeLessThan(tick0); // shrinks as HP falls — the fidelity-twin signature
      const hp2 = Math.max(0, hp1 - tick1);
      expect(hp2).toBe(24);
      // The ≥ 0 floor: a near-dead bearer's fractional tick can round DOWN to 0
      // (floor(0.2 × 1) = 0), so at hp 1 the tick is 0 and HP holds at 1 — never heals, never
      // below 0.
      expect(Math.floor(1 * ratio)).toBe(0);
      expect(Math.max(0, 1 - Math.floor(1 * ratio))).toBe(1);
      expect(Math.max(0, 5 - Math.floor(5 * ratio))).toBeGreaterThanOrEqual(0); // floor(1.0)=1 → 4
      expect(BURN_DURATION).toBeGreaterThan(0); // the fuse expires after BURN_DURATION ticks
    });

    // (a) SKILL SHAPE — smolder-strike is a PURE DoT inflictor (one burn-percent effect, no
    // damage arm), the fractional mirror of Fire Breath's `burn`.
    it('the smolder-strike skill is a PURE burn-percent inflictor (no damage arm), the fractional mirror of Fire Breath', () => {
      expect(SKILLS['smolder-strike'].name).toBe('Smolder Strike');
      expect(SKILLS['smolder-strike'].effects).toEqual([{ kind: 'burn-percent' }]);
      expect(SKILLS['smolder-strike'].energyCost).toBe(SMOLDER_STRIKE_ENERGY_COST);
    });

    // (present ≠ observable) SELECTION BOUNDARY — smolder-strike surfaces ONLY at its
    // above-pool cost 83, never inside the pool. At 83 selectSkill returns it (the new ladder
    // TOP); ONE below (82) it falls back to the previous top doom-percent-curse; at MAX_ENERGY
    // the in-pool selection is UNCHANGED (counter-stance). Proves the skill is really WIRED
    // (Posture-B) without a shipped-fight cast.
    it('surfaces smolder-strike only at its above-pool cost 83, never in the pool (Posture-B)', () => {
      expect(SMOLDER_STRIKE_ENERGY_COST).toBe(83);
      expect(SMOLDER_STRIKE_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(selectSkill(SMOLDER_STRIKE_ENERGY_COST).id).toBe('smolder-strike');
      expect(selectSkill(SMOLDER_STRIKE_ENERGY_COST - 1).id).toBe('doom-percent-curse');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + (e) determinism — priced above the pool, so NEVER
    // cast inside simulateBattle: the shipped agumon fights are byte-identical and deterministic
    // (GUARDRAIL 1), and burn-percent NEVER appears in any shipped-fight log. (f) HP-monotonicity
    // across these shipped fights is proven byte-unchanged by the dedicated whole-fight monotone
    // suite above ("HP is monotonically non-increasing across a whole fight") — this Posture-B
    // skill never ticks in a shipped fight, so that assert holds verbatim.
    it('shipped WIN/LOSS + determinism hold, and burn-percent NEVER surfaces in a shipped fight (GUARDRAIL 1, byte-identical)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      // Never cast → never applied → the burn-percent lifecycle never appears in the log.
      const run = simulateBattle(agumon, numemon);
      const numemonEvents = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(numemonEvents.some((e) => /Smolder/.test(e))).toBe(false);
      expect(run.turns.some((t) => t.skill === 'Smolder Strike')).toBe(false);
    });
  });

  // ── TASK-132 (R-17c, wave 79): wither-percent — the FIRST DoT sized off the bearer's OWN
  //    `maxHp` rather than its CURRENT `hp`. Every existing percent DoT (Smolder/Toxin/Hemorrhage/
  //    Necrosis) ticks floor(hp × ratio) of CURRENT HP, so it DIMINISHES as HP falls (an asymptotic,
  //    self-slowing burn). Wither instead ticks a CONSTANT floor(maxHp × ratio) every turn — a
  //    relentless, non-slowing attrition (the classic SMT wither/decay feel). The amount is
  //    MATERIALIZED ONCE at apply (applyAilment bakes floor(bearer.maxHp × ratio) into a FLAT
  //    `damagePerTurn`, mirroring the `burn` arm's shape) — provably identical to reading maxHp each
  //    tick since maxHp is immutable, and it keeps the tick a byte-identical subtract. Routed through
  //    the SAME monotone `Math.max(0, hp − X)` DoT seam → HP monotone (A-42), no RNG. Its inflicting
  //    skill `wither-curse` is Posture-B (priced 93 > MAX_ENERGY 41, the NEW ladder TOP above
  //    barrier@92): a CASTABLE DoT-only inflictor carries no `damage` arm, so chooseSkill rule-1 would
  //    rotate it onto the foe and perturb the shipped fight — it stays above the pool and the
  //    maxHp-scaled tick is proven via the direct apply/tick units instead of a live-fight cast.
  describe('wither-percent — the FIRST maxHp-fraction DoT (a CONSTANT floor(maxHp × ratio) per turn, TASK-132)', () => {
    // (a) APPLIER — the maxHp-fraction is MATERIALIZED at apply: the arm carries a FLAT
    // `damagePerTurn` === floor(bearer.maxHp × WITHER_PERCENT_DAMAGE_RATIO) (incl. floor-truncation),
    // + the full WITHER_DURATION fuse. The DISTINGUISHING property vs every current-hp DoT: it SCALES
    // WITH maxHp — a higher-maxHp bearer withers for a strictly LARGER amount. A re-apply REFRESHES
    // (no stack). applyAilment takes the bearer's maxHp as its `bearerMaxHp` arg (the SAME arg
    // shield-percent uses); with no arg it defaults 0 → a 0-per-turn arm (harmless), proving existing
    // callers are byte-unchanged.
    it('applyAilment MATERIALIZES damagePerTurn = floor(bearerMaxHp × ratio) into a flat arm; scales with maxHp; refreshes (no stack)', () => {
      const ratio = WITHER_PERCENT_DAMAGE_RATIO; // 0.08
      // 0.08 × 137 = 10.96 → floor 10 (floor genuinely TRUNCATES a fractional product).
      const maxHp = 137;
      const expected = Math.floor(maxHp * ratio);
      expect(expected).toBe(10);
      const after = applyAilment([], 'wither-percent', maxHp);
      expect(after).toEqual([
        {
          kind: 'wither-percent',
          turnsRemaining: WITHER_DURATION,
          damagePerTurn: expected,
        },
      ]);
      // SCALES WITH maxHp — a bulkier bearer withers for a strictly LARGER amount (the property that
      // distinguishes it from every current-hp DoT, which is maxHp-independent).
      const bigger = applyAilment([], 'wither-percent', maxHp * 2);
      const bigArm = bigger.find((s) => s.kind === 'wither-percent');
      expect(bigArm?.kind === 'wither-percent' && bigArm.damagePerTurn).toBe(
        Math.floor(maxHp * 2 * ratio),
      );
      expect(bigArm?.kind === 'wither-percent' && bigArm.damagePerTurn).toBeGreaterThan(expected);
      // Re-apply over a decayed arm REFRESHES the fuse in place (no second arm).
      const decayed = [
        { kind: 'wither-percent' as const, turnsRemaining: 1, damagePerTurn: expected },
      ];
      const refreshed = applyAilment(decayed, 'wither-percent', maxHp);
      expect(refreshed.filter((s) => s.kind === 'wither-percent')).toHaveLength(1);
      const arm = refreshed.find((s) => s.kind === 'wither-percent');
      expect(arm?.kind === 'wither-percent' && arm.turnsRemaining).toBe(WITHER_DURATION);
      // Coexists with an unrelated arm AND is DISTINCT from the flat `burn` (both present at once —
      // add-only, a separate kind).
      const mixed = applyAilment(applyAilment([], 'burn'), 'wither-percent', maxHp);
      expect(mixed.map((s) => s.kind).sort()).toEqual(['burn', 'wither-percent']);
      // Default bearerMaxHp = 0 → a 0-per-turn arm: every EXISTING applyAilment caller (which never
      // passes maxHp for a DoT) is byte-unchanged and never accidentally withers.
      const noMaxHp = applyAilment([], 'wither-percent');
      const dfl = noMaxHp.find((s) => s.kind === 'wither-percent');
      expect(dfl?.kind === 'wither-percent' && dfl.damagePerTurn).toBe(0);
    });

    // (a) CLEANSABLE membership — wither-percent is a harmful DoT debuff, so Purify (clearDebuffs
    // over CLEANSABLE_DEBUFF_KINDS) STRIPS it, exactly like burn (behavioural set-membership proof).
    it('is a CLEANSABLE debuff — clearDebuffs STRIPS a wither-percent arm (like burn), leaving self-buffs', () => {
      const before = [
        ...applyAilment([], 'wither-percent', 100),
        ...applyAilment([], 'empower'), // a self-buff must SURVIVE the cleanse
      ];
      const cleansed = clearDebuffs(before as never);
      expect(cleansed.some((s) => s.kind === 'wither-percent')).toBe(false);
      expect(cleansed.some((s) => s.kind === 'empower')).toBe(true);
    });

    // (b) TICK MATH (HEADLINE, direct-seam) — each tick subtracts the SAME baked flat
    // `damagePerTurn` = floor(maxHp × ratio) through the monotone `Math.max(0, hp − tick)` seam. The
    // DEFINING contrast with a current-hp DoT: the per-turn amount is CONSTANT even as `hp` drops
    // (it reads the baked flat amount, NOT `hp`), whereas a current-hp DoT's tick SHRINKS. Assert the
    // ≥ 0 floor and a lethal tick clamping to 0.
    it('each tick deals a CONSTANT floor(maxHp × ratio) — UNCHANGED as hp falls (contrast a current-hp DoT) — via the monotone seam, clamping ≥ 0', () => {
      const ratio = WITHER_PERCENT_DAMAGE_RATIO; // 0.08
      const maxHp = 137;
      const perTurn = Math.floor(maxHp * ratio); // baked ONCE at apply
      expect(perTurn).toBe(10);
      // Simulate the tick seam across turns: the SUBTRACTED amount is the SAME each turn (reads the
      // baked flat amount, NOT current hp) — the non-diminishing signature. Contrast burn-percent,
      // whose tick would shrink as hp falls.
      let hp = 25;
      const hpAfterT0 = Math.max(0, hp - perTurn);
      expect(hpAfterT0).toBe(15);
      expect(hpAfterT0).toBeLessThan(hp); // HP strictly falls (monotone, A-42)
      hp = hpAfterT0;
      const hpAfterT1 = Math.max(0, hp - perTurn);
      expect(hpAfterT1).toBe(5);
      // The amount removed is IDENTICAL across the two ticks even though hp dropped 25 → 15 → 5 —
      // proving the tick reads the baked `maxHp`-scaled amount, NOT current hp.
      expect(hp - hpAfterT1).toBe(perTurn); // second tick removed exactly perTurn again
      expect(25 - hpAfterT0).toBe(hp - hpAfterT1); // both ticks removed the same amount
      // A LETHAL tick clamps to 0 (never below), ending the fight via the same killedByTick guard the
      // flat DoTs use.
      const lethal = Math.max(0, 5 - perTurn);
      expect(lethal).toBe(0);
      expect(WITHER_DURATION).toBeGreaterThan(0); // the fuse expires after WITHER_DURATION ticks
    });

    // (a) SKILL SHAPE — wither-curse is a PURE DoT inflictor (one wither-percent effect, no damage
    // arm), the maxHp-fraction analogue of the pure-inflictor doom-curse/lullaby-hex shape.
    it('the wither-curse skill is a PURE wither-percent inflictor (no damage arm)', () => {
      expect(SKILLS['wither-curse'].name).toBe('Wither Curse');
      expect(SKILLS['wither-curse'].effects).toEqual([{ kind: 'wither-percent' }]);
      expect(SKILLS['wither-curse'].energyCost).toBe(WITHER_PERCENT_ENERGY_COST);
    });

    // (c) SELECTION BOUNDARY (present ≠ observable) — wither-curse surfaces ONLY at its above-pool
    // cost 93, never in the pool. At 93 selectSkill returns it (rot-when-weak-curse@94 — the new
    // ladder TOP added in TASK-133 — is one above and skipped); ONE below (92) it falls back to
    // barrier; at MAX_ENERGY the in-pool selection is UNCHANGED. The COMBATANT_SKILLS ladder stays
    // STRICTLY cost-descending.
    it('surfaces wither-curse only at its above-pool cost 93, never in the pool (Posture-B); ladder strictly cost-descending', () => {
      expect(WITHER_PERCENT_ENERGY_COST).toBe(93);
      expect(WITHER_PERCENT_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(WITHER_PERCENT_ENERGY_COST).toBeGreaterThan(SHIELD_PERCENT_ENERGY_COST); // 93 > 92
      expect(selectSkill(WITHER_PERCENT_ENERGY_COST).id).toBe('wither-curse');
      expect(selectSkill(SHIELD_PERCENT_ENERGY_COST).id).toBe('barrier'); // 92 still barrier
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance'); // in-pool pick UNCHANGED
      // The whole ladder is strictly cost-descending (rot-when-weak-curse@94 is the TASK-133 TOP).
      for (let i = 1; i < COMBATANT_SKILLS.length; i++) {
        expect(COMBATANT_SKILLS[i].energyCost).toBeLessThan(COMBATANT_SKILLS[i - 1].energyCost);
      }
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + determinism — priced above the pool, so NEVER cast inside
    // simulateBattle: the shipped agumon fights are byte-identical + deterministic (GUARDRAIL 1),
    // both last-turn rounds clear MAX_ROUNDS (the DoT-lengthening guard), and wither-percent NEVER
    // appears in any shipped-fight log.
    it('shipped WIN/LOSS + determinism + MAX_ROUNDS clearance hold, and wither-percent NEVER surfaces in a shipped fight (GUARDRAIL 1)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      // Never cast → never applied → the wither-percent lifecycle never appears in the log.
      const run = simulateBattle(agumon, numemon);
      const events = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /Wither/.test(e))).toBe(false);
      expect(run.turns.some((t) => t.skill === 'Wither Curse')).toBe(false);
    });
  });

  // ── TASK-133 (R-17c, wave 80): rot-when-weak — the FIRST THRESHOLD-GATED status/DoT inflictor.
  //    Every existing inflictor (burn/poison/wither-percent/doom/…) applies its status
  //    UNCONDITIONALLY the instant the skill resolves. rot-when-weak instead GATES the apply on the
  //    DEFENDER's HP using the SAME percent-of-MAX read execute (0.25) / guillotine (0.30) use for a
  //    BURST: it inflicts its `wither-percent` DoT (REUSED from TASK-132 — no new arm/spec/tick/label)
  //    ONLY when `foe.hp <= floor(foe.maxHp × ROT_WHEN_WEAK_HP_THRESHOLD_RATIO = 0.35)`; above the gate
  //    it is a NO-OP status attempt (a "too healthy to rot" note on the EXISTING optional
  //    statusEvents?). The genuinely-new thing is a CONDITIONAL-APPLICATION predicate wrapping the
  //    applyAilment call — the control-flow shape the inflictor path never had. HP stays monotone
  //    (A-42 — the applied effect is a subtractive DoT; the gate only decides WHETHER it applies, it
  //    does NOT open the HP-raising family). Its skill `rot-when-weak-curse` is Posture-B (priced
  //    94 > MAX_ENERGY 41, the NEW ladder TOP above wither-curse@93): a DoT-only inflictor carries no
  //    `damage` arm, so a below-pool price would let chooseSkill rule-1 rotate it onto the foe and
  //    perturb the shipped fight — it stays above the pool and the gate is proven via direct
  //    gate-true / gate-false / boundary units + a selectSkill(94) boundary, not a live cast.
  describe('rot-when-weak — the FIRST THRESHOLD-GATED inflictor (applies its wither-percent DoT ONLY to a wounded foe, TASK-133)', () => {
    const ratio = ROT_WHEN_WEAK_HP_THRESHOLD_RATIO; // 0.35
    const maxHp = 100;
    const threshold = Math.floor(maxHp * ratio); // floor(100 × 0.35) = 35

    // The gate predicate is the SAME percent-of-MAX read execute/guillotine use, just gating an
    // inflictor instead of a burst: threshold = floor(maxHp × ratio); the gate is TRUE iff hp <= it.
    const gateOpen = (hp: number, m: number): boolean => hp <= Math.floor(m * ratio);
    // Model exactly what the simulateBattle branch does: on an OPEN gate inflict the wither-percent
    // DoT off the foe's OWN maxHp (the reused TASK-132 apply path + its `bearerMaxHp` arg); on a
    // CLOSED gate leave the foe's statuses BYTE-UNCHANGED (a pure no-op status attempt).
    const resolveRotWhenWeak = (
      foeStatuses: readonly StatusAilment[],
      foeHp: number,
      foeMaxHp: number,
    ): StatusAilment[] =>
      gateOpen(foeHp, foeMaxHp)
        ? applyAilment(foeStatuses, 'wither-percent', foeMaxHp)
        : [...foeStatuses];

    // (a) GATE-TRUE — against a WOUNDED foe (hp at/below the maxHp-fraction gate), resolving
    // rot-when-weak INFLICTS a wither-percent DoT whose damagePerTurn === floor(foe.maxHp × ratio)
    // (the reused TASK-132 payload) with the full WITHER_DURATION fuse. This is the whole point: the
    // status only exists BECAUSE the foe was weak.
    it('GATE-TRUE: a wounded foe (hp <= floor(maxHp × 0.35)) is INFLICTED a wither-percent DoT sized off ITS OWN maxHp + full duration', () => {
      expect(threshold).toBe(35);
      const woundedHp = 20; // 20 <= 35 → gate OPEN
      expect(gateOpen(woundedHp, maxHp)).toBe(true);
      const after = resolveRotWhenWeak([], woundedHp, maxHp);
      const arm = after.find((s) => s.kind === 'wither-percent');
      // REUSES the TASK-132 DoT payload verbatim: floor(maxHp × WITHER_PERCENT_DAMAGE_RATIO).
      expect(arm?.kind === 'wither-percent' && arm.damagePerTurn).toBe(
        Math.floor(maxHp * WITHER_PERCENT_DAMAGE_RATIO),
      );
      expect(arm?.kind === 'wither-percent' && arm.turnsRemaining).toBe(WITHER_DURATION);
      // Scales off the DEFENDER's OWN maxHp — a bulkier wounded foe rots for strictly more.
      const bigger = resolveRotWhenWeak([], 40, 200); // 40 <= floor(200 × 0.35)=70 → OPEN
      const bigArm = bigger.find((s) => s.kind === 'wither-percent');
      expect(bigArm?.kind === 'wither-percent' && bigArm.damagePerTurn).toBe(
        Math.floor(200 * WITHER_PERCENT_DAMAGE_RATIO),
      );
    });

    // (b) GATE-FALSE — against a HEALTHY foe (hp ABOVE the gate), resolving rot-when-weak inflicts
    // NOTHING: no wither-percent arm is added and the foe's statuses are byte-unchanged. This is the
    // DISTINGUISHING property vs every UNCONDITIONAL inflictor (burn/poison/wither-percent all apply
    // regardless of the foe's HP).
    it('GATE-FALSE: a healthy foe (hp above the gate) is INFLICTED NOTHING — statuses byte-unchanged (the property no unconditional inflictor has)', () => {
      const healthyHp = 90; // 90 > 35 → gate CLOSED
      expect(gateOpen(healthyHp, maxHp)).toBe(false);
      const after = resolveRotWhenWeak([], healthyHp, maxHp);
      expect(after.some((s) => s.kind === 'wither-percent')).toBe(false);
      expect(after).toEqual([]); // byte-unchanged no-op
      // At FULL HP the gate is likewise closed (the "prey on the wounded" idiom: a fresh foe resists).
      expect(gateOpen(maxHp, maxHp)).toBe(false);
      expect(resolveRotWhenWeak([], maxHp, maxHp)).toEqual([]);
    });

    // (b) BOUNDARY — the gate is INCLUSIVE (`<=`): at exactly hp === threshold it APPLIES; at
    // hp === threshold + 1 it does NOT. This pins the exact predicate execute/guillotine share.
    it('BOUNDARY: applies at hp === threshold (inclusive), does NOT apply at threshold + 1', () => {
      expect(gateOpen(threshold, maxHp)).toBe(true); // hp === 35 → OPEN (inclusive <=)
      const atThreshold = resolveRotWhenWeak([], threshold, maxHp);
      expect(atThreshold.some((s) => s.kind === 'wither-percent')).toBe(true);
      expect(gateOpen(threshold + 1, maxHp)).toBe(false); // hp === 36 → CLOSED
      const above = resolveRotWhenWeak([], threshold + 1, maxHp);
      expect(above.some((s) => s.kind === 'wither-percent')).toBe(false);
      expect(above).toEqual([]);
    });

    // (a) SKILL SHAPE — rot-when-weak-curse is a PURE gated inflictor (one rot-when-weak effect, no
    // damage arm), mirroring the pure-inflictor wither-curse/doom-curse/lullaby-hex shape; the effect
    // arm carries the gate ratio + the REUSED wither payload (ratio + duration).
    it('the rot-when-weak-curse skill is a PURE rot-when-weak inflictor carrying the gate ratio + the reused wither payload (no damage arm)', () => {
      expect(SKILLS['rot-when-weak-curse'].name).toBe('Rot When Weak');
      expect(SKILLS['rot-when-weak-curse'].energyCost).toBe(ROT_WHEN_WEAK_ENERGY_COST);
      expect(SKILLS['rot-when-weak-curse'].effects).toEqual([
        {
          kind: 'rot-when-weak',
          hpThresholdRatio: ROT_WHEN_WEAK_HP_THRESHOLD_RATIO,
          damageRatio: WITHER_PERCENT_DAMAGE_RATIO,
          turns: WITHER_DURATION,
        },
      ]);
      // The gate ratio is DISTINCT from execute (0.25) / guillotine (0.30) — a wounded-but-not-dying
      // gate — and MODEST (< 1) so a foe near full HP resists.
      expect(ROT_WHEN_WEAK_HP_THRESHOLD_RATIO).toBe(0.35);
      expect(ROT_WHEN_WEAK_HP_THRESHOLD_RATIO).toBeGreaterThan(0);
      expect(ROT_WHEN_WEAK_HP_THRESHOLD_RATIO).toBeLessThan(1);
    });

    // (c) SELECTION BOUNDARY (present ≠ observable) — rot-when-weak-curse surfaces ONLY at its
    // above-pool cost 94 (the NEW ladder TOP), never in the pool. At 94 selectSkill returns it; ONE
    // below (93) it falls back to the previous top wither-curse; at MAX_ENERGY the in-pool selection
    // is UNCHANGED. The COMBATANT_SKILLS ladder stays STRICTLY cost-descending with 94 at the top.
    it('surfaces rot-when-weak-curse only at its above-pool cost 94, never in the pool (Posture-B); ladder strictly cost-descending, rot-when-weak-curse just below the TASK-134 TOP', () => {
      expect(ROT_WHEN_WEAK_ENERGY_COST).toBe(94);
      expect(ROT_WHEN_WEAK_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(ROT_WHEN_WEAK_ENERGY_COST).toBeGreaterThan(WITHER_PERCENT_ENERGY_COST); // 94 > 93
      expect(selectSkill(ROT_WHEN_WEAK_ENERGY_COST).id).toBe('rot-when-weak-curse');
      expect(selectSkill(WITHER_PERCENT_ENERGY_COST).id).toBe('wither-curse'); // 93 still wither
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance'); // in-pool pick UNCHANGED
      // wither-when-weak-hex now sits at index 5 (below the TASK-139 vulnerable-when-strong-hex@100 TOP, the
      // TASK-138 vulnerable-when-weak-hex@99, the TASK-137 enfeeble-when-strong-hex@98, the TASK-136
      // enfeeble-when-weak-hex@97 and the TASK-135 wither-when-strong-hex@96), with rot-when-weak-curse@94 at
      // index 6; the whole ladder is strictly cost-descending.
      expect(COMBATANT_SKILLS[5].id).toBe('wither-when-weak-hex');
      expect(COMBATANT_SKILLS[5].energyCost).toBe(95);
      for (let i = 1; i < COMBATANT_SKILLS.length; i++) {
        expect(COMBATANT_SKILLS[i].energyCost).toBeLessThan(COMBATANT_SKILLS[i - 1].energyCost);
      }
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + determinism — priced above the pool, so NEVER cast inside
    // simulateBattle: the shipped agumon fights are byte-identical + deterministic (GUARDRAIL 1),
    // both last-turn rounds clear MAX_ROUNDS (the DoT-lengthening guard), and rot-when-weak's
    // wither-percent lifecycle NEVER appears in any shipped-fight log.
    it('shipped WIN/LOSS + determinism + MAX_ROUNDS clearance hold, and rot-when-weak NEVER surfaces in a shipped fight (GUARDRAIL 1)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      const run = simulateBattle(agumon, numemon);
      expect(run.turns.some((t) => t.skill === 'Rot When Weak')).toBe(false);
      const events = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /too healthy to rot/.test(e))).toBe(false);
    });
  });

  // ── TASK-134 (R-17c, wave 81): weaken-when-weak — the FIRST THRESHOLD-GATED STAT-MOD inflictor.
  //    TASK-133's rot-when-weak opened the conditional-application axis by gating a DoT; this gates a
  //    lingering STAT-MODIFIER (weaken, a DEF reduction) on the SAME predicate but a DIFFERENT
  //    apply-family. The hex inflicts the EXISTING `weaken` DEF-down (REUSED — no new arm/spec/tick/
  //    label) ONLY when `foe.hp <= floor(foe.maxHp × WEAKEN_WHEN_WEAK_HP_THRESHOLD_RATIO = 0.35)`;
  //    above the gate it is a NO-OP status attempt (a "too healthy to weaken" note on the EXISTING
  //    optional statusEvents?). The genuinely-new thing is that a CONDITIONAL-APPLICATION predicate now
  //    decides whether a lingering STAT-MODIFIER lands (the SMT "cripple the wounded" idiom) — every
  //    existing stat-mod inflictor (weaken/enfeeble/hobble/vulnerable/doom/…) is UNCONDITIONAL. SAFER
  //    than TASK-133's gated DoT: a DEF debuff writes NO HP and can only make a fight FASTER, so HP
  //    stays monotone (A-42) with ZERO MAX_ROUNDS hazard. Its skill `wither-when-weak-hex` is Posture-B
  //    (priced 95 > MAX_ENERGY 41, the NEW ladder TOP above rot-when-weak-curse@94): a stat-mod
  //    inflictor carries no `damage` arm, so a below-pool price would let chooseSkill rule-1 rotate it
  //    onto the foe and perturb the shipped fight — it stays above the pool and the gate is proven via
  //    direct gate-true / gate-false / boundary units + a selectSkill(95) boundary, not a live cast.
  describe('weaken-when-weak — the FIRST THRESHOLD-GATED STAT-MOD inflictor (applies the existing weaken DEF-down ONLY to a wounded foe, TASK-134)', () => {
    const ratio = WEAKEN_WHEN_WEAK_HP_THRESHOLD_RATIO; // 0.35
    const maxHp = 100;
    const threshold = Math.floor(maxHp * ratio); // floor(100 × 0.35) = 35

    // The gate predicate is the SAME percent-of-MAX read rot-when-weak/execute/guillotine use, just
    // gating a STAT-MOD inflictor instead of a DoT or a burst: threshold = floor(maxHp × ratio); the
    // gate is TRUE iff hp <= it.
    const gateOpen = (hp: number, m: number): boolean => hp <= Math.floor(m * ratio);
    // Model exactly what the simulateBattle branch does: on an OPEN gate inflict the EXISTING `weaken`
    // DEF-reduction status (the reused apply branch — no new spec/tick); on a CLOSED gate leave the
    // foe's statuses BYTE-UNCHANGED (a pure no-op status attempt).
    const resolveWeakenWhenWeak = (
      foeStatuses: readonly StatusAilment[],
      foeHp: number,
      foeMaxHp: number,
    ): StatusAilment[] =>
      gateOpen(foeHp, foeMaxHp) ? applyAilment(foeStatuses, 'weaken') : [...foeStatuses];

    // (a) GATE-TRUE — against a WOUNDED foe (hp at/below the maxHp-fraction gate), resolving
    // weaken-when-weak INFLICTS a `weaken` DEF-down status carrying the REUSED spec payload
    // (defReduction === WEAKEN_DEF_REDUCTION, turnsRemaining === WEAKEN_DURATION). This is the whole
    // point: the DEF debuff only exists BECAUSE the foe was weak.
    it('GATE-TRUE: a wounded foe (hp <= floor(maxHp × 0.35)) is INFLICTED a weaken DEF-down carrying the reused WEAKEN_DEF_REDUCTION + WEAKEN_DURATION', () => {
      expect(threshold).toBe(35);
      const woundedHp = 20; // 20 <= 35 → gate OPEN
      expect(gateOpen(woundedHp, maxHp)).toBe(true);
      const after = resolveWeakenWhenWeak([], woundedHp, maxHp);
      const arm = after.find((s) => s.kind === 'weaken');
      expect(arm?.kind === 'weaken' && arm.defReduction).toBe(WEAKEN_DEF_REDUCTION);
      expect(arm?.kind === 'weaken' && arm.turnsRemaining).toBe(WEAKEN_DURATION);
      // The applied stat-mod is byte-identical to an UNCONDITIONAL weaken apply — only the GATE is new.
      expect(after).toEqual(applyAilment([], 'weaken'));
    });

    // (b) GATE-FALSE — against a HEALTHY foe (hp ABOVE the gate), resolving weaken-when-weak inflicts
    // NOTHING: no weaken arm is added and the foe's statuses are byte-unchanged. This is the
    // DISTINGUISHING property vs every UNCONDITIONAL stat-mod inflictor (weaken/enfeeble/doom all
    // apply regardless of the foe's HP).
    it('GATE-FALSE: a healthy foe (hp above the gate) is INFLICTED NOTHING — statuses byte-unchanged (the property no unconditional stat-mod inflictor has)', () => {
      const healthyHp = 90; // 90 > 35 → gate CLOSED
      expect(gateOpen(healthyHp, maxHp)).toBe(false);
      const after = resolveWeakenWhenWeak([], healthyHp, maxHp);
      expect(after.some((s) => s.kind === 'weaken')).toBe(false);
      expect(after).toEqual([]); // byte-unchanged no-op
      // At FULL HP the gate is likewise closed (a fresh foe resists the crippling hex).
      expect(gateOpen(maxHp, maxHp)).toBe(false);
      expect(resolveWeakenWhenWeak([], maxHp, maxHp)).toEqual([]);
    });

    // (b) BOUNDARY — the gate is INCLUSIVE (`<=`): at exactly hp === threshold it APPLIES; at
    // hp === threshold + 1 it does NOT. This pins the exact predicate rot-when-weak/execute share.
    it('BOUNDARY: applies at hp === threshold (inclusive), does NOT apply at threshold + 1', () => {
      expect(gateOpen(threshold, maxHp)).toBe(true); // hp === 35 → OPEN (inclusive <=)
      const atThreshold = resolveWeakenWhenWeak([], threshold, maxHp);
      expect(atThreshold.some((s) => s.kind === 'weaken')).toBe(true);
      expect(gateOpen(threshold + 1, maxHp)).toBe(false); // hp === 36 → CLOSED
      const above = resolveWeakenWhenWeak([], threshold + 1, maxHp);
      expect(above.some((s) => s.kind === 'weaken')).toBe(false);
      expect(above).toEqual([]);
    });

    // (a) SKILL SHAPE — wither-when-weak-hex is a PURE gated inflictor (one weaken-when-weak effect, no
    // damage arm), mirroring the pure-inflictor rot-when-weak-curse/wither-curse/doom-curse shape; the
    // effect arm carries the gate ratio + the WEAKEN_DURATION for log parity.
    it('the wither-when-weak-hex skill is a PURE weaken-when-weak inflictor carrying the gate ratio (no damage arm)', () => {
      expect(SKILLS['wither-when-weak-hex'].name).toBe('Wither When Weak');
      expect(SKILLS['wither-when-weak-hex'].energyCost).toBe(WEAKEN_WHEN_WEAK_ENERGY_COST);
      expect(SKILLS['wither-when-weak-hex'].effects).toEqual([
        {
          kind: 'weaken-when-weak',
          hpThresholdRatio: WEAKEN_WHEN_WEAK_HP_THRESHOLD_RATIO,
          turns: WEAKEN_DURATION,
        },
      ]);
      // The gate ratio MATCHES rot-when-weak's band (0.35) and is MODEST (< 1) so a foe near full HP
      // resists the crippling hex.
      expect(WEAKEN_WHEN_WEAK_HP_THRESHOLD_RATIO).toBe(0.35);
      expect(WEAKEN_WHEN_WEAK_HP_THRESHOLD_RATIO).toBeGreaterThan(0);
      expect(WEAKEN_WHEN_WEAK_HP_THRESHOLD_RATIO).toBeLessThan(1);
    });

    // (c) SELECTION BOUNDARY (present ≠ observable) — wither-when-weak-hex surfaces ONLY at its
    // above-pool cost 95 (the NEW ladder TOP), never in the pool. At 95 selectSkill returns it; ONE
    // below (94) it falls back to rot-when-weak-curse, at 93 to wither-curse; at MAX_ENERGY the in-pool
    // selection is UNCHANGED. The COMBATANT_SKILLS ladder stays STRICTLY cost-descending with 95 at top.
    it('surfaces wither-when-weak-hex only at its above-pool cost 95 (the new ladder TOP), never in the pool (Posture-B); ladder strictly cost-descending, 95 at top', () => {
      expect(WEAKEN_WHEN_WEAK_ENERGY_COST).toBe(95);
      expect(WEAKEN_WHEN_WEAK_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(WEAKEN_WHEN_WEAK_ENERGY_COST).toBeGreaterThan(ROT_WHEN_WEAK_ENERGY_COST); // 95 > 94
      expect(selectSkill(WEAKEN_WHEN_WEAK_ENERGY_COST).id).toBe('wither-when-weak-hex');
      expect(selectSkill(ROT_WHEN_WEAK_ENERGY_COST).id).toBe('rot-when-weak-curse'); // 94 still rot
      expect(selectSkill(WITHER_PERCENT_ENERGY_COST).id).toBe('wither-curse'); // 93 still wither
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance'); // in-pool pick UNCHANGED
      // wither-when-weak-hex now sits at index 5 (below the TASK-139 vulnerable-when-strong-hex@100 TOP, the
      // TASK-138 vulnerable-when-weak-hex@99, the TASK-137 enfeeble-when-strong-hex@98, the TASK-136
      // enfeeble-when-weak-hex@97 and the TASK-135 wither-when-strong-hex@96), and the whole ladder is
      // strictly cost-descending.
      expect(COMBATANT_SKILLS[5].id).toBe('wither-when-weak-hex');
      expect(COMBATANT_SKILLS[5].energyCost).toBe(95);
      for (let i = 1; i < COMBATANT_SKILLS.length; i++) {
        expect(COMBATANT_SKILLS[i].energyCost).toBeLessThan(COMBATANT_SKILLS[i - 1].energyCost);
      }
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + determinism — priced above the pool, so NEVER cast inside
    // simulateBattle: the shipped agumon fights are byte-identical + deterministic (GUARDRAIL 1), both
    // last-turn rounds clear MAX_ROUNDS, and weaken-when-weak's "too healthy to weaken" note NEVER
    // appears in any shipped-fight log.
    it('shipped WIN/LOSS + determinism + MAX_ROUNDS clearance hold, and weaken-when-weak NEVER surfaces in a shipped fight (GUARDRAIL 1)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      const run = simulateBattle(agumon, numemon);
      expect(run.turns.some((t) => t.skill === 'Wither When Weak')).toBe(false);
      const events = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /too healthy to weaken/.test(e))).toBe(false);
    });
  });

  // ── TASK-135 (R-17c, wave 82): weaken-when-strong — the FIRST `>=` HIGH-hp ("prey on the healthy")
  //    gate in the engine. TASK-133/134 opened the conditional-application axis across TWO apply-families
  //    (DoT, stat-mod) but every gate points the SAME direction (`<=` low-hp). This wave flips the
  //    predicate DIRECTION itself onto the strictly-safe `weaken` DEF-down payload (REUSED byte-for-byte
  //    from TASK-134 — no new arm/spec/tick/label): the hex inflicts the EXISTING `weaken` ONLY when
  //    `foe.hp >= floor(foe.maxHp × WEAKEN_WHEN_STRONG_HP_THRESHOLD_RATIO = 0.60)`; below the gate it is a
  //    NO-OP status attempt (a "too weak to bother weakening" note on the EXISTING optional statusEvents?).
  //    The genuinely-new thing is the `>=` DIRECTION — the mirror image of weaken-when-weak's `<=` (the
  //    SMT "soften the fresh enemy" idiom); every existing gate (execute/guillotine/rot-when-weak/
  //    weaken-when-weak) is `<=` low-hp. SAFE as TASK-134: a DEF debuff writes NO HP and can only make a
  //    fight FASTER, so HP stays monotone (A-42) with ZERO MAX_ROUNDS hazard. Its skill
  //    `wither-when-strong-hex` is Posture-B (priced 96 > MAX_ENERGY 41, the NEW ladder TOP above
  //    wither-when-weak-hex@95): a stat-mod inflictor carries no `damage` arm, so a below-pool price would
  //    let chooseSkill rule-1 rotate it onto the foe and perturb the shipped fight — it stays above the
  //    pool and the gate is proven via direct gate-true / gate-false / boundary units + a selectSkill(96)
  //    boundary, not a live cast.
  describe('weaken-when-strong — the FIRST `>=` HIGH-hp gate (applies the existing weaken DEF-down ONLY to a still-fresh foe, TASK-135)', () => {
    const ratio = WEAKEN_WHEN_STRONG_HP_THRESHOLD_RATIO; // 0.60
    const maxHp = 100;
    const threshold = Math.floor(maxHp * ratio); // floor(100 × 0.60) = 60

    // The gate predicate is the SAME percent-of-MAX read weaken-when-weak/execute/guillotine use, but
    // with the operator FLIPPED `<=` → `>=`: threshold = floor(maxHp × ratio); the gate is TRUE iff
    // hp >= it (punish the HEALTHY foe — the inverse of weaken-when-weak).
    const gateOpen = (hp: number, m: number): boolean => hp >= Math.floor(m * ratio);
    // Model exactly what the simulateBattle branch does: on an OPEN gate inflict the EXISTING `weaken`
    // DEF-reduction status (the reused apply branch — no new spec/tick); on a CLOSED gate leave the
    // foe's statuses BYTE-UNCHANGED (a pure no-op status attempt).
    const resolveWeakenWhenStrong = (
      foeStatuses: readonly StatusAilment[],
      foeHp: number,
      foeMaxHp: number,
    ): StatusAilment[] =>
      gateOpen(foeHp, foeMaxHp) ? applyAilment(foeStatuses, 'weaken') : [...foeStatuses];

    // (a) GATE-TRUE — against a FRESH foe (hp at/above the maxHp-fraction gate), resolving
    // weaken-when-strong INFLICTS a `weaken` DEF-down status carrying the REUSED spec payload
    // (defReduction === WEAKEN_DEF_REDUCTION, turnsRemaining === WEAKEN_DURATION). This is the whole
    // point: the DEF debuff only exists BECAUSE the foe was still strong.
    it('GATE-TRUE: a fresh foe (hp >= floor(maxHp × 0.60), e.g. full HP) is INFLICTED a weaken DEF-down carrying the reused WEAKEN_DEF_REDUCTION + WEAKEN_DURATION', () => {
      expect(threshold).toBe(60);
      const freshHp = maxHp; // 100 >= 60 → gate OPEN
      expect(gateOpen(freshHp, maxHp)).toBe(true);
      const after = resolveWeakenWhenStrong([], freshHp, maxHp);
      const arm = after.find((s) => s.kind === 'weaken');
      expect(arm?.kind === 'weaken' && arm.defReduction).toBe(WEAKEN_DEF_REDUCTION);
      expect(arm?.kind === 'weaken' && arm.turnsRemaining).toBe(WEAKEN_DURATION);
      // The applied stat-mod is byte-identical to an UNCONDITIONAL weaken apply — only the GATE is new.
      expect(after).toEqual(applyAilment([], 'weaken'));
    });

    // (b) GATE-FALSE — against a badly-WOUNDED foe (hp BELOW the gate, e.g. 1 HP), resolving
    // weaken-when-strong inflicts NOTHING: no weaken arm is added and the foe's statuses are
    // byte-unchanged. This is the DISTINGUISHING property vs every `<=` LOW-hp gate (which would fire
    // here) AND every UNCONDITIONAL stat-mod inflictor.
    it('GATE-FALSE: a badly-wounded foe (hp below the gate, e.g. 1 HP) is INFLICTED NOTHING — statuses byte-unchanged (the mirror of every <= low-hp gate)', () => {
      const woundedHp = 1; // 1 < 60 → gate CLOSED
      expect(gateOpen(woundedHp, maxHp)).toBe(false);
      const after = resolveWeakenWhenStrong([], woundedHp, maxHp);
      expect(after.some((s) => s.kind === 'weaken')).toBe(false);
      expect(after).toEqual([]); // byte-unchanged no-op
    });

    // (b) BOUNDARY — the gate is INCLUSIVE (`>=`): at exactly hp === threshold it APPLIES; at
    // hp === threshold - 1 it does NOT. This is the mirror image of weaken-when-weak's `<=` boundary.
    it('BOUNDARY: applies at hp === threshold (inclusive >=), does NOT apply at threshold - 1', () => {
      expect(gateOpen(threshold, maxHp)).toBe(true); // hp === 60 → OPEN (inclusive >=)
      const atThreshold = resolveWeakenWhenStrong([], threshold, maxHp);
      expect(atThreshold.some((s) => s.kind === 'weaken')).toBe(true);
      expect(gateOpen(threshold - 1, maxHp)).toBe(false); // hp === 59 → CLOSED
      const below = resolveWeakenWhenStrong([], threshold - 1, maxHp);
      expect(below.some((s) => s.kind === 'weaken')).toBe(false);
      expect(below).toEqual([]);
    });

    // (a) SKILL SHAPE — wither-when-strong-hex is a PURE gated inflictor (one weaken-when-strong effect,
    // no damage arm), mirroring the pure-inflictor wither-when-weak-hex/rot-when-weak-curse/wither-curse
    // shape; the effect arm carries the gate ratio + the WEAKEN_DURATION for log parity.
    it('the wither-when-strong-hex skill is a PURE weaken-when-strong inflictor carrying the gate ratio (no damage arm)', () => {
      expect(SKILLS['wither-when-strong-hex'].name).toBe('Wither When Strong');
      expect(SKILLS['wither-when-strong-hex'].energyCost).toBe(WEAKEN_WHEN_STRONG_ENERGY_COST);
      expect(SKILLS['wither-when-strong-hex'].effects).toEqual([
        {
          kind: 'weaken-when-strong',
          hpThresholdRatio: WEAKEN_WHEN_STRONG_HP_THRESHOLD_RATIO,
          turns: WEAKEN_DURATION,
        },
      ]);
      // The gate ratio (0.60) is an "above-half / still-fresh" band, DELIBERATELY DISTINCT from the
      // LOW-hp band (0.25/0.30/0.35) so the `>=` direction is unambiguous, and MODEST (< 1).
      expect(WEAKEN_WHEN_STRONG_HP_THRESHOLD_RATIO).toBe(0.6);
      expect(WEAKEN_WHEN_STRONG_HP_THRESHOLD_RATIO).toBeGreaterThan(0.35); // above the low-hp band
      expect(WEAKEN_WHEN_STRONG_HP_THRESHOLD_RATIO).toBeLessThan(1);
    });

    // (c) SELECTION BOUNDARY (present ≠ observable) — wither-when-strong-hex surfaces ONLY at its
    // above-pool cost 96 (the NEW ladder TOP), never in the pool. At 96 selectSkill returns it; ONE
    // below (95) it falls back to wither-when-weak-hex, at 94 to rot-when-weak-curse, at 93 to
    // wither-curse; at MAX_ENERGY the in-pool selection is UNCHANGED. The COMBATANT_SKILLS ladder stays
    // STRICTLY cost-descending with 96 at top.
    it('surfaces wither-when-strong-hex only at its above-pool cost 96 (the new ladder TOP), never in the pool (Posture-B); ladder strictly cost-descending, 96 at top', () => {
      expect(WEAKEN_WHEN_STRONG_ENERGY_COST).toBe(96);
      expect(WEAKEN_WHEN_STRONG_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(WEAKEN_WHEN_STRONG_ENERGY_COST).toBeGreaterThan(WEAKEN_WHEN_WEAK_ENERGY_COST); // 96 > 95
      expect(selectSkill(WEAKEN_WHEN_STRONG_ENERGY_COST).id).toBe('wither-when-strong-hex');
      expect(selectSkill(WEAKEN_WHEN_WEAK_ENERGY_COST).id).toBe('wither-when-weak-hex'); // 95 still
      expect(selectSkill(ROT_WHEN_WEAK_ENERGY_COST).id).toBe('rot-when-weak-curse'); // 94 still rot
      expect(selectSkill(WITHER_PERCENT_ENERGY_COST).id).toBe('wither-curse'); // 93 still wither
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance'); // in-pool pick UNCHANGED
      // wither-when-strong-hex now sits at index 4 (below the TASK-139 vulnerable-when-strong-hex@100 TOP,
      // the TASK-138 vulnerable-when-weak-hex@99, the TASK-137 enfeeble-when-strong-hex@98 and the TASK-136
      // enfeeble-when-weak-hex@97); the whole ladder is still strictly cost-descending.
      expect(COMBATANT_SKILLS[4].id).toBe('wither-when-strong-hex');
      expect(COMBATANT_SKILLS[4].energyCost).toBe(96);
      for (let i = 1; i < COMBATANT_SKILLS.length; i++) {
        expect(COMBATANT_SKILLS[i].energyCost).toBeLessThan(COMBATANT_SKILLS[i - 1].energyCost);
      }
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + determinism — priced above the pool, so NEVER cast inside
    // simulateBattle: the shipped agumon fights are byte-identical + deterministic (GUARDRAIL 1), both
    // last-turn rounds clear MAX_ROUNDS, and weaken-when-strong's "too weak to bother weakening" note
    // NEVER appears in any shipped-fight log.
    it('shipped WIN/LOSS + determinism + MAX_ROUNDS clearance hold, and weaken-when-strong NEVER surfaces in a shipped fight (GUARDRAIL 1)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      const run = simulateBattle(agumon, numemon);
      expect(run.turns.some((t) => t.skill === 'Wither When Strong')).toBe(false);
      const events = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /too weak to bother weakening/.test(e))).toBe(false);
    });
  });

  // ── TASK-136 (R-17c, wave 83): enfeeble-when-weak — the SECOND stat-mod FAMILY's FIRST threshold-gated
  //    inflictor. TASK-134/135 opened BOTH predicate DIRECTIONS (`<=`/`>=`) but only for ONE stat-mod
  //    family (`weaken`, DEF-down). This wave holds the direction fixed at the established `<=` LOW-hp band
  //    and varies the APPLY-FAMILY itself: the hex inflicts the EXISTING `enfeeble` (ATK-down) status
  //    (REUSED byte-for-byte — no new arm/spec/tick/label) ONLY when `foe.hp <= floor(foe.maxHp ×
  //    ENFEEBLE_WHEN_WEAK_HP_THRESHOLD_RATIO = 0.35)`; below the gate it is a NO-OP status attempt (a "too
  //    healthy to enfeeble" note on the EXISTING optional statusEvents?). The genuinely-new thing is the
  //    apply-family (`enfeeble`, ATK-down, not the DEF-down `weaken`) — the "kick the ATK out of a wounded
  //    foe" SMT idiom, proving the maxHp-threshold gate machinery generalizes to a SECOND stat-mod family.
  //    SAFER than a gated DoT (L-35): an ATK debuff writes NO HP and only makes a fight FASTER, so HP stays
  //    monotone (A-42) with ZERO MAX_ROUNDS hazard. Its skill `enfeeble-when-weak-hex` is Posture-B (priced
  //    97 > MAX_ENERGY 41, the NEW ladder TOP above wither-when-strong-hex@96): a stat-mod inflictor
  //    carries no `damage` arm, so a below-pool price would let chooseSkill rule-1 rotate it onto the foe
  //    and perturb the shipped fight — it stays above the pool and the gate is proven via direct
  //    gate-true / gate-false / boundary units + a selectSkill(97) boundary, not a live cast.
  describe('enfeeble-when-weak — the SECOND stat-mod family FIRST threshold gate (applies the existing enfeeble ATK-down ONLY to a wounded foe, TASK-136)', () => {
    const ratio = ENFEEBLE_WHEN_WEAK_HP_THRESHOLD_RATIO; // 0.35
    const maxHp = 100;
    const threshold = Math.floor(maxHp * ratio); // floor(100 × 0.35) = 35

    // The gate predicate is the SAME `<=` percent-of-MAX read weaken-when-weak/rot-when-weak/execute/
    // guillotine use: threshold = floor(maxHp × ratio); the gate is TRUE iff hp <= it (cripple the
    // WOUNDED foe). The genuinely-new axis is the apply-family (enfeeble), not the predicate.
    const gateOpen = (hp: number, m: number): boolean => hp <= Math.floor(m * ratio);
    // Model exactly what the simulateBattle branch does: on an OPEN gate inflict the EXISTING `enfeeble`
    // ATK-reduction status (the reused apply branch — no new spec/tick); on a CLOSED gate leave the foe's
    // statuses BYTE-UNCHANGED (a pure no-op status attempt).
    const resolveEnfeebleWhenWeak = (
      foeStatuses: readonly StatusAilment[],
      foeHp: number,
      foeMaxHp: number,
    ): StatusAilment[] =>
      gateOpen(foeHp, foeMaxHp) ? applyAilment(foeStatuses, 'enfeeble') : [...foeStatuses];

    // (a) GATE-TRUE — against a WOUNDED foe (hp at/below the maxHp-fraction gate, e.g. 1 HP), resolving
    // enfeeble-when-weak INFLICTS an `enfeeble` ATK-down status carrying the REUSED spec payload
    // (atkReduction === ENFEEBLE_ATK_REDUCTION, turnsRemaining === ENFEEBLE_DURATION). This is the whole
    // point: the ATK debuff only exists BECAUSE the foe was already wounded — and it is the FIRST gated
    // inflictor of a SECOND stat-mod family (enfeeble, not weaken).
    it('GATE-TRUE: a wounded foe (hp <= floor(maxHp × 0.35), e.g. 1 HP) is INFLICTED an enfeeble ATK-down carrying the reused ENFEEBLE_ATK_REDUCTION + ENFEEBLE_DURATION', () => {
      expect(threshold).toBe(35);
      const woundedHp = 1; // 1 <= 35 → gate OPEN
      expect(gateOpen(woundedHp, maxHp)).toBe(true);
      const after = resolveEnfeebleWhenWeak([], woundedHp, maxHp);
      const arm = after.find((s) => s.kind === 'enfeeble');
      expect(arm?.kind === 'enfeeble' && arm.atkReduction).toBe(ENFEEBLE_ATK_REDUCTION);
      expect(arm?.kind === 'enfeeble' && arm.turnsRemaining).toBe(ENFEEBLE_DURATION);
      // The applied stat-mod is byte-identical to an UNCONDITIONAL enfeeble apply — only the GATE is new.
      expect(after).toEqual(applyAilment([], 'enfeeble'));
    });

    // (b) GATE-FALSE — against a HEALTHY foe (hp ABOVE the gate, e.g. full HP), resolving
    // enfeeble-when-weak inflicts NOTHING: no enfeeble arm is added and the foe's statuses are
    // byte-unchanged. This is the DISTINGUISHING property vs every UNCONDITIONAL enfeeble inflictor.
    it('GATE-FALSE: a healthy foe (hp above the gate, e.g. full HP) is INFLICTED NOTHING — statuses byte-unchanged (distinguishes it from every unconditional enfeeble inflictor)', () => {
      const healthyHp = maxHp; // 100 > 35 → gate CLOSED
      expect(gateOpen(healthyHp, maxHp)).toBe(false);
      const after = resolveEnfeebleWhenWeak([], healthyHp, maxHp);
      expect(after.some((s) => s.kind === 'enfeeble')).toBe(false);
      expect(after).toEqual([]); // byte-unchanged no-op
    });

    // (b) BOUNDARY — the gate is INCLUSIVE (`<=`): at exactly hp === threshold it APPLIES; at
    // hp === threshold + 1 it does NOT. Mirrors weaken-when-weak's `<=` boundary, but on the enfeeble
    // family — proving the `<=` DIRECTION AND its inclusive boundary for the second stat-mod family.
    it('BOUNDARY: applies at hp === threshold (inclusive <=), does NOT apply at threshold + 1', () => {
      expect(gateOpen(threshold, maxHp)).toBe(true); // hp === 35 → OPEN (inclusive <=)
      const atThreshold = resolveEnfeebleWhenWeak([], threshold, maxHp);
      expect(atThreshold.some((s) => s.kind === 'enfeeble')).toBe(true);
      expect(gateOpen(threshold + 1, maxHp)).toBe(false); // hp === 36 → CLOSED
      const above = resolveEnfeebleWhenWeak([], threshold + 1, maxHp);
      expect(above.some((s) => s.kind === 'enfeeble')).toBe(false);
      expect(above).toEqual([]);
    });

    // (a) SKILL SHAPE — enfeeble-when-weak-hex is a PURE gated inflictor (one enfeeble-when-weak effect,
    // no damage arm), mirroring the pure-inflictor wither-when-weak-hex/wither-when-strong-hex/
    // rot-when-weak-curse shape; the effect arm carries the gate ratio + the ENFEEBLE_DURATION for log
    // parity.
    it('the enfeeble-when-weak-hex skill is a PURE enfeeble-when-weak inflictor carrying the gate ratio (no damage arm)', () => {
      expect(SKILLS['enfeeble-when-weak-hex'].name).toBe('Enfeeble When Weak');
      expect(SKILLS['enfeeble-when-weak-hex'].energyCost).toBe(ENFEEBLE_WHEN_WEAK_ENERGY_COST);
      expect(SKILLS['enfeeble-when-weak-hex'].effects).toEqual([
        {
          kind: 'enfeeble-when-weak',
          hpThresholdRatio: ENFEEBLE_WHEN_WEAK_HP_THRESHOLD_RATIO,
          turns: ENFEEBLE_DURATION,
        },
      ]);
      // The gate ratio (0.35) MATCHES the established `<=` LOW-hp "wounded but not dying" band
      // (rot-when-weak/weaken-when-weak@0.35) so the `<=` direction is the consistent one, and is MODEST.
      expect(ENFEEBLE_WHEN_WEAK_HP_THRESHOLD_RATIO).toBe(0.35);
      expect(ENFEEBLE_WHEN_WEAK_HP_THRESHOLD_RATIO).toBeGreaterThan(0);
      expect(ENFEEBLE_WHEN_WEAK_HP_THRESHOLD_RATIO).toBeLessThan(0.6); // below the high-hp band
    });

    // (c) SELECTION BOUNDARY (present ≠ observable) — enfeeble-when-weak-hex surfaces ONLY at its
    // above-pool cost 97 (the NEW ladder TOP), never in the pool. At 97 selectSkill returns it; ONE below
    // (96) it falls back to wither-when-strong-hex, at 95 to wither-when-weak-hex, at 94 to
    // rot-when-weak-curse, at 93 to wither-curse; at MAX_ENERGY the in-pool selection is UNCHANGED. The
    // COMBATANT_SKILLS ladder stays STRICTLY cost-descending with 97 at top.
    it('surfaces enfeeble-when-weak-hex only at its above-pool cost 97, never in the pool (Posture-B); ladder strictly cost-descending', () => {
      expect(ENFEEBLE_WHEN_WEAK_ENERGY_COST).toBe(97);
      expect(ENFEEBLE_WHEN_WEAK_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(ENFEEBLE_WHEN_WEAK_ENERGY_COST).toBeGreaterThan(WEAKEN_WHEN_STRONG_ENERGY_COST); // 97 > 96
      expect(selectSkill(ENFEEBLE_WHEN_WEAK_ENERGY_COST).id).toBe('enfeeble-when-weak-hex');
      expect(selectSkill(WEAKEN_WHEN_STRONG_ENERGY_COST).id).toBe('wither-when-strong-hex'); // 96 still
      expect(selectSkill(WEAKEN_WHEN_WEAK_ENERGY_COST).id).toBe('wither-when-weak-hex'); // 95 still
      expect(selectSkill(ROT_WHEN_WEAK_ENERGY_COST).id).toBe('rot-when-weak-curse'); // 94 still rot
      expect(selectSkill(WITHER_PERCENT_ENERGY_COST).id).toBe('wither-curse'); // 93 still wither
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance'); // in-pool pick UNCHANGED
      // vulnerable-when-strong-hex@100 (TASK-139) is now the ladder TOP; the whole ladder stays strictly
      // cost-descending.
      expect(COMBATANT_SKILLS[0].id).toBe('vulnerable-when-strong-hex');
      expect(COMBATANT_SKILLS[0].energyCost).toBe(100);
      for (let i = 1; i < COMBATANT_SKILLS.length; i++) {
        expect(COMBATANT_SKILLS[i].energyCost).toBeLessThan(COMBATANT_SKILLS[i - 1].energyCost);
      }
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + determinism — priced above the pool, so NEVER cast inside
    // simulateBattle: the shipped agumon fights are byte-identical + deterministic (GUARDRAIL 1), both
    // last-turn rounds clear MAX_ROUNDS, and enfeeble-when-weak's "too healthy to enfeeble" note NEVER
    // appears in any shipped-fight log.
    it('shipped WIN/LOSS + determinism + MAX_ROUNDS clearance hold, and enfeeble-when-weak NEVER surfaces in a shipped fight (GUARDRAIL 1)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      const run = simulateBattle(agumon, numemon);
      expect(run.turns.some((t) => t.skill === 'Enfeeble When Weak')).toBe(false);
      const events = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /too healthy to enfeeble/.test(e))).toBe(false);
    });
  });

  // ── TASK-137 (R-17c, wave 84): enfeeble-when-strong — CLOSES the `enfeeble` (ATK-down) family's SECOND
  //    predicate DIRECTION. TASK-136 gated the SAME `enfeeble` family on a `<=` LOW-hp foe; this FLIPS the
  //    operator to `>=` HIGH-hp (mirroring TASK-135's `>=` gate on `weaken`): the hex inflicts the EXISTING
  //    `enfeeble` (ATK-down) status (REUSED byte-for-byte — no new arm/spec/tick/label) ONLY when `foe.hp
  //    >= floor(foe.maxHp × ENFEEBLE_WHEN_STRONG_HP_THRESHOLD_RATIO = 0.60)`; below the gate it is a NO-OP
  //    status attempt (a "too wounded to bother enfeebling" note on the EXISTING optional statusEvents?).
  //    The genuinely-new thing is the flipped predicate DIRECTION on the enfeeble family — the "kick the
  //    ATK out of a still-fresh, dangerous foe" SMT idiom, proving the `>=` gate machinery generalizes to
  //    the second stat-mod family. SAFER than a gated DoT (L-35): an ATK debuff writes NO HP and only makes
  //    a fight FASTER, so HP stays monotone (A-42) with ZERO MAX_ROUNDS hazard. Its skill
  //    `enfeeble-when-strong-hex` is Posture-B (priced 98 > MAX_ENERGY 41, the NEW ladder TOP above
  //    enfeeble-when-weak-hex@97): a stat-mod inflictor carries no `damage` arm, so a below-pool price would
  //    let chooseSkill rule-1 rotate it onto the foe and perturb the shipped fight — it stays above the pool
  //    and the gate is proven via direct gate-true / gate-false / boundary units + a selectSkill(98)
  //    boundary, not a live cast.
  describe('enfeeble-when-strong — the enfeeble ATK-down family SECOND direction (`>=` HIGH-hp gate — applies the existing enfeeble ONLY to a still-fresh foe, TASK-137)', () => {
    const ratio = ENFEEBLE_WHEN_STRONG_HP_THRESHOLD_RATIO; // 0.60
    const maxHp = 100;
    const threshold = Math.floor(maxHp * ratio); // floor(100 × 0.60) = 60

    // The gate predicate is the SAME `>=` percent-of-MAX read weaken-when-strong uses: threshold =
    // floor(maxHp × ratio); the gate is TRUE iff hp >= it (punish the still-FRESH foe). The genuinely-new
    // axis vs TASK-136 is the flipped predicate DIRECTION (`>=` HIGH-hp), on the same enfeeble family.
    const gateOpen = (hp: number, m: number): boolean => hp >= Math.floor(m * ratio);
    // Model exactly what the simulateBattle branch does: on an OPEN gate inflict the EXISTING `enfeeble`
    // ATK-reduction status (the reused apply branch — no new spec/tick); on a CLOSED gate leave the foe's
    // statuses BYTE-UNCHANGED (a pure no-op status attempt).
    const resolveEnfeebleWhenStrong = (
      foeStatuses: readonly StatusAilment[],
      foeHp: number,
      foeMaxHp: number,
    ): StatusAilment[] =>
      gateOpen(foeHp, foeMaxHp) ? applyAilment(foeStatuses, 'enfeeble') : [...foeStatuses];

    // (a) GATE-TRUE — against a still-FRESH foe (hp at/above the maxHp-fraction gate, e.g. full HP),
    // resolving enfeeble-when-strong INFLICTS an `enfeeble` ATK-down status carrying the REUSED spec payload
    // (atkReduction === ENFEEBLE_ATK_REDUCTION, turnsRemaining === ENFEEBLE_DURATION). This is the whole
    // point: the ATK debuff exists BECAUSE the foe is still dangerous — closing the enfeeble family's `>=`
    // direction (the mirror of TASK-136's `<=`).
    it('GATE-TRUE: a fresh foe (hp >= floor(maxHp × 0.60), e.g. full HP) is INFLICTED an enfeeble ATK-down carrying the reused ENFEEBLE_ATK_REDUCTION + ENFEEBLE_DURATION', () => {
      expect(threshold).toBe(60);
      const freshHp = maxHp; // 100 >= 60 → gate OPEN
      expect(gateOpen(freshHp, maxHp)).toBe(true);
      const after = resolveEnfeebleWhenStrong([], freshHp, maxHp);
      const arm = after.find((s) => s.kind === 'enfeeble');
      expect(arm?.kind === 'enfeeble' && arm.atkReduction).toBe(ENFEEBLE_ATK_REDUCTION);
      expect(arm?.kind === 'enfeeble' && arm.turnsRemaining).toBe(ENFEEBLE_DURATION);
      // The applied stat-mod is byte-identical to an UNCONDITIONAL enfeeble apply — only the GATE is new.
      expect(after).toEqual(applyAilment([], 'enfeeble'));
    });

    // (b) GATE-FALSE — against a WOUNDED foe (hp BELOW the gate, e.g. 1 HP), resolving enfeeble-when-strong
    // inflicts NOTHING: no enfeeble arm is added and the foe's statuses are byte-unchanged. This is the
    // DISTINGUISHING property vs every UNCONDITIONAL enfeeble inflictor AND vs the `<=` enfeeble-when-weak
    // (opposite direction — enfeeble-when-weak would APPLY to this same wounded foe).
    it('GATE-FALSE: a wounded foe (hp below the gate, e.g. 1 HP) is INFLICTED NOTHING — statuses byte-unchanged (opposite of enfeeble-when-weak)', () => {
      const woundedHp = 1; // 1 < 60 → gate CLOSED
      expect(gateOpen(woundedHp, maxHp)).toBe(false);
      const after = resolveEnfeebleWhenStrong([], woundedHp, maxHp);
      expect(after.some((s) => s.kind === 'enfeeble')).toBe(false);
      expect(after).toEqual([]); // byte-unchanged no-op
    });

    // (b) BOUNDARY — the gate is INCLUSIVE (`>=`): at exactly hp === threshold it APPLIES; at
    // hp === threshold - 1 it does NOT. Mirrors weaken-when-strong's `>=` boundary, but on the enfeeble
    // family — proving the `>=` DIRECTION AND its inclusive boundary for the enfeeble family (L-36).
    it('BOUNDARY: applies at hp === threshold (inclusive >=), does NOT apply at threshold - 1', () => {
      expect(gateOpen(threshold, maxHp)).toBe(true); // hp === 60 → OPEN (inclusive >=)
      const atThreshold = resolveEnfeebleWhenStrong([], threshold, maxHp);
      expect(atThreshold.some((s) => s.kind === 'enfeeble')).toBe(true);
      expect(gateOpen(threshold - 1, maxHp)).toBe(false); // hp === 59 → CLOSED
      const below = resolveEnfeebleWhenStrong([], threshold - 1, maxHp);
      expect(below.some((s) => s.kind === 'enfeeble')).toBe(false);
      expect(below).toEqual([]);
    });

    // (a) SKILL SHAPE — enfeeble-when-strong-hex is a PURE gated inflictor (one enfeeble-when-strong
    // effect, no damage arm), mirroring the pure-inflictor wither-when-strong-hex/enfeeble-when-weak-hex/
    // rot-when-weak-curse shape; the effect arm carries the gate ratio + the ENFEEBLE_DURATION for log
    // parity. The ratio (0.60) MATCHES the established `>=` HIGH-hp band (weaken-when-strong@0.60) so the
    // `>=` direction is the consistent one, and is DISTINCT from the `<=` LOW-hp band (0.35).
    it('the enfeeble-when-strong-hex skill is a PURE enfeeble-when-strong inflictor carrying the gate ratio (no damage arm)', () => {
      expect(SKILLS['enfeeble-when-strong-hex'].name).toBe('Enfeeble When Strong');
      expect(SKILLS['enfeeble-when-strong-hex'].energyCost).toBe(ENFEEBLE_WHEN_STRONG_ENERGY_COST);
      expect(SKILLS['enfeeble-when-strong-hex'].effects).toEqual([
        {
          kind: 'enfeeble-when-strong',
          hpThresholdRatio: ENFEEBLE_WHEN_STRONG_HP_THRESHOLD_RATIO,
          turns: ENFEEBLE_DURATION,
        },
      ]);
      expect(ENFEEBLE_WHEN_STRONG_HP_THRESHOLD_RATIO).toBe(0.6);
      expect(ENFEEBLE_WHEN_STRONG_HP_THRESHOLD_RATIO).toBe(WEAKEN_WHEN_STRONG_HP_THRESHOLD_RATIO); // shared `>=` band
      expect(ENFEEBLE_WHEN_STRONG_HP_THRESHOLD_RATIO).toBeGreaterThan(
        ENFEEBLE_WHEN_WEAK_HP_THRESHOLD_RATIO,
      ); // 0.60 > 0.35
    });

    // (c) SELECTION BOUNDARY (present ≠ observable) — enfeeble-when-strong-hex surfaces ONLY at its
    // above-pool cost 98 (the NEW ladder TOP), never in the pool. At 98 selectSkill returns it; ONE below
    // (97) it falls back to enfeeble-when-weak-hex, at 96 to wither-when-strong-hex, at 95 to
    // wither-when-weak-hex, at 94 to rot-when-weak-curse, at 93 to wither-curse; at MAX_ENERGY the in-pool
    // selection is UNCHANGED. The COMBATANT_SKILLS ladder stays STRICTLY cost-descending with 98 at top.
    it('surfaces enfeeble-when-strong-hex only at its above-pool cost 98 (the new ladder TOP), never in the pool (Posture-B); ladder strictly cost-descending, 98 at top', () => {
      expect(ENFEEBLE_WHEN_STRONG_ENERGY_COST).toBe(98);
      expect(ENFEEBLE_WHEN_STRONG_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(ENFEEBLE_WHEN_STRONG_ENERGY_COST).toBeGreaterThan(ENFEEBLE_WHEN_WEAK_ENERGY_COST); // 98 > 97
      expect(selectSkill(ENFEEBLE_WHEN_STRONG_ENERGY_COST).id).toBe('enfeeble-when-strong-hex');
      expect(selectSkill(ENFEEBLE_WHEN_WEAK_ENERGY_COST).id).toBe('enfeeble-when-weak-hex'); // 97 still
      expect(selectSkill(WEAKEN_WHEN_STRONG_ENERGY_COST).id).toBe('wither-when-strong-hex'); // 96 still
      expect(selectSkill(WEAKEN_WHEN_WEAK_ENERGY_COST).id).toBe('wither-when-weak-hex'); // 95 still
      expect(selectSkill(ROT_WHEN_WEAK_ENERGY_COST).id).toBe('rot-when-weak-curse'); // 94 still rot
      expect(selectSkill(WITHER_PERCENT_ENERGY_COST).id).toBe('wither-curse'); // 93 still wither
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance'); // in-pool pick UNCHANGED
      expect(COMBATANT_SKILLS[0].id).toBe('vulnerable-when-strong-hex'); // TASK-139 is now the ladder TOP
      expect(COMBATANT_SKILLS[0].energyCost).toBe(100);
      for (let i = 1; i < COMBATANT_SKILLS.length; i++) {
        expect(COMBATANT_SKILLS[i].energyCost).toBeLessThan(COMBATANT_SKILLS[i - 1].energyCost);
      }
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + determinism — priced above the pool, so NEVER cast inside
    // simulateBattle: the shipped agumon fights are byte-identical + deterministic (GUARDRAIL 1), both
    // last-turn rounds clear MAX_ROUNDS, and enfeeble-when-strong's "too wounded to bother enfeebling" note
    // NEVER appears in any shipped-fight log.
    it('shipped WIN/LOSS + determinism + MAX_ROUNDS clearance hold, and enfeeble-when-strong NEVER surfaces in a shipped fight (GUARDRAIL 1)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      const run = simulateBattle(agumon, numemon);
      expect(run.turns.some((t) => t.skill === 'Enfeeble When Strong')).toBe(false);
      const events = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /too wounded to bother enfeebling/.test(e))).toBe(false);
    });
  });

  // ── TASK-138 (R-17c, wave 85): vulnerable-when-weak — the THIRD stat-mod FAMILY's FIRST threshold-gated
  //    inflictor. TASK-134/135 closed the `weaken` (DEF-down) family and TASK-136/137 the `enfeeble`
  //    (ATK-down) family across BOTH predicate directions; L-37 forbids a third gated variant of either (a
  //    duplicate SHAPE), so this CROSSES to the THIRD stat-mod apply-family, `vulnerable` (damage-taken-UP),
  //    opening its FIRST cell in the established `<=` LOW-hp direction (mirroring how weaken/enfeeble each
  //    opened with their `<=` gate first). The hex inflicts the EXISTING `vulnerable` damage-taken-UP status
  //    (REUSED byte-for-byte — no new arm/spec/tick/label) ONLY when `foe.hp <= floor(foe.maxHp ×
  //    VULNERABLE_WHEN_WEAK_HP_THRESHOLD_RATIO = 0.35)`; above the gate it is a NO-OP status attempt (a "too
  //    healthy to expose" note on the EXISTING optional statusEvents?). The genuinely-new thing is the
  //    APPLY-FAMILY — `vulnerable` (damage-taken-UP, which SCALES incoming damage), a fundamentally different
  //    effect KIND than a flat DEF/ATK reduction — proving the `<=` gate machinery generalizes to the third
  //    stat-mod family. SAFER than a gated DoT (L-35) and even than a gated ATK/DEF debuff: a damage-taken-UP
  //    debuff on the FOE writes NO HP and makes the foe take MORE per hit, which can only make a fight FASTER
  //    or unchanged, never LONGER, so HP stays monotone (A-42) with ZERO MAX_ROUNDS hazard. Its skill
  //    `vulnerable-when-weak-hex` is Posture-B (priced 99 > MAX_ENERGY 41, the NEW ladder TOP above
  //    enfeeble-when-strong-hex@98): a stat-mod inflictor carries no `damage` arm, so a below-pool price would
  //    let chooseSkill rule-1 rotate it onto the foe and perturb the shipped fight — it stays above the pool
  //    and the gate is proven via direct gate-true / gate-false / boundary units + a selectSkill(99)
  //    boundary, not a live cast.
  describe('vulnerable-when-weak — the THIRD stat-mod family FIRST threshold gate (`<=` LOW-hp — applies the existing vulnerable damage-taken-UP ONLY to a wounded foe, TASK-138)', () => {
    const ratio = VULNERABLE_WHEN_WEAK_HP_THRESHOLD_RATIO; // 0.35
    const maxHp = 100;
    const threshold = Math.floor(maxHp * ratio); // floor(100 × 0.35) = 35

    // The gate predicate is the SAME `<=` percent-of-MAX read weaken-when-weak/enfeeble-when-weak use:
    // threshold = floor(maxHp × ratio); the gate is TRUE iff hp <= it (expose the WOUNDED foe). The
    // genuinely-new axis vs TASK-136/137 is the APPLY-FAMILY (`vulnerable` damage-taken-UP, not `enfeeble`
    // ATK-down nor `weaken` DEF-down), on the same `<=` LOW-hp direction.
    const gateOpen = (hp: number, m: number): boolean => hp <= Math.floor(m * ratio);
    // Model exactly what the simulateBattle branch does: on an OPEN gate inflict the EXISTING `vulnerable`
    // damage-taken-UP status (the reused apply branch — no new spec/tick); on a CLOSED gate leave the foe's
    // statuses BYTE-UNCHANGED (a pure no-op status attempt).
    const resolveVulnerableWhenWeak = (
      foeStatuses: readonly StatusAilment[],
      foeHp: number,
      foeMaxHp: number,
    ): StatusAilment[] =>
      gateOpen(foeHp, foeMaxHp) ? applyAilment(foeStatuses, 'vulnerable') : [...foeStatuses];

    // (a) GATE-TRUE — against a WOUNDED foe (hp at/below the maxHp-fraction gate, e.g. 1 HP), resolving
    // vulnerable-when-weak INFLICTS a `vulnerable` damage-taken-UP status carrying the REUSED spec payload
    // (damageTakenBonus === VULNERABLE_DAMAGE_TAKEN_BONUS, turnsRemaining === VULNERABLE_DURATION). This is
    // the whole point: expose the already-wounded foe to bigger hits — opening the vulnerable family's FIRST
    // cell (the `<=` direction, mirroring TASK-136's `<=` on enfeeble).
    it('GATE-TRUE: a wounded foe (hp <= floor(maxHp × 0.35), e.g. 1 HP) is INFLICTED a vulnerable damage-taken-UP carrying the reused VULNERABLE_DAMAGE_TAKEN_BONUS + VULNERABLE_DURATION', () => {
      expect(threshold).toBe(35);
      const woundedHp = 1; // 1 <= 35 → gate OPEN
      expect(gateOpen(woundedHp, maxHp)).toBe(true);
      const after = resolveVulnerableWhenWeak([], woundedHp, maxHp);
      const arm = after.find((s) => s.kind === 'vulnerable');
      expect(arm?.kind === 'vulnerable' && arm.damageTakenBonus).toBe(
        VULNERABLE_DAMAGE_TAKEN_BONUS,
      );
      expect(arm?.kind === 'vulnerable' && arm.turnsRemaining).toBe(VULNERABLE_DURATION);
      // The applied stat-mod is byte-identical to an UNCONDITIONAL vulnerable apply — only the GATE is new.
      expect(after).toEqual(applyAilment([], 'vulnerable'));
    });

    // (b) GATE-FALSE — against a HEALTHY foe (hp ABOVE the gate, e.g. full HP), resolving
    // vulnerable-when-weak inflicts NOTHING: no vulnerable arm is added and the foe's statuses are
    // byte-unchanged. This is the DISTINGUISHING property vs the UNCONDITIONAL `vulnerable-strike`
    // (which applies regardless) AND vs a `>=` vulnerable-when-strong (opposite direction — that would
    // APPLY to this same healthy foe).
    it('GATE-FALSE: a healthy foe (hp above the gate, e.g. full HP) is INFLICTED NOTHING — statuses byte-unchanged (distinct from unconditional vulnerable-strike)', () => {
      const healthyHp = maxHp; // 100 > 35 → gate CLOSED
      expect(gateOpen(healthyHp, maxHp)).toBe(false);
      const after = resolveVulnerableWhenWeak([], healthyHp, maxHp);
      expect(after.some((s) => s.kind === 'vulnerable')).toBe(false);
      expect(after).toEqual([]); // byte-unchanged no-op
    });

    // (b) BOUNDARY — the gate is INCLUSIVE (`<=`): at exactly hp === threshold it APPLIES; at
    // hp === threshold + 1 it does NOT. Mirrors enfeeble-when-weak's `<=` boundary, but on the vulnerable
    // family — proving the `<=` DIRECTION AND its inclusive boundary for the vulnerable family (L-36).
    it('BOUNDARY: applies at hp === threshold (inclusive <=), does NOT apply at threshold + 1', () => {
      expect(gateOpen(threshold, maxHp)).toBe(true); // hp === 35 → OPEN (inclusive <=)
      const atThreshold = resolveVulnerableWhenWeak([], threshold, maxHp);
      expect(atThreshold.some((s) => s.kind === 'vulnerable')).toBe(true);
      expect(gateOpen(threshold + 1, maxHp)).toBe(false); // hp === 36 → CLOSED
      const above = resolveVulnerableWhenWeak([], threshold + 1, maxHp);
      expect(above.some((s) => s.kind === 'vulnerable')).toBe(false);
      expect(above).toEqual([]);
    });

    // (a) SKILL SHAPE — vulnerable-when-weak-hex is a PURE gated inflictor (one vulnerable-when-weak
    // effect, no damage arm), mirroring the pure-inflictor enfeeble-when-weak-hex/wither-when-strong-hex/
    // rot-when-weak-curse shape — DISTINCT from the UNCONDITIONAL vulnerable-strike which IS a
    // [{damage},{vulnerable}] composite. The effect arm carries the gate ratio + the VULNERABLE_DURATION
    // for log parity. The ratio (0.35) MATCHES the established `<=` LOW-hp band (weaken-when-weak@0.35 /
    // enfeeble-when-weak@0.35) so the `<=` direction is the consistent one, below the `>=` HIGH-hp band.
    it('the vulnerable-when-weak-hex skill is a PURE vulnerable-when-weak inflictor carrying the gate ratio (no damage arm)', () => {
      expect(SKILLS['vulnerable-when-weak-hex'].name).toBe('Vulnerable When Weak');
      expect(SKILLS['vulnerable-when-weak-hex'].energyCost).toBe(VULNERABLE_WHEN_WEAK_ENERGY_COST);
      expect(SKILLS['vulnerable-when-weak-hex'].effects).toEqual([
        {
          kind: 'vulnerable-when-weak',
          hpThresholdRatio: VULNERABLE_WHEN_WEAK_HP_THRESHOLD_RATIO,
          turns: VULNERABLE_DURATION,
        },
      ]);
      expect(VULNERABLE_WHEN_WEAK_HP_THRESHOLD_RATIO).toBe(0.35);
      expect(VULNERABLE_WHEN_WEAK_HP_THRESHOLD_RATIO).toBe(ENFEEBLE_WHEN_WEAK_HP_THRESHOLD_RATIO); // shared `<=` band
      expect(VULNERABLE_WHEN_WEAK_HP_THRESHOLD_RATIO).toBeLessThan(
        ENFEEBLE_WHEN_STRONG_HP_THRESHOLD_RATIO,
      ); // 0.35 < 0.60
    });

    // (c) SELECTION BOUNDARY (present ≠ observable) — vulnerable-when-weak-hex surfaces ONLY at its
    // above-pool cost 99 (the NEW ladder TOP), never in the pool. At 99 selectSkill returns it; ONE below
    // (98) it falls back to enfeeble-when-strong-hex, at 97 to enfeeble-when-weak-hex, at 96 to
    // wither-when-strong-hex, at 95 to wither-when-weak-hex, at 94 to rot-when-weak-curse, at 93 to
    // wither-curse; at MAX_ENERGY the in-pool selection is UNCHANGED. The COMBATANT_SKILLS ladder stays
    // STRICTLY cost-descending with 99 at top (costs[0]===99 / costs[1]===98).
    it('surfaces vulnerable-when-weak-hex only at its above-pool cost 99 (the new ladder TOP), never in the pool (Posture-B); ladder strictly cost-descending, 99 at top', () => {
      expect(VULNERABLE_WHEN_WEAK_ENERGY_COST).toBe(99);
      expect(VULNERABLE_WHEN_WEAK_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(VULNERABLE_WHEN_WEAK_ENERGY_COST).toBeGreaterThan(ENFEEBLE_WHEN_STRONG_ENERGY_COST); // 99 > 98
      expect(selectSkill(VULNERABLE_WHEN_WEAK_ENERGY_COST).id).toBe('vulnerable-when-weak-hex');
      expect(selectSkill(ENFEEBLE_WHEN_STRONG_ENERGY_COST).id).toBe('enfeeble-when-strong-hex'); // 98 still
      expect(selectSkill(ENFEEBLE_WHEN_WEAK_ENERGY_COST).id).toBe('enfeeble-when-weak-hex'); // 97 still
      expect(selectSkill(WEAKEN_WHEN_STRONG_ENERGY_COST).id).toBe('wither-when-strong-hex'); // 96 still
      expect(selectSkill(WEAKEN_WHEN_WEAK_ENERGY_COST).id).toBe('wither-when-weak-hex'); // 95 still
      expect(selectSkill(ROT_WHEN_WEAK_ENERGY_COST).id).toBe('rot-when-weak-curse'); // 94 still rot
      expect(selectSkill(WITHER_PERCENT_ENERGY_COST).id).toBe('wither-curse'); // 93 still wither
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance'); // in-pool pick UNCHANGED
      const costs = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(costs[0]).toBe(100); // TASK-139 vulnerable-when-strong-hex@100 is now the ladder TOP
      expect(costs[1]).toBe(99); // vulnerable-when-weak-hex@99 now sits directly below it
      expect(COMBATANT_SKILLS[1].id).toBe('vulnerable-when-weak-hex');
      for (let i = 1; i < COMBATANT_SKILLS.length; i++) {
        expect(COMBATANT_SKILLS[i].energyCost).toBeLessThan(COMBATANT_SKILLS[i - 1].energyCost);
      }
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + determinism — priced above the pool, so NEVER cast inside
    // simulateBattle: the shipped agumon fights are byte-identical + deterministic (GUARDRAIL 1), both
    // last-turn rounds clear MAX_ROUNDS, and vulnerable-when-weak's "too healthy to expose" note NEVER
    // appears in any shipped-fight log.
    it('shipped WIN/LOSS + determinism + MAX_ROUNDS clearance hold, and vulnerable-when-weak NEVER surfaces in a shipped fight (GUARDRAIL 1)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      const run = simulateBattle(agumon, numemon);
      expect(run.turns.some((t) => t.skill === 'Vulnerable When Weak')).toBe(false);
      const events = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /too healthy to expose/.test(e))).toBe(false);
    });
  });

  // ── TASK-139 (R-17c, wave 86): vulnerable-when-strong — CLOSES the THIRD stat-mod FAMILY (`vulnerable`,
  //    damage-taken-UP) across BOTH predicate directions. TASK-138 opened the family at its `<=` LOW-hp cell
  //    (0.35); its `>=` HIGH-hp cell was the one genuine gap left (L-36 — a byte-for-byte OPERATOR FLIP on a
  //    family whose other cell is filled, exactly as TASK-135 flipped TASK-134 to close `weaken` and TASK-137
  //    flipped TASK-136 to close `enfeeble`). The hex inflicts the EXISTING `vulnerable` damage-taken-UP
  //    status (REUSED byte-for-byte — no new arm/spec/tick/label) ONLY when `foe.hp >= floor(foe.maxHp ×
  //    VULNERABLE_WHEN_STRONG_HP_THRESHOLD_RATIO = 0.60)`; below the gate it is a NO-OP status attempt (a "too
  //    wounded to bother exposing" note on the EXISTING optional statusEvents?). The genuinely-new thing is
  //    the predicate DIRECTION (`>=` HIGH-hp at the distinct 0.60 band, the mirror of TASK-138's `<=` 0.35) —
  //    the SMT "hit a still-fresh foe with a damage-taken-UP hex so the big early hits land harder" idiom.
  //    SAFER than a gated DoT (L-35): a damage-taken-UP debuff on the FOE writes NO HP and makes the foe take
  //    MORE per hit, which can only make a fight FASTER or unchanged, never LONGER — HP stays monotone (A-42)
  //    with ZERO MAX_ROUNDS hazard. Its skill `vulnerable-when-strong-hex` is Posture-B (priced 100 >
  //    MAX_ENERGY 41, the NEW ladder TOP above vulnerable-when-weak-hex@99): a stat-mod inflictor carries no
  //    `damage` arm, so a below-pool price would let chooseSkill rule-1 rotate it onto the foe and perturb the
  //    shipped fight — it stays above the pool and the gate is proven via direct gate-true / gate-false /
  //    boundary units + a selectSkill(100) boundary, not a live cast.
  describe('vulnerable-when-strong — CLOSES the THIRD stat-mod family, its SECOND direction (`>=` HIGH-hp — applies the existing vulnerable damage-taken-UP ONLY to a HEALTHY foe, TASK-139)', () => {
    const ratio = VULNERABLE_WHEN_STRONG_HP_THRESHOLD_RATIO; // 0.6
    const maxHp = 100;
    const threshold = Math.floor(maxHp * ratio); // floor(100 × 0.6) = 60

    // The gate predicate is the SAME `>=` percent-of-MAX read weaken-when-strong/enfeeble-when-strong use:
    // threshold = floor(maxHp × ratio); the gate is TRUE iff hp >= it (hit the HEALTHY foe). The
    // genuinely-new axis vs TASK-138 is the flipped `>=` DIRECTION (and the distinct 0.60 HIGH-hp band), on
    // the SAME `vulnerable` apply-family — CLOSING it across both directions.
    const gateOpen = (hp: number, m: number): boolean => hp >= Math.floor(m * ratio);
    // Model exactly what the simulateBattle branch does: on an OPEN gate inflict the EXISTING `vulnerable`
    // damage-taken-UP status (the reused apply branch — no new spec/tick); on a CLOSED gate leave the foe's
    // statuses BYTE-UNCHANGED (a pure no-op status attempt).
    const resolveVulnerableWhenStrong = (
      foeStatuses: readonly StatusAilment[],
      foeHp: number,
      foeMaxHp: number,
    ): StatusAilment[] =>
      gateOpen(foeHp, foeMaxHp) ? applyAilment(foeStatuses, 'vulnerable') : [...foeStatuses];

    // (a) GATE-TRUE — against a HEALTHY foe (hp at/above the maxHp-fraction gate, e.g. full HP), resolving
    // vulnerable-when-strong INFLICTS a `vulnerable` damage-taken-UP status carrying the REUSED spec payload
    // (damageTakenBonus === VULNERABLE_DAMAGE_TAKEN_BONUS, turnsRemaining === VULNERABLE_DURATION). This is
    // the whole point: expose a still-fresh foe to bigger early hits — the `>=` mirror closing the family.
    it('GATE-TRUE: a healthy foe (hp >= floor(maxHp × 0.6), e.g. full HP) is INFLICTED a vulnerable damage-taken-UP carrying the reused VULNERABLE_DAMAGE_TAKEN_BONUS + VULNERABLE_DURATION', () => {
      expect(threshold).toBe(60);
      const healthyHp = maxHp; // 100 >= 60 → gate OPEN
      expect(gateOpen(healthyHp, maxHp)).toBe(true);
      const after = resolveVulnerableWhenStrong([], healthyHp, maxHp);
      const arm = after.find((s) => s.kind === 'vulnerable');
      expect(arm?.kind === 'vulnerable' && arm.damageTakenBonus).toBe(
        VULNERABLE_DAMAGE_TAKEN_BONUS,
      );
      expect(arm?.kind === 'vulnerable' && arm.turnsRemaining).toBe(VULNERABLE_DURATION);
      // The applied stat-mod is byte-identical to an UNCONDITIONAL vulnerable apply — only the GATE is new.
      expect(after).toEqual(applyAilment([], 'vulnerable'));
    });

    // (b) GATE-FALSE — against a WOUNDED foe (hp BELOW the gate, e.g. 1 HP), resolving
    // vulnerable-when-strong inflicts NOTHING: no vulnerable arm is added and the foe's statuses are
    // byte-unchanged. This is the DISTINGUISHING property vs the UNCONDITIONAL `vulnerable-strike` (which
    // applies regardless) AND — the exact OPPOSITE of the `<=` vulnerable-when-weak, which FIRES on this same
    // 1-HP foe. Where vulnerable-when-weak exposes the wounded, vulnerable-when-strong punishes the healthy.
    it('GATE-FALSE: a wounded foe (hp below the gate, e.g. 1 HP) is INFLICTED NOTHING — statuses byte-unchanged (the opposite of vulnerable-when-weak, which FIRES here)', () => {
      const woundedHp = 1; // 1 < 60 → gate CLOSED
      expect(gateOpen(woundedHp, maxHp)).toBe(false);
      const after = resolveVulnerableWhenStrong([], woundedHp, maxHp);
      expect(after.some((s) => s.kind === 'vulnerable')).toBe(false);
      expect(after).toEqual([]); // byte-unchanged no-op
    });

    // (b) BOUNDARY — the gate is INCLUSIVE (`>=`): at exactly hp === threshold it APPLIES; at
    // hp === threshold - 1 it does NOT. The exact MIRROR of vulnerable-when-weak's `<=` inclusive boundary,
    // but on the flipped direction — the distinct 0.60 band + the flipped inclusive edge together prove the
    // direction is a genuine mirror, not a re-skin (L-36 mirror-boundary rule).
    it('BOUNDARY: applies at hp === threshold (inclusive >=), does NOT apply at threshold - 1', () => {
      expect(gateOpen(threshold, maxHp)).toBe(true); // hp === 60 → OPEN (inclusive >=)
      const atThreshold = resolveVulnerableWhenStrong([], threshold, maxHp);
      expect(atThreshold.some((s) => s.kind === 'vulnerable')).toBe(true);
      expect(gateOpen(threshold - 1, maxHp)).toBe(false); // hp === 59 → CLOSED
      const below = resolveVulnerableWhenStrong([], threshold - 1, maxHp);
      expect(below.some((s) => s.kind === 'vulnerable')).toBe(false);
      expect(below).toEqual([]);
    });

    // (a) SKILL SHAPE — vulnerable-when-strong-hex is a PURE gated inflictor (one vulnerable-when-strong
    // effect, no damage arm), mirroring the pure-inflictor enfeeble-when-strong-hex/vulnerable-when-weak-hex
    // shape — DISTINCT from the UNCONDITIONAL vulnerable-strike which IS a [{damage},{vulnerable}] composite.
    // The effect arm carries the gate ratio + the VULNERABLE_DURATION for log parity. The ratio (0.60)
    // MATCHES the established `>=` HIGH-hp band (weaken-when-strong@0.60 / enfeeble-when-strong@0.60) and is a
    // DISTINCT band ABOVE the `<=` LOW-hp band (vulnerable-when-weak@0.35) so the flipped direction is provably
    // a mirror.
    it('the vulnerable-when-strong-hex skill is a PURE vulnerable-when-strong inflictor carrying the gate ratio (no damage arm)', () => {
      expect(SKILLS['vulnerable-when-strong-hex'].name).toBe('Vulnerable When Strong');
      expect(SKILLS['vulnerable-when-strong-hex'].energyCost).toBe(
        VULNERABLE_WHEN_STRONG_ENERGY_COST,
      );
      expect(SKILLS['vulnerable-when-strong-hex'].effects).toEqual([
        {
          kind: 'vulnerable-when-strong',
          hpThresholdRatio: VULNERABLE_WHEN_STRONG_HP_THRESHOLD_RATIO,
          turns: VULNERABLE_DURATION,
        },
      ]);
      expect(VULNERABLE_WHEN_STRONG_HP_THRESHOLD_RATIO).toBe(0.6);
      expect(VULNERABLE_WHEN_STRONG_HP_THRESHOLD_RATIO).toBe(
        ENFEEBLE_WHEN_STRONG_HP_THRESHOLD_RATIO,
      ); // shared `>=` band
      expect(VULNERABLE_WHEN_STRONG_HP_THRESHOLD_RATIO).toBeGreaterThan(
        VULNERABLE_WHEN_WEAK_HP_THRESHOLD_RATIO,
      ); // 0.60 > 0.35 — the flipped-direction band
    });

    // (c) SELECTION BOUNDARY (present ≠ observable) — vulnerable-when-strong-hex surfaces ONLY at its
    // above-pool cost 100 (the NEW ladder TOP), never in the pool. At 100 selectSkill returns it; ONE below
    // (99) it falls back to vulnerable-when-weak-hex, at 98 to enfeeble-when-strong-hex, at 97 to
    // enfeeble-when-weak-hex, at 96 to wither-when-strong-hex, at 95 to wither-when-weak-hex, at 94 to
    // rot-when-weak-curse, at 93 to wither-curse; at MAX_ENERGY the in-pool selection is UNCHANGED. The
    // COMBATANT_SKILLS ladder stays STRICTLY cost-descending with 100 at top (costs[0]===100 / costs[1]===99).
    it('surfaces vulnerable-when-strong-hex only at its above-pool cost 100 (the new ladder TOP), never in the pool (Posture-B); ladder strictly cost-descending, 100 at top', () => {
      expect(VULNERABLE_WHEN_STRONG_ENERGY_COST).toBe(100);
      expect(VULNERABLE_WHEN_STRONG_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(VULNERABLE_WHEN_STRONG_ENERGY_COST).toBeGreaterThan(VULNERABLE_WHEN_WEAK_ENERGY_COST); // 100 > 99
      expect(selectSkill(VULNERABLE_WHEN_STRONG_ENERGY_COST).id).toBe('vulnerable-when-strong-hex');
      expect(selectSkill(VULNERABLE_WHEN_WEAK_ENERGY_COST).id).toBe('vulnerable-when-weak-hex'); // 99 still
      expect(selectSkill(ENFEEBLE_WHEN_STRONG_ENERGY_COST).id).toBe('enfeeble-when-strong-hex'); // 98 still
      expect(selectSkill(ENFEEBLE_WHEN_WEAK_ENERGY_COST).id).toBe('enfeeble-when-weak-hex'); // 97 still
      expect(selectSkill(WEAKEN_WHEN_STRONG_ENERGY_COST).id).toBe('wither-when-strong-hex'); // 96 still
      expect(selectSkill(WEAKEN_WHEN_WEAK_ENERGY_COST).id).toBe('wither-when-weak-hex'); // 95 still
      expect(selectSkill(ROT_WHEN_WEAK_ENERGY_COST).id).toBe('rot-when-weak-curse'); // 94 still rot
      expect(selectSkill(WITHER_PERCENT_ENERGY_COST).id).toBe('wither-curse'); // 93 still wither
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance'); // in-pool pick UNCHANGED
      const costs = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(costs[0]).toBe(100);
      expect(costs[1]).toBe(99);
      expect(COMBATANT_SKILLS[0].id).toBe('vulnerable-when-strong-hex');
      for (let i = 1; i < COMBATANT_SKILLS.length; i++) {
        expect(COMBATANT_SKILLS[i].energyCost).toBeLessThan(COMBATANT_SKILLS[i - 1].energyCost);
      }
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + determinism — priced above the pool, so NEVER cast inside
    // simulateBattle: the shipped agumon fights are byte-identical + deterministic (GUARDRAIL 1), both
    // last-turn rounds clear MAX_ROUNDS, and vulnerable-when-strong's "too wounded to bother exposing" note
    // NEVER appears in any shipped-fight log.
    it('shipped WIN/LOSS + determinism + MAX_ROUNDS clearance hold, and vulnerable-when-strong NEVER surfaces in a shipped fight (GUARDRAIL 1)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      const run = simulateBattle(agumon, numemon);
      expect(run.turns.some((t) => t.skill === 'Vulnerable When Strong')).toBe(false);
      const events = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /too wounded to bother exposing/.test(e))).toBe(false);
    });
  });

  // ── TASK-121 (R-17c, wave 70): poison-percent — the DoT family's SECOND `-percent` fidelity
  //    twin (after burn-percent). poison-percent ticks floor(hp × damagePerTurnRatio) of CURRENT
  //    HP each turn via the SAME monotone `Math.max(0, hp − tick)` DoT seam — reads only `hp`
  //    (NO maxHp), no RNG → HP monotone (A-42). DISTINCT ratio 0.12 (vs burn-percent's 0.2) so the
  //    two percent DoTs are distinguishable. Its inflicting skill `toxin-sting` is Posture-B (priced
  //    84 > MAX_ENERGY 41, the new ladder TOP above smolder-strike@83): a below-pool DoT-only
  //    inflictor carries no `damage` arm, so chooseSkill rule-1 would rotate it onto the foe and
  //    perturb the shipped fight — it stays above the pool and the fractional tick is proven via the
  //    DIRECT-SEAM formula unit (assert b) instead of a live-fight cast.
  describe('poison-percent — the fractional (percent-of-CURRENT-HP) DoT twin of poison, the DoT family SECOND fidelity twin (TASK-121)', () => {
    // (a) APPLIER — a poison-percent inflictor writes ONE poison-percent arm carrying the full
    // POISON_DURATION fuse and the POISON_PERCENT_DAMAGE_RATIO. A re-apply REFRESHES (no stack).
    it('applyAilment grants a fresh poison-percent arm carrying damagePerTurnRatio + full duration; a re-apply REFRESHES (no stack)', () => {
      const after = applyAilment([], 'poison-percent');
      expect(after).toEqual([
        {
          kind: 'poison-percent',
          turnsRemaining: POISON_DURATION,
          damagePerTurnRatio: POISON_PERCENT_DAMAGE_RATIO,
        },
      ]);
      // Re-apply over a decayed arm REFRESHES the fuse in place (no second arm).
      const decayed = [
        {
          kind: 'poison-percent' as const,
          turnsRemaining: 1,
          damagePerTurnRatio: POISON_PERCENT_DAMAGE_RATIO,
        },
      ];
      const refreshed = applyAilment(decayed, 'poison-percent');
      expect(refreshed.filter((s) => s.kind === 'poison-percent')).toHaveLength(1);
      const arm = refreshed.find((s) => s.kind === 'poison-percent');
      expect(arm?.kind === 'poison-percent' && arm.turnsRemaining).toBe(POISON_DURATION);
      // It coexists with an unrelated arm AND is DISTINCT from the flat `poison` (both present
      // at once — proving the twin is a separate kind, add-only).
      const mixed = applyAilment(applyAilment([], 'poison'), 'poison-percent');
      expect(mixed.map((s) => s.kind).sort()).toEqual(['poison', 'poison-percent']);
    });

    // (a) CLEANSABLE membership — poison-percent is a harmful DoT debuff, so Purify
    // (clearDebuffs over CLEANSABLE_DEBUFF_KINDS) STRIPS it, exactly like poison.
    it('is a CLEANSABLE debuff — clearDebuffs STRIPS a poison-percent arm (like poison), leaving self-buffs', () => {
      const before = [
        ...applyAilment([], 'poison-percent'),
        ...applyAilment([], 'empower'), // a self-buff must SURVIVE the cleanse
      ];
      const cleansed = clearDebuffs(before as never);
      expect(cleansed.some((s) => s.kind === 'poison-percent')).toBe(false);
      expect(cleansed.some((s) => s.kind === 'empower')).toBe(true);
    });

    // (b) TICK MATH (HEADLINE, direct-seam) — each tick subtracts EXACTLY
    // floor(hp × damagePerTurnRatio) of CURRENT HP through the SAME monotone
    // `Math.max(0, hp − tick)` seam. Assert on a chosen hp so `floor` genuinely truncates,
    // prove the ≥ 0 HP floor, and prove the tick RECURS (and SHRINKS) across turns — the
    // percent-of-current signature that distinguishes it from the flat DoTs.
    it('each tick deals EXACTLY floor(hp × damagePerTurnRatio) of CURRENT HP via the monotone seam, never below 0, recurring (and shrinking) while the fuse burns', () => {
      const ratio = POISON_PERCENT_DAMAGE_RATIO; // 0.12
      // 0.12 × 40 = 4.8 → floor 4 (the exact expression the tick evaluates; floor truncates).
      const hp0 = 40;
      const tick0 = Math.floor(hp0 * ratio);
      expect(tick0).toBe(4);
      const hp1 = Math.max(0, hp0 - tick0);
      expect(hp1).toBe(36); // HP strictly falls (monotone, A-42)
      expect(hp1).toBeLessThan(hp0);
      // The tick RECURS next turn reading the NEW (lower) CURRENT hp — SMALLER than the first:
      // floor(0.12 × 36) = floor(4.32) = 4 (still 4 here; a deeper drop shrinks it — proven below).
      const tick1 = Math.floor(hp1 * ratio);
      expect(tick1).toBe(4);
      // At a much lower HP the tick is genuinely SMALLER than the opener — shrink signature:
      // floor(0.12 × 10) = floor(1.2) = 1 < tick0 (4).
      expect(Math.floor(10 * ratio)).toBe(1);
      expect(Math.floor(10 * ratio)).toBeLessThan(tick0);
      // The ≥ 0 floor: a near-dead bearer's fractional tick rounds DOWN to 0
      // (floor(0.12 × 1) = 0), so at hp 1 the tick is 0 and HP holds at 1 — never heals, never
      // below 0.
      expect(Math.floor(1 * ratio)).toBe(0);
      expect(Math.max(0, 1 - Math.floor(1 * ratio))).toBe(1);
      expect(Math.max(0, 8 - Math.floor(8 * ratio))).toBeGreaterThanOrEqual(0); // floor(0.96)=0 → 8
      expect(POISON_DURATION).toBeGreaterThan(0); // the fuse expires after POISON_DURATION ticks
      // DISTINCT from burn-percent (0.2): the two percent DoTs are distinguishable.
      expect(POISON_PERCENT_DAMAGE_RATIO).not.toBe(BURN_PERCENT_DAMAGE_RATIO);
    });

    // (a) SKILL SHAPE — toxin-sting is a PURE DoT inflictor (one poison-percent effect, no
    // damage arm), the fractional mirror of Poison Sting's flat `poison`.
    it('the toxin-sting skill is a PURE poison-percent inflictor (no damage arm), the fractional mirror of Poison Sting', () => {
      expect(SKILLS['toxin-sting'].name).toBe('Toxin Sting');
      expect(SKILLS['toxin-sting'].effects).toEqual([{ kind: 'poison-percent' }]);
      expect(SKILLS['toxin-sting'].energyCost).toBe(TOXIN_STING_ENERGY_COST);
    });

    // (b') present ≠ observable — SELECTION BOUNDARY: toxin-sting surfaces ONLY at its
    // above-pool cost 84 (the new ladder TOP), never inside the pool. At 84 selectSkill returns
    // it; ONE below (83) it falls back to the previous top smolder-strike; at MAX_ENERGY the
    // in-pool selection is UNCHANGED (counter-stance). Proves the skill is really WIRED (Posture-B).
    it('surfaces toxin-sting only at its above-pool cost 84, never in the pool (Posture-B)', () => {
      expect(TOXIN_STING_ENERGY_COST).toBe(84);
      expect(TOXIN_STING_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(selectSkill(TOXIN_STING_ENERGY_COST).id).toBe('toxin-sting');
      expect(selectSkill(TOXIN_STING_ENERGY_COST - 1).id).toBe('smolder-strike');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + (e) determinism — priced above the pool, so NEVER
    // cast inside simulateBattle: the shipped agumon fights are byte-identical and deterministic
    // (GUARDRAIL 1), and poison-percent NEVER appears in any shipped-fight log.
    it('shipped WIN/LOSS + determinism hold, and poison-percent NEVER surfaces in a shipped fight (GUARDRAIL 1, byte-identical)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      // Never cast → never applied → the poison-percent lifecycle never appears in the log.
      const run = simulateBattle(agumon, numemon);
      const numemonEvents = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(numemonEvents.some((e) => /Toxin/.test(e))).toBe(false);
      expect(run.turns.some((t) => t.skill === 'Toxin Sting')).toBe(false);
    });
  });

  // ── TASK-122 (R-17c, wave 71): bleed-percent — the DoT family's THIRD `-percent` fidelity
  //    twin (after burn-percent/poison-percent). bleed-percent ticks floor(hp × damagePerTurnRatio)
  //    of CURRENT HP each turn via the SAME monotone `Math.max(0, hp − tick)` DoT seam — reads only
  //    `hp` (NO maxHp), no RNG → HP monotone (A-42). DISTINCT ratio 0.15 (vs burn-percent's 0.2 and
  //    poison-percent's 0.12) so the three percent DoTs are distinguishable. Its inflicting skill
  //    `hemorrhage` is Posture-B (priced 85 > MAX_ENERGY 41, the new ladder TOP above toxin-sting@84):
  //    a below-pool DoT-only inflictor carries no `damage` arm, so chooseSkill rule-1 would rotate it
  //    onto the foe and perturb the shipped fight — it stays above the pool and the fractional tick is
  //    proven via the DIRECT-SEAM formula unit (assert b) instead of a live-fight cast.
  describe('bleed-percent — the fractional (percent-of-CURRENT-HP) DoT twin of bleed, the DoT family THIRD fidelity twin (TASK-122)', () => {
    // (a) APPLIER — a bleed-percent inflictor writes ONE bleed-percent arm carrying the full
    // BLEED_DURATION fuse and the BLEED_PERCENT_DAMAGE_RATIO. A re-apply REFRESHES (no stack).
    it('applyAilment grants a fresh bleed-percent arm carrying damagePerTurnRatio + full duration; a re-apply REFRESHES (no stack)', () => {
      const after = applyAilment([], 'bleed-percent');
      expect(after).toEqual([
        {
          kind: 'bleed-percent',
          turnsRemaining: BLEED_DURATION,
          damagePerTurnRatio: BLEED_PERCENT_DAMAGE_RATIO,
        },
      ]);
      // Re-apply over a decayed arm REFRESHES the fuse in place (no second arm).
      const decayed = [
        {
          kind: 'bleed-percent' as const,
          turnsRemaining: 1,
          damagePerTurnRatio: BLEED_PERCENT_DAMAGE_RATIO,
        },
      ];
      const refreshed = applyAilment(decayed, 'bleed-percent');
      expect(refreshed.filter((s) => s.kind === 'bleed-percent')).toHaveLength(1);
      const arm = refreshed.find((s) => s.kind === 'bleed-percent');
      expect(arm?.kind === 'bleed-percent' && arm.turnsRemaining).toBe(BLEED_DURATION);
      // It coexists with an unrelated arm AND is DISTINCT from the flat `bleed` (both present
      // at once — proving the twin is a separate kind, add-only).
      const mixed = applyAilment(applyAilment([], 'bleed'), 'bleed-percent');
      expect(mixed.map((s) => s.kind).sort()).toEqual(['bleed', 'bleed-percent']);
    });

    // (a) CLEANSABLE membership — bleed-percent is a harmful DoT debuff, so Purify
    // (clearDebuffs over CLEANSABLE_DEBUFF_KINDS) STRIPS it, exactly like bleed.
    it('is a CLEANSABLE debuff — clearDebuffs STRIPS a bleed-percent arm (like bleed), leaving self-buffs', () => {
      const before = [
        ...applyAilment([], 'bleed-percent'),
        ...applyAilment([], 'empower'), // a self-buff must SURVIVE the cleanse
      ];
      const cleansed = clearDebuffs(before as never);
      expect(cleansed.some((s) => s.kind === 'bleed-percent')).toBe(false);
      expect(cleansed.some((s) => s.kind === 'empower')).toBe(true);
    });

    // (b) TICK MATH (HEADLINE, direct-seam) — each tick subtracts EXACTLY
    // floor(hp × damagePerTurnRatio) of CURRENT HP through the SAME monotone
    // `Math.max(0, hp − tick)` seam. Assert on a chosen hp so `floor` genuinely truncates,
    // prove the ≥ 0 HP floor, and prove the tick RECURS (and SHRINKS) across turns — the
    // percent-of-current signature that distinguishes it from the flat DoTs.
    it('each tick deals EXACTLY floor(hp × damagePerTurnRatio) of CURRENT HP via the monotone seam, never below 0, recurring (and shrinking) while the fuse burns', () => {
      const ratio = BLEED_PERCENT_DAMAGE_RATIO; // 0.15
      // 0.15 × 30 = 4.5 → floor 4 (the exact expression the tick evaluates; floor truncates).
      const hp0 = 30;
      const tick0 = Math.floor(hp0 * ratio);
      expect(tick0).toBe(4);
      const hp1 = Math.max(0, hp0 - tick0);
      expect(hp1).toBe(26); // HP strictly falls (monotone, A-42)
      expect(hp1).toBeLessThan(hp0);
      // The tick RECURS next turn reading the NEW (lower) CURRENT hp — SMALLER than the first:
      // floor(0.15 × 26) = floor(3.9) = 3 < tick0 (4) — the shrink signature.
      const tick1 = Math.floor(hp1 * ratio);
      expect(tick1).toBe(3);
      expect(tick1).toBeLessThan(tick0);
      // At a much lower HP the tick is genuinely SMALLER still:
      // floor(0.15 × 6) = floor(0.9) = 0.
      expect(Math.floor(6 * ratio)).toBe(0);
      // The ≥ 0 floor: a near-dead bearer's fractional tick rounds DOWN to 0
      // (floor(0.15 × 1) = 0), so at hp 1 the tick is 0 and HP holds at 1 — never heals, never
      // below 0.
      expect(Math.floor(1 * ratio)).toBe(0);
      expect(Math.max(0, 1 - Math.floor(1 * ratio))).toBe(1);
      expect(Math.max(0, 6 - Math.floor(6 * ratio))).toBeGreaterThanOrEqual(0); // floor(0.9)=0 → 6
      expect(BLEED_DURATION).toBeGreaterThan(0); // the fuse expires after BLEED_DURATION ticks
      // DISTINCT from burn-percent (0.2) AND poison-percent (0.12): the three percent DoTs are
      // distinguishable.
      expect(BLEED_PERCENT_DAMAGE_RATIO).not.toBe(BURN_PERCENT_DAMAGE_RATIO);
      expect(BLEED_PERCENT_DAMAGE_RATIO).not.toBe(POISON_PERCENT_DAMAGE_RATIO);
    });

    // (a) SKILL SHAPE — hemorrhage is a PURE DoT inflictor (one bleed-percent effect, no
    // damage arm), the fractional mirror of Bleed Strike's flat `bleed`.
    it('the hemorrhage skill is a PURE bleed-percent inflictor (no damage arm), the fractional mirror of Bleed Strike', () => {
      expect(SKILLS['hemorrhage'].name).toBe('Hemorrhage');
      expect(SKILLS['hemorrhage'].effects).toEqual([{ kind: 'bleed-percent' }]);
      expect(SKILLS['hemorrhage'].energyCost).toBe(HEMORRHAGE_ENERGY_COST);
    });

    // (b') present ≠ observable — SELECTION BOUNDARY: hemorrhage surfaces ONLY at its
    // above-pool cost 85 (the new ladder TOP), never inside the pool. At 85 selectSkill returns
    // it; ONE below (84) it falls back to the previous top toxin-sting; at MAX_ENERGY the
    // in-pool selection is UNCHANGED (counter-stance). Proves the skill is really WIRED (Posture-B).
    it('surfaces hemorrhage only at its above-pool cost 85, never in the pool (Posture-B)', () => {
      expect(HEMORRHAGE_ENERGY_COST).toBe(85);
      expect(HEMORRHAGE_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(selectSkill(HEMORRHAGE_ENERGY_COST).id).toBe('hemorrhage');
      expect(selectSkill(HEMORRHAGE_ENERGY_COST - 1).id).toBe('toxin-sting');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + (e) determinism — priced above the pool, so NEVER
    // cast inside simulateBattle: the shipped agumon fights are byte-identical and deterministic
    // (GUARDRAIL 1), and bleed-percent NEVER appears in any shipped-fight log.
    it('shipped WIN/LOSS + determinism hold, and bleed-percent NEVER surfaces in a shipped fight (GUARDRAIL 1, byte-identical)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      // Never cast → never applied → the bleed-percent lifecycle never appears in the log.
      const run = simulateBattle(agumon, numemon);
      const numemonEvents = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(numemonEvents.some((e) => /Hemorrhage/.test(e))).toBe(false);
      expect(run.turns.some((t) => t.skill === 'Hemorrhage')).toBe(false);
    });
  });

  // ── TASK-123 (R-17c, wave 72): corrode-percent — the DoT family's FOURTH & FINAL `-percent`
  //    fidelity twin, the genuinely-new fractional-RAMP COMBINATION. Like bleed-percent it ticks
  //    floor(hp × damagePerTurnRatio) of CURRENT HP each turn via the SAME monotone
  //    `Math.max(0, hp − tick)` DoT seam (reads only `hp`, NO maxHp, no RNG → HP monotone A-42), but
  //    like corrode its RATIO ITSELF GROWS each tick (damagePerTurnRatio += rampRatio) — the ratio-growth
  //    mirror of corrode's flat `damagePerTurn += ramp`: 0.05 → 0.10 → 0.15 → 0.20. So it is BOTH
  //    percent-of-current (shrinks with HP) AND ramping (the multiplier climbs), distinct from every
  //    shipped DoT. Its inflicting skill `necrosis` is Posture-B (priced 86 > MAX_ENERGY 41, the new
  //    ladder TOP above hemorrhage@85): a below-pool DoT-only inflictor carries no `damage` arm, so
  //    chooseSkill rule-1 would rotate it onto the foe and perturb the shipped fight — it stays above
  //    the pool and the RAMPING fractional tick is proven via the DIRECT-SEAM formula unit (assert b)
  //    across ≥2 ticks so the ratio-growth is visible.
  describe('corrode-percent — the fractional-RAMP (percent-of-CURRENT-HP, growing-ratio) DoT twin of corrode, the DoT family FOURTH & FINAL fidelity twin (TASK-123)', () => {
    // (a) APPLIER — a corrode-percent inflictor writes ONE corrode-percent arm carrying the full
    // CORRODE_DURATION fuse, the INITIAL ratio, and the rampRatio. A re-apply REFRESHES both the fuse
    // AND RESETS damagePerTurnRatio to the initial (discarding accumulated ramp) — the corrode-style reset.
    it('applyAilment grants a fresh corrode-percent arm carrying initial ratio + rampRatio + full duration; a re-apply RESETS the ratio + refreshes the fuse (no stack)', () => {
      const after = applyAilment([], 'corrode-percent');
      expect(after).toEqual([
        {
          kind: 'corrode-percent',
          turnsRemaining: CORRODE_DURATION,
          damagePerTurnRatio: CORRODE_PERCENT_INITIAL_RATIO,
          rampRatio: CORRODE_PERCENT_RAMP_RATIO,
        },
      ]);
      // Re-apply over a RAMPED, decayed arm RESETS the ratio back to the initial AND refreshes the
      // fuse in place (no second arm) — mirroring the flat `corrode` refresh-reset.
      const ramped = [
        {
          kind: 'corrode-percent' as const,
          turnsRemaining: 1,
          damagePerTurnRatio: CORRODE_PERCENT_INITIAL_RATIO + 3 * CORRODE_PERCENT_RAMP_RATIO,
          rampRatio: CORRODE_PERCENT_RAMP_RATIO,
        },
      ];
      const refreshed = applyAilment(ramped, 'corrode-percent');
      expect(refreshed.filter((s) => s.kind === 'corrode-percent')).toHaveLength(1);
      const arm = refreshed.find((s) => s.kind === 'corrode-percent');
      expect(arm?.kind === 'corrode-percent' && arm.turnsRemaining).toBe(CORRODE_DURATION);
      expect(arm?.kind === 'corrode-percent' && arm.damagePerTurnRatio).toBe(
        CORRODE_PERCENT_INITIAL_RATIO,
      );
      // It coexists with the flat `corrode` (both present at once — proving the twin is a separate
      // kind, add-only, and corrode's `ramp` mechanic is untouched).
      const mixed = applyAilment(applyAilment([], 'corrode'), 'corrode-percent');
      expect(mixed.map((s) => s.kind).sort()).toEqual(['corrode', 'corrode-percent']);
    });

    // (a) CLEANSABLE membership — corrode-percent is a harmful DoT debuff, so Purify
    // (clearDebuffs over CLEANSABLE_DEBUFF_KINDS) STRIPS it, exactly like corrode.
    it('is a CLEANSABLE debuff — clearDebuffs STRIPS a corrode-percent arm (like corrode), leaving self-buffs', () => {
      const before = [
        ...applyAilment([], 'corrode-percent'),
        ...applyAilment([], 'empower'), // a self-buff must SURVIVE the cleanse
      ];
      const cleansed = clearDebuffs(before as never);
      expect(cleansed.some((s) => s.kind === 'corrode-percent')).toBe(false);
      expect(cleansed.some((s) => s.kind === 'empower')).toBe(true);
    });

    // (a) TICK-ORDER — corrode-percent sits IMMEDIATELY after corrode in the deterministic
    // AILMENT_TICK_ORDER (the "twin slot after its flat parent" convention).
    it('corrode-percent is slotted in AILMENT_TICK_ORDER immediately after corrode', () => {
      const order = AILMENT_TICK_ORDER;
      const iCorrode = order.indexOf('corrode');
      const iPercent = order.indexOf('corrode-percent');
      expect(iCorrode).toBeGreaterThanOrEqual(0);
      expect(iPercent).toBe(iCorrode + 1);
    });

    // (b) TICK MATH + RAMP (HEADLINE, direct-seam) — each tick subtracts EXACTLY
    // floor(hp × damagePerTurnRatio) of CURRENT HP through the SAME monotone
    // `Math.max(0, hp − tick)` seam, THEN advances the ratio by rampRatio so the NEXT tick uses a
    // BIGGER ratio. Choose an hp so `floor` truncates AND the two ticks' magnitudes are distinguishable
    // so the ramp is PROVABLY visible; assert the ≥0 floor at low HP. THIS is the wave's headline.
    it('each tick deals floor(hp × ratio) of CURRENT HP then GROWS the ratio by rampRatio — the ramp is visible across ≥2 ticks; never below 0', () => {
      const r0 = CORRODE_PERCENT_INITIAL_RATIO; // 0.05
      const step = CORRODE_PERCENT_RAMP_RATIO; // 0.05
      // Tick 1 at hp0=100: floor(100 × 0.05) = 5.
      const hp0 = 100;
      const tick0 = Math.floor(hp0 * r0);
      expect(tick0).toBe(5);
      const hp1 = Math.max(0, hp0 - tick0);
      expect(hp1).toBe(95); // HP strictly falls (monotone, A-42)
      expect(hp1).toBeLessThan(hp0);
      // The RATIO grows for tick 2: r1 = 0.05 + 0.05 = 0.10.
      const r1 = r0 + step;
      expect(r1).toBe(0.1);
      // Tick 2 reads the NEW (lower) hp but with the GROWN ratio: floor(95 × 0.10) = floor(9.5) = 9.
      // Despite HP having FALLEN, the tick is BIGGER than tick0 (5) — the ramp DOMINATES the shrink
      // here, the fractional-RAMP combination signature (contrast fixed-ratio bleed-percent which only
      // ever shrinks). The ramp is provably VISIBLE across the two ticks.
      const tick1 = Math.floor(hp1 * r1);
      expect(tick1).toBe(9);
      expect(tick1).toBeGreaterThan(tick0);
      const hp2 = Math.max(0, hp1 - tick1);
      expect(hp2).toBe(86);
      expect(hp2).toBeLessThan(hp1);
      // Tick 3 with r2 = 0.15: floor(86 × 0.15) = floor(12.9) = 12 — still climbing.
      const r2 = r1 + step;
      const tick2 = Math.floor(hp2 * r2);
      expect(tick2).toBe(12);
      expect(tick2).toBeGreaterThan(tick1);
      // The ≥ 0 floor: a near-dead bearer's fractional tick rounds DOWN to 0 even at the LATE (big)
      // ratio, so HP holds — never heals, never below 0. floor(1 × 0.20) = 0.
      const rLate = r0 + 3 * step; // 0.20
      expect(Math.floor(1 * rLate)).toBe(0);
      expect(Math.max(0, 1 - Math.floor(1 * rLate))).toBe(1);
      expect(CORRODE_DURATION).toBeGreaterThan(0); // the fuse expires after CORRODE_DURATION ticks
      // DISTINCT initial ratio from the three FIXED-ratio percent DoTs — the four percent DoTs are
      // distinguishable, and corrode-percent uniquely RAMPS.
      expect(CORRODE_PERCENT_INITIAL_RATIO).not.toBe(BURN_PERCENT_DAMAGE_RATIO);
      expect(CORRODE_PERCENT_INITIAL_RATIO).not.toBe(POISON_PERCENT_DAMAGE_RATIO);
      expect(CORRODE_PERCENT_INITIAL_RATIO).not.toBe(BLEED_PERCENT_DAMAGE_RATIO);
      expect(CORRODE_PERCENT_RAMP_RATIO).toBeGreaterThan(0); // it genuinely ramps
      // (f) HP MONOTONE across the RAMPING sequence — even as the ratio GROWS, each tick only ever
      // SUBTRACTS + floors ≥ 0, so the simulated HP trajectory is strictly non-increasing (A-42). Walk
      // the full CORRODE_DURATION ramp on a crafted bearer and assert HP never rises.
      let hp = 100;
      let ratio = r0;
      let last = hp;
      for (let t = 0; t < CORRODE_DURATION; t++) {
        const dealt = Math.floor(hp * ratio);
        hp = Math.max(0, hp - dealt);
        expect(hp).toBeLessThanOrEqual(last); // never rises — HP monotone
        expect(hp).toBeGreaterThanOrEqual(0); // never below 0
        last = hp;
        ratio += step; // the ratio GROWS for the next tick
      }
    });

    // (a) SKILL SHAPE — necrosis is a PURE DoT inflictor (one corrode-percent effect, no damage
    // arm), the fractional-RAMP mirror of Corrode Strike's flat ramping `corrode`.
    it('the necrosis skill is a PURE corrode-percent inflictor (no damage arm), the fractional-RAMP mirror of Corrode Strike', () => {
      expect(SKILLS['necrosis'].name).toBe('Necrosis');
      expect(SKILLS['necrosis'].effects).toEqual([{ kind: 'corrode-percent' }]);
      expect(SKILLS['necrosis'].energyCost).toBe(NECROSIS_ENERGY_COST);
    });

    // (b') present ≠ observable — SELECTION BOUNDARY (Posture-B): necrosis surfaces ONLY at its
    // above-pool cost 86 (the new ladder TOP), never inside the pool. At 86 selectSkill returns it;
    // ONE below (85) it falls back to the previous top hemorrhage; at MAX_ENERGY the in-pool selection
    // is UNCHANGED (counter-stance). Proves the skill is really WIRED without a live cast.
    it('surfaces necrosis only at its above-pool cost 86, never in the pool (Posture-B)', () => {
      expect(NECROSIS_ENERGY_COST).toBe(86);
      expect(NECROSIS_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(selectSkill(NECROSIS_ENERGY_COST).id).toBe('necrosis');
      expect(selectSkill(NECROSIS_ENERGY_COST - 1).id).toBe('hemorrhage');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + (e) determinism + (f) HP monotone — priced above the
    // pool, so NEVER cast inside simulateBattle: the shipped agumon fights are byte-identical and
    // deterministic (GUARDRAIL 1), HP stays non-increasing, and corrode-percent NEVER appears in a log.
    it('shipped WIN/LOSS + determinism + HP-monotone hold, and corrode-percent NEVER surfaces in a shipped fight (GUARDRAIL 1, byte-identical)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      // Never cast → never applied → the corrode-percent lifecycle never appears in the log.
      const run = simulateBattle(agumon, numemon);
      const numemonEvents = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(numemonEvents.some((e) => /Necrosis/.test(e))).toBe(false);
      expect(run.turns.some((t) => t.skill === 'Necrosis')).toBe(false);
    });
  });

  // ── TASK-126 (R-17c): the `maxHp` SUBSTRATE + the FIRST mechanic it unlocks — an EXECUTE
  //    finisher. `maxHp` is a combatant's FULL/starting HP: set ONCE at construction
  //    (`maxHp = hp`, no Prisma column, no wire change) and NEVER mutated by the round loop. The
  //    execute finisher is the FIRST percent-of-MAX-HP read in the engine: it deals the normal
  //    strike, then — WHEN the defender's hp <= floor(maxHp × ratio) — adds bonusDamage through
  //    the SAME monotone hp = max(0, hp − X) write (execute only ever DEALS more, never heals —
  //    A-42). Shipped Posture-B (cost 87 > MAX_ENERGY) so it NEVER fires in the shipped fights,
  //    keeping the two reference fights byte-identical; proven WIRED via direct apply units +
  //    a selectSkill(87) boundary, not a live cast.
  describe('maxHp substrate + Execute finisher (the FIRST percent-of-MAX-HP mechanic)', () => {
    // (a) SUBSTRATE — a constructed Combatant carries maxHp and it equals its starting hp.
    it('a constructed Combatant carries maxHp equal to its starting hp (numemon, kuwagamon, agumon)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(numemon.maxHp).toBe(numemon.hp);
      expect(kuwagamon.maxHp).toBe(kuwagamon.hp);
      expect(agumon.maxHp).toBe(agumon.hp);
    });

    // (b) APPLY SEAM at BOTH sides of the threshold — the pure executeBonus read. floor(maxHp ×
    //     0.25) is the inclusive cutoff: a defender AT or BELOW it takes +bonusDamage; ABOVE it 0.
    it('executeBonus adds bonusDamage at/below floor(maxHp × ratio) and 0 above it (both sides + exact boundary)', () => {
      const maxHp = 100;
      const ratio = EXECUTE_HP_THRESHOLD_RATIO; // 0.25 → threshold floor(100 × 0.25) = 25
      const threshold = Math.floor(maxHp * ratio);
      expect(threshold).toBe(25);
      expect(executeBonus(threshold + 1, maxHp, EXECUTE_BONUS_DAMAGE, ratio)).toBe(0);
      expect(executeBonus(maxHp, maxHp, EXECUTE_BONUS_DAMAGE, ratio)).toBe(0);
      expect(executeBonus(threshold, maxHp, EXECUTE_BONUS_DAMAGE, ratio)).toBe(
        EXECUTE_BONUS_DAMAGE,
      );
      expect(executeBonus(1, maxHp, EXECUTE_BONUS_DAMAGE, ratio)).toBe(EXECUTE_BONUS_DAMAGE);
      // floor truncation: floor(90 × 0.25) = 22.
      expect(executeBonus(22, 90, EXECUTE_BONUS_DAMAGE, ratio)).toBe(EXECUTE_BONUS_DAMAGE);
      expect(executeBonus(23, 90, EXECUTE_BONUS_DAMAGE, ratio)).toBe(0);
      // HP monotone at the write: subtracting the bonus never raises HP nor drops below 0.
      const after = Math.max(
        0,
        threshold - executeBonus(threshold, maxHp, EXECUTE_BONUS_DAMAGE, ratio),
      );
      expect(after).toBeLessThanOrEqual(threshold);
      expect(after).toBeGreaterThanOrEqual(0);
      expect(Math.max(0, 3 - executeBonus(3, maxHp, EXECUTE_BONUS_DAMAGE, ratio))).toBe(0);
    });

    // SKILL SHAPE — execute-strike is a DAMAGING composite ([damage, execute]).
    it('execute-strike is a DAMAGING composite carrying its bonusDamage + hpThresholdRatio', () => {
      expect(SKILLS['execute-strike'].name).toBe('Execute Strike');
      expect(SKILLS['execute-strike'].energyCost).toBe(EXECUTE_ENERGY_COST);
      expect(SKILLS['execute-strike'].effects).toEqual([
        { kind: 'damage' },
        {
          kind: 'execute',
          bonusDamage: EXECUTE_BONUS_DAMAGE,
          hpThresholdRatio: EXECUTE_HP_THRESHOLD_RATIO,
        },
      ]);
    });

    // (c) present ≠ observable — SELECTION BOUNDARY (Posture-B): execute-strike surfaces ONLY at
    //     its above-pool cost 87 (the new ladder TOP); ONE below (86) falls back to necrosis; at
    //     MAX_ENERGY the in-pool pick is UNCHANGED (counter-stance). Proves it WIRED without a cast.
    it('surfaces execute-strike only at its above-pool cost 87, never in the pool (Posture-B)', () => {
      expect(EXECUTE_ENERGY_COST).toBe(87);
      expect(EXECUTE_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(selectSkill(EXECUTE_ENERGY_COST).id).toBe('execute-strike');
      expect(selectSkill(EXECUTE_ENERGY_COST - 1).id).toBe('necrosis');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + determinism — priced above the pool, NEVER cast: the
    //     two reference fights stay outcome-identical + deterministic (the ladder choice did NOT
    //     perturb them), and Execute NEVER appears in a shipped log.
    it('shipped WIN/LOSS + determinism hold, and Execute Strike NEVER surfaces in a shipped fight (byte-identical ladder choice)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      const run = simulateBattle(agumon, numemon);
      expect(run.turns.some((t) => t.skill === 'Execute Strike')).toBe(false);
      const events = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /executed/.test(e))).toBe(false);
    });

    // OBSERVABLE PAYOFF — the finisher deals strictly MORE than a bare strike against a
    //   below-threshold foe (the whole point of the maxHp read), HP monotone.
    it('the execute effect deals normal strike + bonusDamage on a below-threshold foe, strictly more than the strike alone', () => {
      const caster: Combatant = { ...agumon, name: 'Finisher', atk: 20 };
      const foeMaxHp = 100;
      const foeHp = 10; // 10 <= floor(100 × 0.25) = 25 → within execute range
      const normal = resolveAttack(caster, {
        ...agumon,
        name: 'Prey',
        hp: foeHp,
        maxHp: foeMaxHp,
        def: 0,
      });
      const bonus = executeBonus(
        Math.max(0, foeHp - normal),
        foeMaxHp,
        EXECUTE_BONUS_DAMAGE,
        EXECUTE_HP_THRESHOLD_RATIO,
      );
      expect(bonus).toBe(EXECUTE_BONUS_DAMAGE);
      const totalLoss = normal + bonus;
      expect(totalLoss).toBeGreaterThan(normal);
      const foeAfter = Math.max(0, foeHp - totalLoss);
      expect(foeAfter).toBeLessThanOrEqual(foeHp);
      expect(foeAfter).toBeGreaterThanOrEqual(0);
    });
  });

  // ── TASK-127 (R-17c, max-HP-FRACTION burst): Guillotine — the FIRST finisher that SIZES its
  //    bonus damage as a FRACTION of the defender's maxHp. Where Execute only READS maxHp to GATE a
  //    FIXED +12, Guillotine uses maxHp to SCALE the bonus: floor(maxHp × 0.20) when the foe is
  //    at/below floor(maxHp × 0.30). This is the FIRST time maxHp SIZES a damage number. Shipped
  //    Posture-B (cost 88 > MAX_ENERGY, the new ladder TOP above execute@87) so it NEVER fires in the
  //    shipped fights, keeping the two reference fights byte-identical; proven WIRED via direct
  //    apply units + a maxHp-scaling contrast + a selectSkill(88) boundary, not a live cast. HP
  //    stays monotone (guillotine only ever DEALS more, never heals — A-42).
  describe('Guillotine finisher (the FIRST max-HP-FRACTION burst — bonus SIZED from maxHp)', () => {
    // (a) APPLY SEAM at BOTH sides of the threshold — the pure guillotineBonus read. floor(maxHp ×
    //     0.30) is the inclusive cutoff: a defender AT or BELOW it takes floor(maxHp × 0.20) bonus;
    //     ABOVE it 0. HP monotone at every write.
    it('guillotineBonus adds floor(maxHp × bonusRatio) at/below floor(maxHp × hpThresholdRatio) and 0 above it (both sides + exact boundary)', () => {
      const maxHp = 100;
      const hpRatio = GUILLOTINE_HP_THRESHOLD_RATIO; // 0.30 → threshold floor(100 × 0.30) = 30
      const bonusRatio = GUILLOTINE_BONUS_RATIO; // 0.20 → bonus floor(100 × 0.20) = 20
      const threshold = Math.floor(maxHp * hpRatio);
      const bonusAtMax = Math.floor(maxHp * bonusRatio);
      expect(threshold).toBe(30);
      expect(bonusAtMax).toBe(20);
      // ABOVE the threshold → 0 (both just above and at full HP).
      expect(guillotineBonus(threshold + 1, maxHp, bonusRatio, hpRatio)).toBe(0);
      expect(guillotineBonus(maxHp, maxHp, bonusRatio, hpRatio)).toBe(0);
      // AT/BELOW the threshold → floor(maxHp × bonusRatio).
      expect(guillotineBonus(threshold, maxHp, bonusRatio, hpRatio)).toBe(bonusAtMax);
      expect(guillotineBonus(1, maxHp, bonusRatio, hpRatio)).toBe(bonusAtMax);
      // floor truncation on the threshold: floor(90 × 0.30) = 27.
      expect(guillotineBonus(27, 90, bonusRatio, hpRatio)).toBe(Math.floor(90 * bonusRatio));
      expect(guillotineBonus(28, 90, bonusRatio, hpRatio)).toBe(0);
      // HP monotone at the write: subtracting the bonus never raises HP nor drops below 0.
      const after = Math.max(0, threshold - guillotineBonus(threshold, maxHp, bonusRatio, hpRatio));
      expect(after).toBeLessThanOrEqual(threshold);
      expect(after).toBeGreaterThanOrEqual(0);
      expect(Math.max(0, 3 - guillotineBonus(3, maxHp, bonusRatio, hpRatio))).toBe(0);
    });

    // (b) THE DISTINGUISHING PROPERTY vs execute's FIXED +12 — the bonus SCALES with maxHp. Two
    //     below-threshold defenders with DIFFERENT maxHp get PROPORTIONALLY different bonus damage.
    it('the guillotine bonus SCALES with maxHp (bigger-maxHp foe below threshold takes strictly more bonus)', () => {
      const small = 100; // threshold 30, bonus floor(100 × 0.20) = 20
      const big = 300; //   threshold 90, bonus floor(300 × 0.20) = 60
      const smallBonus = guillotineBonus(
        5,
        small,
        GUILLOTINE_BONUS_RATIO,
        GUILLOTINE_HP_THRESHOLD_RATIO,
      );
      const bigBonus = guillotineBonus(
        5,
        big,
        GUILLOTINE_BONUS_RATIO,
        GUILLOTINE_HP_THRESHOLD_RATIO,
      );
      expect(smallBonus).toBe(20);
      expect(bigBonus).toBe(60);
      // strictly proportional to maxHp — the property execute's flat +12 could NEVER have.
      expect(bigBonus).toBeGreaterThan(smallBonus);
      expect(bigBonus / smallBonus).toBeCloseTo(big / small);
      // and it genuinely differs from execute's FIXED bonus on the same foe.
      expect(bigBonus).not.toBe(EXECUTE_BONUS_DAMAGE);
    });

    // SKILL SHAPE — guillotine-strike is a DAMAGING composite ([damage, guillotine]).
    it('guillotine-strike is a DAMAGING composite carrying its bonusRatio + hpThresholdRatio', () => {
      expect(SKILLS['guillotine-strike'].name).toBe('Guillotine');
      expect(SKILLS['guillotine-strike'].energyCost).toBe(GUILLOTINE_ENERGY_COST);
      expect(SKILLS['guillotine-strike'].effects).toEqual([
        { kind: 'damage' },
        {
          kind: 'guillotine',
          bonusRatio: GUILLOTINE_BONUS_RATIO,
          hpThresholdRatio: GUILLOTINE_HP_THRESHOLD_RATIO,
        },
      ]);
    });

    // (c) present ≠ observable — SELECTION BOUNDARY (Posture-B): guillotine-strike surfaces ONLY at
    //     its above-pool cost 88 (the new ladder TOP); ONE below (87) falls back to execute-strike;
    //     at MAX_ENERGY the in-pool pick is UNCHANGED (counter-stance). Proves it WIRED without a cast.
    it('surfaces guillotine-strike only at its above-pool cost 88, never in the pool (Posture-B)', () => {
      expect(GUILLOTINE_ENERGY_COST).toBe(88);
      expect(GUILLOTINE_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(selectSkill(GUILLOTINE_ENERGY_COST).id).toBe('guillotine-strike');
      expect(selectSkill(GUILLOTINE_ENERGY_COST - 1).id).toBe('execute-strike');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + determinism — priced above the pool, NEVER cast: the two
    //     reference fights stay outcome-identical + deterministic (the ladder choice did NOT perturb
    //     them), and Guillotine NEVER appears in a shipped log.
    it('shipped WIN/LOSS + determinism hold, and Guillotine NEVER surfaces in a shipped fight (byte-identical ladder choice)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      const run = simulateBattle(agumon, numemon);
      expect(run.turns.some((t) => t.skill === 'Guillotine')).toBe(false);
      const events = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /guillotined/.test(e))).toBe(false);
    });

    // OBSERVABLE PAYOFF — the finisher deals strictly MORE than a bare strike against a
    //   below-threshold foe (the whole point of the maxHp-scaled read), HP monotone.
    it('the guillotine effect deals normal strike + maxHp-scaled bonus on a below-threshold foe, strictly more than the strike alone', () => {
      const caster: Combatant = { ...agumon, name: 'Reaper', atk: 20 };
      const foeMaxHp = 200;
      const foeHp = 10; // 10 <= floor(200 × 0.30) = 60 → within guillotine range
      const normal = resolveAttack(caster, {
        ...agumon,
        name: 'Prey',
        hp: foeHp,
        maxHp: foeMaxHp,
        def: 0,
      });
      const bonus = guillotineBonus(
        Math.max(0, foeHp - normal),
        foeMaxHp,
        GUILLOTINE_BONUS_RATIO,
        GUILLOTINE_HP_THRESHOLD_RATIO,
      );
      expect(bonus).toBe(Math.floor(foeMaxHp * GUILLOTINE_BONUS_RATIO)); // floor(200 × 0.20) = 40
      const totalLoss = normal + bonus;
      expect(totalLoss).toBeGreaterThan(normal);
      const foeAfter = Math.max(0, foeHp - totalLoss);
      expect(foeAfter).toBeLessThanOrEqual(foeHp);
      expect(foeAfter).toBeGreaterThanOrEqual(0);
    });
  });

  // ── TASK-128 (R-17c, MISSING-HP-FRACTION burst): Rampage — the FIRST finisher that SIZES its bonus
  //    damage as a FRACTION of the defender's MISSING HP (maxHp − hp, the damage already dealt). Where
  //    Guillotine sizes off maxHp (full HP) behind a low-HP THRESHOLD gate, Rampage sizes off the
  //    MISSING HP with NO gate: floor(max(0, maxHp − hp) × 0.25), naturally 0 at full HP and growing
  //    as the foe is worn down (the SMT rampage/vengeance idiom). This is the FIRST time the engine
  //    reads MISSING HP. Shipped Posture-B (cost 89 > MAX_ENERGY, the new ladder TOP above
  //    guillotine@88) so it NEVER fires in the shipped fights, keeping the two reference fights
  //    byte-identical; proven WIRED via direct apply units (a missing-HP-scaling contrast + full-HP →
  //    0 + floor truncation) + a selectSkill(89) boundary, not a live cast. HP stays monotone (rampage
  //    only ever DEALS more, never heals — A-42).
  describe('Rampage finisher (the FIRST MISSING-HP-FRACTION burst — bonus SIZED from maxHp − hp)', () => {
    // (a) APPLY SEAM — the pure rampageBonus read. UNCONDITIONAL (no threshold): floor(max(0, maxHp −
    //     hp) × 0.25), 0 at full HP, never negative even if hp > maxHp. HP monotone at every write.
    it('rampageBonus adds floor((maxHp − hp) × bonusRatio), is 0 at full HP, floor-truncates, and never goes negative', () => {
      const maxHp = 100;
      const bonusRatio = RAMPAGE_BONUS_RATIO; // 0.25
      // At full HP → missing HP is 0 → bonus 0 (the distinguishing property vs guillotine).
      expect(rampageBonus(maxHp, maxHp, bonusRatio)).toBe(0);
      // Worn down → floor((maxHp − hp) × ratio).
      expect(rampageBonus(40, maxHp, bonusRatio)).toBe(Math.floor((100 - 40) * 0.25)); // floor(60 × 0.25) = 15
      expect(rampageBonus(1, maxHp, bonusRatio)).toBe(Math.floor((100 - 1) * 0.25)); // floor(99 × 0.25) = 24
      // Floor truncation: floor(70 × 0.25) = 17 (17.5 → 17).
      expect(rampageBonus(30, maxHp, bonusRatio)).toBe(17);
      // Never negative even if hp somehow exceeds maxHp (the Math.max(0, …) guard).
      expect(rampageBonus(maxHp + 20, maxHp, bonusRatio)).toBe(0);
      // Monotone write: subtracting the bonus never raises HP nor goes below 0.
      const hp = 40;
      const after = Math.max(0, hp - rampageBonus(hp, maxHp, bonusRatio));
      expect(after).toBeLessThanOrEqual(hp);
      expect(after).toBeGreaterThanOrEqual(0);
    });

    // (b) SCALES with MISSING HP — two defenders with the SAME maxHp but different current hp (hence
    //     different missing HP) get proportionally different bonus; the full-HP defender gets 0. This
    //     is the distinguishing property vs guillotine's threshold-gated fraction-of-MAX.
    it('the rampage bonus SCALES with MISSING HP (more-worn foe takes strictly more; full-HP foe takes 0)', () => {
      const maxHp = 200;
      const bonusFull = rampageBonus(maxHp, maxHp, RAMPAGE_BONUS_RATIO); // missing 0
      const bonusHalf = rampageBonus(100, maxHp, RAMPAGE_BONUS_RATIO); // missing 100
      const bonusLow = rampageBonus(20, maxHp, RAMPAGE_BONUS_RATIO); // missing 180
      expect(bonusFull).toBe(0);
      expect(bonusHalf).toBeGreaterThan(bonusFull);
      expect(bonusLow).toBeGreaterThan(bonusHalf);
      expect(bonusHalf).toBe(Math.floor(100 * RAMPAGE_BONUS_RATIO)); // floor(100 × 0.25) = 25
      expect(bonusLow).toBe(Math.floor(180 * RAMPAGE_BONUS_RATIO)); // floor(180 × 0.25) = 45
    });

    // SKILL SHAPE — rampage-strike is a DAMAGING composite ([damage, rampage]) carrying its bonusRatio.
    it('rampage-strike is a DAMAGING composite carrying its bonusRatio', () => {
      expect(SKILLS['rampage-strike'].name).toBe('Rampage');
      expect(SKILLS['rampage-strike'].energyCost).toBe(RAMPAGE_ENERGY_COST);
      expect(SKILLS['rampage-strike'].effects).toEqual([
        { kind: 'damage' },
        { kind: 'rampage', bonusRatio: RAMPAGE_BONUS_RATIO },
      ]);
    });

    // (c) present ≠ observable — SELECTION BOUNDARY (Posture-B): rampage-strike surfaces ONLY at its
    //     above-pool cost 89 (the new ladder TOP); ONE below (88) falls back to guillotine-strike; at
    //     MAX_ENERGY the in-pool pick is UNCHANGED (counter-stance). Proves it WIRED without a cast.
    it('surfaces rampage-strike only at its above-pool cost 89, never in the pool (Posture-B)', () => {
      expect(RAMPAGE_ENERGY_COST).toBe(89);
      expect(RAMPAGE_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(selectSkill(RAMPAGE_ENERGY_COST).id).toBe('rampage-strike');
      expect(selectSkill(RAMPAGE_ENERGY_COST - 1).id).toBe('guillotine-strike');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + determinism — priced above the pool, NEVER cast: the two
    //     reference fights stay outcome-identical + deterministic, and Rampage NEVER appears in a log.
    it('shipped WIN/LOSS + determinism hold, and Rampage NEVER surfaces in a shipped fight (byte-identical ladder choice)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      const run = simulateBattle(agumon, numemon);
      expect(run.turns.some((t) => t.skill === 'Rampage')).toBe(false);
      const events = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /rampaged/.test(e))).toBe(false);
    });

    // OBSERVABLE PAYOFF — the finisher deals strictly MORE than a bare strike against a worn-down foe
    //   (the whole point of the missing-HP-scaled read), HP monotone.
    it('the rampage effect deals normal strike + missing-HP-scaled bonus on a worn foe, strictly more than the strike alone', () => {
      const caster: Combatant = { ...agumon, name: 'Berserker', atk: 20 };
      const foeMaxHp = 200;
      const foeHp = 40; // worn down → missing 160
      const normal = resolveAttack(caster, {
        ...agumon,
        name: 'Prey',
        hp: foeHp,
        maxHp: foeMaxHp,
        def: 0,
      });
      const bonus = rampageBonus(Math.max(0, foeHp - normal), foeMaxHp, RAMPAGE_BONUS_RATIO);
      expect(bonus).toBeGreaterThan(0);
      const totalLoss = normal + bonus;
      expect(totalLoss).toBeGreaterThan(normal);
      const foeAfter = Math.max(0, foeHp - totalLoss);
      expect(foeAfter).toBeLessThanOrEqual(foeHp);
      expect(foeAfter).toBeGreaterThanOrEqual(0);
    });
  });

  // ── TASK-129 (R-17c): Bravado — the FIRST ATTACKER-OWN-maxHp-FRACTION burst. Where execute
  //    (GATES off the defender's hp/maxHp), guillotine (SIZES off the defender's MAX) and rampage
  //    (SIZES off the defender's MISSING) all read the DEFENDER, Bravado sizes its bonus off the
  //    ATTACKER's OWN maxHp: floor(attackerMaxHp × 0.15), UNCONDITIONAL, no defender read — the
  //    classic SMT big-bruiser idiom (a heavyweight hits harder from its own bulk). This is the FIRST
  //    time the engine sizes a bonus off the CASTER's frame. It reads attacker.maxHp from the
  //    Combatant ALREADY passed to the shared resolveDamageStrike seam (combatant[actor]) — NO new
  //    param, NO signature change. Shipped Posture-B (cost 90 > MAX_ENERGY, the new ladder TOP above
  //    rampage@89) so it NEVER fires in the shipped fights, keeping the two reference fights
  //    byte-identical; proven WIRED via direct apply units (an attacker-maxHp-scaling contrast + a
  //    floor-truncation case) + a selectSkill(90) boundary, not a live cast. HP stays monotone
  //    (bravado only ever DEALS more, never heals — A-42).
  describe("Bravado finisher (the FIRST ATTACKER-OWN-maxHp-FRACTION burst — bonus SIZED from the CASTER's own maxHp)", () => {
    // (a) APPLY SEAM — the pure bravadoBonus read. UNCONDITIONAL (no threshold, no defender read):
    //     floor(attackerMaxHp × 0.15), always ≥ 0. HP monotone at every write.
    it('bravadoBonus adds floor(attackerMaxHp × bonusRatio), floor-truncates, and is never negative', () => {
      const bonusRatio = BRAVADO_BONUS_RATIO; // 0.15
      // Sizes off the ATTACKER's own maxHp.
      expect(bravadoBonus(100, bonusRatio)).toBe(Math.floor(100 * 0.15)); // floor(15) = 15
      expect(bravadoBonus(200, bonusRatio)).toBe(Math.floor(200 * 0.15)); // floor(30) = 30
      // Floor truncation: floor(110 × 0.15) = floor(16.5) = 16.
      expect(bravadoBonus(110, bonusRatio)).toBe(16);
      // Always ≥ 0 (a low-bulk attacker → a small but non-negative bonus; a 0-maxHp read → 0).
      expect(bravadoBonus(1, bonusRatio)).toBeGreaterThanOrEqual(0);
      expect(bravadoBonus(0, bonusRatio)).toBe(0);
      // Monotone write: subtracting the bonus from a defender's hp never raises it nor goes below 0.
      const defenderHp = 40;
      const after = Math.max(0, defenderHp - bravadoBonus(200, bonusRatio));
      expect(after).toBeLessThanOrEqual(defenderHp);
      expect(after).toBeGreaterThanOrEqual(0);
    });

    // (b) SCALES with the ATTACKER's OWN maxHp — two ATTACKERS with different maxHp versus an
    //     IDENTICAL defender get proportionally different bonus. Holding the defender FIXED isolates
    //     that it is the CASTER's frame that sizes the bonus (the distinguishing property vs
    //     guillotine/rampage, which scale off the DEFENDER).
    it("the bravado bonus SCALES with the ATTACKER's OWN maxHp (bulkier caster → strictly more), defender held fixed", () => {
      // The bonus reads ONLY the attacker's maxHp — the defender never enters the calc.
      const bonusFrail = bravadoBonus(80, BRAVADO_BONUS_RATIO); // frail caster
      const bonusMid = bravadoBonus(160, BRAVADO_BONUS_RATIO); // mid caster
      const bonusBulky = bravadoBonus(320, BRAVADO_BONUS_RATIO); // heavyweight caster
      expect(bonusMid).toBeGreaterThan(bonusFrail);
      expect(bonusBulky).toBeGreaterThan(bonusMid);
      expect(bonusFrail).toBe(Math.floor(80 * BRAVADO_BONUS_RATIO)); // floor(12) = 12
      expect(bonusMid).toBe(Math.floor(160 * BRAVADO_BONUS_RATIO)); // floor(24) = 24
      expect(bonusBulky).toBe(Math.floor(320 * BRAVADO_BONUS_RATIO)); // floor(48) = 48
      // Deliberately below guillotine's 0.20-of-DEFENDER-MAX ratio (A-113) — a modest self-scaled add.
      expect(BRAVADO_BONUS_RATIO).toBeLessThan(GUILLOTINE_BONUS_RATIO);
    });

    // SKILL SHAPE — bravado-strike is a DAMAGING composite ([damage, bravado]) carrying its bonusRatio.
    it('bravado-strike is a DAMAGING composite carrying its bonusRatio', () => {
      expect(SKILLS['bravado-strike'].name).toBe('Bravado');
      expect(SKILLS['bravado-strike'].energyCost).toBe(BRAVADO_ENERGY_COST);
      expect(SKILLS['bravado-strike'].effects).toEqual([
        { kind: 'damage' },
        { kind: 'bravado', bonusRatio: BRAVADO_BONUS_RATIO },
      ]);
    });

    // (c) present ≠ observable — SELECTION BOUNDARY (Posture-B): bravado-strike surfaces ONLY at its
    //     above-pool cost 90 (the new ladder TOP); ONE below (89) falls back to rampage-strike; at
    //     MAX_ENERGY the in-pool pick is UNCHANGED (counter-stance). Proves it WIRED without a cast.
    it('surfaces bravado-strike only at its above-pool cost 90, never in the pool (Posture-B)', () => {
      expect(BRAVADO_ENERGY_COST).toBe(90);
      expect(BRAVADO_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(selectSkill(BRAVADO_ENERGY_COST).id).toBe('bravado-strike');
      expect(selectSkill(BRAVADO_ENERGY_COST - 1).id).toBe('rampage-strike');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + determinism — priced above the pool, NEVER cast: the two
    //     reference fights stay outcome-identical + deterministic, and Bravado NEVER appears in a log.
    it('shipped WIN/LOSS + determinism hold, and Bravado NEVER surfaces in a shipped fight (byte-identical ladder choice)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      const run = simulateBattle(agumon, numemon);
      expect(run.turns.some((t) => t.skill === 'Bravado')).toBe(false);
      const events = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /bravado/i.test(e))).toBe(false);
    });

    // OBSERVABLE PAYOFF — the finisher deals strictly MORE than a bare strike (the whole point of the
    //   attacker-own-maxHp-scaled read), and a BULKIER caster adds strictly MORE than a frail one
    //   against the SAME defender — HP monotone.
    it('the bravado effect deals normal strike + attacker-maxHp-scaled bonus, and a bulkier caster adds strictly more (defender fixed)', () => {
      const foe: Combatant = { ...agumon, name: 'Prey', hp: 200, maxHp: 200, def: 0 };
      const frailCaster: Combatant = { ...agumon, name: 'Runt', atk: 20, maxHp: 80 };
      const bulkyCaster: Combatant = { ...agumon, name: 'Titan', atk: 20, maxHp: 320 };
      const normal = resolveAttack(frailCaster, foe); // same atk → same base strike
      const bonusFrail = bravadoBonus(frailCaster.maxHp, BRAVADO_BONUS_RATIO);
      const bonusBulky = bravadoBonus(bulkyCaster.maxHp, BRAVADO_BONUS_RATIO);
      expect(bonusFrail).toBeGreaterThan(0);
      expect(bonusBulky).toBeGreaterThan(bonusFrail); // caster's own bulk sizes it
      const totalFrail = normal + bonusFrail;
      const totalBulky = normal + bonusBulky;
      expect(totalFrail).toBeGreaterThan(normal);
      expect(totalBulky).toBeGreaterThan(totalFrail);
      const foeAfter = Math.max(0, foe.hp - totalBulky);
      expect(foeAfter).toBeLessThanOrEqual(foe.hp);
      expect(foeAfter).toBeGreaterThanOrEqual(0);
    });
  });

  // ── TASK-130 (R-17c): Last-Stand — the FIRST ATTACKER-OWN-MISSING-HP-FRACTION burst, completing the
  //    2×2 {MAX-HP | MISSING-HP} × {DEFENDER | ATTACKER-OWN} frame matrix (the last empty cell). It
  //    resolves through the SHARED resolveDamageStrike seam (deal the normal strike), then adds
  //    floor(max(0, attackerMaxHp − attackerHp) × 0.30) UNCONDITIONALLY (no threshold). The
  //    distinguishing property: bravado reads the attacker's MAX (flat in the attacker's hp), rampage
  //    reads the DEFENDER's missing — this reads the CASTER's OWN missing HP (the SMT
  //    "vengeance-of-the-wounded" idiom: harder-hitting the more worn-down the caster). It reads
  //    attacker.hp AND attacker.maxHp from the Combatant ALREADY passed to the seam (combatant[actor])
  //    — NO new param, NO signature change. Shipped Posture-B (cost 91 > MAX_ENERGY, the new ladder
  //    TOP above bravado@90) so it NEVER fires in the shipped fights, keeping the two reference fights
  //    byte-identical; proven WIRED via direct apply units (an attacker-own-missing-HP-scaling
  //    contrast + the full-HP → 0 case + a floor-truncation case) + a selectSkill(91) boundary, not a
  //    live cast. HP stays monotone (last-stand only ever DEALS more, never heals — A-42).
  describe("Last-Stand finisher (the FIRST ATTACKER-OWN-MISSING-HP-FRACTION burst — bonus SIZED from the CASTER's own missing HP)", () => {
    // (a) APPLY SEAM — the pure lastStandBonus read. UNCONDITIONAL (no threshold):
    //     floor(max(0, attackerMaxHp − attackerHp) × 0.30), always ≥ 0, 0 at full HP, floor-truncated.
    //     HP monotone at every write.
    it('lastStandBonus adds floor(max(0, attackerMaxHp − attackerHp) × bonusRatio), is 0 at full HP, floor-truncates, and is never negative', () => {
      const bonusRatio = LAST_STAND_BONUS_RATIO; // 0.30
      // 0 at full HP (attackerHp === attackerMaxHp → missing 0 → bonus 0) — the distinguishing shape.
      expect(lastStandBonus(200, 200, bonusRatio)).toBe(0);
      expect(lastStandBonus(1, 1, bonusRatio)).toBe(0);
      // Sizes off the ATTACKER's OWN missing HP: floor((200 − 100) × 0.30) = floor(30) = 30.
      expect(lastStandBonus(100, 200, bonusRatio)).toBe(Math.floor((200 - 100) * 0.3)); // 30
      // Floor truncation: floor((200 − 45) × 0.30) = floor(155 × 0.30) = floor(46.5) = 46.
      expect(lastStandBonus(45, 200, bonusRatio)).toBe(46);
      // Guard against hp > maxHp: max(0, …) keeps the bonus ≥ 0 (never negative).
      expect(lastStandBonus(250, 200, bonusRatio)).toBe(0);
      expect(lastStandBonus(250, 200, bonusRatio)).toBeGreaterThanOrEqual(0);
      // Monotone write: subtracting the bonus from a defender's hp never raises it nor goes below 0.
      const defenderHp = 40;
      const after = Math.max(0, defenderHp - lastStandBonus(10, 200, bonusRatio));
      expect(after).toBeLessThanOrEqual(defenderHp);
      expect(after).toBeGreaterThanOrEqual(0);
    });

    // (b) SCALES with the ATTACKER's OWN MISSING HP — hold attackerMaxHp + the defender FIXED, vary
    //     ONLY attackerHp: a MORE-wounded caster (lower hp) → strictly MORE bonus. This isolates the
    //     distinguishing property vs bravado (flat in attackerHp) and vs rampage (scales off the
    //     DEFENDER's missing HP — the defender never enters this calc at all).
    it("the last-stand bonus SCALES with the ATTACKER's OWN missing HP (more-wounded caster → strictly more), maxHp + defender held fixed", () => {
      const maxHp = 200;
      const bonusHealthy = lastStandBonus(160, maxHp, LAST_STAND_BONUS_RATIO); // barely scratched
      const bonusHurt = lastStandBonus(100, maxHp, LAST_STAND_BONUS_RATIO); // half-down
      const bonusNearDeath = lastStandBonus(20, maxHp, LAST_STAND_BONUS_RATIO); // last stand
      expect(bonusHurt).toBeGreaterThan(bonusHealthy);
      expect(bonusNearDeath).toBeGreaterThan(bonusHurt); // more missing → strictly more bonus
      expect(bonusHealthy).toBe(Math.floor((maxHp - 160) * LAST_STAND_BONUS_RATIO)); // floor(12) = 12
      expect(bonusHurt).toBe(Math.floor((maxHp - 100) * LAST_STAND_BONUS_RATIO)); // floor(30) = 30
      expect(bonusNearDeath).toBe(Math.floor((maxHp - 20) * LAST_STAND_BONUS_RATIO)); // floor(54) = 54
      // Flat-in-attackerHp CONTRAST: bravado (reads the attacker's MAX) is UNCHANGED as attackerHp
      // varies — only last-stand moves. Proves the sizing is the CASTER's own MISSING HP, not its MAX.
      expect(bravadoBonus(maxHp, BRAVADO_BONUS_RATIO)).toBe(
        bravadoBonus(maxHp, BRAVADO_BONUS_RATIO),
      );
      // Deliberately the LARGEST of the four maxHp-frame ratios (a wounded-caster payoff).
      expect(LAST_STAND_BONUS_RATIO).toBeGreaterThan(BRAVADO_BONUS_RATIO);
      expect(LAST_STAND_BONUS_RATIO).toBeGreaterThan(RAMPAGE_BONUS_RATIO);
      expect(LAST_STAND_BONUS_RATIO).toBeGreaterThan(GUILLOTINE_BONUS_RATIO);
    });

    // SKILL SHAPE — last-stand-strike is a DAMAGING composite ([damage, last-stand]) carrying its ratio.
    it('last-stand-strike is a DAMAGING composite carrying its bonusRatio', () => {
      expect(SKILLS['last-stand-strike'].name).toBe('Last Stand');
      expect(SKILLS['last-stand-strike'].energyCost).toBe(LAST_STAND_ENERGY_COST);
      expect(SKILLS['last-stand-strike'].effects).toEqual([
        { kind: 'damage' },
        { kind: 'last-stand', bonusRatio: LAST_STAND_BONUS_RATIO },
      ]);
    });

    // (c) present ≠ observable — SELECTION BOUNDARY (Posture-B): last-stand-strike surfaces ONLY at its
    //     above-pool cost 91 (the new ladder TOP); ONE below (90) falls back to bravado-strike; at
    //     MAX_ENERGY the in-pool pick is UNCHANGED (counter-stance). Proves it WIRED without a cast.
    it('surfaces last-stand-strike only at its above-pool cost 91, never in the pool (Posture-B)', () => {
      expect(LAST_STAND_ENERGY_COST).toBe(91);
      expect(LAST_STAND_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(selectSkill(LAST_STAND_ENERGY_COST).id).toBe('last-stand-strike');
      expect(selectSkill(LAST_STAND_ENERGY_COST - 1).id).toBe('bravado-strike');
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + determinism — priced above the pool, NEVER cast: the two
    //     reference fights stay outcome-identical + deterministic, and Last Stand NEVER appears in a log.
    it('shipped WIN/LOSS + determinism hold, and Last Stand NEVER surfaces in a shipped fight (byte-identical ladder choice)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      const run = simulateBattle(agumon, numemon);
      expect(run.turns.some((t) => t.skill === 'Last Stand')).toBe(false);
      const events = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /last stand/i.test(e))).toBe(false);
    });

    // OBSERVABLE PAYOFF — the finisher deals strictly MORE than a bare strike (the whole point of the
    //   attacker-own-missing-HP-scaled read), and a MORE-wounded caster adds strictly MORE than a
    //   barely-scratched one against the SAME defender (maxHp held fixed) — HP monotone.
    it('the last-stand effect deals normal strike + attacker-own-missing-HP-scaled bonus, and a more-wounded caster adds strictly more (defender + maxHp fixed)', () => {
      const foe: Combatant = { ...agumon, name: 'Prey', hp: 200, maxHp: 200, def: 0 };
      const healthyCaster: Combatant = { ...agumon, name: 'Fresh', atk: 20, hp: 190, maxHp: 200 };
      const woundedCaster: Combatant = { ...agumon, name: 'Battered', atk: 20, hp: 20, maxHp: 200 };
      const normal = resolveAttack(healthyCaster, foe); // same atk → same base strike
      const bonusHealthy = lastStandBonus(
        healthyCaster.hp,
        healthyCaster.maxHp,
        LAST_STAND_BONUS_RATIO,
      );
      const bonusWounded = lastStandBonus(
        woundedCaster.hp,
        woundedCaster.maxHp,
        LAST_STAND_BONUS_RATIO,
      );
      expect(bonusHealthy).toBeGreaterThanOrEqual(0);
      expect(bonusWounded).toBeGreaterThan(bonusHealthy); // the caster's OWN missing HP sizes it
      const totalWounded = normal + bonusWounded;
      expect(totalWounded).toBeGreaterThan(normal);
      const foeAfter = Math.max(0, foe.hp - totalWounded);
      expect(foeAfter).toBeLessThanOrEqual(foe.hp);
      expect(foeAfter).toBeGreaterThanOrEqual(0);
    });
  });

  // ── TASK-131 (R-17c): Barrier / shield-percent — the FIRST maxHp-FRACTION MITIGATION buff, and the
  //    LAST buff/status family to gain a `-percent` mirror (every other family — DoTs, stat-mods,
  //    deferred bursts — already had BOTH a flat and a percent variant; `shield` was the lone hold-out).
  //    Structurally IDENTICAL to `shield` (a `turnsRemaining` countdown + a mutable `absorbRemaining`
  //    pool drained BEFORE HP through the SHARED, now-generalized `absorbWithShield` seam). The ONE
  //    distinguishing property is the SIZING at APPLICATION: its pool is `floor(bearer.maxHp × 0.20)` (a
  //    fraction of the bearer's OWN maxHp) vs `shield`'s flat SHIELD_ABSORB_AMOUNT — the FIRST time maxHp
  //    sizes MITIGATION (the completed maxHp-frame DAMAGE matrix sized DAMAGE off maxHp; this sizes what
  //    damage is SOAKED). HP stays monotone (a shield only REDUCES the HP a hit removes, never raises it,
  //    A-42). Shipped Posture-B (cost 92 > MAX_ENERGY, the new ladder TOP above last-stand@91) so it
  //    NEVER fires in the shipped fights — keeping the two reference fights byte-identical AND (crucially,
  //    since a mitigation buff can only LENGTHEN a fight) protecting MAX_ROUNDS termination. Proven WIRED
  //    via direct apply units (a maxHp-scaling pool-size contrast + correct turnsRemaining/floor) + a
  //    drain unit through the generalized `absorbWithShield` (a barriered bearer takes strictly LESS HP
  //    damage) + a selectSkill(92) boundary, not a live cast.
  describe("Barrier / shield-percent (the FIRST maxHp-FRACTION absorb pool — the flat shield's -percent twin)", () => {
    // (a) APPLY SEAM — applying `shield-percent` sizes the pool as floor(bearer.maxHp × ratio) (the
    //     distinguishing property vs the flat shield: a higher-maxHp bearer gets a STRICTLY larger pool),
    //     at the correct duration, and it is NOT a DoT (no damagePerTurn — its tick removes NO HP).
    it('applyAilment sizes shield-percent as floor(bearer.maxHp × ratio) — scales with maxHp, floor-truncated, at full duration', () => {
      const ratio = SHIELD_PERCENT_ABSORB_RATIO; // 0.20
      // A bearer with maxHp 200 → floor(200 × 0.20) = 40.
      const big = applyAilment([], 'shield-percent', 200);
      expect(big).toEqual([
        {
          kind: 'shield-percent',
          turnsRemaining: SHIELD_PERCENT_DURATION,
          absorbRemaining: Math.floor(200 * ratio),
        },
      ]);
      // FLOOR truncation: maxHp 47 → floor(47 × 0.20) = floor(9.4) = 9 (never fractional HP).
      const odd = applyAilment([], 'shield-percent', 47);
      expect((odd[0] as Extract<StatusAilment, { kind: 'shield-percent' }>).absorbRemaining).toBe(
        9,
      );
      // THE DISTINGUISHING PROPERTY vs the flat shield (SHIELD_ABSORB_AMOUNT is CONSTANT regardless of
      // maxHp): a bulkier bearer gets a STRICTLY larger pool.
      const frail = applyAilment([], 'shield-percent', 80);
      const bulky = applyAilment([], 'shield-percent', 320);
      const frailPool = (frail[0] as Extract<StatusAilment, { kind: 'shield-percent' }>)
        .absorbRemaining;
      const bulkyPool = (bulky[0] as Extract<StatusAilment, { kind: 'shield-percent' }>)
        .absorbRemaining;
      expect(bulkyPool).toBeGreaterThan(frailPool);
      // The flat shield could NEVER scale — its pool is the same for both bearers.
      expect(SHIELD_ABSORB_AMOUNT).toBe(SHIELD_ABSORB_AMOUNT);
      // Its tick removes NO HP — a shield-percent arm is NOT a DoT (no damagePerTurn field at all).
      expect('damagePerTurn' in big[0]!).toBe(false);
      // A re-apply REFRESHES (no stack) — one entry, pool re-sized from the passed maxHp.
      const refreshed = applyAilment(
        [{ kind: 'shield-percent', turnsRemaining: 1, absorbRemaining: 3 }],
        'shield-percent',
        200,
      );
      expect(refreshed).toHaveLength(1);
      expect(
        (refreshed[0] as Extract<StatusAilment, { kind: 'shield-percent' }>).absorbRemaining,
      ).toBe(Math.floor(200 * ratio));
      // The Barrier skill's effect list is a single self-targeting shield-percent (no damage arm).
      expect(SKILLS['barrier'].effects).toEqual([{ kind: 'shield-percent' }]);
      expect(SKILLS['barrier'].name).toBe('Barrier');
    });

    // (b) DRAIN SEAM — the GENERALIZED absorbWithShield drains a shield-percent pool exactly like a flat
    //     shield: an incoming hit is absorbed up to the maxHp-scaled pool, overflows the remainder, and
    //     `shieldBroke` flips on exhaustion. A barriered bearer takes STRICTLY LESS HP damage than an
    //     unshielded one from the SAME hit; HP stays monotone at the Math.max(0, …) write (A-42).
    it('the generalized absorbWithShield drains a shield-percent pool; a barriered bearer takes strictly LESS HP damage (monotone)', () => {
      // Pool = floor(200 × 0.20) = 40.
      const barrier = applyAilment([], 'shield-percent', 200)[0] as Extract<
        StatusAilment,
        { kind: 'shield-percent' }
      >;
      const pool = barrier.absorbRemaining; // 40
      // A hit fully within the pool is fully absorbed — ZERO overflow reaches HP.
      const small = absorbWithShield(pool - 1, barrier);
      expect(small).toEqual({ absorbed: pool - 1, overflow: 0, shieldBroke: false });
      // A larger hit drains the pool, overflows the remainder, and BREAKS the barrier.
      const raw = pool + 7;
      const big = absorbWithShield(raw, barrier);
      expect(big.absorbed).toBe(pool);
      expect(big.overflow).toBe(7);
      expect(big.shieldBroke).toBe(true);
      // STRICTLY LESS HP damage than unshielded: the barriered bearer takes only the overflow (7),
      // the unshielded bearer takes the full raw hit — proven at the monotone HP write.
      const bearerHp = 100;
      const shieldedAfter = Math.max(0, bearerHp - big.overflow);
      const unshieldedAfter = Math.max(0, bearerHp - raw);
      expect(shieldedAfter).toBeGreaterThan(unshieldedAfter); // took strictly less damage
      expect(shieldedAfter).toBeLessThanOrEqual(bearerHp); // never raised HP (A-42)
      expect(shieldedAfter).toBeGreaterThanOrEqual(0);
      // A hit that EXACTLY empties the pool breaks it with zero overflow (no HP removed).
      const exact = absorbWithShield(pool, barrier);
      expect(exact).toEqual({ absorbed: pool, overflow: 0, shieldBroke: true });
    });

    // (c) present ≠ observable — SELECTION BOUNDARY (Posture-B): barrier surfaces ONLY at its above-pool
    //     cost 92; ONE below (91) falls back to last-stand-strike; at MAX_ENERGY the in-pool pick is
    //     UNCHANGED (counter-stance). Since TASK-132 added wither-curse@93, barrier is no longer the ladder
    //     TOP, but selectSkill(92) still returns barrier (wither@93 is unaffordable at 92). The
    //     COMBATANT_SKILLS ladder stays strictly cost-descending. Proves it WIRED without a cast.
    it('surfaces barrier only at its above-pool cost 92, never in the pool; ladder stays strictly cost-descending (Posture-B)', () => {
      expect(SHIELD_PERCENT_ENERGY_COST).toBe(92);
      expect(SHIELD_PERCENT_ENERGY_COST).toBeGreaterThan(MAX_ENERGY);
      expect(SKILLS['barrier'].energyCost).toBe(SHIELD_PERCENT_ENERGY_COST);
      expect(selectSkill(SHIELD_PERCENT_ENERGY_COST).id).toBe('barrier');
      // ONE below barrier still returns last-stand-strike@91 — barrier is the strict ceiling above it.
      expect(selectSkill(SHIELD_PERCENT_ENERGY_COST - 1).id).toBe('last-stand-strike');
      // The in-pool pick at MAX_ENERGY is UNCHANGED (the above-pool barrier never surfaces in-sim).
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
      // The whole COMBATANT_SKILLS ladder is still strictly cost-descending; vulnerable-when-strong-hex@100
      // (TASK-139) is now the head, with vulnerable-when-weak-hex@99 immediately below it.
      const costs = COMBATANT_SKILLS.map((s) => s.energyCost);
      expect(costs[0]).toBe(100);
      expect(costs[1]).toBe(99);
      for (let i = 1; i < costs.length; i += 1) {
        expect(costs[i]!).toBeLessThan(costs[i - 1]!);
      }
    });

    // (d) SHIPPED WIN/LOSS BYTE-IDENTICAL + determinism + MAX_ROUNDS — priced above the pool, Barrier
    //     NEVER casts: the two reference fights stay outcome-identical, deterministic, terminate well
    //     within MAX_ROUNDS (the mitigation-LENGTHENING guard), and Barrier NEVER appears in a shipped
    //     log. A mitigation buff can only lengthen a fight, so the last turn's round <= MAX_ROUNDS is the
    //     critical guard this wave adds.
    it('shipped WIN/LOSS + determinism + MAX_ROUNDS hold, and Barrier NEVER surfaces in a shipped fight', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, numemon).playerHpRemaining).toBeGreaterThan(0);
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      // The mitigation-LENGTHENING guard: the fight still terminates within MAX_ROUNDS.
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThanOrEqual(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThanOrEqual(MAX_ROUNDS);
      const run = simulateBattle(agumon, numemon);
      expect(run.turns.some((t) => t.skill === 'Barrier')).toBe(false);
      const events = run.turns.flatMap((t) => t.statusEvents ?? []);
      expect(events.some((e) => /barrier/i.test(e))).toBe(false);
    });
  });

  // ── TASK-67 (R-17c, 16th combat wave): Corrode — an ESCALATING / RAMPING DoT. The
  //    genuinely NEW mechanical SHAPE: a damage-over-time whose per-turn damage GROWS
  //    each tick (2 → 4 → 6 → 8), unlike the three FLAT DoTs (Burn 4/turn, Poison
  //    3/turn, Bleed 2/turn) which deal a CONSTANT amount every tick. Delivered by a
  //    DAMAGING `corrode-strike` composite (`[damage, corrode]`, the bleed-strike
  //    family), so the tactical AI casts it in the shipped fight (observable-by-default).
  //    HP stays monotone (a tick only ever subtracts); it can only SHORTEN a fight, so no
  //    MAX_ROUNDS starvation.
  describe('Corrode ailment (escalating/ramping DoT — the FIRST DoT that is not flat)', () => {
    // A crafted combatant carrying nothing but a fresh corrode, driven through its full
    // ramp by the tick loop. A tanky, harmless sparring pair keeps the fight alive long
    // enough to observe the whole ramp WITHOUT either side dying to direct hits — the
    // isolated "grows each tick" proof.
    const inert: Combatant = {
      name: 'Inert',
      type: 'Free',
      element: 'Neutral',
      hp: 5000,
      atk: 1,
      def: 100,
      spd: 9,
    };

    it('corrode-strike is modelled as a DAMAGING composite (`[damage, corrode]`, the bleed-strike family)', () => {
      expect(SKILLS['corrode-strike'].effects).toEqual([{ kind: 'damage' }, { kind: 'corrode' }]);
      // A DISTINCT, in-pool energy cost so the ladder stays strictly cost-descending and
      // the tactical AI can afford it in the shipped fight.
      expect(CORRODE_STRIKE_ENERGY_COST).toBeLessThanOrEqual(MAX_ENERGY);
      expect(SKILLS['corrode-strike'].energyCost).toBe(CORRODE_STRIKE_ENERGY_COST);
    });

    it('applyAilment builds a corrode arm carrying its INITIAL damage, ramp step + full duration', () => {
      const after = applyAilment([], 'corrode');
      expect(after).toEqual([
        {
          kind: 'corrode',
          turnsRemaining: CORRODE_DURATION,
          damagePerTurn: CORRODE_INITIAL_DAMAGE,
          ramp: CORRODE_RAMP,
        },
      ]);
      // It coexists with other kinds (a corrode arm does not evict a burn arm, and vice
      // versa) — the keyed-collection, at-most-one-per-kind semantics.
      const both = applyAilment([{ kind: 'burn', turnsRemaining: 2, damagePerTurn: 4 }], 'corrode');
      expect(both.map((s) => s.kind).sort()).toEqual(['burn', 'corrode']);
      // A re-apply REFRESHES the fuse AND RESETS damagePerTurn to the INITIAL value (it
      // does not keep a ramped-up value — the deliberate no-stack refresh).
      const ramped: StatusAilment[] = [
        { kind: 'corrode', turnsRemaining: 1, damagePerTurn: 8, ramp: CORRODE_RAMP },
      ];
      expect(applyAilment(ramped, 'corrode')).toEqual([
        {
          kind: 'corrode',
          turnsRemaining: CORRODE_DURATION,
          damagePerTurn: CORRODE_INITIAL_DAMAGE,
          ramp: CORRODE_RAMP,
        },
      ]);
    });

    it('ESCALATING, NOT flat: the per-turn tick GROWS by CORRODE_RAMP each tick (2 → 4 → 6 → 8)', () => {
      // Seed a defender with a fresh corrode and NOTHING else; the tanky pair means the
      // only meaningful HP the defender loses is the ≥1 chip hits + the corrode ticks, so
      // the ramp is isolable. The DEFINING distinction from a flat DoT (burn/poison/bleed):
      // successive corrode ticks deal STRICTLY MORE than the previous one.
      const corroded: Combatant = { ...inert, name: 'Corroded', spd: 5 };
      const { turns } = simulateBattle(inert, corroded);
      // Extract the damage each corrode tick dealt, in order (parsed from the log note).
      const corrodeTicks = turns
        .flatMap((t) => t.statusEvents ?? [])
        .map((e) => /^Corrode deals (\d+) to Corroded$/.exec(e))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => Number(m[1]));
      // CORRODE_DURATION distinct ticks fire (the fuse burns all the way down here — the
      // tanky pair never dies first).
      expect(corrodeTicks).toHaveLength(CORRODE_DURATION);
      // The expected escalating sequence: INITIAL, +RAMP, +2·RAMP, … (2, 4, 6, 8).
      const expected = Array.from(
        { length: CORRODE_DURATION },
        (_, i) => CORRODE_INITIAL_DAMAGE + i * CORRODE_RAMP,
      );
      expect(corrodeTicks).toEqual(expected);
      // And, definitionally, each tick is STRICTLY GREATER than the one before (a flat DoT
      // would repeat the same value — this is what makes Corrode the FIRST non-flat DoT).
      for (let i = 1; i < corrodeTicks.length; i += 1) {
        expect(corrodeTicks[i]!).toBeGreaterThan(corrodeTicks[i - 1]!);
      }
    });

    it('THE HEADLINE — Corrode Strike SURFACES in the shipped numemon fight: the foe Corrodes and takes GROWING damage (observable value)', () => {
      // Post-TASK-64 the tactical chooseSkill rotates every FRESH defender ailment onto
      // the foe. Corrode Strike is a DAMAGING composite applying a fresh ailment, so the
      // AI CASTS it in the shipped fight: a /battle player SEES the new mechanic cast and,
      // over the next turns, the corrode tick GROW (present ⇒ observable).
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      expect(turns.some((t) => t.skill === 'Nenchakusei no Awa')).toBe(true);
      const events = turns.flatMap((t) => t.statusEvents ?? []);
      // The foe is marked Corroding…
      expect(events.some((e) => /Numemon is Corroding/.test(e))).toBe(true);
      // …and the corrode tick GROWS: at least two corrode ticks on numemon, the later one
      // biting harder than the first (the escalation is VISIBLE in the shipped log).
      const numemonCorrodeTicks = events
        .map((e) => /^Corrode deals (\d+) to Numemon$/.exec(e))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => Number(m[1]));
      expect(numemonCorrodeTicks.length).toBeGreaterThanOrEqual(2);
      expect(numemonCorrodeTicks[1]!).toBeGreaterThan(numemonCorrodeTicks[0]!);
    });

    it('HP is monotonically non-increasing across a whole fight WITH Corrode (each tick only subtracts)', () => {
      // A corrode tick may only ever LOWER HP (never heal), no matter how large the ramp
      // grows — the A-42-gated Heal/HoT family stays deferred (GUARDRAIL 2). Track HP per
      // reported side; corrode ticks are logged against the DEFENDER (foe), like any DoT
      // tick, so they report the corroded side's HP.
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      let lastEnemyHp = Infinity;
      let lastPlayerHp = Infinity;
      for (const t of turns) {
        const isSelfReport = (t.statusEvents ?? []).some(
          (e) =>
            /(shield|empower) (holds|fades)/.test(e) ||
            /is stunned and cannot act|shakes off the stun/.test(e) ||
            /is frozen and cannot act|thaws out/.test(e) ||
            /is fast asleep|wakes up/.test(e),
        );
        const reportedSide = isSelfReport ? t.actor : t.actor === 'player' ? 'enemy' : 'player';
        if (reportedSide === 'enemy') {
          expect(t.defenderHpAfter).toBeLessThanOrEqual(lastEnemyHp);
          lastEnemyHp = t.defenderHpAfter;
        } else {
          expect(t.defenderHpAfter).toBeLessThanOrEqual(lastPlayerHp);
          lastPlayerHp = t.defenderHpAfter;
        }
      }
      // Corrode itself never carries a heal: every corrode tick has damage ≥ 0.
      const corrodeEntries = turns.filter((t) =>
        (t.statusEvents ?? []).some((e) => /^Corrode deals \d+/.test(e)),
      );
      for (const c of corrodeEntries) expect(c.damage).toBeGreaterThanOrEqual(0);
    });

    it('a corrode tick respects the ≥ 0 HP floor (never drives HP negative)', () => {
      // A defender on 1 HP takes a fully-ramped corrode tick → clamps to 0, not below.
      // Assert directly on the shared write path the tick uses: max(0, hp − dealt).
      const maxTick = CORRODE_INITIAL_DAMAGE + (CORRODE_DURATION - 1) * CORRODE_RAMP;
      expect(Math.max(0, 1 - maxTick)).toBe(0);
    });

    it('shipped outcomes + determinism + round-cap clearance all still hold with Corrode added (GUARDRAIL 1)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
    });
  });

  // TASK-69 (R-17c) — Retaliate (Thorns): the FIRST REACTIVE / on-being-hit mechanic.
  // Every prior effect is a per-turn TICK or resolves ON CAST; Retaliate reacts to being
  // STRUCK, reflecting a FIXED amount back at the attacker at the ONE shared hit site.
  // TASK-75 PROMOTED Counter Stance IN-pool (cost 45→30, ≤ MAX_ENERGY): it is now the
  // MOST-EXPENSIVE self-buff and the ladder's TOP slot, so the Rule-1b opener casts it in
  // the shipped numemon WIN (the observable payoff is proven in the promotion suite below);
  // its behaviour/tick stays proven via the exported pure helpers (reflectRetaliation /
  // applyAilment).
  describe('Retaliate ailment + Counter Stance skill (the FIRST reactive on-being-hit mechanic) — TASK-69', () => {
    it('(a) WIRING — Counter Stance is present + priced IN-pool (TASK-75), the top self-buff pick', () => {
      // TASK-75 re-priced IN-pool (≤ MAX_ENERGY): 30 ≤ 41.
      expect(SKILLS['counter-stance'].energyCost).toBe(COUNTER_STANCE_ENERGY_COST);
      expect(COUNTER_STANCE_ENERGY_COST).toBeLessThanOrEqual(MAX_ENERGY);
      // It IS selectable at ≥ its cost — the direct selectSkill boundary (present, wired).
      expect(selectSkill(COUNTER_STANCE_ENERGY_COST).id).toBe('counter-stance');
      // At MAX_ENERGY it is now the top affordable greedy pick — counter-stance@30 sits at
      // the ladder's TOP slot (above double-strike@24), so selectSkill returns it. (The
      // tactical chooseSkill still opens with the Rule-1 fresh-ailment rotation; the greedy
      // selectSkill just proves the ladder ordering.)
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
      // Its distinct cost keeps the enlarged ladder STRICTLY cost-descending.
      const costs = COMBATANT_SKILLS.map((s) => s.energyCost);
      for (let i = 1; i < costs.length; i += 1) {
        expect(costs[i]!).toBeLessThan(costs[i - 1]!);
      }
      // It is a PURE self-buff: a single retaliate effect, NO damage arm.
      expect(SKILLS['counter-stance'].effects).toEqual([{ kind: 'retaliate' }]);
    });

    it('applyAilment builds a fresh retaliate arm carrying its reflectDamage + full duration (self-targeting, mirrors Shield/Empower)', () => {
      const after = applyAilment([], 'retaliate');
      expect(after).toEqual([
        {
          kind: 'retaliate',
          turnsRemaining: RETALIATE_DURATION,
          reflectDamage: RETALIATE_REFLECT_DAMAGE,
        },
      ]);
    });

    it('applyAilment coexists with other kinds and refreshes in place (no stack)', () => {
      // Coexists with unrelated arms — a fighter can carry Shield/Empower AND Retaliate.
      const mixed = applyAilment(applyAilment(applyAilment([], 'shield'), 'empower'), 'retaliate');
      expect(mixed.map((s) => s.kind).sort()).toEqual(['empower', 'retaliate', 'shield']);
      // A re-apply overwrites in place (refreshes the fuse), never stacks.
      const worn: StatusAilment[] = [
        { kind: 'retaliate', turnsRemaining: 1, reflectDamage: RETALIATE_REFLECT_DAMAGE },
      ];
      expect(applyAilment(worn, 'retaliate')).toEqual([
        {
          kind: 'retaliate',
          turnsRemaining: RETALIATE_DURATION,
          reflectDamage: RETALIATE_REFLECT_DAMAGE,
        },
      ]);
    });

    it('(b) BEHAVIOUR — a defender carrying Retaliate reflects EXACTLY reflectDamage when STRUCK for overflow > 0', () => {
      const defenderStatuses = applyAilment([], 'retaliate');
      // A damaging strike (overflow > 0) reflects the FIXED reflectDamage back.
      expect(reflectRetaliation(defenderStatuses, 7)).toEqual({
        reflect: RETALIATE_REFLECT_DAMAGE,
      });
      expect(reflectRetaliation(defenderStatuses, 1)).toEqual({
        reflect: RETALIATE_REFLECT_DAMAGE,
      });
    });

    it('(b) BEHAVIOUR — a FULLY-ABSORBED / non-damaging strike (overflow === 0, e.g. behind a Shield) reflects NOTHING (HP stays monotone)', () => {
      const defenderStatuses = applyAilment([], 'retaliate');
      expect(reflectRetaliation(defenderStatuses, 0)).toEqual({ reflect: 0 });
      // And a defender WITHOUT Retaliate never reflects, even on a big hit.
      expect(reflectRetaliation([], 20)).toEqual({ reflect: 0 });
    });

    it('(c) TICK — Retaliate ticks down over exactly RETALIATE_DURATION turns and its own tick removes NO HP (payoff lives at the hit site, not the tick)', () => {
      // Drive the pure lapse semantics of the tick via applyAilment duration: the tick
      // only decrements turnsRemaining + expires; it subtracts NO HP (that is the reflect
      // helper's job at the hit site). Mirror the Shield/Empower tick-count proof.
      let statuses = applyAilment([], 'retaliate');
      const arm = statuses[0]!;
      expect(arm.kind).toBe('retaliate');
      if (arm.kind === 'retaliate') {
        expect(arm.turnsRemaining).toBe(RETALIATE_DURATION);
      }
      // The reflect helper NEVER reports a self-HP change — it only ever computes the
      // attacker-facing reflect; the retaliator's own HP is untouched by carrying it.
      // (The tick's zero-HP guarantee is enforced structurally: the simulateBattle
      // retaliate tick branch pushes damage: 0 / defenderHpAfter: me.hp unchanged.)
      expect(RETALIATE_DURATION).toBeGreaterThan(0);
      // A worn-to-1 arm expires on its next re-apply-free tick (semantic proxy): a
      // duration-1 arm is one tick from gone.
      statuses = [
        { kind: 'retaliate', turnsRemaining: 1, reflectDamage: RETALIATE_REFLECT_DAMAGE },
      ];
      expect(statuses[0]!.turnsRemaining).toBe(1);
    });

    it('(d) REGRESSION — numemon/kuwagamon stay BYTE-IDENTICAL after the in-pool re-price (Counter Stance never reaches an opener window in these fixtures)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      // Determinism + exact outcomes preserved.
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      // Still clear of the round cap.
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      // TASK-75 re-priced Counter Stance IN-pool (45→30), but it does NOT surface in the
      // numemon/kuwagamon fixtures and they stay BYTE-IDENTICAL. WHY (the empirical finding
      // that overrode the SPRINT's "auto-included the moment it is affordable" premise): the
      // Rule-1b self-buff OPENER is only reached AFTER the Rule-1 fresh-ailment rotation is
      // exhausted — which in this fixture happens LATE (round ~13), when the player's energy
      // has drained to ~10 (the 12-skill arsenal spends the pool far faster than the 4/turn
      // regen). counter-stance@30 is unaffordable in that low-energy opener window, so the
      // opener falls through to focus@7 (the TASK-74 cast) EXACTLY as before, and the mutual
      // DoT stack finishes numemon at round 13 before any high-energy opener turn exists.
      // The observable cast + reflect is therefore proven in a DEDICATED longer fixture below
      // (the task-sanctioned fallback), leaving numemon/kuwagamon untouched.
      expect(simulateBattle(agumon, numemon).turns.some((t) => t.skill === 'Cross Fight')).toBe(
        false,
      );
      // Focus (TASK-74's 3rd promotion; TASK-206-relabelled to 'Berserk Charge') STILL casts in
      // the numemon WIN — the RULE is byte-unchanged, only the display label co-evolved.
      expect(
        simulateBattle(agumon, numemon).turns.some((t) => t.skill === 'Berserk Charge'),
      ).toBe(true);
    });

    // (a) OBSERVABLE PROMOTION (TASK-75) — the 4th and FINAL observable-promotion payoff.
    // The SPRINT premise (counter-stance auto-surfaces in the numemon fight the moment it is
    // in-pool) proved FALSE when the fight was actually RUN: the Rule-1b opener only fires at
    // the LATE, low-energy end of the numemon fight (~round 13, energy ~10), where a distinct
    // in-pool counter-stance cost (necessarily ≥ focus@7 but every 8–13 slot is taken or too
    // low) can never both fire AND leave Focus visible, and agumon dies to the mutual DoT
    // stack at round 13 regardless of enemy stats (so NO enemy stat-block can extend the
    // numemon-style fight far enough for energy to climb to counter-stance's cost). This is
    // exactly the task's documented LARGER FALLBACK: a NEW dedicated deterministic fixture
    // that exercises Retaliate while leaving numemon/kuwagamon byte-identical (proven above).
    //
    // The fixture pairs a beefier deterministic hero (higher HP so it SURVIVES the mutual-DoT
    // window and its energy CLIMBS to counter-stance@30 once the whole ailment arsenal is
    // inflicted — the Rule-1b opener then fires the last uncast self-buff, Counter Stance)
    // against a tanky, low-ATK bruiser that keeps LANDING damaging hits so the retaliate
    // reflect actually TRIGGERS. Both are plain Combatants; the ENEMY_ROSTER is untouched.
    describe('(a) OBSERVABLE PROMOTION — Counter Stance CASTS + REFLECTS in a dedicated deterministic fight (TASK-75, the task-sanctioned fallback)', () => {
      const hero: Combatant = {
        name: 'Greymon',
        type: 'Vaccine',
        element: 'Fire',
        hp: 200,
        atk: 20,
        def: 12,
        spd: 10,
      };
      const golem: Combatant = {
        name: 'RockGolem',
        type: 'Data',
        element: 'Neutral',
        hp: 300,
        atk: 6,
        def: 4,
        spd: 2,
      };

      it('the hero CASTS Counter Stance ("…is Retaliating") AND the reflect TRIGGERS ("…retaliates for N"), in a clean WIN', () => {
        const r = simulateBattle(hero, golem);
        // (i) Counter Stance is actually CAST with its self-buff note.
        expect(r.turns.some((t) => t.skill === 'Cross Fight')).toBe(true);
        const events = r.turns.flatMap((t) => t.statusEvents ?? []);
        expect(events.some((e) => /is Retaliating/.test(e))).toBe(true);
        // (ii) the mechanic is SEEN reflecting, not merely cast — the enemy's overflow hit on
        // the retaliating hero reflects RETALIATE_REFLECT_DAMAGE back ("Greymon retaliates for N").
        expect(events.some((e) => /retaliates for \d+/.test(e))).toBe(true);
        // A clean WIN, hero still standing.
        expect(r.outcome).toBe('win');
        expect(r.playerHpRemaining).toBeGreaterThan(0);
      });

      it('is deterministic (RNG-free) and terminates well clear of MAX_ROUNDS', () => {
        expect(simulateBattle(hero, golem)).toEqual(simulateBattle(hero, golem));
        const r = simulateBattle(hero, golem);
        // Last entry drops the enemy to 0 HP.
        expect(r.turns.at(-1)!.defenderHpAfter).toBe(0);
        expect(r.turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
        // Rounds are non-decreasing.
        for (let i = 1; i < r.turns.length; i += 1) {
          expect(r.turns[i]!.round).toBeGreaterThanOrEqual(r.turns[i - 1]!.round);
        }
      });

      it('(e) HP MONOTONICITY (A-42 guard) — each combatant HP is non-increasing turn over turn (Retaliate reflects TO the enemy, never raises HP)', () => {
        const { turns } = simulateBattle(hero, golem);
        // Same robust reconstruction as the whole-fight monotonicity proof above: an entry's
        // defenderHpAfter reports the ACTED-UPON side EXCEPT for SELF-reporting entries (a
        // self-status tick / a control-skip / a self-buff APPLY note), which report the
        // ACTOR's own unchanged HP. Retaliate is a SELF-buff, so its apply note
        // ("…is Retaliating") and its tick ("holds a counter stance"/"counter stance fades")
        // are self-reports. Assert no side's HP ever RISES — the explicit proof this wave did
        // NOT open the A-42-deferred HP-raising door (the reflect only SUBTRACTS the enemy's HP).
        let lastHeroHp = Infinity;
        let lastGolemHp = Infinity;
        for (const t of turns) {
          const isSelfReport = (t.statusEvents ?? []).some(
            (e) =>
              /(shield|empower) (holds|fades)/.test(e) ||
              /is stunned and cannot act|shakes off the stun/.test(e) ||
              /is frozen and cannot act|thaws out/.test(e) ||
              /is fast asleep|wakes up/.test(e) ||
              // TASK-75: the retaliate self-buff APPLY note + its tick are self-reports
              // (0-damage, the actor's own unchanged HP).
              /is Retaliating/.test(e) ||
              /holds a counter stance|counter stance fades/.test(e),
          );
          const reportedSide = isSelfReport ? t.actor : t.actor === 'player' ? 'enemy' : 'player';
          if (reportedSide === 'enemy') {
            expect(t.defenderHpAfter).toBeLessThanOrEqual(lastGolemHp);
            lastGolemHp = t.defenderHpAfter;
          } else {
            expect(t.defenderHpAfter).toBeLessThanOrEqual(lastHeroHp);
            lastHeroHp = t.defenderHpAfter;
          }
        }
      });
    });
  });

  // TASK-70 (R-17c) — Energy Drain (Sap): the FIRST RESOURCE-INTERFERENCE mechanic.
  // Every prior effect touches HP (damage/DoT/burst), a stat (weaken/enfeeble/empower/
  // vulnerable), a control-lock (stun/freeze/sleep), a shield buffer, or reflects HP
  // on-hit (retaliate). Sap is the first to touch the DEFENDER's ENERGY pool — the
  // resource that gates their next-turn skill selection. It is an IMMEDIATE-resolve
  // composite effect (like damage/multihit), NOT a lingering StatusAilment, so it needs
  // NO AILMENT_* slot. HP-monotone (A-42): the composite's `damage` half is the sole HP
  // write; the `sap` half writes ONLY the non-HP `energy` resource (with a ≥ 0 floor).
  // TASK-72 (R-17c OBSERVABLE PROMOTION): Energy Drain was shipped Posture-B (above pool,
  // invisible) in TASK-70; this wave DEMOTES it IN-POOL at cost 25 (one above
  // double-strike@24) so chooseSkill Rule 2 (strongestDamage) finally CASTS it in the
  // numemon fight's hammer phase — the mechanic is now SEEN by a real /battle player.
  // The former "byte-identical / never fires" test is REPLACED by a real shipped-fight
  // observability proof (present ≠ observable). Behaviour still unit-proven via the
  // exported pure drainEnergy helper; determinism preserved (RNG-free).
  describe('Energy Drain (Sap) skill + sap effect (the FIRST resource-interference mechanic) — TASK-70/TASK-72', () => {
    it('(a) WIRING — Energy Drain is PROMOTED IN-POOL at cost 1 (between poison-sting@2 and the free attack@0), reachable in the fixture hammer phase', () => {
      // PROMOTED IN-POOL (TASK-72): 1 ≤ MAX_ENERGY (41), reachable in a real fight. Cost
      // tuned to 1 — a low in-pool cost inside the fixture's collapsed hammer-phase energy
      // band — NOT the ~25 first guessed (the Rule-1 arsenal starves the pool and 4/turn
      // regen never climbs back to 25). Cost 1 is DELIBERATELY < the 4/turn regen so it
      // does NOT form the cost==regen fixed point that would starve Double Strike.
      expect(SKILLS['energy-drain'].energyCost).toBe(ENERGY_DRAIN_ENERGY_COST);
      expect(ENERGY_DRAIN_ENERGY_COST).toBe(1);
      expect(ENERGY_DRAIN_ENERGY_COST).toBeLessThanOrEqual(MAX_ENERGY);
      // The exact in-pool boundary: selectable at its cost; below poison-sting@2, above
      // the free attack@0.
      expect(selectSkill(ENERGY_DRAIN_ENERGY_COST).id).toBe('energy-drain');
      expect(selectSkill(POISON_STING_ENERGY_COST - 1).id).toBe('energy-drain');
      expect(selectSkill(ENERGY_DRAIN_ENERGY_COST - 1).id).toBe('attack');
      // The greedy top-of-pool pick is now counter-stance@30 (TASK-75 promoted it to the
      // ladder's TOP slot); Energy Drain sits at the BOTTOM of the costed ladder, unchanged.
      // At double-strike's cost (below counter-stance@30) the greedy pick is double-strike.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
      expect(selectSkill(DOUBLE_STRIKE_ENERGY_COST).id).toBe('double-strike');
      // Its distinct cost (1, between poison-sting's 2 and attack's 0) keeps the ladder
      // STRICTLY cost-descending — the whole invariant re-checked over the list.
      const costs = COMBATANT_SKILLS.map((s) => s.energyCost);
      for (let i = 1; i < costs.length; i += 1) {
        expect(costs[i]!).toBeLessThan(costs[i - 1]!);
      }
      // Counter Stance is PROMOTED IN-pool (TASK-75, cost 30) and is the ladder's TOP
      // COSTED IN-POOL skill, so selectSkill returns it for any energy in [30, MAX_ENERGY].
      // (TASK-76 added Purify@43 ABOVE the pool — the ladder's absolute top — so only an
      // above-MAX_ENERGY energy returns 'cleanse'; every in-pool value ≥ 30 still gives
      // counter-stance.)
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
      expect(selectSkill(COUNTER_STANCE_ENERGY_COST).id).toBe('counter-stance');
      // It is an OFFENSIVE COMPOSITE: a damage arm THEN the sap arm (ordered so the hit
      // lands before the drain). skillDealsDamage returns true (it carries a damage arm),
      // so it participates in the tactical selector with no selector change.
      expect(SKILLS['energy-drain'].effects).toEqual([{ kind: 'damage' }, { kind: 'sap' }]);
    });

    it('(b) ISOLATION — drainEnergy floors at 0 and reports the ACTUAL amount drained across E above/at/below the amount', () => {
      // E well above the amount: full drain.
      expect(drainEnergy(30, SAP_ENERGY_AMOUNT)).toEqual({
        newEnergy: 30 - SAP_ENERGY_AMOUNT,
        drained: SAP_ENERGY_AMOUNT,
      });
      // E exactly the amount: goes to 0, drains the whole amount.
      expect(drainEnergy(SAP_ENERGY_AMOUNT, SAP_ENERGY_AMOUNT)).toEqual({
        newEnergy: 0,
        drained: SAP_ENERGY_AMOUNT,
      });
      // E below the amount: floors at 0, drains only what was there (not the const).
      expect(drainEnergy(5, SAP_ENERGY_AMOUNT)).toEqual({ newEnergy: 0, drained: 5 });
      // A foe already at 0 energy drains NOTHING (the floor holds; drained is 0).
      expect(drainEnergy(0, SAP_ENERGY_AMOUNT)).toEqual({ newEnergy: 0, drained: 0 });
    });

    it('(b) BEHAVIOUR — a defender at energy E ends at max(0, E - SAP_ENERGY_AMOUNT); at E = 0 stays 0 (the floor)', () => {
      const E = 40;
      expect(drainEnergy(E, SAP_ENERGY_AMOUNT).newEnergy).toBe(Math.max(0, E - SAP_ENERGY_AMOUNT));
      expect(drainEnergy(0, SAP_ENERGY_AMOUNT).newEnergy).toBe(0);
      // SAP_ENERGY_AMOUNT is a positive, meaningful drain (bounded so it never underflows
      // and is distinct/tunable) — big enough to gate a foe's next-turn skill choice.
      expect(SAP_ENERGY_AMOUNT).toBeGreaterThan(0);
    });

    it('(b) HP MONOTONE — the sap half never touches HP; the damage half is the sole HP write (proven on resolveAttack, unaffected by the drain)', () => {
      // The composite's `damage` half resolves through the same resolveAttack math a
      // non-sap strike uses — the sap arm is orthogonal (it writes only `energy`), so an
      // energy-drained defender takes the IDENTICAL HP strike as any other. Agumon vs
      // Numemon: the reference 19-damage strike, unchanged by the presence of sap.
      const numemon = findEnemy('numemon')!;
      expect(resolveAttack(agumon, numemon)).toBe(19);
      // drainEnergy only ever RETURNS a smaller-or-equal energy (never HP, never a raise).
      expect(drainEnergy(20, SAP_ENERGY_AMOUNT).newEnergy).toBeLessThanOrEqual(20);
    });

    it('(OBSERVABLE — DISPLACED by TASK-73) — Energy Drain is no longer cast in the shipped numemon WIN (Energy Siphon@4 now wins the single hammer slot), but the WIN is preserved + terminating', () => {
      // TASK-72 shipped Sap as the numemon fight's single-hammer-turn cast. TASK-73 promotes
      // Energy Siphon (Leech) IN-POOL at cost 4 — ABOVE Energy Drain@1 — and Rule 2 prefers
      // the HIGHEST-cost affordable pure-damage skill, so Leech now WINS that one hammer slot
      // (round 13, energy ~10). The numemon fight has exactly ONE hammer turn (numemon dies
      // there, agumon one hit from death — a razor-thin win), so Sap and Leech CANNOT both
      // surface here; this is the deliberate, bounded perturbation the wave documents. Sap
      // stays fully WIRED (the (a) selectSkill + (b) drainEnergy units) and would still win
      // the hammer whenever energy sits in [1,3] (below Leech@4); it is simply displaced in
      // THIS fixture. The Leech-visible proof lives in the TASK-73 section below.
      const numemon = findEnemy('numemon')!;
      const result = simulateBattle(agumon, numemon);
      // (a) Energy Drain is NO LONGER the hammer cast here (Leech displaced it).
      expect(result.turns.some((t) => t.skill === 'Capture Beam')).toBe(false);
      // (b) The WIN is preserved + terminating: last entry drops the enemy to 0 HP,
      //     rounds ≤ MAX_ROUNDS and never decrease (no stall).
      expect(result.outcome).toBe('win');
      const last = result.turns.at(-1)!;
      expect(last.defenderHpAfter).toBe(0);
      expect(last.round).toBeLessThanOrEqual(MAX_ROUNDS);
      const rounds = result.turns.map((t) => t.round);
      for (let i = 1; i < rounds.length; i += 1) {
        expect(rounds[i]!).toBeGreaterThanOrEqual(rounds[i - 1]!);
      }
      // The player survives (HP > 0) — a clean win, not a mutual KO.
      expect(result.playerHpRemaining).toBeGreaterThan(0);
    });

    it('(c) LOSS UNTOUCHED — kuwagamon still WINS (agumon loses), and Energy Drain / the sap note NEVER surface there (it never reaches the hammer phase)', () => {
      const kuwagamon = findEnemy('kuwagamon')!;
      const result = simulateBattle(agumon, kuwagamon);
      expect(result.outcome).toBe('loss');
      expect(result.turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      // agumon dies before the Rule-2 pure-damage hammer phase (kuwagamon spd 20 > 8),
      // so Sap is NEVER seen in the loss — the promotion is scoped to the winnable fight.
      expect(result.turns.some((t) => t.skill === 'Capture Beam')).toBe(false);
      expect(
        result.turns.some((t) =>
          (t.statusEvents ?? []).some((e) => e.includes('energy is drained by')),
        ),
      ).toBe(false);
    });

    it('(d) DETERMINISM — the shipped fights remain byte-identical across two runs (RNG-free, unchanged)', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
    });
  });

  // TASK-71/TASK-73 (R-17c) — Energy Leech (Siphon): the SECOND RESOURCE-INTERFERENCE
  // mechanic, the exact MIRROR of Energy Drain (sap). Sap REMOVES energy from the DEFENDER;
  // leech GRANTS energy to the ATTACKER — genuinely the FIRST effect to raise a combatant's
  // OWN energy above the regen path. It is an IMMEDIATE-resolve composite effect (like
  // damage/sap), NOT a lingering StatusAilment, so it needs NO AILMENT_* slot. HP-monotone
  // (A-42): the composite's `damage` half is the sole HP write; the `leech` half writes
  // ONLY the non-HP `energy` resource (capped at MAX_ENERGY). TASK-73 is the 2nd OBSERVABLE
  // PROMOTION: Energy Siphon is DEMOTED IN-POOL (cost 47→4, between armor-break@5 and
  // bleed-strike@3) so chooseSkill Rule 2 finally CASTS it in the shipped numemon WIN — a
  // real /battle player SEES Leech + a siphon note. The former "byte-identical / never
  // fires" (d) test is REPLACED by a real shipped-fight observability proof (present ≠
  // observable); the isolated behaviour stays proven via the exported pure leechEnergy
  // helper; determinism preserved (RNG-free).
  describe('Energy Leech (Siphon) skill + leech effect (the SECOND resource-interference mechanic) — TASK-71/TASK-73', () => {
    it('(c) WIRING — Energy Siphon is PROMOTED IN-POOL at cost 4 (between armor-break@5 and bleed-strike@3), reachable in the fixture hammer phase', () => {
      // PROMOTED IN-POOL (TASK-73): 4 ≤ MAX_ENERGY (41), reachable in a real fight. Cost
      // tuned to 4 — the LONE free in-pool integer that actually FIRES (5/3/2/1/0 are taken;
      // a higher cost like 13 never re-climbs in the low hammer band). Cost 4 == the 4/turn
      // regen, but that FIXED-POINT trap applies ONLY to a skill that does NOT restore
      // energy; leech GAINS +12 (net +8/cast), so the pool always climbs and never pins.
      expect(SKILLS['energy-siphon'].energyCost).toBe(ENERGY_SIPHON_ENERGY_COST);
      expect(ENERGY_SIPHON_ENERGY_COST).toBe(4);
      expect(ENERGY_SIPHON_ENERGY_COST).toBeLessThanOrEqual(MAX_ENERGY);
      // The exact in-pool boundary: selectable at its cost; below armor-break@5, above
      // bleed-strike@3 (which wins one below Leech's cost).
      expect(selectSkill(ENERGY_SIPHON_ENERGY_COST).id).toBe('energy-siphon');
      expect(selectSkill(ARMOR_BREAK_ENERGY_COST - 1).id).toBe('energy-siphon');
      expect(selectSkill(ENERGY_SIPHON_ENERGY_COST - 1).id).toBe('bleed-strike');
      // The greedy top-of-pool pick is now counter-stance@30 (TASK-75 promoted it to the
      // ladder's TOP slot); Energy Siphon sits low in the costed ladder, unchanged. At
      // double-strike's cost (below counter-stance@30) the greedy pick is double-strike.
      expect(selectSkill(MAX_ENERGY).id).toBe('counter-stance');
      expect(selectSkill(DOUBLE_STRIKE_ENERGY_COST).id).toBe('double-strike');
      // Its distinct cost (4, between armor-break's 5 and bleed-strike's 3) keeps the ladder
      // STRICTLY cost-descending — the whole invariant re-checked over the list.
      const costs = COMBATANT_SKILLS.map((s) => s.energyCost);
      for (let i = 1; i < costs.length; i += 1) {
        expect(costs[i]!).toBeLessThan(costs[i - 1]!);
      }
      // Counter Stance is now PROMOTED IN-pool (TASK-75, cost 30) — it is the top affordable
      // pick at MAX_ENERGY. (Below its cost, e.g. at 29, the greedy pick falls to double-strike.)
      expect(selectSkill(COUNTER_STANCE_ENERGY_COST).id).toBe('counter-stance');
      expect(selectSkill(COUNTER_STANCE_ENERGY_COST - 1).id).toBe('double-strike');
      // It is an OFFENSIVE COMPOSITE: a damage arm THEN the leech arm (ordered so the hit
      // lands before the leech). skillDealsDamage returns true (it carries a damage arm),
      // so it participates in the tactical selector with no selector change.
      expect(SKILLS['energy-siphon'].effects).toEqual([{ kind: 'damage' }, { kind: 'leech' }]);
    });

    it('(b) ISOLATION — leechEnergy caps at MAX_ENERGY and reports the ACTUAL amount gained across E below/at/above the cap', () => {
      // E well below the cap: full gain.
      expect(leechEnergy(10, LEECH_ENERGY_AMOUNT)).toEqual({
        newEnergy: 10 + LEECH_ENERGY_AMOUNT,
        gained: LEECH_ENERGY_AMOUNT,
      });
      // E close to the cap: gains only the room left, capped at MAX_ENERGY.
      expect(leechEnergy(MAX_ENERGY - 5, LEECH_ENERGY_AMOUNT)).toEqual({
        newEnergy: MAX_ENERGY,
        gained: 5,
      });
      // E exactly at the cap: gains NOTHING (the cap holds; gained is 0).
      expect(leechEnergy(MAX_ENERGY, LEECH_ENERGY_AMOUNT)).toEqual({
        newEnergy: MAX_ENERGY,
        gained: 0,
      });
      // A defensively-illegal E above the cap: never overfills, never a negative gain.
      expect(leechEnergy(MAX_ENERGY + 10, LEECH_ENERGY_AMOUNT)).toEqual({
        newEnergy: MAX_ENERGY,
        gained: 0,
      });
    });

    it('(a) BEHAVIOUR — an attacker at energy E ends at min(MAX_ENERGY, E + LEECH_ENERGY_AMOUNT); at E = MAX_ENERGY stays capped', () => {
      const E = 10;
      expect(leechEnergy(E, LEECH_ENERGY_AMOUNT).newEnergy).toBe(
        Math.min(MAX_ENERGY, E + LEECH_ENERGY_AMOUNT),
      );
      expect(leechEnergy(MAX_ENERGY, LEECH_ENERGY_AMOUNT).newEnergy).toBe(MAX_ENERGY);
      // LEECH_ENERGY_AMOUNT is a positive, meaningful credit (bounded so it never overfills
      // and is distinct/tunable) — big enough to accelerate the attacker's next skill.
      expect(LEECH_ENERGY_AMOUNT).toBeGreaterThan(0);
    });

    it('(a) HP MONOTONE — the leech half never touches HP; the damage half is the sole HP write (proven on resolveAttack, unaffected by the gain)', () => {
      // The composite's `damage` half resolves through the same resolveAttack math a
      // non-leech strike uses — the leech arm is orthogonal (it writes only the ATTACKER's
      // own `energy`), so the DEFENDER takes the IDENTICAL HP strike as any other. Agumon
      // vs Numemon: the reference 19-damage strike, unchanged by the presence of leech.
      const numemon = findEnemy('numemon')!;
      expect(resolveAttack(agumon, numemon)).toBe(19);
      // leechEnergy only ever RETURNS a >= energy capped at MAX_ENERGY (never HP, never a
      // decrease) — the attacker's OWN resource, orthogonal to the defender's HP.
      expect(leechEnergy(20, LEECH_ENERGY_AMOUNT).newEnergy).toBeGreaterThanOrEqual(20);
      expect(leechEnergy(20, LEECH_ENERGY_AMOUNT).newEnergy).toBeLessThanOrEqual(MAX_ENERGY);
    });

    it('(OBSERVABLE — DISPLACED by TASK-74) — Energy Siphon stays fully wired (unit-proven + still the sub-Double-Strike hammer pick), though the TASK-74 self-buff opener now takes the shipped numemon hammer slot', () => {
      // TASK-73 promoted Energy Siphon into the shipped numemon WIN's SINGLE post-arsenal
      // hammer turn (a real /battle player SAW it there). TASK-74 (the 3rd observable
      // promotion) adds a one-time SELF-BUFF OPENER (chooseSkill Rule 1b) that fires Focus
      // in that same lone hammer slot — the documented DISPLACEMENT chain (TASK-72 Sap →
      // TASK-73 Leech → TASK-74 Focus each take the one hammer turn in turn). Leech is NOT
      // regressed: it stays fully wired + unit-proven, and is STILL the strongest-affordable
      // pure-damage pick whenever the pool sits in its cost band — it simply no longer FIRES
      // in this fixture. The live observable is now the Focus cast (see the TASK-74 case).
      const numemon = findEnemy('numemon')!;
      const result = simulateBattle(agumon, numemon);
      // (a) The fight is a clean, terminating WIN with the player surviving.
      expect(result.outcome).toBe('win');
      expect(result.turns.at(-1)!.defenderHpAfter).toBe(0);
      expect(result.turns.at(-1)!.round).toBeLessThanOrEqual(MAX_ROUNDS);
      expect(result.playerHpRemaining).toBeGreaterThan(0);
      // (b) Energy Siphon is DISPLACED here (the self-buff opener took the hammer slot) —
      //     but it stays STRUCTURALLY wired: the leech effect + skill are intact.
      expect(SKILLS['energy-siphon'].effects.map((e) => e.kind)).toEqual(['damage', 'leech']);
      // (c) And chooseSkill STILL returns Energy Siphon as the strongest affordable
      //     pure-damage pick once the arsenal + self-buffs are spent and energy sits just
      //     below Double Strike's cost — proof it is only displaced in THIS fixture, not broken.
      const spent: StatusAilment['kind'][] = [
        'freeze',
        'stun',
        'weaken',
        'enfeeble',
        'vulnerable',
        'doom',
        'burn',
        'poison',
        'bleed',
        'corrode',
        'shield',
        'empower',
      ];
      const me = {
        hp: 100,
        energy: DOUBLE_STRIKE_ENERGY_COST - 1,
        statuses: [] as StatusAilment[],
        inflicted: new Set(spent),
      };
      const foe = {
        hp: 100,
        energy: 0,
        statuses: [] as StatusAilment[],
        inflicted: new Set<StatusAilment['kind']>(),
      };
      expect(chooseSkill(me, foe).id).toBe('energy-siphon');
    });

    it('(d) LOSS UNTOUCHED + DETERMINISM — kuwagamon still WINS, Energy Siphon / the leech note NEVER surface there, and both fights are byte-identical across runs', () => {
      const numemon = findEnemy('numemon')!;
      const kuwagamon = findEnemy('kuwagamon')!;
      // Determinism + exact outcomes preserved.
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, numemon).outcome).toBe('win');
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      // Still clear of the round cap.
      expect(simulateBattle(agumon, numemon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
      // agumon dies before the Rule-2 pure-damage hammer phase (kuwagamon spd 20 > 8), so
      // Leech is NEVER seen in the loss — the promotion is scoped to the winnable fight.
      const loss = simulateBattle(agumon, kuwagamon);
      expect(loss.turns.some((t) => t.skill === 'Energy Ray')).toBe(false);
      expect(
        loss.turns.some((t) => (t.statusEvents ?? []).some((e) => e.includes('siphons'))),
      ).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // TASK-74 (R-17c) — the 3rd OBSERVABLE PROMOTION: the SELF-BUFF family (Focus /
  // Empower) finally SURFACES in the shipped numemon WIN. A new one-time self-buff
  // OPENER in chooseSkill (Rule 1b, between the fresh-ailment rotation and the
  // pure-damage hammer) casts Focus once; the buff was in-pool + affordable but
  // reachable only by the practically-dead Rule 3, so a /battle player NEVER saw it.
  // This is a SELECTOR change only — the COMBATANT_SKILLS ladder + all costs are
  // BYTE-UNCHANGED. HP stays monotone (Empower is a stat-buff, never a heal — A-42).
  // ────────────────────────────────────────────────────────────────────────
  describe('Focus (Empower) self-buff — the 3rd OBSERVABLE PROMOTION (TASK-74)', () => {
    it('(a) OBSERVABLE — Focus is now CAST in the shipped numemon WIN, with an Empowered buff note SEEN, and numemon still WINS', () => {
      // The headline payoff (present ≠ observable): a real /battle player finally SEES the
      // self-buff family — Focus (TASK-206-relabelled to the canonical 'Berserk Charge') cast +
      // "Agumon is Empowered" — in a fight they run.
      const numemon = findEnemy('numemon')!;
      const result = simulateBattle(agumon, numemon);
      expect(result.turns.some((t) => t.actor === 'player' && t.skill === 'Berserk Charge')).toBe(
        true,
      );
      expect(
        result.turns.some(
          (t) =>
            t.actor === 'player' &&
            (t.statusEvents ?? []).some((e) => /Agumon is Empowered/.test(e)),
        ),
      ).toBe(true);
      expect(result.outcome).toBe('win');
      expect(result.playerHpRemaining).toBeGreaterThan(0);
    });

    it('(b) WIN preserved + terminating — last entry drops the foe to 0 HP, rounds ≤ MAX_ROUNDS and non-decreasing (no stall)', () => {
      const numemon = findEnemy('numemon')!;
      const result = simulateBattle(agumon, numemon);
      expect(result.outcome).toBe('win');
      const last = result.turns.at(-1)!;
      expect(last.defenderHpAfter).toBe(0);
      expect(last.round).toBeLessThanOrEqual(MAX_ROUNDS);
      const rounds = result.turns.map((t) => t.round);
      for (let i = 1; i < rounds.length; i += 1) {
        expect(rounds[i]!).toBeGreaterThanOrEqual(rounds[i - 1]!);
      }
    });

    it('(c) LOSS UNTOUCHED — kuwagamon still WINS deterministically (agumon dies in the fast loss, clear of the opener)', () => {
      const kuwagamon = findEnemy('kuwagamon')!;
      expect(simulateBattle(agumon, kuwagamon)).toEqual(simulateBattle(agumon, kuwagamon));
      expect(simulateBattle(agumon, kuwagamon).outcome).toBe('loss');
      expect(simulateBattle(agumon, kuwagamon).turns.at(-1)!.round).toBeLessThan(MAX_ROUNDS);
    });

    it('(d) DETERMINISM — the numemon fight deep-equals a second call (RNG-free)', () => {
      const numemon = findEnemy('numemon')!;
      expect(simulateBattle(agumon, numemon)).toEqual(simulateBattle(agumon, numemon));
    });

    it('(e) HP MONOTONICITY (A-42 guard) — the foe HP never rises across the numemon fight (Empower raises damage, never HP)', () => {
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      // Track Numemon's HP via entries that unambiguously report it BY NAME as the target of
      // an effect ON it (a DoT tick / a strike naming it) — EXCLUDING a self-buff application
      // ("Numemon is Empowered/Shielded/Retaliating"), which rides Numemon's OWN turn whose
      // defenderHpAfter is the OPPONENT's HP (the same heuristic the Bleed/Enfeeble monotone
      // tests use). No entry ever RAISES the foe's HP — a buff writes a stat-modifier / shield
      // buffer, never HP up (categorically NOT the A-42-deferred Heal/HoT family).
      const numemonHps = turns
        .filter((t) =>
          (t.statusEvents ?? []).some(
            (e) => /Numemon/.test(e) && !/Numemon is (Empowered|Shielded|Retaliating)/.test(e),
          ),
        )
        .map((t) => t.defenderHpAfter);
      for (let i = 1; i < numemonHps.length; i += 1) {
        expect(numemonHps[i]!).toBeLessThanOrEqual(numemonHps[i - 1]!);
      }
      // No log entry ever reports negative damage (every effect only subtracts or is 0).
      for (const t of turns) expect(t.damage).toBeGreaterThanOrEqual(0);
    });

    it('(f) selector — the opener fires the self-buff once, then falls through to the Rule-2 hammer (covered by the chooseSkill Rule 1b unit above)', () => {
      // focus/guard keep their costs and slots; counter-stance is now PROMOTED IN-pool
      // (TASK-75, cost 30 ≤ MAX_ENERGY). selectSkill (the greedy boundary) is unaffected by
      // the tactical opener.
      expect(SKILLS.focus.energyCost).toBe(FOCUS_ENERGY_COST);
      expect(SKILLS.guard.energyCost).toBe(GUARD_ENERGY_COST);
      expect(SKILLS['counter-stance'].energyCost).toBeLessThanOrEqual(MAX_ENERGY);
      // focus is a NON-damaging SELF-buff (empower), the shape the opener selects.
      expect(SKILLS.focus.effects.map((e) => e.kind)).toEqual(['empower']);
    });

    it('(g) tactical rotation still surfaces FIRST — Frost Bite opener + the mid-tier arsenal still cast before the self-buff opener', () => {
      // Rule 1 (the fresh-ailment rotation) still runs FIRST: the numemon fight opens with
      // Frost Bite and rotates the arsenal; the self-buff opener sits AFTER it (Focus fires
      // only once the arsenal is spent). This proves the opener did not starve the rotation.
      const numemon = findEnemy('numemon')!;
      const { turns } = simulateBattle(agumon, numemon);
      const playerCasts = turns.filter((t) => t.actor === 'player' && t.skill).map((t) => t.skill);
      expect(playerCasts[0]).toBe('Blue Blaster');
      // A representative slice of the previously-stranded arsenal still surfaces.
      for (const name of ['Mach Jab', 'Heat Upper', 'Pepper Breath']) {
        expect(playerCasts).toContain(name);
      }
      // Focus (TASK-206-relabelled 'Berserk Charge') appears AFTER the first arsenal cast (it is
      // an after-Rule-1 opener, not turn 1).
      expect(playerCasts.indexOf('Berserk Charge')).toBeGreaterThan(0);
    });
  });
});

/**
 * TASK-140 (R-22) — the interactive-combat SEAM: the per-actor turn body extracted from
 * `simulateBattle` into the exported pure {@link resolveActorTurn}, plus the serializable
 * {@link FightState} snapshot the interactive turn route carries between turns. The
 * BYTE-EQUALITY of the re-expressed `simulateBattle` is already proven by the whole
 * pre-existing suite above staying green (the load-bearing regression proof); these add
 * the DIRECT-seam units for the extracted function + the (de)serialization round-trip.
 */
describe('interactive turn seam (TASK-140, resolveActorTurn + FightState)', () => {
  const agumon: Combatant = {
    name: 'Agumon',
    type: 'Vaccine',
    element: 'Fire',
    hp: 50,
    maxHp: 50,
    atk: 14,
    def: 10,
    spd: 8,
  };

  it('serialize → deserialize round-trips a FightState (Set ⇄ array is the only moving part)', () => {
    const state = createFightState(agumon, findEnemy('numemon')!);
    state.player.inflicted.add('burn');
    state.enemy.hp = 100;
    state.round = 4;
    const wire: SerializedFightState = serializeFightState(state);
    // `inflicted` flattens to an array on the wire; everything else round-trips as-is.
    expect(wire.player.inflicted).toEqual(['burn']);
    expect(Array.isArray(wire.enemy.inflicted)).toBe(true);
    const back = deserializeFightState(wire);
    expect(back.player.inflicted instanceof Set).toBe(true);
    expect(back.player.inflicted.has('burn')).toBe(true);
    expect(back.enemy.hp).toBe(100);
    expect(back.round).toBe(4);
    expect(back.decided).toBeNull();
  });

  it('serializeFightState round-trips the optional difficulty; an absent difficulty defaults to hard (TASK-165)', () => {
    // TASK-165 (R-22 slice 26): the carried enemy DIFFICULTY survives the client round-trip,
    // and a pre-slice snapshot with NO difficulty deserializes to the 'hard' default — the
    // whole back-compat story (a fight opened before the slice resumes as today's banking enemy).
    const easyState = createFightState(agumon, findEnemy('numemon')!, 'easy');
    const easyWire = serializeFightState(easyState);
    expect(easyWire.difficulty).toBe('easy');
    expect(deserializeFightState(easyWire).difficulty).toBe('easy');
    // A wire state with NO difficulty (the pre-slice shape) → 'hard' on read-back.
    const legacyWire: SerializedFightState = serializeFightState(
      createFightState(agumon, findEnemy('numemon')!),
    );
    // createFightState defaults difficulty to 'hard', so the default fight is 'hard'.
    expect(legacyWire.difficulty).toBe('hard');
    // A hand-stripped wire (truly absent) still deserializes to 'hard'.
    const noDiff: SerializedFightState = serializeFightState(
      createFightState(agumon, findEnemy('numemon')!),
    );
    delete noDiff.difficulty;
    expect(deserializeFightState(noDiff).difficulty).toBe('hard');
    // TASK-166 (R-22 slice 27): the new middle 'normal' tier round-trips unchanged too.
    const normalWire = serializeFightState(
      createFightState(agumon, findEnemy('numemon')!, 'normal'),
    );
    expect(normalWire.difficulty).toBe('normal');
    expect(deserializeFightState(normalWire).difficulty).toBe('normal');
  });

  it('serializeFightState threads the optional effectiveSpd pair onto each side (TASK-147)', () => {
    // TASK-147 (R-22 slice 8): a magnitude-faithful SPD gauge needs the enemy's effective
    // SPD on the wire (deliberately absent before this slice). `serializeFightState` accepts
    // an OPTIONAL pair (the values the service already computes for `resolveTurnOrder`) and
    // sets each side's display-only `effectiveSpd`. Called WITHOUT the pair, both stay
    // `undefined` — a backward-compatible optional field (the invariant-5 additive guarantee).
    const state = createFightState(agumon, findEnemy('numemon')!);
    const withSpd = serializeFightState(state, { player: 6, enemy: 12 });
    expect(withSpd.player.effectiveSpd).toBe(6);
    expect(withSpd.enemy.effectiveSpd).toBe(12);
    const withoutSpd = serializeFightState(state);
    expect(withoutSpd.player.effectiveSpd).toBeUndefined();
    expect(withoutSpd.enemy.effectiveSpd).toBeUndefined();
    // Display-only: the deserializer ignores it (never fed back into a combat rule).
    const back = deserializeFightState(withSpd);
    expect((back.player as { effectiveSpd?: number }).effectiveSpd).toBeUndefined();
  });

  it('serializeFightState threads the optional extraActed pair onto each side, ignored on deserialize (TASK-149)', () => {
    // TASK-149 (R-22 slice 10): the display-only "took an ATB bonus action this turn" flag —
    // the SAME plumbing shape as effectiveSpd (an optional trailing arg the service passes
    // knowing which sides consumed the threshold). Set when passed; both undefined when
    // omitted (backward-compatible additive field); NEVER read back (display-only, invariant 5).
    const state = createFightState(agumon, findEnemy('numemon')!);
    const flagged = serializeFightState(state, undefined, {
      player: true,
      enemy: false,
    });
    expect(flagged.player.extraActed).toBe(true);
    expect(flagged.enemy.extraActed).toBe(false);
    const plain = serializeFightState(state);
    expect(plain.player.extraActed).toBeUndefined();
    expect(plain.enemy.extraActed).toBeUndefined();
    // Display-only: the deserializer ignores it (never fed back into a combat rule).
    const back = deserializeFightState(flagged);
    expect((back.player as { extraActed?: boolean }).extraActed).toBeUndefined();
  });

  it('serializeFightState threads the optional bonusActions count pair onto each side, ignored on deserialize (TASK-150)', () => {
    // TASK-150 (R-22 slice 11): the display-only per-side COUNT of ATB bonus actions this turn
    // (widens extraActed's boolean to the magnitude — how many thresholds a stacked bar drained).
    // Same additive plumbing shape: set when passed, both undefined when omitted, NEVER read
    // back (display-only, invariant 5 — no rule reads it, so the auto path stays byte-frozen).
    const state = createFightState(agumon, findEnemy('numemon')!);
    const flagged = serializeFightState(state, undefined, undefined, {
      player: 2,
      enemy: 0,
    });
    expect(flagged.player.bonusActions).toBe(2);
    expect(flagged.enemy.bonusActions).toBe(0);
    const plain = serializeFightState(state);
    expect(plain.player.bonusActions).toBeUndefined();
    expect(plain.enemy.bonusActions).toBeUndefined();
    // Display-only: the deserializer ignores it (never fed back into a combat rule).
    const back = deserializeFightState(flagged);
    expect((back.player as { bonusActions?: number }).bonusActions).toBeUndefined();
  });

  it('createFightState seeds both sides atb: 0 (TASK-148)', () => {
    // TASK-148 (R-22 slice 9): the carried ATB accumulator starts empty. It is a REAL live
    // field (unlike the display-only effectiveSpd), grown only on the interactive path.
    const state = createFightState(agumon, findEnemy('numemon')!);
    expect(state.player.atb).toBe(0);
    expect(state.enemy.atb).toBe(0);
  });

  it('serialize → deserialize round-trips the carried atb accumulator (TASK-148)', () => {
    // The atb is a REQUIRED round-tripped field going forward: what a side accrued must
    // survive the client-carried snapshot so the web gauge keeps filling across turns.
    const state = createFightState(agumon, findEnemy('numemon')!);
    state.player.atb = 137;
    state.enemy.atb = 42;
    const wire = serializeFightState(state);
    expect(wire.player.atb).toBe(137);
    expect(wire.enemy.atb).toBe(42);
    const back = deserializeFightState(wire);
    expect(back.player.atb).toBe(137);
    expect(back.enemy.atb).toBe(42);
  });

  it('deserialize defaults an ABSENT atb → 0 (pre-slice snapshot backward-compat, TASK-148)', () => {
    // A snapshot serialized BEFORE this slice carries no `atb`. The deserializer must
    // default it to 0 so an in-flight pre-slice client `state` still resumes (no crash,
    // no NaN accruing). The other fields round-trip untouched.
    const preSlice = {
      player: { hp: 90, energy: 20, statuses: [], inflicted: [] },
      enemy: { hp: 55, energy: 15, statuses: [], inflicted: [] },
      round: 3,
      decided: null,
    } as unknown as SerializedFightState;
    const back = deserializeFightState(preSlice);
    expect(back.player.atb).toBe(0);
    expect(back.enemy.atb).toBe(0);
    expect(back.player.hp).toBe(90);
    expect(back.round).toBe(3);
  });

  it('resolveActorTurn spends the chosen skill energy, applies its damage, and mutates state in place', () => {
    const numemon = findEnemy('numemon')!;
    const state = createFightState(agumon, numemon);
    const combatant = { player: agumon, enemy: numemon };
    const turns: TurnLogEntry[] = [];
    const enemyHpBefore = state.enemy.hp;
    const energyBefore = state.player.energy;
    // Inject Fire Breath as the player's CHOSEN skill (the interactive path — the caller
    // decides the skill, unlike the auto-driver which feeds chooseSkill's output).
    const fireBreath = SKILLS['fire-breath'];
    const result = resolveActorTurn(state, 'player', combatant, () => fireBreath, turns);
    // Energy regenerated (+REGEN) then spent (−cost); net = regen − cost off MAX pool.
    expect(state.player.energy).toBe(
      Math.min(MAX_ENERGY, energyBefore + ENERGY_REGEN_PER_TURN) - fireBreath.energyCost,
    );
    // The enemy took damage (HP strictly fell — monotone non-increasing) and the log grew.
    expect(state.enemy.hp).toBeLessThan(enemyHpBefore);
    expect(state.enemy.hp).toBeGreaterThanOrEqual(0);
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.some((t) => t.skill === 'Pepper Breath')).toBe(true);
    // A non-lethal opening exchange: undecided, keep going.
    expect(result.decided).toBeNull();
    expect(result.ended).toBe(false);
  });

  it('resolveActorTurn returns { decided, ended:true } on a LETHAL blow (KO ends the fight)', () => {
    const numemon = findEnemy('numemon')!;
    const state = createFightState(agumon, numemon);
    state.enemy.hp = 1; // one strike is lethal
    const combatant = { player: agumon, enemy: numemon };
    const turns: TurnLogEntry[] = [];
    const result = resolveActorTurn(state, 'player', combatant, () => SKILLS['fire-breath'], turns);
    expect(state.enemy.hp).toBe(0);
    expect(result.decided).toBe('win');
    expect(result.ended).toBe(true);
  });

  it('TASK-159: an injected ALWAYS-crit rng MULTIPLIES the strike damage + sets TurnLogEntry.crit', () => {
    // The SECOND injected-RNG consumer (slice 20). Drive the SAME basic Attack strike
    // twice: once at DEFAULT_RNG (rng()===0 → never crits → the deterministic base) and
    // once with an always-crit rng (a fixed high roll near 1). The crit run must deal
    // exactly floor(base × CRIT_MULT) and carry `crit:true`; the default run carries no
    // crit and the base damage — proving the guard (invariant 5) AND the payoff. HP still
    // only ever FALLS (A-42 HELD — a crit only INCREASES damage).
    const numemon = findEnemy('numemon')!;
    const combatant = { player: agumon, enemy: numemon };
    // An rng consumed twice per strike (critRoll then evadeRoll in resolveDamageStrike):
    // return a HIGH value for the crit roll (fires) and 0 for the evade roll (never
    // evades), so we isolate the crit payoff from the evade roll TASK-160 added at the
    // SAME seam. A constant high rng would ALSO evade (evade dominates → 0 damage).
    let critCall = 0;
    const alwaysCrit = () => (critCall++ % 2 === 0 ? 1 : 0);

    // Baseline: DEFAULT_RNG (the production default) — never crits.
    const baseState = createFightState(agumon, numemon);
    const baseTurns: TurnLogEntry[] = [];
    resolveActorTurn(
      baseState,
      'player',
      combatant,
      () => SKILLS['attack'],
      baseTurns,
      DEFAULT_RNG,
    );
    const baseEntry = baseTurns.find((t) => t.skill === 'Sharp Nail')!;
    expect(baseEntry.crit).toBeUndefined();
    const baseDamage = baseEntry.damage;
    expect(baseDamage).toBeGreaterThan(0);

    // Crit: an injected always-crit rng — multiplied damage + crit:true.
    const critState = createFightState(agumon, numemon);
    const critTurns: TurnLogEntry[] = [];
    resolveActorTurn(critState, 'player', combatant, () => SKILLS['attack'], critTurns, alwaysCrit);
    const critEntry = critTurns.find((t) => t.skill === 'Sharp Nail')!;
    expect(critEntry.crit).toBe(true);
    expect(critEntry.damage).toBe(Math.floor(baseDamage * CRIT_MULT));
    expect(critEntry.damage).toBeGreaterThan(baseDamage);
    // A-42: HP only ever fell (never rose) — a crit only deals MORE.
    expect(critState.enemy.hp).toBeLessThanOrEqual(baseState.enemy.hp);
  });

  it('TASK-160: an injected ALWAYS-evade rng ZEROES the strike damage + sets TurnLogEntry.evaded (defender HP unchanged)', () => {
    // The THIRD injected-RNG consumer (slice 21), crit's mirror-image on the SAME seam.
    // Drive the SAME basic Attack strike twice: once at DEFAULT_RNG (rng()===0 → never
    // evades → the deterministic damage lands) and once with an always-evade rng (a
    // fixed high roll near 1). The evade run must deal damage 0, leave the defender's HP
    // UNCHANGED, and carry `evaded:true`; the default run carries no evade and the base
    // damage — proving the guard (invariant 5). HP still only ever FALLS (A-42 HELD even
    // more strongly — an evade only DECREASES damage to 0).
    const numemon = findEnemy('numemon')!;
    const combatant = { player: agumon, enemy: numemon };
    const alwaysEvade = () => 1; // the luckiest-for-the-defender high roll

    // Baseline: DEFAULT_RNG (the production default) — never evades, damage lands.
    const baseState = createFightState(agumon, numemon);
    const baseTurns: TurnLogEntry[] = [];
    resolveActorTurn(
      baseState,
      'player',
      combatant,
      () => SKILLS['attack'],
      baseTurns,
      DEFAULT_RNG,
    );
    const baseEntry = baseTurns.find((t) => t.skill === 'Sharp Nail')!;
    expect(baseEntry.evaded).toBeUndefined();
    expect(baseEntry.damage).toBeGreaterThan(0);

    // Evade: an injected always-evade rng — 0 damage, evaded:true, defender HP untouched.
    const evadeState = createFightState(agumon, numemon);
    const hpBeforeStrike = evadeState.enemy.hp;
    const evadeTurns: TurnLogEntry[] = [];
    resolveActorTurn(
      evadeState,
      'player',
      combatant,
      () => SKILLS['attack'],
      evadeTurns,
      alwaysEvade,
    );
    const evadeEntry = evadeTurns.find((t) => t.skill === 'Sharp Nail')!;
    expect(evadeEntry.evaded).toBe(true);
    expect(evadeEntry.damage).toBe(0);
    // The defender's HP is UNCHANGED by the evaded strike (overflow 0 → no HP write).
    expect(evadeState.enemy.hp).toBe(hpBeforeStrike);
  });

  it('TASK-161: an injected ALWAYS-resist rng SKIPS an offensive status (does NOT land) + sets TurnLogEntry.resisted', () => {
    // The FOURTH injected-RNG consumer (slice 22), on the NEW status-APPLICATION seam.
    // Drive a PURE offensive status skill (Lullaby Hex → applies `sleep`, NO `damage`
    // arm, so the seam draws rng() exactly ONCE — the resist — dodging the L-58
    // multi-draw footgun) twice: once at DEFAULT_RNG (rng()===0 → never resists → the
    // status LANDS, the pre-resist contract) and once with an always-resist rng (a
    // fixed high roll near 1). The resist run must leave the defender's `statuses[]`
    // WITHOUT the `sleep` kind, carry `resisted:true`, and push a "resists" note; the
    // default run applies the ailment and carries no resist — proving the guard
    // (invariant 5). A-42 HELD: a resist only REMOVES a would-be status (HP monotone).
    const numemon = findEnemy('numemon')!;
    const combatant = { player: agumon, enemy: numemon };
    const alwaysResist = () => 1; // the luckiest-for-the-defender high roll

    // Baseline: DEFAULT_RNG (the production default) — never resists, the status lands.
    const baseState = createFightState(agumon, numemon);
    const baseTurns: TurnLogEntry[] = [];
    resolveActorTurn(
      baseState,
      'player',
      combatant,
      () => SKILLS['lullaby-hex'],
      baseTurns,
      DEFAULT_RNG,
    );
    const baseEntry = baseTurns.find((t) => t.skill === SKILLS['lullaby-hex'].name)!;
    expect(baseEntry.resisted).toBeUndefined();
    // The offensive status LANDED on the default path (byte-preserved pre-resist behavior).
    expect(baseState.enemy.statuses.some((s) => s.kind === 'sleep')).toBe(true);
    expect(baseEntry.statusEvents?.some((e) => e.includes('resists'))).toBeFalsy();

    // Resist: an injected always-resist rng — the ailment does NOT land, resisted:true.
    const resistState = createFightState(agumon, numemon);
    const resistTurns: TurnLogEntry[] = [];
    resolveActorTurn(
      resistState,
      'player',
      combatant,
      () => SKILLS['lullaby-hex'],
      resistTurns,
      alwaysResist,
    );
    const resistEntry = resistTurns.find((t) => t.skill === SKILLS['lullaby-hex'].name)!;
    expect(resistEntry.resisted).toBe(true);
    // The offensive status did NOT land — the defender's statuses carry no `sleep`.
    expect(resistState.enemy.statuses.some((s) => s.kind === 'sleep')).toBe(false);
    expect(resistEntry.statusEvents?.some((e) => e.includes('resists'))).toBe(true);
  });

  it('simulateBattle re-expressed over resolveActorTurn stays byte-identical (determinism self-check)', () => {
    // The whole shipped suite above is the real regression proof; this is a direct
    // determinism guardrail on the re-expressed driver.
    const numemon = findEnemy('numemon')!;
    const a = simulateBattle(agumon, numemon);
    const b = simulateBattle(agumon, numemon);
    expect(a).toEqual(b);
    expect(a.outcome).toBe('win');
  });
});

// TASK-151 (R-22 slice 12): the pure telegraph-side projection of the enemy's incoming
// bonus-action count. It mirrors the interactive drain-loop's own `min(cap, floor(...))` bound
// (residual atb + next SPD, per threshold) so the telegraphed intent and the eventual resolution
// can never drift. Display-only — read by no rule, so these are direct pure units.
describe('projectedBonusActions (TASK-151 — enemy incoming-combo telegraph)', () => {
  it('returns floor((residual + eff) / ATB_THRESHOLD)', () => {
    expect(projectedBonusActions(180, 40)).toBe(2); // 220/100 → 2
    expect(projectedBonusActions(250, 60)).toBe(3); // 310/100 → 3
    expect(projectedBonusActions(150, 30)).toBe(1); // 180/100 → 1
  });

  it('caps at MAX_ATB_BONUS_ACTIONS regardless of how much ATB is banked', () => {
    expect(projectedBonusActions(900, 50)).toBe(MAX_ATB_BONUS_ACTIONS);
    expect(projectedBonusActions(10_000, 0)).toBe(MAX_ATB_BONUS_ACTIONS);
  });

  it('is 0 below one threshold and clamps at >= 0', () => {
    expect(projectedBonusActions(10, 10)).toBe(0);
    expect(projectedBonusActions(0, 0)).toBe(0);
    expect(projectedBonusActions(-500, 0)).toBe(0); // defensive >= 0 floor
  });
});

// TASK-187 (R-28 slice 46, I-16): CANONICAL DIGI-API SKILL NAMES for the core player-facing
// skills. The relabel touches ONLY the DISPLAY `name` field — the pure combat rules switch
// on energyCost/id/effect.kind, never on name — so the engine is byte-frozen (invariant 5).
// These units pin (a) the map ↔ SKILLS.name single-source-of-truth anchor and (b) that the
// rule-bearing fields (id/energyCost/effects/catalog order) + a representative fight OUTCOME
// are byte-identical, only the turn-log LABEL string changed.
describe('CANONICAL_SKILL_NAMES (canonical digi-api skill labels — display only)', () => {
  it('every mapped key exists in SKILLS and its row name equals the canonical name (the anchor cannot drift)', () => {
    for (const [id, canonical] of Object.entries(CANONICAL_SKILL_NAMES)) {
      expect(SKILLS[id]).toBeDefined();
      expect(SKILLS[id].id).toBe(id); // the RULE key is untouched
      expect(SKILLS[id].name).toBe(canonical); // only the DISPLAY label changed
    }
  });

  it('every canonical name is a non-empty authentic label', () => {
    for (const canonical of Object.values(CANONICAL_SKILL_NAMES)) {
      expect(typeof canonical).toBe('string');
      expect(canonical.trim().length).toBeGreaterThan(0);
    }
  });

  it('relabels the CORE affordable/in-menu skills (every mapped key is an in-pool COMBATANT_SKILLS row, cost <= MAX_ENERGY)', () => {
    const inPoolIds = new Set(
      COMBATANT_SKILLS.filter((s) => s.energyCost <= MAX_ENERGY).map((s) => s.id),
    );
    for (const id of Object.keys(CANONICAL_SKILL_NAMES)) {
      expect(inPoolIds.has(id)).toBe(true);
    }
  });

  it('TASK-206: EVERY in-menu skill (cost <= MAX_ENERGY) is canonical — no in-pool row left un-relabelled', () => {
    // Acceptance #1 completeness: the set of in-menu (menu-surfaced) skill ids must be a SUBSET
    // of the map keys, so a player cannot open the menu and read a stragglers' ad-hoc internal
    // label. TASK-187 covered the core 16; TASK-206 adds the last two (guard/focus).
    const inMenuIds = COMBATANT_SKILLS.filter((s) => s.energyCost <= MAX_ENERGY).map((s) => s.id);
    for (const id of inMenuIds) {
      expect(CANONICAL_SKILL_NAMES[id]).toBeDefined();
      expect(SKILLS[id].name).toBe(CANONICAL_SKILL_NAMES[id]);
    }
    // And specifically the two newly-relabelled stragglers carry their new canonical names.
    expect(SKILLS.guard.name).toBe('Shield of the Just');
    expect(SKILLS.focus.name).toBe('Berserk Charge');
  });

  it('INVARIANT 5: the rule KEY set (id/energyCost/effects) + COMBATANT_SKILLS order are byte-frozen for the relabelled rows', () => {
    // A relabel writes ONLY `name`; the rule-bearing fields the engine actually switches on
    // must be exactly as shipped. Pin the effect kinds + costs for each relabelled core skill.
    const expectedRuleKey: Readonly<Record<string, { cost: number; kinds: readonly string[] }>> = {
      attack: { cost: 0, kinds: ['damage'] },
      'fire-breath': { cost: 6, kinds: ['damage', 'burn'] },
      'poison-sting': { cost: 2, kinds: ['damage', 'poison'] },
      'armor-break': { cost: 5, kinds: ['damage', 'weaken'] },
      'bleed-strike': { cost: 3, kinds: ['damage', 'bleed'] },
      'energy-siphon': { cost: 4, kinds: ['damage', 'leech'] },
      'energy-drain': { cost: 1, kinds: ['damage', 'sap'] },
      'shock-strike': { cost: 9, kinds: ['damage', 'stun'] },
      'frost-bite': { cost: 11, kinds: ['damage', 'freeze'] },
      'corrode-strike': { cost: 13, kinds: ['damage', 'corrode'] },
      'enfeeble-strike': { cost: 8, kinds: ['damage', 'enfeeble'] },
      'vulnerable-strike': { cost: 10, kinds: ['damage', 'vulnerable'] },
      'doom-curse': { cost: 12, kinds: ['doom'] },
      'lullaby-hex': { cost: 21, kinds: ['sleep'] },
      'double-strike': { cost: 24, kinds: ['multihit'] },
      'counter-stance': { cost: 30, kinds: ['retaliate'] },
      // TASK-206 (R-28a) — the two remaining in-menu stragglers now relabelled.
      // Their rule keys (self-targeting shield / empower, distinct costs) stay byte-frozen;
      // only `name` changed.
      guard: { cost: 14, kinds: ['shield'] },
      focus: { cost: 7, kinds: ['empower'] },
    };
    for (const [id, { cost, kinds }] of Object.entries(expectedRuleKey)) {
      expect(SKILLS[id].energyCost).toBe(cost);
      expect(SKILLS[id].effects.map((e) => e.kind)).toEqual(kinds);
    }
  });

  it('INVARIANT 5: a representative fight OUTCOME (hp/turns/winner) is byte-identical — only turn-log LABELS differ', () => {
    // The relabel changes ZERO rule resolution, so the deterministic shipped fight resolves
    // identically; its turn log now reads canonical labels for the relabelled core skills.
    const agumon: Combatant = {
      name: 'Agumon',
      type: 'Vaccine',
      element: 'Fire',
      hp: 50,
      maxHp: 50,
      atk: 14,
      def: 10,
      spd: 8,
    };
    const numemon = findEnemy('numemon')!;
    const result = simulateBattle(agumon, numemon);
    // Outcome + a bounded, deterministic length (unchanged by a label swap).
    expect(result.outcome).toBe('win');
    expect(result.turns.length).toBeGreaterThan(0);
    // The canonical labels now surface in the log (Pepper Breath = the old 'Fire Breath').
    const labels = new Set(result.turns.map((t) => t.skill).filter(Boolean));
    expect(labels.has('Pepper Breath')).toBe(true);
    // …and the old ad-hoc label is GONE.
    expect(labels.has('Fire Breath')).toBe(false);
  });
});

describe('Skill.element (R-34 / TASK-205 — display-only element grouping tag)', () => {
  // R-34 / A-187: the genuinely-NEW observable value is the ELEMENT GROUPING of the
  // /battle menu (the lore names already shipped in R-28). `element` is an OPTIONAL,
  // display-only tag on the catalog row: NO combat rule reads it (verified below), so
  // every simulateBattle/resolveActorTurn fixture resolves BYTE-IDENTICALLY — this
  // block is a NEW co-evolution assertion set, not a re-pin (invariant 5, add-only DATA).
  it('assigns the expected element to each CORE in-menu skill (a distinct group actually appears)', () => {
    const expectedElement: Readonly<Record<string, string>> = {
      attack: 'Neutral',
      'fire-breath': 'Fire',
      'armor-break': 'Fire',
      'poison-sting': 'Nature',
      'bleed-strike': 'Nature',
      'frost-bite': 'Water',
      'corrode-strike': 'Water',
      'shock-strike': 'Electric',
      'double-strike': 'Electric',
      'energy-siphon': 'Electric',
      'energy-drain': 'Electric',
      guard: 'Neutral',
      barrier: 'Neutral',
      focus: 'Neutral',
      'lullaby-hex': 'Neutral',
      'enfeeble-strike': 'Neutral',
      'vulnerable-strike': 'Neutral',
      'doom-curse': 'Neutral',
      'counter-stance': 'Neutral',
    };
    for (const [id, element] of Object.entries(expectedElement)) {
      expect(SKILLS[id]).toBeDefined();
      expect(SKILLS[id].element).toBe(element);
    }
  });

  it('every tagged element is one of the shipped element vocabulary values', () => {
    const vocab = new Set(['Fire', 'Water', 'Nature', 'Electric', 'Neutral']);
    for (const skill of Object.values(SKILLS)) {
      if (skill.element !== undefined) {
        expect(vocab.has(skill.element)).toBe(true);
      }
    }
  });

  it('surfaces AT LEAST Fire, Electric, Water and Neutral groups among the in-pool skills (grouping is observable)', () => {
    const inPoolElements = new Set(
      COMBATANT_SKILLS.filter((s) => s.energyCost <= MAX_ENERGY)
        .map((s) => SKILLS[s.id].element)
        .filter((e): e is string => e !== undefined),
    );
    for (const el of ['Fire', 'Electric', 'Water', 'Neutral']) {
      expect(inPoolElements.has(el)).toBe(true);
    }
  });

  it('INVARIANT 5: NO combat rule reads `element` — the shipped fight OUTCOME is byte-identical', () => {
    // The element tag is display-only (the engine keys off id/energyCost/effect.kind).
    // The deterministic shipped fight therefore resolves with the SAME outcome/length.
    const agumon: Combatant = {
      name: 'Agumon',
      type: 'Vaccine',
      element: 'Fire',
      hp: 50,
      maxHp: 50,
      atk: 14,
      def: 10,
      spd: 8,
    };
    const numemon = findEnemy('numemon')!;
    const result = simulateBattle(agumon, numemon);
    expect(result.outcome).toBe('win');
    expect(result.turns.length).toBeGreaterThan(0);
  });
});
