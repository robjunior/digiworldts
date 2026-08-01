import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useState } from 'react';
import { Link } from 'react-router';

import {
  deleteDialogue,
  dialogueExportUrl,
  listDialogues,
  syncDialogues,
  type DialogueSummary,
  type SyncReport,
} from '../../lib/api-dialogues';
import { AdminMessage, AdminSection, ErrorText, StatTile } from './AdminShared';
import { TweeImportButton } from './DialoguesAdmin/TweeImportButton';

const DIALOGUES_KEY = ['admin', 'dialogues'] as const;

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

function SyncSummary({ report }: { readonly report: SyncReport }): JSX.Element {
  const counted = (status: string): number => report.results.filter((r) => r.status === status).length;
  const failures = report.results.filter((r) => r.status === 'failed');
  return (
    <div className="dlg-sync-report">
      <AdminMessage tone={failures.length > 0 ? 'error' : 'success'}>
        Scanned {report.scanned} file{report.scanned === 1 ? '' : 's'} — {counted('imported')} imported,{' '}
        {counted('updated')} updated, {counted('unchanged')} unchanged, {failures.length} failed.
      </AdminMessage>
      {failures.map((failure) => (
        <div key={failure.file} className="dlg-sync-failure">
          <code>{failure.file}</code>
          <ul>
            {failure.status === 'failed'
              ? failure.errors.map((error, index) => (
                  <li key={index}>{error.passage ?? 'file'}{error.line > 0 ? `:${error.line}` : ''} — {error.message}</li>
                ))
              : null}
          </ul>
        </div>
      ))}
      {report.orphans.length > 0 ? (
        <AdminMessage tone="muted">
          No file on disk backs these any more: {report.orphans.join(', ')}. They are kept, not deleted, because quests
          and NPCs may still reference them.
        </AdminMessage>
      ) : null}
    </div>
  );
}

function DialogueRow({ dialogue, onDelete, busy }: {
  readonly dialogue: DialogueSummary;
  readonly onDelete: (id: string) => void;
  readonly busy: boolean;
}): JSX.Element {
  return (
    <tr>
      <td>
        <b>{dialogue.dialogueId}</b>
        <div className="dlg-title">{dialogue.title}</div>
      </td>
      <td>{dialogue.sourcePath ?? <span className="dlg-muted">uploaded</span>}</td>
      <td>{dialogue.nodeCount}</td>
      <td><code>{dialogue.startNodeId}</code></td>
      <td>{dialogue.npcIds.length > 0 ? dialogue.npcIds.join(', ') : <span className="dlg-muted">—</span>}</td>
      <td>{formatDate(dialogue.updatedAt)}</td>
      <td className="dlg-actions">
        <Link className="btn btn--secondary btn--sm" to={`/dialogues/${encodeURIComponent(dialogue.dialogueId)}/simulate`}>Simulate</Link>
        <a className="btn btn--secondary btn--sm" href={dialogueExportUrl(dialogue.dialogueId)} download>Export</a>
        <button
          className="btn btn--secondary btn--sm"
          type="button"
          disabled={busy}
          onClick={() => onDelete(dialogue.dialogueId)}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

export function DialoguesAdmin(): JSX.Element {
  const queryClient = useQueryClient();
  const [syncReport, setSyncReport] = useState<SyncReport | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const dialoguesQuery = useQuery({ queryKey: DIALOGUES_KEY, queryFn: listDialogues });
  const dialogues = dialoguesQuery.data?.dialogues ?? [];

  const invalidate = (): void => { void queryClient.invalidateQueries({ queryKey: DIALOGUES_KEY }); };

  const syncMutation = useMutation({
    mutationFn: syncDialogues,
    onSuccess: (report) => { setSyncReport(report); invalidate(); },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDialogue,
    onSuccess: () => { setConfirmId(null); invalidate(); },
  });

  const totalNodes = dialogues.reduce((sum, d) => sum + d.nodeCount, 0);
  const fromDisk = dialogues.filter((d) => d.sourcePath !== null).length;

  return (
    <div className="admin-dialogues">
      <AdminSection
        title="Dialogues"
        lede="Authored in Twine and exported as .twee. Drop files in the sync folder and press Sync, or upload one below."
        actions={
          <button className="btn" type="button" disabled={syncMutation.isPending} onClick={() => syncMutation.mutate()}>
            {syncMutation.isPending ? 'Syncing…' : 'Sync folder'}
          </button>
        }
      >
        <div className="admin-stat-row">
          <StatTile label="Dialogues" value={dialogues.length} />
          <StatTile label="Nodes" value={totalNodes} />
          <StatTile label="From sync folder" value={fromDisk} />
          <StatTile label="Uploaded" value={dialogues.length - fromDisk} />
        </div>

        <ErrorText error={syncMutation.error} />
        {syncReport !== null ? <SyncSummary report={syncReport} /> : null}
      </AdminSection>

      <AdminSection title="Import a .twee" lede="Parsed in the browser first — nothing is stored until you press Import.">
        <TweeImportButton onImported={invalidate} />
      </AdminSection>

      <AdminSection title="Stored dialogues">
        <ErrorText error={dialoguesQuery.error} />
        <ErrorText error={deleteMutation.error} />
        {dialoguesQuery.isPending ? (
          <AdminMessage tone="muted">Loading dialogues…</AdminMessage>
        ) : dialogues.length === 0 ? (
          <AdminMessage tone="muted">No dialogues yet. Import a .twee or press Sync folder.</AdminMessage>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th><th>Source</th><th>Nodes</th><th>Start</th><th>Speakers</th><th>Updated</th><th />
              </tr>
            </thead>
            <tbody>
              {dialogues.map((dialogue) => (
                <DialogueRow
                  key={dialogue.dialogueId}
                  dialogue={dialogue}
                  busy={deleteMutation.isPending}
                  onDelete={setConfirmId}
                />
              ))}
            </tbody>
          </table>
        )}

        {confirmId !== null ? (
          <AdminMessage tone="error">
            Delete <b>{confirmId}</b>? Quests or NPCs referencing it will stop resolving.
            <div className="dlg-confirm-actions">
              <button className="btn" type="button" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(confirmId)}>
                {deleteMutation.isPending ? 'Deleting…' : 'Delete it'}
              </button>
              <button className="btn btn--secondary" type="button" onClick={() => setConfirmId(null)}>Cancel</button>
            </div>
          </AdminMessage>
        ) : null}
      </AdminSection>
    </div>
  );
}
