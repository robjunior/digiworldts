import type { Element } from '@digiworld/shared/digimon';
import type { EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import { useState } from 'react';

import { useLocale, useT } from '../../hooks/useLocale';
import { localizedName } from '../../lib/locale';
import { ItemsMenu } from './ItemsMenu';
import { AffinityCue, SkillMenu, affinity } from './SkillMenu';

export type CommandMode = 'menu' | 'skills' | 'items' | 'target-fight' | 'target-skill';

type CommandPanelProps = {
  readonly mode: CommandMode;
  readonly actor: FriendlyUnitView | null;
  readonly target: EnemyUnitView | null;
  readonly aliveEnemies: readonly EnemyUnitView[];
  readonly friendly: readonly FriendlyUnitView[];
  readonly yourTurn: boolean;
  readonly pveMode: boolean;
  readonly onMode: (mode: CommandMode) => void;
  readonly onFight: (targetId: UnitId) => void;
  readonly onSkill: (skillId: string, targetId: UnitId, extraTargetIds?: readonly UnitId[]) => void;
  readonly onUseItem: (itemId: string, targetId: UnitId) => void;
  readonly onFlee: () => void;
};

export function CommandPanel(props: CommandPanelProps): JSX.Element {
  const { mode, actor, target, aliveEnemies, friendly, yourTurn, pveMode, onMode, onFight, onSkill, onUseItem, onFlee } = props;
  const [pendingSkillId, setPendingSkillId] = useState<string | null>(null);

  if (!yourTurn) {
    return (
      <>
        <div className="chelp muted"><span className="htag">Wait</span><span>Waiting for {target?.name ?? 'opponent'}…</span></div>
        <div className="chead"><span className="sect">Wait</span></div>
        <div className="rows"></div>
      </>
    );
  }
  if (actor === null || actor.down) {
    return (
      <>
        <div className="chelp muted"><span className="htag">Wait</span><span>No unit ready.</span></div>
        <div className="chead"><span className="sect">Wait</span></div>
        <div className="rows"></div>
      </>
    );
  }

  return (
    <PanelContent
      mode={mode}
      actor={actor}
      target={target}
      aliveEnemies={aliveEnemies}
      friendly={friendly}
      pveMode={pveMode}
      pendingSkillId={pendingSkillId}
      setPendingSkillId={setPendingSkillId}
      onMode={onMode}
      onFight={onFight}
      onSkill={onSkill}
      onUseItem={onUseItem}
      onFlee={onFlee}
    />
  );
}

type PanelContentProps = Omit<CommandPanelProps, 'yourTurn'> & {
  readonly actor: FriendlyUnitView;
  readonly pendingSkillId: string | null;
  readonly setPendingSkillId: (id: string | null) => void;
};

function PanelContent(props: PanelContentProps): JSX.Element {
  const { mode, actor, target, aliveEnemies, friendly, pveMode, pendingSkillId, setPendingSkillId, onMode, onFight, onSkill, onUseItem, onFlee } = props;
  const t = useT();
  const locale = useLocale();

  switch (mode) {
    case 'menu':
      return (
        <MenuActions
          target={target}
          pveMode={pveMode}
          onMode={onMode}
          onFlee={onFlee}
        />
      );
    case 'skills':
      return (
        <SkillMenu
          unit={actor}
          target={target}
          aliveEnemies={aliveEnemies}
          onSkill={onSkill}
          onPickSkill={(skillId) => {
            setPendingSkillId(skillId);
            onMode('target-skill');
          }}
          onBack={() => onMode('menu')}
        />
      );
    case 'items':
      return <ItemsMenu actor={actor} friendly={friendly} onUseItem={onUseItem} onBack={() => onMode('menu')} />;
    case 'target-fight':
      return (
        <TargetPick
          title={t('combat.fight')}
          hint="Choose an enemy to attack."
          enemies={aliveEnemies}
          onPick={onFight}
          onBack={() => onMode('menu')}
        />
      );
    case 'target-skill': {
      const skill = pendingSkillId !== null ? actor.skills.find((s) => s.id === pendingSkillId) : undefined;
      if (skill === undefined) {
        return (
          <SkillMenu
            unit={actor}
            target={target}
            aliveEnemies={aliveEnemies}
            onSkill={onSkill}
            onPickSkill={(skillId) => {
              setPendingSkillId(skillId);
              onMode('target-skill');
            }}
            onBack={() => onMode('menu')}
          />
        );
      }
      return (
        <TargetPick
          title={localizedName(skill, locale)}
          hint="Choose an enemy to strike."
          enemies={aliveEnemies}
          affinityElement={skill.element}
          onPick={(targetId) => onSkill(skill.id, targetId)}
          onBack={() => {
            setPendingSkillId(null);
            onMode('skills');
          }}
        />
      );
    }
    default:
      mode satisfies never;
      return (
        <>
          <div className="chelp muted"><span className="htag">Error</span><span>Unknown command.</span></div>
          <div className="chead"><span className="sect">Error</span></div>
          <div className="rows"></div>
        </>
      );
  }
}

function MenuActions({ target, pveMode, onMode, onFlee }: {
  readonly target: EnemyUnitView | null;
  readonly pveMode: boolean;
  readonly onMode: (mode: CommandMode) => void;
  readonly onFlee: () => void;
}): JSX.Element {
  const t = useT();
  const targetReady = target !== null;
  return (
    <>
      <div className="chelp"><span className="htag">Help</span><span>{t('combat.select_action')}</span></div>
      <div className="chead"><span className="sect">Command</span></div>
      <div className="rows">
        <button className={`mrow ${!targetReady ? 'disabled' : ''}`} type="button" disabled={!targetReady} onClick={() => onMode('target-fight')}>
          <div className="cur"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z"/></svg></div>
          <div className="mnm">{t('combat.fight')}</div>
        </button>
        <button className="mrow" type="button" onClick={() => onMode('skills')}>
          <div className="cur"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z"/></svg></div>
          <div className="mnm">{t('combat.skills')}</div>
        </button>
        {pveMode ? (
          <button className="mrow" type="button" onClick={() => onMode('items')}>
            <div className="cur"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z"/></svg></div>
            <div className="mnm">{t('combat.item')}</div>
          </button>
        ) : null}
        <button className="mrow" type="button" onClick={onFlee}>
          <div className="cur"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z"/></svg></div>
          <div className="mnm">{t('combat.flee')}</div>
        </button>
      </div>
    </>
  );
}

function TargetPick({ title, hint, enemies, affinityElement, onPick, onBack }: {
  readonly title: string;
  readonly hint: string;
  readonly enemies: readonly EnemyUnitView[];
  readonly affinityElement?: Element;
  readonly onPick: (targetId: UnitId) => void;
  readonly onBack: () => void;
}): JSX.Element {
  return (
    <>
      <div className="chelp"><span className="htag">Target</span><span>{hint}</span></div>
      <div className="chead"><span className="sect">{title}</span><span className="cnt">{enemies.length} foe{enemies.length === 1 ? '' : 's'}</span></div>
      <div className="rows">
        {enemies.length === 0 ? (
          <div className="mrow disabled"><div className="mnm">No targets left.</div></div>
        ) : enemies.map((enemy) => {
          const cue = affinityElement ? affinity(affinityElement, enemy) : 'none';
          return (
            <button
              key={enemy.id}
              className="mrow"
              type="button"
              onClick={() => onPick(enemy.id)}
            >
              <div className="cur"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z"/></svg></div>
              <div className="mtxt">
                <div className="mnm">{enemy.name}<AffinityCue cue={cue} /></div>
                <div className="mdesc">Lv {enemy.level} · {enemy.hp}/{enemy.hpMax} HP</div>
              </div>
              <div className="mtag" style={{ ['--el' as string]: `var(--el-${enemy.element})` }}>{enemy.element}</div>
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