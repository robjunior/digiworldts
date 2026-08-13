import type { FormEvent, JSX } from 'react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { DungeonBridge, DungeonDoor, DungeonTrigger, DungeonView, TilesetGrant, TriggerTargetKind } from '@digiworld/shared';
import { TRIGGER_TARGET_KINDS } from '@digiworld/shared';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import { TileGidPicker } from './TileGidPicker';
import { toOptionalText } from './utils';
import { TriggerTargetPicker, type PickedTriggerTarget } from './TriggerTargetPicker';
import { createAdminTrigger, deleteAdminTrigger, updateAdminTrigger, type AdminTriggerTargetBody } from '../../../lib/api-dungeon-admin';

export function TriggerEditor({
  dungeonId,
  x,
  y,
  trigger,
  doors,
  bridges,
  tilesets,
  dungeonGroupId,
}: {
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly trigger?: DungeonTrigger;
  readonly doors: readonly DungeonDoor[];
  readonly bridges: readonly DungeonBridge[];
  readonly tilesets: readonly TilesetGrant[];
  readonly dungeonGroupId: string | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const applyView = (result: { readonly view: DungeonView }): void => {
    queryClient.setQueryData(ADMIN_DUNGEON_QUERY(dungeonId), result.view);
  };
  const target = trigger?.targets[0] ?? null;
  const [targetKind, setTargetKind] = useState<TriggerTargetKind>(target?.kind ?? 'door');
  const [picked, setPicked] = useState<PickedTriggerTarget | null>(target === null
    ? null
    : {
        kind: target.kind,
        id: target.kind === 'door' ? (target.doorId ?? '') : (target.bridgeId ?? ''),
        dungeonId: '',
        x: 0,
        y: 0,
        label: null,
      });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unusedTileGid, setUnusedTileGid] = useState<number | null>(trigger?.unusedTileGid ?? null);
  const [usedTileGid, setUsedTileGid] = useState<number | null>(trigger?.usedTileGid ?? null);

  const createMut = useMutation({
    mutationFn: (body: { readonly x: number; readonly y: number; readonly label?: string | null; readonly unusedTileGid?: number | null; readonly usedTileGid?: number | null; readonly target: AdminTriggerTargetBody }) => createAdminTrigger(dungeonId, body),
    onSuccess: applyView,
  });
  const updateMut = useMutation({
    mutationFn: (body: { readonly label?: string | null; readonly unusedTileGid?: number | null; readonly usedTileGid?: number | null; readonly target?: AdminTriggerTargetBody }) => updateAdminTrigger(dungeonId, trigger?.id ?? '', body),
    onSuccess: applyView,
  });
  const deleteMut = useMutation({
    mutationFn: (triggerId: string) => deleteAdminTrigger(dungeonId, triggerId),
    onSuccess: applyView,
  });

  const resolvePickedLabel = (entry: PickedTriggerTarget): string => {
    if (entry.dungeonId === dungeonId) {
      if (entry.kind === 'door') {
        const door = doors.find((d) => d.id === entry.id);
        if (door) return `Door at (${door.x}, ${door.y})${door.label ? ` — ${door.label}` : ''}`;
      } else {
        const bridge = bridges.find((b) => b.id === entry.id);
        if (bridge) return `Bridge at (${bridge.x}, ${bridge.y})${bridge.label ? ` — ${bridge.label}` : ''}`;
      }
    }
    return `${entry.kind === 'door' ? 'Door' : 'Bridge'} on another map`;
  };

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = toOptionalText(form.get('label'));
    if (picked === null) return;
    const targetBody: AdminTriggerTargetBody = picked.kind === 'door'
      ? { kind: 'door', doorId: picked.id }
      : { kind: 'bridge', bridgeId: picked.id };
    if (trigger) updateMut.mutate({ label, unusedTileGid, usedTileGid, target: targetBody });
    else createMut.mutate({ x, y, label, unusedTileGid, usedTileGid, target: targetBody });
  };

  return (
    <div className="admin-editor-panel">
      <h3>Trigger at ({x}, {y})</h3>
      <form onSubmit={save}>
        <label>
          Label
          <input name="label" defaultValue={trigger?.label ?? ''} placeholder="Optional lever label" />
        </label>
        <p className="muted">Fires once when a player steps on this tile. The target can be on another map of the same group.</p>
        <TileGidPicker label="Unused tile (lever down)" value={unusedTileGid} tilesets={tilesets} onChange={setUnusedTileGid} />
        <TileGidPicker label="Used tile (lever pulled)" value={usedTileGid} tilesets={tilesets} onChange={setUsedTileGid} />
        <fieldset>
          <legend>Activates</legend>
          <label>
            Kind
            <select
              value={targetKind}
              onChange={(event) => { setTargetKind(event.target.value as TriggerTargetKind); setPicked(null); }}
            >
              {TRIGGER_TARGET_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind === 'door' ? 'A door (opens without key)' : 'A bridge (lowers it)'}
                </option>
              ))}
            </select>
          </label>
          {picked !== null ? (
            <div className="tpt-picked">
              <span>{resolvePickedLabel(picked)}</span>
              <button type="button" onClick={() => setPickerOpen(true)}>Change…</button>
            </div>
          ) : (
            <button type="button" onClick={() => setPickerOpen(true)}>Pick {targetKind} by clicking the map…</button>
          )}
        </fieldset>
        <div className="admin-poi-actions">
          <button type="submit" disabled={picked === null || createMut.isPending || updateMut.isPending}>
            Save
          </button>
          {trigger ? (
            <button type="button" onClick={() => deleteMut.mutate(trigger.id)} disabled={deleteMut.isPending}>
              Delete
            </button>
          ) : null}
        </div>
      </form>
      {pickerOpen ? (
        <TriggerTargetPicker
          currentDungeonId={dungeonId}
          groupId={dungeonGroupId}
          kind={targetKind}
          onPicked={(entry) => { setPicked(entry); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
