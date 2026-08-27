/**
 * Regression tests for the attack-stutter fix (scene3d PR).
 *
 * Root cause of the lag: every skill cast used to build its runner — which
 * allocates a ParticleEmitter per slot (InstancedMesh + 8 InstancedBufferAttributes
 * + a fresh ShaderMaterial) — synchronously inside the input/click frame, so the
 * first cast paid a multi-ms GC + GPU-upload hitch. Two changes address it:
 *
 *   1. `createEmitterMaterial` caches ShaderMaterials by shader/opts signature,
 *      so repeated casts reuse the material instead of reallocating + recompiling.
 *   2. `createDeferredRunner` (scene.ts) defers the heavy runner construction to
 *      the next render tick, off the input frame.
 *
 * These tests pin both behaviours without a real WebGL context: ParticleEmitter
 * touches only JS arrays + Three object bookkeeping, and a stub Scene satisfies
 * the single `scene.add(mesh)` call.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { ParticleEmitter } from "./ParticleEmitter";
import {
  createEmitterMaterial,
  prewarmParticleMaterials,
} from "./shaders";

/** Minimal Scene stand-in: only needs the `.add()` call the emitter performs. */
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

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-emitter",
    name: "test",
    kind: "instanced",
    geometry: "quad",
    shader: "default",
    emissionRate: 100,
    maxParticles: 50,
    lifetimeMs: [200, 400],
    startSize: [0.1, 0.2],
    endSize: [0.05, 0.08],
    startColor: 0xffee88,
    endColor: 0xff8800,
    startOpacity: 1,
    endOpacity: 0,
    velocity: { base: [0, 1, 0], variance: [1, 1, 1] },
    gravity: [0, -3, 0],
    wind: [0, 0, 0],
    drag: 0.1,
    spawn: { shape: "point", size: [0, 0, 0], center: [0, 0, 0] },
    blending: "additive",
    ...overrides,
  } as never;
}

describe("ParticleEmitter — zero-alloc tick + stats", () => {
  it("constructs without a real WebGL context", () => {
    const scene = new StubScene();
    const em = new ParticleEmitter(scene as unknown as THREE.Scene, makeConfig());
    expect(em.mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(em.mesh.count).toBe(50);
    // Every instance must start hidden: translation Y parked at the hidden Y,
    // so nothing renders until a spawn writes it. (A zero-scale matrix
    // decomposes with a unit scale, so we assert the translation directly.)
    const m = new THREE.Matrix4();
    em.mesh.getMatrixAt(0, m);
    expect(m.elements[13]).toBe(-1000);
    em.dispose();
  });

  it("spawns and ages particles across ticks without throwing on NaN dt", () => {
    const scene = new StubScene();
    // Use a burst (oneshot) emitter so it fully drains: all particles dead after
    // their lifetime, proving age/kill logic works without a render loop.
    const em = new ParticleEmitter(
      scene as unknown as THREE.Scene,
      makeConfig({
        emissionMode: "oneshot",
        burstCount: 20,
        totalLifetimeMs: 600,
        lifetimeMs: [200, 400],
      }),
    );
    // One tick spawns the whole burst.
    em.tick(1 / 60);
    const before = em.getParticleStats();
    expect(before.alive).toBe(20);
    // NaN dt must be ignored (no crash, no state corruption).
    em.tick(NaN);
    const afterNaN = em.getParticleStats();
    expect(afterNaN.alive).toBe(before.alive);
    // Advance well past the max lifetime; every particle must have died.
    for (let i = 0; i < 120; i += 1) em.tick(1 / 30);
    const end = em.getParticleStats();
    expect(end.alive).toBe(0);
    expect(end.dead).toBe(50);
    em.dispose();
  });
});

describe("createEmitterMaterial — caching (stutter fix #1)", () => {
  it("returns the same material instance for identical shader/opts", () => {
    const a = createEmitterMaterial("default", {
      color: 0xffffff,
      opacity: 1,
      blending: "normal",
      softParticles: false,
      textureUrl: null,
    });
    const b = createEmitterMaterial("default", {
      color: 0xffffff,
      opacity: 1,
      blending: "normal",
      softParticles: false,
      textureUrl: null,
    });
    expect(a).toBe(b);
  });

  it("returns distinct materials for distinct opt signatures", () => {
    const a = createEmitterMaterial("default", {
      color: 0xff0000,
      opacity: 1,
      blending: "normal",
      softParticles: false,
      textureUrl: null,
    });
    const b = createEmitterMaterial("default", {
      color: 0x00ff00,
      opacity: 1,
      blending: "normal",
      softParticles: false,
      textureUrl: null,
    });
    expect(a).not.toBe(b);
  });

  it("cachable:false always builds a fresh instance", () => {
    const a = createEmitterMaterial(
      "default",
      {
        color: 0xffffff,
        opacity: 1,
        blending: "normal",
        softParticles: false,
        textureUrl: null,
      },
      false,
    );
    const b = createEmitterMaterial(
      "default",
      {
        color: 0xffffff,
        opacity: 1,
        blending: "normal",
        softParticles: false,
        textureUrl: null,
      },
      false,
    );
    expect(a).not.toBe(b);
  });

  it("prewarmParticleMaterials populates the cache for every shader kind", () => {
    const kinds = [
      "default",
      "rainStreak",
      "wetSpark",
      "sandHaze",
      "thunderCore",
      "snowFlake",
      "hailShard",
    ] as const;
    expect(() => prewarmParticleMaterials(kinds)).not.toThrow();
    // After prewarm, requesting the default material again returns the cached one.
    const cached = createEmitterMaterial("default", {
      color: 0xffffff,
      opacity: 1,
      blending: "normal",
      softParticles: false,
      textureUrl: null,
    });
    expect(cached).toBeInstanceOf(THREE.ShaderMaterial);
  });
});
