import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useState } from 'react';

import { createShopItem, deleteShopItem, getShopItems, updateShopItem, type ShopItemClass, type ShopItemInput, type ShopItemKind, type ShopItemView } from '../../lib/api-admin';
import { AdminMessage, AdminSection, ErrorText, Field } from './AdminShared';

const SHOP_QUERY_KEY = ['admin', 'shop'] as const;
const SHOP_KINDS = ['consumable', 'cosmetic', 'evolve', 'building_placement', 'ticket', 'revive'] as const;
const SHOP_CLASSES = ['product', 'item'] as const;

export function ShopAdmin(): JSX.Element {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ShopItemView | null>(null);
  const shopQuery = useQuery({ queryKey: SHOP_QUERY_KEY, queryFn: getShopItems });
  const createMutation = useMutation({ mutationFn: createShopItem, onSuccess: () => queryClient.invalidateQueries({ queryKey: SHOP_QUERY_KEY }) });
  const updateMutation = useMutation({ mutationFn: ({ id, input }: { readonly id: string; readonly input: ShopItemInput }) => updateShopItem(id, input), onSuccess: () => queryClient.invalidateQueries({ queryKey: SHOP_QUERY_KEY }) });
  const deleteMutation = useMutation({ mutationFn: deleteShopItem, onSuccess: () => queryClient.invalidateQueries({ queryKey: SHOP_QUERY_KEY }) });
  const items = shopQuery.data?.items ?? [];

  const submit = async (input: ShopItemInput): Promise<void> => {
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, input });
    } else {
      await createMutation.mutateAsync(input);
    }
    setEditing(null);
  };

  return (
    <div className="admin-two-column">
      <AdminSection title="Shop items" lede="Manage combat consumables, evolution items, tickets, cosmetics, and building placements.">
        <ErrorText error={shopQuery.error ?? createMutation.error ?? updateMutation.error ?? deleteMutation.error} />
        <div className="admin-scroll">
          <table className="admin-table">
            <thead><tr><th>Name</th><th>Class</th><th>Kind</th><th>Price</th><th>Enabled</th><th>Actions</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><b>{item.name}</b><br /><span className="muted">{item.description}</span></td>
                  <td><span className={`badge badge-${item.class}`}>{item.class}</span></td>
                  <td><span className="badge">{item.kind}</span></td>
                  <td>{item.priceCredits}</td>
                  <td>{item.enabled ? 'yes' : 'no'}</td>
                  <td className="admin-actions-cell"><button className="btn btn--secondary btn--sm" type="button" onClick={() => setEditing(item)}>Edit</button><button className="btn btn--danger btn--sm" type="button" onClick={() => void deleteMutation.mutate(item.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shopQuery.isPending ? <AdminMessage tone="muted">Loading shop items…</AdminMessage> : null}
      </AdminSection>
      <ShopItemForm key={editing?.id ?? 'new'} item={editing} busy={createMutation.isPending || updateMutation.isPending} onCancel={() => setEditing(null)} onSubmit={submit} />
    </div>
  );
}

function ShopItemForm({ item, busy, onCancel, onSubmit }: { readonly item: ShopItemView | null; readonly busy: boolean; readonly onCancel: () => void; readonly onSubmit: (input: ShopItemInput) => Promise<void> }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const input = buildInput(new FormData(event.currentTarget));
    if (input === null) {
      setError('Name, price, and valid JSON payload are required.');
      return;
    }
    setError(null);
    await onSubmit(input);
    event.currentTarget.reset();
  };

  return (
    <AdminSection title={item ? 'Edit shop item' : 'Create shop item'} lede="Payload accepts backend-defined JSON for buff/evolution/building behavior.">
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <Field label="Name"><input className="input" name="name" defaultValue={item?.name ?? ''} required /></Field>
        <Field label="Description"><textarea className="input" name="description" defaultValue={item?.description ?? ''} rows={3} /></Field>
        <Field label="Class"><select className="input" name="class" defaultValue={item?.class ?? 'product'}>{SHOP_CLASSES.map((cls) => <option key={cls} value={cls}>{cls}</option>)}</select></Field>
        <Field label="Kind"><select className="input" name="kind" defaultValue={item?.kind ?? 'consumable'}>{SHOP_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></Field>
        <Field label="Price"><input className="input" name="priceCredits" type="number" min="0" defaultValue={item?.priceCredits ?? 100} required /></Field>
        <Field label="Payload JSON"><textarea className="input mono" name="payload" rows={6} defaultValue={JSON.stringify(item?.payload ?? {}, null, 2)} /></Field>
        <label className="admin-checkbox"><input type="checkbox" name="enabled" defaultChecked={item?.enabled ?? true} /> Enabled</label>
        {error ? <p className="auth-error">{error}</p> : null}
        <div className="row spread"><button className="btn btn--secondary" type="button" onClick={onCancel}>Cancel</button><button className="btn" type="submit" disabled={busy}>{item ? 'Save item' : 'Create item'}</button></div>
      </form>
    </AdminSection>
  );
}

function buildInput(form: FormData): ShopItemInput | null {
  const name = readString(form, 'name');
  const priceCredits = readNumber(form, 'priceCredits');
  if (!name || priceCredits === null) return null;
  const payload = parsePayload(readString(form, 'payload') ?? '{}');
  if (payload === null) return null;
  const description = readString(form, 'description') ?? '';
  return { name, description, priceCredits, kind: readKind(form), class: readClass(form), payload, enabled: form.get('enabled') === 'on' };
}

function parsePayload(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(form: FormData, key: string): number | null {
  const value = readString(form, key);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readKind(form: FormData): ShopItemKind {
  const value = readString(form, 'kind');
  return SHOP_KINDS.find((kind) => kind === value) ?? 'consumable';
}

function readClass(form: FormData): ShopItemClass {
  const value = readString(form, 'class');
  return SHOP_CLASSES.find((cls) => cls === value) ?? 'product';
}
