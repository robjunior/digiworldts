import type { Element } from '@digiworld/shared/digimon';
import type { SceneEntity } from '@digiworld/shared/scene';

import { listScenes } from './store.js';

export async function pickSceneForElements(elements: readonly Element[]): Promise<SceneEntity | null> {
  if (elements.length === 0) return null;
  const scenes = await listScenes();
  if (scenes.length === 0) return null;
  // Callers pass elements WITH multiplicity so the winner matches the arena the client picks
  // (majority element). Ties break on scene id to keep a battle's scene stable across replays.
  const counts = new Map<Element, number>();
  for (const el of elements) counts.set(el, (counts.get(el) ?? 0) + 1);
  let best: SceneEntity | null = null;
  let bestScore = 0;
  for (const scene of scenes) {
    let score = 0;
    for (const el of scene.elements) score += counts.get(el) ?? 0;
    if (score === 0) continue;
    if (best === null || score > bestScore || (score === bestScore && scene.id < best.id)) {
      best = scene;
      bestScore = score;
    }
  }
  return best;
}
