import type { ReactNode } from 'react';

import { AppNav, NavStat } from '../AppNav';
import { DigiCredits } from '../common/DigiCredits';
import { PageStrip } from '../common/PageStrip';

export function MarketChrome({ credits, children }: { readonly credits: number; readonly children: ReactNode }): JSX.Element {
  return (
    <div className="app-shell market-page">
      <AppNav>
        <NavStat tone="credits" label="Credits" value={credits.toLocaleString()} />
      </AppNav>
      <main className="app-main">
        <PageStrip
          name="Market"
          tone="action"
          metrics={[
            { label: <>player trades</>, className: 'muted' },
          ]}
          actions={<DigiCredits value={credits} />}
        />
        {children}
      </main>
    </div>
  );
}
