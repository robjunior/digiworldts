import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';

import { listDialogues } from '../../lib/api-dialogues';
import {
  createOnboardingTeam,
  deleteOnboardingTeam,
  getOnboardingConfig,
  listOnboardingTeamsAdmin,
  updateOnboardingConfig,
  updateOnboardingTeam,
  type OnboardingConfigInput,
  type OnboardingConfigView,
  type OnboardingTeamInput,
  type OnboardingTeamView,
} from '../../lib/api-onboarding';
import { AdminMessage, AdminSection, ErrorText, Field, StatTile } from './AdminShared';

const CONFIG_KEY = ['admin', 'onboarding', 'config'] as const;
const TEAMS_KEY = ['admin', 'onboarding', 'teams'] as const;
const DIALOGUES_KEY = ['admin', 'dialogues'] as const;

type ConfigDraft = {
  readonly introDialogue: string;
  readonly bgImage: string;
  readonly introDialogueId: string;
};

function configToDraft(view: OnboardingConfigView): ConfigDraft {
  return {
    introDialogue: view.introDialogue,
    bgImage: view.bgImage,
    introDialogueId: view.introDialogueId ?? '',
  };
}

function draftToInput(draft: ConfigDraft): OnboardingConfigInput {
  const id = draft.introDialogueId.trim();
  return {
    introDialogue: draft.introDialogue,
    bgImage: draft.bgImage,
    introDialogueId: id.length === 0 ? null : id,
  };
}

function ConfigSection(): JSX.Element {
  const queryClient = useQueryClient();
  const configQuery = useQuery({ queryKey: CONFIG_KEY, queryFn: getOnboardingConfig });
  const dialoguesQuery = useQuery({ queryKey: DIALOGUES_KEY, queryFn: listDialogues });
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [flash, setFlash] = useState<{ readonly tone: 'success' | 'error'; readonly message: string } | null>(null);

  useEffect(() => {
    if (configQuery.data && draft === null) {
      setDraft(configToDraft(configQuery.data.config));
    }
  }, [configQuery.data, draft]);

  const saveMutation = useMutation({
    mutationFn: updateOnboardingConfig,
    onSuccess: (data) => {
      setDraft(configToDraft(data.config));
      setFlash({ tone: 'success', message: 'Config saved.' });
      void queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
    },
    onError: (err) => setFlash({ tone: 'error', message: err instanceof Error ? err.message : 'save failed' }),
  });

  const dialogues = dialoguesQuery.data?.dialogues ?? [];
  const canSave = draft !== null && draft.introDialogue.trim().length > 0 && !saveMutation.isPending;
  const modeIsInteractive = draft !== null && draft.introDialogueId.trim().length > 0;

  return (
    <AdminSection
      title="Intro config"
      lede="What the player sees before picking their starter team. Set a dialogue id to run the interactive runtime; leave it blank to fall back to the paragraph text."
      actions={
        <button
          type="button"
          className="btn"
          disabled={!canSave}
          onClick={() => { if (draft) saveMutation.mutate(draftToInput(draft)); }}
        >
          {saveMutation.isPending ? 'Saving…' : 'Save intro config'}
        </button>
      }
    >
      <ErrorText error={configQuery.error} />
      <ErrorText error={dialoguesQuery.error} />
      {flash !== null ? <AdminMessage tone={flash.tone}>{flash.message}</AdminMessage> : null}

      {draft === null ? (
        <AdminMessage tone="muted">Loading…</AdminMessage>
      ) : (
        <>
          <div className="admin-stat-row">
            <StatTile label="Mode" value={modeIsInteractive ? 'interactive dialogue' : 'paragraph text'} />
            <StatTile label="BG image" value={draft.bgImage.trim().length > 0 ? 'custom' : 'CSS default'} />
            <StatTile label="Last updated" value={configQuery.data?.config.updatedAt ? new Date(configQuery.data.config.updatedAt).toLocaleString() : 'never'} />
          </div>

          <Field label="Intro dialogue id (optional — leave blank to use paragraphs below)">
            <select
              value={draft.introDialogueId}
              onChange={(e) => setDraft({ ...draft, introDialogueId: e.target.value })}
            >
              <option value="">— none, use paragraphs —</option>
              {dialogues.map((d) => (
                <option key={d.dialogueId} value={d.dialogueId}>
                  {d.dialogueId} — {d.title}
                </option>
              ))}
            </select>
          </Field>

          <Field label={`Fallback paragraph text (${draft.introDialogue.length}/4000, always required)${modeIsInteractive ? ' — hidden when the dialogue above runs, but kept for graceful fallback if the dialogue is deleted' : ''}`}>
            <textarea
              rows={8}
              value={draft.introDialogue}
              onChange={(e) => setDraft({ ...draft, introDialogue: e.target.value })}
              placeholder={'A new signal breaks across the network...\n\nSeparate paragraphs with a blank line.'}
              style={{ opacity: modeIsInteractive ? 0.6 : 1 }}
            />
          </Field>

          <Field label="Background image URL (optional — http(s), same-origin path, or data:image/…)">
            <input
              type="text"
              value={draft.bgImage}
              onChange={(e) => setDraft({ ...draft, bgImage: e.target.value })}
              placeholder="/assets/onboarding/bg.jpg"
            />
          </Field>
        </>
      )}
    </AdminSection>
  );
}

type TeamDraft = {
  readonly id: string | null;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly monCatalogIds: readonly [string, string, string];
  readonly sortOrder: number;
  readonly enabled: boolean;
};

function draftFromTeam(team: OnboardingTeamView | null): TeamDraft {
  if (team === null) {
    return {
      id: null,
      slug: '',
      name: '',
      description: '',
      monCatalogIds: ['', '', ''],
      sortOrder: 0,
      enabled: true,
    };
  }
  const ids = team.mons.map((m) => m.catalogId);
  const [a, b, c] = [ids[0] ?? '', ids[1] ?? '', ids[2] ?? ''] as const;
  return {
    id: team.id,
    slug: team.slug,
    name: team.name,
    description: team.description,
    monCatalogIds: [a, b, c],
    sortOrder: team.sortOrder,
    enabled: team.enabled,
  };
}

function draftToTeamInput(draft: TeamDraft): OnboardingTeamInput {
  return {
    slug: draft.slug.trim(),
    name: draft.name.trim(),
    description: draft.description.trim(),
    monCatalogIds: [draft.monCatalogIds[0], draft.monCatalogIds[1], draft.monCatalogIds[2]],
    sortOrder: draft.sortOrder,
    enabled: draft.enabled,
  };
}

function TeamDialog({ team, onClose, onSaved }: {
  readonly team: OnboardingTeamView | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): JSX.Element {
  const isNew = team === null;
  const [draft, setDraft] = useState<TeamDraft>(() => draftFromTeam(team));
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = draftToTeamInput(draft);
      return isNew ? await createOnboardingTeam(input) : await updateOnboardingTeam(draft.id!, input);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'save failed'),
  });

  const updateMonAt = (index: 0 | 1 | 2, value: string): void => {
    const next: [string, string, string] = [...draft.monCatalogIds] as [string, string, string];
    next[index] = value;
    setDraft({ ...draft, monCatalogIds: next });
  };

  const canSave = draft.slug.trim().length > 0
    && draft.name.trim().length > 0
    && draft.monCatalogIds.every((id) => id.trim().length > 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isNew ? 'New starter team' : `Edit team "${team.slug}"`}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <Field label="Slug (lowercase, kebab/snake, unique)">
            <input type="text" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
          </Field>
          <Field label="Display name">
            <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>
          <div className="form-grid">
            <Field label="Mon 1 catalog id (e.g. skb-50)">
              <input type="text" value={draft.monCatalogIds[0]} onChange={(e) => updateMonAt(0, e.target.value)} />
            </Field>
            <Field label="Mon 2 catalog id">
              <input type="text" value={draft.monCatalogIds[1]} onChange={(e) => updateMonAt(1, e.target.value)} />
            </Field>
            <Field label="Mon 3 catalog id">
              <input type="text" value={draft.monCatalogIds[2]} onChange={(e) => updateMonAt(2, e.target.value)} />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Sort order (lower = earlier)">
              <input type="number" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })} />
            </Field>
            <label className="admin-checkbox">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
              Enabled (shown to players)
            </label>
          </div>
          {error !== null ? <AdminMessage tone="error">{error}</AdminMessage> : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" disabled={!canSave || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? 'Saving…' : isNew ? 'Create team' : 'Save changes'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function TeamsSection(): JSX.Element {
  const queryClient = useQueryClient();
  const teamsQuery = useQuery({ queryKey: TEAMS_KEY, queryFn: listOnboardingTeamsAdmin });
  const [dialogTeam, setDialogTeam] = useState<OnboardingTeamView | null | undefined>(undefined);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const invalidate = (): void => { void queryClient.invalidateQueries({ queryKey: TEAMS_KEY }); };

  const deleteMutation = useMutation({
    mutationFn: deleteOnboardingTeam,
    onSuccess: () => { setConfirmDeleteId(null); invalidate(); },
  });

  const teams = teamsQuery.data?.teams ?? [];
  const enabled = teams.filter((t) => t.enabled).length;
  const broken = teams.filter((t) => t.missingCatalogIds.length > 0).length;

  return (
    <AdminSection
      title="Starter teams"
      lede="Each team is 3 Digimon from the catalog. The player picks one at the end of the intro."
      actions={<button type="button" className="btn" onClick={() => setDialogTeam(null)}>+ New team</button>}
    >
      <ErrorText error={teamsQuery.error} />
      <ErrorText error={deleteMutation.error} />

      <div className="admin-stat-row">
        <StatTile label="Total teams" value={teams.length} />
        <StatTile label="Enabled" value={`${enabled} / ${teams.length}`} />
        <StatTile label="Broken (missing catalog ids)" value={broken} />
      </div>

      {teamsQuery.isPending ? (
        <AdminMessage tone="muted">Loading teams…</AdminMessage>
      ) : teams.length === 0 ? (
        <AdminMessage tone="muted">No teams configured. Add one so the intro can complete.</AdminMessage>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Slug</th>
              <th>Name</th>
              <th>Mons</th>
              <th>Order</th>
              <th>Enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.id}>
                <td><b>{team.slug}</b></td>
                <td>{team.name}</td>
                <td>
                  {team.mons.map((m) => (
                    <span key={m.catalogId} title={m.catalogId} style={{ marginRight: 8 }}>{m.name}</span>
                  ))}
                  {team.missingCatalogIds.length > 0 ? (
                    <span className="admin-message is-error" style={{ display: 'inline-block', padding: '2px 6px' }}>
                      missing: {team.missingCatalogIds.join(', ')}
                    </span>
                  ) : null}
                </td>
                <td>{team.sortOrder}</td>
                <td>{team.enabled ? 'yes' : 'no'}</td>
                <td className="dlg-actions">
                  <button className="btn btn--secondary btn--sm" type="button" onClick={() => setDialogTeam(team)}>Edit</button>
                  <button
                    className="btn btn--secondary btn--sm"
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={() => setConfirmDeleteId(team.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {confirmDeleteId !== null ? (
        <AdminMessage tone="error">
          Delete team? Players who haven't picked yet will lose it as an option.
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

      {dialogTeam !== undefined ? (
        <TeamDialog
          team={dialogTeam}
          onClose={() => setDialogTeam(undefined)}
          onSaved={() => { setDialogTeam(undefined); invalidate(); }}
        />
      ) : null}
    </AdminSection>
  );
}

export function OnboardingAdmin(): JSX.Element {
  return (
    <div className="admin-onboarding">
      <ConfigSection />
      <TeamsSection />
    </div>
  );
}
