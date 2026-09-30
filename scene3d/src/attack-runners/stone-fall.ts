import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { Pool, burst, rand, rnd, V, C2 } from './html-fx/pool';

/**
 * Stone Fall — faithful port of the reference HTML `rock()` effect.
 *
 * Six tumbling boulders fall from high above the target (~y = target.y + 12),
 * each leaving a cloud of dark ground debris on impact (normal-blend pool) plus
 * a warm additive rock-chip burst and a light flash. Boulders that land are
 * removed scale-down over 0.4 s; the whole effect ends at 2.6 s.
 */
export function buildStoneFallRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const groundY = effect.targetPosition.y;
  const targetX = effect.targetPosition.x;
  const targetZ = effect.targetPosition.z;
  const fallH = groundY + 12;

  const P = new Pool(scene, 1500); // additive — rock burst/light debris
  const D = new Pool(scene, 1500, THREE.NormalBlending); // normal — dark ground debris

  const light = new THREE.PointLight(0xffc080, 0, 24, 1.5);
  scene.add(light);
  const flashLight = (i: number, x: number, y: number, z: number): void => {
    light.position.set(x, y, z);
    if (i >= light.intensity) {
      light.color.setHex(0xffc080);
      light.intensity = i;
    }
  };

  // Debris palettes (C2.rk/rk1 = dark ground chunk, C2.rd0/rd1 = warm burst).
  const D0 = C2.rk;
  const D1 = C2.rk1;
  const K0 = C2.rd0;
  const K1 = C2.rd1;

  const mat = new THREE.MeshStandardMaterial({
    color: 0x7d6d5a,
    roughness: 0.95,
    flatShading: true,
  });

  type Rock = {
    readonly m: THREE.Mesh;
    readonly sz: number;
    readonly d: number;
    vy: number;
    landed: boolean;
    readonly rot: THREE.Vector3;
    shown: boolean;
  };

  const rocks: Rock[] = [];
  for (let i = 0; i < 6; i++) {
    const big = i === 0;
    const sz = big ? 1.15 : rand(0.35, 0.7);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(sz, 0), mat);
    m.position.set(targetX + (big ? 0 : rnd() * 2.2), fallH + i, targetZ + (big ? 0 : rnd() * 2.2));
    m.scale.y = 0.85;
    m.visible = false;
    scene.add(m);
    rocks.push({
      m,
      sz,
      d: 0.1 + i * 0.14,
      vy: 0,
      landed: false,
      rot: V(rnd(), rnd(), rnd()).multiplyScalar(4),
      shown: false,
    });
  }

  let T = 0;
  let impactFired = false;
  const disposed = { value: false };

  const tick: Runner3D['tick'] = (dtS) => {
    if (disposed.value) return;
    T += dtS;

    for (const r of rocks) {
      if (T < r.d || r.landed) continue;
      if (!r.shown) {
        r.shown = true;
        r.m.visible = true;
      }
      r.vy -= 30 * dtS;
      r.m.position.y += r.vy * dtS;
      r.m.rotation.x += r.rot.x * dtS;
      r.m.rotation.z += r.rot.z * dtS;
      const rest = groundY + r.sz * 0.7;
      if (r.m.position.y <= rest) {
        r.m.position.y = rest;
        r.landed = true;
        const x = r.m.position.x;
        const z = r.m.position.z;
        for (let j = 0; j < 40; j++) {
          const an = Math.random() * 6.28;
          const sp = rand(1, 3.5);
          D.emit(x, groundY + 0.2, z, Math.cos(an) * sp, rand(0.3, 1.4), Math.sin(an) * sp, rand(0.8, 1.5), 0.7, 2, D0, D1, 0, 1.5);
        }
        burst(P, x, groundY + 0.3, z, 30, 5, 0.7, 0.09, 0.02, K0, K1, -10, 0.5, 3);
        flashLight(4, x, groundY + 1, z);
        if (!impactFired && r.sz > 1) {
          impactFired = true;
          effect.onImpact?.();
        }
      }
    }

    if (T > 2.2) {
      const sc = Math.max(0, 1 - (T - 2.2) / 0.4);
      for (const r of rocks) r.m.scale.set(sc, 0.85 * sc, sc);
    }

    P.update(dtS);
    D.update(dtS);
    light.intensity = light.intensity > 0.02 ? light.intensity * Math.exp(-7 * dtS) : 0;
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    for (const r of rocks) {
      scene.remove(r.m);
      r.m.geometry.dispose();
    }
    mat.dispose();
    P.dispose();
    D.dispose();
    scene.remove(light);
  };

  return { tick, dispose };
}