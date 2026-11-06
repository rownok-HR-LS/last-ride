// What the Blender building kit (scripts/blender/build-kit.py) builds to: each walk-in building's size, doors and
// walls (from shared/map.js, so the new models sit exactly on the walls players bump into), plus the trailers.
// Usage: node scripts/export-kit-layout.mjs out/layout.json
import { writeFileSync } from 'node:fs';
import { BUILDINGS, PROPS } from '../shared/map.js';

const inside = (p, b) => Math.abs(p.x - b.cx) <= b.w / 2 + 0.5 && Math.abs(p.z - b.cz) <= b.d / 2 + 0.5;
const layout = {
  buildings: BUILDINGS.map((b) => ({
    ...b,
    walls: PROPS.filter((p) => p.type === 'wall' && p.style === b.style && inside(p, b))
      .map((p) => ({ x: p.x - b.cx, z: p.z - b.cz, w: p.w, d: p.d, h: p.h, y0: p.y0 || 0, rot: p.rot || 0 })),
  })),
  trailers: PROPS.filter((p) => p.type === 'trailer').map((p) => ({ x: p.x, z: p.z, rot: p.rot })),
};
writeFileSync(process.argv[2], JSON.stringify(layout, null, 1));
console.log(layout.buildings.map((b) => `${b.style}: ${b.walls.length} walls`).join(', '), `| ${layout.trailers.length} trailers`);
