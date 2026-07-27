import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { BIOMES, type Biome } from '@digiworld/shared';

import { createAdminDungeon, deleteAdminDungeon, listAdminDungeons } from '../../lib/api-dungeon-admin';
import { AdminSection, ErrorText, Field } from './AdminShared';

const DUNGEONS_QUERY_KEY = ['admin', 'dungeons'] as const;

type DraftDungeon = {
  name: string;
  description: string;
  biome: Biome;
  width: number;
  height: number;
  spawnX: number;
  spawnY: number;
};

const EMPTY_DRAFT: DraftDungeon = {
  name: '',
  description: '',
  biome: 'forest',
  width: 8,
  height: 8,
  spawnX: 0,
  spawnY: 0,
};

export function DungeonsAdmin(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<DraftDungeon>(EMPTY_DRAFT);

  const dungeonsQuery = useQuery({ queryKey: DUNGEONS_QUERY_KEY, queryFn: listAdminDungeons });
  const createMutation = useMutation({
    mutationFn: createAdminDungeon,
    onSuccess: async ({ dungeon }) => {
      await queryClient.invalidateQueries({ queryKey: DUNGEONS_QUERY_KEY });
      setCreating(false);
      setDraft(EMPTY_DRAFT);
      navigate(`/admin/dungeons/${dungeon.id}`);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAdminDungeon,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DUNGEONS_QUERY_KEY }),
  });

  const dungeons = dungeonsQuery.data?.dungeons ?? [];

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const name = draft.name.trim();
    if (!name) return;
    const description = draft.description.trim();
    createMutation.mutate({
      name,
      biome: draft.biome,
      width: draft.width,
      height: draft.height,
      spawnX: draft.spawnX,
      spawnY: draft.spawnY,
      ...(description ? { description } : {}),
    });
  };

  const onDelete = (id: string, name: string): void => {
    if (!window.confirm(`Delete dungeon "${name}"? This removes all tiles, encounters, and item drops.`)) return;
    deleteMutation.mutate(id);
  };

  return (
    <AdminSection
      title="Dungeons"
      lede="Create and manage dungeons. Each dungeon has a grid of walkable tiles plus encounters and item drops placed on specific tiles."
      actions={
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setCreating(true)} disabled={creating}>
          + New Dungeon
        </button>
      }
    >
      <ErrorText error={dungeonsQuery.error ?? createMutation.error ?? deleteMutation.error} />

      {creating ? (
        <form onSubmit={submit} style={{ marginBottom: '16px', padding: '14px', border: '1px solid var(--hair)', background: 'var(--panel)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '12px' }}>
            <Field label="Name">
              <input type="text" required autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Verdant Reach Trial" />
            </Field>
            <Field label="Biome">
              <select value={draft.biome} onChange={(e) => setDraft({ ...draft, biome: e.target.value as Biome })}>
                {BIOMES.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </Field>
            <Field label="Width">
              <input type="number" min={2} max={32} required value={draft.width} onChange={(e) => setDraft({ ...draft, width: Math.max(2, Math.min(32, Number(e.target.value) || 2)) })} />
            </Field>
            <Field label="Height">
              <input type="number" min={2} max={32} required value={draft.height} onChange={(e) => setDraft({ ...draft, height: Math.max(2, Math.min(32, Number(e.target.value) || 2)) })} />
            </Field>
            <Field label="Spawn X">
              <input type="number" min={0} value={draft.spawnX} onChange={(e) => setDraft({ ...draft, spawnX: Math.max(0, Number(e.target.value) || 0) })} />
            </Field>
            <Field label="Spawn Y">
              <input type="number" min={0} value={draft.spawnY} onChange={(e) => setDraft({ ...draft, spawnY: Math.max(0, Number(e.target.value) || 0) })} />
            </Field>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <Field label="Description (optional)">
              <textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="A forgotten shrine deep in the digital woods…" />
            </Field>
          </div>
          <div className="admin-section-actions">
            <button type="submit" className="btn btn--primary" disabled={createMutation.isPending || !draft.name.trim()}>
              {createMutation.isPending ? 'Creating…' : 'Create dungeon'}
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => { setCreating(false); setDraft(EMPTY_DRAFT); }}>Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="admin-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Biome</th>
              <th>Size</th>
              <th>Spawn</th>
              <th>Linked</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {dungeons.length === 0 ? (
              <tr><td colSpan={6} className="muted">No dungeons yet. Click <b>+ New Dungeon</b> to create one.</td></tr>
            ) : (
              dungeons.map((d) => (
                <tr key={d.id}>
                  <td>
                    <b>{d.name}</b>
                    {d.description ? <><br /><span className="muted">{d.description}</span></> : null}
                  </td>
                  <td><span className="badge">{d.biome}</span></td>
                  <td>{d.width} × {d.height}</td>
                  <td>({d.spawnX}, {d.spawnY})</td>
                  <td>
                    {d.worldObjectId ? <span className="badge">world</span> : null}
                    {d.questId ? <span className="badge">quest</span> : null}
                    {d.biomeRegion ? <span className="badge">{d.biomeRegion}</span> : null}
                    {!d.worldObjectId && !d.questId && !d.biomeRegion ? <span className="muted">—</span> : null}
                  </td>
                  <td className="admin-actions-cell">
                    <Link to={`/admin/dungeons/${d.id}`} className="btn btn--secondary btn--sm">Edit</Link>
                    <button type="button" className="btn btn--danger btn--sm" onClick={() => onDelete(d.id, d.name)} disabled={deleteMutation.isPending}>Delete</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AdminSection>
  );
}
