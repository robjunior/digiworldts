import type { TemplateDigimon } from '@digiworld/shared/digimon';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { createCustomTemplate, deleteTemplate, downloadTemplateAssets, getCatalog, type TemplateDraft } from '../../lib/api-admin';
import { AdminMessage, AdminSection, ErrorText } from './AdminShared';
import { CatalogEditDialog } from './CatalogEditDialog';
import { LootEditorDialog } from './LootEditorDialog';

export const CATALOG_QUERY_KEY = ['admin', 'catalog'] as const;

/** Defense-in-depth: only render `<a href>` for http(s) URLs. Backend also
 *  validates on write, but the frontend must not trust catalog rows loaded
 *  from any pre-fix XML (or if an admin's UI copies javascript: URIs). */
function isSafeHttpUrl(raw: string | undefined | null): raw is string {
  if (typeof raw !== 'string') return false;
  return /^https?:\/\//i.test(raw.trim());
}

export function CatalogTable(): JSX.Element {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lootTarget, setLootTarget] = useState<TemplateDigimon | null>(null);
  const catalogQuery = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: getCatalog });
  const createMutation = useMutation({ mutationFn: createCustomTemplate, onSuccess: () => queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }) });
  const deleteMutation = useMutation({ mutationFn: deleteTemplate, onSuccess: () => queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }) });
  const assetMutation = useMutation({ mutationFn: downloadTemplateAssets });
  const digimons = catalogQuery.data?.digimons ?? [];

  const create = async (draft: TemplateDraft): Promise<void> => {
    await createMutation.mutateAsync(draft);
    setDialogOpen(false);
  };

  return (
    <AdminSection
      title="Game catalog"
      lede="Create, inspect, delete, and re-download curated Digimon templates."
      actions={<><span className="pill" id="catalog-count">{digimons.length} templates</span><button className="btn btn--sm" type="button" onClick={() => setDialogOpen(true)}>Add custom</button></>}
    >
      <ErrorText error={catalogQuery.error ?? createMutation.error ?? deleteMutation.error ?? assetMutation.error} />
      {catalogQuery.isPending ? <AdminMessage tone="muted">Loading catalog…</AdminMessage> : null}
      {digimons.length === 0 && !catalogQuery.isPending ? <p className="lede" id="catalog-empty">No templates yet. Add from scraped data or create a custom entry.</p> : null}
      <div className="catalog-list" id="catalog-list">
        {digimons.map((template) => (
          <CatalogRow
            key={template.id}
            template={template}
            expanded={expandedId === template.id}
            busy={deleteMutation.isPending || assetMutation.isPending}
            onToggle={() => setExpandedId(expandedId === template.id ? null : template.id)}
            onDelete={() => void deleteMutation.mutate(template.id)}
            onDownload={() => void assetMutation.mutate(template.id)}
            onEditLoot={() => setLootTarget(template)}
          />
        ))}
      </div>
      <CatalogEditDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSubmit={create} />
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

function CatalogRow({ template, expanded, busy, onToggle, onDelete, onDownload, onEditLoot }: { readonly template: TemplateDigimon; readonly expanded: boolean; readonly busy: boolean; readonly onToggle: () => void; readonly onDelete: () => void; readonly onDownload: () => void; readonly onEditLoot: () => void }): JSX.Element {
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
          <div className="catalog-links">
            {isSafeHttpUrl(template.sourceUrl) ? <a href={template.sourceUrl} target="_blank" rel="noreferrer noopener">Source</a> : null}
            {template.wikimonSlug ? <span>{template.wikimonSlug}</span> : null}
          </div>
          <div className="actions">
            <button className="btn btn--secondary btn--sm" type="button" onClick={onEditLoot}>Edit loot</button>
            <button className="btn btn--secondary btn--sm" type="button" disabled={busy} onClick={onDownload}>Re-download assets</button>
            <button className="btn btn--danger btn--sm" type="button" disabled={busy} onClick={onDelete}>Delete</button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
