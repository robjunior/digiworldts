import type { PendingHatchEntry, SpeciesDataEntry } from '../../lib/api-nursery';
import { DigitamaPool } from './DigitamaPool';

type NurseryDigitamaSidebarProps = {
  readonly entries: readonly SpeciesDataEntry[];
  readonly pending: readonly PendingHatchEntry[];
  readonly loading: boolean;
  readonly totalWeight: number;
  readonly busyCatalogId: string | null;
  readonly mixBusy: boolean;
  readonly onHatch: (entry: SpeciesDataEntry) => void;
  readonly onMix: () => void;
};

export function NurseryDigitamaSidebar(props: NurseryDigitamaSidebarProps): JSX.Element {
  const { entries, loading, totalWeight, busyCatalogId, mixBusy, onHatch, onMix } = props;
  const anyData = entries.some(d => d.percent > 0);

  return (
    <>
      <DigitamaPool
        entries={entries}
        loading={loading}
        busyCatalogId={busyCatalogId}
        onHatch={onHatch}
      />
      <div className="mixfoot">
        <div className="mx" id="mix-hint">
          {anyData 
            ? <>Roll a random Rookie weighted by data (<b>{totalWeight}</b> total). <b>Consumes all data.</b></>
            : 'No data to mix. Collect species data first.'}
        </div>
        <button type="button" className="btn primary" id="mix-btn" disabled={!anyData || mixBusy} onClick={onMix}>Mix Hatch</button>
      </div>
    </>
  );
}
