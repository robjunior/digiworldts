import { Link } from 'react-router';

import { AppNav } from '../components/AppNav';
import { CombatBody, useCombatBattle } from '../components/combat/CombatBody';
import { useWsStore } from '../state/wsStore';
import '../styles/extensions-combat.css';

export function Combat(): JSX.Element {
  const activeBattle = useWsStore((state) => state.activeBattle);
  const { loadError, startEncounter } = useCombatBattle(true);

  if (activeBattle === null) {
    return (
      <>
        <AppNav />
        <main className="app-main combat-screen">
          <div className="cbt-empty">
            <b>No active match — return to lobby to queue.</b>
            <span>Queue in the lobby for PvP or explore the world to trigger a wild PvE encounter.</span>
            {loadError !== null ? <span className="warn">{loadError}</span> : null}
            <div className="row">
              <Link className="btn btn--secondary" to="/lobby">Back to lobby</Link>
              <button className="btn" type="button" onClick={startEncounter}>New Encounter</button>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <main className="app-main combat-screen" data-od-id="combat-main">
        <CombatBody />
      </main>
    </>
  );
}
