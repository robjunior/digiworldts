import type { JSX } from 'react';

/**
 * The `.ovw` stat block that sits above the factory grid — shows counts
 * and next-ready countdown. Previously inline in Factory.tsx.
 */
export function FactoryOverview({
  ownedCount,
  totalCrafting,
  totalReady,
  nextReadyText,
}: {
  readonly ownedCount: number;
  readonly totalCrafting: number;
  readonly totalReady: number;
  readonly nextReadyText: string;
}): JSX.Element {
  return (
    <div className="ovw" data-od-id="factory-overview">
      <div className="stat">
        <div className="k">Factories</div>
        <div className="v">
          {ownedCount}
          <small>/4</small>
        </div>
      </div>
      <div className="stat">
        <div className="k">Crafting</div>
        <div className="v">{totalCrafting}</div>
      </div>
      <div className={`stat ${totalReady > 0 ? 'hot' : ''}`}>
        <div className="k">Ready to collect</div>
        <div className="v">{totalReady}</div>
      </div>
      <div className="stat">
        <div className="k">Next ready</div>
        <div className="v">{nextReadyText}</div>
      </div>
    </div>
  );
}
