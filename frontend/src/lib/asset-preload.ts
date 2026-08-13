import type { BattleView } from '@digiworld/shared/battle';
import type { SceneEntity } from '@digiworld/shared/scene';
import { ARENA_MODEL_BY_KEY, DEFAULT_ARENA_MODEL, getArenaUrl } from '@digiworld/scene3d/arena-urls';

import { getDungeon } from './api-dungeon';
import { getScenes } from './api-scenes';
import { getSceneDefaults, type PerArenaSceneDefaults } from './scene-defaults';

/**
 * Asset preloading for the loading-transition buffer.
 *
 * Everything here is intentionally low-tech: `Image()` for images and plain
 * `fetch()` for binaries (GLB). We deliberately do NOT touch Three.js /
 * GLTFLoader — the goal is to warm the browser HTTP cache so the destination
 * screen's own loaders hit cache instead of the network.
 *
 * Every preload is best-effort: a failure is logged with `console.warn` and
 * swallowed, never thrown. Navigation must never be blocked by a 404.
 */

/** Element → arena key, mirroring `ARENA_BY_ELEMENT` in Combat3DScene.tsx.
 *  Kept here (not imported) because Combat3DScene internals are out of scope;
 *  if the mapping ever changes, update both sides. */
const ARENA_BY_ELEMENT: Readonly<Record<string, string>> = {
  plant: 'plant',
  nature: 'plant',
  wind: 'wind',
  earth: 'rock',
  steel: 'steel',
  electricity: 'steel',
  fire: 'fire',
  dark: 'dark',
  water: 'water',
  ice: 'ice',
  light: 'light',
  null: 'null',
};

const ARENA_FALLBACK = 'steel';

/** Mirror of `pickArenaKey` in Combat3DScene.tsx — majority element of the
 *  enemy side wins, falling back to the first friendly element, then 'steel'. */
function pickArenaKey(battle: BattleView): string {
  const counts = new Map<string, number>();
  for (const enemy of battle.enemy) {
    const arena = ARENA_BY_ELEMENT[enemy.element];
    if (arena !== undefined) counts.set(arena, (counts.get(arena) ?? 0) + 1);
  }
  if (counts.size > 0) {
    let bestKey = ARENA_FALLBACK;
    let bestCount = 0;
    for (const [key, n] of counts) {
      if (n > bestCount) { bestCount = n; bestKey = key; }
    }
    return bestKey;
  }
  for (const mon of battle.friendly) {
    const arena = ARENA_BY_ELEMENT[mon.element];
    if (arena !== undefined) return arena;
  }
  return ARENA_FALLBACK;
}

/**
 * Resolve the concrete arena model URL for a battle, mirroring the resolution
 * in Combat3DScene.tsx (scene entity `modelFile` first, then per-arena
 * defaults, then element-keyed model map). Best-effort: any failure falls back
 * to the next source and ultimately to `DEFAULT_ARENA_MODEL`.
 */
async function resolveArenaModelUrl(battle: BattleView): Promise<string | undefined> {
  const fallbackArenaKey = pickArenaKey(battle);
  const sceneId = battle.sceneId ?? null;
  const scenes = await getScenes(false).catch(() => [] as readonly SceneEntity[]);
  if (sceneId !== null) {
    const scene = scenes.find((s) => s.id === sceneId) ?? null;
    if (scene !== null) {
      const settings = scene.settings as Readonly<Record<string, unknown>>;
      const modelFile = typeof settings.modelFile === 'string' && settings.modelFile !== '' ? settings.modelFile : null;
      const modelUrl = modelFile !== null ? getArenaUrl(modelFile) : undefined;
      if (modelUrl !== undefined) return modelUrl;
      return ARENA_MODEL_BY_KEY[fallbackArenaKey] ?? DEFAULT_ARENA_MODEL;
    }
  }
  const all = await getSceneDefaults(false).catch((): PerArenaSceneDefaults => ({}));
  const arenaDefaults = all[fallbackArenaKey] ?? {};
  const modelFile = typeof arenaDefaults.modelFile === 'string' && arenaDefaults.modelFile !== '' ? arenaDefaults.modelFile : null;
  const modelUrl = modelFile !== null ? getArenaUrl(modelFile) : ARENA_MODEL_BY_KEY[fallbackArenaKey];
  return modelUrl ?? DEFAULT_ARENA_MODEL;
}

/** Resolve once the images/dots have warmed the cache at least as long as a
 *  minimum delay. `minMs` is a floor, not a ceiling — if the preload takes
 *  longer, the promise resolves when the preload finishes. */
export function promiseWithMinDuration<T>(promise: Promise<T>, minMs: number): Promise<T> {
  const minDelay = new Promise<void>((resolve) => { window.setTimeout(resolve, minMs); });
  return Promise.all([promise, minDelay]).then(([value]) => value);
}

/** Warm the browser cache for an image. Resolves on load OR on error (warned). */
export function preloadImage(url: string): Promise<void> {
  if (url === '' || url == null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => { console.warn('preload.image.fail', url); resolve(); };
    img.src = url;
  });
}

/** Warm the browser cache for a non-image asset (GLB). Resolves on success OR
 *  on failure (warned). */
export function preloadFetch(url: string): Promise<void> {
  if (url === '' || url == null) return Promise.resolve();
  return fetch(url, { credentials: 'include' })
    .then((res) => {
      if (!res.ok) console.warn('preload.fetch.fail', url, res.status);
    })
    .catch((err) => { console.warn('preload.fetch.fail', url, err); });
}

/** Portrait URL for a combat unit, mirroring Combat3DScene `toPlacements`. */
export function unitPortraitUrl(templateId: string): string {
  return `/assets/digimon/${templateId}/portrait.webp`;
}

/** Dot-sprite URL for a combat unit, mirroring Combat3DScene `toPlacements`. */
export function unitDotUrl(templateId: string): string {
  return `/assets/digimon/${templateId}/dot.gif`;
}

/**
 * Preload everything the combat screen needs for first paint:
 *   - the resolved arena GLB URL (scene entity / arena defaults / element key),
 *   - enemy portraits (for the splash and HUD),
 *   - dot sprites for every unit (friendly + enemy).
 * Never throws — every failure is individually warned.
 */
export async function preloadCombatAssets(battle: BattleView): Promise<void> {
  const urls: string[] = [];
  const arenaUrl = await resolveArenaModelUrl(battle).catch((err) => { console.warn('preload.arena.resolve.fail', err); return undefined; });
  if (arenaUrl !== undefined) urls.push(arenaUrl);
  for (const enemy of battle.enemy) urls.push(unitPortraitUrl(enemy.templateId));
  for (const unit of battle.friendly) urls.push(unitDotUrl(unit.templateId));
  for (const enemy of battle.enemy) urls.push(unitDotUrl(enemy.templateId));
  await Promise.all(urls.map((url) => (url.endsWith('.glb') ? preloadFetch(url) : preloadImage(url))));
}

/**
 * Preload every tileset spritesheet a dungeon needs, so the grid renders
 * without network stalls. Best-effort: dungeon fetch failure and per-image
 * failures are warned and swallowed.
 */
export async function preloadDungeonAssets(dungeonId: string): Promise<void> {
  const view = await getDungeon(dungeonId).catch((err) => { console.warn('preload.dungeon.fetch.fail', dungeonId, err); return null; });
  if (view === null) return;
  await Promise.all(view.tilesets.map((tileset) => preloadImage(tileset.imageUrl)));
}
