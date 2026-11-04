// Rain: thousands of streaks and ground splashes animated entirely on the GPU in a box that follows the camera.
// Drops keep their place in the world as you move (the box wraps), catch the light of nearby lamps and lightning,
// and never fall under a roof: buildings, the big top, the bumper pavilion, the coaster station and the bus.
import * as THREE from 'three';
import { BUILDINGS, ARENA, BIGTOP, STATION, LAMPS, LAMP_HEAD } from '../shared/map.js';

const DROPS = 22000;
const SPLASHES = 3600;
const BOX = new THREE.Vector3(44, 24, 44);
const SPLASH_R = 16;
const MAX_LAMPS = 8;

/** Roofs as [cx, cz, half width, half depth] plus their height. */
const ROOFS = [
  ...BUILDINGS.map((b) => [b.cx, b.cz, b.w / 2 + 0.3, b.d / 2 + 0.3, b.h + 0.3]),
  [ARENA.x, ARENA.z, ARENA.w / 2 + 0.6, ARENA.d / 2 + 0.6, 6.5],
  [STATION.x, STATION.z, 3, 11.5, 4.9],
];

const SHELTER_GLSL = `
  uniform vec4 roofs[${ROOFS.length}]; uniform float roofH[${ROOFS.length}];
  uniform vec4 bus; uniform vec2 busDir;
  float sheltered(vec3 p) {
    for (int i = 0; i < ${ROOFS.length}; i++) {
      vec4 r = roofs[i];
      if (abs(p.x - r.x) < r.z && abs(p.z - r.y) < r.w && p.y < roofH[i]) return 1.0;
    }
    vec2 d = p.xz - vec2(${BIGTOP.x.toFixed(1)}, ${BIGTOP.z.toFixed(1)});
    if (dot(d, d) < ${(BIGTOP.r + 0.5) ** 2} && p.y < ${(BIGTOP.h + 6).toFixed(1)}) return 1.0;
    // the bus: an oriented box (x, z, half length, roof height)
    vec2 b = p.xz - bus.xy;
    float along = dot(b, busDir);
    float across = dot(b, vec2(-busDir.y, busDir.x));
    if (abs(along) < bus.z && abs(across) < 1.45 && p.y < bus.w) return 1.0;
    return 0.0;
  }
  uniform vec4 lamps[${MAX_LAMPS}];
  uniform float flash; uniform float ambient;
  vec3 lightAt(vec3 p) {
    vec3 c = vec3(0.55, 0.62, 0.75) * (ambient + flash * 6.0);
    for (int i = 0; i < ${MAX_LAMPS}; i++) {
      vec3 d = p - lamps[i].xyz;
      c += vec3(1.0, 0.78, 0.5) * lamps[i].w / (1.0 + dot(d, d) * 0.12);
    }
    return c;
  }
`;

/** True when a point is under one of the roofs that keep the rain off (for muffling the rain sound indoors). */
export function sheltered(x, y, z, busState) {
  for (const [cx, cz, hw, hd, h] of ROOFS) if (Math.abs(x - cx) < hw && Math.abs(z - cz) < hd && y < h) return true;
  if (Math.hypot(x - BIGTOP.x, z - BIGTOP.z) < BIGTOP.r + 0.5 && y < BIGTOP.h + 6) return true;
  if (busState) {
    const fx = -Math.sin(busState.yaw);
    const fz = -Math.cos(busState.yaw);
    const dx = x - busState.x;
    const dz = z - busState.z;
    if (Math.abs(dx * fx + dz * fz) < 5.2 && Math.abs(-dx * fz + dz * fx) < 1.45 && y < 3.4) return true;
  }
  return false;
}

export class Rain {
  constructor(scene) {
    this.time = 0;
    this.amount = 0;
    this.shared = {
      time: { value: 0 },
      amount: { value: 0 },
      wind: { value: new THREE.Vector2(1.6, 0.7) },
      flash: { value: 0 },
      ambient: { value: 1 },
      roofs: { value: ROOFS.map(([x, z, hw, hd]) => new THREE.Vector4(x, z, hw, hd)) },
      roofH: { value: ROOFS.map((r) => r[4]) },
      bus: { value: new THREE.Vector4(0, 9999, 5.2, 3.4) },
      busDir: { value: new THREE.Vector2(0, 1) },
      lamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()) },
    };
    this.lampPos = LAMPS.map((l) => new THREE.Vector3(l.x + LAMP_HEAD.x, l.y - 0.2, l.z));
    this.drops = this.buildDrops();
    this.splashes = this.buildSplashes();
    scene.add(this.drops, this.splashes);
  }

  buildDrops() {
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    const seed = new Float32Array(DROPS * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = DROPS;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.shared, box: { value: BOX } },
      vertexShader: `
        attribute vec4 seed;
        uniform float time; uniform float amount; uniform vec2 wind; uniform vec3 box;
        varying vec2 vUv; varying float vA; varying vec3 vLight;
        ${SHELTER_GLSL}
        void main() {
          vUv = uv;
          float speed = 8.5 + seed.w * 2.5;
          vec3 vel = vec3(wind.x, -speed, wind.y);
          // fall through a tile of world space; wrapping it around the camera keeps every drop fixed in the world
          vec3 p = seed.xyz * box + vel * time;
          vec3 origin = cameraPosition - vec3(box.x * 0.5, 7.0, box.z * 0.5);
          p = origin + mod(p - origin, box);
          vec3 dir = normalize(vel);
          vec3 toCam = cameraPosition - p;
          float dist = length(toCam);
          vec3 side = normalize(cross(dir, toCam / dist));
          // motion-blurred streak; never thinner than about a pixel, but fainter when widened
          float width = max(0.006, dist * 0.0011);
          float len = 0.35 + seed.w * 0.35;
          vec3 world = p + side * position.x * width + dir * position.y * len;
          float hd = length(p.xz - cameraPosition.xz);
          vA = step(seed.w, amount) * (1.0 - sheltered(p)) * step(0.0, p.y)
            * smoothstep(0.4, 1.6, dist) * (1.0 - smoothstep(box.x * 0.32, box.x * 0.5, hd))
            * clamp(0.012 / width, 0.2, 1.0);
          vLight = lightAt(p);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
          if (vA <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv; varying float vA; varying vec3 vLight;
        void main() {
          float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
          float a = vA * across * smoothstep(0.0, 0.7, vUv.y) * 0.36;
          gl_FragColor = vec4(vLight, a);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 6;
    return m;
  }

  buildSplashes() {
    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    const seed = new Float32Array(SPLASHES * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = SPLASHES;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.shared },
      vertexShader: `
        attribute vec4 seed;
        uniform float time; uniform float amount;
        varying vec2 vUv; varying float vA; varying float vPh; varying vec3 vLight;
        ${SHELTER_GLSL}
        float h1(float n) { return fract(sin(n) * 43758.5453); }
        void main() {
          vUv = uv;
          // each splash lives for a fraction of a second, then lands somewhere new
          float period = 0.35 + seed.z * 0.45;
          float cyc = time / period + seed.w * 7.0;
          float k = floor(cyc);
          vPh = fract(cyc);
          vec2 q = vec2(h1(k * 12.9898 + seed.x * 78.233), h1(k * 39.3468 + seed.y * 11.135)) * ${SPLASH_R * 2}.0;
          vec2 origin = cameraPosition.xz - ${SPLASH_R}.0;
          vec2 xz = origin + mod(q - origin, ${SPLASH_R * 2}.0);
          vec3 p = vec3(xz.x, 0.025, xz.y);
          float size = 0.05 + vPh * 0.16;
          float d = length(xz - cameraPosition.xz);
          vA = step(seed.x, amount) * (1.0 - sheltered(p + vec3(0.0, 0.2, 0.0))) * (1.0 - smoothstep(${SPLASH_R * 0.6}, ${SPLASH_R}.0, d));
          vLight = lightAt(p + vec3(0.0, 0.5, 0.0));
          gl_Position = projectionMatrix * viewMatrix * vec4(p + position * size, 1.0);
          if (vA <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv; varying float vA; varying float vPh; varying vec3 vLight;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          // a thin ring spreading out, brightest the instant the drop lands
          float ring = smoothstep(0.62, 0.85, r) * (1.0 - smoothstep(0.85, 1.0, r));
          float a = vA * (ring * 0.6 + (1.0 - smoothstep(0.0, 0.35, r)) * (1.0 - smoothstep(0.0, 0.25, vPh))) * (1.0 - vPh) * 0.28;
          gl_FragColor = vec4(vLight * 0.55, a);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 6;
    return m;
  }

  /** Draw only a share of the drops (graphics quality). */
  setDensity(k) {
    this.drops.geometry.instanceCount = Math.round(DROPS * k);
    this.splashes.geometry.instanceCount = Math.round(SPLASHES * k);
  }

  /**
   * amount: 0..1 of the drops falling. flash: lightning brightness. bus: snapshot bus state (or null).
   */
  update(dt, camera, { amount, flash = 0, bus = null, ambient = 1 }) {
    this.time += dt;
    const u = this.shared;
    u.time.value = this.time % 1000;
    u.amount.value = amount;
    u.flash.value = flash;
    u.ambient.value = ambient;
    // gusts swing the slant around a little
    u.wind.value.set(1.6 + Math.sin(this.time * 0.13) * 1.2, 0.7 + Math.sin(this.time * 0.09 + 1) * 0.9);
    if (bus) {
      // from inside the cabin no drop over the bus can be seen (the roof hides them, and long streaks poked through)
      const fx = -Math.sin(bus.yaw);
      const fz = -Math.cos(bus.yaw);
      const dx = camera.position.x - bus.x;
      const dz = camera.position.z - bus.z;
      const inside = Math.abs(dx * fx + dz * fz) < 5.2 && Math.abs(-dx * fz + dz * fx) < 1.45 && camera.position.y < 3.4;
      u.bus.value.set(bus.x, bus.z, 5.2, inside ? 60 : 3.4);
      u.busDir.value.set(fx, fz);
    } else u.bus.value.set(0, 9999, 0, 0);
    // the nearest lamps light up the rain falling past them, and so do the bus headlights out in front of it
    const c = camera.position;
    const near = this.lampPos
      .map((p) => [p, p.distanceToSquared(c)])
      .sort((a, b) => a[1] - b[1]);
    let slot = 0;
    if (bus) {
      const fx = -Math.sin(bus.yaw);
      const fz = -Math.cos(bus.yaw);
      for (const ahead of [7, 15]) u.lamps.value[slot++].set(bus.x + fx * ahead, 1.4, bus.z + fz * ahead, ahead < 10 ? 2.5 : 1.2);
    }
    for (let i = 0; slot < MAX_LAMPS; i++, slot++) {
      const l = near[i];
      if (l && l[1] < 60 * 60) u.lamps.value[slot].set(l[0].x, l[0].y, l[0].z, 0.9);
      else u.lamps.value[slot].set(0, -999, 0, 0);
    }
  }
}
