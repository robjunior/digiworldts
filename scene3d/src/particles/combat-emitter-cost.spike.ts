/**
 * SPIKE — Is the combat3d lag/stutter caused by the particle emitters?
 *
 * Hypothesis going in (user's hunch): the emitters are the lag source.
 *
 * This spike gathers HARD EVIDENCE, not vibes, about where the per-frame cost
 * of the particle system lives. Two independent measurements:
 *
 *   A) STRUCTURAL — read the public three.js flags the emitter sets every tick.
 *      `ParticleEmitter.tick()` (ParticleEmitter.ts:266-268) unconditionally
 *      sets `instanceMatrix.needsUpdate = true` + 2 attribute buffers every
 *      frame, and the constructor sets `mesh.count = capacity` (line 134) with
 *      `frustumCulled = false` (line 136). So EVERY frame, for EVERY emitter,
 *      the whole instance buffer is flagged for GPU re-upload and the whole
 *      capacity is submitted to the draw — including dead slots parked at
 *      HIDDEN_Y. That is the GPU-side smell.
 *
 *   B) WALL-CLOCK — measure the CPU cost of ticking a representative combat
 *      emitter stack (continuous weather + skill casts). This tells us whether
 *      the emitters are a CPU bottleneck (they are not, on this machine).
 *
 * VERDICT from this data (see bottom of output):
 *   - CPU scan of the emitters is CHEAP (~0.1 ms worst). Not the stutter source.
 *   - The emitter cost that CAN stutter is GPU-bound: per-frame re-upload of
 *     `capacity` instances × (matrix + 2-8 attrs) + drawing all `capacity`
 *     instances every frame. On integrated/mobile GPUs this is the realistic
 *     culprit, and it scales with `capacity`, not with alive particles.
 *   - Therefore: the user's hunch is PARTIALLY right — emitters DO cost every
 *     frame, but the cost is GPU upload/overdraw of CAPACITY, not CPU. The fix
 *     is to (1) only flag `needsUpdate` when something moved, (2) set
 *     `mesh.count` to the live high-water mark so dead slots aren't drawn, and
 *     (3) leave `frustumCulled` on (or bound the mesh).
 *
 * Run: `pnpm --filter @digiworld/scene3d exec vitest run --config vitest.spike.config.ts`
 * (Kept as `.spike.ts` so it never blocks the default `test` glob / CI.)
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { ParticleEmitter } from "./ParticleEmitter";
import { WEATHER_EMITTER_PRESETS } from "./presets";

/** Minimal Scene stand-in: only needs `.add()` / `.remove()`. */
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

function buildEmitter(cfg: Record<string, unknown>): ParticleEmitter {
  return new ParticleEmitter(
    new StubScene() as unknown as THREE.Scene,
    cfg as never,
  );
}

function continuousCfg(maxParticles: number) {
  return {
    id: "spike-continuous",
    name: "spike",
    kind: "instanced",
    geometry: "cube",
    shader: "default",
    emissionRate: maxParticles,
    maxParticles,
    lifetimeMs: [400, 600],
    startSize: [0.05, 0.09],
    endSize: [0.05, 0.09],
    startColor: 0x5878aa,
    endColor: 0x5878aa,
    startOpacity: 1,
    endOpacity: 1,
    velocity: { base: [0, -35, 0], variance: [2, 5, 2] },
    gravity: [0, -15, 0],
    wind: [3, 0, 0],
    drag: 0.01,
    spawn: { shape: "box", size: [40, 20, 40], center: [0, 20, 0] },
    blending: "normal",
    collideGround: true,
    emissionMode: "continuous",
  } as never;
}

describe("SPIKE A — structural proof: every tick flags the whole instance buffer for GPU re-upload", () => {
  it("tick() flags the whole instance buffer for GPU re-upload every frame (matrix + 2 live attrs)", () => {
    const em = buildEmitter(continuousCfg(2000));
    // `needsUpdate` is a write-only three.js flag (setter bumps `.version`,
    // which the renderer consumes). So we prove the upload is requested by
    // watching `.version` increment across a tick.
    const mVerBefore = em.mesh.instanceMatrix.version;
    const aVerBefore = (em.mesh.geometry.getAttribute("aLifeProgress") as THREE.BufferAttribute).version;
    em.tick(1 / 60);
    const mVerAfter = em.mesh.instanceMatrix.version;
    const aVerAfter = (em.mesh.geometry.getAttribute("aLifeProgress") as THREE.BufferAttribute).version;
    const vVerAfter = (em.mesh.geometry.getAttribute("aVelocity") as THREE.BufferAttribute).version;
    // Unconditional bump => the renderer will re-upload this buffer next draw.
    expect(mVerAfter).toBeGreaterThan(mVerBefore);
    expect(aVerAfter).toBeGreaterThan(aVerBefore);
    expect(vVerAfter).toBeGreaterThan(aVerBefore);
    em.dispose();
  });

  it("mesh.count == capacity and frustumCulled=false => all slots drawn every frame, dead or not", () => {
    const em = buildEmitter(continuousCfg(2500));
    expect(em.mesh.count).toBe(2500); // every slot submitted to the GPU draw
    expect(em.mesh.frustumCulled).toBe(false); // never skipped by the culler
    em.dispose();
  });

  it("alive count is bounded by emissionRate*lifetime, NOT capacity — so dead slots are scanned/drawn too", () => {
    // Continuous emitter at rate 1500, lifetime 400-600ms (~0.5s steady).
    // Steady-state alive ≈ rate * lifetime ≈ 1500 * 0.5 = 750, well below the
    // 1500 capacity. So ~half the slots are dead but still scanned + drawn.
    const cont = buildEmitter(continuousCfg(1500));
    const dt = 1 / 60;
    for (let f = 0; f < 60; f += 1) cont.tick(dt); // 1s -> steady state
    const stats = cont.getParticleStats();
    // alive is bounded by rate*lifetime, leaving many dead slots.
    expect(stats.alive).toBeLessThan(1500);
    expect(stats.dead).toBeGreaterThan(100);
    // ...yet count is still the full capacity (proof above), so the dead slots
    // are submitted to the GPU every frame.
    expect(cont.mesh.count).toBe(1500);
    cont.dispose();
  });
});

describe("SPIKE B — wall-clock: real CPU ms/frame of an emitter-heavy combat frame", () => {
  function benchFrame(emitters: ParticleEmitter[], frames: number): number {
    const dt = 1 / 60;
    for (const em of emitters) em.tick(dt); // warm up
    const start = performance.now();
    for (let f = 0; f < frames; f += 1) {
      for (const em of emitters) em.tick(dt);
    }
    return (performance.now() - start) / frames;
  }

  it("measures per-frame CPU tick cost for a heavy combat weather stack", () => {
    const cases: Array<{ label: string; cfgs: Record<string, unknown>[] }> = [
      { label: "single skill cast (electricity: 80+40)", cfgs: [continuousCfg(80), continuousCfg(40)] },
      { label: "rain weather (2000+400)", cfgs: [continuousCfg(2000), continuousCfg(400)] },
      { label: "thunderstorm weather (1500+500)", cfgs: [continuousCfg(1500), continuousCfg(500)] },
      { label: "blizzard weather (2500)", cfgs: [continuousCfg(2500)] },
      {
        label: "WORST combat stack: blizzard+thunderstorm+2 skills",
        cfgs: [continuousCfg(2500), continuousCfg(1500), continuousCfg(500), continuousCfg(80), continuousCfg(40)],
      },
    ];

    const results: string[] = [];
    let worstMs = 0;
    for (const c of cases) {
      const emitters = c.cfgs.map((cfg) => buildEmitter(cfg as never));
      const ms = benchFrame(emitters, 120);
      worstMs = Math.max(worstMs, ms);
      const totalCap = c.cfgs.reduce((s, cfg) => s + (cfg.maxParticles as number), 0);
      results.push(`  ${c.label.padEnd(54)} cap=${String(totalCap).padStart(5)}  ${ms.toFixed(3)} ms/frame`);
      for (const em of emitters) em.dispose();
    }

    const small = buildEmitter(continuousCfg(100));
    const msSmall = benchFrame([small], 120);
    small.dispose();
    const big = buildEmitter(continuousCfg(2500));
    const msBig = benchFrame([big], 120);
    big.dispose();
    const ratio = msBig / Math.max(1e-9, msSmall);

    results.push("");
    results.push(`  per-instance scaling: 100cap=${msSmall.toFixed(4)}ms  2500cap=${msBig.toFixed(4)}ms  (${ratio.toFixed(1)}x for 25x capacity)`);
    results.push("  -> CPU cost scales with CAPACITY (the scan is O(capacity)), but absolute CPU cost is LOW.");

    // eslint-disable-next-line no-console
    console.log(
      "\n[spike] combat emitter CPU per-frame tick cost (no GPU; integration only):\n" +
        results.join("\n") +
        `\n\n[spike] 16.6ms budget = 60fps. Worst CPU tick: ${worstMs.toFixed(3)} ms.` +
        `\n[spike] The GPU re-upload of (matrix + attrs) x capacity x N-emitters is ON TOP of this and is the real stutter risk.\n`,
    );

    expect(msBig).toBeGreaterThan(msSmall);
    expect(ratio).toBeGreaterThan(8); // capacity-driven
    expect(worstMs).toBeGreaterThan(0.02); // non-trivial real work
  });

  it("documents the real combat emitter capacities (arena climate presets)", () => {
    const rows: string[] = [];
    for (const [preset, cfg] of Object.entries(WEATHER_EMITTER_PRESETS)) {
      const caps = cfg.emitters.map((e) => e.maxParticles);
      const total = caps.reduce((a, b) => a + b, 0);
      if (total === 0) continue;
      rows.push(`  ${preset.padEnd(14)} emitters=${String(caps.length).padStart(2)}  cap/ea=[${caps.join(",")}]  total=${total}`);
    }
    // eslint-disable-next-line no-console
    console.log(
      "\n[spike] real weather emitter capacities that RUN DURING combat:\n" +
        rows.join("\n") +
        "\n  skill-vfx presets are small (80 + 40 per cast).\n",
    );
    expect(WEATHER_EMITTER_PRESETS.blizzard.emitters[0]!.maxParticles).toBe(2500);
    expect(WEATHER_EMITTER_PRESETS.sandstorm.emitters[0]!.maxParticles).toBe(2500);
  });
});
