import type { FormEvent, JSX } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { DungeonView, DungeonWarp } from '@digiworld/shared';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import { toOptionalText } from './utils';
import { createAdminWarp, deleteAdminWarp, updateAdminWarp } from '../../../lib/api-dungeon-admin';

export function WarpEditor({
  dungeonId,
  x,
  y,
  warp,
  dungeons,
}: {
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly warp?: DungeonWarp;
  readonly dungeons: readonly { readonly id: string; readonly name: string }[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const applyView = (view: DungeonView): void => {
    queryClient.setQueryData(ADMIN_DUNGEON_QUERY(dungeonId), view);
  };
  const createMut = useMutation({
    mutationFn: (body: {
      readonly x: number;
      readonly y: number;
      readonly targetDungeonId?: string | null;
      readonly label?: string | null;
    }) => createAdminWarp(dungeonId, body),
    onSuccess: applyView,
  });
  const updateMut = useMutation({
    mutationFn: (body: { readonly targetDungeonId?: string | null; readonly label?: string | null }) =>
      updateAdminWarp(dungeonId, warp?.id ?? '', body),
    onSuccess: applyView,
  });
  const deleteMut = useMutation({
    mutationFn: (warpId: string) => deleteAdminWarp(dungeonId, warpId),
    onSuccess: applyView,
  });

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const target = toOptionalText(form.get('targetDungeonId'));
    const label = toOptionalText(form.get('label'));
    const body = { targetDungeonId: target, ...(label === null ? {} : { label }) };
    if (warp) updateMut.mutate(body);
    else createMut.mutate({ x, y, ...body });
  };

  return (
    <div className="admin-editor-panel">
      <h3>Warp at ({x}, {y})</h3>
      <form onSubmit={save}>
        <label>
          Target
          <select name="targetDungeonId" defaultValue={warp?.targetDungeonId ?? ''}>
            <option value="">— Exit to world —</option>
            {dungeons.map((dungeon) => (
              <option key={dungeon.id} value={dungeon.id}>
                {dungeon.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Label
          <input name="label" defaultValue={warp?.label ?? ''} placeholder="Optional label" />
        </label>
        <div className="admin-poi-actions">
          <button type="submit" disabled={createMut.isPending || updateMut.isPending}>
            Save
          </button>
          {warp ? (
            <button type="button" onClick={() => deleteMut.mutate(warp.id)} disabled={deleteMut.isPending}>
              Delete
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
