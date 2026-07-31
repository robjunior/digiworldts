import type { DialogueDefinition, DialogueDiagnostic, DialogueParseStats } from '@digiworld/shared';

import { apiFetch } from './api';

export type DialogueSummary = {
  readonly dialogueId: string;
  readonly title: string;
  readonly sourcePath: string | null;
  readonly sourceHash: string;
  readonly startNodeId: string;
  readonly npcIds: readonly string[];
  readonly nodeCount: number;
  readonly importedAt: number;
  readonly updatedAt: number;
};

export type StoredDialogue = DialogueSummary & {
  readonly sourceTwee: string;
  readonly definition: DialogueDefinition;
};

export type DialoguePreview = {
  readonly ok: boolean;
  readonly stats: DialogueParseStats;
  readonly errors: readonly DialogueDiagnostic[];
  readonly warnings: readonly DialogueDiagnostic[];
  readonly npcIds: readonly string[];
  readonly startNodeId: string | null;
  readonly title: string | null;
};

export type SyncOutcome =
  | { readonly file: string; readonly status: 'imported' | 'updated'; readonly dialogueId: string; readonly warnings: readonly DialogueDiagnostic[] }
  | { readonly file: string; readonly status: 'unchanged'; readonly dialogueId: string }
  | { readonly file: string; readonly status: 'failed'; readonly errors: readonly DialogueDiagnostic[] };

export type SyncReport = {
  readonly root: string;
  readonly scanned: number;
  readonly results: readonly SyncOutcome[];
  readonly orphans: readonly string[];
};

export function listDialogues(): Promise<{ readonly dialogues: readonly DialogueSummary[] }> {
  return apiFetch<{ readonly dialogues: readonly DialogueSummary[] }>('/api/dialogues');
}

export function getDialogue(dialogueId: string): Promise<{ readonly dialogue: StoredDialogue }> {
  return apiFetch<{ readonly dialogue: StoredDialogue }>(`/api/dialogues/${encodeURIComponent(dialogueId)}`);
}

export function previewDialogue(input: { readonly source: string; readonly dialogueId?: string }): Promise<DialoguePreview> {
  return apiFetch<DialoguePreview>('/api/admin/dialogues/preview', { method: 'POST', body: input });
}

export function importDialogue(input: { readonly dialogueId: string; readonly source: string }): Promise<{ readonly dialogue: DialogueSummary; readonly warnings: readonly DialogueDiagnostic[] }> {
  return apiFetch<{ readonly dialogue: DialogueSummary; readonly warnings: readonly DialogueDiagnostic[] }>('/api/admin/dialogues/import', { method: 'POST', body: input });
}

export function syncDialogues(): Promise<SyncReport> {
  return apiFetch<SyncReport>('/api/admin/dialogues/sync', { method: 'POST' });
}

export function deleteDialogue(dialogueId: string): Promise<{ readonly ok: true }> {
  return apiFetch<{ readonly ok: true }>(`/api/admin/dialogues/${encodeURIComponent(dialogueId)}`, { method: 'DELETE' });
}

export type DialogueView = {
  readonly dialogueId: string;
  readonly nodeId: string;
  readonly allowedChoiceIds: readonly string[];
  readonly done: boolean;
};

export function startDialogueSession(dialogueId: string): Promise<{ readonly view: DialogueView }> {
  return apiFetch<{ readonly view: DialogueView }>(`/api/dialogues/${encodeURIComponent(dialogueId)}/start`, { method: 'POST' });
}

export function advanceDialogueSession(dialogueId: string, choiceId: string): Promise<{ readonly view: DialogueView }> {
  return apiFetch<{ readonly view: DialogueView }>(`/api/dialogues/${encodeURIComponent(dialogueId)}/advance`, {
    method: 'POST',
    body: { choiceId },
  });
}

export function abandonDialogueSession(): Promise<{ readonly ok: true }> {
  return apiFetch<{ readonly ok: true }>('/api/dialogues/abandon', { method: 'POST' });
}

export function dialogueExportUrl(dialogueId: string): string {
  return `/api/admin/dialogues/${encodeURIComponent(dialogueId)}/export`;
}
