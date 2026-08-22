import type { JSX } from 'react';

import { formatClock } from './utils';
import type { AdventureConfigView, AdventureView } from '../../lib/api-adventure';
import { unitSpriteStaticUrl } from '@digiworld/scene3d';

/**
 * Active expedition card — a single in-progress adventure with countdown,
 * party portraits, and Collect button. Previously an inline function in Adventure.tsx.
 */
export function ActiveExpCard({
  active,
  now,
  config,
  onCollect,
  isCollecting,
}: {
  readonly active: AdventureView;
  readonly now: number;
  readonly config: AdventureConfigView;
  readonly onCollect: () => void;
  readonly isCollecting: boolean;
}): JSX.Element {
  const total = active.distanceMs;
  const remainingMs = Math.max(0, active.finishesAt - now);
  const done = total - remainingMs;
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 100;
  const h = Math.max(1, Math.round(active.distanceMs / 3600000));
  const ready = active.ready || remainingMs === 0;

  return (
    <div className={`exp-card ${ready ? 'ready' : ''}`}>
      <div className="ehead">
        <span className="emini">
          {active.party.map((p) => (
            <img key={p.monId} src={unitSpriteStaticUrl(p.catalogId)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
          ))}
        </span>
        <span className="enames">
          {active.party.map((p) => p.nickname).join(' · ')}
          <span className="esub">
            {h}h run · {active.provisionsSpent} prov · ~{Math.round(h * config.encountersPerHour)} enc
          </span>
        </span>
        <span className={`eclock ${ready ? 'ready' : ''}`}>{ready ? 'READY' : formatClock(remainingMs)}</span>
      </div>
      <div className="epbar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="efoot">
        {ready ? (
          <>
            <span className="eh">
              Back at the gate — <b>collect</b> to bank loot &amp; XP.
            </span>
            <button className="btn primary sm" onClick={onCollect} disabled={isCollecting}>
              Collect
            </button>
          </>
        ) : (
          <>
            <span className="eh">Out in the field — rewards roll in on return.</span>
            <button className="btn ghost sm" disabled>
              Away…
            </button>
          </>
        )}
      </div>
    </div>
  );
}
