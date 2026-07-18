import type { FriendlyUnitView, UnitId } from '@digiworld/shared/battle';

import { CbtUnitV2 } from './CbtUnitV2';

type CbtPartyProps = {
  readonly units: readonly FriendlyUnitView[];
  readonly activeUnitId: UnitId | null;
  readonly hitUnitId: UnitId | null;
};

export function CbtParty({ units, activeUnitId, hitUnitId }: CbtPartyProps): JSX.Element {
  return (
    <div className="cbt-party" role="list" aria-label="Your party">
      {units.map((unit) => (
        <CbtUnitV2 key={unit.id} unit={unit} activeUnitId={activeUnitId} hitUnitId={hitUnitId} />
      ))}
    </div>
  );
}
