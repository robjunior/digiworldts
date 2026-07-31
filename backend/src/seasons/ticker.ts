/**
 * Seasons ticker — auto-closes seasons whose planned `ends_at` has passed.
 *
 * Runs every 60s. Each tick:
 *   1. Try to acquire the cluster lock `seasons:close` (30s TTL).
 *      - Failed lock ⇒ another node is closing this round; skip.
 *   2. List seasons with `ended_at IS NULL AND ends_at <= now`.
 *   3. For each, call `endSeason(id)` — which is transactional and idempotent
 *      (guards on `ended_at IS NULL`), so a concurrent close from an admin
 *      manually triggering "End now" won't double-snapshot.
 *   4. Release the lock.
 *
 * A single tick can close multiple seasons if several expired between polls.
 * We tolerate `endSeason` returning `already_ended` (race lost cleanly).
 *
 * Multi-node: the cluster lock is the only cross-node coordination — the DB
 * check inside `endSeason`'s tx is the last-line correctness guarantee.
 */
import { getCluster } from '../cluster/index.js';
import { log } from '../util/log.js';
import { endSeason, listSeasonsDueForClose } from './repo.js';

const TICK_INTERVAL_MS = 60_000;
const LOCK_KEY = 'seasons:close';
const LOCK_TTL_SEC = 30;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runOnce(): Promise<void> {
  if (running) return; // guard against overlapping ticks on slow DB
  running = true;
  const cluster = await getCluster();
  const token = await cluster.lock(LOCK_KEY, LOCK_TTL_SEC);
  if (!token) {
    running = false;
    return; // another node is on it
  }
  try {
    const now = Date.now();
    const due = await listSeasonsDueForClose(now);
    if (due.length === 0) return;
    log.info('seasons.ticker.due', { count: due.length, ids: due.map((s) => s.id) });
    for (const season of due) {
      try {
        const result = await endSeason(season.id);
        if (result.ok) {
          log.info('seasons.ticker.closed', { id: season.id, name: season.name, snapshottedUsers: result.value.snapshottedUsers });
        } else if (result.error.kind === 'already_ended') {
          // Race with admin manual-end — expected, silent.
        } else {
          log.warn('seasons.ticker.close_failed', { id: season.id, error: result.error.kind });
        }
      } catch (e) {
        log.error('seasons.ticker.close_threw', { id: season.id, err: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (e) {
    log.error('seasons.ticker.tick_failed', { err: e instanceof Error ? e.message : String(e) });
  } finally {
    await cluster.unlock(LOCK_KEY, token);
    running = false;
  }
}

/**
 * Start the ticker. Runs an immediate first pass (to close seasons whose
 * `ends_at` expired while the server was down), then every 60s.
 * Idempotent: calling twice does not schedule twice.
 */
export function startSeasonsTicker(): void {
  if (timer !== null) return;
  // Fire-and-forget the first pass so server startup isn't blocked by DB work.
  void runOnce();
  timer = setInterval(() => {
    void runOnce();
  }, TICK_INTERVAL_MS);
  log.info('seasons.ticker.started', { intervalMs: TICK_INTERVAL_MS });
}

/**
 * Stop the ticker. Safe to call during graceful shutdown or tests.
 */
export function stopSeasonsTicker(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
    log.info('seasons.ticker.stopped', {});
  }
}
