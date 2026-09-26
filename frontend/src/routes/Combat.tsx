import { Link, useLocation } from 'react-router';

import { Combat3DBody } from '../components/combat3d/Combat3DBody';
import { useWsStore } from '../state/wsStore';
import '../styles/extensions-combat3d.css';

export function Combat(): JSX.Element {
  const activeBattle = useWsStore((state) => state.activeBattle);
  const location = useLocation();
  const returnTo = (location.state as { readonly returnTo?: string } | null)?.returnTo ?? '/';

  if (activeBattle === null) {
    return (
      <div className="win win--fill">
        <div className="titlebar" data-od-id="title-bar">
          <div className="lights"><i /><i /><i /></div>
          <div className="win-meta">Tamer Terminal · Battle</div>
        </div>
        <div className="stage" data-od-id="battle-stage" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div className="box" style={{ maxWidth: '400px', textAlign: 'center' }}>
            <b>No active match</b><br/>
            <span className="muted">Queue in the lobby for PvP.</span>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px' }}>
              <Link className="cbtn back" to={returnTo} style={{ textDecoration: 'none' }}>Back to lobby</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="win win--fill">
      <div className="titlebar" data-od-id="title-bar">
        <div className="lights"><i /><i /><i /></div>
        <div className="win-meta">Tamer Terminal · Battle</div>
      </div>
      <Combat3DBody />
    </div>
  );
}
