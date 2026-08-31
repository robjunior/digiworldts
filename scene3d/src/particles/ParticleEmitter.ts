import * as THREE from "three";

import type {
  ParticleBlending,
  ParticleEmissionMode,
  ParticleEmitterConfig,
  ParticleGeometry,
  ParticleShaderKind,
  ParticleSpawn,
  Vec3Range,
} from "@digiworld/shared/weather";

import {
  createDefaultParticleMaterial,
  createHailShardMaterial,
  createRainStreakMaterial,
  createSandHazeMaterial,
  createSnowFlakeMaterial,
  createThunderCoreMaterial,
  createWetSparkMaterial,
  createEmitterMaterial,
  attachUpdater,
} from "./shaders.js";

/**
 * Attribute name map. Removes the per-attribute ternary chain that previously
 * lived in the constructor loop and keeps the on-GPU attribute name next to the
 * buffer that feeds it.
 */
const ATTRIBUTE_NAMES = {
  startColor: "aStartColor",
  endColor: "aEndColor",
  startSize: "aStartSize",
  endSize: "aEndSize",
  startOpacity: "aStartOpacity",
  endOpacity: "aEndOpacity",
  lifeProgress: "aLifeProgress",
  velocity: "aVelocity",
} as const;

/**
 * Shared constants for the emitter's fixed-world assumptions and clamping.
 * Centralised so magic numbers stop appearing inline in tick()/spawn().
 */
const CONFIG = {
  GROUND_Y: 0,
  GROUND_FRICTION: 0.7,
  MIN_CAPACITY: 1,
  MAX_CAPACITY: 10000,
  MIN_BURST: 1,
  DEFAULT_BURST: 20,
  DEFAULT_BOUNCINESS: 0,
  DEFAULT_OPACITY_MULT: 1.0,
  HIDDEN_Y: -1000,
} as const;

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
  private readonly hiddenPos = new THREE.Vector3(0, CONFIG.HIDDEN_Y, 0);

  private readonly cameraTargetXZ = new THREE.Vector2();
  private cameraRef: THREE.Camera | null = null;

  private disposed = false;
  private elapsedS = 0;
  private opacityMultiplier = 1;

  private readonly emissionMode: ParticleEmissionMode;
  private readonly burstCount: number;
  private readonly totalLifetimeS: number | null;
  private burstFired = false;

  private readonly spawnCenterOverride = new THREE.Vector3();
  private useSpawnOverride = false;

  constructor(scene: THREE.Scene, config: ParticleEmitterConfig) {
    this.scene = scene;
    this.config = config;

    // Clamp capacity — combat-only rendering budget.
    this.capacity = Math.min(
      Math.max(CONFIG.MIN_CAPACITY, config.maxParticles),
      CONFIG.MAX_CAPACITY,
    );

    this.emissionMode = config.emissionMode ?? "continuous";
    this.burstCount = Math.min(
      Math.max(CONFIG.MIN_BURST, config.burstCount ?? CONFIG.DEFAULT_BURST),
      this.capacity,
    );
    this.totalLifetimeS =
      config.totalLifetimeMs !== undefined
        ? config.totalLifetimeMs / 1000
        : null;

    const geometry = buildInstanceGeometry(config.geometry);
    // Material is cached by shader/opts signature so a repeated skill cast never
    // reallocates a ShaderMaterial or recompiles GLSL on the attack frame.
    const material = createEmitterMaterial(
      config.shader ?? "default",
      buildMaterialOpts(config),
    );
    this.mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = config.castShadow === true;

    this.ages = new Float32Array(this.capacity);
    this.lifetimes = new Float32Array(this.capacity);
    this.positions = new Float32Array(this.capacity * 3);
    this.velocities = new Float32Array(this.capacity * 3);
    this.rotationSpeeds = new Float32Array(this.capacity);

    this.aStartColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity * 3),
      3,
    );
    this.aEndColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity * 3),
      3,
    );
    this.aStartSize = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity),
      1,
    );
    this.aEndSize = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity),
      1,
    );
    this.aStartOpacity = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity),
      1,
    );
    this.aEndOpacity = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity),
      1,
    );
    this.aLifeProgress = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity),
      1,
    );
    this.aVelocity = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity * 3),
      3,
    );
    // Single attribute table: name + buffer. Replaces the per-attribute ternary
    // chain that previously lived inline in this loop.
    const attributes: ReadonlyArray<{
      readonly name: string;
      readonly attr: THREE.InstancedBufferAttribute;
    }> = [
      { name: ATTRIBUTE_NAMES.startColor, attr: this.aStartColor },
      { name: ATTRIBUTE_NAMES.endColor, attr: this.aEndColor },
      { name: ATTRIBUTE_NAMES.startSize, attr: this.aStartSize },
      { name: ATTRIBUTE_NAMES.endSize, attr: this.aEndSize },
      { name: ATTRIBUTE_NAMES.startOpacity, attr: this.aStartOpacity },
      { name: ATTRIBUTE_NAMES.endOpacity, attr: this.aEndOpacity },
      { name: ATTRIBUTE_NAMES.lifeProgress, attr: this.aLifeProgress },
      { name: ATTRIBUTE_NAMES.velocity, attr: this.aVelocity },
    ];
    for (const { name, attr } of attributes) {
      attr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attr);
    }

    // Hide every instance until spawn touches it.
    for (let i = 0; i < this.capacity; i += 1) {
      this.ages[i] = -1;
      this.lifetimes[i] = 0;
      this.hideInstance(i);
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

  /**
   * Override the spawn's world-space center for NEW particles only. Existing
   * particles continue their own integration in world space (so a projectile
   * emitter leaves a trail behind as the runner moves the center along a path).
   * Called by preset runner each tick for slots with `followTrajectory: true`.
   */
  setSpawnCenter(x: number, y: number, z: number): void {
    this.spawnCenterOverride.set(x, y, z);
    this.useSpawnOverride = true;
  }

  tick(dtS: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(dtS) || dtS <= 0) return;
    this.elapsedS += dtS;

    if (
      this.emissionMode === "oneshot" &&
      this.totalLifetimeS !== null &&
      this.elapsedS >= this.totalLifetimeS
    ) {
      this.dispose();
      return;
    }
    const cfg = this.config;

    if (this.cameraRef !== null && cfg.spawn.followCamera === true) {
      this.cameraTargetXZ.set(
        this.cameraRef.position.x,
        this.cameraRef.position.z,
      );
    }

    // Emission accumulator — mode-dependent.
    //   continuous: steady stream from emissionRate.
    //   burst / oneshot: spawn burstCount at t=0, zero after that.
    const spawnBudget = this.calculateSpawnBudget(dtS);

    this.updateAllParticles(spawnBudget, dtS, cfg);

    // Mark GPU buffers for update.
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aLifeProgress.needsUpdate = true;
    this.aVelocity.needsUpdate = true;
  }

  private calculateSpawnBudget(dtS: number): number {
    if (this.emissionMode === "continuous") {
      this.emissionAcc.value += this.config.emissionRate * dtS;
      const budget = Math.floor(this.emissionAcc.value);
      this.emissionAcc.value -= budget;
      return budget;
    }
    if (!this.burstFired) {
      this.burstFired = true;
      return this.burstCount;
    }
    return 0;
  }

  private updateAllParticles(
    spawnBudget: number,
    dtS: number,
    cfg: ParticleEmitterConfig,
  ): void {
    let toSpawn = spawnBudget;
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.ages[i]! < 0) {
        if (toSpawn > 0) {
          this.spawn(i);
          toSpawn -= 1;
        }
        // Dead and no spawn budget: nothing to integrate this frame.
        continue;
      }
      this.updateParticle(i, dtS, cfg);
    }
  }

  private updateParticle(
    i: number,
    dtS: number,
    cfg: ParticleEmitterConfig,
  ): void {
    const life = this.lifetimes[i]!;
    this.ages[i] = this.ages[i]! + dtS;
    const age = this.ages[i]!;
    if (age >= life) {
      this.ages[i] = -1;
      this.hideInstance(i);
      return;
    }
    this.aLifeProgress.array[i] = age / life;

    this.updateParticlePhysics(i, dtS, cfg);
    this.updateParticleMatrix(i);
  }

  private updateParticlePhysics(
    i: number,
    dtS: number,
    cfg: ParticleEmitterConfig,
  ): void {
    const vx = i * 3;
    const px = i * 3;

    this.integrateVelocity(vx, dtS, cfg);
    this.integratePosition(px, vx, dtS);

    if (cfg.collideGround === true) {
      this.handleGroundCollision(
        i,
        vx,
        px,
        cfg.bounciness ?? CONFIG.DEFAULT_BOUNCINESS,
      );
    }

    this.aVelocity.array[vx] = this.velocities[vx]!;
    this.aVelocity.array[vx + 1] = this.velocities[vx + 1]!;
    this.aVelocity.array[vx + 2] = this.velocities[vx + 2]!;
  }

  private integrateVelocity(
    vx: number,
    dtS: number,
    cfg: ParticleEmitterConfig,
  ): void {
    const drag = 1 - Math.min(1, cfg.drag * dtS);
    const gx = cfg.gravity[0] + cfg.wind[0];
    const gy = cfg.gravity[1] + cfg.wind[1];
    const gz = cfg.gravity[2] + cfg.wind[2];

    this.velocities[vx] = (this.velocities[vx]! + gx * dtS) * drag;
    this.velocities[vx + 1] = (this.velocities[vx + 1]! + gy * dtS) * drag;
    this.velocities[vx + 2] = (this.velocities[vx + 2]! + gz * dtS) * drag;
  }

  private integratePosition(px: number, vx: number, dtS: number): void {
    this.positions[px] = this.positions[px]! + this.velocities[vx]! * dtS;
    this.positions[px + 1] =
      this.positions[px + 1]! + this.velocities[vx + 1]! * dtS;
    this.positions[px + 2] =
      this.positions[px + 2]! + this.velocities[vx + 2]! * dtS;
  }

  private handleGroundCollision(
    i: number,
    vx: number,
    px: number,
    bounce: number,
  ): void {
    if (this.positions[px + 1]! >= CONFIG.GROUND_Y) return;

    this.positions[px + 1] = CONFIG.GROUND_Y;

    if (bounce > 0 && this.velocities[vx + 1]! < 0) {
      this.velocities[vx + 1] = -this.velocities[vx + 1]! * bounce;
      this.velocities[vx] = this.velocities[vx]! * CONFIG.GROUND_FRICTION;
      this.velocities[vx + 2] =
        this.velocities[vx + 2]! * CONFIG.GROUND_FRICTION;
    } else {
      // Kill on contact when no bounce.
      this.ages[i] = this.lifetimes[i]!;
    }
  }

  private updateParticleMatrix(i: number): void {
    const px = i * 3;
    const progress = this.aLifeProgress.array[i]!;
    const startSize = this.aStartSize.array[i]!;
    const endSize = this.aEndSize.array[i]!;
    const size = startSize + (endSize - startSize) * progress;
    const rot = this.rotationSpeeds[i]! * this.ages[i]!;

    this.posVec.set(
      this.positions[px]!,
      this.positions[px + 1]!,
      this.positions[px + 2]!,
    );
    this.quat.setFromAxisAngle(AXIS_Y, rot);
    this.scaleVec.setScalar(size);
    this.matrix.compose(this.posVec, this.quat, this.scaleVec);
    this.mesh.setMatrixAt(i, this.matrix);
  }

  private spawn(i: number): void {
    const cfg = this.config;
    const [lifeMin, lifeMax] = cfg.lifetimeMs;
    this.lifetimes[i] = (lifeMin + Math.random() * (lifeMax - lifeMin)) / 1000;
    this.ages[i] = 0;

    this.spawnPosition(i);
    this.spawnVelocity(i);
    this.spawnVisuals(i);
  }

  private spawnPosition(i: number): void {
    const cfg = this.config;
    const px = i * 3;
    samplePosition(
      cfg.spawn,
      this.posVec,
      this.cameraTargetXZ,
      cfg.spawn.followCamera === true,
    );
    if (this.useSpawnOverride) {
      this.posVec.x += this.spawnCenterOverride.x - cfg.spawn.center[0];
      this.posVec.y += this.spawnCenterOverride.y - cfg.spawn.center[1];
      this.posVec.z += this.spawnCenterOverride.z - cfg.spawn.center[2];
    }
    this.positions[px] = this.posVec.x;
    this.positions[px + 1] = this.posVec.y;
    this.positions[px + 2] = this.posVec.z;
  }

  private spawnVelocity(i: number): void {
    const [vx0, vx1, vx2] = sampleVec3(this.config.velocity);
    const vx = i * 3;
    this.velocities[vx] = vx0;
    this.velocities[vx + 1] = vx1;
    this.velocities[vx + 2] = vx2;
  }

  private spawnVisuals(i: number): void {
    const cfg = this.config;
    setHexToVec3(cfg.startColor, this.aStartColor.array, i * 3);
    setHexToVec3(cfg.endColor, this.aEndColor.array, i * 3);

    const [sMin, sMax] = cfg.startSize;
    const [eMin, eMax] = cfg.endSize;
    this.aStartSize.array[i] = sMin + Math.random() * (sMax - sMin);
    this.aEndSize.array[i] = eMin + Math.random() * (eMax - eMin);
    this.aStartOpacity.array[i] = cfg.startOpacity;
    this.aEndOpacity.array[i] = cfg.endOpacity;
    this.aLifeProgress.array[i] = 0;

    if (cfg.rotationSpeed !== undefined) {
      const [rMin, rMax] = cfg.rotationSpeed;
      this.rotationSpeeds[i] = rMin + Math.random() * (rMax - rMin);
    } else {
      this.rotationSpeeds[i] = 0;
    }

    // Batch update flags — all of these changed for this newly-spawned instance.
    this.aStartColor.needsUpdate = true;
    this.aEndColor.needsUpdate = true;
    this.aStartSize.needsUpdate = true;
    this.aEndSize.needsUpdate = true;
    this.aStartOpacity.needsUpdate = true;
    this.aEndOpacity.needsUpdate = true;
  }

  private hideInstance(i: number): void {
    this.scaleVec.set(0, 0, 0);
    this.matrix.compose(this.hiddenPos, this.quat.identity(), this.scaleVec);
    this.mesh.setMatrixAt(i, this.matrix);
  }

  /**
   * Debug/telemetry snapshot of live particle counts and the emission
   * accumulator. Cheap: one linear scan over capacity.
   */
  getParticleStats(): {
    alive: number;
    dead: number;
    spawnBudgetAccum: number;
  } {
    let alive = 0;
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.ages[i]! >= 0) alive += 1;
    }
    return {
      alive,
      dead: this.capacity - alive,
      spawnBudgetAccum: this.emissionAcc.value,
    };
  }

  /**
   * True when a one-shot emitter has run to completion. Continuous emitters
   * return false forever. Preset runner polls this each tick to know when to
   * dispose the emitter and remove it from its slot list.
   */
  hasFinished(): boolean {
    if (this.disposed) return true;
    if (this.emissionMode === "continuous") return false;
    if (this.totalLifetimeS !== null && this.elapsedS >= this.totalLifetimeS) {
      // Only finished once every particle has died.
      return this.allParticlesDead();
    }
    return !this.burstFired;
  }

  private allParticlesDead(): boolean {
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.ages[i]! >= 0) return false;
    }
    return true;
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
    case "sphere":
      return new THREE.SphereGeometry(0.5, 8, 6);
    case "cube":
      return new THREE.BoxGeometry(0.6, 0.6, 0.6);
    case "streak":
    case "plane":
    case "quad":
    default:
      return new THREE.PlaneGeometry(1, 1, 1, 1);
  }
}

function buildMaterialOpts(cfg: ParticleEmitterConfig): ParticleMaterialOpts {
  return {
    color: cfg.startColor,
    opacity: cfg.startOpacity,
    blending: cfg.blending as ParticleBlending,
    softParticles: cfg.softParticles === true,
    textureUrl: cfg.textureUrl ?? null,
  };
}

type ParticleMaterialOpts = {
  color: number;
  opacity: number;
  blending: ParticleBlending;
  softParticles?: boolean;
  textureUrl?: string | null;
  envMap?: THREE.Texture | null;
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
    case "point":
      break;
    case "box":
      x = (Math.random() * 2 - 1) * sx;
      y = (Math.random() * 2 - 1) * sy;
      z = (Math.random() * 2 - 1) * sz;
      break;
    case "disc": {
      const r = Math.sqrt(Math.random()) * sx;
      const a = Math.random() * Math.PI * 2;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      y = (Math.random() * 2 - 1) * sy;
      break;
    }
    case "sphere": {
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
    case "cone": {
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

function setHexToVec3(
  hex: number,
  arr: ArrayLike<number> & { [i: number]: number },
  offset: number,
): void {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  arr[offset] = r;
  arr[offset + 1] = g;
  arr[offset + 2] = b;
}
