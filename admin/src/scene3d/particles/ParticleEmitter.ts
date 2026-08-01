import * as THREE from 'three';

import type {
  ParticleBlending,
  ParticleEmitterConfig,
  ParticleGeometry,
  ParticleShaderKind,
  ParticleSpawn,
  Vec3Range,
} from '@digiworld/shared/weather';

import {
  createDefaultParticleMaterial,
  createHailShardMaterial,
  createRainStreakMaterial,
  createSandHazeMaterial,
  createSnowFlakeMaterial,
  createThunderCoreMaterial,
  createWetSparkMaterial,
  attachUpdater,
} from './shaders.js';

/**
 * Generic InstancedMesh-based particle emitter driven by a
 * ParticleEmitterConfig. One instance maps to one config; the SceneManager
 * owns a Map<emitterId, ParticleEmitter> for the active weather + custom FX.
 *
 * All allocation happens at construction time. tick(dt) is zero-alloc.
 */
export class ParticleEmitter {
  readonly config: ParticleEmitterConfig;
  readonly mesh: THREE.InstancedMesh;

  private readonly scene: THREE.Scene;
  private readonly capacity: number;
  private readonly emissionAcc: { value: number } = { value: 0 };

  private readonly ages: Float32Array;
  private readonly lifetimes: Float32Array;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly rotationSpeeds: Float32Array;
  private readonly aStartColor: THREE.InstancedBufferAttribute;
  private readonly aEndColor: THREE.InstancedBufferAttribute;
  private readonly aStartSize: THREE.InstancedBufferAttribute;
  private readonly aEndSize: THREE.InstancedBufferAttribute;
  private readonly aStartOpacity: THREE.InstancedBufferAttribute;
  private readonly aEndOpacity: THREE.InstancedBufferAttribute;
  private readonly aLifeProgress: THREE.InstancedBufferAttribute;
  private readonly aVelocity: THREE.InstancedBufferAttribute;

  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly scaleVec = new THREE.Vector3();
  private readonly posVec = new THREE.Vector3();

  private readonly cameraTargetXZ = new THREE.Vector2();
  private cameraRef: THREE.Camera | null = null;

  private disposed = false;
  private elapsedS = 0;
  private opacityMultiplier = 1;

  constructor(scene: THREE.Scene, config: ParticleEmitterConfig) {
    this.scene = scene;
    this.config = config;

    // Clamp capacity — combat-only rendering budget.
    this.capacity = Math.min(Math.max(1, config.maxParticles), 10000);

    const geometry = buildInstanceGeometry(config.geometry);
    const material = buildMaterial(config, this.elapsedS);
    this.mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = config.castShadow === true;

    this.ages = new Float32Array(this.capacity);
    this.lifetimes = new Float32Array(this.capacity);
    this.positions = new Float32Array(this.capacity * 3);
    this.velocities = new Float32Array(this.capacity * 3);
    this.rotationSpeeds = new Float32Array(this.capacity);

    this.aStartColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    this.aEndColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    this.aStartSize = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.aEndSize = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.aStartOpacity = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.aEndOpacity = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.aLifeProgress = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.aVelocity = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    for (const attr of [
      this.aStartColor,
      this.aEndColor,
      this.aStartSize,
      this.aEndSize,
      this.aStartOpacity,
      this.aEndOpacity,
      this.aLifeProgress,
      this.aVelocity,
    ]) {
      attr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(attr === this.aStartColor ? 'aStartColor' : attr === this.aEndColor ? 'aEndColor' : attr === this.aStartSize ? 'aStartSize' : attr === this.aEndSize ? 'aEndSize' : attr === this.aStartOpacity ? 'aStartOpacity' : attr === this.aEndOpacity ? 'aEndOpacity' : attr === this.aLifeProgress ? 'aLifeProgress' : 'aVelocity', attr);
    }

    // Hide every instance until spawn touches it.
    for (let i = 0; i < this.capacity; i += 1) {
      this.ages[i] = -1;
      this.lifetimes[i] = 0;
      this.scaleVec.set(0, 0, 0);
      this.matrix.compose(this.posVec.set(0, -1000, 0), this.quat.identity(), this.scaleVec);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    attachUpdater(material, (_dt, elapsed) => {
      this.elapsedS = elapsed;
    });

    scene.add(this.mesh);
  }

  setCameraReference(camera: THREE.Camera | null): void {
    this.cameraRef = camera;
  }

  /** External opacity fader for weather crossfade. Values are multiplied into the shader's aEndOpacity path. */
  setOpacityMultiplier(mult: number): void {
    this.opacityMultiplier = Math.max(0, Math.min(1, mult));
    const mat = this.mesh.material as THREE.ShaderMaterial;
    if (mat.uniforms.uOpacityMult !== undefined) {
      mat.uniforms.uOpacityMult.value = this.opacityMultiplier;
    }
  }

  tick(dtS: number): void {
    if (this.disposed) return;
    this.elapsedS += dtS;
    const cfg = this.config;

    if (this.cameraRef !== null && cfg.spawn.followCamera === true) {
      this.cameraTargetXZ.set(this.cameraRef.position.x, this.cameraRef.position.z);
    }

    // Emission accumulator (particles per second → this frame's spawn count).
    this.emissionAcc.value += cfg.emissionRate * dtS;
    let spawnBudget = Math.floor(this.emissionAcc.value);
    this.emissionAcc.value -= spawnBudget;

    const gravity = cfg.gravity;
    const wind = cfg.wind;
    const drag = 1 - Math.min(1, cfg.drag * dtS);
    const groundY = 0;
    const bounce = cfg.bounciness ?? 0;

    for (let i = 0; i < this.capacity; i += 1) {
      const alive = this.ages[i]! >= 0;
      if (!alive) {
        if (spawnBudget > 0) {
          this.spawn(i);
          spawnBudget -= 1;
        } else {
          continue;
        }
      }

      const life = this.lifetimes[i]!;
      this.ages[i] = this.ages[i]! + dtS;
      const age = this.ages[i]!;
      if (age >= life) {
        this.ages[i] = -1;
        this.hideInstance(i);
        continue;
      }
      const progress = age / life;
      this.aLifeProgress.array[i] = progress;

      const px = i * 3;
      const vx = i * 3;

      // Integrate velocity → position with gravity + wind + drag.
      this.velocities[vx] = (this.velocities[vx]! + (gravity[0] + wind[0]) * dtS) * drag;
      this.velocities[vx + 1] = (this.velocities[vx + 1]! + (gravity[1] + wind[1]) * dtS) * drag;
      this.velocities[vx + 2] = (this.velocities[vx + 2]! + (gravity[2] + wind[2]) * dtS) * drag;

      this.positions[px] = this.positions[px]! + this.velocities[vx]! * dtS;
      this.positions[px + 1] = this.positions[px + 1]! + this.velocities[vx + 1]! * dtS;
      this.positions[px + 2] = this.positions[px + 2]! + this.velocities[vx + 2]! * dtS;

      // Ground collision + bounce (hail).
      if (cfg.collideGround === true && this.positions[px + 1]! < groundY) {
        this.positions[px + 1] = groundY;
        if (bounce > 0 && this.velocities[vx + 1]! < 0) {
          this.velocities[vx + 1] = -this.velocities[vx + 1]! * bounce;
          this.velocities[vx] = this.velocities[vx]! * 0.7;
          this.velocities[vx + 2] = this.velocities[vx + 2]! * 0.7;
        } else {
          // Kill on contact when no bounce.
          this.ages[i] = life;
        }
      }

      this.aVelocity.array[vx] = this.velocities[vx]!;
      this.aVelocity.array[vx + 1] = this.velocities[vx + 1]!;
      this.aVelocity.array[vx + 2] = this.velocities[vx + 2]!;

      // Interpolate size for matrix scale.
      const startSize = this.aStartSize.array[i]!;
      const endSize = this.aEndSize.array[i]!;
      const size = startSize + (endSize - startSize) * progress;
      const rot = this.rotationSpeeds[i]! * age;

      this.posVec.set(this.positions[px]!, this.positions[px + 1]!, this.positions[px + 2]!);
      this.quat.setFromAxisAngle(AXIS_Y, rot);
      this.scaleVec.setScalar(size);
      this.matrix.compose(this.posVec, this.quat, this.scaleVec);
      this.mesh.setMatrixAt(i, this.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    this.aLifeProgress.needsUpdate = true;
    this.aVelocity.needsUpdate = true;
  }

  private spawn(i: number): void {
    const cfg = this.config;
    const [lifeMin, lifeMax] = cfg.lifetimeMs;
    this.lifetimes[i] = (lifeMin + Math.random() * (lifeMax - lifeMin)) / 1000;
    this.ages[i] = 0;

    // Position — sample spawn shape.
    const px = i * 3;
    samplePosition(cfg.spawn, this.posVec, this.cameraTargetXZ, cfg.spawn.followCamera === true);
    this.positions[px] = this.posVec.x;
    this.positions[px + 1] = this.posVec.y;
    this.positions[px + 2] = this.posVec.z;

    // Velocity — base ± variance.
    const v = sampleVec3(cfg.velocity);
    const vx = i * 3;
    this.velocities[vx] = v[0];
    this.velocities[vx + 1] = v[1];
    this.velocities[vx + 2] = v[2];

    // Per-instance visual attributes.
    setHexToVec3(cfg.startColor, this.aStartColor.array, i * 3);
    setHexToVec3(cfg.endColor, this.aEndColor.array, i * 3);
    const [sMin, sMax] = cfg.startSize;
    const [eMin, eMax] = cfg.endSize;
    this.aStartSize.array[i] = sMin + Math.random() * (sMax - sMin);
    this.aEndSize.array[i] = eMin + Math.random() * (eMax - eMin);
    this.aStartOpacity.array[i] = cfg.startOpacity;
    this.aEndOpacity.array[i] = cfg.endOpacity;
    this.aLifeProgress.array[i] = 0;

    // Rotation speed per particle (rad/s).
    if (cfg.rotationSpeed !== undefined) {
      const [rMin, rMax] = cfg.rotationSpeed;
      this.rotationSpeeds[i] = rMin + Math.random() * (rMax - rMin);
    } else {
      this.rotationSpeeds[i] = 0;
    }

    this.aStartColor.needsUpdate = true;
    this.aEndColor.needsUpdate = true;
    this.aStartSize.needsUpdate = true;
    this.aEndSize.needsUpdate = true;
    this.aStartOpacity.needsUpdate = true;
    this.aEndOpacity.needsUpdate = true;
  }

  private hideInstance(i: number): void {
    this.scaleVec.set(0, 0, 0);
    this.matrix.compose(this.posVec.set(0, -1000, 0), this.quat.identity(), this.scaleVec);
    this.mesh.setMatrixAt(i, this.matrix);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    const mat = this.mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat.dispose();
  }
}

const AXIS_Y = new THREE.Vector3(0, 1, 0);

function buildInstanceGeometry(kind: ParticleGeometry): THREE.BufferGeometry {
  switch (kind) {
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 8, 6);
    case 'cube':
      return new THREE.BoxGeometry(0.6, 0.6, 0.6);
    case 'streak':
    case 'plane':
    case 'quad':
    default:
      return new THREE.PlaneGeometry(1, 1, 1, 1);
  }
}

function buildMaterial(cfg: ParticleEmitterConfig, elapsedS: number): THREE.ShaderMaterial {
  const opts = {
    color: cfg.startColor,
    opacity: cfg.startOpacity,
    blending: cfg.blending as ParticleBlending,
    softParticles: cfg.softParticles === true,
    textureUrl: cfg.textureUrl ?? null,
  };
  const kind: ParticleShaderKind = cfg.shader;
  const factory = SHADER_FACTORIES[kind];
  const material = factory(opts);
  if (material.uniforms.uTime !== undefined) {
    material.uniforms.uTime.value = elapsedS;
  }
  if (material.uniforms.uOpacityMult === undefined) {
    material.uniforms.uOpacityMult = { value: 1.0 };
  }
  return material;
}

const SHADER_FACTORIES: Record<ParticleShaderKind, (opts: ShaderFactoryOpts) => THREE.ShaderMaterial> = {
  default: createDefaultParticleMaterial,
  rainStreak: createRainStreakMaterial,
  wetSpark: createWetSparkMaterial,
  sandHaze: createSandHazeMaterial,
  thunderCore: createThunderCoreMaterial,
  snowFlake: createSnowFlakeMaterial,
  hailShard: createHailShardMaterial,
};

type ShaderFactoryOpts = {
  color: number;
  opacity: number;
  blending: ParticleBlending;
  softParticles?: boolean;
  textureUrl?: string | null;
};

function sampleVec3(range: Vec3Range): [number, number, number] {
  const [bx, by, bz] = range.base;
  const [vx, vy, vz] = range.variance;
  return [
    bx + (Math.random() * 2 - 1) * vx,
    by + (Math.random() * 2 - 1) * vy,
    bz + (Math.random() * 2 - 1) * vz,
  ];
}

function samplePosition(
  spawn: ParticleSpawn,
  out: THREE.Vector3,
  cameraXZ: THREE.Vector2,
  followCamera: boolean,
): void {
  const [sx, sy, sz] = spawn.size;
  const [cx, cy, cz] = spawn.center;
  let x = 0;
  let y = 0;
  let z = 0;
  switch (spawn.shape) {
    case 'point':
      break;
    case 'box':
      x = (Math.random() * 2 - 1) * sx;
      y = (Math.random() * 2 - 1) * sy;
      z = (Math.random() * 2 - 1) * sz;
      break;
    case 'disc': {
      const r = Math.sqrt(Math.random()) * sx;
      const a = Math.random() * Math.PI * 2;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      y = (Math.random() * 2 - 1) * sy;
      break;
    }
    case 'sphere': {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = Math.cbrt(Math.random()) * sx;
      x = r * Math.sin(phi) * Math.cos(theta);
      y = r * Math.sin(phi) * Math.sin(theta);
      z = r * Math.cos(phi);
      break;
    }
    case 'cone': {
      const r = Math.sqrt(Math.random()) * sx;
      const a = Math.random() * Math.PI * 2;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      y = Math.random() * sy;
      break;
    }
  }
  if (followCamera) {
    x += cameraXZ.x;
    z += cameraXZ.y;
  }
  out.set(x + cx, y + cy, z + cz);
}

function setHexToVec3(hex: number, arr: ArrayLike<number> & { [i: number]: number }, offset: number): void {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  arr[offset] = r;
  arr[offset + 1] = g;
  arr[offset + 2] = b;
}
