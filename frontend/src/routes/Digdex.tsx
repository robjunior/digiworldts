import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ELEMENTS, type Element } from '@digiworld/shared/digimon';

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
    <div className="digdex-container">
      <div className="dexbar">
        <div className="comp">
          <div className="k">completion</div>
          <div className="v">
            {metCount} <small>/ {total}</small>
          </div>
        </div>
        <div className="cmeter">
          <i style={{ width: `${(metCount / Math.max(1, total)) * 100}%` }} />
        </div>
        <div className="shown">
          <b>{visibleEntries.length}</b> shown
        </div>
      </div>

      <div className="stage">
        <div className="filters">
          <div className="fgroup">
            <div className="fl">Search</div>
            <div className="search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Name or ID"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
              />
            </div>
          </div>

          <div className="fgroup">
            <div className="fl">Status</div>
            <div className="seg">
              {FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={filter === option.id ? 'on' : ''}
                  onClick={() => setFilter(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="fgroup">
            <div className="fl">Element</div>
            <div className="elist">
              {ELEMENT_FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`elrow ${elementFilter === option.id ? 'on' : ''}`}
                  style={option.id !== 'all' ? ({ '--ec': `var(--el-${option.id})` } as React.CSSProperties) : undefined}
                  onClick={() => setElementFilter(option.id)}
                >
                  {option.id !== 'all' && <div className="sw" />}
                  <div className="av" style={option.id === 'all' ? { gridColumn: '1 / span 2' } : undefined}>
                    {option.label}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {(filter !== 'all' || elementFilter !== 'all' || search.length > 0) && (
            <button
              className="clearchip"
              onClick={() => {
                setFilter('all');
                setElementFilter('all');
                setSearch('');
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear Filters
            </button>
          )}
        </div>

        {query.isPending && (
          <div className="grid-wrap">
            <div className="gridempty">Loading Digdex…</div>
          </div>
        )}
        {query.error && (
          <div className="grid-wrap">
            <div className="gridempty">Failed to load: {String(query.error)}</div>
          </div>
        )}
        {!query.isPending && !query.error && visibleEntries.length === 0 && (
          <div className="grid-wrap">
            <div className="gridempty">No entries match your filter.</div>
          </div>
        )}
        {!query.isPending && visibleEntries.length > 0 && (
          <DigdexHive
            entries={visibleEntries}
            onSelect={setSelected}
            {...(selected ? { selectedCatalogId: selected.catalogId } : {})}
            {...(elementFilter !== 'all' ? { filterElement: elementFilter } : {})}
          />
        )}

        <aside className="detail">
          <div className="dempty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <br />
            Select a Digimon to view details
          </div>
        </aside>

        {selected && (
          <DigdexDetailModal
            entry={selected}
            entriesById={entriesById}
            onClose={() => setSelected(null)}
            onSelect={setSelected}
          />
        )}
      </div>
    </div>
  );
}
