import type { ReactNode } from 'react';

export function MarketChrome({ credits, children }: { readonly credits: number; readonly children: ReactNode }): JSX.Element {
  return (
    <>
      <div className="wallet">
        <span className="ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <circle cx="12" cy="12" r="8" />
            <path d="M12 8v8M9.5 10.5h3.5a1.5 1.5 0 0 1 0 3H9.5" />
          </svg>
        </span>
        <span>
          <span className="k">DigiCredits</span>
          <span className="v">{credits.toLocaleString()}</span>
        </span>
      </div>
      {children}
    </>
  );
}
