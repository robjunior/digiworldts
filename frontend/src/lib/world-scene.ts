import * as THREE from 'three';

import type { WorldObject, WorldTile } from './api-world';
import { createWorldObjectLayer } from './world-object-meshes';

export type BendedTile = { readonly color: string };

export type WorldSceneSnapshot<T extends BendedTile = WorldTile> = {
  readonly x: number;
  readonly y: number;
  readonly tile: T | null;
};

export type WorldSceneOptions = {
  readonly viewRadius?: number;
  readonly sphereRadius?: number;
  readonly borderWidth?: number;
  readonly borderDarken?: number;
};

export type WorldScene<T extends BendedTile = WorldTile> = {
  readonly dispose: () => void;
  readonly moveTo: (tiles: readonly T[]) => void;
  readonly setWorldObjects: (objects: readonly WorldObject[]) => void;
  readonly subscribe: (subscriber: (snapshot: WorldSceneSnapshot<T>) => void) => () => void;
};

const TILE_PX = 48;
const FOV_DEG = 50;
const TILT_RATIO = 22 / 14;
const DEFAULT_VIEW_RADIUS = 18;
const DEFAULT_SPHERE_RADIUS = 80;
const DEFAULT_BORDER_WIDTH = 0.04;
const DEFAULT_BORDER_DARKEN = 1.0;

const vertexShader = /* glsl */ `
          varying vec2 vUv;
          uniform float radius;
          void main() {
            vUv = uv;
            vec3 pos = position;
            float dist = length(pos.xz);
            pos.y -= (dist * dist) / radius;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }
        `;

const fragmentShader = /* glsl */ `
          varying vec2 vUv;
          uniform sampler2D tiles;
          uniform float tileCount;
          uniform float borderWidth;
          uniform float borderDarken;
          void main() {
            vec4 c = texture2D(tiles, vUv);
            if (c.a < 0.01) discard;
            vec2 tileFrac = fract(vUv * tileCount);
            float edgeDist = min(
              min(tileFrac.x, 1.0 - tileFrac.x),
              min(tileFrac.y, 1.0 - tileFrac.y)
            );
            float t = smoothstep(0.0, borderWidth, edgeDist);
            vec3 rgb = mix(c.rgb * borderDarken, c.rgb, t);
            gl_FragColor = vec4(rgb, c.a);
          }
        `;

export function createWorldScene<T extends BendedTile = WorldTile>(canvas: HTMLCanvasElement, opts: WorldSceneOptions = {}): WorldScene<T> {
  const size = 2 * (opts.viewRadius ?? DEFAULT_VIEW_RADIUS) + 1;
  const width = Math.max(canvas.clientWidth, 1);
  const height = Math.max(canvas.clientHeight, 1);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV_DEG, width / height, 0.1, 500);
  setCameraPosition(camera, height);
  const ambientLight = new THREE.HemisphereLight(0xfff3d6, 0x31415c, 1.4);
  const keyLight = new THREE.DirectionalLight(0xffefd0, 1.6);
  keyLight.position.set(-4, 8, 5);
  scene.add(ambientLight, keyLight);

  const data = new Uint8Array(size * size * 4);
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.flipY = true;
  texture.needsUpdate = true;

  const segments = size * 4;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      tiles: { value: texture },
      radius: { value: opts.sphereRadius ?? DEFAULT_SPHERE_RADIUS },
      tileCount: { value: size },
      borderWidth: { value: opts.borderWidth ?? DEFAULT_BORDER_WIDTH },
      borderDarken: { value: opts.borderDarken ?? DEFAULT_BORDER_DARKEN },
    },
    vertexShader,
    fragmentShader,
  });

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  const worldObjectLayer = createWorldObjectLayer({
    sphereRadius: opts.sphereRadius ?? DEFAULT_SPHERE_RADIUS,
    viewRadius: opts.viewRadius ?? DEFAULT_VIEW_RADIUS,
  });
  scene.add(worldObjectLayer.group);

  let frameId: number | null = null;
  let disposed = false;
  let lastTiles: readonly T[] = [];
  let center = { x: 0, y: 0 };
  const subscribers = new Set<(snapshot: WorldSceneSnapshot<T>) => void>();

  const render = (): void => {
    if (disposed) {
      return;
    }
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(render);
  };

  const resize = (): void => {
    const nextWidth = Math.max(canvas.clientWidth, 1);
    const nextHeight = Math.max(canvas.clientHeight, 1);
    renderer.setSize(nextWidth, nextHeight, false);
    camera.aspect = nextWidth / nextHeight;
    setCameraPosition(camera, nextHeight);
    camera.updateProjectionMatrix();
  };

  window.addEventListener('resize', resize);
  frameId = requestAnimationFrame(render);

  return {
    dispose: () => {
      disposed = true;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      window.removeEventListener('resize', resize);
      subscribers.clear();
      scene.remove(mesh, worldObjectLayer.group, ambientLight, keyLight);
      worldObjectLayer.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.dispose();
    },
    moveTo: (tiles) => {
      lastTiles = tiles;
      center = readCenterTile(tiles, center);
      worldObjectLayer.setCenter(center);
      updateTiles(texture, size, tiles);
      const centerIndex = Math.floor(tiles.length / 2);
      subscribers.forEach((subscriber) => subscriber({ x: 0, y: 0, tile: tiles[centerIndex] ?? null }));
    },
    setWorldObjects: (objects) => {
      worldObjectLayer.setObjects(objects);
    },
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      const centerIndex = Math.floor(lastTiles.length / 2);
      subscriber({ x: 0, y: 0, tile: lastTiles[centerIndex] ?? null });
      return () => {
        subscribers.delete(subscriber);
      };
    },
  };
}

function readCenterTile<T extends BendedTile>(tiles: readonly T[], fallback: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number } {
  const centerIndex = Math.floor(tiles.length / 2);
  const tile = tiles[centerIndex];
  if (tile && 'x' in tile && 'y' in tile && typeof tile.x === 'number' && typeof tile.y === 'number') {
    return { x: tile.x, y: tile.y };
  }
  return fallback;
}

function cameraPos(canvasH: number): { readonly camY: number; readonly camZ: number } {
  const visibleHeightWorld = canvasH / TILE_PX;
  const tanHalfFov = Math.tan((FOV_DEG / 2) * Math.PI / 180);
  const focal = visibleHeightWorld / (2 * tanHalfFov);
  const d = focal / Math.sqrt(TILT_RATIO * TILT_RATIO + 1);
  return { camY: d * TILT_RATIO, camZ: d };
}

function setCameraPosition(camera: THREE.PerspectiveCamera, canvasH: number): void {
  const { camY, camZ } = cameraPos(canvasH);
  camera.position.set(0, camY, camZ);
  camera.lookAt(0, 0, 0);
}

function updateTiles(texture: THREE.DataTexture, size: number, tiles: readonly BendedTile[]): void {
  const image = texture.image;
  const arr = image.data;
  if (!(arr instanceof Uint8Array)) {
    return;
  }
  const n = size * size;
  for (let i = 0; i < n; i += 1) {
    const tile = tiles[i];
    if (!tile) {
      writeTransparent(arr, i);
      continue;
    }
    const rgb = parseHexColor(tile.color);
    if (rgb === null) {
      writeTransparent(arr, i);
      continue;
    }
    const offset = i * 4;
    arr[offset] = rgb.r;
    arr[offset + 1] = rgb.g;
    arr[offset + 2] = rgb.b;
    arr[offset + 3] = 255;
  }
  texture.needsUpdate = true;
}

function writeTransparent(arr: Uint8Array, index: number): void {
  const offset = index * 4;
  arr[offset] = 0;
  arr[offset + 1] = 0;
  arr[offset + 2] = 0;
  arr[offset + 3] = 0;
}

function parseHexColor(color: string): { readonly r: number; readonly g: number; readonly b: number } | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return null;
  }
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16),
  };
}
