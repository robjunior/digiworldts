import type { CSSProperties } from 'react';

export type Floater3D = {
  readonly id: string;
  readonly text: string;
  readonly kind: 'dmg' | 'crit' | 'miss' | 'resist' | 'heal' | 'status' | 'level';
  readonly x: number;
  readonly y: number;
  readonly color?: string;
  readonly sub?: string;
};

/**
 * Combat floaters projected over arena sprites. Each character is an
 * individual `<span class="d">` with a `--i` stagger index (the fx-digit
 * animation), `status` renders inside a `.tagbox`, and an optional `.fx-sub`
 * label sits above. Removal happens on `animationend` (the fx-rise /
 * fx-slide / fx-fade keyframes), not a timeout.
 */
export function Floaters({
  floaters,
  onDone,
}: {
  readonly floaters: readonly Floater3D[];
  readonly onDone?: (id: string) => void;
}): JSX.Element {
  return (
    <div className="c3d-floaters" aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      {floaters.map((f) => {
        const chars = Array.from(f.text);
        return (
          <div
            key={f.id}
            className={`fx fx-${f.kind}`}
            style={{
              left: f.x,
              top: f.y,
              ...(f.color ? ({ '--c': f.color } as CSSProperties) : {}),
            }}
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget) onDone?.(f.id);
            }}
          >
            {f.kind === 'status' ? (
              <span className="tagbox">
                {chars.map((ch, i) => (
                  <span key={i} className="d" style={{ '--i': i } as CSSProperties}>
                    {ch === ' ' ? '\u00a0' : ch}
                  </span>
                ))}
              </span>
            ) : (
              chars.map((ch, i) => (
                <span key={i} className="d" style={{ '--i': i } as CSSProperties}>
                  {ch === ' ' ? '\u00a0' : ch}
                </span>
              ))
            )}
            {f.sub ? <span className="fx-sub">{f.sub}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
