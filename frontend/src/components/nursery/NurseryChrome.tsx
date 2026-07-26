import type { ReactNode } from 'react';


export function NurseryChrome({ meat, children }: { readonly meat: number; readonly children: ReactNode }): JSX.Element {
  return (
    <div className="nursery-page">
      <div className="nursery-shell">
        {children}
        <div className="nursery-meat-source" hidden>{meat}</div>
      </div>
    </div>
  );
}
