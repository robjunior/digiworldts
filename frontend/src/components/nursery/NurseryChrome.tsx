import type { ReactNode } from 'react';

import { NavStat } from '../NavStat';

export function NurseryChrome({ meat, children }: { readonly meat: number; readonly children: ReactNode }): JSX.Element {
  return (
    <div className="nursery-page">
      <div className="nursery-strip">
        <NavStat tone="meat" label="Meat" value={meat.toLocaleString()} />
      </div>
      <div className="nursery-shell">
        {children}
      </div>
    </div>
  );
}
