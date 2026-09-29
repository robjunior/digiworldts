import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorldObject } from '@digiworld/shared';
import type { PvePlace, PvePlaceInput } from '@digiworld/shared/pve';
import { AdminGuard } from '../components/admin/AdminGuard';
import { AdminWorldGlobe } from '../components/admin/AdminWorldGlobe';
import { getCatalog } from '../lib/api-admin';
import { getPvePlaces, savePvePlace } from '../lib/api-pve';
import '../styles/extensions-admin.css';
import '../styles/world-location-editor.css';

type Tool = 'SELECT' | 'PLACE';
const empty: PvePlaceInput = { id: '', name: '', description: '', x: 50, y: 50, explorePool: [], expeditionPool: [], minWildLevel: 1, maxWildLevel: 99, maxWildStage: 'Mega', enabled: true };
const toLatLon = (x: number, y: number): { lat: number; lon: number } => ({ lat: 54 - y * 0.72, lon: x * 3.6 - 180 });
const toXY = (lat: number, lon: number): { x: number; y: number } => ({ x: Math.max(0, Math.min(100, (lon + 180) / 3.6)), y: Math.max(0, Math.min(100, (54 - lat) / 0.72)) });

export function AdminWorld(): JSX.Element {
  const client = useQueryClient();
  const places = useQuery({ queryKey: ['admin', 'pve-places'], queryFn: getPvePlaces });
  const catalog = useQuery({ queryKey: ['admin', 'catalog'], queryFn: getCatalog });
  const [tool, setTool] = useState<Tool>('SELECT');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PvePlaceInput>(empty);
  const [nameFilter, setNameFilter] = useState('');
  const [elementFilter, setElementFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const placeList = places.data?.places ?? [];
  const selected = placeList.find((place) => place.id === selectedId) ?? null;
  const objects = useMemo<readonly WorldObject[]>(() => placeList.map((place) => ({
    id: place.id, ...toLatLon(place.x, place.y), x: place.x, y: place.y, kind: 'city', scale: 1, passable: true,
    label: place.name, minLevel: place.minWildLevel, maxLevel: place.maxWildLevel, createdAt: place.createdAt, updatedAt: place.updatedAt,
  })), [placeList]);
  const save = useMutation({ mutationFn: (input: PvePlaceInput) => savePvePlace(input), onSuccess: ({ place }) => { void client.invalidateQueries({ queryKey: ['admin', 'pve-places'] }); setSelectedId(place.id); setDraft(place); setTool('SELECT'); } });
  const select = (id: string | null): void => { setSelectedId(id); const place = placeList.find((entry) => entry.id === id); if (place) setDraft(place); };
  const placeAt = (point: { lat: number; lon: number }): void => { const xy = toXY(point.lat, point.lon); setDraft({ ...empty, id: `place-${Date.now()}`, name: 'New location', x: xy.x, y: xy.y }); setTool('SELECT'); };
  const togglePool = (pool: 'explorePool' | 'expeditionPool', catalogId: string): void => setDraft((current) => ({ ...current, [pool]: current[pool].some((entry) => entry.catalogId === catalogId) ? current[pool].filter((entry) => entry.catalogId !== catalogId) : [...current[pool], { catalogId, weight: 1 }] }));
  const visibleCatalog = (catalog.data?.digimons ?? []).filter((entry) => (entry.status ?? 'published') === 'published' && (!nameFilter.trim() || entry.name.toLowerCase().includes(nameFilter.trim().toLowerCase())) && (elementFilter === 'all' || entry.element === elementFilter) && (stageFilter === 'all' || entry.stage === stageFilter));
  const submit = (): void => { if (!draft.id.trim() || !draft.name.trim()) return; save.mutate(draft); };
  return <AdminGuard><main className="main admin-world-layout"><div className="admin-world-map-shell"><div className="admin-world-header"><div><h2>World Location Editor</h2><p>Place and edit PvE locations on the globe.</p></div></div><AdminWorldGlobe objects={objects} regions={[]} selectedId={selectedId} tool={tool} duplicateIds={new Set()} onSelect={select} onPlace={placeAt} /><aside className="admin-world-floating-panel" aria-label="Location editor"><div className="admin-world-panel-head"><div><h2>Locations</h2><span>{placeList.length} configured</span></div></div><div className="layer-picker tool-picker"><button type="button" className={tool === 'SELECT' ? 'is-active' : ''} onClick={() => setTool('SELECT')}>SELECT</button><button type="button" className={tool === 'PLACE' ? 'is-active' : ''} onClick={() => setTool('PLACE')}>PLACE</button></div><div className="admin-editor-panel">{selected ? <p className="muted">Editing {selected.name}</p> : <p className="muted">Select a location or use PLACE on the globe.</p>}<label>ID<input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} /></label><label>Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><div className="form-grid"><label>Min level<input type="number" min="1" value={draft.minWildLevel ?? 1} onChange={(event) => setDraft({ ...draft, minWildLevel: Number(event.target.value) })} /></label><label>Max level<input type="number" min="1" value={draft.maxWildLevel ?? 99} onChange={(event) => setDraft({ ...draft, maxWildLevel: Number(event.target.value) })} /></label></div><div className="form-grid"><label>Find Digimon<input value={nameFilter} placeholder="Name" onChange={(event) => setNameFilter(event.target.value)} /></label><label>Element<select value={elementFilter} onChange={(event) => setElementFilter(event.target.value)}><option value="all">All elements</option>{['fire','water','plant','electricity','ice','earth','steel','wind','light','dark','null'].map((element) => <option key={element} value={element}>{element}</option>)}</select></label><label>Stage<select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="all">All stages</option>{['Rookie','Champion','Ultimate','Mega','Ultra'].map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></label></div><h4>Explore pool</h4><div className="world-pool-list">{visibleCatalog.map((entry) => <button type="button" key={`explore-${entry.id}`} className={`btn btn--sm ${draft.explorePool.some((poolEntry) => poolEntry.catalogId === entry.id) ? 'btn--primary' : 'btn--secondary'}`} onClick={() => togglePool('explorePool', entry.id)}>{entry.name} · {entry.element} · {entry.stage} · ENABLED</button>)}</div><h4>Expedition pool</h4><div className="world-pool-list">{visibleCatalog.map((entry) => <button type="button" key={`expedition-${entry.id}`} className={`btn btn--sm ${draft.expeditionPool.some((poolEntry) => poolEntry.catalogId === entry.id) ? 'btn--primary' : 'btn--secondary'}`} onClick={() => togglePool('expeditionPool', entry.id)}>{entry.name} · {entry.element} · {entry.stage} · ENABLED</button>)}</div><button type="button" className="btn btn--primary" disabled={save.isPending || !draft.id || !draft.name} onClick={submit}>{save.isPending ? 'Saving…' : 'Save location'}</button></div><div className="rlist">{placeList.map((place) => <button type="button" className={`rrow${place.id === selectedId ? ' sel' : ''}`} key={place.id} onClick={() => select(place.id)}><span className="rdot" /><span className="rnm">{place.name}<span className="rsub">Lv {place.minWildLevel}–{place.maxWildLevel}</span></span></button>)}</div></aside></div></main></AdminGuard>;
}
