import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { getCatalog } from '../../lib/api-admin';
import { WORLD_BIOMES } from '../../lib/api-world';
import { SceneSettingsAdmin } from './SceneSettingsAdmin';

const STORAGE_KEY = 'digiworld.biome-config';

type BiomeSpawn = {
  readonly catalogId: string;
  readonly weight: number;
};

type BiomeOverride = {
  readonly arenaKey?: 'plant' | 'steel' | 'water' | 'rock' | 'dark' | 'fire' | 'ice' | 'field' | 'null' | 'wind' | 'light' | null;
  readonly spawns: readonly BiomeSpawn[];
};

type BiomeConfig = Record<string, BiomeOverride>;

const ARENA_OPTIONS = [
  { value: '', label: 'auto (by element)' },
  { value: 'plant', label: 'Nature — plant.glb (forest)' },
  { value: 'steel', label: 'Metal / Electric — steel.glb (factory)' },
  { value: 'water', label: 'Water — water.glb (beach)' },
  { value: 'rock', label: 'Earth — rock.glb (canyon)' },
  { value: 'dark', label: 'Dark — dark.glb (nightmare)' },
  { value: 'fire', label: 'Fire — fire.glb (volcano)' },
  { value: 'ice', label: 'Ice — ice.glb (glacier)' },
  { value: 'field', label: 'Grassland — field.glb' },
  { value: 'null', label: 'Null — null.glb (toytown)' },
  { value: 'wind', label: 'Wind — wind.glb (cliff)' },
  { value: 'light', label: 'Light — light.glb (monument)' },
] as const;

function loadConfig(): BiomeConfig {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as BiomeConfig;
  } catch {
    return {};
  }
}

function saveConfig(config: BiomeConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    return;
  }
}

export function BiomeEditor(): JSX.Element {
  const [config, setConfig] = useState<BiomeConfig>(() => loadConfig());
  const [selectedBiome, setSelectedBiome] = useState<string>(WORLD_BIOMES[0]);
  const catalogQuery = useQuery({
    queryKey: ['admin', 'catalog'] as const,
    queryFn: getCatalog,
    staleTime: 300_000,
  });

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  const catalog = useMemo(() => catalogQuery.data?.digimons ?? [], [catalogQuery.data]);
  const current = config[selectedBiome] ?? { arenaKey: null, spawns: [] };

  const updateCurrent = (patch: Partial<BiomeOverride>): void => {
    setConfig((prev) => ({
      ...prev,
      [selectedBiome]: { ...current, ...patch },
    }));
  };

  const addSpawn = (catalogId: string): void => {
    if (current.spawns.some((s) => s.catalogId === catalogId)) return;
    updateCurrent({ spawns: [...current.spawns, { catalogId, weight: 10 }] });
  };

  const removeSpawn = (catalogId: string): void => {
    updateCurrent({ spawns: current.spawns.filter((s) => s.catalogId !== catalogId) });
  };

  const updateWeight = (catalogId: string, weight: number): void => {
    updateCurrent({
      spawns: current.spawns.map((s) => (s.catalogId === catalogId ? { catalogId, weight } : s)),
    });
  };

  const resetBiome = (): void => {
    setConfig((prev) => {
      const next = { ...prev };
      delete next[selectedBiome];
      return next;
    });
  };

  const totalWeight = current.spawns.reduce((sum, s) => sum + s.weight, 0);
  const availableToAdd = catalog.filter((t) => !current.spawns.some((s) => s.catalogId === t.id));
  const configuredCount = Object.keys(config).length;

  return (
    <div className="biome-editor">
      <header className="biome-editor-head">
        <div>
          <h2>Biome editor</h2>
          <p className="biome-editor-note">
            Per-biome arena backdrop + spawn weights. Overrides apply the next time an encounter starts.
            <br />
            <strong>Phase-1:</strong> UI + config persist to localStorage. Server-side spawn integration is Phase-2.
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
          {WORLD_BIOMES.map((biome) => {
            const isActive = biome === selectedBiome;
            const hasOverride = config[biome] !== undefined;
            return (
              <button
                key={biome}
                type="button"
                className={`biome-editor-item${isActive ? ' is-active' : ''}${hasOverride ? ' has-override' : ''}`}
                onClick={() => setSelectedBiome(biome)}
              >
                <span className="biome-editor-item-name">{biome}</span>
                {hasOverride ? <span className="biome-editor-item-dot" title="Has override" /> : null}
              </button>
            );
          })}
        </aside>

        <section className="biome-editor-panel">
          <div className="biome-editor-panel-head">
            <h3>{selectedBiome}</h3>
            <button type="button" className="scene-admin-reset" onClick={resetBiome} disabled={config[selectedBiome] === undefined}>Reset biome</button>
          </div>

          <fieldset className="biome-editor-fieldset">
            <legend>Arena backdrop</legend>
            <div className="biome-editor-arena-options">
              {ARENA_OPTIONS.map((opt) => {
                const active = (current.arenaKey ?? '') === opt.value;
                return (
                  <label key={opt.value} className={`biome-editor-arena-opt${active ? ' is-active' : ''}`}>
                    <input
                      type="radio"
                      name="arena-key"
                      value={opt.value}
                      checked={active}
                      onChange={() => updateCurrent({ arenaKey: opt.value === '' ? null : opt.value as 'plant' | 'steel' | 'water' | 'rock' | 'dark' })}
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="biome-editor-fieldset">
            <legend>
              Spawn list ({current.spawns.length} mon{current.spawns.length === 1 ? '' : 's'})
              {totalWeight > 0 ? <span className="biome-editor-total"> · total weight: {totalWeight}</span> : null}
            </legend>
            {catalogQuery.isPending ? (
              <div className="biome-editor-empty">Loading catalog…</div>
            ) : (
              <>
                <div className="biome-editor-spawn-add">
                  <select
                    onChange={(e) => {
                      const id = e.currentTarget.value;
                      if (id !== '') addSpawn(id);
                      e.currentTarget.value = '';
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>— add digimon to spawn pool —</option>
                    {availableToAdd.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} · {t.stage} · {t.element}</option>
                    ))}
                  </select>
                </div>

                {current.spawns.length === 0 ? (
                  <div className="biome-editor-empty">No spawns configured — biome falls back to element-based pool.</div>
                ) : (
                  <div className="biome-editor-spawn-list">
                    {current.spawns.map((spawn) => {
                      const meta = catalog.find((t) => t.id === spawn.catalogId);
                      const pct = totalWeight > 0 ? (spawn.weight / totalWeight) * 100 : 0;
                      return (
                        <div key={spawn.catalogId} className="biome-editor-spawn-row">
                          <img className="biome-editor-spawn-icon" src={`/assets/digimon/${spawn.catalogId}/dot.gif`} alt="" aria-hidden="true" />
                          <div className="biome-editor-spawn-meta">
                            <b>{meta?.name ?? spawn.catalogId}</b>
                            <span>{meta?.stage ?? '?'} · {meta?.element ?? '?'}</span>
                          </div>
                          <label className="biome-editor-spawn-weight">
                            weight
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={spawn.weight}
                              onChange={(e) => {
                                const n = Number(e.currentTarget.value);
                                if (Number.isFinite(n) && n >= 0) updateWeight(spawn.catalogId, n);
                              }}
                            />
                          </label>
                          <span className="biome-editor-spawn-pct">{pct.toFixed(1)}%</span>
                          <button type="button" className="biome-editor-spawn-remove" onClick={() => removeSpawn(spawn.catalogId)} aria-label={`Remove ${meta?.name ?? spawn.catalogId}`}>×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </fieldset>

          <details className="biome-editor-fieldset biome-editor-scene-fieldset">
            <summary>Scene settings (shared across all biomes for now)</summary>
            <div className="biome-editor-scene-wrap">
              <SceneSettingsAdmin />
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}
