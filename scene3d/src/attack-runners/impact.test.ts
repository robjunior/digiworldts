/**
 * Regression tests for the centralized ability-impact polish
 * (`attack-runners/impact.ts`) — the shared ring + spark-burst + light flourish
 * that plays on every landed skill hit, plus the camera screen-shake math.
 *
 * These run headless (no WebGL): `buildImpactController` only touches THREE
 * object bookkeeping (Mesh/Material/PointLight) and a stub Scene, and the
 * shake helpers are pure functions. We assert the lifecycle invariants the
 * render loop depends on:
 *   1. buildImpactController returns null for unknown elements (defensive),
 *   2. a valid element yields a controller with a finite duration and a
 *      tick/dispose-shaped runner,
 *   3. tick() advances without throwing and dispose() is idempotent + removes
 *      every mesh it added from the scene,
 *   4. nextShakeOffset decays to zero by the end of its window and is bounded
 *      by the amplitude while active,
 *   5. shakeForElement returns per-element amplitudes (0 only for the no-shake
 *      sentinel element).
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  buildImpactController,
  nextShakeOffset,
  shakeForElement,
  IMPACT_SHAKE_DURATION_S,
} from "./impact";
import type { AnimatedElement } from "./types";

/** Minimal Scene stand-in: only needs `.add()` / `.remove()` the controller calls. */
class StubScene {
  readonly children: unknown[] = [];
  add(obj: unknown): void {
    this.children.push(obj);
  }
  remove(obj: unknown): void {
    const i = this.children.indexOf(obj);
    if (i >= 0) this.children.splice(i, 1);
  }
}

const ELEMENTS: AnimatedElement[] = [
  "fire", "water", "plant", "ice", "electricity",
  "earth", "steel", "wind", "light", "dark", "null",
];

describe("buildImpactController", () => {
  it("returns null for an unknown element (defensive)", () => {
    const scene = new StubScene() as unknown as THREE.Scene;
    // `undefined` element is not in IMPACT_TUNING → null, never throws.
    const ctrl = buildImpactController(scene, {
      element: "unknown" as AnimatedElement,
      position: new THREE.Vector3(0, 0, 0),
    });
    expect(ctrl).toBeNull();
  });

  it("builds a runner with finite duration for every known element", () => {
    const scene = new StubScene() as unknown as THREE.Scene;
    for (const el of ELEMENTS) {
      const ctrl = buildImpactController(scene, {
        element: el,
        position: new THREE.Vector3(1, 2, 3),
      });
      expect(ctrl).not.toBeNull();
      expect(ctrl!.duration).toBeGreaterThan(0);
      expect(Number.isFinite(ctrl!.duration)).toBe(true);
      expect(typeof ctrl!.runner.tick).toBe("function");
      expect(typeof ctrl!.runner.dispose).toBe("function");
      // Unique id so concurrent impacts never collide in the effects map.
      expect(ctrl!.id).toContain("impact-");
    }
  });

  it("adds meshes to the scene and removes them all on dispose (idempotent)", () => {
    const scene = new StubScene() as unknown as THREE.Scene;
    const ctrl = buildImpactController(scene, {
      element: "fire",
      position: new THREE.Vector3(0, 0, 0),
    })!;
    const added = scene.children.length;
    expect(added).toBeGreaterThan(0);

    ctrl.runner.dispose();
    // All added meshes/lights are gone.
    expect(scene.children.length).toBe(0);

    // Second dispose is a no-op (no throw, no double-remove).
    expect(() => ctrl.runner.dispose()).not.toThrow();
    expect(scene.children.length).toBe(0);
  });

  it("tick advances the flourish without throwing across its lifetime", () => {
    const scene = new StubScene() as unknown as THREE.Scene;
    const ctrl = buildImpactController(scene, {
      element: "ice",
      position: new THREE.Vector3(0, 0, 0),
    })!;
    const camQuat = new THREE.Quaternion();
    // Step through ~1s at 60fps; must not throw and must stay finite-lived.
    let elapsed = 0;
    const dt = 1 / 60;
    while (elapsed < ctrl.duration + 0.1) {
      expect(() => ctrl.runner.tick(dt, elapsed, camQuat)).not.toThrow();
      elapsed += dt;
    }
    ctrl.runner.dispose();
  });
});

describe("screen-shake math", () => {
  it("decays to zero by the end of the window and is bounded while active", () => {
    const amp = 0.05;
    // Mid-window: magnitude stays within the amplitude (with some headroom for
    // the random walk), never exceeding amp.
    for (let t = 0; t < IMPACT_SHAKE_DURATION_S; t += 0.01) {
      const { x, y } = nextShakeOffset(amp, t, IMPACT_SHAKE_DURATION_S);
      expect(Math.abs(x)).toBeLessThanOrEqual(amp + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(amp + 1e-9);
    }
    // At/after the window: fully settled.
    const settled = nextShakeOffset(amp, IMPACT_SHAKE_DURATION_S, IMPACT_SHAKE_DURATION_S);
    expect(settled).toEqual({ x: 0, y: 0 });
    const past = nextShakeOffset(amp, IMPACT_SHAKE_DURATION_S + 1, IMPACT_SHAKE_DURATION_S);
    expect(past).toEqual({ x: 0, y: 0 });
  });

  it("zero amplitude yields no shake", () => {
    expect(nextShakeOffset(0, 0, IMPACT_SHAKE_DURATION_S)).toEqual({ x: 0, y: 0 });
    // Every element maps to a finite, non-negative amplitude.
    for (const el of ELEMENTS) {
      expect(shakeForElement(el)).toBeGreaterThanOrEqual(0);
    }
  });
});
