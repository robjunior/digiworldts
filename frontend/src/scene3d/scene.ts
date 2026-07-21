import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';

import { RUNNERS } from './attack-runners';
import type { AnimatedElement, AttackEffect3D, Runner3D } from './attack-runners/types';
import { DEFAULT_EFFECT_DURATION_S, ELEMENT_LIGHT_COLOR } from './attack-runners/types';
import { FORMATION_SIDE_X, FORMATION_SLOT_Z_SPACING, SpriteRig, slotWorldPosition, type SpriteRigConfig, type SpriteSide } from './sprite-rig';

export type SpriteInit = SpriteRigConfig;

const FRUSTUM = 4.5;
const CAM_ELEV_DEG = 22;
const CAM_YAW_DEG = 22;
const CAM_DIST = 14;
const CAM_LOOK_AT_Y = 0.6;

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly clock: THREE.Clock;
  private readonly ambient: THREE.AmbientLight;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
  private readonly gridHelper: THREE.GridHelper;
  private readonly propsGroup: THREE.Group;
  private readonly ringsGroup: THREE.Group;
  private readonly arenaGroup: THREE.Group;
  private readonly sprites: Map<string, SpriteRig> = new Map();
  private readonly effects: Map<string, { runner: Runner3D; elapsed: number; duration: number }> = new Map();
  private rafId = 0;
  private disposedFlag = false;
  private stageWidth = 1;
  private stageHeight = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.placeCameraIso();

    this.ambient = new THREE.AmbientLight(0x8faad0, 0.85);
    this.scene.add(this.ambient);

    this.keyLight = new THREE.DirectionalLight(0xfff2d0, 0.9);
    this.keyLight.position.set(-6, 9, 4);
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x1677ff, 0.35);
    this.rimLight.position.set(6, 4, -6);
    this.scene.add(this.rimLight);

    this.gridHelper = new THREE.GridHelper(20, 20, 0x1677ff, 0xd9dee7);
    (this.gridHelper.material as THREE.Material).transparent = true;
    (this.gridHelper.material as THREE.Material).opacity = 0.5;
    this.scene.add(this.gridHelper);

    this.ringsGroup = new THREE.Group();
    this.scene.add(this.ringsGroup);
    this.buildTeamSideRings();

    this.propsGroup = new THREE.Group();
    this.propsGroup.visible = false;
    this.scene.add(this.propsGroup);
    this.buildDefaultProps();

    this.arenaGroup = new THREE.Group();
    this.scene.add(this.arenaGroup);

    this.clock = new THREE.Clock();
  }

  private placeCameraIso(): void {
    const elev = (CAM_ELEV_DEG * Math.PI) / 180;
    const yaw = (CAM_YAW_DEG * Math.PI) / 180;
    this.camera.position.set(
      Math.sin(yaw) * Math.cos(elev) * CAM_DIST,
      Math.sin(elev) * CAM_DIST,
      Math.cos(yaw) * Math.cos(elev) * CAM_DIST,
    );
    this.camera.lookAt(0, CAM_LOOK_AT_Y, 0);
  }

  private buildTeamSideRings(): void {
    const geometry = new THREE.RingGeometry(0.55, 0.62, 24);
    const buildFor = (sign: number, color: number): void => {
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
      for (let i = 0; i < 3; i += 1) {
        const ring = new THREE.Mesh(geometry, material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(sign * FORMATION_SIDE_X, 0.02, (i - 1) * FORMATION_SLOT_Z_SPACING);
        this.ringsGroup.add(ring);
      }
    };
    buildFor(-1, 0x1677ff);
    buildFor(1, 0xe0384a);
  }

  private buildDefaultProps(): void {
    const material = new THREE.MeshBasicMaterial({ color: 0x1677ff, wireframe: true, transparent: true, opacity: 0.28 });
    const cfgs: ReadonlyArray<readonly [number, number, number, number]> = [
      [-6, 0.6, -6, 1.2],
      [6.5, 0.9, -5, 1.8],
      [-7, 0.5, 5, 1.0],
      [7, 0.7, 6, 1.4],
    ];
    for (const [x, y, z, s] of cfgs) {
      const geometry = new THREE.BoxGeometry(s, s, s);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      this.propsGroup.add(mesh);
    }
  }

  async loadArenaModel(url: string): Promise<void> {
    if (this.disposedFlag) return;
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    while (this.arenaGroup.children.length > 0) {
      const child = this.arenaGroup.children[0]!;
      this.arenaGroup.remove(child);
    }
    this.arenaGroup.add(gltf.scene);
    this.propsGroup.visible = false;
    this.gridHelper.visible = false;
  }

  resize(width: number, height: number): void {
    if (this.disposedFlag) return;
    if (width <= 0 || height <= 0) return;
    this.stageWidth = width;
    this.stageHeight = height;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.camera.left = -FRUSTUM * aspect;
    this.camera.right = FRUSTUM * aspect;
    this.camera.top = FRUSTUM;
    this.camera.bottom = -FRUSTUM;
    this.camera.updateProjectionMatrix();
  }

  addSprite(config: SpriteInit): SpriteRig {
    const existing = this.sprites.get(config.unitId);
    if (existing !== undefined) return existing;
    const sprite = new SpriteRig(this.scene, config);
    this.sprites.set(config.unitId, sprite);
    return sprite;
  }

  removeSprite(unitId: string): void {
    const sprite = this.sprites.get(unitId);
    if (sprite === undefined) return;
    sprite.dispose();
    this.sprites.delete(unitId);
  }

  getSprite(unitId: string): SpriteRig | undefined {
    return this.sprites.get(unitId);
  }

  getSpriteIds(): readonly string[] {
    return Array.from(this.sprites.keys());
  }

  clearSprites(): void {
    for (const sprite of this.sprites.values()) sprite.dispose();
    this.sprites.clear();
  }

  playEffect(
    element: AnimatedElement,
    sourceUnitId: string | null,
    targetUnitId: string,
    options: { readonly durationS?: number; readonly onImpact?: () => void } = {},
  ): string | null {
    const target = this.sprites.get(targetUnitId);
    if (target === undefined) return null;
    const source = sourceUnitId === null ? null : this.sprites.get(sourceUnitId) ?? null;
    const sourcePos = source === null
      ? target.worldPosition.clone().add(new THREE.Vector3(0, 4, 0))
      : source.worldPosition.clone();
    const targetPos = target.worldPosition.clone();
    const durationS = options.durationS ?? DEFAULT_EFFECT_DURATION_S;
    const id = `fx-${element}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const effect: AttackEffect3D = {
      id,
      element,
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      durationS,
      ...(options.onImpact ? { onImpact: options.onImpact } : {}),
    };

    if (source !== null) source.playAttack();

    const originalOnImpact = effect.onImpact;
    const wrappedEffect: AttackEffect3D = {
      ...effect,
      onImpact: () => {
        target.playHit();
        target.illuminate(ELEMENT_LIGHT_COLOR[element], 0.9, 3.5);
        originalOnImpact?.();
      },
    };

    const builder = RUNNERS[element];
    const runner = builder(this.scene, wrappedEffect);
    this.effects.set(id, { runner, elapsed: 0, duration: durationS });
    return id;
  }

  startLoop(): void {
    if (this.disposedFlag) return;
    if (this.rafId !== 0) return;
    const tick = (): void => {
      if (this.disposedFlag) return;
      const dt = this.clock.getDelta();
      const elapsed = this.clock.elapsedTime;
      for (const sprite of this.sprites.values()) {
        sprite.update(dt, elapsed, this.camera.quaternion);
      }
      const toRemove: string[] = [];
      for (const [id, ctx] of this.effects.entries()) {
        ctx.elapsed += dt;
        ctx.runner.tick(dt, elapsed, this.camera.quaternion);
        if (ctx.elapsed >= ctx.duration + 0.05) toRemove.push(id);
      }
      for (const id of toRemove) {
        const ctx = this.effects.get(id);
        ctx?.runner.dispose();
        this.effects.delete(id);
      }
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stopLoop(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  projectWorldToScreen(worldPos: THREE.Vector3): { readonly x: number; readonly y: number } {
    const v = worldPos.clone();
    v.project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.stageWidth,
      y: (-v.y * 0.5 + 0.5) * this.stageHeight,
    };
  }

  dispose(): void {
    if (this.disposedFlag) return;
    this.disposedFlag = true;
    this.stopLoop();
    for (const ctx of this.effects.values()) ctx.runner.dispose();
    this.effects.clear();
    for (const sprite of this.sprites.values()) sprite.dispose();
    this.sprites.clear();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
    this.renderer.dispose();
  }
}

export { slotWorldPosition };
export type { AnimatedElement, SpriteSide };
