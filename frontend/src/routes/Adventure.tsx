import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { getRoster } from '../lib/api';
import {
  collectAdventure,
  getAdventure,
  startAdventure,
  type AdventurePageView,
  type AdventureReport,
  type AdventureView,
  type AdventureConfigView,
} from '../lib/api-adventure';
import { getFarm, type FarmView } from '../lib/api-farm';
import type { RosterView } from '../lib/api';
import '../styles/extensions-adventure.css';

const ADVENTURE_QUERY_KEY = ['adventure'] as const;
const ROSTER_QUERY_KEY = ['roster'] as const;
const FARM_QUERY_KEY = ['farm'] as const;

export function Adventure(): JSX.Element {
  const queryClient = useQueryClient();
  const [now, setNow] = useState<number>(() => Date.now());
  const [selectedIds, setSelectedIds] = useState<readonly (string | null)[]>([null, null, null]);
  const [hours, setHours] = useState<number>(1);
  const [notice, setNotice] = useState<string>('');

  const adventureQuery = useQuery({ queryKey: ADVENTURE_QUERY_KEY, queryFn: getAdventure, refetchInterval: 15_000 });
  const rosterQuery = useQuery({ queryKey: ROSTER_QUERY_KEY, queryFn: getRoster });
  const farmQuery = useQuery({ queryKey: FARM_QUERY_KEY, queryFn: getFarm });

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const page = adventureQuery.data ?? null;
  const active = page?.active ?? null;
  const lastCollected = page?.lastCollected ?? null;
  const provisionsOwned = page?.provisionsOwned ?? 0;
  const config = page?.config ?? { minHours: 1, maxHours: 8, provisionsPerHour: 10, provisionItemId: 'itm-provision', encountersPerHour: 3, partySize: 3 };
  const roster = rosterQuery.data?.roster ?? [];
  const farm: FarmView = farmQuery.data ?? emptyFarm;

  const eligibleMons = useMemo<readonly RosterView[]>(
    () => roster.filter((m) => isEligibleForAdventure(m, now)),
    [roster, now],
  );

  const provisionsNeeded = hours * config.provisionsPerHour;

  const startMutation = useMutation({
    mutationFn: (params: { readonly monIds: readonly string[]; readonly hours: number }) => startAdventure(params.monIds, params.hours),
    onSuccess: (result) => {
      queryClient.setQueryData<AdventurePageView>(ADVENTURE_QUERY_KEY, (prev) => ({
        active: result.adventure,
        lastCollected: prev?.lastCollected ?? null,
        provisionsOwned: result.provisionsOwned,
        config: prev?.config ?? config,
      }));
      queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      setSelectedIds([null, null, null]);
      setNotice(`Adventure started — ${hours}h expedition with ${result.adventure.party.length} Digimon.`);
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'start failed'),
  });

  const collectMutation = useMutation({
    mutationFn: collectAdventure,
    onSuccess: (result) => {
      queryClient.setQueryData<AdventurePageView>(ADVENTURE_QUERY_KEY, (prev) => ({
        active: null,
        lastCollected: result.adventure,
        provisionsOwned: prev?.provisionsOwned ?? 0,
        config: prev?.config ?? config,
      }));
      queryClient.invalidateQueries({ queryKey: ADVENTURE_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      const report = result.adventure.report;
      const wins = report?.wins ?? 0;
      const losses = report?.losses ?? 0;
      setNotice(`Party returned — ${wins} win${wins === 1 ? '' : 's'}, ${losses} loss${losses === 1 ? '' : 'es'}.`);
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'collect failed'),
  });

  function handleTogglePick(monId: string) {
    const slotIndex = selectedIds.indexOf(monId);
    if (slotIndex >= 0) {
      const next = [...selectedIds];
      next[slotIndex] = null;
      setSelectedIds(next);
    } else {
      const emptyIdx = selectedIds.indexOf(null);
      if (emptyIdx >= 0) {
        const next = [...selectedIds];
        next[emptyIdx] = monId;
        setSelectedIds(next);
      } else {
        setNotice(`Party is full (${config.partySize}). Deselect one first.`);
      }
    }
  }

  const filled = selectedIds.filter((id) => id !== null).length;
  const enoughProv = provisionsOwned >= provisionsNeeded;
  const canStart = filled === config.partySize && enoughProv;

  let hint, warn = false;
  if (filled < config.partySize) {
    hint = <>Pick <b>{config.partySize - filled}</b> more Digimon to embark.</>;
  } else if (!enoughProv) {
    hint = <>Need <b>{provisionsNeeded}</b> provisions — you have <b>{provisionsOwned}</b>. Craft more in the Pantry.</>;
    warn = true;
  } else {
    hint = <>Ready — <b>{provisionsNeeded}</b> provisions for a <b>{hours}h</b> run.</>;
  }

  const displayRoster = roster.filter((m) => m.status === 'resting' && m.listedAt === null && typeof m.slot !== 'number');

  const meatBal = farm.balances.Meat ?? 0;
  const bitsBal = farm.balances.Bits ?? 0;
  const dataBal = farm.balances.Data ?? 0;
  const creditsBal = farm.credits ?? 0;

  return (
    <>
      <div className="balbar" id="balbar">
        <div className="bal" data-res="meat">
          <span className="ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M12 3c4 0 7 3 7 7 0 5-4 9-7 11-3-2-7-6-7-11 0-4 3-7 7-7z" />
              <path d="M9 9c1-1 4-1 5 0" />
            </svg>
          </span>
          <span className="col"><span className="k">Meat</span><span className="v">{meatBal.toLocaleString('en-US')}</span></span>
        </div>
        <div className="bal" data-res="bits">
          <span className="ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M4 8h4V4M20 8h-4V4M4 16h4v4M20 16h-4v4" />
              <rect x="8" y="8" width="8" height="8" />
            </svg>
          </span>
          <span className="col"><span className="k">Bits</span><span className="v">{bitsBal.toLocaleString('en-US')}</span></span>
        </div>
        <div className="bal" data-res="data">
          <span className="ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <ellipse cx="12" cy="6" rx="7" ry="3" />
              <path d="M5 6v12c0 1.6 3.1 3 7 3s7-1.4 7-3V6" />
              <path d="M5 12c0 1.6 3.1 3 7 3s7-1.4 7-3" />
            </svg>
          </span>
          <span className="col"><span className="k">Data</span><span className="v">{dataBal.toLocaleString('en-US')}</span></span>
        </div>
        <div className="bal" data-res="credits">
          <span className="ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v8M9.5 10.5h3.5a1.5 1.5 0 0 1 0 3H9.5" />
            </svg>
          </span>
          <span className="col"><span className="k">Credits</span><span className="v">{creditsBal.toLocaleString('en-US')}</span></span>
        </div>
        <div className="bal" data-res="provisions">
          <span className="ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M5 8h14v11H5z" />
              <path d="M5 8l2-4h10l2 4" />
              <path d="M9 12h6" />
            </svg>
          </span>
          <span className="col"><span className="k">Provisions</span><span className="v">{provisionsOwned.toLocaleString('en-US')}</span></span>
        </div>
        <div className="strip-title">
          <div className="k">Expeditions</div>
          <div className="s">{active ? '1 in the field' : 'idle · ready to send'}</div>
        </div>
      </div>

      <div className="scroll">
        <div className="col left">
          <div className="lstack">
            <h3 className="stitle">Send an expedition</h3>
            <div className="panelbox">
              <div className="pinner">
                <div className="rlabel">Pick your party — {config.partySize} resting Digimon</div>
                <div className="party">
                  {displayRoster.map((mon) => {
                    const isDowned = mon.reviveAt !== null && mon.reviveAt > now;
                    const isPicked = selectedIds.includes(mon.id);
                    return (
                      <div
                        key={mon.id}
                        className={`mon ${isPicked ? 'picked' : ''} ${isDowned ? 'downed' : ''} ${!isDowned ? 'picker' : ''}`}
                        onClick={() => {
                          if (!isDowned) handleTogglePick(mon.id);
                        }}
                      >
                        <span className="pick-ic">
                          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M5 12l4 4 10-10" />
                          </svg>
                        </span>
                        {isDowned && <span className="ko">Downed</span>}
                        <span className="spr">
                          <img src={`/assets/digimon/${mon.catalogId}/dot.gif`} alt="" loading="lazy" />
                        </span>
                        <span className="nick">{mon.nickname}</span>
                        <span className="sub">
                          Lv {mon.level} · <span className="st">{mon.template?.stage ?? '?'}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="field">
                  <div className="flabel">
                    <span>Expedition length</span>
                    <b>{hours}h</b>
                  </div>
                  <input
                    type="range"
                    min={config.minHours}
                    max={config.maxHours}
                    step="1"
                    value={hours}
                    onChange={(e) => setHours(Number(e.target.value))}
                    aria-label="Expedition length in hours"
                  />
                </div>

                <div className="previewgrid">
                  <div className={`pv ${provisionsNeeded > provisionsOwned ? 'short' : ''}`}>
                    <div className="k">Provisions</div>
                    <div className="v">{provisionsNeeded}</div>
                  </div>
                  <div className="pv">
                    <div className="k">Encounters</div>
                    <div className="v">~{Math.round(hours * config.encountersPerHour)}</div>
                  </div>
                  <div className="pv">
                    <div className="k">Returns in</div>
                    <div className="v">{hours}h</div>
                  </div>
                </div>
              </div>
              <div className="afoot">
                <span className={`ahint ${warn ? 'warn' : ''}`}>{hint}</span>
                <button
                  className="btn primary"
                  disabled={!canStart || startMutation.isPending}
                  onClick={() => {
                    const monIds = selectedIds.filter((id): id is string => id !== null);
                    startMutation.mutate({ monIds, hours });
                  }}
                >
                  Embark
                </button>
              </div>
            </div>
          </div>

          <div className="lstack">
            <h3 className="stitle">
              Active Expeditions <span className="cnt">{active ? 1 : 0}</span>
            </h3>
            <div className="panelbox">
              <div className="pinner">
                <div className="explist">
                  {active ? (
                    <ActiveExpCard
                      active={active}
                      now={now}
                      config={config}
                      onCollect={() => collectMutation.mutate()}
                      isCollecting={collectMutation.isPending}
                    />
                  ) : (
                    <div className="exp-empty">
                      No expeditions in the field. Pick a party above and Embark — every run you send appears here with its
                      own countdown, and you can send as many as you like.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col right">
          <h3 className="stitle">Last Report</h3>
          <div className="panelbox">
            <div className="pinner">
              <ReportPanel report={lastCollected?.report ?? null} adventure={lastCollected} />
            </div>
          </div>
        </div>
      </div>

      <div className={`toast ${notice ? 'show' : ''}`} id="toast" role="status" aria-live="polite">
        {notice}
      </div>
    </>
  );
}

function ActiveExpCard({
  active,
  now,
  config,
  onCollect,
  isCollecting,
}: {
  readonly active: AdventureView;
  readonly now: number;
  readonly config: AdventureConfigView;
  readonly onCollect: () => void;
  readonly isCollecting: boolean;
}): JSX.Element {
  const total = active.distanceMs;
  const remainingMs = Math.max(0, active.finishesAt - now);
  const done = total - remainingMs;
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 100;
  const h = Math.max(1, Math.round(active.distanceMs / 3600000));
  const ready = active.ready || remainingMs === 0;

  return (
    <div className={`exp-card ${ready ? 'ready' : ''}`}>
      <div className="ehead">
        <span className="emini">
          {active.party.map((p) => (
            <img key={p.monId} src={`/assets/digimon/${p.catalogId}/dot.gif`} alt="" loading="lazy" />
          ))}
        </span>
        <span className="enames">
          {active.party.map((p) => p.nickname).join(' · ')}
          <span className="esub">
            {h}h run · {active.provisionsSpent} prov · ~{Math.round(h * config.encountersPerHour)} enc
          </span>
        </span>
        <span className={`eclock ${ready ? 'ready' : ''}`}>{ready ? 'READY' : formatClock(remainingMs)}</span>
      </div>
      <div className="epbar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="efoot">
        {ready ? (
          <>
            <span className="eh">
              Back at the gate — <b>collect</b> to bank loot &amp; XP.
            </span>
            <button className="btn primary sm" onClick={onCollect} disabled={isCollecting}>
              Collect
            </button>
          </>
        ) : (
          <>
            <span className="eh">Out in the field — rewards roll in on return.</span>
            <button className="btn ghost sm" disabled>
              Away…
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ReportPanel({
  report,
  adventure,
}: {
  readonly report: AdventureReport | null;
  readonly adventure: AdventureView | null;
}): JSX.Element {
  if (!report || !adventure) {
    return (
      <div className="rep-empty">
        No expeditions yet. Send a party into the field, and their battle report — loot, XP, and any KOs — lands here
        when they return.
      </div>
    );
  }

  const h = Math.max(1, Math.round(adventure.distanceMs / 3600000));
  const encCount = report.wins + report.losses;

  return (
    <>
      <div className="wl">
        <div className="b wins">
          <div className="k">Wins</div>
          <div className="v">{report.wins}</div>
        </div>
        <div className="b loss">
          <div className="k">Losses</div>
          <div className="v">{report.losses}</div>
        </div>
      </div>
      <div className="rlabel">
        {h}h run · {encCount} encounters
      </div>
      <div className="rlabel">Loot banked</div>
      <div className="loot">
        {report.totals.meat > 0 && (
          <span className="lchip" data-res="meat">
            <span className="cd" />
            {report.totals.meat.toLocaleString('en-US')} <span className="u">Meat</span>
          </span>
        )}
        {report.totals.bits > 0 && (
          <span className="lchip" data-res="bits">
            <span className="cd" />
            {report.totals.bits.toLocaleString('en-US')} <span className="u">Bits</span>
          </span>
        )}
        {report.totals.data > 0 && (
          <span className="lchip" data-res="data">
            <span className="cd" />
            {report.totals.data.toLocaleString('en-US')} <span className="u">Data</span>
          </span>
        )}
        {report.totals.credits > 0 && (
          <span className="lchip" data-res="credits">
            <span className="cd" />
            {report.totals.credits.toLocaleString('en-US')} <span className="u">Credits</span>
          </span>
        )}
        {report.totals.meat === 0 &&
          report.totals.bits === 0 &&
          report.totals.data === 0 &&
          report.totals.credits === 0 && <span className="rep-empty">No loot this run.</span>}
      </div>
      <div className="rlabel">Experience</div>
      {report.xpDeltas.map((x) => {
        const mon = adventure.party.find((p) => p.monId === x.monId);
        return (
          <div className="xprow" key={x.monId}>
            <span className="xspr">
              <img src={`/assets/digimon/${mon?.catalogId}/dot.gif`} alt="" loading="lazy" />
            </span>
            <span className="xn">{mon?.nickname ?? x.monId}</span>
            <span className="xg">
              +{x.xpGained.toLocaleString('en-US')} XP
              {x.gainedLevels > 0 && <span className="lvup">Lv {x.levelAfter}</span>}
            </span>
          </div>
        );
      })}
      {report.koedMonIds.length > 0 && (
        <div className="koline">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
          {report.koedMonIds
            .map((id) => adventure.party.find((p) => p.monId === id)?.nickname ?? id)
            .join(', ')}{' '}
          knocked out — recovering (30m)
        </div>
      )}
    </>
  );
}

function isEligibleForAdventure(mon: RosterView, now: number): boolean {
  if (mon.status !== 'resting') return false;
  if (mon.listedAt !== null) return false;
  if (mon.reviveAt !== null && mon.reviveAt > now) return false;
  if (typeof mon.slot === 'number') return false;
  return true;
}

const emptyFarm: FarmView = {
  balances: { Meat: 0, Bits: 0, Data: 0 },
  credits: 0,
  buildings: [],
};

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hr = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (hr > 0) return `${hr}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
