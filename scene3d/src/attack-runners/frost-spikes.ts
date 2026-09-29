import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { Pool, burst, cnt, rand, rnd, C } from './html-fx/pool';

/**
 * Frost Spikes — faithful port of the reference HTML `ice()` effect.
 *
 * A central crystal and 10 surrounding spikes erupt out of the ground at the
 * target, an expanding ice ring flashes, cold mist + icicle motes drift, then
 * at T >= 2.5 s everything shatters into ice shards.
 */
export function buildFrostSpikesRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const pool = new Pool(scene, 2500);
  const b = effect.targetPosition.clone();

  const light = new THREE.PointLight(0x66ccff, 0, 32, 1.5);
  scene.add(light);
  const flashLight = (i: number, x: number, y: number, z: number): void => {
    light.position.set(x, y, z);
    if (i >= light.intensity) {
      light.color.setHex(0x66ccff);
      light.intensity = i;
    }
  };

  // Spikes: one central (tall) + 10 around.
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9be7ff,
    emissive: 0x2a9dff,
    emissiveIntensity: 0.7,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.9,
    flatShading: true,
  });
  const geo = new THREE.ConeGeometry(0.3, 1, 6);
  geo.translate(0, 0.5, 0);
  const sp: Array<{ m: THREE.Mesh; d: number; h: number; w: number; up: boolean }> = [];
  for (let i = 0; i < 11; i++) {
    const c = i === 0;
    const an = Math.random() * 6.28;
    const r = c ? 0 : rand(0.6, 1.7);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(b.x + Math.cos(an) * r, 0, b.z + Math.sin(an) * r);
    m.rotation.set(c ? 0 : rnd() * 0.35, Math.random() * 6, c ? 0 : rnd() * 0.35);
    m.scale.set(0, 0, 0);
    scene.add(m);
    sp.push({ m, d: c ? 0.05 : rand(0.05, 0.35), h: c ? 3.4 : rand(1.3, 2.4), w: c ? 1.3 : rand(0.7, 1.1), up: false });
  }

  // Expanding additive ring at ground level.
  const ring = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.MeshBasicMaterial({
      color: 0x6fd8ff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(b.x, 0.03, b.z);
  scene.add(ring);

  let T = 0;
  let gone = false;
  let impactFired = false;
  const disposed = { value: false };

  const tick: Runner3D['tick'] = (dtS) => {
    if (disposed.value) return;
    T += dtS;
    if (!impactFired && T >= 0.28) {
      impactFired = true;
      effect.onImpact?.();
    }

    ring.scale.setScalar(0.2 + 2.4 * Math.min(1, T / 0.4));
    ring.material.opacity = 0.35 * Math.min(1, (2.5 - T) / 0.5);

    for (const s of sp) {
      const k = Math.min(1, Math.max(0, (T - s.d) / 0.22));
      const e = 1 - Math.pow(1 - k, 3);
      if (k > 0 && !s.up) {
        s.up = true;
        burst(pool, s.m.position.x, 0.1, s.m.position.z, 26, 3, 0.7, 0.35, 0.05, C.white, C.ice2, -1, 1.5, 1.5);
        flashLight(5, b.x, 1.5, 0);
      }
      if (T < 2) s.m.scale.set(s.w * (0.4 + 0.6 * e), s.h * e, s.w * (0.4 + 0.6 * e));
    }
    if (T > 2) mat.opacity = 0.9 * Math.max(0, (2.5 - T) / 0.5);

    // Cold mist drifting across the target area.
    for (let i = cnt(60, dtS); i--;) {
      const an = Math.random() * 6.28;
      const r = rand(0.3, 2);
      pool.emit(b.x + Math.cos(an) * r, 0.15, b.z + Math.sin(an) * r,
        rnd() * 0.4, rand(0.1, 0.5), rnd() * 0.4, rand(1, 1.8), 1, 2, C.mist, C.mist, 0, 0.5);
    }
    // Icicle motes clinging around the growing spikes.
    for (let i = cnt(35, dtS); i--;) {
      const s = sp[i % sp.length]!;
      pool.emit(s.m.position.x + rnd() * 0.4, rand(0.2, 3), s.m.position.z + rnd() * 0.4,
        rnd() * 0.2, rand(0.1, 0.5), rnd() * 0.2, rand(0.6, 1.2), 0.09, 0.02, C.white, C.ice);
    }

    if (T >= 2.5) {
      if (!gone) {
        gone = true;
        for (const s of sp) {
          burst(pool, s.m.position.x, s.h * 0.5, s.m.position.z, 30, 4, 0.8, 0.14, 0.03, C.white, C.ice2, -6, 0.8);
          scene.remove(s.m);
        }
      }
      flashLight(6, b.x, 1.5, 0);
    }

    pool.update(dtS);
    light.intensity = light.intensity > 0.02 ? light.intensity * Math.exp(-7 * dtS) : 0;
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    for (const s of sp) scene.remove(s.m);
    mat.dispose();
    geo.dispose();
    ring.geometry.dispose();
    ring.material.dispose();
    scene.remove(ring);
    scene.remove(light);
    pool.dispose();
  };

  return { tick, dispose };
}