import * as THREE from 'three';

/**
 * Faithful port of the reference skill-FX particle pool from the RPG Skill
 * Effects HTML (THREE.js r128). A single additive THREE.Points cloud whose
 * per-particle buffers (pos/vel/color/size/alpha/life) are updated on the CPU
 * each frame and streamed to a ShaderMaterial with gl_PointSize.
 *
 * Kept byte-for-byte behaviorally identical to the source (same shader, same
 * pool ring-buffer, same alpha/size/color lerp) so ported effects render the
 * same. One pool instance per runner so simultaneous casts don't clobber each
 * other (the HTML used one global pool).
 */
export class Pool {
  readonly max: number;
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly ml: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly c0: Float32Array;
  private readonly c1: Float32Array;
  private readonly grav: Float32Array;
  private readonly dragArr: Float32Array;
  private k = 0;

  constructor(scene: THREE.Scene, max = 9000) {
    this.max = max;
    const f = (m = 1) => new Float32Array(max * m);
    this.pos = f(3);
    this.vel = f(3);
    this.col = f(3);
    this.size = f();
    this.alpha = f();
    this.life = f();
    this.ml = f();
    this.s0 = f();
    this.s1 = f();
    this.c0 = f(3);
    this.c1 = f(3);
    this.grav = f();
    this.dragArr = f();

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { scale: { value: 600 } },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        attribute vec3 pcolor;
        varying vec3 vC;
        varying float vA;
        uniform float scale;
        void main(){
          vC=pcolor; vA=alpha;
          vec4 mv=modelViewMatrix*vec4(position,1.);
          gl_PointSize=size*scale/-mv.z;
          gl_Position=projectionMatrix*mv;
        }`,
      fragmentShader: `
        varying vec3 vC; varying float vA;
        void main(){
          float d=length(gl_PointCoord-.5);
          float a=smoothstep(.5,.02,d);
          gl_FragColor=vec4(vC,a*vA);
        }`,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    ml: number, s0: number, s1: number,
    c0: readonly [number, number, number],
    c1: readonly [number, number, number],
    grav = 0, drag = 0,
  ): void {
    const i = this.k;
    this.k = (i + 1) % this.max;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.life[i] = this.ml[i] = ml;
    this.s0[i] = s0; this.s1[i] = s1;
    const r0 = c0[0]!, g0 = c0[1]!, b0 = c0[2]!;
    const r1 = c1[0]!, g1 = c1[1]!, b1 = c1[2]!;
    this.c0[j] = r0; this.c0[j + 1] = g0; this.c0[j + 2] = b0;
    this.c1[j] = r1; this.c1[j + 1] = g1; this.c1[j + 2] = b1;
    this.grav[i] = grav; this.dragArr[i] = drag;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if ((this.life[i] ?? 0) <= 0) { this.size[i] = 0; this.alpha[i] = 0; continue; }
      this.life[i] = (this.life[i] ?? 0) - dt;
      const j = i * 3;
      const t = 1 - Math.max(this.life[i] ?? 0, 0) / (this.ml[i] ?? 1);
      const d = Math.exp(-(this.dragArr[i] ?? 0) * dt);
      this.vel[j] = (this.vel[j] ?? 0) * d;
      this.vel[j + 1] = (this.vel[j + 1] ?? 0) * d + (this.grav[i] ?? 0) * dt;
      this.vel[j + 2] = (this.vel[j + 2] ?? 0) * d;
      this.pos[j] = (this.pos[j] ?? 0) + (this.vel[j] ?? 0) * dt;
      this.pos[j + 1] = (this.pos[j + 1] ?? 0) + (this.vel[j + 1] ?? 0) * dt;
      this.pos[j + 2] = (this.pos[j + 2] ?? 0) + (this.vel[j + 2] ?? 0) * dt;
      for (let g = 0; g < 3; g++) {
        this.col[j + g] = (this.c0[j + g] ?? 0) + ((this.c1[j + g] ?? 0) - (this.c0[j + g] ?? 0)) * t;
      }
      this.size[i] = (this.s0[i] ?? 0) + ((this.s1[i] ?? 0) - (this.s0[i] ?? 0)) * t;
      this.alpha[i] = Math.min(1, t * 12) * (1 - t);
    }
    const a = this.points.geometry.attributes;
    (a.position as THREE.BufferAttribute).needsUpdate = true;
    (a.pcolor as THREE.BufferAttribute).needsUpdate = true;
    (a.size as THREE.BufferAttribute).needsUpdate = true;
    (a.alpha as THREE.BufferAttribute).needsUpdate = true;
  }

  setPointScale(value: number): void {
    if (this.material.uniforms.scale) this.material.uniforms.scale.value = value;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    (this.points.parent as THREE.Scene | null)?.remove(this.points);
  }
}

/** Random float in [a, b). */
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
/** Random float in [-1, 1). */
export const rnd = (): number => Math.random() * 2 - 1;
/** Rand count scaled by dt (fractional spawn like the HTML's `cnt`). */
export const cnt = (rate: number, dt: number): number => Math.floor(rate * dt + Math.random());

/** Hex color → [r, g, b] (0..1), like the HTML's `rgb(h)`. */
export function rgb(h: number): [number, number, number] {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
}

export const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Reference color palette from the HTML. */
export const C = {
  yel: rgb(0xffe07a), org: rgb(0xff6a10), red: rgb(0x7a1000), white: rgb(0xffffff),
  ice: rgb(0xbdf0ff), ice2: rgb(0x2a8cff), mist: rgb(0x3a6f95),
  wind: rgb(0xd8fff0), wind2: rgb(0x3f8f78),
  el: rgb(0x6f9bff), el2: rgb(0x2a2fff), spark: rgb(0xfff6b0),
} as const;

/** Spherical burst of n particles from a point — `burst()` from the HTML. */
export function burst(
  pool: Pool,
  x: number, y: number, z: number,
  n: number, spd: number, ml: number, s0: number, s1: number,
  c0: readonly [number, number, number],
  c1: readonly [number, number, number],
  grav: number, drag: number, up = 0,
): void {
  for (let i = 0; i < n; i++) {
    const v = V(rnd(), rnd(), rnd()).normalize().multiplyScalar(rand(0.3, 1) * spd);
    pool.emit(x, y, z, v.x, v.y + up, v.z, rand(0.6, 1) * ml, s0, s1, c0, c1, grav, drag);
  }
}