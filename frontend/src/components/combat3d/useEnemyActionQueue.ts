import { useCallback, useEffect, useRef } from 'react';
import type { BattleView } from '@digiworld/shared/battle';
import { effectDurationMs, TURN_ADVANCE_DELAY_MS, type EnemyPlaybackEntry } from './combat3dConfig';

/**
 * Serializes enemy action playback so impacts land one at a time.
 *
 * The gap between two events is measured from the moment the previous hit
 * LANDS, not from the end of its particle effect: `onPlayAction` receives an
 * `onImpact` callback that the scene fires at the runner's real hit frame
 * (0.2s for `tornado`, ~1s for `stone-fall`, 2.3s for `vine-lash`), and the
 * queue only advances `TURN_ADVANCE_DELAY_MS` after that. A long trailing
 * effect therefore never holds the battle back.
 *
 * `settledRef` records the impact of the cast currently on screen: an event
 * that emits several lines (damage + status) reports its impact once, and the
 * rest of the cast's events drain off that single hit.
 *
 * Safety: if the cast never reports an impact (no visual, missing target
 * sprite), a bounded fallback timer — the effect's duration, or the propagation
 * gap when nothing plays — drains the queue so the battle can never stall.
 */
export function useEnemyActionQueue(
  onPlayAction: (
    event: BattleView['log'][number],
    playVfx: boolean,
    onImpact: () => void,
  ) => void,
): { enqueue: (entry: EnemyPlaybackEntry) => void } {
  const queueRef = useRef<EnemyPlaybackEntry[]>([]);
  const timerRef = useRef<number | null>(null);
  const settledRef = useRef(false);

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const drainQueue = useCallback((): void => {
    clearTimer();
    const next = queueRef.current.shift();
    if (next === undefined) return;

    settledRef.current = false;
    // Advance on the hit. `clearTimer` makes a cast that reports its impact
    // cancel the fallback bound, so the two never race.
    const onImpact = (): void => {
      if (settledRef.current) return;
      settledRef.current = true;
      clearTimer();
      timerRef.current = window.setTimeout(() => drainQueue(), TURN_ADVANCE_DELAY_MS);
    };
    onPlayAction(next.event, next.playVfx, onImpact);

    if (!settledRef.current) {
      // No impact yet: arm the safety bound (an immediate impact already
      // replaced it with the post-hit delay above).
      const bound = effectDurationMs(next.event, next.playVfx) + TURN_ADVANCE_DELAY_MS;
      timerRef.current = window.setTimeout(() => {
        settledRef.current = true;
        drainQueue();
      }, bound);
    }
  }, [onPlayAction]);

  const enqueue = useCallback((entry: EnemyPlaybackEntry): void => {
    queueRef.current.push(entry);
    if (timerRef.current === null && queueRef.current.length > 0) {
      drainQueue();
    }
  }, [drainQueue]);

  useEffect(() => {
    return () => {
      clearTimer();
      queueRef.current = [];
    };
  }, []);

  return { enqueue };
}
