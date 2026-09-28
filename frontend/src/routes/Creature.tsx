import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Attribute, Element, Stage, TemplateDigimon } from '@digiworld/shared/digimon';

import { RenameDialog } from '../components/roster/RenameDialog';
import { ResistanceChart } from '../components/roster/ResistanceChart';
import { SkillEditor } from '../components/roster/SkillEditor';
import { EvolutionChain } from '../components/roster/EvolutionChain';
import { EvoConditions, EvoLine, pastLine } from '../components/roster/EvolveDialog';
import type { ActivityByMon, RosterMon } from '../components/roster/types';
import {
  formatRemaining,
  isDowned,
  moodInfo,
  scaledStats,
  xpPct,
} from '../components/roster/types';
import { useT } from '../hooks/useLocale';
import { getRoster } from '../lib/api';
import { getCatalog } from '../lib/api-catalog';
import {
  evolveRosterMon,
  getEvolutionGate,
  getTrainingStatus,
  renameRosterMon,
  reviveRosterMon,
  setPartySlot,
  type EvolutionGate,
} from '../lib/api-roster';
import '../styles/extensions-roster.css';
import '../styles/extensions-creature.css';

const ROSTER_QUERY_KEY = ['roster'] as const;
const TRAINING_QUERY_KEY = ['training'] as const;
const CATALOG_QUERY_KEY = ['catalog'] as const;

const el = (r: RosterMon): string => r.template?.element ?? 'null';
const cap = (s: string): string => (s.charAt(0) ?? '').toUpperCase() + s.slice(1);

type TabKey = 'stats' | 'skills' | 'info' | 'evolution';
type AnimStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const STAT_ORDER = [
  { k: 'hp', l: 'HP' },
  { k: 'en', l: 'EN' },
  { k: 'atk', l: 'ATK' },
  { k: 'def', l: 'DEF' },
  { k: 'int', l: 'INT' },
  { k: 'spd', l: 'SPD' },
] as const;

// Full bar reference per stat (light-theme ceilings, mirror of the proto sheet).
const STAT_MAX: Record<string, number> = { hp: 1400, en: 41, atk: 260, def: 200, int: 160, spd: 160 };

export function Creature(): JSX.Element {
  const { monId = '' } = useParams<{ readonly monId: string }>();
  const queryClient = useQueryClient();
  const t = useT();

  const rosterQuery = useQuery({ queryKey: ROSTER_QUERY_KEY, queryFn: getRoster });
  const trainingQuery = useQuery({ queryKey: TRAINING_QUERY_KEY, queryFn: getTrainingStatus, retry: false });
  const catalogQuery = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: getCatalog, staleTime: 5 * 60 * 1000 });

  const roster = rosterQuery.data?.roster ?? [];
  const mon = useMemo(() => roster.find((r) => r.id === monId) ?? null, [roster, monId]);

  const [now, setNow] = useState<number>(() => Date.now());
  const [activeTab, setActiveTab] = useState<TabKey>('stats');
  const [message, setMessage] = useState<string | null>(null);
  const [renameMon, setRenameMon] = useState<RosterMon | null>(null);
  const [evolutionGate, setEvolutionGate] = useState<EvolutionGate | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const templateById = useMemo<ReadonlyMap<string, TemplateDigimon>>(() => {
    const m = new Map<string, TemplateDigimon>();
    for (const d of catalogQuery.data?.digimons ?? []) m.set(d.id, d);
    return m;
  }, [catalogQuery.data]);

  const reverseGraph = useMemo<ReadonlyMap<string, readonly string[]>>(() => {
    const g = new Map<string, string[]>();
    for (const d of catalogQuery.data?.digimons ?? []) {
      for (const edge of d.evolvesInto ?? []) {
        const list = g.get(edge.targetId) ?? [];
        list.push(d.id);
        g.set(edge.targetId, list);
      }
    }
    return g;
  }, [catalogQuery.data]);

  const activityByMon = useMemo<ActivityByMon>(() => {
    const entries = trainingQuery.data?.stations.flatMap((station) => station.active ? [[station.active.monId, station.active] as const] : []) ?? [];
    return new Map(entries);
  }, [trainingQuery.data]);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: TRAINING_QUERY_KEY });
  };

  const evolveMutation = useMutation({
    mutationFn: ({ monId: id, targetCatalogId }: { readonly monId: string; readonly targetCatalogId: string }) => evolveRosterMon(id, targetCatalogId),
    onSuccess: (result) => {
      setMessage(`Evolved into ${result.nickname}.`);
      setEvolutionGate(null);
      setAnimStep(0);
      setAnimTargetId(null);
      setSelTargetId(null);
      invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'evolution failed'),
  });
  const renameMutation = useMutation({
    mutationFn: ({ monId: id, nickname }: { readonly monId: string; readonly nickname: string }) => renameRosterMon(id, nickname),
    onSuccess: () => { setMessage('Nickname updated.'); setRenameMon(null); invalidate(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'rename failed'),
  });
  const reviveMutation = useMutation({
    mutationFn: reviveRosterMon,
    onSuccess: () => { setMessage('Revived.'); invalidate(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'revive failed'),
  });
  const partyMutation = useMutation({
    mutationFn: ({ monId: id, slot }: { readonly monId: string; readonly slot: number }) => setPartySlot(id, slot),
    onSuccess: () => { setMessage('Party updated.'); invalidate(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'party update failed'),
  });

  const partyBySlot = useMemo<readonly (RosterMon | null)[]>(() => {
    const slots: (RosterMon | null)[] = [null, null, null];
    for (const r of roster) {
      if (typeof r.slot === 'number' && r.slot >= 0 && r.slot < 3) slots[r.slot] = r;
    }
    return slots;
  }, [roster]);

  const addToParty = (): void => {
    if (!mon) return;
    if (down) { setMessage('This Digimon is recovering. Revive it first.'); return; }
    if (mon.status === 'nursery') { setMessage('Still in the nursery — graduate it to Rookie first.'); return; }
    const emptySlot = partyBySlot.findIndex((slot) => slot === null);
    if (emptySlot < 0) { setMessage('Party is full — remove a member first.'); return; }
    partyMutation.mutate({ monId: mon.id, slot: emptySlot });
  };

  const loadGate = (): void => {
    if (!mon || evolutionGate) return;
    void getEvolutionGate(mon.id).then(setEvolutionGate).catch((error: unknown) => { if (error instanceof Error) setMessage(error.message); else throw error; });
  };

  // ---- evolution tab state (reused from EvolveDialog) ----
  const [selTargetId, setSelTargetId] = useState<string | null>(null);
  const [animStep, setAnimStep] = useState<AnimStep>(0);
  const [animTargetId, setAnimTargetId] = useState<string | null>(null);
  const timeoutsRef = useRef<number[]>([]);
  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const animNames = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const [id, tpl] of templateById) m[id] = tpl.name;
    return m;
  }, [templateById]);

  useEffect(() => () => { for (const id of timeoutsRef.current) window.clearTimeout(id); timeoutsRef.current = []; }, []);

  const gate = evolutionGate;
  const firstEligible = useMemo(() => gate?.options.find((o) => o.eligible) ?? gate?.options[0] ?? null, [gate]);
  useEffect(() => {
    if (activeTab === 'evolution' && mon) loadGate();
  }, [activeTab, mon]);
  useEffect(() => {
    if (!gate) return;
    setSelTargetId((prev) => prev ?? firstEligible?.catalogId ?? null);
  }, [gate, firstEligible]);

  if (rosterQuery.isLoading || catalogQuery.isLoading) {
    return <div className="cr-missing"><h2>…</h2><p role="status">Loading creature…</p></div>;
  }
  if (!mon) {
    return (
      <div className="cr-missing">
        <h2>Creature not found</h2>
        <p>This Digimon is no longer in your registry — it may have been evolved or removed.</p>
        <Link to="/roster">← Back to roster</Link>
      </div>
    );
  }

  const e = el(mon);
  const template = templateById.get(mon.catalogId);
  const stage = template?.stage ?? 'Unknown';
  const attribute = template?.attribute ?? 'Unknown';
  const currentElement: Element | 'null' = template?.element ?? 'null';
  const currentAttribute: Attribute = template?.attribute ?? 'Free';
  const currentStage: Stage = template?.stage ?? (gate?.currentStage ?? 'Rookie');
  const currentStats = scaledStats(mon);
  const down = isDowned(mon, now);
  const mood = moodInfo(mon);

  const selectedOption = selTargetId ? gate?.options.find((o) => o.catalogId === selTargetId) : undefined;
  const selectedTemplate = selTargetId ? templateById.get(selTargetId) : undefined;
  const selectedIsRoot = selTargetId === mon.catalogId;
  const past = pastLine(mon.evolutionHistory, mon.catalogId, templateById);

  const startEvolve = (catalogId: string): void => {
    if (reducedMotion) { evolveMutation.mutate({ monId: mon.id, targetCatalogId: catalogId }); return; }
    setAnimTargetId(catalogId);
    setAnimStep(1);
    const push = (delay: number, step: AnimStep): void => {
      const id = window.setTimeout(() => setAnimStep(step), delay);
      timeoutsRef.current.push(id);
    };
    push(700, 2);
    push(2400, 3);
    push(3200, 4);
    push(3400, 5);
    push(3800, 6);
    const fireId = window.setTimeout(() => {
      evolveMutation.mutate({ monId: mon.id, targetCatalogId: catalogId });
      setAnimStep(0);
      setAnimTargetId(null);
    }, 5000);
    timeoutsRef.current.push(fireId);
  };

  const animCurrent = animTargetId ? template?.assets.dot ?? null : null;
  const animTargetTemplate = animTargetId ? templateById.get(animTargetId) : undefined;
  const animTargetDot = animTargetTemplate?.assets.dot ?? null;
  const animTargetName = animTargetTemplate?.name ?? animTargetId ?? '';
  const displayDot = animStep >= 5 ? animTargetDot : animCurrent;
  const animClasses = animStep === 0 ? '' : ['play',
    animStep === 1 ? 'squash' : '',
    animStep >= 2 && animStep <= 4 ? 'spinning' : '',
    animStep >= 3 && animStep <= 4 ? 'charge' : '',
    animStep === 4 ? 'flash-on' : '',
    animStep >= 5 ? 'reveal' : '',
  ].filter(Boolean).join(' ');

  const statOrder = STAT_ORDER;

  return (
    <section className="detail creature-detail" id="detail" data-od-id="creature-profile" tabIndex={-1}>
      <div className="cr-back">
        <Link to="/roster" aria-label="Back to roster">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
          Roster
        </Link>
        <span className="crumb">Collection / <b>{template?.name ?? mon.nickname}</b></span>
        <span className="cr-bar-spacer" />
        <span className={`cr-chip ${down ? '' : 'gold'}`}><span className="dot" />{down ? 'DOWN' : `${mood.label} · ${mon.mood}%`}</span>
      </div>

      {message !== null ? (
        <div role="status" style={{ padding: '10px 40px', background: 'var(--signal)', color: '#fff', textAlign: 'center', fontSize: 13 }}>{message}</div>
      ) : null}

      <div className="dwrap" data-el={e}>
        {/* ---- HERO ---- */}
        <div className="hero">
          <div className="splash"><img src={`/assets/digimon/${mon.catalogId}/portrait.webp`} alt={mon.nickname} onError={(ev) => { ev.currentTarget.style.opacity = '0.15'; }} /></div>
          <div className="wash" />
          <div className="hinfo">
            <h2>{mon.nickname}</h2>
            <p className="tpl">{template?.name ?? mon.catalogId} &nbsp;/&nbsp; Attribute <b>{attribute}</b> · {cap(e)}</p>
            <div className="meta">
              <div className="cell"><div className="lbl">Level</div><div className="val">{mon.level}</div></div>
              <div className="cell"><div className="lbl">Element</div><div className="val el">{cap(e)}</div></div>
              <div className="cell"><div className="lbl">Stage</div><div className="val">{stage}</div></div>
              <div className="cell"><div className="lbl">Mood</div><div className="val">{mon.mood}%</div></div>
            </div>
            <div className="status-row">
              <span className={`statchip ${mon.status}${down ? ' is-down' : ''}`}><span className="dot" />{down ? `DOWN · ${formatRemaining(mon.reviveAt, now)}` : typeof mon.slot === 'number' ? `In party · slot ${mon.slot + 1}` : 'Resting'}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button className="rl-action-btn rl-action-btn--rename" type="button" onClick={() => setRenameMon(mon)}>Rename</button>
                {down ? (
                  <button className="rl-action-btn rl-action-btn--revive" type="button" onClick={() => reviveMutation.mutate(mon.id)}>Revive</button>
                ) : null}
                {typeof mon.slot !== 'number' ? (
                  <button className="rl-action-btn rl-action-btn--party" type="button" disabled={partyMutation.isPending || down || mon.status === 'nursery'} onClick={addToParty}>Add to Party</button>
                ) : null}
              </div>
            </div>
            <div className="cr-xp">
              <span className="xp-fill" style={{ width: `${xpPct(mon)}%` }} />
              <span className="xp-num">{Math.round(mon.xp)} <i>/</i> {mon.xpNext}</span>
            </div>
          </div>
        </div>

        {/* ---- TABS ---- */}
        <div className="dtabs" role="tablist" aria-label="Creature detail sections">
          <button className={`dtab ${activeTab === 'stats' ? 'is-on' : ''}`} role="tab" aria-selected={activeTab === 'stats'} onClick={() => setActiveTab('stats')}>{t('roster.tab_stats')}</button>
          <button className={`dtab ${activeTab === 'skills' ? 'is-on' : ''}`} role="tab" aria-selected={activeTab === 'skills'} onClick={() => setActiveTab('skills')}>{t('roster.tab_skills')}</button>
          <button className={`dtab ${activeTab === 'info' ? 'is-on' : ''}`} role="tab" aria-selected={activeTab === 'info'} onClick={() => setActiveTab('info')}>Info</button>
          <button className={`dtab ${activeTab === 'evolution' ? 'is-on' : ''}`} role="tab" aria-selected={activeTab === 'evolution'} onClick={() => setActiveTab('evolution')}>Evolution</button>
        </div>

        <div className="tabwrap">
          {/* STATS */}
          <div className={`tabpanel ${activeTab === 'stats' ? 'is-on' : ''}`} data-panel="stats" role="tabpanel" hidden={activeTab !== 'stats'}>
            <h3 className="stitle">Stats</h3>
            <div className="stats statcols">
              {statOrder.map(({ k, l }) => {
                const v = currentStats[k];
                const bo = mon.statBonus[k] ?? 0;
                const pct = Math.max(0, Math.min(100, Math.round((v / (STAT_MAX[k] ?? 1)) * 100)));
                return (
                  <div key={k} className={`stat ${k}`}>
                    <span className="sl">{l}</span>
                    <span className="track"><span className="fill" data-w={pct} style={{ width: `${pct}%` }} /></span>
                    <span className="sv">{v}{bo ? <span className="bo">+{bo}</span> : ''}</span>
                  </div>
                );
              })}
            </div>
            {template ? <ResistanceChart template={template} /> : null}
          </div>

          {/* SKILLS */}
          <div className={`tabpanel ${activeTab === 'skills' ? 'is-on' : ''}`} data-panel="skills" role="tabpanel" hidden={activeTab !== 'skills'}>
            <SkillEditor key={mon.id} monId={mon.id} />
          </div>

          {/* INFO */}
          <div className={`tabpanel ${activeTab === 'info' ? 'is-on' : ''}`} data-panel="info" role="tabpanel" hidden={activeTab !== 'info'}>
            <h3 className="stitle">Creature Info</h3>
            <InfoRows mon={mon} stage={stage} attribute={attribute} element={cap(e)} down={down} now={now} />
            {template ? (
              <>
                <h3 className="stitle" style={{ marginTop: 6 }}>Evolution History</h3>
                <EvolutionChain catalogId={mon.catalogId} templateById={templateById} reverseGraph={reverseGraph} />
              </>
            ) : null}
          </div>

          {/* EVOLUTION */}
          <div className={`tabpanel ${activeTab === 'evolution' ? 'is-on' : ''}`} data-panel="evolution" role="tabpanel" hidden={activeTab !== 'evolution'}>
            <div className="evo-cinema">
              <div className="evo-stage">
                <EvoLine
                  past={past}
                  rootId={mon.catalogId}
                  gate={gate}
                  selectedTargetId={selTargetId}
                  templateById={templateById}
                  onSelect={setSelTargetId}
                />
                <EvoConditions
                  gate={gate}
                  selectedOption={selectedOption}
                  selectedTemplate={selectedTemplate}
                  selectedIsRoot={selectedIsRoot}
                  currentStage={currentStage}
                  currentElement={currentElement}
                  currentAttribute={currentAttribute}
                  currentLevel={mon.level}
                  currentStats={currentStats}
                  busy={evolveMutation.isPending}
                  onEvolve={startEvolve}
                />
              </div>
              {animStep > 0 ? (
                <div className={`digiv ${animClasses}`} aria-hidden="true">
                  <div className="grid" />
                  <div className="glow" />
                  <div className="beam" />
                  <div className="speed" />
                  <div className="bigname">{animTargetName}</div>
                  <div className="stage3d"><div className="spin">
                    {displayDot ? <img src={displayDot} alt="" /> : <span className="mono">{animTargetName[0] ?? '?'}</span>}
                  </div></div>
                  <div className="cap">
                    {animStep >= 5 ? <b>{animTargetName}</b> : <><b>{template?.name ?? mon.nickname}</b> digivolving…</>}
                  </div>
                  <div className="flash" />
                  <div className="skip">Digivolving…</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <RenameDialog mon={renameMon} busy={renameMutation.isPending} onClose={() => setRenameMon(null)} onSave={(nickname) => { if (renameMon) renameMutation.mutate({ monId: renameMon.id, nickname }); }} />
    </section>
  );
}

function InfoRows({ mon, stage, attribute, element, down, now }: { readonly mon: RosterMon; readonly stage: string; readonly attribute: string; readonly element: string; readonly down: boolean; readonly now: number }): JSX.Element {
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['Attribute', attribute],
    ['Element', element],
    ['Stage', stage],
    ['Level', String(mon.level)],
    ['Status', down ? `Down · ${formatRemaining(mon.reviveAt, now)}` : typeof mon.slot === 'number' ? `In party · slot ${mon.slot + 1}` : 'Resting'],
    ['Mood', `${mon.mood}/100 · ${moodInfo(mon).label}`],
  ];
  return (
    <div className="cr-infoblocks">
      <div className="cr-info">
        {rows.map(([k, v]) => (
          <div key={k} className="row"><span className="ll">{k}</span><span className="lv">{v}</span></div>
        ))}
      </div>
      <div className="cr-info">
        <div className="row"><span className="ll">XP</span><span className="lv">{Math.round(mon.xp)} / {mon.xpNext}</span></div>
        <div className="row"><span className="ll">History forms</span><span className="lv">{mon.evolutionHistory.length}</span></div>
      </div>
    </div>
  );
}