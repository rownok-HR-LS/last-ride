// The park's grime: oil stains, cracks, mud, cart tracks, drain covers, a stencilled EXIT, litter and drag stains on
// the ground, and spray-painted graffiti and torn posters on the walk-in buildings and trailers. The pictures are
// rendered in Blender (scripts/blender/make-decals.py -> public/tex/decals.webp, a 4 x 4 sheet); here they are
// scattered with a fixed seed and merged into two meshes (ground and walls), so they cost two draw calls.
import * as THREE from 'three';
import { PATHS, BUILDINGS, PROPS, BUS_ROUTE, clearance } from '../shared/map.js';
import { rng } from '../shared/rng.js';
import { addLampLight } from './lamplight.js';
import { compressed } from './ktx.js';

// tiles in the sheet (row by row)
const OIL = [0, 1];
const CRACK = [2, 3];
const MUD = [4, 5];
const TRACKS = 6;
const DRAIN = 7;
const GRAFFITI = [8, 9, 10];
const POSTER = [11, 12];
const EXIT = 13;
const LITTER = 14;
const DRAG = 15;

class Sheet {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
  }

  /** A quad centred at c, half-extents ax (the picture's right) and ay (its up), facing n, showing tile t. */
  quad(c, ax, ay, n, t, u0 = 0, u1 = 1) {
    const col = t % 4;
    const row = Math.floor(t / 4);
    const inset = 0.004;
    const U = (u) => (col + inset + u * (1 - 2 * inset)) / 4;
    const V = (v) => 1 - (row + 1 - inset - v * (1 - 2 * inset)) / 4;
    const base = this.pos.length / 3;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      this.pos.push(c.x + ax.x * sx + ay.x * sy, c.y + ax.y * sx + ay.y * sy, c.z + ax.z * sx + ay.z * sy);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(U(sx < 0 ? u0 : u1), V((sy + 1) / 2));
    }
    // wind the two triangles so their front faces the way n does
    const front = new THREE.Vector3().crossVectors(ax, ay).dot(n) > 0;
    if (front) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    return m;
  }
}

function decalMaterial(map, ground) {
  const m = new THREE.MeshStandardMaterial({
    map, transparent: true, depthWrite: false, roughness: ground ? 0.55 : 0.85, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  m.onBeforeCompile = (sh) => addLampLight(sh, { ground });
  return m;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Build the decals (two meshes in a group). */
export function buildDecals() {
  const tex = compressed('./tex/decals.ktx2');
  tex.anisotropy = 8;
  const r = rng(4242);
  const pick = (a) => (Array.isArray(a) ? a[Math.floor(r() * a.length)] : a);
  const G = new Sheet();
  const W = new Sheet();
  let layer = 0;
  const flat = (x, z, size, t, yaw = r() * Math.PI * 2, stretch = 1) => {
    const c = new THREE.Vector3(x, 0.012 + (layer++ % 40) * 0.0004, z);
    const ax = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(size / 2);
    const ay = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar((size / 2) * stretch);
    G.quad(c, ax, ay, UP, t);
  };

  // a spot on one of the paths (weighted by length): position and the path's direction
  const segs = [];
  for (const p of PATHS) {
    for (let i = 0; i < p.pts.length - 1; i++) {
      const [a, b] = [p.pts[i], p.pts[i + 1]];
      segs.push({ a, b, w: p.w, len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
    }
  }
  const total = segs.reduce((s, g) => s + g.len, 0);
  const onPath = () => {
    let d = r() * total;
    const s = segs.find((g) => (d -= g.len) <= 0) || segs[segs.length - 1];
    const t = r();
    const dx = (s.b[0] - s.a[0]) / s.len;
    const dz = (s.b[1] - s.a[1]) / s.len;
    const off = (r() - 0.5) * s.w * 0.8;
    return { x: s.a[0] + (s.b[0] - s.a[0]) * t - dz * off, z: s.a[1] + (s.b[1] - s.a[1]) * t + dx * off, yaw: Math.atan2(dx, dz) };
  };
  const anywhere = () => ({ x: (r() - 0.5) * 210, z: (r() - 0.5) * 210, yaw: r() * Math.PI * 2 });
  const KINDS = [
    { w: 18, tiles: OIL, path: 0.85, size: [1.2, 2.6] },
    { w: 22, tiles: CRACK, path: 0.9, size: [1.6, 3.2] },
    { w: 24, tiles: MUD, path: 0.25, size: [2.0, 4.5] },
    { w: 4, tiles: DRAIN, path: 1, size: [0.9, 0.9] },
    { w: 4, tiles: EXIT, path: 1, size: [1.8, 1.8], along: true },
    { w: 18, tiles: LITTER, path: 0.7, size: [0.9, 1.4] },
    { w: 6, tiles: DRAG, path: 0.5, size: [1.4, 2.4] },
  ];
  const kindTotal = KINDS.reduce((s, k) => s + k.w, 0);
  for (let n = 0; n < 190; n++) {
    let d = r() * kindTotal;
    const k = KINDS.find((q) => (d -= q.w) <= 0);
    const size = k.size[0] + r() * (k.size[1] - k.size[0]);
    for (let tries = 0; tries < 10; tries++) {
      const p = r() < k.path ? onPath() : anywhere();
      if (clearance(p.x, p.z, size * 0.35) < 0) continue;
      flat(p.x, p.z, size, pick(k.tiles), k.along ? p.yaw + Math.PI : undefined);
      break;
    }
  }
  // service-cart tracks along the bus's drive through the park, in broken stretches
  const pts = BUS_ROUTE.pts;
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s < len; s += 1.6) {
      run += 1.6;
      const x = a[0] + ((b[0] - a[0]) * s) / len;
      const z = a[1] + ((b[1] - a[1]) * s) / len;
      if (Math.abs(x) > 108 || Math.abs(z) > 108 || Math.sin(run * 0.045) < -0.2 || clearance(x, z, 0.8) < 0) continue;
      const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
      const c = new THREE.Vector3(x + Math.cos(yaw) * 1.1, 0.011, z - Math.sin(yaw) * 1.1);
      G.quad(c, new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(0.55), new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(0.8), UP, TRACKS);
    }
  }

  // walls: the sides and backs of the walk-in buildings (their fronts carry the false fronts), away from doors
  const wall = (c, n, size, t) => {
    const ax = new THREE.Vector3().crossVectors(UP, n).multiplyScalar(size / 2);
    W.quad(c, ax, UP.clone().multiplyScalar(size / 2), n, t);
  };
  for (const b of BUILDINGS) {
    const sides = [
      { name: 'n', len: b.w, at: (u) => new THREE.Vector3(b.cx + u, 0, b.cz - b.d / 2 - 0.23), n: new THREE.Vector3(0, 0, -1) },
      { name: 'e', len: b.d, at: (u) => new THREE.Vector3(b.cx + b.w / 2 + 0.23, 0, b.cz + u), n: new THREE.Vector3(1, 0, 0) },
      { name: 'w', len: b.d, at: (u) => new THREE.Vector3(b.cx - b.w / 2 - 0.23, 0, b.cz + u), n: new THREE.Vector3(-1, 0, 0) },
    ];
    for (const s of sides) {
      // the kit's pilasters split each run of wall into bays (scripts/blender/build-kit.py): paint between them
      const gaps = (b.doors?.[s.name] || []).map((o) => [o - 1.5, o + 1.5]).sort((p, q) => p[0] - q[0]);
      const runs = [];
      let a = -s.len / 2;
      for (const [g0, g1] of gaps) {
        if (g0 > a) runs.push([a, g0]);
        a = g1;
      }
      if (a < s.len / 2) runs.push([a, s.len / 2]);
      for (const [a0, a1] of runs) {
        const seg = a1 - a0;
        const bays = Math.max(1, Math.round(seg / 4.2));
        const step = (seg - 0.56) / bays;
        for (let i = 0; i < bays; i++) {
          if (r() > 0.55 || step < 1.6) continue;
          const u = a0 + 0.28 + step * (i + 0.5) + (r() - 0.5) * Math.max(0, step - 2.6) * 0.5;
          const poster = r() < 0.4;
          const size = Math.min(poster ? 1.3 : 1.5 + r() * 0.7, step - 0.75);
          const c = s.at(u);
          c.y = poster ? 1.6 : 0.85 + size / 2 + r() * 0.3;
          wall(c, s.n, size, pick(poster ? POSTER : GRAFFITI));
        }
      }
    }
  }
  for (const p of PROPS.filter((q) => q.type === 'trailer')) {
    for (const side of [-1, 1]) {
      const rot = p.rot || 0;
      const n = new THREE.Vector3(Math.sin(rot) * side, 0, Math.cos(rot) * side);
      const c = new THREE.Vector3(p.x, 1.55, p.z).addScaledVector(n, 1.43);
      c.add(new THREE.Vector3(Math.cos(rot), 0, -Math.sin(rot)).multiplyScalar((r() - 0.5) * 3));
      wall(c, n, 1.5, pick(r() < 0.3 ? POSTER : GRAFFITI));
    }
  }

  const group = new THREE.Group();
  group.name = 'decals';
  group.add(G.mesh(decalMaterial(tex, true)), W.mesh(decalMaterial(tex, false)));
  return group;
}
