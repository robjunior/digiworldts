import type { EnemyUnitView, UnitId } from '@digiworld/shared/battle';

import { Foe } from './Foe';

type EnemiesProps = {
  readonly enemies: readonly EnemyUnitView[];
  readonly selectedTargetId: UnitId | null;
  readonly currentUnitId: UnitId | null;
  readonly selectable: boolean;
  readonly hitUnitId: UnitId | null;
  readonly onSelectTarget: (id: UnitId) => void;
};

export function Enemies({ enemies, selectedTargetId, currentUnitId, selectable, hitUnitId, onSelectTarget }: EnemiesProps): JSX.Element {
  const visible = enemies.filter((foe) => !isPlaceholder(foe));
  return (
    <section className="enemies" aria-label="Enemy Digimon">
      {visible.map((foe) => (
        <Foe
          key={foe.id}
          foe={foe}
          selected={selectedTargetId === foe.id}
          current={currentUnitId === foe.id}
          selectable={selectable}
          hitUnitId={hitUnitId}
          onSelect={onSelectTarget}
        />
      ))}
    </section>
  );
}

function isPlaceholder(foe: EnemyUnitView): boolean {
  return foe.hpMax === 0 && foe.hp === 0 && foe.down;
}
