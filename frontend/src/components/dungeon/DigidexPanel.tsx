import type { TemplateDigimon } from '@digiworld/shared/digimon';

type DigidexPanelProps = {
  readonly digimons: readonly TemplateDigimon[];
};

export function DigidexPanel({ digimons }: DigidexPanelProps): JSX.Element {
  const sorted = [...digimons].sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  );

  return (
    <div className="digidex-panel">
      {sorted.length === 0 ? (
        <div className="digidex-empty">Nenhuma espécie registrada.</div>
      ) : (
        sorted.map((entry: TemplateDigimon) => (
          <div key={entry.id} className="digidex-row">
            <span className="digidex-name">{entry.name}</span>
            <span className="digidex-meta">
              {entry.stage ?? '—'} · {entry.element ?? '—'}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
