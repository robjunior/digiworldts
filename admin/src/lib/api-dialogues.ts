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
  readonly status: 'draft' | 'published' | 'archived';
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
  return apiFetch<{ readonly dialogues: readonly DialogueSummary[] }>('/api/dialogues?includeDrafts=1');
}

export function getDialogue(dialogueId: string): Promise<{ readonly dialogue: StoredDialogue }> {
  return apiFetch<{ readonly dialogue: StoredDialogue }>(`/api/dialogues/${encodeURIComponent(dialogueId)}?includeDrafts=1`);
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

export type SimulatorStep = {
  readonly nodeId: string;
  readonly choiceId: string;
};

export type SimulatorFactOverrides = {
  readonly level?: number;
  readonly playerName?: string;
  readonly flags?: readonly string[];
  readonly items?: Readonly<Record<string, number>>;
};

export type SimulatorRequest = {
  readonly overrides?: SimulatorFactOverrides;
  readonly history?: readonly SimulatorStep[];
};

export type SimulatedActionPreview = {
  readonly id: string;
  readonly name: string;
  readonly args: readonly (string | number | boolean)[];
  readonly appliedSuccessfully: boolean;
  readonly note: string | null;
};

export type SimulatedChoicePreview = {
  readonly id: string;
  readonly label: string;
  readonly target: string;
  readonly visible: boolean;
  readonly conditionSummary: string | null;
};

export type SimulatorSpeaker = {
  readonly npcId: string;
  readonly expression: string;
};

export type SimulatorView = {
  readonly nodeId: string;
  readonly speaker: SimulatorSpeaker | null;
  readonly tags: readonly string[];
  readonly text: string;
  readonly actionsAtEntry: readonly SimulatedActionPreview[];
  readonly choices: readonly SimulatedChoicePreview[];
  readonly done: boolean;
  readonly jumpTrail: readonly string[];
  readonly flags: readonly string[];
  readonly items: Readonly<Record<string, number>>;
};

export function simulateDialogue(
  dialogueId: string,
  input: SimulatorRequest,
): Promise<{ readonly view: SimulatorView }> {
  return apiFetch<{ readonly view: SimulatorView }>(
    `/api/admin/dialogues/${encodeURIComponent(dialogueId)}/simulate`,
    { method: 'POST', body: input },
  );
}
