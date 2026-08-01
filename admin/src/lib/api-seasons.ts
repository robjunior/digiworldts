import { apiFetch } from './api';

export type Season = {
  readonly id: string;
  readonly name: string;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly endedAt: number | null;
  readonly createdAt: number;
  readonly createdBy: string | null;
};

export type SeasonsList = {
  readonly seasons: readonly Season[];
};

export type CreateSeasonInput = {
  readonly name: string;
  readonly startsAt: number;
  readonly endsAt: number;
};

export type UpdateSeasonInput = {
  readonly name?: string;
  readonly startsAt?: number;
  readonly endsAt?: number;
};

export type EndSeasonResult = {
  readonly ok: true;
  readonly season: Season | null;
  readonly snapshottedUsers: number;
};

export function listSeasons(): Promise<SeasonsList> {
  return apiFetch<SeasonsList>('/api/admin/seasons');
}

export function createSeason(body: CreateSeasonInput): Promise<{ readonly season: Season }> {
  return apiFetch<{ readonly season: Season }>('/api/admin/seasons', { method: 'POST', body });
}

export function updateSeason(id: string, body: UpdateSeasonInput): Promise<{ readonly season: Season }> {
  return apiFetch<{ readonly season: Season }>(`/api/admin/seasons/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
  });
}

export function endSeasonNow(id: string): Promise<EndSeasonResult> {
  return apiFetch<EndSeasonResult>(`/api/admin/seasons/${encodeURIComponent(id)}/end`, { method: 'POST' });
}

export function deleteSeason(id: string): Promise<{ readonly ok: true }> {
  return apiFetch<{ readonly ok: true }>(`/api/admin/seasons/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
