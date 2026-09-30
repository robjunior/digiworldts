import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { NAMED_RUNNERS, namedEffectDuration, isNamedEffect, isRangedEffect } from './named';
import { MELEE_RUNNERS } from './melee';
import type { SkillVfxRangedEffect } from '@digiworld/shared/skill-vfx';
import { SKILL_VFX_RANGED_EFFECTS } from '@digiworld/shared/skill-vfx';

/**
 * Faithful-port regression: every named RANGED skill effect (fireball,
 * frost-spikes, ice-lance, tornado, lightning, shadow-void, holy-smite,
 * tidal-surge, blade-storm, stone-fall, null-pulse, vine-lash) and every MELEE
 * basic-attack effect must build, tick over its full lifetime, and dispose
 * without throwing — each under a real THREE.Scene with the actual `Pool`
 * particle system. Runs headless (happy-dom, no WebGL) because the runners
 * only do THREE object bookkeeping + typed-array updates.
 */
describe('named ranged skill effects (faithful HTML ports)', () => {
  const effectFor = (): AttackEffect3D => ({
    id: 'fx-test',
    element: 'fire',
    sourcePosition: new THREE.Vector3(-4.3, 2.3, 0),
    targetPosition: new THREE.Vector3(4.2, 1.3, 0),
    durationS: 2.5,
  });

  it.each(SKILL_VFX_RANGED_EFFECTS as readonly SkillVfxRangedEffect[])(
    '%s builds + ticks to completion + disposes idempotently',
    (id) => {
      const scene = new THREE.Scene();
      const build = NAMED_RUNNERS[id];
      const runner: Runner3D = build(scene, effectFor());

      const duration = namedEffectDuration(id);
      expect(duration).toBeGreaterThan(0);
      const steps = Math.ceil((duration + 0.1) / 0.016);
      expect(() => {
        for (let i = 0; i < steps; i++) {
          runner.tick(0.016, i * 0.016, new THREE.Quaternion());
        }
        runner.dispose();
        runner.dispose(); // idempotent
      }).not.toThrow();
    },
  );

  it('exposes the same ids that the eager dispatch recognizes', () => {
    for (const id of SKILL_VFX_RANGED_EFFECTS) {
      expect(isNamedEffect(id)).toBe(true);
      expect(isRangedEffect(id)).toBe(true);
      expect(NAMED_RUNNERS[id]).toBeTypeOf('function');
    }
    expect(isNamedEffect('not-a-real-effect')).toBe(false);
    expect(isNamedEffect(undefined)).toBe(false);
  });

  it('runners do not throw on fresh construction (0 ticks)', () => {
    const scene = new THREE.Scene();
    for (const id of SKILL_VFX_RANGED_EFFECTS as readonly SkillVfxRangedEffect[]) {
      expect(() => {
        const r = NAMED_RUNNERS[id](scene, effectFor());
        r.dispose();
      }).not.toThrow();
    }
  });
});

describe('melee basic-attack effects (faithful HTML ports)', () => {
  const effectFor = (element: AttackEffect3D['element']): AttackEffect3D => ({
    id: 'fx-melee',
    element,
    sourcePosition: new THREE.Vector3(-4.3, 1.4, 0),
    targetPosition: new THREE.Vector3(4.2 - 1.7, 1.4, 0),
    durationS: 1.4,
  });
  const elements = Object.keys(MELEE_RUNNERS) as AttackEffect3D['element'][];

  it.each(elements)('%s builds + ticks to completion + disposes idempotently', (element) => {
    const scene = new THREE.Scene();
    const runner: Runner3D = MELEE_RUNNERS[element](scene, effectFor(element));
    const steps = Math.ceil((1.4 + 0.35) / 0.016);
    expect(() => {
      for (let i = 0; i < steps; i++) {
        runner.tick(0.016, i * 0.016, new THREE.Quaternion());
      }
      runner.dispose();
      runner.dispose();
    }).not.toThrow();
  });

  it('covers every element', () => {
    expect(elements.sort()).toEqual(
      ['fire', 'water', 'plant', 'ice', 'electricity', 'earth', 'steel', 'wind', 'light', 'dark', 'null'].sort(),
    );
  });
});