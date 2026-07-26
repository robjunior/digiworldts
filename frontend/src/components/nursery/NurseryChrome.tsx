import type { ReactNode } from 'react';

export function NurseryChrome({ meat, children }: { readonly meat: number; readonly children: ReactNode }): JSX.Element {
  // `meat` is kept in props to maintain the signature, even though we display it directly in Nursery.tsx now.
  return (
    <div className="nursery-page">
      {children}
    </div>
  );
}
