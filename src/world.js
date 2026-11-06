// Builds the static park: sky, ground, lighting and every prop from shared/map.js.
// Static geometry is merged per material to keep draw calls low.
import * as THREE from 'three';
import { softShaft, nightAir } from './shafts.js';
import { wetten, groundAO } from './wet.js';
import { addLampLight, loadLampLight } from './lamplight.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { PROPS, LAMPS, LAMP_HEAD, PARK_EDGE, PRIZE_BOOTHS, DECOR, LANDMARKS_OUT, rotXZ } from '../shared/map.js';
import { rng } from '../shared/rng.js';
import { glow, signTex, pbr, grimyStripes, pathMask } from './textures.js';
import { plantTrees } from './trees.js';
import { buildScatter } from './scatter.js';
import { placeModels } from './models.js';
import { dressBuildings } from './buildings.js';

// ------------------------------------------------------------------ materials

const MATS = {};
function std(key, color, opts = {}, world = 0) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts });
  MATS[key] = { mat: m, world };
  return m;
}

/** Photo-textured material. world = metres per texture tile for world-space UVs (0 keeps model UVs). */
function photo(key, tex, { color = '#ffffff', world = 2, normal = 1, metal = false, rough = 1 } = {}) {
  const t = pbr(tex);
  const m = new THREE.MeshStandardMaterial({
    color, map: t.map, normalMap: t.normalMap, roughnessMap: t.arm, roughness: rough,
    metalnessMap: metal ? t.arm : null, metalness: metal ? 1 : 0,
  });
  m.normalScale.set(normal, normal);
  MATS[key] = { mat: m, world };
  return m;
}

/** Old flaking paint: a muted version of the colour over cracked plaster. */
function paint(key, hex, world = 2) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s * 0.45, Math.min(0.42, hsl.l * 0.7));
  const t = pbr('damaged_plaster');
  const m = new THREE.MeshStandardMaterial({ color: c, normalMap: t.normalMap, roughnessMap: t.arm, roughness: 1 });
  m.normalScale.set(0.8, 0.8);
  MATS[key] = { mat: m, world };
  return m;
}

export function initMaterials() {
  photo('iron', 'rusty_metal_02', { color: '#6a625e', metal: true, world: 1.5 });
  photo('metal', 'rusty_metal_02', { color: '#9a948e', metal: true, world: 1.5 });
  photo('rust', 'rust_coarse_01', { world: 1.5 });
  photo('gold', 'rusty_metal_02', { color: '#a7864a', metal: true, world: 1 });
  photo('wood', 'weathered_planks', { world: 2.4 });
  photo('woodDark', 'old_planks_02', { color: '#9a8c80', world: 2.4 });
  photo('crate', 'old_planks_02', { color: '#8c7c68', world: 1.2 });
  photo('bark', 'old_planks_02', { color: '#4a4038', world: 1.2 });
  photo('stone', 'concrete_floor_worn_001', { world: 3 });
  photo('concrete', 'cracked_concrete_wall', { world: 3 });
  const tent = (key, a, b, seed) => {
    const t = pbr('damaged_plaster');
    const m = new THREE.MeshStandardMaterial({ map: grimyStripes(a, b, 2, seed), normalMap: t.normalMap, roughness: 0.95, side: THREE.DoubleSide });
    m.normalScale.set(0.5, 0.5);
    MATS[key] = { mat: m, world: 0 };
  };
  tent('tentRed', '#4e1a1c', '#8c836c', 1);
  tent('tentPurple', '#2c2236', '#7d7462', 2);
  tent('tentGreen', '#1f2e26', '#857c66', 3);
  tent('awning', '#5a1d20', '#8f8670', 4);
  photo('funhouse', 'damaged_plaster', { color: '#8a7a8c', world: 4 });
  photo('tunnel', 'red_brick_03', { color: '#8a7a74', world: 3 });
  photo('arcade', 'painted_metal_shutter', { color: '#a8b0b0', world: 3, metal: true });
  photo('roof', 'corrugated_iron_02', { color: '#8a8580', metal: true, world: 3 });
  // building dressing: concrete footings and copings, dark weathered timber trim, boarded-up windows, rusty pipes
  photo('plinth', 'cracked_concrete_wall', { color: '#77736c', world: 2.5 });
  photo('trim', 'weathered_planks', { color: '#5c544a', world: 1.5 });
  photo('boards', 'old_planks_02', { color: '#6b6258', world: 1.2 });
  photo('pipe', 'rusty_metal_02', { color: '#6a5f55', metal: true, world: 1 });
  std('rubber', '#141313', { roughness: 0.95 });
  photo('checker', 'concrete_floor_worn_001', { color: '#6a6660', world: 3 });
  photo('trailer', 'painted_metal_shutter', { color: '#9a9a96', metal: true, world: 3 });
  photo('tank', 'rusty_metal_02', { color: '#7a7a78', metal: true, world: 3 });
  photo('cream', 'damaged_plaster', { color: '#b8ae98', world: 2 });
  std('dark', '#0c0b0b', { roughness: 1 });
  paint('teal', '#1b8a8a');
  std('skin', '#c9a48a');
  for (const c of ['#e2384f', '#2f9be0', '#f2b632', '#8e44d6', '#2fbf87', '#f0702c', '#ffffff', '#3a2a4a']) paint(c, c);
  const bulb = (key, color, i) => {
    MATS[key] = { mat: new THREE.MeshStandardMaterial({ color: '#000', emissive: color, emissiveIntensity: i }), world: 0 };
  };
  // most of the old bulbs are dead; the few that work glow a sick yellow
  bulb('bulb', '#ffb35a', 1.2);
  bulb('bulbPink', '#2a1a1a', 0.2);
  bulb('bulbCyan', '#1a2222', 0.2);
  bulb('bulbRed', '#ff2a1a', 1.6);
  bulb('bulbGreen', '#9aff9a', 0.9);
  // everything built from these gets wet in the rain (the glowing bulbs are left alone)
  for (const [k, e] of Object.entries(MATS)) if (!k.startsWith('bulb')) wetten(e.mat);
  return MATS;
}

export function mat(key) {
  if (!MATS[key] && key.startsWith('#')) paint(key, key);
  return MATS[key].mat;
}

// ------------------------------------------------------------------ merged static builder

const tmpM = new THREE.Matrix4();
const tmpE = new THREE.Euler();
const tmpQ = new THREE.Quaternion();

/** World-space planar UVs so tiling textures look right on any wall. */
function worldUV(geo, scale) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    let u;
    let v;
    if (ny >= nx && ny >= nz) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else if (nx >= nz) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv[i * 2] = u / scale;
    uv[i * 2 + 1] = v / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export class Builder {
  constructor() {
    this.parts = new Map();
  }

  /** Add geometry placed in prop space: P {x, z, rot}, local offset, local euler. */
  add(key, geo, P, lx = 0, ly = 0, lz = 0, rx = 0, ry = 0, rz = 0, scaleUV = null) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (scaleUV) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * scaleUV[0], uv.getY(i) * scaleUV[1]);
    }
    const rot = P.rot || 0;
    const [ox, oz] = rotXZ(lx, lz, rot);
    tmpE.set(rx, ry + rot, rz, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(new THREE.Vector3(P.x + ox, (P.y || 0) + ly, P.z + oz), tmpQ, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(tmpM);
    if (!MATS[key] && key.startsWith('#')) paint(key, key);
    const entry = MATS[key];
    if (!entry) throw new Error(`no material ${key}`);
    if (entry.world) worldUV(g, entry.world);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    if (geo !== g && !geo.userData.keep) geo.dispose?.();
  }

  box(key, P, lx, ly, lz, w, h, d, ry = 0, rx = 0, rz = 0) {
    this.add(key, new THREE.BoxGeometry(w, h, d), P, lx, ly, lz, rx, ry, rz);
  }

  cyl(key, P, lx, ly, lz, rTop, rBot, h, seg = 10, rx = 0, rz = 0, open = false) {
    this.add(key, new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open), P, lx, ly, lz, rx, 0, rz);
  }

  sphere(key, P, lx, ly, lz, r, seg = 8) {
    this.add(key, new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1)), P, lx, ly, lz);
  }

  build(parent, { shadows = true } = {}) {
    for (const [key, list] of this.parts) {
      const geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      const mesh = new THREE.Mesh(geo, MATS[key].mat);
      mesh.castShadow = shadows && !key.startsWith('bulb');
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
    }
    this.parts.clear();
  }
}

/** Alpha mask for the road: solid down the middle, crumbling away at both edges. */
function roadEdgeTex() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 1024;
  const ctx = c.getContext('2d');
  const rr = rng(515);
  const img = ctx.createImageData(c.width, c.height);
  for (let y = 0; y < c.height; y++) {
    // the broken edge wanders along the road
    const wobL = Math.sin(y * 0.05) * 3 + Math.sin(y * 0.013) * 4;
    const wobR = Math.sin(y * 0.043 + 2) * 3 + Math.sin(y * 0.011 + 1) * 4;
    for (let x = 0; x < c.width; x++) {
      const dl = x - (9 + wobL);
      const dr = c.width - 1 - x - (9 + wobR);
      const d = Math.min(dl, dr);
      let a = Math.max(0, Math.min(1, 0.5 + d / 8));
      if (d < 6) a *= 0.55 + rr() * 0.6;
      const i = (y * c.width + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(Math.min(1, a) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// ------------------------------------------------------------------ signs

export function neonSign(text, color, w) {
  const { texture, glow: lit } = signTex(text, { color });
  const m = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: lit, emissive: '#ffffff', emissiveIntensity: 1.4, roughness: 0.8, side: THREE.DoubleSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), m);
}

// ------------------------------------------------------------------ props

const r = rng(77);

function fence(B, p) {
  const n = Math.round(p.len / 2);
  for (let i = 0; i <= n; i++) {
    const lx = -p.len / 2 + (i * p.len) / n;
    B.box('iron', p, lx, 1.7, 0, 0.12, 3.4, 0.12);
    B.add('iron', new THREE.ConeGeometry(0.1, 0.4, 5), p, lx, 3.55, 0);
    for (let k = 1; k < 4 && i < n; k++) B.box('iron', p, lx + (k * p.len) / n / 4, 1.6, 0, 0.05, 3.0, 0.05);
  }
  B.box('iron', p, 0, 3.0, 0, p.len, 0.1, 0.1);
  B.box('iron', p, 0, 0.4, 0, p.len, 0.1, 0.1);
}

function wallProp(B, p) {
  const y0 = p.y0 || 0;
  B.box(p.style, { x: p.x, z: p.z, rot: p.rot }, 0, y0 + p.h / 2, 0, p.w, p.h, p.d);
}

function roofProp(B, p) {
  // p.y is the roof height; the builder would add it again if p went in as the placement
  const P = { x: p.x, z: p.z, rot: p.rot || 0 };
  B.box('roof', P, 0, p.y + 0.18, 0, p.w, 0.36, p.d);
  B.box('dark', P, 0, p.y + 0.45, 0, p.w - 0.4, 0.2, p.d - 0.4);
}

function booth(B, p) {
  // a rusted corrugated shack (Sketchfab scan) with the game counter and the creepy prizes kept in front of it
  modelSpots.push(['shack_open', { x: p.x, z: p.z, rot: p.rot, yaw: Math.PI, w: 4.7, d: 3.1, h: 3.3, uniform: false }]);
  B.box(p.color, p, 0, 0.52, 1.1, 4.0, 1.05, 0.45);
  B.box('cream', p, 0, 1.08, 1.12, 4.1, 0.06, 0.55);
  for (let i = 0; i < 6; i++) {
    const lx = -1.6 + i * 0.64;
    const col = ['#e2384f', '#2f9be0', '#f2b632', '#8e44d6', '#2fbf87', '#f0702c'][(i + Math.floor(r() * 6)) % 6];
    B.sphere(col, p, lx, 1.35 + (i % 2) * 0.3, -0.6, 0.2, 7);
    B.sphere(col, p, lx, 1.65 + (i % 2) * 0.3, -0.6, 0.14, 7);
  }
}

function crate(B, p) {
  const layers = Math.max(1, Math.round(p.h / 1.4));
  const lh = p.h / layers;
  for (let i = 0; i < layers; i++) {
    const ry = i * 0.3;
    const y0 = lh * i;
    const P = { x: p.x, z: p.z, rot: (p.rot || 0) + ry };
    B.add('crate', new THREE.BoxGeometry(p.s - 0.06, lh - 0.04, p.s - 0.06), P, 0, y0 + lh / 2, 0);
    // a shipping crate's frame: corner posts, rims top and bottom, a brace across each side
    const e = p.s / 2 - 0.04;
    const t = 0.1;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box('trim', P, sx * e, y0 + lh / 2, sz * e, t, lh, t);
    for (const y of [y0 + 0.05, y0 + lh - 0.05]) {
      for (const s of [-1, 1]) {
        B.box('trim', P, 0, y, s * e, p.s, t, t);
        B.box('trim', P, s * e, y, 0, t, t, p.s);
      }
    }
    const diag = Math.atan2(lh - 0.2, p.s - 0.2);
    const len = Math.hypot(lh - 0.2, p.s - 0.2);
    for (const s of [-1, 1]) {
      B.box('trim', P, 0, y0 + lh / 2, s * (e + 0.02), len, 0.09, 0.05, 0, 0, s * diag);
      B.box('trim', P, s * (e + 0.02), y0 + lh / 2, 0, 0.05, 0.09, len, 0, s * diag, 0);
    }
  }
}

/** Scanned models placed into prop footprints once the world is built: [model, placement options]. */
const modelSpots = [];

/** Park trees are collected here and planted (instanced) once the props are built. */
const parkTrees = [];
function tree(B, p) {
  parkTrees.push({ x: p.x, z: p.z, h: 5.8 * p.s, rot: p.rot });
}

function lampPost(B, p) {
  // a weathered concrete pole from Pripyat (scan), its arm reaching out along +x to the lamp
  modelSpots.push(['light_poles#LightPole_01_2', { x: p.x + 0.95, z: p.z, rot: 0, yaw: Math.PI / 2, w: 2.35, d: 0.6, h: 6.15 }]);
}

function trash(B, p) {
  modelSpots.push(['trash_bags', { x: p.x, z: p.z, rot: (p.x * 3.1 + p.z) % 6.28, w: 1.6, d: 1.6 }]);
}

function cart(B, p) {
  B.box(p.kind === 'popcorn' ? '#e2384f' : p.kind === 'candy' ? '#8e44d6' : '#f2b632', p, 0, 0.75, 0, 1.4, 1.0, 2.4);
  B.box('cream', p, 0, 1.3, 0, 1.5, 0.1, 2.5);
  for (const sz of [-0.8, 0.8]) B.cyl('dark', p, 0.75, 0.32, sz, 0.32, 0.32, 0.1, 12, 0, Math.PI / 2);
  B.cyl('iron', p, 0, 2.0, 0, 0.04, 0.04, 1.4, 6);
  B.add('awning', new THREE.ConeGeometry(1.5, 0.7, 12, 1, true), p, 0, 2.9, 0, 0, 0, 0, [6, 1]);
  if (p.kind === 'popcorn') B.box('#fff4c4', p, 0, 1.75, 0, 1.0, 0.8, 1.0);
}

function bigtop(B, p) {
  // the guy ropes reach well past the canvas: the canvas itself is about half the model's width
  modelSpots.push(['bigtop', { x: p.x, z: p.z, rot: 0.4, w: p.r * 3.9, d: p.r * 3.9 }]);
  bigtopLights(B, p);
}

/** Light strings from the big top down to the plaza. */
function bigtopLights(B, p) {
  // light strings from the roof rim down to the plaza
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const x0 = Math.cos(a) * (p.r + 0.4);
    const z0 = Math.sin(a) * (p.r + 0.4);
    const x1 = Math.cos(a) * (p.r + 8);
    const z1 = Math.sin(a) * (p.r + 8);
    for (let k = 1; k < 12; k++) {
      const t = k / 12;
      const y = p.h - 0.4 + (3 - p.h) * t - Math.sin(t * Math.PI) * 1.4;
      B.sphere(i % 2 ? 'bulb' : 'bulbPink', { x: 0, z: 0 }, x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, 0.09, 5);
    }
    B.cyl('iron', { x: x1, z: z1 }, 0, 1.6, 0, 0.06, 0.08, 3.2, 6);
  }
}

function gametent(B, p) {
  // a weathered striped circus tent (Sketchfab scan)
  modelSpots.push(['tent_small', { x: p.x, z: p.z, rot: (p.x + p.z) % 6.28, w: p.r * 2.1, d: p.r * 2.1 }]);
}

function arch(B) {
  const P = { x: 0, z: 110, rot: 0 };
  for (const sx of [-7, 7]) {
    B.add('tentPurple', new THREE.BoxGeometry(2.2, 9, 2.2), P, sx, 4.5, 0, 0, 0, 0, [2, 4]);
    B.sphere('gold', P, sx, 9.6, 0, 0.9, 12);
  }
  B.box('#3a2a4a', P, 0, 8.6, 0, 16, 2, 1.4);
  for (let i = 0; i < 22; i++) B.sphere(i % 2 ? 'bulb' : 'bulbPink', P, -7.5 + i * 0.72, 7.55, 0.75, 0.1, 6);
}

function ticket(B, p) {
  modelSpots.push(['kiosk', { x: p.x, z: p.z, rot: p.rot || 0, w: 2.8, d: 2.6 }]);
}

function freefall(B, p) {
  B.cyl('#3a2a4a', p, 0, 24, 0, 1.2, 2.2, 48, 12);
  for (let y = 4; y < 48; y += 4) B.add('gold', new THREE.TorusGeometry(1.3 + (48 - y) * 0.02, 0.08, 4, 16), p, 0, y, 0, Math.PI / 2);
  B.cyl('concrete', p, 0, 0.2, 0, 5, 5, 0.4, 20);
  B.sphere('bulbRed', p, 0, 48.6, 0, 0.5, 8);
}

function control(B, p) {
  B.box('#2f9be0', p, 0, 1.35, 0, 2.4, 2.7, 2.2);
  B.box('dark', p, 0, 1.8, 1.11, 1.8, 0.9, 0.05);
  B.box('roof', p, 0, 2.8, 0, 2.8, 0.2, 2.6);
}

function arena(B, p) {
  const P = { x: p.x, z: p.z, rot: 0 };
  // steel floor plates the cars ran on, rusted through the paint
  B.box('pipe', P, 0, 0.09, 0, p.w, 0.18, p.d);
  for (let x = -p.w / 2 + 2; x < p.w / 2; x += 2) B.box('dark', P, x, 0.181, 0, 0.03, 0.002, p.d);
  // the electrified mesh ceiling the poles touched, under a corrugated roof with timber fascia
  for (let x = -p.w / 2 + 1; x < p.w / 2; x += 1.2) B.box('iron', P, x, 5.85, 0, 0.03, 0.03, p.d - 1);
  for (let z = -p.d / 2 + 1; z < p.d / 2; z += 1.2) B.box('iron', P, 0, 5.84, z, p.w - 1, 0.03, 0.03);
  B.box('roof', P, 0, 6.45, 0, p.w + 1.2, 0.08, p.d + 1.2);
  for (const sz of [-1, 1]) B.box('trim', P, 0, 6.2, (sz * (p.d + 1.2)) / 2, p.w + 1.3, 0.5, 0.08);
  for (const sx of [-1, 1]) B.box('trim', P, (sx * (p.w + 1.2)) / 2, 6.2, 0, 0.08, 0.5, p.d + 1.3);
  for (const sz of [-1, 1]) {
    B.box('#f2b632', P, -p.w / 4 - 1.5, 0.4, (sz * p.d) / 2, p.w / 2 - 3, 0.75, 0.5);
    B.box('#f2b632', P, p.w / 4 + 1.5, 0.4, (sz * p.d) / 2, p.w / 2 - 3, 0.75, 0.5);
  }
  for (const sx of [-1, 1]) B.box('#f2b632', P, (sx * p.w) / 2, 0.4, 0, 0.5, 0.75, p.d);
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) B.cyl('iron', P, (sx * p.w) / 2, 3, (sz * p.d) / 2, 0.3, 0.3, 6, 8);
  B.box('iron', P, 0, 6.0, 0, p.w - 1, 0.06, p.d - 1);
  for (let i = 0; i < 30; i++) {
    const t = i / 30;
    const per = 2 * (p.w + p.d);
    let d = t * per;
    let lx;
    let lz;
    if (d < p.w) [lx, lz] = [-p.w / 2 + d, -p.d / 2 - 0.5];
    else if ((d -= p.w) < p.d) [lx, lz] = [p.w / 2 + 0.5, -p.d / 2 + d];
    else if ((d -= p.d) < p.w) [lx, lz] = [p.w / 2 - d, p.d / 2 + 0.5];
    else [lx, lz] = [-p.w / 2 - 0.5, p.d / 2 - (d - p.w)];
    B.sphere(i % 3 ? 'bulb' : 'bulbCyan', P, lx, 5.95, lz, 0.1, 6);
  }
}

function station(B, p) {
  // the loading platform: a planked deck on a concrete base, the track on its -x side
  const P = { x: p.x, z: p.z, rot: 0 };
  B.box('plinth', P, 0.05, 0.44, 0, p.w - 0.1, 0.88, p.d - 0.1);
  B.box('trim', P, 0, 0.94, 0, p.w, 0.12, p.d);
  // painted safety edge along the track and a timber kerb
  B.box('#f2b632', P, -p.w / 2 + 0.2, 1.005, 0, 0.35, 0.02, p.d);
  B.box('trim', P, -p.w / 2 + 0.03, 0.75, 0, 0.08, 0.5, p.d);
  // concrete steps up from the path
  B.box('plinth', P, 3.2, 0.25, 0, 1.4, 0.5, 6);
  B.box('plinth', P, 2.75, 0.62, 0, 0.5, 0.24, 6);
  // rusty steel posts with knee braces, a corrugated roof that sheds water toward the back
  for (const dz of [-10, 0, 10]) {
    B.cyl('pipe', P, 2.1, 2.8, dz, 0.16, 0.18, 3.6, 10);
    B.box('pipe', P, 2.1, 1.05, dz, 0.45, 0.1, 0.45);
    B.box('pipe', P, 1.25, 4.05, dz, 0.1, 0.1, 2.2, 0, 0, 0.75);
  }
  B.box('pipe', P, 2.1, 4.55, 0, 0.22, 0.22, 22.6);
  B.box('roof', P, 0, 4.75, 0, 6, 0.08, 23, 0, 0, -0.06);
  for (const sx of [-1, 1]) B.box('trim', P, sx * 3.0, 4.72 + sx * -0.18, 0, 0.06, 0.3, 23);
  B.box('trim', P, 0, 4.72, -11.5, 6, 0.3, 0.06, 0, 0, -0.06);
  B.box('trim', P, 0, 4.72, 11.5, 6, 0.3, 0.06, 0, 0, -0.06);
  B.cyl('pipe', P, 3.1, 4.5, 0, 0.09, 0.09, 23, 8, Math.PI / 2);
  // hand rails along the back, open where the steps come up
  for (const [z0, z1] of [[-11, -3.4], [3.4, 11]]) {
    const mid = (z0 + z1) / 2;
    const len = z1 - z0;
    for (const y of [1.55, 2.0]) B.box('pipe', P, p.w / 2 - 0.1, y, mid, 0.05, 0.05, len);
    for (let z = z0; z <= z1 + 0.01; z += len / 4) B.box('pipe', P, p.w / 2 - 0.1, 1.5, z, 0.06, 1.0, 0.06);
  }
  // the operator's booth at the far end, its window long since smashed
  B.box('trailer', P, 1.0, 2.2, 9.5, 2, 2.4, 2);
  B.box('dark', P, 0.0, 2.6, 9.5, 0.04, 0.9, 1.3);
  B.box('roof', P, 1.0, 3.45, 9.5, 2.3, 0.1, 2.3);
}

function trailer(B, p) {
  B.box('trailer', p, 0, 1.6, 0, 8, 2.6, 2.8);
  B.box('#2f9be0', p, 0, 1.5, 0, 8.02, 0.3, 2.82);
  for (const sx of [-2.6, 2.6]) B.cyl('dark', p, sx, 0.35, 0, 0.35, 0.35, 2.9, 12, Math.PI / 2);
  for (const sx of [-2, 0, 2]) B.box('dark', p, sx, 2.1, 1.41, 1, 0.6, 0.04);
}

function watertower(B, p) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl('iron', p, sx * 2.6, 6, sz * 2.6, 0.18, 0.25, 12, 6);
  B.cyl('tank', p, 0, 14.5, 0, 4, 4, 5, 20);
  B.add('roof', new THREE.ConeGeometry(4.3, 2.4, 20), p, 0, 18.2, 0);
}

function table(B, p) {
  B.box('wood', p, 0, 0.75, 0, 2.2, 0.08, 0.9);
  for (const sz of [-0.75, 0.75]) B.box('wood', p, 0, 0.45, sz, 2.2, 0.06, 0.35);
  for (const sx of [-0.9, 0.9]) B.box('woodDark', p, sx, 0.37, 0, 0.1, 0.75, 1.8);
}

/** Where the themed false fronts want their signs (set by dressBuildings). */
let fronts = {};

function facade(B, p, scene) {
  // the fronts themselves (false front, clown face, gargoyles) come from dressBuildings; this hangs the neon
  const color = p.style === 'funhouse' ? '#d9b45a' : p.style === 'tunnel' ? '#c8392b' : '#b8c4b0';
  const sign = neonSign(p.label, color, p.style === 'tunnel' ? 12 : 9);
  const at = fronts[p.style];
  if (at) sign.position.set(at.x, at.y, at.z);
  else sign.position.set(p.x, 9.4, p.z + 0.3);
  scene.add(sign);
}

// ------------------------------------------------------------------ world

export function buildWorld(scene) {
  initMaterials();
  const B = new Builder();
  const builders = {
    fence, wall: wallProp, roof: roofProp, booth, crate, tree, lamp: lampPost, trash, cart, bigtop, gametent,
    arch, ticket, freefall, control, arena, station, trailer, watertower, table,
  };
  fronts = dressBuildings(B, scene, modelSpots);
  for (const p of PROPS) {
    if (builders[p.type]) builders[p.type](B, p);
    else if (p.type === 'facade') facade(B, p, scene);
  }
  B.build(scene);
  plantTrees(scene, parkTrees, { shadows: true, living: 0.15 });

  // ground: forest floor with broken cobbled walkways blended in by a mask
  const ground = new THREE.Mesh(scaledPlane(240, 240 / 4), groundMaterial());
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  // ambient occlusion baked in Blender (scripts/blender/bake-ground-ao.py): every building, tent, ride, booth, prop
  // and tree softly darkens the ground around it. Its second UV set spans the whole ground once.
  {
    const pos = ground.geometry.attributes.position;
    const uv1 = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv1[i * 2] = (pos.getX(i) + 120) / 240;
      uv1[i * 2 + 1] = (pos.getY(i) + 120) / 240;
    }
    ground.geometry.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    new THREE.TextureLoader().load('./tex/ground_ao.webp', (t) => {
      t.channel = 1;
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = 4;
      ground.material.aoMap = t;
      ground.material.aoMapIntensity = 1;
      ground.material.needsUpdate = true;
      // and the foot of everything standing on it (wet.js)
      groundAO.map.value = t;
      groundAO.on.value = 1;
    });
  }
  ground.receiveShadow = true;
  scene.add(ground);
  const wildsTex = pbr('forest_leaves_02');
  const wildsMat = new THREE.MeshStandardMaterial({ color: '#8a8070', map: wildsTex.map, normalMap: wildsTex.normalMap, roughness: 1 });
  const wilds = new THREE.Mesh(scaledPlane(1400, 1400 / 5), wildsMat);
  wilds.name = 'wilds';
  wilds.rotation.x = -Math.PI / 2;
  wilds.position.y = -0.03;
  scene.add(wilds);

  const add = (mesh, x, y, z, ry = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    scene.add(mesh);
    return mesh;
  };
  // the prize counters glow so you can find them
  for (const b of PRIZE_BOOTHS) {
    const [ox, oz] = rotXZ(0, -0.76, b.rot);
    add(neonSign('PRIZE COUNTER', '#ffb05a', 3.3), b.x + ox, 3.9, b.z + oz, b.rot);
  }
  // old carnival signs
  add(neonSign('LAST RIDE', '#c8392b', 12), 0, 8.6, 110.75);
  add(neonSign('LAST RIDE', '#c8392b', 12), 0, 8.6, 109.25, Math.PI);
  add(neonSign('BUMPER CARS', '#d9b45a', 10), 48, 7.6, 62 + 9.6);
  add(neonSign('THE LAST RIDE', '#d9b45a', 7), 51.3, 5.6, 17, Math.PI / 2);
  add(neonSign('FREE FALL', '#c8392b', 6), -95, 9, 4.3);

  // the old road the tour bus comes in on
  const roadTex = pbr('cracked_concrete_wall');
  const edge = roadEdgeTex();
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 320, 1, 1),
    new THREE.MeshStandardMaterial({
      color: '#5a5652', map: roadTex.map, normalMap: roadTex.normalMap, roughness: 0.95, alphaMap: edge, transparent: true, depthWrite: false,
    }),
  );
  // the photo repeats along the road; the edge mask spans it once (second UV set)
  const ruv = road.geometry.attributes.uv;
  road.geometry.setAttribute('uv1', ruv.clone());
  for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i) * 2.6, ruv.getY(i) * 90);
  edge.channel = 1;
  road.renderOrder = 1;
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, 116 + 160);
  road.receiveShadow = true;
  scene.add(road);

  buildBackdrop(scene);
  buildScatter(scene);
  buildMist(scene);
  for (const d of DECOR) modelSpots.push([d.model, { x: d.x, z: d.z, rot: d.rot, w: d.w, d: d.d }]);
  // the memorial's candles throw a warm, unsteady glow on the ground round it
  for (const d of DECOR.filter((o) => o.model === 'memorial')) {
    const mat = new THREE.MeshBasicMaterial({
      map: glow(), color: '#ff9a45', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.3,
    });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), mat);
    pool.rotation.x = -Math.PI / 2;
    const [ox, oz] = rotXZ(0, 0.25, d.rot);
    pool.position.set(d.x + ox, 0.05, d.z + oz);
    pool.renderOrder = 1;
    pool.onBeforeRender = () => {
      const t = performance.now() / 1000;
      mat.opacity = 0.26 + 0.05 * Math.sin(t * 9.1) * Math.sin(t * 3.7 + 1.3) + 0.02 * Math.sin(t * 23.0);
    };
    scene.add(pool);
  }
  // copies of the same model share instanced meshes
  const byModel = new Map();
  for (const [name, o] of modelSpots) {
    if (!byModel.has(name)) byModel.set(name, []);
    byModel.get(name).push(o);
  }
  for (const [name, list] of byModel) placeModels(scene, name, list).catch((e) => console.warn(name, e));
  return { lamps: buildLamps(scene) };
}

/** A plane whose UVs repeat every `tiles` units, so tiling photo textures stay sharp. */
function scaledPlane(size, tiles) {
  const g = new THREE.PlaneGeometry(size, size);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * tiles, uv.getY(i) * tiles);
  return g;
}

/** Rain falling into the puddles (driven by the client): time in seconds and how much of the rain is falling. */
export const groundRain = { time: { value: 0 }, amount: { value: 0 } };

function groundMaterial() {
  // dead grass, mud and leaf litter blended by large-scale noise; cobbles on the walkways
  const grass = pbr('withered_grass');
  const mud = pbr('mud_forest');
  const leaves = pbr('forest_leaves_02');
  const stone = pbr('cobblestone_floor_08');
  const m = new THREE.MeshStandardMaterial({ map: grass.map, normalMap: mud.normalMap, roughness: 1 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.mapMud = { value: mud.map };
    sh.uniforms.mapLeaves = { value: leaves.map };
    sh.uniforms.mapStone = { value: stone.map };
    sh.uniforms.norStone = { value: stone.normalMap };
    sh.uniforms.maskMap = { value: pathMask() };
    sh.uniforms.rainT = groundRain.time;
    sh.uniforms.rainAmt = groundRain.amount;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D mapMud; uniform sampler2D mapLeaves; uniform sampler2D mapStone; uniform sampler2D norStone; uniform sampler2D maskMap; uniform float rainT; uniform float rainAmt;
        float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gh(i), gh(i + vec2(1, 0)), f.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p){ return gn(p) * 0.55 + gn(p * 2.3) * 0.3 + gn(p * 5.1) * 0.15; }
        float pathK; float puddle; float wetG;`)
      .replace('#include <map_fragment>', `
        vec2 big = vMapUv * 0.22;
        float wet = smoothstep(0.42, 0.7, fbm(big));
        wetG = wet;
        float litter = smoothstep(0.45, 0.75, fbm(big * 1.7 + 13.0));
        vec4 col = texture2D(map, vMapUv) * vec4(0.95, 0.9, 0.78, 1.0);
        col = mix(col, texture2D(mapLeaves, vMapUv * 0.8) * vec4(0.85, 0.78, 0.7, 1.0), litter * 0.85);
        col = mix(col, texture2D(mapMud, vMapUv * 0.9) * vec4(0.75, 0.72, 0.68, 1.0), wet * 0.9);
        // breaking the repeat: slow light and dark patches
        col.rgb *= 0.82 + 0.3 * fbm(vMapUv * 0.05 + 7.0);
        // damp earth after rain: darker and browner than dry straw
        col.rgb *= vec3(0.74, 0.68, 0.58);
        pathK = smoothstep(0.25, 0.75, texture2D(maskMap, vMapUv / 60.0).r);
        vec4 stoneCol = texture2D(mapStone, vMapUv * 1.6) * vec4(0.86, 0.84, 0.8, 1.0);
        // rain water left standing in the dips: sharp-edged pools, more of them on the worn cobbles
        float pn = fbm(vMapUv * 0.33 + 31.0) + fbm(vMapUv * 1.9 + 5.0) * 0.12;
        puddle = smoothstep(0.655, 0.695, pn + pathK * 0.04) * (0.55 + 0.45 * wet);
        vec4 ground = mix(col, stoneCol, pathK);
        // a dark rim where the water soaks into the edges
        ground.rgb *= 1.0 - smoothstep(0.6, 0.67, pn + pathK * 0.04) * 0.35;
        ground.rgb = mix(ground.rgb, ground.rgb * 0.22, puddle);
        diffuseColor *= ground;`)
      .replace('#include <normal_fragment_maps>', `
        vec3 mapN = mix(texture2D(normalMap, vNormalMapUv * 0.9).xyz, texture2D(norStone, vNormalMapUv * 1.6).xyz, pathK) * 2.0 - 1.0;
        mapN.xy *= normalScale;
        // standing water is flat as glass
        mapN = mix(mapN, vec3(0.0, 0.0, 1.0), puddle);
        // raindrops landing in the pools: rings spreading out and fading, a few per square metre
        if (puddle > 0.01 && rainAmt > 0.0) {
          vec2 rp = vMapUv * 4.0 * 2.2;
          vec2 ci = floor(rp);
          vec2 rn = vec2(0.0);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 c = ci + vec2(float(i), float(j));
            float h = gh(c);
            vec2 d = rp - (c + vec2(gh(c + 3.1), gh(c + 7.7)));
            float r = length(d);
            float t = fract(rainT * (0.8 + h * 0.7) + h * 9.0);
            float x = (r - t * 1.1) * 26.0;
            float wave = sin(x) * step(abs(x), 3.14159) * (1.0 - t) * (1.0 - t) * step(h, rainAmt);
            rn += d / max(r, 0.001) * wave;
          }
          mapN.xy += rn * 0.3 * puddle;
        }
        normal = normalize(tbn * mapN);`)
      // the baked occlusion: three.js only shades ambient light with it, but at night the moon and the lamps light
      // the ground, so it softens those too, as contact shadow round every wall, tent and booth
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        #ifdef USE_AOMAP
          reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, 0.75);
          reflectedLight.directSpecular *= ambientOcclusion;
        #endif`)
      .replace('#include <roughnessmap_fragment>', `// the rain falling now leaves everything with a film of water
        float roughnessFactor = mix(roughness - wetG * 0.3 - pathK * 0.2 - rainAmt * 0.18, 0.1, puddle);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // the pools mirror the sky, but the town glow on the horizon is a saturated purple: keep its light, drop most of its colour
        reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, vec3(dot(reflectedLight.indirectSpecular, vec3(0.3, 0.5, 0.2))) * vec3(0.92, 0.96, 1.05), puddle * 0.7);`);
    // the street lamps' light on the ground, baked in Blender with every shadow cast across it
    addLampLight(sh, { ground: true });
  };
  return m;
}

/** Soft cloud texture that fades out toward its edges (for the ground mist). */
function mistTex() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rr = rng(808);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const x = S * 0.15 + rr() * S * 0.7;
    const y = S * 0.15 + rr() * S * 0.7;
    const r = 20 + rr() * 50;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.12 + rr() * 0.12})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Low banks of mist drifting over the park and the woods. */
function buildMist(scene) {
  const rr = rng(909);
  const tex = mistTex();
  const mat = new THREE.MeshBasicMaterial({ color: '#5a626e', alphaMap: tex, transparent: true, opacity: 0.1, depthWrite: false, fog: true });
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const banks = [];
  // only along the approach road: inside the park the fog's own ground mist does this, and flat banks right
  // next to the camera showed as lumpy purple clouds on the grass
  for (let i = 18; i < 26; i++) {
    const road = i >= 18;
    const x = road ? (rr() - 0.5) * 40 : (rr() * 2 - 1) * (PARK_EDGE + 20);
    const z = road ? PARK_EDGE + 10 + rr() * 260 : (rr() * 2 - 1) * (PARK_EDGE + 20);
    const s = 18 + rr() * 26;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0.4 + rr() * 1.1, z);
    m.scale.set(s, 1, s * (0.6 + rr() * 0.6));
    m.rotation.y = rr() * Math.PI;
    m.renderOrder = 5;
    banks.push({ m, x, z, sp: 0.2 + rr() * 0.3, ph: rr() * 6 });
    scene.add(m);
  }
  // drift slowly with the night air (the first bank always renders, so its hook runs every frame)
  banks[0].m.frustumCulled = false;
  banks[0].m.onBeforeRender = () => {
    const t = performance.now() / 1000;
    for (const b of banks) {
      b.m.position.x = b.x + Math.sin(t * 0.05 * b.sp + b.ph) * 6;
      b.m.position.z = b.z + Math.cos(t * 0.04 * b.sp + b.ph) * 4;
    }
  };
}

/** Dead forest and dark hills outside the fence. */
function buildBackdrop(scene) {
  const rr = rng(404);
  const far = [];
  const near = [];
  // the forest around the fence: thicker the further out you look
  for (let i = 0; i < 520; i++) {
    const a = rr() * Math.PI * 2;
    const d = PARK_EDGE + 8 + rr() * 110;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (Math.abs(x) < PARK_EDGE + 3 && Math.abs(z) < PARK_EDGE + 3) continue;
    if (Math.abs(x) < 9 && z > 0) continue; // keep the tour bus road clear
    if (LANDMARKS_OUT.some((l) => Math.hypot(x - l.x, z - l.z) < l.r)) continue;
    far.push({ x, z, h: 8 + rr() * 12, rot: rr() * 6 });
  }
  // woods lining the road the tour bus comes in on: a wall of trunks close to the road, deep forest behind
  for (let i = 0; i < 620; i++) {
    const side = rr() < 0.5 ? -1 : 1;
    // far enough back that crowns overhang the verge, not the bus
    const x = side * (10 + rr() * rr() * 90);
    const z = PARK_EDGE + 6 + rr() * 360;
    (Math.abs(x) < 24 ? near : far).push({ x, z, h: 8 + rr() * 13, rot: rr() * 6 });
  }
  plantTrees(scene, near, { living: 0.35 });
  plantTrees(scene, far, { lite: true, living: 0.5 });
  buildTreeline(scene);
}

/** A ragged forest silhouette (alpha) for the horizon cards. */
function treelineTex(seed) {
  const W = 2048;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const rr = rng(seed);
  ctx.fillStyle = '#fff';
  // a solid band of undergrowth, then crowns of pines and bare trees poking up at different heights
  ctx.fillRect(0, H * 0.72, W, H);
  for (let i = 0; i < 520; i++) {
    const x = rr() * W;
    const h = H * (0.25 + rr() * 0.55);
    const w = 6 + rr() * 22;
    const top = H - h;
    if (rr() < 0.6) {
      // pine: a narrow jagged spire
      ctx.beginPath();
      ctx.moveTo(x, top);
      for (let k = 1; k <= 6; k++) {
        const y = top + (h * k) / 6;
        ctx.lineTo(x - (w * k) / 6 - rr() * 3, y);
        ctx.lineTo(x - (w * k) / 9, y - 2);
      }
      for (let k = 6; k >= 1; k--) {
        const y = top + (h * k) / 6;
        ctx.lineTo(x + (w * k) / 9, y - 2);
        ctx.lineTo(x + (w * k) / 6 + rr() * 3, y);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      // bare tree: a trunk and a few forked branches
      ctx.lineWidth = 2 + rr() * 2;
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x, top + h * 0.3);
      for (let k = 0; k < 5; k++) {
        const by = top + h * (0.15 + rr() * 0.5);
        ctx.moveTo(x, by + 10);
        ctx.lineTo(x + (rr() - 0.5) * w * 2.2, by - rr() * 20);
      }
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * Forest silhouettes all round the horizon (two rings for depth), lost in the night mist: they hide the open
 * country in the sky photo, so the park sits deep in the woods.
 */
function buildTreeline(scene) {
  for (const [r, h, seed, shade] of [[520, 70, 11, '#10141c'], [680, 110, 23, '#141a24']]) {
    const tex = treelineTex(seed);
    tex.repeat.set(6, 1);
    const mat = new THREE.MeshBasicMaterial({ color: shade, alphaMap: tex, transparent: true, depthWrite: false, side: THREE.BackSide, fog: true });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 96, 1, true), mat);
    ring.position.y = h / 2 - 8;
    ring.renderOrder = -1;
    scene.add(ring);
  }
}

/**
 * Sodium street lamps: glowing heads, light pools on the ground, and a small pool of real point lights
 * that follow the camera to the nearest working lamps. Some lamps are dead, some flicker.
 */
function buildLamps(scene) {
  const n = LAMPS.length;
  const rr = rng(909);
  const kind = LAMPS.map(() => {
    const r = rr();
    return r < 0.08 ? 'dead' : r < 0.22 ? 'flicker' : 'ok';
  });
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), n);
  const poolMat = new THREE.MeshBasicMaterial({
    map: glow(), color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.24,
  });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), poolMat, n);
  const m = new THREE.Matrix4();
  const warm = new THREE.Color('#ff9a45');
  const off = new THREE.Color('#0d0b0a');
  LAMPS.forEach((l, i) => {
    m.makeTranslation(l.x + LAMP_HEAD.x, LAMP_HEAD.y - 0.15, l.z);
    heads.setMatrixAt(i, m);
    m.makeRotationX(-Math.PI / 2);
    m.scale(new THREE.Vector3(13, 13, 1));
    m.setPosition(l.x + LAMP_HEAD.x, 0.04, l.z);
    pools.setMatrixAt(i, m);
  });
  pools.renderOrder = 1;
  // the painted pools stand in until the baked lamp light (lamplight.js) is in, which has the real ones
  loadLampLight().then(() => {
    pools.visible = false;
  }).catch((e) => console.warn('lamp light', e));
  // the light falling from each head, made visible by the rain and mist
  const coneH = LAMP_HEAD.y - 0.25;
  const coneMat = softShaft(new THREE.MeshBasicMaterial({
    color: '#ffffff', transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }), { bright: 'top', power: 2.4, near0: 3.6, near1: 7.5 });
  const cones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 3.4, coneH, 20, 1, true), coneMat, n);
  LAMPS.forEach((l, i) => {
    m.makeTranslation(l.x + LAMP_HEAD.x, LAMP_HEAD.y - 0.2 - coneH / 2, l.z);
    cones.setMatrixAt(i, m);
  });
  cones.renderOrder = 2;
  cones.frustumCulled = false;
  scene.add(heads, pools, cones);
  const lights = [];
  for (let i = 0; i < 3; i++) {
    const pl = new THREE.PointLight('#ffa860', 0, 26, 1.6);
    scene.add(pl);
    lights.push(pl);
  }
  const level = new Float32Array(n);
  const c = new THREE.Color();
  return {
    update(blackouts, time, cx, cz, power = 1) {
      LAMPS.forEach((l, i) => {
        let v = kind[i] === 'dead' ? 0 : 1;
        if (kind[i] === 'flicker') {
          const s = Math.sin(time * 13 + i * 7.1) + Math.sin(time * 31 + i * 3.3);
          v = s > 1.2 ? 0.1 : s > 0.9 ? 0.5 : 1;
        }
        if (blackouts.some((b) => Math.hypot(l.x - b.x, l.z - b.z) < b.r)) v = 0;
        v *= power;
        level[i] = v;
        heads.setColorAt(i, c.copy(off).lerp(warm, v).multiplyScalar(1 + v * 1.5));
        pools.setColorAt(i, c.copy(warm).multiplyScalar(v));
        cones.setColorAt(i, c.copy(warm).multiplyScalar(v));
      });
      heads.instanceColor.needsUpdate = true;
      pools.instanceColor.needsUpdate = true;
      cones.instanceColor.needsUpdate = true;
      // real lights on the closest working lamps
      const near = LAMPS.map((l, i) => ({ i, d: Math.hypot(l.x - cx, l.z - cz) }))
        .filter((o) => level[o.i] > 0)
        .sort((a, b) => a.d - b.d);
      lights.forEach((pl, k) => {
        const o = near[k];
        if (!o) {
          pl.intensity = 0;
          return;
        }
        const l = LAMPS[o.i];
        pl.position.set(l.x + LAMP_HEAD.x, LAMP_HEAD.y - 0.4, l.z);
        // the baked light (lamplight.js) already carries most of it: these add the shine and the sharp falloff
        pl.intensity = 35 * level[o.i];
      });
    },
  };
}

// ------------------------------------------------------------------ sky and light

nightAir(new THREE.Vector3(-0.45, 0.5, -0.74));

/** The background sky photo is stored divided by this (see scripts/sky.mjs); backgroundIntensity puts it back. */
export const SKY_SCALE = 2.5;

export function buildSky(scene, renderer) {
  // moonlit night sky (Poly Haven, CC0): a sharp 2k photo for the background, a small HDR copy for the lighting.
  // Both have the town lights on the horizon clamped (bloom turned them into huge white blobs).
  const pmrem = new THREE.PMREMGenerator(renderer);
  new HDRLoader().load('./hdri/sky_env.hdr', (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    scene.environmentIntensity = 0.65;
  });
  new THREE.TextureLoader().load('./hdri/sky_bg.jpg', (sky) => {
    sky.mapping = THREE.EquirectangularReflectionMapping;
    sky.colorSpace = THREE.SRGBColorSpace;
    scene.background = sky;
    scene.backgroundIntensity = 0.6 * SKY_SCALE;
  });
  scene.background = new THREE.Color('#05070a');

  const moonDir = new THREE.Vector3(-0.45, 0.5, -0.74).normalize();
  scene.fog = new THREE.FogExp2('#232a38', 0.0068);
  const hemi = new THREE.HemisphereLight('#7686ad', '#2a2620', 1.15);
  scene.add(hemi);
  const moonLight = new THREE.DirectionalLight('#b8c8ee', 2.1);
  moonLight.position.copy(moonDir).multiplyScalar(120);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(2048, 2048);
  const sc = moonLight.shadow.camera;
  sc.left = -45;
  sc.right = 45;
  sc.top = 45;
  sc.bottom = -45;
  sc.near = 10;
  sc.far = 300;
  moonLight.shadow.bias = -0.0006;
  moonLight.shadow.normalBias = 0.04;
  scene.add(moonLight, moonLight.target);
  // a dying fire inside the big top
  const tentLight = new THREE.PointLight('#ff5a20', 30, 40, 1.6);
  tentLight.position.set(0, 13, 0);
  scene.add(tentLight);
  return { moonLight, moonDir, hemi };
}
