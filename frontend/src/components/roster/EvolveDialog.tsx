import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { EVOLUTION_LEVELS, type Attribute, type Element, type Stage, type TemplateDigimon } from '@digiworld/shared/digimon';
import type { EvolutionGate, EvolutionOption, EvolutionReason } from '../../lib/api-roster';
import { totalStats, scaledStats, type RosterMon } from './types';

type EvolveDialogProps = {
  readonly mon: RosterMon | null;
  readonly gate: EvolutionGate | null;
  readonly templateById: ReadonlyMap<string, TemplateDigimon>;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onEvolve: (targetCatalogId: string) => void;
};

// Mirror of backend STAGE_MULTIPLIER (backend/src/digimon/element.ts) so we can preview stat gains.
const STAGE_MULT: Record<Stage, number> = {
  Baby: 0.4,
  'In-Training': 0.6,
  Rookie: 1.0,
  Champion: 1.5,
  Ultimate: 2.2,
  Mega: 3.0,
};

// Reasonable per-stage Meat cost preview (Meat is the roster evolution material).
const EVO_MEAT: Record<Stage, number> = {
  Baby: 0,
  'In-Training': 40,
  Rookie: 80,
  Champion: 220,
  Ultimate: 520,
  Mega: 1200,
};

const STAT_KEYS = ['hp', 'atk', 'int', 'en', 'def', 'spd'] as const;
const STAT_LABELS: Record<(typeof STAT_KEYS)[number], string> = { hp: 'HP', atk: 'ATK', int: 'INT', en: 'EN', def: 'DEF', spd: 'SPD' };

type LineColumn = { readonly stage: Stage | 'Unknown'; readonly ids: readonly string[]; readonly extra: number };

type AnimStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const COLUMN_NODE_CAP = 8;

function evolutionLine(rootId: string, templates: ReadonlyMap<string, TemplateDigimon>, priorityIds: ReadonlySet<string>): readonly LineColumn[] {
  const cols: LineColumn[] = [];
  let frontier: string[] = [rootId];
  const seen = new Set<string>();
  let guard = 0;
  while (frontier.length > 0 && guard < 6) {
    guard += 1;
    const ids: string[] = [];
    const nextFrontier: string[] = [];
    let colStage: Stage | 'Unknown' = 'Unknown';
    const sortedFrontier = [...frontier].sort((a, b) => {
      const pa = priorityIds.has(a) ? 0 : 1;
      const pb = priorityIds.has(b) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return a.localeCompare(b);
    });
    for (const id of sortedFrontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      const template = templates.get(id);
      if (template && colStage === 'Unknown') colStage = template.stage;
      for (const edge of template?.evolvesInto ?? []) nextFrontier.push(edge.targetId);
    }
    const shown = ids.slice(0, COLUMN_NODE_CAP);
    const extra = ids.length - shown.length;
    if (shown.length > 0) cols.push({ stage: colStage, ids: shown, extra });
    frontier = Array.from(new Set(nextFrontier));
  }
  return cols;
}

function computeStatGains(
  current: ReturnType<typeof totalStats>,
  currentStage: Stage,
  targetStage: Stage,
): Record<(typeof STAT_KEYS)[number], { readonly cur: number; readonly next: number; readonly delta: number }> {
  const ratio = STAGE_MULT[targetStage] / STAGE_MULT[currentStage];
  const out = {} as Record<(typeof STAT_KEYS)[number], { readonly cur: number; readonly next: number; readonly delta: number }>;
  for (const k of STAT_KEYS) {
    const cur = current[k];
    const next = k === 'en' ? Math.min(41, Math.round(cur * ratio)) : Math.round(cur * ratio);
    out[k] = { cur, next, delta: next - cur };
  }
  return out;
}

function optionForCatalogId(gate: EvolutionGate | null, catalogId: string): EvolutionOption | undefined {
  return gate?.options.find((o) => o.catalogId === catalogId);
}

function reasonDetail(reason: EvolutionReason | undefined, option: EvolutionOption, gate: EvolutionGate): string {
  switch (reason) {
    case 'level-too-low':
      return `Needs Lv ${option.requiredLevel} (currently ${gate.currentLevel})`;
    case 'no-mood':
      return `Needs mood ${option.requiredMood} (currently ${gate.currentMood})`;
    case 'attribute-mismatch':
      return `Requires ${option.requiredAttribute ?? '?'} attribute`;
    case 'no-paths':
    case 'stage-cap':
      return 'No path';
    case undefined:
      return 'Not eligible';
  }
  return 'Not eligible';
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (event: MediaQueryListEvent): void => setReduced(event.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

export function EvolveDialog({ mon, gate, templateById, busy, onClose, onEvolve }: EvolveDialogProps): JSX.Element {
  const open = mon !== null;
  const currentTemplate = mon ? templateById.get(mon.catalogId) : undefined;
  const line = useMemo(
    () => {
      if (!mon) return [];
      const priority = new Set<string>(gate?.options.map((o) => o.catalogId) ?? []);
      return evolutionLine(mon.catalogId, templateById, priority);
    },
    [mon, templateById, gate],
  );

  const firstEligibleOption = useMemo(() => gate?.options.find((o) => o.eligible) ?? gate?.options[0] ?? null, [gate]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [animStep, setAnimStep] = useState<AnimStep>(0);
  const [animTargetId, setAnimTargetId] = useState<string | null>(null);
  const timeoutsRef = useRef<number[]>([]);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) {
      setSelectedTargetId(null);
      setAnimStep(0);
      setAnimTargetId(null);
      for (const id of timeoutsRef.current) window.clearTimeout(id);
      timeoutsRef.current = [];
      return;
    }
    setSelectedTargetId((prev) => prev ?? firstEligibleOption?.catalogId ?? null);
  }, [open, firstEligibleOption]);

  useEffect(() => () => {
    for (const id of timeoutsRef.current) window.clearTimeout(id);
    timeoutsRef.current = [];
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && animStep === 0) {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, animStep]);

  if (!open || mon === null) {
    return <div className="evo-ov" aria-hidden="true" />;
  }

  const monName = mon.nickname;
  const currentStage = currentTemplate?.stage ?? (gate?.currentStage ?? 'Rookie');
  const currentElement: Element | 'null' = currentTemplate?.element ?? 'null';
  const currentAttribute: Attribute = currentTemplate?.attribute ?? 'Free';
  const currentStats = scaledStats(mon);
  const speciesName = currentTemplate?.name ?? mon.catalogId;

  const selectedOption = selectedTargetId ? optionForCatalogId(gate, selectedTargetId) : undefined;
  const selectedTemplate = selectedTargetId ? templateById.get(selectedTargetId) : undefined;
  const selectedIsRoot = selectedTargetId === mon.catalogId;

  const startEvolve = (catalogId: string): void => {
    if (reducedMotion) {
      onEvolve(catalogId);
      return;
    }
    setAnimTargetId(catalogId);
    setAnimStep(1); // squash
    const push = (delay: number, step: AnimStep): void => {
      const id = window.setTimeout(() => setAnimStep(step), delay);
      timeoutsRef.current.push(id);
    };
    push(700, 2); // spinning
    push(2400, 3); // spinning + charge
    push(3200, 4); // spinning + charge + flash-on
    push(3400, 5); // reveal (swap sprite)
    push(3800, 6); // reveal without flash
    const fireId = window.setTimeout(() => {
      onEvolve(catalogId);
      setAnimStep(0);
      setAnimTargetId(null);
    }, 5000);
    timeoutsRef.current.push(fireId);
  };

  const animCurrent = animTargetId ? currentTemplate?.assets.dot ?? null : null;
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

  return (
    <div
      className={`evo-ov ${open ? 'show' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="evoHeadName"
      onMouseDown={(event) => { if (event.target === event.currentTarget && animStep === 0) onClose(); }}
    >
      <div className="evo-modal">
        <div className="evo-head">
          <div>
            <div className="ek">Digivolution</div>
            <h3 id="evoHeadName">{monName} · {currentStage}</h3>
            <div className="sub">{speciesName} · {capElement(currentElement)} · Lv {mon.level} · Attr {currentAttribute}</div>
          </div>
          <button
            className="evo-x"
            type="button"
            aria-label="Close evolution"
            onClick={onClose}
            disabled={animStep !== 0}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="evo-stage">
          <EvoLine
            line={line}
            rootId={mon.catalogId}
            gate={gate}
            selectedTargetId={selectedTargetId}
            templateById={templateById}
            onSelect={setSelectedTargetId}
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
            busy={busy}
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
              {animStep >= 5 ? <b>{animTargetName}</b> : <><b>{speciesName}</b> digivolving…</>}
            </div>
            <div className="flash" />
            <div className="skip">Digivolving…</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function capElement(element: Element | 'null'): string {
  if (element === 'null') return 'Null';
  const first = element[0] ?? '';
  return first.toUpperCase() + element.slice(1);
}

function EvoLine({
  line,
  rootId,
  gate,
  selectedTargetId,
  templateById,
  onSelect,
}: {
  readonly line: readonly LineColumn[];
  readonly rootId: string;
  readonly gate: EvolutionGate | null;
  readonly selectedTargetId: string | null;
  readonly templateById: ReadonlyMap<string, TemplateDigimon>;
  readonly onSelect: (id: string) => void;
}): JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [pathData, setPathData] = useState<string>('');
  const [svgSize, setSvgSize] = useState<{ readonly w: number; readonly h: number }>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const nodes = wrap.querySelectorAll<HTMLElement>('.enode');
    const nodeMap = new Map<string, DOMRect>();
    for (const n of Array.from(nodes)) {
      const id = n.getAttribute('data-node');
      if (id) nodeMap.set(id, n.getBoundingClientRect());
    }
    const wrapRect = wrap.getBoundingClientRect();
    const scrollLeft = wrap.scrollLeft;
    const scrollTop = wrap.scrollTop;
    let paths = '';
    for (const [id, rect] of nodeMap.entries()) {
      const template = templateById.get(id);
      if (!template?.evolvesInto?.length) continue;
      const px = rect.left - wrapRect.left + scrollLeft + rect.width;
      const py = rect.top - wrapRect.top + scrollTop + rect.height / 2;
      for (const edge of template.evolvesInto) {
        const childRect = nodeMap.get(edge.targetId);
        if (!childRect) continue;
        const cx = childRect.left - wrapRect.left + scrollLeft;
        const cy = childRect.top - wrapRect.top + scrollTop + childRect.height / 2;
        const mid = (px + cx) / 2;
        paths += `M${px} ${py} H${mid} V${cy} H${cx} `;
      }
    }
    setPathData(paths);
    setSvgSize({ w: wrap.scrollWidth, h: wrap.scrollHeight });
  }, [line, templateById]);

  return (
    <div className="evo-line" ref={wrapRef}>
      <div className="evo-gen">Line · <b>{line.length}</b> stages</div>
      <svg className="evo-links" width={svgSize.w} height={svgSize.h} viewBox={`0 0 ${svgSize.w} ${svgSize.h}`} aria-hidden="true">
        <path d={pathData} fill="none" stroke="var(--hair)" strokeWidth={1.5} />
      </svg>
      <div className="evo-cols" role="list" aria-label="Evolution line">
        {line.map((col, idx) => (
          <div key={idx} className="evo-col" data-col={idx}>
            <div className="stagelbl">{col.stage}</div>
            {col.ids.map((id) => {
              const template = templateById.get(id);
              const met = template !== undefined;
              const isRoot = id === rootId;
              const isSel = id === selectedTargetId;
              const option = optionForCatalogId(gate, id);
              const avail = option?.eligible === true;
              const stage = template?.stage ?? 'Unknown';
              const element = template?.element ?? 'null';
              const cls = [
                'enode',
                isRoot ? 'is-root' : '',
                isSel ? 'sel' : '',
                !met ? 'unmet' : '',
                avail ? 'avail' : '',
              ].filter(Boolean).join(' ');
              const badge = isRoot ? 'YOU' : stage.slice(0, 3).toUpperCase();
              return (
                <button
                  key={id}
                  type="button"
                  role="listitem"
                  className={cls}
                  data-node={id}
                  style={{ ['--el' as string]: `var(--el-${element})` }}
                  onClick={() => onSelect(id)}
                  aria-label={met ? `${template.name}, ${stage}${isRoot ? ', current form' : ''}${avail ? ', can evolve now' : ''}` : 'Undiscovered species'}
                >
                  <span className="pic">
                    {met && template.assets.dot ? (
                      <img src={template.assets.dot} alt="" />
                    ) : (
                      <span className="q">?</span>
                    )}
                  </span>
                  <span className="en-nm">{met ? template.name : '???'}</span>
                  <span className="en-badge"><span className="adot" /><span className="lv">{badge}</span></span>
                </button>
              );
            })}
            {col.extra > 0 ? (
              <div className="enode-more" aria-label={`${col.extra} more evolution branches available`}>
                +{col.extra} more
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function EvoConditions({
  gate,
  selectedOption,
  selectedTemplate,
  selectedIsRoot,
  currentStage,
  currentElement,
  currentAttribute,
  currentLevel,
  currentStats,
  busy,
  onEvolve,
}: {
  readonly gate: EvolutionGate | null;
  readonly selectedOption: EvolutionOption | undefined;
  readonly selectedTemplate: TemplateDigimon | undefined;
  readonly selectedIsRoot: boolean;
  readonly currentStage: Stage;
  readonly currentElement: Element | 'null';
  readonly currentAttribute: Attribute;
  readonly currentLevel: number;
  readonly currentStats: ReturnType<typeof scaledStats>;
  readonly busy: boolean;
  readonly onEvolve: (catalogId: string) => void;
}): JSX.Element {
  if (selectedIsRoot || (!selectedTemplate && !selectedOption)) {
    return (
      <aside className="evo-cond">
        <div className="cond-hd"><span className="ct">Digivolution Conditions</span></div>
        <div className="cond-empty">Select a form in the line to preview its requirements, stat gains and attribute change.</div>
      </aside>
    );
  }

  const target = selectedTemplate ?? null;
  const met = target !== null;
  const targetStage: Stage = (target?.stage ?? selectedOption?.stage ?? 'Rookie');
  const targetElement: Element | 'null' = target?.element ?? 'null';
  const targetAttribute: Attribute = target?.attribute ?? (selectedOption?.requiredAttribute ?? currentAttribute);
  const targetName = target?.name ?? selectedOption?.name ?? '???';

  const gains = computeStatGains(currentStats, currentStage, targetStage);
  const attrChanged = targetAttribute !== currentAttribute;
  const elChanged = targetElement !== currentElement && targetElement !== 'null';

  const isDirect = selectedOption !== undefined;
  const requiredLevel = selectedOption?.requiredLevel ?? EVOLUTION_LEVELS[targetStage] ?? 99;
  const meatCost = EVO_MEAT[targetStage] ?? 0;
  const levelOk = met && currentLevel >= requiredLevel;
  const attrOk = !selectedOption?.requiredAttribute || currentAttribute === selectedOption.requiredAttribute;

  return (
    <aside className="evo-cond">
      <div className="cond-hd">
        <span className="ct">Digivolution Conditions</span>
        <span className="cnm">{met ? targetName : '???'}</span>
      </div>
      <div className="cond-body">
        <div className="tgt" style={{ ['--el' as string]: `var(--el-${targetElement})` }}>
          <span className="tpic">
            {met && target.assets.dot ? <img src={target.assets.dot} alt="" /> : <span className="q">?</span>}
          </span>
          <div>
            <div className="tnm">{met ? targetName : '???'}</div>
            <div className="tst">{targetStage}{met ? '' : ' · Undiscovered'}</div>
          </div>
        </div>

        <div>
          <div className="cond-sh">Stat Change</div>
          <div className="stat-grid">
            {STAT_KEYS.map((k) => {
              const g = gains[k];
              const dir = g.delta > 0 ? 'up' : g.delta < 0 ? 'down' : '';
              return (
                <div key={k} className={`srow ${dir}`}>
                  <span className="sk">{STAT_LABELS[k]}</span>
                  <span className="sv">
                    {g.next}
                    {g.delta !== 0 ? <span className="dl"> {g.delta > 0 ? '+' : ''}{g.delta}</span> : null}
                  </span>
                  <span className="ar">
                    {g.delta > 0 ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M12 5v14M6 11l6-6 6 6" /></svg>
                    ) : g.delta < 0 ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M12 19V5M6 13l6 6 6-6" /></svg>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="cond-sh">Attribute / Element</div>
          <div className="change">
            <div className="chg-row">
              <span className="cl">Attribute</span>
              <span className="chg-pill from" style={{ ['--el' as string]: `var(--el-${currentElement})` }}>
                <span className="adot" />{currentAttribute}
              </span>
              {attrChanged ? (
                <>
                  <span className="chg-arrow">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </span>
                  <span className="chg-pill to" style={{ ['--el2' as string]: `var(--el-${targetElement})` }}>
                    <span className="adot" />{targetAttribute}
                  </span>
                </>
              ) : (
                <span className="chg-same">No change</span>
              )}
            </div>
            <div className="chg-row">
              <span className="cl">Element</span>
              <span className="chg-pill from" style={{ ['--el' as string]: `var(--el-${currentElement})` }}>
                <span className="adot" />{capElement(currentElement)}
              </span>
              {elChanged ? (
                <>
                  <span className="chg-arrow">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </span>
                  <span className="chg-pill to" style={{ ['--el2' as string]: `var(--el-${targetElement})` }}>
                    <span className="adot" />{capElement(targetElement)}
                  </span>
                </>
              ) : (
                <span className="chg-same">No change</span>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="cond-sh">Requirements</div>
          <div className="req-line">
            <span className={`rq2 ${met ? (levelOk ? 'ok' : 'bad') : ''}`}>Lv <span className="rn">{requiredLevel}</span></span>
            <span className={`rq2 ${met ? 'ok' : ''}`}><span className="rn">{meatCost.toLocaleString('en-US')}</span> Meat</span>
            <span className="rq2">{targetStage}</span>
          </div>
        </div>
      </div>

      <div className="cond-foot">
        {!isDirect ? (
          <>
            <button className="evoDo" disabled>Not a direct evolution</button>
            <div className="cond-block dim">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              <span>Reach the next stage first.</span>
            </div>
          </>
        ) : selectedOption?.eligible ? (
          <button
            className="evoDo"
            disabled={busy}
            onClick={() => selectedOption && onEvolve(selectedOption.catalogId)}
          >
            Digivolve → {targetName}
          </button>
        ) : (
          <>
            <button className="evoDo" disabled>Requirement not met</button>
            {gate && selectedOption ? (
              <div className="cond-block">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="5" y="11" width="14" height="9" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                <span>{reasonDetail(selectedOption.reason, selectedOption, gate)}{!levelOk && attrOk ? '' : ''}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
