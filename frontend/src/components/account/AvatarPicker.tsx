import { useEffect, useRef } from 'react';
import { DigimonSprite } from '../common/DigimonSprite';

export type AvatarPickChoice = {
  readonly value: string | null;
  readonly label: string;
  readonly catalogId?: string;
  readonly element?: string;
};

type AvatarPickerProps = {
  readonly open: boolean;
  readonly title: string;
  readonly eyebrow: string;
  readonly subtitle: string;
  readonly closeLabel: string;
  readonly choices: readonly AvatarPickChoice[];
  readonly selected: string | null;
  readonly initialLetter: string;
  readonly onSelect: (value: string | null) => void;
  readonly onClose: () => void;
};

export function AvatarPicker(props: AvatarPickerProps): JSX.Element {
  const { open, onClose, choices, selected, onSelect, initialLetter } = props;
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const firstFocusRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) firstFocusRef.current?.focus();
  }, [open]);

  return (
    <div
      ref={overlayRef}
      className={`acc-avov${open ? ' show' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="acc-avpick-title"
      aria-hidden={open ? undefined : true}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="acc-avmodal">
        <div className="mh">
          <div>
            <div className="ek">{props.eyebrow}</div>
            <h3 id="acc-avpick-title">{props.title}</h3>
            <div className="msub">{props.subtitle}</div>
          </div>
          <button className="acc-avx" type="button" aria-label={props.closeLabel} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="acc-avgrid">
          {choices.map((choice, idx) => {
            const pressed = selected === choice.value;
            const isMonogram = choice.value === null;
            return (
              <button
                ref={idx === 0 ? firstFocusRef : null}
                key={choice.value ?? '__init__'}
                type="button"
                className="acc-avpick"
                aria-pressed={pressed}
                data-el={choice.element ?? undefined}
                onClick={() => onSelect(choice.value)}
              >
                {isMonogram ? (
                  <span className="mono">{initialLetter}</span>
                ) : choice.catalogId != null ? (
                  <DigimonSprite catalogId={choice.catalogId} />
                ) : (
                  <span className="mono">{initialLetter}</span>
                )}
                <span className="cap">{choice.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
