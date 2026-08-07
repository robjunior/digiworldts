import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import type { JSX } from 'react';

import {
  listBundles,
  createBundle,
  updateBundle,
  deleteBundle,
  getShopItems,
  type BundleAdminView,
  type BundleInput,
  type BundleItemInput,
  type ShopItemView,
} from '../../lib/api-admin';
import { AdminMessage, AdminSection, ErrorText, Field } from './AdminShared';

const BUNDLES_QUERY_KEY = ['admin', 'shop', 'bundles'] as const;
const ITEMS_QUERY_KEY = ['admin', 'shop'] as const;

type BundleDraft = {
  readonly id: string | null;
  readonly name: string;
  readonly description: string;
  readonly currency: 'credits' | 'netcore';
  readonly discountPct: number;
  readonly shopCategory: string;
  readonly sortOrder: number;
  readonly featured: boolean;
  readonly quickOffer: boolean;
  readonly enabled: boolean;
  readonly items: readonly BundleItemInput[];
};

function draftFromBundle(bundle: BundleAdminView | null): BundleDraft {
  if (!bundle) {
    return {
      id: null,
      name: '',
      description: '',
      currency: 'credits',
      discountPct: 0,
      shopCategory: 'bundle',
      sortOrder: 0,
      featured: false,
      quickOffer: false,
      enabled: true,
      items: [],
    };
  }
  return {
    id: bundle.id,
    name: bundle.name,
    description: bundle.description,
    currency: bundle.currency as 'credits' | 'netcore',
    discountPct: bundle.discountPct,
    shopCategory: bundle.shopCategory,
    sortOrder: bundle.sortOrder,
    featured: bundle.featured,
    quickOffer: bundle.quickOffer,
    enabled: bundle.enabled,
    items: bundle.items.map((i) => ({ itemId: i.itemId, qty: i.qty, sortOrder: i.sortOrder })),
  };
}

function draftToBundleInput(draft: BundleDraft): BundleInput {
  const result: any = {
    name: draft.name.trim(),
    currency: draft.currency,
    discountPct: draft.discountPct,
    sortOrder: draft.sortOrder,
    featured: draft.featured,
    quickOffer: draft.quickOffer,
    enabled: draft.enabled,
    items: draft.items,
  };
  const desc = draft.description.trim();
  if (desc) result.description = desc;
  const cat = draft.shopCategory.trim();
  if (cat) result.shopCategory = cat;
  
  return result as BundleInput;
}

function BundleDialog({
  bundle,
  onClose,
  onSaved,
}: {
  readonly bundle: BundleAdminView | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): JSX.Element {
  const isNew = bundle === null;
  const [draft, setDraft] = useState<BundleDraft>(() => draftFromBundle(bundle));
  const [error, setError] = useState<string | null>(null);

  const itemsQuery = useQuery({ queryKey: ITEMS_QUERY_KEY, queryFn: getShopItems });
  const allShopItems = itemsQuery.data?.items ?? [];

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = draftToBundleInput(draft);
      return isNew ? await createBundle(input) : await updateBundle(draft.id!, input);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'save failed'),
  });

  const availableItems = useMemo(() => {
    return allShopItems.filter((i) => i.currency === draft.currency);
  }, [allShopItems, draft.currency]);

  // Compute live preview
  const preview = useMemo(() => {
    let originalPrice = 0;
    for (const item of draft.items) {
      const shopItem = allShopItems.find((si) => si.id === item.itemId);
      if (shopItem) {
        originalPrice += (shopItem.price || shopItem.priceCredits) * item.qty;
      }
    }
    const discountPct = draft.discountPct;
    const discountedPrice = Math.max(0, Math.floor(originalPrice * (1 - discountPct / 100)));
    const savings = originalPrice - discountedPrice;
    return { originalPrice, discountPct, discountedPrice, savings };
  }, [draft.items, draft.discountPct, allShopItems]);

  const canSave = draft.name.trim().length > 0 && draft.items.length > 0;

  const addItem = (itemId: string) => {
    if (!itemId || draft.items.some((i) => i.itemId === itemId)) return;
    setDraft({ ...draft, items: [...draft.items, { itemId, qty: 1, sortOrder: 0 }] });
  };

  const updateItemQty = (itemId: string, qty: number) => {
    setDraft({
      ...draft,
      items: draft.items.map((i) => (i.itemId === itemId ? { ...i, qty: Math.max(1, Math.min(99, qty)) } : i)),
    });
  };

  const removeItem = (itemId: string) => {
    setDraft({
      ...draft,
      items: draft.items.filter((i) => i.itemId !== itemId),
    });
  };

  const handleCurrencyChange = (newCurrency: 'credits' | 'netcore') => {
    if (newCurrency === draft.currency) return;
    // When currency changes, we must clear items because they might not match the new currency
    setDraft({ ...draft, currency: newCurrency, items: [] });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 700 }}>
        <div className="modal-head">
          <h2>{isNew ? 'New bundle' : `Edit bundle "${bundle.name}"`}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body admin-scroll">
          <Field label="Name">
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Description">
            <textarea
              rows={3}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="input"
            />
          </Field>
          <div className="form-grid">
            <Field label="Currency">
              <select
                value={draft.currency}
                onChange={(e) => handleCurrencyChange(e.target.value as 'credits' | 'netcore')}
                className="input"
              >
                <option value="credits">Credits</option>
                <option value="netcore">NetCore</option>
              </select>
            </Field>
            <Field label="Discount % (0-100)">
              <input
                type="number"
                min="0"
                max="100"
                value={draft.discountPct}
                onChange={(e) => setDraft({ ...draft, discountPct: Number(e.target.value) || 0 })}
                className="input"
              />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Shop Category">
              <input
                type="text"
                value={draft.shopCategory}
                onChange={(e) => setDraft({ ...draft, shopCategory: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Sort Order">
              <input
                type="number"
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })}
                className="input"
              />
            </Field>
          </div>
          <div className="form-grid">
            <label className="admin-checkbox">
              <input
                type="checkbox"
                checked={draft.featured}
                onChange={(e) => setDraft({ ...draft, featured: e.target.checked })}
              />
              Featured
            </label>
            <label className="admin-checkbox">
              <input
                type="checkbox"
                checked={draft.quickOffer}
                onChange={(e) => setDraft({ ...draft, quickOffer: e.target.checked })}
              />
              Quick Offer
            </label>
            <label className="admin-checkbox">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              Enabled
            </label>
          </div>

          <hr style={{ margin: '16px 0', borderColor: '#333' }} />

          <h3>Bundle Items</h3>
          <div className="stack" style={{ marginTop: 8 }}>
            {draft.items.map((item) => {
              const shopItem = allShopItems.find((si) => si.id === item.itemId);
              return (
                <div key={item.itemId} className="row spread" style={{ background: 'var(--bg-card-alt)', padding: 8, borderRadius: 4 }}>
                  <div>{shopItem?.name || item.itemId}</div>
                  <div className="row">
                    <input
                      type="number"
                      min="1"
                      max="99"
                      value={item.qty}
                      onChange={(e) => updateItemQty(item.itemId, parseInt(e.target.value, 10) || 1)}
                      style={{ width: 60, marginRight: 8 }}
                      className="input"
                    />
                    <button type="button" className="btn btn--danger btn--sm" onClick={() => removeItem(item.itemId)}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <Field label="Add Item">
            <select
              value=""
              onChange={(e) => addItem(e.target.value)}
              className="input"
            >
              <option value="" disabled>-- Select an item to add --</option>
              {availableItems.map((si) => {
                const isPicked = draft.items.some((i) => i.itemId === si.id);
                return (
                  <option key={si.id} value={si.id} disabled={isPicked}>
                    {si.name} ({si.price || si.priceCredits} {si.currency})
                  </option>
                );
              })}
            </select>
          </Field>

          {error !== null ? <AdminMessage tone="error">{error}</AdminMessage> : null}
        </div>
        <div className="modal-actions stack">
          <div style={{ padding: '8px', background: 'var(--bg-card-alt)', borderRadius: 4, textAlign: 'center', fontSize: '0.9em' }}>
            Original: <b>{preview.originalPrice}</b> · Discount: <b>{preview.discountPct}%</b> · Final: <b>{preview.discountedPrice}</b> · Savings: <b>{preview.savings}</b>
          </div>
          <div className="row spread" style={{ width: '100%', marginTop: 8 }}>
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={!canSave || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Saving…' : isNew ? 'Create bundle' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ShopBundlesSection(): JSX.Element {
  const queryClient = useQueryClient();
  const bundlesQuery = useQuery({ queryKey: BUNDLES_QUERY_KEY, queryFn: listBundles });
  const [dialogBundle, setDialogBundle] = useState<BundleAdminView | null | undefined>(undefined);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const invalidate = (): void => { void queryClient.invalidateQueries({ queryKey: BUNDLES_QUERY_KEY }); };

  const deleteMutation = useMutation({
    mutationFn: deleteBundle,
    onSuccess: () => {
      setConfirmDeleteId(null);
      invalidate();
    },
  });

  const bundles = bundlesQuery.data?.bundles ?? [];

  return (
    <AdminSection
      title="Shop Bundles"
      lede="Group multiple shop items together with a discount."
      actions={
        <button type="button" className="btn" onClick={() => setDialogBundle(null)}>
          + New bundle
        </button>
      }
    >
      <ErrorText error={bundlesQuery.error} />
      <ErrorText error={deleteMutation.error} />

      <div className="admin-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Currency</th>
              <th>Discount %</th>
              <th>Items count</th>
              <th>Enabled</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {bundles.map((bundle) => (
              <tr key={bundle.id}>
                <td>
                  <b>{bundle.name}</b>
                </td>
                <td><span className="badge">{bundle.currency}</span></td>
                <td>{bundle.discountPct}%</td>
                <td>{bundle.items.length}</td>
                <td>{bundle.enabled ? 'yes' : 'no'}</td>
                <td className="admin-actions-cell">
                  <button
                    className="btn btn--secondary btn--sm"
                    type="button"
                    onClick={() => setDialogBundle(bundle)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn--danger btn--sm"
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={() => setConfirmDeleteId(bundle.id)}
                    style={{ marginLeft: 4 }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {bundles.length === 0 && !bundlesQuery.isPending && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 16 }} className="muted">
                  No bundles found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {bundlesQuery.isPending ? <AdminMessage tone="muted">Loading bundles…</AdminMessage> : null}

      {confirmDeleteId !== null ? (
        <AdminMessage tone="error">
          Delete bundle? This action cannot be undone.
          <div className="row" style={{ marginTop: 8, gap: 8 }}>
            <button
              className="btn btn--danger"
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => void deleteMutation.mutate(confirmDeleteId)}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete it'}
            </button>
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => setConfirmDeleteId(null)}
            >
              Cancel
            </button>
          </div>
        </AdminMessage>
      ) : null}

      {dialogBundle !== undefined ? (
        <BundleDialog
          bundle={dialogBundle}
          onClose={() => setDialogBundle(undefined)}
          onSaved={() => {
            setDialogBundle(undefined);
            invalidate();
          }}
        />
      ) : null}
    </AdminSection>
  );
}
