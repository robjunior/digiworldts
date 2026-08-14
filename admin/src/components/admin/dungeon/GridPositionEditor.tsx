import type { FormEvent, JSX } from 'react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { Dungeon, DungeonView } from '@digiworld/shared';

import { updateAdminDungeon } from '../../../lib/api-dungeon-admin';
import { ADMIN_DUNGEON_QUERY } from './query-keys';

function optionalInteger(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

export function GridPositionEditor({ dungeon }: { readonly dungeon: Dungeon }): JSX.Element {
  const queryClient = useQueryClient();
  const [groupId, setGroupId] = useState(dungeon.dungeonGroupId ?? '');
  const [floorIndex, setFloorIndex] = useState(dungeon.floorIndex?.toString() ?? '');
  const [gridX, setGridX] = useState(dungeon.gridX?.toString() ?? '');
  const [gridY, setGridY] = useState(dungeon.gridY?.toString() ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: {
      readonly dungeonGroupId: string | null;
      readonly floorIndex: number | null;
      readonly gridX: number | null;
      readonly gridY: number | null;
    }) => updateAdminDungeon(dungeon.id, body),
    onSuccess: ({ dungeon: updated }) => {
      queryClient.setQueryData<DungeonView>(ADMIN_DUNGEON_QUERY(dungeon.id), (old) => old ? { ...old, dungeon: updated } : old);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'dungeons'] });
      setValidationError(null);
    },
  });

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextGroupId = groupId.trim() === '' ? null : groupId.trim();
    const nextX = optionalInteger(gridX);
    const nextY = optionalInteger(gridY);
    if ((nextX === null) !== (nextY === null)) {
      setValidationError('Preencha X e Y juntos.');
      return;
    }
    if (nextGroupId === null && (nextX !== null || nextY !== null)) {
      setValidationError('A grade exige um dungeonGroupId.');
      return;
    }
    mutation.mutate({
      dungeonGroupId: nextGroupId,
      floorIndex: optionalInteger(floorIndex),
      gridX: nextGroupId === null ? null : nextX,
      gridY: nextGroupId === null ? null : nextY,
    });
  };

  return (
    <form className="admin-editor-panel" onSubmit={save}>
      <h3>Continuous grid</h3>
      <p className="muted">Use the same group and unique X/Y coordinates for orthogonal neighbors.</p>
      <label>
        Dungeon group
        <input value={groupId} onChange={(event) => setGroupId(event.target.value)} placeholder="forest-trial" />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
        <label>
          Floor
          <input type="number" value={floorIndex} onChange={(event) => setFloorIndex(event.target.value)} placeholder="-" />
        </label>
        <label>
          Grid X
          <input type="number" value={gridX} onChange={(event) => setGridX(event.target.value)} placeholder="-" />
        </label>
        <label>
          Grid Y
          <input type="number" value={gridY} onChange={(event) => setGridY(event.target.value)} placeholder="-" />
        </label>
      </div>
      {validationError ? <p className="error-text">{validationError}</p> : null}
      {mutation.error instanceof Error ? <p className="error-text">{mutation.error.message}</p> : null}
      <button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? 'Saving…' : 'Save grid position'}
      </button>
    </form>
  );
}
