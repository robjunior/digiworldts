import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';

import type {
  SkillVfxAttackType,
  SkillVfxEmitterSlot,
  SkillVfxLight,
  SkillVfxPreset,
  SkillVfxTrajectory,
} from '@digiworld/shared/skill-vfx';
import { SKILL_VFX_ATTACK_TYPES, SKILL_VFX_TRAJECTORIES } from '@digiworld/shared/skill-vfx';
import { ELEMENTS, type Element } from '@digiworld/shared/digimon';
import type { ParticleEmitterConfig } from '@digiworld/shared/weather';

import {
  createSkillVfxPreset,
  deleteSkillVfxPreset,
  getSkillVfxPresets,
  updateSkillVfxPreset,
  type SkillVfxPresetCreateBody,
} from '../lib/api-skill-vfx-presets';
import { AdminGuard } from '../components/admin/AdminGuard';
import { buildPresetRunner } from '@digiworld/scene3d/attack-runners/preset';
import type { AttackEffect3D, Runner3D } from '@digiworld/scene3d/attack-runners/types';

import '../styles/extensions-admin.css';

const DEFAULT_EMITTER: ParticleEmitterConfig = {
  id: 'e_default',
  name: 'default',
  kind: 'instanced',
  geometry: 'quad',
  shader: 'default',
  emissionRate: 30,
  maxParticles: 50,
  lifetimeMs: [400, 700],
  startSize: [0.2, 0.3],
  endSize: [0.05, 0.1],
  startColor: 0xffffff,
  endColor: 0xffffff,
  startOpacity: 1,
  endOpacity: 0,
  velocity: { base: [0, 1, 0], variance: [1, 1, 1] },
  gravity: [0, -3, 0],
  wind: [0, 0, 0],
  drag: 3,
  spawn: { shape: 'point', size: [0, 0, 0], center: [0, 0, 0] },
  blending: 'additive',
  emissionMode: 'oneshot',
  burstCount: 30,
  totalLifetimeMs: 700,
};

type EditablePreset = Omit<SkillVfxPreset, 'createdAt' | 'updatedAt'>;

const DEFAULT_PRESET: EditablePreset = {
  id: 'new-preset',
  name: 'New Skill VFX Preset',
  attackType: 'ranged',
  emitters: [{ emitter: { ...DEFAULT_EMITTER }, startAtMs: 0, followTrajectory: true }],
  trajectory: 'straight',
  totalDurationMs: 900,
  impactAtMs: 500,
  light: { color: 0xffffff, intensity: 4, distance: 6, decayMs: 700 },
};

function generateId(): string {
  return 'svfx-' + Math.random().toString(36).substring(2, 9);
}

function hexToHtmlColor(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

function htmlColorToHex(html: string): number {
  return parseInt(html.replace('#', ''), 16);
}

type PreviewControls = {
  play: () => void;
  stop: () => void;
  setLoop: (on: boolean) => void;
};

/**
 * 3D preview of a SkillVfxPreset. Renders a source (blue) and target (red) pin
 * on a grid, and plays the preset via `buildPresetRunner` on demand. Loop mode
 * replays every `totalDurationMs + 500 ms` for iteration.
 */
function PresetPreview({
  preset,
  playRef,
}: {
  readonly preset: EditablePreset | null;
  readonly playRef: React.MutableRefObject<PreviewControls | null>;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const presetRef = useRef<EditablePreset | null>(preset);
  presetRef.current = preset;

  useEffect(() => {
    if (canvasRef.current === null || containerRef.current === null) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1a1d24');

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 5, 15);
    camera.lookAt(0, 1, 0);

    const grid = new THREE.GridHelper(30, 15, 0x445566, 0x223344);
    scene.add(grid);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);

    const sourceMat = new THREE.MeshBasicMaterial({ color: 0x66aaff });
    const sourceSphere = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), sourceMat);
    sourceSphere.position.set(-5, 1, 0);
    scene.add(sourceSphere);

    const targetMat = new THREE.MeshBasicMaterial({ color: 0xff6666 });
    const targetSphere = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), targetMat);
    targetSphere.position.set(5, 1, 0);
    scene.add(targetSphere);

    let runner: Runner3D | null = null;
    let loopOn = false;
    let nextPlayAtMs = 0;

    const play = (): void => {
      if (runner !== null) {
        runner.dispose();
        runner = null;
      }
      const p = presetRef.current;
      if (p === null || p.emitters.length === 0) return;
      const fullPreset: SkillVfxPreset = { ...p, createdAt: 0, updatedAt: 0 };
      const effect: AttackEffect3D = {
        id: 'preview-' + Date.now(),
        element: p.element ?? 'null',
        sourcePosition: new THREE.Vector3(-5, 1, 0),
        targetPosition: new THREE.Vector3(5, 1, 0),
        durationS: p.totalDurationMs / 1000,
      };
      runner = buildPresetRunner(scene, effect, fullPreset);
      nextPlayAtMs = performance.now() + p.totalDurationMs + 500;
    };

    const stop = (): void => {
      loopOn = false;
      if (runner !== null) {
        runner.dispose();
        runner = null;
      }
    };

    const setLoop = (on: boolean): void => {
      loopOn = on;
      if (on && runner === null) play();
    };

    playRef.current = { play, stop, setLoop };

    let rafId = 0;
    let lastTime = performance.now();

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
      }
    });
    resizeObserver.observe(container);

    const loop = (time: number): void => {
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      if (runner !== null) {
        runner.tick(dt, time / 1000, camera.quaternion);
      }
      if (loopOn && runner === null && time >= nextPlayAtMs) {
        play();
      }

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      if (runner !== null) runner.dispose();
      renderer.dispose();
      sourceMat.dispose();
      targetMat.dispose();
      playRef.current = null;
    };
  }, [playRef]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

export function AdminSkillVfxEditor(): JSX.Element {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditablePreset | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [loopOn, setLoopOn] = useState(false);
  const playRef = useRef<PreviewControls | null>(null);

  const presetsQuery = useQuery({
    queryKey: ['admin-skill-vfx-presets'],
    queryFn: () => getSkillVfxPresets(true),
  });
  const presets = presetsQuery.data ?? [];

  const showToast = (message: string, type: 'success' | 'error'): void => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const createMut = useMutation({
    mutationFn: createSkillVfxPreset,
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-skill-vfx-presets'] });
      showToast('Preset created', 'success');
      setSelectedId(res.preset.id);
      setEditing(res.preset);
    },
    onError: (err) => showToast(String(err), 'error'),
  });

  const updateMut = useMutation({
    mutationFn: (args: { id: string; body: Partial<SkillVfxPresetCreateBody> }) =>
      updateSkillVfxPreset(args.id, args.body),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-skill-vfx-presets'] });
      showToast('Preset saved', 'success');
      setEditing(res.preset);
    },
    onError: (err) => showToast(String(err), 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: deleteSkillVfxPreset,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-skill-vfx-presets'] });
      showToast('Preset deleted', 'success');
      setSelectedId(null);
      setEditing(null);
    },
    onError: (err) => showToast(String(err), 'error'),
  });

  const handleNew = (): void => {
    setSelectedId(null);
    setEditing({
      ...DEFAULT_PRESET,
      id: generateId(),
      emitters: DEFAULT_PRESET.emitters.map((s) => ({
        emitter: { ...s.emitter, id: 'e_' + Math.random().toString(36).slice(2, 7) },
        startAtMs: s.startAtMs,
        followTrajectory: s.followTrajectory,
      })),
    });
  };

  const handleSelect = (p: SkillVfxPreset): void => {
    setSelectedId(p.id);
    setEditing(p);
  };

  const handleSave = (): void => {
    if (editing === null) return;
    const body: SkillVfxPresetCreateBody = {
      name: editing.name,
      emitters: editing.emitters,
      trajectory: editing.trajectory,
      totalDurationMs: editing.totalDurationMs,
      impactAtMs: editing.impactAtMs,
      ...(editing.element !== undefined ? { element: editing.element } : {}),
      ...(editing.attackType !== undefined ? { attackType: editing.attackType } : {}),
      ...(editing.light !== undefined ? { light: editing.light } : {}),
    };
    if (selectedId !== null && presets.find((p) => p.id === selectedId) !== undefined) {
      updateMut.mutate({ id: selectedId, body });
    } else {
      createMut.mutate(body);
    }
  };

  const handleDelete = (): void => {
    if (selectedId === null) return;
    if (window.confirm(`Delete "${editing?.name}"?`)) deleteMut.mutate(selectedId);
  };

  const toggleLoop = (on: boolean): void => {
    setLoopOn(on);
    playRef.current?.setLoop(on);
  };

  const updateField = <K extends keyof EditablePreset>(key: K, value: EditablePreset[K]): void => {
    if (editing === null) return;
    setEditing({ ...editing, [key]: value });
  };

  const updateLight = <K extends keyof SkillVfxLight>(key: K, value: SkillVfxLight[K]): void => {
    if (editing === null || editing.light === undefined) return;
    setEditing({ ...editing, light: { ...editing.light, [key]: value } });
  };

  const toggleLight = (): void => {
    if (editing === null) return;
    if (editing.light !== undefined) {
      const { light: _light, ...rest } = editing;
      void _light;
      setEditing(rest as EditablePreset);
    } else {
      setEditing({ ...editing, light: { color: 0xffffff, intensity: 4, distance: 6, decayMs: 700 } });
    }
  };

  const addEmitterSlot = (): void => {
    if (editing === null || editing.emitters.length >= 3) return;
    const newSlot: SkillVfxEmitterSlot = {
      emitter: { ...DEFAULT_EMITTER, id: 'e_' + Math.random().toString(36).slice(2, 7) },
      startAtMs: 0,
      followTrajectory: false,
    };
    setEditing({ ...editing, emitters: [...editing.emitters, newSlot] });
  };

  const removeEmitterSlot = (idx: number): void => {
    if (editing === null || editing.emitters.length <= 1) return;
    setEditing({ ...editing, emitters: editing.emitters.filter((_, i) => i !== idx) });
  };

  const updateSlotField = <K extends keyof SkillVfxEmitterSlot>(
    idx: number,
    key: K,
    value: SkillVfxEmitterSlot[K],
  ): void => {
    if (editing === null) return;
    const updated = editing.emitters.map((s, i) => (i === idx ? { ...s, [key]: value } : s));
    setEditing({ ...editing, emitters: updated });
  };

  const updateSlotEmitterJson = (idx: number, jsonText: string): void => {
    if (editing === null) return;
    try {
      const emitter = JSON.parse(jsonText) as ParticleEmitterConfig;
      if (typeof emitter.id !== 'string' || typeof emitter.name !== 'string') {
        throw new Error('Missing id/name');
      }
      const updated = editing.emitters.map((s, i) => (i === idx ? { ...s, emitter } : s));
      setEditing({ ...editing, emitters: updated });
    } catch (e) {
      showToast(`Invalid JSON: ${String(e)}`, 'error');
    }
  };

  return (
    <AdminGuard>
      <div className="scene-admin particle-editor">
        <div
          className="scene-admin-header"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div>
            <h2>Skill VFX Preset Editor</h2>
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              Compose particle-based skill effects with trajectory + light.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to="/particles" className="admin-link-button">
              Particle Editor
            </Link>
            <Link to="/" className="admin-link-button">
              Back to Admin
            </Link>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 120px)' }}>
          <div
            style={{
              width: 250,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              background: 'var(--bg-panel)',
              padding: 12,
              borderRadius: 8,
              overflowY: 'auto',
            }}
          >
            <button
              className="admin-link-button"
              onClick={handleNew}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              + New Preset
            </button>
            <div style={{ height: 1, background: 'var(--border-base)', margin: '8px 0' }} />
            {presets.map((p) => (
              <div
                key={p.id}
                onClick={() => handleSelect(p)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: p.id === selectedId ? 'var(--bg-active)' : 'transparent',
                  fontWeight: p.id === selectedId ? 600 : 400,
                  fontSize: 14,
                }}
              >
                {p.name}
                {p.element !== undefined && (
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 6 }}>
                    [{p.element}]
                  </span>
                )}
              </div>
            ))}
          </div>

          <div
            style={{
              flex: 1,
              background: '#000',
              borderRadius: 8,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{ padding: '8px 12px', display: 'flex', gap: 8, background: 'rgba(0,0,0,0.5)', alignItems: 'center' }}
            >
              <button
                className="admin-link-button"
                onClick={() => playRef.current?.play()}
                disabled={editing === null}
              >
                ▶ Play once
              </button>
              <button className="admin-link-button" onClick={() => playRef.current?.stop()}>
                ■ Stop
              </button>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-dim)' }}
              >
                <input type="checkbox" checked={loopOn} onChange={(e) => toggleLoop(e.target.checked)} />
                Loop
              </label>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                Blue = source · Red = target
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <PresetPreview preset={editing} playRef={playRef} />
            </div>
          </div>

          <div
            style={{
              width: 380,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              background: 'var(--bg-panel)',
              padding: 16,
              borderRadius: 8,
              overflowY: 'auto',
            }}
          >
            {editing !== null ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    paddingBottom: 16,
                    borderBottom: '1px solid var(--border-base)',
                  }}
                >
                  <button className="admin-link-button" onClick={handleSave}>
                    Save
                  </button>
                  {selectedId !== null && presets.find((p) => p.id === selectedId) !== undefined && (
                    <button
                      className="admin-link-button"
                      onClick={handleDelete}
                      style={{ color: '#ff4444' }}
                    >
                      Delete
                    </button>
                  )}
                </div>

                {toast !== null && (
                  <div className={`admin-message is-${toast.type}`} style={{ padding: 8, borderRadius: 4 }}>
                    {toast.message}
                  </div>
                )}

                <div className="admin-section">
                  <div className="admin-section-head"><h2>Basics</h2></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Name</div>
                      <input
                        type="text"
                        className="admin-credit-input"
                        value={editing.name}
                        onChange={(e) => updateField('name', e.target.value)}
                      />
                    </label>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Element</div>
                      <select
                        className="admin-credit-input"
                        value={editing.element ?? ''}
                        onChange={(e) =>
                          updateField('element', e.target.value === '' ? undefined : (e.target.value as Element))
                        }
                      >
                        <option value="">(none)</option>
                        {ELEMENTS.map((el) => (
                          <option key={el} value={el}>
                            {el}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Delivery</div>
                      <select
                        className="admin-credit-input"
                        value={editing.attackType ?? 'ranged'}
                        onChange={(e) => updateField('attackType', e.target.value as SkillVfxAttackType)}
                      >
                        {SKILL_VFX_ATTACK_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t === 'melee' ? 'Melee — caster advances to face the receiver' : 'Ranged — effect/projectile travels to the receiver'}
                          </option>
                        ))}
                      </select>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                        {editing.attackType === 'melee'
                          ? 'Purely visual. The caster walks up to the target; camera follows. Emitters with "Follow trajectory" off + Start At ≈ Impact read as an on-contact burst; a source emitter (Start At 0) is the swing/charge-up.'
                          : 'Purely visual. The caster stays put and the camera follows the projectile along the trajectory, then holds on the receiver.'}
                      </div>
                    </label>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>
                        Total Duration (ms) — {editing.totalDurationMs}
                      </div>
                      <input
                        type="range"
                        min={100}
                        max={5000}
                        step={50}
                        value={editing.totalDurationMs}
                        onChange={(e) => updateField('totalDurationMs', parseInt(e.target.value, 10))}
                        style={{ width: '100%' }}
                      />
                    </label>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>
                        Impact At (ms) — {editing.impactAtMs}
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={editing.totalDurationMs}
                        step={50}
                        value={editing.impactAtMs}
                        onChange={(e) => updateField('impactAtMs', parseInt(e.target.value, 10))}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                </div>

                <div className="admin-section">
                  <div className="admin-section-head"><h2>Trajectory</h2></div>
                  <select
                    className="admin-credit-input"
                    value={editing.trajectory}
                    onChange={(e) => updateField('trajectory', e.target.value as SkillVfxTrajectory)}
                  >
                    {SKILL_VFX_TRAJECTORIES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="admin-section">
                  <div className="admin-section-head"><h2>Light</h2></div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 12,
                      marginBottom: 8,
                    }}
                  >
                    <input type="checkbox" checked={editing.light !== undefined} onChange={toggleLight} />
                    Include light
                  </label>
                  {editing.light !== undefined && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <label>
                        <div style={{ fontSize: 12, marginBottom: 2 }}>Color</div>
                        <input
                          type="color"
                          value={hexToHtmlColor(editing.light.color)}
                          onChange={(e) => updateLight('color', htmlColorToHex(e.target.value))}
                        />
                      </label>
                      <label>
                        <div style={{ fontSize: 12, marginBottom: 2 }}>
                          Intensity ({editing.light.intensity.toFixed(1)})
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={20}
                          step={0.1}
                          value={editing.light.intensity}
                          onChange={(e) => updateLight('intensity', parseFloat(e.target.value))}
                          style={{ width: '100%' }}
                        />
                      </label>
                      <label>
                        <div style={{ fontSize: 12, marginBottom: 2 }}>
                          Distance ({editing.light.distance})
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={30}
                          step={0.5}
                          value={editing.light.distance}
                          onChange={(e) => updateLight('distance', parseFloat(e.target.value))}
                          style={{ width: '100%' }}
                        />
                      </label>
                      <label>
                        <div style={{ fontSize: 12, marginBottom: 2 }}>
                          Decay (ms) ({editing.light.decayMs})
                        </div>
                        <input
                          type="range"
                          min={100}
                          max={5000}
                          step={50}
                          value={editing.light.decayMs}
                          onChange={(e) => updateLight('decayMs', parseInt(e.target.value, 10))}
                          style={{ width: '100%' }}
                        />
                      </label>
                    </div>
                  )}
                </div>

                <div className="admin-section">
                  <div
                    className="admin-section-head"
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <h2>Emitters ({editing.emitters.length}/3)</h2>
                    {editing.emitters.length < 3 && (
                      <button
                        className="admin-link-button"
                        onClick={addEmitterSlot}
                        style={{ fontSize: 11, padding: '2px 8px' }}
                      >
                        + Add
                      </button>
                    )}
                  </div>
                  {editing.emitters.map((slot, idx) => (
                    <div
                      key={`slot-${idx}`}
                      style={{ borderTop: '1px solid var(--border-base)', paddingTop: 12, marginTop: 12 }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 8,
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 600 }}>
                          Slot {idx + 1} — {slot.emitter.name}
                        </div>
                        {editing.emitters.length > 1 && (
                          <button
                            className="admin-link-button"
                            onClick={() => removeEmitterSlot(idx)}
                            style={{ fontSize: 11, padding: '2px 8px', color: '#ff4444' }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <label>
                        <div style={{ fontSize: 12, marginBottom: 2 }}>
                          Start At (ms) ({slot.startAtMs})
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={5000}
                          step={50}
                          value={slot.startAtMs}
                          onChange={(e) => updateSlotField(idx, 'startAtMs', parseInt(e.target.value, 10))}
                          style={{ width: '100%' }}
                        />
                      </label>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                          margin: '8px 0',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={slot.followTrajectory}
                          onChange={(e) => updateSlotField(idx, 'followTrajectory', e.target.checked)}
                        />
                        Follow trajectory
                      </label>
                      <label>
                        <div style={{ fontSize: 12, marginBottom: 2 }}>Emitter Config (JSON)</div>
                        <textarea
                          className="admin-credit-input"
                          rows={8}
                          value={JSON.stringify(slot.emitter, null, 2)}
                          onChange={(e) => updateSlotEmitterJson(idx, e.target.value)}
                          style={{ fontFamily: 'monospace', fontSize: 11, width: '100%' }}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 14, color: 'var(--text-dim)', textAlign: 'center', padding: 20 }}>
                Select or create a preset.
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}
