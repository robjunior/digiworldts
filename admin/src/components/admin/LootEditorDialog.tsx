import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
  getCatalogLoot,
  getShopItems,
  putCatalogLoot,
  type LootEntryInput,
  type LootEntryView,
} from '../../lib/api-admin';

const LOOT_QUERY_KEY = (catalogId: string) => ['admin', 'loot', catalogId] as const;
const SHOP_QUERY_KEY = ['admin', 'shop'] as const;

type Draft = {
  readonly key: string;
  readonly itemId: string;
  readonly dropPct: number;
  readonly qtyMin: number;
  readonly qtyMax: number;
};

export type LootEditorDialogProps = {
  readonly catalogId: string;
  readonly catalogName: string;
  readonly onClose: () => void;
};

export function LootEditorDialog({ catalogId, catalogName, onClose }: LootEditorDialogProps): JSX.Element {
  const queryClient = useQueryClient();
  const lootQuery = useQuery({ queryKey: LOOT_QUERY_KEY(catalogId), queryFn: () => getCatalogLoot(catalogId) });
  const itemsQuery = useQuery({ queryKey: SHOP_QUERY_KEY, queryFn: getShopItems });
  const [drafts, setDrafts] = useState<readonly Draft[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<number>(0);

  const items = itemsQuery.data?.items ?? [];
  const itemMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) map.set(item.id, item.name);
    return map;
  }, [items]);

  useEffect(() => {
    if (!lootQuery.data) return;
    setDrafts(lootQuery.data.entries.map((entry, index) => toDraft(entry, index)));
    setNextKey(lootQuery.data.entries.length);
  }, [lootQuery.data]);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const saveMutation = useMutation({
    mutationFn: (entries: readonly LootEntryInput[]) => putCatalogLoot(catalogId, entries),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LOOT_QUERY_KEY(catalogId) });
      onClose();
    },
  });

  const setDraft = (key: string, patch: Partial<Draft>): void => {
    setDrafts((prev) => prev.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  };

  const addRow = (): void => {
    const defaultItemId = items[0]?.id ?? '';
    const key = String(nextKey);
    setNextKey((n) => n + 1);
    setDrafts((prev) => [...prev, { key, itemId: defaultItemId, dropPct: 20, qtyMin: 1, qtyMax: 1 }]);
  };

  const removeRow = (key: string): void => {
    setDrafts((prev) => prev.filter((draft) => draft.key !== key));
  };

  const onSave = (): void => {
    setSaveError(null);
    for (const draft of drafts) {
      if (!draft.itemId) return setSaveError('Every row needs an item selected.');
      if (draft.dropPct < 0 || draft.dropPct > 100) return setSaveError('Drop % must be 0-100.');
      if (draft.qtyMin < 1 || draft.qtyMax < draft.qtyMin) return setSaveError('Qty min must be ≥1 and Qty max ≥ Qty min.');
    }
    const seen = new Set<string>();
    for (const draft of drafts) {
      if (seen.has(draft.itemId)) return setSaveError(`Duplicate item: ${itemMap.get(draft.itemId) ?? draft.itemId}. Combine into one row.`);
      seen.add(draft.itemId);
    }
    const entries: LootEntryInput[] = drafts.map((draft) => ({
      itemId: draft.itemId,
      dropPct: draft.dropPct,
      qtyMin: draft.qtyMin,
      qtyMax: draft.qtyMax,
    }));
    void saveMutation.mutate(entries);
  };

  const stopPropagation = (event: React.MouseEvent): void => event.stopPropagation();
  const loading = lootQuery.isPending || itemsQuery.isPending;
  const busy = saveMutation.isPending;

  return (
    <div className="digdex-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="loot-editor-title">
      <div className="digdex-modal" style={{ maxWidth: 720, position: 'relative' }} onClick={stopPropagation}>
        <button className="digdex-modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        <div>
          <h2 id="loot-editor-title" style={{ margin: '0 0 4px' }}>Loot for {catalogName}</h2>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Rows below define what this Digimon drops when defeated. Each row rolls independently at its own drop%.
            An empty list means this mon uses the global 20% random-item fallback.
          </p>
        </div>

        {loading ? <p className="muted">Loading…</p> : null}
        {lootQuery.error ? <p className="auth-error">Load failed: {String(lootQuery.error)}</p> : null}
        {itemsQuery.error ? <p className="auth-error">Items load failed: {String(itemsQuery.error)}</p> : null}
        {saveError ? <p className="auth-error">{saveError}</p> : null}
        {saveMutation.error ? <p className="auth-error">Save failed: {String(saveMutation.error)}</p> : null}

        {!loading ? (
          <div className="admin-scroll" style={{ maxHeight: 320 }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: '46%' }}>Item</th>
                  <th style={{ width: 96 }}>Drop %</th>
                  <th style={{ width: 76 }}>Qty min</th>
                  <th style={{ width: 76 }}>Qty max</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {drafts.map((draft) => (
                  <tr key={draft.key}>
                    <td>
                      <select
                        className="input"
                        value={draft.itemId}
                        onChange={(event) => setDraft(draft.key, { itemId: event.currentTarget.value })}
                      >
                        {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        className="input mono"
                        type="number"
                        min={0}
                        max={100}
                        value={draft.dropPct}
                        onChange={(event) => setDraft(draft.key, { dropPct: clampInt(event.currentTarget.value, 0, 100) })}
                      />
                    </td>
                    <td>
                      <input
                        className="input mono"
                        type="number"
                        min={1}
                        max={999}
                        value={draft.qtyMin}
                        onChange={(event) => setDraft(draft.key, { qtyMin: clampInt(event.currentTarget.value, 1, 999) })}
                      />
                    </td>
                    <td>
                      <input
                        className="input mono"
                        type="number"
                        min={1}
                        max={999}
                        value={draft.qtyMax}
                        onChange={(event) => setDraft(draft.key, { qtyMax: clampInt(event.currentTarget.value, 1, 999) })}
                      />
                    </td>
                    <td>
                      <button className="btn btn--danger btn--sm" type="button" onClick={() => removeRow(draft.key)} aria-label="Remove row">×</button>
                    </td>
                  </tr>
                ))}
                {drafts.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted, #8892a0)', padding: 16 }}>
                      No loot rules yet — this mon uses the global 20% random-item drop. Add rows to override.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn btn--secondary btn--sm" type="button" onClick={addRow} disabled={loading || items.length === 0}>+ Add row</button>
          {items.length === 0 && !itemsQuery.isPending ? (
            <span className="muted" style={{ fontSize: 12 }}>No shop items exist yet — create some via the Shop Admin tab first.</span>
          ) : null}
        </div>

        <div className="row spread" style={{ marginTop: 16 }}>
          <button className="btn btn--secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn" type="button" onClick={onSave} disabled={busy || loading}>{busy ? 'Saving…' : 'Save loot table'}</button>
        </div>
      </div>
    </div>
  );
}

function toDraft(entry: LootEntryView, index: number): Draft {
  return {
    key: `${entry.id}-${index}`,
    itemId: entry.itemId,
    dropPct: entry.dropPct,
    qtyMin: entry.qtyMin,
    qtyMax: entry.qtyMax,
  };
}

function clampInt(raw: string, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}
