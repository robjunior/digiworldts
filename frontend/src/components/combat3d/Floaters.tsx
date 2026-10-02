import { useEffect, useRef, useState, type CSSProperties } from 'react';

export type Floater3D = {
  readonly id: string;
  readonly text: string;
  readonly kind: 'dmg' | 'crit' | 'miss' | 'resist' | 'heal' | 'status' | 'level';
  readonly x: number;
  readonly y: number;
  readonly color?: string;
  readonly sub?: string;
};

const GLYPHS = '01#$%&@*<>/|=+';

/**
 * Decodes the floater text: each character starts as a random glyph and is
 * revealed progressively (char i resolves at 220 + i*70 ms), mirroring the
 * original fx() setInterval behavior.
 */
function useDecodedText(text: string, enabled: boolean): string {
  const [decoded, setDecoded] = useState(text);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setDecoded(text);
      return;
    }
    const chars = Array.from(text);
    const t0 = performance.now();
    intervalRef.current = setInterval(() => {
      const dt = performance.now() - t0;
      let done = true;
      const next = chars.map((ch, i) => {
        if (ch === ' ' || dt > 220 + i * 70) return ch === ' ' ? '\u00a0' : ch;
        done = false;
        return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      });
      setDecoded(next.join(''));
      if (done && intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, 45);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [text, enabled]);

  return decoded;
}

function FxText({ text, decode }: { readonly text: string; readonly decode: boolean }): JSX.Element {
  const decoded = useDecodedText(text, decode);
  const chars = Array.from(decoded);
  return (
    <>
      {chars.map((ch, i) => (
        <span key={i} className="d" style={{ '--i': i } as CSSProperties}>
          {ch}
        </span>
      ))}
    </>
  );
}

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
        const decode = f.kind !== 'status';
        return (
          <div
            key={f.id}
            className={`fx fx-${f.kind}`}
            data-t={f.text}
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
                <FxText text={f.text} decode={false} />
              </span>
            ) : (
              <FxText text={f.text} decode={decode} />
            )}
            {f.sub ? <span className="fx-sub">{f.sub}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
