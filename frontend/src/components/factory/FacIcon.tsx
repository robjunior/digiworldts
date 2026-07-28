import type { JSX } from 'react';

import type { FactoryTypeId } from '../../lib/api-farm';

/**
 * Small SVG icon rendered inside the `.badge` and `.bbadge` slots on
 * factory cards. One icon per factory type — matches the pre-existing inline
 * `<FacIcon type={f.type} />` helper in Factory.tsx.
 */
export function FacIcon({ type }: { readonly type: FactoryTypeId | string }): JSX.Element | null {
  switch (type) {
    case 'med':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M12 4v16M4 12h16" strokeWidth="2.4" />
          <rect x="4" y="4" width="16" height="16" rx="0" />
        </svg>
      );
    case 'chip':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="6" y="6" width="12" height="12" />
          <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
        </svg>
      );
    case 'rare':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M12 3l3 5 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6L3 9l6-1 3-5z" />
        </svg>
      );
    case 'pantry':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M5 8h14v11H5z" />
          <path d="M5 8l2-4h10l2 4" />
          <path d="M9 12h6" />
        </svg>
      );
    default:
      return null;
  }
}
