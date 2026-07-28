import type { JSX, ReactNode } from 'react';

import { ResourceIcon, type ResourceKind } from './ResourceIcon';

/**
 * Resource balance bar - top-of-page ribbon showing player currencies.
 *
 * Previously duplicated inline across Factory, Farm, Adventure, Nursery routes (300+ lines total).
 * Each route wrote its own <div className="balbar"> + 4-5 <div className="bal"> blocks
 * with hand-rolled SVG icons - all identical except for the resource set.
 *
 * The `.balbar` and `.bal` classes are page-scoped via extensions-{page}.css - this component
 * emits the raw class names and relies on the parent .*-page wrapper (applied by AppShell)
 * to select the correct scoped styles.
 *
 * Usage:
 * ```tsx
 * <BalBar title="Factory Row" subtitle="3 crafting">
 *   <ResourceBal resource="meat" label="Meat" value={farm.balances.Meat} />
 *   <ResourceBal resource="bits" label="Bits" value={farm.balances.Bits} />
 *   <ResourceBal resource="data" label="Data" value={farm.balances.Data} />
 *   <ResourceBal resource="credits" label="Credits" value={farm.credits} />
 * </BalBar>
 * ```
 */
export function BalBar({
  title,
  subtitle,
  odId,
  children,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly odId?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div className="balbar" {...(odId !== undefined ? { 'data-od-id': odId } : {})}>
      {children}
      <div className="strip-title">
        <div className="k">{title}</div>
        <div className="s">{subtitle}</div>
      </div>
    </div>
  );
}

/**
 * A single resource cell inside a BalBar. Renders the SVG icon, label, and value.
 * The `data-res` attribute drives per-resource color theming in the extensions CSS.
 */
export function ResourceBal({
  resource,
  label,
  value,
  format = defaultFormat,
}: {
  readonly resource: ResourceKind;
  readonly label: string;
  readonly value: number | string;
  readonly format?: (v: number) => string;
}): JSX.Element {
  const displayed = typeof value === 'number' ? format(value) : value;
  return (
    <div className="bal" data-res={dataResFor(resource)}>
      <span className="ic" aria-hidden="true">
        <ResourceIcon kind={resource} />
      </span>
      <span className="col">
        <span className="k">{label}</span>
        <span className="v">{displayed}</span>
      </span>
    </div>
  );
}

function defaultFormat(value: number): string {
  return Math.floor(value).toLocaleString('en-US');
}

function dataResFor(kind: ResourceKind): string {
  // Match legacy `data-res` values from Factory/Farm/Adventure/Nursery inline markup.
  if (kind === 'dataspecies') return 'data';
  if (kind === 'mons') return 'mons';
  return kind;
}
