import type { Attribute, Element, Stage } from '@digiworld/shared/digimon';

import { apiFetch } from './api';

// PHASE 7 CANDIDATE: promote onboarding HTTP response types to shared.
export type OnboardingMonSummary = {
  readonly catalogId: string;
  readonly name: string;
  readonly stage: Stage;
  readonly element: Element;
  readonly attribute: Attribute;
  readonly portrait: string;
  readonly dot: string;
};

export type OnboardingTeamView = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly sortOrder: number;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly mons: readonly OnboardingMonSummary[];
  readonly missingCatalogIds: readonly string[];
};

export type OnboardingConfigView = {
  readonly introDialogue: string;
  readonly bgImage: string;
  readonly updatedAt: number | null;
};

export type OnboardingSnapshotResponse = {
  readonly completed: false;
  readonly config: OnboardingConfigView;
  readonly teams: readonly OnboardingTeamView[];
};

export type OnboardingCompletedResponse = {
  readonly completed: true;
  readonly config: OnboardingConfigView;
  readonly teams: readonly [];
};

export type OnboardingStateResponse = OnboardingSnapshotResponse | OnboardingCompletedResponse;

export type OnboardingCompletionResponse = {
  readonly teamSlug: string;
  readonly monIds: readonly string[];
  readonly spawnedAt: number;
};

export function getOnboardingState(): Promise<OnboardingStateResponse> {
  return apiFetch<OnboardingStateResponse>('/api/onboarding');
}

export function selectOnboardingTeam(teamId: string): Promise<OnboardingCompletionResponse> {
  return apiFetch<OnboardingCompletionResponse>('/api/onboarding/select', {
    method: 'POST',
    body: { teamId },
  });
}
