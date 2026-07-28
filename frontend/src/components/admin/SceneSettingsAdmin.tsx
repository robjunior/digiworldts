import { useEffect, useMemo, useState } from 'react';

import { apiFetch } from '../../lib/api';
import { getSceneDefaults, replaceSceneDefaultsCache, type PerArenaSceneDefaults } from '../../lib/scene-defaults';
import { ARENA_FILE_LIST } from '../../scene3d/arena-urls';
import type { SceneSettings } from '../../scene3d/scene';
import { ScenePreview } from './ScenePreview';

const STORAGE_KEY = 'digiworld.scene-settings-override';
const BASELINE_STORAGE_KEY = 'digiworld.scene-defaults-baseline';

const PREVIEW_ARENAS = ['plant', 'steel', 'water', 'rock', 'dark', 'fire', 'ice', 'field', 'null', 'wind', 'light'] as const;
type PreviewArenaKey = (typeof PREVIEW_ARENAS)[number];
const PREVIEW_ARENA_SET: ReadonlySet<string> = new Set<string>(PREVIEW_ARENAS);

type PerArenaOverride = Record<string, Partial<SceneSettings>>;

const DEFAULT_SETTINGS: SceneSettings = {
  sunColor: 0xfff2d0,
  sunIntensity: 1.0,
  sunPosX: -6,
  sunPosY: 10,
  sunPosZ: 5,
  shadowsEnabled: true,
  shadowRadius: 8,
  shadowBias: -0.0005,
  shadowNormalBias: 0.02,
  shadowMapSize: 2048,
  fogEnabled: true,
  fogMode: 'linear',
  fogColor: 0x1e2a44,
  fogNear: 12,
  fogFar: 32,
  fogDensity: 0.035,
  fogHeight: 2,
  hemiSkyColor: 0x88a8d0,
  hemiGroundColor: 0x1b2130,
  hemiIntensity: 0.62,
  rimColor: 0x2c74ff,
  rimIntensity: 0.55,
  fillColor: 0xffd18a,
  fillIntensity: 0.28,
  exposure: 1.05,
  dustOpacity: 0.2,
  camElevDeg: 22,
  camYawDeg: 22,
  camDist: 14,
  camLookAtY: 0.6,
  camFrustum: 4.5,
  cameraType: 'ortho',
  camFov: 45,
  arenaSpan: 28,
  arenaOffsetX: 0,
  arenaOffsetY: 0,
  arenaOffsetZ: 0,
};

function loadOverride(): PerArenaOverride {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const obj = parsed as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length > 0 && !keys.every((k) => PREVIEW_ARENA_SET.has(k))) return {};
    const out: PerArenaOverride = {};
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'object' && v !== null) out[k] = v as Partial<SceneSettings>;
    }
    return out;
  } catch {
    return {};
  }
}

function toHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function fromHex(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

const PRESETS_STORAGE_KEY = 'digiworld.scene-presets';

type Presets = Record<string, Partial<SceneSettings>>;

function loadPresets(): Presets {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PRESETS_STORAGE_KEY);
    if (raw === null) return {};
    return JSON.parse(raw) as Presets;
  } catch {
    return {};
  }
}

function savePresetsToStorage(presets: Presets): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    return;
  }
}

function arenaHash(defaults: Partial<SceneSettings> | undefined): string {
  return JSON.stringify(defaults ?? {});
}

function loadBaseline(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(BASELINE_STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function SceneSettingsAdmin(): JSX.Element {
  const [override, setOverride] = useState<PerArenaOverride>(() => loadOverride());
  const [baseline, setBaseline] = useState<Record<string, string>>(() => loadBaseline());
  const [codeDefaults, setCodeDefaults] = useState<PerArenaSceneDefaults>({});
  const [presets, setPresets] = useState<Presets>(() => loadPresets());
  const [presetName, setPresetName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [previewArena, setPreviewArena] = useState<PreviewArenaKey>('plant');
  const [copyFrom, setCopyFrom] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getSceneDefaults(true)
      .then((remoteDefaults) => {
        if (!cancelled) setCodeDefaults(remoteDefaults);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const overrideKeys = Object.keys(override);
    if (overrideKeys.length === 0) return;
    const nextOverride: PerArenaOverride = { ...override };
    const nextBaseline: Record<string, string> = { ...baseline };
    let baselineChanged = false;
    let overrideChanged = false;
    for (const arena of overrideKeys) {
      const currentHash = arenaHash(codeDefaults[arena]);
      const recordedHash = baseline[arena];
      if (recordedHash === undefined) {
        nextBaseline[arena] = currentHash;
        baselineChanged = true;
      } else if (recordedHash !== currentHash) {
        delete nextOverride[arena];
        delete nextBaseline[arena];
        overrideChanged = true;
        baselineChanged = true;
      }
    }
    if (overrideChanged) setOverride(nextOverride);
    if (baselineChanged) setBaseline(nextBaseline);
  }, [codeDefaults]);

  useEffect(() => {
    try {
      const hasAny = Object.keys(baseline).length > 0;
      if (hasAny) window.localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baseline));
      else window.localStorage.removeItem(BASELINE_STORAGE_KEY);
    } catch { /* noop */ }
  }, [baseline]);

  const settings: SceneSettings = useMemo(() => ({
    ...DEFAULT_SETTINGS,
    ...(codeDefaults[previewArena] ?? {}),
    ...(override[previewArena] ?? {}),
  }), [previewArena, codeDefaults, override]);

  const overrideForArena = useMemo(() => override[previewArena] ?? {}, [override, previewArena]);

  useEffect(() => {
    try {
      const pruned: PerArenaOverride = {};
      let hasAny = false;
      for (const [k, v] of Object.entries(override)) {
        if (v && Object.keys(v).length > 0) {
          pruned[k] = v;
          hasAny = true;
        }
      }
      if (hasAny) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch { /* noop */ }
  }, [override]);

  const patch = (change: Partial<SceneSettings>): void => {
    setOverride((prev) => {
      const arenaCode = codeDefaults[previewArena] ?? {};
      const arenaOverride = { ...(prev[previewArena] ?? {}) };
      for (const [k, v] of Object.entries(change)) {
        const key = k as keyof SceneSettings;
        const codeBaseline = (arenaCode as Record<string, unknown>)[key];
        const baseline = codeBaseline !== undefined ? codeBaseline : (DEFAULT_SETTINGS as Record<string, unknown>)[key];
        if (v === baseline) delete (arenaOverride as Record<string, unknown>)[key];
        else (arenaOverride as Record<string, unknown>)[key] = v;
      }
      return { ...prev, [previewArena]: arenaOverride };
    });
  };

  const resetArena = (): void => {
    setOverride((prev) => {
      const next = { ...prev };
      delete next[previewArena];
      return next;
    });
    setBaseline((prev) => {
      if (!(previewArena in prev)) return prev;
      const next = { ...prev };
      delete next[previewArena];
      return next;
    });
  };

  const clearAllOverrides = (): void => {
    setOverride({});
    setBaseline({});
  };

  const savePreset = (): void => {
    const name = presetName.trim();
    if (name === '') return;
    const next = { ...presets, [name]: { ...overrideForArena } };
    savePresetsToStorage(next);
    setPresets(next);
    setPresetName('');
    setSelectedPreset(name);
  };

  const applyPreset = (name: string): void => {
    setSelectedPreset(name);
    if (name === '') return;
    const preset = presets[name];
    if (preset === undefined) return;
    setOverride((prev) => ({ ...prev, [previewArena]: { ...preset } }));
  };

  const deletePreset = (): void => {
    if (selectedPreset === '') return;
    const next = { ...presets };
    delete next[selectedPreset];
    savePresetsToStorage(next);
    setPresets(next);
    setSelectedPreset('');
  };

  const saveToCode = async (): Promise<void> => {
    setSaveStatus('saving');
    try {
      const nextCode: PerArenaSceneDefaults = { ...codeDefaults };
      const currentCode = codeDefaults[previewArena] ?? {};
      const merged: Partial<SceneSettings> = { ...currentCode, ...overrideForArena };
      if (Object.keys(merged).length > 0) nextCode[previewArena] = merged;
      else delete nextCode[previewArena];
      const body = await apiFetch<{ ok: true; defaults: PerArenaSceneDefaults }>('/api/admin/scene-defaults', { method: 'POST', body: nextCode });
      setCodeDefaults(body.defaults);
      replaceSceneDefaultsCache(body.defaults);
      setOverride((prev) => {
        const next = { ...prev };
        delete next[previewArena];
        return next;
      });
      setBaseline((prev) => {
        if (!(previewArena in prev)) return prev;
        const next = { ...prev };
        delete next[previewArena];
        return next;
      });
      setSaveStatus('saved');
      window.setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
      window.setTimeout(() => setSaveStatus('idle'), 4000);
    }
  };

  const copyFromArena = (sourceKey: string): void => {
    setCopyFrom(sourceKey);
    if (sourceKey === '' || !PREVIEW_ARENA_SET.has(sourceKey) || sourceKey === previewArena) return;
    const sourceCode = codeDefaults[sourceKey] ?? {};
    const sourceOverride = override[sourceKey] ?? {};
    const merged: Partial<SceneSettings> = { ...sourceCode, ...sourceOverride };
    setOverride((prev) => ({ ...prev, [previewArena]: merged }));
    window.setTimeout(() => setCopyFrom(''), 250);
  };

  const overrideCount = Object.keys(overrideForArena).length;
  const codeDefaultCount = Object.keys(codeDefaults[previewArena] ?? {}).length;

  return (
    <div className="scene-admin scene-admin-fullsize">
      <section className="scene-admin-canvas-layer" aria-label="Live scene preview">
        <div className="scene-admin-arena-picker" role="tablist" aria-label="Arena preview">
          {PREVIEW_ARENAS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={previewArena === key}
              className={`scene-admin-arena-tab${previewArena === key ? ' is-active' : ''}`}
              onClick={() => setPreviewArena(key)}
            >
              {key}
            </button>
          ))}
        </div>
        <ScenePreview arenaKey={previewArena} settings={settings} />
      </section>
      <aside className="scene-admin-controls-panel" aria-label="Scene controls">
        <header className="scene-admin-header">
        <div>
          <h2>Scene lighting &amp; atmosphere</h2>
          <p className="scene-admin-note">
            Each arena keeps its own settings — tweaking <b>{previewArena}</b> does not affect other arenas.
            Use <b>Copy from</b> to clone another arena&rsquo;s settings into this one.
            <br />
            Changes take effect the next time combat starts (or on page reload).
          </p>
        </div>
        <div className="scene-admin-header-actions">
          <span className="scene-admin-badge" data-active={overrideCount > 0 ? '1' : '0'}>
            {overrideCount === 0 ? `${previewArena}: no override` : `${previewArena}: ${overrideCount} override${overrideCount === 1 ? '' : 's'}`}
          </span>
          {codeDefaultCount > 0 ? (
            <span className="scene-admin-badge" data-active="1" title="Saved to code for this arena (server-side default)">
              code: {codeDefaultCount}
            </span>
          ) : null}
          <select
            className="scene-admin-copy-from"
            value={copyFrom}
            onChange={(e) => copyFromArena(e.currentTarget.value)}
            title={`Copy another arena's settings into ${previewArena}`}
          >
            <option value="">Copy from arena…</option>
            {PREVIEW_ARENAS.filter((k) => k !== previewArena).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <button type="button" className="scene-admin-reset" onClick={() => { void saveToCode(); }} disabled={saveStatus === 'saving' || overrideCount === 0}>
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Error' : `Save ${previewArena} to code`}
          </button>
          <button type="button" className="scene-admin-reset" onClick={resetArena} disabled={overrideCount === 0}>Reset arena</button>
          <button
            type="button"
            className="scene-admin-reset"
            onClick={clearAllOverrides}
            disabled={Object.keys(override).length === 0}
            title="Clear ALL local scene overrides for every arena so you see exactly what other users see (server defaults)"
          >
            Reset all local
          </button>
        </div>
      </header>

      <section className="scene-admin-model-picker">
        <label className="scene-admin-model-picker-label">
          <span>Model file</span>
          <select
            value={settings.modelFile ?? ''}
            onChange={(e) => {
              const next = e.currentTarget.value;
              if (next === '') {
                setOverride((prev) => {
                  const arenaOverride = { ...(prev[previewArena] ?? {}) } as Record<string, unknown>;
                  delete arenaOverride.modelFile;
                  return { ...prev, [previewArena]: arenaOverride as Partial<SceneSettings> };
                });
              } else {
                patch({ modelFile: next });
              }
            }}
          >
            <option value="">— use default ({previewArena}.glb) —</option>
            {ARENA_FILE_LIST.map((filename) => (
              <option key={filename} value={filename}>{filename}</option>
            ))}
          </select>
        </label>
        <p className="scene-admin-note">
          Any <code>.glb</code> in <code>frontend/src/assets/arenas/</code> — filename doesn't matter.
          Picks the mesh loaded for the <b>{previewArena}</b> arena in combat.
        </p>
      </section>

      <section className="scene-admin-presets">
        <h3>Presets</h3>
        <div className="scene-admin-presets-row">
          <select value={selectedPreset} onChange={(e) => applyPreset(e.currentTarget.value)}>
            <option value="">— select a preset —</option>
            {Object.keys(presets).sort().map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button type="button" onClick={deletePreset} disabled={selectedPreset === ''}>Delete</button>
          <input
            type="text"
            placeholder="preset name"
            value={presetName}
            onChange={(e) => setPresetName(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); }}
          />
          <button type="button" onClick={savePreset} disabled={presetName.trim() === '' || overrideCount === 0}>Save current arena</button>
        </div>
      </section>

      <div className="scene-admin-grid">
        <Section title="Sun (key light)">
          <ColorRow label="Color" value={settings.sunColor} onChange={(v) => patch({ sunColor: v })} />
          <SliderRow label="Intensity" value={settings.sunIntensity} min={0} max={3} step={0.02} onChange={(v) => patch({ sunIntensity: v })} />
          <SliderRow label="Pos X" value={settings.sunPosX} min={-20} max={20} step={0.1} onChange={(v) => patch({ sunPosX: v })} />
          <SliderRow label="Pos Y" value={settings.sunPosY} min={0} max={25} step={0.1} onChange={(v) => patch({ sunPosY: v })} />
          <SliderRow label="Pos Z" value={settings.sunPosZ} min={-20} max={20} step={0.1} onChange={(v) => patch({ sunPosZ: v })} />
        </Section>

        <Section title="Shadows">
          <ToggleRow label="Enabled" value={settings.shadowsEnabled} onChange={(v) => patch({ shadowsEnabled: v })} />
          <SliderRow label="Softness" value={settings.shadowRadius} min={0} max={20} step={0.5} onChange={(v) => patch({ shadowRadius: v })} />
          <SliderRow label="Bias" value={settings.shadowBias} min={-0.01} max={0.01} step={0.0001} onChange={(v) => patch({ shadowBias: v })} decimals={4} />
          <SliderRow label="Normal bias" value={settings.shadowNormalBias} min={0} max={0.2} step={0.005} onChange={(v) => patch({ shadowNormalBias: v })} decimals={3} />
          <SelectRow label="Map size" value={settings.shadowMapSize} options={[512, 1024, 2048, 4096]} onChange={(v) => patch({ shadowMapSize: v })} />
        </Section>

        <Section title="Fog">
          <ToggleRow label="Enabled" value={settings.fogEnabled} onChange={(v) => patch({ fogEnabled: v })} />
          <RadioRow label="Mode" value={settings.fogMode} options={[{ label: 'Linear', value: 'linear' }, { label: 'Volumetric (exp²)', value: 'exp2' }, { label: 'Height', value: 'height' }]} onChange={(v) => patch({ fogMode: v as 'linear' | 'exp2' | 'height' })} />
          <ColorRow label="Color" value={settings.fogColor} onChange={(v) => patch({ fogColor: v })} />
          {settings.fogMode === 'linear' ? (
            <>
              <SliderRow label="Near" value={settings.fogNear} min={0} max={80} step={0.5} onChange={(v) => patch({ fogNear: v })} />
              <SliderRow label="Far" value={settings.fogFar} min={5} max={120} step={0.5} onChange={(v) => patch({ fogFar: v })} />
            </>
          ) : settings.fogMode === 'exp2' ? (
            <SliderRow label="Density" value={settings.fogDensity} min={0} max={0.2} step={0.001} onChange={(v) => patch({ fogDensity: v })} decimals={3} />
          ) : (
            <>
              <SliderRow label="Density" value={settings.fogDensity} min={0.001} max={0.1} step={0.0001} onChange={(v) => patch({ fogDensity: v })} decimals={4} />
              <SliderRow label="Height" value={settings.fogHeight} min={-5} max={5} step={0.05} onChange={(v) => patch({ fogHeight: v })} decimals={2} />
            </>
          )}
        </Section>

        <Section title="Hemisphere (ambient)">
          <ColorRow label="Sky" value={settings.hemiSkyColor} onChange={(v) => patch({ hemiSkyColor: v })} />
          <ColorRow label="Ground" value={settings.hemiGroundColor} onChange={(v) => patch({ hemiGroundColor: v })} />
          <SliderRow label="Intensity" value={settings.hemiIntensity} min={0} max={2} step={0.02} onChange={(v) => patch({ hemiIntensity: v })} />
        </Section>

        <Section title="Rim light">
          <ColorRow label="Color" value={settings.rimColor} onChange={(v) => patch({ rimColor: v })} />
          <SliderRow label="Intensity" value={settings.rimIntensity} min={0} max={2} step={0.02} onChange={(v) => patch({ rimIntensity: v })} />
        </Section>

        <Section title="Fill light">
          <ColorRow label="Color" value={settings.fillColor} onChange={(v) => patch({ fillColor: v })} />
          <SliderRow label="Intensity" value={settings.fillIntensity} min={0} max={2} step={0.02} onChange={(v) => patch({ fillIntensity: v })} />
        </Section>

        <Section title="Camera">
          <RadioRow label="Type" value={settings.cameraType} options={[{ label: 'Orthographic', value: 'ortho' }, { label: 'Perspective', value: 'perspective' }]} onChange={(v) => patch({ cameraType: v as 'ortho' | 'perspective' })} />
          <SliderRow label="Elevation°" value={settings.camElevDeg} min={0} max={80} step={0.5} onChange={(v) => patch({ camElevDeg: v })} />
          <SliderRow label="Yaw°" value={settings.camYawDeg} min={-90} max={90} step={0.5} onChange={(v) => patch({ camYawDeg: v })} />
          <SliderRow label="Distance" value={settings.camDist} min={4} max={40} step={0.2} onChange={(v) => patch({ camDist: v })} />
          <SliderRow label="Look-at Y" value={settings.camLookAtY} min={-2} max={5} step={0.05} onChange={(v) => patch({ camLookAtY: v })} />
          {settings.cameraType === 'perspective'
            ? <SliderRow label="Field of view°" value={settings.camFov} min={20} max={90} step={1} onChange={(v) => patch({ camFov: v })} decimals={0} />
            : <SliderRow label="Frustum" value={settings.camFrustum} min={1} max={12} step={0.1} onChange={(v) => patch({ camFrustum: v })} />}
        </Section>

        <Section title="Arena position">
          <SliderRow label="Scene size" value={settings.arenaSpan} min={5} max={200} step={1} onChange={(v) => patch({ arenaSpan: v })} decimals={0} />
          <SliderRow label="Offset X (←→)" value={settings.arenaOffsetX} min={-50} max={50} step={0.2} onChange={(v) => patch({ arenaOffsetX: v })} decimals={1} />
          <SliderRow label="Offset Y (↑↓)" value={settings.arenaOffsetY} min={-50} max={50} step={0.2} onChange={(v) => patch({ arenaOffsetY: v })} decimals={1} />
          <SliderRow label="Offset Z (fwd/back)" value={settings.arenaOffsetZ} min={-50} max={50} step={0.2} onChange={(v) => patch({ arenaOffsetZ: v })} decimals={1} />
        </Section>

        <Section title="Effects">
          <SliderRow label="Exposure" value={settings.exposure} min={0.2} max={2.5} step={0.02} onChange={(v) => patch({ exposure: v })} />
          <SliderRow label="Dust opacity" value={settings.dustOpacity} min={0} max={1} step={0.02} onChange={(v) => patch({ dustOpacity: v })} />
        </Section>
      </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <details className="scene-admin-section" open>
      <summary>{title}</summary>
      <div className="scene-admin-rows">{children}</div>
    </details>
  );
}

function SliderRow({ label, value, min, max, step, onChange, decimals = 2 }: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onChange: (value: number) => void;
  readonly decimals?: number;
}): JSX.Element {
  return (
    <label className="scene-admin-row">
      <span className="scene-admin-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.currentTarget.value))} />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(decimals))}
        onChange={(e) => {
          const n = Number(e.currentTarget.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

function ColorRow({ label, value, onChange }: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="scene-admin-row scene-admin-row--color">
      <span className="scene-admin-label">{label}</span>
      <input type="color" value={toHex(value)} onChange={(e) => onChange(fromHex(e.currentTarget.value))} />
      <input
        type="text"
        value={toHex(value).toUpperCase()}
        onChange={(e) => {
          const v = e.currentTarget.value.trim();
          if (/^#?[0-9a-f]{6}$/i.test(v)) onChange(fromHex(v.startsWith('#') ? v : `#${v}`));
        }}
      />
    </label>
  );
}

function ToggleRow({ label, value, onChange }: {
  readonly label: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <label className="scene-admin-row scene-admin-row--toggle">
      <span className="scene-admin-label">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span className="scene-admin-value">{value ? 'ON' : 'OFF'}</span>
    </label>
  );
}

function SelectRow({ label, value, options, onChange }: {
  readonly label: string;
  readonly value: number;
  readonly options: readonly number[];
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="scene-admin-row scene-admin-row--select">
      <span className="scene-admin-label">{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.currentTarget.value))}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <span className="scene-admin-value">{value}</span>
    </label>
  );
}

function RadioRow({ label, value, options, onChange }: {
  readonly label: string;
  readonly value: string;
  readonly options: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="scene-admin-row scene-admin-row--radio">
      <span className="scene-admin-label">{label}</span>
      <div className="scene-admin-radio-group">
        {options.map((o) => (
          <label key={o.value} className={`scene-admin-radio${value === o.value ? ' is-active' : ''}`}>
            <input type="radio" name={`radio-${label}`} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}
