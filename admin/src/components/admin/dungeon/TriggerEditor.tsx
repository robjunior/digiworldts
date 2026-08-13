import type { FormEvent, JSX } from 'react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { DungeonDoor, DungeonTrigger, DungeonView, TilesetGrant, TriggerTargetKind } from '@digiworld/shared';
import { TRIGGER_TARGET_KINDS } from '@digiworld/shared';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import { TileGidPicker } from './TileGidPicker';
import { toOptionalText, toPositiveInt } from './utils';
import { createAdminTrigger, deleteAdminTrigger, updateAdminTrigger, type AdminTriggerTargetBody } from '../../../lib/api-dungeon-admin';

export function TriggerEditor({
  dungeonId,
  x,
  y,
  trigger,
  doors,
  tilesets,
}: {
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly trigger?: DungeonTrigger;
  readonly doors: readonly DungeonDoor[];
  readonly tilesets: readonly TilesetGrant[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const applyView = (result: { readonly view: DungeonView }): void => {
    queryClient.setQueryData(ADMIN_DUNGEON_QUERY(dungeonId), result.view);
  };
  const target = trigger?.targets[0] ?? null;
  const [targetKind, setTargetKind] = useState<TriggerTargetKind>(target?.kind ?? 'door');
  const [doorId, setDoorId] = useState<string>(target?.doorId ?? doors[0]?.id ?? '');
  const [bridgeX, setBridgeX] = useState<number>(target?.targetX ?? 0);
  const [bridgeY, setBridgeY] = useState<number>(target?.targetY ?? 0);
  const [bridgeTileGid, setBridgeTileGid] = useState<number | null>(target?.usedTileGid ?? null);
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

  const buildTarget = (): AdminTriggerTargetBody | null => {
    if (targetKind === 'door') {
      if (!doorId) return null;
      return { kind: 'door', doorId };
    }
    return { kind: 'bridge', targetX: bridgeX, targetY: bridgeY, usedTileGid: bridgeTileGid };
  };

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = toOptionalText(form.get('label'));
    const targetBody = buildTarget();
    if (targetBody === null) return;
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
        <p className="muted">Fires once when a player steps on this tile.</p>
        <TileGidPicker label="Unused tile (lever down)" value={unusedTileGid} tilesets={tilesets} onChange={setUnusedTileGid} />
        <TileGidPicker label="Used tile (lever pulled)" value={usedTileGid} tilesets={tilesets} onChange={setUsedTileGid} />
        <fieldset>
          <legend>Activates</legend>
          <label>
            Kind
            <select
              value={targetKind}
              onChange={(event) => setTargetKind(event.target.value as TriggerTargetKind)}
            >
              {TRIGGER_TARGET_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind === 'door' ? 'A door (opens without key)' : 'A bridge tile (raises bridge)'}
                </option>
              ))}
            </select>
          </label>
          {targetKind === 'door' ? (
            <label>
              Door
              <select value={doorId} onChange={(event) => setDoorId(event.target.value)}>
                {doors.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    Door at ({entry.x}, {entry.y}){entry.label ? ` — ${entry.label}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                Bridge cell X
                <input type="number" min={0} max={199} value={bridgeX} onChange={(event) => setBridgeX(toPositiveInt(event.currentTarget.value, 0))} />
              </label>
              <label>
                Bridge cell Y
                <input type="number" min={0} max={199} value={bridgeY} onChange={(event) => setBridgeY(toPositiveInt(event.currentTarget.value, 0))} />
              </label>
              <p className="muted">The gap cell becomes walkable and renders the tile below once the lever is pulled.</p>
              <TileGidPicker label="Raised bridge tile" value={bridgeTileGid} tilesets={tilesets} onChange={setBridgeTileGid} />
            </>
          )}
        </fieldset>
        <div className="admin-poi-actions">
          <button type="submit" disabled={createMut.isPending || updateMut.isPending}>
            Save
          </button>
          {trigger ? (
            <button type="button" onClick={() => deleteMut.mutate(trigger.id)} disabled={deleteMut.isPending}>
              Delete
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
