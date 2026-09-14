import type {
  AuthLogoutResponse,
  AuthMeResponse,
  AuthSessionResponse,
  AuthStatusResponse,
  LoginBody,
  RegisterBody,
} from '@digiworld/shared/auth';
import type { BattleView } from '@digiworld/shared/battle';
import type { BattleOutcome } from '@digiworld/shared/battle';
import type { BaseStats, StagePools, TemplateDigimon } from '@digiworld/shared/digimon';

type ErrorPayload = {
  readonly error?: unknown;
  readonly code?: unknown;
  readonly details?: unknown;
};

type JsonInit = Omit<RequestInit, 'body'> & {
  readonly body?: BodyInit | object | null;
};

// PHASE 6 CANDIDATE: promote roster HTTP response types to shared.
export type RosterView = {
  readonly id: string;
  readonly catalogId: string;
  readonly nickname: string;
  readonly level: number;
  readonly xp: number;
  readonly xpFloor: number;
  readonly xpNext: number;
  readonly statBonus: BaseStats;
  readonly mood: number;
  readonly status: 'resting' | 'training' | 'party' | 'adventure' | 'nursery';
  readonly slot: number | null;
  readonly reviveAt: number | null;
  readonly currentHp: number | null;
  readonly currentEn: number | null;
  readonly hpMax: number;
  readonly enMax: number;
  readonly listedAt: number | null;
  readonly evolutionHistory: readonly string[];
  readonly equippedSkillIds: readonly string[] | null;
  readonly stagePools: StagePools | null;
  readonly template: TemplateDigimon | null;
};

export type RosterResponse = {
  readonly roster: readonly RosterView[];
};

// PHASE 6 CANDIDATE: promote daily reward HTTP response types to shared.
export type DayReward = {
  readonly day: number;
  readonly meat?: number;
  readonly bits?: number;
  readonly data?: number;
  readonly credits?: number;
};

export type DailyResponse = {
  readonly streakDay: number;
  readonly canClaim: boolean;
  readonly wouldGrantDay: number;
  readonly wouldReset: boolean;
  readonly secondsUntilNext: number;
  readonly lastClaimAt: number | null;
  readonly cycle: readonly DayReward[];
};

export type DailyClaimResponse = {
  readonly streakDay: number;
  readonly reset: boolean;
  readonly granted: DayReward;
};

// PHASE 6 CANDIDATE: add a backend match-summary route and shared response type.
export type LastMatchSummary = {
  readonly id: string;
  readonly outcome: BattleOutcome | 'win' | 'loss' | 'draw' | 'fled';
  readonly opponent?: string;
  readonly opponentLevel?: number;
  readonly rewards?: {
    readonly credits?: number;
    readonly xp?: number;
    readonly drop?: string;
  };
  readonly endedAt: number;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (code !== undefined) {
      this.code = code;
    }
    this.details = details;
  }
}

export async function apiFetch<T>(path: string, init: JsonInit = {}): Promise<T> {
  const { body: rawBody, headers: initHeaders, ...restInit } = init;
  const headers = new Headers(initHeaders);
  const body = encodeBody(rawBody);

  if (body !== undefined && !headers.has('Content-Type') && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const requestInit = {
    ...restInit,
    headers,
    credentials: 'include',
    ...(body === undefined ? {} : { body }),
  } satisfies RequestInit;

  const response = await fetch(path, requestInit);
  const payload = await parsePayload(response);

  if (!response.ok) {
    throw toApiError(response.status, payload);
  }

  return payload as T;
}

export function authStatus(): Promise<AuthStatusResponse> {
  return apiFetch<AuthStatusResponse>('/api/auth/status');
}

export function authMe(): Promise<AuthMeResponse> {
  return apiFetch<AuthMeResponse>('/api/auth/me');
}

export function authLogin(body: LoginBody): Promise<AuthSessionResponse> {
  return apiFetch<AuthSessionResponse>('/api/auth/login', {
    method: 'POST',
    body,
  });
}

export function authRegister(body: RegisterBody): Promise<AuthSessionResponse> {
  return apiFetch<AuthSessionResponse>('/api/auth/register', {
    method: 'POST',
    body,
  });
}

export function authLogout(): Promise<AuthLogoutResponse> {
  return apiFetch<AuthLogoutResponse>('/api/auth/logout', { method: 'POST' });
}

export function authResetConsume(body: { token: string; newPassword: string }): Promise<{ ok: true; username: string }> {
  return apiFetch<{ ok: true; username: string }>('/api/auth/reset-consume', {
    method: 'POST',
    body,
  });
}

export function battleSpectate(matchId: string): Promise<{ matchId: string; view: BattleView; spectatorCount: number }> {
  return apiFetch<{ matchId: string; view: BattleView; spectatorCount: number }>(
    `/api/battle/spectate/${encodeURIComponent(matchId)}`,
  );
}

export type ChatRoomView = {
  readonly id: string;
  readonly name: string;
  readonly kind: 'room' | 'dm';
  readonly ownerId: string | null;
  readonly createdAt: number;
  readonly memberCount: number;
};

export function chatListMyRooms(): Promise<{ rooms: ChatRoomView[] }> {
  return apiFetch<{ rooms: ChatRoomView[] }>('/api/chat/rooms/mine');
}

export function chatCreateRoom(name: string): Promise<{ room: ChatRoomView }> {
  return apiFetch<{ room: ChatRoomView }>('/api/chat/room/create', { method: 'POST', body: { name } });
}

export function chatJoinRoom(roomId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/api/chat/room/join', { method: 'POST', body: { roomId } });
}

export function chatLeaveRoom(roomId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/api/chat/room/leave', { method: 'POST', body: { roomId } });
}

export function chatOpenDm(username: string): Promise<{
  room: ChatRoomView;
  created: boolean;
  otherUser: { id: string; displayName: string };
}> {
  return apiFetch('/api/chat/dm/open', { method: 'POST', body: { username } });
}

export function getRoster(): Promise<RosterResponse> {
  return apiFetch<RosterResponse>('/api/roster');
}

export function getDaily(): Promise<DailyResponse> {
  return apiFetch<DailyResponse>('/api/daily');
}

export function claimDaily(): Promise<DailyClaimResponse> {
  return apiFetch<DailyClaimResponse>('/api/daily/claim', { method: 'POST' });
}

export async function getLastMatch(): Promise<LastMatchSummary | null> {
  try {
    return await apiFetch<LastMatchSummary>('/api/battle/last');
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return getLastMatchFromHistory();
    }
    throw error;
  }
}

async function getLastMatchFromHistory(): Promise<LastMatchSummary | null> {
  try {
    const history = await apiFetch<{ readonly matches?: readonly LastMatchSummary[] }>('/api/battle/history?limit=1');
    return history.matches?.[0] ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

function encodeBody(body: JsonInit['body']): BodyInit | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (isBodyInit(body)) {
    return body;
  }
  return JSON.stringify(body);
}

function isBodyInit(body: object | BodyInit): body is BodyInit {
  return (
    typeof body === 'string' ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ReadableStream
  );
}

async function parsePayload(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return text;
    }
    throw error;
  }
}

function toApiError(status: number, payload: unknown): ApiError {
  if (isErrorPayload(payload)) {
    const message = typeof payload.error === 'string' ? payload.error : `Request failed with ${status}`;
    const code = typeof payload.code === 'string' ? payload.code : undefined;
    return new ApiError(message, status, code, payload.details);
  }
  if (typeof payload === 'string') {
    return new ApiError(payload, status);
  }
  return new ApiError(`Request failed with ${status}`, status);
}

function isErrorPayload(payload: unknown): payload is ErrorPayload {
  return typeof payload === 'object' && payload !== null && 'error' in payload;
}

// ── Friends ─────────────────────────────────────────────────────────
export type FriendView = {
  readonly userId: string;
  readonly displayName: string;
  readonly online: boolean;
  readonly since: number;
};

export type FriendRequestView = {
  readonly userId: string;
  readonly displayName: string;
  readonly at: number;
};

export type FriendsResponse = {
  readonly friends: readonly FriendView[];
  readonly incoming: readonly FriendRequestView[];
  readonly outgoing: readonly FriendRequestView[];
};

export async function getFriends(): Promise<FriendsResponse> {
  return apiFetch<FriendsResponse>('/api/friends');
}

export async function requestFriend(username: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>('/api/friends/request', { method: 'POST', body: JSON.stringify({ username }) });
}

export async function acceptFriend(userId: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>('/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId }) });
}

export async function removeFriend(userId: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/api/friends/remove', { method: 'POST', body: JSON.stringify({ userId }) });
}

// ── Live matches ────────────────────────────────────────────────────
export type LiveMatchSummary = {
  readonly matchId: string;
  readonly playerA: { readonly userId: string; readonly displayName: string };
  readonly playerB: { readonly userId: string; readonly displayName: string };
  readonly spectactorCount: number;
};

export async function getLiveMatches(): Promise<readonly LiveMatchSummary[]> {
  try {
    return await apiFetch<readonly LiveMatchSummary[]>('/api/battle/live');
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return [];
    }
    throw error;
  }
}
