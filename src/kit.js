// The Blender building kit (scripts/blender/build-kit.py): the Funhouse, the Tunnel of Terror and the Arcade in
// 1980s painted cinder block, the backlot trailers and the front gate. The models carry geometry only; each part is
// named after one of the world's materials, so it gets the park's own tiling textures, rain and lamp light, and is
// merged per material like everything else the world builds. They replace the plainer boxes the world draws first
// (the 'outside' group) as soon as they have loaded; if they never do, the boxes stay.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { BUILDINGS, PROPS } from '../shared/map.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** Load the kit and hand each placed part to a fresh Builder; resolves to the built group. */
export async function buildKit(Builder, hasMaterial) {
  const B = new Builder();
  const place = (gltf, P, remap = {}) => {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const raw = o.material?.name || '';
      const name = remap[raw] || raw;
      const key = hasMaterial(name) ? name : 'plinth';
      // compressed (quantised) attributes clamp when transformed: unpack them to plain floats first
      const g = new THREE.BufferGeometry();
      for (const [n, a] of Object.entries(o.geometry.attributes)) {
        if (n !== 'position' && n !== 'normal') continue;
        const arr = new Float32Array(a.count * 3);
        for (let i = 0; i < a.count; i++) {
          arr[i * 3] = a.getX(i);
          arr[i * 3 + 1] = a.getY(i);
          arr[i * 3 + 2] = a.getZ(i);
        }
        g.setAttribute(n, new THREE.BufferAttribute(arr, 3));
      }
      if (o.geometry.index) g.setIndex(Array.from(o.geometry.index.array));
      g.applyMatrix4(o.matrixWorld);
      B.add(key, g, P);
    });
  };
  const load = (name) => loader.loadAsync(`./models/kit/kit_${name}.glb`);
  const jobs = [];
  for (const b of BUILDINGS) jobs.push(load(b.style).then((g) => place(g, { x: b.cx, z: b.cz, rot: 0 })));
  const trailers = PROPS.filter((p) => p.type === 'trailer');
  if (trailers.length) jobs.push(load('trailer').then((g) => trailers.forEach((p) => place(g, { x: p.x, z: p.z, rot: p.rot || 0 }))));
  const gate = PROPS.find((p) => p.type === 'arch');
  if (gate) jobs.push(load('arch').then((g) => place(g, { x: gate.x, z: gate.z, rot: 0 })));
  // carnival game booths: one of four games (or the prize counter), painted each booth's own colour
  const booths = PROPS.filter((p) => p.type === 'booth');
  const variants = new Map();
  booths.forEach((p, i) => variants.set(p, boothVariant(p, i)));
  for (const v of new Set(variants.values())) {
    jobs.push(load(`booth_${v}`).then((g) => booths.filter((p) => variants.get(p) === v).forEach((p) => place(g, { x: p.x, z: p.z, rot: p.rot || 0 }, { booth_main: p.color }))));
  }
  // game tents keep their scanned canvas; this adds bunting, guy ropes and stakes round each
  const tents = PROPS.filter((p) => p.type === 'gametent');
  if (tents.length) jobs.push(load('tentdress').then((g) => tents.forEach((p) => place(g, { x: p.x, z: p.z, rot: (p.x + p.z) % 6.28 }))));
  await Promise.all(jobs);
  const group = new THREE.Group();
  group.name = 'kit';
  B.build(group);
  return group;
}

/** Which game a booth plays: the prize counters hand out prizes, the rest take turns. */
export const BOOTH_GAMES = { ringtoss: 'RING TOSS', darts: 'BALLOON DARTS', milk: 'MILK BOTTLES', gallery: 'SHOOTING GALLERY' };
export function boothVariant(p, i) {
  return p.prize ? 'prize' : Object.keys(BOOTH_GAMES)[i % 4];
}

/** Is this map prop one the kit draws (the walk-in buildings' walls and roofs, the booths, trailers, the gate)? */
export function kitDraws(p) {
  if (p.type === 'trailer' || p.type === 'arch' || p.type === 'booth') return true;
  if (p.type !== 'wall' && p.type !== 'roof') return false;
  return BUILDINGS.some((b) => b.style === p.style && Math.abs(p.x - b.cx) <= b.w / 2 + 0.5 && Math.abs(p.z - b.cz) <= b.d / 2 + 0.5);
}
