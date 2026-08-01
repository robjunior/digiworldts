import { apiFetch } from './api';

export type OnboardingMonSummary = {
  readonly catalogId: string;
  readonly name: string;
  readonly stage: string;
  readonly element: string;
  readonly attribute: string;
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
  readonly introDialogueId: string | null;
  readonly updatedAt: number | null;
};

export type OnboardingTeamInput = {
  readonly slug: string;
  readonly name: string;
  readonly description?: string;
  readonly monCatalogIds: readonly [string, string, string];
  readonly sortOrder?: number;
  readonly enabled?: boolean;
};

export type OnboardingConfigInput = {
  readonly introDialogue: string;
  readonly bgImage: string;
  readonly introDialogueId?: string | null;
};

export function getOnboardingConfig(): Promise<{ readonly config: OnboardingConfigView }> {
  return apiFetch<{ readonly config: OnboardingConfigView }>('/api/admin/onboarding/config');
}

export function updateOnboardingConfig(input: OnboardingConfigInput): Promise<{ readonly config: OnboardingConfigView }> {
  return apiFetch<{ readonly config: OnboardingConfigView }>('/api/admin/onboarding/config', {
    method: 'PUT',
    body: input,
  });
}

export function listOnboardingTeamsAdmin(): Promise<{ readonly teams: readonly OnboardingTeamView[] }> {
  return apiFetch<{ readonly teams: readonly OnboardingTeamView[] }>('/api/admin/onboarding/teams');
}

export function createOnboardingTeam(input: OnboardingTeamInput): Promise<{ readonly team: OnboardingTeamView }> {
  return apiFetch<{ readonly team: OnboardingTeamView }>('/api/admin/onboarding/teams', {
    method: 'POST',
    body: input,
  });
}

export function updateOnboardingTeam(id: string, input: OnboardingTeamInput): Promise<{ readonly team: OnboardingTeamView }> {
  return apiFetch<{ readonly team: OnboardingTeamView }>(`/api/admin/onboarding/teams/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input,
  });
}

export function deleteOnboardingTeam(id: string): Promise<{ readonly ok: true; readonly id: string }> {
  return apiFetch<{ readonly ok: true; readonly id: string }>(`/api/admin/onboarding/teams/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
