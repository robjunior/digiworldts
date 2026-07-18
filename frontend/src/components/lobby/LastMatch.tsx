import type { LastMatchSummary } from '../../lib/api';
import { fmtRelative } from '../../lib/format';

export type LastMatchProps = {
  readonly match: LastMatchSummary | null;
};

export function LastMatch({ match }: LastMatchProps): JSX.Element {
  if (match === null) {
    return <div className="last-match is-empty">No matches yet</div>;
  }

  const outcome = normalizeOutcome(match.outcome);
  return (
    <div className="last-match">
      <span className={`outcome ${outcome}`} aria-label={`Match outcome: ${outcome}`}>
        {outcome}
      </span>
      <div className="mid">
        <div className="who">{match.opponent === undefined ? 'Recent battle' : `vs ${match.opponent}${match.opponentLevel === undefined ? '' : ` · Lv ${match.opponentLevel}`}`}</div>
        <div className="rewards">{rewardText(match)}</div>
      </div>
      <time className="when" dateTime={new Date(match.endedAt).toISOString()}>
        {fmtRelative(match.endedAt)}
      </time>
    </div>
  );
}

function normalizeOutcome(outcome: LastMatchSummary['outcome']): 'win' | 'loss' | 'draw' | 'fled' {
  switch (outcome) {
    case 'win_a':
    case 'win_b':
    case 'captured_a':
    case 'win':
      return 'win';
    case 'fled_a':
    case 'fled_b':
    case 'fled':
      return 'fled';
    case 'abandoned':
    case 'draw':
      return 'draw';
    case 'loss':
      return 'loss';
    default:
      outcome satisfies never;
      return 'draw';
  }
}

function rewardText(match: LastMatchSummary): string {
  const rewards = match.rewards;
  if (rewards === undefined) {
    return 'Rewards unavailable';
  }
  const parts = [
    rewards.credits === undefined ? null : `+${rewards.credits} credits`,
    rewards.xp === undefined ? null : `+${rewards.xp} XP`,
    rewards.drop ?? null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? 'Rewards unavailable' : parts.join(' · ');
}
