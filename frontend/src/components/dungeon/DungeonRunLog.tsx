import type { ReactElement } from 'react';
import type { LogEntry } from './types';

type DungeonRunLogProps = {
  readonly dungeonName: string;
  readonly stepCount: number;
  readonly defeatedCount: number;
  readonly totalEncounters: number;
  readonly isComplete: boolean;
  readonly allEncountersDefeated: boolean;
  readonly isCompleting: boolean;
  readonly onComplete: () => void;
  readonly logs: readonly LogEntry[];
};

export function DungeonRunLog({
  dungeonName,
  stepCount,
  defeatedCount,
  totalEncounters,
  isComplete,
  allEncountersDefeated,
  isCompleting,
  onComplete,
  logs,
}: DungeonRunLogProps): ReactElement {
  return (
    <>
      <div className="rhead">
        <div className="rt">Run Log</div>
        <div className="rs">
          <b>{dungeonName}</b> · Steps {stepCount} · Encounters {defeatedCount}/{totalEncounters}
        </div>
        {!isComplete && allEncountersDefeated && stepCount > 0 && totalEncounters > 0 && (
          <button
            className="ebtn"
            style={{ marginTop: 10 }}
            onClick={onComplete}
            disabled={isCompleting}
          >
            Complete Dungeon
          </button>
        )}
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
