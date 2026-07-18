import type { BattleOutcome, BattleView } from '@digiworld/shared/battle';
import { Link } from 'react-router';

type EndCardProps = {
  readonly battle: BattleView;
  readonly onNewEncounter: () => void;
};

export function EndCard({ battle, onNewEncounter }: EndCardProps): JSX.Element | null {
  if (battle.status !== 'ended' && battle.outcome === null) {
    return null;
  }
  const outcome = battle.outcome ?? 'abandoned';
  const tone = outcomeTone(outcome, battle.yourSide);
  const mmr = extractPvpMmr(battle);
  const hpLeftPct = averageHpLeftPct(battle);
  return (
    <section className={`end-card ${tone}`} data-od-id="end-card">
      <span className="outcome-pill">{outcomeLabel(outcome, battle.yourSide)}</span>
      <h2 className="headline">{headline(outcome, battle.yourSide, battle)}</h2>
      <div className="rewards">
        <div className="r"><span className="k">Credits</span><span>+{creditsFor(tone)}</span></div>
        <div className="r"><span className="k">Rounds</span><span>{battle.round}</span></div>
        <div className="r"><span className="k">HP left</span><span>{hpLeftPct}%</span></div>
        {battle.mode === 'pvp' && mmr !== null ? (
          <div className="r" data-od-id="end-card-mmr">
            <span className="k">MMR</span>
            <span>
              <span className="mmr-before">{mmr.before}</span>
              <span className="mmr-arrow"> → </span>
              <b className={`mmr-after mmr-${tone}`}>{mmr.after}</b>
              <span className={`mmr-delta mmr-${tone}`}> ({mmr.delta >= 0 ? '+' : ''}{mmr.delta})</span>
            </span>
          </div>
        ) : (
          <div className="r"><span className="k">Mode</span><span>{battle.mode.toUpperCase()}</span></div>
        )}
      </div>
      <div className="cta-row">
        <button className="btn" type="button" onClick={onNewEncounter} data-od-id="btn-new-encounter">New Encounter</button>
        <Link className="btn btn--secondary" to="/lobby">Back to Menu</Link>
      </div>
    </section>
  );
}

type OutcomeTone = 'win' | 'loss' | 'draw';

function outcomeTone(outcome: BattleOutcome, yourSide: 'a' | 'b'): OutcomeTone {
  switch (outcome) {
    case 'win_a':
    case 'captured_a':
      return yourSide === 'a' ? 'win' : 'loss';
    case 'win_b':
      return yourSide === 'b' ? 'win' : 'loss';
    case 'fled_a':
      return yourSide === 'a' ? 'loss' : 'win';
    case 'fled_b':
      return yourSide === 'b' ? 'loss' : 'win';
    case 'draw':
    case 'abandoned':
      return 'draw';
    default:
      outcome satisfies never;
      return 'draw';
  }
}

function outcomeLabel(outcome: BattleOutcome, yourSide: 'a' | 'b'): string {
  const tone = outcomeTone(outcome, yourSide);
  switch (tone) {
    case 'win': return outcome === 'captured_a' ? 'Captured' : 'Victory';
    case 'loss': return 'Defeat';
    case 'draw': return 'Draw';
    default:
      tone satisfies never;
      return 'Battle ended';
  }
}

function headline(outcome: BattleOutcome, yourSide: 'a' | 'b', battle: BattleView): string {
  const tone = outcomeTone(outcome, yourSide);
  const opponent = battle.opponentDisplayName;
  const rivalName = battle.mode === 'pvp' && opponent !== undefined && opponent.length > 0 ? opponent : null;
  switch (tone) {
    case 'win':
      if (outcome === 'captured_a') return 'Wild target captured.';
      if (rivalName !== null) return `Cleared ${rivalName}'s team.`;
      return 'You cleared the arena.';
    case 'loss':
      if (rivalName !== null) return `Defeated by ${rivalName}.`;
      return 'Your team was cleared.';
    case 'draw': return 'A hard-fought draw.';
    default:
      tone satisfies never;
      return 'Battle resolved.';
  }
}

function creditsFor(tone: OutcomeTone): number {
  switch (tone) {
    case 'win': return 60;
    case 'draw': return 25;
    case 'loss': return 15;
    default:
      tone satisfies never;
      return 0;
  }
}

function extractPvpMmr(battle: BattleView): { before: number; after: number; delta: number } | null {
  for (let i = battle.log.length - 1; i >= 0; i--) {
    const event = battle.log[i];
    if (event !== undefined && event.type === 'end' && event.pvpMmr !== undefined) {
      return event.pvpMmr;
    }
  }
  return null;
}

function averageHpLeftPct(battle: BattleView): number {
  if (battle.friendly.length === 0) return 0;
  let sum = 0;
  for (const unit of battle.friendly) {
    sum += unit.hpMax > 0 ? unit.hp / unit.hpMax : 0;
  }
  return Math.round((sum / battle.friendly.length) * 100);
}
