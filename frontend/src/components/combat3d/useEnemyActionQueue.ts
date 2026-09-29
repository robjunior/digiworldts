import { useCallback, useEffect, useRef } from 'react';
import type { BattleView } from '@digiworld/shared/battle';
import { ATTACK_PROPAGATION_MS, TURN_GAP_MS, type EnemyPlaybackEntry } from './combat3dConfig';

/**
 * Serializes enemy action playback so impacts land one at a time. Hits by the
 * SAME actor are spaced by `ATTACK_PROPAGATION_MS`; when the ACTOR changes
 * (a new digimon's turn begins) the gap widens to `TURN_GAP_MS` — the ~3s
 * breathing pause "entre os turnos". `lastActorRef` persists across the whole
 * battle so the player→enemy handoff also breathes.
 */
export function useEnemyActionQueue(
  onPlayAction: (event: BattleView['log'][number], playVfx: boolean) => void,
): { enqueue: (entry: EnemyPlaybackEntry) => void } {
  const queueRef = useRef<EnemyPlaybackEntry[]>([]);
  const timerRef = useRef<number | null>(null);
  const lastActorRef = useRef<string | null>(null);

  const drainQueue = useCallback((): void => {
    const next = queueRef.current.shift();
    if (next === undefined) {
      timerRef.current = null;
      return;
    }
    const actor = next.event.type === 'action' ? next.event.actor : null;
    const newTurn = lastActorRef.current !== null && actor !== null && actor !== lastActorRef.current;
    onPlayAction(next.event, next.playVfx);
    if (actor !== null) lastActorRef.current = actor;
    timerRef.current = window.setTimeout(
      () => drainQueue(),
      newTurn ? TURN_GAP_MS : ATTACK_PROPAGATION_MS,
    );
  }, [onPlayAction]);

  const enqueue = useCallback((entry: EnemyPlaybackEntry): void => {
    queueRef.current.push(entry);
    if (timerRef.current === null && queueRef.current.length > 0) {
      drainQueue();
    }
  }, [drainQueue]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      queueRef.current = [];
      lastActorRef.current = null;
    };
  }, []);

  return { enqueue };
}
