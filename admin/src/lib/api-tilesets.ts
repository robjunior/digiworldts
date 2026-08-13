import type { Tileset, TilesetListResponse, TilesetResponse } from '@digiworld/shared';

import { apiFetch, ApiError } from './api';

export async function listAdminTilesets(): Promise<TilesetListResponse> {
  return apiFetch<TilesetListResponse>('/api/admin/tilesets');
}

export type UploadTilesetInput = {
  readonly name: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly spacing?: number;
  readonly margin?: number;
  readonly image: File;
};

export async function uploadAdminTileset(input: UploadTilesetInput): Promise<TilesetResponse> {
  const body = new FormData();
  body.append('name', input.name);
  body.append('tileWidth', String(input.tileWidth));
  body.append('tileHeight', String(input.tileHeight));
  if (input.spacing !== undefined) body.append('spacing', String(input.spacing));
  if (input.margin !== undefined) body.append('margin', String(input.margin));
  body.append('image', input.image, input.image.name);
  const res = await fetch('/api/admin/tilesets', { method: 'POST', body, credentials: 'include' });
  const text = await res.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!res.ok) {
    const errObj = parsed as { readonly error?: string } | null;
    const message = errObj?.error ?? `upload failed with ${res.status}`;
    throw new ApiError(message, res.status, errObj?.error);
  }
  return parsed as TilesetResponse;
}

export async function deleteAdminTileset(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/admin/tilesets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function tilesetImageUrl(t: Pick<Tileset, 'imageUrl'>): string {
  return t.imageUrl;
}
