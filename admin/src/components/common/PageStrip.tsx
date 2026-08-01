import type { ReactNode } from 'react';

export type PageStripTone = 'action' | 'reward' | 'warn';

export type PageStripMetric = {
  readonly label: ReactNode;
  readonly className?: string;
};

export type PageStripProps = {
  readonly name: string;
  readonly tone: PageStripTone;
  readonly metrics: readonly PageStripMetric[];
  readonly actions?: ReactNode;
};

export function PageStrip({ name, tone, metrics, actions }: PageStripProps): JSX.Element {
  return (
    <div className={`page-strip is-${tone}`} role="status" aria-live="polite" data-od-id="page-strip">
      <span className="ps-name">{name}</span>
      <span className="ps-body">
        {metrics.map((metric, index) => (
          <MetricItem key={index} metric={metric} showSeparator={index > 0} />
        ))}
      </span>
      <span className="ps-actions">{actions}</span>
    </div>
  );
}

function MetricItem({ metric, showSeparator }: { readonly metric: PageStripMetric; readonly showSeparator: boolean }): JSX.Element {
  return (
    <>
      {showSeparator ? <span className="sep">·</span> : null}
      <span className={metric.className}>{metric.label}</span>
    </>
  );
}
