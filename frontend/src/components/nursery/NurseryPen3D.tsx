import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { PenSpriteRig } from '@digiworld/scene3d/pen-sprite';
import { unitSpriteSheetUrl } from '@digiworld/scene3d';
import { SceneManager, type SceneSettings } from '@digiworld/scene3d/scene';
import { ARENA_MODEL_BY_KEY, resolveSceneModelUrl } from '@digiworld/scene3d/arena-urls';
import type { NurseryPenMon, NurseryPenStage, PendingHatchEntry } from '../../lib/api-nursery';
import { PenMonMenu } from './PenMonMenu';

const PEN_BOUNDS = { minX: -4, maxX: 4, minZ: -3, maxZ: 3 };
const COLLISION_RADIUS = 0.4;
const COLLISION_SQ = (COLLISION_RADIUS * 2) * (COLLISION_RADIUS * 2);
const HOVER_RAYCAST_MIN_INTERVAL_MS = 60;

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

/** A hatching egg visible in the 3D pen. Procedural mesh (no asset needed):
 *  a squashed, slightly elongated sphere that gently bobs; when the egg is
 *  ready to hatch it pulses with a glowing highlight. */
class EggRig {
  private readonly group: THREE.Group;
  private readonly shell: THREE.Mesh;
  private readonly glow: THREE.Mesh;
  private ready = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly entry: PendingHatchEntry,
    x: number,
    z: number,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  ) {
    this.group = new THREE.Group();

    const shellGeo = new THREE.SphereGeometry(0.55, 24, 18);
    shellGeo.scale(1, 1.18, 1);
    const shellMat = new THREE.MeshStandardMaterial({
      color: entry.mystery ? 0xcfc6ff : 0xf7f0e0,
      roughness: 0.55,
      metalness: 0.05,
    });
    this.shell = new THREE.Mesh(shellGeo, shellMat);

    const glowGeo = new THREE.SphereGeometry(0.68, 20, 16);
    glowGeo.scale(1, 1.18, 1);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffe9a8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Mesh(glowGeo, glowMat);

    this.group.add(this.shell, this.glow);
    this.group.position.set(x, 0.4, z);
    this.group.rotation.y = Math.random() * Math.PI * 2;
    const cx = THREE.MathUtils.clamp(x, bounds.minX, bounds.maxX);
    const cz = THREE.MathUtils.clamp(z, bounds.minZ, bounds.maxZ);
    this.group.position.set(cx, 0.4, cz);
    scene.add(this.group);
  }

  setReady(ready: boolean): void {
    this.ready = ready;
  }

  update(elapsedS: number): void {
    this.group.position.y = 0.34 + Math.sin(elapsedS * 1.4 + this.group.position.x) * 0.06;
    this.group.rotation.y += 0.004;
    // Ready eggs pulse with a soft glow.
    const targetOpacity = this.ready ? 0.5 + Math.sin(elapsedS * 3) * 0.2 : 0;
    const glowMat = this.glow.material as THREE.MeshBasicMaterial;
    glowMat.opacity = THREE.MathUtils.lerp(glowMat.opacity, targetOpacity, 0.08);
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.shell.geometry.dispose();
    (this.shell.material as THREE.Material).dispose();
    this.glow.geometry.dispose();
    (this.glow.material as THREE.Material).dispose();
  }
}

export type NurseryPen3DProps = {
  readonly penMons: readonly NurseryPenMon[];
  readonly pending: readonly PendingHatchEntry[];
  readonly stageDurations: { readonly babyMs: number; readonly inTrainingMs: number };
  readonly onPet: (mon: NurseryPenMon) => void;
  readonly onFeed: (mon: NurseryPenMon) => void;
  readonly onGraduate: (mon: NurseryPenMon) => void;
  readonly busyMonId: string | null;
  readonly canFeed: boolean;
  readonly feedCost: number;
  /** Resolved backdrop GLB URL (undefined → default arena). */
  readonly envModelUrl?: string | undefined;
  /** Top-level scene settings (lighting/arena/fog) — applied unless useGlbSettings. */
  readonly settings?: Partial<SceneSettings> | undefined;
  /** When true, the GLB defines the look (settings ignored). */
  readonly useGlbSettings?: boolean;
};

export function NurseryPen3D({
  penMons,
  pending,
  onPet,
  onFeed,
  onGraduate,
  busyMonId,
  canFeed,
  feedCost,
  envModelUrl,
  settings,
  useGlbSettings,
}: NurseryPen3DProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const rigsRef = useRef<Map<string, PenSpriteRig>>(new Map());
  const eggRigsRef = useRef<Map<string, EggRig>>(new Map());
  const prevStageByMonIdRef = useRef<Map<string, NurseryPenStage>>(new Map());
  const exitedRef = useRef<Set<string>>(new Set());
  const penMonsRef = useRef<readonly NurseryPenMon[]>(penMons);
  const onGraduateRef = useRef(onGraduate);

  penMonsRef.current = penMons;
  onGraduateRef.current = onGraduate;

  const [selectedMonId, setSelectedMonId] = useState<string | null>(null);
  const [hoveredMonId, setHoveredMonId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const lastMenuUpdateRef = useRef(0);
  const lastHoverRaycastRef = useRef(0);
  const collisionCacheRef = useRef<Map<string, number>>(new Map());
  const cameraAnimRef = useRef<{ startT: number; targetX: number; targetZ: number } | null>(null);
  const animationFrameIdRef = useRef(0);

  const activeMonId = selectedMonId ?? hoveredMonId;

  // Content fingerprint for the backdrop: rebuild the WebGL scene only when the
  // env actually changed (never on object identity / every refetch).
  const envContentKey = JSON.stringify({
    envModelUrl: envModelUrl ?? null,
    settings: settings ?? null,
    useGlbSettings: useGlbSettings ?? false,
  });

  // Init Scene
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const sm = new SceneManager(canvasRef.current);
    sceneManagerRef.current = sm;

    const resizeObs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        sm.resize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    resizeObs.observe(containerRef.current);

    if (settings !== undefined && useGlbSettings !== true) {
      const patch: Record<string, unknown> = { ...settings };
      delete patch['modelFile'];
      sm.applySettings(patch as Partial<SceneSettings>);
    }

    const modelUrl = envModelUrl
      ?? resolveSceneModelUrl(settings?.modelFile)
      ?? ARENA_MODEL_BY_KEY['field']
      ?? ARENA_MODEL_BY_KEY['plant'];
    if (modelUrl !== undefined) {
      void (useGlbSettings === true
        ? sm.loadArenaModelBare(modelUrl, 'field')
        : sm.loadArenaModelWithAtmosphere(modelUrl, 'field'));
    }
    sm.startLoop();

    return () => {
      resizeObs.disconnect();
      for (const eggRig of eggRigsRef.current.values()) {
        eggRig.dispose();
      }
      eggRigsRef.current.clear();
      sm.dispose();
      sceneManagerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envContentKey]);

  // Sync Mons -> Rigs
  useEffect(() => {
    const sm = sceneManagerRef.current;
    if (!sm) return;

    const currentRigs = rigsRef.current;
    const prevStages = prevStageByMonIdRef.current;
    const incomingIds = new Set(penMons.map((m) => m.id));

    // Remove old
    for (const [id, rig] of currentRigs.entries()) {
      if (!incomingIds.has(id)) {
        rig.dispose();
        currentRigs.delete(id);
        prevStages.delete(id);
        exitedRef.current.delete(id);
      }
    }

    // Add or update
    for (const mon of penMons) {
      let rig = currentRigs.get(mon.id);
      const url = unitSpriteSheetUrl(mon.catalogId);
      if (!rig) {
        const initialX = PEN_BOUNDS.minX + Math.random() * (PEN_BOUNDS.maxX - PEN_BOUNDS.minX);
        const initialZ = PEN_BOUNDS.minZ + Math.random() * (PEN_BOUNDS.maxZ - PEN_BOUNDS.minZ);
        rig = new PenSpriteRig(sm.scene, mon.id, url, initialX, initialZ, PEN_BOUNDS);
        currentRigs.set(mon.id, rig);
      } else {
        rig.setTextureUrl(url);
      }

      const prevStage = prevStages.get(mon.id);
      if (prevStage !== undefined && prevStage !== mon.stage) {
        rig.playEvolvePuff();
      }
      prevStages.set(mon.id, mon.stage);

      if (mon.stage === 'Rookie') {
        rig.startExit();
      }
    }
  }, [penMons]);

  // Sync Eggs -> meshes (hatching eggs shown in the 3D pen)
  useEffect(() => {
    const sm = sceneManagerRef.current;
    if (!sm) return;

    const currentEggRigs = eggRigsRef.current;
    const incomingIds = new Set(pending.map((p) => p.id));

    for (const [id, eggRig] of currentEggRigs.entries()) {
      if (!incomingIds.has(id)) {
        eggRig.dispose();
        currentEggRigs.delete(id);
      }
    }

    for (const entry of pending) {
      let eggRig = currentEggRigs.get(entry.id);
      if (!eggRig) {
        const x = PEN_BOUNDS.minX + Math.random() * (PEN_BOUNDS.maxX - PEN_BOUNDS.minX);
        const z = PEN_BOUNDS.minZ + Math.random() * (PEN_BOUNDS.maxZ - PEN_BOUNDS.minZ);
        eggRig = new EggRig(sm.scene, entry, x, z, PEN_BOUNDS);
        currentEggRigs.set(entry.id, eggRig);
      } else {
        eggRig.setReady(entry.ready);
      }
    }
  }, [pending]);

  // Main Loop (custom physics + camera tracking)
  useEffect(() => {
    const loop = (time: number) => {
      animationFrameIdRef.current = requestAnimationFrame(loop);
      const sm = sceneManagerRef.current;
      if (!sm) return;
      
      const dt = 1 / 60; // Approximate, could use actual dt
      const now = performance.now();
      const elapsedS = now / 1000;
      const rigs = Array.from(rigsRef.current.values());

      // Update Rigs
      for (const rig of rigs) {
        rig.update(dt, elapsedS, sm.camera.quaternion);
      }

      // Update hatching eggs
      for (const eggRig of eggRigsRef.current.values()) {
        eggRig.update(elapsedS);
      }

      // Auto-graduate Rookies that walked off-screen
      for (const [id, rig] of rigsRef.current.entries()) {
        if (rig.hasExited() && !exitedRef.current.has(id)) {
          exitedRef.current.add(id);
          const mon = penMonsRef.current.find((m) => m.id === id);
          if (mon !== undefined) onGraduateRef.current(mon);
        }
      }

      // Collisions
      const cache = collisionCacheRef.current;
      // expire old cache
      for (const [k, t] of cache.entries()) {
        if (now - t > 800) cache.delete(k);
      }

      for (let i = 0; i < rigs.length; i++) {
        for (let j = i + 1; j < rigs.length; j++) {
          const a = rigs[i]!;
          const b = rigs[j]!;
          if (a.isExiting() || b.isExiting()) continue;
          const pa = a.getWorldPosition();
          const pb = b.getWorldPosition();
          const dx = pb.x - pa.x;
          const dz = pb.z - pa.z;
          const distSq = dx * dx + dz * dz;

          if (distSq < COLLISION_SQ) {
            const key = a.monId < b.monId ? `${a.monId}<${b.monId}` : `${b.monId}<${a.monId}`;
            if (!cache.has(key)) {
              cache.set(key, now);
              
              const dist = Math.sqrt(distSq) || 0.001;
              const overlap = (COLLISION_RADIUS * 2) - dist;
              const nx = dx / dist;
              const nz = dz / dist;

              a.setWorldXZ(pa.x - nx * (overlap / 2), pa.z - nz * (overlap / 2));
              b.setWorldXZ(pb.x + nx * (overlap / 2), pb.z + nz * (overlap / 2));

              a.playSquish();
              a.playSpin();
              b.playSquish();
              b.playSpin();
            }
          }
        }
      }

      // Camera slight-follow
      if (cameraAnimRef.current) {
        const { startT, targetX, targetZ } = cameraAnimRef.current;
        const t = now - startT;
        const PAN_MS = 1000, HOLD_MS = 3000, RELEASE_MS = 1000;
        
        let ox = 0, oz = 0;
        if (t < PAN_MS) {
          const p = easeOutCubic(t / PAN_MS);
          ox = targetX * p;
          oz = targetZ * p;
        } else if (t < PAN_MS + HOLD_MS) {
          ox = targetX;
          oz = targetZ;
        } else if (t < PAN_MS + HOLD_MS + RELEASE_MS) {
          const p = easeOutCubic((t - PAN_MS - HOLD_MS) / RELEASE_MS);
          ox = targetX * (1 - p);
          oz = targetZ * (1 - p);
        } else {
          cameraAnimRef.current = null;
        }
        sm.setCameraLookOffset(ox, 0, oz);
      }

      // Project active mon (selected OR hovered) to screen
      if (activeMonId) {
        const rig = rigsRef.current.get(activeMonId);
        if (rig && now - lastMenuUpdateRef.current > 50) {
          lastMenuUpdateRef.current = now;
          const pos = rig.getWorldPosition().clone();
          pos.y += 0.5;
          pos.project(sm.camera);
          if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const sx = (pos.x * 0.5 + 0.5) * rect.width;
            const sy = (1 - (pos.y * 0.5 + 0.5)) * rect.height;
            setMenuPos({ x: sx, y: sy });
          }
        }
      }
    };
    animationFrameIdRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameIdRef.current);
  }, [activeMonId]);

  const raycastMonAt = (clientX: number, clientY: number): string | null => {
    const sm = sceneManagerRef.current;
    const canvas = canvasRef.current;
    if (!sm || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), sm.camera);
    const meshes = Array.from(rigsRef.current.values()).map((r) => r.mesh);
    const intersects = raycaster.intersectObjects(meshes, false);
    if (intersects.length === 0) return null;
    const hitMesh = intersects[0]!.object;
    for (const [id, r] of rigsRef.current.entries()) {
      if (r.mesh === hitMesh) return id;
    }
    return null;
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const monId = raycastMonAt(e.clientX, e.clientY);
    if (monId === null) {
      setSelectedMonId(null);
      return;
    }
    const rig = rigsRef.current.get(monId);
    if (rig === undefined) return;
    setSelectedMonId(monId);
    const pos = rig.getWorldPosition();
    cameraAnimRef.current = { startT: performance.now(), targetX: pos.x * 0.4, targetZ: pos.z * 0.4 };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const now = performance.now();
    if (now - lastHoverRaycastRef.current < HOVER_RAYCAST_MIN_INTERVAL_MS) return;
    lastHoverRaycastRef.current = now;
    const monId = raycastMonAt(e.clientX, e.clientY);
    setHoveredMonId((prev) => (prev === monId ? prev : monId));
  };

  const handleCanvasMouseLeave = () => {
    setHoveredMonId(null);
  };

  const closeMenu = () => {
    setSelectedMonId(null);
    setHoveredMonId(null);
  };

  const activeMon = penMons.find((m) => m.id === activeMonId);

  return (
    <div ref={containerRef} className="pen3d">
      <canvas
        ref={canvasRef}
        className="pen3d__canvas"
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
      />
      {activeMon && (
        <PenMonMenu
          mon={activeMon}
          screenX={menuPos.x}
          screenY={menuPos.y}
          busy={busyMonId === activeMon.id}
          canFeed={canFeed}
          feedCost={feedCost}
          onPet={onPet}
          onFeed={onFeed}
          onGraduate={onGraduate}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}