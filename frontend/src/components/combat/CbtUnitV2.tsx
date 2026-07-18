import type { Ailmented, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import type { Element } from '@digiworld/shared/digimon';

type CbtUnitV2Props = {
  readonly unit: FriendlyUnitView;
  readonly activeUnitId: UnitId | null;
  readonly hitUnitId: UnitId | null;
};

export function CbtUnitV2({ unit, activeUnitId, hitUnitId }: CbtUnitV2Props): JSX.Element {
  const hpPct = percent(unit.hp, unit.hpMax);
  const enPct = percent(unit.en, unit.enMax);
  const isActive = activeUnitId === unit.id && !unit.down;
  const classes = ['cbt-unit', 'cbt-unit--v2', isActive ? 'is-active' : '', unit.down ? 'is-locked' : '', hitUnitId === unit.id ? 'is-hit' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <article className={classes} data-mon={unit.id} data-od-id={`cbt-${unit.id}`}>
      <div className="atb-stripe" role="progressbar" aria-valuenow={isActive ? 100 : 0} aria-valuemin={0} aria-valuemax={100} aria-label="ATB gauge" data-role="atb">
        <i style={{ width: isActive ? '100%' : '0%' }} />
      </div>
      <div className="u-head">
        <span className="u-name">{unit.name}</span>
        <span className="u-el" style={{ color: elementColor(unit.element) }}>{unit.element}</span>
      </div>
      <div className="body-row">
        <div className="u-portrait" style={{ color: elementColor(unit.element) }}>
          <img
            src={`/assets/digimon/${unit.templateId}/portrait.webp`}
            alt={unit.name}
            loading="lazy"
            onError={(event) => {
              const img = event.currentTarget;
              const dot = `/assets/digimon/${unit.templateId}/dot.gif`;
              if (img.src.endsWith('portrait.webp')) {
                img.src = dot;
              } else {
                img.style.display = 'none';
              }
            }}
          />
        </div>
        <div className="stat-block">
          <div className="hp-line">
            <div className="meter meter--hp" role="progressbar" aria-valuenow={unit.hp} aria-valuemin={0} aria-valuemax={unit.hpMax} data-role="hp" aria-label="HP">
              <i style={{ width: `${hpPct}%` }} />
            </div>
            <span className="v" data-role="hp-num">{formatNum(unit.hp)} / {formatNum(unit.hpMax)}</span>
          </div>
          <div className="en-line">
            <span className="k">EN</span>
            <div className="meter meter--en" role="progressbar" aria-valuenow={unit.en} aria-valuemin={0} aria-valuemax={unit.enMax} data-role="en" aria-label="Energy">
              <i style={{ width: `${enPct}%` }} />
            </div>
            <span className="v" data-role="en-num">{unit.en} / {unit.enMax}</span>
          </div>
        </div>
      </div>
      <Ailments ailments={unit.ailments} />
    </article>
  );
}

function Ailments({ ailments }: { readonly ailments: readonly Ailmented[] }): JSX.Element {
  return (
    <div className="ailments" data-role="ailments">
      {ailments.map((ailment) => (
        <span className={`ailment ailment--${ailment.kind}`} key={`${ailment.kind}-${ailment.turnsLeft}`}>{ailment.kind}</span>
      ))}
    </div>
  );
}

function ElementGlyph({ element }: { readonly element: Element }): JSX.Element {
  switch (element) {
    case 'fire':
      return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3"><path d="M34 6c8 12-5 16 8 27 4-8 9-9 11-18 8 11 7 25-1 34-10 12-31 11-40-2C3 34 11 21 24 12c-2 10 2 14 10 18 5-8-1-13 0-24Z" /></svg>;
    case 'water':
      return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3"><path d="M32 6c12 15 20 26 20 38 0 10-8 16-20 16s-20-6-20-16C12 32 20 21 32 6Z" /><path d="M21 43c3 5 7 7 13 7" /></svg>;
    case 'nature':
      return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3"><path d="M52 10C31 10 16 22 14 43c20 1 35-11 38-33Z" /><path d="M14 52c7-18 17-27 32-36" /></svg>;
    case 'electric':
      return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3"><path d="M37 4 13 36h18l-4 24 24-34H34L37 4Z" /></svg>;
    case 'neutral':
      return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3"><path d="M32 8 54 21v22L32 56 10 43V21L32 8Z" /><path d="M32 8v48M10 21l22 13 22-13" /></svg>;
    default:
      element satisfies never;
      return <svg viewBox="0 0 64 64" />;
  }
}

function percent(value: number, max: number): number {
  if (max <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

function formatNum(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function elementColor(element: Element): string {
  return `var(--el-${element})`;
}
