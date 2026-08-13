import type { FormEvent, JSX } from 'react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { DungeonTrigger, DungeonView, TilesetGrant, TriggerTargetKind } from '@digiworld/shared';
import { TRIGGER_TARGET_KINDS } from '@digiworld/shared';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import { TileGidPicker } from './TileGidPicker';
import { toOptionalText } from './utils';
import { TriggerTargetPicker, type PickedTriggerTarget } from './TriggerTargetPicker';
import { createAdminTrigger, deleteAdminTrigger, getAdminTriggerPool, updateAdminTrigger, type AdminTriggerTargetBody, type TriggerPoolEntry } from '../../../lib/api-dungeon-admin';

const poolLabel = (entry: TriggerPoolEntry, kind: TriggerTargetKind): string =>
  `[${entry.dungeonName}] ${kind === 'door' ? 'Door' : 'Bridge'} at (${entry.x}, ${entry.y})${entry.label ? ` — ${entry.label}` : ''}`;

export function TriggerEditor({
  dungeonId,
  x,
  y,
  trigger,
  tilesets,
}: {
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly trigger?: DungeonTrigger;
  readonly tilesets: readonly TilesetGrant[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const applyView = (result: { readonly view: DungeonView }): void => {
    queryClient.setQueryData(ADMIN_DUNGEON_QUERY(dungeonId), result.view);
  };
  const poolQuery = useQuery({ queryKey: ['admin', 'trigger-pool'] as const, queryFn: getAdminTriggerPool });
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
  const [enabled, setEnabled] = useState<boolean>(trigger?.enabled ?? true);
  const [unusedTileGid, setUnusedTileGid] = useState<number | null>(trigger?.unusedTileGid ?? null);
  const [usedTileGid, setUsedTileGid] = useState<number | null>(trigger?.usedTileGid ?? null);

  const createMut = useMutation({
    mutationFn: (body: { readonly x: number; readonly y: number; readonly enabled: boolean; readonly label?: string | null; readonly unusedTileGid?: number | null; readonly usedTileGid?: number | null; readonly target: AdminTriggerTargetBody }) => createAdminTrigger(dungeonId, body),
    onSuccess: applyView,
  });
  const updateMut = useMutation({
    mutationFn: (body: { readonly enabled: boolean; readonly label?: string | null; readonly unusedTileGid?: number | null; readonly usedTileGid?: number | null; readonly target?: AdminTriggerTargetBody }) => updateAdminTrigger(dungeonId, trigger?.id ?? '', body),
    onSuccess: applyView,
  });
  const deleteMut = useMutation({
    mutationFn: (triggerId: string) => deleteAdminTrigger(dungeonId, triggerId),
    onSuccess: applyView,
  });

  const resolvePickedLabel = (): string => {
    const pool = targetKind === 'door' ? poolQuery.data?.doors ?? [] : poolQuery.data?.bridges ?? [];
    const entry = pool.find((item) => item.id === picked?.id);
    if (entry) return `[${entry.dungeonName}] ${targetKind === 'door' ? 'Door' : 'Bridge'} at (${entry.x}, ${entry.y})${entry.label ? ` — ${entry.label}` : ''}`;
    return `${targetKind === 'door' ? 'Door' : 'Bridge'} (${picked?.id ?? 'none'})`;
  };

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = toOptionalText(form.get('label'));
    if (picked === null) return;
    const targetBody: AdminTriggerTargetBody = picked.kind === 'door'
      ? { kind: 'door', doorId: picked.id }
      : { kind: 'bridge', bridgeId: picked.id };
    if (trigger) updateMut.mutate({ enabled, label, unusedTileGid, usedTileGid, target: targetBody });
    else createMut.mutate({ x, y, enabled, label, unusedTileGid, usedTileGid, target: targetBody });
  };

  const poolEntries = targetKind === 'door' ? poolQuery.data?.doors ?? [] : poolQuery.data?.bridges ?? [];

  return (
    <div className="admin-editor-panel">
      <h3>Trigger at ({x}, {y})</h3>
      <form onSubmit={save}>
        <label>
          Label
          <input name="label" defaultValue={trigger?.label ?? ''} placeholder="Optional lever label" />
        </label>
        <label>
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enabled
        </label>
        <p className="muted">Fires when a player clicks it. The target can be any {targetKind} from the global pool, on any map.</p>
        <TileGidPicker label="Unused tile (lever down)" value={unusedTileGid} tilesets={tilesets} onChange={setUnusedTileGid} />
        <TileGidPicker label="Used tile (lever pulled)" value={usedTileGid} tilesets={tilesets} onChange={setUsedTileGid} />
        <fieldset>
          <legend>Activates (global pool by id)</legend>
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
          {poolEntries.length > 0 ? (
            <label>
              {targetKind === 'door' ? 'Door' : 'Bridge'} (global pool)
              <select
                value={picked?.id ?? ''}
                onChange={(event) => {
                  const entry = poolEntries.find((item) => item.id === event.target.value);
                  if (entry) setPicked({ kind: targetKind, id: entry.id, dungeonId: entry.dungeonId, x: entry.x, y: entry.y, label: entry.label });
                }}
              >
                <option value="">— pick from the map below —</option>
                {poolEntries.map((entry) => (
                  <option key={entry.id} value={entry.id}>{poolLabel(entry, targetKind)}</option>
                ))}
              </select>
            </label>
          ) : (
            <p className="muted">No {targetKind}s exist yet. Place one with the {targetKind === 'door' ? 'DOORS' : 'BRIDGES'} tool first.</p>
          )}
          {picked !== null ? (
            <div className="tpt-picked">
              <span>{resolvePickedLabel()}</span>
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
          kind={targetKind}
          onPicked={(entry) => { setPicked(entry); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
