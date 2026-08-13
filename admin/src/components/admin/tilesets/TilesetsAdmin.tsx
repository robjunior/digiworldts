import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChangeEvent, FormEvent, JSX } from 'react';
import { useState } from 'react';

import type { Tileset } from '@digiworld/shared';

import { deleteAdminTileset, listAdminTilesets, uploadAdminTileset } from '../../../lib/api-tilesets';
import { AdminSection, ErrorText, Field } from '../AdminShared';

const TILESETS_QUERY = ['admin', 'tilesets'] as const;

type UploadDraft = {
  readonly name: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly spacing: number;
  readonly margin: number;
  readonly file: File | null;
  readonly localPreviewUrl: string | null;
  readonly localWidth: number | null;
  readonly localHeight: number | null;
};

const EMPTY_DRAFT: UploadDraft = {
  name: '',
  tileWidth: 32,
  tileHeight: 32,
  spacing: 0,
  margin: 0,
  file: null,
  localPreviewUrl: null,
  localWidth: null,
  localHeight: null,
};

export function TilesetsAdmin(): JSX.Element {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<UploadDraft>(EMPTY_DRAFT);
  const [uploading, setUploading] = useState(false);

  const listQuery = useQuery({ queryKey: TILESETS_QUERY, queryFn: listAdminTilesets });

  const uploadMutation = useMutation({
    mutationFn: uploadAdminTileset,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TILESETS_QUERY });
      if (draft.localPreviewUrl !== null) URL.revokeObjectURL(draft.localPreviewUrl);
      setDraft(EMPTY_DRAFT);
      setUploading(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAdminTileset,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TILESETS_QUERY }),
  });

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0] ?? null;
    if (draft.localPreviewUrl !== null) URL.revokeObjectURL(draft.localPreviewUrl);
    if (!file) {
      setDraft((d) => ({ ...d, file: null, localPreviewUrl: null, localWidth: null, localHeight: null }));
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    const dims = await readImageDimensions(previewUrl);
    const derivedName = draft.name.trim().length === 0 ? file.name.replace(/\.(png|jpe?g|gif|webp)$/i, '') : draft.name;
    setDraft((d) => ({
      ...d,
      file,
      localPreviewUrl: previewUrl,
      localWidth: dims?.width ?? null,
      localHeight: dims?.height ?? null,
      name: derivedName,
    }));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!draft.file || draft.name.trim().length === 0) return;
    setUploading(true);
    uploadMutation.mutate({
      name: draft.name.trim(),
      tileWidth: draft.tileWidth,
      tileHeight: draft.tileHeight,
      spacing: draft.spacing,
      margin: draft.margin,
      image: draft.file,
    }, { onError: () => setUploading(false) });
  };

  const onDelete = (t: Tileset): void => {
    if (!window.confirm(`Delete tileset "${t.name}"? This removes the spritesheet and cannot be undone. Dungeons that reference it will block deletion.`)) return;
    deleteMutation.mutate(t.id);
  };

  const tilesets = listQuery.data?.tilesets ?? [];

  return (
    <AdminSection
      title="Tilesets"
      lede="Reusable spritesheets for dungeons. Upload a PNG once, then reference it from any Tiled map (matched by name). Deleting a tileset in use is blocked."
    >
      <ErrorText error={listQuery.error ?? uploadMutation.error ?? deleteMutation.error} />

      <div style={{ marginBottom: '20px', padding: '14px', border: '1px solid var(--hair)', background: 'var(--panel)' }}>
        <h3 style={{ marginTop: 0 }}>Upload a new tileset</h3>
        <form onSubmit={onSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '12px' }}>
            <Field label="PNG file">
              <input type="file" accept="image/png" required onChange={onFileChange} />
            </Field>
            <Field label="Name (unique)">
              <input type="text" required value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="forest-set" />
            </Field>
            <Field label="Tile width (px)">
              <input type="number" min={1} max={512} required value={draft.tileWidth} onChange={(e) => setDraft((d) => ({ ...d, tileWidth: Math.max(1, Math.min(512, Number(e.target.value) || 1)) }))} />
            </Field>
            <Field label="Tile height (px)">
              <input type="number" min={1} max={512} required value={draft.tileHeight} onChange={(e) => setDraft((d) => ({ ...d, tileHeight: Math.max(1, Math.min(512, Number(e.target.value) || 1)) }))} />
            </Field>
            <Field label="Spacing (px)">
              <input type="number" min={0} max={512} value={draft.spacing} onChange={(e) => setDraft((d) => ({ ...d, spacing: Math.max(0, Math.min(512, Number(e.target.value) || 0)) }))} />
            </Field>
            <Field label="Margin (px)">
              <input type="number" min={0} max={512} value={draft.margin} onChange={(e) => setDraft((d) => ({ ...d, margin: Math.max(0, Math.min(512, Number(e.target.value) || 0)) }))} />
            </Field>
          </div>
          {draft.localPreviewUrl !== null && draft.localWidth !== null && draft.localHeight !== null ? (
            <div style={{ marginBottom: '12px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <img src={draft.localPreviewUrl} alt="Preview" style={{ maxWidth: '160px', maxHeight: '160px', border: '1px solid var(--hair)', imageRendering: 'pixelated' }} />
              <div className="muted" style={{ fontSize: '12px' }}>
                <div><b>{draft.localWidth}×{draft.localHeight}px</b> spritesheet</div>
                <div><b>{Math.floor(draft.localWidth / draft.tileWidth)}×{Math.floor(draft.localHeight / draft.tileHeight)}</b> tiles ({Math.floor(draft.localWidth / draft.tileWidth) * Math.floor(draft.localHeight / draft.tileHeight)} total)</div>
                <div>at <b>{draft.tileWidth}×{draft.tileHeight}px</b> per tile</div>
              </div>
            </div>
          ) : null}
          <div className="admin-section-actions">
            <button type="submit" className="btn btn--primary" disabled={uploading || !draft.file || draft.name.trim().length === 0}>
              {uploading ? 'Uploading\u2026' : 'Upload tileset'}
            </button>
          </div>
        </form>
      </div>

      <div className="admin-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Preview</th>
              <th>Name</th>
              <th>Tile</th>
              <th>Sheet</th>
              <th>Total tiles</th>
              <th>Uploaded</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tilesets.length === 0 ? (
              <tr><td colSpan={7} className="muted">No tilesets yet. Upload a PNG spritesheet above.</td></tr>
            ) : (
              tilesets.map((t) => (
                <tr key={t.id}>
                  <td><img src={t.imageUrl} alt={t.name} style={{ maxWidth: '64px', maxHeight: '64px', border: '1px solid var(--hair)', imageRendering: 'pixelated' }} /></td>
                  <td><b>{t.name}</b><br /><span className="muted" style={{ fontSize: '11px' }}>{t.imageFilename}</span></td>
                  <td>{t.tileWidth}×{t.tileHeight}</td>
                  <td>{t.imageWidth}×{t.imageHeight}<br /><span className="muted" style={{ fontSize: '11px' }}>{t.columns} cols</span></td>
                  <td>{t.tileCount}</td>
                  <td className="muted" style={{ fontSize: '11px' }}>{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="admin-actions-cell">
                    <button type="button" className="btn btn--danger btn--sm" onClick={() => onDelete(t)} disabled={deleteMutation.isPending}>Delete</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AdminSection>
  );
}

async function readImageDimensions(url: string): Promise<{ readonly width: number; readonly height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
