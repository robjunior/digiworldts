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
