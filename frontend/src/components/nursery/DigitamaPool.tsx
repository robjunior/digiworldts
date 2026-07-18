import { useState } from 'react';

import type { PendingHatchEntry, SpeciesDataEntry } from '../../lib/api-nursery';

type DigitamaPoolProps = {
  readonly entries: readonly SpeciesDataEntry[];
  readonly pending: readonly PendingHatchEntry[];
  readonly loading: boolean;
  readonly totalWeight: number;
  readonly busyCatalogId: string | null;
  readonly mixBusy: boolean;
  readonly onHatch: (entry: SpeciesDataEntry) => void;
  readonly onMix: () => void;
};

export function DigitamaPool({ entries, pending, loading, totalWeight, busyCatalogId, mixBusy, onHatch, onMix }: DigitamaPoolProps): JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const pendingByCatalog = new Map(pending.map((p) => [p.targetCatalogId, p] as const));
  const readyCount = entries.filter((e) => e.percent >= 100).length;
  const totalKills = entries.reduce((s, e) => s + e.kills, 0);
  const mixEligible = totalWeight > 0;

  return (
    <section className="digitama-pool">
      <header className="digitama-pool-header" onClick={() => setExpanded((v) => !v)}>
        <div>
          <div className="eyebrow">Digitama Pool</div>
          <h2>Species Data</h2>
        </div>
        <div className="digitama-pool-summary">
          <span className="digitama-count" title="Species collected">{entries.length}</span>
          {readyCount > 0 ? <span className="digitama-ready" title="Species ready to hatch">{readyCount} ready</span> : null}
          <button type="button" className="digitama-collapse" aria-label={expanded ? 'Collapse' : 'Expand'}>{expanded ? '▾' : '▸'}</button>
        </div>
      </header>
      {expanded ? (
        <div className="digitama-body">
          <DigitamaMixRow eligible={mixEligible} totalWeight={totalWeight} totalKills={totalKills} mixBusy={mixBusy} onMix={onMix} />
          <DigitamaList entries={entries} loading={loading} pendingByCatalog={pendingByCatalog} busyCatalogId={busyCatalogId} onHatch={onHatch} />
        </div>
      ) : null}
    </section>
  );
}

function DigitamaMixRow({ eligible, totalWeight, totalKills, mixBusy, onMix }: { readonly eligible: boolean; readonly totalWeight: number; readonly totalKills: number; readonly mixBusy: boolean; readonly onMix: () => void }): JSX.Element {
  const title = eligible
    ? `Weighted lottery across all species. Consumes ALL data. Total weight: ${totalWeight}. Kills: ${totalKills}.`
    : 'No species data yet. Defeat wild Digimon to collect data.';
  return (
    <div className="digitama-mix">
      <div className="digitama-mix-info">
        <div className="digitama-mix-title">Mix Hatch</div>
        <div className="digitama-mix-sub">Weighted lottery · consumes all data · ~3 min</div>
      </div>
      <button type="button" className="digitama-mix-btn" disabled={!eligible || mixBusy} title={title} onClick={onMix}>{mixBusy ? '...' : 'Mix'}</button>
    </div>
  );
}

function DigitamaList({ entries, loading, pendingByCatalog, busyCatalogId, onHatch }: { readonly entries: readonly SpeciesDataEntry[]; readonly loading: boolean; readonly pendingByCatalog: Map<string, PendingHatchEntry>; readonly busyCatalogId: string | null; readonly onHatch: (entry: SpeciesDataEntry) => void }): JSX.Element {
  if (loading && entries.length === 0) {
    return <div className="empty-digitama">Loading…</div>;
  }
  if (entries.length === 0) {
    return <div className="empty-digitama">Defeat wild Digimon to collect species data.</div>;
  }
  return (
    <div className="digitama-list">
      {entries.map((entry) => <DigitamaRow key={entry.catalogId} entry={entry} pending={pendingByCatalog.get(entry.catalogId) ?? null} busy={busyCatalogId === entry.catalogId} onHatch={onHatch} />)}
    </div>
  );
}

function DigitamaRow({ entry, pending, busy, onHatch }: { readonly entry: SpeciesDataEntry; readonly pending: PendingHatchEntry | null; readonly busy: boolean; readonly onHatch: (entry: SpeciesDataEntry) => void }): JSX.Element {
  const pct = Math.max(0, Math.min(100, entry.percent));
  const ready = pct >= 100;
  const hatching = pending !== null;
  const disabled = !ready || busy || hatching;
  const title = hatching
    ? `Already hatching (ready ${new Date(pending!.hatchAt).toLocaleTimeString()})`
    : ready ? `Hatch — Rookie predecessor at Lv 5, plus chip items for higher stages` : `Need 100% (currently ${pct}%). Defeat more wild ${entry.name}.`;
  return (
    <div className="digitama-row" data-stage={String(entry.stage).toLowerCase()} data-ready={ready ? 'true' : 'false'}>
      <div className="digitama-thumb"><img src={entry.dot} alt="" onError={(event) => { event.currentTarget.style.opacity = '0.2'; }} /></div>
      <div className="digitama-body-cell">
        <div className="digitama-name"><span>{entry.name}</span><span className="digitama-stage">{entry.stage}</span></div>
        <div className="digitama-gauge" title={`${pct}% (kills: ${entry.kills})`}>
          <div className="digitama-gauge-fill" style={{ width: `${pct}%` }} data-ready={ready ? 'true' : 'false'} />
        </div>
        <div className="digitama-meta"><span>{pct}%</span><span>Kills {entry.kills}</span></div>
      </div>
      <div className="digitama-action">
        <button type="button" className="digitama-hatch-btn" disabled={disabled} title={title} onClick={() => onHatch(entry)}>
          {hatching ? 'Egg' : ready ? 'Hatch' : `${pct}%`}
        </button>
      </div>
    </div>
  );
}
