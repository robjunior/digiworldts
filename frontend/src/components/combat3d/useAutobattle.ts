import { useEffect, useRef, useState } from 'react';
import type { Action, BattleView, FriendlyUnitView } from '@digiworld/shared/battle';
import type { CommandMode } from '../combat/CommandPanel';
import { AUTOBATTLE_DELAY_MS, readAutobattlePref, writeAutobattlePref, pickAutoAction } from './combat3dConfig';

/**
 * Drives the autobattle toggle for PvE matches. Picks and dispatches an action
 * once per resolved turn, keyed by `id:round:logLength:actorId` so a re-render
 * mid-turn never double-fires. The turn key resets whenever the battle leaves
 * the `active` state.
 */
export function useAutobattle(
  activeBattle: BattleView | null,
  actor: FriendlyUnitView | null,
  commandMode: CommandMode,
  onDispatch: (action: Action) => void,
): { enabled: boolean; setEnabled: (next: boolean) => void } {
  const [enabled, setEnabled] = useState<boolean>(() => readAutobattlePref());
  const turnKeyRef = useRef<string | null>(null);

  useEffect(() => {
    writeAutobattlePref(enabled);
  }, [enabled]);

  useEffect(() => {
    if (activeBattle?.status !== 'active') {
      turnKeyRef.current = null;
    }
  }, [activeBattle?.status, activeBattle?.id]);

  useEffect(() => {
    if (!enabled || !activeBattle || activeBattle.mode !== 'pve' || activeBattle.status !== 'active') {
      return;
    }
    if (!activeBattle.yourTurn || actor === null || actor.down || commandMode !== 'menu') {
      return;
    }

    const turnKey = `${activeBattle.id}:${activeBattle.round}:${activeBattle.log.length}:${actor.id}`;
    if (turnKeyRef.current === turnKey) return;

    const action = pickAutoAction(actor, activeBattle.enemy);
    if (action === null) return;

    turnKeyRef.current = turnKey;
    const timerId = window.setTimeout(() => onDispatch(action), AUTOBATTLE_DELAY_MS);
    return () => window.clearTimeout(timerId);
  }, [enabled, activeBattle, actor, commandMode, onDispatch]);

  return { enabled, setEnabled };
}
