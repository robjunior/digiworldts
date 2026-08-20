import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useState } from 'react';

import type { Npc } from '@digiworld/shared/npc';
import { NPC_ID_PATTERN, NPC_EXPRESSION_PATTERN } from '@digiworld/shared/npc';

import {
  createNpc,
  deleteNpc,
  deleteNpcPortrait,
  listNpcs,
  npcPortraitUrl,
  updateNpc,
  uploadNpcPortrait,
  publishNpc,
  getNpcHistory,
  type NpcInput,
  type NpcUpdate,
  type NpcHistoryEntry,
} from '../../lib/api-npcs';
import { AdminMessage, AdminSection, ErrorText, Field, StatTile, StatusBadge, HistoryModal, type ContentStatus, type HistoryEntry } from './AdminShared';

const NPCS_KEY = ['admin', 'npcs'] as const;

type ExpressionDraft = { readonly key: string; readonly label: string };

type NpcDraft = {
  readonly id: string;
  readonly displayName: string;
  readonly expressions: readonly ExpressionDraft[];
};

const EMPTY_DRAFT: NpcDraft = {
  id: '',
  displayName: '',
  expressions: [{ key: 'neutral', label: '' }],
};

function draftFromNpc(npc: Npc): NpcDraft {
  return {
    id: npc.id,
    displayName: npc.displayName,
    expressions: npc.expressions.map((e) => ({ key: e.key, label: e.label ?? '' })),
  };
}

function draftIssues(draft: NpcDraft, isNew: boolean): readonly string[] {
  const issues: string[] = [];
  if (isNew && !NPC_ID_PATTERN.test(draft.id)) {
    issues.push('id must be lowercase kebab/snake (a-z, 0-9, _, -), starting with a letter');
  }
  if (draft.displayName.trim().length === 0) issues.push('displayName is required');
  if (draft.expressions.length === 0) issues.push('at least one expression is required');
  const seen = new Set<string>();
  for (const expr of draft.expressions) {
    if (!NPC_EXPRESSION_PATTERN.test(expr.key)) {
      issues.push(`expression "${expr.key}" is not a valid key (lowercase kebab/snake)`);
    }
    if (seen.has(expr.key)) issues.push(`duplicate expression "${expr.key}"`);
    seen.add(expr.key);
  }
  return issues;
}

function draftToInput(draft: NpcDraft): NpcInput {
  return {
    id: draft.id.trim(),
    displayName: draft.displayName.trim(),
    expressions: draft.expressions.map((e) => {
      const label = e.label.trim();
      return label.length > 0 ? { key: e.key, label } : { key: e.key };
    }),
  };
}

function ExpressionRow({
  entry,
  onChange,
  onRemove,
  canRemove,
}: {
  readonly entry: ExpressionDraft;
  readonly onChange: (next: ExpressionDraft) => void;
  readonly onRemove: () => void;
  readonly canRemove: boolean;
}): JSX.Element {
  return (
    <div className="npc-expression-row">
      <input
        type="text"
        placeholder="key (e.g. neutral)"
        value={entry.key}
        onChange={(e) => onChange({ ...entry, key: e.target.value })}
      />
      <input
        type="text"
        placeholder="label (optional)"
        value={entry.label}
        onChange={(e) => onChange({ ...entry, label: e.target.value })}
      />
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        disabled={!canRemove}
        onClick={onRemove}
        title={canRemove ? 'Remove expression' : 'At least one expression is required'}
      >
        Remove
      </button>
    </div>
  );
}

function PortraitCell({
  npcId,
  expression,
  hasPortrait,
  onChanged,
}: {
  readonly npcId: string;
  readonly expression: string;
  readonly hasPortrait: boolean;
  readonly onChanged: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await uploadNpcPortrait(npcId, expression, file);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await deleteNpcPortrait(npcId, expression);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="npc-portrait-cell">
      {hasPortrait ? (
        <img
          src={`${npcPortraitUrl(npcId, expression)}?t=${Date.now()}`}
          alt={`${expression} portrait`}
          width={48}
          height={48}
          style={{ objectFit: 'cover', borderRadius: 6, background: '#2a2d35' }}
        />
      ) : (
        <div className="npc-portrait-empty" style={{ width: 48, height: 48, borderRadius: 6, background: '#2a2d35', display: 'grid', placeItems: 'center', fontSize: 11, opacity: 0.5 }}>
          none
        </div>
      )}
      <label className="btn btn--secondary btn--sm" style={{ cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? '…' : hasPortrait ? 'Replace' : 'Upload'}
        <input
          type="file"
          accept="image/png"
          hidden
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
      </label>
      {hasPortrait ? (
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={busy}
          onClick={() => void remove()}
        >
          Delete
        </button>
      ) : null}
      {error ? <div className="admin-message is-error" style={{ fontSize: 11 }}>{error}</div> : null}
    </div>
  );
}

function NpcDialog({
  npc,
  onClose,
  onSaved,
}: {
  readonly npc: Npc | null;
  readonly onClose: () => void;
  readonly onSaved: (npc: Npc) => void;
}): JSX.Element {
  const isNew = npc === null;
  const [draft, setDraft] = useState<NpcDraft>(() => (npc === null ? EMPTY_DRAFT : draftFromNpc(npc)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    const issues = draftIssues(draft, isNew);
    if (issues.length > 0) {
      setError(issues.join('; '));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isNew) {
        const { npc: created } = await createNpc(draftToInput(draft));
        onSaved(created);
      } else {
        const update: NpcUpdate = {
          displayName: draft.displayName.trim(),
          expressions: draftToInput(draft).expressions,
        };
        const { npc: updated } = await updateNpc(draft.id, update);
        onSaved(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
      setBusy(false);
    }
  };

  const addExpression = (): void => {
    setDraft((prev) => ({
      ...prev,
      expressions: [...prev.expressions, { key: `expression_${prev.expressions.length}`, label: '' }],
    }));
  };

  const updateExpression = (index: number, next: ExpressionDraft): void => {
    setDraft((prev) => ({
      ...prev,
      expressions: prev.expressions.map((e, i) => (i === index ? next : e)),
    }));
  };

  const removeExpression = (index: number): void => {
    setDraft((prev) => ({
      ...prev,
      expressions: prev.expressions.filter((_, i) => i !== index),
    }));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal npc-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isNew ? 'New NPC' : `Edit "${npc.id}"`}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {isNew ? (
            <Field label="ID">
              <input
                type="text"
                placeholder="elder"
                value={draft.id}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              />
            </Field>
          ) : null}
          <Field label="Display name">
            <input
              type="text"
              placeholder="Elder of the Forest"
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
            />
          </Field>
          <div className="admin-section-head" style={{ marginTop: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Expressions</h3>
              <p className="lede">Each expression maps to a portrait file. Add "concerned", "happy", etc.</p>
            </div>
            <button type="button" className="btn btn--secondary btn--sm" onClick={addExpression}>+ Add</button>
          </div>
          <div className="npc-expression-list">
            {draft.expressions.map((expr, index) => (
              <div key={index} className="npc-expression-block">
                <ExpressionRow
                  entry={expr}
                  onChange={(next) => updateExpression(index, next)}
                  onRemove={() => removeExpression(index)}
                  canRemove={draft.expressions.length > 1}
                />
                {!isNew && npc !== null && npc.expressions.some((e) => e.key === expr.key) ? (
                  <PortraitCell
                    npcId={npc.id}
                    expression={expr.key}
                    hasPortrait={npc.expressions.find((e) => e.key === expr.key)?.hasPortrait ?? false}
                    onChanged={() => window.setTimeout(() => window.location.reload(), 250)}
                  />
                ) : (
                  <div className="admin-message is-muted" style={{ fontSize: 11 }}>Save the NPC first, then upload portraits.</div>
                )}
              </div>
            ))}
          </div>
          {error ? <AdminMessage tone="error">{error}</AdminMessage> : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : isNew ? 'Create NPC' : 'Save changes'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function NpcsAdmin(): JSX.Element {
  const queryClient = useQueryClient();
  const [dialogNpc, setDialogNpc] = useState<Npc | null | undefined>(undefined);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState<Npc | null>(null);
  const [historyData, setHistoryData] = useState<readonly NpcHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const npcsQuery = useQuery({ queryKey: NPCS_KEY, queryFn: listNpcs });
  const npcs = npcsQuery.data?.npcs ?? [];

  const invalidate = (): void => { void queryClient.invalidateQueries({ queryKey: NPCS_KEY }); };

  const deleteMutation = useMutation({
    mutationFn: deleteNpc,
    onSuccess: () => { setConfirmDeleteId(null); invalidate(); },
  });

  const publishNpcMutation = useMutation({
    mutationFn: publishNpc,
    onSuccess: () => {
      invalidate();
      setMessage('NPC published.');
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const loadHistory = async (npc: Npc): Promise<void> => {
    setHistoryOpen(npc);
    setHistoryData([]);
    try {
      const { history } = await getNpcHistory(npc.id);
      setHistoryData(history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    }
  };

  const portraitTotal = npcs.reduce((sum, n) => sum + n.expressions.filter((e) => e.hasPortrait).length, 0);
  const expressionTotal = npcs.reduce((sum, n) => sum + n.expressions.length, 0);

  return (
    <div className="admin-npcs">
      <AdminSection
        title="NPCs"
        lede="Speakers the dialogue system can reference. Every @speaker in a .twee is cross-checked against this registry at import time."
        actions={
          <button type="button" className="btn" onClick={() => setDialogNpc(null)}>+ New NPC</button>
        }
      >
        <div className="admin-stat-row">
          <StatTile label="NPCs" value={npcs.length} />
          <StatTile label="Expressions" value={expressionTotal} />
          <StatTile label="Portraits uploaded" value={`${portraitTotal} / ${expressionTotal}`} />
        </div>

        <ErrorText error={npcsQuery.error} />
        <ErrorText error={deleteMutation.error} />

        {npcsQuery.isPending ? (
          <AdminMessage tone="muted">Loading NPCs…</AdminMessage>
        ) : npcs.length === 0 ? (
          <AdminMessage tone="muted">No NPCs yet. Create one to unblock @speaker in your dialogues.</AdminMessage>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Display name</th>
                <th>Expressions</th>
                <th>Portraits</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {npcs.map((npc) => {
                const uploaded = npc.expressions.filter((e) => e.hasPortrait).length;
                return (
                  <tr key={npc.id}>
                    <td><b>{npc.id}</b></td>
                    <td>{npc.displayName}</td>
                    <td>
                      {npc.expressions.map((e) => (
                        <span key={e.key} className={`npc-expression-chip ${e.hasPortrait ? 'has-portrait' : ''}`} title={e.hasPortrait ? 'portrait uploaded' : 'no portrait'}>
                          {e.key}
                        </span>
                      ))}
                    </td>
                    <td>{uploaded} / {npc.expressions.length}</td>
                    <td><StatusBadge status={npc.status} /></td>
                    <td className="dlg-actions">
                      <button className="btn btn--secondary btn--sm" type="button" onClick={() => setDialogNpc(npc)}>Edit</button>
                      {npc.status === 'draft' ? (
                        <button className="btn btn--primary btn--sm" type="button" onClick={() => publishNpcMutation.mutate(npc.id)}>Publish</button>
                      ) : (
                        <span className="status-published" style={{ fontSize: 11, opacity: 0.7 }}>Published</span>
                      )}
                      <button className="btn btn--secondary btn--sm" type="button" onClick={() => loadHistory(npc)}>History</button>
                      <button
                        className="btn btn--secondary btn--sm"
                        type="button"
                        disabled={deleteMutation.isPending}
                        onClick={() => setConfirmDeleteId(npc.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {confirmDeleteId !== null ? (
          <AdminMessage tone="error">
            Delete NPC <b>{confirmDeleteId}</b>? Every dialogue that @speakers this NPC will fail re-import until the reference is updated.
            <div className="dlg-confirm-actions">
              <button
                className="btn"
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(confirmDeleteId)}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete it'}
              </button>
              <button className="btn btn--secondary" type="button" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
            </div>
          </AdminMessage>
        ) : null}
      </AdminSection>

      {dialogNpc !== undefined ? (
        <NpcDialog
          npc={dialogNpc}
          onClose={() => setDialogNpc(undefined)}
          onSaved={(npc) => {
            invalidate();
            setDialogNpc(npc);
          }}
        />
      ) : null}
    </div>
  );
}
