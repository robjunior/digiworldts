import type { FormEvent, JSX } from 'react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { DungeonBridge, DungeonView, TilesetGrant } from '@digiworld/shared';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import { TileGidPicker } from './TileGidPicker';
import { toOptionalText } from './utils';
import { createAdminBridge, deleteAdminBridge, updateAdminBridge } from '../../../lib/api-dungeon-admin';

export function BridgeEditor({
  dungeonId,
  x,
  y,
  bridge,
  tilesets,
}: {
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly bridge?: DungeonBridge;
  readonly tilesets: readonly TilesetGrant[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const applyView = (result: { readonly view: DungeonView }): void => {
    queryClient.setQueryData(ADMIN_DUNGEON_QUERY(dungeonId), result.view);
  };
  const createMut = useMutation({
    mutationFn: (body: { readonly x: number; readonly y: number; readonly downTileGid?: number | null; readonly upTileGid?: number | null; readonly label?: string | null }) => createAdminBridge(dungeonId, body),
    onSuccess: applyView,
  });
  const updateMut = useMutation({
    mutationFn: (body: { readonly downTileGid?: number | null; readonly upTileGid?: number | null; readonly label?: string | null }) => updateAdminBridge(dungeonId, bridge?.id ?? '', body),
    onSuccess: applyView,
  });
  const [downTileGid, setDownTileGid] = useState<number | null>(bridge?.downTileGid ?? null);
  const [upTileGid, setUpTileGid] = useState<number | null>(bridge?.upTileGid ?? null);
  const deleteMut = useMutation({
    mutationFn: (bridgeId: string) => deleteAdminBridge(dungeonId, bridgeId),
    onSuccess: applyView,
  });

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = toOptionalText(form.get('label'));
    if (bridge) updateMut.mutate({ downTileGid, upTileGid, label });
    else createMut.mutate({ x, y, downTileGid, upTileGid, ...(label === null ? {} : { label }) });
  };

  return (
    <div className="admin-editor-panel">
      <h3>Bridge at ({x}, {y})</h3>
      <form onSubmit={save}>
        <p className="muted">Place the bridge on the gap tile. While up it blocks the tile; a lever target lowers it (down = walkable).</p>
        <label>
          Label
          <input name="label" defaultValue={bridge?.label ?? ''} placeholder="Optional bridge label" />
        </label>
        <TileGidPicker label="Down tile (walkable)" value={downTileGid} tilesets={tilesets} onChange={setDownTileGid} />
        <TileGidPicker label="Up tile (blocked)" value={upTileGid} tilesets={tilesets} onChange={setUpTileGid} />
        <div className="admin-poi-actions">
          <button type="submit" disabled={createMut.isPending || updateMut.isPending}>
            Save
          </button>
          {bridge ? (
            <button type="button" onClick={() => deleteMut.mutate(bridge.id)} disabled={deleteMut.isPending}>
              Delete
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
