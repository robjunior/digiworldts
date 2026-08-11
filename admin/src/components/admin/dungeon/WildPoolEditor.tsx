import type { JSX } from 'react';
import type { WildPool, WildPoolEntry } from '@digiworld/shared';
import type { TemplateDigimon } from '@digiworld/shared/digimon';

type WildPoolEditorProps = {
  readonly pool: WildPool;
  readonly onChange: (pool: WildPool) => void;
  readonly catalog: readonly TemplateDigimon[];
  readonly disabled?: boolean;
};

function parseOptionalInt(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

export function WildPoolEditor({ pool, onChange, catalog, disabled }: WildPoolEditorProps): JSX.Element {
  const addEntry = (): void => {
    const first = catalog[0];
    if (!first) return;
    onChange([...pool, { catalogId: first.id }]);
  };

  const updateEntry = (index: number, patch: Partial<WildPoolEntry>): void => {
    onChange(pool.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  };

  const removeEntry = (index: number): void => {
    onChange(pool.filter((_, i) => i !== index));
  };

  if (catalog.length === 0) {
    return <p className="muted">No catalog templates loaded — cannot build a pool.</p>;
  }

  return (
    <div className="wild-pool-editor">
      {pool.length === 0 ? (
        <p className="muted">Pool empty. When empty and container is not safe, container falls back to next-level pool.</p>
      ) : (
        <table className="wild-pool-table">
          <thead>
            <tr>
              <th>Catalog</th>
              <th>Min lvl</th>
              <th>Max lvl</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pool.map((entry, index) => (
              <tr key={`${entry.catalogId}-${index}`}>
                <td>
                  <select
                    value={entry.catalogId}
                    onChange={(event) => updateEntry(index, { catalogId: event.target.value })}
                    disabled={disabled}
                  >
                    {catalog.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} ({template.stage} · {template.element})
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={entry.minLevel ?? ''}
                    placeholder="—"
                    onChange={(event) => updateEntry(index, { minLevel: parseOptionalInt(event.target.value) })}
                    disabled={disabled}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={entry.maxLevel ?? ''}
                    placeholder="—"
                    onChange={(event) => updateEntry(index, { maxLevel: parseOptionalInt(event.target.value) })}
                    disabled={disabled}
                  />
                </td>
                <td>
                  <button type="button" onClick={() => removeEntry(index)} disabled={disabled} aria-label="Remove entry">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" onClick={addEntry} disabled={disabled}>
        + Add pool entry
      </button>
    </div>
  );
}
