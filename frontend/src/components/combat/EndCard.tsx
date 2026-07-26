import type { BattleOutcome, BattleView } from '@digiworld/shared/battle';
import type { ItemDrop, XpAward } from '../../lib/api-world';
import { Link } from 'react-router';

type EndCardProps = {
  readonly battle: BattleView;
  readonly pveResults: { readonly xpAwards: readonly XpAward[]; readonly itemDrops?: readonly ItemDrop[]; readonly creditsGained?: number; readonly bitsGained?: number } | null;
  readonly onClose: () => void;
};

export function EndCard({ battle, pveResults, onClose }: EndCardProps): JSX.Element {
  const outcome = battle.outcome ?? 'abandoned';
  const isWin = outcome === 'win_a' || outcome === 'win_b' || outcome === 'captured_a'; // simplistic
  const isFlee = outcome === 'fled_a' || outcome === 'fled_b';

  return (
    <div className="scrim show" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <div className={`endcard ${isWin ? 'win' : 'loss'}`}>
        <div className="eyebrow">Battle Report</div>
        <h2 id="end-title">{isWin ? 'Victory' : isFlee ? 'Escaped' : 'Defeat'}</h2>
        <div className="esub">
          {battle.mode === 'pvp' ? (
            <span>PvP Match completed. Rating adjusted.</span>
          ) : (
            <span>Wild encounter completed.</span>
          )}
        </div>
        <div className="estats">
          <div className="m"><div className="k">Turns</div><div className="v">{battle.round}</div></div>
          {pveResults?.bitsGained ? <div className="m"><div className="k">Bits</div><div className="v">{pveResults.bitsGained}</div></div> : null}
          {pveResults?.xpAwards && pveResults.xpAwards.length > 0 ? (
            <div className="m"><div className="k">Exp</div><div className="v">+{pveResults.xpAwards[0]?.delta ?? 0}</div></div>
          ) : null}
        </div>
        <div className="eact">
          {battle.mode === 'pve' ? (
            <button className="cbtn primary" onClick={() => window.location.reload()}>New encounter</button>
          ) : null}
          <Link to="/lobby" className="cbtn back" style={{ textDecoration: 'none' }} onClick={onClose}>Leave</Link>
        </div>
      </div>
    </div>
  );
}
