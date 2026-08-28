import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Element } from '@digiworld/shared/digimon';
import { DigdexDetail } from '../../components/digdex/DigdexDetailModal';
import { DigdexHive } from '../../components/digdex/DigdexHive';
import { getDigdex, type DigdexEntry, type DigdexResponse } from '../../lib/api-digdex';
import '../../styles/extensions-digdex.css';

export function DigidexPanel(): JSX.Element {
  const [filter, setFilter] = useState<'all' | 'met' | 'unmet'>('all');
  const [elementFilter, setElementFilter] = useState<Element | 'all'>('all');
  const [stageFilter, setStageFilter] = useState<'all' | 'Rookie' | 'Champion' | 'Ultimate' | 'Mega'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<DigdexEntry | null>(null);

  const query = useQuery<DigdexResponse>({
    queryKey: ['digdex'],
    queryFn: getDigdex,
    staleTime: 5 * 60 * 1000,
  });

  const entries = query.data?.entries ?? [];
  const total = query.data?.totalCount ?? 0;
  const metCount = query.data?.metCount ?? 0;

  const counts = useMemo(() => {
    const met = entries.filter((e) => e.met).length;
    const unmet = entries.length - met;
    const stages: Record<string, number> = { all: entries.length };
    const els: Record<string, number> = { all: entries.length };
    for (const e of entries) {
      els[e.element] = (els[e.element] || 0) + 1;
      if (e.template) {
        stages[e.template.stage] = (stages[e.template.stage] || 0) + 1;
      }
    }
    return { all: entries.length, met, unmet, stages, els };
  }, [entries]);

  const visibleEntries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter === 'met' && !entry.met) return false;
      if (filter === 'unmet' && entry.met) return false;
      if (stageFilter !== 'all' && entry.template?.stage !== stageFilter) return false;
      if (elementFilter !== 'all' && entry.element !== elementFilter) return false;
      if (needle.length > 0) {
        const name = entry.template?.name.toLowerCase() ?? '';
        if (!name.includes(needle) && !entry.catalogId.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [entries, filter, elementFilter, stageFilter, search]);

  if (query.isPending) {
    return <div className="fn-skeleton">Loading Digidex…</div>;
  }
  if (query.isError) {
    return <div className="fn-error">Falha ao carregar Digidex.</div>;
  }

  return (
    <div className="digidex-content">
      <div className="dexbar">
        <div className="comp">
          <div>
            <div className="k">Field Guide</div>
            <div className="v">
              {metCount}<small>/{total} met</small>
            </div>
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
            <label className="search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                type="text"
                placeholder="Name…"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                autoComplete="off"
              />
            </label>
          </div>

          <div className="fgroup">
            <div className="fl">Stage</div>
            <div className="seg">
              {[
                { id: 'all', label: 'All' },
                { id: 'Rookie', label: 'Rookie' },
                { id: 'Champion', label: 'Champion' },
                { id: 'Ultimate', label: 'Ultimate' },
                { id: 'Mega', label: 'Mega' },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={stageFilter === option.id ? 'on' : ''}
                  onClick={() => setStageFilter(option.id as 'all' | 'Rookie' | 'Champion' | 'Ultimate' | 'Mega')}
                >
                  {option.label} {option.id !== 'all' ? `(${counts.stages[option.id] || 0})` : ''}
                </button>
              ))}
            </div>
          </div>

          <div className="fgroup">
            <div className="fl">Status</div>
            <div className="seg">
              {([
                { id: 'all', label: 'All' },
                { id: 'met', label: 'Met' },
                { id: 'unmet', label: 'Unmet' },
              ] as const).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={filter === option.id ? 'on' : ''}
                  onClick={() => setFilter(option.id)}
                >
                  {option.label} ({counts[option.id]})
                </button>
              ))}
            </div>
          </div>

          {(filter !== 'all' || elementFilter !== 'all' || stageFilter !== 'all' || search.length > 0) && (
            <button
              className="clearchip"
              onClick={() => {
                setFilter('all');
                setElementFilter('all');
                setStageFilter('all');
                setSearch('');
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              Clear filters
            </button>
          )}
        </div>

        {query.isPending && (
          <div className="grid-wrap">
            <div className="gridempty">Loading Digidex…</div>
          </div>
        )}
        {query.isError && (
          <div className="grid-wrap">
            <div className="gridempty">Failed to load.</div>
          </div>
        )}
        {!query.isPending && !query.isError && visibleEntries.length === 0 && (
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

        {selected ? (
          <DigdexDetail
            entry={selected}
            entriesById={useMemo(() => {
              const map = new Map<string, DigdexEntry>();
              for (const entry of entries) map.set(entry.catalogId, entry);
              return map;
            }, [entries])}
            onClose={() => setSelected(null)}
            onSelect={setSelected}
          />
        ) : (
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
        )}
      </div>
    </div>
  );
}
