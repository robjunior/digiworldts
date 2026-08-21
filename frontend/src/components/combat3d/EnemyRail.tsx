import type { EnemyUnitView, UnitId } from '@digiworld/shared/battle';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useT } from '../../hooks/useLocale';

export function EnemyRail({ aliveEnemies, selectedTargetId, canAct, onSelect, onSpriteClick }: { readonly aliveEnemies: readonly EnemyUnitView[]; readonly selectedTargetId: UnitId | null; readonly canAct: boolean; readonly onSelect: (id: UnitId) => void; readonly onSpriteClick?: (id: UnitId) => void }): JSX.Element {
  const t = useT();
  const [hoveredId, setHoveredId] = useState<UnitId | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const hoveredEnemy = hoveredId ? aliveEnemies.find(e => e.id === hoveredId) : null;

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>, id: UnitId) => {
    setHoveredId(id);
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({ x: rect.left - 12, y: rect.top + rect.height / 2 });
  };

  const handleMouseLeave = () => {
    setHoveredId(null);
    setTooltipPos(null);
  };

  return (
    <>
      <div className="enemy-rail" role="group" aria-label="Enemy Digimon" ref={railRef}>
        {aliveEnemies.map((foe) => (
          <button
            key={foe.id}
            type="button"
            className={`erow ${canAct ? 'pick' : ''} ${selectedTargetId === foe.id ? 'sel' : ''} ${hoveredId === foe.id ? 'hover' : ''}`}
            onClick={() => onSelect(foe.id)}
            onMouseEnter={(e) => handleMouseEnter(e, foe.id)}
            onMouseLeave={handleMouseLeave}
            disabled={!canAct}
            aria-pressed={selectedTargetId === foe.id}
            aria-describedby={hoveredId === foe.id ? `enemy-tooltip-${foe.id}` : undefined}
          >
            <span className="edot pill" style={{ ['--el' as string]: `var(--el-${foe.element})` }} />
            <span className="enm">{foe.name}</span>
            <span className="ehp">{foe.hp}/{foe.hpMax}</span>
          </button>
        ))}
      </div>

      {hoveredEnemy && tooltipPos && (
        <div
          id={`enemy-tooltip-${hoveredEnemy.id}`}
          className="enemy-tooltip"
          role="tooltip"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: 'translateX(-100%) translateY(-50%)',
          }}
        >
          <div className="tooltip-header">
            <span className="tooltip-element" style={{ ['--el' as string]: `var(--el-${hoveredEnemy.element})` }}>{hoveredEnemy.element}</span>
            <span className="tooltip-name">{hoveredEnemy.name}</span>
          </div>
          <div className="tooltip-stats">
            <div className="stat-row">
              <span className="stat-label">{t('combat.level')}</span>
              <span className="stat-value">Lv {hoveredEnemy.level}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">{t('combat.hp')}</span>
              <span className="stat-value">{hoveredEnemy.hp} / {hoveredEnemy.hpMax}</span>
            </div>
          </div>
          {hoveredEnemy.ailments.length > 0 && (
            <div className="tooltip-ailments">
              <span className="stat-label">{t('combat.ailments')}</span>
              <span className="stat-value">{hoveredEnemy.ailments.join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}