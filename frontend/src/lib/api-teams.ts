import { apiFetch } from './api';

export type TeamView = {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  /** Slot 0..2; null = empty slot while drafting. */
  readonly monIds: readonly (string | null)[];
};

export type TeamsResponse = {
  readonly teams: readonly TeamView[];
  readonly limit: number;
  readonly premium: boolean;
  readonly extraSlots: number;
};

export const TEAM_SLOT_ITEM_ID = 'itm-team-slot';
export const TEAM_SLOT_PRICE = 200;

export function getTeams(): Promise<TeamsResponse> {
  return apiFetch<TeamsResponse>('/api/teams');
}

export function createTeam(input: { name?: string; seedFromParty?: boolean }): Promise<TeamView> {
  return apiFetch<TeamView>('/api/teams', { method: 'POST', body: input });
}

export function renameTeam(teamId: string, name: string): Promise<TeamView> {
  return apiFetch<TeamView>(`/api/teams/${encodeURIComponent(teamId)}/rename`, { method: 'POST', body: { name } });
}

export function setTeamMembers(teamId: string, monIds: readonly (string | null)[]): Promise<TeamView> {
  return apiFetch<TeamView>(`/api/teams/${encodeURIComponent(teamId)}/members`, { method: 'PUT', body: { monIds } });
}

export function activateTeam(teamId: string): Promise<TeamView> {
  return apiFetch<TeamView>(`/api/teams/${encodeURIComponent(teamId)}/activate`, { method: 'POST' });
}

export function deleteTeam(teamId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' });
}

/** Buy one `itm-team-slot` (200 credits → +1 team slot). */
export function buyTeamSlot(): Promise<{ ok: true; credits: number; netcore: number }> {
  return apiFetch<{ ok: true; credits: number; netcore: number }>('/api/shop/buy', {
    method: 'POST',
    body: { itemId: TEAM_SLOT_ITEM_ID, qty: 1 },
  });
}