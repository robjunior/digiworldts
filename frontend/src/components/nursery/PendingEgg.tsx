import { useEffect, useState } from 'react';

import type { PendingHatchEntry } from '../../lib/api-nursery';

type PendingEggProps = {
  readonly entry: PendingHatchEntry;
  readonly x: number;
  readonly y: number;
  readonly busy: boolean;
  readonly onCollect: (entry: PendingHatchEntry) => void;
};

export function PendingEgg({ entry, busy, onCollect }: PendingEggProps): JSX.Element {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, []);

  const remaining = Math.max(0, entry.hatchAt - now);
  const ready = remaining <= 0;

  return (
    <div className={`egg ${ready ? 'ready' : ''}`} data-egg={entry.id}>
      <span className="espr">
        <img src={`/assets/digimon/${entry.rookieCatalogId}/dot.gif`} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
      </span>
      <div className="emid">
        <div className="en">{entry.rookieName}</div>
        <div className="esub">→ {entry.targetName} · {entry.targetStage}</div>
      </div>
      {ready ? (
        <button type="button" className="collectbtn" disabled={busy} onClick={() => onCollect(entry)}>Hatch!</button>
      ) : (
        <span className="etime" data-timer={entry.id}>{formatRemaining(remaining)}</span>
      )}
    </div>
  );
}

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}
