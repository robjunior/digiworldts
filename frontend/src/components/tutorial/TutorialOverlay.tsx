import { useCallback, useEffect, useState, type JSX } from 'react';

import { CloseIcon } from '../common/icons';
import type { Tutorial } from './tutorial-content';

/**
 * Paginated per-screen tutorial overlay.
 *
 * Matches the Cyber-Sleuth-style card the design brief pointed to:
 * Tutorials label + category tab + notched card with header/body/diagram +
 * pagination + End / Proceed footer + left/right page chevrons.
 *
 * Keyboard bindings:
 *   Escape / X          → End (mark seen and close)
 *   Space / D / Right → Proceed (next page, or End on the last page)
 *   Left arrow         → Back (previous page)
 */
export function TutorialOverlay({
  tutorial,
  onClose,
}: {
  readonly tutorial: Tutorial;
  readonly onClose: () => void;
}): JSX.Element {
  const [pageIdx, setPageIdx] = useState<number>(0);
  const pages = tutorial.pages;
  const total = pages.length;
  const page = pages[pageIdx] ?? pages[0]!;
  const isFirst = pageIdx === 0;
  const isLast = pageIdx === total - 1;

  const goPrev = useCallback((): void => {
    setPageIdx((idx) => Math.max(0, idx - 1));
  }, []);

  const goNext = useCallback((): void => {
    setPageIdx((idx) => {
      if (idx >= total - 1) {
        onClose();
        return idx;
      }
      return idx + 1;
    });
  }, [total, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      switch (event.key) {
        case 'Escape':
        case 'x':
        case 'X':
          event.preventDefault();
          onClose();
          return;
        case ' ':
        case 'd':
        case 'D':
        case 'ArrowRight':
          event.preventDefault();
          goNext();
          return;
        case 'ArrowLeft':
          event.preventDefault();
          goPrev();
          return;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, onClose]);

  return (
    <div className="tutorial-shell" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <div className="tutorial-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="tutorial-frame">
        <div className="tutorial-head">
          <div className="tutorial-brand">Tutorials</div>
          <div className="tutorial-cat" data-cat={tutorial.category.toLowerCase()}>
            {tutorial.category}
          </div>
        </div>

        <div className="tutorial-body-row">
          <button
            type="button"
            className="tutorial-chev tutorial-chev-prev"
            onClick={goPrev}
            disabled={isFirst}
            aria-label="Previous page"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <article className="tutorial-card">
            <header className="tutorial-card-head">
              <h2 id="tutorial-title">{page.title}</h2>
            </header>
            <div className="tutorial-card-body">
              <p className="tutorial-text">{page.body}</p>
              {page.visual ? <div className="tutorial-visual">{page.visual}</div> : null}
            </div>
            <footer className="tutorial-card-foot">
              <div className="tutorial-pager">
                <b>{pageIdx + 1}</b>
                <span className="tutorial-pager-sep">/</span>
                <span>{total}</span>
              </div>
              <div className="tutorial-actions">
                <button type="button" className="tutorial-btn tutorial-btn-end" onClick={onClose}>
                  <kbd className="tutorial-kbd">X</kbd>
                  End
                </button>
                <button type="button" className="tutorial-btn tutorial-btn-proceed" onClick={goNext}>
                  <kbd className="tutorial-kbd">D</kbd>
                  <kbd className="tutorial-kbd">␣</kbd>
                  {isLast ? 'Finish' : 'Proceed'}
                </button>
              </div>
            </footer>
          </article>

          <button
            type="button"
            className="tutorial-chev tutorial-chev-next"
            onClick={goNext}
            aria-label="Next page"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        <button type="button" className="tutorial-close" onClick={onClose} aria-label="Close tutorial">
          <CloseIcon size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
