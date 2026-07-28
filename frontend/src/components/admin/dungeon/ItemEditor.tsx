import type { JSX } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { DungeonItem } from '@digiworld/shared';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import { createAdminItem, deleteAdminItem } from '../../../lib/api-dungeon-admin';

export function ItemEditor({
  dungeonId,
  x,
  y,
  item,
}: {
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly item?: DungeonItem;
}): JSX.Element {
  const queryClient = useQueryClient();
  const createMut = useMutation({
    mutationFn: (body: { readonly x: number; readonly y: number; readonly itemId: string; readonly qty: number }) =>
      createAdminItem(dungeonId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }),
  });
  const deleteMut = useMutation({
    mutationFn: (itemId: string) => deleteAdminItem(dungeonId, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) }),
  });

  if (!item && !createMut.isPending) {
    return (
      <div>
        <h3>No Item at {x},{y}</h3>
        <button type="button" onClick={() => createMut.mutate({ x, y, itemId: 'hp_potion', qty: 1 })}>
          Add Item
        </button>
      </div>
    );
  }
  if (!item) return <div>Creating...</div>;

  return (
    <div className="admin-editor-panel">
      <h3>Item</h3>
      <p>ItemId: {item.itemId}</p>
      <p>Qty: {item.qty}</p>
      <button type="button" onClick={() => deleteMut.mutate(item.id)}>
        Delete
      </button>
    </div>
  );
}
