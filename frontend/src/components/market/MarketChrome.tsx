import type { ReactNode } from 'react';
import { Credits, NetCore } from '../common/DigiCredits';

type Props = {
  readonly credits: number;
  readonly netcore?: number;
  readonly children: ReactNode;
};

export function MarketChrome({ credits, netcore, children }: Props): JSX.Element {
  return (
    <>
      <div className="market-chrome-wallet" style={{ display: 'flex', gap: '16px', marginLeft: 'auto', alignItems: 'center' }}>
        {netcore !== undefined && <NetCore value={netcore} />}
        <Credits value={credits} />
      </div>
      {children}
    </>
  );
}
