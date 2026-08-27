import { useCallback, type RefObject } from 'react';
import type { BattleSide, BattleView, UnitId } from '@digiworld/shared/battle';
import { isAnimatedElement } from '@digiworld/scene3d/attack-runners/types';
import type { AnimatedElement } from '@digiworld/scene3d/attack-runners/types';
import type { Combat3DSceneHandle } from './Combat3DScene';
import type { Floater3D } from './Floaters';

/**
 * Renders a single `action` battle event: spawns its damage/miss/resist
 * floater and, for enemy (non-friendly) animated hits, fires the 3D impact
 * effect. Support/debuff skills report `damage: 0` or negative (heal), so the
 * floater gate is on `damage !== undefined`, not `damage > 0`; misses stay
 * silent so the impact callback doesn't read as a landed hit.
 */
export function useActionEventProcessing(
  sceneRef: RefObject<Combat3DSceneHandle | null>,
  yourSide: BattleSide,
  spawnFloater: (targetId: UnitId, text: string, kind: Floater3D['kind']) => void,
): { playActionEvent: (event: BattleView['log'][number], playVfx?: boolean) => void } {
  const playActionEvent = useCallback(
    (event: BattleView['log'][number], playVfx = true): void => {
      if (event.type !== 'action') return;

      const { targetId, damage, cue, skillElement, actor: eventActor, vfxPresetId } = event;
      if (targetId === undefined || targetId === null) return;

      const actorIsFriendly = eventActor !== null && eventActor.startsWith(`${yourSide}:`);

      if (damage !== undefined) {
        const kind: Floater3D['kind'] =
          cue === 'crit' ? 'crit' : cue === 'miss' ? 'miss' : cue === 'resist' ? 'resist' : 'dmg';
        const text =
          damage > 0 ? String(damage) : cue === 'miss' ? 'MISS' : cue === 'resist' ? 'RESIST' : '0';
        spawnFloater(targetId, text, kind);
      }

      const isMiss = cue === 'miss';
      if (playVfx && !actorIsFriendly && isAnimatedElement(skillElement) && !isMiss) {
        sceneRef.current?.playEffect(
          skillElement as AnimatedElement,
          eventActor,
          targetId,
          vfxPresetId !== undefined ? { vfxPresetId } : undefined,
        );
      }
    },
    [sceneRef, yourSide, spawnFloater],
  );

  return { playActionEvent };
}
