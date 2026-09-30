import { useCallback, useRef } from 'react';
import type { Action, BattleView, FriendlyUnitView } from '@digiworld/shared/battle';
import type { CommandMode } from '../combat/CommandPanel';
import type { WSClientMessage } from '@digiworld/shared/ws';
import type { RefObject } from 'react';
import type { Combat3DSceneHandle } from './Combat3DScene';
import { ATTACK_PROPAGATION_MS, extractPlayerVfx } from './combat3dConfig';

/**
 * Player-action entry point. Plays the actor's impact effect first (when the
 * action has one), waits `ATTACK_PROPAGATION_MS`, then sends to the server —
 * PvE via the world-battle endpoint, PvP via the websocket. Guards against
 * re-entrancy while a cast is in flight and always resets the command menu.
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
        sceneRef.current.playEffect(
          vfx.element,
          vfx.sourceId,
          vfx.targetId,
          {
            attackKind: vfx.attackKind,
            ...(vfx.vfxPresetId !== undefined ? { vfxPresetId: vfx.vfxPresetId } : {}),
          },
        );
        setCommandMode('menu');
        window.setTimeout(() => {
          if (activeBattle.mode === 'pve') {
            void onPveDispatch(action);
          } else {
            onWsSend({ type: 'act', matchId: activeBattle.id, action } satisfies WSClientMessage);
          }
          dispatchPendingRef.current = false;
        }, ATTACK_PROPAGATION_MS);
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
