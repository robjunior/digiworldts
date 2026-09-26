import type { PendingHatchEntry, SpeciesDataEntry } from '../../lib/api-nursery';
import { DigimonSprite } from '../common/DigimonSprite';

type DigitamaPoolProps = {
  readonly entries: readonly SpeciesDataEntry[];
  readonly pending?: readonly PendingHatchEntry[];
  readonly loading: boolean;
  readonly totalWeight?: number;
  readonly busyCatalogId: string | null;
  readonly mixBusy?: boolean;
  readonly onHatch: (entry: SpeciesDataEntry) => void;
  readonly onMix?: () => void;
};

export function DigitamaPool({ entries, loading, busyCatalogId, onHatch }: DigitamaPoolProps): JSX.Element {
  const list = [...entries].sort((a, b) => b.percent - a.percent || b.kills - a.kills);

  if (loading && entries.length === 0) {
    return <div className="rlist" id="datalist"><div className="rempty">Loading…</div></div>;
  }

  return (
    <div className="rlist" id="datalist">
      {list.length > 0 ? (
        list.map((entry) => <DigitamaRow key={entry.catalogId} entry={entry} busy={busyCatalogId === entry.catalogId} onHatch={onHatch} />)
      ) : (
        <div className="rempty">No species data yet. Defeat wild Digimon in Adventure to collect their data — 100% lets you hatch that exact species.</div>
      )}
    </div>
  );
}

function DigitamaRow({ entry, busy, onHatch }: { readonly entry: SpeciesDataEntry; readonly busy: boolean; readonly onHatch: (entry: SpeciesDataEntry) => void }): JSX.Element {
  const full = entry.percent >= 100;
  const tier = (entry as Record<string, unknown>).tier as string | undefined ?? 'common';
  return (
    <div className="drow" data-tier={tier} data-cat={entry.catalogId}>
      <span className="dspr">
        <DigimonSprite catalogId={entry.catalogId} />
      </span>
      <div className="dmid">
        <div className="dn">{entry.name} <span className="tier">{tier}</span></div>
        <div className="dbar"><i style={{ width: `${Math.min(100, entry.percent)}%` }} /></div>
      </div>
      <div className="dmeta">
        <span className={`pc ${full ? 'full' : ''}`}>{Math.round(entry.percent)}%</span>
        <button type="button" className="hatchbtn" disabled={!full || busy} title={full ? 'Hatch this species' : 'Needs 100% data'} onClick={() => onHatch(entry)}>
          {full ? 'Hatch' : `${entry.kills} kills`}
        </button>
      </div>
    </div>
  );
}
