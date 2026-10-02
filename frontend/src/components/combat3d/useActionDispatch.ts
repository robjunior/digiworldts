import { useCallback, useRef } from 'react';
import type { Action, BattleView, FriendlyUnitView } from '@digiworld/shared/battle';
import type { CommandMode } from '../combat/CommandPanel';
import type { WSClientMessage } from '@digiworld/shared/ws';
import type { RefObject } from 'react';
import type { Combat3DSceneHandle } from './Combat3DScene';
import { extractPlayerVfx, playerEffectDurationMs, TURN_ADVANCE_DELAY_MS } from './combat3dConfig';

/**
 * Player-action entry point. Plays the actor's impact effect first (when the
 * action has one) and sends the action to the server once the hit LANDS —
 * anchored to the effect's `onImpact`, plus `TURN_ADVANCE_DELAY_MS` of
 * breathing room. PvE via the world-battle endpoint, PvP via the websocket.
 * Waiting on the impact (not the particle effect's tail) keeps a long trailing
 * visual from delaying the turn after the damage has already been dealt.
 * Guards against re-entrancy while a cast is in flight and always resets the
 * command menu.
 */
export function useActionDispatch(
  sceneRef: RefObject<Combat3DSceneHandle | null>,
  actor: FriendlyUnitView | null,
  activeBattle: BattleView | null,
  setCommandMode: (mode: CommandMode) => void,
  onPveDispatch: (action: Action) => Promise<void>,
  onWsSend: (msg: WSClientMessage) => void,
): { dispatch: (action: Action) => void } {
  const dispatchPendingRef = useRef(false);

  const dispatch = useCallback(
    (action: Action): void => {
      if (!activeBattle || dispatchPendingRef.current) return;

      const vfx = extractPlayerVfx(actor, action);
      if (vfx !== null && sceneRef.current !== null) {
        dispatchPendingRef.current = true;
        const sendAction = (): void => {
          if (activeBattle.mode === 'pve') {
            void onPveDispatch(action);
          } else {
            onWsSend({ type: 'act', matchId: activeBattle.id, action } satisfies WSClientMessage);
          }
          dispatchPendingRef.current = false;
        };
        // Send once the hit LANDS plus the post-hit pause — not when the
        // particle effect finishes, so a long trailing effect never delays the
        // turn (the damage is already on screen at that point).
        let sent = false;
        let fallbackId: number | null = null;
        const onImpact = (): void => {
          if (sent) return;
          sent = true;
          if (fallbackId !== null) window.clearTimeout(fallbackId);
          window.setTimeout(sendAction, TURN_ADVANCE_DELAY_MS);
        };
        const effectId = sceneRef.current.playEffect(
          vfx.element,
          vfx.sourceId,
          vfx.targetId,
          {
            attackKind: vfx.attackKind,
            onImpact,
            ...(vfx.vfxPresetId !== undefined ? { vfxPresetId: vfx.vfxPresetId } : {}),
          },
        );
        setCommandMode('menu');
        if (effectId === null) {
          // Rejected cast (target sprite missing): `onImpact` will never fire.
          onImpact();
        } else {
          // Safety bound: if the runner somehow never reports its hit, the turn
          // still advances after the effect's own duration.
          fallbackId = window.setTimeout(onImpact, playerEffectDurationMs(actor, action) + TURN_ADVANCE_DELAY_MS);
        }
        return;
      }

      if (activeBattle.mode === 'pve') {
        void onPveDispatch(action);
      } else {
        onWsSend({ type: 'act', matchId: activeBattle.id, action } satisfies WSClientMessage);
      }
      setCommandMode('menu');
    },
    [actor, activeBattle, setCommandMode, onPveDispatch, onWsSend, sceneRef],
  );

  return { dispatch };
}
