import { apiFetch } from './api';

export type TamerTier = 'I' | 'II' | 'III' | 'IV' | 'V';

export type PlayerCareer = {
  readonly tamer: {
    readonly id: string;
    readonly username: string;
    readonly displayName: string;
    readonly level: number;
    readonly xp: number;
    readonly xpFloor: number;
    readonly xpNext: number;
    readonly mmr: number;
    readonly mmrHigh: number;
    readonly tier: TamerTier;
  };
  readonly activeSeason: {
    readonly id: string;
    readonly name: string;
    readonly endsAt: number;
  } | null;
  readonly seasonHistory: readonly {
    readonly seasonId: string;
    readonly seasonName: string;
    readonly finalMmr: number;
    readonly finalizedAt: number;
  }[];
  readonly battles: {
    readonly wins: number;
    readonly losses: number;
    readonly draws: number;
    readonly total: number;
    readonly winRatePct: number;
  };
  readonly digivolutions: number;
  readonly dexRegistered: number;
  readonly timeTrainedHours: number;
};

export type PvpMatchOutcome = 'win_a' | 'win_b' | 'draw' | 'fled_a' | 'fled_b' | 'abandoned';

export type PvpMatchSummary = {
  readonly id: string;
  readonly win: boolean;
  readonly isDraw: boolean;
  readonly outcome: PvpMatchOutcome;
  readonly opponent: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly rounds: number;
  readonly endedAt: number;
};

export type PvpHistory = {
  readonly matches: readonly PvpMatchSummary[];
};

export function getPlayerCareer(): Promise<PlayerCareer> {
  return apiFetch<PlayerCareer>('/api/player/career');
}

export function getPvpHistory(limit = 20): Promise<PvpHistory> {
  return apiFetch<PvpHistory>(`/api/player/pvp-history?limit=${encodeURIComponent(String(limit))}`);
}
