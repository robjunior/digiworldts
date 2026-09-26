import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ELEMENTS, type Element } from '@digiworld/shared/digimon';
import { ELEMENT_TO_ARENA_KEY, type SceneEntity } from '@digiworld/shared/scene';
import { WEATHER_PRESETS, TIME_PHASES, WeatherConfigZ, type WeatherConfig, type TimeOfDayConfig, type WeatherPreset, type TimePhase } from '@digiworld/shared/weather';

import { WEATHER_EMITTER_PRESETS } from '@digiworld/scene3d/particles/presets';

import { copyScene, createScene, deleteScene, getScenes, invalidateScenesCache, updateScene } from '../../lib/api-scenes';
import { apiFetch } from '../../lib/api';
import { ARENA_FILE_LIST } from '@digiworld/scene3d/arena-urls';
import { DEFAULT_LOBBY_SCENE, LOBBY_SCENE_NAME, type LobbySceneSettings, type SceneSettings } from '@digiworld/scene3d/scene';
import { ScenePreview } from './ScenePreview';
import { ThreeEditorFrame } from './ThreeEditorFrame';

/**
 * EDITOR-SPLIT PLAN (anotação de esquema):
 * O editor de cenas será separado por consumidor — nursery / city / lobby /
 * combat — com UMA única base CRUD + validação reutilizada (SceneEntity,
 * `kind`, envelope de `settings`). Cada kind liga o seu subset de settings:
 *   - kind 'arena'  -> ArenaSettingsZ (sun/fog/camera/arena/GLB)
 *   - kind 'lobby'  -> LobbySceneSettingsZ (palco da party: formação + drift)
 *   - (futuro) 'nursery' / 'city' -> seus próprios subsets (mesma surface)
 * A seção "Lobby (palco da party)" abaixo e os knobs de arena são os dois
 * subsets atuais; quando o split acontecer, cada um vira uma tab/ab do editor
 * reutilizando createScene/updateScene/getScenes (api-scenes.ts) sem duplicar
 * o CRUD nem o preview. Novos knobs entram no subset — nunca no schema global.
 */

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
  readonly kind?: 'arena' | 'lobby';
  readonly useGlbSettings: boolean;
  readonly settings: Partial<SceneSettings>;
  readonly weather: WeatherConfig | null;
  readonly timeOfDay: TimeOfDayConfig | null;
};

/** Resolves exactly like the frontend lobby lookup: kind:'lobby' first, then the
 *  legacy name. Scenes matching this get the "lobby" badge in the list. */
function isLobbyScene(scene: SceneEntity): boolean {
  return scene.kind === 'lobby'
    || (scene.kind === undefined && scene.name.trim().toLowerCase() === LOBBY_SCENE_NAME.toLowerCase());
}

function draftFromScene(scene: SceneEntity): SceneDraft {
  return {
    name: scene.name,
    elements: scene.elements,
    ...(scene.kind !== undefined ? { kind: scene.kind } : {}),
    useGlbSettings: scene.useGlbSettings === true,
    settings: (scene.settings as Partial<SceneSettings>) ?? {},
    weather: scene.weather ?? null,
    timeOfDay: scene.timeOfDay ?? null,
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
  if (JSON.stringify(a.weather) !== JSON.stringify(b.weather)) return false;
  if (JSON.stringify(a.timeOfDay) !== JSON.stringify(b.timeOfDay)) return false;
  return true;
}

export function SceneSettingsAdmin(): JSX.Element {
  const [scenes, setScenes] = useState<readonly SceneEntity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SceneDraft | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [busy, setBusy] = useState<'copy' | 'delete' | 'create' | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorSceneId, setEditorSceneId] = useState<string | null>(null);

  const [triggerPreset, setTriggerPreset] = useState<WeatherPreset>('rain');
  const [triggerDurationMs, setTriggerDurationMs] = useState(10000);
  const [triggerStatus, setTriggerStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');

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
  const setKind = (kind: 'arena' | 'lobby'): void => setDraft((prev) => (prev === null ? prev : { ...prev, kind }));
  const setUseGlbSettings = (useGlb: boolean): void => setDraft((prev) => (prev === null ? prev : { ...prev, useGlbSettings: useGlb }));

  /* lobby backdrop knobs (nested under settings.lobby) */
  const effectiveLobby: LobbySceneSettings = {
    ...DEFAULT_LOBBY_SCENE,
    ...(draft?.settings.lobby as Partial<LobbySceneSettings> | undefined),
  };

  const patchLobby = (change: Partial<LobbySceneSettings>): void => {
    setDraft((prev) => {
      if (prev === null) return prev;
      const base = {
        ...DEFAULT_LOBBY_SCENE,
        ...(prev.settings.lobby as Partial<LobbySceneSettings> | undefined),
      };
      return {
        ...prev,
        settings: {
          ...prev.settings,
          lobby: { ...base, ...change },
        } as unknown as Partial<SceneSettings>,
      };
    });
  };

  const handleCreateLobby = async (): Promise<void> => {
    const existing = scenes.find(isLobbyScene);
    if (existing !== undefined) {
      selectScene(existing.id);
      return;
    }
    setBusy('create');
    try {
      const res = await createScene({
        name: LOBBY_SCENE_NAME,
        elements: [],
        kind: 'lobby',
        settings: { lobby: DEFAULT_LOBBY_SCENE } as unknown as Record<string, unknown>,
      });
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

  const handleTrigger = async (): Promise<void> => {
    if (selectedId === null) return;
    setTriggerStatus('sending');
    try {
      await apiFetch('/api/admin/weather/trigger', {
        method: 'POST',
        body: {
          sceneId: selectedId,
          weather: { preset: triggerPreset, emitters: [], lighting: {}, transitionMs: 2000 },
          durationMs: triggerDurationMs
        }
      });
      setTriggerStatus('success');
      window.setTimeout(() => setTriggerStatus('idle'), 3000);
    } catch {
      setTriggerStatus('error');
      window.setTimeout(() => setTriggerStatus('idle'), 3000);
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
      // aplaina o subset `lobby` com default no envio: o draft.settings pode
      // carregar o lobby CRU de uma cena legada (ex.: sem partyHeight), e o
      // zod rejeitaria. merge só quando o lobby já existe (arena não ganha).
      const settings = { ...draft.settings };
      if (settings.lobby !== undefined) {
        settings.lobby = {
          ...DEFAULT_LOBBY_SCENE,
          ...(settings.lobby as Partial<LobbySceneSettings> | undefined),
        };
      }
      const res = await updateScene(selectedId, {
        name: draft.name,
        elements: draft.elements,
        kind: draft.kind ?? 'arena',
        settings,
        useGlbSettings: draft.useGlbSettings,
        weather: draft.weather,
        timeOfDay: draft.timeOfDay,
      } as any);
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
    <div className="scene-admin scene-admin-crud">
      <aside className="scene-admin-list-panel" aria-label="Scene list">
        <header className="scene-admin-list-header">
          <h2>Scenes</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="button" onClick={() => { void handleCreateLobby(); }} disabled={busy !== null} title={`Cria ou seleciona a cena "${LOBBY_SCENE_NAME}" (kind: lobby) — o fundo 3D da tela inicial`}>
              {busy === 'create' ? 'Creating…' : 'Lobby'}
            </button>
            <button type="button" onClick={() => { void handleNew(); }} disabled={busy !== null}>
              {busy === 'create' ? 'Creating…' : 'New scene'}
            </button>
          </div>
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
                  <span className="scene-admin-list-name">
                    {s.name}
                    {isLobbyScene(s) && (
                      <span className="scene-admin-list-lobby" title="Cena usada pelo lobby" style={{ marginLeft: 6, padding: '0 6px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'var(--signal, #3b82f6)', color: '#fff', borderRadius: 3 }}>lobby</span>
                    )}
                  </span>
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
            <ScenePreview
              arenaKey={previewArenaKey}
              settings={effectiveSettings}
              weather={draft.weather}
              timeOfDay={draft.timeOfDay}
              useGlbSettings={draft.useGlbSettings}
              lobby={selectedScene !== null && isLobbyScene(selectedScene) ? effectiveLobby : null}
            />
          </section>
          <aside className="scene-admin-controls-panel" aria-label="Scene controls">
            <div className="scene-admin-trigger-tile" style={{ padding: '12px 16px', borderBottom: '1px solid #2a3441', display: 'flex', alignItems: 'center', gap: '16px', background: '#171e28' }}>
              <span className="scene-admin-label" style={{ minWidth: 'max-content', margin: 0 }}>Trigger event:</span>
              <select value={triggerPreset} onChange={(e) => setTriggerPreset(e.currentTarget.value as WeatherPreset)}>
                {WEATHER_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input type="range" min={5000} max={300000} step={1000} value={triggerDurationMs} onChange={(e) => setTriggerDurationMs(Number(e.currentTarget.value))} style={{ width: '100px' }} />
              <span className="scene-admin-value" style={{ width: '60px', textAlign: 'right' }}>{triggerDurationMs}ms</span>
              <button type="button" onClick={() => { void handleTrigger(); }} disabled={triggerStatus === 'sending'} style={{ marginLeft: 'auto' }}>
                {triggerStatus === 'sending' ? 'Broadcasting…' : triggerStatus === 'success' ? 'Sent ✓' : triggerStatus === 'error' ? 'Error' : 'Broadcast'}
              </button>
            </div>
            <header className="scene-admin-header">
              <div>
                <h2>Editing: {draft.name}</h2>
                <p className="scene-admin-note">
                  Elements tag this scene for auto-pick during PVE / PVP.
                  {draft.useGlbSettings ? ' GLB mode: the mesh drives lighting; settings below are ignored.' : ' Settings mode: the sliders below drive lighting and fog.'}
                </p>
              </div>
              <div className="scene-admin-header-actions">
                <button type="button" onClick={() => setEditorSceneId(selectedScene.id)}>
                  Open official Three.js Editor
                </button>
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
                  {typeof draft.settings.modelFile === 'string' && !ARENA_FILE_LIST.includes(draft.settings.modelFile) ? (
                    <option value={draft.settings.modelFile}>Published / custom GLB</option>
                  ) : null}
                  {ARENA_FILE_LIST.map((filename) => (
                    <option key={filename} value={filename}>{filename}</option>
                  ))}
                </select>
              </label>
              <p className="scene-admin-note">
                Any <code>.glb</code> in <code>scene3d/assets/arenas/</code>. Leave empty to use the built-in arena mesh for the scene's primary element.
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

            <div style={{ padding: '0 16px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <RadioRow
                label="Tipo"
                value={draft.kind ?? 'arena'}
                options={[
                  { label: 'Arena (combate)', value: 'arena' },
                  { label: 'Lobby (tela inicial)', value: 'lobby' },
                ]}
                onChange={(v) => setKind(v as 'arena' | 'lobby')}
              />
              <span className="scene-admin-note" style={{ margin: 0 }}>
                {draft.kind === 'lobby'
                  ? 'Renderizada pelo lobby: pedestais da party, chão, partículas e drift de câmera.'
                  : 'Renderizada pelo combate: luz, névoa, câmera e arena.'}
              </span>
            </div>

            <fieldset className="scene-admin-grid" disabled={draft.useGlbSettings && draft.kind !== 'lobby'}>
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

              <Section title="Weather">
                {draft.weather === null ? (
                  <div className="scene-admin-row">
                    <button type="button" onClick={() => setDraft((p) => p === null ? p : { ...p, weather: { preset: 'rain', emitters: [], lighting: {}, transitionMs: 2000 } })}>
                      Add weather
                    </button>
                  </div>
                ) : (
                  <>
                    <StringSelectRow label="Preset" value={draft.weather.preset} options={['none', ...WEATHER_PRESETS]} onChange={(v) => {
                      if (v === 'none') {
                        setDraft((p) => p === null ? p : { ...p, weather: null });
                      } else {
                        setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, preset: v as WeatherPreset } });
                      }
                    }} />
                    <SliderRow label="Transition (ms)" value={draft.weather.transitionMs ?? 2000} min={200} max={10000} step={100} decimals={0} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, transitionMs: v } })} />
                    
                    <div style={{ marginTop: '12px', padding: '12px', background: '#1c2431', borderRadius: '4px' }}>
                      <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#9ca3af' }}>Lighting Overrides</h4>
                      <ColorRow label="Sun color" value={draft.weather.lighting.sunColor ?? 0xffffff} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, sunColor: v } } })} />
                      <SliderRow label="Sun mult" value={draft.weather.lighting.sunIntensityMult ?? 1} min={0} max={3} step={0.05} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, sunIntensityMult: v } } })} />
                      <ColorRow label="Ambient tint" value={draft.weather.lighting.ambientTint ?? 0xffffff} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, ambientTint: v } } })} />
                      <SliderRow label="Ambient dim" value={draft.weather.lighting.ambientDimMult ?? 1} min={0} max={3} step={0.05} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, ambientDimMult: v } } })} />
                      <ToggleRow label="Fog override" value={draft.weather.lighting.fogEnabled ?? false} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, fogEnabled: v } } })} />
                      {draft.weather.lighting.fogEnabled ? (
                        <>
                          <ColorRow label="Fog color" value={draft.weather.lighting.fogColor ?? 0xffffff} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, fogColor: v } } })} />
                          <SliderRow label="Fog density" value={draft.weather.lighting.fogDensity ?? 0.05} min={0} max={0.2} step={0.005} decimals={3} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, fogDensity: v } } })} />
                        </>
                      ) : null}
                      <SliderRow label="Exposure mult" value={draft.weather.lighting.exposureMult ?? 1} min={0.2} max={2} step={0.05} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, exposureMult: v } } })} />
                    </div>

                    {(draft.weather.preset === 'thunderstorm' || draft.weather.preset === 'lightstorm') && (
                      <div style={{ marginTop: '12px', padding: '12px', background: '#1c2431', borderRadius: '4px' }}>
                        <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#9ca3af' }}>Thunder</h4>
                        <ToggleRow label="Enabled" value={draft.weather.lighting.thunder?.enabled ?? false} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, thunder: { ...(p.weather!.lighting.thunder ?? { intervalMs: [5000, 15000], flashColor: 0xffffff, flashIntensity: 4, durationMs: 500, stutterCount: 3 }), enabled: v } } } })} />
                        {draft.weather.lighting.thunder?.enabled && (
                          <>
                            <SliderRow label="Interval (min)" value={draft.weather.lighting.thunder.intervalMs[0]} min={500} max={30000} step={100} decimals={0} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, thunder: { ...p.weather!.lighting.thunder!, intervalMs: [v, p.weather!.lighting.thunder!.intervalMs[1]] } } } })} />
                            <SliderRow label="Interval (max)" value={draft.weather.lighting.thunder.intervalMs[1]} min={500} max={30000} step={100} decimals={0} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, thunder: { ...p.weather!.lighting.thunder!, intervalMs: [p.weather!.lighting.thunder!.intervalMs[0], v] } } } })} />
                            <ColorRow label="Flash color" value={draft.weather.lighting.thunder.flashColor} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, thunder: { ...p.weather!.lighting.thunder!, flashColor: v } } } })} />
                            <SliderRow label="Intensity" value={draft.weather.lighting.thunder.flashIntensity} min={0} max={8} step={0.1} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, thunder: { ...p.weather!.lighting.thunder!, flashIntensity: v } } } })} />
                            <SliderRow label="Duration (ms)" value={draft.weather.lighting.thunder.durationMs} min={100} max={2000} step={50} decimals={0} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, thunder: { ...p.weather!.lighting.thunder!, durationMs: v } } } })} />
                            <SliderRow label="Stutters" value={draft.weather.lighting.thunder.stutterCount} min={1} max={6} step={1} decimals={0} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: { ...p.weather!, lighting: { ...p.weather!.lighting, thunder: { ...p.weather!.lighting.thunder!, stutterCount: v } } } })} />
                          </>
                        )}
                      </div>
                    )}

                    <details style={{ marginTop: '12px' }}>
                      <summary style={{ cursor: 'pointer', color: '#60a5fa', fontSize: '13px' }}>Advanced: edit full weather JSON</summary>
                      <WeatherJsonEditor weather={draft.weather} onChange={(v) => setDraft((p) => p === null ? p : { ...p, weather: v })} />
                    </details>
                  </>
                )}
              </Section>

              <Section title="Time of day">
                {draft.timeOfDay === null ? (
                  <div className="scene-admin-row">
                    <button type="button" onClick={() => setDraft((p) => p === null ? p : { ...p, timeOfDay: { mode: 'fixed', fixedPhase: 'noon' } })}>
                      Add time of day
                    </button>
                  </div>
                ) : (
                  <>
                    <RadioRow label="Mode" value={draft.timeOfDay.mode} options={[{ label: 'None', value: 'none' }, { label: 'Fixed', value: 'fixed' }, { label: 'Auto', value: 'auto' }, { label: 'Server', value: 'server' }]} onChange={(v) => {
                      if (v === 'none') {
                        setDraft((p) => p === null ? p : { ...p, timeOfDay: null });
                      } else {
                        setDraft((p) => p === null ? p : { ...p, timeOfDay: { mode: v as 'fixed' | 'auto' | 'server', fixedPhase: 'noon' } });
                      }
                    }} />
                    {draft.timeOfDay.mode === 'fixed' && (
                      <StringSelectRow label="Phase" value={draft.timeOfDay.fixedPhase ?? 'noon'} options={TIME_PHASES} onChange={(v) => setDraft((p) => p === null ? p : { ...p, timeOfDay: { ...p.timeOfDay!, fixedPhase: v as TimePhase } })} />
                    )}
                    {draft.timeOfDay.mode === 'auto' && (
                      <>
                        <StringSelectRow label="Start phase" value={draft.timeOfDay.startPhase ?? 'dawn'} options={TIME_PHASES} onChange={(v) => setDraft((p) => p === null ? p : { ...p, timeOfDay: { ...p.timeOfDay!, startPhase: v as TimePhase } })} />
                        <SliderRow label="Cycle (min)" value={(draft.timeOfDay.cycleDurationMs ?? 60000) / 60000} min={0.5} max={60} step={0.5} decimals={1} onChange={(v) => setDraft((p) => p === null ? p : { ...p, timeOfDay: { ...p.timeOfDay!, cycleDurationMs: v * 60000 } })} />
                      </>
                    )}
                    {draft.timeOfDay.mode === 'server' && (
                      <p className="scene-admin-note" style={{ margin: '8px 16px' }}>Server mode follows the globally broadcast auto-cycle.</p>
                    )}
                  </>
                )}
              </Section>

              <Section title="Lobby (palco da party)">
                <p className="scene-admin-note" style={{ margin: '8px 16px 0' }}>
                  O cenário do lobby vem SEMPRE do GLB em "GLB model file" (o
                  modelo default da lista é usado se nenhum for escolhido — não
                  existe cena procedural). Estes knobs configuram apenas o palco
                  da party sobre o GLB. Cena com kind "lobby" (botão Lobby na
                  lista) + "<code>useGlbSettings</code>" ligado = o GLB define
                  câmera e luzes; desligado = o editor define luz/câmera.
                </p>
                <SliderRow label="Espaçamento dos pedestais (px)" value={effectiveLobby.pedestalSpacing} min={80} max={500} step={4} decimals={0} onChange={(v) => patchLobby({ pedestalSpacing: v })} />
                <SliderRow label="Escala dos pedestais" value={effectiveLobby.pedestalScale} min={0.5} max={1.5} step={0.02} onChange={(v) => patchLobby({ pedestalScale: v })} />
                <SliderRow label="Inclinação lateral (°)" value={effectiveLobby.sideTiltDeg} min={0} max={45} step={1} decimals={0} onChange={(v) => patchLobby({ sideTiltDeg: v })} />
                <SliderRow label="Escala do pedestal central" value={effectiveLobby.centerScale} min={0.5} max={1.8} step={0.02} onChange={(v) => patchLobby({ centerScale: v })} />
                <SliderRow label="Elevação do centro (px)" value={effectiveLobby.centerLift} min={0} max={160} step={2} decimals={0} onChange={(v) => patchLobby({ centerLift: v })} />
                <SliderRow label="Altura da party (Y)" value={effectiveLobby.partyHeight} min={-3} max={3} step={0.05} onChange={(v) => patchLobby({ partyHeight: v })} />
                <SliderRow label="Drift de câmera" value={effectiveLobby.driftIntensity} min={0} max={2} step={0.05} onChange={(v) => patchLobby({ driftIntensity: v })} />
                <SliderRow label="Brilho dos digimons (Octopath)" value={effectiveLobby.digimonBrightness} min={0.3} max={8} step={0.1} onChange={(v) => patchLobby({ digimonBrightness: v })} />
                <SliderRow label="Luz de palco (pool + sombra)" value={effectiveLobby.stageLightIntensity} min={0} max={6} step={0.1} onChange={(v) => patchLobby({ stageLightIntensity: v })} />
                <SliderRow label="Iluminação volumétrica" value={effectiveLobby.volumetricIntensity} min={0} max={6} step={0.1} onChange={(v) => patchLobby({ volumetricIntensity: v })} />
                <SliderRow label="Suavidade do feixe" value={effectiveLobby.volumetricSoftness} min={0} max={1} step={0.05} onChange={(v) => patchLobby({ volumetricSoftness: v })} decimals={2} />
                <SliderRow label="Blur / queda à distância" value={effectiveLobby.volumetricDistanceBlur} min={0} max={1} step={0.05} onChange={(v) => patchLobby({ volumetricDistanceBlur: v })} decimals={2} />
                <ToggleRow label="Bloom cinematográfico" value={effectiveLobby.bloomEnabled} onChange={(v) => patchLobby({ bloomEnabled: v })} />
                <SliderRow label="Bloom strength" value={effectiveLobby.bloomStrength} min={0} max={3} step={0.05} onChange={(v) => patchLobby({ bloomStrength: v })} decimals={2} />
                <SliderRow label="Bloom radius" value={effectiveLobby.bloomRadius} min={0} max={1} step={0.05} onChange={(v) => patchLobby({ bloomRadius: v })} decimals={2} />
                <SliderRow label="Bloom threshold" value={effectiveLobby.bloomThreshold} min={0} max={2} step={0.05} onChange={(v) => patchLobby({ bloomThreshold: v })} decimals={2} />
              </Section>
            </fieldset>
          </aside>
        </>
      )}
      {editorSceneId !== null ? (() => {
        const editorScene = scenes.find((item) => item.id === editorSceneId);
        return editorScene === undefined ? null : (
          <ThreeEditorFrame
            key={editorScene.id}
            scene={editorScene}
            onClose={() => setEditorSceneId(null)}
            onSaved={(saved) => {
              setScenes((current) => current.map((item) => item.id === saved.id ? saved : item));
              setDraft((current) => {
                if (current === null || selectedId !== saved.id) return current;
                const nextSettings = { ...current.settings } as Record<string, unknown>;
                for (const key of ['editorProjectFile', 'modelFile'] as const) {
                  const value = saved.settings[key];
                  if (value === undefined) delete nextSettings[key];
                  else nextSettings[key] = value;
                }
                return { ...current, settings: nextSettings as Partial<SceneSettings> };
              });
            }}
          />
        );
      })() : null}
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

function StringSelectRow({ label, value, options, onChange }: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label className="scene-admin-row scene-admin-row--select">
      <span className="scene-admin-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <span className="scene-admin-value">{value}</span>
    </label>
  );
}

function WeatherJsonEditor({ weather, onChange }: { readonly weather: WeatherConfig; readonly onChange: (weather: WeatherConfig) => void }): JSX.Element {
  const serialized = useMemo(() => JSON.stringify(weather, null, 2), [weather]);
  const [text, setText] = useState(serialized);
  const [issues, setIssues] = useState<readonly string[]>([]);

  // Resync textarea from prop changes (sliders/preset) only when the buffer has no in-progress edits to lose.
  const lastApplied = useRef(serialized);
  const dirty = text !== lastApplied.current;

  useEffect(() => {
    if (!dirty) {
      lastApplied.current = serialized;
      setText(serialized);
      setIssues([]);
    }
  }, [serialized, dirty]);

  const parse = (value: string): { readonly ok: true; readonly data: WeatherConfig } | { readonly ok: false; readonly issues: readonly string[] } => {
    let raw: unknown;
    try {
      raw = JSON.parse(value);
    } catch (err) {
      return { ok: false, issues: [err instanceof Error ? `JSON parse error: ${err.message}` : 'Invalid JSON'] };
    }
    const result = WeatherConfigZ.safeParse(raw);
    if (result.success) return { ok: true, data: result.data };
    return { ok: false, issues: result.error.issues.map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`) };
  };

  const apply = (value: string): void => {
    const parsed = parse(value);
    if (!parsed.ok) {
      setIssues(parsed.issues);
      return;
    }
    onChange(parsed.data);
    lastApplied.current = value;
    setIssues([]);
  };

  const valid = issues.length === 0;

  return (
    <div className="scene-admin-row" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '8px', alignItems: 'center' }}>
        <span className="scene-admin-label">Weather JSON</span>
        <span style={{ color: valid ? '#4ade80' : '#f87171', fontSize: '0.8rem' }}>
          {valid ? '✓ valid' : `${issues.length} issue${issues.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <textarea
        value={text}
        spellCheck={false}
        onChange={(e) => {
          const value = e.currentTarget.value;
          setText(value);
          const parsed = parse(value);
          setIssues(parsed.ok ? [] : parsed.issues);
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            apply(text);
          }
        }}
        style={{ width: '100%', minHeight: '200px', fontFamily: 'monospace', fontSize: '13px', background: '#0d1117', color: '#e5e7eb', border: '1px solid #374151', padding: '8px', borderRadius: '4px' }}
      />
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => {
            const preset = WEATHER_EMITTER_PRESETS[weather.preset] ?? weather;
            const value = JSON.stringify(preset, null, 2);
            setText(value);
            lastApplied.current = value;
            setIssues([]);
          }}
        >
          Load preset JSON
        </button>
        <button type="button" disabled={!valid} onClick={() => apply(text)}>Apply (Ctrl+Enter)</button>
      </div>
      {issues.length > 0 && (
        <ul style={{ margin: '8px 0 0 0', paddingLeft: '18px', color: '#f87171', fontSize: '0.8rem', width: '100%', gridColumn: '1 / -1', overflowWrap: 'anywhere' }}>
          {issues.slice(0, 8).map((issue) => <li key={issue}>{issue}</li>)}
          {issues.length > 8 ? <li>… and {issues.length - 8} more</li> : null}
        </ul>
      )}
    </div>
  );
}
