import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { WorldObject, WorldRegion } from '@digiworld/shared';

type Tool = 'SELECT' | 'PLACE';
type GlobePoint = { readonly lat: number; readonly lon: number };

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
};

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

export function AdminWorldGlobe({ objects, regions, selectedId, tool, duplicateIds, onSelect, onPlace }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [webGLFailed, setWebGLFailed] = useState(false);
  const stateRef = useRef({ dragging: false, moved: false, lastX: 0, lastY: 0, rotX: 0.28, rotY: -0.35, camDist: 3.15 });

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
      new THREE.LineBasicMaterial({ color: 0xe6001f, transparent: true, opacity: 0.34 }),
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
    type Marker = { readonly mesh: THREE.Mesh; readonly ring: THREE.Mesh; readonly id: string; readonly duplicate: boolean };
    const markers: Marker[] = [];

    for (const region of regions) {
      const color = ELHEX[region.element] ?? 0xe6001f;
      const pos = latLonToVec3(region.lat, region.lon, 1.012);
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.019, 10, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82 }));
      marker.position.copy(pos);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.034, 0.045, 18), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, side: THREE.DoubleSide }));
      ring.position.copy(pos);
      ring.lookAt(pos.clone().multiplyScalar(2));
      markerGroup.add(marker, ring);
    }

    for (const object of objects) {
      const color = hexToNumber(object.tint, KIND_TINT[object.kind] ?? 0xd8d8df);
      const selected = object.id === selectedId;
      const duplicate = duplicateIds.has(object.id);
      const pos = latLonToVec3(object.lat, object.lon, 1.035);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(selected ? 0.046 : 0.036, 16, 16), new THREE.MeshBasicMaterial({ color }));
      mesh.position.copy(pos);
      const ringColor = selected ? 0xff2d55 : duplicate ? 0xff5a3d : color;
      const ring = new THREE.Mesh(new THREE.RingGeometry(selected ? 0.064 : 0.05, selected ? 0.083 : 0.065, 24), new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: selected || duplicate ? 0.95 : 0.58, side: THREE.DoubleSide }));
      ring.position.copy(pos);
      ring.lookAt(pos.clone().multiplyScalar(2));
      markerGroup.add(mesh, ring);
      markers.push({ mesh, ring, id: object.id, duplicate });
    }

    const resize = (): void => {
      const nextWidth = canvas.clientWidth || 960;
      const nextHeight = canvas.clientHeight || 640;
      renderer.setSize(nextWidth, nextHeight, false);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
    };

    const setPointer = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    };

    const markerAt = (event: PointerEvent): Marker | null => {
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(markers.map((marker) => marker.mesh), false)[0];
      return hit ? markers.find((marker) => marker.mesh === hit.object) ?? null : null;
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
      } else {
        canvas.style.cursor = markerAt(event) ? 'pointer' : tool === 'PLACE' ? 'crosshair' : 'grab';
      }
    };
    const onPointerUp = (event: PointerEvent): void => {
      stateRef.current.dragging = false;
      canvas.classList.remove('drag');
      if (stateRef.current.moved) return;
      const marker = markerAt(event);
      if (marker) {
        onSelect(marker.id);
        return;
      }
      if (tool === 'PLACE') {
        const point = pointAt(event);
        if (point) onPlace(point);
      } else {
        onSelect(null);
      }
    };
    const onPointerLeave = (): void => {
      stateRef.current.dragging = false;
      canvas.classList.remove('drag');
    };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      stateRef.current.camDist = clamp(stateRef.current.camDist + event.deltaY * 0.0016, 1.8, 5);
    };

    window.addEventListener('resize', resize);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    let rafId = 0;
    const animate = (): void => {
      rafId = requestAnimationFrame(animate);
      globe.rotation.y = stateRef.current.rotY;
      globe.rotation.x = stateRef.current.rotX;
      camera.position.z = stateRef.current.camDist;
      for (const marker of markers) {
        const selected = marker.id === selectedId;
        marker.ring.scale.setScalar(selected ? 1.28 : marker.duplicate ? 1.12 : 1);
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
    };
  }, [duplicateIds, objects, onPlace, onSelect, regions, selectedId, tool]);

  return (
    <div className="admin-world-globe-canvas-host">
      <canvas ref={canvasRef} className="admin-world-globe-canvas" aria-label="Admin 3D world globe editor" />
      {webGLFailed ? <div className="admin-world-globe-fallback">3D globe unavailable. WebGL could not start.</div> : null}
      <div className="admin-world-globe-hint">Drag to rotate · scroll to zoom · {tool === 'PLACE' ? 'click sphere to place' : 'click marker to edit'}</div>
    </div>
  );
}
