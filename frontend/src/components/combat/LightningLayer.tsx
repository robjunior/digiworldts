import * as THREE from 'three';
import type { UnitId } from '@digiworld/shared/battle';
import { useEffect, useRef } from 'react';

export type LightningEffect = {
  readonly id: string;
  readonly targetId: UnitId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const LIGHTNING_DURATION_MS = 700;
const FLICKER_INTERVAL_MS = 85;
const CORE_COLOR = 0xffffff;
const GLOW_COLOR = 0x7ec8ff;
const HALO_COLOR = 0xa8b8ff;
const BASE_BOLT_COUNT = 3;

type LayerProps = {
  readonly effects: readonly LightningEffect[];
};

export function LightningLayer({ effects }: LayerProps): JSX.Element {
  return (
    <div className="lightning-layer" aria-hidden="true">
      {effects.map((effect) => (
        <LightningNode key={effect.id} effect={effect} />
      ))}
    </div>
  );
}

function LightningNode({ effect }: { readonly effect: LightningEffect }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    return runLightningAnimation(canvas, effect.width, effect.height);
  }, [effect.width, effect.height]);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${effect.x}px`,
    top: `${effect.y}px`,
    width: `${effect.width}px`,
    height: `${effect.height}px`,
    pointerEvents: 'none',
    mixBlendMode: 'screen',
  };

  return <canvas ref={canvasRef} className="lightning-canvas" style={style} />;
}

function runLightningAnimation(canvas: HTMLCanvasElement, width: number, height: number): () => void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, width, height, 0, -100, 100);

  const bolts: THREE.Line[] = [];
  const materials: THREE.LineBasicMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  function clearBolts(): void {
    for (const line of bolts) scene.remove(line);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    bolts.length = 0;
    geometries.length = 0;
    materials.length = 0;
  }

  function makeBolt(color: number, opacity: number, jitterFactor: number): void {
    const points: THREE.Vector3[] = [];
    const originX = width / 2 + (Math.random() - 0.5) * width * 0.5;
    const stepCount = 10 + Math.floor(Math.random() * 6);
    for (let i = 0; i <= stepCount; i++) {
      const t = i / stepCount;
      const centerBias = 1 - Math.abs(t - 0.5) * 1.4;
      const jitter = (Math.random() - 0.5) * width * jitterFactor * Math.max(0.15, centerBias);
      const y = height * (1 - t);
      points.push(new THREE.Vector3(originX + jitter, y, 0));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    bolts.push(line);
    geometries.push(geometry);
    materials.push(material);
  }

  function generateBurst(currentOpacity: number): void {
    clearBolts();
    const boltCount = BASE_BOLT_COUNT + Math.floor(Math.random() * 3);
    for (let i = 0; i < boltCount; i++) {
      const isCore = i === 0;
      const isHalo = i > boltCount - 2;
      const color = isCore ? CORE_COLOR : isHalo ? HALO_COLOR : GLOW_COLOR;
      const layerOpacity = (isCore ? 1.0 : isHalo ? 0.35 : 0.7) * currentOpacity;
      const jitterFactor = isCore ? 0.28 : 0.42;
      makeBolt(color, layerOpacity, jitterFactor);
    }
  }

  const startTime = performance.now();
  let flickerAt = 0;
  let rafId = 0;
  let disposed = false;

  function tick(now: number): void {
    if (disposed) return;
    const elapsed = now - startTime;
    if (elapsed >= LIGHTNING_DURATION_MS) {
      cleanup();
      return;
    }
    const progress = elapsed / LIGHTNING_DURATION_MS;
    const opacity = Math.max(0, 1 - Math.pow(progress, 1.3));
    if (elapsed - flickerAt >= FLICKER_INTERVAL_MS || bolts.length === 0) {
      generateBurst(opacity);
      flickerAt = elapsed;
    } else {
      for (let i = 0; i < materials.length; i++) {
        const isCore = i === 0;
        const layerBase = isCore ? 1.0 : 0.55;
        materials[i]!.opacity = layerBase * opacity;
      }
    }
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  function cleanup(): void {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(rafId);
    clearBolts();
    renderer.dispose();
  }

  return cleanup;
}
