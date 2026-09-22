/**
 * LobbyScene3D — the lobby's live 3D backdrop.
 *
 * Renders the SceneEntity configured as `kind: 'lobby'` with real Three.js and
 * the SAME SpriteRig the combat screen uses: the party Digimon stand on
 * holographic pedestals in a fan formation, idle-animating from their real
 * sprite sheets (unitSpriteSheetUrl), updating in real time whenever the party
 * changes (diff by roster id, add/remove/reposition — no full remount).
 *
 * Scene knobs come from `settings.lobby` (admin scene editor): floor/grid/seam
 * colors, pedestal spacing/scale/tilt, ambient motes and camera drift. An
 * optional arena GLB (`modelFile`) is loaded as the backdrop environment when
 * the admin picks one, with a silent fallback to the procedural floor.
 *
 * UI (dock, panels, plaque) floats above in `.lobby-shell` — this layer is
 * pointer-transparent except the figure labels, which open the creature page.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SpriteRig } from '@digiworld/scene3d/sprite-rig';
import type { LobbySceneSettings } from '@digiworld/scene3d/scene';

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

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** Procedural floor texture: base + perspective grid + radial glow + gold seam. */
function makeFloorTexture(s: LobbySceneSettings): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = hex(s.floorColor);
  ctx.fillRect(0, 0, 1024, 1024);

  const glow = ctx.createRadialGradient(512, 512, 40, 512, 512, 700);
  glow.addColorStop(0, hex(s.glowColor));
  glow.addColorStop(1, hex(s.floorColor));
  ctx.globalAlpha = Math.min(1, s.glowOpacity * 2.2);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = hex(s.gridColor);
  ctx.globalAlpha = Math.min(1, s.gridOpacity * 6);
  ctx.lineWidth = 3;
  const step = 64;
  for (let i = 0; i <= 1024; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 1024);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(1024, i);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // gold seam down the middle
  ctx.strokeStyle = hex(s.seamColor);
  ctx.globalAlpha = Math.min(1, s.seamOpacity);
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(512, 0);
  ctx.lineTo(512, 1024);
  ctx.stroke();
  ctx.globalAlpha = 1;

  return new THREE.CanvasTexture(c);
}

export function LobbyScene3D({ settings, party, modelUrl, useGlbSettings, onOpenCreature }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const fallbackRef = useRef<HTMLDivElement | null>(null);
  const partySyncRef = useRef<() => void>(() => undefined);

  useEffect(() => {
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
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, host.clientWidth / Math.max(host.clientHeight, 1), 0.1, 400);
    const cameraBase = new THREE.Vector3(0, 6.0, 12.5);
    camera.position.copy(cameraBase);
    camera.lookAt(0, 2.4, 0);

    // ── lights (surrendered to the GLB when useGlbSettings ships its own) ─
    const ownLights: THREE.Light[] = [];
    const hemi = new THREE.HemisphereLight(0x88a8d0, 0x1b2130, 0.9);
    ownLights.push(hemi);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff2d0, 1.4);
    key.position.set(-6, 12, 8);
    ownLights.push(key);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x2c74ff, 0.5);
    rim.position.set(8, 6, -8);
    ownLights.push(rim);
    scene.add(rim);
    if (settings.spotlight) {
      const spot = new THREE.SpotLight(hex(settings.glowColor), 2.2, 60, 0.5, 0.45, 1.6);
      spot.position.set(0, 16, 6);
      spot.target.position.set(0, 0, 0);
      ownLights.push(spot);
      scene.add(spot, spot.target);
    }

    // ── floor ───────────────────────────────────────────────────────────
    const floorTex = makeFloorTexture(settings);
    const floorMat = new THREE.MeshBasicMaterial({ map: floorTex, transparent: true, opacity: 0.92 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = GROUND_Y - 0.02;
    scene.add(floor);

    // optional GLB environment
    let glbRoot: THREE.Group | null = null;
    let glbCamera: THREE.Camera | null = null;
    const glbDrives = useGlbSettings === true;
    if (modelUrl) {
      try {
        new GLTFLoader().load(
          modelUrl,
          (gltf) => {
            glbRoot = gltf.scene;
            const box = new THREE.Box3().setFromObject(glbRoot);
            const size = box.getSize(new THREE.Vector3());
            const span = Math.max(size.x, size.y, size.z);
            if (span > 0 && (span < 20 || span > 90)) {
              const k = 48 / span;
              glbRoot.scale.setScalar(k);
            }
            const center = box.getCenter(new THREE.Vector3());
            glbRoot.position.set(-center.x, -(box.min.y + 0.02), -center.z);
            scene.add(glbRoot);

            if (glbDrives) {
              // GLB drives the look: adopt its camera, hide our procedural
              // floor, and surrender our lights only when the GLB ships its own.
              if (gltf.cameras.length > 0) glbCamera = gltf.cameras[0] as unknown as THREE.Camera;
              floor.visible = false;
              let glbLightCount = 0;
              glbRoot.traverse((obj) => {
                if ((obj as THREE.Light).isLight) glbLightCount += 1;
              });
              if (glbLightCount > 0) {
                for (const l of ownLights) scene.remove(l);
              }
            }
          },
          undefined,
          () => {
            /* GLB indisponível — mantém piso e luzes próprias */
          },
        );
      } catch {
        /* loader sync failure — fall back to procedural */
      }
    }

    // ── pedestals + motes ───────────────────────────────────────────────
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
      ring.position.y = GROUND_Y + 0.01;
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(1.9, 48),
        new THREE.MeshBasicMaterial({ color: elementColor(key), transparent: true, opacity: 0.1, depthWrite: false }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = GROUND_Y + 0.005;
      pedestalGroup.add(ring, glow);
      pedestals.push({ ring, glow });
    };

    for (const fig of party) buildPedestal(fig?.element ?? 'water');

    // holo placeholder for empty slots
    const holos: THREE.Mesh[] = [];
    for (const fig of party) {
      if (fig !== null && fig !== undefined) continue;
      const mat = new THREE.MeshBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.28,
        wireframe: true,
        depthWrite: false,
      });
      const holo = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 3.6, 20, 1, true), mat);
      holo.position.y = GROUND_Y + 1.8;
      scene.add(holo);
      holos.push(holo);
    }

    // liquid crystal motes — deterministic, blue/gold
    const motesCount = settings.particleMode === 'off' ? 0 : settings.particleCount;
    const motePositions = new Float32Array(motesCount * 3);
    const moteSpeeds = new Float32Array(motesCount);
    const motePhases = new Float32Array(motesCount);
    for (let i = 0; i < motesCount; i++) {
      motePositions[i * 3] = ((i * 37) % 100) / 100 * 44 - 22;
      motePositions[i * 3 + 1] = 1 + ((i * 53) % 100) / 100 * 16;
      motePositions[i * 3 + 2] = ((i * 29) % 100) / 100 * 20 - 10;
      moteSpeeds[i] = 0.6 + ((i * 13) % 100) / 100 * 1.2;
      motePhases[i] = (i * 0.7) % (Math.PI * 2);
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
    const gold = new THREE.Color(0xf59e0b);
    const blue = new THREE.Color(0x60a5fa);
    const moteCols = new Float32Array(motesCount * 3);
    for (let i = 0; i < motesCount; i++) {
      const col = i % 7 === 0 ? gold : blue;
      moteCols[i * 3] = col.r;
      moteCols[i * 3 + 1] = col.g;
      moteCols[i * 3 + 2] = col.b;
    }
    moteGeo.setAttribute('color', new THREE.BufferAttribute(moteCols, 3));
    const moteMat = new THREE.PointsMaterial({
      size: settings.particleMode === 'pixels' ? 0.3 : 0.18,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const motes = new THREE.Points(moteGeo, moteMat);
    scene.add(motes);

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
        const fig = party[slot];
        const label = labelRefs.current[slot];
        if (!fig) {
          if (label !== null && label !== undefined) {
            label.hidden = false;
            label.textContent = "Vazio — Convidar";
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
            rig.setArenaBaselineY(0);
            rigs.set(fig.id, rig);
          } catch (err) {
            // one failing sprite must never blank the whole scene
            console.warn('[LobbyScene3D] sprite create failed', fig.id, err);
            continue;
          }
        }
        bySlot.set(slot, rig);
        rig.setTextureUrl(unitSpriteSheetUrl(fig.catalogId));
        if (label !== null && label !== undefined) {
          label.hidden = false;
          label.textContent = `${fig.nickname} · Lv ${fig.level}`;
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

      // GLB-driven scenes keep the author's camera (no drift/lookAt tampering)
      const useGlbCam = glbCamera !== null;
      const activeCam = useGlbCam ? glbCamera! : camera;

      if (!useGlbCam) {
        // camera drift: slow idle orbit + subtle pointer parallax
        const k = reduced ? 0 : settings.driftIntensity;
        const yaw = k * (Math.sin(elapsed * 0.14) * 0.06 + mouseX * 0.09);
        const pitch = k * (Math.cos(elapsed * 0.11) * 0.04 + mouseY * 0.06);
        camera.position.set(
          cameraBase.x * Math.cos(yaw) + cameraBase.z * Math.sin(yaw),
          cameraBase.y + pitch * 6,
          -cameraBase.x * Math.sin(yaw) + cameraBase.z * Math.cos(yaw),
        );
        // smooth camera look target
        camera.lookAt(yaw * 1.5, 2.6 + pitch * 2, 0);
      }

      for (const rig of rigs.values()) rig.update(dt, elapsed, activeCam.quaternion);

      // motes rise
      if (motesCount > 0) {
        const pos = moteGeo.getAttribute('position') as THREE.BufferAttribute;
        const arr = pos.array as Float32Array;
        for (let i = 0; i < motesCount; i++) {
          const speed = moteSpeeds[i] ?? 0.6;
          const phase = motePhases[i] ?? 0;
          const y = arr[i * 3 + 1] ?? 0;
          const x = arr[i * 3] ?? 0;
          const nextY = y + speed * dt;
          arr[i * 3 + 1] = nextY;
          if (nextY > 17) arr[i * 3 + 1] = 0.5;
          arr[i * 3] = x + Math.sin(elapsed * 0.5 + phase) * dt * 0.15;
        }
        pos.needsUpdate = true;
      }

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

      renderer.render(scene, activeCam);
      raf = requestAnimationFrame(loop);
    };
    // first paint immediately — never a black frame while the rAF warms up
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        renderer.setSize(width, height);
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
      scene.remove(floor, motes, pedestalGroup);
      floor.geometry.dispose();
      floorMat.map?.dispose();
      floorMat.dispose();
      moteGeo.dispose();
      moteMat.dispose();
      for (const mat of pedestalMatPool.values()) mat.dispose();
      for (const holo of holos) {
        scene.remove(holo);
        (holo.material as THREE.Material).dispose();
        holo.geometry.dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Party changes → live re-sync (the scene mounts once; this effect reuses it)
  useEffect(() => {
    partySyncRef.current();
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