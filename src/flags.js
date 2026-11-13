// Flags in the storm: the big top's and every game tent's flag, and two new ones on the gate's pillars, are cloth
// flapping in the wind (scripts/blender/bake-motion.py flag(), played by src/motion.js), all streaming downwind. The
// scanned tents carried their flags baked into the canvas, still: those are clipped out of the scans (a discard in
// their shaders, inside each flag's region) and the moving ones hang in their place on the same poles.
import * as THREE from 'three';
import { PROPS } from '../shared/map.js';
import { loadMotion, motionGeometry, motionMaterial } from './motion.js';
import { placementOf } from './models.js';
import { wetten } from './wet.js';

/** Which way the flags stream (radians about y): with the storm's prevailing wind. */
const HEADING = 0.9;
/**
 * Where each scan's flag is, in its own model space: the pole's axis (x, z), the cloth's height as fractions of the
 * model's height (bottom, top), the pole's radius (anything further out in that band is cloth) and how far out the
 * ball on top reaches. Measured from the scans.
 */
const SCANS = {
  bigtop: { axis: [-22.0, 434.7], y0: 0.84, y1: 0.968, pole: 7, ball: 14, color: '#d98a2b', aspect: 1.75 },
  tent_small: { axis: [0, 0], y0: 0.855, y1: 0.99, pole: 0.0016, ball: 0.003, color: '#a8262a', aspect: 1.6 },
};

/** Cut away the parts of a material's surfaces inside these world regions: [{ x, z, y0, y1, r, rTop, yMax }]. */
function clipOut(mat, regions) {
  const prev = mat.onBeforeCompile;
  const A = regions.map((g) => new THREE.Vector4(g.x, g.z, g.y0, g.r));
  const B = regions.map((g) => new THREE.Vector4(g.y1, g.rTop, g.yMax, 0));
  while (A.length < 12) {
    A.push(new THREE.Vector4(0, 0, 1e9, 0));
    B.push(new THREE.Vector4(1e9, 0, 1e9, 0));
  }
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.clipA = { value: A };
    sh.uniforms.clipB = { value: B };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vClipW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 cw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cw = instanceMatrix * cw;
          #endif
          #ifdef USE_BATCHING
            cw = batchingMatrix * cw;
          #endif
          vClipW = (modelMatrix * cw).xyz;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vClipW;\nuniform vec4 clipA[12];\nuniform vec4 clipB[12];')
      .replace('void main() {', `void main() {
        // (the scan's own flag, cut away: a moving one hangs here instead)
        for (int i = 0; i < 12; i++) {
          float d = distance(vClipW.xz, clipA[i].xy);
          if (vClipW.y > clipA[i].z && vClipW.y < clipB[i].x && d > clipA[i].w) discard;
          if (vClipW.y >= clipB[i].x && vClipW.y < clipB[i].z && d > clipB[i].y) discard;
        }`);
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${key ? key() : ''}|clip`;
  mat.needsUpdate = true;
}

/** All the park's flags (and the gate's new poles) as one group, or null. */
export async function buildFlags() {
  const m = await loadMotion('flag');
  const spots = [];
  const jobs = [];
  const big = PROPS.find((p) => p.type === 'bigtop');
  if (big) jobs.push(['bigtop', [{ x: big.x, z: big.z, rot: 0.4, w: big.r * 3.9, d: big.r * 3.9 }]]);
  const tents = PROPS.filter((p) => p.type === 'gametent');
  if (tents.length) jobs.push(['tent_small', tents.map((p) => ({ x: p.x, z: p.z, rot: (p.x + p.z) % 6.28, w: p.r * 2.1, d: p.r * 2.1 }))]);
  for (const [file, list] of jobs) {
    const S = SCANS[file];
    const regions = [];
    let src = null;
    for (const o of list) {
      const pl = await placementOf(file, o);
      src = pl.src;
      const H = pl.ymax - pl.ymin;
      const at = (f) => new THREE.Vector3(S.axis[0], pl.ymin + H * f, S.axis[1]).applyMatrix4(pl.matrix);
      const bottom = at(S.y0);
      const topCloth = at(S.y1);
      const topAll = at(1.02);
      const k = new THREE.Vector3().setFromMatrixScale(pl.matrix).x;
      regions.push({ x: bottom.x, z: bottom.z, y0: bottom.y - 0.05, y1: topCloth.y, r: S.pole * k, rTop: S.ball * k, yMax: topAll.y + 1 });
      const h = topCloth.y - bottom.y;
      spots.push({ x: bottom.x, y: topCloth.y, z: bottom.z, h, len: h * S.aspect, color: S.color });
    }
    // every material of the scan (its copies all share them)
    const mats = new Set();
    src?.traverse((o) => o.isMesh && [].concat(o.material).forEach((mt) => mats.add(mt)));
    for (const mt of mats) clipOut(mt, regions);
  }
  // the gate: a flag on a short pole above each pillar's gold ball
  const gate = PROPS.find((p) => p.type === 'arch');
  const poles = [];
  if (gate) {
    for (const sx of [-7, 7]) {
      poles.push({ x: gate.x + sx, z: gate.z, y0: 11.2, y1: 14.6 });
      spots.push({ x: gate.x + sx, y: 14.5, z: gate.z, h: 1.15, len: 1.9, color: '#6c2f86' });
    }
  }
  if (!spots.length) return null;
  const mat = motionMaterial(wetten(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85 })), m);
  const mesh = new THREE.InstancedMesh(motionGeometry(m), mat, spots.length);
  mesh.name = 'flags';
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), HEADING);
  const mm = new THREE.Matrix4();
  const col = new THREE.Color();
  spots.forEach((s, i) => {
    // the flag's model: pole edge at x 0, top edge at y 0, 0.9 m long, 0.56 m tall
    mm.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.len / 0.9, s.h / 0.56, s.h / 0.56));
    mesh.setMatrixAt(i, mm);
    mesh.setColorAt(i, col.set(s.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.userData.moves = true;
  mesh.castShadow = true;
  const group = new THREE.Group();
  group.name = 'flags';
  group.add(mesh);
  const poleMat = new THREE.MeshStandardMaterial({ color: '#3a3a3e', roughness: 0.6, metalness: 0.4 });
  for (const p of poles) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, p.y1 - p.y0, 8), poleMat);
    c.position.set(p.x, (p.y0 + p.y1) / 2, p.z);
    c.castShadow = true;
    group.add(c);
  }
  return group;
}

/**
 * Canvas at the big top's doorway, flapping in the gusts that blow through it: a scalloped red valance across the
 * top of the arch and a cream flap down each side, just in front of the scan's own tied-back curtains. (Where the
 * doorway is was found by casting rays at the scan: open from about 18 to 37 degrees, up to 8.5 m.)
 */
export async function buildDoorFlaps() {
  const big = PROPS.find((p) => p.type === 'bigtop');
  if (!big) return null;
  const [val, flap] = await Promise.all([loadMotion('valance'), loadMotion('flap')]);
  const group = new THREE.Group();
  group.name = 'doorFlaps';
  const place = (m, color, items) => {
    const mat = motionMaterial(wetten(new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.9 })), m, undefined, { ampFloor: 0.4 });
    const mesh = new THREE.InstancedMesh(motionGeometry(m), mat, items.length);
    const mm = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    items.forEach(([deg, r, y, sx, sy], i) => {
      const a = (deg * Math.PI) / 180;
      // across the doorway (the sheet's width) along the wall, facing out
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
      mm.compose(new THREE.Vector3(big.x + Math.sin(a) * r, y, big.z + Math.cos(a) * r), q, new THREE.Vector3(sx, sy, 1));
      mesh.setMatrixAt(i, mm);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.moves = true;
    group.add(mesh);
  };
  place(val, '#9a2228', [[27.5, 19.4, 8.7, 2.15, 1.6]]);
  place(flap, '#a99d88', [[15.5, 19.7, 8.4, 1.1, 1.3], [39.5, 19.7, 8.4, 1.1, 1.3]]);
  return group;
}

/**
 * The little game tents' doorways: a pair of canvas flaps over each (the same storm-blown cloth as the big top's),
 * hinged at their outer edges, that swing aside when someone comes up to the door and fall back after. The scan's
 * doorway faces its own +z, about 3.4 m out, 2 m wide and 2.3 m high (found by casting rays at it, then by eye).
 */
const TENT_DOOR = { r: 3.42, top: 2.3, half: 0.03, sx: 0.84, sy: 0.57 };
let tentFlaps = null;

export async function buildTentFlaps() {
  const tents = PROPS.filter((p) => p.type === 'gametent');
  if (!tents.length) return null;
  const m = await loadMotion('flap');
  // the tents' own dark red stripe, so the curtains read against the pale canvas inside
  const mat = motionMaterial(wetten(new THREE.MeshStandardMaterial({ color: '#7a2226', side: THREE.DoubleSide, roughness: 0.92 })), m, undefined, { ampFloor: 0.35 });
  const mesh = new THREE.InstancedMesh(motionGeometry(m), mat, tents.length * 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.moves = true;
  mesh.frustumCulled = false;
  const doors = tents.map((p) => {
    // the same turn world.js gives the scanned tent
    const rot = (p.x + p.z) % 6.28;
    const ox = Math.sin(rot);
    const oz = Math.cos(rot);
    return { x: p.x + ox * TENT_DOOR.r, z: p.z + oz * TENT_DOOR.r, rot, tx: oz, tz: -ox, open: 0 };
  });
  tentFlaps = { mesh, doors };
  placeTentFlaps();
  return mesh;
}

const _fm = new THREE.Matrix4();
const _fr = new THREE.Matrix4();
const _ft = new THREE.Matrix4();
const _fs = new THREE.Matrix4();

function placeTentFlaps() {
  const { mesh, doors } = tentFlaps;
  const D = TENT_DOOR;
  const w = 0.6 * D.sx;
  doors.forEach((d, i) => {
    for (const [k, side] of [[0, -1], [1, 1]]) {
      // hinge at the flap's outer edge; it swings out and away from the doorway as it opens
      const hx = d.x + d.tx * side * (D.half + w);
      const hz = d.z + d.tz * side * (D.half + w);
      _fm.makeTranslation(hx, D.top, hz);
      _fr.makeRotationY(d.rot + side * d.open * 1.25);
      _ft.makeTranslation(-side * w, 0, 0);
      _fs.makeScale(D.sx, D.sy, 1);
      _fm.multiply(_fr).multiply(_ft).multiply(_fs);
      mesh.setMatrixAt(i * 2 + k, _fm);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
}

/** Each frame: riders (anything with x, z, and state 'alive') near a doorway push its flaps aside. */
export function updateTentFlaps(riders, dt) {
  if (!tentFlaps) return;
  let moved = false;
  for (const d of tentFlaps.doors) {
    let near = 0;
    for (const p of riders || []) {
      if (p.state !== 'alive') continue;
      const dist = Math.hypot(p.x - d.x, p.z - d.z);
      near = Math.max(near, 1 - Math.min(1, Math.max(0, (dist - 0.9) / 1.2)));
    }
    // quick to open, slow to fall back
    const to = near;
    const k = Math.min(1, dt * (to > d.open ? 6 : 1.4));
    const v = d.open + (to - d.open) * k;
    if (Math.abs(v - d.open) > 1e-4) {
      d.open = v;
      moved = true;
    }
  }
  if (moved) placeTentFlaps();
}
