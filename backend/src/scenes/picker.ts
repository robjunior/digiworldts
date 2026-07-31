import type { Element } from '@digiworld/shared/digimon';
import type { SceneEntity } from '@digiworld/shared/scene';

import { listScenes } from './store.js';

export async function pickSceneForElements(elements: readonly Element[]): Promise<SceneEntity | null> {
  if (elements.length === 0) return null;
  const scenes = await listScenes();
  if (scenes.length === 0) return null;
  const set = new Set<Element>(elements);
  const matches = scenes.filter((s) => s.elements.some((el) => set.has(el)));
  if (matches.length === 0) return null;
  const idx = Math.floor(Math.random() * matches.length);
  return matches[idx] ?? null;
}
