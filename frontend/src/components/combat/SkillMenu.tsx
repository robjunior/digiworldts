import type { EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import type { Element } from '@digiworld/shared/digimon';
import { useState } from 'react';

import { useLocale } from '../../hooks/useLocale';
import { localizedDescription, localizedName } from '../../lib/locale';

type SkillMenuProps = {
  readonly unit: FriendlyUnitView;
  readonly target: EnemyUnitView | null;
  readonly onSkill: (skillId: string, targetId: UnitId) => void;
  readonly onBack: () => void;
};

export function SkillMenu({ unit, target, onSkill, onBack }: SkillMenuProps): JSX.Element {
  const [hoveredDesc, setHoveredDesc] = useState<string | null>(null);
  const locale = useLocale();

  return (
    <>
      <div className="chelp"><span className="htag">Info</span><span>{hoveredDesc ?? 'Select a skill.'}</span></div>
      <div className="chead"><span className="sect">Skills</span><span className="cnt">{unit.en} / {unit.enMax} EN</span></div>
      <div className="rows">
        {unit.skills.map((skill) => {
          const canAfford = skill.energyCost <= unit.en;
          const disabled = !canAfford || target === null;
          const name = localizedName(skill, locale);
          const description = localizedDescription(skill, locale) ?? `${skill.element} attack · ${skill.power} power`;
          const affinityCue = target ? affinity(skill.element, target) : 'none';
          return (
            <button
              key={skill.id}
              className={`mrow ${disabled ? 'disabled' : ''}`}
              type="button"
              disabled={disabled}
              onMouseEnter={() => setHoveredDesc(description)}
              onMouseLeave={() => setHoveredDesc(null)}
              onClick={() => target && onSkill(skill.id, target.id)}
            >
              <div className="cur"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z"/></svg></div>
              <div className="mtxt">
                <div className="mnm">{name}<AffinityCue cue={affinityCue} /></div>
                <div className="mdesc">{description}</div>
              </div>
              <div className="mtag" style={{ ['--el' as string]: `var(--el-${skill.element})` }}>{skill.element}</div>
              <div className={`men ${canAfford ? '' : 'short'}`}>{skill.energyCost} EN</div>
            </button>
          );
        })}
        <button className="mrow back" type="button" onClick={onBack}>
          <div className="cur"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z"/></svg></div>
          <div className="mnm">← Back</div>
        </button>
      </div>
    </>
  );
}

function AffinityCue({ cue }: { readonly cue: Affinity }): JSX.Element | null {
  switch (cue) {
    case 'weak':
      return <span className="cue cue--weak">Weak!</span>;
    case 'resist':
      return <span className="cue cue--resist">Resist</span>;
    case 'none':
      return null;
    default:
      cue satisfies never;
      return null;
  }
}

type Affinity = 'weak' | 'resist' | 'none';

const WEAK_AFFINITY = {
  fire: 'plant',
  water: 'fire',
  plant: 'water',
  ice: 'wind',
  electricity: 'water',
  earth: 'electricity',
  steel: 'ice',
  wind: 'earth',
  light: 'dark',
  dark: 'light',
  null: null,
} as const satisfies Record<Element, Element | null>;

const RESIST_AFFINITY = {
  fire: 'water',
  water: 'electricity',
  plant: 'fire',
  ice: 'fire',
  electricity: 'earth',
  earth: 'plant',
  steel: 'electricity',
  wind: 'ice',
  light: null,
  dark: null,
  null: null,
} as const satisfies Record<Element, Element | null>;

function affinity(attackerElement: Element, defender: EnemyUnitView): Affinity {
  const resist = defender.resistances?.[attackerElement];
  if (resist !== undefined) {
    if (resist >= 1.5) return 'weak';
    if (resist > 0 && resist <= 0.5) return 'resist';
    if (resist === 0) return 'resist';
    return 'none';
  }
  if (WEAK_AFFINITY[attackerElement] === defender.element) {
    return 'weak';
  }
  if (RESIST_AFFINITY[attackerElement] === defender.element) {
    return 'resist';
  }
  return 'none';
}
