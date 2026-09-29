import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { WorldRegion } from "@digiworld/shared/world";
import type { WorldObject } from "../../lib/api-world";
import type { WorldHoverTipData } from "./WorldHoverTip";
import { resolveSceneModelUrl, DEFAULT_ARENA_MODEL } from "@digiworld/scene3d/arena-urls";
import { clampLobbyExposure, lobbyHdrCompensation, resolveLobbyFog } from "@digiworld/scene3d/lobby-settings";
import { SpriteRig } from "@digiworld/scene3d/sprite-rig";
import type { WorldSceneSettings, SceneSettings } from "@digiworld/scene3d/scene";
import { GLOBE_CLEARANCE_R_MIN } from "@digiworld/scene3d/scene";
import { unitSpriteSheetUrl } from "../../lib/asset-preload";

// Altura (mundo) em que o globo flutua acima do piso da cena: o centro do globo
// fica bem no meio do ENVELOPE (camera olha pra ele), com os digimons girando
// em volta no chao (y=0) — "flutuando exatamente no centro da cena".
const GLOBE_Y = 1.35;
// Raio do anel onde os digimons de todos os times andam em volta do globo.
const RING_RADIUS = 3.0;

const ELHEX: Record<string, number> = {
  fire: 0xe6001f,
  water: 0x4aa3ff,
  plant: 0x3fbf6f,
  electricity: 0xe8c33a,
  ice: 0x7ad0e6,
  earth: 0xb98a4a,
  steel: 0x9fb0bd,
  wind: 0x63d6c0,
  light: 0xf2e39a,
  dark: 0xc03a4a,
  null: 0x8a877f,
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function latLonToVec3(lat: number, lon: number, r: number) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

function circlePts(r: number, seg: number, plane: "xy" | "xz") {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    if (plane === "xz")
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    else pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  return pts;
}

/** Positiona a camera orbitando o GLOBO (centro 0,globeY,0) a distancia camDist,
 *  com yaw (azimute) e elev (pitch) em graus configurados no admin de cena. */
function positionWorldCamera(
  camera: THREE.PerspectiveCamera,
  camDist: number,
  globeY: number,
  camYawDeg: number,
  camElevDeg: number,
): void {
  const deg = Math.PI / 180;
  const yaw = camYawDeg * deg;
  const elev = camElevDeg * deg;
  const cosE = Math.cos(elev);
  camera.position.set(
    camDist * cosE * Math.sin(yaw),
    globeY + camDist * Math.sin(elev),
    camDist * cosE * Math.cos(yaw),
  );
  camera.lookAt(0, globeY, 0);
}

/** Raio orbital minimo dos digimons: nunca dentro do globo (margem + sprite). */
function resolveRingRadius(r: number | undefined): number {
  return Math.max(r ?? RING_RADIUS, GLOBE_CLEARANCE_R_MIN);
}

type WorldGlobeProps = {
  readonly regions: readonly WorldRegion[];
  readonly worldObjects?: readonly WorldObject[];
  readonly focusLatLon?: { readonly lat: number; readonly lon: number } | null;
  readonly autoSpin: boolean;
  readonly selectedIdx: number | null;
  readonly hoveredIdx: number;
  readonly onHoverChange: (idx: number) => void;
  readonly onSelect: (idx: number) => void;
  readonly onHoverTip: (tip: WorldHoverTipData | null) => void;
  readonly onFailWebGL: () => void;
  /** Admin scene of kind 'world': globe knobs (settings.world). */
  readonly world?: WorldSceneSettings | null;
  /** Admin scene common settings (modelFile, lighting, fog, exposure). */
  readonly lighting?: Partial<SceneSettings> | null;
  /** Resolved environment GLB URL (the world scene's modelFile). */
  readonly envModelUrl?: string | null;
  readonly useGlbSettings?: boolean;
  /** Digimons (de todos os times) que andam em volta do globo na cena. */
  readonly wanderers?: readonly Wanderer[];
};

type Wanderer = {
  readonly id: string;
  readonly catalogId: string;
  readonly element?: string;
};

export function WorldGlobe({
  regions,
  worldObjects,
  focusLatLon,
  autoSpin,
  selectedIdx,
  hoveredIdx,
  onHoverChange,
  onSelect,
  onHoverTip,
  onFailWebGL,
  world = null,
  lighting = null,
  envModelUrl = null,
  useGlbSettings = false,
  wanderers = [],
}: WorldGlobeProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const stateRef = useRef({
    autoSpin,
    selectedIdx,
    hoveredIdx,
    dragging: false,
    lastX: 0,
    lastY: 0,
    rotX: 0.3,
    rotY: 0,
    camDist: 4.6,
    world: world ?? null,
    lighting: lighting ?? null,
    useGlbSettings,
    wanderers,
  });

  useEffect(() => {
    stateRef.current.autoSpin = autoSpin;
    stateRef.current.selectedIdx = selectedIdx;
    stateRef.current.hoveredIdx = hoveredIdx;
    stateRef.current.world = world ?? null;
    stateRef.current.lighting = lighting ?? null;
    stateRef.current.useGlbSettings = useGlbSettings;
    stateRef.current.wanderers = wanderers;
  }, [autoSpin, selectedIdx, hoveredIdx, world, lighting, useGlbSettings, wanderers]);

  useEffect(() => {
    if (!focusLatLon) return;
    const pos = latLonToVec3(focusLatLon.lat, focusLatLon.lon, 1);
    stateRef.current.rotY = -Math.atan2(pos.x, pos.z);
    stateRef.current.rotX = Math.atan2(
      pos.y,
      Math.sqrt(pos.x * pos.x + pos.z * pos.z),
    );
  }, [focusLatLon]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (typeof THREE === "undefined") {
      onFailWebGL();
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      });
      if (!renderer.getContext()) throw new Error("No WebGL");
    } catch (e) {
      onFailWebGL();
      return;
    }

    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);

    const scene = new THREE.Scene();
    // Ajusta a distancia inicial da camera aos clamps da cena (admin world).
    const initWorld = stateRef.current.world;
    stateRef.current.camDist = Math.max(
      initWorld?.camDistMin ?? 2.5,
      Math.min(initWorld?.camDistMax ?? 7, stateRef.current.camDist),
    );
    const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 400);
    const initW = initWorld ?? null;
    const initGlobeY = initW?.globeY ?? GLOBE_Y;
    const initRing = resolveRingRadius(initW?.ringRadius);
    positionWorldCamera(camera, stateRef.current.camDist, initGlobeY, initW?.camYawDeg ?? 0, initW?.camElevDeg ?? 0);
    const clock = new THREE.Timer();
    const raycaster = new THREE.Raycaster();

    // ── cena 3d do admin de cena (kind 'world') — environment backdrop─────
    // Aplica lighting/fog/exposure do SceneEntity 'world' + o GLB do modelFile
    // como ambiente, deixando o GLOBO flutuando exatamente no centro (GLOBE_Y).
    const s = stateRef.current.world;
    const light = stateRef.current.lighting;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const exposure = clampLobbyExposure(light?.exposure);
    renderer.toneMappingExposure = exposure;
    const hdrComp = lobbyHdrCompensation(exposure);
    scene.background = new THREE.Color(0x0a0e1a);
    const envLights: THREE.Light[] = [];
    const hemi = new THREE.HemisphereLight(
      light?.hemiSkyColor ?? 0x88a8d0,
      light?.hemiGroundColor ?? 0x0e1220,
      light?.hemiIntensity ?? 0.55,
    );
    scene.add(hemi);
    envLights.push(hemi);
    const key = new THREE.DirectionalLight(
      light?.sunColor ?? 0xfff2d0,
      light?.sunIntensity ?? 1.1,
    );
    key.position.set(light?.sunPosX ?? -6, light?.sunPosY ?? 12, light?.sunPosZ ?? 6);
    scene.add(key);
    envLights.push(key);
    const rim = new THREE.DirectionalLight(light?.rimColor ?? 0x2c74ff, light?.rimIntensity ?? 0.5);
    rim.position.set(8, 6, -8);
    scene.add(rim);
    envLights.push(rim);
    scene.fog = resolveLobbyFog(light ?? {});
    // Bloom é configuração COMUM (settings.bloom*) — vale pro mundo também.
    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    if ((light?.bloomEnabled ?? true) !== false) {
      composer = new EffectComposer(renderer);
      composer.setSize(w, h); // sem isto o composer fica 1x1 e a cena sai preta
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(w, h),
        light?.bloomStrength ?? 0.3,
        light?.bloomRadius ?? 0.45,
        light?.bloomThreshold ?? 0.9,
      );
      bloomPass.setSize(w, h);
      composer.addPass(bloomPass);
    }
    let envRoot: THREE.Group | null = null;
    if (envModelUrl) {
      new GLTFLoader()
        .loadAsync(envModelUrl)
        .then((gltf) => {
          if (!renderer.getContext()) return; // scene disposed
          const root = gltf.scene;
          root.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(root);
          const span = Math.max(box.getSize(new THREE.Vector3()).x, box.getSize(new THREE.Vector3()).z, 0.001);
          const targetSpan = light?.arenaSpan ?? 34;
          const k = targetSpan / span;
          root.scale.setScalar(k);
          root.position.set(
            -(box.getCenter(new THREE.Vector3()).x * k),
            -box.min.y * k,
            -(box.getCenter(new THREE.Vector3()).z * k),
          );
          scene.add(root);
          envRoot = root;
          if (renderer.shadowMap) {
            root.traverse((o) => {
              const m = o as THREE.Mesh;
              if ((m as unknown as { isMesh?: boolean }).isMesh) { m.castShadow = true; m.receiveShadow = true; }
            });
          }
        })
        .catch(() => { /* GLB fail: globe ainda aparece sobre o fundo */ });
    }

    const globe = new THREE.Group();
    scene.add(globe);
    // Flutua o globo acima do piso (y=0 dos digimons) — centro da cena.
    globe.position.y = initGlobeY;

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.985, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x0a0a0c }),
    );
    globe.add(core);

    const grid = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 36, 24)),
      new THREE.LineBasicMaterial({
        color: 0xe6001f,
        transparent: true,
        opacity: s?.graticuleOpacity ?? 0.34,
      }),
    );
    globe.add(grid);

    const ringMat = new THREE.LineBasicMaterial({
      color: 0xe6001f,
      transparent: true,
      opacity: 0.7,
    });
    const eq = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(circlePts(1.001, 64, "xz")),
      ringMat,
    );
    globe.add(eq);
    const mer = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(circlePts(1.001, 64, "xy")),
      ringMat,
    );
    globe.add(mer);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1.08, 32, 24),
      new THREE.MeshBasicMaterial({
        color: 0xe6001f,
        transparent: true,
        opacity: s?.glowOpacity ?? 0.05,
        side: THREE.BackSide,
      }),
    );
    globe.add(glow);

    const nodeGroup = new THREE.Group();
    globe.add(nodeGroup);

    type NodeMesh = {
      mesh: THREE.Mesh;
      ring: THREE.Mesh;
      data: WorldRegion;
      idx: number;
    };
    const nodeMeshes: NodeMesh[] = [];

    regions.forEach((b, i) => {
      const pos = latLonToVec3(b.lat, b.lon, 1.0);
      const col = ELHEX[b.element] || 0xe6001f;
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(s?.nodeScale ?? 0.032, 12, 12),
        new THREE.MeshBasicMaterial({ color: col }),
      );
      m.position.copy(pos);
      const rs = s?.ringScale ?? 0.058;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(rs, rs * 1.32, 20),
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        }),
      );
      ring.position.copy(pos);
      ring.lookAt(pos.clone().multiplyScalar(2));
      const stem = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          pos.clone(),
          pos.clone().multiplyScalar(1.12),
        ]),
        new THREE.LineBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.6,
        }),
      );
      nodeGroup.add(m);
      nodeGroup.add(ring);
      nodeGroup.add(stem);
      nodeMeshes.push({ mesh: m, ring, data: b, idx: i });
    });

    (worldObjects ?? []).forEach((obj) => {
      const pos = latLonToVec3(obj.lat, obj.lon, 1.0);
      const colorHex = obj.tint ?? "#c8b48a";
      const col = parseInt(colorHex.replace("#", ""), 16);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.024, 10, 10),
        new THREE.MeshBasicMaterial({ color: col }),
      );
      marker.position.copy(pos);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.038, 0.05, 16),
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
        }),
      );
      ring.position.copy(pos);
      ring.lookAt(pos.clone().multiplyScalar(2));
      nodeGroup.add(marker);
      nodeGroup.add(ring);
    });

    // ── digimons de TODOS os times andando em volta do globo ────────────
    // SpriteRig (mesmo rig de combate/lobby) por membro, orbitando o centro
    // num anel no piso; o idleAnimated boba o ciclo de caminhada e a posicao
    // avanca em circulo a cada frame = "andando em volta da cena".
    type Walker = { angle: number; speed: number; radius: number; rig: SpriteRig };
    const walkers: Walker[] = [];
    const wanderList = stateRef.current.wanderers;
    wanderList.forEach((w, i) => {
      try {
        const rig = new SpriteRig(scene, {
          unitId: w.id,
          side: 'you',
          slotIndex: 0,
          textureUrl: unitSpriteSheetUrl(w.catalogId),
          isSpritesheet: true,
          idleAnimated: true,
          initiallyDowned: false,
          onClick: undefined,
        });
        rig.setArenaBaselineY(0.02);
        // Legiveis sob o tonemapping ACES (como os Digimon do lobby).
        (rig.mesh.material as THREE.MeshBasicMaterial).color.setScalar(
          Math.max(1.5 * hdrComp, 0.4),
        );
        const stagger = i % 4;
        const radius = initRing + stagger * 0.34;
        const speed = 0.5 + (i % 5) * 0.1;
        const angle = (i / Math.max(1, wanderList.length)) * Math.PI * 2 + stagger * 0.5;
        walkers.push({ angle, speed, radius, rig });
      } catch (err) {
        console.warn('[WorldGlobe] wanderer sprite create failed', w.id, err);
      }
    });

    const resizeGlobe = () => {
      if (!canvas) return;
      const rw = canvas.clientWidth || 800,
        rh = canvas.clientHeight || 600;
      renderer.setSize(rw, rh, false);
      composer?.setSize(rw, rh);
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", resizeGlobe);

    const ndc = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
    };

    const pickHover = (e: PointerEvent) => {
      raycaster.setFromCamera(ndc(e), camera);
      const hits = raycaster.intersectObjects(
        nodeMeshes.map((n) => n.mesh),
        false,
      );
      const firstHit = hits[0];
      const newHovered = firstHit
        ? nodeMeshes.findIndex((n) => n.mesh === firstHit.object)
        : -1;

      if (newHovered !== stateRef.current.hoveredIdx) {
        onHoverChange(newHovered);
      }

      canvas.style.cursor =
        newHovered >= 0
          ? "pointer"
          : stateRef.current.dragging
            ? "grabbing"
            : "grab";

      if (newHovered >= 0) {
        const n = nodeMeshes[newHovered];
        if (!n) return;
        const v = n.mesh.getWorldPosition(new THREE.Vector3()).project(camera);
        if (v.z <= 1) {
          const r = canvas.getBoundingClientRect();
          onHoverTip({
            x: r.left + (v.x * 0.5 + 0.5) * r.width,
            y: r.top + (-v.y * 0.5 + 0.5) * r.height,
            name: n.data.label,
            el: cap(n.data.element) + " · Danger " + n.data.danger,
            rawEl: n.data.element,
          });
          return;
        }
      }
      onHoverTip(null);
    };

    const onPointerDown = (e: PointerEvent) => {
      stateRef.current.dragging = true;
      stateRef.current.lastX = e.clientX;
      stateRef.current.lastY = e.clientY;
      canvas.classList.add("drag");
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (stateRef.current.dragging) {
        const dx = e.clientX - stateRef.current.lastX;
        const dy = e.clientY - stateRef.current.lastY;
        stateRef.current.lastX = e.clientX;
        stateRef.current.lastY = e.clientY;
        stateRef.current.rotY += dx * 0.006;
        stateRef.current.rotX = Math.max(
          -1.2,
          Math.min(1.2, stateRef.current.rotX + dy * 0.006),
        );
      } else {
        pickHover(e);
      }
    };
    const onPointerUp = () => {
      stateRef.current.dragging = false;
      canvas.classList.remove("drag");
    };
    const onPointerLeave = () => {
      stateRef.current.dragging = false;
      onHoverChange(-1);
      onHoverTip(null);
      canvas.classList.remove("drag");
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s2 = stateRef.current.world;
      const min = s2?.camDistMin ?? 2.5;
      const max = s2?.camDistMax ?? 7;
      stateRef.current.camDist = Math.max(min, Math.min(max, stateRef.current.camDist + e.deltaY * 0.0016));
    };
    const onClick = () => {
      if (stateRef.current.hoveredIdx >= 0) {
        onSelect(stateRef.current.hoveredIdx);
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("click", onClick);

    let rafId: number;
    const animate = (rafTimestamp: number) => {
      rafId = requestAnimationFrame(animate);
      // `THREE.Timer` needs `update()` each frame; otherwise `getElapsed()`
      // stays 0 and the selection-ring pulse below is frozen.
      clock.update(rafTimestamp);
      if (stateRef.current.autoSpin && !stateRef.current.dragging) {
        stateRef.current.rotY += 0.0016;
      }
      globe.rotation.y = stateRef.current.rotY;
      globe.rotation.x = stateRef.current.rotX;
      positionWorldCamera(
        camera,
        stateRef.current.camDist,
        stateRef.current.world?.globeY ?? GLOBE_Y,
        stateRef.current.world?.camYawDeg ?? 0,
        stateRef.current.world?.camElevDeg ?? 0,
      );

      const t = clock.getElapsed();
      nodeMeshes.forEach((n, i) => {
        const isSel =
          i === stateRef.current.hoveredIdx ||
          n.idx === stateRef.current.selectedIdx;
        const s = isSel ? 1.35 + Math.sin(t * 4) * 0.12 : 1;
        n.ring.scale.setScalar(s);
        (n.ring.material as THREE.MeshBasicMaterial).opacity = isSel ? 1 : 0.7;
      });

      const delta = Math.min(clock.getDelta(), 0.05);
      for (const wk of walkers) {
        wk.angle += wk.speed * delta;
        const x = Math.cos(wk.angle) * wk.radius;
        const z = Math.sin(wk.angle) * wk.radius;
        wk.rig.setBasePosition(x, z);
        wk.rig.update(delta, t, camera.quaternion);
      }

      if (composer !== null) composer.render();
      else renderer.render(scene, camera);
    };
    animate(performance.now());

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resizeGlobe);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("click", onClick);

      if (envRoot !== null) {
        scene.remove(envRoot);
        envRoot.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          o.geometry.dispose();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m?.dispose();
        });
      }
      for (const l of envLights) scene.remove(l);
      for (const wk of walkers) wk.rig.dispose();
      composer?.dispose();

      renderer.dispose();
      globe.traverse((obj) => {
        if (
          obj instanceof THREE.Mesh ||
          obj instanceof THREE.Line ||
          obj instanceof THREE.LineLoop ||
          obj instanceof THREE.LineSegments
        ) {
          if (obj.geometry) obj.geometry.dispose();
          if (Array.isArray(obj.material))
            obj.material.forEach((m) => m.dispose());
          else if (obj.material) obj.material.dispose();
        }
      });
    };
  }, [regions, worldObjects, onFailWebGL, onHoverChange, onHoverTip, onSelect, envModelUrl, world, lighting, wanderers]);

  return (
    <canvas
      ref={canvasRef}
      className="world-canvas"
      id="globe"
      aria-label="3D world globe"
    ></canvas>
  );
}
