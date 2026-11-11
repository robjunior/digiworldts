import { describe, expect, it } from 'vitest';

import { resolveSceneModelUrl } from './arena-urls';

describe('resolveSceneModelUrl', () => {
  const fallback = '/bundled/fallback.glb';
  const sceneUrl = '/assets/scenes/scn_0123456789abcdefghjkmnpqrs/rev_0123456789abcdef0123456789abcdef/scene.glb';

  it('passes generated same-origin scene asset URLs through', () => {
    expect(resolveSceneModelUrl(sceneUrl, fallback)).toBe(sceneUrl);
  });

  it('passes seeded backend arena paths through (content-deploy /assets/arenas)', () => {
    const seeded = '/assets/arenas/arena.glb';
    expect(resolveSceneModelUrl(seeded, fallback)).toBe(seeded);
  });

  it('rejects traversal and remote URLs in favor of the fallback', () => {
    expect(resolveSceneModelUrl('../scene.glb', fallback)).toBe(fallback);
    expect(resolveSceneModelUrl('https://example.invalid/scene.glb', fallback)).toBe(fallback);
    expect(resolveSceneModelUrl('//example.invalid/scene.glb', fallback)).toBe(fallback);
  });

  it('uses the fallback when no model was configured', () => {
    expect(resolveSceneModelUrl(undefined, fallback)).toBe(fallback);
  });
});
