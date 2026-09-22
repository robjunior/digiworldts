import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { TimeOfDayConfig, WeatherConfig } from '@digiworld/shared/weather';

import { ARENA_MODEL_BY_KEY, getArenaUrl } from '@digiworld/scene3d/arena-urls';
import { unitSpriteSheetUrl } from '@digiworld/scene3d';
import { SceneManager, type LobbySceneSettings, type SceneSettings } from '@digiworld/scene3d/scene';
import { SpriteRig } from '@digiworld/scene3d/sprite-rig';

type ScenePreviewProps = {
  readonly arenaKey: string;
  readonly settings: SceneSettings;
  readonly weather?: WeatherConfig | null;
  readonly timeOfDay?: TimeOfDayConfig | null;
  /** When set, the preview renders the LOBBY stage (GLB backdrop + 3-Digimon
   *  party on pedestals) applying the lobby knobs live — mirror of the front
   *  LobbyScene3D so admin edits are visible in the scene preview. */
  readonly lobby?: LobbySceneSettings | null;
  /** GLB-driven mode (the editor's "Use GLB embedded lighting"): load the arena
   *  bare so the GLB drives lighting, falling back to the arena-keyed
   *  atmosphere when the GLB ships no punctual lights. Mirrors what combat
   *  calls (`loadArenaModelBare`) so the preview matches the real scene. */
  readonly useGlbSettings?: boolean;
};

const PLACEHOLDER_UNITS = [
  { unitId: 'preview:you:0', side: 'you' as const, slotIndex: 0, textureUrl: unitSpriteSheetUrl('skb-1'), isSpritesheet: true, onClick: undefined },
  { unitId: 'preview:you:1', side: 'you' as const, slotIndex: 1, textureUrl: unitSpriteSheetUrl('skb-2'), isSpritesheet: true, onClick: undefined },
  { unitId: 'preview:you:2', side: 'you' as const, slotIndex: 2, textureUrl: unitSpriteSheetUrl('skb-3'), isSpritesheet: true, onClick: undefined },
  { unitId: 'preview:opp:0', side: 'opp' as const, slotIndex: 0, textureUrl: unitSpriteSheetUrl('skb-10'), isSpritesheet: true, onClick: undefined },
  { unitId: 'preview:opp:1', side: 'opp' as const, slotIndex: 1, textureUrl: unitSpriteSheetUrl('skb-12'), isSpritesheet: true, onClick: undefined },
];

/* ── lobby preview helpers (mirror LobbyScene3D fan + element colors) ────── */
const LOBBY_UNIT_IDS = ['skb-1', 'skb-2', 'skb-3'];
const LOBBY_ELEMENTS = ['fire', 'water', 'plant'];
const EL_COLOR: Readonly<Record<string, number>> = {
  fire: 0xe0384a,
  water: 0x3b82f6,
  plant: 0x34d399,
  electricity: 0xfbbf24,
  wind: 0x9fb0bd,
  dark: 0xa78bfa,
  light: 0xfbbf24,
  steel: 0x9fb0bd,
};

function fanPosition(index: number, spacing: number): { x: number; z: number } {
  const s = spacing / 108;
  if (index === 0) return { x: -s, z: -1.3 };
  if (index === 2) return { x: s, z: -1.3 };
  return { x: 0, z: 1.7 };
}

type LobbyRefs = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  lights: THREE.Light[];
  pedestals: { ring: THREE.Mesh; glow: THREE.Mesh }[];
  rigs: (SpriteRig | null)[];
  glbRoot: THREE.Group | null;
};

/** Recompute pedestals + party rig positions/scale/lights from lobby settings. */
function applyLobbyStage(f: LobbyRefs, settings: SceneSettings, lobby: LobbySceneSettings): void {
  const partyY = lobby.partyHeight ?? 0;
  // centraliza verticalmente a party no centro exato da geometria
  const partyH = 0.7 * 5.2 * (lobby.centerScale ?? 1.1) * (lobby.pedestalScale ?? 1);
  f.camera.lookAt(0, partyY + partyH / 2, 0);
  f.camera.position.y = partyY + partyH / 2 + 3.2;
  f.camera.updateProjectionMatrix();
  for (const l of f.lights) f.scene.remove(l);
  f.lights = [];
  const key = new THREE.DirectionalLight(settings.sunColor ?? 0xfff2d0, settings.sunIntensity ?? 1.4);
  key.position.set(settings.sunPosX ?? -6, settings.sunPosY ?? 10, settings.sunPosZ ?? 5);
  f.scene.add(key);
  const rim = new THREE.DirectionalLight(settings.rimColor ?? 0x2c74ff, settings.rimIntensity ?? 0.5);
  rim.position.set(8, 6, -8);
  f.scene.add(rim);
  f.lights.push(key, rim);

  const ps = lobby.pedestalScale ?? 1;
  for (let slot = 0; slot < 3; slot++) {
    const color = new THREE.Color(EL_COLOR[LOBBY_ELEMENTS[slot] ?? 'water'] ?? 0x60a5fa);
    const p = f.pedestals[slot];
    if (p) {
      (p.ring.material as THREE.MeshBasicMaterial).color.copy(color);
      (p.glow.material as THREE.MeshBasicMaterial).color.copy(color);
      p.ring.scale.setScalar(ps);
      p.glow.scale.setScalar(ps);
      const pos = fanPosition(slot, lobby.pedestalSpacing);
      p.ring.position.set(pos.x, partyY, pos.z);
      p.glow.position.set(pos.x, partyY, pos.z);
      p.ring.visible = true;
      p.glow.visible = true;
    }
    const base = slot === 1 ? 5.2 : 4.3;
    let rig = f.rigs[slot] ?? null;
    if (rig === null) {
      try {
        rig = new SpriteRig(f.scene, {
          unitId: `preview:lobby:${slot}`,
          side: 'you',
          slotIndex: 0,
          textureUrl: unitSpriteSheetUrl(LOBBY_UNIT_IDS[slot] ?? 'skb-1'),
          isSpritesheet: true,
          idleAnimated: true,
          initiallyDowned: false,
          onClick: undefined,
        });
        rig.setArenaBaselineY(partyY);
        f.rigs[slot] = rig;
      } catch {
        rig = null;
      }
    }
    if (rig !== null) {
      const pos = fanPosition(slot, lobby.pedestalSpacing);
      rig.setBasePosition(pos.x, pos.z);
      rig.setArenaBaselineY(partyY);
      rig.mesh.scale.setScalar(base * (lobby.centerScale ?? 1.1) * (lobby.pedestalScale ?? 1));
    }
  }
}

/** Load the arena GLB as backdrop, seated on its floor. */
async function loadLobbyGlb(f: LobbyRefs, modelUrl: string | undefined): Promise<void> {
  if (modelUrl === undefined) return;
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const root = gltf.scene;
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  if (span > 0 && (span < 20 || span > 90)) root.scale.setScalar(48 / span);
  const center = box.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -box.min.y, -center.z);
  f.glbRoot = root;
  f.scene.add(root);
}

function mountLobbyPreview(canvas: HTMLCanvasElement, f: LobbyRefs, settings: SceneSettings, lobby: LobbySceneSettings): () => void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
  camera.position.set(0, 6.0, 12.5);
  camera.lookAt(0, 2.4, 0);
  f.renderer = renderer;
  f.scene = scene;
  f.camera = camera;

  scene.add(new THREE.HemisphereLight(settings.hemiSkyColor ?? 0x88a8d0, settings.hemiGroundColor ?? 0x1b2130, settings.hemiIntensity ?? 0.9));
  if (settings.fogEnabled !== false) scene.fog = new THREE.Fog(settings.fogColor ?? 0x1e2a44, settings.fogNear ?? 14, settings.fogFar ?? 70);

  f.pedestals = [];
  f.rigs = [];
  for (let slot = 0; slot < 3; slot++) {
    const color = new THREE.Color(EL_COLOR[LOBBY_ELEMENTS[slot] ?? 'water'] ?? 0x60a5fa);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.05, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.9, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.1, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    f.pedestals.push({ ring, glow });
  }
  applyLobbyStage(f, settings, lobby);

  let raf = 0;
  let disposed = false;
  const clock = new THREE.Clock();
  const loop = (): void => {
    if (disposed) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;
    for (const rig of f.rigs) rig?.update(dt, elapsed, camera.quaternion);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  renderer.render(scene, camera);
  raf = requestAnimationFrame(loop);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    for (const rig of f.rigs) rig?.dispose();
    for (const p of f.pedestals) {
      (p.ring.material as THREE.Material).dispose();
      p.ring.geometry.dispose();
      (p.glow.material as THREE.Material).dispose();
      p.glow.geometry.dispose();
    }
    if (f.glbRoot !== null) scene.remove(f.glbRoot);
    renderer.dispose();
  };
}

export function ScenePreview({ arenaKey, settings, weather, timeOfDay, lobby, useGlbSettings }: ScenePreviewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const managerRef = useRef<SceneManager | null>(null);
  const lobbyRef = useRef<LobbyRefs | null>(null);
  const isLobby = lobby !== null && lobby !== undefined;

  /* Single controlled mount: switching arena <-> lobby tears down the old
   preview and builds the new one — deps on isLobby, not a stale first render. */
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;

    if (isLobby) {
      const fr: LobbyRefs = {
        renderer: null as never,
        scene: null as never,
        camera: null as never,
        lights: [],
        pedestals: [],
        rigs: [],
        glbRoot: null,
      };
      lobbyRef.current = fr;
      const off = mountLobbyPreview(canvas, fr, settings, lobby as LobbySceneSettings);
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          fr.renderer.setSize(width, height);
          fr.camera.aspect = width / Math.max(height, 1);
          fr.camera.updateProjectionMatrix();
        }
      });
      ro.observe(container);
      let picked = settings.modelFile !== undefined ? getArenaUrl(settings.modelFile) : undefined;
      const url = picked ?? ARENA_MODEL_BY_KEY[arenaKey];
      void loadLobbyGlb(fr, url).catch(() => {});
      return () => {
        ro.disconnect();
        off();
        lobbyRef.current = null;
      };
    }

    let manager: SceneManager | null = null;
    try {
      manager = new SceneManager(canvas);
    } catch {
      return;
    }
    managerRef.current = manager;
    const rect = container.getBoundingClientRect();
    manager.resize(rect.width, rect.height);
    manager.startLoop();
    manager.runEntrance();
    for (const unit of PLACEHOLDER_UNITS) manager.addSprite(unit);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) managerRef.current?.resize(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(container);
    let picked = settings.modelFile !== undefined ? getArenaUrl(settings.modelFile) : undefined;
    const url = picked ?? ARENA_MODEL_BY_KEY[arenaKey];
    if (url !== undefined) {
      void (useGlbSettings === true
        ? manager.loadArenaModelBare(url, arenaKey)
        : manager.loadArenaModelWithAtmosphere(url, arenaKey)
      ).catch(() => {});
    }
    return () => {
      ro.disconnect();
      manager?.dispose();
      managerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLobby]);

  /* reapply lobby knobs live (settings + lobby) */
  useEffect(() => {
    const fr = lobbyRef.current;
    if (fr === null || !isLobby) return;
    applyLobbyStage(fr, settings, lobby as LobbySceneSettings);
  }, [settings, lobby, isLobby]);

  /* reload GLB when model/arena changes */
  useEffect(() => {
    const fr = lobbyRef.current;
    if (fr === null) return;
    if (fr.glbRoot !== null) {
      fr.scene.remove(fr.glbRoot);
      fr.glbRoot = null;
    }
    if (!isLobby) return;
    let picked = settings.modelFile !== undefined ? getArenaUrl(settings.modelFile) : undefined;
    const url = picked ?? ARENA_MODEL_BY_KEY[arenaKey];
    void loadLobbyGlb(fr, url).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [settings.modelFile, arenaKey, isLobby]);

      /* reload combat GLB when model/arena changes */
      useEffect(() => {
        if (isLobby) return;
        const manager = managerRef.current;
        if (manager === null) return;
        manager.clearArenaModel();
        let picked = settings.modelFile !== undefined ? getArenaUrl(settings.modelFile) : undefined;
        const url = picked ?? ARENA_MODEL_BY_KEY[arenaKey];
        if (url === undefined) return;
        void (useGlbSettings === true
          ? manager.loadArenaModelBare(url, arenaKey)
          : manager.loadArenaModelWithAtmosphere(url, arenaKey)
        ).catch(() => {});
      }, [arenaKey, settings.modelFile, isLobby, useGlbSettings]);

      /* combat scene settings / weather / time */
  useEffect(() => {
    if (isLobby || useGlbSettings === true) return;
    managerRef.current?.applySettings(settings);
  }, [settings, isLobby, useGlbSettings]);

  useEffect(() => {
    if (isLobby) return;
    managerRef.current?.setWeather(weather ?? null);
  }, [weather, isLobby]);

  useEffect(() => {
    if (isLobby) return;
    managerRef.current?.setTimeOfDay(timeOfDay ?? null);
  }, [timeOfDay, isLobby]);

  return (
    <div ref={containerRef} className="scene-admin-preview">
      <canvas ref={canvasRef} className="scene-admin-preview-canvas" aria-label="Live scene preview" />
    </div>
  );
}