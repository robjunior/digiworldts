import type { ReactNode } from 'react';

export function NurseryChrome({ meat: _meat, children }: { readonly meat: number; readonly children: ReactNode }): JSX.Element {
  return <>{children}</>;
}
