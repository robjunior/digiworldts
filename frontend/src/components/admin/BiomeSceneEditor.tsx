import { useEffect, useMemo, useState } from 'react';

import { BIOMES, ARENA_FILES, type ArenaFile, type Biome, type BiomeSceneConfig, type PerBiomeSceneDefaults } from '@digiworld/shared/world';
import { apiFetch, ApiError } from '../../lib/api';
import { deleteArena, getArenas, renameArena, uploadArena, uploadArenaThumbnail, type ArenaFileMeta } from '../../lib/api-admin';
import { generateArenaThumbnail } from '../../lib/arena-thumbnail';
import { getBiomeScenes, invalidateArenaVersionsCache, replaceBiomeScenesCache } from '../../lib/scene-defaults';
import type { SceneSettings } from '../../scene3d/scene';
import { useWsStore } from '../../state/wsStore';
import { ScenePreview } from './ScenePreview';

const BIOME_LABEL: Record<Biome, string> = {
  desert: 'Ember Wastes',
  forest: 'Verdant Reach',
  lake: 'Mirror Basin',
  storm: 'Voltcloud',
  tundra: 'Frostspire',
  mountain: 'Stoneridge',
  foundry: 'Rustworks',
  plateau: 'Skyshear',
  prairie: 'Solaris Fields',
  swamp: 'Nightveil',
  void: 'The Static',
};

const BIOME_DEFAULT_FILE: Record<Biome, ArenaFile> = {
  desert: 'fire.glb',
  forest: 'plant.glb',
  lake: 'water.glb',
  storm: 'steel.glb',
  tundra: 'ice.glb',
  mountain: 'rock.glb',
  foundry: 'steel.glb',
  plateau: 'wind.glb',
  prairie: 'light.glb',
  swamp: 'dark.glb',
  void: 'null.glb',
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type UploadStatus = 'idle' | 'uploading' | 'thumbnailing' | 'ok' | 'error';
type DeleteStatus = 'idle' | 'deleting';
type RenameStatus = 'idle' | 'renaming';

const FALLBACK_ARENAS: readonly ArenaFileMeta[] = ARENA_FILES.map((file) => ({ file, size: 0, mtime: 0 }));

function formatBytes(n: number): string {
  if (n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelative(mtimeMs: number): string {
  if (mtimeMs <= 0) return '—';
  const diff = Date.now() - mtimeMs;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function formatSettings(settings: Record<string, unknown>): string {
  return JSON.stringify(settings, null, 2);
}

function parseSettings(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: 'settings must be a JSON object' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid JSON' };
  }
}

export function BiomeSceneEditor(): JSX.Element {
  const [selectedBiome, setSelectedBiome] = useState<Biome>(BIOMES[0]);
  const [config, setConfig] = useState<PerBiomeSceneDefaults>({});
  const [settingsDraft, setSettingsDraft] = useState<string>('{}');
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [availableArenas, setAvailableArenas] = useState<readonly ArenaFileMeta[]>(FALLBACK_ARENAS);
  const [arenasRefreshing, setArenasRefreshing] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteStatus, setDeleteStatus] = useState<DeleteStatus>('idle');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [renameStatus, setRenameStatus] = useState<RenameStatus>('idle');
  const [renameError, setRenameError] = useState<string | null>(null);
  const arenasUpdatedAt = useWsStore((s) => s.arenasUpdatedAt);
  const biomeScenesUpdatedAt = useWsStore((s) => s.biomeScenesUpdatedAt);

  const refreshArenas = async (): Promise<void> => {
    setArenasRefreshing(true);
    try {
      const res = await getArenas();
      if (res.arenas.length > 0) setAvailableArenas(res.arenas);
      invalidateArenaVersionsCache();
    } catch {
    } finally {
      setArenasRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void getBiomeScenes(true)
      .then((data) => { if (!cancelled) setConfig(data); })
      .catch(() => {});
    void getArenas()
      .then((res) => { if (!cancelled && res.arenas.length > 0) setAvailableArenas(res.arenas); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (arenasUpdatedAt === 0) return;
    let cancelled = false;
    void getArenas()
      .then((res) => { if (!cancelled && res.arenas.length > 0) setAvailableArenas(res.arenas); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [arenasUpdatedAt]);

  useEffect(() => {
    if (biomeScenesUpdatedAt === 0) return;
    let cancelled = false;
    void getBiomeScenes(true)
      .then((data) => { if (!cancelled) setConfig(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [biomeScenesUpdatedAt]);

  const inUseByFile = useMemo<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const [biome, cfg] of Object.entries(config)) {
      const f = cfg?.file;
      if (f === undefined) continue;
      const arr = out[f] ?? [];
      arr.push(biome);
      out[f] = arr;
    }
    return out;
  }, [config]);

  const handleUpload = async (file: File): Promise<void> => {
    setUploadStatus('uploading');
    setUploadError(null);
    const tryUpload = async (overwrite: boolean): Promise<void> => {
      const res = await uploadArena(file, overwrite);
      setUploadStatus('thumbnailing');
      try {
        const arenaKey = res.file.replace(/\.glb$/, '');
        const png = await generateArenaThumbnail(file, arenaKey);
        await uploadArenaThumbnail(res.file, png);
      } catch (thumbErr) {
        console.warn('arena.thumbnail.generate.fail', thumbErr);
      }
      setUploadStatus('ok');
      window.setTimeout(() => setUploadStatus((s) => (s === 'ok' ? 'idle' : s)), 1500);
    };
    try {
      await tryUpload(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const yes = window.confirm(`${file.name} already exists on the server. Overwrite it?`);
        if (!yes) { setUploadStatus('idle'); return; }
        try { await tryUpload(true); return; } catch (err2) {
          setUploadStatus('error');
          setUploadError(err2 instanceof Error ? err2.message : 'upload failed');
          return;
        }
      }
      setUploadStatus('error');
      setUploadError(err instanceof Error ? err.message : 'upload failed');
    }
  };

  const handleDelete = async (file: string): Promise<void> => {
    if (!window.confirm(`Delete ${file}? This removes the file from disk permanently.`)) return;
    setDeleteStatus('deleting');
    setDeleteError(null);
    try {
      await deleteArena(file);
      setAvailableArenas((prev) => prev.filter((a) => a.file !== file));
      setDeleteStatus('idle');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'delete failed');
      setDeleteStatus('idle');
    }
  };

  const handleRename = async (oldFile: string): Promise<void> => {
    const raw = window.prompt(`Rename ${oldFile} to:`, oldFile);
    if (raw === null) return;
    const newFile = raw.trim();
    if (newFile === '' || newFile === oldFile) return;
    setRenameStatus('renaming');
    setRenameError(null);
    try {
      const res = await renameArena(oldFile, newFile);
      if (res.cascaded) {
        const fresh = await getBiomeScenes(true);
        setConfig(fresh);
      }
      setRenameStatus('idle');
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'rename failed');
      setRenameStatus('idle');
    }
  };

  const current: BiomeSceneConfig = useMemo(() => (
    config[selectedBiome] ?? { file: BIOME_DEFAULT_FILE[selectedBiome], settings: {} }
  ), [config, selectedBiome]);

  useEffect(() => {
    setSettingsDraft(formatSettings(current.settings));
    setSettingsError(null);
  }, [selectedBiome, current.settings]);

  const configuredCount = Object.keys(config).length;

  const arenaKey = useMemo(() => current.file.replace(/\.glb$/, ''), [current.file]);
  const currentVersion = useMemo<number | undefined>(() => {
    const match = availableArenas.find((a) => a.file === current.file);
    return match !== undefined && match.mtime > 0 ? match.mtime : undefined;
  }, [availableArenas, current.file]);
  const previewSettings = useMemo<SceneSettings>(() => {
    const parsed = parseSettings(settingsDraft);
    return (parsed.ok ? parsed.value : current.settings) as unknown as SceneSettings;
  }, [settingsDraft, current.settings]);

  const updateFile = (file: ArenaFile): void => {
    setConfig((prev) => ({ ...prev, [selectedBiome]: { ...current, file } }));
  };

  const commitSettings = (): boolean => {
    const parsed = parseSettings(settingsDraft);
    if (!parsed.ok) {
      setSettingsError(parsed.error);
      return false;
    }
    setSettingsError(null);
    setConfig((prev) => ({ ...prev, [selectedBiome]: { ...current, settings: parsed.value } }));
    return true;
  };

  const resetBiome = (): void => {
    setConfig((prev) => {
      const next = { ...prev };
      delete next[selectedBiome];
      return next;
    });
  };

  const save = async (): Promise<void> => {
    if (!commitSettings()) return;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const parsedSettings = parseSettings(settingsDraft);
      if (!parsedSettings.ok) throw new Error(parsedSettings.error);
      const nextConfig: PerBiomeSceneDefaults = {
        ...config,
        [selectedBiome]: { ...current, settings: parsedSettings.value },
      };
      await apiFetch<{ ok: true; biomes: PerBiomeSceneDefaults }>('/api/admin/biome-scenes', {
        method: 'POST',
        body: nextConfig,
      });
      replaceBiomeScenesCache(nextConfig);
      setSaveStatus('saved');
      window.setTimeout(() => setSaveStatus('idle'), 1500);
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : 'unknown error');
    }
  };

  return (
    <div className="biome-editor">
      <header className="biome-editor-head">
        <div>
          <h2>Biome scene editor</h2>
          <p className="biome-editor-note">
            Per-biome arena file + scene atmospherics. Saved server-side; broadcasts to every connected client.
          </p>
        </div>
        <div className="biome-editor-header-actions">
          <span className="scene-admin-badge" data-active={configuredCount > 0 ? '1' : '0'}>
            {configuredCount === 0 ? 'no biome overrides' : `${configuredCount} configured`}
          </span>
        </div>
      </header>

      <div className="biome-editor-layout">
        <aside className="biome-editor-list" aria-label="Biomes">
          {BIOMES.map((biome) => {
            const isActive = biome === selectedBiome;
            const hasOverride = config[biome] !== undefined;
            return (
              <button
                key={biome}
                type="button"
                className={`biome-editor-item${isActive ? ' is-active' : ''}${hasOverride ? ' has-override' : ''}`}
                onClick={() => setSelectedBiome(biome)}
              >
                <span className="biome-editor-item-name">{BIOME_LABEL[biome]}</span>
                <span className="biome-editor-item-key">{biome}</span>
                {hasOverride ? <span className="biome-editor-item-dot" title="Has override" /> : null}
              </button>
            );
          })}
        </aside>

        <section className="biome-editor-panel">
          <div className="biome-editor-panel-head">
            <h3>{BIOME_LABEL[selectedBiome]} <span className="biome-editor-panel-key">({selectedBiome})</span></h3>
            <button
              type="button"
              className="scene-admin-reset"
              onClick={resetBiome}
              disabled={config[selectedBiome] === undefined}
            >
              Reset biome
            </button>
          </div>

          <fieldset className="biome-editor-fieldset">
            <legend>
              Arena file
              <button
                type="button"
                className="biome-arena-refresh"
                onClick={() => { void refreshArenas(); }}
                disabled={arenasRefreshing}
                title="Re-scan frontend/public/assets/arenas/ for new or updated .glb files"
              >
                {arenasRefreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </legend>

            <div className="biome-arena-uploader">
              <label className={`biome-arena-upload-btn${uploadStatus === 'uploading' || uploadStatus === 'thumbnailing' ? ' is-uploading' : ''}${uploadStatus === 'ok' ? ' is-ok' : ''}`}>
                <input
                  type="file"
                  accept=".glb,model/gltf-binary"
                  disabled={uploadStatus === 'uploading' || uploadStatus === 'thumbnailing'}
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) void handleUpload(f);
                    e.currentTarget.value = '';
                  }}
                />
                {uploadStatus === 'uploading'
                  ? 'Uploading…'
                  : uploadStatus === 'thumbnailing'
                    ? 'Generating thumbnail…'
                    : uploadStatus === 'ok'
                      ? 'Uploaded ✓'
                      : '+ Upload .glb'}
              </label>
              {uploadError !== null ? (
                <span className="biome-arena-upload-error">Upload failed: {uploadError}</span>
              ) : null}
              {deleteError !== null ? (
                <span className="biome-arena-upload-error">Delete failed: {deleteError}</span>
              ) : null}
              {renameError !== null ? (
                <span className="biome-arena-upload-error">Rename failed: {renameError}</span>
              ) : null}
            </div>

            <div className="biome-arena-grid" role="listbox" aria-label="Arena file">
              {availableArenas.map(({ file, size, mtime, thumb }) => {
                const isActive = file === current.file;
                const usedBy = inUseByFile[file] ?? [];
                const isInUse = usedBy.length > 0;
                const hasThumb = thumb !== undefined;
                return (
                  <div
                    key={file}
                    role="option"
                    aria-selected={isActive}
                    tabIndex={0}
                    className={`biome-arena-tile${isActive ? ' is-active' : ''}${isInUse ? ' is-in-use' : ''}${hasThumb ? ' has-thumb' : ''}`}
                    onClick={() => updateFile(file as ArenaFile)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        updateFile(file as ArenaFile);
                      }
                    }}
                    title={file}
                  >
                    {hasThumb ? (
                      <img
                        className="biome-arena-tile-thumb"
                        src={`${thumb.url}?v=${thumb.mtime}`}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                      />
                    ) : null}
                    <span className="biome-arena-tile-name">{file}</span>
                    <span className="biome-arena-tile-meta">
                      <span>{formatBytes(size)}</span>
                      <span>{formatRelative(mtime)}</span>
                    </span>
                    <button
                      type="button"
                      className="biome-arena-tile-rename"
                      onClick={(e) => { e.stopPropagation(); void handleRename(file); }}
                      disabled={renameStatus === 'renaming'}
                      aria-label={`Rename ${file}`}
                      title={`Rename ${file}`}
                    >
                      ✎
                    </button>
                    {isInUse ? (
                      <span className="biome-arena-tile-inuse" title={`used by ${usedBy.join(', ')}`}>
                        in use · {usedBy.length}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="biome-arena-tile-delete"
                        onClick={(e) => { e.stopPropagation(); void handleDelete(file); }}
                        disabled={deleteStatus === 'deleting'}
                        aria-label={`Delete ${file}`}
                        title={`Delete ${file}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="biome-editor-hint">
              Upload directly or drop files into <code>frontend/public/assets/arenas/</code> then click <b>Refresh</b>. Tiles in use by a biome show an <b>in use</b> badge and can't be deleted — remove them from that biome first.
            </p>
          </fieldset>

          <fieldset className="biome-editor-fieldset">
            <legend>Scene atmospherics (JSON)</legend>
            <textarea
              value={settingsDraft}
              onChange={(e) => { setSettingsDraft(e.currentTarget.value); setSettingsError(null); }}
              onBlur={commitSettings}
              rows={16}
              spellCheck={false}
              className="biome-editor-json"
              placeholder='{ "fogColor": 3355443, "sunIntensity": 1.2 }'
            />
            {settingsError !== null ? (
              <div className="biome-editor-error">JSON error: {settingsError}</div>
            ) : (
              <p className="biome-editor-hint">
                Object of scene setting keys (fogColor, sunIntensity, camDist, etc.). Server-validated on save.
              </p>
            )}
          </fieldset>

          <div className="biome-editor-actions">
            <button
              type="button"
              className="scene-admin-reset"
              onClick={() => { void save(); }}
              disabled={saveStatus === 'saving'}
            >
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : 'Save biome scenes'}
            </button>
            {saveStatus === 'error' && saveError !== null ? (
              <span className="biome-editor-error">Save failed: {saveError}</span>
            ) : null}
          </div>
        </section>

        <aside className="biome-editor-preview-col" aria-label="Live scene preview">
          <div className="biome-editor-preview-head">
            <h4>Live preview</h4>
            <span className="biome-editor-preview-key">{arenaKey}.glb</span>
          </div>
          <ScenePreview arenaKey={arenaKey} version={currentVersion} settings={previewSettings} />
          <p className="biome-editor-hint">
            Updates as you switch biomes, pick a different arena file, or edit the atmospherics JSON. Nothing is saved until you click <b>Save biome scenes</b>.
          </p>
        </aside>
      </div>
    </div>
  );
}
