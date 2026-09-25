/**
 * LobbyScene3D — the lobby's live 3D backdrop.
 *
 * Renders the SceneEntity configured as `kind: 'lobby'` with real Three.js and
 * the SAME SpriteRig the combat screen uses: the party Digimon stand on
 * holographic pedestals in a fan formation, idle-animating from their real
 * sprite sheets (unitSpriteSheetUrl), updating in real time whenever the party
 * changes (diff by roster id, add/remove/reposition — no full remount).
 *
 * Scene knobs come from `settings.lobby` (admin scene editor): pedestal
 * formation (spacing/scale/tilt/lift) and camera drift. The ENVIRONMENT is
 * always the scene's `modelFile` GLB — which the Lobby screen guarantees by
 * falling back to the default arena GLB when the lobby scene has none — so
 * the party always stands on a real scene, never on a generated backdrop.
 * With `useGlbSettings` the GLB also drives camera and lights.
 *
 * UI (dock, panels, plaque) floats above in `.lobby-shell` — this layer is
 * pointer-transparent except the figure labels, which open the creature page.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SpriteRig } from '@digiworld/scene3d/sprite-rig';
import { createLightShaft, type LightShaftHandle } from '@digiworld/scene3d/volumetric-light';
import type { LobbySceneSettings, SceneSettings } from '@digiworld/scene3d/scene';

import { unitSpriteSheetUrl } from '../../lib/asset-preload';

export type LobbyFigure = {
  readonly id: string;
  readonly catalogId: string;
  readonly nickname: string;
  readonly level: number;
  readonly element: string;
};

type Props = {
  readonly settings: LobbySceneSettings;
  /** Exactly 3 slots — null = empty pedestal (holo + invite). */
  readonly party: readonly (LobbyFigure | null)[];
  /** Optional arena GLB URL to use as the lobby environment. */
  readonly modelUrl?: string | null;
  /** GLB-driven mode: use the GLB's own camera/lights/floor and surrender ours. */
  readonly useGlbSettings?: boolean;
  /** Editor lighting for the scene (lighting knobs, reutilizados do subset da
   *  arena) — aplicado quando o GLB não dirige a iluminação. */
  readonly lighting?: Partial<SceneSettings>;
  readonly onOpenCreature?: (monId: string) => void;
};

const EL_COLOR: Readonly<Record<string, string>> = {
  fire: '#e0384a',
  water: '#3b82f6',
  plant: '#34d399',
  electricity: '#fbbf24',
  wind: '#9fb0bd',
  dark: '#a78bfa',
  light: '#fbbf24',
  steel: '#9fb0bd',
  earth: '#d97706',
  ice: '#60a5fa',
};

const GROUND_Y = 0;
/** Slot fan formation (world units). Center is closer to the camera.
 *  Spacing shrinks with a higher divisor so the party reads as one unit —
 *  the default 256px pedestalSpacing yields ~2.4 units between centers. */
function fanPosition(index: number, spacing: number): { x: number; z: number } {
  const s = spacing / 108;
  if (index === 0) return { x: -s, z: -1.3 };
  if (index === 2) return { x: s, z: -1.3 };
  return { x: 0, z: 1.7 };
}

function elementColor(element: string): THREE.Color {
  return new THREE.Color(EL_COLOR[element] ?? '#60a5fa');
}

function normalizeLobbyGlbLights(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Light)) return;
    // Blender exports candela values that are several orders of magnitude too
    // high for this ACES/WebGL pipeline. Normalize only those HDR outliers and
    // preserve ordinary authored fill lights.
    if (obj.intensity > 100) obj.intensity = Math.min(obj.intensity * 0.0001, 8);
  });
}

export function LobbyScene3D({ settings, party, modelUrl, useGlbSettings, lighting, onOpenCreature }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const fallbackRef = useRef<HTMLDivElement | null>(null);
  const partySyncRef = useRef<() => void>(() => undefined);
  const partyRef = useRef<Props['party']>(party);
  partyRef.current = party;

  useEffect(() => {
    try {
    const host = hostRef.current;
    if (host === null) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      if (fallbackRef.current !== null) fallbackRef.current.hidden = false;
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    // Sem o tone mapping do combate, as luzes físicas do GLB (intensidades
    // candela altíssimas) clipam pro branco e a cena fica estourada/mos da.
    // Mesmo setup do SceneManager de combate para coerência da arena.
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Embedded arena lights are authored in candela; keep the lobby in a
    // cinematic range instead of clipping the floor to white.
    renderer.toneMappingExposure = Math.min(lighting?.exposure ?? 0.28, 0.30);
    // Projeção de sombras reais (o SpriteRig projeta o contorno do digimon via
    // customDepthMaterial+alpha; sem shadowMap habilitado nada projetava).
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      lighting?.camFov ?? 42,
      host.clientWidth / Math.max(host.clientHeight, 1),
      0.1,
      400,
    );
    // Cinematic lobby framing: the authored GLB camera is usually a close
    // inspection camera. The lobby uses the editor camera controls so the
    // preview and the real frontend stay framed identically.
    const cameraTargetY = lighting?.camLookAtY ?? 3.0;
    // Distância de apresentação: quanto >MENOR> o valor, mais perto a câmera
    // fica dos digimons. O clamp baixo (12) garante que o camDist do editor
    // consiga dar zoom (antes era um piso duro de 26 que impedia aproximar).
    const cameraDistance = Math.max(lighting?.camDist ?? 14, 12);
    const cameraElevation = THREE.MathUtils.degToRad(lighting?.camElevDeg ?? 24);
    const cameraYaw = THREE.MathUtils.degToRad(lighting?.camYawDeg ?? 0);
    const cameraBase = new THREE.Vector3(
      Math.sin(cameraYaw) * Math.cos(cameraElevation) * cameraDistance,
      cameraTargetY + Math.sin(cameraElevation) * cameraDistance,
      Math.cos(cameraYaw) * Math.cos(cameraElevation) * cameraDistance,
    );
    // Piso da party: o GLB pode substituir este fallback pelo topo do
    // hdd_plattertop quando terminar de carregar.
    let groundY = settings.partyHeight ?? 0;
    const partyH = 0.7 * 5.2 * (settings.centerScale ?? 1.1) * (settings.pedestalScale ?? 1);
    let camCenterY = groundY + (lighting?.camLookAtY ?? 0);
    camera.position.copy(cameraBase);
    camera.lookAt(0, camCenterY, 0);
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(host.clientWidth, host.clientHeight),
      settings.bloomStrength !== undefined ? Math.min(settings.bloomStrength, 0.35) : 0.3,
      settings.bloomRadius !== undefined ? Math.min(settings.bloomRadius, 0.5) : 0.45,
      settings.bloomThreshold !== undefined ? Math.max(settings.bloomThreshold, 0.85) : 0.9,
    );
    bloomPass.enabled = settings.bloomEnabled !== false;
    composer.addPass(bloomPass);
    //    useGlbSettings e o GLB traz as dele — política do loadArenaModelBare) ─
    const L = lighting ?? {};
    const ownLights: THREE.Light[] = [];
    const hemi = new THREE.HemisphereLight(
      L.hemiSkyColor ?? 0x88a8d0,
      L.hemiGroundColor ?? 0x1b2130,
      L.hemiIntensity ?? 0.9,
    );
    ownLights.push(hemi);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(L.sunColor ?? 0xfff2d0, L.sunIntensity ?? 1.4);
    key.position.set(L.sunPosX ?? -6, L.sunPosY ?? 10, L.sunPosZ ?? 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 60;
    const ksc = 16;
    key.shadow.camera.left = -ksc;
    key.shadow.camera.right = ksc;
    key.shadow.camera.top = ksc;
    key.shadow.camera.bottom = -ksc;
    key.shadow.camera.updateProjectionMatrix();
    key.target.position.set(0, 0, 0);
    ownLights.push(key);
    scene.add(key);
    scene.add(key.target);
    const rim = new THREE.DirectionalLight(L.rimColor ?? 0x2c74ff, L.rimIntensity ?? 0.5);
    rim.position.set(8, 6, -8);
    ownLights.push(rim);
    scene.add(rim);
    // ── luz de palco sobre a party ──────────────────────────────────────
    // Spot ACIMA/à frente: ilumina um pool no piso (sombra projeta nele),
    // casta a SILHUETA dos digimons e alimenta um feixe volumétrico. Decay 0
    // → intensidade constante no cone (previsível pra estilizar sob o low
    // exposure). Intensidade em HDR pra ler com a cena escura.
    const stage = new THREE.SpotLight(
      0xfff1d8,
      (settings.stageLightIntensity ?? 0) * 1.35,
      0,
      0.62,
      0.5,
      0,
    );
    stage.castShadow = true;
    stage.shadow.mapSize.set(2048, 2048);
    stage.shadow.bias = -0.0004;
    stage.shadow.normalBias = 0.03;
    stage.shadow.camera.near = 0.5;
    stage.shadow.camera.far = 90;
    const ssc = 12;
    const scCam = stage.shadow.camera as unknown as THREE.OrthographicCamera;
    scCam.left = -ssc;
    scCam.right = ssc;
    scCam.top = ssc;
    scCam.bottom = -ssc;
    scCam.updateProjectionMatrix();
    stage.position.set(0, 16, 10);
    stage.target.position.set(0, 0, 0);
    ownLights.push(stage);
    scene.add(stage);
    scene.add(stage.target);
    // senta a luz de palco sobre o piso atual (groundY) — re-chamado quando o
    // platter do GLB define a altura real.
    const seatStageLight = (): void => {
      stage.position.set(0, groundY + 12, partyH * 0.35 + 7);
      stage.target.position.set(0, groundY + partyH * 0.3, 0);
      stage.target.updateMatrixWorld();
    };
    seatStageLight();
    // névoa do cenário (do editor) — afasta o horizonte do GLB
    if (L.fogEnabled !== false) {
      scene.fog = new THREE.Fog(L.fogColor ?? 0x1e2a44, L.fogNear ?? 14, L.fogFar ?? 70);
    }

    // optional GLB environment — o cenário É o GLB (nunca um conjunto procedural)
    let glbRoot: THREE.Group | null = null;
    const glbDrives = useGlbSettings === true;
    const lightShafts: LightShaftHandle[] = [];
    if (modelUrl) {
      try {
        new GLTFLoader().load(
          modelUrl,
          (gltf) => {
            glbRoot = gltf.scene;
            const box = new THREE.Box3().setFromObject(glbRoot);
            const size = box.getSize(new THREE.Vector3());
            const span = Math.max(size.x, size.y, size.z);
            const center = box.getCenter(new THREE.Vector3());
            // arenaSpan controla o tamanho da arena no lobby; senão, normaliza
            // modelos fora de banda (muito pequenos/grandes) para um span razoável.
            const targetSpan = lighting?.arenaSpan ?? (span < 20 || span > 90 ? 48 : span);
            if (span > 0 && targetSpan > 0) glbRoot.scale.setScalar(targetSpan / span);
            const ox = lighting?.arenaOffsetX ?? 0;
            const oy = lighting?.arenaOffsetY ?? 0;
            const oz = lighting?.arenaOffsetZ ?? 0;
            glbRoot.position.set(-center.x * (targetSpan / (span || 1)) + ox, -(box.min.y + 0.02) + oy, -center.z * (targetSpan / (span || 1)) + oz);
            normalizeLobbyGlbLights(glbRoot);
            scene.add(glbRoot);

            // A altura da arena é o topo do `hdd_plattertop` do GLB — assim que
            // o modelo carrega, senta party/pedestais/holos/câmera nele.
            fitPartyToPlatter(glbRoot);

            // A câmera do lobby é controlada pelo editor (camDist/FOV/elev/yaw),
            // não pela câmera de inspeção que muitos GLBs incluem.
            // Luzes do GLB ficam COMO AUTORADAS — neste pipeline o tonemapping
            // ACES + o knob exposure do editor são o controle tonal (normalizar
            // candela mecanicamente estourava o escuro: mean 128→57).
            // Arena recebe/casta sombra e os casters (key + stage) projetam as
            // silhuetas dos digimons no chão.
            glbRoot.traverse((obj) => {
              const m = obj as THREE.Mesh;
              if ((m as unknown as { isMesh?: boolean }).isMesh) {
                m.castShadow = true;
                m.receiveShadow = true;
              }
            });
            // luz de palco + feixes volumétricos no piso real (platter)
            seatStageLight();
            rebuildLightShafts();
          },
          undefined,
          () => {
            /* GLB indisponível — fundo da página + party seguem renderizando */
          },
        );
      } catch {
        /* loader sync failure — fundo da página + party seguem renderizando */
      }
    }

    // ── pedestals ─────────────────────────────────────────────────────
    const pedestalMatPool = new Map<string, THREE.MeshBasicMaterial>();
    const pedestals: { ring: THREE.Mesh; glow: THREE.Mesh }[] = [];
    const pedestalGroup = new THREE.Group();
    scene.add(pedestalGroup);

    const elementColor = (element: string): THREE.Color =>
      new THREE.Color(EL_COLOR[element] ?? '#60a5fa');

    const buildPedestal = (element: string): void => {
      const key = element;
      let mat = pedestalMatPool.get(key);
      if (mat === undefined) {
        mat = new THREE.MeshBasicMaterial({ color: elementColor(key), transparent: true, opacity: 0.45, side: THREE.DoubleSide });
        pedestalMatPool.set(key, mat);
      }
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.05, 48), mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = GROUND_Y + 0.01 + groundY;
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(1.9, 48),
        new THREE.MeshBasicMaterial({ color: elementColor(key), transparent: true, opacity: 0.1, depthWrite: false }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = GROUND_Y + 0.005 + groundY;
      pedestalGroup.add(ring, glow);
      pedestals.push({ ring, glow });
    };

    for (const fig of partyRef.current) buildPedestal(fig?.element ?? 'water');

    // holo placeholder for empty slots
    const holos: THREE.Mesh[] = [];
    for (const fig of partyRef.current) {
      if (fig !== null && fig !== undefined) continue;
      const mat = new THREE.MeshBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.28,
        wireframe: true,
        depthWrite: false,
      });
      const holo = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 3.6, 20, 1, true), mat);
      holo.position.y = GROUND_Y + 1.8 + groundY;
      scene.add(holo);
      holos.push(holo);
    }

    // ── party sprites (the real combat SpriteRig) ───────────────────────
    const rigs = new Map<string, SpriteRig>();
    const bySlot = new Map<number, SpriteRig>();

    const applyFan = (): void => {
      for (let slot = 0; slot < 3; slot++) {
        const rig = bySlot.get(slot);
        if (!rig) continue;
        const pos = fanPosition(slot, settings.pedestalSpacing);
        rig.setBasePosition(pos.x, pos.z);
        // SPRITE_MAX_DIMENSION is 0.7 world units — scale up so the party
        // reads as proper standing figures (central slightly bigger).
        const base = slot === 1 ? 5.2 : 4.3;
        rig.mesh.scale.setScalar(base * settings.centerScale * settings.pedestalScale);
      }
      const ps = settings.pedestalScale;
      for (const p of pedestals) {
        p.ring.scale.setScalar(ps);
        p.glow.scale.setScalar(ps);
      }
      for (const holo of holos) holo.scale.setScalar(ps);
    };

    const syncParty = (): void => {
      const wanted = new Set<string>();
      for (let slot = 0; slot < 3; slot++) {
        const fig = partyRef.current[slot];
        const label = labelRefs.current[slot];
        // recalibra o pedestal do slot com a cor de elemento da figura atual
        const p = pedestals[slot];
        if (p) {
          const col = elementColor(fig?.element ?? 'water');
          (p.ring.material as THREE.MeshBasicMaterial).color.copy(col);
          (p.glow.material as THREE.MeshBasicMaterial).color.copy(col);
        }
        // holo do slot vazio aparece; com figura, some
        const holo = holos[slot];
        if (holo) holo.visible = fig === null || fig === undefined;
        if (!fig) {
          if (label !== null && label !== undefined) {
            label.hidden = false;
          }
          continue;
        }
        wanted.add(fig.id);
        let rig = rigs.get(fig.id);
        if (rig === undefined) {
          try {
            rig = new SpriteRig(scene, {
              unitId: fig.id,
              side: 'you',
              slotIndex: 0,
              textureUrl: unitSpriteSheetUrl(fig.catalogId),
              isSpritesheet: true,
              idleAnimated: true,
              initiallyDowned: false,
              onClick: undefined,
            });
            rig.setArenaBaselineY(groundY);
            rigs.set(fig.id, rig);
          } catch (err) {
            // one failing sprite must never blank the whole scene
            console.warn('[LobbyScene3D] sprite create failed', fig.id, err);
            continue;
          }
        }
        bySlot.set(slot, rig);
        rig.setTextureUrl(unitSpriteSheetUrl(fig.catalogId));
        // Iluminação simulada estilo Octopath: o sprite (MeshBasic) é não-luz
        // e o tonemapping ACES no low exposure apaga ele — multiplicar o
        // albedo do sheet mantém os digimons legíveis/brilhantes na cena.
        (rig.mesh.material as THREE.MeshBasicMaterial).color.setScalar(Math.max(settings.digimonBrightness ?? 1.8, 0));
        if (label !== null && label !== undefined) {
          label.hidden = false;
        }
      }
      for (const [id, rig] of rigs) {
        if (!wanted.has(id)) {
          rig.dispose();
          rigs.delete(id);
        }
      }
      applyFan();
    };

    // ── piso da arena: topo do `hdd_plattertop` do GLB ──────────────────
    // Todo GLB de lobby carrega esse elemento (o prato do HDD); o topo dele é
    // a altura do piso onde a party apoia. Medido em WORLD coords (pós escala/
    // posição do root) — por isso updateMatrixWorld antes do Box3.
    const platterTopY = (root: THREE.Group): number | null => {
      root.updateMatrixWorld(true);
      let top: number | null = null;
      root.traverse((obj) => {
        if (!/hdd_plattertop/i.test(obj.name)) return;
        const t = new THREE.Box3().setFromObject(obj).max.y;
        if (Number.isFinite(t) && (top === null || t > top)) top = t;
      });
      return top;
    };

    /** Senta a party/pedestais/holos/câmera no topo exato do `hdd_plattertop`.
     *  Se o GLB é inválido de lobby (sem o platter pra apoiar os digimons),
     *  FALLBACK para a regra anterior das cenas 3D: party em partyHeight,
     *  câmera padrão, o GLB só como ambiente. */
    function fitPartyToPlatter(root: THREE.Group): void {
      const top = platterTopY(root);
      if (top === null) {
        console.warn('[LobbyScene3D] GLB do lobby sem hdd_plattertop — usa como backdrop (partyHeight)');
        groundY = settings.partyHeight ?? 0;

        // Biome/lodge GLBs are environments, not arena stages. Their geometry
        // has no authored party floor and can sit between the camera and the
        // sprites when left at the arena transform. Reframe these models as a
        // distant backdrop; arena GLBs keep the field transform above.
        root.position.set(0, 0, 0);
        root.updateMatrixWorld(true);
        const sourceBox = new THREE.Box3().setFromObject(root);
        const sourceSpan = Math.max(sourceBox.getSize(new THREE.Vector3()).length(), 1);
        root.scale.multiplyScalar(34 / sourceSpan);
        root.updateMatrixWorld(true);
        const backdropBox = new THREE.Box3().setFromObject(root);
        const backdropCenter = backdropBox.getCenter(new THREE.Vector3());
        const viewTarget = new THREE.Vector3(0, groundY + partyH / 2, 0);
        const viewDirection = viewTarget.clone().sub(cameraBase).normalize();
        const backdropWorldCenter = viewTarget.clone().addScaledVector(viewDirection, 26);
        root.position.set(
          backdropWorldCenter.x - backdropCenter.x,
          backdropWorldCenter.y - backdropCenter.y,
          backdropWorldCenter.z - backdropCenter.z,
        );
        root.updateMatrixWorld(true);

        camCenterY = groundY + (lighting?.camLookAtY ?? 0);
        cameraBase.y = camCenterY + Math.sin(cameraElevation) * cameraDistance;
        for (const p of pedestals) {
          p.ring.position.y = GROUND_Y + 0.01 + groundY;
          p.glow.position.y = GROUND_Y + 0.005 + groundY;
        }
        for (const holo of holos) holo.position.y = GROUND_Y + 1.8 + groundY;
        for (const rig of rigs.values()) rig.setArenaBaselineY(groundY);
        seatStageLight();
        rebuildLightShafts();
        return;
      }
      groundY = top;
      camCenterY = groundY + (lighting?.camLookAtY ?? 0);
      cameraBase.y = camCenterY + Math.sin(cameraElevation) * cameraDistance;
      for (const p of pedestals) {
        p.ring.position.y = GROUND_Y + 0.01 + groundY;
        p.glow.position.y = GROUND_Y + 0.005 + groundY;
      }
      for (const holo of holos) holo.position.y = GROUND_Y + 1.8 + groundY;
      for (const rig of rigs.values()) rig.setArenaBaselineY(groundY);
      // reassenta a luz de palco + feixes volumétricos no piso real (platter)
      seatStageLight();
      rebuildLightShafts();
    }

    // ── volumétrico: volumes de luz (spots do GLB + luz de palco) ───────
    const clearLightShafts = (): void => {
      for (const h of lightShafts) {
        scene.remove(h.mesh);
        h.dispose();
      }
      lightShafts.length = 0;
    };
    /** Volumes de luz ray-marched (VolumetricLightShader) de cada SpotLight do
     *  ponto até o piso — god-rays de palco. Intensidade HDR × volumetricIntensity
     *  pra ler mesmo sob o low exposure do tonemapping. */
    function rebuildLightShafts(): void {
      clearLightShafts();
      const vol = settings.volumetricIntensity ?? 1;
      if (vol <= 0) return;
      const fog = scene.fog as THREE.Fog | null;
      const fogColor = new THREE.Color(fog?.color ?? 0x1e2a44);
      const fogNear = fog?.near ?? 14;
      const fogFar = fog?.far ?? 70;
      const exposure = renderer.toneMappingExposure || 1;
      const fwd = new THREE.Vector3();
      const addShaft = (
        from: THREE.Vector3,
        dir: THREE.Vector3,
        angle: number,
        color: THREE.Color,
        strength = 0.08,
      ): void => {
        const down = -dir.y;
        if (down < 0.02) return;
        const h = Math.min((from.y - groundY) / down, 60);
        if (h < 0.5) return;
        const handle = createLightShaft({
          color,
          intensity: strength * vol,
          position: from,
          forward: dir,
          angle,
          length: h,
          softness: settings.volumetricSoftness ?? 0.55,
          distanceBlur: settings.volumetricDistanceBlur ?? 0.65,
          fogColor,
          fogNear,
          fogFar,
          exposure,
        });
        scene.add(handle.mesh);
        handle.update(camera);
        lightShafts.push(handle);
      };

      // manter poucos feixes fortes: só a luz de palco sobre a party (os spots
      // do GLB espalham 9 feixes → somam e estouram a cena). Ajustável no admin.
      const stageHit = new THREE.Vector3().copy(stage.position);
      fwd.set(0, 0, 0).subVectors(stage.target.position, stage.position);
      if (fwd.lengthSq() > 0) {
        fwd.normalize();
        addShaft(stageHit, fwd, stage.angle, stage.color, 0.45);
      }

      // The authored arena contains the actual stage rig. Reuse its downward
      // spotlights as atmospheric sources so the lobby matches the cinematic
      // wide shot instead of showing one isolated cone over the party.
      if (glbRoot !== null) {
        let count = 0;
        const spotPos = new THREE.Vector3();
        const spotTarget = new THREE.Vector3();
        glbRoot.traverse((obj) => {
          if (count >= 6 || !(obj instanceof THREE.SpotLight)) return;
          obj.getWorldPosition(spotPos);
          obj.target.getWorldPosition(spotTarget);
          const spotDir = spotTarget.sub(spotPos).normalize();
          addShaft(spotPos, spotDir, obj.angle, obj.color, 0.2);
          count += 1;
        });
      }
    }

    // initial build
    syncParty();

    // ── labels projection + camera drift + loop ─────────────────────────
    const clock = new THREE.Clock();
    let raf = 0;
    let disposed = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let mouseX = 0;
    let mouseY = 0;
    const onPointerMove = (e: PointerEvent): void => {
      mouseX = e.clientX / window.innerWidth - 0.5;
      mouseY = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const labelV = new THREE.Vector3();
    const loop = (): void => {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;

      // Camera is always the editor-controlled cinematic camera so the front
      // and admin preview never diverge because of an authored GLB camera.
      const activeCam = camera;
      // camera drift: slow idle orbit + subtle pointer parallax
      const k = reduced ? 0 : settings.driftIntensity;
      const yaw = k * (Math.sin(elapsed * 0.14) * 0.06 + mouseX * 0.09);
      const pitch = k * (Math.cos(elapsed * 0.11) * 0.04 + mouseY * 0.06);
      camera.position.set(
        cameraBase.x * Math.cos(yaw) + cameraBase.z * Math.sin(yaw),
        cameraBase.y + pitch * 6,
        -cameraBase.x * Math.sin(yaw) + cameraBase.z * Math.cos(yaw),
      );
      // smooth camera look target (always the party's vertical center)
      camera.lookAt(yaw * 1.5, camCenterY + pitch * 2, 0);

      bloomPass.enabled = settings.bloomEnabled !== false;
      bloomPass.strength = settings.bloomStrength !== undefined ? Math.min(settings.bloomStrength, 0.35) : 0.3;
      bloomPass.radius = settings.bloomRadius !== undefined ? Math.min(settings.bloomRadius, 0.5) : 0.45;
      bloomPass.threshold = settings.bloomThreshold !== undefined ? Math.max(settings.bloomThreshold, 0.85) : 0.9;

      for (const rig of rigs.values()) rig.update(dt, elapsed, activeCam.quaternion);
      // mantém o uniforme de câmera dos volumes de luz em sync (drift)
      for (const h of lightShafts) h.update(activeCam);

      // project figure labels onto the screen
      const w = host.clientWidth;
      const h = host.clientHeight;
      for (let slot = 0; slot < 3; slot++) {
        const label = labelRefs.current[slot];
        const rig = bySlot.get(slot);
        if (!label || !rig) continue;
        labelV.copy(rig.worldPosition).project(activeCam);
        if (labelV.z > 1) {
          label.hidden = true;
        } else {
          label.hidden = false;
          label.style.left = `${((labelV.x * 0.5 + 0.5) * w).toFixed(0)}px`;
          label.style.top = `${((-labelV.y * 0.5 + 0.5) * h).toFixed(0)}px`;
        }
      }
      // holo flicker
      const holoPulse = 0.2 + (Math.sin(elapsed * 2.2) + 1) * 0.07;
      for (const holo of holos) (holo.material as THREE.MeshBasicMaterial).opacity = holoPulse;

      composer.render();
      raf = requestAnimationFrame(loop);
    };
    // first paint immediately — never a black frame while the rAF warms up
    composer.render();
    raf = requestAnimationFrame(loop);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        renderer.setSize(width, height);
        composer.setSize(width, height);
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
      }
    });
    resizeObserver.observe(host);

    // ── live party updates ───────────────────────────────────────────────
    partySyncRef.current = () => syncParty();
    syncParty();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointerMove);
      resizeObserver.disconnect();
      for (const rig of rigs.values()) rig.dispose();
      rigs.clear();
      if (glbRoot !== null) scene.remove(glbRoot);
      clearLightShafts();
      composer.dispose();
      scene.remove(pedestalGroup);
      for (const mat of pedestalMatPool.values()) mat.dispose();
      for (const holo of holos) {
        scene.remove(holo);
        (holo.material as THREE.Material).dispose();
        holo.geometry.dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
    } catch (err) {
      // qualquer erro no mount nunca deixa tela vazia silenciosa: cai no
      // fallback honesto e loga para diagnóstico.
      console.error('[LobbyScene3D] mount failed:', err);
      if (fallbackRef.current !== null) fallbackRef.current.hidden = false;
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, modelUrl, useGlbSettings, lighting]);

  // Party changes → live re-sync (the scene mounts once; this effect reuses it)
  useEffect(() => {
    try {
      partySyncRef.current();
    } catch (err) {
      console.error('[LobbyScene3D] party sync failed:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party]);

  return (
    <div className="lobby-scene3d" ref={hostRef} data-od-id="lobby-scene3d">
      <div className="lobby-scene3d-fallback" ref={fallbackRef} hidden role="img" aria-label="Cena 3D indisponível — lobby segue funcional">
        Cena 3D indisponível — o lobby segue funcional.
      </div>
      {[0, 1, 2].map((slot) => {
        const fig = party[slot];
        return (
          <button
            key={slot}
            type="button"
            className={`lob-fig-label${fig ? '' : ' empty'}`}
            ref={(el) => {
              labelRefs.current[slot] = el;
            }}
            hidden
            style={{ '--dm': fig ? (EL_COLOR[fig.element] ?? '#60a5fa') : '#60a5fa' } as React.CSSProperties}
            aria-label={fig ? `Abrir ${fig.nickname} (Lv ${fig.level}) — perfil` : `Slot ${slot + 1} vazio — convidar`}
            onClick={() => {
              if (fig && onOpenCreature) onOpenCreature(fig.id);
            }}
          >
            <span className="lob-fig-label-n">
              {fig ? `${fig.nickname} · Lv ${fig.level}` : 'Vazio — Convidar'}
            </span>
          </button>
        );
      })}
    </div>
  );
}