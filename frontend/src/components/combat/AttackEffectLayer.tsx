import * as THREE from 'three';
import type { UnitId } from '@digiworld/shared/battle';
import type { Element } from '@digiworld/shared/digimon';
import { useEffect, useRef } from 'react';

export type AnimatedElement = 'electricity' | 'fire' | 'plant';

export type AttackEffect = {
  readonly id: string;
  readonly targetId: UnitId;
  readonly element: AnimatedElement;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export function isAnimatedElement(element: Element | undefined | null): element is AnimatedElement {
  return element === 'electricity' || element === 'fire' || element === 'plant';
}

const ATTACK_DURATION_MS = 1200;

const FLICKER_MS: Record<AnimatedElement, number> = {
  electricity: 85,
  fire: 70,
  plant: 110,
};

const BOLT_COUNT: Record<AnimatedElement, readonly [number, number]> = {
  electricity: [3, 5],
  fire: [5, 7],
  plant: [4, 6],
};

type LayerSpec = { readonly color: number; readonly opacity: number };

const LAYERS: Record<AnimatedElement, readonly LayerSpec[]> = {
  electricity: [
    { color: 0xffffff, opacity: 1.0 },
    { color: 0x7ec8ff, opacity: 0.7 },
    { color: 0xa8b8ff, opacity: 0.35 },
  ],
  fire: [
    { color: 0xffee88, opacity: 1.0 },
    { color: 0xff8833, opacity: 0.7 },
    { color: 0xcc3311, opacity: 0.35 },
  ],
  plant: [
    { color: 0xa8ff88, opacity: 1.0 },
    { color: 0x4a9944, opacity: 0.55 },
    { color: 0x226622, opacity: 0.30 },
  ],
};

type LayerProps = {
  readonly effects: readonly AttackEffect[];
};

export function AttackEffectLayer({ effects }: LayerProps): JSX.Element {
  return (
    <div className="attack-effect-layer" aria-hidden="true">
      {effects.map((effect) => (
        <EffectNode key={effect.id} effect={effect} />
      ))}
    </div>
  );
}

function EffectNode({ effect }: { readonly effect: AttackEffect }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    return runAttackAnimation(canvas, effect.width, effect.height, effect.element);
  }, [effect.width, effect.height, effect.element]);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${effect.x}px`,
    top: `${effect.y}px`,
    width: `${effect.width}px`,
    height: `${effect.height}px`,
    pointerEvents: 'none',
    mixBlendMode: 'screen',
  };

  return <canvas ref={canvasRef} className={`attack-effect-canvas attack-effect-canvas--${effect.element}`} style={style} />;
}

function runAttackAnimation(canvas: HTMLCanvasElement, width: number, height: number, element: AnimatedElement): () => void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, width, height, 0, -100, 100);

  const lines: THREE.Line[] = [];
  const materials: THREE.LineBasicMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const layerSpecs = LAYERS[element];
  const [minBolts, maxBolts] = BOLT_COUNT[element];

  function disposeAll(): void {
    for (const line of lines) scene.remove(line);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    lines.length = 0;
    geometries.length = 0;
    materials.length = 0;
  }

  function addBolt(points: THREE.Vector3[], opacityScale: number): void {
    for (let l = 0; l < layerSpecs.length; l++) {
      const spec = layerSpecs[l]!;
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: spec.color, transparent: true, opacity: spec.opacity * opacityScale });
      const line = new THREE.Line(geometry, material);
      scene.add(line);
      lines.push(line);
      geometries.push(geometry);
      materials.push(material);
    }
  }

  function generateBurst(opacityScale: number): void {
    disposeAll();
    const count = minBolts + Math.floor(Math.random() * (maxBolts - minBolts + 1));
    for (let i = 0; i < count; i++) {
      const path = generatePath(element, width, height, i, count);
      addBolt(path, opacityScale);
    }
  }

  const startTime = performance.now();
  const flickerInterval = FLICKER_MS[element];
  let flickerAt = 0;
  let rafId = 0;
  let disposed = false;

  function tick(now: number): void {
    if (disposed) return;
    const elapsed = now - startTime;
    if (elapsed >= ATTACK_DURATION_MS) {
      cleanup();
      return;
    }
    const progress = elapsed / ATTACK_DURATION_MS;
    const fadeCurve = element === 'plant' ? 1.6 : 1.3;
    const opacity = Math.max(0, 1 - Math.pow(progress, fadeCurve));
    if (elapsed - flickerAt >= flickerInterval || lines.length === 0) {
      generateBurst(opacity);
      flickerAt = elapsed;
    } else {
      for (let i = 0; i < materials.length; i++) {
        const layerIdx = i % layerSpecs.length;
        materials[i]!.opacity = layerSpecs[layerIdx]!.opacity * opacity;
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
    disposeAll();
    renderer.dispose();
  }

  return cleanup;
}

function generatePath(element: AnimatedElement, width: number, height: number, boltIndex: number, boltCount: number): THREE.Vector3[] {
  switch (element) {
    case 'electricity':
      return lightningPath(width, height);
    case 'fire':
      return firePath(width, height, boltIndex, boltCount);
    case 'plant':
      return plantPath(width, height, boltIndex, boltCount);
  }
}

function lightningPath(width: number, height: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const originX = width / 2 + (Math.random() - 0.5) * width * 0.5;
  const stepCount = 10 + Math.floor(Math.random() * 6);
  for (let i = 0; i <= stepCount; i++) {
    const t = i / stepCount;
    const centerBias = 1 - Math.abs(t - 0.5) * 1.4;
    const jitter = (Math.random() - 0.5) * width * 0.42 * Math.max(0.15, centerBias);
    const y = height * (1 - t);
    points.push(new THREE.Vector3(originX + jitter, y, 0));
  }
  return points;
}

function firePath(width: number, height: number, boltIndex: number, boltCount: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const originX = width * ((boltIndex + 0.5) / boltCount) + (Math.random() - 0.5) * width * 0.12;
  const tongueHeight = height * (0.55 + Math.random() * 0.4);
  const stepCount = 9 + Math.floor(Math.random() * 3);
  for (let i = 0; i <= stepCount; i++) {
    const t = i / stepCount;
    const taper = 1 - t * 0.75;
    const wave = Math.sin(t * 5 + boltIndex * 1.7) * width * 0.05 * taper;
    const jitter = (Math.random() - 0.5) * width * 0.05 * taper;
    const y = height - tongueHeight * t;
    points.push(new THREE.Vector3(originX + wave + jitter, y, 0));
  }
  return points;
}

function plantPath(width: number, height: number, boltIndex: number, boltCount: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const startX = width * ((boltIndex + 0.5) / boltCount);
  const startY = height;
  const anchorAngle = Math.PI * (0.15 + Math.random() * 0.7);
  const controlX = width * 0.5 + Math.cos(anchorAngle) * width * 0.35 * (Math.random() > 0.5 ? 1 : -1);
  const controlY = height * (0.15 + Math.random() * 0.35);
  const endX = width * (0.15 + Math.random() * 0.7);
  const endY = height * (Math.random() * 0.25);
  const stepCount = 22;
  for (let i = 0; i <= stepCount; i++) {
    const t = i / stepCount;
    const u = 1 - t;
    const x = u * u * startX + 2 * u * t * controlX + t * t * endX + (Math.random() - 0.5) * 3;
    const y = u * u * startY + 2 * u * t * controlY + t * t * endY + (Math.random() - 0.5) * 3;
    points.push(new THREE.Vector3(x, y, 0));
  }
  return points;
}
