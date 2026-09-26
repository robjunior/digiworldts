/**
 * Volumetric light shafts — WebGL realization of the WebGPU "volume lighting"
 * example (three.js) applied to the lobby stage spotlights.
 *
 * Each shaft is evaluated by analytically intersecting the camera's view ray
 * with the spotlight's cone (apex at the light, base at the floor) — so the
 * whole beam FILLS on screen (not a thin shell), with soft edge + axial fade +
 * fog. The mesh is a big sphere proxy that rasterizes the beam's screen area;
 * the shader does the fill. Additively blended.
 *
 * Shared by LobbyScene3D and the admin ScenePreview so they stay 1:1.
 */
import * as THREE from 'three';

export type LightShaftHandle = {
  mesh: THREE.Mesh;
  /** Keep the camera-position uniform in sync (camera drift). */
  update: (camera: THREE.Camera) => void;
  dispose: () => void;
};

type LightShaftOptions = {
  color: THREE.Color;
  /** HDR multiplier — survives low tone-mapping exposure. */
  intensity: number;
  position: THREE.Vector3;
  /** normalized direction from the light toward the floor */
  forward: THREE.Vector3;
  /** spotlight cone half-angle (rad) */
  angle: number;
  /** cone length (light → floor) */
  length: number;
  /** 0 = crisp edge, 1 = broad atmospheric penumbra. */
  softness?: number;
  /** 0 = uniform beam, 1 = strong distance extinction. */
  distanceBlur?: number;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  exposure: number;
};

const VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uLightPos;
uniform vec3 uSpotDir;
uniform float uAng;
uniform float uRadiusMax;
uniform float uSoftness;
uniform float uDistanceBlur;
uniform vec4 uLightColor;
uniform vec3 uCameraPos;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uExposure;
varying vec3 vWorldPos;

void main() {
  // Ray from the camera through the rasterized proxy fragment.
  // The previous direction was reversed, so the quadratic marched behind the
  // camera and discarded practically every fragment (an invisible beam).
  vec3 d = normalize(vWorldPos - uCameraPos);
  vec3 o = uCameraPos - uLightPos;         // raiz do raio no frame do cone
  float oc = dot(o, uSpotDir);
  vec3 op = o - uSpotDir * oc;
  float dc = dot(d, uSpotDir);
  vec3 dp = d - uSpotDir * dc;
  float tg = tan(uAng);
  // ray-cone: |perp| = tg * axial  →  A t² + B t + C = 0
  float A = dot(dp, dp) - tg * tg * dc * dc;
  float B = 2.0 * (dot(op, dp) - tg * tg * oc * dc);
  float C = dot(op, op) - tg * tg * oc * oc;
  float disc = B * B - 4.0 * A * C;
  if (disc < 0.0) discard;
  float s = sqrt(disc);
  float t0;
  float t1;
  if (abs(A) < 1e-6) {
    // raio ~ paralelo ao eixo do cone → equação quase linear
    if (abs(B) < 1e-6) discard;
    t0 = -C / B;
    t1 = t0;
  } else {
    t0 = (-B - s) / (2.0 * A);
    t1 = (-B + s) / (2.0 * A);
  }
  if (t1 < t0) { float tmp = t0; t0 = t1; t1 = tmp; }
  float tEnter = max(t0, 0.0);
  if (tEnter < 0.0 || tEnter > uRadiusMax) discard;
  float pathLen = clamp(t1 - t0, 0.0, uRadiusMax);
  if (pathLen <= 0.001) discard;
  // Soft penumbra: attenuate the analytic volume before the hard cone edge.
  // This keeps the beam readable without the plastic "solid cone" look.
  vec3 entry = uCameraPos + d * tEnter;
  float alongEntry = dot(entry - uLightPos, uSpotDir);
  float radiusAtEntry = max(tan(uAng) * max(alongEntry, 0.001), 0.001);
  float radialEntry = length((entry - uLightPos) - uSpotDir * alongEntry);
  float edge = smoothstep(0.0, radiusAtEntry * max(uSoftness, 0.001), radiusAtEntry - radialEntry);
  // Distance blur/extinction makes the shaft dissolve into the fog instead of
  // ending with a visible uniform tube at the floor.
  float distanceFade = mix(1.0, exp(-alongEntry / max(uRadiusMax, 0.001) * 4.0), clamp(uDistanceBlur, 0.0, 1.0));
  // posição de entrada ao longo do eixo → fade axial (perto do ponto → base)
  vec3 hit = entry;
  float along = dot(hit - uLightPos, uSpotDir);
  if (along < 0.0 || along > uRadiusMax) discard;
  float axial = 1.0 - smoothstep(uRadiusMax * 0.25, uRadiusMax, along);
  // densidade do raio no cone (path curto perto da tangente → borda macia)
  float density = clamp(pathLen / (uRadiusMax * 0.5), 0.0, 1.0);
  float fall = axial * density * edge * distanceFade;
  vec3 col = uLightColor.rgb * fall;
  float fog = smoothstep(uFogNear, uFogFar, length(uCameraPos - vWorldPos));
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  col *= uExposure;
  gl_FragColor = vec4(col, 1.0);
}`;

export function createLightShaft(opts: LightShaftOptions): LightShaftHandle {
  const { position, forward, angle, length } = opts;
  const rad = Math.max(length, 0.1);
  // The proxy only rasterizes pixels; its bounds must cover the widest part of
  // the cone or the analytic shader is clipped before the beam reaches the floor.
  const proxyRadius = Math.max(rad * 0.5, rad * Math.tan(Math.max(angle, 0.01)));
  const geo = new THREE.SphereGeometry(proxyRadius, 36, 20);
  const uniforms = {
    uCameraPos: { value: new THREE.Vector3(0, 8, 8) },
    uLightPos: { value: position.clone() },
    uSpotDir: { value: forward.clone().normalize() },
    uAng: { value: Math.max(angle, 0.01) },
    uRadiusMax: { value: Math.max(length, 0.1) },
    uSoftness: { value: THREE.MathUtils.clamp(opts.softness ?? 0.55, 0, 1) },
    uDistanceBlur: { value: THREE.MathUtils.clamp(opts.distanceBlur ?? 0.65, 0, 1) },
    uLightColor: { value: new THREE.Vector4(opts.color.r, opts.color.g, opts.color.b, 1).multiplyScalar(opts.intensity) },
    uFogColor: { value: opts.fogColor },
    uFogNear: { value: opts.fogNear },
    uFogFar: { value: opts.fogFar },
    uExposure: { value: opts.exposure },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position).addScaledVector(forward, length * 0.5);
  mesh.frustumCulled = false;

  const update = (camera: THREE.Camera): void => {
    camera.getWorldPosition(uniforms.uCameraPos.value);
  };
  const dispose = (): void => {
    geo.dispose();
    mat.dispose();
  };
  return { mesh, update, dispose };
}