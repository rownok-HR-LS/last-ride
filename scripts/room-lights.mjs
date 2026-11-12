// Add the lamps inside the walk-in buildings (shared/map.js INTERIOR_LIGHTS) to the lamp-light bake's glows file
// (src/tools/export-glows.js writes the neon signs and marquee bulbs; this replaces any room lights already in it).
// Usage: node scripts/room-lights.mjs glows.json [out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { INTERIOR_LIGHTS } from '../shared/map.js';

const [src, out = src] = process.argv.slice(2);
const glows = JSON.parse(readFileSync(src, 'utf8')).filter((g) => g.kind !== 'room');
for (const l of INTERIOR_LIGHTS) glows.push({ kind: 'room', x: l.x, y: l.y, z: l.z, color: l.color, power: l.power });
writeFileSync(out, JSON.stringify(glows));
console.log(`${out}: ${glows.length} glows, ${INTERIOR_LIGHTS.length} room lights`);
