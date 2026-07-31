import type { FormEvent, JSX } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { DungeonTrap, DungeonView, TrapKind } from '@digiworld/shared';
import { TRAP_KINDS } from '@digiworld/shared';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import { clamp, toOptionalText, toPositiveInt } from './utils';
import { createAdminTrap, deleteAdminTrap, updateAdminTrap } from '../../../lib/api-dungeon-admin';

const KIND_HINTS: Readonly<Record<TrapKind, string>> = {
  damage: 'All party mons lose severity% max HP',
  poison: 'Poisons the party (severity% per tick)',
  burn: 'Burns the party (severity% per tick)',
  energy_drain: 'All party mons lose severity% max EN',
  mood_loss: 'A party mon loses severity mood points',
  teleport: 'Teleports the party to a random walkable tile',
  random_encounter: 'Forces a random encounter',
};

export function TrapEditor({
  dungeonId,
  x,
  y,
  trap,
}: {
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly trap?: DungeonTrap;
}): JSX.Element {
  const queryClient = useQueryClient();
  const applyView = (result: { readonly view: DungeonView }): void => {
    queryClient.setQueryData(ADMIN_DUNGEON_QUERY(dungeonId), result.view);
  };
  const createMut = useMutation({
    mutationFn: (body: {
      readonly x: number;
      readonly y: number;
      readonly kind: TrapKind;
      readonly severity: number;
      readonly label?: string | null;
    }) => createAdminTrap(dungeonId, body),
    onSuccess: applyView,
  });
  const updateMut = useMutation({
    mutationFn: (body: { readonly kind?: TrapKind; readonly severity?: number; readonly label?: string | null }) =>
      updateAdminTrap(dungeonId, trap?.id ?? '', body),
    onSuccess: applyView,
  });
  const deleteMut = useMutation({
    mutationFn: (trapId: string) => deleteAdminTrap(dungeonId, trapId),
    onSuccess: applyView,
  });

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawKind = form.get('kind');
    const kind = TRAP_KINDS.includes(rawKind as TrapKind) ? (rawKind as TrapKind) : 'damage';
    const severity = clamp(toPositiveInt(form.get('severity'), trap?.severity ?? 10), 1, 100);
    const label = toOptionalText(form.get('label'));
    if (trap) updateMut.mutate({ kind, severity, label });
    else createMut.mutate({ x, y, kind, severity, ...(label === null ? {} : { label }) });
  };

  return (
    <div className="admin-editor-panel">
      <h3>Trap at ({x}, {y})</h3>
      <form onSubmit={save}>
        <label>
          Kind
          <select name="kind" defaultValue={trap?.kind ?? 'damage'}>
            {TRAP_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity (1-100)
          <input name="severity" type="number" min={1} max={100} defaultValue={trap?.severity ?? 10} />
        </label>
        <label>
          Label
          <input name="label" defaultValue={trap?.label ?? ''} placeholder="Optional trap label" />
        </label>
        <p className="muted">{KIND_HINTS[trap?.kind ?? 'damage']}</p>
        <div className="admin-poi-actions">
          <button type="submit" disabled={createMut.isPending || updateMut.isPending}>
            Save
          </button>
          {trap ? (
            <button type="button" onClick={() => deleteMut.mutate(trap.id)} disabled={deleteMut.isPending}>
              Delete
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
