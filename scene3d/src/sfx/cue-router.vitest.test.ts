import { describe, expect, it } from 'vitest';
import { CueRouter, defaultCues, type CueStep } from './cue-router';
import { gainFromScreen, normalizePosition, panFromScreenX, spatialize } from './spatial';
import { pickVariationIndex } from './manifest';

describe('spatial math', () => {
  it('pan is 0 at center, ±0.7 at the edges, capped', () => {
    expect(panFromScreenX(0)).toBe(0);
    expect(panFromScreenX(-1)).toBeCloseTo(-0.7);
    expect(panFromScreenX(1)).toBeCloseTo(0.7);
    expect(panFromScreenX(5)).toBeCloseTo(0.7); // capped
  });

  it('gain is highest at center and low off-screen', () => {
    expect(gainFromScreen(0, true)).toBe(1);
    expect(gainFromScreen(0, false)).toBeGreaterThan(0.12);
    const edge = gainFromScreen(1, true);
    expect(edge).toBeGreaterThan(0.3);
    expect(edge).toBeLessThan(1);
  });

  it('normalizePosition maps px → centered NDC-ish', () => {
    // 750px in a 1000px viewport → +0.5 right of center.
    const n = normalizePosition(750, 1000, true);
    expect(n.screenX).toBeCloseTo(0.5);
    const center = normalizePosition(500, 1000, true);
    expect(center.screenX).toBeCloseTo(0);
  });

  it('spatialize combines the two curves', () => {
    const s = spatialize({ screenX: 0, viewportWidth: 1, onScreen: true });
    expect(s.pan).toBe(0);
    expect(s.gain).toBe(1);
  });
});

describe('import { pickVariationIndex } from manifest — no-repeat', () => {
  it('never picks the previous variation when allowed', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i += 1) {
      const idx = pickVariationIndex(3, null, () => 0);
      seen.add(idx);
    }
    expect(seen.has(0)).toBe(true);
    // 2 variations → always flips.
    expect(pickVariationIndex(2, 0, () => 0)).toBe(1);
    expect(pickVariationIndex(2, 1, () => 0)).toBe(0);
  });
});

describe('CueRouter', () => {
  const playSteps: { soundId: CueStep['soundId']; opts: import('./cue-router').CueOpts }[] = [];
  const step: import('./cue-router').PlayFn = (soundId, opts) => {
    playSteps.push({ soundId, opts });
    // Return a no-op handle unless looping; looped cues get a stop-able one.
    return opts.loop
      ? { id: playSteps.length, soundId, stop: () => { playSteps.push({ soundId, opts: {} }); } }
      : { id: -1, soundId, stop: () => {} };
  };

  it('maps a melee hit to layered impact by material + damage + crit', () => {
    const r = new CueRouter(step);
    r.emit({ type: 'ability:hit', damage: 80, crit: true, material: 'flesh' });
    const ids = playSteps.map((p) => p.soundId);
    expect(ids).toContain('combat_impact');
    expect(ids).toContain('combat_impact_flesh');
    expect(ids).toContain('combat_impact_heavy'); // damage ≥ 60
    expect(ids).toContain('combat_impact_crit');
  });

  it('footsteps pick the surface', () => {
    const r = new CueRouter(step);
    r.emit({ type: 'unit:step', unitId: 'a:0', surface: 'water' });
    expect(playSteps[playSteps.length - 1]!.soundId).toBe('combat_footstep_water');
  });

  it('ability cast starts a looping projectile that cancelLoops stops', () => {
    const r = new CueRouter(step);
    const before = playSteps.length;
    r.emit({ type: 'ability:cast' });
    const after = playSteps.length;
    expect(after - before).toBeGreaterThanOrEqual(2); // cast + looping projectile
    const hasLoop = playSteps.slice(before, after).some((p) => p.opts.loop === true);
    expect(hasLoop).toBe(true);
    r.cancelLoops();
  });

  it('routes UI click + board interactions', () => {
    const r = new CueRouter(step);
    r.emit({ type: 'ui:*' });
    expect(playSteps[playSteps.length - 1]!.soundId).toBe('ui_click');
    r.emit({ type: 'tile:hover' });
    expect(playSteps[playSteps.length - 1]!.soundId).toBe('tile_hover');
    r.emit({ type: 'tile:invalid' });
    expect(playSteps[playSteps.length - 1]!.soundId).toBe('tile_invalid');
  });
});

describe('defaultCues exhaustiveness', () => {
  it('labels every CueEvent branch', () => {
    const events = [
      { type: 'ability:projectile:start' },
      { type: 'ability:projectile:stop' },
      { type: 'ability:miss' },
      { type: 'ability:block' },
      { type: 'unit:death' },
      { type: 'status:apply', debuff: false },
      { type: 'status:dot' },
      { type: 'status:heal' },
      { type: 'turn:start' },
      { type: 'turn:end' },
    ] as const;
    for (const e of events) expect(Array.isArray(defaultCues(e))).toBe(true);
  });
});