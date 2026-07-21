import * as THREE from 'three';

export type AnimatedElement =
  | 'fire'
  | 'water'
  | 'plant'
  | 'ice'
  | 'electricity'
  | 'earth'
  | 'steel'
  | 'wind'
  | 'light'
  | 'dark'
  | 'null';

export type AttackEffect3D = {
  readonly id: string;
  readonly element: AnimatedElement;
  readonly sourcePosition: THREE.Vector3;
  readonly targetPosition: THREE.Vector3;
  readonly durationS: number;
  readonly onImpact?: () => void;
};

export type Runner3D = {
  tick(dtS: number, elapsedS: number, cameraQuat: THREE.Quaternion): void;
  dispose(): void;
};

export type RunnerBuilder = (scene: THREE.Scene, effect: AttackEffect3D) => Runner3D;

export const DEFAULT_EFFECT_DURATION_S = 1.1;

export const ELEMENT_LIGHT_COLOR: Record<AnimatedElement, number> = {
  fire: 0xff6a2a,
  water: 0x3ea1ff,
  plant: 0x3ede78,
  ice: 0x8fe0ff,
  electricity: 0xfff08a,
  earth: 0xd4a15a,
  steel: 0xc9d3e0,
  wind: 0xb8e8c8,
  light: 0xfff2c8,
  dark: 0x8f5aff,
  null: 0xd9dee7,
};

export const ELEMENT_LIGHT_INTENSITY: Record<AnimatedElement, number> = {
  fire: 4.0,
  water: 2.6,
  plant: 2.4,
  ice: 3.2,
  electricity: 5.5,
  earth: 2.0,
  steel: 3.0,
  wind: 2.2,
  light: 5.0,
  dark: 3.0,
  null: 1.6,
};

export const ELEMENT_LIGHT_DISTANCE: Record<AnimatedElement, number> = {
  fire: 6,
  water: 5,
  plant: 4.5,
  ice: 5.5,
  electricity: 7,
  earth: 4,
  steel: 5,
  wind: 4,
  light: 7,
  dark: 5.5,
  null: 3,
};

const ANIMATED: ReadonlySet<AnimatedElement> = new Set([
  'fire', 'water', 'plant', 'ice', 'electricity',
  'earth', 'steel', 'wind', 'light', 'dark', 'null',
]);

export function isAnimatedElement(value: string | null | undefined): value is AnimatedElement {
  return value !== null && value !== undefined && ANIMATED.has(value as AnimatedElement);
}
