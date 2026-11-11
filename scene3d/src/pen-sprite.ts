import * as THREE from 'three';
import { SpriteRig } from './sprite-rig';

const MIN_HORIZONTAL_DELTA_TO_FLIP_FACING = 0.05;
const EVOLVE_PUFF_MS = 800;
const EVOLVE_PUFF_RING_START = 0.35;
const EVOLVE_PUFF_RING_END = 2.4;
const EXIT_MARGIN = 3;
const EXIT_COMPLETE_MARGIN = 1;

export class PenSpriteRig {
  readonly sprite: SpriteRig;
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  
  private readonly scene: THREE.Scene;
  private targetX: number;
  private targetZ: number;
  private nextTargetAtS: number = 0;
  private speed: number = 1.0;
  private exiting = false;
  
  private isSquishing = false;
  private squishT = 0;
  
  private isSpinning = false;
  private spinT = 0;
  private baseRotY = 0;

  private puffRing: THREE.Mesh | null = null;
  private puffT = 0;

  constructor(
    scene: THREE.Scene,
    public readonly monId: string,
    textureUrl: string,
    initialX: number,
    initialZ: number,
    bounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
  ) {
    this.scene = scene;
    this.bounds = bounds ?? { minX: -4, maxX: 4, minZ: -3, maxZ: 3 };
    this.targetX = initialX;
    this.targetZ = initialZ;
    
    this.sprite = new SpriteRig(scene, {
      unitId: monId,
      side: 'opp',
      slotIndex: 1,
      textureUrl,
      isSpritesheet: true,
    });
    this.setWorldXZ(initialX, initialZ);
  }

  get mesh(): THREE.Mesh {
    return this.sprite.mesh;
  }

  getWorldPosition(): THREE.Vector3 {
    return this.sprite.worldPosition;
  }

  setTextureUrl(url: string): void {
    this.sprite.setTextureUrl(url);
  }

  setWorldXZ(x: number, z: number): void {
    const cx = THREE.MathUtils.clamp(x, this.bounds.minX, this.bounds.maxX);
    const cz = THREE.MathUtils.clamp(z, this.bounds.minZ, this.bounds.maxZ);
    this.sprite.setBasePosition(cx, cz);
    this.targetX = cx;
    this.targetZ = cz;
  }

  startExit(): void {
    if (this.exiting) return;
    this.exiting = true;
    this.targetX = this.bounds.maxX + EXIT_MARGIN;
    this.targetZ = this.sprite.worldPosition.z;
  }

  hasExited(): boolean {
    return this.exiting && this.sprite.worldPosition.x >= this.bounds.maxX + EXIT_COMPLETE_MARGIN;
  }

  isExiting(): boolean {
    return this.exiting;
  }

  playSquish(): void {
    this.isSquishing = true;
    this.squishT = 0;
  }

  playSpin(): void {
    this.isSpinning = true;
    this.spinT = 0;
    this.baseRotY = this.sprite.mesh.rotation.y;
  }

  playEvolvePuff(): void {
    if (this.puffRing !== null) {
      this.scene.remove(this.puffRing);
      this.puffRing.geometry.dispose();
      (this.puffRing.material as THREE.Material).dispose();
    }
    const geometry = new THREE.RingGeometry(0.9, 1.0, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0xfff4a3,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    const pos = this.sprite.worldPosition;
    ring.position.set(pos.x, 0.05, pos.z);
    ring.scale.setScalar(EVOLVE_PUFF_RING_START);
    this.scene.add(ring);
    this.puffRing = ring;
    this.puffT = 0;
    this.sprite.illuminate(0xfff4a3, 1.4, 3.2);
  }

  update(dt: number, elapsedS: number, cameraQuat: THREE.Quaternion): void {
    // Wander AI
    const pos = this.sprite.worldPosition;
    const dx = this.targetX - pos.x;
    const dz = this.targetZ - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (this.exiting) {
      if (dist > 0.01) {
        const move = Math.min(this.speed * dt, dist);
        const nx = pos.x + (dx / dist) * move;
        const nz = pos.z + (dz / dist) * move;
        this.sprite.setBasePosition(nx, nz);
        this.sprite.setFacingDirection(-1);
        this.sprite.setMoving(true);
      } else {
        this.sprite.setMoving(false);
      }
    } else if (dist < 0.2 || elapsedS >= this.nextTargetAtS) {
      this.targetX = this.bounds.minX + Math.random() * (this.bounds.maxX - this.bounds.minX);
      this.targetZ = this.bounds.minZ + Math.random() * (this.bounds.maxZ - this.bounds.minZ);
      this.nextTargetAtS = elapsedS + 3 + Math.random() * 3;
    } else {
      const move = Math.min(this.speed * dt, dist);
      const nx = pos.x + (dx / dist) * move;
      const nz = pos.z + (dz / dist) * move;
      this.sprite.setBasePosition(nx, nz);
      this.sprite.setMoving(true);
      if (Math.abs(dx) > MIN_HORIZONTAL_DELTA_TO_FLIP_FACING) {
        this.sprite.setFacingDirection(dx > 0 ? -1 : 1);
      }
    }

    // Call underlying sprite rig to update (handles GIF loading, base transforms)
    this.sprite.update(dt, elapsedS, cameraQuat);

    // Apply squish/spin overrides
    if (this.isSquishing) {
      this.squishT += dt * 1000;
      if (this.squishT >= 300) {
        this.isSquishing = false;
        // Restored to (1,1,1) scaling from SpriteRig's inner update next frame
      } else {
        const p = this.squishT / 300;
        const e = 1 - Math.pow(1 - p, 3);
        const sx = 1.3 - 0.3 * e;
        const sy = 0.7 + 0.3 * e;
        const sz = 1.3 - 0.3 * e;
        
        this.sprite.mesh.scale.x *= sx;
        this.sprite.mesh.scale.y *= sy;
        this.sprite.mesh.scale.z *= sz;
      }
    }
    
    if (this.isSpinning) {
      this.spinT += dt * 1000;
      if (this.spinT >= 600) {
        this.isSpinning = false;
      } else {
        const p = this.spinT / 600;
        const e = 1 - Math.pow(1 - p, 3);
        // Add full rotation (current angle -> +2pi)
        this.sprite.mesh.rotation.y += Math.PI * 2 * e;
      }
    }

    if (this.puffRing !== null) {
      this.puffT += dt * 1000;
      if (this.puffT >= EVOLVE_PUFF_MS) {
        this.scene.remove(this.puffRing);
        this.puffRing.geometry.dispose();
        (this.puffRing.material as THREE.Material).dispose();
        this.puffRing = null;
      } else {
        const p = this.puffT / EVOLVE_PUFF_MS;
        const e = 1 - Math.pow(1 - p, 3);
        const scale = EVOLVE_PUFF_RING_START + (EVOLVE_PUFF_RING_END - EVOLVE_PUFF_RING_START) * e;
        this.puffRing.scale.setScalar(scale);
        const pos = this.sprite.worldPosition;
        this.puffRing.position.x = pos.x;
        this.puffRing.position.z = pos.z;
        const material = this.puffRing.material as THREE.MeshBasicMaterial;
        material.opacity = 1 - e;
      }
    }
  }

  dispose(): void {
    if (this.puffRing !== null) {
      this.scene.remove(this.puffRing);
      this.puffRing.geometry.dispose();
      (this.puffRing.material as THREE.Material).dispose();
      this.puffRing = null;
    }
    this.sprite.dispose();
  }
}
