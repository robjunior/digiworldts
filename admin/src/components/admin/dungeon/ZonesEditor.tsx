import { useEffect, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { TemplateDigimon } from '@digiworld/shared/digimon';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import { WildPoolEditor } from './WildPoolEditor';
import { getDungeonZones, replaceDungeonZones, type ZoneInputBody } from '../../../lib/api-dungeon-admin';

const ZONES_QUERY = (dungeonId: string) => ['admin', 'dungeon', dungeonId, 'zones'] as const;

type Draft = ZoneInputBody;

export function ZonesEditor({
  dungeonId,
  catalog,
}: {
  readonly dungeonId: string;
  readonly catalog: readonly TemplateDigimon[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const zonesQuery = useQuery({
    queryKey: ZONES_QUERY(dungeonId),
    queryFn: () => getDungeonZones(dungeonId),
  });

  const [drafts, setDrafts] = useState<readonly Draft[]>([]);

  useEffect(() => {
    if (!zonesQuery.data) return;
    setDrafts(
      zonesQuery.data.zones.map((zone): Draft => ({
        name: zone.name,
        x: zone.x,
        y: zone.y,
        width: zone.width,
        height: zone.height,
        safe: zone.safe,
        pool: zone.pool,
        ...(zone.rollOverrides !== undefined ? { rollOverrides: zone.rollOverrides } : {}),
      })),
    );
  }, [zonesQuery.data]);

  const saveMut = useMutation({
    mutationFn: (zones: readonly Draft[]) => replaceDungeonZones(dungeonId, zones),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ZONES_QUERY(dungeonId) });
      void queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) });
    },
  });

  const addZone = (): void => {
    setDrafts([
      ...drafts,
      { name: `Zone ${drafts.length + 1}`, x: 0, y: 0, width: 5, height: 5, safe: false, pool: [] },
    ]);
  };

  const updateZone = (index: number, patch: Partial<Draft>): void => {
    setDrafts(drafts.map((zone, i) => (i === index ? { ...zone, ...patch } : zone)));
  };

  const removeZone = (index: number): void => {
    setDrafts(drafts.filter((_, i) => i !== index));
  };

  if (zonesQuery.isLoading) {
    return (
      <div className="admin-editor-panel">
        <p className="muted">Loading zones...</p>
      </div>
    );
  }
  if (zonesQuery.isError) {
    return (
      <div className="admin-editor-panel">
        <p className="muted">Failed to load zones.</p>
      </div>
    );
  }

  return (
    <div className="admin-editor-panel zones-editor">
      <h3>Encounter Zones</h3>
      <p className="muted">
        Rectangular regions on this dungeon's map. Precedence: <b>safe</b> → no encounter · <b>zone pool</b> → override · <b>empty zone</b> → dungeon-wide fallback.
      </p>

      {drafts.length === 0 ? (
        <p className="muted">No zones defined. Every tile uses the dungeon-wide random pool.</p>
      ) : (
        drafts.map((zone, index) => (
          <fieldset key={index} className="editor-sub-panel">
            <legend>
              {zone.name} · ({zone.x},{zone.y}) → ({zone.x + zone.width},{zone.y + zone.height})
              {zone.safe ? ' · SAFE' : zone.pool.length === 0 ? ' · fallback' : ` · pool(${zone.pool.length})`}
            </legend>
            <label>
              Name
              <input value={zone.name} onChange={(event) => updateZone(index, { name: event.target.value })} />
            </label>
            <div className="zone-coords-grid">
              <label>
                X
                <input
                  type="number"
                  min={0}
                  max={199}
                  value={zone.x}
                  onChange={(event) => updateZone(index, { x: Number(event.target.value) })}
                />
              </label>
              <label>
                Y
                <input
                  type="number"
                  min={0}
                  max={199}
                  value={zone.y}
                  onChange={(event) => updateZone(index, { y: Number(event.target.value) })}
                />
              </label>
              <label>
                Width
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={zone.width}
                  onChange={(event) => updateZone(index, { width: Number(event.target.value) })}
                />
              </label>
              <label>
                Height
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={zone.height}
                  onChange={(event) => updateZone(index, { height: Number(event.target.value) })}
                />
              </label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={zone.safe}
                onChange={(event) => updateZone(index, { safe: event.target.checked })}
              />{' '}
              Safe zone (ignore all encounter rolls, including dungeon-wide)
            </label>
            <h4>Zone pool</h4>
            <WildPoolEditor
              pool={zone.pool}
              onChange={(pool) => updateZone(index, { pool })}
              catalog={catalog}
              disabled={zone.safe}
            />
            <p className="muted">Empty pool + not safe → falls back to the dungeon-wide pool.</p>
            <button type="button" onClick={() => removeZone(index)} className="danger">
              Delete zone
            </button>
          </fieldset>
        ))
      )}

      <div className="admin-poi-actions">
        <button type="button" onClick={addZone}>
          + Add zone
        </button>
        <button type="button" onClick={() => saveMut.mutate(drafts)} disabled={saveMut.isPending}>
          {saveMut.isPending ? 'Saving...' : 'Save all zones'}
        </button>
        {saveMut.isSuccess ? <span className="muted">Saved.</span> : null}
        {saveMut.isError ? <span className="muted">Save failed.</span> : null}
      </div>
    </div>
  );
}
