import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { WorldRegion } from '@digiworld/shared/world';
import type { WorldObject } from '../../lib/api-world';
import type { WorldHoverTipData } from './WorldHoverTip';

const ELHEX: Record<string, number> = {
  fire: 0xe6001f, water: 0x4aa3ff, plant: 0x3fbf6f, electricity: 0xe8c33a,
  ice: 0x7ad0e6, earth: 0xb98a4a, steel: 0x9fb0bd, wind: 0x63d6c0,
  light: 0xf2e39a, dark: 0xc03a4a, null: 0x8a877f
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function latLonToVec3(lat: number, lon: number, r: number) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

function circlePts(r: number, seg: number, plane: 'xy' | 'xz') {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const a = i / seg * Math.PI * 2;
    if (plane === 'xz') pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    else pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  return pts;
}

type WorldGlobeProps = {
  readonly regions: readonly WorldRegion[];
  readonly worldObjects?: readonly WorldObject[];
  readonly autoSpin: boolean;
  readonly selectedIdx: number | null;
  readonly hoveredIdx: number;
  readonly onHoverChange: (idx: number) => void;
  readonly onSelect: (idx: number) => void;
  readonly onHoverTip: (tip: WorldHoverTipData | null) => void;
  readonly onFailWebGL: () => void;
};

export function WorldGlobe({
  regions,
  worldObjects,
  autoSpin,
  selectedIdx,
  hoveredIdx,
  onHoverChange,
  onSelect,
  onHoverTip,
  onFailWebGL
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
    camDist: 3.1,
  });

  useEffect(() => {
    stateRef.current.autoSpin = autoSpin;
    stateRef.current.selectedIdx = selectedIdx;
    stateRef.current.hoveredIdx = hoveredIdx;
  }, [autoSpin, selectedIdx, hoveredIdx]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    if (typeof THREE === 'undefined') {
      onFailWebGL();
      return;
    }
    
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      if (!renderer.getContext()) throw new Error('No WebGL');
    } catch (e) {
      onFailWebGL();
      return;
    }
    
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    camera.position.set(0, 0, stateRef.current.camDist);
    const clock = new THREE.Clock();
    const raycaster = new THREE.Raycaster();
    
    const globe = new THREE.Group();
    scene.add(globe);
    
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.985, 48, 32), new THREE.MeshBasicMaterial({ color: 0x0a0a0c }));
    globe.add(core);
    
    const grid = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 36, 24)),
      new THREE.LineBasicMaterial({ color: 0xe6001f, transparent: true, opacity: 0.34 })
    );
    globe.add(grid);
    
    const ringMat = new THREE.LineBasicMaterial({ color: 0xe6001f, transparent: true, opacity: 0.7 });
    const eq = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circlePts(1.001, 64, 'xz')), ringMat);
    globe.add(eq);
    const mer = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circlePts(1.001, 64, 'xy')), ringMat);
    globe.add(mer);
    
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.08, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0xe6001f, transparent: true, opacity: 0.05, side: THREE.BackSide }));
    globe.add(glow);
    
    const nodeGroup = new THREE.Group();
    globe.add(nodeGroup);
    
    type NodeMesh = { mesh: THREE.Mesh, ring: THREE.Mesh, data: WorldRegion, idx: number };
    const nodeMeshes: NodeMesh[] = [];
    
    regions.forEach((b, i) => {
      const pos = latLonToVec3(b.lat, b.lon, 1.0);
      const col = ELHEX[b.element] || 0xe6001f;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 12), new THREE.MeshBasicMaterial({ color: col }));
      m.position.copy(pos);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.066, 20),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      ring.position.copy(pos);
      ring.lookAt(pos.clone().multiplyScalar(2));
      const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pos.clone(), pos.clone().multiplyScalar(1.12)]),
        new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.6 }));
      nodeGroup.add(m); nodeGroup.add(ring); nodeGroup.add(stem);
      nodeMeshes.push({ mesh: m, ring, data: b, idx: i });
    });
    
    (worldObjects ?? []).forEach((obj) => {
      const pos = latLonToVec3(obj.lat, obj.lon, 1.0);
      const colorHex = obj.tint ?? '#c8b48a';
      const col = parseInt(colorHex.replace('#', ''), 16);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.024, 10, 10),
        new THREE.MeshBasicMaterial({ color: col })
      );
      marker.position.copy(pos);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.038, 0.05, 16),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
      );
      ring.position.copy(pos);
      ring.lookAt(pos.clone().multiplyScalar(2));
      nodeGroup.add(marker);
      nodeGroup.add(ring);
    });
    
    const resizeGlobe = () => {
      if (!canvas) return;
      const rw = canvas.clientWidth || 800, rh = canvas.clientHeight || 600;
      renderer.setSize(rw, rh, false);
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resizeGlobe);
    
    const ndc = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    
    const pickHover = (e: PointerEvent) => {
      raycaster.setFromCamera(ndc(e), camera);
      const hits = raycaster.intersectObjects(nodeMeshes.map(n => n.mesh), false);
      const firstHit = hits[0];
      const newHovered = firstHit ? nodeMeshes.findIndex(n => n.mesh === firstHit.object) : -1;
      
      if (newHovered !== stateRef.current.hoveredIdx) {
        onHoverChange(newHovered);
      }
      
      canvas.style.cursor = newHovered >= 0 ? 'pointer' : (stateRef.current.dragging ? 'grabbing' : 'grab');
      
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
            el: cap(n.data.element) + ' · Danger ' + n.data.danger,
            rawEl: n.data.element
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
      canvas.classList.add('drag');
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (stateRef.current.dragging) {
        const dx = e.clientX - stateRef.current.lastX;
        const dy = e.clientY - stateRef.current.lastY;
        stateRef.current.lastX = e.clientX;
        stateRef.current.lastY = e.clientY;
        stateRef.current.rotY += dx * 0.006;
        stateRef.current.rotX = Math.max(-1.2, Math.min(1.2, stateRef.current.rotX + dy * 0.006));
      } else {
        pickHover(e);
      }
    };
    const onPointerUp = () => {
      stateRef.current.dragging = false;
      canvas.classList.remove('drag');
    };
    const onPointerLeave = () => {
      stateRef.current.dragging = false;
      onHoverChange(-1);
      onHoverTip(null);
      canvas.classList.remove('drag');
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stateRef.current.camDist = Math.max(1.8, Math.min(5, stateRef.current.camDist + e.deltaY * 0.0016));
    };
    const onClick = () => {
      if (stateRef.current.hoveredIdx >= 0) {
        onSelect(stateRef.current.hoveredIdx);
      }
    };
    
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('click', onClick);
    
    let rafId: number;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      if (stateRef.current.autoSpin && !stateRef.current.dragging) {
        stateRef.current.rotY += 0.0016;
      }
      globe.rotation.y = stateRef.current.rotY;
      globe.rotation.x = stateRef.current.rotX;
      camera.position.z = stateRef.current.camDist;
      
      const t = clock.getElapsedTime();
      nodeMeshes.forEach((n, i) => {
        const isSel = (i === stateRef.current.hoveredIdx || n.idx === stateRef.current.selectedIdx);
        const s = isSel ? 1.35 + Math.sin(t * 4) * 0.12 : 1;
        n.ring.scale.setScalar(s);
        (n.ring.material as THREE.MeshBasicMaterial).opacity = isSel ? 1 : 0.7;
      });
      
      renderer.render(scene, camera);
    };
    animate();
    
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resizeGlobe);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('click', onClick);
      
      renderer.dispose();
      globe.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineLoop || obj instanceof THREE.LineSegments) {
          if (obj.geometry) obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else if (obj.material) obj.material.dispose();
        }
      });
    };
  }, [regions, worldObjects, onFailWebGL, onHoverChange, onHoverTip, onSelect]);

  return <canvas ref={canvasRef} className="world-canvas" id="globe" aria-label="3D world globe"></canvas>;
}
