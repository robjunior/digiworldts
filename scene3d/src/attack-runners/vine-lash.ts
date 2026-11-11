import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { Pool, burst, cnt, rand, rnd, V, rgb, C2 } from './html-fx/pool';

/**
 * Vine Lash — faithful port of the reference HTML `vine()` effect.
 *
 * Seven curved vine tubes (CatmullRom + TubeGeometry) grow up out of the
 * ground around the target over ~2.3 s, spilling green/pink motes as they
 * extend, then shrink back from T=1.9. A green additive ground ring fades with
 * the effect; impact fires at the first vine tip to finish growing.
 */
export function buildVineLashRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const P = new Pool(scene, 2000); // additive
  const groundY = effect.targetPosition.y;
  const groundX = effect.targetPosition.x;
  const groundZ = effect.targetPosition.z;

  const G0 = C2.gr0;
  const G1 = C2.gr1;
  const Pk = C2.pk;
  const Yl = rgb(0xf6ff8a);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x3f9a3a,
    emissive: 0x14501a,
    roughness: 0.7,
    flatShading: true,
  });

  type Vine = {
    readonly curve: THREE.CatmullRomCurve3;
    readonly g: THREE.TubeGeometry;
    readonly m: THREE.Mesh;
    readonly d: number;
    done: boolean;
  };

  const vs: Vine[] = [];
  for (let i = 0; i < 7; i++) {
    const a0 = (i / 7) * 6.28 + rnd() * 0.3;
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j <= 14; j++) {
      const t = j / 14;
      const an = a0 + t * 4.5;
      const r = Math.max(0.62, 1.7 - t * 2.6) + rnd() * 0.03;
      pts.push(V(groundX + Math.cos(an) * r, groundY + t * 2.7, groundZ + Math.sin(an) * r));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, 40, 0.07, 6, false);
    g.setDrawRange(0, 0);
    const m = new THREE.Mesh(g, mat);
    scene.add(m);
    vs.push({ curve, g, m, d: i * 0.07, done: false });
  }

  const ring = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.MeshBasicMaterial({
      color: 0x5cff5a,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(groundX, groundY + 0.03, groundZ);
  scene.add(ring);

  const FULL = 40 * 36;
  let T = 0;
  let impactFired = false;
  let finished = false;
  const disposed = { value: false };

  const flashLight = (i: number, x: number, y: number, z: number): void => {
    light.position.set(x, y, z);
    if (i >= light.intensity) {
      light.color.setHex(0x6fff5a);
      light.intensity = i;
    }
  };

  const light = new THREE.PointLight(0x6fff5a, 0, 24, 1.5);
  scene.add(light);

  const tick: Runner3D['tick'] = (dtS) => {
    if (disposed.value) return;
    T += dtS;

    ring.scale.setScalar(0.3 + 2.2 * Math.min(1, T / 0.5));
    (ring.material as THREE.MeshBasicMaterial).opacity =
      0.35 * Math.max(0, Math.min(1, (2.4 - T) / 0.4));

    if (!finished) {
      const r = Math.max(0, (T - 1.9) / 0.4);
      for (const v of vs) {
        const k = Math.min(1, Math.max(0, (T - v.d) / 0.8));
        if (r > 0) {
          const st = Math.min(40, Math.floor(r * 40)) * 36;
          v.g.setDrawRange(st, FULL - st);
        } else {
          v.g.setDrawRange(0, Math.floor(k * 40) * 36);
        }
        if (k > 0 && k < 1) {
          const h = v.curve.getPoint(k);
          for (let i = cnt(60, dtS); i--;) {
            P.emit(
              h.x, h.y, h.z,
              rnd() * 0.8, rnd() * 0.8 + 0.3, rnd() * 0.8,
              0.6, 0.16, 0.05, i % 6 ? G0 : Pk, G1, -1.5, 0.8,
            );
          }
        }
        if (k >= 1 && !v.done) {
          v.done = true;
          const h = v.curve.getPoint(1);
          burst(P, h.x, h.y, h.z, 20, 2.5, 0.7, 0.16, 0.03, Pk, Yl, -2, 1);
          if (!impactFired) {
            impactFired = true;
            effect.onImpact?.();
          }
        }
      }
      for (let i = cnt(40, dtS); i--;) {
        P.emit(
          groundX + rnd() * 2, groundY + 0.1, groundZ + rnd() * 2,
          0, rand(0.3, 1), 0, 1.4, 0.1, 0.02, Yl, G0,
        );
      }
      flashLight(2.5 * Math.min(1, T), groundX, groundY + 1.5, groundZ);

      if (T >= 2.3) {
        burst(P, groundX, groundY + 2, 0, 80, 4, 1.3, 0.14, 0.04, G0, G1, -2, 1.5, 1);
        burst(P, groundX, groundY + 2, 0, 60, 4, 1.3, 0.14, 0.04, Pk, Yl, -2, 1.5, 1);
        for (const v of vs) {
          scene.remove(v.m);
          v.g.dispose();
        }
        scene.remove(ring);
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
        mat.dispose();
        finished = true;
      }
    }

    P.update(dtS);
    light.intensity = light.intensity > 0.02 ? light.intensity * Math.exp(-7 * dtS) : 0;
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    if (!finished) {
      for (const v of vs) {
        scene.remove(v.m);
        v.g.dispose();
      }
      scene.remove(ring);
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
      mat.dispose();
    }
    P.dispose();
    scene.remove(light);
  };

  return { tick, dispose };
}