import { useMemo } from 'react';
import { ELEMENTS, type Element } from '@digiworld/shared/digimon';

import type { DigdexEntry } from '../../lib/api-digdex';

const ROW_SIZE = 10;

const ELEMENT_ORDER: Record<Element, number> = Object.fromEntries(
  ELEMENTS.map((el, i) => [el, i]),
) as Record<Element, number>;

export type DigdexHiveProps = {
  readonly entries: readonly DigdexEntry[];
  readonly onSelect: (entry: DigdexEntry) => void;
};

export function DigdexHive({ entries, onSelect }: DigdexHiveProps): JSX.Element {
  const sorted = useMemo<readonly DigdexEntry[]>(() => sortByElementThenName(entries), [entries]);
  const rows: DigdexEntry[][] = [];
  for (let i = 0; i < sorted.length; i += ROW_SIZE) {
    rows.push(sorted.slice(i, i + ROW_SIZE));
  }
  return (
    <div className="digdex-hive" role="grid" aria-label="Digimon bestiary honeycomb">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className={`digdex-row${rowIndex % 2 === 1 ? ' is-offset' : ''}`} role="row">
          {row.map((entry, colIndex) => (
            <DigdexHexCell
              key={entry.catalogId}
              entry={entry}
              onSelect={onSelect}
              animationIndex={rowIndex * ROW_SIZE + colIndex}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function DigdexHexCell({
  entry,
  onSelect,
  animationIndex,
}: {
  readonly entry: DigdexEntry;
  readonly onSelect: (entry: DigdexEntry) => void;
  readonly animationIndex: number;
}): JSX.Element {
  const { met, template } = entry;
  const element: Element = met && template ? template.element : 'null';
  const clickable = met;
  const label = met && template
    ? `${template.name} — ${template.stage}, ${template.element}`
    : 'Undiscovered Digimon — encounter one to reveal it';
  const delayMs = Math.min(600, animationIndex * 12);
  return (
    <button
      type="button"
      role="gridcell"
      aria-label={label}
      className={`digdex-hex digdex-hex-element-${element}${met ? '' : ' is-unmet'}`}
      disabled={!clickable}
      style={{ animationDelay: `${delayMs}ms` }}
      onClick={() => { if (clickable) onSelect(entry); }}
    >
      <div className="digdex-hex-inner">
        {met && template ? (
          <>
            <img className="digdex-hex-portrait" src={template.assets.portrait} alt="" loading="lazy" onError={hidePortrait} />
            <span className="digdex-hex-badge">{stageAbbrev(template.stage)}</span>
            <span className="digdex-hex-name">{template.name}</span>
          </>
        ) : (
          <span className="digdex-hex-unknown" aria-hidden>?</span>
        )}
      </div>
    </button>
  );
}

function sortByElementThenName(entries: readonly DigdexEntry[]): DigdexEntry[] {
  const met: DigdexEntry[] = [];
  const unmet: DigdexEntry[] = [];
  for (const e of entries) (e.met && e.template ? met : unmet).push(e);
  met.sort((a, b) => {
    const ea = ELEMENT_ORDER[a.template!.element] ?? 99;
    const eb = ELEMENT_ORDER[b.template!.element] ?? 99;
    if (ea !== eb) return ea - eb;
    return a.template!.name.localeCompare(b.template!.name);
  });
  unmet.sort((a, b) => a.catalogId.localeCompare(b.catalogId));
  return [...met, ...unmet];
}

function hidePortrait(event: React.SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.style.display = 'none';
}

function stageAbbrev(stage: string): string {
  const map: Record<string, string> = {
    'Baby': 'BB',
    'In-Training': 'IT',
    'Rookie': 'RK',
    'Champion': 'CH',
    'Ultimate': 'UL',
    'Mega': 'MG',
  };
  return map[stage] ?? stage.slice(0, 2).toUpperCase();
}
