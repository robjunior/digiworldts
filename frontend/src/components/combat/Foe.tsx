import type { Ailmented, EnemyUnitView, UnitId } from '@digiworld/shared/battle';
import type { Element } from '@digiworld/shared/digimon';

type FoeProps = {
  readonly foe: EnemyUnitView;
  readonly selected: boolean;
  readonly current: boolean;
  readonly selectable: boolean;
  readonly hitUnitId: UnitId | null;
  readonly onSelect: (id: UnitId) => void;
};

export function Foe({ foe, selected, current, selectable, hitUnitId, onSelect }: FoeProps): JSX.Element {
  const hpPct = percent(foe.hp, foe.hpMax);
  const classes = ['foe', selected ? 'is-target' : '', current ? 'is-current' : '', foe.down ? 'is-down' : '', hitUnitId === foe.id ? 'is-hit' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <article className={classes} data-foe={foe.id} data-od-id={`foe-${foe.id}`}>
      <button className="foe-btn" type="button" disabled={!selectable || foe.down} onClick={() => onSelect(foe.id)} aria-label={`Target ${foe.name}`}>
        <span className="art" style={{ color: elementColor(foe.element) }}>
          <img
            src={`/assets/digimon/${foe.templateId}/portrait.webp`}
            alt={foe.name}
            loading="lazy"
            onError={(event) => {
              const img = event.currentTarget;
              const dot = `/assets/digimon/${foe.templateId}/dot.gif`;
              if (img.src.endsWith('portrait.webp')) {
                img.src = dot;
              } else {
                img.style.display = 'none';
              }
            }}
          />
        </span>
        <span className="f-name">{foe.name}</span>
        <span className="f-sub">{foe.element} · Lv {foe.level}{foe.analyzed ? ' · analysed' : ''}</span>
        <span
          className="foe-hp-bar"
          role="progressbar"
          aria-valuenow={foe.hp}
          aria-valuemin={0}
          aria-valuemax={foe.hpMax}
          aria-label={`HP ${foe.hp} of ${foe.hpMax}`}
          data-role="hp"
          data-critical={hpPct <= 25 ? 'true' : 'false'}
        >
          <span className="foe-hp-bar-fill" style={{ width: `${hpPct}%` }} />
          <span className="foe-hp-bar-value" data-role="hp-num">
            {formatNum(foe.hp)} / {formatNum(foe.hpMax)}
          </span>
        </span>
        <Ailments ailments={foe.ailments} />
      </button>
    </article>
  );
}

function Ailments({ ailments }: { readonly ailments: readonly Ailmented[] }): JSX.Element {
  return (
    <span className="ailments" data-role="ailments">
      {ailments.map((ailment) => (
        <span className={`ailment ailment--${ailment.kind}`} key={`${ailment.kind}-${ailment.turnsLeft}`}>{ailment.kind}</span>
      ))}
    </span>
  );
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
