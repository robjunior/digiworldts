import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';

import {
  createSeason,
  deleteSeason,
  endSeasonNow,
  listSeasons,
  type Season,
} from '../../lib/api-seasons';
import { AdminMessage, AdminSection, ErrorText, Field } from './AdminShared';

const SEASONS_QUERY_KEY = ['admin', 'seasons'] as const;

function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value: string): number | null {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusOf(season: Season, now: number): 'active' | 'expired' | 'ended' | 'scheduled' {
  if (season.endedAt !== null) return 'ended';
  if (season.startsAt > now) return 'scheduled';
  if (season.endsAt <= now) return 'expired';
  return 'active';
}

export function SeasonsAdmin(): JSX.Element {
  const queryClient = useQueryClient();
  const seasonsQuery = useQuery({ queryKey: SEASONS_QUERY_KEY, queryFn: listSeasons, staleTime: 15_000 });

  const createMutation = useMutation({
    mutationFn: createSeason,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SEASONS_QUERY_KEY }),
  });
  const endMutation = useMutation({
    mutationFn: endSeasonNow,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SEASONS_QUERY_KEY }),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteSeason,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SEASONS_QUERY_KEY }),
  });

  const seasons = seasonsQuery.data?.seasons ?? [];
  const now = Date.now();

  const anyError =
    seasonsQuery.error ?? createMutation.error ?? endMutation.error ?? deleteMutation.error ?? null;

  return (
    <AdminSection
      title="Seasons"
      lede="Competitive periods with MMR snapshots. When a season's end date arrives, the ticker snapshots every player's MMR into user_season_results and applies a soft decay (new = 1000 + (old - 1000) × 0.5). Manual end is available below."
    >
      <ErrorText error={anyError instanceof Error ? anyError : null} />
      {seasonsQuery.isPending ? <AdminMessage tone="muted">Loading seasons…</AdminMessage> : null}
      <SeasonForm busy={createMutation.isPending} onSubmit={(input) => createMutation.mutateAsync(input)} />
      <SeasonsTable
        seasons={seasons}
        now={now}
        endBusy={endMutation.isPending}
        deleteBusy={deleteMutation.isPending}
        onEnd={(id) => endMutation.mutateAsync(id)}
        onDelete={(id) => deleteMutation.mutateAsync(id)}
      />
    </AdminSection>
  );
}

function SeasonForm({
  busy,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly onSubmit: (input: { name: string; startsAt: number; endsAt: number }) => Promise<unknown>;
}): JSX.Element {
  const defaultStart = useMemo(() => toDatetimeLocal(Date.now()), []);
  const defaultEnd = useMemo(() => toDatetimeLocal(Date.now() + 30 * 24 * 60 * 60 * 1000), []);
  const [name, setName] = useState<string>('');
  const [startsAtStr, setStartsAtStr] = useState<string>(defaultStart);
  const [endsAtStr, setEndsAtStr] = useState<string>(defaultEnd);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setStatus(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Name is required.');
      return;
    }
    const startsAt = fromDatetimeLocal(startsAtStr);
    const endsAt = fromDatetimeLocal(endsAtStr);
    if (startsAt === null || endsAt === null) {
      setError('Invalid start or end date.');
      return;
    }
    if (endsAt <= startsAt) {
      setError('End date must be after start date.');
      return;
    }
    try {
      await onSubmit({ name: trimmed, startsAt, endsAt });
      setName('');
      setStatus(`Created "${trimmed}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create season.');
    }
  };

  return (
    <form className="admin-form" onSubmit={submit} style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Spring 2026"
            maxLength={80}
            required
          />
        </Field>
        <Field label="Starts at">
          <input type="datetime-local" value={startsAtStr} onChange={(e) => setStartsAtStr(e.target.value)} required />
        </Field>
        <Field label="Ends at">
          <input type="datetime-local" value={endsAtStr} onChange={(e) => setEndsAtStr(e.target.value)} required />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create season'}
        </button>
        {status !== null ? <AdminMessage tone="success">{status}</AdminMessage> : null}
        {error !== null ? <AdminMessage tone="error">{error}</AdminMessage> : null}
      </div>
    </form>
  );
}

function SeasonsTable({
  seasons,
  now,
  endBusy,
  deleteBusy,
  onEnd,
  onDelete,
}: {
  readonly seasons: readonly Season[];
  readonly now: number;
  readonly endBusy: boolean;
  readonly deleteBusy: boolean;
  readonly onEnd: (id: string) => Promise<unknown>;
  readonly onDelete: (id: string) => Promise<unknown>;
}): JSX.Element {
  if (seasons.length === 0) {
    return <AdminMessage tone="muted">No seasons yet. Create one above.</AdminMessage>;
  }
  return (
    <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>Name</th>
          <th style={{ textAlign: 'left' }}>Starts</th>
          <th style={{ textAlign: 'left' }}>Ends (planned)</th>
          <th style={{ textAlign: 'left' }}>Status</th>
          <th style={{ textAlign: 'right' }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {seasons.map((s) => {
          const status = statusOf(s, now);
          const isEnded = status === 'ended';
          return (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{fmtDate(s.startsAt)}</td>
              <td>{fmtDate(s.endsAt)}</td>
              <td>
                {status === 'ended' ? (
                  <span className="pill" title={`Ended ${fmtDate(s.endedAt ?? s.endsAt)}`}>Ended</span>
                ) : status === 'expired' ? (
                  <span className="pill" title="Awaiting ticker close">Expired</span>
                ) : status === 'scheduled' ? (
                  <span className="pill">Scheduled</span>
                ) : (
                  <span className="pill" style={{ background: 'var(--signal)', color: '#fff' }}>Active</span>
                )}
              </td>
              <td style={{ textAlign: 'right' }}>
                {!isEnded ? (
                  <>
                    <button
                      type="button"
                      className="btn"
                      disabled={endBusy}
                      onClick={() => {
                        if (window.confirm(`End "${s.name}" now? This snapshots every user's MMR and applies soft decay.`)) {
                          void onEnd(s.id);
                        }
                      }}
                    >
                      End now
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      disabled={deleteBusy}
                      style={{ marginLeft: 8 }}
                      onClick={() => {
                        if (window.confirm(`Delete "${s.name}"? This is only allowed while the season is active.`)) {
                          void onDelete(s.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
