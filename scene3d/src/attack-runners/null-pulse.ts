import * as THREE from 'three';

import type { AttackEffect3D, Runner3D } from './types';
import { Pool, burst, cnt, rnd, V, C2 } from './html-fx/pool';

/**
 * Null Pulse — faithful port of the reference HTML `nullPulse()` effect.
 *
 * An orb of pale null-energy flies from the caster to the target (0.45 s),
 * then implodes into a bright white pulse: an additive burst, an expanding
 * translucent shell, and three expanding ground rings. Pulse phase lasts ~0.9 s.
 */
export function buildNullPulseRunner(scene: THREE.Scene, effect: AttackEffect3D): Runner3D {
  const P = new Pool(scene, 2200); // additive
  const groundY = effect.targetPosition.y;
  const groundX = effect.targetPosition.x;
  const groundZ = effect.targetPosition.z;

  const a = V(effect.sourcePosition.x, effect.sourcePosition.y + 2.3, effect.sourcePosition.z);
  const b = V(groundX, groundY + 1.4, groundZ);

  const light = new THREE.PointLight(0xdde4ff, 0, 28, 1.5);
  scene.add(light);
  const flashLight = (c: number, i: number, x: number, y: number, z: number): void => {
    light.position.set(x, y, z);
    if (i >= light.intensity) {
      light.color.setHex(c);
      light.intensity = i;
    }
  };

  const N0 = C2.nl0;
  const N1 = C2.nl1;

  const add = (c: number, o: number): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({
      color: c,
      transparent: true,
      opacity: o,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

  let t = 0;
  let stage = 0;
  let bt = 0;
  let shell: THREE.Mesh | null = null;
  let rings: THREE.Mesh[] = [];
  let impactFired = false;
  const disposed = { value: false };

  const tick: Runner3D['tick'] = (dtS) => {
    if (disposed.value) return;
    if (stage === 0) {
      t += dtS;
      const u = Math.min(t / 0.45, 1);
      const p = a.clone().lerp(b, u);
      for (let i = cnt(180, dtS); i--;) {
        P.emit(
          p.x + rnd() * 0.12, p.y + rnd() * 0.12, p.z + rnd() * 0.12,
          rnd() * 0.5, rnd() * 0.5, rnd() * 0.5, 0.35, 0.5, 0.08, N0, N1, 0, 2,
        );
      }
      for (let i = cnt(60, dtS); i--;) {
        P.emit(p.x, p.y, p.z, 0, 0, 0, 0.12, 0.9, 0.3, [1, 1, 1], N0);
      }
      flashLight(0xdde4ff, 3, p.x, p.y, p.z);
      if (u >= 1) {
        stage = 1;
        burst(P, b.x, b.y, b.z, 200, 7, 0.8, 0.25, 0.04, N0, N1, 0, 2);
        if (!impactFired) {
          impactFired = true;
          effect.onImpact?.();
        }
        flashLight(0xffffff, 10, b.x, b.y, b.z);
        shell = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), add(0xe8ecff, 0.6));
        shell.position.copy(b);
        scene.add(shell);
        for (let i = 0; i < 3; i++) {
          const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), add(0xe8ecff, 0));
          m.rotation.x = -Math.PI / 2;
          m.position.set(groundX, groundY + 0.05, groundZ);
          scene.add(m);
          rings.push(m);
        }
      }
    } else {
      bt += dtS;
      const g = Math.min(1, bt / 0.55);
      const e = 1 - Math.pow(1 - g, 3);
      if (shell) {
        shell.scale.setScalar(0.2 + 3.3 * e);
        (shell.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - g);
      }
      rings.forEach((m, i) => {
        const ph = Math.max(0, (bt - i * 0.12) / 0.7);
        m.scale.setScalar(0.5 + ph * 5.5);
        (m.material as THREE.MeshBasicMaterial).opacity = ph > 0 && ph < 1 ? 0.6 * (1 - ph) : 0;
      });
      if (bt >= 0.9) {
        if (shell) {
          scene.remove(shell);
          shell.geometry.dispose();
          (shell.material as THREE.Material).dispose();
          shell = null;
        }
        for (const m of rings) {
          scene.remove(m);
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
        rings = [];
      }
    }

    P.update(dtS);
    light.intensity = light.intensity > 0.02 ? light.intensity * Math.exp(-7 * dtS) : 0;
  };

  const dispose: Runner3D['dispose'] = () => {
    if (disposed.value) return;
    disposed.value = true;
    if (shell) {
      scene.remove(shell);
      shell.geometry.dispose();
      (shell.material as THREE.Material).dispose();
      shell = null;
    }
    for (const m of rings) {
      scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    rings = [];
    P.dispose();
    scene.remove(light);
  };

  return { tick, dispose };
}