import type { EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';

import { SkillMenu } from './SkillMenu';

export type CommandMode = 'menu' | 'skills' | 'target-fight' | 'target-skill';

type CommandPanelProps = {
  readonly mode: CommandMode;
  readonly actor: FriendlyUnitView | null;
  readonly target: EnemyUnitView | null;
  readonly yourTurn: boolean;
  readonly onMode: (mode: CommandMode) => void;
  readonly onFight: (targetId: UnitId) => void;
  readonly onSkill: (skillId: string, targetId: UnitId) => void;
  readonly onGuard: () => void;
  readonly onAnalyze: (targetId: UnitId) => void;
  readonly onFlee: () => void;
};

export function CommandPanel(props: CommandPanelProps): JSX.Element {
  const { mode, actor, target, yourTurn, onMode, onFight, onSkill, onGuard, onAnalyze, onFlee } = props;

  if (!yourTurn) {
    return <div className="command-panel" aria-live="polite"><div className="await-banner">Waiting for <b>{target?.name ?? 'opponent'}</b>…</div></div>;
  }
  if (actor === null || actor.down) {
    return <div className="command-panel" aria-live="polite"><div className="await-banner">No unit ready.</div></div>;
  }

  return (
    <div className="command-panel" aria-live="polite" data-od-id="command-panel">
      <PanelContent
        mode={mode}
        actor={actor}
        target={target}
        onMode={onMode}
        onFight={onFight}
        onSkill={onSkill}
        onGuard={onGuard}
        onAnalyze={onAnalyze}
        onFlee={onFlee}
      />
    </div>
  );
}

function PanelContent(props: Omit<CommandPanelProps, 'yourTurn'> & { readonly actor: FriendlyUnitView }): JSX.Element {
  const { mode, actor, target, onMode, onFight, onSkill, onGuard, onAnalyze, onFlee } = props;
  switch (mode) {
    case 'menu':
      return (
        <MenuActions
          target={target}
          onMode={onMode}
          onFight={onFight}
          onGuard={onGuard}
          onAnalyze={() => target && onAnalyze(target.id)}
          onFlee={onFlee}
        />
      );
    case 'skills':
      return <SkillMenu unit={actor} target={target} onSkill={onSkill} onBack={() => onMode('menu')} />;
    case 'target-fight':
      return (
        <MenuActions
          target={target}
          onMode={onMode}
          onFight={onFight}
          onGuard={onGuard}
          onAnalyze={() => target && onAnalyze(target.id)}
          onFlee={onFlee}
        />
      );
    case 'target-skill':
      return <SkillMenu unit={actor} target={target} onSkill={onSkill} onBack={() => onMode('menu')} />;
    default:
      mode satisfies never;
      return <div className="await-banner">Unknown command.</div>;
  }
}

function MenuActions({ target, onMode, onFight, onGuard, onAnalyze, onFlee }: {
  readonly target: EnemyUnitView | null;
  readonly onMode: (mode: CommandMode) => void;
  readonly onFight: (targetId: UnitId) => void;
  readonly onGuard: () => void;
  readonly onAnalyze: () => void;
  readonly onFlee: () => void;
}): JSX.Element {
  const targetReady = target !== null;
  return (
    <div className="cbt-actions" role="group" aria-label="Choose an action">
      <button className="cbt-cmd" type="button" disabled={!targetReady} onClick={() => target && onFight(target.id)} data-od-id="cmd-fight" title={target ? `Attack ${target.name}` : 'No target'}>Fight</button>
      <button className="cbt-cmd cbt-cmd--guard" type="button" onClick={() => onMode('skills')} data-od-id="cmd-skills" style={{ background: 'var(--signal)', color: 'var(--bg)' }}>Skills</button>
      <button className="cbt-cmd cbt-cmd--guard" type="button" onClick={onGuard} data-od-id="cmd-guard">Guard</button>
      <button className="cbt-cmd cbt-cmd--analyse" type="button" disabled={!targetReady} onClick={onAnalyze} data-od-id="cmd-analyse">Analyse</button>
      <button className="cbt-cmd cbt-cmd--flee" type="button" onClick={onFlee} data-od-id="cmd-flee">Flee</button>
    </div>
  );
}

function ConfirmAction({ label, target, onCancel, onConfirm }: {
  readonly label: string;
  readonly target: EnemyUnitView | null;
  readonly onCancel: () => void;
  readonly onConfirm: (targetId: UnitId) => void;
}): JSX.Element {
  return (
    <>
      <div className="await-banner"><b>{label}</b> on <b>{target?.name ?? '—'}</b>. Click another enemy to switch target.</div>
      <div className="row" style={{ gap: '8px' }}>
        <button className="btn btn--secondary btn--sm" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn btn--sm" type="button" disabled={target === null} onClick={() => target && onConfirm(target.id)}>Confirm</button>
      </div>
    </>
  );
}
