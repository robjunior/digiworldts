import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { DailyClaimResponse, DailyResponse, DayReward } from '../../lib/api';
import { claimDaily } from '../../lib/api';

export const DAILY_QUERY_KEY = ['daily'] as const;

export type DailyStripProps = {
  readonly daily: DailyResponse | null;
};

export function DailyStrip({ daily }: DailyStripProps): JSX.Element {
  const queryClient = useQueryClient();
  const claimMutation = useMutation({
    mutationFn: claimDaily,
    onSuccess: (claim) => {
      queryClient.setQueryData<DailyResponse>(DAILY_QUERY_KEY, (current) => updateDailyAfterClaim(current, claim));
    },
  });

  const canClaim = daily?.canClaim ?? false;
  return (
    <>
      <div className="daily-strip" role="list" aria-label="7-day streak">
        {(daily?.cycle ?? []).map((reward) => (
          <DailyPip key={reward.day} reward={reward} status={rewardStatus(reward.day, daily)} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{dailyStatus(daily)}</div>
      <button
        className="btn btn--wide"
        type="button"
        data-od-id="btn-daily"
        disabled={!canClaim || claimMutation.isPending}
        onClick={() => claimMutation.mutate()}
      >
        {claimMutation.isPending ? 'Claiming…' : 'Claim daily'}
      </button>
    </>
  );
}

function DailyPip({ reward, status }: { readonly reward: DayReward; readonly status: 'done' | 'next' | 'todo' }): JSX.Element {
  const className = status === 'done' ? 'daily-pip is-done' : status === 'next' ? 'daily-pip is-next' : 'daily-pip';
  return (
    <div className={className} role="listitem" aria-label={`Day ${reward.day}, ${rewardLabel(reward)}`}>
      <span className="n">D{reward.day}</span>
      <span className="r">
        <b>{rewardAmount(reward)}</b>
        <br />
        {rewardKind(reward)}
      </span>
    </div>
  );
}

function rewardStatus(day: number, daily: DailyResponse | null): 'done' | 'next' | 'todo' {
  if (daily === null) {
    return 'todo';
  }
  if (daily.canClaim && day === daily.wouldGrantDay) {
    return 'next';
  }
  if (!daily.canClaim && day === (daily.streakDay >= 7 ? 1 : daily.streakDay + 1)) {
    return 'next';
  }
  return day <= daily.streakDay ? 'done' : 'todo';
}

function dailyStatus(daily: DailyResponse | null): string {
  if (daily === null) {
    return 'Loading…';
  }
  if (daily.canClaim) {
    const reward = daily.cycle.find((item) => item.day === daily.wouldGrantDay);
    return `Day ${daily.wouldGrantDay} ready — ${reward === undefined ? 'reward' : rewardLabel(reward)}`;
  }
  return `Next claim in ${formatSeconds(daily.secondsUntilNext)}`;
}

function updateDailyAfterClaim(current: DailyResponse | undefined, claim: DailyClaimResponse): DailyResponse {
  const nextDay = claim.streakDay >= 7 ? 1 : claim.streakDay + 1;
  return {
    streakDay: claim.streakDay,
    canClaim: false,
    wouldGrantDay: nextDay,
    wouldReset: false,
    secondsUntilNext: 86_400,
    lastClaimAt: Date.now(),
    cycle: current?.cycle ?? [claim.granted],
  };
}

function rewardLabel(reward: DayReward): string {
  return `${rewardAmount(reward)} ${rewardKind(reward)}`;
}

function rewardAmount(reward: DayReward): number {
  return reward.meat ?? reward.bits ?? reward.data ?? reward.credits ?? 0;
}

function rewardKind(reward: DayReward): string {
  if (reward.meat !== undefined) {
    return 'Meat';
  }
  if (reward.bits !== undefined) {
    return 'Bits';
  }
  if (reward.data !== undefined) {
    return 'Data';
  }
  return 'Credits';
}

function formatSeconds(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
