import { useMemo } from 'react';
import { ELEMENTS, STAGES, type Element, type Stage } from '@digiworld/shared/digimon';

import type { DigdexEntry } from '../../lib/api-digdex';

export type DigdexHiveProps = {
  readonly entries: readonly DigdexEntry[];
  readonly onSelect: (entry: DigdexEntry) => void;
  readonly selectedCatalogId?: string;
  readonly filterElement?: Element;
};

function stageIdx(stage: Stage): number {
  const i = STAGES.indexOf(stage);
  return i < 0 ? 9 : i;
}

export function DigdexHive({ entries, onSelect, selectedCatalogId, filterElement }: DigdexHiveProps): JSX.Element {
  const sections = useMemo(() => {
    const byEl: Partial<Record<Element, DigdexEntry[]>> = {};
    for (const e of entries) {
      const el = e.element;
      if (!byEl[el]) byEl[el] = [];
      byEl[el]!.push(e);
    }
    
    const order = filterElement ? [filterElement] : ELEMENTS;
    
    return order.map(el => {
      const items = byEl[el];
      if (!items || items.length === 0) return null;
      
      const sorted = [...items].sort((a, b) => {
        const stageA = a.template?.stage ?? 'Rookie';
        const stageB = b.template?.stage ?? 'Rookie';
        const diff = stageIdx(stageA) - stageIdx(stageB);
        if (diff !== 0) return diff;
        return a.catalogId.localeCompare(b.catalogId);
      });
      
      const metCt = sorted.filter(d => d.met).length;
      return { el, items: sorted, metCt };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
  }, [entries, filterElement]);

  return (
    <div className="grid-wrap" id="grid-wrap">
      {sections.map(({ el, items, metCt }) => (
        <section key={el} className="elsec" data-el={el} style={{ '--ec': `var(--el-${el})` } as React.CSSProperties}>
          <div className="eh">
            <span className="dot" />
            <span className="nm">{el}</span>
            <span className="ct">{metCt}/{items.length} met</span>
          </div>
          <div className="hexgrid">
            {items.map(entry => (
              <DigdexTile
                key={entry.catalogId}
                entry={entry}
                onSelect={onSelect}
                selected={entry.catalogId === selectedCatalogId}
                el={el}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const STAGE_ABBR: Record<string, string> = {
  Baby: 'BAB',
  'In-Training': 'IN',
  Rookie: 'ROO',
  Champion: 'CHA',
  Ultimate: 'ULT',
  Mega: 'MEG',
};

function DigdexTile({
  entry,
  onSelect,
  selected,
  el,
}: {
  readonly entry: DigdexEntry;
  readonly onSelect: (entry: DigdexEntry) => void;
  readonly selected: boolean;
  readonly el: Element;
}): JSX.Element {
  const met = entry.met;
  const t = entry.template;

  const inner = met && t ? (
    <>
      <span className="spr">
        <img src={t.assets.dot} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
      </span>
      <span className="nm">{t.name}</span>
    </>
  ) : (
    <>
      <span className="spr"><span className="q">?</span></span>
      <span className="nm">???</span>
    </>
  );

  const abbr = t?.stage ? (STAGE_ABBR[t.stage] || t.stage.slice(0,3).toUpperCase()) : '';

  return (
    <div
      className={`tile ${met ? '' : 'unmet'} ${selected ? 'sel' : ''}`}
      style={{ '--ec': `var(--el-${el})` } as React.CSSProperties}
      data-no={entry.catalogId}
      tabIndex={0}
      role="button"
      aria-label={met && t ? `${t.name}, ${t.stage}, ${t.element}` : `Unknown species — not met`}
      onClick={() => onSelect(entry)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(entry);
        }
      }}
    >
      <span className="stg">{abbr}</span>
      {inner}
    </div>
  );
}
