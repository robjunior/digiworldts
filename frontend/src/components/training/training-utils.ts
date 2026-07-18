import type { Stage, TrainingStat } from '@digiworld/shared/digimon';

const STAGE_MULT: Record<Stage, number> = {
  Baby: 0.5,
  'In-Training': 0.7,
  Rookie: 1,
  Champion: 1.5,
  Ultimate: 2,
  Mega: 3,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function moodColor(mood: number): string {
  if (mood < 20) return 'var(--battle)';
  if (mood < 40) return 'var(--gold)';
  if (mood < 60) return 'var(--muted)';
  if (mood < 80) return 'var(--el-nature)';
  return '#4c8';
}

export function moodDeltaForMinutes(minutes: number): number {
  if (minutes < 30) return 3;
  if (minutes < 120) return 0;
  if (minutes < 240) return -5;
  return -15;
}

export function previewGain(stage: Stage, durationMin: number, statCount: number): number {
  return Math.max(1, Math.round(4 * (durationMin / 60) * STAGE_MULT[stage] / statCount));
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
