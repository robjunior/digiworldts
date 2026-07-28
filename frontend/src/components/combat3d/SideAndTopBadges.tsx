import type { BattleView, EnemyUnitView, FriendlyUnitView } from '@digiworld/shared/battle';
import { TurnOrderStrip } from './TurnOrderStrip';

export function SideBadge({ battle }: { readonly battle: BattleView }): JSX.Element {
  return (
    <div className="sb">
      <span className="k">Wild Pack</span>
      <span className="pips">
        {battle.enemy.map((e) => (
          <span key={e.id} className={`pip ${e.down || e.hp <= 0 ? '' : 'alive'}`} title={e.name} />
        ))}
      </span>
    </div>
  );
}

export function TeamBadge({ friendly }: { readonly friendly: readonly FriendlyUnitView[] }): JSX.Element {
  return (
    <div className="team-badge">
      <span className="k">Your Team</span>
      <div className="pips">
        {friendly.map((u) => (
          <span key={u.id} className={`pip ${u.down || u.hp <= 0 ? '' : 'alive'}`} title={u.name} />
        ))}
      </div>
    </div>
  );
}

export function TopBar({ battle, actor }: { readonly battle: BattleView; readonly actor: FriendlyUnitView | null }): JSX.Element {
  return (
    <div className="topbar">
      <div className="tstrip" role="status" aria-live="polite" aria-atomic="true">
        <span className="rd">Round {battle.round}</span>
        <span className={`tt ${battle.yourTurn ? 'you' : ''}`}>{battle.yourTurn ? 'Your Turn' : 'Opponent'}</span>
        <span className="actor">{actor?.name ?? battle.enemy.find((e) => !e.down)?.name ?? '—'}</span>
      </div>
      <div className="nextq" role="list" aria-label="Turn order">
        <span className="nl" aria-hidden="true">Next</span>
        <span style={{display:'flex',gap:'11px'}}>
          <TurnOrderStrip battle={battle} />
        </span>
      </div>
    </div>
  );
}