import type { EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import { skillTargetScope } from '@digiworld/shared/battle';
import { useState } from 'react';

import { useLocale, useT } from '../../hooks/useLocale';
import { localizedDescription, localizedName } from '../../lib/locale';
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
  readonly onGuard: () => void;
  readonly onPendingSkill?: (skillId: string | null) => void;
  readonly onPendingItem?: (itemId: string | null) => void;
};

export function CommandPanel(props: CommandPanelProps): JSX.Element {
  const { mode, actor, target, aliveEnemies, friendly, yourTurn, pveMode, onMode, onFight, onSkill, onUseItem, onFlee, onGuard, onPendingSkill, onPendingItem } = props;
  const [pendingSkillId, setPendingSkillId] = useState<string | null>(null);

  if (!yourTurn) {
    return <DisabledCommandMenu onFlee={onFlee} />;
  }
  if (actor === null || actor.down) {
    return <DisabledCommandMenu onFlee={onFlee} />;
  }

  const panelProps: PanelContentProps = {
    mode,
    actor,
    target,
    aliveEnemies,
    friendly,
    pveMode,
    pendingSkillId,
    setPendingSkillId,
    onMode,
    onFight,
    onSkill,
    onUseItem,
    onFlee,
    onGuard,
    ...(onPendingSkill === undefined ? {} : { onPendingSkill }),
    ...(onPendingItem === undefined ? {} : { onPendingItem }),
  };
  return (
    <div className="command-shell">
      <MenuActions target={target} pveMode={pveMode} activeMode={mode} onMode={onMode} onFlee={onFlee} onGuard={onGuard} />
      {mode !== 'menu' ? <div className="command-overlay"><PanelContent {...panelProps} /></div> : null}
    </div>
  );
}

type PanelContentProps = Omit<CommandPanelProps, 'yourTurn'> & {
  readonly actor: FriendlyUnitView;
  readonly pendingSkillId: string | null;
  readonly setPendingSkillId: (id: string | null) => void;
  readonly onPendingSkill?: (skillId: string | null) => void;
  readonly onPendingItem?: (itemId: string | null) => void;
  readonly onGuard: () => void;
};

function PanelContent(props: PanelContentProps): JSX.Element {
  const { mode, actor, target, aliveEnemies, friendly, pveMode, pendingSkillId, setPendingSkillId, onMode, onFight, onSkill, onUseItem, onFlee, onGuard, onPendingSkill, onPendingItem } = props;
  const t = useT();
  const locale = useLocale();

  switch (mode) {
    case 'menu':
      return (
        <MenuActions
          target={target}
          pveMode={pveMode}
          activeMode={mode}
          onMode={onMode}
          onFlee={onFlee}
          onGuard={onGuard}
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
            onPendingSkill?.(skillId);
            onMode('target-skill');
          }}
          onBack={() => onMode('menu')}
        />
      );
    case 'items':
      return <ItemsMenu actor={actor} friendly={friendly} onUseItem={onUseItem} onBack={() => onMode('menu')} {...(onPendingItem === undefined ? {} : { onPendingItem })} />;
    case 'target-fight':
      return <TargetingHint title={t('combat.fight')} hint="Click an enemy in the arena to attack." details="Physical attack · 1 enemy target" onBack={() => onMode('menu')} />;
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
      const combo = Array.isArray(skill.actions) && skill.actions.length > 1 ? `Combo · ${skill.actions.length} effects` : 'Single action';
      const details = `${skill.element.toUpperCase()} · ${skill.power} power · ${skill.energyCost} EN · ${combo}`;
      const hint = skillTargetScope(skill) === 'any'
        ? 'Click an enemy or one of your friendly digimon in the arena to use this skill.'
        : 'Click an enemy in the arena to use this skill.';
      return <TargetingHint title={localizedName(skill, locale)} hint={hint} details={details} description={localizedDescription(skill, locale)} onBack={() => {
        setPendingSkillId(null);
        onPendingSkill?.(null);
        onMode('skills');
      }} />;
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

function DisabledCommandMenu({ onFlee }: { readonly onFlee: () => void }): JSX.Element {
  return (
    <div className="command-menu command-menu--disabled" aria-label="Commands unavailable while waiting for your turn">
      <div className="command-menu__title">Command</div>
      <div className="command-menu__grid">
        <button className="command-menu__item disabled" type="button" disabled><CommandIcon kind="attack" /><span>Attack</span><small>Waiting</small></button>
        <button className="command-menu__item disabled" type="button" disabled><CommandIcon kind="skill" /><span>Skill</span><small>Waiting</small></button>
        <button className="command-menu__item disabled" type="button" disabled><CommandIcon kind="guard" /><span>Guard</span><small>Waiting</small></button>
      </div>
      <button className="command-menu__flee" type="button" onClick={onFlee}>↩ Flee battle</button>
    </div>
  );
}

function MenuActions({ target, pveMode, activeMode, onMode, onFlee, onGuard }: {
  readonly target: EnemyUnitView | null;
  readonly pveMode: boolean;
  readonly activeMode: CommandMode;
  readonly onMode: (mode: CommandMode) => void;
  readonly onFlee: () => void;
  readonly onGuard: () => void;
}): JSX.Element {
  const t = useT();
  const targetReady = target !== null;
  return (
    <div className="command-menu">
      <div className="command-menu__title">Command</div>
      <div className="command-menu__grid">
        <button className={`command-menu__item ${activeMode === 'target-fight' ? 'selected' : ''} ${!targetReady ? 'disabled' : ''}`} type="button" disabled={!targetReady} onClick={() => onMode('target-fight')}>
          <CommandIcon kind="attack" /><span>{t('combat.fight')}</span><small>Attack</small>
        </button>
        <button className={`command-menu__item ${activeMode === 'skills' || activeMode === 'target-skill' ? 'selected' : ''}`} type="button" onClick={() => onMode('skills')}>
          <CommandIcon kind="skill" /><span>{t('combat.skills')}</span><small>Techniques</small>
        </button>
        {pveMode ? (
          <button className={`command-menu__item ${activeMode === 'items' ? 'selected' : ''}`} type="button" onClick={() => onMode('items')}>
            <CommandIcon kind="item" /><span>{t('combat.item')}</span><small>Recovery</small>
          </button>
        ) : null}
        <button className="command-menu__item" type="button" onClick={onGuard}>
          <CommandIcon kind="guard" /><span>Guard</span><small>Reduce damage</small>
        </button>
      </div>
      <button className="command-menu__flee" type="button" onClick={onFlee}>↩ Flee battle</button>
    </div>
  );
}

function CommandIcon({ kind }: { readonly kind: 'attack' | 'skill' | 'item' | 'guard' }): JSX.Element {
  if (kind === 'attack') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 3.5l6 6-3 3-2-2-5.5 5.5-2.5-2.5L13 8l-2-2 3.5-2.5z" /><path d="M4 20l4-4" /></svg>;
  if (kind === 'skill') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" /></svg>;
  if (kind === 'item') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h10l1 3v11H6V8l1-3z" /><path d="M6 9h12M9 5v4M15 5v4M12 12v5M9.5 14.5h5" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 7.8-7 10-4-2.2-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg>;
}

function TargetingHint({ title, hint, details, description, onBack }: { readonly title: string; readonly hint: string; readonly details?: string; readonly description?: string | null; readonly onBack: () => void }): JSX.Element {
  return (
    <div className="targeting-hint-panel">
      <div className="chead"><span className="sect">{title}</span><span className="cnt">Target</span></div>
      {details ? <div className="targeting-details">{details}</div> : null}
      {description ? <div className="targeting-description">{description}</div> : null}
      <div className="targeting-hint"><span className="targeting-hint__cursor">⌖</span><span>{hint}</span><button type="button" onClick={onBack}>Cancel</button></div>
    </div>
  );
}
