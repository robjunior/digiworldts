import type { EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import type { Element, Skill } from '@digiworld/shared/digimon';

const IC = {
  cursor: '<path d="M5 4l14 8-14 8z"/>',
};

type SkillMenuProps = {
  readonly unit: FriendlyUnitView;
  readonly target: EnemyUnitView | null;
  readonly onSkill: (skillId: string, targetId: UnitId) => void;
  readonly onBack: () => void;
  readonly setHelp: (h: string) => void;
};

export function SkillMenu({ unit, target, onSkill, onBack, setHelp }: SkillMenuProps): JSX.Element {
  return (
    <>
      <div className="chead"><span className="sect">Skills</span><span className="cnt">{unit.skills.length}</span></div>
      <div className="rows">
        <button className="mrow back" type="button" onClick={onBack} onMouseEnter={() => setHelp('Return to the command menu.')}>
          <span className="cur"><svg viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: IC.cursor }} /></span>
          <span className="mnm">‹ Back</span>
        </button>
        {unit.skills.map((skill) => (
          <SkillRow key={skill.id} skill={skill} unit={unit} target={target} onSkill={onSkill} setHelp={setHelp} />
        ))}
      </div>
    </>
  );
}

function SkillRow({ skill, unit, target, onSkill, setHelp }: {
  readonly skill: Skill;
  readonly unit: FriendlyUnitView;
  readonly target: EnemyUnitView | null;
  readonly onSkill: (skillId: string, targetId: UnitId) => void;
  readonly setHelp: (h: string) => void;
}): JSX.Element {
  const disabled = target === null || skill.energyCost > unit.en;
  const helpText = disabled && skill.energyCost > unit.en ? `Not enough EN (needs ${skill.energyCost}). ${skill.description ?? ''}` : (skill.description ?? 'Skill attack.');

  return (
    <button
      className={`mrow ${disabled ? 'disabled' : ''}`}
      type="button"
      disabled={disabled}
      onClick={() => target && onSkill(skill.id, target.id)}
      onMouseEnter={() => setHelp(helpText)}
      style={{ '--el': `var(--el-${skill.element})` } as React.CSSProperties}
    >
      <span className="cur"><svg viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: IC.cursor }} /></span>
      <span className="mnm">{skill.name}</span>
      <span className="mtag">{skill.element}</span>
      <span className={`men ${disabled ? 'short' : ''}`}>{skill.energyCost} EN</span>
    </button>
  );
}
