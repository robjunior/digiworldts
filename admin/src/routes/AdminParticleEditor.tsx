import { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPresets, createPreset, updatePreset, deletePreset } from '../lib/api-particle-presets';
import type {
  ParticleEmitterConfig,
  ParticlePresetEntry,
  ParticleKind,
  ParticleGeometry,
  ParticleShaderKind,
  ParticleBlending,
  SpawnShape,
} from '@digiworld/shared/weather';
import { ParticleEmitter } from '@digiworld/scene3d/particles/ParticleEmitter';
import { AdminGuard } from '../components/admin/AdminGuard';
import { Link } from 'react-router';
import '../styles/extensions-admin.css';

const DEFAULT_CONFIG: ParticleEmitterConfig = {
  id: 'new-preset',
  name: 'New Rain Preset',
  kind: 'streak',
  geometry: 'streak',
  shader: 'rainStreak',
  emissionRate: 1500,
  maxParticles: 1500,
  lifetimeMs: [400, 600],
  startSize: [0.02, 0.04],
  endSize: [0.02, 0.04],
  startColor: 0x99aacc,
  endColor: 0x99aacc,
  startOpacity: 0.6,
  endOpacity: 0.3,
  velocity: { base: [0, -35, 0], variance: [2, 5, 2] },
  gravity: [0, -15, 0],
  wind: [3, 0, 0],
  drag: 0.01,
  spawn: { shape: 'box', size: [40, 20, 40], center: [0, 20, 0], followCamera: true, cameraOffsetY: 20 },
  blending: 'normal',
  collideGround: true,
  softParticles: true,
};

function generateId(): string {
  return 'p_' + Math.random().toString(36).substring(2, 9);
}

function hexToHtmlColor(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

function htmlColorToHex(html: string): number {
  return parseInt(html.replace('#', ''), 16);
}

function ParticlePreview({ config }: { readonly config: ParticleEmitterConfig | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const emitterRef = useRef<ParticleEmitter | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color('#1a1d24');
    
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    cameraRef.current = camera;
    camera.position.set(0, 10, 40);
    camera.lookAt(0, 5, 0);

    const grid = new THREE.GridHelper(100, 50, 0x445566, 0x223344);
    scene.add(grid);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    let rafId: number;
    let lastTime = performance.now();
    let angle = 0;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
      }
    });
    resizeObserver.observe(containerRef.current);

    const loop = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;
      
      angle += dt * 0.2;
      camera.position.x = Math.sin(angle) * 40;
      camera.position.z = Math.cos(angle) * 40;
      camera.lookAt(0, 5, 0);
      
      if (emitterRef.current) {
        emitterRef.current.tick(dt);
      }
      
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      if (emitterRef.current) {
        emitterRef.current.dispose();
        emitterRef.current = null;
      }
      renderer.dispose();
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sceneRef.current || !cameraRef.current) return;
    
    if (emitterRef.current) {
      emitterRef.current.dispose();
      emitterRef.current = null;
    }

    if (config) {
      emitterRef.current = new ParticleEmitter(sceneRef.current, config);
      emitterRef.current.setCameraReference(cameraRef.current);
    }
  }, [config]);
  
  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

export function AdminParticleEditor(): JSX.Element {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<ParticleEmitterConfig | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const presetsQuery = useQuery({ queryKey: ['admin-particle-presets'], queryFn: () => getPresets() });
  const presets = presetsQuery.data ?? [];

  const createMut = useMutation({
    mutationFn: createPreset,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-particle-presets'] });
      showToast('Preset created', 'success');
    },
    onError: (err) => showToast(String(err), 'error'),
  });

  const updateMut = useMutation({
    mutationFn: (args: { id: string; body: { name: string; emitter: ParticleEmitterConfig } }) => updatePreset(args.id, args.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-particle-presets'] });
      showToast('Preset saved', 'success');
    },
    onError: (err) => showToast(String(err), 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: deletePreset,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-particle-presets'] });
      showToast('Preset deleted', 'success');
      setSelectedId(null);
      setEditingConfig(null);
    },
    onError: (err) => showToast(String(err), 'error'),
  });

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSelect = (entry: ParticlePresetEntry) => {
    setSelectedId(entry.id);
    setEditingConfig(entry.emitter);
  };

  const handleNew = () => {
    const id = generateId();
    const config = { ...DEFAULT_CONFIG, id, name: 'New Preset' };
    setSelectedId(id);
    setEditingConfig(config);
  };

  const handleSave = () => {
    if (!editingConfig) return;
    const existing = presets.find((p) => p.id === selectedId);
    if (existing) {
      updateMut.mutate({ id: existing.id, body: { name: editingConfig.name, emitter: editingConfig } });
    } else {
      createMut.mutate({ name: editingConfig.name, emitter: editingConfig });
    }
  };

  const handleDelete = () => {
    if (!selectedId) return;
    if (confirm('Are you sure you want to delete this preset?')) {
      deleteMut.mutate(selectedId);
    }
  };

  const handleCopy = () => {
    if (!editingConfig) return;
    const id = generateId();
    const copy = { ...editingConfig, id, name: editingConfig.name + ' (Copy)' };
    setSelectedId(id);
    setEditingConfig(copy);
  };

  const handleExport = () => {
    if (!editingConfig) return;
    const json = JSON.stringify(editingConfig, null, 2);
    void navigator.clipboard.writeText(json);
    showToast('Exported JSON copied to clipboard', 'success');
  };

  const handleImport = () => {
    const json = prompt('Paste JSON here:');
    if (!json) return;
    try {
      const parsed = JSON.parse(json) as ParticleEmitterConfig;
      if (!parsed.id || !parsed.name || !parsed.kind || !parsed.geometry || !parsed.shader) {
        throw new Error('Invalid ParticleEmitterConfig JSON');
      }
      setEditingConfig({ ...parsed, id: selectedId || generateId() });
      showToast('JSON imported successfully', 'success');
    } catch (e) {
      showToast(String(e), 'error');
    }
  };

  const updateField = <K extends keyof ParticleEmitterConfig>(key: K, value: ParticleEmitterConfig[K]) => {
    if (editingConfig) {
      setEditingConfig({ ...editingConfig, [key]: value });
    }
  };

  const updateNested = <K extends keyof ParticleEmitterConfig, NK extends keyof ParticleEmitterConfig[K]>(
    key: K,
    nestedKey: NK,
    value: ParticleEmitterConfig[K][NK]
  ) => {
    if (editingConfig && editingConfig[key]) {
      const obj = editingConfig[key] as Record<string, any>;
      setEditingConfig({
        ...editingConfig,
        [key]: { ...obj, [nestedKey as string]: value },
      });
    }
  };

  return (
    <AdminGuard>
      <div className="scene-admin particle-editor">
        <div className="scene-admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>Particle Preset Editor</h2>
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Design named weather and VFX emitters.</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to="/admin" className="admin-link-button">Back to Admin</Link>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 120px)' }}>
          <div style={{ width: 250, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-panel)', padding: 12, borderRadius: 8, overflowY: 'auto' }}>
            <button className="admin-link-button" onClick={handleNew} style={{ width: '100%', justifyContent: 'center' }}>
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
              </div>
            ))}
          </div>

          <div style={{ flex: 1, background: '#000', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <ParticlePreview config={editingConfig} />
          </div>

          <div style={{ width: 350, display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--bg-panel)', padding: 16, borderRadius: 8, overflowY: 'auto' }}>
            {editingConfig ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingBottom: 16, borderBottom: '1px solid var(--border-base)' }}>
                  <button className="admin-link-button" onClick={handleSave}>Save</button>
                  <button className="admin-link-button" onClick={handleCopy}>Copy</button>
                  <button className="admin-link-button" onClick={handleExport}>Export</button>
                  <button className="admin-link-button" onClick={handleImport}>Import</button>
                  <button className="admin-link-button" onClick={handleDelete} style={{ color: '#ff4444' }}>Delete</button>
                </div>
                
                {toast && (
                  <div className={`admin-message is-${toast.type}`} style={{ padding: 8, borderRadius: 4 }}>
                    {toast.message}
                  </div>
                )}

                <div className="admin-section">
                  <div className="admin-section-head"><h2>General</h2></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>ID (read-only)</div>
                      <input type="text" className="admin-credit-input" value={editingConfig.id} readOnly disabled />
                    </label>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Name</div>
                      <input type="text" className="admin-credit-input" value={editingConfig.name} onChange={(e) => updateField('name', e.target.value)} />
                    </label>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Kind</div>
                      <select className="admin-credit-input" value={editingConfig.kind} onChange={(e) => updateField('kind', e.target.value as ParticleKind)}>
                        {['instanced', 'points', 'streak', 'sprite'].map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </label>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Geometry</div>
                      <select className="admin-credit-input" value={editingConfig.geometry} onChange={(e) => updateField('geometry', e.target.value as ParticleGeometry)}>
                        {['sphere', 'plane', 'cube', 'streak', 'quad'].map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </label>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Shader</div>
                      <select className="admin-credit-input" value={editingConfig.shader} onChange={(e) => updateField('shader', e.target.value as ParticleShaderKind)}>
                        {['default', 'rainStreak', 'wetSpark', 'sandHaze', 'thunderCore', 'snowFlake', 'hailShard'].map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </label>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Texture URL</div>
                      <input type="text" className="admin-credit-input" value={editingConfig.textureUrl || ''} onChange={(e) => updateField('textureUrl', e.target.value)} />
                    </label>
                  </div>
                </div>

                <div className="admin-section">
                  <div className="admin-section-head"><h2>Emission</h2></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Emission Rate ({editingConfig.emissionRate})</div>
                      <input type="range" min={0.1} max={2000} step={1} value={editingConfig.emissionRate} onChange={(e) => updateField('emissionRate', parseFloat(e.target.value))} style={{ width: '100%' }} />
                    </label>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Max Particles ({editingConfig.maxParticles})</div>
                      <input type="range" min={10} max={10000} step={10} value={editingConfig.maxParticles} onChange={(e) => updateField('maxParticles', parseInt(e.target.value, 10))} style={{ width: '100%' }} />
                    </label>
                    <div style={{ fontSize: 12, marginBottom: 2 }}>Lifetime MS ({editingConfig.lifetimeMs[0]} - {editingConfig.lifetimeMs[1]})</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input type="number" className="admin-credit-input" value={editingConfig.lifetimeMs[0]} onChange={(e) => updateField('lifetimeMs', [parseInt(e.target.value, 10), editingConfig.lifetimeMs[1]])} style={{ width: '50%' }} />
                      <input type="number" className="admin-credit-input" value={editingConfig.lifetimeMs[1]} onChange={(e) => updateField('lifetimeMs', [editingConfig.lifetimeMs[0], parseInt(e.target.value, 10)])} style={{ width: '50%' }} />
                    </div>
                  </div>
                </div>

                <div className="admin-section">
                  <div className="admin-section-head"><h2>Appearance</h2></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, marginBottom: 2 }}>Size (Start / End)</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input type="number" step={0.01} className="admin-credit-input" value={editingConfig.startSize[0]} onChange={(e) => updateField('startSize', [parseFloat(e.target.value), editingConfig.startSize[1]])} style={{ width: '50%' }} />
                      <input type="number" step={0.01} className="admin-credit-input" value={editingConfig.endSize[0]} onChange={(e) => updateField('endSize', [parseFloat(e.target.value), editingConfig.endSize[1]])} style={{ width: '50%' }} />
                    </div>
                    <div style={{ fontSize: 12, marginBottom: 2 }}>Color (Start / End)</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input type="color" value={hexToHtmlColor(editingConfig.startColor)} onChange={(e) => updateField('startColor', htmlColorToHex(e.target.value))} style={{ width: '50%' }} />
                      <input type="color" value={hexToHtmlColor(editingConfig.endColor)} onChange={(e) => updateField('endColor', htmlColorToHex(e.target.value))} style={{ width: '50%' }} />
                    </div>
                    <div style={{ fontSize: 12, marginBottom: 2 }}>Opacity (Start: {editingConfig.startOpacity.toFixed(2)} / End: {editingConfig.endOpacity.toFixed(2)})</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input type="range" min={0} max={1} step={0.05} value={editingConfig.startOpacity} onChange={(e) => updateField('startOpacity', parseFloat(e.target.value))} style={{ width: '50%' }} />
                      <input type="range" min={0} max={1} step={0.05} value={editingConfig.endOpacity} onChange={(e) => updateField('endOpacity', parseFloat(e.target.value))} style={{ width: '50%' }} />
                    </div>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Blending</div>
                      <select className="admin-credit-input" value={editingConfig.blending} onChange={(e) => updateField('blending', e.target.value as ParticleBlending)}>
                        {['normal', 'additive', 'multiply'].map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </label>
                  </div>
                </div>

                <div className="admin-section">
                  <div className="admin-section-head"><h2>Motion</h2></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, marginBottom: 2 }}>Velocity Base (X, Y, Z)</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input type="number" className="admin-credit-input" value={editingConfig.velocity.base[0]} onChange={(e) => updateNested('velocity', 'base', [parseFloat(e.target.value), editingConfig.velocity.base[1], editingConfig.velocity.base[2]])} />
                      <input type="number" className="admin-credit-input" value={editingConfig.velocity.base[1]} onChange={(e) => updateNested('velocity', 'base', [editingConfig.velocity.base[0], parseFloat(e.target.value), editingConfig.velocity.base[2]])} />
                      <input type="number" className="admin-credit-input" value={editingConfig.velocity.base[2]} onChange={(e) => updateNested('velocity', 'base', [editingConfig.velocity.base[0], editingConfig.velocity.base[1], parseFloat(e.target.value)])} />
                    </div>
                    <div style={{ fontSize: 12, marginBottom: 2 }}>Velocity Variance (X, Y, Z)</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input type="number" className="admin-credit-input" value={editingConfig.velocity.variance[0]} onChange={(e) => updateNested('velocity', 'variance', [parseFloat(e.target.value), editingConfig.velocity.variance[1], editingConfig.velocity.variance[2]])} />
                      <input type="number" className="admin-credit-input" value={editingConfig.velocity.variance[1]} onChange={(e) => updateNested('velocity', 'variance', [editingConfig.velocity.variance[0], parseFloat(e.target.value), editingConfig.velocity.variance[2]])} />
                      <input type="number" className="admin-credit-input" value={editingConfig.velocity.variance[2]} onChange={(e) => updateNested('velocity', 'variance', [editingConfig.velocity.variance[0], editingConfig.velocity.variance[1], parseFloat(e.target.value)])} />
                    </div>
                    <div style={{ fontSize: 12, marginBottom: 2 }}>Gravity (X, Y, Z)</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input type="number" className="admin-credit-input" value={editingConfig.gravity[0]} onChange={(e) => updateField('gravity', [parseFloat(e.target.value), editingConfig.gravity[1], editingConfig.gravity[2]])} />
                      <input type="number" className="admin-credit-input" value={editingConfig.gravity[1]} onChange={(e) => updateField('gravity', [editingConfig.gravity[0], parseFloat(e.target.value), editingConfig.gravity[2]])} />
                      <input type="number" className="admin-credit-input" value={editingConfig.gravity[2]} onChange={(e) => updateField('gravity', [editingConfig.gravity[0], editingConfig.gravity[1], parseFloat(e.target.value)])} />
                    </div>
                    <div style={{ fontSize: 12, marginBottom: 2 }}>Wind (X, Y, Z)</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input type="number" className="admin-credit-input" value={editingConfig.wind[0]} onChange={(e) => updateField('wind', [parseFloat(e.target.value), editingConfig.wind[1], editingConfig.wind[2]])} />
                      <input type="number" className="admin-credit-input" value={editingConfig.wind[1]} onChange={(e) => updateField('wind', [editingConfig.wind[0], parseFloat(e.target.value), editingConfig.wind[2]])} />
                      <input type="number" className="admin-credit-input" value={editingConfig.wind[2]} onChange={(e) => updateField('wind', [editingConfig.wind[0], editingConfig.wind[1], parseFloat(e.target.value)])} />
                    </div>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Drag ({editingConfig.drag})</div>
                      <input type="range" min={0} max={5} step={0.05} value={editingConfig.drag} onChange={(e) => updateField('drag', parseFloat(e.target.value))} style={{ width: '100%' }} />
                    </label>
                  </div>
                </div>

                <div className="admin-section">
                  <div className="admin-section-head"><h2>Spawn</h2></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Shape</div>
                      <select className="admin-credit-input" value={editingConfig.spawn.shape} onChange={(e) => updateNested('spawn', 'shape', e.target.value as SpawnShape)}>
                        {['box', 'disc', 'sphere', 'point', 'cone'].map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </label>
                    <div style={{ fontSize: 12, marginBottom: 2 }}>Size (X, Y, Z)</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input type="number" className="admin-credit-input" value={editingConfig.spawn.size[0]} onChange={(e) => updateNested('spawn', 'size', [parseFloat(e.target.value), editingConfig.spawn.size[1], editingConfig.spawn.size[2]])} />
                      <input type="number" className="admin-credit-input" value={editingConfig.spawn.size[1]} onChange={(e) => updateNested('spawn', 'size', [editingConfig.spawn.size[0], parseFloat(e.target.value), editingConfig.spawn.size[2]])} />
                      <input type="number" className="admin-credit-input" value={editingConfig.spawn.size[2]} onChange={(e) => updateNested('spawn', 'size', [editingConfig.spawn.size[0], editingConfig.spawn.size[1], parseFloat(e.target.value)])} />
                    </div>
                    <div style={{ fontSize: 12, marginBottom: 2 }}>Center (X, Y, Z)</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input type="number" className="admin-credit-input" value={editingConfig.spawn.center[0]} onChange={(e) => updateNested('spawn', 'center', [parseFloat(e.target.value), editingConfig.spawn.center[1], editingConfig.spawn.center[2]])} />
                      <input type="number" className="admin-credit-input" value={editingConfig.spawn.center[1]} onChange={(e) => updateNested('spawn', 'center', [editingConfig.spawn.center[0], parseFloat(e.target.value), editingConfig.spawn.center[2]])} />
                      <input type="number" className="admin-credit-input" value={editingConfig.spawn.center[2]} onChange={(e) => updateNested('spawn', 'center', [editingConfig.spawn.center[0], editingConfig.spawn.center[1], parseFloat(e.target.value)])} />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <input type="checkbox" checked={editingConfig.spawn.followCamera || false} onChange={(e) => updateNested('spawn', 'followCamera', e.target.checked)} />
                      Follow Camera XZ
                    </label>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Camera Offset Y</div>
                      <input type="number" className="admin-credit-input" value={editingConfig.spawn.cameraOffsetY ?? 0} onChange={(e) => updateNested('spawn', 'cameraOffsetY', parseFloat(e.target.value))} />
                    </label>
                  </div>
                </div>

                <div className="admin-section">
                  <div className="admin-section-head"><h2>Flags</h2></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <input type="checkbox" checked={editingConfig.collideGround || false} onChange={(e) => updateField('collideGround', e.target.checked)} />
                      Collide Ground
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <input type="checkbox" checked={editingConfig.softParticles || false} onChange={(e) => updateField('softParticles', e.target.checked)} />
                      Soft Particles
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <input type="checkbox" checked={editingConfig.castShadow || false} onChange={(e) => updateField('castShadow', e.target.checked)} />
                      Cast Shadow
                    </label>
                    <label>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>Bounciness ({editingConfig.bounciness ?? 0})</div>
                      <input type="range" min={0} max={1} step={0.05} value={editingConfig.bounciness ?? 0} onChange={(e) => updateField('bounciness', parseFloat(e.target.value))} style={{ width: '100%' }} />
                    </label>
                  </div>
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
