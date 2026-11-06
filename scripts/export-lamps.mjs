// Where the street lamps' light comes from, for the Blender lamp-light bake: each lamp's head and whether it is
// dead, flickering or working (the same draw as buildLamps in src/world.js).
// Usage: node scripts/export-lamps.mjs out/lamps.json
import { writeFileSync } from 'node:fs';
import { LAMPS, LAMP_HEAD } from '../shared/map.js';
import { rng } from '../shared/rng.js';

const rr = rng(909);
const lamps = LAMPS.map((l) => {
  const v = rr();
  return { x: +(l.x + LAMP_HEAD.x).toFixed(2), y: +(LAMP_HEAD.y - 0.15).toFixed(2), z: +l.z.toFixed(2), kind: v < 0.08 ? 'dead' : v < 0.22 ? 'flicker' : 'ok' };
});
writeFileSync(process.argv[2], JSON.stringify(lamps));
console.log(lamps.length, 'lamps,', lamps.filter((l) => l.kind === 'dead').length, 'dead');
