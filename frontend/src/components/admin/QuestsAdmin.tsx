import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LootItem, LootPool, Quest, QuestStep } from '@digiworld/shared';

import { createAdminQuest, deleteAdminQuest, exportAdminQuest, importAdminQuest, listAdminQuests, updateAdminQuest } from '../../lib/api-quest-admin';
import type { QuestAdminBody } from '../../lib/api-quest-admin';
import { AdminMessage, AdminSection, Field } from './AdminShared';

const QUESTS_QUERY_KEY = ['admin', 'quests'] as const;
const STEPS_TEMPLATE = '[]';
const REWARD_TEMPLATE = '{"items":[],"pickCount":0,"guaranteedCredits":0}';

type EditorState = {
  readonly mode: 'create' | 'edit';
  readonly questId?: string;
  readonly name: string;
  readonly description: string;
  readonly requiredLevel: number;
  readonly introDialogueId: string;
  readonly steps: string;
  readonly finalReward: string;
  readonly unlocksQuestIds: string;
};

export function QuestsAdmin(): JSX.Element {
  const queryClient = useQueryClient();
  const questsQuery = useQuery({ queryKey: QUESTS_QUERY_KEY, queryFn: listAdminQuests });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshQuests = (): void => {
    void queryClient.invalidateQueries({ queryKey: QUESTS_QUERY_KEY });
  };

  const saveQuest = useMutation({
    mutationFn: (state: EditorState) => saveEditorState(state),
    onSuccess: () => {
      refreshQuests();
      setEditor(null);
      setError(null);
      setMessage('Quest saved.');
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const deleteQuest = useMutation({
    mutationFn: deleteAdminQuest,
    onSuccess: () => {
      refreshQuests();
      setMessage('Quest deleted.');
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const importQuest = useMutation({
    mutationFn: (text: string) => importAdminQuest(parseQuestImport(text)),
    onSuccess: () => {
      refreshQuests();
      setImportOpen(false);
      setImportText('');
      setError(null);
      setMessage('Quest imported.');
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const quests = questsQuery.data?.quests ?? [];

  return (
    <div className="admin-quests-layout">
      {message ? <AdminMessage tone="success">{message}</AdminMessage> : null}
      {error ? <AdminMessage tone="error">{error}</AdminMessage> : null}
      <AdminSection
        title="Quests"
        lede="Create, import, export, and tune quest definitions before the player-facing quest layer ships."
        actions={(
          <>
            <button type="button" onClick={() => { setEditor(blankEditor()); setError(null); }}>New Quest</button>
            <button type="button" onClick={() => setImportOpen((open) => !open)}>Import Quest</button>
          </>
        )}
      >
        {importOpen ? (
          <form className="admin-quest-editor" onSubmit={(event) => { event.preventDefault(); importQuest.mutate(importText); }}>
            <Field label="Quest import JSON">
              <textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={10} spellCheck={false} />
            </Field>
            <div className="admin-quest-actions">
              <button type="submit" disabled={importQuest.isPending}>Import</button>
              <button type="button" onClick={() => setImportOpen(false)}>Cancel</button>
            </div>
          </form>
        ) : null}
        {editor ? <QuestEditor state={editor} saving={saveQuest.isPending} onChange={setEditor} onCancel={() => setEditor(null)} onSubmit={(state) => saveQuest.mutate(state)} /> : null}
        <div className="admin-scroll">
          <table className="admin-table admin-quests-table">
            <thead>
              <tr><th>Name</th><th>Req. level</th><th>Steps</th><th>Unlocks</th><th>Updated</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {quests.length === 0 ? <tr><td colSpan={6}><span className="muted">No quests yet. Use New Quest to create one.</span></td></tr> : null}
              {quests.map((quest) => (
                <tr key={quest.id}>
                  <td><button type="button" className="admin-link-button" onClick={() => setEditor(editorFromQuest(quest))}>{quest.name}<span>{quest.description || 'No description'}</span></button></td>
                  <td>{quest.requiredLevel}</td>
                  <td>{quest.steps.length}</td>
                  <td>{quest.unlocksQuestIds.length}</td>
                  <td>{new Date(quest.updatedAt).toLocaleString()}</td>
                  <td><QuestActions quest={quest} onEdit={() => setEditor(editorFromQuest(quest))} onDelete={() => { if (window.confirm(`Delete ${quest.name}?`)) deleteQuest.mutate(quest.id); }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminSection>
    </div>
  );
}

function QuestEditor({ state, saving, onChange, onCancel, onSubmit }: { readonly state: EditorState; readonly saving: boolean; readonly onChange: (state: EditorState) => void; readonly onCancel: () => void; readonly onSubmit: (state: EditorState) => void }): JSX.Element {
  const setField = <K extends keyof EditorState>(key: K, value: EditorState[K]): void => onChange({ ...state, [key]: value });
  return (
    <form className="admin-quest-editor" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onSubmit(state); }}>
      <div className="form-grid">
        <Field label="Name"><input value={state.name} onChange={(event) => setField('name', event.target.value)} required /></Field>
        <Field label="Required level"><input type="number" min={1} value={state.requiredLevel} onChange={(event) => setField('requiredLevel', Number.parseInt(event.target.value, 10) || 1)} /></Field>
        <Field label="Unlocks quest IDs (CSV)"><input value={state.unlocksQuestIds} onChange={(event) => setField('unlocksQuestIds', event.target.value)} /></Field>
      </div>
      <Field label="Description"><textarea value={state.description} onChange={(event) => setField('description', event.target.value)} rows={3} /></Field>
      <Field label="Intro dialogue ID"><input className="input" value={state.introDialogueId} onChange={(event) => setField('introDialogueId', event.target.value)} placeholder="leave empty for none" spellCheck={false} /></Field>
      <Field label="Steps JSON"><textarea value={state.steps} onChange={(event) => setField('steps', event.target.value)} rows={8} spellCheck={false} /></Field>
      <Field label="Final reward JSON"><textarea value={state.finalReward} onChange={(event) => setField('finalReward', event.target.value)} rows={5} spellCheck={false} /></Field>
      <div className="admin-quest-actions">
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function QuestActions({ quest, onEdit, onDelete }: { readonly quest: Quest; readonly onEdit: () => void; readonly onDelete: () => void }): JSX.Element {
  return <div className="admin-actions-cell"><button type="button" onClick={onEdit}>Edit</button><button type="button" onClick={() => void downloadQuest(quest)}>Export</button><button type="button" onClick={onDelete}>Delete</button></div>;
}

async function downloadQuest(quest: Quest): Promise<void> {
  const exported = await exportAdminQuest(quest.id);
  const blob = new Blob([`${JSON.stringify(exported, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${quest.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'quest'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function saveEditorState(state: EditorState): Promise<{ readonly quest: Quest }> {
  const body = bodyFromEditor(state);
  if (state.mode === 'edit' && state.questId) return updateAdminQuest(state.questId, body);
  return createAdminQuest(body);
}

function bodyFromEditor(state: EditorState): QuestAdminBody {
  const body = {
    name: state.name.trim(),
    description: state.description,
    requiredLevel: state.requiredLevel,
    introDialogueId: state.introDialogueId.trim() === '' ? null : state.introDialogueId.trim(),
    steps: parseQuestSteps(state.steps),
    finalReward: parseLootPool(state.finalReward),
    unlocksQuestIds: state.unlocksQuestIds.split(',').map((id) => id.trim()).filter(Boolean),
  } satisfies QuestAdminBody;
  return body;
}

function blankEditor(): EditorState {
  return { mode: 'create', name: '', description: '', requiredLevel: 1, introDialogueId: '', steps: STEPS_TEMPLATE, finalReward: REWARD_TEMPLATE, unlocksQuestIds: '' };
}

function editorFromQuest(quest: Quest): EditorState {
  return { mode: 'edit', questId: quest.id, name: quest.name, description: quest.description, requiredLevel: quest.requiredLevel, introDialogueId: quest.introDialogueId ?? '', steps: stringify(quest.steps), finalReward: stringify(quest.finalReward), unlocksQuestIds: quest.unlocksQuestIds.join(', ') };
}

function parseQuestImport(text: string): Quest | QuestAdminBody {
  const parsed = parseJson(text, 'Import JSON');
  if (isQuest(parsed)) return parsed;
  if (isQuestBody(parsed)) return parsed;
  throw new Error('Import JSON must be a quest export or quest body.');
}

function parseQuestSteps(text: string): readonly QuestStep[] {
  const parsed = parseJson(text, 'Steps');
  if (!isQuestSteps(parsed)) throw new Error('Steps JSON must be a valid quest step array.');
  return parsed;
}

function parseLootPool(text: string): LootPool {
  const parsed = parseJson(text, 'Final reward');
  if (!isLootPool(parsed)) throw new Error('Final reward JSON is not a valid loot pool.');
  return parsed;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} JSON is invalid: ${error.message}`);
    throw error;
  }
}

function isQuest(value: unknown): value is Quest { return isQuestBody(value) && hasNumber(value, 'createdAt') && hasNumber(value, 'updatedAt') && hasString(value, 'id'); }
function isQuestBody(value: unknown): value is QuestAdminBody { return isRecord(value) && hasString(value, 'name') && hasString(value, 'description') && hasNumber(value, 'requiredLevel') && (value.introDialogueId === null || typeof value.introDialogueId === 'string') && Array.isArray(value.steps) && isLootPool(value.finalReward) && Array.isArray(value.unlocksQuestIds); }
function isQuestSteps(value: unknown): value is readonly QuestStep[] { return Array.isArray(value) && value.every(isQuestStep); }
function isQuestStep(value: unknown): value is QuestStep {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'dialogue':
      return typeof value.dialogueId === 'string';
    case 'battle':
      return Array.isArray(value.enemies);
    case 'boss':
      return Array.isArray(value.enemies) && hasString(value, 'bossName') && hasString(value, 'flavor');
    case 'loot':
      return isLootPool(value.pool);
    default:
      return false;
  }
}
function isLootPool(value: unknown): value is LootPool { return isRecord(value) && Array.isArray(value.items) && value.items.every(isLootItem) && hasNumber(value, 'pickCount'); }
function isLootItem(value: unknown): value is LootItem { return isRecord(value) && hasString(value, 'itemId') && hasNumber(value, 'weight') && hasNumber(value, 'minQty') && hasNumber(value, 'maxQty'); }
function hasString(value: unknown, key: string): value is Readonly<Record<string, string>> { return isRecord(value) && typeof value[key] === 'string'; }
function hasNumber(value: unknown, key: string): value is Readonly<Record<string, number>> { return isRecord(value) && typeof value[key] === 'number'; }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null; }
function stringify(value: unknown): string { return JSON.stringify(value, null, 2); }
