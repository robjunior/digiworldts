import type { ReactNode } from 'react';

export function AdminSection({ title, lede, actions, children }: { readonly title: string; readonly lede?: string; readonly actions?: ReactNode; readonly children: ReactNode }): JSX.Element {
  return (
    <section className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2>{title}</h2>
          {lede ? <p className="lede">{lede}</p> : null}
        </div>
        {actions ? <div className="admin-section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function AdminMessage({ tone, children }: { readonly tone: 'muted' | 'error' | 'success'; readonly children: ReactNode }): JSX.Element {
  return <div className={`admin-message is-${tone}`}>{children}</div>;
}

export function Field({ label, children }: { readonly label: string; readonly children: ReactNode }): JSX.Element {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  );
}

export function StatTile({ label, value }: { readonly label: string; readonly value: ReactNode }): JSX.Element {
  return (
    <div className="stat-tile">
      <span className="lbl">{label}</span>
      <span className="val">{value}</span>
    </div>
  );
}

export function ErrorText({ error }: { readonly error: Error | null }): JSX.Element | null {
  if (error === null) return null;
  return <AdminMessage tone="error">{error.message}</AdminMessage>;
}
