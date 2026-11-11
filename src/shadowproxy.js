// One simplified stand-in for the moonlight's shadows. The park's still scenery (buildings, booths, tents, trees'
// trunks, props) took ~200 draw calls and ~0.9 M triangles every time the shadow map was redrawn. Blender
// (scripts/blender/shadow-proxy.py) welds it all into a few dozen tiles, simplified to what a 4 cm shadow texel can
// show, and the game draws only those into the shadow map: the proxy sits on a layer just the moonlight's shadow
// camera sees, and the still meshes it replaces stop casting their own shadow. Anything that moves (rides, riders,
// the bus, loot), anything see-through or cut out (leaves, glass, tape) keeps casting itself.
//
// To rebuild after moving scenery, in the dev console on a freshly started dev server, with the scratchpad receiver
// running, once the park has finished loading:
//   await (await import('/src/shadowproxy.js')).exportCasters(__lr, 'http://127.0.0.1:5299/?n=casters&ext=glb')
// then scripts/blender/shadow-proxy.py and scripts/pack-shadow-proxy.mjs (see HANDOFF.md).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** The layer only the moonlight's shadow camera looks at. */
export const SHADOW_LAYER = 3;
/** Tiles this wide (m): small enough for the shadow camera to skip the far ones. */
const TILE = 30;
/** Nothing further than this from the centre can reach the shadow box around a player in the park. */
const REACH = 150;

/** Everything in the scene that moves, so its shadow must move with it. */
export function moverRoots(client) {
  const set = new Set();
  const add = (o) => o && set.add(o);
  const r = client.rides;
  if (r) {
    add(r.wheel);
    add(r.carousel);
    add(r.freefallSeat);
    for (const k of ['gondolas', 'train', 'cars', 'flying', 'stepMarks']) for (const o of r[k] || []) add(o);
    for (const o of r.trapMeshes?.values?.() || []) add(o);
  }
  add(client.bus?.root);
  add(client.driver?.root);
  add(client.showChar?.root);
  for (const c of client.chars?.values() || []) add(c.char?.root);
  for (const p of client.lootView?.pools?.values() || []) add(p.mesh);
  for (const k of ['fx', 'projectiles', 'corpses', 'bodyFx', 'rain', 'weather', 'targetRing', 'muzzleLight']) {
    const v = client[k];
    if (v?.isObject3D) add(v);
    else if (v?.root?.isObject3D) add(v.root);
    else if (v?.group?.isObject3D) add(v.group);
  }
  return set;
}

const solid = (m) =>
  m && !m.userData.moves && !m.transparent && !(m.alphaTest > 0) && !m.alphaHash && m.depthWrite !== false && m.side !== THREE.BackSide &&
  (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial);

/** Is o a still, solid mesh casting moonlight shadow, that the proxy can stand in for? */
export function stillCaster(o, movers, scene) {
  if (!o.isMesh || o.isSkinnedMesh || !o.castShadow || o.layers.mask !== 1) return false;
  if (o.morphTargetInfluences?.length) return false;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  if (!mats.every(solid)) return false;
  for (let p = o; p && p !== scene; p = p.parent) {
    if (movers.has(p) || p.userData.moves) return false;
    // an LOD's far versions: the near one stands for it
    if (p.parent?.isLOD && p.parent.levels[0]?.object !== p) return 'far';
  }
  if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
  return true;
}

/** Write every still caster, in park coordinates, positions only, as one GLB of TILE-sized meshes. */
export async function exportCasters(client, postTo) {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const { restoreAllInstances } = await import('./cull.js');
  // every still caster casting its own shadow again (wait for the stand-in first: if it loaded mid-export it would
  // take their shadows away and they would be missing from the new one)
  await client.shadowProxy?.ready;
  client.shadowProxy?.set(false);
  restoreAllInstances();
  const scene = client.scene;
  scene.updateMatrixWorld(true);
  const movers = moverRoots(client);
  // anything else that moved in the last two seconds is a mover too
  const before = new Map();
  scene.traverse((o) => o.isMesh && before.set(o, o.matrixWorld.clone()));
  await new Promise((r) => setTimeout(r, 2000));
  scene.updateMatrixWorld(true);
  const moved = [];
  for (const [o, m] of before) if (!o.matrixWorld.equals(m) && stillCaster(o, movers, scene) === true) moved.push(o);
  for (const o of moved) movers.add(o);
  const tiles = new Map();
  const tileOf = (x, z) => {
    const k = `${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`;
    if (!tiles.has(k)) tiles.set(k, { pos: [], idx: [] });
    return tiles.get(k);
  };
  const v = new THREE.Vector3();
  const s = new THREE.Sphere();
  const w = new THREE.Matrix4();
  const im = new THREE.Matrix4();
  let objects = 0;
  let tris = 0;
  const put = (g, mw) => {
    s.copy(g.boundingSphere).applyMatrix4(mw);
    if (Math.abs(s.center.x) - s.radius > REACH || Math.abs(s.center.z) - s.radius > REACH) return;
    const t = tileOf(s.center.x, s.center.z);
    const base = t.pos.length / 3;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mw);
      t.pos.push(v.x, v.y, v.z);
    }
    const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : p.count }];
    for (const gr of groups) {
      for (let i = gr.start; i < gr.start + gr.count; i++) t.idx.push(base + (g.index ? g.index.getX(i) : i));
    }
    tris += (g.index ? g.index.count : p.count) / 3;
  };
  scene.traverse((o) => {
    if (stillCaster(o, movers, scene) !== true) return;
    objects++;
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, im);
        put(o.geometry, w.multiplyMatrices(o.matrixWorld, im));
      }
    } else put(o.geometry, o.matrixWorld);
  });
  const root = new THREE.Group();
  const grey = new THREE.MeshBasicMaterial();
  for (const [k, t] of tiles) {
    if (!t.idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
    g.setIndex(t.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(t.idx, 1) : new THREE.Uint16BufferAttribute(t.idx, 1));
    const mesh = new THREE.Mesh(g, grey);
    mesh.name = `tile_${k}`;
    root.add(mesh);
  }
  const glb = await new GLTFExporter().parseAsync(root, { binary: true });
  if (postTo) await fetch(postTo, { method: 'POST', body: glb });
  return { objects, tris: Math.round(tris), tiles: root.children.length, moved: moved.map((o) => o.name || o.parent?.name), mb: +(glb.byteLength / 1048576).toFixed(1) };
}

/**
 * Load the proxy and switch it in: still casters stop casting, the tiles cast instead. Things added to the scene
 * later go through adopt(), so a model that arrives after the proxy hands over its shadow too.
 */
export class ShadowProxy {
  constructor(client, moonLight) {
    this.client = client;
    this.on = false;
    this.handed = new Set();
    moonLight.shadow.camera.layers.enable(SHADOW_LAYER);
    this.ready = new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .loadAsync('./models/shadow_proxy.glb')
      .then((gltf) => {
        const mat = new THREE.MeshBasicMaterial({ colorWrite: false });
        mat.shadowSide = THREE.DoubleSide;
        const group = new THREE.Group();
        group.name = 'shadowProxy';
        for (const m of [...gltf.scene.children]) {
          m.traverse((o) => {
            if (!o.isMesh) return;
            o.material = mat;
            o.castShadow = true;
            o.receiveShadow = false;
            o.layers.set(SHADOW_LAYER);
            o.geometry.computeBoundingSphere();
          });
          group.add(m);
        }
        group.layers.set(SHADOW_LAYER);
        this.group = group;
        client.scene.add(group);
        this.on = true;
        this.adopt(client.scene);
        // models that load into groups already in the park (not through scene.add) are picked up a little later
        for (const ms of [8000, 25000, 60000]) setTimeout(() => this.adopt(client.scene), ms);
      })
      .catch((e) => console.warn('shadow proxy', e));
  }

  /** Switch between the stand-in and the scenery's own shadows (to compare them). */
  set(on) {
    if (!this.group) return;
    this.on = on;
    this.group.visible = on;
    for (const m of this.handed) m.castShadow = !on;
  }

  /** Hand o's (and its children's) shadows to the proxy. */
  adopt(o) {
    if (!this.on || !o?.isObject3D) return;
    const movers = moverRoots(this.client);
    const scene = this.client.scene;
    o.traverse((m) => {
      if (stillCaster(m, movers, scene)) {
        m.castShadow = false;
        this.handed.add(m);
      }
    });
  }
}
