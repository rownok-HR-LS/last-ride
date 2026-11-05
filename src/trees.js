// Trees grown with EZ-Tree (MIT, real bark and needle textures), then instanced across the park and the woods:
// leafless oaks, ashes and pines (long dead), plus dark pines that still carry their needles to make the woods
// read as a dense forest. Detailed versions near play, lighter ones for the far woods.
import * as THREE from 'three';
import { sway } from './wind.js';
import { Tree } from '@dgreenheck/ez-tree';
import { cullable, lodLimit } from './cull.js';

/** [preset, seed, tweak]. Every variant is normalised to 1 m tall and scaled per instance. */
const DEAD = [
  ['Oak Large', 11, (o) => { o.branch.angle[1] = 62; o.branch.gnarliness[1] = 0.3; }],
  ['Oak Medium', 23, (o) => { o.branch.gnarliness[2] = 0.25; }],
  ['Ash Large', 37, (o) => { o.branch.children[0] = 7; }],
  ['Ash Medium', 41, () => {}],
  ['Pine Large', 53, (o) => { o.branch.length[1] *= 0.55; o.branch.children[0] = 30; }],
  ['Pine Medium', 67, (o) => { o.branch.length[1] *= 0.5; }],
];
/** Evergreens: tall, dark, ragged pines. */
const LIVING = [
  ['Pine Large', 71, (o) => { o.leaves.size *= 1.1; }],
  ['Pine Large', 83, (o) => { o.branch.children[0] = 80; o.leaves.count = 14; }],
  ['Pine Medium', 97, () => {}],
];

const BARK_TINT = { oak: '#6e665e', ash: '#77736c', pine: '#5e5650' };

function grow(name, seed, tweak, lite, needles) {
  const tree = new Tree();
  tree.loadPreset(name);
  const o = tree.options;
  o.seed = seed;
  if (!needles) o.leaves.count = 0; // long dead
  tweak(o);
  if (lite) {
    // far away: fewer, chunkier sections, no twigs, sparser needles
    o.branch.levels = Math.min(o.branch.levels, 2);
    for (const k of Object.keys(o.branch.sections)) o.branch.sections[k] = Math.max(3, Math.round(o.branch.sections[k] * 0.5));
    for (const k of Object.keys(o.branch.segments)) o.branch.segments[k] = Math.max(3, Math.round(o.branch.segments[k] * 0.6));
    if (needles) {
      o.leaves.count = Math.max(4, Math.round(o.leaves.count * 0.45));
      o.leaves.size *= 1.35;
    }
  }
  tree.generate();
  const geo = tree.branchesMesh.geometry;
  geo.computeBoundingBox();
  const bb = geo.boundingBox.clone();
  const h = bb.max.y - bb.min.y || 1;
  // 1 m tall with the base at y = 0 (the needles move with the branches)
  const norm = (g) => g.translate(0, -bb.min.y, 0).scale(1 / h, 1 / h, 1 / h);
  norm(geo);
  const src = tree.branchesMesh.material;
  const parts = [{
    geo,
    // the crown sways a little more than the trunk (heights here are 0..1 of the tree)
    mat: sway(new THREE.MeshStandardMaterial({
      color: BARK_TINT[o.bark.type] || '#6e665e',
      map: src.map, normalMap: src.normalMap, roughnessMap: src.roughnessMap, aoMap: src.aoMap,
      roughness: 1, metalness: 0,
    }), 0.008),
  }];
  if (needles && tree.leavesMesh.geometry.attributes.position) {
    const lsrc = tree.leavesMesh.material;
    parts.push({
      geo: norm(tree.leavesMesh.geometry),
      mat: sway(new THREE.MeshStandardMaterial({
        color: '#3b4a36', map: lsrc.map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, metalness: 0,
      }), 0.011),
    });
  }
  const tris = parts.reduce((n, p) => n + (p.geo.index ? p.geo.index.count : p.geo.attributes.position.count) / 3, 0);
  return { parts, tris };
}

let cache = null;
function variants() {
  if (!cache) {
    cache = {};
    for (const lite of [false, true]) {
      cache[lite ? 'lite' : 'full'] = {
        dead: DEAD.map(([n, s, t]) => grow(n, s, t, lite, false)),
        living: LIVING.map(([n, s, t]) => grow(n, s, t, lite, true)),
      };
    }
  }
  return cache;
}

/**
 * Plant trees. list: [{ x, z, h (height, m), rot, y? }]. living: share that are needled pines. Each spot is
 * given its tree from its position, so the same spot always grows the same tree.
 */
/** Detailed trees give way to their lighter versions from this far out (m). */
const LOD_SWITCH = 75;

export function plantTrees(scene, list, { lite = false, shadows = false, living = 0 } = {}) {
  // a detailed planting gets a light copy for the distance (no shadows out there anyway)
  if (!lite) plant(scene, list, { lite: true, shadows: false, living, farOnly: true });
  return plant(scene, list, { lite, shadows, living, farOnly: false });
}

function plant(scene, list, { lite, shadows, living, farOnly }) {
  const set = variants()[lite ? 'lite' : 'full'];
  const all = [...set.dead, ...set.living];
  const buckets = all.map(() => []);
  for (const t of list) {
    const hsh = Math.abs(Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % 1;
    const k = hsh < living
      ? set.dead.length + Math.floor((hsh / living) * set.living.length) % set.living.length
      : Math.floor(((hsh - living) / (1 - living)) * set.dead.length) % set.dead.length;
    buckets[k].push(t);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  let tris = 0;
  buckets.forEach((b, i) => {
    if (!b.length) return;
    for (const part of all[i].parts) {
      const mesh = new THREE.InstancedMesh(part.geo, part.mat, b.length);
      b.forEach((t, j) => {
        q.setFromAxisAngle(up, t.rot);
        // slightly different proportions per tree
        const w = t.h * (0.85 + ((j * 0.37) % 0.3));
        m.compose(p.set(t.x, (t.y || 0) - 0.15, t.z), q, s.set(w, t.h, w));
        mesh.setMatrixAt(j, m);
      });
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      // past the mist nothing shows; trees that throw shadows stay drawn close behind the camera too
      if (farOnly) cullable(mesh, 270, 0, LOD_SWITCH);
      else cullable(mesh, lite ? 270 : 260, shadows ? 30 : 0);
      if (!lite) lodLimit(mesh, LOD_SWITCH);
    }
    tris += all[i].tris * b.length;
  });
  return tris;
}
