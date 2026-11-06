// The abandoned theme park. Pure data shared by the simulation, bots and the renderer.
// Props describe what to draw; each prop also yields collision shapes.
// Colliders: { k: 'box', x, z, hx, hz, y0, y1, rot } (rot = yaw, three.js convention)
//            { k: 'cyl', x, z, r, y0, y1 }
import { rng } from './rng.js';
import { MAP_HALF } from './constants.js';

export const PARK_EDGE = MAP_HALF - 4; // the iron fence

export const PROPS = [];
export const COLLIDERS = [];
export const LAMPS = [];
export const LOOT_SPOTS = [];
export const CHEST_SPOTS = [];
/** Set dressing drawn with real models (benches, vending machines, kiddie rides, junk). Each one collides. */
export const DECOR = [];
/** Walk-in buildings ({ cx, cz, w, d, h, style, doors }), so the client can dress their outsides. */
export const BUILDINGS = [];
/** Prize counters: spend tickets here (x, z = booth centre). */
export const PRIZE_BOOTHS = [];

export const FERRIS = { x: -62, z: -42, hubY: 22, r: 18, n: 20 };
export const CAROUSEL = { x: -62, z: 38, r: 7.5 };
export const ARENA = { x: 48, z: 62, w: 26, d: 18 };
export const STATION = { x: 48.5, z: 17 }; // where a ghost possesses the coaster
export const BIGTOP = { x: 0, z: 0, r: 15, h: 11 };
export const FREEFALL = { x: -95, z: 2 };

export const REGIONS = [
  { name: 'Front Gate', x: 0, z: 106 },
  { name: 'The Midway', x: 0, z: 62 },
  { name: 'Big Top', x: 0, z: -20 },
  { name: 'Ferris Wheel', x: -62, z: -60 },
  { name: 'Carousel', x: -62, z: 54 },
  { name: 'Bumper Cars', x: 48, z: 78 },
  { name: 'Coaster', x: 82, z: -6 },
  { name: 'Funhouse', x: -20, z: -96 },
  { name: 'Tunnel of Terror', x: 40, z: -100 },
  { name: 'Arcade', x: -80, z: 100 },
  { name: 'Backlot', x: -90, z: -78 },
  { name: 'Free Fall', x: -95, z: 18 },
];

/** Walkway centre lines (for the ground texture and for scattering props). */
export const PATHS = [
  { w: 10, pts: [[0, 116], [0, 15]] },
  { w: 6, pts: [[-20, -18], [-40, -24], [-58, -28]] },
  { w: 6, pts: [[-22, 14], [-38, 24], [-52, 32]] },
  { w: 6, pts: [[20, 18], [30, 34], [42, 52]] },
  { w: 5, pts: [[26, 8], [40, 14]] },
  { w: 6, pts: [[-8, -26], [-14, -50], [-20, -70]] },
  { w: 6, pts: [[10, -26], [26, -52], [40, -74]] },
  { w: 6, pts: [[-5, 92], [-40, 90], [-70, 86]] },
  { w: 5, pts: [[-66, -52], [-76, -68], [-86, -80]] },
  { w: 6, pts: [[-27, 0], [-60, 2], [-88, 2]] },
  { w: 5, pts: [[26, -8], [56, -30], [84, -48], [100, -72]] },
  { w: 5, pts: [[5, 80], [34, 88], [62, 92]] },
  { w: 5, pts: [[62, 72], [88, 60], [104, 40]] },
];
export const RING = { r: 27, w: 7 };

const rand = rng(1337);

function addBox(x, z, w, d, y0, y1, rot = 0) {
  COLLIDERS.push({ k: 'box', x, z, hx: w / 2, hz: d / 2, y0, y1, rot });
}
function addCyl(x, z, r, y0, y1) {
  COLLIDERS.push({ k: 'cyl', x, z, r, y0, y1 });
}

/** Rotate a local offset (lx, lz) by yaw into world space (three.js convention). */
export function rotXZ(lx, lz, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [lx * c + lz * s, -lx * s + lz * c];
}

function prop(p) {
  PROPS.push(p);
  return p;
}

// ------------------------------------------------------------------ prop builders

function wall(x, z, w, d, h, style, rot = 0) {
  prop({ type: 'wall', x, z, w, d, h, style, rot });
  addBox(x, z, w, d, 0, h, rot);
}

function roof(x, z, w, d, y, style) {
  prop({ type: 'roof', x, z, w, d, y, style });
  addBox(x, z, w, d, y, y + 0.35);
}

/**
 * Rectangular building with door gaps. doors: { n|s|e|w: [offsets along that side] }.
 * Walls are 0.4 thick, doors 3 wide.
 */
function building(cx, cz, w, d, h, style, doors = {}) {
  BUILDINGS.push({ cx, cz, w, d, h, style, doors });
  const t = 0.4;
  const door = 3;
  const side = (name, x0, z0, along, len, horiz) => {
    const gaps = (doors[name] || []).map((o) => [o - door / 2, o + door / 2]).sort((a, b) => a[0] - b[0]);
    let s = -len / 2;
    const segs = [];
    for (const g of gaps) {
      if (g[0] > s) segs.push([s, g[0]]);
      s = g[1];
    }
    if (s < len / 2) segs.push([s, len / 2]);
    for (const [a, b] of segs) {
      const mid = (a + b) / 2;
      const l = b - a;
      if (horiz) wall(x0 + mid, z0, l, t, h, style);
      else wall(x0, z0 + mid, t, l, h, style);
    }
    // lintel over each door so the roof line stays closed
    for (const g of gaps) {
      const mid = (g[0] + g[1]) / 2;
      if (horiz) {
        prop({ type: 'wall', x: x0 + mid, z: z0, w: door, d: t, h: h - 3.2, y0: 3.2, style, rot: 0 });
        addBox(x0 + mid, z0, door, t, 3.2, h);
      } else {
        prop({ type: 'wall', x: x0, z: z0 + mid, w: t, d: door, h: h - 3.2, y0: 3.2, style, rot: 0 });
        addBox(x0, z0 + mid, t, door, 3.2, h);
      }
    }
    void along;
  };
  side('n', cx, cz - d / 2, 'x', w, true);
  side('s', cx, cz + d / 2, 'x', w, true);
  side('w', cx - w / 2, cz, 'z', d, false);
  side('e', cx + w / 2, cz, 'z', d, false);
  roof(cx, cz, w + 0.6, d + 0.6, h, style);
}

/** Prize booth: open front with a counter you can vault, roof with a striped awning. */
function booth(x, z, rot, color, prize = false) {
  prop({ type: 'booth', x, z, rot, color, prize });
  const parts = [
    [0, -1.2, 4.4, 0.2, 0, 3.0], // back wall
    [-2.1, 0, 0.2, 2.6, 0, 3.0], // sides
    [2.1, 0, 0.2, 2.6, 0, 3.0],
    [0, 1.1, 4.0, 0.45, 0, 1.05], // counter
  ];
  for (const [lx, lz, w, d, y0, y1] of parts) {
    const [ox, oz] = rotXZ(lx, lz, rot);
    addBox(x + ox, z + oz, w, d, y0, y1, rot);
  }
  addBox(x, z, 4.8, 3.2, 3.0, 3.25, rot);
  if (prize) PRIZE_BOOTHS.push({ x, z, rot });
  else CHEST_SPOTS.push({ x, z, rot });
}

/** model, footprint (w along local x, d along local z, h) and a box collider to match. */
const DECOR_SIZE = {
  bench: [2.0, 0.7, 0.9],
  vending_coffee: [0.8, 0.8, 1.9],
  vending_news: [0.8, 0.9, 1.6],
  ice_freezer: [1.4, 1.0, 1.9],
  rocket_kiddie: [1.5, 2.4, 1.8],
  boxes: [2.6, 3.0, 1.3],
  crates_barrels: [2.2, 4.4, 1.1],
  trash_bags: [1.6, 1.6, 1.0],
  street_fences: [3.2, 4.7, 1.0],
  shed_worn: [6.4, 4.3, 3.6],
  clown_statue: [0.75, 0.86, 2.2],
  popcorn_cart: [2.8, 1.9, 1.7],
  welcome_sign: [3.1, 0.62, 3.8],
  victorian: [15, 13.8, 12.6],
  warehouse: [9.2, 27.3, 12],
};
/** Big buildings out in the woods past the fence: seen, not reached (no colliders; the woods keep clear of them). */
export const LANDMARKS_OUT = [];
function decor(model, x, z, rot) {
  const [w, d, h] = DECOR_SIZE[model];
  DECOR.push({ model, x, z, rot, w, d, h });
  addBox(x, z, w, d, 0, h, rot);
}

function crate(x, z, s, h, rot = 0) {
  prop({ type: 'crate', x, z, s, h, rot });
  addBox(x, z, s, s, 0, h, rot);
}

function tree(x, z, s) {
  prop({ type: 'tree', x, z, s, rot: rand() * Math.PI * 2 });
  addCyl(x, z, 0.35 * s, 0, 5 * s);
}

/** Where a lamp's light hangs, from the foot of its pole (an old concrete pole with one arm along +x). */
export const LAMP_HEAD = { x: 1.9, y: 6.0 };

function lamp(x, z) {
  prop({ type: 'lamp', x, z });
  addCyl(x, z, 0.16, 0, 6.2);
  LAMPS.push({ x, z, y: LAMP_HEAD.y });
}

// ------------------------------------------------------------------ layout

// iron fence around the park
{
  const e = PARK_EDGE;
  const seg = 12;
  for (let a = -e; a < e; a += seg) {
    const m = a + seg / 2;
    for (const [x, z, rot] of [[m, -e, 0], [m, e, 0], [-e, m, Math.PI / 2], [e, m, Math.PI / 2]]) {
      // the tour bus drives in through a gap in the south fence
      if (z === e && rot === 0 && Math.abs(x) < 6) continue;
      prop({ type: 'fence', x, z, len: seg, rot });
      addBox(x, z, seg, 0.3, 0, 3.4, rot);
    }
  }
  // brick gate posts either side of the gap
  for (const x of [-8.4, 4.4]) {
    prop({ type: 'wall', x, z: e, w: 0.9, d: 0.9, h: 4.2, style: 'tunnel', rot: 0 });
    addBox(x, e, 0.9, 0.9, 0, 4.2);
  }
}

// The tour bus route: a road through the woods, in at the gate, up the midway, round the big top, out west.
const BUS_CTRL = [
  [0, 340], [0, 250], [0, 170], [0, 118], [0, 90], [0, 50], [0, 31], [12, 24], [22, 14], [27, 0], [22, -14],
  [12, -24], [0, -27], [-12, -24], [-22, -14], [-27, 0], [-40, 1], [-60, 2], [-84, 2],
];
export const BUS_ROUTE = { pts: [], cum: [], len: 0, gateS: 0 };
{
  const n = BUS_CTRL.length;
  const at = (i) => BUS_CTRL[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < 12; k++) {
      const t = k / 12;
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      const c = (j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t * t * t);
      BUS_ROUTE.pts.push([c(0), c(1)]);
    }
  }
  BUS_ROUTE.pts.push(at(n - 1));
  let total = 0;
  BUS_ROUTE.pts.forEach((p, i) => {
    if (i) total += Math.hypot(p[0] - BUS_ROUTE.pts[i - 1][0], p[1] - BUS_ROUTE.pts[i - 1][1]);
    BUS_ROUTE.cum.push(total);
    if (!BUS_ROUTE.gateS && p[1] <= PARK_EDGE) BUS_ROUTE.gateS = total;
  });
  BUS_ROUTE.len = total;
}

/** Position and heading (unit dx, dz) at distance s along the bus route. */
export function busAt(s) {
  const { pts, cum, len } = BUS_ROUTE;
  s = Math.max(0, Math.min(len, s));
  let i = 1;
  while (i < pts.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / seg;
  const dx = (b[0] - a[0]) / seg;
  const dz = (b[1] - a[1]) / seg;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx, dz };
}

// front gate
prop({ type: 'arch', x: 0, z: 110 });
addBox(-7, 110, 2.2, 2.2, 0, 9);
addBox(7, 110, 2.2, 2.2, 0, 9);
addBox(0, 110, 16, 1.4, 7.6, 9.6);
for (const sx of [-1, 1]) {
  prop({ type: 'ticket', x: sx * 12, z: 102, rot: 0 });
  addBox(sx * 12, 102, 2.6, 2.4, 0, 2.8);
}

// the midway: prize booths facing the walkway
{
  const colors = ['#e2384f', '#2f9be0', '#f2b632', '#8e44d6', '#2fbf87', '#f0702c'];
  let i = 0;
  for (let z = 92; z >= 36; z -= 11) {
    booth(-11.5, z, facePath(-11.5, z), colors[i++ % colors.length], z === 70);
    booth(11.5, z + 5, facePath(11.5, z + 5), colors[i++ % colors.length]);
  }
  for (let z = 96; z >= 24; z -= 12) {
    lamp(-6, z);
    lamp(6, z + 6);
  }
  // carts stand beside the lamps so the tour bus can drive up the middle
  const carts = [[-8.4, 74, 'popcorn'], [8.4, 52, 'candy'], [-8.4, 36, 'hotdog']];
  for (const [x, z, kind] of carts) {
    prop({ type: 'cart', x, z, kind, rot: rand() * 0.6 - 0.3 });
    addBox(x, z, 1.4, 2.4, 0, 1.3);
  }
}

// big top with the old circus cannon on the roof
prop({ type: 'bigtop', ...BIGTOP });
addCyl(BIGTOP.x, BIGTOP.z, BIGTOP.r, 0, BIGTOP.h);
addCyl(BIGTOP.x, BIGTOP.z, BIGTOP.r * 0.62, BIGTOP.h, BIGTOP.h + 6);
for (let a = 0; a < 12; a++) {
  const ang = (a / 12) * Math.PI * 2 + 0.26;
  lamp(Math.cos(ang) * 33, Math.sin(ang) * 33);
}

// Ferris wheel: the wheel itself is drawn by the rides module; legs and platform collide
prop({ type: 'ferris', ...FERRIS });
for (const sx of [-1, 1]) for (const sz of [-1, 1]) addCyl(FERRIS.x + sx * 9, FERRIS.z + sz * 3, 0.7, 0, 7);
addBox(FERRIS.x, FERRIS.z, 9, 6, 0, 0.45);
prop({ type: 'control', x: FERRIS.x + 7, z: FERRIS.z + 9, rot: 0 });
addBox(FERRIS.x + 7, FERRIS.z + 9, 2.4, 2.2, 0, 2.7);
CHEST_SPOTS.push({ x: FERRIS.x, z: FERRIS.z, rot: 0 });

// carousel (platform can be stepped onto)
prop({ type: 'carousel', ...CAROUSEL });
addCyl(CAROUSEL.x, CAROUSEL.z, CAROUSEL.r - 0.4, 0, 0.5);
addCyl(CAROUSEL.x, CAROUSEL.z, 1.6, 0, 7);
addCyl(CAROUSEL.x, CAROUSEL.z, CAROUSEL.r + 0.2, 6.6, 7.6);
CHEST_SPOTS.push({ x: CAROUSEL.x + 4, z: CAROUSEL.z, rot: Math.PI / 2 });

// bumper car pavilion
{
  const { x, z, w, d } = ARENA;
  prop({ type: 'arena', ...ARENA });
  addBox(x, z, w, d, 0, 0.18);
  const rail = 0.75;
  // rails with a gap in the middle of each long side
  for (const sz of [-1, 1]) {
    addBox(x - w / 4 - 1.5, z + (sz * d) / 2, w / 2 - 3, 0.5, 0, rail);
    addBox(x + w / 4 + 1.5, z + (sz * d) / 2, w / 2 - 3, 0.5, 0, rail);
  }
  for (const sx of [-1, 1]) addBox(x + (sx * w) / 2, z, 0.5, d, 0, rail);
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) addCyl(x + (sx * w) / 2, z + (sz * d) / 2, 0.3, 0, 6);
  addBox(x, z, w + 1, d + 1, 6, 6.4);
  CHEST_SPOTS.push({ x: x - 8, z: z + 4, rot: 0 }, { x: x + 9, z: z - 5, rot: Math.PI });
}
export const CAR_SPAWNS = [];
for (let i = 0; i < 8; i++) {
  CAR_SPAWNS.push({
    x: ARENA.x - 9 + (i % 4) * 6,
    z: ARENA.z - 4 + Math.floor(i / 4) * 8,
    yaw: rand() * Math.PI * 2,
  });
}

// roller coaster track (closed Catmull-Rom loop). Low points skim the ground.
const TRACK_CTRL = [
  [44, 26, 1.25], [44, 10, 1.25], [46, -6, 4], [52, -22, 14], [62, -34, 22], [74, -41, 12],
  [84, -42, 0.95], [96, -36, 2.6], [104, -20, 12], [106, 0, 15], [102, 18, 8], [92, 30, 0.95],
  [80, 40, 5], [66, 45, 9], [54, 39, 4], [46, 33, 1.6],
];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return p1.map((_, i) =>
    0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3),
  );
}

export const TRACK = { pts: [], cum: [], len: 0 };
{
  const n = TRACK_CTRL.length;
  for (let i = 0; i < n; i++) {
    const p0 = TRACK_CTRL[(i - 1 + n) % n];
    const p1 = TRACK_CTRL[i];
    const p2 = TRACK_CTRL[(i + 1) % n];
    const p3 = TRACK_CTRL[(i + 2) % n];
    for (let s = 0; s < 24; s++) {
      const [x, z, y] = catmull(p0, p1, p2, p3, s / 24);
      TRACK.pts.push([x, y, z]);
    }
  }
  let total = 0;
  for (let i = 0; i < TRACK.pts.length; i++) {
    TRACK.cum.push(total);
    const a = TRACK.pts[i];
    const b = TRACK.pts[(i + 1) % TRACK.pts.length];
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  TRACK.len = total;
}

/** Position and unit tangent at arc length s along the track. */
export function trackAt(s) {
  const L = TRACK.len;
  s = ((s % L) + L) % L;
  const { pts, cum } = TRACK;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const a = pts[lo];
  const b = pts[(lo + 1) % pts.length];
  const segLen = (lo + 1 < pts.length ? cum[lo + 1] : L) - cum[lo];
  const t = segLen > 0 ? (s - cum[lo]) / segLen : 0;
  const tx = b[0] - a[0];
  const ty = b[1] - a[1];
  const tz = b[2] - a[2];
  const tl = Math.hypot(tx, ty, tz) || 1;
  return { x: a[0] + tx * t, y: a[1] + ty * t, z: a[2] + tz * t, tx: tx / tl, ty: ty / tl, tz: tz / tl };
}

export const TRACK_SUPPORTS = [];
for (let s = 0; s < TRACK.len; s += 7) {
  const p = trackAt(s);
  if (p.y < 2.4) continue;
  TRACK_SUPPORTS.push({ x: p.x, z: p.z, h: p.y - 0.3 });
  addCyl(p.x, p.z, 0.3, 0, p.y - 0.3);
}
prop({ type: 'track' });

// coaster station platform beside the track
prop({ type: 'station', x: 48.5, z: 17, w: 5, d: 22 });
addBox(48.5, 17, 5, 22, 0, 1.0);
addBox(51.7, 17, 1.4, 6, 0, 0.5);
addBox(48.5, 17, 6, 23, 4.6, 4.9);
for (const dz of [-10, 0, 10]) addCyl(50.6, 17 + dz, 0.2, 1, 4.6);
addBox(49.5, 26.5, 2, 2, 1.0, 3.4); // operator's booth
CHEST_SPOTS.push({ x: 53.5, z: 24, rot: Math.PI / 2 });

// Funhouse (maze-like interior)
building(-20, -82, 24, 16, 7.5, 'funhouse', { s: [0], n: [-6], e: [3] });
wall(-26, -82, 0.4, 9, 7.5, 'funhouse');
wall(-15, -84, 8, 0.4, 7.5, 'funhouse');
wall(-14, -77.5, 0.4, 5, 7.5, 'funhouse');
prop({ type: 'facade', x: -20, z: -73.7, style: 'funhouse', label: 'FUNHOUSE' });
CHEST_SPOTS.push({ x: -29, z: -86, rot: 0 }, { x: -11, z: -87, rot: 0 }, { x: -20, z: -79, rot: 0 }, { x: -29, z: -77, rot: 0 });

// Tunnel of Terror (dark-ride building)
building(40, -84, 26, 14, 8, 'tunnel', { s: [-8, 8], n: [0] });
wall(36, -84, 0.4, 8, 8, 'tunnel');
wall(44, -84, 0.4, 8, 8, 'tunnel');
prop({ type: 'facade', x: 40, z: -76.7, style: 'tunnel', label: 'TUNNEL OF TERROR' });
CHEST_SPOTS.push({ x: 30, z: -88, rot: 0 }, { x: 50, z: -88, rot: 0 }, { x: 40, z: -86, rot: 0 }, { x: 40, z: -80, rot: Math.PI });

// Arcade hall
building(-80, 84, 20, 14, 6.5, 'arcade', { s: [-4], e: [2], n: [5] });
for (let i = 0; i < 4; i++) crate(-87 + i * 4.6, 80, 1.1, 2.2);
prop({ type: 'facade', x: -80, z: 91.2, style: 'arcade', label: 'ARCADE' });
CHEST_SPOTS.push({ x: -86, z: 87, rot: Math.PI }, { x: -74, z: 87, rot: Math.PI }, { x: -78, z: 79, rot: 0 });

// Free Fall drop tower
prop({ type: 'freefall', ...FREEFALL });
addCyl(FREEFALL.x, FREEFALL.z, 2.2, 0, 48);
addCyl(FREEFALL.x, FREEFALL.z, 5, 0, 0.4);
CHEST_SPOTS.push({ x: FREEFALL.x + 4, z: FREEFALL.z + 4, rot: 0 });

// Backlot: trailers, a water tower and stacked crates
{
  const trailers = [[-96, -66, 0], [-80, -94, Math.PI / 2], [-104, -88, Math.PI / 2], [-70, -104, 0]];
  for (const [x, z, rot] of trailers) {
    prop({ type: 'trailer', x, z, rot });
    addBox(x, z, 8, 2.8, 0, 3, rot);
  }
  prop({ type: 'watertower', x: -96, z: -102 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addCyl(-96 + sx * 2.6, -102 + sz * 2.6, 0.3, 0, 12);
  addCyl(-96, -102, 4, 12, 17);
  const stacks = [[-88, -74, 2], [-86, -77, 1], [-76, -84, 3], [-100, -76, 2], [-92, -90, 1], [-74, -76, 1]];
  for (const [x, z, n] of stacks) crate(x, z, 2.2, 1.4 * n, rand() * 0.4);
  CHEST_SPOTS.push({ x: -96, z: -70, rot: 0 }, { x: -84, z: -90, rot: 0 }, { x: -100, z: -96, rot: 0 }, { x: -72, z: -98, rot: 0 });
}

// prize counters out in the park, facing the nearest walkway
for (const [x, z] of [[72, -30], [-4, -70], [-64, 96]]) booth(x, z, facePath(x, z), '#f2b632', true);

// little striped game tents
for (const [x, z] of [[-34, 70], [30, 76], [-36, -44], [20, -46], [-38, 14], [76, -70], [86, 92], [-104, 40]]) {
  prop({ type: 'gametent', x, z, r: 4 });
  addCyl(x, z, 4, 0, 3.6);
  CHEST_SPOTS.push({ x: x + 5.4, z, rot: -Math.PI / 2 });
}

// picnic / food court with benches near the big top
for (const [x, z] of [[-30, 26], [-24, 34], [-36, 32], [24, -28], [30, -22]]) {
  prop({ type: 'table', x, z, rot: rand() * Math.PI });
  addBox(x, z, 2.2, 1.0, 0, 0.8);
}

// ------------------------------------------------------------------ scatter

/** Rotation that turns a booth's open front (local +z) toward the nearest walkway. */
function facePath(x, z) {
  let best = Infinity;
  let tx = 0;
  let tz = 0;
  const consider = (px, pz) => {
    const d = Math.hypot(px - x, pz - z);
    if (d < best) {
      best = d;
      tx = px;
      tz = pz;
    }
  };
  const rd = Math.hypot(x, z) || 1;
  consider((x / rd) * RING.r, (z / rd) * RING.r);
  for (const p of PATHS) {
    for (let i = 0; i < p.pts.length - 1; i++) {
      const [ax, az] = p.pts[i];
      const [bx, bz] = p.pts[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      consider(ax + dx * t, az + dz * t);
    }
  }
  return Math.atan2(tx - x, tz - z);
}

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/** Distance from (x, z) to the nearest walkway edge (negative = on a path). */
export function pathDistance(x, z) {
  let best = Math.abs(Math.hypot(x, z) - RING.r) - RING.w / 2;
  for (const p of PATHS) {
    for (let i = 0; i < p.pts.length - 1; i++) {
      const d = distToSeg(x, z, p.pts[i][0], p.pts[i][1], p.pts[i + 1][0], p.pts[i + 1][1]) - p.w / 2;
      if (d < best) best = d;
    }
  }
  return best;
}

/** Shortest horizontal gap between a circle and the collider footprints (negative = overlap). */
export function clearance(x, z, r, yMax = 99) {
  let best = Infinity;
  for (const c of COLLIDERS) {
    if (c.y0 > yMax || c.y1 <= 0.6) continue; // overhead or walkable
    let d;
    if (c.k === 'cyl') d = Math.hypot(x - c.x, z - c.z) - c.r;
    else {
      const [lx, lz] = rotXZ(x - c.x, z - c.z, -c.rot);
      const qx = Math.abs(lx) - c.hx;
      const qz = Math.abs(lz) - c.hz;
      d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
    }
    d -= r;
    if (d < best) best = d;
  }
  return best;
}

function nearTrack(x, z, gap) {
  for (let i = 0; i < TRACK.pts.length; i += 2) {
    const p = TRACK.pts[i];
    if (Math.hypot(p[0] - x, p[2] - z) < gap) return true;
  }
  return false;
}

const landmarkKeepout = [
  [0, 0, 32], [FERRIS.x, FERRIS.z, 14], [CAROUSEL.x, CAROUSEL.z, 13], [ARENA.x, ARENA.z, 18],
  [FREEFALL.x, FREEFALL.z, 8], [0, 110, 10],
];
function inKeepout(x, z) {
  for (const [kx, kz, r] of landmarkKeepout) if (Math.hypot(x - kx, z - kz) < r) return true;
  return false;
}

// dead trees: thick along the fence, sparse inside
for (let i = 0, placed = 0; i < 3000 && placed < 130; i++) {
  const edge = rand() < 0.55;
  let x;
  let z;
  if (edge) {
    const a = (rand() * 2 - 1) * (PARK_EDGE - 3);
    const b = PARK_EDGE - 2 - rand() * 9;
    const side = Math.floor(rand() * 4);
    [x, z] = side === 0 ? [a, -b] : side === 1 ? [a, b] : side === 2 ? [-b, a] : [b, a];
  } else {
    x = (rand() * 2 - 1) * (PARK_EDGE - 4);
    z = (rand() * 2 - 1) * (PARK_EDGE - 4);
  }
  if (inKeepout(x, z) || pathDistance(x, z) < 2 || nearTrack(x, z, 4) || clearance(x, z, 3) < 0) continue;
  // the tour bus drives through the park: keep its route clear of branches
  if (BUS_ROUTE.pts.some(([bx, bz]) => Math.hypot(x - bx, z - bz) < 8)) continue;
  tree(x, z, 0.8 + rand() * 0.6);
  placed++;
}

// cover crates near structures and paths
for (let i = 0, placed = 0; i < 3000 && placed < 70; i++) {
  const x = (rand() * 2 - 1) * (PARK_EDGE - 6);
  const z = (rand() * 2 - 1) * (PARK_EDGE - 6);
  const pd = pathDistance(x, z);
  if (pd < 1 || pd > 14 || inKeepout(x, z) || nearTrack(x, z, 3) || clearance(x, z, 2.5) < 0) continue;
  const tall = rand() < 0.35;
  crate(x, z, 1.6 + rand() * 0.6, tall ? 2.6 : 1.3, rand() * Math.PI);
  if (rand() < 0.4) crate(x + 2.1, z + (rand() - 0.5), 1.4, 1.2, rand());
  placed++;
}

// lamps and trash cans along the side paths
for (const p of PATHS.slice(1)) {
  for (let i = 0; i < p.pts.length - 1; i++) {
    const [ax, az] = p.pts[i];
    const [bx, bz] = p.pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    for (let s = 6; s < len - 3; s += 16) {
      const t = s / len;
      const off = p.w / 2 + 0.8;
      const x = ax + (bx - ax) * t + nx * off;
      const z = az + (bz - az) * t + nz * off;
      if (clearance(x, z, 1.2) < 0 || nearTrack(x, z, 2)) continue;
      const r = rand();
      // benches and machines turn their fronts to the walkway
      const face = Math.atan2(-nx, -nz);
      if (r < 0.5) lamp(x, z);
      else if (r < 0.66) {
        prop({ type: 'trash', x, z });
        addCyl(x, z, 0.4, 0, 1.0);
      } else if (r < 0.88) decor('bench', x + nx * 0.2, z + nz * 0.2, face);
      else decor(rand() < 0.5 ? 'vending_coffee' : 'vending_news', x + nx * 0.3, z + nz * 0.3, face);
    }
  }
}

// abandoned junk near the walkways: boxes, crates and barrels, trash, barriers, an ice chest
{
  const JUNK = ['boxes', 'crates_barrels', 'trash_bags', 'trash_bags', 'street_fences', 'ice_freezer'];
  for (let i = 0, placed = 0; i < 4000 && placed < 46; i++) {
    const x = (rand() * 2 - 1) * (PARK_EDGE - 6);
    const z = (rand() * 2 - 1) * (PARK_EDGE - 6);
    const pd = pathDistance(x, z);
    const model = JUNK[Math.floor(rand() * JUNK.length)];
    const [w, d] = DECOR_SIZE[model];
    const r = Math.hypot(w, d) / 2 + 0.6;
    if (pd < r * 0.6 || pd > 12 || inKeepout(x, z) || nearTrack(x, z, r + 1) || clearance(x, z, r) < 0.3) continue;
    if (CHEST_SPOTS.some((c) => Math.hypot(c.x - x, c.z - z) < r + 2)) continue;
    decor(model, x, z, rand() * Math.PI * 2);
    placed++;
  }
  // kiddie rides outside the arcade, a worn staff shed out in the backlot
  for (let i = 0, n = 0; i < 400 && n < 3; i++) {
    const x = -80 + (rand() * 2 - 1) * 16;
    const z = 82 + (rand() * 2 - 1) * 10;
    if (clearance(x, z, 1.8) < 0.3 || pathDistance(x, z) < 0.5 || CHEST_SPOTS.some((c) => Math.hypot(c.x - x, c.z - z) < 3)) continue;
    decor('rocket_kiddie', x, z, rand() * Math.PI * 2);
    n++;
  }
  for (const [x, z, rot] of [[-104, -60, 0.4], [-70, -108, Math.PI / 2]]) {
    if (clearance(x, z, 4) > 0.3) decor('shed_worn', x, z, rot);
  }
  // the carnival's welcome, just inside the gate
  decor('welcome_sign', 7.5, 98, 0);
  // weathered clown statues watching the paths, popcorn carts left where they stood
  for (const [x, z] of [[-6, 106], [-6, 62], [-62, -60], [48, 78], [-20, -96], [-90, -78]]) {
    if (clearance(x, z, 0.8) > 0.3) decor('clown_statue', x, z, facePath(x, z));
  }
  for (const [x, z] of [[8, 68], [8, -16], [-56, -52], [52, 84], [48, -94], [-74, 106], [-84, -70]]) {
    if (clearance(x, z, 1.8) > 0.3) decor('popcorn_cart', x, z, facePath(x, z));
  }
  // past the fence: the old manager's house and a brick workshop, dark among the trees
  for (const [model, x, z, rot] of [['victorian', -132, -88, Math.PI / 2], ['warehouse', 136, -66, 0]]) {
    const [w, d, h] = DECOR_SIZE[model];
    DECOR.push({ model, x, z, rot, w, d, h });
    LANDMARKS_OUT.push({ x, z, r: Math.hypot(w, d) / 2 + 3 });
  }
  storyProps();
}

/**
 * What the town left behind after the twenty went missing in 1987 (modelled in scripts/blender/story-props.py):
 * the memorial just inside the gate, MISSING notice boards along the walkways, the county's CLOSED barricades and
 * prize teddy bears dropped where people stood. A random stream of its own, so the rest of the park stays put.
 */
function storyProps() {
  const sr = rng(1031);
  // visual footprint (w across, d deep, as modelled), and the solid part: [local x, local z, w, d, height]
  const SIZE = {
    memorial: [2.52, 1.65, [0, -0.4, 1.9, 0.6, 1.4]],
    missing_board: [2.45, 1.22, [0, -0.3, 2.15, 0.3, 2.4]],
    barricade: [2.0, 0.63, [0, 0, 2.0, 0.4, 1.1]],
  };
  const place = (model, x, z, rot) => {
    const [w, d, [lx, lz, cw, cd, h]] = SIZE[model];
    DECOR.push({ model, x, z, rot, w, d, h });
    const [ox, oz] = rotXZ(lx, lz, rot);
    addBox(x + ox, z + oz, cw, cd, 0, h, rot);
  };
  const free = (x, z, r) => clearance(x, z, r) > 0.3 && !inKeepout(x, z) && !nearTrack(x, z, r + 1)
    && !CHEST_SPOTS.some((c) => Math.hypot(c.x - x, c.z - z) < r + 2);
  // the memorial, on the left as the bus comes through the gate
  for (const [x, z] of [[-7, 101.5], [-9.5, 96], [-10, 90]]) {
    if (free(x, z, 1.6)) {
      place('memorial', x, z, facePath(x, z));
      break;
    }
  }
  // notice boards beside the walkways, turned to the people walking past
  const boards = [];
  for (let i = 0; i < 3000 && boards.length < 7; i++) {
    const x = (sr() * 2 - 1) * (PARK_EDGE - 8);
    const z = (sr() * 2 - 1) * (PARK_EDGE - 8);
    const pd = pathDistance(x, z);
    if (pd < 1.2 || pd > 3 || !free(x, z, 1.5) || boards.some((b) => Math.hypot(b[0] - x, b[1] - z) < 28)) continue;
    boards.push([x, z]);
    place('missing_board', x, z, facePath(x, z));
  }
  // CLOSED barricades: left across the side of a walkway, some knocked askew
  const bars = [];
  for (let i = 0; i < 3000 && bars.length < 9; i++) {
    const x = (sr() * 2 - 1) * (PARK_EDGE - 8);
    const z = (sr() * 2 - 1) * (PARK_EDGE - 8);
    const pd = pathDistance(x, z);
    if (pd < 0.3 || pd > 2.5 || !free(x, z, 1.2) || bars.some((b) => Math.hypot(b[0] - x, b[1] - z) < 18)) continue;
    bars.push([x, z]);
    place('barricade', x, z, facePath(x, z) + (sr() - 0.5) * 0.9);
  }
  // teddy bears from the prize counters, dropped on the paths and by the booths (small: no collider)
  const kinds = ['plush#bear_brown', 'plush#bear_pink', 'plush#bear_blue'];
  const bear = (x, z) => DECOR.push({ model: kinds[Math.floor(sr() * 3)], x, z, rot: sr() * Math.PI * 2, w: 0.35, d: 0.33, h: 0.46 });
  for (const b of PRIZE_BOOTHS) {
    for (let k = 0; k < 12; k++) {
      const a = sr() * Math.PI * 2;
      const x = b.x + Math.cos(a) * (3.2 + sr() * 1.5);
      const z = b.z + Math.sin(a) * (3.2 + sr() * 1.5);
      if (clearance(x, z, 0.3) > 0.1) {
        bear(x, z);
        break;
      }
    }
  }
  for (let i = 0, n = 0; i < 3000 && n < 14; i++) {
    const x = (sr() * 2 - 1) * (PARK_EDGE - 6);
    const z = (sr() * 2 - 1) * (PARK_EDGE - 6);
    if (pathDistance(x, z) > 1.5 || clearance(x, z, 0.3) < 0.1 || nearTrack(x, z, 1)) continue;
    bear(x, z);
    n++;
  }
}

// floor loot: on and beside walkways, inside buildings, near landmarks
for (let i = 0; i < 6000 && LOOT_SPOTS.length < 130; i++) {
  const x = (rand() * 2 - 1) * (PARK_EDGE - 5);
  const z = (rand() * 2 - 1) * (PARK_EDGE - 5);
  const pd = pathDistance(x, z);
  if (pd > 10 && rand() < 0.7) continue;
  if (clearance(x, z, 0.8, 2) < 0) continue;
  if (Math.hypot(x, z) < BIGTOP.r + 1) continue;
  let close = false;
  for (const s of LOOT_SPOTS) if (Math.hypot(s.x - x, s.z - z) < 7) close = true;
  if (close) continue;
  LOOT_SPOTS.push({ x, z });
}

// chests: drop any that ended up blocked
for (let i = CHEST_SPOTS.length - 1; i >= 0; i--) {
  const c = CHEST_SPOTS[i];
  if (clearance(c.x, c.z, 0.3, 2) < 0) CHEST_SPOTS.splice(i, 1);
}
