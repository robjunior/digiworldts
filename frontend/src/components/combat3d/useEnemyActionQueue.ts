import { useCallback, useEffect, useRef } from 'react';
import type { BattleView } from '@digiworld/shared/battle';
import { ATTACK_PROPAGATION_MS, type EnemyPlaybackEntry } from './combat3dConfig';

/**
 * Serializes enemy action playback so impacts land one at a time, spaced by
 * `ATTACK_PROPAGATION_MS`. Each queued entry carries its own `playVfx`
 * decision (set by the caller when classifying the event) so a multi-event
 * cast only fires a single effect.
 */
export function useEnemyActionQueue(
  onPlayAction: (event: BattleView['log'][number], playVfx: boolean) => void,
): { enqueue: (entry: EnemyPlaybackEntry) => void } {
  const queueRef = useRef<EnemyPlaybackEntry[]>([]);
  const timerRef = useRef<number | null>(null);

  const drainQueue = useCallback((): void => {
    const next = queueRef.current.shift();
    if (next === undefined) {
      timerRef.current = null;
      return;
    }
    onPlayAction(next.event, next.playVfx);
    timerRef.current = window.setTimeout(() => drainQueue(), ATTACK_PROPAGATION_MS);
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
    };
  }, []);

  return { enqueue };
}
