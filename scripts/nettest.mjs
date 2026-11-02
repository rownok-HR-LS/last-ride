// Two riders against a local server, no browser: node scripts/nettest.mjs (server must run with BUS_WAIT=2)
import { Connection, NetGame } from '../src/net.js';

const STEP = 1 / 60;
async function rider(name, plan) {
  const conn = new Connection('ws://localhost:8090');
  await conn.opened;
  const r = { conn, name, game: null, log: [] };
  conn.handlers.lobby = (m) => r.log.push(`lobby busIn=${m.busIn?.toFixed?.(1)} waiting=${m.waiting}`);
  conn.handlers.start = (m) => {
    r.game = new NetGame(conn, m.id, { name });
    r.log.push('start ' + m.id);
  };
  conn.send({ t: 'join', name, outfit: 'eric' });
  r.plan = plan;
  return r;
}
const a = await rider('Ana', (g, t) => ({ fwd: 1, side: 0, yaw: 0.5, pitch: 0, jump: false }));
const b = await rider('Ben', (g, t) => ({ fwd: 0, side: 1, yaw: -1, pitch: 0, sprint: true }));
let t = 0;
let errs = [];
const t0 = Date.now();
await new Promise((done) => {
  const iv = setInterval(() => {
    t += STEP;
    for (const r of [a, b]) {
      const g = r.game;
      if (!g?.ready) continue;
      g.setInput(g.myId, r.plan(g, t));
      // get off the bus as soon as the doors open
      if (g.view.me?.state === 'bus' && g.view.bus.open) g.command(g.myId, { c: 'jump' });
      if (Math.random() < 0.01) g.command(g.myId, { c: 'dodge', fwd: 1, side: 0 });
      g.update(STEP);
      g.snapshot(g.myId, -1);
      g.drainEvents();
      // the prediction against the server's latest word for us, allowing for the inputs still in flight
      if (g.predicting && g.latest) {
        const s = g.latest.players.find((p) => p.id === g.myId);
        const m = g.me;
        if (s) errs.push(Math.hypot(s.x - m.x, s.z - m.z) / Math.max(1, g.pending.length));
      }
    }
    if (Date.now() - t0 > 40000) {
      clearInterval(iv);
      done();
    }
  }, 1000 / 60);
});
for (const r of [a, b]) {
  const g = r.game;
  console.log(r.name, r.log.slice(0, 3).join(' | '), '...', r.log.at(-1));
  if (!g) continue;
  const me = g.view.me;
  const p = g.view.players.find((q) => q.id === g.myId);
  console.log(' phase', g.view.phase, 'state', me?.state, 'pos', p?.x.toFixed(1), p?.z.toFixed(1), 'players', g.view.players.length, 'loot', g.loot.size,
    'pending', g.pending.length, 'rtt', (r.conn.rtt * 1000).toFixed(0), 'ms');
}
errs.sort((x, y) => x - y);
for (const r of [a, b]) { const c = [...(r.game?.corrections || [])].sort((x, y) => x - y); console.log(r.name, 'corrections (m): median', c[c.length >> 1]?.toFixed(4), 'p95', c[Math.floor(c.length * 0.95)]?.toFixed(4), 'max', c.at(-1)?.toFixed(3), 'n', c.length); }
console.log('prediction drift per pending input (m): median', errs[errs.length >> 1]?.toFixed(3), 'p95', errs[Math.floor(errs.length * 0.95)]?.toFixed(3), 'n', errs.length);
process.exit(0);
