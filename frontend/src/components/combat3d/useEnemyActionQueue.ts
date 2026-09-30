import { useCallback, useEffect, useRef } from 'react';
import type { BattleView } from '@digiworld/shared/battle';
import { ATTACK_PROPAGATION_MS, EFFECT_TAIL_MS, effectDurationMs, type EnemyPlaybackEntry } from './combat3dConfig';

/**
 * Serializes enemy action playback so impacts land one at a time. Each event
 * waits for ITS OWN visual effect to finish before the next one plays — the gap
 * is the running effect's duration (plus a short tail on a new actor's turn),
 * not a fixed wall-clock pause, so a turn never advances while an effect is
 * still on screen. Same-cast follow-ups (playVfx=false) only need the short
 * attack-propagation gap. `lastActorRef` persists across the whole battle so
 * the player→enemy handoff keeps the same effect-bounded breathing.
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
    // Wait the whole effect out (plus breathing on an actor change), never a
    // fixed gap, so the next event only starts once this effect has finished.
    const delay = effectDurationMs(next.event, next.playVfx) + (newTurn ? EFFECT_TAIL_MS : 0);
    timerRef.current = window.setTimeout(() => drainQueue(), delay);
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
