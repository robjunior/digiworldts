import type { ReactElement } from 'react';
import type { DungeonEncounter, EncounterDigimon } from '@digiworld/shared';
import type { TemplateDigimon } from '@digiworld/shared/digimon';

type DungeonEncounterCardProps = {
  readonly activeEncounter: DungeonEncounter | null;
  readonly activeRandomEncounter: readonly EncounterDigimon[] | null;
  readonly templateById: ReadonlyMap<string, TemplateDigimon>;
  readonly isStartingRandom: boolean;
  readonly isStartingEncounter: boolean;
  readonly onStartRandom: (digimon: readonly EncounterDigimon[]) => void;
  readonly onCancelRandom: () => void;
  readonly onStartEncounter: (encId: string) => void;
};

export function DungeonEncounterCard({
  activeEncounter,
  activeRandomEncounter,
  templateById,
  isStartingRandom,
  isStartingEncounter,
  onStartRandom,
  onCancelRandom,
  onStartEncounter,
}: DungeonEncounterCardProps): ReactElement | null {
  const displayName = (mon: EncounterDigimon): string =>
    mon.nickname || templateById.get(mon.catalogId)?.name || mon.catalogId;
  if (activeRandomEncounter) {
    return (
      <div className="ecard wild-card">
        <div className="ek">wild · Random Encounter</div>
        <h3>Wild encounter!</h3>
        <div className="emons">
          {activeRandomEncounter.map((mon, index) => (
            <div key={`${mon.catalogId}-${index}`} className="emon">
              <span className="esprite" aria-hidden="true">
                {displayName(mon).charAt(0).toUpperCase()}
              </span>
              <span className="enm">
                {displayName(mon)}
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
                {displayName(m).charAt(0).toUpperCase()}
              </span>
              <span className="enm">
                {displayName(m)}
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
