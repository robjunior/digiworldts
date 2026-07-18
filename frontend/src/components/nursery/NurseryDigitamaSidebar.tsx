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

export function NurseryDigitamaSidebar({ entries, pending, loading, totalWeight, busyCatalogId, mixBusy, onHatch, onMix }: NurseryDigitamaSidebarProps): JSX.Element {
  const readyCount = entries.filter((e) => e.percent >= 100).length;
  const pendingCount = pending.length;
  return (
    <aside className="sidebar sidebar-left">
      <div className="sidebar-header">
        <div>
          <div className="eyebrow">Nursery</div>
          <h1>Digitama</h1>
        </div>
        <div className="digitama-header-badges">
          {pendingCount > 0 ? <span className="digitama-badge digitama-badge-egg" title={`${pendingCount} egg${pendingCount > 1 ? 's' : ''} incubating`}>{pendingCount} EGG{pendingCount > 1 ? 'S' : ''}</span> : null}
          {readyCount > 0 ? <span className="digitama-badge digitama-badge-ready" title={`${readyCount} species ready`}>{readyCount} READY</span> : null}
        </div>
      </div>
      <DigitamaPool
        entries={entries}
        pending={pending}
        loading={loading}
        totalWeight={totalWeight}
        busyCatalogId={busyCatalogId}
        mixBusy={mixBusy}
        onHatch={onHatch}
        onMix={onMix}
      />
    </aside>
  );
}
