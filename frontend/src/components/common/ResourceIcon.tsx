import type { JSX } from 'react';

/**
 * Centralized SVG icon library for game resources.
 * These match the inline SVGs previously duplicated across Factory, Farm, Adventure, Nursery balbars.
 *
 * The stroke width is uniformly 1.7 to match the .balbar .ic pattern in components.css.
 * Consumers wrap this in a container that provides sizing / color context.
 */

export type ResourceKind = 'meat' | 'bits' | 'data' | 'credits' | 'provisions' | 'mons' | 'dataspecies';

type IconProps = { readonly className?: string };

export function MeatIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      <path d="M12 3c4 0 7 3 7 7 0 5-4 9-7 11-3-2-7-6-7-11 0-4 3-7 7-7z" />
      <path d="M9 9c1-1 4-1 5 0" />
    </svg>
  );
}

export function BitsIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      <path d="M4 8h4V4M20 8h-4V4M4 16h4v4M20 16h-4v4" />
      <rect x="8" y="8" width="8" height="8" />
    </svg>
  );
}

export function DataIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.6 3.1 3 7 3s7-1.4 7-3V6" />
      <path d="M5 12c0 1.6 3.1 3 7 3s7-1.4 7-3" />
    </svg>
  );
}

export function CreditsIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M9.5 10.5h3.5a1.5 1.5 0 0 1 0 3H9.5" />
    </svg>
  );
}

export function ProvisionsIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      <path d="M5 8h14v11H5z" />
      <path d="M5 8l2-4h10l2 4" />
      <path d="M9 12h6" />
    </svg>
  );
}

export function MonsIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 5.5a3 3 0 0 1 0 5.4M18 19c0-2.4-1.4-4.3-3.4-5" />
    </svg>
  );
}

export function ResourceIcon({ kind, className }: { readonly kind: ResourceKind; readonly className?: string }): JSX.Element {
  const props = className !== undefined ? { className } : {};
  switch (kind) {
    case 'meat': return <MeatIcon {...props} />;
    case 'bits': return <BitsIcon {...props} />;
    case 'data':
    case 'dataspecies': return <DataIcon {...props} />;
    case 'credits': return <CreditsIcon {...props} />;
    case 'provisions': return <ProvisionsIcon {...props} />;
    case 'mons': return <MonsIcon {...props} />;
  }
}
