import type { ReactNode } from 'react';

export type NavStatTone = 'meat' | 'bits' | 'data' | 'credits' | 'signal' | 'battle' | 'gold' | 'nature' | 'muted';

export type NavStatProps = {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly tone?: NavStatTone;
  readonly title?: string;
};

export function NavStat({ label, value, tone = 'muted', title }: NavStatProps): JSX.Element {
  const scalar = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const scalarLabel = typeof label === 'string' ? label : '';
  return (
    <span className={`nav-stat nav-stat--${tone}`} title={title ?? `${scalarLabel}: ${scalar}`}>
      <span className="nav-stat-dot" aria-hidden="true" />
      <span className="nav-stat-lbl">{label}</span>
      <b className="nav-stat-val">{value}</b>
    </span>
  );
}
