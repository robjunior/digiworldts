import type { FormEvent, JSX } from 'react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { DungeonDoor, DungeonView, TilesetGrant } from '@digiworld/shared';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import { TileGidPicker } from './TileGidPicker';
import { toOptionalText } from './utils';
import { createAdminDoor, deleteAdminDoor, updateAdminDoor } from '../../../lib/api-dungeon-admin';
import type { ShopItemView } from '../../../lib/api-admin';

export function DoorEditor({
  dungeonId,
  x,
  y,
  door,
  shopItems,
  tilesets,
}: {
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly door?: DungeonDoor;
  readonly shopItems: readonly ShopItemView[];
  readonly tilesets: readonly TilesetGrant[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const applyView = (result: { readonly view: DungeonView }): void => {
    queryClient.setQueryData(ADMIN_DUNGEON_QUERY(dungeonId), result.view);
  };
  const createMut = useMutation({
    mutationFn: (body: {
      readonly x: number;
      readonly y: number;
      readonly keyItemId: string;
      readonly dungeonKeyId?: string | null;
      readonly unusedTileGid?: number | null;
      readonly usedTileGid?: number | null;
      readonly label?: string | null;
    }) => createAdminDoor(dungeonId, body),
    onSuccess: applyView,
  });
  const updateMut = useMutation({
    mutationFn: (body: { readonly keyItemId?: string; readonly dungeonKeyId?: string | null; readonly unusedTileGid?: number | null; readonly usedTileGid?: number | null; readonly label?: string | null }) =>
      updateAdminDoor(dungeonId, door?.id ?? '', body),
    onSuccess: applyView,
  });
  const [useDungeonKey, setUseDungeonKey] = useState<boolean>(door?.dungeonKeyId !== null && door?.dungeonKeyId !== undefined);
  const [unusedTileGid, setUnusedTileGid] = useState<number | null>(door?.unusedTileGid ?? null);
  const [usedTileGid, setUsedTileGid] = useState<number | null>(door?.usedTileGid ?? null);
  const deleteMut = useMutation({
    mutationFn: (doorId: string) => deleteAdminDoor(dungeonId, doorId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }),
  });

  const fallbackKeyItemId = door?.keyItemId ?? shopItems[0]?.id ?? '';
  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const keyItemId = toOptionalText(form.get('keyItemId')) ?? fallbackKeyItemId;
    const label = toOptionalText(form.get('label'));
    if (!keyItemId) return;
    const dungeonKeyId = useDungeonKey ? 'auto' : null;
    if (door) updateMut.mutate({ keyItemId, dungeonKeyId, unusedTileGid, usedTileGid, label });
    else createMut.mutate({ x, y, keyItemId, dungeonKeyId, unusedTileGid, usedTileGid, ...(label === null ? {} : { label }) });
  };

  if (shopItems.length === 0) {
    return (
      <div className="admin-editor-panel">
        <h3>Door at ({x}, {y})</h3>
        <p>No shop items exist yet. Create a consumable key in the Shop Admin tab first.</p>
      </div>
    );
  }

  return (
    <div className="admin-editor-panel">
      <h3>Door at ({x}, {y})</h3>
      <form onSubmit={save}>
        <label>
          Key item
          <select name="keyItemId" defaultValue={fallbackKeyItemId}>
            {shopItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.id})
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={useDungeonKey} onChange={(event) => setUseDungeonKey(event.target.checked)} /> Use dungeon-scoped generated key
        </label>
        <TileGidPicker label="Unused tile (closed)" value={unusedTileGid} tilesets={tilesets} onChange={setUnusedTileGid} />
        <TileGidPicker label="Used tile (open)" value={usedTileGid} tilesets={tilesets} onChange={setUsedTileGid} />
        <label>
          Label
          <input name="label" defaultValue={door?.label ?? ''} placeholder="Optional door label" />
        </label>
        <div className="admin-poi-actions">
          <button type="submit" disabled={createMut.isPending || updateMut.isPending}>
            Save
          </button>
          {door ? (
            <button type="button" onClick={() => deleteMut.mutate(door.id)} disabled={deleteMut.isPending}>
              Delete
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
