import type { Kit, KitInput, KitItem } from '@digiworld/shared/dungeon';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useFlag } from '../../hooks/useFlag';
import { getItems } from '../../lib/api-shop';
import {
  createKit as apiCreateKit,
  deleteKit as apiDeleteKit,
  enterDungeon as apiEnterDungeon,
  listKits,
} from '../../lib/api-dungeon-kits';

const FEATURE_FLAG = 'dungeon-kit-enabled';
const KITS_KEY = ['dungeon', 'kits'] as const;
const ITEMS_KEY = ['dungeon', 'kits', 'inventory'] as const;

type EnterFn = (dungeonId: string, kitId?: string) => void | Promise<void>;

export function DungeonKitPicker({
  dungeonId,
  onEnter,
}: {
  readonly dungeonId: string;
  readonly onEnter?: EnterFn;
}): JSX.Element | null {
  const enabled = useFlag(FEATURE_FLAG);
  const queryClient = useQueryClient();
  const kitsQuery = useQuery({ queryKey: KITS_KEY, queryFn: listKits, enabled });
  const itemsQuery = useQuery({ queryKey: ITEMS_KEY, queryFn: getItems, enabled });

  const createMutation = useMutation({
    mutationFn: apiCreateKit,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KITS_KEY }),
  });
  const deleteMutation = useMutation({
    mutationFn: apiDeleteKit,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KITS_KEY }),
  });
  const enterMutation = useMutation({
    mutationFn: (kitId: string | undefined) =>
      apiEnterDungeon(dungeonId, kitId === undefined ? {} : { kitId }),
    onSuccess: async (result, kitId) => {
      queryClient.setQueryData(['dungeon', dungeonId], result.view);
      queryClient.setQueryData(['dungeon', dungeonId, 'stash'], result.stash);
      if (onEnter) await onEnter(dungeonId, kitId);
    },
  });

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newItems, setNewItems] = useState<KitItem[]>([]);

  if (!enabled) return null;

  const kits = kitsQuery.data?.kits ?? [];
  const inventoryItems = itemsQuery.data?.items ?? [];
  const inventoryByItem = new Map(inventoryItems.map((it) => [it.itemId, it]));

  const addSlot = (itemId: string): void => {
    if (newItems.some((it) => it.itemId === itemId)) return;
    setNewItems((prev) => [...prev, { itemId, qty: 1, slotOrder: prev.length }]);
  };

  const updateSlotQty = (itemId: string, qty: number): void => {
    setNewItems((prev) => prev.map((it) => (it.itemId === itemId ? { ...it, qty } : it)));
  };

  const removeSlot = (itemId: string): void => {
    setNewItems((prev) => prev.filter((it) => it.itemId !== itemId).map((it, i) => ({ ...it, slotOrder: i })));
  };

  const submitNew = async (): Promise<void> => {
    const name = newName.trim();
    if (name.length < 1 || newItems.length === 0) return;
    const input: KitInput = { name, items: newItems };
    await createMutation.mutateAsync(input);
    setCreating(false);
    setNewName('');
    setNewItems([]);
  };

  return (
    <div className="dungeon-kit-picker">
      <div className="dungeon-kit-picker__header">
        <h3>My Kits</h3>
        <button type="button" className="btn btn--secondary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : 'New Kit'}
        </button>
      </div>

      {creating ? (
        <NewKitForm
          name={newName}
          setName={setNewName}
          items={newItems}
          inventoryItems={inventoryItems.map((it) => ({ itemId: it.itemId, name: it.name, qty: it.qty }))}
          onAdd={addSlot}
          onQtyChange={updateSlotQty}
          onRemove={removeSlot}
          onSubmit={submitNew}
          busy={createMutation.isPending}
        />
      ) : null}

      {kitsQuery.isPending ? <p className="muted">Loading kits...</p> : null}
      {!kitsQuery.isPending && kits.length === 0 ? (
        <p className="muted">No kits yet — create one to bring items into the dungeon.</p>
      ) : null}

      <ul className="dungeon-kit-picker__list">
        {kits.map((kit) => (
          <KitRow
            key={kit.id}
            kit={kit}
            inventoryByItem={inventoryByItem}
            onEnter={() => void enterMutation.mutateAsync(kit.id)}
            onDelete={() => void deleteMutation.mutateAsync(kit.id)}
            busy={enterMutation.isPending || deleteMutation.isPending}
          />
        ))}
      </ul>

      <div className="dungeon-kit-picker__enter-plain">
        <button
          type="button"
          className="btn"
          disabled={enterMutation.isPending}
          onClick={() => void enterMutation.mutateAsync(undefined)}
        >
          Enter without kit
        </button>
      </div>

      {enterMutation.error ? (
        <p className="error">{String(enterMutation.error)}</p>
      ) : null}
    </div>
  );
}

function KitRow({
  kit,
  inventoryByItem,
  onEnter,
  onDelete,
  busy,
}: {
  readonly kit: Kit;
  readonly inventoryByItem: ReadonlyMap<string, { readonly name: string; readonly qty: number }>;
  readonly onEnter: () => void;
  readonly onDelete: () => void;
  readonly busy: boolean;
}): JSX.Element {
  const canFulfil = kit.items.every((it) => (inventoryByItem.get(it.itemId)?.qty ?? 0) >= it.qty);
  return (
    <li className="dungeon-kit-picker__row">
      <div className="dungeon-kit-picker__row-name">{kit.name}</div>
      <div className="dungeon-kit-picker__row-items">
        {kit.items.map((it) => {
          const inv = inventoryByItem.get(it.itemId);
          const have = inv?.qty ?? 0;
          const label = inv?.name ?? it.itemId;
          const short = have < it.qty;
          return (
            <span
              key={it.itemId}
              className={`dungeon-kit-picker__slot${short ? ' dungeon-kit-picker__slot--short' : ''}`}
            >
              {label} × {it.qty} <span className="muted">({have} owned)</span>
            </span>
          );
        })}
      </div>
      <div className="dungeon-kit-picker__row-actions">
        <button type="button" className="btn" disabled={busy || !canFulfil} onClick={onEnter}>
          Enter with kit
        </button>
        <button type="button" className="btn btn--danger" disabled={busy} onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}

function NewKitForm({
  name,
  setName,
  items,
  inventoryItems,
  onAdd,
  onQtyChange,
  onRemove,
  onSubmit,
  busy,
}: {
  readonly name: string;
  readonly setName: (name: string) => void;
  readonly items: readonly KitItem[];
  readonly inventoryItems: ReadonlyArray<{ readonly itemId: string; readonly name: string; readonly qty: number }>;
  readonly onAdd: (itemId: string) => void;
  readonly onQtyChange: (itemId: string, qty: number) => void;
  readonly onRemove: (itemId: string) => void;
  readonly onSubmit: () => Promise<void>;
  readonly busy: boolean;
}): JSX.Element {
  const available = inventoryItems.filter((inv) => !items.some((it) => it.itemId === inv.itemId));
  return (
    <div className="dungeon-kit-picker__new">
      <input
        className="input"
        placeholder="Kit name (e.g. Boss Push)"
        value={name}
        maxLength={64}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="dungeon-kit-picker__new-items">
        {items.map((it) => {
          const inv = inventoryItems.find((r) => r.itemId === it.itemId);
          return (
            <div key={it.itemId} className="dungeon-kit-picker__new-item">
              <span>{inv?.name ?? it.itemId}</span>
              <input
                type="number"
                className="input"
                min={1}
                max={inv?.qty ?? 1}
                value={it.qty}
                onChange={(e) => onQtyChange(it.itemId, Math.max(1, Number(e.target.value) || 1))}
              />
              <button type="button" className="btn btn--sm" onClick={() => onRemove(it.itemId)}>
                Remove
              </button>
            </div>
          );
        })}
      </div>
      <div className="dungeon-kit-picker__new-add">
        <select
          className="input"
          value=""
          onChange={(e) => {
            if (e.target.value) onAdd(e.target.value);
          }}
        >
          <option value="">Add item...</option>
          {available.map((inv) => (
            <option key={inv.itemId} value={inv.itemId}>
              {inv.name} (owned: {inv.qty})
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="btn"
        disabled={busy || name.trim().length < 1 || items.length === 0}
        onClick={() => void onSubmit()}
      >
        Save Kit
      </button>
    </div>
  );
}
