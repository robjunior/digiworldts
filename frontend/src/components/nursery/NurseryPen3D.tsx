import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { PenSpriteRig } from '../../scene3d/pen-sprite';
import { SceneManager } from '../../scene3d/scene';
import { ARENA_MODEL_BY_KEY, getArenaUrl } from '../../scene3d/arena-urls';
import type { NurseryPenMon, NurseryPenStage } from '../../lib/api-nursery';
import { PenMonMenu } from './PenMonMenu';

const PEN_BOUNDS = { minX: -4, maxX: 4, minZ: -3, maxZ: 3 };
const COLLISION_RADIUS = 0.4;
const COLLISION_SQ = (COLLISION_RADIUS * 2) * (COLLISION_RADIUS * 2);
const HOVER_RAYCAST_MIN_INTERVAL_MS = 60;

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

export type NurseryPen3DProps = {
  readonly penMons: readonly NurseryPenMon[];
  readonly stageDurations: { readonly babyMs: number; readonly inTrainingMs: number };
  readonly onPet: (mon: NurseryPenMon) => void;
  readonly onFeed: (mon: NurseryPenMon) => void;
  readonly onGraduate: (mon: NurseryPenMon) => void;
  readonly busyMonId: string | null;
  readonly canFeed: boolean;
  readonly feedCost: number;
};

export function NurseryPen3D({
  penMons,
  onPet,
  onFeed,
  onGraduate,
  busyMonId,
  canFeed,
  feedCost,
}: NurseryPen3DProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const rigsRef = useRef<Map<string, PenSpriteRig>>(new Map());
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

    const arenaUrl = getArenaUrl('forest_biome.glb')
      ?? ARENA_MODEL_BY_KEY['plant']
      ?? ARENA_MODEL_BY_KEY['field'];
    if (arenaUrl !== undefined) {
      sm.loadArenaModelWithAtmosphere(arenaUrl, 'field');
    }
    sm.startLoop();

    return () => {
      resizeObs.disconnect();
      sm.dispose();
      sceneManagerRef.current = null;
    };
  }, []);

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
      const url = `/assets/digimon/${mon.catalogId}/dot.gif`;
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