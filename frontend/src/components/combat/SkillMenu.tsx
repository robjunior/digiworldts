import type { EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import type { Element, Skill } from '@digiworld/shared/digimon';

type SkillMenuProps = {
  readonly unit: FriendlyUnitView;
  readonly target: EnemyUnitView | null;
  readonly onSkill: (skillId: string, targetId: UnitId) => void;
  readonly onBack: () => void;
};

export function SkillMenu({ unit, target, onSkill, onBack }: SkillMenuProps): JSX.Element {
  return (
    <>
      <div className="skill-menu" role="menu" data-od-id="skill-menu">
        {unit.skills.map((skill) => (
          <SkillRow key={skill.id} skill={skill} unit={unit} target={target} onSkill={onSkill} />
        ))}
      </div>
      <div className="row" style={{ gap: '8px' }}>
        <button className="btn btn--secondary btn--sm" type="button" onClick={onBack}>Back</button>
        <span className="target-hint">{target ? `Target: ${target.name}` : 'Select a target'}</span>
      </div>
    </>
  );
}

function SkillRow({ skill, unit, target, onSkill }: {
  readonly skill: Skill;
  readonly unit: FriendlyUnitView;
  readonly target: EnemyUnitView | null;
  readonly onSkill: (skillId: string, targetId: UnitId) => void;
}): JSX.Element {
  const disabled = target === null || skill.energyCost > unit.en;
  const affinityCue = target ? affinity(skill.element, target.element) : 'neutral';

  return (
    <button className="skill-row" type="button" role="menuitem" disabled={disabled} onClick={() => target && onSkill(skill.id, target.id)} data-od-id={`skill-${skill.id}`}>
      <span className="stack" style={{ gap: '2px' }}>
        <span className="s-name">
          {skill.name} <AffinityCue cue={affinityCue} />
        </span>
        <span className="s-desc">{skill.description ?? `${skill.element} attack · ${skill.power} power`}</span>
      </span>
      <span className="s-cost">{skill.energyCost} EN</span>
    </button>
  );
}

function AffinityCue({ cue }: { readonly cue: Affinity }): JSX.Element | null {
  switch (cue) {
    case 'weak':
      return <span className="cue cue--weak">Weak!</span>;
    case 'resist':
      return <span className="cue cue--resist">Resist</span>;
    case 'neutral':
      return null;
    default:
      cue satisfies never;
      return null;
  }
}

type Affinity = 'weak' | 'resist' | 'neutral';

function affinity(attacker: Element, defender: Element): Affinity {
  if ((attacker === 'fire' && defender === 'nature') || (attacker === 'nature' && defender === 'water') || (attacker === 'water' && defender === 'fire') || (attacker === 'electric' && defender === 'water')) {
    return 'weak';
  }
  if ((attacker === 'nature' && defender === 'fire') || (attacker === 'water' && defender === 'nature') || (attacker === 'fire' && defender === 'water') || (attacker === 'water' && defender === 'electric')) {
    return 'resist';
  }
  return 'neutral';
}
