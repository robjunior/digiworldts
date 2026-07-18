import { useEffect, useState } from 'react';

import type { PendingHatchEntry } from '../../lib/api-nursery';

type PendingEggProps = {
  readonly entry: PendingHatchEntry;
  readonly x: number;
  readonly y: number;
  readonly busy: boolean;
  readonly onCollect: (entry: PendingHatchEntry) => void;
};

export function PendingEgg({ entry, x, y, busy, onCollect }: PendingEggProps): JSX.Element {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, []);

  const remaining = Math.max(0, entry.hatchAt - now);
  const ready = remaining <= 0;
  const label = ready ? 'READY' : formatRemaining(remaining);
  const classes = ['pending-egg'];
  if (ready) classes.push('is-ready');
  const tint = pickTint(entry.rookieCatalogId);

  return (
    <button
      type="button"
      className={classes.join(' ')}
      style={{ transform: `translate(${x - 32}px, ${y - 40}px)`, '--egg-tint': tint } as React.CSSProperties}
      disabled={!ready || busy}
      onClick={() => onCollect(entry)}
      title={ready ? `Collect ${entry.rookieName}` : `${entry.targetName} egg · ${label}`}
      aria-label={`Digitama egg for ${entry.rookieName}, ${ready ? 'ready to collect' : label + ' remaining'}`}
    >
      <span className="pending-egg-shell" aria-hidden="true" />
      <span className="pending-egg-timer">{label}</span>
      <span className="pending-egg-label">{entry.rookieName}</span>
    </button>
  );
}

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

/**
 * Deterministically pick a shell tint from the target catalog id. Same target
 * always shows the same shell colour across sessions so players can tell eggs
 * apart on the yard without opening the sidebar.
 */
function pickTint(catalogId: string): string {
  const palette = ['#e8c05a', '#7fb3d5', '#e07a5f', '#a8dadc', '#f2cc8f', '#c9ada7', '#8ecae6', '#ffb4a2'] as const;
  let hash = 0;
  for (let i = 0; i < catalogId.length; i++) hash = (hash * 31 + catalogId.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length] ?? palette[0];
}
