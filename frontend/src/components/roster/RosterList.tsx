import { useState, useMemo } from 'react';

import type { TemplateDigimon, Element } from '@digiworld/shared/digimon';
import { ELEMENTS, ATTRIBUTES } from '@digiworld/shared/digimon';

import type { ActivityByMon, RosterActions, RosterMon } from './types';
import { formatRemaining, isDowned, totalStats, xpPct } from './types';
import { SkillEditor } from './SkillEditor';
import { ResistanceChart } from './ResistanceChart';

const ATTR_TO_EL: Record<string, Element> = { Virus: 'fire', Data: 'water', Vaccine: 'plant', Free: 'electricity', Variable: 'wind' };
const el = (r: RosterMon) => ATTR_TO_EL[r.template?.attribute ?? 'Free'] ?? 'null';

const STAT_MAX: Record<string, number> = { hp: 1400, en: 41, atk: 260, def: 200, int: 160, spd: 160 };

type RosterListProps = {
  readonly roster: readonly RosterMon[];
  readonly now: number;
  readonly activityByMon: ActivityByMon;
  readonly actions: RosterActions;
  readonly templateById: ReadonlyMap<string, TemplateDigimon>;
  readonly reverseGraph: ReadonlyMap<string, readonly string[]>;
  readonly message?: string | null;
};

export function RosterList({ roster, now, activityByMon, actions, templateById, reverseGraph, message }: RosterListProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string>(roster[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [elFilter, setElFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'stats'|'skills'>('stats');

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return roster.filter((r) => {
      const e = el(r);
      if (elFilter !== 'all' && e !== elFilter) return false;
      if (query && !(r.nickname.toLowerCase().includes(query) || r.catalogId.toLowerCase().includes(query))) return false;
      return true;
    });
  }, [roster, q, elFilter]);

  const selectedMon = roster.find(r => r.id === selectedId) ?? filtered[0] ?? null;

  const handleSelect = (id: string) => setSelectedId(id);

  // Filter chips
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
    ...ELEMENTS.map(e => ({ v: e, l: e.toUpperCase(), n: counts[e] ?? 0 }))
  ];

  return (
    <>
      <aside className="master" data-od-id="master-list">
        <div className="mhead">
          <div className="kick">Digivice Registry</div>
          <h1>Your Roster</h1>
          <p className="sub" id="sub">
            {elFilter === 'all' && !q ? `${roster.length} registered · filter by element` : `${filtered.length} of ${roster.length} shown`}
          </p>
        </div>
        <div className="tools">
          <label className="search" aria-label="Search roster">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
            <input 
              id="search" 
              type="search" 
              placeholder="Search nickname or species…" 
              autoComplete="off" 
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div className="filters" id="filters" role="group" aria-label="Filter by element">
            {chips.map(({ v, l, n }) => (
              <button 
                key={v}
                className="chip" 
                data-el={v} 
                aria-pressed={elFilter === v}
                onClick={() => setElFilter(v)}
              >
                {l}<span className="n">{n}</span>
              </button>
            ))}
            {elFilter === 'all' && !q ? null : (
              <button className="clearf" id="clearf" onClick={() => { setQ(''); setElFilter('all'); }}>Clear</button>
            )}
          </div>
        </div>
        <div className="list" id="list" role="listbox" aria-label="Digimon roster">
          {filtered.length === 0 ? (
            <div className="empty">
              <p>No Digimon match these filters.<br/>The Digivice registry found nothing.</p>
              <button id="reset" onClick={() => { setQ(''); setElFilter('all'); }}>Clear filters</button>
            </div>
          ) : (
            filtered.map((r) => {
              const e = el(r);
              const template = templateById.get(r.catalogId);
              const stage = template?.stage ?? 'Unknown';
              return (
                <button 
                  key={r.id}
                  className="row" 
                  role="option" 
                  data-id={r.id} 
                  data-el={e} 
                  tabIndex={0}
                  aria-selected={selectedMon?.id === r.id}
                  onClick={() => handleSelect(r.id)}
                >
                  <span className="mug"><img src={`/assets/digimon/${r.catalogId}/dot.gif`} alt="" onError={(ev) => (ev.currentTarget.style.visibility = 'hidden')} /></span>
                  <span className="who">
                    <span className="nm">{r.nickname}</span>
                    <span className="rn">{template?.name ?? r.catalogId}</span>
                    <span className="tpl">{stage} · {e.charAt(0).toUpperCase() + e.slice(1)}</span>
                  </span>
                  <span className="lv">LV<b>{r.level}</b></span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section className="detail" id="detail" data-od-id="detail-panel" tabIndex={-1}>
        {message && <div style={{ padding: '10px', background: 'var(--signal)', color: '#fff', textAlign: 'center' }}>{message}</div>}
        {selectedMon ? (
          <DetailPane 
            r={selectedMon} 
            templateById={templateById} 
            activeTab={activeTab} 
            setActiveTab={setActiveTab} 
            now={now}
            actions={actions}
          />
        ) : null}
      </section>
    </>
  );
}

function DetailPane({ r, templateById, activeTab, setActiveTab, now, actions }: any) {
  const e = el(r);
  const template = templateById.get(r.catalogId);
  const stage = template?.stage ?? 'Unknown';
  const attribute = template?.attribute ?? 'Unknown';
  
  const stats = totalStats(r);
  const order = [
    { k: 'hp', l: 'HP' }, { k: 'en', l: 'EN' }, { k: 'atk', l: 'ATK' },
    { k: 'def', l: 'DEF' }, { k: 'int', l: 'INT' }, { k: 'spd', l: 'SPD' }
  ];

  return (
    <div className="dwrap" data-el={e}>
      <div className="hero">
        <div className="splash"><img src={`/assets/digimon/${r.catalogId}/portrait.webp`} alt={r.nickname} /></div>
        <div className="wash"></div>
        <span className="cap">{template?.name}</span>
        <div className="hinfo">
          <div className="kick">{stage} · {e.charAt(0).toUpperCase() + e.slice(1)}</div>
          <h2>{r.nickname}</h2>
          <p className="tpl">{template?.name} &nbsp;/&nbsp; Attribute <b>{attribute}</b></p>
          <div className="meta">
            <div className="cell"><div className="lbl">Level</div><div className="val">{r.level}</div></div>
            <div className="cell"><div className="lbl">Element</div><div className="val el">{e.charAt(0).toUpperCase() + e.slice(1)}</div></div>
            <div className="cell"><div className="lbl">Stage</div><div className="val">{stage}</div></div>
            <div className="cell"><div className="lbl">Mood</div><div className="val">{r.mood}%</div></div>
          </div>
          <div className="status-row">
            <span className={`statchip ${r.status}`}><span className="dot"></span>{typeof r.slot === 'number' ? `In party · slot ${r.slot + 1}` : 'Resting'}</span>
            <span className="statchip"><span className="dot"></span>XP {Math.round(r.xp)} / {r.xpNext}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
              <button className="navbtn" style={{ padding: '4px 8px' }} onClick={() => actions.onRename(r)}>Rename</button>
              <button className="navbtn" style={{ padding: '4px 8px' }} onClick={() => actions.onEvolve(r.id)} disabled={isDowned(r, now)}>Evolve</button>
              {typeof r.slot !== 'number' && (
                <button className="navbtn" style={{ padding: '4px 8px', color: 'var(--signal)' }} onClick={() => actions.onAddToParty(r)} disabled={isDowned(r, now)}>Add to Party</button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="dtabs" role="tablist" aria-label="Digimon detail sections">
        <button className={`dtab ${activeTab === 'stats' ? 'is-on' : ''}`} role="tab" aria-selected={activeTab === 'stats'} onClick={() => setActiveTab('stats')}>Stats</button>
        <button className={`dtab ${activeTab === 'skills' ? 'is-on' : ''}`} role="tab" aria-selected={activeTab === 'skills'} onClick={() => setActiveTab('skills')}>Skills</button>
      </div>

      <div className="tabwrap">
        <div className={`tabpanel ${activeTab === 'stats' ? 'is-on' : ''}`} data-panel="stats" role="tabpanel" hidden={activeTab !== 'stats'}>
          <h3 className="stitle">Stats</h3>
          <div className="stats statcols">
            {order.map(({ k, l }) => {
              const v = stats[k as keyof typeof stats];
              const bo = (r.statBonus as any)?.[k] ?? 0;
              const max = STAT_MAX[k] ?? 1000;
              const pct = Math.min(100, Math.round((v / max) * 100));
              return (
                <div key={k} className={`stat ${k}`}>
                  <span className="sl">{l}</span>
                  <span className="track"><span className="fill" data-w={pct} style={{ width: `${pct}%` }}></span></span>
                  <span className="sv">{v}{bo ? <span className="bo">+{bo}</span> : ''}</span>
                </div>
              );
            })}
          </div>
          {template && <ResistanceChart template={template} />}
        </div>

        <div className={`tabpanel ${activeTab === 'skills' ? 'is-on' : ''}`} data-panel="skills" role="tabpanel" hidden={activeTab !== 'skills'}>
          <SkillEditor monId={r.id} />
        </div>
      </div>
    </div>
  );
}
