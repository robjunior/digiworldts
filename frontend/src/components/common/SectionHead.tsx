import type { JSX, ReactNode } from 'react';

/**
 * Standard section header (h3.stitle) used across pages.
 *
 * Consolidates the pattern:
 * ```tsx
 * <h3 className="stitle">
 *   Your Factories <span className="cnt">3/4 built</span>
 * </h3>
 * ```
 * Duplicated in Factory, Adventure, Training, Nursery, Roster, Farm, and more.
 *
 * The `.stitle` class + `::after` line + `.cnt` badge are page-scoped in
 * extensions-{page}.css - this component just emits the raw class names.
 */
export function SectionHead({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count?: string | number;
  readonly children?: ReactNode;
}): JSX.Element {
  return (
    <h3 className="stitle">
      {title}
      {count !== undefined ? <span className="cnt">{count}</span> : null}
      {children}
    </h3>
  );
}
