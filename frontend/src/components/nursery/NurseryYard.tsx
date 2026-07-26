import type { NurseryMon, PendingHatchEntry } from '../../lib/api-nursery';
import { PendingEgg } from './PendingEgg';

export type NurseryFeedback = {
  readonly monId: string;
  readonly kind: 'pet' | 'feed';
  readonly nonce: number;
};

export function NurseryYard({ pending, busyHatchId, onCollect }: { readonly mons: readonly NurseryMon[]; readonly feedback: NurseryFeedback | null; readonly pending: readonly PendingHatchEntry[]; readonly busyHatchId: string | null; readonly onCollect: (entry: PendingHatchEntry) => void }): JSX.Element {
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
        <div className="rempty">No eggs incubating. Hatch a species from your data — eggs take 3 minutes, then collect a fresh Lv 5 Rookie.</div>
      )}
    </div>
  );
}
