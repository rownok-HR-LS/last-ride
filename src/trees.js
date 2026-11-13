// Trees grown with EZ-Tree (MIT, real bark and needle textures), baked ahead of time into models/trees.glb (see
// src/tools/bake-trees.js; the lists below are what it grows), then instanced across the park and the woods:
// leafless oaks, ashes and pines (long dead), plus dark pines that still carry their needles to make the woods
// read as a dense forest. Detailed versions near play, lighter ones for the far woods.
import * as THREE from 'three';
import { sway } from './wind.js';
import { cullable, lodLimit } from './cull.js';
import { ktx2 } from './ktx.js';
import { busClip } from './bus.js';

/**
 * Trees near the camera fade out (dithered) while this is set: [gone within, whole beyond] in metres; 0, 0 = off.
 * The intro's drone and crane shots set it (intro.js treeCut), as their cameras pass through the crowns over the road.
 */
export const treeCut = { value: new THREE.Vector2(0, 0) };

/** Give a tree material the camera cut-away (treeCut). */
function nearCut(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, renderer) => {
    prev?.call(mat, sh, renderer);
    sh.uniforms.treeCut = treeCut;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 treeCut;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (treeCut.y > 0.0) {
          // a fine, stable dither (interleaved gradient noise) so the cut-away fades rather than ends at a line
          float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (smoothstep(treeCut.x, treeCut.y, length(vViewPosition)) < dither) discard;
        }`);
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${key ? key() : ''}|treeCut`;
  return mat;
}

/** [preset, seed, tweak]. Every variant is normalised to 1 m tall and scaled per instance. */
export const DEAD = [
  ['Oak Large', 11, (o) => { o.branch.angle[1] = 62; o.branch.gnarliness[1] = 0.3; }],
  ['Oak Medium', 23, (o) => { o.branch.gnarliness[2] = 0.25; }],
  ['Ash Large', 37, (o) => { o.branch.children[0] = 7; }],
  ['Ash Medium', 41, () => {}],
  ['Pine Large', 53, (o) => { o.branch.length[1] *= 0.55; o.branch.children[0] = 30; }],
  ['Pine Medium', 67, (o) => { o.branch.length[1] *= 0.5; }],
];
/** Evergreens: tall, dark, ragged pines. */
export const LIVING = [
  ['Pine Large', 71, (o) => { o.leaves.size *= 1.1; }],
  ['Pine Large', 83, (o) => { o.branch.children[0] = 80; o.leaves.count = 14; }],
  ['Pine Medium', 97, () => {}],
];

export const BARK_TINT = { oak: '#6e665e', ash: '#77736c', pine: '#5e5650' };

let cache = null;

/**
 * Load the baked trees (public/models/trees.glb, made by src/tools/bake-trees.js from EZ-Tree): every variant,
 * detailed and light, already normalised to 1 m tall. Call once while loading; plantTrees needs it done.
 */
export async function preloadTrees() {
  if (cache) return cache;
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2()).loadAsync('./models/trees.glb');
  const swayed = new Map();
  const out = { full: { dead: [], living: [] }, lite: { dead: [], living: [] } };
  gltf.scene.traverse((m) => {
    if (!m.isMesh) return;
    const [lod, kind, i, j] = m.name.split('_');
    const mat = m.material;
    // one swaying copy per baked material: the crown moves a little more than the trunk (heights 0..1)
    if (!swayed.has(mat)) {
      mat.roughness = 1;
      mat.metalness = 0;
      if (mat.name === 'needles') mat.side = THREE.DoubleSide;
      // never drawn inside the tour bus (branches over the road reached through its cabin)
      mat.clippingPlanes = busClip;
      mat.clipIntersection = true;
      swayed.set(mat, nearCut(sway(mat, mat.name === 'needles' ? 0.011 : 0.008)));
    }
    const v = (out[lod][kind][+i] ??= { parts: [], tris: 0 });
    v.parts[+j] = { geo: m.geometry, mat: swayed.get(mat) };
    v.tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  });
  cache = out;
  return cache;
}

function variants() {
  if (!cache) throw new Error('preloadTrees() first');
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
