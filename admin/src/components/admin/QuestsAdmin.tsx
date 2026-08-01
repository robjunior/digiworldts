import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BIOMES, ELEMENTS, STAGES } from '@digiworld/shared';
import type { Biome, Element, Stage, LootItem, LootPool, Quest, QuestStep, QuestObjective } from '@digiworld/shared';

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
  readonly giver: string;
  readonly rewardText: string;
  readonly lockHint: string;
  readonly requiredFlags: readonly string[];
  readonly completesFlag: string;
  readonly objectives: readonly QuestObjective[];
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
      
      <Field label="Giver"><input value={state.giver} onChange={(event) => setField('giver', event.target.value)} placeholder="NPC Display Name (optional)" /></Field>
      <Field label="Reward text"><input value={state.rewardText} onChange={(event) => setField('rewardText', event.target.value)} placeholder="Override reward text summary (optional)" /></Field>
      <Field label="Lock hint"><input value={state.lockHint} onChange={(event) => setField('lockHint', event.target.value)} placeholder="Hover tooltip for locked quest (optional)" /></Field>
      <Field label="Required flags">
        <FlagListEditor flags={state.requiredFlags} onChange={(flags) => setField('requiredFlags', flags)} />
      </Field>
      <Field label="Completes flag"><input value={state.completesFlag} onChange={(event) => setField('completesFlag', event.target.value)} placeholder="Flag to set on completion (optional)" /></Field>
      <Field label="Objectives">
        <ObjectivesEditor objectives={state.objectives} onChange={(objs) => setField('objectives', objs)} />
      </Field>

      <div className="admin-quest-actions">
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ObjectivesEditor({ objectives, onChange }: { readonly objectives: readonly QuestObjective[]; readonly onChange: (objs: readonly QuestObjective[]) => void }): JSX.Element {
  const replaceAt = <T,>(arr: readonly T[], index: number, value: T): readonly T[] => [...arr.slice(0, index), value, ...arr.slice(index + 1)];
  const removeAt = <T,>(arr: readonly T[], index: number): readonly T[] => [...arr.slice(0, index), ...arr.slice(index + 1)];

  return (
    <div className="admin-quest-objectives-panel">
      {objectives.map((obj, i) => (
        <div key={i} className="admin-quest-objective-row">
          <div className="admin-quest-objective-header">
            <span className="admin-quest-objective-kind-chip">{obj.kind}</span>
            <button type="button" onClick={() => onChange(removeAt(objectives, i))}>Remove</button>
          </div>
          <div className="admin-quest-objective-body">
            {obj.kind === 'travel' ? (
              <>
                <label>Biome: <select value={obj.biome} onChange={e => onChange(replaceAt(objectives, i, { ...obj, biome: e.target.value as Biome }))}>{BIOMES.map(b => <option key={b} value={b}>{b}</option>)}</select></label>
                <label>Text: <input value={obj.text} onChange={e => onChange(replaceAt(objectives, i, { ...obj, text: e.target.value }))} /></label>
              </>
            ) : obj.kind === 'defeat' ? (
              <>
                <label>Biome: <select value={obj.biome} onChange={e => onChange(replaceAt(objectives, i, { ...obj, biome: e.target.value as Biome }))}>{BIOMES.map(b => <option key={b} value={b}>{b}</option>)}</select></label>
                <label>Element: <select value={obj.element ?? ''} onChange={e => {
                  const { element: _, ...rest } = obj;
                  onChange(replaceAt(objectives, i, (e.target.value === '' ? rest : { ...rest, element: e.target.value }) as QuestObjective));
                }}><option value="">Any</option>{ELEMENTS.map(e => <option key={e} value={e}>{e}</option>)}</select></label>
                <label>Count: <input type="number" min={1} max={999} value={obj.count} onChange={e => onChange(replaceAt(objectives, i, { ...obj, count: Number.parseInt(e.target.value, 10) || 1 }))} /></label>
                <label>Text: <input value={obj.text} onChange={e => onChange(replaceAt(objectives, i, { ...obj, text: e.target.value }))} /></label>
              </>
            ) : obj.kind === 'talk' ? (
              <>
                <label>NPC ID: <input maxLength={80} value={obj.npcId} onChange={e => onChange(replaceAt(objectives, i, { ...obj, npcId: e.target.value }))} /></label>
                <label>Text: <input value={obj.text} onChange={e => onChange(replaceAt(objectives, i, { ...obj, text: e.target.value }))} /></label>
              </>
            ) : obj.kind === 'collect' ? (
              <>
                <label>Item ID: <input maxLength={80} value={obj.itemId} onChange={e => onChange(replaceAt(objectives, i, { ...obj, itemId: e.target.value }))} /></label>
                <label>Qty: <input type="number" min={1} max={999} value={obj.qty} onChange={e => onChange(replaceAt(objectives, i, { ...obj, qty: Number.parseInt(e.target.value, 10) || 1 }))} /></label>
                <label>Text: <input value={obj.text} onChange={e => onChange(replaceAt(objectives, i, { ...obj, text: e.target.value }))} /></label>
              </>
            ) : obj.kind === 'capture' ? (
              <>
                <label>Catalog ID: <input value={obj.catalogId ?? ''} onChange={e => {
                  const { catalogId: _, ...rest } = obj;
                  onChange(replaceAt(objectives, i, (e.target.value === '' ? rest : { ...rest, catalogId: e.target.value }) as QuestObjective));
                }} placeholder="Any" /></label>
                <label>Stage: <select value={obj.stage ?? ''} onChange={e => {
                  const { stage: _, ...rest } = obj;
                  onChange(replaceAt(objectives, i, (e.target.value === '' ? rest : { ...rest, stage: e.target.value }) as QuestObjective));
                }}><option value="">Any</option>{STAGES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
                <label>Count: <input type="number" min={1} max={999} value={obj.count} onChange={e => onChange(replaceAt(objectives, i, { ...obj, count: Number.parseInt(e.target.value, 10) || 1 }))} /></label>
                <label>Text: <input value={obj.text} onChange={e => onChange(replaceAt(objectives, i, { ...obj, text: e.target.value }))} /></label>
              </>
            ) : null}
          </div>
        </div>
      ))}
      <div className="admin-quest-objective-actions">
        <select onChange={(e) => {
          const val = e.target.value;
          e.target.value = ''; // reset selection
          if (!val) return;
          const defaultText = 'New objective';
          let newObj: QuestObjective;
          if (val === 'travel') newObj = { kind: 'travel', biome: BIOMES[0]!, text: defaultText };
          else if (val === 'defeat') newObj = { kind: 'defeat', biome: BIOMES[0]!, count: 1, text: defaultText };
          else if (val === 'talk') newObj = { kind: 'talk', npcId: '', text: defaultText };
          else if (val === 'collect') newObj = { kind: 'collect', itemId: '', qty: 1, text: defaultText };
          else if (val === 'capture') newObj = { kind: 'capture', count: 1, text: defaultText };
          else return;
          onChange([...objectives, newObj]);
        }}>
          <option value="">+ Add objective...</option>
          <option value="travel">Travel</option>
          <option value="defeat">Defeat</option>
          <option value="talk">Talk</option>
          <option value="collect">Collect</option>
          <option value="capture">Capture</option>
        </select>
      </div>
    </div>
  );
}

function FlagListEditor({ flags, onChange }: { readonly flags: readonly string[]; readonly onChange: (flags: readonly string[]) => void }): JSX.Element {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (trimmed.length > 120) {
      setError('Flag name too long (max 120 chars)');
      return;
    }
    if (flags.includes(trimmed)) {
      setError('Flag already added');
      return;
    }
    if (flags.length >= 20) {
      setError('Max 20 flags allowed');
      return;
    }
    onChange([...flags, trimmed]);
    setInput('');
    setError(null);
  };

  return (
    <div className="admin-quest-flags-panel">
      {flags.length > 0 ? (
        <div className="admin-quest-flag-chips">
          {flags.map(f => (
            <span key={f} className="admin-quest-flag-chip">
              {f} <button type="button" aria-label={`Remove flag ${f}`} onClick={() => onChange(flags.filter(x => x !== f))}>×</button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="admin-quest-flag-input-row">
        <input 
          value={input} 
          onChange={e => setInput(e.target.value)} 
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="New flag name"
        />
        <button type="button" onClick={add}>Add Flag</button>
      </div>
      {error ? <AdminMessage tone="error">{error}</AdminMessage> : null}
    </div>
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
    ...(state.objectives.length > 0 ? { objectives: state.objectives } : {}),
    ...(state.requiredFlags.length > 0 ? { requiredFlags: state.requiredFlags } : {}),
    ...(state.completesFlag.trim() !== '' ? { completesFlag: state.completesFlag.trim() } : {}),
    ...(state.giver.trim() !== '' ? { giver: state.giver.trim() } : {}),
    ...(state.rewardText.trim() !== '' ? { rewardText: state.rewardText.trim() } : {}),
    ...(state.lockHint.trim() !== '' ? { lockHint: state.lockHint.trim() } : {}),
  } satisfies QuestAdminBody;
  return body;
}

function blankEditor(): EditorState {
  return { 
    mode: 'create', 
    name: '', 
    description: '', 
    requiredLevel: 1, 
    introDialogueId: '', 
    steps: STEPS_TEMPLATE, 
    finalReward: REWARD_TEMPLATE, 
    unlocksQuestIds: '',
    giver: '',
    rewardText: '',
    lockHint: '',
    requiredFlags: [],
    completesFlag: '',
    objectives: [],
  };
}

function editorFromQuest(quest: Quest): EditorState {
  return { 
    mode: 'edit', 
    questId: quest.id, 
    name: quest.name, 
    description: quest.description, 
    requiredLevel: quest.requiredLevel, 
    introDialogueId: quest.introDialogueId ?? '', 
    steps: stringify(quest.steps), 
    finalReward: stringify(quest.finalReward), 
    unlocksQuestIds: quest.unlocksQuestIds.join(', '),
    giver: quest.giver ?? '',
    rewardText: quest.rewardText ?? '',
    lockHint: quest.lockHint ?? '',
    requiredFlags: quest.requiredFlags ?? [],
    completesFlag: quest.completesFlag ?? '',
    objectives: quest.objectives ?? [],
  };
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
