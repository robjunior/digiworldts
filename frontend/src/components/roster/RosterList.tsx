import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import type { TemplateDigimon } from '@digiworld/shared/digimon';
import { ELEMENTS } from '@digiworld/shared/digimon';

import { useT } from '../../hooks/useLocale';
import type { RosterActions, RosterMon } from './types';
import { isDowned } from './types';
import { PartyPicker } from './PartyPicker';
import { DigimonSprite } from '../common/DigimonSprite';

const el = (r: RosterMon): string => r.template?.element ?? 'null';

type RosterListProps = {
  readonly roster: readonly RosterMon[];
  readonly now: number;
  readonly actions: RosterActions;
  readonly templateById: ReadonlyMap<string, TemplateDigimon>;
  readonly message?: string | null;
};

export function RosterList({ roster, now, actions, templateById, message }: RosterListProps): JSX.Element {
  const t = useT();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [elFilter, setElFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return roster.filter((r) => {
      const e = el(r);
      if (elFilter !== 'all' && e !== elFilter) return false;
      if (query && !(r.nickname.toLowerCase().includes(query) || r.catalogId.toLowerCase().includes(query))) return false;
      return true;
    });
  }, [roster, q, elFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of roster) {
      const e = el(r);
      c[e] = (c[e] ?? 0) + 1;
    }
    return c;
  }, [roster]);

  const chips = [
    { v: 'all', l: 'ALL', n: roster.length },
    ...ELEMENTS.map((element) => ({ v: element, l: element.toUpperCase(), n: counts[element] ?? 0 })),
  ];

  return (
    <section className="detail roster-shell" id="detail" data-od-id="roster-panel" tabIndex={-1}>
      <div className="roster-toolbar">
        <PartyPicker roster={roster} now={now} actions={actions} />
        <div className="tools">
          <label className="search" aria-label={t('common.search')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
            <input
              id="search"
              type="search"
              placeholder={t('roster.search_placeholder')}
              autoComplete="off"
              value={q}
              onChange={(event) => setQ(event.currentTarget.value)}
            />
          </label>
          <div className="filters" id="filters" role="group" aria-label={t('roster.filter_by_element')}>
            {chips.map(({ v, l, n }) => (
              <button
                key={v}
                type="button"
                className="chip"
                data-el={v}
                aria-pressed={elFilter === v}
                onClick={() => setElFilter(v)}
              >
                {l}<span className="n">{n}</span>
              </button>
            ))}
            {elFilter === 'all' && !q ? null : (
              <button className="clearf" id="clearf" type="button" onClick={() => { setQ(''); setElFilter('all'); }}>Clear</button>
            )}
          </div>
        </div>
      </div>

      <div className="roster-list-compact">
        {filtered.length === 0 ? (
          <div className="empty">
            <p>No Digimon match these filters.<br />The Digivice registry found nothing.</p>
            <button id="reset" type="button" onClick={() => { setQ(''); setElFilter('all'); }}>Clear filters</button>
          </div>
        ) : (
          filtered.map((r) => {
            const e = el(r);
            const template = templateById.get(r.catalogId);
            const stage = template?.stage ?? 'Unknown';
            const inNursery = r.status === 'nursery';
            const dragDisabled = typeof r.slot === 'number' || isDowned(r, now) || inNursery;
            return (
              <button
                key={r.id}
                type="button"
                className={`row${inNursery ? ' row--nursery' : ''}`}
                role="option"
                data-id={r.id}
                data-el={e}
                data-status={r.status}
                tabIndex={0}
                onClick={() => navigate(`/creature/${encodeURIComponent(r.id)}`)}
                aria-label={`${r.nickname}, ${template?.name ?? r.catalogId}, Level ${r.level} ${stage}, ${e} element`}
                draggable={!dragDisabled}
                onDragStart={(event) => {
                  if (dragDisabled) { event.preventDefault(); return; }
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', r.id);
                }}
              >
                <span className="mug"><DigimonSprite catalogId={r.catalogId} variant="portrait" /></span>
                <span className="who">
                  <span className="nm">{r.nickname}</span>
                  <span className="rn">{template?.name ?? r.catalogId}</span>
                  <span className="tpl">{stage} · {e.charAt(0).toUpperCase() + e.slice(1)}</span>
                </span>
                {inNursery ? <span className="row-badge row-badge--nursery">In nursery</span> : null}
                <span className="lv">LV<b>{r.level}</b></span>
              </button>
            );
          })
        )}
      </div>
      {message !== null && message !== undefined ? (
        <div style={{ padding: '10px', background: 'var(--signal)', color: '#fff', textAlign: 'center' }}>{message}</div>
      ) : null}
    </section>
  );
}