import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import type { TimeOfDayConfig, WeatherConfig } from '@digiworld/shared/weather';

import { ARENA_MODEL_BY_KEY, resolveSceneModelUrl } from '@digiworld/scene3d/arena-urls';
import { unitSpriteSheetUrl } from '@digiworld/scene3d';
import { SceneManager, type LobbySceneSettings, type SceneSettings } from '@digiworld/scene3d/scene';
import { SpriteRig } from '@digiworld/scene3d/sprite-rig';
import { createLightShaft, type LightShaftHandle } from '@digiworld/scene3d/volumetric-light';
import { clampLobbyExposure, lobbyHdrCompensation, lobbyPartyGround, resolveLobbyFog } from '@digiworld/scene3d/lobby-settings';

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

function normalizeLobbyGlbLights(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Light)) return;
    if (obj.intensity > 100) obj.intensity = Math.min(obj.intensity * 0.0001, 8);
  });
}

type LobbyRefs = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  lights: THREE.Light[];
  pedestals: { ring: THREE.Mesh; glow: THREE.Mesh }[];
  rigs: (SpriteRig | null)[];
  glbRoot: THREE.Group | null;
  glbLoadVersion: number;
  dust: THREE.Points | null;
  /** luz de palco sobre a party (espelha o LobbyScene3D) */
  stage: THREE.SpotLight | null;
  /** volumes de luz (feixes) ativos */
  lightShafts: LightShaftHandle[];
  stageCenterX: number;
  stageCenterZ: number;
  /** Piso real da party resolvido no load do GLB (platter OU piso do modelo
   *  normalizado) — lobbyStageOrigin lê daqui em vez de re-normalizar a cada
   *  applyLobbyStage (que roda a cada knob change e comporia o scale). */
  partyOrigin: { y: number; x: number; z: number } | null;
};

function lobbyStageOrigin(f: LobbyRefs, lobby: LobbySceneSettings): { y: number; x: number; z: number } {
  const fallback = { y: lobby.partyHeight ?? 0, x: 0, z: 0 };
  // Piso resolvido uma vez no load do GLB (lobbyPartyGround: platter arena OU
  // maior piso do modelo normalizado). Nunca re-meça aqui — applyLobbyStage
  // roda a cada knob change e a renormalização comporia o scale.
  if (f.partyOrigin !== null) return f.partyOrigin;
  return fallback;
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
  const origin = lobbyStageOrigin(f, lobby);
  const partyY = origin.y;
  f.stageCenterX = origin.x;
  f.stageCenterZ = origin.z;
  const partyH = 0.7 * (lobby.pedestalScale ?? 1); // paridade com o front (0.7u)
  // exposição efetiva (range completo do editor 0.2..2.5) — o clamp antigo
  // Math.min(x, 0.30) congelava o knob acima de 0.30; os HDR (brightness,
  // stage, shafts) compensam inversamente via lobbyHdrCompensation.
  const exposure = clampLobbyExposure(settings.exposure);
  f.renderer.toneMappingExposure = exposure;

  // ── camera (perspective; knobs: dist/elev/yaw/fov/lookAtY) ─────────
  const deg = Math.PI / 180;
  const dist = Math.max(settings.camDist ?? 14, 12);
  // defaults ESPELHAM o front (LobbyScene3D): elev 24°, fov 42°
  const elev = (settings.camElevDeg ?? 24) * deg;
  const yaw = (settings.camYawDeg ?? 0) * deg;
  const fov = settings.camFov ?? 42;
  const lookY = partyY + (settings.camLookAtY ?? 0);
  const pos = new THREE.Vector3(
    f.stageCenterX + Math.sin(yaw) * dist * Math.cos(elev),
    lookY + Math.sin(elev) * dist,
    f.stageCenterZ + Math.cos(yaw) * dist * Math.cos(elev),
  );
  const target = new THREE.Vector3(f.stageCenterX, lookY, f.stageCenterZ);
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

  // ── lights — espelha 1:1 o LobbyScene3D: hemi + key(caster) + rim + stage ─
  // Keep directional targets in the scene graph. Without this, the preview's
  // target world matrix can remain stale and shadow/light direction diverges
  // from the actual lobby renderer after knob changes.
  for (const l of f.lights) {
    f.scene.remove(l);
    if (l instanceof THREE.DirectionalLight) f.scene.remove(l.target);
  }
  f.lights = [];
  const wl = weather?.lighting;
  const phaseDim = timeOfDay?.fixedPhase === "night" || timeOfDay?.fixedPhase === "dusk" ? 0.45 : 1;
  const hemi = new THREE.HemisphereLight(
    wl?.ambientTint ?? settings.hemiSkyColor ?? 0x88a8d0,
    settings.hemiGroundColor ?? 0x1b2130,
    (settings.hemiIntensity ?? 0.9) * (wl?.ambientDimMult ?? 1) * phaseDim,
  );
  f.scene.add(hemi);
  f.lights.push(hemi);
  const key = new THREE.DirectionalLight(
    wl?.sunColor ?? settings.sunColor ?? 0xfff2d0,
    (settings.sunIntensity ?? 1.4) * (wl?.sunIntensityMult ?? 1) * phaseDim,
  );
  key.position.set(settings.sunPosX ?? -6, settings.sunPosY ?? 10, settings.sunPosZ ?? 5);
  // DirectionalLight illuminates along position -> target. Aim at the actual
  // stage floor, not world Y=0 (the lobby GLB platter can be far above it).
  key.target.position.set(f.stageCenterX, partyY, f.stageCenterZ);
  key.target.updateMatrixWorld(true);
  f.scene.add(key);
  f.scene.add(key.target);
  f.lights.push(key);
  const rim = new THREE.DirectionalLight(settings.rimColor ?? 0x2c74ff, settings.rimIntensity ?? 0.5);
  rim.position.set(8, 6, -8);
  f.scene.add(rim);
  f.lights.push(rim);
  // luz de palco sobre a party (espelha o front)
  if (f.stage !== null) {
    f.scene.remove(f.stage);
    f.scene.remove(f.stage.target);
    f.stage = null;
  }
  const stageI = lobby.stageLightIntensity ?? 0;
  if (stageI > 0) {
    const stage = new THREE.SpotLight(0xfff1d8, stageI * 1.35 * lobbyHdrCompensation(exposure), 0, 0.62, 0.5, 0);
    stage.castShadow = true;
    stage.shadow.mapSize.set(2048, 2048);
    stage.shadow.bias = -0.0004;
    stage.shadow.normalBias = 0.03;
    stage.shadow.camera.near = 0.5;
    stage.shadow.camera.far = 90;
    const scCam = stage.shadow.camera as unknown as THREE.OrthographicCamera;
    scCam.left = -12;
    scCam.right = 12;
    scCam.top = 12;
    scCam.bottom = -12;
    scCam.updateProjectionMatrix();
    stage.position.set(f.stageCenterX, partyY + 12, f.stageCenterZ + partyH * 0.35 + 7);
    stage.target.position.set(f.stageCenterX, partyY + partyH * 0.3, f.stageCenterZ);
    f.scene.add(stage);
    f.scene.add(stage.target);
    f.stage = stage;
  }

  // ── shadows — sempre ligado (espelha o front) ────────────────────────
  f.renderer.shadowMap.enabled = true;
  f.renderer.shadowMap.type = THREE.PCFShadowMap;
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 60;
  key.shadow.camera.left = -16;
  key.shadow.camera.right = 16;
  key.shadow.camera.top = 16;
  key.shadow.camera.bottom = -16;
  key.shadow.camera.updateProjectionMatrix();
  if (f.stage !== null) f.stage.castShadow = true;
  f.glbRoot?.traverse((o) => {
    const m = o as THREE.Mesh;
    if ((m as unknown as { isMesh?: boolean }).isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });

  // ── fog (linear / exp2 / height) ─────────────────────────────────────
  // resolveLobbyFog é a fonte ÚNICA (dá no front LobbyScene3D o MESMO objeto
  // de névoa); o override de cor do weather fica no call-site do preview.
  f.scene.fog = resolveLobbyFog({ ...settings, fogColor: wl?.fogColor ?? settings.fogColor });
  f.bloomPass.enabled = lobby.bloomEnabled !== false;
  f.bloomPass.strength = lobby.bloomStrength !== undefined ? Math.min(lobby.bloomStrength, 0.35) : 0.3;
  f.bloomPass.radius = lobby.bloomRadius !== undefined ? Math.min(lobby.bloomRadius, 0.5) : 0.45;
  f.bloomPass.threshold = lobby.bloomThreshold !== undefined ? Math.max(lobby.bloomThreshold, 0.85) : 0.9;

  // ── ambient dust opacity ────────────────────────────────────────────
  if (f.dust !== null) {
    (f.dust.material as THREE.PointsMaterial).opacity = settings.dustOpacity ?? 0;
    f.dust.visible = (settings.dustOpacity ?? 0) > 0;
  }

  // ── volumétrico — VolumetricLightShader compartilhado (espelha 1:1 o front) ─
  for (const h of f.lightShafts) {
    f.scene.remove(h.mesh);
    h.dispose();
  }
  f.lightShafts = [];
  const vol = lobby.volumetricIntensity ?? 1;
  if (vol > 0) {
    const sceneFog = f.scene.fog as THREE.Fog | null;
    const fogColor = new THREE.Color(sceneFog?.color ?? 0x1e2a44);
    const fogNear = sceneFog?.near ?? 14;
    const fogFar = sceneFog?.far ?? 70;
    const posW = new THREE.Vector3();
    const fw = new THREE.Vector3();
    const addShaft = (from: THREE.Vector3, dir: THREE.Vector3, angle: number, color: THREE.Color, strength = 0.08): void => {
      const down = -dir.y;
      if (down < 0.02) return;
      const h = Math.min((from.y - partyY) / down, 60);
      if (h < 0.5) return;
      const handle = createLightShaft({
        color,
        // intensidade HDR compensada inversamente ao exposure (espelha o front)
        intensity: strength * vol * lobbyHdrCompensation(exposure),
        position: from,
        forward: dir,
        angle,
        length: h,
        softness: lobby.volumetricSoftness ?? 0.55,
        distanceBlur: lobby.volumetricDistanceBlur ?? 0.65,
        fogColor,
        fogNear,
        fogFar,
        exposure,
      });
      f.scene.add(handle.mesh);
      handle.update(f.camera);
      f.lightShafts.push(handle);
    };
    // manter poucos feixes fortes: só a luz de palco sobre a party (os spots do
    // GLB somam e estouram a cena). Ajustável no admin.
    if (f.stage !== null) {
      posW.copy(f.stage.position);
      fw.set(0, 0, 0).subVectors(f.stage.target.position, f.stage.position);
      if (fw.lengthSq() > 0) {
        fw.normalize();
        addShaft(posW, fw, f.stage.angle, f.stage.color, 0.45);
      }
    }
    if (f.glbRoot !== null) {
      let count = 0;
      const spotPos = new THREE.Vector3();
      const spotTarget = new THREE.Vector3();
      f.glbRoot.traverse((obj) => {
        if (count >= 6 || !(obj instanceof THREE.SpotLight)) return;
        obj.getWorldPosition(spotPos);
        obj.target.getWorldPosition(spotTarget);
        const spotDir = spotTarget.sub(spotPos).normalize();
        addShaft(spotPos, spotDir, obj.angle, obj.color, 0.2);
        count += 1;
      });
    }
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
      p.ring.position.set(f.stageCenterX + pos.x, partyY, f.stageCenterZ + pos.z);
      p.glow.position.set(f.stageCenterX + pos.x, partyY, f.stageCenterZ + pos.z);
      p.ring.visible = true;
      p.glow.visible = true;
    }
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
      rig.setBasePosition(f.stageCenterX + pos.x, f.stageCenterZ + pos.z);
      rig.setArenaBaselineY(partyY);
      // brilho HDR dos sprites compensado inversamente ao exposure (espelha o front)
      (rig.mesh.material as THREE.MeshBasicMaterial).color.setScalar(
        Math.max(lobby.digimonBrightness ?? 1.8, 0) * lobbyHdrCompensation(exposure),
      );
    }
  }
}

/** Load the arena GLB as backdrop, seated on its floor + arena offsets/span.
 *  Mirrors LobbyScene3D: an `hdd_plattertop` GLB is a FIELD (arena-span
 *  transform, party on the platter); a platterless biome/lodge GLB is
 *  normalized to 34/sourceSpan and the party seats ON its real floor plane
 *  (Ground_* / *_Floor / Floor_*), centered — NOT at z=-26 (that left the
 *  digimons floating ~15u in front of the visible floor) and NOT on the
 *  partyHeight knob. The resolved party origin is stored once in
 *  `f.partyOrigin`; applyLobbyStage reads it without renormalizing. */
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
  const probe = lobbyPartyGround(root);
  if (probe !== null && probe.kind === 'platter') {
    // arenaSpan sets the target size; otherwise normalize only out-of-band models.
    const targetSpan = (settings.arenaSpan ?? (span < 20 || span > 90 ? 48 : span)) * 0.75;
    if (span > 0 && targetSpan > 0) root.scale.setScalar(targetSpan / span);
    const center = box.getCenter(new THREE.Vector3());
    const ox = settings.arenaOffsetX ?? 0;
    const oy = settings.arenaOffsetY ?? 0;
    const oz = settings.arenaOffsetZ ?? 0;
    root.position.set(-center.x * (targetSpan / (span || 1)) + ox, -box.min.y + oy, -center.z * (targetSpan / (span || 1)) + oz);
    root.updateMatrixWorld(true);
    f.partyOrigin = lobbyPartyGround(root);
  } else {
    // Biome/lodge: reset the load-callback field transform (arenaSpan/offsets
    // are arena-tuned and would blow up these models), normalize to
    // 34/sourceSpan and seat the party on the model's real floor center.
    root.position.set(0, 0, 0);
    root.scale.setScalar(1);
    root.updateMatrixWorld(true);
    const sourceBox = new THREE.Box3().setFromObject(root);
    const sourceSpan = Math.max(sourceBox.getSize(new THREE.Vector3()).length(), 1);
    root.scale.setScalar(34 / sourceSpan);
    root.updateMatrixWorld(true);
    f.partyOrigin = lobbyPartyGround(root);
    if (f.partyOrigin === null) f.partyOrigin = { y: lobby.partyHeight ?? 0, x: 0, z: 0 };
  }
  root.updateMatrixWorld(true);
  f.glbRoot = root;
  normalizeLobbyGlbLights(root);
  f.scene.add(root);
  // o piso da arena mudou (topo do hdd_plattertop/maior piso) — reassenta
  // party, pedestais e câmera no chão real do modelo recém-carregado
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
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), lobby.bloomStrength ?? 0.85, lobby.bloomRadius ?? 0.55, lobby.bloomThreshold ?? 0.65);
  bloomPass.enabled = lobby.bloomEnabled !== false;
  composer.addPass(bloomPass);
  f.composer = composer;
  f.bloomPass = bloomPass;
  const initialWidth = Math.max(1, canvas.clientWidth || canvas.parentElement?.clientWidth || 1);
  const initialHeight = Math.max(1, canvas.clientHeight || canvas.parentElement?.clientHeight || 1);
  f.composer.setSize(initialWidth, initialHeight);
  camera.aspect = initialWidth / initialHeight;
  camera.updateProjectionMatrix();

  // hemi/fog são criados/redefinidos pelo applyLobbyStage (evita dupla
  // iluminação e espelha 1:1 o front)

  f.pedestals = [];
  f.rigs = [];
  for (let slot = 0; slot < 3; slot++) {
    const color = new THREE.Color(EL_COLOR[LOBBY_ELEMENTS[slot] ?? 'water'] ?? 0x60a5fa);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.1, depthWrite: false }));
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
    f.composer.render();
    raf = requestAnimationFrame(loop);
  };
  f.composer.render();
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
    if (f.stage !== null) {
      scene.remove(f.stage);
      scene.remove(f.stage.target);
      f.stage = null;
    }
    for (const h of f.lightShafts) {
      scene.remove(h.mesh);
      h.dispose();
    }
    f.lightShafts = [];
    f.composer.dispose();
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
            composer: null as never,
            bloomPass: null as never,
            camera: null as never,
            lights: [],
            pedestals: [],
            rigs: [],
            glbRoot: null,
            glbLoadVersion: 0,
            dust: null,
            stage: null,
            lightShafts: [],
            stageCenterX: 0,
            stageCenterZ: 0,
            partyOrigin: null,
          };
      lobbyRef.current = fr;
      const off = mountLobbyPreview(canvas, fr, settings, lobby as LobbySceneSettings, weather ?? null, timeOfDay ?? null);
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          fr.renderer.setSize(width, height);
          fr.composer.setSize(width, height);
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
      const url = resolveSceneModelUrl(settings.modelFile, ARENA_MODEL_BY_KEY[arenaKey]);
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
    const url = resolveSceneModelUrl(settings.modelFile, ARENA_MODEL_BY_KEY[arenaKey]);
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
    fr.partyOrigin = null; // novo load — piso antigo não vale (platter→biome etc.)
    if (!isLobby) return;
    const url = resolveSceneModelUrl(settings.modelFile, ARENA_MODEL_BY_KEY[arenaKey]);
    void loadLobbyGlb(fr, url, settings, lobby as LobbySceneSettings, weather ?? null, timeOfDay ?? null).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [settings.modelFile, arenaKey, isLobby]);

      /* reload combat GLB when model/arena changes */
      useEffect(() => {
        if (isLobby) return;
        const manager = managerRef.current;
        if (manager === null) return;
        manager.clearArenaModel();
        const url = resolveSceneModelUrl(settings.modelFile, ARENA_MODEL_BY_KEY[arenaKey]);
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