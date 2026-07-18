import type { ReactNode } from 'react';

import { AppNav, NavStat } from '../AppNav';

export function NurseryChrome({ meat, children }: { readonly meat: number; readonly children: ReactNode }): JSX.Element {
  return (
    <div className="nursery-page">
      <AppNav>
        <NavStat tone="meat" label="Meat" value={meat.toLocaleString()} />
      </AppNav>
      <div className="nursery-shell">
        {children}
        <div className="nursery-meat-source" hidden>{meat}</div>
      </div>
    </div>
  );
}
