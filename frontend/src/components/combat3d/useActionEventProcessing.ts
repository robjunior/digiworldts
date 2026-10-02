import { useCallback, type RefObject } from 'react';
import type { BattleSide, BattleView, UnitId } from '@digiworld/shared/battle';
import { isAnimatedElement } from '@digiworld/scene3d/attack-runners/types';
import type { AnimatedElement } from '@digiworld/scene3d/attack-runners/types';
import type { Combat3DSceneHandle } from './Combat3DScene';
import type { Floater3D } from './Floaters';

/**
 * Renders a single `action` battle event: fires its 3D impact effect (for enemy
 * hits) and spawns the damage floater AT THE MOMENT OF IMPACT.
 *
 * The floater is anchored to the hit, not to the cast: `playEffect` accepts an
 * `onImpact` callback that every runner fires at its real hit frame (0.2s for
 * `tornado`, ~1s for `stone-fall`, 2.3s for `vine-lash`), so the number appears
 * when the blow lands. When no visual plays — or the scene rejects the effect
 * (target sprite missing) — the floater spawns immediately so damage is never
 * silently dropped.
 *
 * `notifyImpact` reports the same moment back to the caller so the battle's
 * turn clock can be anchored to it too.
 *
 * Support/debuff skills report `damage: 0` or negative (heal), so the floater
 * gate is on `damage !== undefined`, not `damage > 0`; misses stay silent so
 * the impact callback doesn't read as a landed hit.
 */
export function useActionEventProcessing(
  sceneRef: RefObject<Combat3DSceneHandle | null>,
  yourSide: BattleSide,
  spawnFloater: (targetId: UnitId, text: string, kind: Floater3D['kind'], opts?: { color?: string; sub?: string }) => void,
): {
  playActionEvent: (
    event: BattleView['log'][number],
    playVfx?: boolean,
    notifyImpact?: () => void,
  ) => void;
} {
  const playActionEvent = useCallback(
    (event: BattleView['log'][number], playVfx = true, notifyImpact?: () => void): void => {
      if (event.type !== 'action') return;

      const { targetId, damage, cue, skillElement, actor: eventActor, vfxPresetId } = event;
      if (targetId === undefined || targetId === null) return;

      const actorIsFriendly = eventActor !== null && eventActor.startsWith(`${yourSide}:`);

      const spawnDamageFloater = (): void => {
        if (damage === undefined) return;
        let kind: Floater3D['kind'] = 'dmg';
        let text = String(damage);
        let color: string | undefined;
        let sub: string | undefined;

        if (cue === 'crit') {
          kind = 'crit';
          sub = 'CRITICAL';
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
          color = 'var(--gold-bright)';
        } else if (cue === 'attr-advantage') {
          kind = 'crit';
          sub = 'ADVANTAGE';
        } else if (cue === 'attr-disadvantage') {
          kind = 'resist';
        } else if (cue === 'item-heal') {
          kind = 'heal';
          text = `+${Math.abs(damage)}`;
        } else if (cue === 'item-en') {
          kind = 'status';
          text = 'EN';
          color = 'var(--signal2)';
        } else if (cue === 'item-cure') {
          kind = 'status';
          text = 'CURE';
          color = '#3dffa0';
        } else if (cue === 'item-buff') {
          kind = 'status';
          text = 'BUFF';
          color = 'var(--gold-bright)';
        } else if (cue === 'item-revive') {
          kind = 'level';
          text = 'REVIVE';
        } else if (cue === 'capture-hit') {
          kind = 'status';
          text = 'CAPTURED';
          color = 'var(--signal2)';
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
      };

      const isMiss = cue === 'miss' || cue === 'capture-miss';
      const playVisual = playVfx && !actorIsFriendly && isAnimatedElement(skillElement) && !isMiss;
      const scene = sceneRef.current;

      if (!playVisual || scene === null) {
        // Nothing will play on screen: the hit reads immediately.
        spawnDamageFloater();
        notifyImpact?.();
        return;
      }

      let landed = false;
      const onImpact = (): void => {
        if (landed) return;
        landed = true;
        spawnDamageFloater();
        notifyImpact?.();
      };

      const attackKind: 'basic' | 'skill' =
        event.action !== undefined && event.action.type === 'fight' ? 'basic' : 'skill';
      const effectId = scene.playEffect(
        skillElement as AnimatedElement,
        eventActor,
        targetId,
        {
          attackKind,
          onImpact,
          ...(vfxPresetId !== undefined ? { vfxPresetId } : {}),
        },
      );

      // `playEffect` returns null when the cast is rejected (target sprite
      // missing), so the callback would never fire — land the hit now instead
      // of dropping the damage silently.
      if (effectId === null) onImpact();
    },
    [sceneRef, yourSide, spawnFloater],
  );

  return { playActionEvent };
}
