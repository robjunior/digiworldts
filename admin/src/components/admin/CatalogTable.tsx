import type { Attribute, Element, Stage, TemplateDigimon } from '@digiworld/shared/digimon';
import { ATTRIBUTES, ELEMENTS, STAGES } from '@digiworld/shared/digimon';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { createCustomTemplate, deleteTemplate, downloadTemplateAssets, getCatalog, getShopItems, replaceTemplate, type TemplateDraft } from '../../lib/api-admin';
import { AdminMessage, AdminSection, ErrorText } from './AdminShared';
import { CatalogEditDialog } from './CatalogEditDialog';
import { LootEditorDialog } from './LootEditorDialog';

export const CATALOG_QUERY_KEY = ['admin', 'catalog'] as const;
export const ADMIN_SHOP_ITEMS_QUERY_KEY = ['admin', 'shop-items'] as const;

function isSafeHttpUrl(raw: string | undefined | null): raw is string {
  if (typeof raw !== 'string') return false;
  return /^https?:\/\//i.test(raw.trim());
}

type DialogState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly template: TemplateDigimon };

type FilterState = {
  readonly search: string;
  readonly stage: Stage | 'all';
  readonly element: Element | 'all';
  readonly attribute: Attribute | 'all';
  readonly type: string;
};

const EMPTY_FILTERS: FilterState = { search: '', stage: 'all', element: 'all', attribute: 'all', type: '' };

export function CatalogTable(): JSX.Element {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lootTarget, setLootTarget] = useState<TemplateDigimon | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const catalogQuery = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: getCatalog });
  const shopItemsQuery = useQuery({ queryKey: ADMIN_SHOP_ITEMS_QUERY_KEY, queryFn: getShopItems, staleTime: 60_000 });
  const createMutation = useMutation({ mutationFn: createCustomTemplate, onSuccess: () => queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }) });
  const replaceMutation = useMutation({
    mutationFn: (params: { readonly id: string; readonly draft: TemplateDraft }) => replaceTemplate(params.id, params.draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }),
  });
  const deleteMutation = useMutation({ mutationFn: deleteTemplate, onSuccess: () => queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }) });
  const assetMutation = useMutation({ mutationFn: downloadTemplateAssets });
  const digimons = catalogQuery.data?.digimons ?? [];
  const shopItems = shopItemsQuery.data?.items ?? [];

  const knownTypes = useMemo(() => {
    const set = new Set<string>();
    for (const d of digimons) if (d.type) set.add(d.type);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [digimons]);

  const filtered = useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    const typeNeedle = filters.type.trim().toLowerCase();
    return digimons.filter((d) => {
      if (needle !== '' && !d.name.toLowerCase().includes(needle) && !d.id.toLowerCase().includes(needle)) return false;
      if (filters.stage !== 'all' && d.stage !== filters.stage) return false;
      if (filters.element !== 'all' && d.element !== filters.element) return false;
      if (filters.attribute !== 'all' && d.attribute !== filters.attribute) return false;
      if (typeNeedle !== '' && !(d.type ?? '').toLowerCase().includes(typeNeedle)) return false;
      return true;
    });
  }, [digimons, filters]);

  const filtersActive = filters.search !== '' || filters.stage !== 'all' || filters.element !== 'all' || filters.attribute !== 'all' || filters.type !== '';

  const submit = async (draft: TemplateDraft): Promise<void> => {
    if (dialog.kind === 'create') {
      await createMutation.mutateAsync(draft);
    } else if (dialog.kind === 'edit') {
      await replaceMutation.mutateAsync({ id: dialog.template.id, draft });
    }
    setDialog({ kind: 'closed' });
  };

  return (
    <AdminSection
      title="Game catalog"
      lede="Create, inspect, edit, delete, and re-download curated Digimon templates."
      actions={<><span className="pill" id="catalog-count">{filtersActive ? `${filtered.length} / ${digimons.length}` : `${digimons.length}`} templates</span><button className="btn btn--sm" type="button" onClick={() => setDialog({ kind: 'create' })}>Add custom</button></>}
    >
      <ErrorText error={catalogQuery.error ?? createMutation.error ?? replaceMutation.error ?? deleteMutation.error ?? assetMutation.error} />
      <div className="catalog-filter-bar" role="search" aria-label="Filter catalog">
        <label className="catalog-filter-field catalog-filter-field--search">
          <span>Search</span>
          <input
            className="input"
            type="search"
            placeholder="name or id…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
        </label>
        <label className="catalog-filter-field">
          <span>Stage</span>
          <select
            className="input"
            value={filters.stage}
            onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value === 'all' ? 'all' : (e.target.value as Stage) }))}
          >
            <option value="all">All stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="catalog-filter-field">
          <span>Element</span>
          <select
            className="input"
            value={filters.element}
            onChange={(e) => setFilters((f) => ({ ...f, element: e.target.value === 'all' ? 'all' : (e.target.value as Element) }))}
          >
            <option value="all">All elements</option>
            {ELEMENTS.map((el) => <option key={el} value={el}>{el}</option>)}
          </select>
        </label>
        <label className="catalog-filter-field">
          <span>Attribute</span>
          <select
            className="input"
            value={filters.attribute}
            onChange={(e) => setFilters((f) => ({ ...f, attribute: e.target.value === 'all' ? 'all' : (e.target.value as Attribute) }))}
          >
            <option value="all">All attributes</option>
            {ATTRIBUTES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="catalog-filter-field">
          <span>Type</span>
          <input
            className="input"
            list="admin-catalog-type-list"
            placeholder="e.g. Reptile"
            value={filters.type}
            onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
          />
          <datalist id="admin-catalog-type-list">
            {knownTypes.map((t) => <option key={t} value={t} />)}
          </datalist>
        </label>
        {filtersActive ? (
          <button
            type="button"
            className="btn btn--secondary btn--sm catalog-filter-reset"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            Reset filters
          </button>
        ) : null}
      </div>
      {catalogQuery.isPending ? <AdminMessage tone="muted">Loading catalog…</AdminMessage> : null}
      {digimons.length === 0 && !catalogQuery.isPending ? <p className="lede" id="catalog-empty">No templates yet. Add from scraped data or create a custom entry.</p> : null}
      {digimons.length > 0 && filtered.length === 0 ? <p className="lede">No templates match the current filters. <button type="button" className="admin-link-button" onClick={() => setFilters(EMPTY_FILTERS)}><b>Reset filters</b></button></p> : null}
      <div className="catalog-list" id="catalog-list">
        {filtered.map((template) => (
          <CatalogRow
            key={template.id}
            template={template}
            expanded={expandedId === template.id}
            busy={deleteMutation.isPending || assetMutation.isPending || replaceMutation.isPending}
            shopItems={shopItems}
            onToggle={() => setExpandedId(expandedId === template.id ? null : template.id)}
            onDelete={() => void deleteMutation.mutate(template.id)}
            onDownload={() => void assetMutation.mutate(template.id)}
            onEditLoot={() => setLootTarget(template)}
            onEdit={() => setDialog({ kind: 'edit', template })}
          />
        ))}
      </div>
      <CatalogEditDialog
        open={dialog.kind !== 'closed'}
        mode={dialog.kind === 'edit' ? 'edit' : 'create'}
        {...(dialog.kind === 'edit' ? { initial: dialog.template } : {})}
        catalogList={digimons}
        shopItems={shopItems}
        onClose={() => setDialog({ kind: 'closed' })}
        onSubmit={submit}
      />
      {lootTarget ? (
        <LootEditorDialog
          catalogId={lootTarget.id}
          catalogName={lootTarget.name}
          onClose={() => setLootTarget(null)}
        />
      ) : null}
    </AdminSection>
  );
}

function CatalogRow({ template, expanded, busy, shopItems, onToggle, onDelete, onDownload, onEditLoot, onEdit }: {
  readonly template: TemplateDigimon;
  readonly expanded: boolean;
  readonly busy: boolean;
  readonly shopItems: readonly { readonly id: string; readonly name: string }[];
  readonly onToggle: () => void;
  readonly onDelete: () => void;
  readonly onDownload: () => void;
  readonly onEditLoot: () => void;
  readonly onEdit: () => void;
}): JSX.Element {
  const itemNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of shopItems) m.set(it.id, it.name);
    return m;
  }, [shopItems]);
  return (
    <article className={`catalog-row${expanded ? ' is-expanded' : ''}`}>
      <button className="catalog-row-header" type="button" onClick={onToggle} aria-expanded={expanded}>
        <img src={template.assets.portrait} alt="" width="36" height="36" />
        <span className="name">{template.name}</span>
        <span className="badge">{template.stage}</span>
        <span className="badge">{template.attribute}</span>
        <span className={`pill pill--${template.element}`}>{template.element}</span>
        <span className="chevron">⌄</span>
      </button>
      {expanded ? (
        <div className="catalog-row-body">
          <div className="catalog-stats">
            {Object.entries(template.baseStats).map(([key, value]) => <span key={key}><b>{key.toUpperCase()}</b> {value}</span>)}
          </div>
          <div className="catalog-skills">
            {template.skillPool.map((skill) => <span key={skill.id}>{skill.name} · {skill.power} power · {skill.energyCost} EN</span>)}
          </div>
          {template.evolvesInto && template.evolvesInto.length > 0 ? (
            <div className="catalog-evolutions">
              <b>Evolves into:</b>
              {template.evolvesInto.map((edge) => {
                const parts: string[] = [];
                if (edge.requiredLevel !== undefined) parts.push(`Lv ${edge.requiredLevel}`);
                if (edge.requiredMood !== undefined) parts.push(`Mood ${edge.requiredMood}`);
                if (edge.requiredAttribute !== undefined) parts.push(edge.requiredAttribute);
                if (edge.requiredItemId !== undefined) {
                  const label = itemNameById.get(edge.requiredItemId) ?? edge.requiredItemId;
                  const qty = edge.requiredItemQty ?? 1;
                  parts.push(`Item ${label} ×${qty}`);
                }
                return (
                  <span key={edge.targetId} className="catalog-evolution-tag">
                    {edge.targetId}
                    {parts.length > 0 ? <span className="muted"> ({parts.join(' · ')})</span> : null}
                  </span>
                );
              })}
            </div>
          ) : null}
          <div className="catalog-links">
            {isSafeHttpUrl(template.sourceUrl) ? <a href={template.sourceUrl} target="_blank" rel="noreferrer noopener">Source</a> : null}
            {template.wikimonSlug ? <span>{template.wikimonSlug}</span> : null}
          </div>
          <div className="actions">
            <button className="btn btn--sm" type="button" onClick={onEdit}>Edit</button>
            <button className="btn btn--secondary btn--sm" type="button" onClick={onEditLoot}>Edit loot</button>
            <button className="btn btn--secondary btn--sm" type="button" disabled={busy} onClick={onDownload}>Re-download assets</button>
            <button className="btn btn--danger btn--sm" type="button" disabled={busy} onClick={onDelete}>Delete</button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
