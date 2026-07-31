import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { ELEMENTS, type Element } from '@digiworld/shared/digimon';
import { ELEMENT_TO_ARENA_KEY, type SceneEntity } from '@digiworld/shared/scene';

import { copyScene, createScene, deleteScene, getScenes, invalidateScenesCache, updateScene } from '../../lib/api-scenes';
import { ARENA_FILE_LIST } from '../../scene3d/arena-urls';
import type { SceneSettings } from '../../scene3d/scene';
import { ScenePreview } from './ScenePreview';

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

type SceneDraft = {
  readonly name: string;
  readonly elements: readonly Element[];
  readonly useGlbSettings: boolean;
  readonly settings: Partial<SceneSettings>;
};

function draftFromScene(scene: SceneEntity): SceneDraft {
  return {
    name: scene.name,
    elements: scene.elements,
    useGlbSettings: scene.useGlbSettings === true,
    settings: (scene.settings as Partial<SceneSettings>) ?? {},
  };
}

function toHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function fromHex(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

function arenaKeyForDraft(draft: SceneDraft): string {
  const first = draft.elements[0];
  if (first !== undefined) return ELEMENT_TO_ARENA_KEY[first];
  return 'steel';
}

function draftsEqual(a: SceneDraft, b: SceneDraft): boolean {
  if (a.name !== b.name) return false;
  if (a.useGlbSettings !== b.useGlbSettings) return false;
  if (a.elements.length !== b.elements.length) return false;
  const aSet = new Set<Element>(a.elements);
  for (const el of b.elements) if (!aSet.has(el)) return false;
  const aKeys = Object.keys(a.settings);
  const bKeys = Object.keys(b.settings);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if ((a.settings as Record<string, unknown>)[k] !== (b.settings as Record<string, unknown>)[k]) return false;
  }
  return true;
}

export function SceneSettingsAdmin(): JSX.Element {
  const [scenes, setScenes] = useState<readonly SceneEntity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SceneDraft | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [busy, setBusy] = useState<'copy' | 'delete' | 'create' | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invalidateScenesCache();
    getScenes(true)
      .then((list) => {
        if (cancelled) return;
        setScenes(list);
        if (list.length > 0 && selectedId === null) {
          const first = list[0];
          if (first !== undefined) {
            setSelectedId(first.id);
            setDraft(draftFromScene(first));
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'failed to load scenes');
      });
    return () => { cancelled = true; };
  }, []);

  const selectedScene = useMemo(() => scenes.find((s) => s.id === selectedId) ?? null, [scenes, selectedId]);
  const dirty = useMemo(() => (draft !== null && selectedScene !== null ? !draftsEqual(draft, draftFromScene(selectedScene)) : false), [draft, selectedScene]);

  const effectiveSettings: SceneSettings = useMemo(() => ({
    ...DEFAULT_SETTINGS,
    ...(draft?.settings ?? {}),
  }), [draft]);

  const previewArenaKey = draft !== null ? arenaKeyForDraft(draft) : 'steel';

  const selectScene = (id: string): void => {
    setSelectedId(id);
    const scene = scenes.find((s) => s.id === id);
    if (scene !== undefined) setDraft(draftFromScene(scene));
    setSaveStatus('idle');
  };

  const patchSettings = (change: Partial<SceneSettings>): void => {
    setDraft((prev) => {
      if (prev === null) return prev;
      const nextSettings = { ...prev.settings } as Record<string, unknown>;
      for (const [k, v] of Object.entries(change)) {
        if (v === undefined) delete nextSettings[k];
        else nextSettings[k] = v;
      }
      return { ...prev, settings: nextSettings as Partial<SceneSettings> };
    });
  };

  const clearSetting = (key: keyof SceneSettings): void => {
    setDraft((prev) => {
      if (prev === null) return prev;
      const nextSettings = { ...prev.settings } as Record<string, unknown>;
      delete nextSettings[key as string];
      return { ...prev, settings: nextSettings as Partial<SceneSettings> };
    });
  };

  const toggleElement = (el: Element): void => {
    setDraft((prev) => {
      if (prev === null) return prev;
      const has = prev.elements.includes(el);
      const next = has ? prev.elements.filter((x) => x !== el) : [...prev.elements, el];
      return { ...prev, elements: next };
    });
  };

  const setName = (name: string): void => setDraft((prev) => (prev === null ? prev : { ...prev, name }));
  const setUseGlbSettings = (useGlb: boolean): void => setDraft((prev) => (prev === null ? prev : { ...prev, useGlbSettings: useGlb }));

  const handleNew = async (): Promise<void> => {
    setBusy('create');
    try {
      const res = await createScene({ name: 'New scene', elements: [], settings: {} });
      const list = await getScenes(true);
      setScenes(list);
      setSelectedId(res.scene.id);
      setDraft(draftFromScene(res.scene));
      setSaveStatus('idle');
    } catch {
      setSaveStatus('error');
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (selectedId === null) return;
    setBusy('copy');
    try {
      const res = await copyScene(selectedId);
      const list = await getScenes(true);
      setScenes(list);
      setSelectedId(res.scene.id);
      setDraft(draftFromScene(res.scene));
      setSaveStatus('idle');
    } catch {
      setSaveStatus('error');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (selectedId === null) return;
    if (!window.confirm(`Delete scene "${selectedScene?.name ?? selectedId}"? This cannot be undone.`)) return;
    setBusy('delete');
    try {
      await deleteScene(selectedId);
      const list = await getScenes(true);
      setScenes(list);
      const next = list[0];
      if (next !== undefined) {
        setSelectedId(next.id);
        setDraft(draftFromScene(next));
      } else {
        setSelectedId(null);
        setDraft(null);
      }
      setSaveStatus('idle');
    } catch {
      setSaveStatus('error');
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (selectedId === null || draft === null) return;
    setSaveStatus('saving');
    try {
      const res = await updateScene(selectedId, {
        name: draft.name,
        elements: draft.elements,
        settings: draft.settings,
        useGlbSettings: draft.useGlbSettings,
      });
      const list = await getScenes(true);
      setScenes(list);
      setDraft(draftFromScene(res.scene));
      setSaveStatus('saved');
      window.setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
      window.setTimeout(() => setSaveStatus('idle'), 4000);
    }
  };

  return (
    <div className="scene-admin scene-admin-fullsize scene-admin-crud">
      <aside className="scene-admin-list-panel" aria-label="Scene list">
        <header className="scene-admin-list-header">
          <h2>Scenes</h2>
          <button type="button" onClick={() => { void handleNew(); }} disabled={busy !== null}>
            {busy === 'create' ? 'Creating…' : 'New scene'}
          </button>
        </header>
        {loadError !== null ? <p className="scene-admin-error">{loadError}</p> : null}
        <ul className="scene-admin-list">
          {scenes.length === 0 ? (
            <li className="scene-admin-list-empty">No scenes yet. Click <b>New scene</b> to create one.</li>
          ) : (
            scenes.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`scene-admin-list-item${selectedId === s.id ? ' is-selected' : ''}`}
                  onClick={() => selectScene(s.id)}
                >
                  <span className="scene-admin-list-name">{s.name}</span>
                  <span className="scene-admin-list-meta">
                    {s.useGlbSettings === true ? 'GLB' : 'settings'}
                    {s.elements.length > 0 ? ` · ${s.elements.join(', ')}` : ''}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      {draft === null || selectedScene === null ? (
        <section className="scene-admin-canvas-layer scene-admin-empty" aria-label="No scene selected">
          <p>Select a scene from the list, or create a new one to start editing.</p>
        </section>
      ) : (
        <>
          <section className="scene-admin-canvas-layer" aria-label="Live scene preview">
            <ScenePreview arenaKey={previewArenaKey} settings={effectiveSettings} />
          </section>
          <aside className="scene-admin-controls-panel" aria-label="Scene controls">
            <header className="scene-admin-header">
              <div>
                <h2>Editing: {draft.name}</h2>
                <p className="scene-admin-note">
                  Elements tag this scene for auto-pick during PVE / PVP.
                  {draft.useGlbSettings ? ' GLB mode: the mesh drives lighting; settings below are ignored.' : ' Settings mode: the sliders below drive lighting and fog.'}
                </p>
              </div>
              <div className="scene-admin-header-actions">
                <button type="button" onClick={() => { void handleSave(); }} disabled={!dirty || saveStatus === 'saving'}>
                  {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Error' : 'Save'}
                </button>
                <button type="button" onClick={() => { void handleCopy(); }} disabled={busy !== null}>
                  {busy === 'copy' ? 'Copying…' : 'Duplicate'}
                </button>
                <button type="button" className="scene-admin-danger" onClick={() => { void handleDelete(); }} disabled={busy !== null}>
                  {busy === 'delete' ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </header>

            <section className="scene-admin-meta">
              <label className="scene-admin-row">
                <span className="scene-admin-label">Name</span>
                <input type="text" value={draft.name} maxLength={120} onChange={(e) => setName(e.currentTarget.value)} />
              </label>
              <label className="scene-admin-row scene-admin-row--toggle">
                <span className="scene-admin-label">Use GLB embedded lighting</span>
                <input type="checkbox" checked={draft.useGlbSettings} onChange={(e) => setUseGlbSettings(e.currentTarget.checked)} />
                <span className="scene-admin-value">{draft.useGlbSettings ? 'ON' : 'OFF'}</span>
              </label>
              <div className="scene-admin-row scene-admin-row--elements">
                <span className="scene-admin-label">Elements</span>
                <div className="scene-admin-element-chips">
                  {ELEMENTS.map((el) => {
                    const active = draft.elements.includes(el);
                    return (
                      <button
                        key={el}
                        type="button"
                        className={`scene-admin-chip${active ? ' is-active' : ''}`}
                        onClick={() => toggleElement(el)}
                      >
                        {el}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="scene-admin-model-picker">
              <label className="scene-admin-model-picker-label">
                <span>Model file</span>
                <select
                  value={(draft.settings.modelFile as string | undefined) ?? ''}
                  onChange={(e) => {
                    const next = e.currentTarget.value;
                    if (next === '') {
                      setDraft((prev) => {
                        if (prev === null) return prev;
                        const s = { ...prev.settings } as Record<string, unknown>;
                        delete s['modelFile'];
                        return { ...prev, settings: s as Partial<SceneSettings> };
                      });
                    } else {
                      patchSettings({ modelFile: next });
                    }
                  }}
                >
                  <option value="">— no model (default per-element fallback) —</option>
                  {ARENA_FILE_LIST.map((filename) => (
                    <option key={filename} value={filename}>{filename}</option>
                  ))}
                </select>
              </label>
              <p className="scene-admin-note">
                Any <code>.glb</code> in <code>frontend/src/assets/arenas/</code>. Leave empty to use the built-in arena mesh for the scene's primary element.
              </p>
            </section>

            {draft.useGlbSettings ? (
              <section className="scene-admin-glb-notice">
                <p>
                  <b>GLB embedded lighting is ON.</b> Combat will render this scene using whatever the GLB itself defines.
                  The settings below are stored but ignored at render time.
                </p>
              </section>
            ) : null}

            <fieldset className="scene-admin-grid" disabled={draft.useGlbSettings}>
              <Section title="Sun (key light)">
                <ColorRow label="Color" value={effectiveSettings.sunColor} onChange={(v) => patchSettings({ sunColor: v })} />
                <SliderRow label="Intensity" value={effectiveSettings.sunIntensity} min={0} max={3} step={0.02} onChange={(v) => patchSettings({ sunIntensity: v })} />
                <SliderRow label="Pos X" value={effectiveSettings.sunPosX} min={-20} max={20} step={0.1} onChange={(v) => patchSettings({ sunPosX: v })} />
                <SliderRow label="Pos Y" value={effectiveSettings.sunPosY} min={0} max={25} step={0.1} onChange={(v) => patchSettings({ sunPosY: v })} />
                <SliderRow label="Pos Z" value={effectiveSettings.sunPosZ} min={-20} max={20} step={0.1} onChange={(v) => patchSettings({ sunPosZ: v })} />
              </Section>

              <Section title="Shadows">
                <ToggleRow label="Enabled" value={effectiveSettings.shadowsEnabled} onChange={(v) => patchSettings({ shadowsEnabled: v })} />
                <SliderRow label="Softness" value={effectiveSettings.shadowRadius} min={0} max={20} step={0.5} onChange={(v) => patchSettings({ shadowRadius: v })} />
                <SliderRow label="Bias" value={effectiveSettings.shadowBias} min={-0.01} max={0.01} step={0.0001} onChange={(v) => patchSettings({ shadowBias: v })} decimals={4} />
                <SliderRow label="Normal bias" value={effectiveSettings.shadowNormalBias} min={0} max={0.2} step={0.005} onChange={(v) => patchSettings({ shadowNormalBias: v })} decimals={3} />
                <SelectRow label="Map size" value={effectiveSettings.shadowMapSize} options={[512, 1024, 2048, 4096]} onChange={(v) => patchSettings({ shadowMapSize: v })} />
              </Section>

              <Section title="Fog">
                <ToggleRow label="Enabled" value={effectiveSettings.fogEnabled} onChange={(v) => patchSettings({ fogEnabled: v })} />
                <RadioRow label="Mode" value={effectiveSettings.fogMode} options={[{ label: 'Linear', value: 'linear' }, { label: 'Volumetric (exp²)', value: 'exp2' }, { label: 'Height', value: 'height' }]} onChange={(v) => patchSettings({ fogMode: v as 'linear' | 'exp2' | 'height' })} />
                <ColorRow label="Color" value={effectiveSettings.fogColor} onChange={(v) => patchSettings({ fogColor: v })} />
                {effectiveSettings.fogMode === 'linear' ? (
                  <>
                    <SliderRow label="Near" value={effectiveSettings.fogNear} min={0} max={80} step={0.5} onChange={(v) => patchSettings({ fogNear: v })} />
                    <SliderRow label="Far" value={effectiveSettings.fogFar} min={5} max={120} step={0.5} onChange={(v) => patchSettings({ fogFar: v })} />
                  </>
                ) : effectiveSettings.fogMode === 'exp2' ? (
                  <SliderRow label="Density" value={effectiveSettings.fogDensity} min={0} max={0.2} step={0.001} onChange={(v) => patchSettings({ fogDensity: v })} decimals={3} />
                ) : (
                  <>
                    <SliderRow label="Density" value={effectiveSettings.fogDensity} min={0.001} max={0.1} step={0.0001} onChange={(v) => patchSettings({ fogDensity: v })} decimals={4} />
                    <SliderRow label="Height" value={effectiveSettings.fogHeight} min={-5} max={5} step={0.05} onChange={(v) => patchSettings({ fogHeight: v })} decimals={2} />
                  </>
                )}
              </Section>

              <Section title="Hemisphere (ambient)">
                <ColorRow label="Sky" value={effectiveSettings.hemiSkyColor} onChange={(v) => patchSettings({ hemiSkyColor: v })} />
                <ColorRow label="Ground" value={effectiveSettings.hemiGroundColor} onChange={(v) => patchSettings({ hemiGroundColor: v })} />
                <SliderRow label="Intensity" value={effectiveSettings.hemiIntensity} min={0} max={2} step={0.02} onChange={(v) => patchSettings({ hemiIntensity: v })} />
              </Section>

              <Section title="Rim light">
                <ColorRow label="Color" value={effectiveSettings.rimColor} onChange={(v) => patchSettings({ rimColor: v })} />
                <SliderRow label="Intensity" value={effectiveSettings.rimIntensity} min={0} max={2} step={0.02} onChange={(v) => patchSettings({ rimIntensity: v })} />
              </Section>

              <Section title="Fill light">
                <ColorRow label="Color" value={effectiveSettings.fillColor} onChange={(v) => patchSettings({ fillColor: v })} />
                <SliderRow label="Intensity" value={effectiveSettings.fillIntensity} min={0} max={2} step={0.02} onChange={(v) => patchSettings({ fillIntensity: v })} />
              </Section>

              <Section title="Camera">
                <RadioRow label="Type" value={effectiveSettings.cameraType} options={[{ label: 'Orthographic', value: 'ortho' }, { label: 'Perspective', value: 'perspective' }]} onChange={(v) => patchSettings({ cameraType: v as 'ortho' | 'perspective' })} />
                <SliderRow label="Elevation°" value={effectiveSettings.camElevDeg} min={0} max={80} step={0.5} onChange={(v) => patchSettings({ camElevDeg: v })} />
                <SliderRow label="Yaw°" value={effectiveSettings.camYawDeg} min={-90} max={90} step={0.5} onChange={(v) => patchSettings({ camYawDeg: v })} />
                <SliderRow label="Distance" value={effectiveSettings.camDist} min={4} max={40} step={0.2} onChange={(v) => patchSettings({ camDist: v })} />
                <SliderRow label="Look-at Y" value={effectiveSettings.camLookAtY} min={-2} max={5} step={0.05} onChange={(v) => patchSettings({ camLookAtY: v })} />
                {effectiveSettings.cameraType === 'perspective'
                  ? <SliderRow label="Field of view°" value={effectiveSettings.camFov} min={20} max={90} step={1} onChange={(v) => patchSettings({ camFov: v })} decimals={0} />
                  : <SliderRow label="Frustum" value={effectiveSettings.camFrustum} min={1} max={12} step={0.1} onChange={(v) => patchSettings({ camFrustum: v })} />}
              </Section>

              <Section title="Arena position">
                <SliderRow label="Scene size" value={effectiveSettings.arenaSpan} min={5} max={200} step={1} onChange={(v) => patchSettings({ arenaSpan: v })} decimals={0} />
                <SliderRow label="Offset X (←→)" value={effectiveSettings.arenaOffsetX} min={-50} max={50} step={0.2} onChange={(v) => patchSettings({ arenaOffsetX: v })} decimals={1} />
                <SliderRow label="Offset Y (↑↓)" value={effectiveSettings.arenaOffsetY} min={-50} max={50} step={0.2} onChange={(v) => patchSettings({ arenaOffsetY: v })} decimals={1} />
                <SliderRow label="Offset Z (fwd/back)" value={effectiveSettings.arenaOffsetZ} min={-50} max={50} step={0.2} onChange={(v) => patchSettings({ arenaOffsetZ: v })} decimals={1} />
              </Section>

              <Section title="Effects">
                <SliderRow label="Exposure" value={effectiveSettings.exposure} min={0.2} max={2.5} step={0.02} onChange={(v) => patchSettings({ exposure: v })} />
                <SliderRow label="Dust opacity" value={effectiveSettings.dustOpacity} min={0} max={1} step={0.02} onChange={(v) => patchSettings({ dustOpacity: v })} />
              </Section>
            </fieldset>
          </aside>
        </>
      )}
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
