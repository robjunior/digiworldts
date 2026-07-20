import type { DigdexEntry } from '../../lib/api-digdex';

const ROW_SIZE = 8;

export type DigdexHiveProps = {
  readonly entries: readonly DigdexEntry[];
  readonly onSelect: (entry: DigdexEntry) => void;
};

export function DigdexHive({ entries, onSelect }: DigdexHiveProps): JSX.Element {
  const rows: DigdexEntry[][] = [];
  for (let i = 0; i < entries.length; i += ROW_SIZE) {
    rows.push(entries.slice(i, i + ROW_SIZE));
  }
  return (
    <div className="digdex-hive" role="grid" aria-label="Digimon bestiary honeycomb">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className={`digdex-row${rowIndex % 2 === 1 ? ' is-offset' : ''}`} role="row">
          {row.map((entry) => (
            <DigdexHexCell key={entry.catalogId} entry={entry} onSelect={onSelect} />
          ))}
        </div>
      ))}
    </div>
  );
}

function DigdexHexCell({ entry, onSelect }: { readonly entry: DigdexEntry; readonly onSelect: (entry: DigdexEntry) => void }): JSX.Element {
  const { met, template } = entry;
  const element = met && template ? template.element : 'null';
  const clickable = met;
  const label = met && template
    ? `${template.name} — ${template.stage}, ${template.element}`
    : 'Undiscovered Digimon — encounter one to reveal it';
  return (
    <button
      type="button"
      role="gridcell"
      aria-label={label}
      className={`digdex-hex digdex-hex-element-${element}${met ? '' : ' is-unmet'}`}
      disabled={!clickable}
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
