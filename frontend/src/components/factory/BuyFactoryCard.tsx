import type { JSX } from 'react';

import { FacIcon } from './FacIcon';
import type { FactoryTypeInfo, FarmView } from '../../lib/api-farm';

/**
 * A single "buy this factory" card. Previously inline in Factory.tsx
 * within the `<div className="buygrid">` block.
 */
export function BuyFactoryCard({
  available,
  balances,
  isPending,
  onBuy,
}: {
  readonly available: FactoryTypeInfo;
  readonly balances: FarmView['balances'];
  readonly isPending: boolean;
  readonly onBuy: (typeId: FactoryTypeInfo['id']) => void;
}): JSX.Element {
  const afford =
    balances.Meat >= available.cost.meat &&
    balances.Bits >= available.cost.bits &&
    balances.Data >= available.cost.data;

  return (
    <article className="buycard" data-fac={available.id}>
      <div className="bh">
        <span className="bbadge">
          <FacIcon type={available.id} />
        </span>
        <div className="bn">{available.name}</div>
      </div>
      <div className="bd">{available.description}</div>
      <div className="costs">
        {available.cost.meat > 0 ? (
          <span className={`cchip ${balances.Meat < available.cost.meat ? 'short' : ''}`} data-res="meat">
            <span className="cd" />
            {available.cost.meat} Meat
          </span>
        ) : null}
        {available.cost.bits > 0 ? (
          <span className={`cchip ${balances.Bits < available.cost.bits ? 'short' : ''}`} data-res="bits">
            <span className="cd" />
            {available.cost.bits} Bits
          </span>
        ) : null}
        {available.cost.data > 0 ? (
          <span className={`cchip ${balances.Data < available.cost.data ? 'short' : ''}`} data-res="data">
            <span className="cd" />
            {available.cost.data} Data
          </span>
        ) : null}
      </div>
      <div className="brow">
        <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
          {afford ? 'Ready to build' : 'Not enough resources'}
        </span>
        <button className="btn primary" disabled={!afford || isPending} onClick={() => onBuy(available.id)}>
          {isPending ? 'Building...' : 'Build factory'}
        </button>
      </div>
    </article>
  );
}
