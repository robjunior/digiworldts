import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SkillVfxPreset } from '@digiworld/shared/skill-vfx';
import { SkillVfxPresetWriteZ } from '@digiworld/shared/skill-vfx';
import { ParticleEmitterConfigZ } from '@digiworld/shared/weather';
import { buildPresetRunner, interpolatePosition } from './preset';
import type { AttackEffect3D, Runner3D } from './types';

/**
 * Ported-skill VFX smoke. The 5 effects (fireball, frost spikes, ice lance,
 * tornado, lightning) are data-driven SkillVfxPresets in
 * `backend/data/scenes/skill-vfx-presets.json`. This spec proves each one:
 *   1. validates against SkillVfxPresetWriteZ / ParticleEmitterConfigZ,
 *   2. builds a runner via the REAL buildPresetRunner,
 *   3. ticks across the full lifetime + dispose, throwing nothing.
 * Runs headless (happy-dom, no WebGL) since the preset runner only does
 * THREE bookkeeping + InstancedMesh allocation.
 */
describe('imported skill-vfx presets (data-driven)', () => {
  const PRESETS_PATH = resolve(import.meta.dirname, '../../../backend/data/scenes/skill-vfx-presets.json');
  let presets: SkillVfxPreset[];

  const PORTED_IDS = [
    'svfx-fireball',
    'svfx-frost-spikes',
    'svfx-ice-lance',
    'svfx-tornado',
    'svfx-lightning',
  ];

  beforeAll(() => {
    const data = JSON.parse(readFileSync(PRESETS_PATH, 'utf8')) as { presets: SkillVfxPreset[] };
    presets = data.presets;
  });

  it('contains all 5 ported presets', () => {
    const ids = new Set(presets.map((p) => p.id));
    for (const id of PORTED_IDS) expect(ids.has(id), `missing ${id}`).toBe(true);
  });

  it('each ported preset validates against the write schema', () => {
    for (const pid of PORTED_IDS) {
      const p = presets.find((x) => x.id === pid)!;
      const body = SkillVfxPresetWriteZ.parse({
        name: p.name,
        element: p.element,
        attackType: p.attackType,
        emitters: p.emitters,
        trajectory: p.trajectory,
        totalDurationMs: p.totalDurationMs,
        impactAtMs: p.impactAtMs,
        light: p.light,
      });
      expect(body.totalDurationMs).toBeGreaterThan(0);
    }
  });

  it('every emitter inside every ported preset validates', () => {
    for (const pid of PORTED_IDS) {
      const p = presets.find((x) => x.id === pid)!;
      for (const slot of p.emitters) {
        expect(() => ParticleEmitterConfigZ.parse(slot.emitter)).not.toThrow();
      }
    }
  });

  it('builds + ticks + disposes each runner headlessly, throwing nothing', () => {
    const scene = new THREE.Scene();
    for (const pid of PORTED_IDS) {
      const p = presets.find((x) => x.id === pid)!;
      const effect: AttackEffect3D = {
        id: 'smoke',
        element: p.element ?? 'fire',
        sourcePosition: new THREE.Vector3(-4, 1.5, 0),
        targetPosition: new THREE.Vector3(4, 1.5, 0),
        durationS: p.totalDurationMs / 1000,
      };
      let runner: Runner3D;
      expect(() => { runner = buildPresetRunner(scene, effect, p); }, `build ${pid}`).not.toThrow();
      const steps = Math.ceil(p.totalDurationMs / 16) + 2;
      expect(() => {
        for (let i = 0; i < steps; i++) {
          runner!.tick(0.016, i * 0.016, new THREE.Quaternion());
        }
        runner!.dispose();
        runner!.dispose(); // idempotent
      }, `tick+dispose ${pid}`).not.toThrow();
    }
  });

  it('interpolatePosition is finite for every trajectory used', () => {
    const out = new THREE.Vector3();
    for (const pid of PORTED_IDS) {
      const p = presets.find((x) => x.id === pid)!;
      const src = new THREE.Vector3(-4, 1, 0);
      const dst = new THREE.Vector3(4, 1, 0);
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        interpolatePosition(p.trajectory, src, dst, t, out);

        expect(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z)).toBe(true);
      }
    }
  });
});