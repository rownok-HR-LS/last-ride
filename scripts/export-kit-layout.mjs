// What the Blender kits (scripts/blender/build-kit.py, build-rides.py) build to: each walk-in building's size, doors
// and walls, the trailers, and the rides' fixed parts (the coaster's route and supports, the Free Fall tower, the
// station, the control booth and the bumper-car pavilion), all from shared/map.js, so the new models sit exactly on
// the walls and colliders players bump into.
// Usage: node scripts/export-kit-layout.mjs out/layout.json
import { writeFileSync } from 'node:fs';
import { BUILDINGS, PROPS, TRACK, trackAt, FREEFALL } from '../shared/map.js';

const inside = (p, b) => Math.abs(p.x - b.cx) <= b.w / 2 + 0.5 && Math.abs(p.z - b.cz) <= b.d / 2 + 0.5;
// the supports exactly as map.js places them (every 7 m where the track is above head height), with the track's
// direction there so the saddle on top lines up with it
const supports = [];
for (let s = 0; s < TRACK.len; s += 7) {
  const p = trackAt(s);
  if (p.y < 2.4) continue;
  supports.push({ x: p.x, y: p.y, z: p.z, tx: p.tx, ty: p.ty, tz: p.tz, h: p.y - 0.3 });
}
const one = (type) => PROPS.find((p) => p.type === type);
const layout = {
  buildings: BUILDINGS.map((b) => ({
    ...b,
    walls: PROPS.filter((p) => p.type === 'wall' && p.style === b.style && inside(p, b))
      .map((p) => ({ x: p.x - b.cx, z: p.z - b.cz, w: p.w, d: p.d, h: p.h, y0: p.y0 || 0, rot: p.rot || 0 })),
  })),
  trailers: PROPS.filter((p) => p.type === 'trailer').map((p) => ({ x: p.x, z: p.z, rot: p.rot })),
  track: { pts: TRACK.pts, len: TRACK.len, supports },
  freefall: FREEFALL,
  station: one('station'),
  control: one('control'),
  arena: one('arena'),
};
writeFileSync(process.argv[2], JSON.stringify(layout));
console.log(layout.buildings.map((b) => `${b.style}: ${b.walls.length} walls`).join(', '), `| ${layout.trailers.length} trailers`,
  `| track ${TRACK.len.toFixed(0)} m, ${TRACK.pts.length} points, ${supports.length} supports, max height ${Math.max(...TRACK.pts.map((p) => p[1])).toFixed(1)}`);
