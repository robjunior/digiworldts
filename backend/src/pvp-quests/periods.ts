import type { PvpQuestPeriod } from '@digiworld/shared/pvp-quest';

/**
 * Server-authoritative period windows.
 *
 * Quests are assigned to a *server* window, never the client clock. Each period
 * has a `[startsAt, endsAt)` interval computed from a fixed epoch, so every node
 * in a cluster agrees on "which daily/weekly/monthly board we are in". The
 * window id (`YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM`) doubles as the deterministic
 * seed source for the procedural board, so a window always regenerates the same
 * quests — but re-generation is idempotent (see repo.ts dedup key).
 *
 * Handling offline players: a player's assignments are spawned lazily on first
 * read *for the current window*. Because the window is server-derived, a player
 * who was offline during the rollover simply gets the new window's board on
 * their next login — no cron, no missed-quest bookkeeping. Incomplete progress
 * from the previous window is simply abandoned (new assignments created fresh).
 */

export const PERIOD_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0); // 2026-01-01 UTC

export interface PeriodWindow {
  period: PvpQuestPeriod;
  windowId: string;
  startsAt: number;
  endsAt: number;
}

function utcMidnight(ts: number): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function addDays(ts: number, days: number): number {
  const d = new Date(ts);
  d.setUTCDate(d.getUTCDate() + days);
  return d.getTime();
}

export function dailyWindow(now: number = Date.now()): PeriodWindow {
  const start = utcMidnight(now);
  return {
    period: 'DAILY',
    windowId: new Date(start).toISOString().slice(0, 10),
    startsAt: start,
    endsAt: addDays(start, 1),
  };
}

export function weeklyWindow(now: number = Date.now()): PeriodWindow {
  // ISO week: weeks start Monday. Compute days since the epoch's Monday.
  const start = utcMidnight(now);
  const dow = (new Date(start).getUTCDay() + 6) % 7; // 0 = Monday
  const weekStart = addDays(start, -dow);
  const year = new Date(weekStart).getUTCFullYear();
  // ISO week number
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const weekNumber = Math.ceil((weekStart - utcMidnight(firstThursday.getTime())) / (7 * 864e5)) + 1;
  return {
    period: 'WEEKLY',
    windowId: `${year}-W${String(weekNumber).padStart(2, '0')}`,
    startsAt: weekStart,
    endsAt: addDays(weekStart, 7),
  };
}

export function monthlyWindow(now: number = Date.now()): PeriodWindow {
  const d = new Date(utcMidnight(now));
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return {
    period: 'MONTHLY',
    windowId: new Date(start).toISOString().slice(0, 7),
    startsAt: start,
    endsAt: end,
  };
}

export function windowFor(period: PvpQuestPeriod, now: number = Date.now()): PeriodWindow {
  switch (period) {
    case 'DAILY':
      return dailyWindow(now);
    case 'WEEKLY':
      return weeklyWindow(now);
    case 'MONTHLY':
      return monthlyWindow(now);
  }
}

export function allWindows(now: number = Date.now()): PeriodWindow[] {
  return [dailyWindow(now), weeklyWindow(now), monthlyWindow(now)];
}

/**
 * Deterministic 32-bit seed for a (period, windowId) pair. Same window always
 * seeds the same board across restarts and nodes.
 */
export function windowSeed(period: PvpQuestPeriod, windowId: string): number {
  const str = `${period}:${windowId}`;
  let h = PERIOD_EPOCH_MS >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** True when `ts` falls inside the window. */
export function isWithin(window: PeriodWindow, ts: number): boolean {
  return ts >= window.startsAt && ts < window.endsAt;
}
