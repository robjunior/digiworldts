import type { EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import { useState } from 'react';

type SkillMenuProps = {
  readonly unit: FriendlyUnitView;
  readonly target: EnemyUnitView | null;
  readonly onSkill: (skillId: string, targetId: UnitId) => void;
  readonly onBack: () => void;
};

export function SkillMenu({ unit, target, onSkill, onBack }: SkillMenuProps): JSX.Element {
  const [hoveredDesc, setHoveredDesc] = useState<string | null>(null);

  return (
    <>
      <div className="chelp"><span className="htag">Info</span><span>{hoveredDesc ?? 'Select a skill.'}</span></div>
      <div className="chead"><span className="sect">Skills</span><span className="cnt">{unit.en} / {unit.enMax} EN</span></div>
      <div className="rows">
        <button className="mrow back" type="button" onClick={onBack}>
          <div className="cur"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z"/></svg></div>
          <div className="mnm">← Back</div>
        </button>
        {unit.skills.map((skill) => {
          const canAfford = skill.energyCost <= unit.en;
          const disabled = !canAfford || target === null;
          return (
            <button
              key={skill.id}
              className={`mrow ${disabled ? 'disabled' : ''}`}
              type="button"
              disabled={disabled}
              onMouseEnter={() => setHoveredDesc(skill.description ?? null)}
              onMouseLeave={() => setHoveredDesc(null)}
              onClick={() => target && onSkill(skill.id, target.id)}
            >
              <div className="cur"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z"/></svg></div>
              <div className="mnm">{skill.name}</div>
              <div className="mtag" style={{ ['--el' as string]: `var(--el-${skill.element})` }}>{skill.element}</div>
              <div className={`men ${canAfford ? '' : 'short'}`}>{skill.energyCost} EN</div>
            </button>
          );
        })}
      </div>
    </>
  );
}
