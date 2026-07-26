import type { EnemyUnitView, FriendlyUnitView, UnitId } from '@digiworld/shared/battle';
import { useState } from 'react';
import { ItemsMenu } from './ItemsMenu';
import { SkillMenu } from './SkillMenu';

export type CommandMode = 'menu' | 'skills' | 'items' | 'target-fight' | 'target-skill';

type CommandPanelProps = {
  readonly mode: CommandMode;
  readonly actor: FriendlyUnitView | null;
  readonly target: EnemyUnitView | null;
  readonly friendly: readonly FriendlyUnitView[];
  readonly yourTurn: boolean;
  readonly pveMode: boolean;
  readonly onMode: (mode: CommandMode) => void;
  readonly onFight: (targetId: UnitId) => void;
  readonly onSkill: (skillId: string, targetId: UnitId) => void;
  readonly onGuard: () => void;
  readonly onAnalyze: (targetId: UnitId) => void;
  readonly onUseItem: (itemId: string, targetId: UnitId) => void;
  readonly onFlee: () => void;
};

const IC = {
  cursor: '<path d="M5 4l14 8-14 8z"/>',
};

export function CommandPanel(props: CommandPanelProps): JSX.Element {
  const { mode, actor, target, friendly, yourTurn, pveMode, onMode, onFight, onSkill, onGuard, onAnalyze, onUseItem, onFlee } = props;
  const [help, setHelp] = useState('Select an action.');

  if (!yourTurn) {
    return (
      <>
        <div className="chelp muted"><span className="htag">Wait</span><span>Waiting for {target?.name ?? 'opponent'}…</span></div>
        <div className="chead"><span className="sect">Enemy</span></div>
        <div className="rows">
          <div className="mrow disabled" style={{ cursor: 'default' }}>
            <span className="cur"></span><span className="mnm">{target?.name ?? 'Opponent'} is acting…</span>
          </div>
        </div>
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
    <>
      <div className="chelp"><span className="htag">Help</span><span>{help}</span></div>
      <PanelContent
        mode={mode}
        actor={actor}
        target={target}
        friendly={friendly}
        pveMode={pveMode}
        onMode={onMode}
        onFight={onFight}
        onSkill={onSkill}
        onGuard={onGuard}
        onAnalyze={onAnalyze}
        onUseItem={onUseItem}
        onFlee={onFlee}
        setHelp={setHelp}
      />
    </>
  );
}

function PanelContent(props: Omit<CommandPanelProps, 'yourTurn'> & { readonly actor: FriendlyUnitView; readonly setHelp: (h: string) => void }): JSX.Element {
  const { mode, actor, target, friendly, pveMode, onMode, onFight, onSkill, onGuard, onAnalyze, onUseItem, onFlee, setHelp } = props;
  switch (mode) {
    case 'menu':
      return (
        <MenuActions
          target={target}
          pveMode={pveMode}
          onMode={onMode}
          onFight={onFight}
          onGuard={onGuard}
          onAnalyze={() => target && onAnalyze(target.id)}
          onFlee={onFlee}
          setHelp={setHelp}
        />
      );
    case 'skills':
      return <SkillMenu unit={actor} target={target} onSkill={onSkill} onBack={() => onMode('menu')} setHelp={setHelp} />;
    case 'items':
      return <ItemsMenu actor={actor} friendly={friendly} onUseItem={onUseItem} onBack={() => onMode('menu')} setHelp={setHelp} />;
    case 'target-fight':
    case 'target-skill':
      // The target picker is in Combat3DBody.tsx (.enemy-rail). Command menu should just tell the user to pick.
      return (
        <>
          <div className="chead"><span className="sect">Target</span></div>
          <div className="rows">
            <button className="mrow back" type="button" onClick={() => onMode('menu')}>
              <span className="cur"><svg viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: IC.cursor }} /></span>
              <span className="mnm">‹ Back</span>
            </button>
            <div className="mrow disabled" style={{ cursor: 'default' }}>
              <span className="cur"></span><span className="mnm">Select an enemy from the list…</span>
            </div>
          </div>
        </>
      );
    default:
      return <></>;
  }
}

function MenuActions({ target, pveMode, onMode, onFight, onGuard, onAnalyze, onFlee, setHelp }: {
  readonly target: EnemyUnitView | null;
  readonly pveMode: boolean;
  readonly onMode: (mode: CommandMode) => void;
  readonly onFight: (targetId: UnitId) => void;
  readonly onGuard: () => void;
  readonly onAnalyze: () => void;
  readonly onFlee: () => void;
  readonly setHelp: (h: string) => void;
}): JSX.Element {
  const targetReady = target !== null;
  return (
    <>
      <div className="chead"><span className="sect">Command</span></div>
      <div className="rows">
        <button className="mrow" type="button" disabled={!targetReady} onClick={() => target && onFight(target.id)} onMouseEnter={() => setHelp('Attack one enemy with a basic strike.')}>
          <span className="cur"><svg viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: IC.cursor }} /></span>
          <span className="mnm">Fight</span><span></span><span></span>
        </button>
        <button className="mrow" type="button" onClick={() => onMode('skills')} onMouseEnter={() => setHelp('Unleash an EN-costing skill.')}>
          <span className="cur"><svg viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: IC.cursor }} /></span>
          <span className="mnm">Skills</span><span></span><span></span>
        </button>
        <button className="mrow" type="button" onClick={onGuard} onMouseEnter={() => setHelp('Brace — halve damage until your next turn.')}>
          <span className="cur"><svg viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: IC.cursor }} /></span>
          <span className="mnm">Guard</span><span></span><span></span>
        </button>
        <button className="mrow" type="button" disabled={!targetReady} onClick={onAnalyze} onMouseEnter={() => setHelp('Reveal an enemy’s elemental weakness.')}>
          <span className="cur"><svg viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: IC.cursor }} /></span>
          <span className="mnm">Analyse</span><span></span><span></span>
        </button>
        {pveMode ? (
          <button className="mrow" type="button" onClick={() => onMode('items')} onMouseEnter={() => setHelp('Use a battle item.')}>
            <span className="cur"><svg viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: IC.cursor }} /></span>
            <span className="mnm">Item</span><span></span><span></span>
          </button>
        ) : null}
        <button className="mrow" type="button" onClick={onFlee} onMouseEnter={() => setHelp('Attempt to escape the battle.')}>
          <span className="cur"><svg viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: IC.cursor }} /></span>
          <span className="mnm">Flee</span><span></span><span></span>
        </button>
      </div>
    </>
  );
}
