import { Link } from 'react-router';

import { Combat3DBody } from '../components/combat3d/Combat3DBody';
import { useCombatBattle } from '../hooks/useCombatBattle';
import { useWsStore } from '../state/wsStore';
import '../styles/extensions-combat3d.css';

export function Combat(): JSX.Element {
  const activeBattle = useWsStore((state) => state.activeBattle);
  const { loadError, startEncounter } = useCombatBattle(true);

  if (activeBattle === null) {
    return (
      <div className="win">
        <div className="titlebar" data-od-id="title-bar">
          <div className="lights"><i></i><i></i><i></i></div>
          <div className="app-mark">Digi<span className="bit">World</span></div>
          <div className="win-meta">Tamer Terminal · Battle</div>
        </div>
        <div className="stage" data-od-id="battle-stage" style={{ display: 'grid', placeItems: 'center', textAlign: 'center', padding: '60px 20px' }}>
          <div>
            <b style={{ display: 'block', marginBottom: '12px' }}>No active match — return to lobby to queue.</b>
            <span className="muted" style={{ display: 'block', marginBottom: '24px' }}>Queue in the lobby for PvP or start a wild PvE encounter.</span>
            {loadError !== null ? <span className="c3d-toast is-err" style={{ position: 'static' }}>{loadError}</span> : null}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <Link className="btn btn--secondary" to="/lobby">Back to lobby</Link>
              <button className="btn" type="button" onClick={startEncounter}>New Encounter</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="win">
      <div className="titlebar" data-od-id="title-bar">
        <div className="lights"><i></i><i></i><i></i></div>
        <div className="app-mark">Digi<span className="bit">World</span></div>
        <div className="win-meta">Tamer Terminal · Battle</div>
      </div>
      <Combat3DBody />
    </div>
  );
}
