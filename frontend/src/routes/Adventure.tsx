import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { AppNav, NavStat } from '../components/AppNav';
import { PageStrip } from '../components/common/PageStrip';
import { getRoster } from '../lib/api';
import {
  collectAdventure,
  getAdventure,
  startAdventure,
  type AdventureMemberView,
  type AdventurePageView,
  type AdventureReport,
  type AdventureView,
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

  return (
    <div className="app-shell">
      <AppNav>
        <NavStat tone="meat" label="Meat" value={farm.balances.Meat.toLocaleString()} />
        <NavStat tone="bits" label="Bits" value={farm.balances.Bits.toLocaleString()} />
        <NavStat tone="data" label="Data" value={farm.balances.Data.toLocaleString()} />
      </AppNav>
      <main className="app-main adventure-main">
        <PageStrip
          name="Adventure"
          tone="reward"
          metrics={[
            { label: <><b>{provisionsOwned}</b> provisions</> },
            { label: <><b>{eligibleMons.length}</b> ready to send</> },
            { label: <>up to <b>{config.maxHours}h</b> per trip</>, className: 'muted' },
          ]}
          actions={<span className="muted">Send 3 Digimon out to loot resources, credits, and XP.</span>}
        />
        <div className="farm-alert" role="status" aria-live="polite">{notice}</div>
        {active !== null ? (
          <ActiveAdventurePanel
            adventure={active}
            now={now}
            collectBusy={collectMutation.isPending}
            onCollect={() => collectMutation.mutate()}
          />
        ) : (
          <IdleAdventurePanel
            selectedIds={selectedIds}
            onSelect={(slot, monId) => {
              const next = selectedIds.slice();
              next[slot] = monId;
              setSelectedIds(next);
            }}
            hours={hours}
            onHoursChange={setHours}
            eligibleMons={eligibleMons}
            provisionsOwned={provisionsOwned}
            provisionsNeeded={provisionsNeeded}
            config={config}
            startBusy={startMutation.isPending}
            onStart={() => {
              const monIds = selectedIds.filter((id): id is string => id !== null);
              startMutation.mutate({ monIds, hours });
            }}
          />
        )}
        {lastCollected !== null && lastCollected.report !== null ? (
          <ReportCard adventure={lastCollected} report={lastCollected.report} />
        ) : null}
      </main>
    </div>
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

function IdleAdventurePanel({
  selectedIds,
  onSelect,
  hours,
  onHoursChange,
  eligibleMons,
  provisionsOwned,
  provisionsNeeded,
  config,
  startBusy,
  onStart,
}: {
  readonly selectedIds: readonly (string | null)[];
  readonly onSelect: (slot: number, monId: string | null) => void;
  readonly hours: number;
  readonly onHoursChange: (h: number) => void;
  readonly eligibleMons: readonly RosterView[];
  readonly provisionsOwned: number;
  readonly provisionsNeeded: number;
  readonly config: AdventurePageView['config'];
  readonly startBusy: boolean;
  readonly onStart: () => void;
}): JSX.Element {
  const filled = selectedIds.filter((id) => id !== null).length;
  const usedIds = new Set(selectedIds.filter((id): id is string => id !== null));
  const canStart = filled === config.partySize && provisionsOwned >= provisionsNeeded && !startBusy;
  const insufficientProvisions = provisionsOwned < provisionsNeeded;
  const encounters = Math.max(1, Math.round(hours * config.encountersPerHour));
  return (
    <section className="adv-idle" aria-label="Plan adventure">
      <div className="adv-idle-cols">
        <div className="adv-slot-col" aria-label="Expedition party">
          <h3 className="adv-h">Party <span className="muted">({filled}/{config.partySize})</span></h3>
          <div className="adv-slots">
            {[0, 1, 2].map((slot) => {
              const monId = selectedIds[slot] ?? null;
              const mon = monId ? eligibleMons.find((m) => m.id === monId) : null;
              return (
                <div key={slot} className={`adv-slot ${mon ? 'is-filled' : 'is-empty'}`}>
                  {mon ? (
                    <>
                      <img src={`/assets/digimon/${mon.catalogId}/dot.gif`} alt="" loading="lazy" />
                      <span className="adv-slot-name">{mon.nickname}</span>
                      <span className="adv-slot-sub muted">Lv {mon.level} · {mon.template?.stage ?? '?'}</span>
                      <button type="button" className="adv-slot-clear" aria-label={`Remove ${mon.nickname} from slot ${slot + 1}`} onClick={() => onSelect(slot, null)}>✕</button>
                    </>
                  ) : (
                    <>
                      <div className="adv-slot-empty-mark">—</div>
                      <span className="adv-slot-sub muted">Slot {slot + 1}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <h4 className="adv-h adv-h--sub">Roster</h4>
          {eligibleMons.length === 0 ? (
            <p className="muted">No Digimon available. Only resting mons (not in party / not training / not adventuring / not listed / not downed) can join an expedition.</p>
          ) : (
            <ul className="adv-roster-list" aria-label="Eligible Digimon">
              {eligibleMons.map((mon) => {
                const selected = usedIds.has(mon.id);
                return (
                  <li key={mon.id}>
                    <button
                      type="button"
                      className={`adv-roster-chip ${selected ? 'is-selected' : ''}`}
                      onClick={() => {
                        if (selected) {
                          const slotIndex = selectedIds.findIndex((id) => id === mon.id);
                          if (slotIndex >= 0) onSelect(slotIndex, null);
                          return;
                        }
                        const emptyIdx = selectedIds.findIndex((id) => id === null);
                        if (emptyIdx >= 0) onSelect(emptyIdx, mon.id);
                      }}
                    >
                      <img src={`/assets/digimon/${mon.catalogId}/dot.gif`} alt="" loading="lazy" />
                      <span>
                        <b>{mon.nickname}</b>
                        <span className="muted"> · Lv {mon.level}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <aside className="adv-plan-col" aria-label="Trip parameters">
          <h3 className="adv-h">Distance</h3>
          <div className="adv-slider-block">
            <input
              type="range"
              min={config.minHours}
              max={config.maxHours}
              step={1}
              value={hours}
              onChange={(event) => onHoursChange(Number(event.target.value))}
              aria-label={`Adventure duration: ${hours} hour${hours === 1 ? '' : 's'}`}
            />
            <div className="adv-slider-value">
              <b>{hours}h</b>
              <span className="muted">~{encounters} encounter{encounters === 1 ? '' : 's'}</span>
            </div>
          </div>
          <dl className="adv-cost">
            <div className="adv-cost-row">
              <dt>Provisions needed</dt>
              <dd className={insufficientProvisions ? 'adv-cost-bad' : ''}>
                <b>{provisionsNeeded}</b>
                <span className="muted"> / {provisionsOwned} owned</span>
              </dd>
            </div>
            <div className="adv-cost-row">
              <dt>Rate</dt>
              <dd className="muted">{config.provisionsPerHour} per hour</dd>
            </div>
            <div className="adv-cost-row">
              <dt>Rewards scale with</dt>
              <dd className="muted">distance × wild level</dd>
            </div>
          </dl>
          <button
            type="button"
            className="btn adv-start-btn"
            disabled={!canStart}
            onClick={onStart}
            title={!canStart ? (filled < config.partySize ? `Fill all ${config.partySize} party slots` : insufficientProvisions ? `Need ${provisionsNeeded - provisionsOwned} more Provisions — craft them in the Pantry` : undefined) : undefined}
          >
            {startBusy ? 'Sending…' : insufficientProvisions ? `Need ${provisionsNeeded - provisionsOwned} more Provisions` : filled < config.partySize ? `Fill ${config.partySize - filled} more slot${config.partySize - filled === 1 ? '' : 's'}` : `Send party (${hours}h)`}
          </button>
        </aside>
      </div>
    </section>
  );
}

function ActiveAdventurePanel({
  adventure,
  now,
  collectBusy,
  onCollect,
}: {
  readonly adventure: AdventureView;
  readonly now: number;
  readonly collectBusy: boolean;
  readonly onCollect: () => void;
}): JSX.Element {
  const elapsed = Math.max(0, now - adventure.startedAt);
  const pct = Math.min(100, Math.max(0, (elapsed / adventure.distanceMs) * 100));
  const remainingMs = Math.max(0, adventure.finishesAt - now);
  const ready = adventure.ready || remainingMs === 0;
  return (
    <section className="adv-active" aria-label="Active adventure">
      <header className="adv-active-head">
        <div>
          <h2 className="adv-active-title">
            {ready ? 'Party ready to be debriefed' : 'Party in the field'}
          </h2>
          <p className="muted adv-active-sub">
            {ready ? 'Collect the report to award XP and loot.' : `Returning in ${formatCountdown(remainingMs)}. Elapsed ${formatDuration(elapsed)} of ${formatDuration(adventure.distanceMs)}.`}
          </p>
        </div>
        <button
          type="button"
          className={`btn ${ready ? 'btn--primary' : 'btn--secondary'} adv-collect-btn`}
          disabled={!ready || collectBusy}
          onClick={onCollect}
        >
          {collectBusy ? 'Collecting…' : ready ? 'Collect report' : formatCountdown(remainingMs)}
        </button>
      </header>
      <div className="adv-progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="adv-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <ul className="adv-active-party" aria-label="Party members">
        {adventure.party.map((member) => (
          <li key={member.monId}>
            <PartyChip member={member} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PartyChip({ member }: { readonly member: AdventureMemberView }): JSX.Element {
  return (
    <div className="adv-mon-chip">
      <img src={`/assets/digimon/${member.catalogId}/dot.gif`} alt="" loading="lazy" />
      <div>
        <b>{member.nickname}</b>
        <span className="muted"> · Lv {member.level} · {member.stage}</span>
      </div>
    </div>
  );
}

function ReportCard({ adventure, report }: { readonly adventure: AdventureView; readonly report: AdventureReport }): JSX.Element {
  const xpByMon = new Map(report.xpDeltas.map((d) => [d.monId, d] as const));
  const koedSet = new Set(report.koedMonIds);
  return (
    <section className="adv-report" aria-label="Last adventure report">
      <header className="adv-report-head">
        <h3 className="adv-h">Last expedition</h3>
        <span className="muted">
          <b>{report.encounters.length}</b> encounter{report.encounters.length === 1 ? '' : 's'} · <b>{report.wins}</b> win{report.wins === 1 ? '' : 's'} · <b>{report.losses}</b> loss{report.losses === 1 ? '' : 'es'}
        </span>
      </header>
      <div className="adv-report-totals">
        {report.totals.meat > 0 ? <span className="ps-res ps-res--meat" title="Meat"><span className="ps-dot" />{report.totals.meat}</span> : null}
        {report.totals.bits > 0 ? <span className="ps-res ps-res--bits" title="Bits"><span className="ps-dot" />{report.totals.bits}</span> : null}
        {report.totals.data > 0 ? <span className="ps-res ps-res--data" title="Data"><span className="ps-dot" />{report.totals.data}</span> : null}
        {report.totals.credits > 0 ? <span className="adv-report-credits">+{report.totals.credits} DGC</span> : null}
      </div>
      <ul className="adv-report-party" aria-label="Party outcomes">
        {adventure.party.map((member) => {
          const xp = xpByMon.get(member.monId);
          const koed = koedSet.has(member.monId);
          return (
            <li key={member.monId} className={koed ? 'is-koed' : ''}>
              <img src={`/assets/digimon/${member.catalogId}/dot.gif`} alt="" loading="lazy" />
              <div className="adv-report-mon-info">
                <b>{member.nickname}</b>
                <span className="muted"> · Lv {xp?.levelAfter ?? member.level}</span>
                {xp && xp.gainedLevels > 0 ? <span className="adv-report-level-up">+{xp.gainedLevels} Lv</span> : null}
                {koed ? <span className="adv-report-ko">KO'd — recovering</span> : null}
              </div>
              <span className="adv-report-xp">+{xp?.xpGained ?? 0} XP</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const hr = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (hr > 0) return min === 0 ? `${hr}h` : `${hr}h ${min}m`;
  if (min === 0) return `${sec}s`;
  if (sec === 0) return `${min}m`;
  return `${min}m ${sec}s`;
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hr = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (hr > 0) return `${hr}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
