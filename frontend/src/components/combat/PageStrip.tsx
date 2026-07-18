import type { BattleView } from '@digiworld/shared/battle';

type PageStripProps = {
  readonly battle: BattleView;
  readonly readyState: number;
};

const OPEN_READY_STATE = 1;

export function PageStrip({ battle, readyState }: PageStripProps): JSX.Element {
  const actor = currentActorName(battle);
  const aliveFriendly = battle.friendly.filter((unit) => !unit.down).length;
  const aliveEnemy = battle.enemy.filter((unit) => !unit.down).length;
  const opponentLabel = opponentDisplay(battle);

  return (
    <div className={`page-strip ${battle.yourTurn ? 'is-action' : 'is-warn'}`} role="status" aria-live="polite" data-od-id="page-strip">
      <span className="ps-name">Battle</span>
      <span className="ps-body">
        <span className="mono">
          R<b>{battle.round}</b>
        </span>
        <span className="sep">·</span>
        <span className={battle.yourTurn ? 'accent' : 'warn'}>{battle.yourTurn ? 'Your turn' : 'Opponent'}</span>
        <span className="ps-actor">{actor}</span>
        <span className="sep">·</span>
        <span className="muted">
          vs <b>{opponentLabel}</b> · <span>{aliveFriendly}v{aliveEnemy}</span>
        </span>
      </span>
      <span className="ps-actions">
        <span className="mono muted" style={{ fontSize: '10px' }}>{readyState === OPEN_READY_STATE ? 'live' : 'syncing'}</span>
      </span>
    </div>
  );
}

function currentActorName(battle: BattleView): string {
  const currentId = battle.currentTurnUnitId;
  if (currentId === null) {
    return '—';
  }
  const friendly = battle.friendly.find((unit) => unit.id === currentId);
  if (friendly) {
    return friendly.name;
  }
  return battle.enemy.find((unit) => unit.id === currentId)?.name ?? '—';
}

function opponentDisplay(battle: BattleView): string {
  if (battle.mode === 'pve') return 'Wild';
  const name = battle.opponentDisplayName;
  return name !== undefined && name.length > 0 ? name : 'Rival';
}
