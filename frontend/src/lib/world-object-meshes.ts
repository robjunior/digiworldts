import * as THREE from 'three';

import type { WorldObject, WorldObjectKind } from './api-world';

type ObjectLayerOptions = {
  readonly sphereRadius: number;
  readonly viewRadius: number;
};

type WorldObjectLayer = {
  readonly group: THREE.Group;
  readonly setCenter: (center: TileCenter) => void;
  readonly setObjects: (objects: readonly WorldObject[]) => void;
  readonly dispose: () => void;
};

type TileCenter = {
  readonly x: number;
  readonly y: number;
};

type ObjectMesh = THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

type ObjectPart = {
  readonly kind: WorldObjectKind;
  readonly mesh: ObjectMesh;
  readonly offset: THREE.Vector3;
  readonly scale: THREE.Vector3;
};

type ObjectPartSpec = {
  readonly kind: WorldObjectKind;
  readonly geometry: THREE.BufferGeometry;
  readonly offset: THREE.Vector3;
  readonly scale: THREE.Vector3;
};

type InstanceWrite = {
  readonly parts: readonly ObjectPart[];
  readonly object: WorldObject;
  readonly index: number;
  readonly center: TileCenter;
  readonly sphereRadius: number;
};

type KindPalette = {
  readonly color: THREE.Color;
  readonly roughness: number;
  readonly metalness: number;
};

const MAX_INSTANCES_PER_KIND = 200;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const KIND_ORDER = ['mountain', 'tower', 'city', 'ruin', 'shrine', 'obelisk', 'crystal', 'grove', 'spring', 'archway'] as const satisfies readonly WorldObjectKind[];

const PALETTES = {
  mountain: { color: new THREE.Color('#725437'), roughness: 0.95, metalness: 0.0 },
  tower: { color: new THREE.Color('#8b9092'), roughness: 0.86, metalness: 0.0 },
  city: { color: new THREE.Color('#b3833f'), roughness: 0.58, metalness: 0.34 },
  ruin: { color: new THREE.Color('#b7b2a6'), roughness: 0.9, metalness: 0.0 },
  shrine: { color: new THREE.Color('#d7a648'), roughness: 0.62, metalness: 0.16 },
  obelisk: { color: new THREE.Color('#2f3d4a'), roughness: 0.78, metalness: 0.08 },
  crystal: { color: new THREE.Color('#a8dceb'), roughness: 0.18, metalness: 0.42 },
  grove: { color: new THREE.Color('#4a8f4c'), roughness: 0.82, metalness: 0.0 },
  spring: { color: new THREE.Color('#3a7cb8'), roughness: 0.22, metalness: 0.28 },
  archway: { color: new THREE.Color('#b8ceb0'), roughness: 0.7, metalness: 0.05 },
} as const satisfies Record<WorldObjectKind, KindPalette>;

export function createWorldObjectLayer(options: ObjectLayerOptions): WorldObjectLayer {
  const group = new THREE.Group();
  const parts = createObjectParts();
  for (const part of parts) {
    part.mesh.count = 0;
    group.add(part.mesh);
  }

  let center: TileCenter = { x: 0, y: 0 };
  let objects: readonly WorldObject[] = [];

  const renderObjects = (): void => {
    const counts: Record<WorldObjectKind, number> = { mountain: 0, tower: 0, city: 0, ruin: 0, shrine: 0, obelisk: 0, crystal: 0, grove: 0, spring: 0, archway: 0 };
    for (const object of objects) {
      const count = counts[object.kind];
      if (count >= MAX_INSTANCES_PER_KIND || !isVisible(object, center, options.viewRadius)) {
        continue;
      }
      writeObjectInstance({ parts, object, index: count, center, sphereRadius: options.sphereRadius });
      counts[object.kind] = count + 1;
    }
    for (const part of parts) {
      part.mesh.count = counts[part.kind];
      part.mesh.instanceMatrix.needsUpdate = true;
      if (part.mesh.instanceColor) {
        part.mesh.instanceColor.needsUpdate = true;
      }
    }
  };

  return {
    group,
    setCenter: (nextCenter) => {
      center = nextCenter;
      renderObjects();
    },
    setObjects: (nextObjects) => {
      objects = nextObjects;
      renderObjects();
    },
    dispose: () => {
      for (const part of parts) {
        group.remove(part.mesh);
        part.mesh.geometry.dispose();
        part.mesh.material.dispose();
      }
    },
  };
}

function createObjectParts(): readonly ObjectPart[] {
  return [
    createPart({ kind: 'mountain', geometry: new THREE.ConeGeometry(0.4, 0.9, 8), offset: new THREE.Vector3(0, 0.45, 0), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'tower', geometry: new THREE.CylinderGeometry(0.18, 0.22, 0.7, 10), offset: new THREE.Vector3(0, 0.35, 0), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'tower', geometry: new THREE.ConeGeometry(0.24, 0.28, 10), offset: new THREE.Vector3(0, 0.84, 0), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'city', geometry: new THREE.BoxGeometry(0.25, 0.3, 0.25), offset: new THREE.Vector3(-0.2, 0.15, -0.08), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'city', geometry: new THREE.BoxGeometry(0.32, 0.42, 0.26), offset: new THREE.Vector3(0.1, 0.21, 0.02), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'city', geometry: new THREE.BoxGeometry(0.22, 0.34, 0.3), offset: new THREE.Vector3(0.28, 0.17, -0.18), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'city', geometry: new THREE.BoxGeometry(0.28, 0.24, 0.24), offset: new THREE.Vector3(-0.06, 0.12, 0.25), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'ruin', geometry: new THREE.BoxGeometry(0.12, 0.56, 0.12), offset: new THREE.Vector3(-0.2, 0.28, -0.06), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'ruin', geometry: new THREE.BoxGeometry(0.12, 0.42, 0.12), offset: new THREE.Vector3(0.04, 0.21, 0.06), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'ruin', geometry: new THREE.BoxGeometry(0.12, 0.5, 0.12), offset: new THREE.Vector3(0.22, 0.25, -0.12), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'ruin', geometry: new THREE.BoxGeometry(0.32, 0.1, 0.13), offset: new THREE.Vector3(0.04, 0.05, 0.25), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'shrine', geometry: new THREE.BoxGeometry(0.6, 0.16, 0.6), offset: new THREE.Vector3(0, 0.08, 0), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'shrine', geometry: new THREE.BoxGeometry(0.45, 0.16, 0.45), offset: new THREE.Vector3(0, 0.24, 0), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'shrine', geometry: new THREE.BoxGeometry(0.3, 0.16, 0.3), offset: new THREE.Vector3(0, 0.4, 0), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'obelisk', geometry: new THREE.BoxGeometry(0.15, 0.7, 0.15), offset: new THREE.Vector3(0, 0.35, 0), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'crystal', geometry: new THREE.OctahedronGeometry(0.28, 0), offset: new THREE.Vector3(0, 0.35, 0), scale: new THREE.Vector3(1, 1.4, 1) }),
    createPart({ kind: 'crystal', geometry: new THREE.OctahedronGeometry(0.16, 0), offset: new THREE.Vector3(-0.22, 0.18, 0.05), scale: new THREE.Vector3(1, 1.1, 1) }),
    createPart({ kind: 'crystal', geometry: new THREE.OctahedronGeometry(0.14, 0), offset: new THREE.Vector3(0.2, 0.16, -0.08), scale: new THREE.Vector3(1, 1.2, 1) }),
    createPart({ kind: 'grove', geometry: new THREE.ConeGeometry(0.15, 0.55, 6), offset: new THREE.Vector3(-0.18, 0.28, -0.1), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'grove', geometry: new THREE.ConeGeometry(0.17, 0.6, 6), offset: new THREE.Vector3(0.12, 0.3, 0.08), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'grove', geometry: new THREE.ConeGeometry(0.13, 0.5, 6), offset: new THREE.Vector3(0.24, 0.25, -0.16), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'grove', geometry: new THREE.ConeGeometry(0.14, 0.48, 6), offset: new THREE.Vector3(-0.06, 0.24, 0.24), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'spring', geometry: new THREE.CylinderGeometry(0.4, 0.42, 0.08, 16), offset: new THREE.Vector3(0, 0.04, 0), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'spring', geometry: new THREE.SphereGeometry(0.12, 8, 6), offset: new THREE.Vector3(0, 0.14, 0), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'archway', geometry: new THREE.TorusGeometry(0.32, 0.06, 6, 12, Math.PI), offset: new THREE.Vector3(0, 0.32, 0), scale: new THREE.Vector3(1, 1, 1) }),
    createPart({ kind: 'archway', geometry: new THREE.BoxGeometry(0.5, 0.05, 0.14), offset: new THREE.Vector3(0, 0.03, 0), scale: new THREE.Vector3(1, 1, 1) }),
  ];
}

function createPart(spec: ObjectPartSpec): ObjectPart {
  const palette = PALETTES[spec.kind];
  const material = new THREE.MeshStandardMaterial({
    color: palette.color,
    roughness: palette.roughness,
    metalness: palette.metalness,
    vertexColors: true,
  });
  const mesh = new THREE.InstancedMesh(spec.geometry, material, MAX_INSTANCES_PER_KIND);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return { kind: spec.kind, mesh, offset: spec.offset, scale: spec.scale };
}

function writeObjectInstance(write: InstanceWrite): void {
  const { parts, object, index, center, sphereRadius } = write;
  const relativeX = object.x - center.x;
  const relativeZ = object.y - center.y;
  const surfaceY = -((relativeX * relativeX + relativeZ * relativeZ) / sphereRadius);
  const color = object.tint && HEX_COLOR.test(object.tint) ? new THREE.Color(object.tint) : PALETTES[object.kind].color;

  for (const part of parts) {
    if (part.kind !== object.kind) {
      continue;
    }
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(
        relativeX + part.offset.x * object.scale,
        surfaceY + part.offset.y * object.scale,
        relativeZ + part.offset.z * object.scale,
      ),
      new THREE.Quaternion(),
      new THREE.Vector3(part.scale.x * object.scale, part.scale.y * object.scale, part.scale.z * object.scale),
    );
    part.mesh.setMatrixAt(index, matrix);
    part.mesh.setColorAt(index, color);
  }
}

function isVisible(object: WorldObject, center: TileCenter, viewRadius: number): boolean {
  const dx = object.x - center.x;
  const dy = object.y - center.y;
  return Math.hypot(dx, dy) <= viewRadius;
}
