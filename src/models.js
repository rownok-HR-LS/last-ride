// Realistic set dressing from Sketchfab (CC-BY, see credits): loads the slimmed GLBs in public/models/env and fits
// them into the footprints the map reserves (so they match the colliders the simulation uses).
// Copies of the same model are drawn as one instanced mesh per part, so dozens of booths cost a few draw calls.
import * as THREE from 'three';
import { wetten } from './wet.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cullable, lodLimit } from './cull.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

/** The model's scene (shared). Clone it for each placement. */
export function loadModel(name) {
  if (!cache.has(name)) {
    cache.set(name, loader.loadAsync(`./models/env/${name}.glb`).then((g) => {
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          // old, damp and dirty: nothing shiny
          m.roughness = Math.max(m.roughness ?? 0.8, 0.55);
          if (m.map) m.map.anisotropy = 4;
          // ...until it rains on it
          if (!m.transparent && !(m.emissiveIntensity > 0.5 && m.emissiveMap)) wetten(m);
        }
      });
      g.scene.updateMatrixWorld(true);
      return g.scene;
    }));
  }
  return cache.get(name);
}

/** Plain float copy of a geometry (compressed attributes clamp when transformed, and do not merge). */
function floatCopy(src) {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) {
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1));
  return g;
}

/**
 * Bake every mesh under root (except inside the skip nodes) into one mesh per material, so a model made of
 * dozens of parts costs a few draw calls. The merged meshes keep root's frame; root's transform still applies.
 */
export function mergeStatic(root, skip = []) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const buckets = new Map();
  const victims = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh) return;
    for (let p = o; p && p !== root; p = p.parent) if (skip.includes(p)) return;
    const g = floatCopy(o.geometry);
    rel.multiplyMatrices(inv, o.matrixWorld);
    g.applyMatrix4(rel);
    // merge only geometries with the same attribute set
    const sig = Object.keys(g.attributes).sort().join(',') + (g.index ? ':i' : '');
    const key = o.material.uuid + '|' + sig;
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, list: [], shadow: o.castShadow });
    buckets.get(key).list.push(g);
    victims.push(o);
  });
  for (const o of victims) o.removeFromParent();
  for (const { mat, list, shadow } of buckets.values()) {
    const geo = list.length > 1 ? mergeGeometries(list, false) : list[0];
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  return buckets.size;
}

const merged = new Map();
/** A model with its parts baked into one mesh per material (for copies placed whole). */
function loadMerged(name) {
  if (!merged.has(name)) {
    merged.set(name, loadModel(name).then((src) => {
      const copy = src.clone(true);
      mergeStatic(copy);
      copy.updateMatrixWorld(true);
      return copy;
    }));
  }
  return merged.get(name);
}

const _box = new THREE.Box3();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Matrix that puts a model into a footprint w x d (metres, before rotation) standing on y = 0.
 * yaw turns the model inside its footprint first, rot is the placement rotation. h: optional height
 * (stretched to it when uniform is false, otherwise the model is scaled evenly).
 */
function fitMatrix(src, { x, z, y = 0, rot = 0, w, d, h, yaw = 0, uniform = true }, keep = () => true) {
  const turn = new THREE.Matrix4().makeRotationY(yaw);
  _box.makeEmpty();
  src.traverse((o) => {
    if (!o.isMesh || !keep(o)) return;
    o.geometry.computeBoundingBox();
    _box.union(o.geometry.boundingBox.clone().applyMatrix4(_m2.multiplyMatrices(turn, o.matrixWorld)));
  });
  const size = _box.getSize(new THREE.Vector3());
  let sx = w / size.x;
  let sz = d / size.z;
  let sy = h ? h / size.y : Math.min(sx, sz);
  if (uniform) sx = sy = sz = Math.min(sx, sz, h ? sy : Infinity);
  const c = _box.getCenter(new THREE.Vector3());
  // placement * scale * centre-and-ground * yaw
  const centre = new THREE.Matrix4().makeTranslation(-c.x, -_box.min.y, -c.z);
  const scale = new THREE.Matrix4().makeScale(sx, sy, sz);
  const place = new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromAxisAngle(_up, rot), new THREE.Vector3(1, 1, 1));
  return place.multiply(scale).multiply(centre).multiply(turn);
}

/** Is o inside the node called part (or anywhere, without a part)? */
function within(o, part) {
  if (!part) return true;
  for (let p = o; p; p = p.parent) if (p.name === part) return true;
  return false;
}

/**
 * Models with a far version (public/models/env/<name>_far.glb, Blender's Decimate via scripts/bake-atlases.mjs):
 * name -> metres from the camera where the far version takes over (measured flat).
 */
export const FAR_MODELS = {
  popcorn_cart: 30, tent_small: 40, crates_barrels: 28, trash_bags: 26, boxes: 26, bench: 24, rocket_kiddie: 28,
  clown_statue: 26, shed_worn: 40, vending_news: 24, ice_freezer: 24,
};

/** Instanced copies of every mesh in src at mats; returns the meshes and how far each may be drawn. */
function instance(parent, src, mats, keep) {
  const out = [];
  src.traverse((o) => {
    if (!o.isMesh || !keep(o)) return;
    const mesh = new THREE.InstancedMesh(o.geometry, o.material, mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, _m.multiplyMatrices(m, o.matrixWorld)));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    parent.add(mesh);
    // how far a piece is drawn goes with its size: a can is a speck long before a booth is (each kind drawn is a
    // draw call, and there are hundreds of kinds of small things)
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const r = o.geometry.boundingSphere.radius * _m.multiplyMatrices(mats[0], o.matrixWorld).getMaxScaleOnAxis();
    out.push([mesh, r < 0.75 ? 70 : r < 1.5 ? 100 : r < 4 ? 160 : 260]);
  });
  return out;
}

/**
 * Many placements of the same model as instanced meshes: [{ x, z, rot, w, d, ... }].
 * name may pick one piece of a model: 'light_poles#LightPole_01_2'.
 */
export async function placeModels(parent, name, list) {
  if (!list.length) return;
  const [file, part] = name.split('#');
  const src = part ? await loadModel(file) : await loadMerged(file);
  const keep = (o) => within(o, part);
  const mats = list.map((o) => fitMatrix(src, o, keep));
  const lod = !part && FAR_MODELS[file];
  const near = instance(parent, src, mats, keep);
  for (const [mesh, max] of near) {
    cullable(mesh, max, 25);
    if (lod) lodLimit(mesh, lod);
  }
  if (!lod) return;
  // the far version sits in the same frame as the full one, so the same placements fit it
  const far = await loadMerged(file + '_far').catch(() => null);
  if (!far) {
    for (const [mesh] of near) lodLimit(mesh, Infinity);
    return;
  }
  for (const [mesh, max] of instance(parent, far, mats, () => true)) cullable(mesh, max, 0, lod);
}
