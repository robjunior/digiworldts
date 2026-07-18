import type { MoodState, Stage, TrainingStat } from '@digiworld/shared/digimon';

import { apiFetch } from './api';

export type TrainingActiveView = {
  readonly sessionId: string;
  readonly monId: string;
  readonly monNickname: string;
  readonly monLevel: number;
  readonly monStage: Stage;
  readonly statKinds: readonly TrainingStat[];
  readonly startedAt: number;
  readonly durationMs: number;
  readonly finishesAt: number;
  readonly progressPct: number;
  readonly readyToCollect: boolean;
  readonly previewGainPerStat: number;
  readonly previewMoodDelta: number;
};

export type TrainingStationView = {
  readonly buildingId: string;
  readonly kind: string;
  readonly buildingType: 'training' | 'training_premium';
  readonly supportedStatCount: number;
  readonly active: TrainingActiveView | null;
};

export type TrainingRosterEntry = {
  readonly monId: string;
  readonly nickname: string;
  readonly level: number;
  readonly stage: Stage;
  readonly mood: number;
  readonly moodState: MoodState;
  readonly portrait: string;
  readonly inParty: boolean;
};

export type TrainingView = {
  readonly stations: readonly TrainingStationView[];
  readonly eligibleMons: readonly TrainingRosterEntry[];
  readonly durationPresetsMin: readonly number[];
  readonly trainableStats: readonly TrainingStat[];
};

export type TrainingAssignBody = {
  readonly monId: string;
  readonly statKinds: readonly TrainingStat[];
  readonly durationMs: number;
};

export type TrainingAssignResult = {
  readonly ok: true;
  readonly view: TrainingView;
};

export type TrainingCollectResult = {
  readonly ok: true;
  readonly view: TrainingView;
  readonly gained: Partial<Record<TrainingStat, number>>;
  readonly moodDelta: number;
  readonly newMood: number;
};

export type TrainingCancelResult = {
  readonly ok: true;
  readonly view: TrainingView;
};

export function getTraining(): Promise<TrainingView> {
  return apiFetch<TrainingView>('/api/training');
}

export function assignTrainingStation(buildingId: string, body: TrainingAssignBody): Promise<TrainingAssignResult> {
  return apiFetch<TrainingAssignResult>(`/api/training/assign/${encodeURIComponent(buildingId)}`, {
    method: 'POST',
    body,
  });
}

export function collectTrainingStation(buildingId: string): Promise<TrainingCollectResult> {
  return apiFetch<TrainingCollectResult>(`/api/training/collect/${encodeURIComponent(buildingId)}`, { method: 'POST' });
}

export function cancelTrainingStation(buildingId: string): Promise<TrainingCancelResult> {
  return apiFetch<TrainingCancelResult>(`/api/training/cancel/${encodeURIComponent(buildingId)}`, { method: 'POST' });
}
