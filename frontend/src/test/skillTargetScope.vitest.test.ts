/**
 * Skill target-scope classification — drives the combat targeting UI.
 *
 * Regression guard for the targeting bug where every single-pick skill forced
 * the player into "click an enemy" even when the skill's DSL actions resolve
 * their own target (most damaged friendly digimon, self, all enemies,
 * random enemy, ...), and where party-only manual skills could never target a
 * friendly digimon because friendly clicks were only wired for items.
 *
 * Run: pnpm --filter @digiworld/frontend test
 */
import { skillTargetScope } from '@digiworld/shared/battle';
import type { Skill } from '@digiworld/shared/digimon';
import { describe, expect, it } from 'vitest';

function skill(actions: unknown[] | undefined): Skill {
  return {
    id: 's1',
    name: 'Test Skill',
    element: 'fire',
    energyCost: 5,
    power: 60,
    ...(actions === undefined ? {} : { actions }),
  };
}

describe('skillTargetScope', () => {
  it('treats legacy non-DSL skills as manual enemy picks', () => {
    expect(skillTargetScope(skill(undefined))).toBe('enemy');
    expect(skillTargetScope(skill([]))).toBe('enemy');
  });

  it('auto: heals the most damaged friendly digimon without a pick', () => {
    expect(skillTargetScope(skill([{ kind: 'heal', target: 'caster_ally_lowest_hp', amount: 50 }]))).toBe('auto');
  });

  it('auto: self buffs cast immediately', () => {
    expect(skillTargetScope(skill([{ kind: 'apply_buff', target: 'self', buff: 'atk_up', amount: 20, turns: 3 }]))).toBe('auto');
  });

  it('auto: whole-party buffs cast immediately', () => {
    expect(skillTargetScope(skill([{ kind: 'apply_buff', target: 'caster_ally_all', buff: 'damage_reduction', amount: 10, turns: 2 }]))).toBe('auto');
  });

  it('auto: AoE and random enemy damage need no pick', () => {
    expect(skillTargetScope(skill([{ kind: 'deal_damage', target: 'enemy_all', amount: 40 }]))).toBe('auto');
    expect(skillTargetScope(skill([{ kind: 'deal_damage', target: 'enemy_random', amount: 40 }]))).toBe('auto');
    expect(skillTargetScope(skill([{ kind: 'deal_damage', target: 'enemy_front', amount: 40 }]))).toBe('auto');
  });

  it('auto: picks nested inside schedule/conditional are still found', () => {
    const scheduled = skill([{ kind: 'schedule', delay: 2, action: { kind: 'heal', target: 'caster_ally_lowest_hp', amount: 30 } }]);
    expect(skillTargetScope(scheduled)).toBe('auto');
    const conditional = skill([{
      kind: 'conditional',
      if: { kind: 'hp_below_pct', pct: 50 },
      then: [{ kind: 'apply_buff', target: 'self', buff: 'shield_absorb', amount: 30, turns: 2 }],
    }]);
    expect(skillTargetScope(conditional)).toBe('auto');
  });

  it('enemy: single-target attacks keep the enemy picker', () => {
    expect(skillTargetScope(skill([{ kind: 'deal_damage', target: 'primary_target', amount: 80 }]))).toBe('enemy');
  });

  it('enemy: manual pick combined with an enemy-side pattern stays enemy', () => {
    const mixed = skill([
      { kind: 'deal_damage', target: 'primary_target', amount: 60 },
      { kind: 'deal_damage', target: 'enemy_all', amount: 20 },
    ]);
    expect(skillTargetScope(mixed)).toBe('enemy');
    const conditional = skill([
      {
        kind: 'conditional',
        if: { kind: 'hp_below_pct', pct: 40 },
        then: [{ kind: 'deal_damage', target: 'enemy_slot_0', amount: 90 }],
        else: [{ kind: 'deal_damage', target: 'primary_target', amount: 40 }],
      },
    ]);
    expect(skillTargetScope(conditional)).toBe('enemy');
  });

  it('enemy: a manual pick scheduled for later still requires the pick now', () => {
    const scheduled = skill([{ kind: 'schedule', delay: 1, action: { kind: 'deal_damage', target: 'primary_target', amount: 70 } }]);
    expect(skillTargetScope(scheduled)).toBe('enemy');
  });

  it('enemy: manual debuffs and EN drain stay on the enemy picker', () => {
    const speedDebuff = skill([{ kind: 'modify_stat', target: 'primary_target', stat: 'spd', delta: -20, turns: 3 }]);
    expect(skillTargetScope(speedDebuff)).toBe('enemy');
    const defDebuff = skill([{ kind: 'apply_buff', target: 'primary_target', buff: 'def_down', amount: 8, turns: 2 }]);
    expect(skillTargetScope(defDebuff)).toBe('enemy');
    const enDrain = skill([{ kind: 'consume_en', target: 'primary_target', amount: 8 }]);
    expect(skillTargetScope(enDrain)).toBe('enemy');
  });

  it('enemy: a damage skill with a conditional self-buff still picks an enemy', () => {
    const sparkParry = skill([
      { kind: 'deal_damage', target: 'primary_target', amount: 33, element: 'steel' },
      {
        kind: 'conditional',
        if: { kind: 'hp_above_pct', pct: 70 },
        then: [{ kind: 'shift_initiative', target: 'primary_target', delta: 1 }],
      },
    ]);
    expect(skillTargetScope(sparkParry)).toBe('enemy');
  });

  it('any: party-only manual skill lets the player pick a friendly digimon', () => {
    const partyHeal = skill([
      { kind: 'heal', target: 'primary_target', amount: 60 },
      { kind: 'cleanse', target: 'primary_target' },
    ]);
    expect(skillTargetScope(partyHeal)).toBe('any');
    const partyBuff = skill([
      { kind: 'apply_buff', target: 'primary_target', buff: 'def_up', amount: 12, turns: 3 },
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'shield_absorb', amount: 24, turns: 2 },
    ]);
    expect(skillTargetScope(partyBuff)).toBe('any');
  });

  it('any: player_pick skills without an enemy-side pattern can target either side', () => {
    expect(skillTargetScope(skill([{ kind: 'heal', target: 'player_pick_2', amount: 40 }]))).toBe('any');
  });
});