import * as THREE from 'three';
import { LightningStrike } from 'three-stdlib';
import type { UnitId } from '@digiworld/shared/battle';
import type { Element } from '@digiworld/shared/digimon';
import { useEffect, useRef } from 'react';

export type AnimatedElement =
  | 'electricity'
  | 'fire'
  | 'plant'
  | 'water'
  | 'ice'
  | 'earth'
  | 'steel'
  | 'wind'
  | 'light'
  | 'dark'
  | 'null';

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

const ANIMATED_ELEMENTS: ReadonlySet<AnimatedElement> = new Set([
  'electricity',
  'fire',
  'plant',
  'water',
  'ice',
  'earth',
  'steel',
  'wind',
  'light',
  'dark',
  'null',
]);

export function isAnimatedElement(element: Element | undefined | null): element is AnimatedElement {
  return element !== undefined && element !== null && ANIMATED_ELEMENTS.has(element as AnimatedElement);
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
  water: buildWaterRunner,
  ice: buildIceRunner,
  earth: buildEarthRunner,
  steel: buildSteelRunner,
  wind: buildWindRunner,
  light: buildLightRunner,
  dark: buildDarkRunner,
  null: buildNullRunner,
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

const WATER_FRAGMENT_SHADER = `
  precision highp float;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uReach;
  uniform vec3 uColorCore;
  uniform vec3 uColorMid;
  uniform vec3 uColorEdge;
  uniform float uThicknessMul;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    float reachMask = smoothstep(uReach + 0.04, uReach - 0.04, uv.x);
    if (reachMask <= 0.0) discard;
    float wave1 = sin((uv.x * 12.0 - uTime * 4.5) + uv.y * 6.0);
    float wave2 = sin((uv.x * 8.0 - uTime * 3.0) - uv.y * 10.0 + 1.7);
    float mixed = (wave1 + wave2) * 0.25 + 0.5;
    float wobble = (mixed - 0.5) * 0.20;
    float wobbledAcross = 1.0 - abs(uv.y - 0.5 + wobble) * 2.0;
    wobbledAcross = smoothstep(0.0, 0.55, wobbledAcross);
    float along = smoothstep(0.02, 0.15, uv.x) * smoothstep(0.02, 0.25, uReach - uv.x + 0.05);
    float intensity = wobbledAcross * along * uThicknessMul * (0.6 + 0.4 * mixed);
    vec3 color = mix(uColorEdge, uColorMid, smoothstep(0.15, 0.55, intensity));
    color = mix(color, uColorCore, smoothstep(0.6, 1.0, intensity));
    gl_FragColor = vec4(color, intensity * uOpacity);
  }
`;

const WATER_LAYERS = [
  { colorCore: 0xf0faff, colorMid: 0x50a5e0, colorEdge: 0x123a7b, widthMul: 0.6, thicknessMul: 1.4 },
  { colorCore: 0xd0e8ff, colorMid: 0x3080c0, colorEdge: 0x0a1e50, widthMul: 1.0, thicknessMul: 1.1 },
  { colorCore: 0x60a0e0, colorMid: 0x1560a0, colorEdge: 0x040e30, widthMul: 1.5, thicknessMul: 0.75 },
];

function buildWaterRunner(scene: THREE.Scene, effect: AttackEffect): Runner {
  const { source, target, targetRect } = effect;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const beamLength = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const angle = Math.atan2(dy, dx);
  const midX = source.x + dx / 2;
  const midY = source.y + dy / 2;
  const baseWidth = Math.max(52, Math.min(targetRect.width, targetRect.height) * 0.75);

  const meshes: THREE.Mesh[] = [];
  const materials: THREE.ShaderMaterial[] = [];
  const geometries: THREE.PlaneGeometry[] = [];

  for (const layer of WATER_LAYERS) {
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
      fragmentShader: WATER_FRAGMENT_SHADER,
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

  const ringGeometry = new THREE.RingGeometry(0.5, 1, 48);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x7ec4ff,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.position.set(target.x, target.y, 0);
  scene.add(ring);

  const maxRingRadius = Math.max(targetRect.width, targetRect.height) * 0.9;

  return {
    tick(elapsedMs, progress) {
      const fade = 1 - Math.pow(progress, 1.5);
      const seconds = elapsedMs / 1000;
      const reachTime = Math.min(600, 280 + beamLength * 0.55);
      const reach = Math.min(1, elapsedMs / reachTime);
      for (const material of materials) {
        material.uniforms.uTime!.value = seconds;
        material.uniforms.uOpacity!.value = fade;
        material.uniforms.uReach!.value = reach;
      }
      if (reach >= 0.9) {
        const rippleProgress = Math.min(1, (elapsedMs - reachTime * 0.9) / 500);
        ring.scale.set(rippleProgress * maxRingRadius, rippleProgress * maxRingRadius, 1);
        ringMaterial.opacity = (1 - rippleProgress) * fade * 0.85;
      }
    },
    dispose() {
      for (const mesh of meshes) scene.remove(mesh);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      scene.remove(ring);
      ringGeometry.dispose();
      ringMaterial.dispose();
    },
  };
}

function buildIceRunner(scene: THREE.Scene, effect: AttackEffect): Runner {
  const source = new THREE.Vector3(effect.source.x, effect.source.y, 0);
  const dest = new THREE.Vector3(effect.target.x, effect.target.y, 0);
  const specs = [
    { color: 0xffffff, radius: 5, baseOpacity: 1.0 },
    { color: 0xcaf0ff, radius: 8, baseOpacity: 0.7 },
    { color: 0x60c0ff, radius: 12, baseOpacity: 0.35 },
  ];
  const layers: Array<{ geometry: LightningStrike; material: THREE.MeshBasicMaterial; mesh: THREE.Mesh; baseOpacity: number }> = [];
  for (const spec of specs) {
    const geometry = new LightningStrike({
      sourceOffset: source.clone(),
      destOffset: dest.clone(),
      radius0: spec.radius,
      radius1: spec.radius * 0.6,
      minRadius: 0.6,
      maxIterations: 4,
      isEternal: true,
      timeScale: 0.55,
      propagationTimeFactor: 0.05,
      vanishingTimeFactor: 0.9,
      subrayPeriod: 0.9,
      subrayDutyCycle: 0.3,
      maxSubrayRecursion: 1,
      ramification: 2,
      recursionProbability: 0.25,
      roughness: 0.35,
      straightness: 0.92,
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

  const shardCount = 28;
  const shardPositions = new Float32Array(shardCount * 3);
  for (let i = 0; i < shardCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * Math.max(effect.targetRect.width, effect.targetRect.height) * 0.6;
    shardPositions[i * 3] = effect.target.x + Math.cos(angle) * r;
    shardPositions[i * 3 + 1] = effect.target.y + Math.sin(angle) * r;
    shardPositions[i * 3 + 2] = 0;
  }
  const shardGeometry = new THREE.BufferGeometry();
  shardGeometry.setAttribute('position', new THREE.BufferAttribute(shardPositions, 3));
  const shardMaterial = new THREE.PointsMaterial({
    color: 0xdff2ff,
    size: 12,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: false,
  });
  const shards = new THREE.Points(shardGeometry, shardMaterial);
  scene.add(shards);

  return {
    tick(elapsedMs, progress) {
      const seconds = elapsedMs / 1000;
      const fade = 1 - Math.pow(progress, 1.4);
      for (const layer of layers) {
        layer.geometry.update(seconds);
        layer.material.opacity = layer.baseOpacity * Math.max(0, fade);
      }
      const shardGate = Math.max(0, Math.min(1, (progress - 0.35) / 0.15));
      shardMaterial.opacity = fade * shardGate * 0.9;
    },
    dispose() {
      for (const layer of layers) {
        scene.remove(layer.mesh);
        layer.geometry.dispose();
        layer.material.dispose();
      }
      scene.remove(shards);
      shardGeometry.dispose();
      shardMaterial.dispose();
    },
  };
}

type EarthRock = {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  geometry: THREE.BufferGeometry;
  startY: number;
  endY: number;
  rotation: number;
  delay: number;
};

function buildEarthRunner(scene: THREE.Scene, effect: AttackEffect): Runner {
  const { targetRect } = effect;
  const rockCount = 5 + Math.floor(Math.random() * 3);
  const rocks: EarthRock[] = [];
  const palette = [0x8b5a3c, 0x6b4020, 0x4a2c14, 0x7a4a30];
  const baseY = targetRect.y + targetRect.height + 20;
  for (let i = 0; i < rockCount; i++) {
    const size = 24 + Math.random() * (targetRect.width * 0.18);
    const shape = new THREE.Shape();
    const sides = 5 + Math.floor(Math.random() * 3);
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const r = size * (0.65 + Math.random() * 0.5);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (s === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const geometry = new THREE.ShapeGeometry(shape);
    const material = new THREE.MeshBasicMaterial({
      color: palette[Math.floor(Math.random() * palette.length)]!,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const spacing = targetRect.width / rockCount;
    mesh.position.set(targetRect.x + spacing * (i + 0.5) + (Math.random() - 0.5) * 12, baseY, 0);
    mesh.rotation.z = Math.random() * Math.PI * 2;
    scene.add(mesh);
    rocks.push({
      mesh,
      material,
      geometry,
      startY: baseY,
      endY: targetRect.y + targetRect.height * (0.15 + Math.random() * 0.35),
      rotation: (Math.random() - 0.5) * Math.PI,
      delay: Math.random() * 260,
    });
  }

  const dustCount = 40;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPositions[i * 3] = targetRect.x + Math.random() * targetRect.width;
    dustPositions[i * 3 + 1] = targetRect.y + targetRect.height * (0.7 + Math.random() * 0.3);
    dustPositions[i * 3 + 2] = 0;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMaterial = new THREE.PointsMaterial({
    color: 0xa88060,
    size: 14,
    transparent: true,
    opacity: 0,
    blending: THREE.NormalBlending,
    depthWrite: false,
    sizeAttenuation: false,
  });
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  scene.add(dust);

  return {
    tick(elapsedMs, progress) {
      const fade = 1 - Math.pow(progress, 1.6);
      for (const rock of rocks) {
        const rockElapsed = Math.max(0, elapsedMs - rock.delay);
        const rise = Math.min(1, rockElapsed / 420);
        const eased = 1 - Math.pow(1 - rise, 3);
        rock.mesh.position.y = rock.startY + (rock.endY - rock.startY) * eased;
        rock.mesh.rotation.z += rock.rotation * 0.008;
        rock.material.opacity = Math.min(1, eased * 1.4) * fade;
      }
      const dustGate = Math.max(0, Math.min(1, (progress - 0.15) / 0.15));
      dustMaterial.opacity = fade * dustGate * 0.75;
    },
    dispose() {
      for (const rock of rocks) {
        scene.remove(rock.mesh);
        rock.geometry.dispose();
        rock.material.dispose();
      }
      scene.remove(dust);
      dustGeometry.dispose();
      dustMaterial.dispose();
    },
  };
}

function buildSteelRunner(scene: THREE.Scene, effect: AttackEffect): Runner {
  const { targetRect } = effect;
  const slashCount = 3;
  const slashes: Array<{
    line: THREE.Line;
    geometry: THREE.BufferGeometry;
    material: THREE.LineBasicMaterial;
    coreLine: THREE.Line;
    coreGeometry: THREE.BufferGeometry;
    coreMaterial: THREE.LineBasicMaterial;
    startAt: number;
  }> = [];
  const angles = [Math.PI * 0.15, Math.PI * -0.2, Math.PI * 0.55];
  for (let i = 0; i < slashCount; i++) {
    const cx = targetRect.x + targetRect.width / 2;
    const cy = targetRect.y + targetRect.height / 2;
    const halfLen = Math.max(targetRect.width, targetRect.height) * 0.75;
    const angle = angles[i]!;
    const dx = Math.cos(angle) * halfLen;
    const dy = Math.sin(angle) * halfLen;
    const points = [new THREE.Vector3(cx - dx, cy - dy, 0), new THREE.Vector3(cx + dx, cy + dy, 0)];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xc8d0d8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    const coreGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const coreMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreLine = new THREE.Line(coreGeometry, coreMaterial);
    scene.add(coreLine);
    slashes.push({ line, geometry, material, coreLine, coreGeometry, coreMaterial, startAt: 120 + i * 180 });
  }

  const sparkCount = 30;
  const sparkPositions = new Float32Array(sparkCount * 3);
  const sparks: Array<{ vx: number; vy: number; age: number; life: number }> = [];
  for (let i = 0; i < sparkCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 120;
    sparks.push({ vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: Math.random() * 0.3, life: 0.4 + Math.random() * 0.3 });
    const cx = targetRect.x + targetRect.width / 2;
    const cy = targetRect.y + targetRect.height / 2;
    sparkPositions[i * 3] = cx;
    sparkPositions[i * 3 + 1] = cy;
    sparkPositions[i * 3 + 2] = 0;
  }
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  const sparkMaterial = new THREE.PointsMaterial({
    color: 0xffe0a8,
    size: 6,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: false,
  });
  const sparkPoints = new THREE.Points(sparkGeometry, sparkMaterial);
  scene.add(sparkPoints);

  let lastTickMs = 0;

  return {
    tick(elapsedMs, progress) {
      const dt = Math.min(0.05, (elapsedMs - lastTickMs) / 1000);
      lastTickMs = elapsedMs;
      const fade = 1 - Math.pow(progress, 1.5);
      for (const slash of slashes) {
        const slashElapsed = Math.max(0, elapsedMs - slash.startAt);
        const flashProgress = Math.min(1, slashElapsed / 260);
        const alpha = flashProgress * Math.max(0, 1 - (slashElapsed - 260) / 400) * fade;
        slash.material.opacity = alpha * 0.7;
        slash.coreMaterial.opacity = alpha;
      }
      const cx = targetRect.x + targetRect.width / 2;
      const cy = targetRect.y + targetRect.height / 2;
      for (let i = 0; i < sparkCount; i++) {
        const s = sparks[i]!;
        s.age += dt;
        if (s.age >= s.life) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 60 + Math.random() * 120;
          s.vx = Math.cos(angle) * speed;
          s.vy = Math.sin(angle) * speed;
          s.age = 0;
          s.life = 0.4 + Math.random() * 0.3;
          sparkPositions[i * 3] = cx;
          sparkPositions[i * 3 + 1] = cy;
        } else {
          sparkPositions[i * 3] = (sparkPositions[i * 3] ?? 0) + s.vx * dt;
          sparkPositions[i * 3 + 1] = (sparkPositions[i * 3 + 1] ?? 0) + s.vy * dt;
        }
      }
      sparkGeometry.attributes.position!.needsUpdate = true;
      const sparkGate = Math.max(0, Math.min(1, (progress - 0.15) / 0.15));
      sparkMaterial.opacity = fade * sparkGate * 0.9;
    },
    dispose() {
      for (const slash of slashes) {
        scene.remove(slash.line);
        scene.remove(slash.coreLine);
        slash.geometry.dispose();
        slash.material.dispose();
        slash.coreGeometry.dispose();
        slash.coreMaterial.dispose();
      }
      scene.remove(sparkPoints);
      sparkGeometry.dispose();
      sparkMaterial.dispose();
    },
  };
}

function buildWindRunner(scene: THREE.Scene, effect: AttackEffect): Runner {
  const { targetRect } = effect;
  const centerX = targetRect.x + targetRect.width / 2;
  const centerY = targetRect.y + targetRect.height / 2;
  const outerR = Math.max(targetRect.width, targetRect.height) * 0.65;
  const lines: THREE.Line[] = [];
  const materials: THREE.LineBasicMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const layerSpecs = [
    { color: 0xffffff, opacity: 0.95 },
    { color: 0xbef0ff, opacity: 0.65 },
    { color: 0x60b0e0, opacity: 0.35 },
  ];
  const arcCount = 5;

  function makeArcs(baseAngle: number, currentFade: number): void {
    disposeAll();
    for (let i = 0; i < arcCount; i++) {
      const start = baseAngle + (i / arcCount) * Math.PI * 2 + Math.random() * 0.15;
      const arcLen = Math.PI * (0.9 + Math.random() * 0.6);
      const points: THREE.Vector3[] = [];
      const stepCount = 32;
      for (let s = 0; s <= stepCount; s++) {
        const t = s / stepCount;
        const a = start + arcLen * t;
        const radius = outerR * (0.9 + Math.sin(t * Math.PI * 3) * 0.1 - t * 0.35);
        points.push(new THREE.Vector3(centerX + Math.cos(a) * radius, centerY + Math.sin(a) * radius, 0));
      }
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

  function disposeAll(): void {
    for (const line of lines) scene.remove(line);
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    lines.length = 0;
    geometries.length = 0;
    materials.length = 0;
  }

  const flickerMs = 80;
  let flickerAt = 0;
  let currentAngle = 0;

  return {
    tick(elapsedMs, progress) {
      const fade = 1 - Math.pow(progress, 1.4);
      currentAngle = (elapsedMs / 1000) * Math.PI * 2.5;
      if (elapsedMs - flickerAt >= flickerMs || lines.length === 0) {
        makeArcs(currentAngle, fade);
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

const LIGHT_LAYERS = [
  { colorCore: 0xffffff, colorMid: 0xfff2a8, colorEdge: 0xffb845, widthMul: 0.55, thicknessMul: 1.6 },
  { colorCore: 0xfff0c0, colorMid: 0xffce68, colorEdge: 0xd88020, widthMul: 1.0, thicknessMul: 1.15 },
  { colorCore: 0xffe08a, colorMid: 0xffa040, colorEdge: 0x603010, widthMul: 1.6, thicknessMul: 0.7 },
];

function buildLightRunner(scene: THREE.Scene, effect: AttackEffect): Runner {
  const { target, targetRect } = effect;
  const beamLength = target.y + 20;
  const midX = target.x;
  const midY = beamLength / 2;
  const baseWidth = Math.max(60, Math.min(targetRect.width, targetRect.height) * 0.9);

  const meshes: THREE.Mesh[] = [];
  const materials: THREE.ShaderMaterial[] = [];
  const geometries: THREE.PlaneGeometry[] = [];

  for (const layer of LIGHT_LAYERS) {
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
    mesh.rotation.z = Math.PI / 2;
    mesh.scale.set(beamLength, baseWidth * layer.widthMul, 1);
    scene.add(mesh);
    meshes.push(mesh);
    materials.push(material);
    geometries.push(geometry);
  }

  const rayCount = 12;
  const rayLines: THREE.Line[] = [];
  const rayGeometries: THREE.BufferGeometry[] = [];
  const rayMaterials: THREE.LineBasicMaterial[] = [];
  for (let i = 0; i < rayCount; i++) {
    const angle = (i / rayCount) * Math.PI * 2;
    const outerR = Math.max(targetRect.width, targetRect.height) * 0.9;
    const points = [
      new THREE.Vector3(target.x, target.y, 0),
      new THREE.Vector3(target.x + Math.cos(angle) * outerR, target.y + Math.sin(angle) * outerR, 0),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xffe89a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    rayLines.push(line);
    rayGeometries.push(geometry);
    rayMaterials.push(material);
  }

  return {
    tick(elapsedMs, progress) {
      const fade = 1 - Math.pow(progress, 1.5);
      const seconds = elapsedMs / 1000;
      const reachTime = Math.min(500, 200 + beamLength * 0.4);
      const reach = Math.min(1, elapsedMs / reachTime);
      for (const material of materials) {
        material.uniforms.uTime!.value = seconds;
        material.uniforms.uOpacity!.value = fade;
        material.uniforms.uReach!.value = reach;
      }
      const rayGate = Math.max(0, Math.min(1, (progress - 0.3) / 0.15));
      for (const rayMat of rayMaterials) rayMat.opacity = fade * rayGate * (0.6 + 0.4 * Math.sin(seconds * 8));
    },
    dispose() {
      for (const mesh of meshes) scene.remove(mesh);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const line of rayLines) scene.remove(line);
      for (const g of rayGeometries) g.dispose();
      for (const m of rayMaterials) m.dispose();
    },
  };
}

function buildDarkRunner(scene: THREE.Scene, effect: AttackEffect): Runner {
  const { targetRect } = effect;
  const layerSpecs = [
    { color: 0xe0c8ff, opacity: 1.0 },
    { color: 0x6020a0, opacity: 0.6 },
    { color: 0x1a0530, opacity: 0.35 },
  ];
  const lines: THREE.Line[] = [];
  const materials: THREE.LineBasicMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const flickerMs = 90;
  const boltMin = 5;
  const boltMax = 7;

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
      const points = darkTendrilPath(targetRect, i, count);
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
      const fade = 1 - Math.pow(progress, 1.4);
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

function darkTendrilPath(rect: Rect, boltIndex: number, boltCount: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const outerR = Math.max(rect.width, rect.height) * 0.75;
  const startAngle = ((boltIndex + 0.5) / boltCount) * Math.PI * 2 + Math.random() * 0.4;
  const startX = centerX + Math.cos(startAngle) * outerR;
  const startY = centerY + Math.sin(startAngle) * outerR + rect.height * 0.2;
  const controlX = centerX + (Math.random() - 0.5) * rect.width * 0.4;
  const controlY = centerY + rect.height * (Math.random() * 0.3);
  const endAngle = startAngle + Math.PI + (Math.random() - 0.5) * 0.6;
  const endX = centerX + Math.cos(endAngle) * outerR * 0.35;
  const endY = centerY + Math.sin(endAngle) * outerR * 0.35;
  const stepCount = 26;
  for (let i = 0; i <= stepCount; i++) {
    const t = i / stepCount;
    const u = 1 - t;
    const x = u * u * startX + 2 * u * t * controlX + t * t * endX + (Math.random() - 0.5) * 4;
    const y = u * u * startY + 2 * u * t * controlY + t * t * endY + (Math.random() - 0.5) * 4;
    points.push(new THREE.Vector3(x, y, 0));
  }
  return points;
}

function buildNullRunner(scene: THREE.Scene, effect: AttackEffect): Runner {
  const { target, targetRect } = effect;
  const maxR = Math.max(targetRect.width, targetRect.height) * 0.9;
  const ringCount = 3;
  const rings: Array<{
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    geometry: THREE.RingGeometry;
    delay: number;
  }> = [];
  for (let i = 0; i < ringCount; i++) {
    const geometry = new THREE.RingGeometry(0.48, 0.5, 64);
    const material = new THREE.MeshBasicMaterial({
      color: i === 0 ? 0xffffff : 0xd8d8e0,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(target.x, target.y, 0);
    scene.add(mesh);
    rings.push({ mesh, material, geometry, delay: i * 160 });
  }

  const centerGeometry = new THREE.CircleGeometry(1, 32);
  const centerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const center = new THREE.Mesh(centerGeometry, centerMaterial);
  center.position.set(target.x, target.y, 0);
  scene.add(center);

  return {
    tick(elapsedMs, progress) {
      const fade = 1 - Math.pow(progress, 1.4);
      for (const ring of rings) {
        const t = Math.max(0, Math.min(1, (elapsedMs - ring.delay) / 700));
        const eased = 1 - Math.pow(1 - t, 2);
        const radius = eased * maxR;
        ring.mesh.scale.set(radius, radius, 1);
        ring.material.opacity = (1 - t) * fade * 0.9;
      }
      const centerT = Math.min(1, elapsedMs / 300);
      const centerScale = (1 - centerT) * (targetRect.width * 0.35) + centerT * 4;
      center.scale.set(centerScale, centerScale, 1);
      centerMaterial.opacity = (1 - centerT) * fade * 0.95;
    },
    dispose() {
      for (const ring of rings) {
        scene.remove(ring.mesh);
        ring.geometry.dispose();
        ring.material.dispose();
      }
      scene.remove(center);
      centerGeometry.dispose();
      centerMaterial.dispose();
    },
  };
}
