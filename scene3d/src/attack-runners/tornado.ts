import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { Pool, cnt, rand, rnd, C } from './html-fx/pool';

/**
 * Tornado — faithful port of the reference HTML `wind()` effect.
 *
 * A swirling vortex of 110 wind-motes spirals up around the target with an
 * expanding additive torus ring pulsing outward, gust-ring particles flaring,
 * for ~2.6 s.
 */
export function buildTornadoRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const pool = new Pool(scene, 2600);
  const b = effect.targetPosition.clone();
  const D = 2.6;

  const light = new THREE.PointLight(0x88ffcc, 0, 32, 1.5);
  scene.add(light);

  // 110 motes spiraling upward.
  const m: Array<{ a: number; h: number; s: number }> = [];
  for (let i = 0; i < 110; i++) {
    m.push({ a: Math.random() * 6.28, h: Math.random() * 4.2, s: rand(0.8, 1.4) });
  }

  // Expanding additive torus ring at ground level.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.035, 8, 64),
    new THREE.MeshBasicMaterial({
      color: 0xbdfbe0,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(b.x, 0.06, b.z);
  scene.add(ring);

  let T = 0;
  let hitT = 0;
  let impactFired = false;
  const disposed = { value: false };

  const tick: Runner3D['tick'] = (dtS) => {
    if (disposed.value) return;
    T += dtS;
    hitT += dtS;
    const life = Math.min(1, T / 0.4) * Math.min(1, (D - T) / 0.5);
    if (!impactFired && T >= 0.2) {
      impactFired = true;
      effect.onImpact?.();
    }

    for (const o of m) {
      o.h += dtS * 1.6 * o.s;
      if (o.h > 4.4) o.h = 0;
      const r = (0.3 + o.h * 0.32) * life;
      o.a += dtS * (7 - o.h * 0.9) * o.s;
      pool.emit(b.x + Math.cos(o.a) * r, o.h, b.z + Math.sin(o.a) * r,
        -Math.sin(o.a) * 1.2, 0.3, Math.cos(o.a) * 1.2, 0.35,
        0.2 + 0.05 * o.h, 0.04, C.wind, C.wind2);
    }
    const ph = (T % 0.9) / 0.9;
    ring.scale.setScalar(0.6 + ph * 3.6);
    ring.material.opacity = 0.6 * (1 - ph) * life;

    for (let i = cnt(50 * life, dtS); i--;) {
      const an = Math.random() * 6.28;
      const r = rand(1, 2.6);
      pool.emit(b.x + Math.cos(an) * r, 0.1, b.z + Math.sin(an) * r,
        -Math.sin(an) * 2.5, rand(0.2, 1), Math.cos(an) * 2.5, 0.6, 0.4, 0.1, C.wind2, C.wind2, 0, 1);
    }

    light.position.set(b.x, 2, b.z);
    light.color.setHex(0x88ffcc);
    light.intensity = 1.2 * life;

    pool.update(dtS);
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    ring.geometry.dispose();
    ring.material.dispose();
    scene.remove(ring);
    scene.remove(light);
    pool.dispose();
  };

  return { tick, dispose };
}