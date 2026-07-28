import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { WorldObject, WorldRegion } from '@digiworld/shared';

type Tool = 'SELECT' | 'PLACE';
type GlobePoint = { readonly lat: number; readonly lon: number };
type HoverInfo = { readonly x: number; readonly y: number; readonly kind: string; readonly label: string; readonly lat: number; readonly lon: number; readonly variant: 'object' | 'region' };
type CursorInfo = { readonly x: number; readonly y: number; readonly lat: number; readonly lon: number };

type Props = {
  readonly objects: readonly WorldObject[];
  readonly regions: readonly WorldRegion[];
  readonly selectedId: string | null;
  readonly tool: Tool;
  readonly duplicateIds: ReadonlySet<string>;
  readonly onSelect: (id: string | null) => void;
  readonly onPlace: (point: GlobePoint) => void;
};

const ELHEX: Readonly<Record<string, number>> = {
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

const KIND_TINT: Readonly<Record<string, number>> = {
  mountain: 0x9aa0a6,
  tower: 0x5d95ff,
  city: 0xa770ff,
  ruin: 0xb8834c,
  shrine: 0xf2d35d,
  obelisk: 0x63d6ff,
  archway: 0xd8b070,
  crystal: 0xff6ee2,
  grove: 0x3fbf6f,
  spring: 0x63d6ff,
};

const KIND_GEOM: Readonly<Record<string, () => THREE.BufferGeometry>> = {
  mountain: () => new THREE.ConeGeometry(0.03, 0.055, 4),
  tower: () => new THREE.CylinderGeometry(0.013, 0.015, 0.062, 8),
  city: () => new THREE.BoxGeometry(0.05, 0.032, 0.05),
  ruin: () => new THREE.BoxGeometry(0.046, 0.022, 0.046),
  shrine: () => new THREE.OctahedronGeometry(0.032, 0),
  obelisk: () => new THREE.BoxGeometry(0.013, 0.06, 0.013),
  archway: () => new THREE.TorusGeometry(0.028, 0.006, 6, 14, Math.PI),
  crystal: () => new THREE.OctahedronGeometry(0.038, 0),
  grove: () => new THREE.SphereGeometry(0.03, 12, 8),
  spring: () => new THREE.TorusGeometry(0.032, 0.006, 6, 18),
};

const DEFAULT_ROT_X = 0.28;
const DEFAULT_ROT_Y = -0.35;
const DEFAULT_CAM_DIST = 3.15;
const REGION_MARKER_RADIUS = 0.021;
const FALLBACK_SPHERE_RADIUS = 0.034;

function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta));
}

function vec3ToLatLon(point: THREE.Vector3): GlobePoint {
  const normalized = point.clone().normalize();
  const lat = 90 - (Math.acos(normalized.y) * 180) / Math.PI;
  const theta = Math.atan2(normalized.z, -normalized.x);
  const lon = clamp((theta * 180) / Math.PI - 180, -180, 180);
  return { lat: roundCoord(lat), lon: roundCoord(lon) };
}

function circlePts(radius: number, segments: number, plane: 'xy' | 'xz'): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    points.push(plane === 'xz'
      ? new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
      : new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
  }
  return points;
}

function hexToNumber(value: string | undefined, fallback: number): number {
  if (!value?.startsWith('#')) return fallback;
  const parsed = Number.parseInt(value.slice(1), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundCoord(value: number): number {
  return Math.round(value * 10) / 10;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((entry) => {
    if (!(entry instanceof THREE.Mesh || entry instanceof THREE.Line || entry instanceof THREE.LineLoop || entry instanceof THREE.LineSegments)) return;
    entry.geometry.dispose();
    if (Array.isArray(entry.material)) entry.material.forEach((material) => material.dispose());
    else entry.material.dispose();
  });
}

type SceneCtx = {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly globe: THREE.Group;
  readonly markerGroup: THREE.Group;
  readonly sphere: THREE.Mesh;
  readonly raycaster: THREE.Raycaster;
};

type MarkerCtx = {
  readonly mesh: THREE.Mesh;
  readonly ring: THREE.Mesh;
  readonly glow: THREE.Mesh | null;
  readonly dropLine: THREE.Line | null;
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly lat: number;
  readonly lon: number;
  readonly variant: 'object' | 'region';
  readonly duplicate: boolean;
};

export function AdminWorldGlobe({ objects, regions, selectedId, tool, duplicateIds, onSelect, onPlace }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [webGLFailed, setWebGLFailed] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [cursor, setCursor] = useState<CursorInfo | null>(null);
  const stateRef = useRef({ dragging: false, moved: false, lastX: 0, lastY: 0, rotX: DEFAULT_ROT_X, rotY: DEFAULT_ROT_Y, camDist: DEFAULT_CAM_DIST });

  const sceneRef = useRef<SceneCtx | null>(null);
  const markersRef = useRef<MarkerCtx[]>([]);
  const propsRef = useRef({ tool, onSelect, onPlace });
  propsRef.current = { tool, onSelect, onPlace };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      setWebGLFailed(true);
      return;
    }

    const width = canvas.clientWidth || 960;
    const height = canvas.clientHeight || 640;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 0, stateRef.current.camDist);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const globe = new THREE.Group();
    scene.add(globe);

    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.985, 48, 32), new THREE.MeshBasicMaterial({ color: 0x0a0a0c }));
    globe.add(sphere);
    globe.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 36, 24)),
      new THREE.LineBasicMaterial({ color: 0xe6001f, transparent: true, opacity: 0.24 }),
    ));
    const ringMat = new THREE.LineBasicMaterial({ color: 0xe6001f, transparent: true, opacity: 0.68 });
    globe.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circlePts(1.001, 64, 'xz')), ringMat));
    globe.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circlePts(1.001, 64, 'xy')), ringMat));
    globe.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.08, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0xe6001f, transparent: true, opacity: 0.055, side: THREE.BackSide }),
    ));

    const markerGroup = new THREE.Group();
    globe.add(markerGroup);

    sceneRef.current = { renderer, scene, camera, globe, markerGroup, sphere, raycaster };

    const setPointer = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    };

    const markerAt = (event: PointerEvent): MarkerCtx | null => {
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const meshes = markersRef.current.map((marker) => marker.mesh);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      return hit ? markersRef.current.find((marker) => marker.mesh === hit.object) ?? null : null;
    };

    const pointAt = (event: PointerEvent): GlobePoint | null => {
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(sphere, false)[0];
      if (!hit) return null;
      return vec3ToLatLon(globe.worldToLocal(hit.point.clone()));
    };

    const onPointerDown = (event: PointerEvent): void => {
      stateRef.current.dragging = true;
      stateRef.current.moved = false;
      stateRef.current.lastX = event.clientX;
      stateRef.current.lastY = event.clientY;
      canvas.classList.add('drag');
      canvas.setPointerCapture(event.pointerId);
      setHover(null);
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (stateRef.current.dragging) {
        const dx = event.clientX - stateRef.current.lastX;
        const dy = event.clientY - stateRef.current.lastY;
        if (Math.abs(dx) + Math.abs(dy) > 3) stateRef.current.moved = true;
        stateRef.current.lastX = event.clientX;
        stateRef.current.lastY = event.clientY;
        stateRef.current.rotY += dx * 0.006;
        stateRef.current.rotX = clamp(stateRef.current.rotX + dy * 0.006, -1.2, 1.2);
        setCursor(null);
        return;
      }
      const marker = markerAt(event);
      const rect = canvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      if (marker) {
        canvas.style.cursor = 'pointer';
        setHover({ x: localX, y: localY, kind: marker.kind, label: marker.label, lat: marker.lat, lon: marker.lon, variant: marker.variant });
        setCursor(null);
        return;
      }
      setHover(null);
      if (propsRef.current.tool === 'PLACE') {
        canvas.style.cursor = 'crosshair';
        const point = pointAt(event);
        if (point) setCursor({ x: localX, y: localY, lat: point.lat, lon: point.lon });
        else setCursor(null);
      } else {
        canvas.style.cursor = 'grab';
        setCursor(null);
      }
    };
    const onPointerUp = (event: PointerEvent): void => {
      stateRef.current.dragging = false;
      canvas.classList.remove('drag');
      if (stateRef.current.moved) return;
      const marker = markerAt(event);
      if (marker) {
        propsRef.current.onSelect(marker.id);
        return;
      }
      if (propsRef.current.tool === 'PLACE') {
        const point = pointAt(event);
        if (point) propsRef.current.onPlace(point);
      } else {
        propsRef.current.onSelect(null);
      }
    };
    const onPointerLeave = (): void => {
      stateRef.current.dragging = false;
      canvas.classList.remove('drag');
      setHover(null);
      setCursor(null);
    };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      stateRef.current.camDist = clamp(stateRef.current.camDist + event.deltaY * 0.0016, 1.8, 5);
    };
    const resize = (): void => {
      const nextWidth = canvas.clientWidth || 960;
      const nextHeight = canvas.clientHeight || 640;
      renderer.setSize(nextWidth, nextHeight, false);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
    };

    window.addEventListener('resize', resize);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    let rafId = 0;
    let tick = 0;
    const animate = (): void => {
      rafId = requestAnimationFrame(animate);
      tick += 1;
      globe.rotation.y = stateRef.current.rotY;
      globe.rotation.x = stateRef.current.rotX;
      camera.position.z = stateRef.current.camDist;
      const pulse = 0.85 + Math.sin(tick * 0.08) * 0.15;
      for (const marker of markersRef.current) {
        if (marker.glow) {
          marker.glow.scale.setScalar(1 + pulse * 0.18);
          const material = marker.glow.material as THREE.MeshBasicMaterial;
          material.opacity = 0.32 + pulse * 0.22;
        }
        if (marker.duplicate) {
          const material = marker.ring.material as THREE.MeshBasicMaterial;
          material.opacity = 0.55 + pulse * 0.35;
        }
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      disposeObject(globe);
      renderer.dispose();
      sceneRef.current = null;
      markersRef.current = [];
    };
  }, []);

  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { markerGroup } = ctx;

    while (markerGroup.children.length > 0) {
      const child = markerGroup.children[0]!;
      markerGroup.remove(child);
      disposeObject(child);
    }
    markersRef.current = [];

    for (const region of regions) {
      const color = ELHEX[region.element] ?? 0xe6001f;
      const pos = latLonToVec3(region.lat, region.lon, 1.012);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(REGION_MARKER_RADIUS, 12, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
      mesh.position.copy(pos);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.038, 0.05, 20), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      ring.position.copy(pos);
      ring.lookAt(pos.clone().multiplyScalar(2));
      const outerRing = new THREE.Mesh(new THREE.RingGeometry(0.055, 0.062, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide }));
      outerRing.position.copy(pos);
      outerRing.lookAt(pos.clone().multiplyScalar(2));
      markerGroup.add(mesh, ring, outerRing);
      markersRef.current.push({
        mesh, ring, glow: null, dropLine: null,
        id: `region-${region.biome}`,
        kind: `region · ${region.element}`,
        label: region.label,
        lat: region.lat,
        lon: region.lon,
        variant: 'region',
        duplicate: false,
      });
    }

    for (const object of objects) {
      const color = hexToNumber(object.tint, KIND_TINT[object.kind] ?? 0xd8d8df);
      const selected = object.id === selectedId;
      const duplicate = duplicateIds.has(object.id);
      const pos = latLonToVec3(object.lat, object.lon, 1.035);
      const geomFactory = KIND_GEOM[object.kind];
      const geometry = geomFactory ? geomFactory() : new THREE.SphereGeometry(FALLBACK_SPHERE_RADIUS, 14, 12);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color }));
      mesh.position.copy(pos);
      const normal = pos.clone().normalize();
      const up = new THREE.Vector3(0, 1, 0);
      mesh.quaternion.setFromUnitVectors(up, normal);
      if (selected) mesh.scale.setScalar(1.3);
      const ringColor = selected ? 0xff2d55 : duplicate ? 0xff5a3d : color;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(selected ? 0.06 : 0.048, selected ? 0.078 : 0.062, 28),
        new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: selected ? 0.95 : duplicate ? 0.8 : 0.55, side: THREE.DoubleSide }),
      );
      ring.position.copy(pos);
      ring.lookAt(pos.clone().multiplyScalar(2));
      markerGroup.add(mesh, ring);

      let glow: THREE.Mesh | null = null;
      let dropLine: THREE.Line | null = null;
      if (selected) {
        glow = new THREE.Mesh(
          new THREE.RingGeometry(0.086, 0.12, 32),
          new THREE.MeshBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
        );
        glow.position.copy(pos);
        glow.lookAt(pos.clone().multiplyScalar(2));
        markerGroup.add(glow);

        dropLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([pos.clone(), pos.clone().normalize().multiplyScalar(0.985)]),
          new THREE.LineBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.7 }),
        );
        markerGroup.add(dropLine);
      }

      markersRef.current.push({
        mesh, ring, glow, dropLine,
        id: object.id,
        kind: object.kind,
        label: object.label ?? object.kind,
        lat: object.lat,
        lon: object.lon,
        variant: 'object',
        duplicate,
      });
    }
  }, [objects, regions, selectedId, duplicateIds]);

  const resetCamera = useCallback((): void => {
    stateRef.current.rotX = DEFAULT_ROT_X;
    stateRef.current.rotY = DEFAULT_ROT_Y;
    stateRef.current.camDist = DEFAULT_CAM_DIST;
  }, []);

  const activeCursor = tool === 'PLACE' && cursor !== null ? cursor : null;
  const activeHover = hover !== null && activeCursor === null ? hover : null;

  return (
    <div className="admin-world-globe-canvas-host">
      <canvas ref={canvasRef} className="admin-world-globe-canvas" aria-label="Admin 3D world globe editor" />
      {webGLFailed ? <div className="admin-world-globe-fallback">3D globe unavailable. WebGL could not start.</div> : null}
      <button type="button" className="admin-world-globe-reset" onClick={resetCamera} aria-label="Reset camera view" title="Reset camera">⟲</button>
      {activeCursor ? (
        <div className="admin-world-globe-coords" style={{ left: activeCursor.x + 16, top: activeCursor.y + 16 }}>
          <span className="k">Place</span>
          <span className="v">{activeCursor.lat.toFixed(1)}°, {activeCursor.lon.toFixed(1)}°</span>
        </div>
      ) : null}
      {activeHover ? (
        <div className={`admin-world-globe-tooltip is-${activeHover.variant}`} style={{ left: activeHover.x + 16, top: activeHover.y + 16 }}>
          <div className="tt-kind">{activeHover.kind}</div>
          <div className="tt-label">{activeHover.label}</div>
          <div className="tt-coords">{activeHover.lat.toFixed(1)}°, {activeHover.lon.toFixed(1)}°</div>
        </div>
      ) : null}
      <div className="admin-world-globe-hint">Drag to rotate · scroll to zoom · {tool === 'PLACE' ? 'click sphere to place' : 'hover markers · click to select'}</div>
    </div>
  );
}
