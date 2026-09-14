import { useState, useMemo } from 'react';

import type { TemplateDigimon, Element } from '@digiworld/shared/digimon';
import { ELEMENTS, ATTRIBUTES } from '@digiworld/shared/digimon';

import { useT } from '../../hooks/useLocale';
import type { ActivityByMon, RosterActions, RosterMon } from './types';
import { formatRemaining, isDowned, perStatTrainingProgress, scaledStats, trainingProgress, xpPct } from './types';
import { PartyPicker } from './PartyPicker';
import { SkillEditor } from './SkillEditor';
import { ResistanceChart } from './ResistanceChart';
import { DigimonSprite } from '../common/DigimonSprite';

const el = (r: RosterMon): string => r.template?.element ?? 'null';

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
  const t = useT();
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
      <section className="detail" id="detail" data-od-id="detail-panel" tabIndex={-1}>
        <div className="roster-toolbar">
          <PartyPicker roster={roster} now={now} actions={actions} />
          <div className="tools">
            <label className="search" aria-label={t('common.search')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
              <input 
                id="search" 
                type="search" 
                placeholder={t('roster.search_placeholder')}
                autoComplete="off" 
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <div className="filters" id="filters" role="group" aria-label={t('roster.filter_by_element')}>
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
        </div>
        <div className="roster-list-compact">
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
              const inNursery = r.status === 'nursery';
              const dragDisabled = typeof r.slot === 'number' || isDowned(r, now) || inNursery;
              return (
                <button
                  key={r.id}
                  className={`row${inNursery ? ' row--nursery' : ''}`}
                  role="option"
                  data-id={r.id}
                  data-el={e}
                  data-status={r.status}
                  tabIndex={0}
                  aria-selected={selectedMon?.id === r.id}
                  onClick={() => handleSelect(r.id)}
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
        {message && <div style={{ padding: '10px', background: 'var(--signal)', color: '#fff', textAlign: 'center' }}>{message}</div>}
        {selectedMon ? (
          <DetailPane 
            r={selectedMon} 
            templateById={templateById} 
            activeTab={activeTab} 
            setActiveTab={setActiveTab} 
            now={now}
            actions={actions}
            activityByMon={activityByMon}
          />
        ) : null}
      </section>
    </>
  );
}

function DetailPane({ r, templateById, activeTab, setActiveTab, now, actions, activityByMon }: any) {
  const t = useT();
  const e = el(r);
  const template = templateById.get(r.catalogId);
  const stage = template?.stage ?? 'Unknown';
  const attribute = template?.attribute ?? 'Unknown';

  const stats = scaledStats(r);
  const training = trainingProgress(r);
  const perStat = perStatTrainingProgress(r);
  const activity = activityByMon?.get(r.id) ?? null;
  const trainingStats = new Set<string>(activity?.statKinds ?? []);
  const order = [
    { k: 'hp', l: 'HP' }, { k: 'en', l: 'EN' }, { k: 'atk', l: 'ATK' },
    { k: 'def', l: 'DEF' }, { k: 'int', l: 'INT' }, { k: 'spd', l: 'SPD' }
  ] as const;

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
            <span className={`statchip ${r.status}${isDowned(r, now) ? ' is-down' : ''}`}><span className="dot"></span>{isDowned(r, now) ? `DOWN · ${formatRemaining(r.reviveAt, now)}` : typeof r.slot === 'number' ? `In party · slot ${r.slot + 1}` : 'Resting'}</span>
            <span className="statchip"><span className="dot"></span>XP {Math.round(r.xp)} / {r.xpNext}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
              <button className="rl-action-btn rl-action-btn--rename" onClick={() => actions.onRename(r)}>Rename</button>
              {isDowned(r, now) ? (
                <button className="rl-action-btn rl-action-btn--revive" onClick={() => actions.onRevive(r.id)}>Revive</button>
              ) : null}
              <button className="rl-action-btn rl-action-btn--evolve" onClick={() => actions.onEvolve(r.id)} disabled={isDowned(r, now)}>Evolve</button>
              {typeof r.slot !== 'number' && (
                <button className="rl-action-btn rl-action-btn--party" onClick={() => actions.onAddToParty(r)} disabled={isDowned(r, now) || r.status === 'nursery'}>Add to Party</button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="dtabs" role="tablist" aria-label="Digimon detail sections">
        <button className={`dtab ${activeTab === 'stats' ? 'is-on' : ''}`} role="tab" aria-selected={activeTab === 'stats'} onClick={() => setActiveTab('stats')}>{t('roster.tab_stats')}</button>
        <button className={`dtab ${activeTab === 'skills' ? 'is-on' : ''}`} role="tab" aria-selected={activeTab === 'skills'} onClick={() => setActiveTab('skills')}>{t('roster.tab_skills')}</button>
      </div>

      <div className="tabwrap">
        <div className={`tabpanel ${activeTab === 'stats' ? 'is-on' : ''}`} data-panel="stats" role="tabpanel" hidden={activeTab !== 'stats'}>
          <h3 className="stitle">
            Stats
            {training !== null ? (
              <span className="stage-training">
                <span className="stt-lbl">Stage training</span>
                <span className={`stt-pct${training.overallPct >= 100 ? ' is-max' : ''}`}>{training.overallPct}%</span>
                <span className="stt-detail">
                  CMB {training.combat.filled}/{training.combat.cap} · HP·EN {training.hpen.filled}/{training.hpen.cap}
                </span>
              </span>
            ) : null}
          </h3>
          <div className="stats statcols">
            {order.map(({ k, l }) => {
              const v = stats[k];
              const bo = r.statBonus[k] ?? 0;
              const prog = perStat?.[k] ?? null;
              const pct = prog?.pct ?? 0;
              const filled = prog?.filled ?? 0;
              const cap = prog?.cap ?? 0;
              const isTraining = trainingStats.has(k);
              return (
                <div key={k} className={`stat ${k}${isTraining ? ' is-training' : ''}`}>
                  <span className="sl">
                    {l}
                    {isTraining ? <span className="trn-pill" title="Currently training this stat">TRN</span> : null}
                  </span>
                  <span className="track" title={`${l} · ${training?.stage ?? 'stage'} training ${filled}/${cap} (${pct}%)`}>
                    <span className={`fill${pct >= 100 ? ' is-max' : ''}`} data-w={pct} style={{ width: `${pct}%` }}></span>
                  </span>
                  <span className="sv">
                    {k === 'hp' && r.currentHp !== null ? <span className="sv-cur" style={{ opacity: 0.7 }}>{r.currentHp}/</span> : null}
                    {k === 'en' && r.currentEn !== null ? <span className="sv-cur" style={{ opacity: 0.7 }}>{r.currentEn}/</span> : null}
                    {v}{bo ? <span className="bo">+{bo}</span> : ''}
                  </span>
                </div>
              );
            })}
          </div>
          {template && <ResistanceChart template={template} />}
        </div>

        <div className={`tabpanel ${activeTab === 'skills' ? 'is-on' : ''}`} data-panel="skills" role="tabpanel" hidden={activeTab !== 'skills'}>
          <SkillEditor key={r.id} monId={r.id} />
        </div>
      </div>
    </div>
  );
}
