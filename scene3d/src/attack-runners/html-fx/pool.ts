import * as THREE from 'three';

/**
 * Current ortho pixels-per-world-unit factor pushed by the scene. The reference
 * hardcoded `scale: 600` in the shader for its fixed perspective camera; DigiWorld
 * renders ortho (FRUSTUM×zoomMult, resizable canvas, DPR), so the scene pushes the
 * live factor here and every Pool syncs it during update(). Default keeps the
 * reference constant until the scene drives it, so standalone use still renders.
 */
let pointScale = 600;
/** Scene sets this every frame to keep particle size in true world units. */
export function setWorldPointScale(value: number): void {
  pointScale = value;
}
export function getWorldPointScale(): number {
  return pointScale;
}

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
  private lastAppliedScale = -1;

  constructor(scene: THREE.Scene, max = 9000, blend: THREE.Blending = THREE.AdditiveBlending) {
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
      blending: blend,
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
          // World-unit size: the scene pushes the ortho pixels-per-world-unit
          // factor into the scale uniform every frame. The reference hardcoded
          // 600 for a fixed perspective camera; ortho needs the live frustum
          // factor so particles track the same world scale as the slash /
          // freeze / ring meshes (gl_PointSize is in device pixels).
          gl_PointSize=max(1.0,size*scale);
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
    // Live world-unit sync: the scene pushes the ortho pixels-per-world-unit
    // factor here every frame, so particles track the same world scale as the
    // slash / freeze / ring meshes (this replaces the reference's fixed 600
    // perspective constant). Per-instance overrides via setPointScale still win.
    if (pointScale !== this.lastAppliedScale) {
      this.setPointScale(pointScale);
      this.lastAppliedScale = pointScale;
    }
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

/** Extra reference palette used by the melee / holy / water / null effects. */
export const C2 = {
  gd: rgb(0xffd870), gd2: rgb(0xff9a30),
  wt0: rgb(0x9fe0ff), wt1: rgb(0x1f6fe0),
  gr0: rgb(0x9dff5a), gr1: rgb(0x1a6a20), pk: rgb(0xff9ac8),
  pur: rgb(0xb060ff), pur2: rgb(0x4a10a0), dks: rgb(0x1a0028),
  st0: rgb(0xdde6f2), st1: rgb(0x445064),
  nl0: rgb(0xf2f4fa), nl1: rgb(0x5a5f70),
  rk: [0.5, 0.42, 0.33] as [number, number, number],
  rk1: [0.16, 0.14, 0.12] as [number, number, number],
  rd0: [0.7, 0.6, 0.45] as [number, number, number],
  rd1: [0.3, 0.25, 0.2] as [number, number, number],
  bk: [0, 0, 0] as [number, number, number],
  wh: [1, 1, 1] as [number, number, number],
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

/** Horizontal ring of particles radiating outward — `ringOut()` from the HTML.
 *  `ml` is the max life, `s0` the start size; end size = s0*0.25 (as authored). */
export function ringOut(
  pool: Pool,
  q: THREE.Vector3, y: number, n: number, sp: number, ml: number, s0: number,
  c0: readonly [number, number, number], c1: readonly [number, number, number],
): void {
  for (let j = 0; j < n; j++) {
    const an = (j / n) * 6.28;
    pool.emit(
      q.x, y, q.z,
      Math.cos(an) * sp, rand(-0.3, 0.5), Math.sin(an) * sp,
      ml, s0, s0 * 0.25, c0, c1, 0, 2,
    );
  }
}

/** Diagonal slash arc of particles on the receiver — `slash()` from the HTML. */
export function slash(
  pool: Pool,
  x: number, c0: readonly [number, number, number], c1: readonly [number, number, number],
  width = 1.5, yBase = 1.5, z = 0.5,
): void {
  for (let j = 0; j <= 26; j++) {
    const u = j / 26 - 0.5;
    pool.emit(
      x - 0.9 + u * width,
      yBase - u * 2.2 + 0.3 * (1 - 4 * u * u),
      z,
      0, 0, 0, 0.2, 0.26, 0.03, c0, c1,
    );
  }
}

/** Jagged path from a → b with per-segment jitter — `makePath()` from the HTML. */
export function makePath(
  a: THREE.Vector3, b: THREE.Vector3, segs: number, jit: number,
): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const p = a.clone().lerp(b, u);
    const amp = jit * Math.sin(Math.PI * u) + (i > 0 && i < segs ? 0.05 : 0);
    if (i > 0 && i < segs) {
      p.x += rnd() * amp;
      p.z += rnd() * amp;
      p.y += rnd() * amp * 0.3;
    }
    pts.push(p);
  }
  return pts;
}

/** Emit a particle-drawn line along a path — `draw()` from the HTML. */
export function draw(
  pool: Pool,
  pts: readonly THREE.Vector3[], size: number, life: number,
  c0: readonly [number, number, number], c1: readonly [number, number, number],
): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const bb = pts[i + 1]!;
    const n = Math.max(1, Math.ceil(a.distanceTo(bb) / 0.14));
    for (let k = 0; k < n; k++) {
      const p = a.clone().lerp(bb, k / n);
      pool.emit(p.x, p.y, p.z, 0, 0, 0, life, size, size * 0.3, c0, c1);
    }
  }
}