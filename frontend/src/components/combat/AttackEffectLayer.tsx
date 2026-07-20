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

type FireImpactParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
};

const FIRE_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FIRE_FRAGMENT_SHADER = `
  precision highp float;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uReach;
  uniform vec3 uColorCore;
  uniform vec3 uColorMid;
  uniform vec3 uColorEdge;
  uniform float uThicknessMul;
  varying vec2 vUv;

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      v += amp * valueNoise(p);
      p *= 2.03;
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv;

    // Propagation tip — kills all pixels past the current reach front with a soft leading edge.
    float reachMask = smoothstep(uReach + 0.04, uReach - 0.04, uv.x);
    if (reachMask <= 0.0) discard;

    // Cone shaping — nozzle at source is thin, plume at impact is full width.
    float coneWidth = mix(0.28, 1.0, smoothstep(0.0, 1.0, uv.x));
    float ry = (uv.y - 0.5) / max(coneWidth, 0.05);

    // Turbulent scroll and wobble
    float turb = fbm(vec2(uv.x * 4.0 - uTime * 3.0, uv.y * 4.0));
    float wobble = (turb - 0.5) * 0.28;
    float wobbledY = ry + wobble;
    float distortedAcross = 1.0 - abs(wobbledY) * 2.0;
    distortedAcross = smoothstep(0.0, 0.6, distortedAcross);

    // Along-beam envelope — bright at source, fades toward the traveling tip.
    float baseAlong = smoothstep(0.02, 0.18, uv.x) * smoothstep(0.02, 0.30, uReach - uv.x + 0.05);
    float along = baseAlong * reachMask;

    float flicker = fbm(vec2(uv.x * 8.0 - uTime * 5.5, uv.y * 8.0 + uTime * 2.2)) * 0.65 + 0.4;
    float intensity = distortedAcross * along * flicker * uThicknessMul;

    vec3 color = mix(uColorEdge, uColorMid, smoothstep(0.15, 0.5, intensity));
    color = mix(color, uColorCore, smoothstep(0.55, 1.0, intensity));

    gl_FragColor = vec4(color, intensity * uOpacity);
  }
`;

const FIRE_LAYERS = [
  { colorCore: 0xfff5dd, colorMid: 0xffb060, colorEdge: 0xc92910, widthMul: 0.55, thicknessMul: 1.6 },
  { colorCore: 0xffdd88, colorMid: 0xff8833, colorEdge: 0x8b1a0a, widthMul: 0.90, thicknessMul: 1.2 },
  { colorCore: 0xff8833, colorMid: 0xc93010, colorEdge: 0x3a0a05, widthMul: 1.40, thicknessMul: 0.85 },
];

function buildFireRunner(scene: THREE.Scene, effect: AttackEffect): Runner {
  const { source, target, targetRect } = effect;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const beamLength = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const angle = Math.atan2(dy, dx);
  const midX = source.x + dx / 2;
  const midY = source.y + dy / 2;
  const baseWidth = Math.max(48, Math.min(targetRect.width, targetRect.height) * 0.7);

  const meshes: THREE.Mesh[] = [];
  const materials: THREE.ShaderMaterial[] = [];
  const geometries: THREE.PlaneGeometry[] = [];

  for (const layer of FIRE_LAYERS) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 1 },
        uReach: { value: 0 },
        uColorCore: { value: new THREE.Color(layer.colorCore) },
        uColorMid: { value: new THREE.Color(layer.colorMid) },
        uColorEdge: { value: new THREE.Color(layer.colorEdge) },
        uThicknessMul: { value: layer.thicknessMul },
      },
      vertexShader: FIRE_VERTEX_SHADER,
      fragmentShader: FIRE_FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(midX, midY, 0);
    mesh.rotation.z = angle;
    mesh.scale.set(beamLength, baseWidth * layer.widthMul, 1);
    scene.add(mesh);
    meshes.push(mesh);
    materials.push(material);
    geometries.push(geometry);
  }

  const impactCount = 48;
  const impactPositions = new Float32Array(impactCount * 3);
  const impactParticles: FireImpactParticle[] = [];
  for (let i = 0; i < impactCount; i++) {
    const seeded = seedImpactParticle(target.x, target.y);
    impactParticles.push(seeded);
    impactPositions[i * 3] = seeded.x;
    impactPositions[i * 3 + 1] = seeded.y;
    impactPositions[i * 3 + 2] = 0;
  }
  const impactGeometry = new THREE.BufferGeometry();
  impactGeometry.setAttribute('position', new THREE.BufferAttribute(impactPositions, 3));
  const impactMaterial = new THREE.PointsMaterial({
    color: 0xffdd88,
    size: 18,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: false,
  });
  const impactPoints = new THREE.Points(impactGeometry, impactMaterial);
  scene.add(impactPoints);

  let lastTickMs = 0;

  return {
    tick(elapsedMs, progress) {
      const dt = Math.min(0.05, (elapsedMs - lastTickMs) / 1000);
      lastTickMs = elapsedMs;
      const fade = 1 - Math.pow(progress, 1.5);
      const seconds = elapsedMs / 1000;
      const reachTime = Math.min(600, 260 + beamLength * 0.55);
      const reach = Math.min(1, elapsedMs / reachTime);
      const impactGate = Math.max(0, Math.min(1, (reach - 0.9) / 0.1));
      for (const material of materials) {
        material.uniforms.uTime!.value = seconds;
        material.uniforms.uOpacity!.value = fade;
        material.uniforms.uReach!.value = reach;
      }
      if (reach < 0.9) {
        impactMaterial.opacity = 0;
      } else {
        for (let i = 0; i < impactCount; i++) {
          const p = impactParticles[i]!;
          p.age += dt;
          if (p.age >= p.life) {
            const seeded = seedImpactParticle(target.x, target.y);
            p.x = seeded.x;
            p.y = seeded.y;
            p.vx = seeded.vx;
            p.vy = seeded.vy;
            p.age = seeded.age;
            p.life = seeded.life;
          } else {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
          }
          impactPositions[i * 3] = p.x;
          impactPositions[i * 3 + 1] = p.y;
        }
        impactGeometry.attributes.position!.needsUpdate = true;
        impactMaterial.opacity = fade * impactGate;
      }
    },
    dispose() {
      for (const mesh of meshes) scene.remove(mesh);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      scene.remove(impactPoints);
      impactGeometry.dispose();
      impactMaterial.dispose();
    },
  };
}

function seedImpactParticle(cx: number, cy: number): FireImpactParticle {
  const angle = Math.random() * Math.PI * 2;
  const speed = 40 + Math.random() * 90;
  return {
    x: cx + (Math.random() - 0.5) * 10,
    y: cy + (Math.random() - 0.5) * 10,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 25,
    life: 0.35 + Math.random() * 0.45,
    age: Math.random() * 0.2,
  };
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
