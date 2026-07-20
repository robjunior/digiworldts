import { useMemo } from 'react';
import { ELEMENTS, type Element } from '@digiworld/shared/digimon';

import type { DigdexEntry } from '../../lib/api-digdex';

const ROW_SIZE = 6;

const ELEMENT_LABEL: Record<Element, string> = {
  fire: 'Fire',
  water: 'Water',
  plant: 'Plant',
  ice: 'Ice',
  electricity: 'Electricity',
  earth: 'Earth',
  steel: 'Steel',
  wind: 'Wind',
  light: 'Light',
  dark: 'Dark',
  null: 'Null',
};

type ClusterKey = Element | 'unknown';

const UNKNOWN_LABEL = 'Undiscovered';

export type DigdexHiveProps = {
  readonly entries: readonly DigdexEntry[];
  readonly onSelect: (entry: DigdexEntry) => void;
};

type Cluster = {
  readonly key: ClusterKey;
  readonly label: string;
  readonly entries: readonly DigdexEntry[];
  readonly metCount: number;
};

export function DigdexHive({ entries, onSelect }: DigdexHiveProps): JSX.Element {
  const clusters = useMemo<readonly Cluster[]>(() => buildClusters(entries), [entries]);
  return (
    <div className="digdex-clusters" role="grid" aria-label="Digimon bestiary honeycomb, grouped by element">
      {clusters.map((cluster, idx) => (
        <ClusterSection key={cluster.key} cluster={cluster} orderIndex={idx} onSelect={onSelect} />
      ))}
    </div>
  );
}

function ClusterSection({ cluster, orderIndex, onSelect }: { readonly cluster: Cluster; readonly orderIndex: number; readonly onSelect: (entry: DigdexEntry) => void }): JSX.Element {
  const rows: DigdexEntry[][] = [];
  for (let i = 0; i < cluster.entries.length; i += ROW_SIZE) {
    rows.push(cluster.entries.slice(i, i + ROW_SIZE));
  }
  return (
    <section className={`digdex-cluster digdex-cluster-${cluster.key}`} style={{ animationDelay: `${orderIndex * 60}ms` }}>
      <header className="digdex-cluster-head">
        <span className={`digdex-cluster-orb digdex-cluster-orb-${cluster.key}`} aria-hidden />
        <h3 className="digdex-cluster-title">{cluster.label}</h3>
        <span className="digdex-cluster-count">{cluster.metCount}<span className="digdex-cluster-count-sep">/</span>{cluster.entries.length}</span>
      </header>
      <div className="digdex-hive">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className={`digdex-row${rowIndex % 2 === 1 ? ' is-offset' : ''}`} role="row">
            {row.map((entry) => (
              <DigdexHexCell key={entry.catalogId} entry={entry} onSelect={onSelect} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function DigdexHexCell({ entry, onSelect }: { readonly entry: DigdexEntry; readonly onSelect: (entry: DigdexEntry) => void }): JSX.Element {
  const { met, template } = entry;
  const element: Element = met && template ? template.element : 'null';
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

function buildClusters(entries: readonly DigdexEntry[]): readonly Cluster[] {
  const byElement = new Map<Element, DigdexEntry[]>();
  for (const el of ELEMENTS) byElement.set(el, []);
  const unknown: DigdexEntry[] = [];
  for (const entry of entries) {
    if (entry.met && entry.template) {
      byElement.get(entry.template.element)?.push(entry);
    } else {
      unknown.push(entry);
    }
  }
  const result: Cluster[] = [];
  for (const el of ELEMENTS) {
    const list = byElement.get(el) ?? [];
    if (list.length === 0) continue;
    const metCount = list.reduce((n, e) => (e.met ? n + 1 : n), 0);
    result.push({ key: el, label: ELEMENT_LABEL[el], entries: list, metCount });
  }
  if (unknown.length > 0) {
    result.push({ key: 'unknown', label: UNKNOWN_LABEL, entries: unknown, metCount: 0 });
  }
  return result;
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

