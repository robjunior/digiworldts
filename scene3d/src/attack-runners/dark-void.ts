import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { Pool, burst, cnt, rand, rnd, C2 } from './html-fx/pool';

/**
 * Dark Void (Shadow Void) — faithful port of the reference HTML `voidSkill()`.
 *
 * A black sphere grows at the target while dark swaths and purple motes spiral
 * inward, then at the drain burst (T >= 2.3 s) it erupts into a dark shockwave
 * + purple burst and fires impact.
 */
export function buildDarkVoidRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  // P = additive purple motes, D = normal-blend dark swaths (as in the HTML).
  const P = new Pool(scene, 3000);
  const D = new Pool(scene, 1500, THREE.NormalBlending);

  const b = effect.targetPosition.clone();

  const orbm = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  orbm.position.copy(b);
  orbm.scale.setScalar(0.01);
  scene.add(orbm);

  const light = new THREE.PointLight(0x8a3cff, 0, 32, 1.5);
  scene.add(light);
  const flashLight = (col: number, i: number, x: number, y: number, z: number): void => {
    light.position.set(x, y, z);
    if (i >= light.intensity) {
      light.color.setHex(col);
      light.intensity = i;
    }
  };

  const DK = C2.dks;
  const BK = C2.bk;
  const PU = C2.pur;
  const PU2 = C2.pur2;

  const END = 2.3;
  let T = 0;
  let ended = false;
  let impactFired = false;
  const disposed = { value: false };

  const tick: Runner3D['tick'] = (dtS) => {
    if (disposed.value) return;
    T += dtS;

    if (T < END) {
      const g = Math.min(1, T / 0.5);
      orbm.scale.setScalar(0.9 * (1 - Math.pow(1 - g, 3)) * (1 + Math.sin(T * 18) * 0.05));

      for (let i = cnt(180, dtS); i--;) {
        const d = new THREE.Vector3(rnd(), rnd(), rnd()).normalize();
        const r = rand(2.2, 3.8);
        const tx = -d.z * 2;
        const tz = d.x * 2;
        D.emit(b.x + d.x * r, b.y + d.y * r, b.z + d.z * r,
          -d.x * 3.5 + tx, -d.y * 3.5, -d.z * 3.5 + tz, 0.7, 0.7, 0.15, DK, BK);
      }
      for (let i = cnt(120, dtS); i--;) {
        const d = new THREE.Vector3(rnd(), rnd(), rnd()).normalize();
        const r = rand(1.5, 3.2);
        P.emit(b.x + d.x * r, b.y + d.y * r, b.z + d.z * r,
          -d.x * 4 - d.z * 2, -d.y * 4, -d.z * 4 + d.x * 2, 0.55, 0.12, 0.04, PU, PU2);
      }
      flashLight(0x8a3cff, 3, b.x, b.y, b.z);
    } else if (!ended) {
      ended = true;
      for (let i = 0; i < 170; i++) {
        const d = new THREE.Vector3(rnd(), rnd(), rnd()).normalize().multiplyScalar(rand(2, 7));
        D.emit(b.x, b.y, b.z, d.x, d.y, d.z, rand(0.6, 1.3), 1, 1.7, DK, BK, 0, 1.5);
      }
      burst(P, b.x, b.y, b.z, 120, 8, 0.8, 0.2, 0.03, PU, PU2, -3, 1);
      flashLight(0x9a4cff, 10, b.x, b.y, b.z);
      if (!impactFired) {
        impactFired = true;
        effect.onImpact?.();
      }
      scene.remove(orbm);
      orbm.geometry.dispose();
      orbm.material.dispose();
    }

    light.intensity = light.intensity > 0.02
      ? light.intensity * Math.exp(-7 * dtS)
      : 0;
    P.update(dtS);
    D.update(dtS);
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    if (orbm.parent) scene.remove(orbm);
    orbm.geometry.dispose();
    orbm.material.dispose();
    scene.remove(light);
    P.dispose();
    D.dispose();
  };

  return { tick, dispose };
}