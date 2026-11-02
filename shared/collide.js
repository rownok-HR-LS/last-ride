// Collision queries against the park colliders: a coarse grid, circle push-out, ground height and ray casts.
import { COLLIDERS, rotXZ } from './map.js';
import { MAP_HALF, STEP_HEIGHT } from './constants.js';

const CELL = 8;
const ORIGIN = -MAP_HALF - 8;
const N = Math.ceil((MAP_HALF * 2 + 16) / CELL);
const grid = Array.from({ length: N * N }, () => []);

function cellOf(v) {
  return Math.max(0, Math.min(N - 1, Math.floor((v - ORIGIN) / CELL)));
}

for (const c of COLLIDERS) {
  const rad = c.k === 'cyl' ? c.r : Math.hypot(c.hx, c.hz);
  c.rad = rad;
  for (let i = cellOf(c.x - rad); i <= cellOf(c.x + rad); i++) {
    for (let j = cellOf(c.z - rad); j <= cellOf(c.z + rad); j++) grid[j * N + i].push(c);
  }
}

let stamp = 1;
const scratch = [];

/** Colliders whose cells touch the square around (x, z). Reuses a scratch array. */
export function nearby(x, z, r) {
  stamp++;
  scratch.length = 0;
  for (let i = cellOf(x - r); i <= cellOf(x + r); i++) {
    for (let j = cellOf(z - r); j <= cellOf(z + r); j++) {
      for (const c of grid[j * N + i]) {
        if (c.stamp === stamp) continue;
        c.stamp = stamp;
        scratch.push(c);
      }
    }
  }
  return scratch;
}

/** Push vector [px, pz] moving a circle out of a collider footprint, or null if apart. */
function circlePush(c, x, z, r) {
  if (c.k === 'cyl') {
    const dx = x - c.x;
    const dz = z - c.z;
    const d = Math.hypot(dx, dz);
    const min = r + c.r;
    if (d >= min) return null;
    if (d < 1e-6) return [min, 0];
    return [(dx / d) * (min - d), (dz / d) * (min - d)];
  }
  const [lx, lz] = rotXZ(x - c.x, z - c.z, -c.rot);
  const cx = Math.max(-c.hx, Math.min(c.hx, lx));
  const cz = Math.max(-c.hz, Math.min(c.hz, lz));
  const ox = lx - cx;
  const oz = lz - cz;
  const d = Math.hypot(ox, oz);
  let px;
  let pz;
  if (d > 1e-6) {
    if (d >= r) return null;
    px = (ox / d) * (r - d);
    pz = (oz / d) * (r - d);
  } else {
    // centre inside the box: leave through the nearest face
    const ex = c.hx - Math.abs(lx);
    const ez = c.hz - Math.abs(lz);
    if (ex < ez) {
      px = Math.sign(lx || 1) * (ex + r);
      pz = 0;
    } else {
      px = 0;
      pz = Math.sign(lz || 1) * (ez + r);
    }
  }
  return rotXZ(px, pz, c.rot);
}

/** True if the collider footprint overlaps the circle. */
export function footprintHit(c, x, z, r) {
  return circlePush(c, x, z, r) !== null;
}

/**
 * Push a vertical cylinder body (feet y, height h, radius r) out of walls.
 * Anything whose top is within step height of the feet is walkable and ignored.
 * Returns true if something was hit.
 */
export function pushOut(body, r, h, step = STEP_HEIGHT) {
  let hit = false;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const c of nearby(body.x, body.z, r + 1)) {
      if (c.y1 <= body.y + step || c.y0 >= body.y + h) continue;
      const p = circlePush(c, body.x, body.z, r);
      if (!p) continue;
      body.x += p[0];
      body.z += p[1];
      moved = true;
      hit = true;
    }
    if (!moved) break;
  }
  return hit;
}

/** Highest walkable surface under a circle whose top is at most `reach` above the feet. */
export function groundAt(x, z, r, feet, reach = STEP_HEIGHT) {
  let g = 0;
  for (const c of nearby(x, z, r + 1)) {
    if (c.y1 > feet + reach || c.y1 <= g) continue;
    if (circlePush(c, x, z, r)) g = c.y1;
  }
  return g;
}

/** Lowest underside above the feet that the head would bump into, or Infinity. */
export function ceilingAt(x, z, r, feet, top) {
  let ceil = Infinity;
  for (const c of nearby(x, z, r + 1)) {
    if (c.y0 <= feet + STEP_HEIGHT || c.y0 > top || c.y0 >= ceil) continue;
    if (circlePush(c, x, z, r)) ceil = c.y0;
  }
  return ceil;
}

// ------------------------------------------------------------------ rays

function rayCollider(c, ox, oy, oz, dx, dy, dz, maxT) {
  if (c.k === 'cyl') {
    const fx = ox - c.x;
    const fz = oz - c.z;
    const inside = fx * fx + fz * fz < c.r * c.r;
    if (inside && oy > c.y0 && oy < c.y1) return null;
    let best = null;
    const a = dx * dx + dz * dz;
    if (a > 1e-9 && !inside) {
      const b = fx * dx + fz * dz;
      const cc = fx * fx + fz * fz - c.r * c.r;
      const disc = b * b - a * cc;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / a;
        const y = oy + dy * t;
        if (t >= 0 && t < maxT && y >= c.y0 && y <= c.y1) {
          best = { t, nx: (fx + dx * t) / c.r, ny: 0, nz: (fz + dz * t) / c.r };
        }
      }
    }
    for (const [py, ny] of [[c.y1, 1], [c.y0, -1]]) {
      if (Math.abs(dy) < 1e-9 || (ny > 0 ? oy < py : oy > py)) continue;
      const t = (py - oy) / dy;
      if (t < 0 || t >= (best ? best.t : maxT)) continue;
      const hx = fx + dx * t;
      const hz = fz + dz * t;
      if (hx * hx + hz * hz <= c.r * c.r) best = { t, nx: 0, ny, nz: 0 };
    }
    return best;
  }
  const [lox, loz] = rotXZ(ox - c.x, oz - c.z, -c.rot);
  const [ldx, ldz] = rotXZ(dx, dz, -c.rot);
  const o = [lox, oy, loz];
  const d = [ldx, dy, ldz];
  const mn = [-c.hx, c.y0, -c.hz];
  const mx = [c.hx, c.y1, c.hz];
  let tmin = 0;
  let tmax = maxT;
  let axis = -1;
  let sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (mn[i] - o[i]) * inv;
    let t2 = (mx[i] - o[i]) * inv;
    let s = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis === -1) return null; // origin inside
  const n = [0, 0, 0];
  n[axis] = sign;
  const [nx, nz] = rotXZ(n[0], n[2], c.rot);
  return { t: tmin, nx, ny: n[1], nz };
}

/** Nearest hit along a normalised ray against colliders and the ground (y = 0), or null. */
export function rayWorld(ox, oy, oz, dx, dy, dz, maxT = 300) {
  let best = null;
  if (dy < 0) {
    const t = -oy / dy;
    if (t >= 0 && t < maxT) best = { t, nx: 0, ny: 1, nz: 0, ground: true };
  }
  // walk the grid cells the ray crosses (2D DDA)
  stamp++;
  let ix = cellOf(ox);
  let iz = cellOf(oz);
  const stepX = dx > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tdx = Math.abs(dx) > 1e-9 ? CELL / Math.abs(dx) : Infinity;
  const tdz = Math.abs(dz) > 1e-9 ? CELL / Math.abs(dz) : Infinity;
  const bx = ORIGIN + (ix + (dx > 0 ? 1 : 0)) * CELL;
  const bz = ORIGIN + (iz + (dz > 0 ? 1 : 0)) * CELL;
  let tx = Math.abs(dx) > 1e-9 ? (bx - ox) / dx : Infinity;
  let tz = Math.abs(dz) > 1e-9 ? (bz - oz) / dz : Infinity;
  let tCell = 0;
  for (let guard = 0; guard < N * 2 + 2; guard++) {
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) break;
    for (const c of grid[iz * N + ix]) {
      if (c.stamp === stamp) continue;
      c.stamp = stamp;
      const h = rayCollider(c, ox, oy, oz, dx, dy, dz, best ? best.t : maxT);
      if (h && (!best || h.t < best.t)) best = h;
    }
    if (best && best.t <= tCell) break;
    if (tx < tz) {
      tCell = tx;
      tx += tdx;
      ix += stepX;
    } else {
      tCell = tz;
      tz += tdz;
      iz += stepZ;
    }
    if (tCell > maxT) break;
  }
  return best;
}

/** True if nothing solid blocks the segment between two points. */
export function lineOfSight(ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  return !rayWorld(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05);
}

/** Ray against a living player's hitboxes (big stylised head + body cylinder). */
export function rayPlayer(ox, oy, oz, dx, dy, dz, px, py, pz, maxT, low = false) {
  let best = null;
  // head sphere
  {
    const cx = ox - px;
    const cy = oy - (py + (low ? 0.8 : 1.6));
    const cz = oz - pz;
    const b = cx * dx + cy * dy + cz * dz;
    const c = cx * cx + cy * cy + cz * cz - 0.27 * 0.27;
    const disc = b * b - c;
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc);
      if (t >= 0 && t < maxT) best = { t, head: true };
    }
  }
  // body cylinder
  const h = rayCollider({ k: 'cyl', x: px, z: pz, r: 0.38, y0: py, y1: py + (low ? 0.65 : 1.38) }, ox, oy, oz, dx, dy, dz, best ? best.t : maxT);
  if (h && (!best || h.t < best.t)) best = { t: h.t, head: false };
  return best;
}
