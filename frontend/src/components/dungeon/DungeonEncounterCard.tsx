import type { ReactElement } from 'react';
import type { DungeonEncounter, EncounterDigimon } from '@digiworld/shared';

type DungeonEncounterCardProps = {
  readonly activeEncounter: DungeonEncounter | null;
  readonly activeRandomEncounter: readonly EncounterDigimon[] | null;
  readonly isStartingRandom: boolean;
  readonly isStartingEncounter: boolean;
  readonly onStartRandom: (digimon: readonly EncounterDigimon[]) => void;
  readonly onCancelRandom: () => void;
  readonly onStartEncounter: (encId: string) => void;
};

export function DungeonEncounterCard({
  activeEncounter,
  activeRandomEncounter,
  isStartingRandom,
  isStartingEncounter,
  onStartRandom,
  onCancelRandom,
  onStartEncounter,
}: DungeonEncounterCardProps): ReactElement | null {
  if (activeRandomEncounter) {
    return (
      <div className="ecard wild-card">
        <div className="ek">wild · Random Encounter</div>
        <h3>Wild encounter!</h3>
        <div className="emons">
          {activeRandomEncounter.map((mon, index) => (
            <div key={`${mon.catalogId}-${index}`} className="emon">
              <span className="esprite" aria-hidden="true">
                {mon.catalogId.charAt(0).toUpperCase()}
              </span>
              <span className="enm">
                {mon.nickname || mon.catalogId}
                <span className="elv">Lv {mon.level}</span>
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="ebtn"
          onClick={() => onStartRandom(activeRandomEncounter)}
          disabled={isStartingRandom}
        >
          {isStartingRandom ? 'Entering...' : 'Start Battle'}
        </button>
        <button
          type="button"
          className="ebtn secondary"
          onClick={onCancelRandom}
          disabled={isStartingRandom}
        >
          Back away
        </button>
      </div>
    );
  }

  if (activeEncounter) {
    return (
      <div className="ecard">
        <div className="ek">{activeEncounter.difficulty} · Encounter</div>
        <h3>{activeEncounter.label || 'Wild Digimon'}</h3>
        <div className="emons">
          {activeEncounter.digimon.map((m, i) => (
            <div key={i} className="emon">
              <span className="esprite" aria-hidden="true">
                {m.catalogId.charAt(0).toUpperCase()}
              </span>
              <span className="enm">
                {m.nickname || m.catalogId}
                <span className="elv">Lv {m.level}</span>
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="ebtn"
          onClick={() => onStartEncounter(activeEncounter.id)}
          disabled={isStartingEncounter}
        >
          {isStartingEncounter ? 'Entering...' : 'Enter Battle'}
        </button>
      </div>
    );
  }

  return null;
}
