import type { ReactElement } from 'react';

type FnPanelProps = {
  readonly title: string;
  readonly sub?: string | undefined;
  readonly soon?: boolean | undefined;
  readonly onClose: () => void;
  readonly children: ReactElement;
};

export function FnPanel({ title, sub, soon = false, onClose, children }: FnPanelProps): ReactElement {
  return (
    <div className="fn-modal-backdrop" onClick={onClose}>
      <div
        className="fn-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fn-modal-head">
          <div>
            <div className="fn-modal-title">{title}</div>
            {sub ? <div className="fn-modal-sub">{sub}</div> : null}
          </div>
          <button type="button" className="fn-modal-x" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="fn-modal-body">
          {children}
          {soon ? <div className="fn-modal-soon">EM BREVE</div> : null}
        </div>
      </div>
    </div>
  );
}
