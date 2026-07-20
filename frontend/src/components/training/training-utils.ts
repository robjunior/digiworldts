import type { TrainingStat } from '@digiworld/shared/digimon';

export const MAX_STAT_GAIN_8H: Record<TrainingStat, number> = {
  hp: 200,
  en: 100,
  atk: 50,
  def: 50,
  int: 50,
  spd: 50,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function moodColor(mood: number): string {
  if (mood < 20) return 'var(--battle)';
  if (mood < 40) return 'var(--gold)';
  if (mood < 60) return 'var(--muted)';
  if (mood < 80) return 'var(--el-plant)';
  return '#4c8';
}

export function moodDeltaForMinutes(minutes: number): number {
  if (minutes < 30) return 3;
  if (minutes < 120) return 0;
  if (minutes < 240) return -5;
  return -15;
}

export function computeGainsPreview(durationMin: number, statKinds: readonly TrainingStat[]): Partial<Record<TrainingStat, number>> {
  const hours = Math.min(8, Math.max(0, durationMin / 60));
  const durationScale = hours / 8;
  const statCount = Math.max(1, statKinds.length);
  const result: Partial<Record<TrainingStat, number>> = {};
  for (const stat of statKinds) {
    const max = MAX_STAT_GAIN_8H[stat];
    result[stat] = Math.max(1, Math.round((max * durationScale) / statCount));
  }
  return result;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours} hr${hours > 1 ? 's' : ''}`;
}

export function formatStat(stat: TrainingStat): string {
  return stat.toUpperCase();
}

export function formatCountdown(remainingMs: number): string {
  const safeMs = Math.max(0, remainingMs);
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function previewGainsText(
  gains: Partial<Record<TrainingStat, number>>,
  statKinds: readonly TrainingStat[],
): string {
  const parts: string[] = [];
  for (const stat of statKinds) {
    const v = gains[stat] ?? 0;
    parts.push(`+${v} ${stat.toUpperCase()}`);
  }
  return parts.length === 0 ? '+0' : parts.join(' · ');
}
