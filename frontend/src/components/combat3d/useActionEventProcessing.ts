import { useCallback, type RefObject } from 'react';
import type { BattleSide, BattleView, UnitId } from '@digiworld/shared/battle';
import { isAnimatedElement } from '@digiworld/scene3d/attack-runners/types';
import type { AnimatedElement } from '@digiworld/scene3d/attack-runners/types';
import type { Combat3DSceneHandle } from './Combat3DScene';
import type { Floater3D } from './Floaters';

/**
 * Renders a single `action` battle event: spawns its damage/miss/resist/heal/
 * status floater and, for enemy (non-friendly) animated hits, fires the 3D
 * impact effect. Support/debuff skills report `damage: 0` or negative (heal),
 * so the floater gate is on `damage !== undefined`, not `damage > 0`; misses
 * stay silent so the impact callback doesn't read as a landed hit.
 */
export function useActionEventProcessing(
  sceneRef: RefObject<Combat3DSceneHandle | null>,
  yourSide: BattleSide,
  spawnFloater: (targetId: UnitId, text: string, kind: Floater3D['kind'], opts?: { color?: string; sub?: string }) => void,
): { playActionEvent: (event: BattleView['log'][number], playVfx?: boolean) => void } {
  const playActionEvent = useCallback(
    (event: BattleView['log'][number], playVfx = true): void => {
      if (event.type !== 'action') return;

      const { targetId, damage, cue, skillElement, actor: eventActor, vfxPresetId } = event;
      if (targetId === undefined || targetId === null) return;

      const actorIsFriendly = eventActor !== null && eventActor.startsWith(`${yourSide}:`);

      if (damage !== undefined) {
        let kind: Floater3D['kind'] = 'dmg';
        let text = String(damage);
        let color: string | undefined;
        let sub: string | undefined;

        if (cue === 'crit') {
          kind = 'crit';
        } else if (cue === 'miss') {
          kind = 'miss';
          text = 'MISS';
        } else if (cue === 'resist') {
          kind = 'resist';
          text = 'RESIST';
        } else if (cue === 'immune') {
          kind = 'resist';
          text = 'IMMUNE';
        } else if (cue === 'weak') {
          kind = 'dmg';
          color = '#5df2ff';
        } else if (cue === 'attr-advantage') {
          kind = 'crit';
        } else if (cue === 'attr-disadvantage') {
          kind = 'resist';
        } else if (cue === 'item-heal') {
          kind = 'heal';
          text = `+${Math.abs(damage)}`;
        } else if (cue === 'item-en') {
          kind = 'status';
          text = 'EN';
          color = '#5df2ff';
        } else if (cue === 'item-cure') {
          kind = 'status';
          text = 'CURE';
          color = '#3dffa0';
        } else if (cue === 'item-buff') {
          kind = 'status';
          text = 'BUFF';
          color = '#ffe14d';
        } else if (cue === 'item-revive') {
          kind = 'level';
          text = 'REVIVE';
        } else if (cue === 'capture-hit') {
          kind = 'status';
          text = 'CAPTURED';
          color = '#ff4df0';
        } else if (cue === 'capture-miss') {
          kind = 'miss';
          text = 'MISS';
        } else if (damage < 0) {
          kind = 'heal';
          text = `+${Math.abs(damage)}`;
        }

        const opts: { color?: string; sub?: string } = {};
        if (color !== undefined) opts.color = color;
        if (sub !== undefined) opts.sub = sub;
        spawnFloater(targetId, text, kind, opts);
      }

      const isMiss = cue === 'miss' || cue === 'capture-miss';
      if (playVfx && !actorIsFriendly && isAnimatedElement(skillElement) && !isMiss) {
        const attackKind: 'basic' | 'skill' =
          event.action !== undefined && event.action.type === 'fight' ? 'basic' : 'skill';
        sceneRef.current?.playEffect(
          skillElement as AnimatedElement,
          eventActor,
          targetId,
          {
            attackKind,
            ...(vfxPresetId !== undefined ? { vfxPresetId } : {}),
          },
        );
      }
    },
    [sceneRef, yourSide, spawnFloater],
  );

  return { playActionEvent };
}
