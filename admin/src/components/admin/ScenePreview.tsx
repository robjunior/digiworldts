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
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  lights: THREE.Light[];
  pedestals: { ring: THREE.Mesh; glow: THREE.Mesh }[];
  rigs: (SpriteRig | null)[];
  glbRoot: THREE.Group | null;
  glbLoadVersion: number;
  dust: THREE.Points | null;
};

/** Piso da party no preview: topo do `hdd_plattertop` do GLB quando carregado,
 *  senão o knob partyHeight. Espelha o LobbyScene3D do front (mesmo regex e
 *  mesma medição em world coords). */
function lobbyGroundY(f: LobbyRefs, lobby: LobbySceneSettings): number {
  const fallback = lobby.partyHeight ?? 0;
  const root = f.glbRoot;
  if (root === null) return fallback;
  root.updateMatrixWorld(true);
  let top: number | null = null;
  root.traverse((o) => {
    if (!/hdd_plattertop/i.test(o.name)) return;
    const t = new THREE.Box3().setFromObject(o).max.y;
    if (Number.isFinite(t) && (top === null || t > top)) top = t;
  });
  return top !== null ? top : fallback;
}

/** Recompute camera, pedestals, party rigs, lights and fog from the scene
 *  settings + lobby knobs + weather/timeOfDay — so every knob is live. */
function applyLobbyStage(
  f: LobbyRefs,
  settings: SceneSettings,
  lobby: LobbySceneSettings,
  weather: WeatherConfig | null | undefined,
  timeOfDay: TimeOfDayConfig | null | undefined,
): void {
  const partyY = lobbyGroundY(f, lobby);
  const partyH = 0.7 * 5.2 * (lobby.centerScale ?? 1.1) * (lobby.pedestalScale ?? 1);
  const centerY = partyY + partyH / 2;

  // ── camera (perspective; knobs: dist/elev/yaw/fov/lookAtY) ─────────
  const deg = Math.PI / 180;
  const dist = settings.camDist ?? 12.5;
  const elev = (settings.camElevDeg ?? 0) * deg;
  const yaw = (settings.camYawDeg ?? 0) * deg;
  const fov = settings.camFov ?? 36;
  const lookY = partyY + (settings.camLookAtY ?? partyH / 2);
  const pos = new THREE.Vector3(
    Math.sin(yaw) * dist * Math.cos(elev),
    lookY + Math.sin(elev) * dist,
    -Math.cos(yaw) * dist * Math.cos(elev),
  );
  const target = new THREE.Vector3(0, lookY, 0);
  if (settings.cameraType === "ortho") {
    const frust = settings.camFrustum ?? 14;
    if (!(f.camera instanceof THREE.OrthographicCamera)) f.camera = new THREE.OrthographicCamera(-frust, frust, frust, -frust, 0.1, 400);
    f.camera.position.copy(pos);
    f.camera.lookAt(target);
    f.camera.updateProjectionMatrix();
  } else {
    const pc = f.camera instanceof THREE.PerspectiveCamera ? f.camera : (f.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 400));
    pc.fov = fov;
    pc.position.copy(pos);
    pc.lookAt(target);
    pc.updateProjectionMatrix();
  }

  // ── lights (sun/hemi/rim) + weather lighting overrides + time-of-day ──
  for (const l of f.lights) f.scene.remove(l);
  f.lights = [];
  const wl = weather?.lighting;
  const phaseDim = timeOfDay?.fixedPhase === "night" || timeOfDay?.fixedPhase === "dusk" ? 0.45 : 1;
  const hemi = new THREE.HemisphereLight(
    wl?.ambientTint ?? settings.hemiSkyColor ?? 0x88a8d0,
    settings.hemiGroundColor ?? 0x1b2130,
    (settings.hemiIntensity ?? 0.9) * (wl?.ambientDimMult ?? 1) * phaseDim,
  );
  f.scene.add(hemi);
  const key = new THREE.DirectionalLight(
    wl?.sunColor ?? settings.sunColor ?? 0xfff2d0,
    (settings.sunIntensity ?? 1.4) * (wl?.sunIntensityMult ?? 1) * phaseDim,
  );
  key.position.set(settings.sunPosX ?? -6, settings.sunPosY ?? 10, settings.sunPosZ ?? 5);
  f.scene.add(key);
  const rim = new THREE.DirectionalLight(settings.rimColor ?? 0x2c74ff, settings.rimIntensity ?? 0.5);
  rim.position.set(8, 6, -8);
  f.scene.add(rim);
  const fill = new THREE.DirectionalLight(settings.fillColor ?? 0x3b82f6, settings.fillIntensity ?? 0.18);
  fill.position.set(2, 4, 9);
  f.scene.add(fill);
  f.lights = [hemi, key, rim, fill];

  // GLB com luzes próprias → remove key/fill (mesma política do front): mantém
  // hemi (ambiente) + rim como base, senão a arena fica só spot + breu.
  if (f.glbRoot !== null) {
    let glbLight = false;
    f.glbRoot.traverse((o) => { if ((o as THREE.Light).isLight) glbLight = true; });
    if (glbLight) { f.scene.remove(key); f.scene.remove(fill); }
  }

  // ── shadows ──────────────────────────────────────────────────────────
  const shadows = settings.shadowsEnabled === true;
  f.renderer.shadowMap.enabled = shadows;
  if (shadows) {
    f.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    key.castShadow = true;
    const mapSize = settings.shadowMapSize ?? 2048;
    key.shadow.mapSize.set(mapSize, mapSize);
    key.shadow.bias = settings.shadowBias ?? 0;
    key.shadow.normalBias = settings.shadowNormalBias ?? 0;
    key.shadow.radius = settings.shadowRadius ?? 6;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 60;
    key.shadow.camera.left = key.shadow.camera.bottom = -30;
    key.shadow.camera.right = key.shadow.camera.top = 30;
    key.shadow.camera.updateProjectionMatrix();
    f.glbRoot?.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((m as unknown as { isMesh?: boolean }).isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  } else {
    key.castShadow = false;
    f.glbRoot?.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((m as unknown as { isMesh?: boolean }).isMesh) {
        m.castShadow = false;
        m.receiveShadow = true;
      }
    });
  }

  // ── fog (linear / exp2 / height) + exposure ─────────────────────────
  if (settings.fogEnabled === false) {
    f.scene.fog = null;
  } else {
    const fogColor = wl?.fogColor ?? settings.fogColor ?? 0x1e2a44;
    const mode = settings.fogMode ?? "linear";
    if (mode === "exp2" || mode === "height") {
      f.scene.fog = new THREE.FogExp2(
        fogColor,
        mode === "height" ? (settings.fogHeight ?? 0) > 0 ? 0.015 : settings.fogDensity ?? 0.02 : settings.fogDensity ?? 0.02,
      );
    } else {
      if (!(f.scene.fog instanceof THREE.Fog)) f.scene.fog = new THREE.Fog(fogColor, settings.fogNear ?? 14, settings.fogFar ?? 70);
      (f.scene.fog as THREE.Fog).color.setHex(fogColor);
      (f.scene.fog as THREE.Fog).near = settings.fogNear ?? 14;
      (f.scene.fog as THREE.Fog).far = settings.fogFar ?? 70;
    }
  }
  f.renderer.toneMappingExposure = settings.exposure ?? 1;

  // ── ambient dust opacity ────────────────────────────────────────────
  if (f.dust !== null) {
    (f.dust.material as THREE.PointsMaterial).opacity = settings.dustOpacity ?? 0;
    f.dust.visible = (settings.dustOpacity ?? 0) > 0;
  }

  // ── pedestals + party rigs (as before) ─────────────────────────────
  const ps = lobby.pedestalScale ?? 1;
  for (let slot = 0; slot < 3; slot++) {
    const color = new THREE.Color(EL_COLOR[LOBBY_ELEMENTS[slot] ?? "water"] ?? 0x60a5fa);
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
          side: "you",
          slotIndex: 0,
          textureUrl: unitSpriteSheetUrl(LOBBY_UNIT_IDS[slot] ?? "skb-1"),
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

/** Load the arena GLB as backdrop, seated on its floor + arena offsets/span. */
async function loadLobbyGlb(
  f: LobbyRefs,
  modelUrl: string | undefined,
  settings: SceneSettings,
  lobby: LobbySceneSettings,
  weather: WeatherConfig | null | undefined,
  timeOfDay: TimeOfDayConfig | null | undefined,
): Promise<void> {
  if (modelUrl === undefined) return;
  const version = ++f.glbLoadVersion;
  let gltf: Awaited<ReturnType<InstanceType<typeof GLTFLoader>["loadAsync"]>>;
  try {
    gltf = await new GLTFLoader().loadAsync(modelUrl);
  } catch {
    return;
  }
  // race guard: se um modelo mais novo foi pedido enquanto carregava, descarta
  if (version !== f.glbLoadVersion) return;
  const root = gltf.scene;
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  // arenaSpan sets the target size; otherwise normalize only out-of-band models.
  const targetSpan = settings.arenaSpan ?? (span < 20 || span > 90 ? 30 : span);
  if (span > 0 && targetSpan > 0) root.scale.setScalar(targetSpan / span);
  const center = box.getCenter(new THREE.Vector3());
  const ox = settings.arenaOffsetX ?? 0;
  const oy = settings.arenaOffsetY ?? 0;
  const oz = settings.arenaOffsetZ ?? 0;
  root.position.set(-center.x * (targetSpan / (span || 1)) + ox, -box.min.y + oy, -center.z * (targetSpan / (span || 1)) + oz);
  // luzes do GLB em candela estouram o PBR — escala uma vez no load (mesmo
  // fator do LobbyScene3D), jamais no applyLobbyStage (comporia a cada knob).
  const GLB_LIGHT_SCALE = 0.05;
  root.traverse((o) => { const l = o as THREE.Light; if (l.isLight) l.intensity *= GLB_LIGHT_SCALE; });
  f.glbRoot = root;
  f.scene.add(root);
  // o piso da arena mudou (topo do hdd_plattertop) — reassenta party, pedestais
  // e câmera no chão real do modelo recém-carregado
  applyLobbyStage(f, settings, lobby, weather, timeOfDay);
}

function mountLobbyPreview(
  canvas: HTMLCanvasElement,
  f: LobbyRefs,
  settings: SceneSettings,
  lobby: LobbySceneSettings,
  weather: WeatherConfig | null,
  timeOfDay: TimeOfDayConfig | null,
): () => void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // mesmo tomapping do combate: sem ACES as luzes físicas do GLB estouram
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
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
  // ambient dust (responds to the Effects → dustOpacity knob)
  const dustGeo = new THREE.BufferGeometry();
  const dustCount = 240;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 44;
    dustPos[i * 3 + 1] = Math.random() * 16;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 36;
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({ color: 0x9fb0bd, size: 0.05, transparent: true, opacity: 0, depthWrite: false });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);
  f.dust = dust;

  applyLobbyStage(f, settings, lobby, weather, timeOfDay);

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
    if (f.dust !== null) {
      scene.remove(f.dust);
      f.dust.geometry.dispose();
      (f.dust.material as THREE.Material).dispose();
      f.dust = null;
    }
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
            glbLoadVersion: 0,
            dust: null,
          };
      lobbyRef.current = fr;
      const off = mountLobbyPreview(canvas, fr, settings, lobby as LobbySceneSettings, weather ?? null, timeOfDay ?? null);
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          fr.renderer.setSize(width, height);
          const cam = fr.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
          if ((cam as unknown as { isOrthographicCamera?: boolean }).isOrthographicCamera) {
            const o = cam as THREE.OrthographicCamera;
            const h = o.top - o.bottom;
            const w = h * (width / Math.max(height, 1));
            o.left = -w / 2;
            o.right = w / 2;
            o.updateProjectionMatrix();
          } else {
            (cam as THREE.PerspectiveCamera).aspect = width / Math.max(height, 1);
            (cam as THREE.PerspectiveCamera).updateProjectionMatrix();
          }
        }
      });
      ro.observe(container);
      let picked = settings.modelFile !== undefined ? getArenaUrl(settings.modelFile) : undefined;
      const url = picked ?? ARENA_MODEL_BY_KEY[arenaKey];
      void loadLobbyGlb(fr, url, settings, lobby as LobbySceneSettings, weather ?? null, timeOfDay ?? null).catch(() => {});
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
    applyLobbyStage(fr, settings, lobby as LobbySceneSettings, weather ?? null, timeOfDay ?? null);
  }, [settings, lobby, weather, timeOfDay, isLobby]);

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
    void loadLobbyGlb(fr, url, settings, lobby as LobbySceneSettings, weather ?? null, timeOfDay ?? null).catch(() => {});
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