import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import type { Biome, Dungeon, Quest, WorldObject, WorldObjectKind, WorldRegion } from '@digiworld/shared';

import { AdminGuard } from '../components/admin/AdminGuard';
import { AdminWorldGlobe } from '../components/admin/AdminWorldGlobe';
import { listAdminDungeons, listAdminWorldObjects, createAdminWorldObject, updateAdminWorldObject, deleteAdminWorldObject, updateAdminDungeon } from '../lib/api-dungeon-admin';
import { listAdminQuests } from '../lib/api-quest-admin';
import { getWorldRegions } from '../lib/api-world';
import '../styles/extensions-admin.css';

type Tool = 'SELECT' | 'PLACE';
type Toast = { readonly message: string; readonly type: 'success' | 'error' };
type EditableWorldObject = Omit<WorldObject, 'id' | 'createdAt' | 'updatedAt'>;

const KINDS = ['mountain', 'tower', 'city', 'ruin', 'shrine', 'obelisk'] as const;
const KIND_TINT: Readonly<Record<WorldObjectKind, string>> = { mountain: '#9aa0a6', tower: '#5d95ff', city: '#a770ff', ruin: '#b8834c', shrine: '#f2d35d', obelisk: '#63d6ff' };
const DUPLICATE_DEGREES = 0.5;

export function AdminWorld(): JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tool, setTool] = useState<Tool>('SELECT');
  const [placeKind, setPlaceKind] = useState<WorldObjectKind>('mountain');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [selectedDungeons, setSelectedDungeons] = useState<Record<string, string>>({});

  const regionsQuery = useQuery({ queryKey: ['admin-world-regions'], queryFn: getWorldRegions });
  const dungeonsQuery = useQuery({ queryKey: ['admin-dungeons'], queryFn: listAdminDungeons });
  const objectsQuery = useQuery({ queryKey: ['admin-world-objects'], queryFn: listAdminWorldObjects });
  const questsQuery = useQuery({ queryKey: ['admin', 'quests'], queryFn: listAdminQuests });

  const regions = useMemo(() => [...(regionsQuery.data ?? [])].sort((a, b) => b.danger - a.danger), [regionsQuery.data]);
  const objects = objectsQuery.data?.objects ?? [];
  const dungeons = dungeonsQuery.data?.dungeons ?? [];
  const quests = questsQuery.data?.quests ?? [];
  const selected = objects.find((object) => object.id === selectedId) ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setSelectedId(null);
      setTool('SELECT');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const invalidateWorld = (): void => { void queryClient.invalidateQueries({ queryKey: ['admin-world-objects'] }); };
  const createObject = useMutation({ mutationFn: createAdminWorldObject, onSuccess: ({ object }) => { invalidateWorld(); setSelectedId(object.id); setTool('SELECT'); setToast({ message: `Placed ${object.kind} at ${object.lat.toFixed(1)}°, ${object.lon.toFixed(1)}°.`, type: 'success' }); }, onError: (error: Error) => setToast({ message: error.message, type: 'error' }) });
  const updateObject = useMutation({ mutationFn: ({ id, body }: { readonly id: string; readonly body: EditableWorldObject }) => updateAdminWorldObject(id, body), onSuccess: ({ object }) => { invalidateWorld(); setSelectedId(object.id); setToast({ message: 'World object saved.', type: 'success' }); }, onError: (error: Error) => setToast({ message: error.message, type: 'error' }) });
  const removeObject = useMutation({ mutationFn: deleteAdminWorldObject, onSuccess: () => { invalidateWorld(); setSelectedId(null); setToast({ message: 'World object deleted.', type: 'success' }); }, onError: (error: Error) => setToast({ message: error.message, type: 'error' }) });
  const updateDungeon = useMutation({ mutationFn: ({ dungeonId, biomeRegion }: { readonly dungeonId: string; readonly biomeRegion: string | null }) => updateAdminDungeon(dungeonId, { biomeRegion }), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin-world-regions'] }); void queryClient.invalidateQueries({ queryKey: ['admin-dungeons'] }); setToast({ message: 'Region link saved.', type: 'success' }); }, onError: (error: Error) => setToast({ message: error.message, type: 'error' }) });

  const duplicateInfo = useMemo(() => findDuplicates(objects), [objects]);
  const cleanDuplicates = useMutation({
    mutationFn: async (): Promise<number> => {
      for (const extra of duplicateInfo.extras) await deleteAdminWorldObject(extra.id);
      return duplicateInfo.extras.length;
    },
    onSuccess: (count) => { invalidateWorld(); setToast({ message: `Removed ${count} duplicate object${count === 1 ? '' : 's'}.`, type: 'success' }); },
    onError: (error: Error) => setToast({ message: error.message, type: 'error' }),
  });

  function placeAt(point: { readonly lat: number; readonly lon: number }): void {
    createObject.mutate({ x: Math.round(point.lon / 10), y: Math.round(point.lat / 10), lat: point.lat, lon: point.lon, kind: placeKind, scale: 1, passable: false, tint: KIND_TINT[placeKind] });
  }

  async function saveRegion(region: WorldRegion): Promise<void> {
    const nextId = selectedDungeons[region.biome] ?? '';
    if (nextId === (region.dungeonId ?? '')) return;
    if (region.dungeonId) await updateDungeon.mutateAsync({ dungeonId: region.dungeonId, biomeRegion: null });
    if (nextId) await updateDungeon.mutateAsync({ dungeonId: nextId, biomeRegion: region.biome });
    setSelectedDungeons(({ [region.biome]: _removed, ...rest }) => rest);
  }

  return (
    <AdminGuard>
      <main className="main admin-world-layout">
        <div className="admin-world-map-shell">
          <div className="admin-world-header"><div><h2>World Map Editor</h2><p>Place quest and dungeon objects anywhere on the 3D globe surface.</p></div><Link to="/admin" className="admin-world-nav">Back to Admin</Link></div>
          {toast ? <div className={`admin-message is-${toast.type}`}>{toast.message}</div> : null}
          <AdminWorldGlobe objects={objects} regions={regions} selectedId={selectedId} tool={tool} duplicateIds={duplicateInfo.duplicateIds} onSelect={setSelectedId} onPlace={placeAt} />
          <aside className="admin-world-floating-panel" aria-label="World editor tools">
            <div className="admin-dungeon-panel-head"><div><h2>World Editor</h2><span>{tool}{selected ? ` · ${selected.lat.toFixed(1)},${selected.lon.toFixed(1)}` : ''}</span></div><button type="button" className="modal-close" onClick={() => navigate('/admin?tab=dungeons')} aria-label="Close world editor">×</button></div>
            {duplicateInfo.extras.length > 0 ? <button type="button" className="world-clean-dups" disabled={cleanDuplicates.isPending} onClick={() => { if (window.confirm(`Delete ${duplicateInfo.extras.length} duplicate object${duplicateInfo.extras.length === 1 ? '' : 's'} within ${DUPLICATE_DEGREES}°? Keeps the oldest object in each cluster.`)) cleanDuplicates.mutate(); }}>{cleanDuplicates.isPending ? 'Cleaning…' : `Clean ${duplicateInfo.extras.length} duplicate${duplicateInfo.extras.length === 1 ? '' : 's'}`}</button> : null}
            <div className="layer-picker tool-picker" aria-label="World tools">{(['SELECT', 'PLACE'] as const).map((entry) => <button key={entry} type="button" className={tool === entry ? 'is-active' : ''} onClick={() => setTool(entry)}>{entry}</button>)}</div>
            {tool === 'PLACE' ? <PlacePanel kind={placeKind} onKind={setPlaceKind} /> : <ObjectPanel key={selected?.id ?? 'empty'} object={selected} quests={quests} dungeons={dungeons} saving={updateObject.isPending} deleting={removeObject.isPending} onSave={(id, body) => updateObject.mutate({ id, body })} onDelete={(id) => { if (window.confirm('Delete this world object?')) removeObject.mutate(id); }} />}
          </aside>
        </div>
        <RegionLinks regions={regions} dungeons={dungeons} selected={selectedDungeons} pending={updateDungeon.isPending} onSelect={(biome, value) => { setSelectedDungeons((prev) => ({ ...prev, [biome]: value })); setToast(null); }} onSave={(region) => void saveRegion(region)} />
      </main>
    </AdminGuard>
  );
}

function PlacePanel({ kind, onKind }: { readonly kind: WorldObjectKind; readonly onKind: (kind: WorldObjectKind) => void }): JSX.Element {
  return <div className="admin-editor-panel"><h3>Place object</h3><label>Kind<select value={kind} onChange={(event) => onKind(toWorldObjectKind(event.target.value))}>{KINDS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label><p className="muted">Click any point on the globe to place a {kind}.</p></div>;
}

function ObjectPanel({ object, quests, dungeons, saving, deleting, onSave, onDelete }: { readonly object: WorldObject | null; readonly quests: readonly Quest[]; readonly dungeons: readonly Dungeon[]; readonly saving: boolean; readonly deleting: boolean; readonly onSave: (id: string, body: EditableWorldObject) => void; readonly onDelete: (id: string) => void }): JSX.Element {
  if (!object) return <div className="admin-editor-panel"><h3>Select object</h3><p className="muted">Click a marker on the globe to edit it.</p></div>;
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSave(object.id, bodyFromForm(new FormData(event.currentTarget), object));
  };
  return <form className="admin-editor-panel" onSubmit={submit}><h3>Edit {object.kind}</h3><label>Label<input name="label" defaultValue={object.label ?? ''} /></label><label>Kind<select name="kind" defaultValue={object.kind}>{KINDS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label><label>Scale<input name="scale" type="number" step="0.1" min="0.5" max="2" defaultValue={object.scale} /></label><label>Tint<input name="tint" type="color" defaultValue={object.tint ?? KIND_TINT[object.kind]} /></label><label className="admin-checkbox"><input name="passable" type="checkbox" defaultChecked={object.passable} /> Passable</label><label>Quest<select name="questId" defaultValue={object.questId ?? ''}><option value="">— none —</option>{quests.map((quest) => <option key={quest.id} value={quest.id}>{quest.name}</option>)}</select></label><label>Dungeon<select name="dungeonId" defaultValue={object.dungeonId ?? ''}><option value="">— none —</option>{dungeons.map((dungeon) => <option key={dungeon.id} value={dungeon.id}>{dungeon.name}</option>)}</select></label><div className="form-grid"><label>Lat<input name="lat" type="number" step="0.1" min="-90" max="90" defaultValue={object.lat} /></label><label>Lon<input name="lon" type="number" step="0.1" min="-180" max="180" defaultValue={object.lon} /></label></div><div className="admin-poi-actions"><button type="submit" disabled={saving}>Save</button><button type="button" disabled={deleting} onClick={() => onDelete(object.id)}>Delete</button></div></form>;
}

function RegionLinks({ regions, dungeons, selected, pending, onSelect, onSave }: { readonly regions: readonly WorldRegion[]; readonly dungeons: readonly Dungeon[]; readonly selected: Readonly<Record<string, string>>; readonly pending: boolean; readonly onSelect: (biome: string, value: string) => void; readonly onSave: (region: WorldRegion) => void }): JSX.Element {
  return <section className="admin-region-link-section"><div className="admin-world-header"><div><h2>Region dungeon links</h2><p>Secondary table for one-dungeon-per-biome routing.</p></div></div><div className="admin-region-table-wrapper"><table className="admin-region-table"><thead><tr><th>Tier</th><th>Region</th><th>Linked Dungeon</th><th>Status</th><th>Actions</th></tr></thead><tbody>{regions.map((region) => { const current = region.dungeonId ?? ''; const displayed = selected[region.biome] ?? current; const changed = displayed !== current; return <tr key={region.biome} className="admin-region-row"><td><div className="region-tier-badge" data-danger={region.danger}>D{region.danger}</div></td><td><div className="region-label-cell"><strong>{region.label}</strong><span>{region.element} · {region.biome}</span></div></td><td><select className="region-select" value={displayed} onChange={(event) => onSelect(region.biome, event.target.value)}><option value="">— None —</option>{dungeons.map((dungeon) => <option key={dungeon.id} value={dungeon.id}>{dungeon.name}</option>)}</select></td><td><div className={`region-scout-status ${region.scouted ? 'is-scouted' : 'is-unscouted'}`}>{region.scouted ? 'Scouted' : 'Unscouted'}</div></td><td><div className="region-actions-cell"><button type="button" className="region-save-btn" disabled={!changed || pending} onClick={() => onSave(region)}>{pending ? 'Saving…' : 'Save'}</button>{current ? <Link to={`/admin/dungeons/${current}`} className="region-edit-link">Edit Dungeon</Link> : null}</div></td></tr>; })}</tbody></table></div></section>;
}

function findDuplicates(objects: readonly WorldObject[]): { readonly duplicateIds: ReadonlySet<string>; readonly extras: readonly WorldObject[] } {
  const duplicateIds = new Set<string>();
  const extras = new Map<string, WorldObject>();
  for (let leftIndex = 0; leftIndex < objects.length; leftIndex += 1) {
    const left = objects[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < objects.length; rightIndex += 1) {
      const right = objects[rightIndex];
      if (!right || angularDistance(left, right) >= DUPLICATE_DEGREES) continue;
      const keep = left.createdAt <= right.createdAt ? left : right;
      const extra = keep.id === left.id ? right : left;
      duplicateIds.add(left.id);
      duplicateIds.add(right.id);
      extras.set(extra.id, extra);
    }
  }
  return { duplicateIds, extras: [...extras.values()].sort((a, b) => a.createdAt - b.createdAt) };
}

function angularDistance(left: Pick<WorldObject, 'lat' | 'lon'>, right: Pick<WorldObject, 'lat' | 'lon'>): number {
  const latA = radians(left.lat);
  const latB = radians(right.lat);
  const dLat = radians(right.lat - left.lat);
  const dLon = radians(right.lon - left.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
  return (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 180) / Math.PI;
}

function bodyFromForm(form: FormData, object: WorldObject): EditableWorldObject {
  const label = textValue(form, 'label');
  const questId = textValue(form, 'questId');
  const dungeonId = textValue(form, 'dungeonId');
  const lat = clamp(numberValue(form, 'lat', object.lat), -90, 90);
  const lon = clamp(numberValue(form, 'lon', object.lon), -180, 180);
  return { x: Math.round(lon / 10), y: Math.round(lat / 10), lat, lon, kind: toWorldObjectKind(String(form.get('kind') ?? object.kind)), scale: numberValue(form, 'scale', object.scale), tint: String(form.get('tint') ?? KIND_TINT[object.kind]), passable: form.get('passable') === 'on', ...(label ? { label } : {}), ...(questId ? { questId } : {}), ...(dungeonId ? { dungeonId } : {}) };
}

function textValue(form: FormData, key: string): string | null { const value = form.get(key); return typeof value === 'string' && value.trim() ? value.trim() : null; }
function numberValue(form: FormData, key: string, fallback: number): number { const value = Number(form.get(key)); return Number.isFinite(value) ? value : fallback; }
function radians(value: number): number { return (value * Math.PI) / 180; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function toWorldObjectKind(value: string): WorldObjectKind {
  switch (value) {
    case 'mountain':
    case 'tower':
    case 'city':
    case 'ruin':
    case 'shrine':
    case 'obelisk':
      return value;
    default:
      return 'mountain';
  }
}
