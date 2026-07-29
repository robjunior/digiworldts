import { apiFetch } from './api';

export type TutorialSeenResponse = {
  readonly seenIds: readonly string[];
};

export function getTutorialSeen(): Promise<TutorialSeenResponse> {
  return apiFetch<TutorialSeenResponse>('/api/tutorial/seen');
}

export function markTutorialSeen(tutorialId: string): Promise<TutorialSeenResponse> {
  return apiFetch<TutorialSeenResponse>('/api/tutorial/seen', {
    method: 'POST',
    body: { tutorialId },
  });
}

export function resetTutorialSeen(): Promise<TutorialSeenResponse> {
  return apiFetch<TutorialSeenResponse>('/api/tutorial/seen', {
    method: 'DELETE',
  });
}
