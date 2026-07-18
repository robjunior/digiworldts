import type { FarmView } from '../../lib/api-farm';

export function FarmSectionHead({ farm, pending, onCollectAll }: { readonly farm: FarmView; readonly pending: boolean; readonly onCollectAll: () => void }): JSX.Element {
  const total = farm.buildings.reduce((sum, building) => sum + building.produced, 0);
  const ready = farm.buildings.filter((building) => building.produced >= 1).length;

  return (
    <div className="sec-head">
      <h2>Production buildings</h2>
      <div className="collect-all">
        <span className="ready-note">{ready > 0 ? <><b>{formatAmount(total)}</b> ready across {ready} building{ready > 1 ? 's' : ''}</> : 'Nothing to collect yet'}</span>
        <button className="btn" type="button" disabled={total < 1 || pending} onClick={onCollectAll}>Collect all</button>
      </div>
    </div>
  );
}

function formatAmount(value: number): string {
  return Math.round(value).toLocaleString();
}
