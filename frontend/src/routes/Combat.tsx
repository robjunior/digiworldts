import { Link } from 'react-router';

import { Combat3DBody } from '../components/combat3d/Combat3DBody';
import { useCombatBattle } from '../hooks/useCombatBattle';
import { useDungeonReturn } from '../hooks/useDungeonReturn';
import { useWsStore } from '../state/wsStore';
import '../styles/extensions-combat3d.css';

export function Combat(): JSX.Element {
  const activeBattle = useWsStore((state) => state.activeBattle);
  const { loadError, startEncounter } = useCombatBattle(true);
  useDungeonReturn();

  if (activeBattle === null) {
    return (
      <div className="win">
        <div className="titlebar" data-od-id="title-bar">
          <div className="lights"><i /><i /><i /></div>
          <div className="app-mark">Digi<span className="bit">World</span></div>
          <div className="win-meta">Tamer Terminal · Battle</div>
        </div>
        <div className="stage" data-od-id="battle-stage" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div className="box" style={{ maxWidth: '400px', textAlign: 'center' }}>
            <b>No active match</b><br/>
            <span className="muted">Queue in the lobby for PvP or start a wild PvE encounter.</span>
            {loadError !== null ? <div className="muted" style={{ color: 'var(--signal)', marginTop: '8px' }}>{loadError}</div> : null}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px' }}>
              <Link className="cbtn back" to="/lobby" style={{ textDecoration: 'none' }}>Back to lobby</Link>
              <button className="cbtn primary" type="button" onClick={startEncounter}>New Encounter</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="win">
      <div className="titlebar" data-od-id="title-bar">
        <div className="lights"><i /><i /><i /></div>
        <div className="app-mark">Digi<span className="bit">World</span></div>
        <div className="win-meta">Tamer Terminal · Battle</div>
      </div>
      <Combat3DBody />
    </div>
  );
}
