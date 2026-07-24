import { useEffect, useMemo, useState } from 'react';

import { BIOMES, ARENA_FILES, type ArenaFile, type Biome, type BiomeSceneConfig, type PerBiomeSceneDefaults } from '@digiworld/shared/world';
import { apiFetch } from '../../lib/api';
import { getBiomeScenes, replaceBiomeScenesCache } from '../../lib/scene-defaults';

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

  useEffect(() => {
    let cancelled = false;
    void getBiomeScenes(true)
      .then((data) => { if (!cancelled) setConfig(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const current: BiomeSceneConfig = useMemo(() => (
    config[selectedBiome] ?? { file: BIOME_DEFAULT_FILE[selectedBiome], settings: {} }
  ), [config, selectedBiome]);

  useEffect(() => {
    setSettingsDraft(formatSettings(current.settings));
    setSettingsError(null);
  }, [selectedBiome, current.settings]);

  const configuredCount = Object.keys(config).length;

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
            <legend>Arena file</legend>
            <select
              value={current.file}
              onChange={(e) => updateFile(e.currentTarget.value as ArenaFile)}
            >
              {ARENA_FILES.map((file) => (
                <option key={file} value={file}>{file}</option>
              ))}
            </select>
            <p className="biome-editor-hint">
              The .glb rendered when combat happens in this biome.
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
      </div>
    </div>
  );
}
