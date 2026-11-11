import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { Pool, burst, cnt, rand, rnd, C2, V } from './html-fx/pool';

/**
 * Blade Storm — faithful port of the reference HTML `steel()`.
 *
 * 7 steel blades launch in sequence from near the caster and zip to the
 * target, each leaving a steel-gray trail and bursting with sparks on arrival;
 * all blades shrink away and the effect clears at T >= 2 s.
 */
export function buildBladeStormRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const P = new Pool(scene, 2500);
  const source = effect.sourcePosition.clone();
  const tgt = effect.targetPosition.clone();

  const light = new THREE.PointLight(0xffe8b0, 0, 32, 1.5);
  scene.add(light);
  const flashLight = (i: number, x: number, y: number, z: number): void => {
    light.position.set(x, y, z);
    if (i >= light.intensity) {
      light.color.setHex(0xffe8b0);
      light.intensity = i;
    }
  };

  const geo = new THREE.BoxGeometry(1.3, 0.14, 0.05);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd4dbe6,
    metalness: 0.6,
    roughness: 0.25,
    emissive: 0x2a3548,
  });
  const S1 = C2.gd;
  const S2 = C2.gd2;
  const M0 = C2.st0;
  const M1 = C2.st1;
  const W = C2.wh;

  interface Blade {
    m: THREE.Mesh;
    from: THREE.Vector3;
    to: THREE.Vector3;
    d: number;
    st: boolean;
    arrived: boolean;
  }
  const bl: Blade[] = [];
  for (let i = 0; i < 7; i++) {
    const from = V(source.x + rnd() * 0.8, source.y + rand(0.3, 2.7), rnd() * 1.6);
    const to = tgt.clone().add(V(rnd() * 0.6, rnd() * 0.7, rnd() * 0.5));
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(from);
    m.visible = false;
    scene.add(m);
    const dir = to.clone().sub(from);
    m.rotation.z = Math.atan2(dir.y, dir.x);
    bl.push({ m, from, to, d: 0.15 + i * 0.13, st: false, arrived: false });
  }

  let T = 0;
  let done = false;
  let impactFired = false;
  const disposed = { value: false };

  const tick: Runner3D['tick'] = (dtS) => {
    if (disposed.value) return;
    T += dtS;

    if (!done) {
      for (const b of bl) {
        const k = (T - b.d) / 0.22;
        if (k < 0) continue;
        b.m.visible = true;
        if (k < 1) {
          const p = b.from.clone().lerp(b.to, k);
          b.m.position.copy(p);
          for (let i = cnt(150, dtS); i--;) {
            P.emit(p.x - 0.5 + rnd() * 0.3, p.y + rnd() * 0.1, p.z + rnd() * 0.1,
              rnd() * 0.3, rnd() * 0.3, rnd() * 0.3, 0.25, 0.18, 0.04, M0, M1);
          }
        } else if (!b.st) {
          b.st = true;
          b.arrived = true;
          b.m.position.copy(b.to);
          const q = b.to;
          const sl = rnd();
          burst(P, q.x, q.y, q.z, 45, 5, 0.5, 0.14, 0.02, S1, S2, -9, 0.8);
          for (let j = 0; j < 16; j++) {
            const u = j / 15 - 0.5;
            P.emit(q.x + u * 1.8, q.y + u * 1.8 * sl, q.z, 0, 0, 0, 0.18, 0.16, 0.02, W, M0);
          }
          flashLight(7, q.x, q.y, q.z);
          if (!impactFired) {
            impactFired = true;
            effect.onImpact?.();
          }
        }
      }
      if (T > 1.7) {
        const sc = Math.max(0, 1 - (T - 1.7) / 0.3);
        bl.forEach((b) => b.m.scale.setScalar(sc));
      }
      if (T >= 2) {
        done = true;
        bl.forEach((b) => {
          scene.remove(b.m);
          b.m.geometry.dispose();
        });
        geo.dispose();
        mat.dispose();
      }
    }

    light.intensity = light.intensity > 0.02
      ? light.intensity * Math.exp(-7 * dtS)
      : 0;
    P.update(dtS);
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    bl.forEach((b) => {
      if (b.m.parent) scene.remove(b.m);
      b.m.geometry.dispose();
    });
    geo.dispose();
    mat.dispose();
    scene.remove(light);
    P.dispose();
  };

  return { tick, dispose };
}