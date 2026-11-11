// Realistic set dressing from Sketchfab (CC-BY, see credits): loads the slimmed GLBs in public/models/env and fits
// them into the footprints the map reserves (so they match the colliders the simulation uses).
// Copies of the same model are drawn as one instanced mesh per part, so dozens of booths cost a few draw calls.
import * as THREE from 'three';
import { wetten } from './wet.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ktx2 } from './ktx.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cullable, lodLimit } from './cull.js';
import { loadMotion, attachMotion, motionMaterial } from './motion.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2());
const cache = new Map();

/** world.js hands over its materials: key -> { mat, world (metres per texture tile) } (see 'tex:' below). */
let worldMaterial = () => null;
export function setWorldMaterials(lookup) {
  worldMaterial = lookup;
}

/** Texture coordinates projected from the model's own space, a tile every `world` metres (for 'tex:' parts). */
function boxUV(o, world) {
  const g = o.geometry;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
    if (nor) n.fromBufferAttribute(nor, i).applyMatrix3(nm);
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    const [u, v] = ay >= ax && ay >= az ? [p.x, p.z] : ax >= az ? [p.z, p.y] : [p.x, p.y];
    uv[i * 2] = u / world;
    uv[i * 2 + 1] = v / world;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** The model's scene (shared). Clone it for each placement. */
export function loadModel(name) {
  if (!cache.has(name)) {
    cache.set(name, loader.loadAsync(`./models/env/${name}.glb`).then((g) => {
      g.scene.updateMatrixWorld(true);
      // each material by its name in the file, as finally used (broken pieces are painted with these)
      const byName = (g.scene.userData.mats = {});
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        const raw = Array.isArray(o.material) ? null : o.material.name;
        // parts the Blender scripts name 'tex:<key>' take the world's own material (its photo textures, rain and
        // lamp light), with texture coordinates projected at real scale
        const own = !Array.isArray(o.material) && o.material.name.startsWith('tex:') && worldMaterial(o.material.name.slice(4).replace(/\.\d+$/, ''));
        if (own) {
          boxUV(o, own.world || 2);
          o.material = own.mat;
          byName[raw] = { mat: own.mat, uvWorld: own.world || 2 };
          return;
        }
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) byName[m.name] ??= { mat: m };
        for (const m of mats) {
          // old, damp and dirty: nothing shiny
          m.roughness = Math.max(m.roughness ?? 0.8, 0.55);
          if (m.map) m.map.anisotropy = 4;
          // scans without a normal map take their surface detail from the photo itself, as bumps
          if (m.map && !m.normalMap && !m.transparent && !(m.alphaTest > 0)) {
            m.bumpMap = m.map;
            m.bumpScale = 0.6;
          }
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

/** Give the police tape model's ribbon the baked flutter (once: the merged model is shared). */
async function tieTape(src) {
  if (src.userData.motion) return;
  src.userData.motion = true;
  const m = await loadMotion('tape');
  src.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(src.matrixWorld).invert();
  src.traverse((o) => {
    if (!o.isMesh || !/tape/i.test(o.material?.name || '')) return;
    const toModel = new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld);
    if (!attachMotion(o.geometry, m, toModel)) return;
    const toLocal = new THREE.Matrix3().setFromMatrix4(toModel).invert();
    o.material = motionMaterial(o.material.clone(), m, toLocal);
  });
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
  // the police tape's runs flutter between their stakes (src/motion.js)
  if (file === 'police_tape') await tieTape(src).catch((e) => console.warn('tape motion', e));
  const mats = list.map((o) => fitMatrix(src, o, keep));
  // props that break: which copy is which, and where it stands (for its pieces)
  const ids = list.some((o) => o.brk != null) ? Int32Array.from(list, (o) => o.brk ?? -1) : null;
  if (ids) list.forEach((o, i) => o.brk != null && BREAK_PLACES.set(o.brk, { file, matrix: mats[i] }));
  const lod = !part && FAR_MODELS[file];
  const near = instance(parent, src, mats, keep);
  for (const [mesh, max] of near) {
    // (they keep their own shadow, which goes when they break: src/shadowproxy.js leaves them out)
    if (ids) mesh.userData.moves = true;
    cullable(mesh, max, 25, 0, ids);
    if (lod) lodLimit(mesh, lod);
  }
  if (!lod) return;
  // the far version sits in the same frame as the full one, so the same placements fit it
  const far = await loadMerged(file + '_far').catch(() => null);
  if (!far) {
    for (const [mesh] of near) lodLimit(mesh, Infinity);
    return;
  }
  for (const [mesh, max] of instance(parent, far, mats, () => true)) {
    if (ids) mesh.userData.moves = true;
    cullable(mesh, max, 0, lod, ids);
  }
}

/** Where each breakable prop stands: id -> { file, matrix } (the placement matrix of its model). */
export const BREAK_PLACES = new Map();

const pieceCache = new Map();
/**
 * A prop's broken pieces (scripts/fracture-props.mjs), painted with the whole prop's own materials and the cut faces
 * with its inside colour: [{ center (model space), parts: [{ geometry (centred on center), material }] }].
 */
export function brokenPieces(file, insideColor) {
  if (!pieceCache.has(file)) {
    pieceCache.set(file, Promise.all([loadModel(file), loader.loadAsync(`./models/env/broken/${file}.glb`)]).then(([src, g]) => {
      const byName = src.userData.mats || {};
      const fallback = Object.values(byName)[0]?.mat || new THREE.MeshStandardMaterial({ color: '#777' });
      const inside = new THREE.MeshStandardMaterial({ color: insideColor || '#8a7a60', roughness: 0.92 });
      wetten(inside);
      g.scene.updateMatrixWorld(true);
      const chunks = new Map();
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        // the chunk is the named node (a mesh with several materials comes in as a group of meshes)
        let node = o;
        while (node.parent && node.parent !== g.scene && !/^chunk_/.test(node.name)) node = node.parent;
        if (!chunks.has(node)) chunks.set(node, { center: node.getWorldPosition(new THREE.Vector3()), parts: [] });
        // plain float positions in the model's space (packed ones clamp if transformed)
        const geo = new THREE.BufferGeometry();
        for (const n of ['position', 'normal', 'uv']) {
          const a = o.geometry.attributes[n];
          if (!a) continue;
          const k = a.itemSize;
          const arr = new Float32Array(a.count * k);
          for (let i = 0; i < a.count; i++) for (let j = 0; j < k; j++) arr[i * k + j] = a.getComponent(i, j);
          geo.setAttribute(n, new THREE.BufferAttribute(arr, k));
        }
        if (o.geometry.index) geo.setIndex(Array.from(o.geometry.index.array));
        geo.applyMatrix4(o.matrixWorld);
        const raw = o.material.name;
        const own = raw === 'inside' ? { mat: inside } : byName[raw] || byName[raw.replace(/.d+$/, '')] || { mat: fallback };
        if (own.uvWorld) boxUV({ geometry: geo, matrixWorld: new THREE.Matrix4() }, own.uvWorld);
        chunks.get(node).parts.push({ geometry: geo, material: own.mat });
      });
      const out = [...chunks.values()];
      for (const c of out) for (const p of c.parts) p.geometry.translate(-c.center.x, -c.center.y, -c.center.z);
      return out;
    }));
  }
  return pieceCache.get(file);
}
