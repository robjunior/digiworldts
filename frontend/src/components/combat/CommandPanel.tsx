import type { EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';

import { useT } from '../../hooks/useLocale';
import { ItemsMenu } from './ItemsMenu';
import { SkillMenu } from './SkillMenu';

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
      onMode={onMode}
      onFight={onFight}
      onSkill={onSkill}
      onUseItem={onUseItem}
      onFlee={onFlee}
    />
  );
}

function PanelContent(props: Omit<CommandPanelProps, 'yourTurn'> & { readonly actor: FriendlyUnitView }): JSX.Element {
  const { mode, actor, target, aliveEnemies, friendly, pveMode, onMode, onFight, onSkill, onUseItem, onFlee } = props;
  switch (mode) {
    case 'menu':
      return (
        <MenuActions
          target={target}
          pveMode={pveMode}
          onMode={onMode}
          onFight={onFight}
          onFlee={onFlee}
        />
      );
    case 'skills':
      return <SkillMenu unit={actor} target={target} aliveEnemies={aliveEnemies} onSkill={onSkill} onBack={() => onMode('menu')} />;
    case 'items':
      return <ItemsMenu actor={actor} friendly={friendly} onUseItem={onUseItem} onBack={() => onMode('menu')} />;
    case 'target-fight':
      return (
        <MenuActions
          target={target}
          pveMode={pveMode}
          onMode={onMode}
          onFight={onFight}
          onFlee={onFlee}
        />
      );
    case 'target-skill':
      return <SkillMenu unit={actor} target={target} aliveEnemies={aliveEnemies} onSkill={onSkill} onBack={() => onMode('menu')} />;
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

function MenuActions({ target, pveMode, onMode, onFight, onFlee }: {
  readonly target: EnemyUnitView | null;
  readonly pveMode: boolean;
  readonly onMode: (mode: CommandMode) => void;
  readonly onFight: (targetId: UnitId) => void;
  readonly onFlee: () => void;
}): JSX.Element {
  const t = useT();
  const targetReady = target !== null;
  return (
    <>
      <div className="chelp"><span className="htag">Help</span><span>{t('combat.select_action')}</span></div>
      <div className="chead"><span className="sect">Command</span></div>
      <div className="rows">
        <button className={`mrow ${!targetReady ? 'disabled' : ''}`} type="button" disabled={!targetReady} onClick={() => target && onFight(target.id)}>
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
