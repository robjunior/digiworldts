import * as THREE from 'three';
import { LightningStrike } from 'three-stdlib';
import type { UnitId } from '@digiworld/shared/battle';
import type { Element } from '@digiworld/shared/digimon';
import { useEffect, useRef } from 'react';

export type AnimatedElement = 'electricity' | 'fire' | 'plant';

export type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export type AttackEffect = {
  readonly id: string;
  readonly element: AnimatedElement;
  readonly arenaWidth: number;
  readonly arenaHeight: number;
  readonly source: { readonly x: number; readonly y: number };
  readonly target: { readonly x: number; readonly y: number };
  readonly targetRect: Rect;
};

export function isAnimatedElement(element: Element | undefined | null): element is AnimatedElement {
  return element === 'electricity' || element === 'fire' || element === 'plant';
}

const ATTACK_DURATION_MS = 1200;

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
    return runAttackAnimation(canvas, effect);
  }, [effect]);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${effect.arenaWidth}px`,
    height: `${effect.arenaHeight}px`,
    pointerEvents: 'none',
    mixBlendMode: 'screen',
  };

  return <canvas ref={canvasRef} className={`attack-effect-canvas attack-effect-canvas--${effect.element}`} style={style} />;
}

function runAttackAnimation(canvas: HTMLCanvasElement, effect: AttackEffect): () => void {
  const { arenaWidth: width, arenaHeight: height, element } = effect;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, width, 0, height, -100, 100);

  const runner = RUNNERS[element](scene, effect);

  const startTime = performance.now();
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
    runner.tick(elapsed, progress);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  function cleanup(): void {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(rafId);
    runner.dispose();
    renderer.dispose();
  }

  return cleanup;
}

type Runner = {
  tick(elapsedMs: number, progress: number): void;
  dispose(): void;
};

const RUNNERS: Record<AnimatedElement, (scene: THREE.Scene, effect: AttackEffect) => Runner> = {
  electricity: buildLightningRunner,
  fire: buildFireRunner,
  plant: buildPlantRunner,
};

function buildLightningRunner(scene: THREE.Scene, effect: AttackEffect): Runner {
  const source = new THREE.Vector3(effect.source.x, effect.source.y, 0);
  const dest = new THREE.Vector3(effect.target.x, effect.target.y, 0);
  const layers: Array<{ geometry: LightningStrike; material: THREE.MeshBasicMaterial; mesh: THREE.Mesh; baseOpacity: number }> = [];

  const specs = [
    { color: 0xffffff, radius: 6.5, baseOpacity: 1.0, timeScale: 1.4 },
    { color: 0x7ec8ff, radius: 9.5, baseOpacity: 0.75, timeScale: 1.1 },
    { color: 0x2f6fff, radius: 14, baseOpacity: 0.35, timeScale: 0.85 },
  ];

  for (const spec of specs) {
    const geometry = new LightningStrike({
      sourceOffset: source.clone(),
      destOffset: dest.clone(),
      radius0: spec.radius,
      radius1: spec.radius * 0.7,
      minRadius: 1.0,
      maxIterations: 6,
      isEternal: true,
      timeScale: spec.timeScale,
      propagationTimeFactor: 0.05,
      vanishingTimeFactor: 0.9,
      subrayPeriod: 0.25,
      subrayDutyCycle: 0.65,
      maxSubrayRecursion: 3,
      ramification: 5,
      recursionProbability: 0.55,
      roughness: 0.85,
      straightness: 0.62,
    });
    const material = new THREE.MeshBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: spec.baseOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    layers.push({ geometry, material, mesh, baseOpacity: spec.baseOpacity });
  }

  return {
    tick(elapsedMs, progress) {
      const seconds = elapsedMs / 1000;
      const fade = 1 - Math.pow(progress, 1.4);
      for (const layer of layers) {
        layer.geometry.update(seconds);
        layer.material.opacity = layer.baseOpacity * Math.max(0, fade);
      }
    },
    dispose() {
      for (const layer of layers) {
        scene.remove(layer.mesh);
        layer.geometry.dispose();
        layer.material.dispose();
      }
    },
  };
}

type FireParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  lifetime: number;
  age: number;
};

function buildFireRunner(scene: THREE.Scene, effect: AttackEffect): Runner {
  const { targetRect } = effect;
  const bandCount = 3;
  const bandSpecs = [
    { color: 0xffee88, size: 26, particleCount: 46, riseSpeed: 90 },
    { color: 0xff8833, size: 38, particleCount: 62, riseSpeed: 68 },
    { color: 0xcc3311, size: 54, particleCount: 40, riseSpeed: 46 },
  ];

  const bands: Array<{
    particles: FireParticle[];
    positions: Float32Array;
    geometry: THREE.BufferGeometry;
    material: THREE.PointsMaterial;
    points: THREE.Points;
    speed: number;
  }> = [];

  for (let b = 0; b < bandCount; b++) {
    const spec = bandSpecs[b]!;
    const particles: FireParticle[] = [];
    for (let i = 0; i < spec.particleCount; i++) {
      particles.push(spawnFireParticle(targetRect, spec.riseSpeed, true));
    }
    const positions = new Float32Array(spec.particleCount * 3);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]!;
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = 0;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: spec.color,
      size: spec.size,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false,
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);
    bands.push({ particles, positions, geometry, material, points, speed: spec.riseSpeed });
  }

  let lastTickMs = 0;

  return {
    tick(elapsedMs, progress) {
      const dt = Math.min(0.05, (elapsedMs - lastTickMs) / 1000);
      lastTickMs = elapsedMs;
      const fade = 1 - Math.pow(progress, 1.5);
      for (const band of bands) {
        for (let i = 0; i < band.particles.length; i++) {
          const p = band.particles[i]!;
          p.age += dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.age >= p.lifetime || p.y < targetRect.y - targetRect.height * 0.2) {
            const respawn = spawnFireParticle(targetRect, band.speed, false);
            p.x = respawn.x;
            p.y = respawn.y;
            p.vx = respawn.vx;
            p.vy = respawn.vy;
            p.size = respawn.size;
            p.lifetime = respawn.lifetime;
            p.age = respawn.age;
          }
          band.positions[i * 3] = p.x;
          band.positions[i * 3 + 1] = p.y;
        }
        band.geometry.attributes.position!.needsUpdate = true;
        band.material.opacity = 0.9 * fade;
      }
    },
    dispose() {
      for (const band of bands) {
        scene.remove(band.points);
        band.geometry.dispose();
        band.material.dispose();
      }
    },
  };
}

function spawnFireParticle(rect: Rect, baseSpeed: number, prewarm: boolean): FireParticle {
  const x = rect.x + Math.random() * rect.width;
  const bottomBand = rect.y + rect.height + (Math.random() - 0.5) * rect.height * 0.15;
  const y = prewarm ? rect.y + rect.height - Math.random() * rect.height * 1.1 : bottomBand;
  const vx = (Math.random() - 0.5) * 30;
  const vy = -(baseSpeed + (Math.random() - 0.5) * baseSpeed * 0.4);
  const lifetime = 0.55 + Math.random() * 0.5;
  return { x, y, vx, vy, size: 0, lifetime, age: prewarm ? Math.random() * lifetime : 0 };
}

function buildPlantRunner(scene: THREE.Scene, effect: AttackEffect): Runner {
  const { targetRect } = effect;
  const layerSpecs = [
    { color: 0xa8ff88, opacity: 1.0 },
    { color: 0x4a9944, opacity: 0.55 },
    { color: 0x226622, opacity: 0.3 },
  ];
  const lines: THREE.Line[] = [];
  const materials: THREE.LineBasicMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  const flickerMs = 110;
  const boltMin = 4;
  const boltMax = 6;

  function disposeAll(): void {
    for (const line of lines) scene.remove(line);
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    lines.length = 0;
    geometries.length = 0;
    materials.length = 0;
  }

  function generateBurst(currentFade: number): void {
    disposeAll();
    const count = boltMin + Math.floor(Math.random() * (boltMax - boltMin + 1));
    for (let i = 0; i < count; i++) {
      const points = plantPath(targetRect, i, count);
      for (const spec of layerSpecs) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color: spec.color,
          transparent: true,
          opacity: spec.opacity * currentFade,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const line = new THREE.Line(geometry, material);
        scene.add(line);
        lines.push(line);
        geometries.push(geometry);
        materials.push(material);
      }
    }
  }

  let flickerAt = 0;

  return {
    tick(elapsedMs, progress) {
      const fade = 1 - Math.pow(progress, 1.6);
      if (elapsedMs - flickerAt >= flickerMs || lines.length === 0) {
        generateBurst(fade);
        flickerAt = elapsedMs;
      } else {
        for (let i = 0; i < materials.length; i++) {
          const specIdx = i % layerSpecs.length;
          materials[i]!.opacity = layerSpecs[specIdx]!.opacity * fade;
        }
      }
    },
    dispose() {
      disposeAll();
    },
  };
}

function plantPath(rect: Rect, boltIndex: number, boltCount: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const startX = rect.x + rect.width * ((boltIndex + 0.5) / boltCount);
  const startY = rect.y + rect.height;
  const anchorAngle = Math.PI * (0.15 + Math.random() * 0.7);
  const controlX = rect.x + rect.width * 0.5 + Math.cos(anchorAngle) * rect.width * 0.35 * (Math.random() > 0.5 ? 1 : -1);
  const controlY = rect.y + rect.height * (0.15 + Math.random() * 0.35);
  const endX = rect.x + rect.width * (0.15 + Math.random() * 0.7);
  const endY = rect.y + rect.height * (Math.random() * 0.25);
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
