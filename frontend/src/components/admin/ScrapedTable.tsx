import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { addCatalogFromScraped, getScrapedList, refreshScrapedList, type ScrapedEntry } from '../../lib/api-admin';
import { AdminMessage, AdminSection, ErrorText, Field } from './AdminShared';
import { CATALOG_QUERY_KEY } from './CatalogTable';

const SCRAPED_QUERY_KEY = ['admin', 'scraped'] as const;
const PAGE_LIMIT = 25;

export function ScrapedTable(): JSX.Element {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [attribute, setAttribute] = useState('');
  const [offset, setOffset] = useState(0);
  const scrapedQuery = useQuery({ queryKey: [...SCRAPED_QUERY_KEY, search, stage, attribute, offset], queryFn: () => getScrapedList({ search, stage, attribute, limit: PAGE_LIMIT, offset }) });
  const refreshMutation = useMutation({ mutationFn: refreshScrapedList, onSuccess: () => queryClient.invalidateQueries({ queryKey: SCRAPED_QUERY_KEY }) });
  const addMutation = useMutation({ mutationFn: (skullbotId: number) => addCatalogFromScraped(skullbotId, true), onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: SCRAPED_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY })]) });
  const data = scrapedQuery.data;
  const canPrevious = offset > 0;
  const canNext = data ? offset + PAGE_LIMIT < data.total : false;

  return (
    <AdminSection title="Scraped list" lede="Browse Skullbot rows, filter them, and add selected entries to the XML catalog." actions={<button className="btn btn--sm" type="button" disabled={refreshMutation.isPending} onClick={() => void refreshMutation.mutate()}>{refreshMutation.isPending ? 'Refreshing…' : 'Refresh from skullbot'}</button>}>
      <ErrorText error={scrapedQuery.error ?? refreshMutation.error ?? addMutation.error} />
      {refreshMutation.data ? <AdminMessage tone="success">Refreshed {refreshMutation.data.entries} upstream entries.</AdminMessage> : null}
      <div className="admin-filter-bar">
        <Field label="Search"><input className="input" id="filter-search" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} /></Field>
        <Field label="Stage"><input className="input" id="filter-stage" value={stage} onChange={(event) => { setStage(event.target.value); setOffset(0); }} placeholder="Rookie" /></Field>
        <Field label="Attribute"><input className="input" id="filter-attr" value={attribute} onChange={(event) => { setAttribute(event.target.value); setOffset(0); }} placeholder="Vaccine" /></Field>
      </div>
      <div className="admin-scroll">
        <table className="admin-table" id="scraped-table">
          <thead><tr><th>Art</th><th>ID</th><th>Name</th><th>Stage</th><th>Attribute</th><th>Status</th><th>Action</th></tr></thead>
          <tbody id="scraped-tbody">
            {(data?.entries ?? []).map((entry) => <ScrapedRow key={entry.skullbot_id} entry={entry} busy={addMutation.isPending} onAdd={() => void addMutation.mutate(entry.skullbot_id)} />)}
          </tbody>
        </table>
      </div>
      {scrapedQuery.isPending ? <AdminMessage tone="muted">Loading scraped entries…</AdminMessage> : null}
      <div className="admin-pager">
        <button className="btn btn--secondary btn--sm" type="button" disabled={!canPrevious} onClick={() => setOffset(Math.max(0, offset - PAGE_LIMIT))}>Previous</button>
        <span id="scraped-page-info">{data ? `${offset + 1}-${Math.min(offset + PAGE_LIMIT, data.total)} of ${data.total}` : '—'}</span>
        <button className="btn btn--secondary btn--sm" type="button" disabled={!canNext} onClick={() => setOffset(offset + PAGE_LIMIT)}>Next</button>
      </div>
    </AdminSection>
  );
}

function ScrapedRow({ entry, busy, onAdd }: { readonly entry: ScrapedEntry; readonly busy: boolean; readonly onAdd: () => void }): JSX.Element {
  const inCatalog = entry.in_catalog === 1;
  return (
    <tr>
      <td>{entry.portrait_url ? <img src={entry.portrait_url} alt="" width="36" height="36" /> : <span className="caps">none</span>}</td>
      <td className="mono">{entry.skullbot_id}</td>
      <td>{entry.name}</td>
      <td>{entry.stage ?? '—'}</td>
      <td>{entry.attribute ?? '—'}</td>
      <td><span className={`badge${inCatalog ? ' in-catalog' : ''}`}>{inCatalog ? 'in catalog' : 'available'}</span></td>
      <td><button className="btn btn--secondary btn--sm" type="button" disabled={busy || inCatalog} onClick={onAdd}>Add to catalog</button></td>
    </tr>
  );
}
