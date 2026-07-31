import type { PendingHatchEntry } from '../../lib/api-nursery';
import { PendingEgg } from './PendingEgg';

export function NurseryYard({ pending, busyHatchId, onCollect }: { readonly pending: readonly PendingHatchEntry[]; readonly busyHatchId: string | null; readonly onCollect: (entry: PendingHatchEntry) => void }): JSX.Element {
  return (
    <div className="rlist" id="pendinglist">
      {pending.length > 0 ? (
        pending.map((entry) => (
          <PendingEgg
            key={entry.id}
            entry={entry}
            x={0}
            y={0}
            busy={busyHatchId === entry.id}
            onCollect={onCollect}
          />
        ))
      ) : (
        <div className="rempty">No eggs incubating. Hatch a species from your data — eggs take 3 minutes.</div>
      )}
    </div>
  );
}
