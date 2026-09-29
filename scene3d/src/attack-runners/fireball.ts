import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { Pool, burst, cnt, rand, rnd, C } from './html-fx/pool';

/**
 * Fireball — faithful port of the reference HTML `fire()` effect.
 *
 * A glowing projectile arcs from the caster to the target (0.7 s), leaving a
 * fire + warm-spark trail, then explodes in a large additive burst at the
 * target and continues as a burning ground fire for ~1.4 s.
 */
export function buildFireballRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const pool = new Pool(scene, 2400);
  const a = effect.sourcePosition.clone();
  const b = effect.targetPosition.clone();

  // Tracking light used as the shot's `flash()`; decays each frame.
  const light = new THREE.PointLight(0xff7a20, 0, 32, 1.5);
  scene.add(light);

  const flashLight = (c: number, i: number, x: number, y: number, z: number): void => {
    light.position.set(x, y, z);
    if (i >= light.intensity) {
      light.color.setHex(c);
      light.intensity = i;
    }
  };

  // --- Projectile phase (flies source→target over 0.7 s) ---
  let t = 0;
  let boom = false;
  let bt = 0;
  const dur = 0.7;
  let impactFired = false;
  const disposed = { value: false };

  const projectile = (dt: number): void => {
    t += dt;
    const u = Math.min(t / dur, 1);
    const p = a.clone().lerp(b, u);
    p.y += Math.sin(u * Math.PI) * 1.1;
    for (let i = cnt(160, dt); i--;) {
      pool.emit(p.x + rnd() * 0.15, p.y + rnd() * 0.15, p.z + rnd() * 0.15,
        rnd() * 0.6, rand(0.4, 1.6), rnd() * 0.6, 0.5,
        rand(0.7, 1), 0.1, i % 3 ? C.org : C.yel, C.red, 2, 1);
    }
    for (let i = cnt(60, dt); i--;) {
      pool.emit(p.x, p.y, p.z, rnd() * 0.3, rnd() * 0.3, rnd() * 0.3, 0.25, 0.9, 0.5, C.white, C.yel);
    }
    flashLight(0xff7a20, 3.5, p.x, p.y, p.z);
    if (u >= 1) {
      boom = true;
      burst(pool, b.x, b.y, b.z, 320, 6, 0.9, 1.2, 0.2, C.yel, C.red, 1.5, 2, 1.5);
      flashLight(0xff8a30, 12, b.x, b.y + 1, 0);
      if (!impactFired) {
        impactFired = true;
        effect.onImpact?.();
      }
    }
  };

  // --- Ground-fire phase (burns at the target for ~1.4 s after boom) ---
  const groundFire = (dt: number): void => {
    bt += dt;
    const k = Math.max(0, 1 - bt / 1.4);
    for (let i = cnt(220 * k, dt); i--;) {
      const an = Math.random() * 6.28;
      const r = Math.random() * 0.8;
      pool.emit(b.x + Math.cos(an) * r, 0.1, b.z + Math.sin(an) * r,
        rnd() * 0.4, rand(1.5, 3.2), rnd() * 0.4, rand(0.5, 1), rand(0.7, 1.1), 0.1,
        i % 4 ? C.org : C.yel, C.red, 1.5, 1);
    }
    flashLight(0xff6a10, 4 * k, b.x, 1.2, 0);
  };

  const tick: Runner3D['tick'] = (dtS) => {
    if (disposed.value) return;
    if (!boom) projectile(dtS);
    else if (bt < 1.4) groundFire(dtS);
    pool.update(dtS);
    light.intensity = light.intensity > 0.02
      ? light.intensity * Math.exp(-7 * dtS)
      : 0;
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    pool.dispose();
    scene.remove(light);
  };

  return { tick, dispose };
}