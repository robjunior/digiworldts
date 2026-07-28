import { memo } from 'react';
import type { BattleView } from '@digiworld/shared/battle';

export const TurnOrderStrip = memo(function TurnOrderStrip({ battle }: { readonly battle: BattleView }): JSX.Element | null {
  const upcoming = battle.upcomingTurns ?? [];
  if (upcoming.length === 0) return null;
  const yourSide = battle.yourSide;
  const templateFor = (unitId: string): { templateId: string; name: string; element: string } | null => {
    const friendly = battle.friendly.find((u) => u.id === unitId);
    if (friendly) return { templateId: friendly.templateId, name: friendly.name, element: friendly.element };
    const enemy = battle.enemy.find((u) => u.id === unitId);
    if (enemy) return { templateId: enemy.templateId, name: enemy.name, element: enemy.element };
    return null;
  };
  return (
    <>
      {upcoming.map((entry, idx) => {
        const meta = templateFor(entry.unitId);
        if (meta === null) return null;
        const isYours = entry.side === yourSide;
        const isCurrent = idx === 0;
        const mono = (meta.name || '?').trim().charAt(0).toUpperCase();
        return (
          <span key={`${entry.unitId}-${idx}`} className={`qi ${isCurrent ? 'cur' : ''} ${isYours ? 'yours' : 'opp'}`} style={{ ['--el' as string]: `var(--el-${meta.element})` }} title={`${meta.name}`}>
            <span className="mono" aria-hidden="true">{mono}</span>
            <img src={`/assets/digimon/${meta.templateId}/dot.gif`} alt="" onError={(e) => e.currentTarget.setAttribute('data-failed', '')} />
          </span>
        );
      })}
    </>
  );
});