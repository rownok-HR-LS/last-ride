// Ground cover: Poly Haven scans (CC0) of ferns, shrubs, dry branches, stumps, mossy rocks, fallen trunks and roots,
// plus procedural tufts of dead grass. Everything is instanced and placed off the walkways and outside buildings.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { PARK_EDGE, pathDistance, clearance, LANDMARKS_OUT } from '../shared/map.js';
import { rng } from '../shared/rng.js';
import { cullable } from './cull.js';

/**
 * model -> where it grows: [park count, woods count, scale range, cast shadows]. Solid things (stumps, rocks, logs,
 * roots) only grow outside the fence, where nobody walks; inside the park only soft plants you can wade through.
 */
const KINDS = {
  fern_02: [520, 520, [0.7, 1.3], false],
  shrub_02: [90, 160, [0.6, 1.1], false],
  shrub_03: [90, 160, [0.6, 1.1], false],
  shrub_04: [90, 160, [0.6, 1.1], false],
  dry_branches_medium_01: [160, 260, [0.8, 1.4], false],
  tree_stump_01: [0, 70, [0.8, 1.3], true],
  tree_stump_02: [0, 70, [0.8, 1.3], true],
  rock_moss_set_01: [0, 40, [0.5, 0.9], true],
  rock_moss_set_02: [0, 40, [0.5, 0.9], true],
  dead_tree_trunk: [0, 50, [0.9, 1.2], true],
  dead_tree_trunk_02: [0, 40, [0.9, 1.2], true],
  root_cluster_01: [0, 40, [0.6, 1.0], true],
};

/** A spot in the park (off the paths, outside buildings) or in the woods along the road and around the fence. */
function spot(rr, park, r) {
  for (let tries = 0; tries < 30; tries++) {
    let x;
    let z;
    if (park) {
      x = (rr() * 2 - 1) * (PARK_EDGE - 2);
      z = (rr() * 2 - 1) * (PARK_EDGE - 2);
      if (pathDistance(x, z) < 0.6) continue;
      if (clearance(x, z, r) < 0.2) continue;
    } else if (rr() < 0.6) {
      // along the road in
      const side = rr() < 0.5 ? -1 : 1;
      x = side * (6.5 + rr() * rr() * 40);
      z = PARK_EDGE + 4 + rr() * 300;
    } else {
      const a = rr() * Math.PI * 2;
      const d = PARK_EDGE + 4 + rr() * 45;
      x = Math.cos(a) * d;
      z = Math.sin(a) * d;
      if (Math.abs(x) < 6 && z > 0) continue;
      if (Math.abs(x) < PARK_EDGE + 2 && Math.abs(z) < PARK_EDGE + 2) continue;
      if (LANDMARKS_OUT.some((l) => Math.hypot(x - l.x, z - l.z) < l.r - 2)) continue;
    }
    return [x, z];
  }
  return null;
}

/** Copy a geometry with plain float attributes (compressed int16 ones clamp when transformed). */
function floatGeo(src) {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) {
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (src.index) g.setIndex(src.index.clone());
  for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  return g;
}

function parts(scene) {
  scene.updateMatrixWorld(true);
  const out = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = floatGeo(o.geometry).applyMatrix4(o.matrixWorld);
    const m = o.material;
    m.side = THREE.DoubleSide;
    if (m.map) m.map.anisotropy = 4;
    out.push([g, m]);
  });
  return out;
}

function place(scene, pieces, list, shadows) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (const [geo, mat] of pieces) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => {
      e.set(t.tilt, t.rot, 0);
      q.setFromEuler(e);
      m.compose(p.set(t.x, -0.02, t.z), q, s.setScalar(t.s));
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    // small plants vanish into the mist long before the big stumps and rocks do
    cullable(mesh, shadows ? 150 : 100, shadows ? 25 : 0);
  }
}

/** Tufts of dead grass: a few bent, tapered blades, dark at the root and straw-coloured at the tips. */
function grassTuft() {
  const pos = [];
  const col = [];
  const base = new THREE.Color('#3b3a26');
  const tip = new THREE.Color('#a39a6a');
  const rr = rng(31);
  // many fine blades, mostly upright, so tufts read as grass (not spiky agave)
  for (let b = 0; b < 16; b++) {
    const a = rr() * Math.PI * 2;
    const r0 = rr() * 0.12;
    const h = 0.16 + rr() * 0.3;
    const lean = 0.03 + rr() * 0.11;
    const w = 0.005 + rr() * 0.004;
    const cx = Math.cos(a) * r0;
    const cz = Math.sin(a) * r0;
    const dx = Math.cos(a) * lean;
    const dz = Math.sin(a) * lean;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    // two segments: base quad + tip triangle
    const mid = [cx + dx * 0.4, h * 0.55, cz + dz * 0.4];
    const top = [cx + dx, h, cz + dz];
    const v = (x, y, z, c) => {
      pos.push(x, y, z);
      col.push(c.r, c.g, c.b);
    };
    const cm = base.clone().lerp(tip, 0.55);
    v(cx - px, 0, cz - pz, base); v(cx + px, 0, cz + pz, base); v(mid[0] + px * 0.7, mid[1], mid[2] + pz * 0.7, cm);
    v(cx - px, 0, cz - pz, base); v(mid[0] + px * 0.7, mid[1], mid[2] + pz * 0.7, cm); v(mid[0] - px * 0.7, mid[1], mid[2] - pz * 0.7, cm);
    v(mid[0] - px * 0.7, mid[1], mid[2] - pz * 0.7, cm); v(mid[0] + px * 0.7, mid[1], mid[2] + pz * 0.7, cm); v(top[0], top[1], top[2], tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // blades catch light from above, not edge-on
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  return g;
}

function plantGrass(scene, rr) {
  const geo = grassTuft();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  const list = [];
  for (let i = 0; i < 28000; i++) {
    const s = spot(rr, i < 18000, 0.2);
    if (s) list.push(s);
  }
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  // clumps differ: dry straw, greyer, a few still green
  const tints = ['#ffffff', '#e8dcc0', '#cfd8b4', '#b8bcae'].map((c) => new THREE.Color(c));
  list.forEach(([x, z], i) => {
    const k = 0.7 + rr() * 0.8;
    m.compose(p.set(x, 0, z), q.setFromAxisAngle(up, rr() * 6.28), sc.set(k, k * (0.8 + rr() * 0.6), k));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, tints[Math.floor(rr() * tints.length)]);
  });
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
  // tufts only matter near the player
  cullable(mesh, 65);
}

export async function buildScatter(scene) {
  const rr = rng(2718);
  plantGrass(scene, rr);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(Object.entries(KINDS).map(async ([name, [inPark, inWoods, [s0, s1], shadows]]) => {
    const g = await loader.loadAsync(`./models/env/${name}.glb`);
    const pieces = parts(g.scene);
    const list = [];
    const big = shadows ? 1.2 : 0.4;
    for (let i = 0; i < inPark + inWoods; i++) {
      const s = spot(rr, i < inPark, big);
      if (!s) continue;
      const lying = name.startsWith('dead_tree_trunk');
      list.push({ x: s[0], z: s[1], rot: rr() * Math.PI * 2, tilt: lying ? 0 : (rr() - 0.5) * 0.1, s: s0 + rr() * (s1 - s0) });
    }
    place(scene, pieces, list, shadows);
  }));
}
