import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { buildStatusEffect, cleanseStatuses, STATUS_IMAGES } from './status-fx';
import { createStatusPools, StatusFxController, type StatusFxTarget } from './status-controller';

/** Minimal SpriteRigApi stub to satisfy the controller. */
function makeSprite(n = 1): Record<string, unknown> {
  const pos = new THREE.Vector3(4.2, 1.5, 0);
  return {
    unitId: `u${n}`,
    side: 'opp',
    slotIndex: 0,
    worldPosition: pos,
    spriteSize: new THREE.Vector2(0.7, 0.7),
    update: () => undefined,
    playAttack: () => undefined,
    playHit: () => undefined,
    illuminate: () => undefined,
    setDowned: () => undefined,
    setTextureUrl: () => undefined,
    setArenaBaselineY: () => undefined,
    setBasePosition: () => undefined,
    setUnitScale: () => undefined,
    setFacingDirection: () => undefined,
    dispose: () => undefined,
  };
}

const ALL_AILMENTS = [
  'burn', 'poison', 'weaken', 'freeze', 'stun', 'sleep',
  'blind', 'silence', 'root', 'petrify', 'curse', 'corruption', 'confusion', 'charm',
] as const;

describe('status-fx', () => {
  it('UNCAUGHT instrumentation direct builders: every ailment returns an effect, never null', () => {
    const scene = new THREE.Scene();
    const shaked: number[] = [];
    const target: StatusFxTarget = { shake: (s) => shaked.push(s) };
    const [pool, dPool] = createStatusPools(scene);
    const env = {
      scene,
      pool,
      dPool,
      tint: new THREE.Color(),
      addTint: () => undefined,
      shake: (s: number) => target.shake(s),
      lean: () => undefined,
      dim: () => undefined,
      flash: () => undefined,
      anchor: () => new THREE.Vector3(4.2, 0, 0),
      icon: () => undefined,
    };
    for (const kind of ALL_AILMENTS) {
      const eff = buildStatusEffect(env as never, kind as never);
      expect(eff).not.toBeNull();
      // Must tick without throwing (each frame path).
      expect(() => eff?.upd(0.016, 0.016)).not.toThrow();
      expect(() => eff?.end?.()).not.toThrow();
    }
    // bleed is reachable as a raw kind string (ported for fidelity).
    const bleed = buildStatusEffect(env as never, 'bleed' as never);
    expect(bleed).not.toBeNull();
  });

  it('controller sync adds/removes status effects and fires end on removal', () => {
    const scene = new THREE.Scene();
    const shaked: number[] = [];
    const target: StatusFxTarget = { shake: (s) => shaked.push(s) };
    const [pool, dPool] = createStatusPools(scene);
    const ctrl = new StatusFxController(
      scene, pool, dPool,
      makeSprite() as never,
      () => null,
      target,
    );

    ctrl.sync(['burn']);
    ctrl.tick(0.016);
    ctrl.tickIcons();
    // burn + any placeholder should not throw across several frames.
    expect(() => {
      for (let i = 0; i < 120; i++) ctrl.tick(0.016);
    }).not.toThrow();

    ctrl.sync(['burn', 'freeze']);
    expect(() => ctrl.tick(0.4)).not.toThrow();

    // Removing freeze fires its end() (shatter burst + mesh dispose) — must not throw.
    ctrl.sync(['burn']);
    expect(() => ctrl.tick(0.016)).not.toThrow();

    ctrl.clearAll();
    ctrl.tick(0.016);
    ctrl.dispose();
    ctrl.dispose(); // idempotent
  });

  it('controller clear/cleanse are safe with no statuses', () => {
    const scene = new THREE.Scene();
    const [pool, dPool] = createStatusPools(scene);
    const ctrl = new StatusFxController(
      scene, pool, dPool, makeSprite() as never, () => null, { shake: () => undefined },
    );
    expect(() => ctrl.clearAll()).not.toThrow();
    expect(() => ctrl.cleanse()).not.toThrow();
    ctrl.dispose();
  });

  it('STATUS_IMAGES covers the mapped ailments + bleed', () => {
    expect(STATUS_IMAGES.burn).toBe('🔥');
    expect(STATUS_IMAGES.freeze).toBe('🧊');
    expect(STATUS_IMAGES.stun).toBe('⚡');
    expect(STATUS_IMAGES.poison).toBe('☠️');
    expect(STATUS_IMAGES.sleep).toBe('💤');
    expect(STATUS_IMAGES.confusion).toBe('💫');
    expect(STATUS_IMAGES.curse).toBe('👿');
    expect((STATUS_IMAGES as Record<string, string | undefined>).bleed).toBe('🩸');
  });

  it('cleanseStatuses runs a full pass without throwing', () => {
    const scene = new THREE.Scene();
    const [pool, dPool] = createStatusPools(scene);
    const env = {
      scene, pool, dPool, tint: new THREE.Color(),
      addTint: () => undefined, shake: () => undefined, lean: () => undefined,
      dim: () => undefined, flash: () => undefined,
      anchor: () => new THREE.Vector3(4.2, 1, 0), icon: () => undefined,
    };
    expect(() => cleanseStatuses(env as never)).not.toThrow();
    expect(() => env.pool.dispose()).not.toThrow();
    expect(() => env.dPool.dispose()).not.toThrow();
  });
});