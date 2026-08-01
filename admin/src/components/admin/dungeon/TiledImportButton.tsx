import { useMutation, useQuery } from '@tanstack/react-query';
import type { ChangeEvent, JSX } from 'react';
import { useState } from 'react';

import { BIOMES, type Biome, getObjectClass, isObjectGroup, isTileLayer, tiledTilesetKey, type TiledMap, type TiledTileset } from '@digiworld/shared';

import { importAdminDungeonTiled, importAdminDungeonTiledReplace } from '../../../lib/api-dungeon-admin';
import { listAdminTilesets } from '../../../lib/api-tilesets';
import { ErrorText, Field } from '../AdminShared';

type TilesetRequirement = {
  readonly name: string;
  readonly firstgid: number;
  readonly inLibrary: boolean;
};

type PoiCounts = {
  readonly tiles: number;
  readonly spawn: number;
  readonly encounter: number;
  readonly item: number;
  readonly door: number;
  readonly warp: number;
  readonly trap: number;
  readonly unknown: number;
  readonly width: number;
  readonly height: number;
  readonly tilesetNames: readonly string[];
};

type TiledImportButtonProps =
  | { readonly mode: 'new'; readonly onImported?: (dungeonId: string) => void }
  | { readonly mode: 'replace'; readonly dungeonId: string; readonly onImported?: () => void };

export function TiledImportButton(props: TiledImportButtonProps): JSX.Element {
  const [tiledJson, setTiledJson] = useState<unknown>(null);
  const [counts, setCounts] = useState<PoiCounts | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [name, setName] = useState('');
  const [biome, setBiome] = useState<Biome>('forest');
  const [description, setDescription] = useState('');

  const tilesetsQuery = useQuery({ queryKey: ['admin', 'tilesets'] as const, queryFn: listAdminTilesets, staleTime: 30_000 });

  const importNew = useMutation({
    mutationFn: importAdminDungeonTiled,
    onSuccess: (res) => {
      setWarnings(res.warnings);
      if (props.mode === 'new') props.onImported?.(res.dungeon.id);
    },
  });

  const importReplace = useMutation({
    mutationFn: (json: unknown) => importAdminDungeonTiledReplace(props.mode === 'replace' ? props.dungeonId : '', json),
    onSuccess: (res) => {
      setWarnings(res.warnings);
      if (props.mode === 'replace') props.onImported?.();
    },
  });

  const isPending = importNew.isPending || importReplace.isPending;
  const backendError = importNew.error ?? importReplace.error;

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    setParseError(null);
    setWarnings([]);
    importNew.reset();
    importReplace.reset();
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setTiledJson(null);
      setCounts(null);
      return;
    }
    try {
      const text = await file.text();
      const json: unknown = JSON.parse(text);
      const preview = computeCounts(json);
      if (preview === null) {
        setParseError('This file does not look like a Tiled JSON map.');
        setTiledJson(null);
        setCounts(null);
        return;
      }
      setTiledJson(json);
      setCounts(preview);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Could not read the file.');
      setTiledJson(null);
      setCounts(null);
    }
  };

  const handleSubmit = (): void => {
    if (tiledJson === null) return;
    if (props.mode === 'new') {
      importNew.mutate({ tiledJson, name: name.trim(), biome, ...(description.trim() ? { description: description.trim() } : {}) });
    } else {
      importReplace.mutate(tiledJson);
    }
  };

  const libraryNames = new Set((tilesetsQuery.data?.tilesets ?? []).map((t) => t.name));
  const requirements: readonly TilesetRequirement[] = counts === null
    ? []
    : counts.tilesetNames.map((n) => ({ name: n, firstgid: 0, inLibrary: libraryNames.has(n) }));
  const missingTilesets = requirements.filter((r) => !r.inLibrary);

  const canSubmit = tiledJson !== null && missingTilesets.length === 0 && (props.mode === 'replace' || name.trim().length > 0);

  return (
    <div className="tiled-import" style={{ padding: '14px', border: '1px solid var(--hair)', background: 'var(--panel)' }}>
      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
          <span className="btn btn--secondary btn--sm">Choose Tiled JSON…</span>
          <input type="file" accept=".json,application/json" onChange={onFileChange} style={{ display: 'none' }} />
          <span className="muted">{counts !== null ? `${counts.width}×${counts.height} map loaded` : 'No file selected'}</span>
        </label>
      </div>

      {parseError !== null ? <ErrorText error={new Error(parseError)} /> : null}
      <ErrorText error={backendError} />

      {counts !== null ? (
        <div style={{ marginBottom: '12px' }}>
          <div className="muted" style={{ marginBottom: '6px' }}>Detected content:</div>
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            <li><b>{counts.tiles}</b> walkable tiles</li>
            <li>
              <b>{counts.spawn}</b> spawn {counts.spawn === 1 ? 'point' : 'points'}
              {counts.spawn === 0 ? <span className="muted"> — will use first walkable tile; adjust with the SPAWN tool</span> : null}
              {counts.spawn > 1 ? <span style={{ color: 'var(--signal)' }}> ⚠️ extras ignored (first one wins)</span> : null}
            </li>
            <li><b>{counts.encounter}</b> encounters</li>
            <li><b>{counts.item}</b> item drops</li>
            <li><b>{counts.door}</b> doors</li>
            <li><b>{counts.warp}</b> warps</li>
            <li><b>{counts.trap}</b> traps</li>
            {counts.unknown > 0 ? <li className="muted">{counts.unknown} objects with unrecognized class (will be skipped)</li> : null}
          </ul>
        </div>
      ) : null}

      {counts !== null && requirements.length > 0 ? (
        <div style={{ marginBottom: '12px', padding: '10px', border: `1px solid ${missingTilesets.length > 0 ? 'var(--signal)' : 'var(--hair)'}`, background: 'var(--panel)' }}>
          <div style={{ marginBottom: '6px' }}><b>Referenced tilesets ({requirements.length})</b></div>
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {requirements.map((r) => (
              <li key={r.name} style={{ color: r.inLibrary ? 'inherit' : 'var(--signal)' }}>
                <code>{r.name}</code> {r.inLibrary ? '✓ in library' : '⚠️ missing — upload it in Admin → Tilesets first'}
              </li>
            ))}
          </ul>
          {missingTilesets.length > 0 ? (
            <div style={{ marginTop: '8px', fontSize: '12px' }} className="muted">
              Import is blocked until every referenced tileset is uploaded. The name must match exactly.
            </div>
          ) : null}
        </div>
      ) : counts !== null ? (
        <div className="muted" style={{ marginBottom: '12px', fontSize: '12px' }}>Map references no tilesets — walkable cells will render with the fallback CSS style.</div>
      ) : null}

      {counts !== null && props.mode === 'new' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '12px' }}>
          <Field label="Dungeon name">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Verdant Reach Trial" required />
          </Field>
          <Field label="Biome (fallback if map has no biome property)">
            <select value={biome} onChange={(e) => setBiome(e.target.value as Biome)}>
              {BIOMES.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Description (optional)">
              <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A shrine in the digital woods…" />
            </Field>
          </div>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="muted" style={{ marginBottom: '12px', padding: '10px', border: '1px dashed var(--hair)' }}>
          <div style={{ marginBottom: '4px' }}><b>Import succeeded with warnings:</b></div>
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="admin-section-actions">
        <button type="button" className="btn btn--primary" disabled={!canSubmit || isPending} onClick={handleSubmit}>
          {isPending ? 'Importing…' : props.mode === 'new' ? 'Create dungeon from Tiled' : 'Replace contents from Tiled'}
        </button>
      </div>
    </div>
  );
}

function computeCounts(json: unknown): PoiCounts | null {
  if (typeof json !== 'object' || json === null) return null;
  const map = json as Partial<TiledMap>;
  if (typeof map.width !== 'number' || typeof map.height !== 'number' || !Array.isArray(map.layers)) return null;
  const counts = {
    tiles: 0,
    spawn: 0,
    encounter: 0,
    item: 0,
    door: 0,
    warp: 0,
    trap: 0,
    unknown: 0,
    width: map.width,
    height: map.height,
    tilesetNames: extractTilesetNames(map.tilesets),
  };
  for (const layer of map.layers) {
    if (isTileLayer(layer)) {
      for (const cell of layer.data) if (cell !== 0) counts.tiles += 1;
    } else if (isObjectGroup(layer)) {
      for (const obj of layer.objects) {
        const cls = getObjectClass(obj);
        switch (cls) {
          case 'spawn': counts.spawn += 1; break;
          case 'encounter': counts.encounter += 1; break;
          case 'item': counts.item += 1; break;
          case 'door': counts.door += 1; break;
          case 'warp': counts.warp += 1; break;
          case 'trap': counts.trap += 1; break;
          default: counts.unknown += 1;
        }
      }
    }
  }
  return counts;
}

function extractTilesetNames(raw: readonly TiledTileset[] | undefined): readonly string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ts of raw) {
    const name = tiledTilesetKey(ts);
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
