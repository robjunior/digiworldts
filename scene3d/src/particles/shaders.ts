import * as THREE from 'three';

export type ParticleMaterialOpts = {
  color: number;
  opacity: number;
  blending: 'normal' | 'additive' | 'multiply';
  softParticles?: boolean;
  textureUrl?: string | null;
  envMap?: THREE.Texture | null;
};

function getBlending(blendStr: string) {
  switch (blendStr) {
    case 'additive': return THREE.AdditiveBlending;
    case 'multiply': return THREE.MultiplyBlending;
    default: return THREE.NormalBlending;
  }
}

const COMMON_VERTEX_PARS = `
attribute vec3 aStartColor;
attribute vec3 aEndColor;
attribute float aStartSize;
attribute float aEndSize;
attribute float aStartOpacity;
attribute float aEndOpacity;
attribute float aLifeProgress;
attribute vec3 aVelocity;

varying vec3 vColor;
varying float vOpacity;
varying vec2 vUv;

uniform float uTime;
#include <common>
#include <fog_pars_vertex>
`;

const COMMON_VERTEX_INIT = `
  vUv = uv;
  vColor = mix(aStartColor, aEndColor, aLifeProgress);
  vOpacity = mix(aStartOpacity, aEndOpacity, aLifeProgress);
  float size = mix(aStartSize, aEndSize, aLifeProgress);
`;

const BILLBOARD_PROJECT = `
  vec4 mvPosition;
  #ifdef USE_INSTANCING
    mat4 im = instanceMatrix;
    vec3 instancePos = vec3(im[3][0], im[3][1], im[3][2]);
    mvPosition = modelViewMatrix * vec4(instancePos, 1.0);
  #else
    mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  #endif
  
  mvPosition.xy += transformed.xy;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
`;

const COMMON_FRAG_PARS = `
uniform vec3 uBaseColor;
uniform float uBaseOpacity;
varying vec3 vColor;
varying float vOpacity;
varying vec2 vUv;
#include <common>
#include <fog_pars_fragment>
`;

function getBaseUniforms(opts: ParticleMaterialOpts) {
  return THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uBaseColor: { value: new THREE.Color(opts.color) },
      uBaseOpacity: { value: opts.opacity },
      uEnvMap: { value: opts.envMap || null }
    }
  ]);
}

function getBaseDefines(opts: ParticleMaterialOpts) {
  const defines: Record<string, string> = {};
  if (opts.envMap) defines['HAS_ENVMAP'] = '';
  return defines;
}

export function attachUpdater(material: THREE.ShaderMaterial, updater?: (dt: number, elapsed: number) => void) {
  material.userData.update = (dt: number, elapsed: number) => {
    if (material.uniforms.uTime) {
      material.uniforms.uTime.value = elapsed;
    }
    updater?.(dt, elapsed);
  };
}

// 1. Default Particle
export function createDefaultParticleMaterial(opts: ParticleMaterialOpts) {
  return new THREE.ShaderMaterial({
    uniforms: getBaseUniforms(opts),
    defines: getBaseDefines(opts),
    blending: getBlending(opts.blending),
    depthWrite: !opts.softParticles,
    depthTest: true,
    transparent: true,
    fog: true,
    vertexShader: `
      ${COMMON_VERTEX_PARS}
      void main() {
        ${COMMON_VERTEX_INIT}
        vec3 transformed = vec3(position) * size;
        ${BILLBOARD_PROJECT}
      }
    `,
    fragmentShader: `
      ${COMMON_FRAG_PARS}
      void main() {
        float d = length(vUv - 0.5);
        if (d > 0.5) discard;
        vec4 baseColor = vec4(vColor * uBaseColor, vOpacity * uBaseOpacity);
        gl_FragColor = baseColor;
        #include <fog_fragment>
      }
    `
  });
}

// 2. Rain Streak
export function createRainStreakMaterial(opts: ParticleMaterialOpts) {
  return new THREE.ShaderMaterial({
    uniforms: getBaseUniforms(opts),
    defines: getBaseDefines(opts),
    blending: getBlending(opts.blending),
    depthWrite: !opts.softParticles,
    depthTest: true,
    transparent: true,
    fog: true,
    vertexShader: `
      ${COMMON_VERTEX_PARS}
      void main() {
        ${COMMON_VERTEX_INIT}
        vec3 transformed = vec3(position) * size;
        
        vec3 viewVel = (viewMatrix * vec4(aVelocity, 0.0)).xyz;
        float speed = length(aVelocity);
        float stretch = min(speed * 0.05, 3.0);
        
        vec2 dir = normalize(viewVel.xy + vec2(0.0001, 0.0));
        vec2 right = vec2(dir.y, -dir.x);
        
        transformed.xy = right * transformed.x + dir * transformed.y * (1.0 + stretch);
        
        ${BILLBOARD_PROJECT}
      }
    `,
    fragmentShader: `
      ${COMMON_FRAG_PARS}
      void main() {
        float alpha = (1.0 - abs(vUv.x - 0.5) * 2.0) * vOpacity * uBaseOpacity;
        gl_FragColor = vec4(vColor * uBaseColor, alpha);
        #include <fog_fragment>
      }
    `
  });
}

// 3. Wet Spark
export function createWetSparkMaterial(opts: ParticleMaterialOpts) {
  return new THREE.ShaderMaterial({
    uniforms: getBaseUniforms(opts),
    defines: getBaseDefines(opts),
    blending: getBlending(opts.blending),
    depthWrite: !opts.softParticles,
    depthTest: true,
    transparent: true,
    fog: true,
    vertexShader: `
      ${COMMON_VERTEX_PARS}
      void main() {
        ${COMMON_VERTEX_INIT}
        vec3 transformed = vec3(position) * size;
        ${BILLBOARD_PROJECT}
      }
    `,
    fragmentShader: `
      ${COMMON_FRAG_PARS}
      void main() {
        float d = length(vUv - 0.5);
        float alpha = smoothstep(0.5, 0.1, d) * vOpacity * uBaseOpacity;
        float core = smoothstep(0.15, 0.0, d);
        vec3 col = vColor * uBaseColor;
        gl_FragColor = vec4(col + vec3(core), alpha);
        #include <fog_fragment>
      }
    `
  });
}

// 4. Sand Haze
export function createSandHazeMaterial(opts: ParticleMaterialOpts) {
  return new THREE.ShaderMaterial({
    uniforms: getBaseUniforms(opts),
    defines: getBaseDefines(opts),
    blending: getBlending(opts.blending),
    depthWrite: !opts.softParticles,
    depthTest: true,
    transparent: true,
    fog: true,
    vertexShader: `
      ${COMMON_VERTEX_PARS}
      void main() {
        ${COMMON_VERTEX_INIT}
        vec3 transformed = vec3(position) * size;
        ${BILLBOARD_PROJECT}
      }
    `,
    fragmentShader: `
      ${COMMON_FRAG_PARS}
      void main() {
        float d = length(vUv - 0.5);
        float alpha = smoothstep(0.5, 0.2, d) * vOpacity * uBaseOpacity;
        gl_FragColor = vec4(vColor * uBaseColor, alpha);
        #include <fog_fragment>
      }
    `
  });
}

// 5. Thunder Core
export function createThunderCoreMaterial(opts: ParticleMaterialOpts) {
  return new THREE.ShaderMaterial({
    uniforms: getBaseUniforms(opts),
    defines: getBaseDefines(opts),
    blending: getBlending(opts.blending),
    depthWrite: !opts.softParticles,
    depthTest: true,
    transparent: true,
    fog: true,
    vertexShader: `
      ${COMMON_VERTEX_PARS}
      void main() {
        ${COMMON_VERTEX_INIT}
        vec3 transformed = vec3(position) * size;
        ${BILLBOARD_PROJECT}
      }
    `,
    fragmentShader: `
      ${COMMON_FRAG_PARS}
      void main() {
        float d = length(vUv - 0.5);
        float alpha = smoothstep(0.4, 0.0, d) * vOpacity * uBaseOpacity;
        vec3 col = vColor * uBaseColor * 3.0; // bright saturated core
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }
    `
  });
}

// 6. Snow Flake
export function createSnowFlakeMaterial(opts: ParticleMaterialOpts) {
  return new THREE.ShaderMaterial({
    uniforms: getBaseUniforms(opts),
    defines: getBaseDefines(opts),
    blending: getBlending(opts.blending),
    depthWrite: !opts.softParticles,
    depthTest: true,
    transparent: true,
    fog: true,
    vertexShader: `
      ${COMMON_VERTEX_PARS}
      void main() {
        ${COMMON_VERTEX_INIT}
        vec3 transformed = vec3(position) * size;
        
        float theta = uTime * 1.5 + aStartSize * 100.0;
        float c = cos(theta);
        float s = sin(theta);
        mat2 rot = mat2(c, -s, s, c);
        transformed.xy = rot * transformed.xy;
        
        ${BILLBOARD_PROJECT}
      }
    `,
    fragmentShader: `
      ${COMMON_FRAG_PARS}
      void main() {
        float d = length(vUv - 0.5);
        float alpha = smoothstep(0.5, 0.1, d) * vOpacity * uBaseOpacity;
        gl_FragColor = vec4(vColor * uBaseColor, alpha);
        #include <fog_fragment>
      }
    `
  });
}

// 7. Hail Shard
export function createHailShardMaterial(opts: ParticleMaterialOpts) {
  return new THREE.ShaderMaterial({
    uniforms: getBaseUniforms(opts),
    defines: getBaseDefines(opts),
    blending: getBlending(opts.blending),
    depthWrite: !opts.softParticles,
    depthTest: true,
    transparent: true,
    fog: true,
    vertexShader: `
      ${COMMON_VERTEX_PARS}
      void main() {
        ${COMMON_VERTEX_INIT}
        vec3 transformed = vec3(position) * size;
        
        float theta = uTime * 4.0 + aStartSize * 50.0;
        float c = cos(theta);
        float s = sin(theta);
        mat2 rot = mat2(c, -s, s, c);
        transformed.xy = rot * transformed.xy;
        
        ${BILLBOARD_PROJECT}
      }
    `,
    fragmentShader: `
      ${COMMON_FRAG_PARS}
      #ifdef HAS_ENVMAP
      uniform sampler2D uEnvMap;
      #endif
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        
        float z = sqrt(1.0 - r2);
        vec3 normal = normalize(vec3(p, z));
        
        vec3 viewDir = vec3(0.0, 0.0, 1.0);
        vec3 refl = reflect(-viewDir, normal);
        
        vec3 envCol = vec3(1.0);
        #ifdef HAS_ENVMAP
          vec2 envUv = refl.xy * 0.5 + 0.5;
          envCol = texture2D(uEnvMap, envUv).rgb;
        #endif
        
        float rim = 1.0 - max(dot(viewDir, normal), 0.0);
        rim = smoothstep(0.5, 1.0, rim);
        
        vec3 baseCol = mix(vColor * uBaseColor, vec3(1.0), 0.6);
        vec3 finalCol = baseCol * 0.6 + envCol * 0.3 + vec3(rim) * 0.5;
        
        gl_FragColor = vec4(finalCol, vOpacity * uBaseOpacity);
        #include <fog_fragment>
      }
    `
  });
}
