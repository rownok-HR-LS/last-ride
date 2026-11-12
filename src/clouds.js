// The storm sky: clouds drifting across the night sky photo, in front of the moon and stars. The clouds are a
// Blender render of real volumetric cloud seen from below (scripts/blender/render-clouds.py, packed by
// scripts/pack-clouds.mjs: red = lit by the moon, green = how much sky they hide, blue = lit from inside by
// lightning), tiling seamlessly. Two layers of it slide over a dome that travels with the camera, at different
// sizes and speeds, with the wind (src/motion.js windAmp; the same way the flags stream). How much sky they cover
// goes with the night: a thunderstorm is nearly overcast, a clear-moon night has a few torn rags of cloud. When
// lightning flashes, the clouds light up from inside.
import * as THREE from 'three';
import { windAmp } from './motion.js';

/** How much of the sky the clouds cover on each kind of night (shared/constants.js NIGHTS). */
const COVER = { thunder: 0.95, storm: 0.82, drizzle: 0.66, fog: 0.6, moon: 0.24 };
/** The way the wind carries them (as the flags stream: src/flags.js HEADING). */
const WIND = new THREE.Vector2(Math.cos(0.9), -Math.sin(0.9));

const VERT = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p;
  }`;
const FRAG = `
  uniform sampler2D map; uniform vec2 drift; uniform float cover; uniform float flash; uniform float dim;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    if (d.y < 0.01) discard;
    // where this ray meets a flat sheet of cloud overhead (flattened toward the horizon so it doesn't smear)
    vec2 p = d.xz / (d.y + 0.12);
    vec3 a = texture2D(map, p * 0.16 + drift).rgb;
    vec3 b = texture2D(map, p * 0.071 + drift * 0.55 + vec2(0.37, 0.61)).rgb;
    // how thick the cloud is here, both layers together; less cover keeps only the thickest parts
    float lo = 1.0 - cover;
    float ca = smoothstep(lo * 0.9, lo * 0.9 + 0.45, a.g);
    float cb = smoothstep(lo * 0.9, lo * 0.9 + 0.45, b.g);
    float alpha = 1.0 - (1.0 - ca) * (1.0 - cb * 0.85);
    float lum = mix(b.r, a.r, ca / max(ca + cb, 0.001));
    lum = pow(lum, 1.6);
    float glow = max(a.b * ca, b.b * cb);
    // moonlit grey-blue; lightning lights them from inside, blue-white
    vec3 col = vec3(0.5, 0.58, 0.74) * lum * dim + vec3(0.7, 0.8, 1.0) * glow * glow * flash * 0.5;
    // they thin into the haze toward the horizon
    alpha *= smoothstep(0.02, 0.22, d.y);
    gl_FragColor = vec4(col, alpha);
  }`;

/** The cloud dome. update(dt, camera, night, flash) each frame. */
export function buildClouds(scene) {
  const tex = new THREE.TextureLoader().load('./tex/clouds.webp');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  const uniforms = { map: { value: tex }, drift: { value: new THREE.Vector2() }, cover: { value: 0.8 }, flash: { value: 0 }, dim: { value: 1 } };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.BackSide, fog: false }),
  );
  mesh.name = 'clouds';
  mesh.frustumCulled = false;
  // behind every other see-through thing (the horizon's hills, rain, ghosts)
  mesh.renderOrder = -20;
  scene.add(mesh);
  return {
    mesh,
    /** night: the snapshot's night name; flash: the lightning (0..1); dim: how dark the sky is tonight. */
    update(dt, camera, night, flash, dim = 1) {
      mesh.position.copy(camera.position);
      const u = uniforms;
      u.drift.value.addScaledVector(WIND, dt * (0.0015 + 0.0045 * windAmp.value));
      const want = COVER[night] ?? COVER.storm;
      u.cover.value += (want - u.cover.value) * Math.min(1, dt * 0.5);
      u.flash.value = flash;
      u.dim.value = dim;
    },
  };
}
