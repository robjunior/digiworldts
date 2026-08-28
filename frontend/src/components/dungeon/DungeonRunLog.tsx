import type { ReactElement } from 'react';
import { useT } from '../../hooks/useLocale';
import type { LogEntry } from './types';

type DungeonRunLogProps = {
  readonly dungeonName: string;
  readonly stepCount: number;
  readonly defeatedCount: number;
  readonly totalEncounters: number;
  readonly logs: readonly LogEntry[];
};

export function DungeonRunLog({
  dungeonName,
  stepCount,
  defeatedCount,
  totalEncounters,
  logs,
}: DungeonRunLogProps): ReactElement {
  const t = useT();
  return (
    <>
      <div className="rhead">
        <div className="rt">{t('dungeon.run_log')}</div>
        <div className="rs">
          <b>{dungeonName}</b> · {t('dungeon.steps')} {stepCount} · {t('dungeon.encounters')} {defeatedCount}/{totalEncounters}
        </div>
      </div>
      <div className="log" role="log" aria-live="polite">
        {logs.map((row, i) => (
          <div key={i} className={`lrow${row.cls ? ` ${row.cls}` : ''}`}>
            <span className="lt">{String(row.step).padStart(2, '0')}</span>
            <span className="lx">{row.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}
