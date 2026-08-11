import type { FormEvent, JSX } from 'react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { ChestReward, DungeonChest, TilesetGrant } from '@digiworld/shared';

import { ADMIN_DUNGEON_QUERY } from './query-keys';
import { TileGidPicker } from './TileGidPicker';
import { toOptionalText } from './utils';
import type { ShopItemView } from '../../../lib/api-admin';
import { createAdminChest, deleteAdminChest, updateAdminChest, type ChestCreateBody } from '../../../lib/api-dungeon-admin';

type DraftReward = { itemId: string; qty: number };

function draftFromReward(reward: ChestReward): DraftReward {
  return { itemId: reward.itemId, qty: reward.qty };
}

export function ChestEditor({
  dungeonId,
  x,
  y,
  chest,
  shopItems,
  tilesets,
}: {
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly chest?: DungeonChest;
  readonly shopItems: readonly ShopItemView[];
  readonly tilesets: readonly TilesetGrant[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const invalidateView = (): void => {
    void queryClient.invalidateQueries({ queryKey: ADMIN_DUNGEON_QUERY(dungeonId) });
  };

  const initialContents: readonly DraftReward[] = chest ? chest.contents.map(draftFromReward) : [];
  const [contents, setContents] = useState<readonly DraftReward[]>(initialContents);
  const [locked, setLocked] = useState<boolean>(chest?.lockedByKeyId !== null && chest?.lockedByKeyId !== undefined);
  const [lockedByKeyId, setLockedByKeyId] = useState<string>(chest?.lockedByKeyId ?? '');
  const [unusedTileGid, setUnusedTileGid] = useState<number | null>(chest?.unusedTileGid ?? null);
  const [usedTileGid, setUsedTileGid] = useState<number | null>(chest?.usedTileGid ?? null);

  const createMut = useMutation({
    mutationFn: (body: ChestCreateBody) => createAdminChest(dungeonId, body),
    onSuccess: invalidateView,
  });
  const updateMut = useMutation({
    mutationFn: (body: Partial<ChestCreateBody>) => updateAdminChest(dungeonId, chest?.id ?? '', body),
    onSuccess: invalidateView,
  });
  const deleteMut = useMutation({
    mutationFn: (chestId: string) => deleteAdminChest(dungeonId, chestId),
    onSuccess: invalidateView,
  });

  const addContentRow = (): void => {
    const first = shopItems[0];
    if (!first) return;
    setContents([...contents, { itemId: first.id, qty: 1 }]);
  };

  const updateContentRow = (index: number, patch: Partial<DraftReward>): void => {
    setContents(contents.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeContentRow = (index: number): void => {
    setContents(contents.filter((_, i) => i !== index));
  };

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (contents.length === 0) return;
    const form = new FormData(event.currentTarget);
    const label = toOptionalText(form.get('label'));
    const effectiveLockedKey = locked && lockedByKeyId.trim().length > 0 ? lockedByKeyId.trim() : null;
    const rewardContents: readonly ChestReward[] = contents.map((row) => ({ itemId: row.itemId, qty: Math.max(1, Math.floor(row.qty)) }));
    if (chest) {
      updateMut.mutate({
        contents: rewardContents,
        lockedByKeyId: effectiveLockedKey,
        unusedTileGid,
        usedTileGid,
        ...(label === null ? {} : { label }),
      });
    } else {
      createMut.mutate({
        x,
        y,
        contents: rewardContents,
        unusedTileGid,
        usedTileGid,
        ...(effectiveLockedKey !== null ? { lockedByKeyId: effectiveLockedKey } : {}),
        ...(label === null ? {} : { label }),
      });
    }
  };

  if (shopItems.length === 0) {
    return (
      <div className="admin-editor-panel">
        <h3>Chest at ({x}, {y})</h3>
        <p>No shop items exist yet. Create at least one item in the Shop Admin tab first.</p>
      </div>
    );
  }

  return (
    <div className="admin-editor-panel chest-editor">
      <h3>Chest at ({x}, {y})</h3>
      <form onSubmit={save}>
        <label>
          Label
          <input name="label" defaultValue={chest?.label ?? ''} placeholder="Optional chest label" />
        </label>

        <fieldset className="chest-contents">
          <legend>Contents ({contents.length})</legend>
          {contents.length === 0 ? (
            <p className="muted">No items. A chest must have at least one item to save.</p>
          ) : (
            <table className="chest-contents-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {contents.map((row, index) => (
                  <tr key={index}>
                    <td>
                      <select
                        value={row.itemId}
                        onChange={(event) => updateContentRow(index, { itemId: event.target.value })}
                      >
                        {shopItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({item.id})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        max={999999}
                        value={row.qty}
                        onChange={(event) => updateContentRow(index, { qty: Math.max(1, Number(event.target.value) || 1) })}
                      />
                    </td>
                    <td>
                      <button type="button" onClick={() => removeContentRow(index)} aria-label="Remove item">
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button type="button" onClick={addContentRow}>
            + Add item
          </button>
        </fieldset>

        <fieldset className="chest-locked">
          <legend>Locking</legend>
          <label>
            <input
              type="checkbox"
              checked={locked}
              onChange={(event) => setLocked(event.target.checked)}
            />{' '}
            Locked
          </label>
          {locked ? (
            <label>
              Key identifier (Wave E integration)
              <input
                value={lockedByKeyId}
                onChange={(event) => setLockedByKeyId(event.target.value)}
                placeholder="dungeon-key id or 'TBD' placeholder"
              />
              <p className="muted">
                Wave E ships auto-generated dungeon-scoped keys; for now this is a freeform string. A non-empty value marks the chest as locked (currently un-openable until Wave E lands).
              </p>
            </label>
          ) : (
            <p className="muted">Unlocked chests open automatically on step.</p>
          )}
        </fieldset>

        <TileGidPicker label="Unused tile (closed)" value={unusedTileGid} tilesets={tilesets} onChange={setUnusedTileGid} />
        <TileGidPicker label="Used tile (open)" value={usedTileGid} tilesets={tilesets} onChange={setUsedTileGid} />

        <div className="admin-poi-actions">
          <button type="submit" disabled={createMut.isPending || updateMut.isPending || contents.length === 0}>
            {chest ? (updateMut.isPending ? 'Saving...' : 'Save chest') : (createMut.isPending ? 'Creating...' : 'Create chest')}
          </button>
          {chest ? (
            <button type="button" onClick={() => deleteMut.mutate(chest.id)} disabled={deleteMut.isPending} className="danger">
              Delete
            </button>
          ) : null}
          {createMut.isSuccess || updateMut.isSuccess ? <span className="muted">Saved.</span> : null}
        </div>
      </form>
    </div>
  );
}
