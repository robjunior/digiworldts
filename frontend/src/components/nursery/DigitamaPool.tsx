import type { SpeciesDataEntry } from '../../lib/api-nursery';
import { DigimonSprite } from '../common/DigimonSprite';

type DigitamaPoolProps = {
  readonly entries: readonly SpeciesDataEntry[];
  readonly loading: boolean;
  /** Set of selected catalog ids (clicking a row toggles selection). */
  readonly selectedIds: ReadonlySet<string>;
  /** Toggle selection for a species with data > 0. */
  readonly onToggle: (entry: SpeciesDataEntry) => void;
};

export function DigitamaPool({ entries, loading, selectedIds, onToggle }: DigitamaPoolProps): JSX.Element {
  const list = [...entries].sort((a, b) => b.percent - a.percent || b.kills - a.kills);

  if (loading && entries.length === 0) {
    return <div className="rlist" id="datalist"><div className="rempty">Loading…</div></div>;
  }

  return (
    <div className="rlist" id="datalist">
      {list.length > 0 ? (
        list.map((entry) => (
          <DigitamaRow
            key={entry.catalogId}
            entry={entry}
            selected={selectedIds.has(entry.catalogId)}
            onToggle={onToggle}
          />
        ))
      ) : (
        <div className="rempty">No species data yet. Defeat wild Digimon in Adventure to collect their data — reach 100% to hatch that exact species.</div>
      )}
    </div>
  );
}

function DigitamaRow({ entry, selected, onToggle }: {
  readonly entry: SpeciesDataEntry;
  readonly selected: boolean;
  readonly onToggle: (entry: SpeciesDataEntry) => void;
}): JSX.Element {
  const full = entry.percent >= 100;
  const selectable = entry.percent > 0;
  const tier = (entry as Record<string, unknown>).tier as string | undefined ?? 'common';
  return (
    <button
      type="button"
      className={`drow sel${selected ? ' is-selected' : ''}${!selectable ? ' disabled' : ''}`}
      data-tier={tier}
      data-cat={entry.catalogId}
      onClick={() => onToggle(entry)}
      disabled={!selectable}
      aria-pressed={selected}
    >
      <span className="sel-ic" aria-hidden="true">{selected ? '✓' : ''}</span>
      <span className="dspr">
        <DigimonSprite catalogId={entry.catalogId} />
      </span>
      <span className="dmid">
        <span className="dn">{entry.name} <span className="tier">{tier}</span></span>
        <span className="dbar"><i style={{ width: `${Math.min(100, entry.percent)}%` }} /></span>
      </span>
      <span className="dmeta">
        <span className={`pc ${full ? 'full' : ''}`}>{Math.round(entry.percent)}%</span>
        <span className="kills">{entry.kills} kill{entry.kills === 1 ? '' : 's'}</span>
      </span>
    </button>
  );
}