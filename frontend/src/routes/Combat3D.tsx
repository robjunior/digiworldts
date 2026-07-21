import { Link } from 'react-router';

import { AppNav } from '../components/AppNav';
import { Combat3DBody } from '../components/combat3d/Combat3DBody';
import { useCombatBattle } from '../components/combat/CombatBody';
import { useWsStore } from '../state/wsStore';
import '../styles/extensions-combat3d.css';

export function Combat3D(): JSX.Element {
  const activeBattle = useWsStore((state) => state.activeBattle);
  const { loadError, startEncounter } = useCombatBattle(true);

  if (activeBattle === null) {
    return (
      <div className="app-shell combat3d-shell">
        <AppNav />
        <main className="app-main combat3d-main">
          <div className="c3d-empty">
            <b>No active match — return to lobby to queue.</b>
            <span className="muted">Queue in the lobby for PvP or start a wild PvE encounter.</span>
            {loadError !== null ? <span className="c3d-toast is-err" style={{ position: 'static' }}>{loadError}</span> : null}
            <div className="row">
              <Link className="btn btn--secondary" to="/lobby">Back to lobby</Link>
              <button className="btn" type="button" onClick={startEncounter}>New Encounter</button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell combat3d-shell">
      <AppNav />
      <main className="app-main combat3d-main" data-od-id="combat3d-main">
        <Combat3DBody />
      </main>
    </div>
  );
}
