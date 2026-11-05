// What one rider downloads during a ride, after the server's compression: node scripts/wire-size.mjs [seconds]
// Runs a room with one rider (the rest bots), captures every message sent to them, and pushes it through a raw
// deflate stream the way permessage-deflate does with context takeover (level 1, a sync flush per message).
import { EventEmitter } from 'node:events';
import zlib from 'node:zlib';
import { Room } from '../server/room.js';

const seconds = +(process.argv[2] || 120);
const ws = new EventEmitter();
ws.readyState = 1;
const sent = [];
ws.send = (s) => sent.push(s);
ws.say = (m) => ws.emit('message', JSON.stringify(m));
const room = new Room({ busWait: 0.1, busAgain: 0.1 });
room.connect(ws);
ws.say({ t: 'join', name: 'Ana', outfit: 'eric' });
// a steady trickle of input so the rider is not left starved
let seq = 0;
for (let i = 0; i < seconds * 60; i++) {
  if (room.game && i % 3 === 0) {
    const s = [];
    for (let k = 0; k < 3; k++) s.push([++seq, 1, 0, 0, (i / 300) % 6, 0, 0, 0, 0, 0, 0, 0]);
    ws.say({ t: 'in', s });
  }
  room.update();
}
const deflate = zlib.createDeflateRaw({ level: 1 });
const out = [];
deflate.on('data', (d) => out.push(d.length));
let raw = 0;
const kinds = {};
for (const s of sent) {
  raw += s.length;
  const t = s.slice(6, 9);
  kinds[t] = (kinds[t] || 0) + s.length;
  deflate.write(s);
  await new Promise((r) => deflate.flush(zlib.constants.Z_SYNC_FLUSH, r));
}
const wire = out.reduce((a, b) => a + b, 0);
const span = room.game ? room.game.time : seconds;
console.log(`${sent.length} messages over ${span.toFixed(0)} s of ride`);
console.log(`raw ${(raw / 1024 / span).toFixed(1)} KB/s, on the wire ${(wire / 1024 / span).toFixed(2)} KB/s, ${((wire / span) * 60 * 7 / 1048576).toFixed(1)} MB per 7-minute ride`);
// which parts of an update weigh most (uncompressed)
const last = JSON.parse(sent.filter((s) => s.startsWith('{"t":"s"')).at(-1));
const part = (o) => JSON.stringify(o)?.length ?? 0;
console.log('one update by part (bytes, uncompressed):', JSON.stringify({ snap: Object.fromEntries(Object.entries(last.snap).map(([k, v]) => [k, part(v)]).filter(([, n]) => n > 150)), self: part(last.self), ev: part(last.ev), loot: part(last.loot) }));
