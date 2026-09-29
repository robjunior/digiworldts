import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { NAMED_RUNNERS, namedEffectDuration, isNamedEffect } from './named';
import type { SkillVfxNamedEffect } from '@digiworld/shared/skill-vfx';
import { SKILL_VFX_NAMED_EFFECTS } from '@digiworld/shared/skill-vfx';

/**
 * Faithful-port regression: the named skill effects (fireball, frost-spikes,
 * ice-lance, tornado, lightning) must build, tick over their full lifetime,
 * and dispose without throwing — each under a real THREE.Scene with the actual
 * `Pool` particle system. Runs headless (happy-dom, no WebGL) because the
 * runners only do THREE object bookkeeping + typed-array updates.
 */
describe('named skill effects (faithful HTML ports)', () => {
  const effectFor = (): AttackEffect3D => ({
    id: 'fx-test',
    element: 'fire',
    sourcePosition: new THREE.Vector3(-4.3, 2.3, 0),
    targetPosition: new THREE.Vector3(4.2, 1.3, 0),
    durationS: 2.5,
  });

  it.each(SKILL_VFX_NAMED_EFFECTS as readonly SkillVfxNamedEffect[])(
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
    for (const id of SKILL_VFX_NAMED_EFFECTS) {
      expect(isNamedEffect(id)).toBe(true);
      expect(NAMED_RUNNERS[id]).toBeTypeOf('function');
    }
    expect(isNamedEffect('not-a-real-effect')).toBe(false);
    expect(isNamedEffect(undefined)).toBe(false);
  });

  it('runners do not throw on fresh construction (0 ticks)', () => {
    const scene = new THREE.Scene();
    for (const id of SKILL_VFX_NAMED_EFFECTS as readonly SkillVfxNamedEffect[]) {
      expect(() => {
        const r = NAMED_RUNNERS[id](scene, effectFor());
        r.dispose();
      }).not.toThrow();
    }
  });
});