// The street lamps' light, baked in Blender (scripts/blender/bake-lamplight.py, packed by scripts/pack-lamplight.mjs):
// every working lamp and the fire in the big top, with the light they bounce and the shadows of whatever stands in
// the way. The ground reads a sharp top-down map; walls, props and riders read a 1 m light grid over the park, kept
// for six directions so the side of a booth facing a lamp is lit and its back is not.
// Only the three lamps nearest the camera are real lights; this is what lights the rest of the park.
import * as THREE from 'three';

const MAX_DARK = 8;
export const lampLight = {
  volume: { value: null },
  ground: { value: null },
  /** decode scale x brightness; 0 until the bake has loaded */
  scale: { value: 0 },
  /** how far the lamps are on (the intro brings them up) */
  power: { value: 1 },
  /** ghosts' blackouts: x, z, radius, strength */
  dark: { value: Array.from({ length: MAX_DARK }, () => new THREE.Vector4()) },
};
/**
 * The lamps nearest the camera for the glow in the fog (post.js): head position and how lit each is (0 = off),
 * refreshed every frame by the lamps in world.js, so flicker, blackouts and the intro's power-up all show.
 */
export const lampGlow = { lamps: Array.from({ length: 8 }, () => new THREE.Vector4()) };

/** Overall brightness of the baked light against the scene's own lighting (tuned by eye). */
export const LAMP_GAIN = 7;

let meta = null;

/** Fetch and unpack the bake (once). */
export async function loadLampLight() {
  if (meta) return;
  meta = await (await fetch('./tex/lamplight.json')).json();
  const [img] = await Promise.all([
    fetch('./tex/light_volume.webp').then((r) => r.blob()).then((b) => createImageBitmap(b)),
    new Promise((res, rej) => new THREE.TextureLoader().load('./tex/ground_light.webp', (t) => {
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = 4;
      lampLight.ground.value = t;
      res();
    }, undefined, rej)),
  ]);
  const G = meta.grid;
  const S = meta.heights.length;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  // the image holds the slices side by side and the six directions one under another; the 3D texture stacks
  // them as layers: direction * slices + slice
  const data = new Uint8Array(G * G * S * 6 * 4);
  for (let d = 0; d < 6; d++) {
    for (let k = 0; k < S; k++) {
      const layer = d * S + k;
      for (let j = 0; j < G; j++) {
        const src = ((d * G + j) * img.width + k * G) * 4;
        data.set(px.subarray(src, src + G * 4), ((layer * G + j) * G) * 4);
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, G, G, S * 6);
  tex.format = THREE.RGBAFormat;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  lampLight.volume.value = tex;
  lampLight.scale.value = meta.scale * LAMP_GAIN;
}

/** Each frame: the lamps' overall power and the ghosts' blackouts (from the snapshot). */
export function updateLampLight(blackouts, power) {
  lampLight.power.value = power;
  const d = lampLight.dark.value;
  for (let i = 0; i < MAX_DARK; i++) {
    const b = blackouts?.[i];
    if (b) d[i].set(b.x, b.z, b.r, Math.min(1, b.t ?? 1, ((b.dur ?? 1) - (b.t ?? 0)) * 2));
    else d[i].w = 0;
  }
}

const GLSL = /* glsl */ `
  uniform highp sampler3D lampVol;
  uniform sampler2D lampGround;
  uniform float lampScale;
  uniform float lampPower;
  uniform vec4 lampDark[${MAX_DARK}];
  varying vec3 vLampW;
  float lampDarkAt(vec2 xz) {
    float k = 1.0;
    for (int i = 0; i < ${MAX_DARK}; i++) {
      vec4 b = lampDark[i];
      if (b.w > 0.0) k *= mix(1.0, smoothstep(b.z - 2.0, b.z + 6.0, distance(xz, b.xy)), b.w);
    }
    return k;
  }
  vec3 lampSlice(float dir, vec3 q) {
    float fy = clamp((q.y - 0.5) / 1.5, 0.0, 8.0);
    float k0 = floor(fy);
    float k1 = min(k0 + 1.0, 8.0);
    vec2 uv = (q.xz + 120.0) / 240.0;
    vec3 a = texture(lampVol, vec3(uv, (dir * 9.0 + k0 + 0.5) / 54.0)).rgb;
    vec3 b = texture(lampVol, vec3(uv, (dir * 9.0 + k1 + 0.5) / 54.0)).rgb;
    vec3 c = mix(a, b, fy - k0);
    return c * c;
  }
  /** The baked lamp light arriving at world point p on a surface facing n. */
  vec3 lampAt(vec3 p, vec3 n) {
    if (lampScale <= 0.0 || lampPower <= 0.0 || abs(p.x) > 119.0 || abs(p.z) > 119.0) return vec3(0.0);
    // read just outside the surface: the grid point inside a wall sees nothing
    vec3 q = p + n * 0.6;
    vec3 w = n * n;
    vec3 c = w.x * lampSlice(n.x > 0.0 ? 0.0 : 1.0, q) + w.y * lampSlice(n.y > 0.0 ? 2.0 : 3.0, q) + w.z * lampSlice(n.z > 0.0 ? 4.0 : 5.0, q);
    return c * lampScale * lampPower * lampDarkAt(p.xz);
  }
  /** The ground's sharper map (surfaces facing up at ground level). */
  vec3 lampGroundAt(vec3 p) {
    if (lampScale <= 0.0 || lampPower <= 0.0 || abs(p.x) > 120.0 || abs(p.z) > 120.0) return vec3(0.0);
    vec3 c = texture2D(lampGround, vec2((p.x + 120.0) / 240.0, (120.0 - p.z) / 240.0)).rgb;
    return c * c * lampScale * lampPower * lampDarkAt(p.xz);
  }
`;

/**
 * Add the baked lamp light to a standard material's shader (call from onBeforeCompile). It lands with the scene's
 * other ambient light, so ambient occlusion shades it too. ground: use the ground's own sharper map.
 */
export function addLampLight(sh, { ground = false } = {}) {
  Object.assign(sh.uniforms, {
    lampVol: lampLight.volume, lampGround: lampLight.ground, lampScale: lampLight.scale, lampPower: lampLight.power, lampDark: lampLight.dark,
  });
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vLampW;')
    .replace('#include <project_vertex>', `#include <project_vertex>
      {
        vec4 lw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          lw = instanceMatrix * lw;
        #endif
        vLampW = (modelMatrix * lw).xyz;
      }`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\n${GLSL}`)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      {
        vec3 lampN = inverseTransformDirection(normal, viewMatrix);
        reflectedLight.indirectDiffuse += BRDF_Lambert(diffuseColor.rgb) * ${ground ? 'lampGroundAt(vLampW)' : 'lampAt(vLampW, lampN)'};
      }`);
}
