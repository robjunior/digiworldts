import { memo } from 'react';
import type { FriendlyUnitView } from '@digiworld/shared/battle';

export const PartyCard = memo(function PartyCard({ unit, active }: { readonly unit: FriendlyUnitView; readonly active: boolean }): JSX.Element {
  const hpPct = unit.hpMax > 0 ? Math.max(0, unit.hp) / unit.hpMax : 0;
  const enPct = unit.enMax > 0 ? Math.max(0, unit.en) / unit.enMax : 0;
  const mono = (unit.name || '?').trim().charAt(0).toUpperCase();
  return (
    <div className={`pcard ${active ? 'active' : ''} ${unit.down || unit.hp <= 0 ? 'dead' : ''}`} style={{ ['--el' as string]: `var(--el-${unit.element})` }}>
      <div className="ph">
        <span className="spr-slot pspr" style={{ ['--el' as string]: `var(--el-${unit.element})` }}>
          <span className="mono" aria-hidden="true">{mono}</span>
          <img src={`/assets/digimon/${unit.templateId}/dot.gif`} alt="" onError={(e) => e.currentTarget.setAttribute('data-failed', '')} />
        </span>
        <span className="pn">
          <span className="nm">{unit.name}</span>
          <span className="lv">Lv {unit.level}</span>
        </span>
        {unit.guarding ? <span className="guard-ic" title="Guarding">Guard</span> : null}
      </div>
      <div className="stat">
        <span className="sk">HP</span>
        <span className="bar hp" role="progressbar" aria-label={`${unit.name} HP`} aria-valuemin={0} aria-valuemax={unit.hpMax} aria-valuenow={Math.max(0, unit.hp)}>
          <i style={{ width: `${hpPct * 100}%` }} />
        </span>
        <span className="sn">{Math.max(0, unit.hp)} / {unit.hpMax}</span>
      </div>
      <div className="stat">
        <span className="sk">EN</span>
        <span className="bar en">
          <i style={{ width: `${enPct * 100}%` }} />
        </span>
        <span className="sn en-n">{Math.max(0, unit.en)}/{unit.enMax}</span>
      </div>
    </div>
  );
});