// Walkability grid + A* for survivor bots.
import { COLLIDERS } from './map.js';
import { footprintHit } from './collide.js';
import { MAP_HALF, PLAYER_RADIUS, STEP_HEIGHT } from './constants.js';

export const NAV_CELL = 2;
const N = Math.ceil((MAP_HALF * 2) / NAV_CELL);
const blocked = new Uint8Array(N * N);

for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = -MAP_HALF + (i + 0.5) * NAV_CELL;
    const z = -MAP_HALF + (j + 0.5) * NAV_CELL;
    for (const c of COLLIDERS) {
      if (c.y1 <= STEP_HEIGHT || c.y0 >= 1.8) continue;
      if (Math.abs(c.x - x) > c.rad + 3 || Math.abs(c.z - z) > c.rad + 3) continue;
      if (footprintHit(c, x, z, PLAYER_RADIUS + 0.55)) {
        blocked[j * N + i] = 1;
        break;
      }
    }
  }
}

function idx(x, z) {
  const i = Math.floor((x + MAP_HALF) / NAV_CELL);
  const j = Math.floor((z + MAP_HALF) / NAV_CELL);
  if (i < 0 || j < 0 || i >= N || j >= N) return -1;
  return j * N + i;
}

function center(k) {
  return [-MAP_HALF + ((k % N) + 0.5) * NAV_CELL, -MAP_HALF + (Math.floor(k / N) + 0.5) * NAV_CELL];
}

export function walkable(x, z) {
  const k = idx(x, z);
  return k >= 0 && !blocked[k];
}

/** Nearest open cell to (x, z), searching outward. */
function nearestOpen(k) {
  if (k >= 0 && !blocked[k]) return k;
  const ci = k % N;
  const cj = Math.floor(k / N);
  for (let r = 1; r < 8; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        if (!blocked[j * N + i]) return j * N + i;
      }
    }
  }
  return -1;
}

/** Straight walk check on the grid (for path smoothing). */
function clearLine(ax, az, bx, bz) {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(len / (NAV_CELL * 0.5));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const k = idx(ax + (bx - ax) * t, az + (bz - az) * t);
    if (k < 0 || blocked[k]) return false;
  }
  return true;
}

const gScore = new Float32Array(N * N);
const came = new Int32Array(N * N);
const seen = new Uint32Array(N * N);
let searchId = 0;

/** A* path from a to b as a list of [x, z] waypoints (smoothed), or null. */
export function findPath(ax, az, bx, bz, maxNodes = 7000) {
  const start = nearestOpen(idx(ax, az));
  const goal = nearestOpen(idx(bx, bz));
  if (start < 0 || goal < 0) return null;
  if (clearLine(ax, az, bx, bz)) return [[bx, bz]];
  searchId++;
  const gi = goal % N;
  const gj = Math.floor(goal / N);
  const h = (k) => {
    const dx = Math.abs((k % N) - gi);
    const dz = Math.abs(Math.floor(k / N) - gj);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
  };
  // binary heap of [f, k]
  const heap = [];
  const push = (f, k) => {
    heap.push([f, k]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  seen[start] = searchId;
  gScore[start] = 0;
  came[start] = -1;
  push(h(start), start);
  let expanded = 0;
  let found = false;
  while (heap.length && expanded < maxNodes) {
    const [, k] = pop();
    if (k === goal) {
      found = true;
      break;
    }
    expanded++;
    const i = k % N;
    const j = Math.floor(k / N);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = nj * N + ni;
        if (blocked[nk]) continue;
        if (di && dj && (blocked[j * N + ni] || blocked[nj * N + i])) continue; // no corner cutting
        const g = gScore[k] + (di && dj ? 1.414 : 1);
        if (seen[nk] === searchId && g >= gScore[nk]) continue;
        seen[nk] = searchId;
        gScore[nk] = g;
        came[nk] = k;
        push(g + h(nk), nk);
      }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let k = goal; k !== -1; k = came[k]) cells.push(k);
  cells.reverse();
  // string-pull
  const pts = cells.map(center);
  pts[pts.length - 1] = [bx, bz];
  const out = [];
  let from = [ax, az];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clearLine(from[0], from[1], pts[j][0], pts[j][1])) j--;
    out.push(pts[j]);
    from = pts[j];
    i = j;
  }
  if (!out.length) out.push([bx, bz]);
  return out;
}
