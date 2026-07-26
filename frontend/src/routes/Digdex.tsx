import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ELEMENTS, type Element } from '@digiworld/shared/digimon';

import { PageStrip } from '../components/common/PageStrip';
import { DigdexDetailModal } from '../components/digdex/DigdexDetailModal';
import { DigdexHive } from '../components/digdex/DigdexHive';
import { getDigdex, type DigdexEntry } from '../lib/api-digdex';
import '../styles/extensions-digdex.css';

const DIGDEX_QUERY_KEY = ['digdex'] as const;

type Filter = 'all' | 'met' | 'unmet';
type ElementFilter = Element | 'all';

const FILTERS: readonly { readonly id: Filter; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'met', label: 'Met' },
  { id: 'unmet', label: 'Unmet' },
];

const ELEMENT_FILTERS: readonly { readonly id: ElementFilter; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  ...ELEMENTS.map((el) => ({ id: el, label: el.charAt(0).toUpperCase() + el.slice(1) })),
];

export function Digdex(): JSX.Element {
  const query = useQuery({ queryKey: DIGDEX_QUERY_KEY, queryFn: getDigdex });
  const [filter, setFilter] = useState<Filter>('all');
  const [elementFilter, setElementFilter] = useState<ElementFilter>('all');
  const [search, setSearch] = useState<string>('');
  const [selected, setSelected] = useState<DigdexEntry | null>(null);

  const entries = query.data?.entries ?? [];
  const total = query.data?.totalCount ?? 0;
  const metCount = query.data?.metCount ?? 0;

  const entriesById = useMemo(() => {
    const map = new Map<string, DigdexEntry>();
    for (const entry of entries) map.set(entry.catalogId, entry);
    return map;
  }, [entries]);

  const visibleEntries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter === 'met' && !entry.met) return false;
      if (filter === 'unmet' && entry.met) return false;
      if (elementFilter !== 'all') {
        if (!entry.met || !entry.template || entry.template.element !== elementFilter) return false;
      }
      if (needle.length > 0) {
        const name = entry.template?.name.toLowerCase() ?? '';
        if (!name.includes(needle) && !entry.catalogId.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [entries, filter, elementFilter, search]);

  return (
    <div className="app-shell digdex-shell">
      <main className="app-main digdex-main">
        <PageStrip
          name="Digdex"
          tone="action"
          metrics={[
            { label: <>bestiary &mdash; encounter Digimon to reveal them</>, className: 'muted' },
            { label: <><b>{metCount}</b>/{total} met</> },
          ]}
        />

        <div className="digdex-header-row">
          <input
            className="input digdex-search"
            type="search"
            placeholder="search by name or id…"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </div>

        {query.isPending ? <div className="digdex-empty">Loading Digdex…</div> : null}
        {query.error ? <div className="digdex-empty">Failed to load: {String(query.error)}</div> : null}
        {!query.isPending && !query.error && visibleEntries.length === 0 ? (
          <div className="digdex-empty">No entries match your filter.</div>
        ) : null}
        {!query.isPending && visibleEntries.length > 0 ? (
          <DigdexHive entries={visibleEntries} onSelect={setSelected} />
        ) : null}

        <div className="digdex-island" role="toolbar" aria-label="Digdex filters">
          <div className="digdex-island-group">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`digdex-pill${filter === option.id ? ' is-active' : ''}`}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="digdex-island-sep" aria-hidden />
          <div className="digdex-island-group digdex-island-scroll">
            {ELEMENT_FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`digdex-pill digdex-pill-element digdex-pill-${option.id}${elementFilter === option.id ? ' is-active' : ''}`}
                onClick={() => setElementFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {selected ? (
          <DigdexDetailModal
            entry={selected}
            entriesById={entriesById}
            onClose={() => setSelected(null)}
            onSelect={setSelected}
          />
        ) : null}
      </main>
    </div>
  );
}
