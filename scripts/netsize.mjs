// How big is one game update on the wire? node scripts/netsize.mjs [seconds into the ride]
// Builds the exact message the server sends a rider 20 times a second (server/room.js broadcast) mid-ride and
// reports its size raw, alone through deflate, and through a running deflate stream (what the WebSocket's
// permessage-deflate with context takeover actually sends, since each message reuses the last ones as dictionary).
import zlib from 'node:zlib';
import { Game } from '../shared/game.js';
import { SNAP_EVERY } from '../shared/net.js';
import { Park, Room } from '../server/room.js';

const at = +process.argv[2] || 90;
const g = new Game({ seed: 7 });
g.fillBots(20);
while (g.time < at && g.phase !== 'end') {
  g.update(1 / 60);
  g.drainEvents();
}
// a rider on the server side: capture what Room.broadcast() sends them
const sent = [];
const id = [...g.players.keys()][0];
const conn = { ws: { readyState: 1, send: (m) => sent.push(m) }, pid: id, joined: true };
const rr = new Room({ park: new Park(), id: 'TEST' });
rr.game = g;
rr.conns = new Set([conn]);
rr.broadcast(); // the first one carries all the loot
sent.length = 0;
for (let i = 0; i < 40; i++) {
  for (let k = 0; k < SNAP_EVERY; k++) {
    g.update(1 / 60);
    rr.events.push(...g.drainEvents());
  }
  rr.broadcast();
}
const def = zlib.createDeflateRaw({ level: 1 });
const chunks = [];
def.on('data', (d) => chunks.push(d));
let streamed = 0;
for (const m of sent) {
  const before = chunks.reduce((s, c) => s + c.length, 0);
  def.write(m);
  await new Promise((res) => def.flush(zlib.constants.Z_SYNC_FLUSH, res));
  streamed += chunks.reduce((s, c) => s + c.length, 0) - before;
}
const raw = sent.reduce((s, m) => s + m.length, 0) / sent.length;
const alone = sent.reduce((s, m) => s + zlib.deflateRawSync(m, { level: 1 }).length, 0) / sent.length;
console.log(`t=${g.time.toFixed(0)}s phase ${g.phase}, ${sent.length} updates: raw ${raw.toFixed(0)} B, deflated alone ${alone.toFixed(0)} B, in a deflate stream ${(streamed / sent.length).toFixed(0)} B`);
console.log(`per second at 20 a second: ${((streamed / sent.length) * 20 / 1024).toFixed(1)} KB/s`);
const last = JSON.parse(sent.at(-1));
const parts = { ...Object.fromEntries(Object.entries(last.snap).map(([k, v]) => ['snap.' + k, JSON.stringify(v)?.length || 0])), self: JSON.stringify(last.self).length, loot: JSON.stringify(last.loot)?.length || 0, ev: JSON.stringify(last.ev).length };
console.log(Object.entries(parts).filter(([, n]) => n > 60).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));
