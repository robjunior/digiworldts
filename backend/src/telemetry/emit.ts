/**
 * Fire-and-forget telemetry emitter. Every game-loop instrumentation point
 * calls {@link emit} synchronously; this module batches events in memory
 * and flushes to the configured sink asynchronously, so a slow sink never
 * blocks a game action.
 *
 * Behaviour:
 * - `TELEMETRY_ENABLED=false`  → no-op (zero cost, no queue growth).
 * - `TELEMETRY_ENABLED=true`   → enqueue + arm a 5-second flush timer.
 *   The queue also self-flushes at 100 events (max batch size, matches
 *   PostHog's limit) so a burst of activity doesn't wait a full window.
 * - On process shutdown ({@link flushAndShutdown}), one final flush drains
 *   the queue before the process exits.
 *
 * Never throws. Sink failures are warn-logged with the batch size so an
 * operator can see the drop rate; a game action is never allowed to fail
 * because a metrics pipeline had a bad day.
 */
import type { TelemetryEvent } from '@digiworld/shared/telemetry';
import { TELEMETRY_MAX_BATCH_SIZE } from '@digiworld/shared/telemetry';

import { config } from '../config.js';
import { log } from '../util/log.js';

import { getSink } from './sink.js';

const FLUSH_INTERVAL_MS = 5_000;

const queue: TelemetryEvent[] = [];
let timer: NodeJS.Timeout | null = null;
let shuttingDown = false;

export type EmitInput = Omit<TelemetryEvent, 'ts'> & { readonly ts?: number };

export function emit(input: EmitInput): void {
  if (!config.TELEMETRY_ENABLED || shuttingDown) return;
  const ev: TelemetryEvent = {
    event: input.event,
    distinctId: input.distinctId,
    ts: input.ts ?? Date.now(),
    props: input.props,
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
  };
  queue.push(ev);
  if (queue.length >= TELEMETRY_MAX_BATCH_SIZE) {
    void flush();
  } else if (timer === null) {
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, FLUSH_INTERVAL_MS);
    timer.unref?.();
  }
}

async function flush(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    await getSink().write(batch);
  } catch (err) {
    log.warn('telemetry.flush.fail', {
      count: batch.length,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function flushAndShutdown(): Promise<void> {
  shuttingDown = true;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  await flush();
}

export function queueSizeForTests(): number {
  return queue.length;
}
