// How heavy is one match on a server? node scripts/perf.mjs
import { Game } from '../shared/game.js';

const g = new Game({ seed: 7 });
g.fillBots(20);
const t0 = performance.now();
let n = 0;
let worst = 0;
while (g.phase !== 'end' && n < 60 * 400) {
  const a = performance.now();
  g.update(1 / 60);
  g.drainEvents();
  worst = Math.max(worst, performance.now() - a);
  n++;
}
const ms = performance.now() - t0;
console.log('sim seconds', (n / 60).toFixed(0), 'wall ms', ms.toFixed(0), 'per tick ms', (ms / n).toFixed(3), 'worst', worst.toFixed(1));
const s0 = performance.now();
let bytes = 0;
for (let i = 0; i < 100; i++) bytes = JSON.stringify(g.snapshot(1, g.lootVer)).length;
console.log('snapshot ms', ((performance.now() - s0) / 100).toFixed(3), 'bytes', bytes);
// trimmed: round floats, drop false/null/zero fields
const zlib = await import('node:zlib');
const trim = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 1000) / 1000;
  if (Array.isArray(v)) return v.map(trim);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k in v) {
      const x = v[k];
      if (x === false || x === null || x === undefined || x === 0) continue;
      o[k] = trim(x);
    }
    return o;
  }
  return v;
};
const s = g.snapshot(1, g.lootVer);
const t = JSON.stringify(trim(s));
const parts = Object.fromEntries(Object.entries(trim(s)).map(([k, v]) => [k, JSON.stringify(v).length]).filter(([, n]) => n > 200));
console.log('trimmed', t.length, 'deflated', zlib.deflateRawSync(t, { level: 1 }).length, parts);
