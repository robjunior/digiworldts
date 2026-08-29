import { useQuery } from '@tanstack/react-query';
import { getDigdex, type DigdexEntry } from '../../lib/api-digdex';
import type { TemplateDigimon } from '@digiworld/shared/digimon';

type DungeonDigidexPanelProps = {
  readonly sub?: string;
};

export function DungeonDigidexPanel({ sub }: DungeonDigidexPanelProps): JSX.Element {
  const query = useQuery({
    queryKey: ['digdex'],
    queryFn: getDigdex,
    staleTime: 5 * 60 * 1000,
  });

  const entries = query.data?.entries ?? [];

  if (query.isPending) {
    return <div className="fn-skeleton">Loading Digidex…</div>;
  }
  if (query.isError) {
    return <div className="fn-error">Falha ao carregar Digidex.</div>;
  }

  return (
    <div className="dungeon-digidex">
      <div className="dungeon-digidex-grid">
        {entries.map((entry: DigdexEntry) => {
          const template: TemplateDigimon | null = entry.template ?? null;
          const met = entry.met;
          const catalogId = entry.catalogId;
          const name = template?.name ?? catalogId;
          const element = template?.element ?? entry.element;

          return (
            <div
              key={catalogId}
              className={`dungeon-digidex-slot ${met ? 'is-met' : 'is-unmet'}`}
              style={
                met
                  ? ({ '--slot-color': `var(--el-${element}, var(--digdex-muted))` } as React.CSSProperties)
                  : undefined
              }
            >
              {met ? (
                <>
                  {template && 'icon' in template && typeof (template as Record<string, unknown>).icon === 'string' ? (
                    <div className="dungeon-digidex-icon">
                      <img src={(template as Record<string, unknown>).icon as string} alt={name} draggable={false} />
                    </div>
                  ) : (
                    <div className="dungeon-digidex-icon">🟦</div>
                  )}
                  <div className="dungeon-digidex-name">{name}</div>
                  <div className="dungeon-digidex-id">{catalogId}</div>
                </>
              ) : (
                <div className="dungeon-digidex-q">?</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
