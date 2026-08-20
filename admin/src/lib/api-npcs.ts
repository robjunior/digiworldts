import type { Npc } from '@digiworld/shared/npc';

import { apiFetch } from './api';

/**
 * Admin bindings for the NPC registry.
 *
 * Public GETs (`/api/npcs`, `/api/npcs/:id`) are user-auth; the mutating
 * routes are admin-only. Portrait upload sends a PNG multipart; the server
 * validates the magic bytes and size before writing to
 * `public/assets/npc/{id}/{expression}.png`.
 */
export type NpcInput = {
  readonly id: string;
  readonly displayName: string;
  readonly expressions: readonly { readonly key: string; readonly label?: string }[];
};

export type NpcUpdate = Omit<NpcInput, 'id'>;

export function listNpcs(): Promise<{ readonly npcs: readonly Npc[] }> {
  return apiFetch<{ readonly npcs: readonly Npc[] }>('/api/npcs?includeDrafts=1');
}

export function getNpc(id: string): Promise<{ readonly npc: Npc }> {
  return apiFetch<{ readonly npc: Npc }>(`/api/npcs/${encodeURIComponent(id)}?includeDrafts=1`);
}

export function createNpc(input: NpcInput): Promise<{ readonly npc: Npc }> {
  return apiFetch<{ readonly npc: Npc }>('/api/admin/npcs', {
    method: 'POST',
    body: input,
  });
}

export function updateNpc(id: string, input: NpcUpdate): Promise<{ readonly npc: Npc }> {
  return apiFetch<{ readonly npc: Npc }>(`/api/admin/npcs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input,
  });
}

export function deleteNpc(id: string): Promise<{ readonly ok: true }> {
  return apiFetch<{ readonly ok: true }>(`/api/admin/npcs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function uploadNpcPortrait(id: string, expression: string, file: File): Promise<{ readonly ok: true; readonly url: string }> {
  const fd = new FormData();
  fd.append('file', file, `${expression}.png`);
  return apiFetch<{ readonly ok: true; readonly url: string }>(
    `/api/admin/npcs/${encodeURIComponent(id)}/portrait/${encodeURIComponent(expression)}`,
    { method: 'POST', body: fd },
  );
}

export function deleteNpcPortrait(id: string, expression: string): Promise<{ readonly ok: true }> {
  return apiFetch<{ readonly ok: true }>(
    `/api/admin/npcs/${encodeURIComponent(id)}/portrait/${encodeURIComponent(expression)}`,
    { method: 'DELETE' },
  );
}

export function npcPortraitUrl(id: string, expression: string): string {
  return `/assets/npc/${encodeURIComponent(id)}/${encodeURIComponent(expression)}.png`;
}

export function publishNpc(id: string): Promise<{ readonly npc: Npc }> {
  return apiFetch<{ readonly npc: Npc }>(`/api/admin/npcs/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
  });
}

export type NpcHistoryEntry = {
  readonly version: number;
  readonly status: 'draft' | 'published';
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly definition: Npc;
};

export function getNpcHistory(id: string): Promise<{ readonly history: readonly NpcHistoryEntry[] }> {
  return apiFetch<{ readonly history: readonly NpcHistoryEntry[] }>(`/api/admin/npcs/${encodeURIComponent(id)}/history`);
}
