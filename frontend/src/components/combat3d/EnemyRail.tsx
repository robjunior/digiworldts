import type { EnemyUnitView, UnitId } from '@digiworld/shared/battle';

export function EnemyRail({ aliveEnemies, selectedTargetId, canAct, onSelect }: { readonly aliveEnemies: readonly EnemyUnitView[]; readonly selectedTargetId: UnitId | null; readonly canAct: boolean; readonly onSelect: (id: UnitId) => void }): JSX.Element {
  return (
    <div className="enemy-rail" role="group" aria-label="Enemy Digimon">
      {aliveEnemies.map((foe) => (
        <button
          key={foe.id}
          type="button"
          className={`erow ${selectedTargetId === foe.id ? 'sel' : ''}`}
          onClick={() => onSelect(foe.id)}
          disabled={!canAct}
          aria-pressed={selectedTargetId === foe.id}
        >
          <span className="edot pill" style={{ ['--el' as string]: `var(--el-${foe.element})` }} />
          <span className="enm">{foe.name}</span>
          <span className="ehp">{foe.hp}/{foe.hpMax}</span>
        </button>
      ))}
    </div>
  );
}