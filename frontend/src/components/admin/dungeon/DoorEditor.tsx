import type { FormEvent, JSX } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { DungeonDoor, DungeonView } from '@digiworld/shared';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import { toOptionalText } from './utils';
import { createAdminDoor, deleteAdminDoor, updateAdminDoor } from '../../../lib/api-dungeon-admin';
import type { ShopItemView } from '../../../lib/api-admin';

export function DoorEditor({
  dungeonId,
  x,
  y,
  door,
  shopItems,
}: {
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly door?: DungeonDoor;
  readonly shopItems: readonly ShopItemView[];
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
      readonly label?: string | null;
    }) => createAdminDoor(dungeonId, body),
    onSuccess: applyView,
  });
  const updateMut = useMutation({
    mutationFn: (body: { readonly keyItemId?: string; readonly label?: string | null }) =>
      updateAdminDoor(dungeonId, door?.id ?? '', body),
    onSuccess: applyView,
  });
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
    if (door) updateMut.mutate({ keyItemId, label });
    else createMut.mutate({ x, y, keyItemId, ...(label === null ? {} : { label }) });
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
