import type { TemplateDigimon } from '@digiworld/shared/digimon';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { createCustomTemplate, deleteTemplate, downloadTemplateAssets, getCatalog, replaceTemplate, type TemplateDraft } from '../../lib/api-admin';
import { AdminMessage, AdminSection, ErrorText } from './AdminShared';
import { CatalogEditDialog } from './CatalogEditDialog';
import { LootEditorDialog } from './LootEditorDialog';

export const CATALOG_QUERY_KEY = ['admin', 'catalog'] as const;

function isSafeHttpUrl(raw: string | undefined | null): raw is string {
  if (typeof raw !== 'string') return false;
  return /^https?:\/\//i.test(raw.trim());
}

type DialogState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly template: TemplateDigimon };

export function CatalogTable(): JSX.Element {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lootTarget, setLootTarget] = useState<TemplateDigimon | null>(null);
  const catalogQuery = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: getCatalog });
  const createMutation = useMutation({ mutationFn: createCustomTemplate, onSuccess: () => queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }) });
  const replaceMutation = useMutation({
    mutationFn: (params: { readonly id: string; readonly draft: TemplateDraft }) => replaceTemplate(params.id, params.draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }),
  });
  const deleteMutation = useMutation({ mutationFn: deleteTemplate, onSuccess: () => queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }) });
  const assetMutation = useMutation({ mutationFn: downloadTemplateAssets });
  const digimons = catalogQuery.data?.digimons ?? [];

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
      actions={<><span className="pill" id="catalog-count">{digimons.length} templates</span><button className="btn btn--sm" type="button" onClick={() => setDialog({ kind: 'create' })}>Add custom</button></>}
    >
      <ErrorText error={catalogQuery.error ?? createMutation.error ?? replaceMutation.error ?? deleteMutation.error ?? assetMutation.error} />
      {catalogQuery.isPending ? <AdminMessage tone="muted">Loading catalog…</AdminMessage> : null}
      {digimons.length === 0 && !catalogQuery.isPending ? <p className="lede" id="catalog-empty">No templates yet. Add from scraped data or create a custom entry.</p> : null}
      <div className="catalog-list" id="catalog-list">
        {digimons.map((template) => (
          <CatalogRow
            key={template.id}
            template={template}
            expanded={expandedId === template.id}
            busy={deleteMutation.isPending || assetMutation.isPending || replaceMutation.isPending}
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

function CatalogRow({ template, expanded, busy, onToggle, onDelete, onDownload, onEditLoot, onEdit }: {
  readonly template: TemplateDigimon;
  readonly expanded: boolean;
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly onDelete: () => void;
  readonly onDownload: () => void;
  readonly onEditLoot: () => void;
  readonly onEdit: () => void;
}): JSX.Element {
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
