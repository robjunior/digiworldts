/**
 * Utility helpers used by adventure subcomponents.
 * Extracted from Adventure.tsx to keep the orchestrator lean.
 */

export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hr = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (hr > 0) return `${hr}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Progressive meat cost — mirrors backend meatCostForHours(): hour i costs
 * meatPerHour + escalation*(i-1) (sum of the arithmetic progression), so
 * longer expeditions cost more meat per hour.
 */
export function meatCostForHours(hours: number, meatPerHour: number, escalationPerHour: number): number {
  const n = Math.max(1, Math.floor(hours));
  return Math.ceil((n * (2 * meatPerHour + (n - 1) * escalationPerHour)) / 2);
}
