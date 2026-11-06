// Dressing for the walk-in buildings (Funhouse, Tunnel of Terror, Arcade): concrete footings, pilasters, a cornice
// and parapet, boarded-up windows, door frames, drainpipes, rain streaks and dirt, rooftop plant, and a themed
// false front. Everything here is visual only: the walls players bump into are the map's colliders.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUILDINGS } from '../shared/map.js';
import { rng } from '../shared/rng.js';

const T = 0.4; // wall thickness
const DOOR = 3;

/** Wall runs along a side of length len with door gaps at the given offsets: [[from, to], ...]. */
function segments(len, gaps = []) {
  const out = [];
  let s = -len / 2;
  for (const g of gaps.map((o) => [o - DOOR / 2, o + DOOR / 2]).sort((a, b) => a[0] - b[0])) {
    if (g[0] > s) out.push([s, g[0]]);
    s = g[1];
  }
  if (s < len / 2) out.push([s, len / 2]);
  return out;
}

/** The four sides: where the wall line is, which way is out, and how long it is. */
function sides(b) {
  return [
    { name: 'n', horiz: true, line: b.cz - b.d / 2, out: -1, len: b.w },
    { name: 's', horiz: true, line: b.cz + b.d / 2, out: 1, len: b.w },
    { name: 'w', horiz: false, line: b.cx - b.w / 2, out: -1, len: b.d },
    { name: 'e', horiz: false, line: b.cx + b.w / 2, out: 1, len: b.d },
  ];
}

/** Rain streaks running down from the top, dirt splashed up from the ground, damp blotches (alpha). */
function grimeTexture() {
  const W = 512;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const rr = rng(77);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  // streaks from the cornice and the window sills
  for (let i = 0; i < 140; i++) {
    const x = rr() * W;
    const y0 = rr() < 0.6 ? 0 : H * (0.3 + rr() * 0.2);
    const len = H * (0.15 + rr() * 0.6);
    const w = 1 + rr() * 7;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    const a = 0.25 + rr() * 0.45;
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, w, len);
  }
  // splash-back and rising damp along the bottom
  const g = ctx.createLinearGradient(0, H, 0, H * 0.62);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.62, W, H * 0.38);
  for (let i = 0; i < 60; i++) {
    const x = rr() * W;
    const y = H * (0.75 + rr() * 0.25);
    const r = 10 + rr() * 50;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(255,255,255,${0.2 + rr() * 0.3})`);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // damp patches anywhere
  for (let i = 0; i < 25; i++) {
    const x = rr() * W;
    const y = rr() * H;
    const r = 20 + rr() * 70;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(255,255,255,${0.1 + rr() * 0.2})`);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Light thrown up a wall by a lamp at its foot: bright at the bottom centre, fanning out and fading upward. */
function washTexture() {
  const W = 128;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const up = 1 - y / (H - 1); // 0 at the lamp, 1 at the top
    const spread = 0.12 + up * 0.38; // the beam widens as it climbs
    for (let x = 0; x < W; x++) {
      const dx = (x / (W - 1) - 0.5) / spread;
      const a = Math.exp(-dx * dx * 2.2) * Math.pow(1 - up, 1.6) * Math.min(1, (1 - up) * 12);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

/** Worn black-and-white funhouse floor tiles: chipped, scuffed and stained. */
function checkerTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rr = rng(4242);
  const n = 8;
  const t = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = (i + j) % 2 ? 26 + rr() * 14 : 168 + rr() * 30;
      ctx.fillStyle = `rgb(${v},${v * 0.98},${v * 0.94})`;
      ctx.fillRect(i * t, j * t, t, t);
    }
  }
  // grime, scuffs and chipped corners
  for (let k = 0; k < 900; k++) {
    ctx.fillStyle = `rgba(30,24,18,${rr() * 0.25})`;
    const r = 1 + rr() * 9;
    ctx.beginPath();
    ctx.arc(rr() * S, rr() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(20,16,12,0.6)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * t, 0);
    ctx.lineTo(i * t, S);
    ctx.moveTo(0, i * t);
    ctx.lineTo(S, i * t);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Inside the Funhouse and the Tunnel of Terror: what the ride left behind. */
function dressInteriors(B, scene, spots) {
  const P = { x: 0, z: 0, rot: 0 };
  const fun = BUILDINGS.find((b) => b.style === 'funhouse');
  if (fun) {
    // checkerboard floor, 2 m tiles
    const floorTex = checkerTexture();
    floorTex.repeat.set((fun.w - 0.4) / 4, (fun.d - 0.4) / 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(fun.w - 0.4, fun.d - 0.4), new THREE.MeshStandardMaterial({ map: floorTex, color: '#6e6a64', roughness: 0.7, envMapIntensity: 0.3 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(fun.cx, 0.02, fun.cz);
    floor.receiveShadow = true;
    scene.add(floor);
    // warped mirrors along the back wall and the first partition (dark glass where they have cracked)
    // old silvering: dim, grey and a little hazy, so it reads as a mirror in a dark room rather than a window
    const glass = new THREE.MeshStandardMaterial({ color: '#7c7e80', metalness: 1, roughness: 0.16, envMapIntensity: 0.35 });
    const cracked = new THREE.MeshStandardMaterial({ color: '#3a3c40', metalness: 1, roughness: 0.35 });
    const back = fun.cz - fun.d / 2 + 0.22;
    const mirrors = [];
    for (const [x, z, ry, broken] of [
      [fun.cx - 10.5, back, 0, false], [fun.cx - 2, back, 0, true], [fun.cx + 1.5, back, 0, false], [fun.cx + 5, back, 0, false], [fun.cx + 8.5, back, 0, true],
      [fun.cx - 5.78, fun.cz - 2, Math.PI / 2, false], [fun.cx - 5.78, fun.cz + 2, Math.PI / 2, false],
    ]) {
      const Pm = { x, z, rot: ry };
      B.box('trim', Pm, 0, 1.45, 0.04, 1.5, 2.7, 0.1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 2.4, 1, 8), broken ? cracked : glass);
      // a funhouse mirror bulges
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(((pos.getY(i) + 1.2) / 2.4) * Math.PI) * 0.12);
      m.geometry.computeVertexNormals();
      m.position.set(x + Math.sin(ry) * 0.1, 1.45, z + Math.cos(ry) * 0.1);
      m.rotation.y = ry;
      mirrors.push(m);
      scene.add(m);
    }
    // bare bulbs hanging on their flexes
    for (const [dx, dz] of [[-8, -4], [-2, -5], [4, -3], [-8, 3], [0, 4], [7, 2]]) {
      B.cyl('dark', P, fun.cx + dx, fun.h - 0.9, fun.cz + dz, 0.01, 0.01, 1.8, 4);
      B.sphere('bulb', P, fun.cx + dx, fun.h - 1.85, fun.cz + dz, 0.09, 8);
    }
    spots.push(['clown_statue', { x: fun.cx + 9.5, z: fun.cz - 5.5, rot: -0.6, w: 0.75, d: 0.86 }]);
  }
  const tun = BUILDINGS.find((b) => b.style === 'tunnel');
  if (tun) {
    // the ride's track: in at the left door, round the back, out at the right
    const path = [[tun.cx - 8, tun.cz + tun.d / 2 - 0.6], [tun.cx - 8, tun.cz - tun.d / 2 + 1.6], [tun.cx, tun.cz - tun.d / 2 + 0.9], [tun.cx + 8, tun.cz - tun.d / 2 + 1.6], [tun.cx + 8, tun.cz + tun.d / 2 - 0.6]];
    for (let i = 0; i < path.length - 1; i++) {
      const [x0, z0] = path[i];
      const [x1, z1] = path[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const ry = Math.atan2(x1 - x0, z1 - z0);
      const Pr = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, rot: ry };
      for (const sx of [-0.45, 0.45]) B.box('pipe', Pr, sx, 0.08, 0, 0.07, 0.07, len);
      for (let k = -len / 2; k <= len / 2; k += 0.9) B.box('trim', Pr, 0, 0.03, k, 1.3, 0.06, 0.18);
    }
    // a car stalled halfway round, its lap bar still down
    spots.push(['coaster_car', { x: tun.cx - 8, z: tun.cz - 1.5, y: 0.12, rot: 0, yaw: Math.PI / 2, w: 1.4, d: 2.5 }]);
    // red work lights along the walls
    for (const [dx, dz] of [[-12.6, -3], [-12.6, 3], [12.6, -3], [12.6, 3], [-4, -6.6], [4, -6.6]]) B.sphere('bulbRed', P, tun.cx + dx, 3.2, tun.cz + dz, 0.12, 8);
  }
}

/** A flat outline with an arched top (the Funhouse's false front), w wide and rising rise above its base. */
function archShape(w, base, rise) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, base);
  // shoulders, then a round crown
  s.lineTo(w * 0.32, base);
  s.quadraticCurveTo(w * 0.3, base + rise * 0.6, 0, base + rise);
  s.quadraticCurveTo(-w * 0.3, base + rise * 0.6, -w * 0.32, base);
  s.lineTo(-w / 2, base);
  s.closePath();
  return s;
}

/** A stepped gable (the Tunnel of Terror's false front). */
function gableShape(w, rise) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, rise * 0.25);
  s.lineTo(w * 0.3, rise * 0.25);
  s.lineTo(w * 0.3, rise * 0.55);
  s.lineTo(w * 0.12, rise * 0.55);
  s.lineTo(0, rise);
  s.lineTo(-w * 0.12, rise * 0.55);
  s.lineTo(-w * 0.3, rise * 0.55);
  s.lineTo(-w * 0.3, rise * 0.25);
  s.lineTo(-w / 2, rise * 0.25);
  s.closePath();
  return s;
}

/**
 * Dress every walk-in building. B: the world Builder (merged static meshes), spots: model placements
 * ([name, footprint]) for the shared instancer, X: the Builder for the outside (pilasters, cornices, windows, doors,
 * pipes, false fronts), which the Blender kit (src/kit.js) replaces once it loads. Returns where each themed front's
 * sign should hang.
 */
export function dressBuildings(B, scene, spots, X = B) {
  const grimeMat = new THREE.MeshStandardMaterial({
    color: '#1a150f', alphaMap: grimeTexture(), transparent: true, opacity: 0.7, depthWrite: false, roughness: 1,
    polygonOffset: true, polygonOffsetFactor: -2,
  });
  const grime = [];
  const signs = {};
  const washTex = washTexture();
  // old floodlights at the foot of the themed fronts, throwing light up the walls
  const uplight = (x, z, color, w = 4, h = 10) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      map: washTex, color, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    m.position.set(x, h / 2, z);
    m.renderOrder = 2;
    scene.add(m);
    B.box('pipe', { x: 0, z: 0, rot: 0 }, x, 0.18, z + 0.45, 0.5, 0.36, 0.35);
    B.sphere('bulb', { x: 0, z: 0, rot: 0 }, x, 0.3, z + 0.3, 0.12, 8);
  };
  for (const b of BUILDINGS) {
    const rr = rng(Math.round(b.cx * 13 + b.cz * 7));
    const P = { x: 0, z: 0, rot: 0 };
    const top = b.h + 0.9; // parapet height
    for (const s of sides(b)) {
      const gaps = b.doors[s.name] || [];
      const segs = segments(s.len, gaps);
      const front = s.name === 's' && (b.style === 'funhouse' || b.style === 'tunnel');
      // a box hugging this side: a = offset along it, off = distance out from the wall line, depth = thickness
      const put = (key, a, len, y, h, off, depth, rz = 0) => {
        const along = s.horiz ? b.cx + a : b.cz + a;
        const across = s.line + s.out * off;
        if (s.horiz) X.box(key, P, along, y, across, len, h, depth, 0, 0, rz);
        else X.box(key, P, across, y, along, depth, h, len, 0, rz, 0);
      };
      // cornice band and parapet with a concrete coping, all the way along (over the door lintels too)
      put('plinth', 0, s.len + 0.7, b.h - 0.22, 0.44, T / 2 + 0.12, 0.26);
      put(b.style, 0, s.len + 0.4, b.h + 0.45, 0.9, 0, 0.3);
      put('plinth', 0, s.len + 0.55, top + 0.06, 0.12, 0, 0.5);
      for (const [a0, a1] of segs) {
        const len = a1 - a0;
        const mid = (a0 + a1) / 2;
        // footing
        put('plinth', mid, len, 0.35, 0.7, T / 2 + 0.06, 0.13);
        // pilasters at both ends of the run and every few metres between
        const bays = Math.max(1, Math.round(len / 4.2));
        const xs = [];
        for (let i = 0; i <= bays; i++) xs.push(a0 + 0.25 + ((len - 0.5) * i) / bays);
        for (const x of xs) put(front ? 'trim' : 'plinth', x, 0.5, (0.7 + b.h - 0.44) / 2, b.h - 1.14, T / 2 + 0.08, 0.16);
        // boarded-up windows in most bays (not on the themed fronts)
        if (!front) {
          for (let i = 0; i < bays; i++) {
            const bw = (len - 0.5) / bays;
            if (bw < 2.6 || rr() < 0.25) continue;
            const cx = (xs[i] + xs[i + 1]) / 2;
            const wy = b.h * 0.55;
            put('trim', cx, 1.9, wy + 1.02, 0.14, T / 2 + 0.06, 0.12);
            put('trim', cx, 1.9, wy - 1.02, 0.14, T / 2 + 0.1, 0.2);
            for (const e of [-0.88, 0.88]) put('trim', cx + e, 0.14, wy, 2.0, T / 2 + 0.06, 0.12);
            const n = 4 + Math.floor(rr() * 2);
            for (let k = 0; k < n; k++) {
              if (rr() < 0.12) continue; // a board has come away
              put('boards', cx + (rr() - 0.5) * 0.1, 1.95, wy - 0.75 + (k * 1.5) / (n - 1), 0.3, T / 2 + 0.1, 0.05, (rr() - 0.5) * 0.12);
            }
          }
        }
        // grime over the whole run of wall, footing to coping
        const g = new THREE.PlaneGeometry(len, top + 0.1);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, (mid + (uv.getX(i) - 0.5) * len) / 6);
        if (s.horiz) {
          if (s.out < 0) g.rotateY(Math.PI);
          g.translate(b.cx + mid, (top + 0.1) / 2, s.line + s.out * (T / 2 + 0.02));
        } else {
          g.rotateY(s.out > 0 ? Math.PI / 2 : -Math.PI / 2);
          g.translate(s.line + s.out * (T / 2 + 0.02), (top + 0.1) / 2, b.cz + mid);
        }
        grime.push(g);
      }
      // door frames and a header over each opening
      for (const o of gaps) {
        for (const e of [-1, 1]) put('trim', o + e * (DOOR / 2 + 0.05), 0.3, 1.65, 3.3, T / 2 + 0.06, 0.18);
        put('trim', o, DOOR + 0.7, 3.35, 0.32, T / 2 + 0.08, 0.22);
        if (b.style === 'tunnel') for (const e of [-1, 1]) X.sphere('bulbRed', P, s.horiz ? b.cx + o + e * 1.2 : s.line + s.out * 0.4, 3.7, s.horiz ? s.line + s.out * 0.4 : b.cz + o + e * 1.2, 0.12, 8);
      }
    }
    // drainpipes down every corner
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = b.cx + sx * (b.w / 2 + 0.16);
        const z = b.cz + sz * (b.d / 2 + 0.16);
        X.cyl('pipe', P, x, (top - 0.2) / 2, z, 0.075, 0.075, top - 0.2, 8);
        X.cyl('pipe', P, x, top - 0.1, z, 0.16, 0.08, 0.3, 8);
        X.cyl('pipe', P, x + sx * 0.12, 0.12, z + sz * 0.12, 0.08, 0.08, 0.4, 8, sz * 0.9, -sx * 0.9);
      }
    }
    // air handlers and vents on the roof
    spots.push(['roof_kit', { x: b.cx + b.w * 0.12, z: b.cz - b.d * 0.12, y: b.h + 0.35, rot: 0.02, w: b.w * 0.45, d: b.d * 0.4 }]);
    // themed false fronts
    const fz = b.cz + b.d / 2;
    if (b.style === 'funhouse') {
      const rise = 5.2;
      const front = new THREE.ExtrudeGeometry(archShape(b.w * 0.75, 1.6, rise), { depth: 0.4, bevelEnabled: false });
      X.add('funhouse', front, P, b.cx, b.h, fz - 0.2);
      const rim = new THREE.ExtrudeGeometry(archShape(b.w * 0.75 + 0.5, 1.75, rise + 0.25), { depth: 0.3, bevelEnabled: false });
      X.add('trim', rim, P, b.cx, b.h - 0.05, fz - 0.3);
      // a giant clown face grins over the door: you walk in under its chin
      spots.push(['clown_face', { x: b.cx, z: fz + 0.35, y: 3.3, rot: 0, w: 6, d: 6, h: 5.8 }]);
      for (const a of [-0.42, -0.21, 0.21, 0.42]) uplight(b.cx + a * b.w, fz + T / 2 + 0.03, '#ffb46a');
      signs.funhouse = { x: b.cx, y: b.h + 2.4, z: fz + 0.35 };
    } else if (b.style === 'tunnel') {
      const rise = 5.5;
      const front = new THREE.ExtrudeGeometry(gableShape(b.w * 0.85, rise), { depth: 0.4, bevelEnabled: false });
      X.add('tunnel', front, P, b.cx, b.h, fz - 0.2);
      const rim = new THREE.ExtrudeGeometry(gableShape(b.w * 0.85 + 0.5, rise + 0.3), { depth: 0.3, bevelEnabled: false });
      X.add('plinth', rim, P, b.cx, b.h - 0.05, fz - 0.3);
      // stone gargoyles crouch on the corners and the gable steps
      for (const [gx, gy, gz, rot] of [
        [b.cx - b.w / 2 + 0.2, top + 0.12, fz - 0.1, -0.5], [b.cx + b.w / 2 - 0.2, top + 0.12, fz - 0.1, 0.5],
        [b.cx - b.w * 0.255, b.h + rise * 0.55, fz, -0.25], [b.cx + b.w * 0.255, b.h + rise * 0.55, fz, 0.25],
      ]) spots.push(['gargoyle', { x: gx, z: gz, y: gy, rot, w: 1.8, d: 2.1, h: 2.4 }]);
      signs.tunnel = { x: b.cx, y: b.h + 1.6, z: fz + 0.35 };
      for (const a of [-0.45, -0.12, 0.12, 0.45]) uplight(b.cx + a * b.w, fz + T / 2 + 0.03, '#ff3a26');
    }
  }
  dressInteriors(B, scene, spots);
  const mesh = new THREE.Mesh(mergeGeometries(grime, false), grimeMat);
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return signs;
}
