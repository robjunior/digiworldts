export type Floater3D = { readonly id: string; readonly text: string; readonly kind: 'dmg' | 'crit' | 'miss' | 'resist'; readonly x: number; readonly y: number };

export function Floaters({ floaters }: { readonly floaters: readonly Floater3D[] }): JSX.Element {
  return (
    <div className="c3d-floaters" aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      {floaters.map((f) => (
        <div key={f.id} className={`floater ${f.kind}`} style={{ left: f.x, top: f.y }}>{f.text}</div>
      ))}
    </div>
  );
}