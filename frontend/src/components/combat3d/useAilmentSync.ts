import { useEffect, useRef } from 'react';
import type { Ailment } from '@digiworld/shared/digimon';
import type { BattleView, UnitId } from '@digiworld/shared/battle';
import type { Combat3DSceneHandle } from './Combat3DScene';

/**
 * Keeps the scene's persistent 3D status effects in sync with each unit's
 * current ailment set. On every battle change the active ailments per unit are
 * diffed against what the scene is currently showing and the deltas are pushed
 * via `scene.syncAilments`. When a unit goes down / leaves, its statuses are
 * cleared so the persistent FX don't linger on an empty slot.
 *
 * The scene self-disposes a status effect when its matching ailment is removed
 * (driven by these deltas), so nothing here leaks across battles or unit swaps.
 */
export function useAilmentSync(
  sceneRef: React.RefObject<Combat3DSceneHandle | null>,
  battle: BattleView | null,
): void {
  // Snapshot of the last ceilments we pushed, keyed by unit id.
  const lastRef = useRef<Map<UnitId, readonly { kind: Ailment; turnsLeft: number }[]>>(new Map());

  useEffect(() => {
    const scene = sceneRef.current;
    if (scene === null || battle === null) return;

    const units = [
      ...battle.friendly.map((u) => ({ id: u.id, ailments: u.ailments ?? [], down: u.down })),
      ...battle.enemy.map((u) => ({ id: u.id, ailments: u.ailments ?? [], down: u.down })),
    ];

    const next = new Map<UnitId, readonly { kind: Ailment; turnsLeft: number }[]>();
    for (const unit of units) {
      next.set(unit.id, unit.ailments);

      // Downed units drop their persistent status FX immediately.
      if (unit.down) {
        if ((lastRef.current.get(unit.id)?.length ?? 0) > 0) scene.clearAilments(unit.id);
        continue;
      }

      // Only push a change when the ailment set actually changed; the scene
      // diffs kind-level add/remove internally.
      const prev = lastRef.current.get(unit.id);
      const same =
        prev !== undefined &&
        prev.length === unit.ailments.length &&
        prev.every((a, i) => a.kind === unit.ailments[i]?.kind && a.turnsLeft === unit.ailments[i]?.turnsLeft);
      if (!same) scene.syncAilments(unit.id, unit.ailments);
    }

    // Clear units that left the battle entirely.
    for (const id of lastRef.current.keys()) {
      if (!next.has(id)) scene.clearAilments(id);
    }

    lastRef.current = next;
  }, [sceneRef, battle]);
}