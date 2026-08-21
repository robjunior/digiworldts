import type { JSX } from 'react';

/**
 * Centralized SVG icon library.
 *
 * Consolidates the inline nav icons previously duplicated across AppShell.tsx
 * (15+ icons of ~5-8 lines each) and other pages that need the same glyphs.
 * Every icon uses viewBox 24 24 + stroke currentColor + strokeWidth 1.7 for
 * a consistent stroke-based look; consumers wrap with `<span className="ic">`
 * or similar to supply sizing/color context.
 */

export function FactoryIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 20V10l5 3V10l5 3V6l6 4v10z" />
      <path d="M7 20v-4M12 20v-4M17 20v-4" />
    </svg>
  );
}

export function FarmIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 20v-6a8 8 0 0 1 16 0v6" />
      <path d="M4 20h16M9 20v-4a3 3 0 0 1 6 0v4M12 6V3" />
    </svg>
  );
}

export function AdventureIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z" />
      <path d="M9.5 12l1.8 1.8L15 10" />
    </svg>
  );
}

export function NurseryIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 21c-4-2.5-7-5.5-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 12c0 3.5-3 6.5-7 9z" />
    </svg>
  );
}

export function TrainingIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M6.5 6.5l11 11" />
      <path d="M4 9l-1.5-1.5 2-2L6 7M15 18l1.5 1.5 2-2L17 15" />
      <path d="M9 4l2 2M18 13l2 2M4 15l2 2M13 6l2 2" />
    </svg>
  );
}

export function MarketIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 7h16l-1.2 4.5H5.2L4 7z" />
      <path d="M5.2 11.5V19h13.6v-7.5" />
      <path d="M4 7l1-3h14l1 3" />
    </svg>
  );
}

export function ShopIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M20 4H4v16h16V4z" />
      <path d="M8 12h8M12 8v8" strokeWidth="1.5" />
      <path d="M16 4v-2M16 20v2M4 8h-2M20 8h2" />
    </svg>
  );
}

export function DigidexIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 3v18M4 7.5l8 4.5 8-4.5" />
    </svg>
  );
}

export function RosterIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 5.5a3 3 0 0 1 0 5.4M18 19c0-2.4-1.4-4.3-3.4-5" />
    </svg>
  );
}

export function WorldIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.4 3.8 8.5S14.5 18.1 12 20.5C9.5 18.1 8.2 15.1 8.2 12S9.5 5.9 12 3.5z" />
    </svg>
  );
}

export function ArenaIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M14 3l-2 5h4l-4 8 2-5h-4l4-8z" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function DungeonIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function AdminDotIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  );
}

export function AdminCogIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M19.8 7.5 17.2 9M6.8 15l-2.6 1.5" />
    </svg>
  );
}

export function BackIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M10 6 4 12l6 6" />
      <path d="M5 12h15" />
    </svg>
  );
}

export function CloseIcon({ strokeWidth = 1.9, size = 16 }: { readonly strokeWidth?: number; readonly size?: number } = {}): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function CheckIcon({ size = 10 }: { readonly size?: number } = {}): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M5 12l4 4 10-10" />
    </svg>
  );
}

export function AlertIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}

export function InfoCircleIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export function DownArrowIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M12 3v14M6 11l6 6 6-6" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

export function UpArrowIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
