import type { ReactNode } from 'react';
import { useState } from 'react';
import { format } from 'date-fns';

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

export type ContentStatus = 'draft' | 'published';

export function StatusBadge({ status, size = 'normal' }: { readonly status: ContentStatus; readonly size?: 'small' | 'normal' }): JSX.Element {
  const className = `status-badge status-badge--${status} ${size === 'small' ? 'status-badge--sm' : ''}`;
  return <span className={className}>{status === 'draft' ? 'Draft' : 'Published'}</span>;
}

export type HistoryEntry<T> = {
  readonly version: number;
  readonly status: ContentStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly definition: T;
};

export function HistoryModal<T>({
  isOpen,
  onClose,
  title,
  history,
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly history: readonly HistoryEntry<unknown>[];
}): JSX.Element | null {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Version history — {title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {history.length === 0 ? (
            <p className="muted">No history entries.</p>
          ) : (
            <div className="history-list">
              {history.map((entry) => (
                <div key={entry.version} className="history-entry">
                  <div className="history-entry-head">
                    <span className="history-version">v{entry.version}</span>
                    <StatusBadge status={entry.status} size="small" />
                    <span className="history-date">
                      Updated {format(entry.updatedAt, 'yyyy-MM-dd HH:mm:ss')}
                    </span>
                  </div>
                  <pre className="history-definition">{JSON.stringify(entry.definition, null, 2)}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
