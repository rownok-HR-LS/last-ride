// LAST RIDE game server: the park's rides over WebSockets. Run with `npm start` (PORT defaults to 8090).
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Park } from './room.js';
import { TICK } from '../shared/net.js';

const PORT = +process.env.PORT || 8090;
// a shorter wait at the stop when testing: BUS_WAIT=5 in the environment, or --bus=5
const busArg = +(process.argv.find((a) => a.startsWith('--bus='))?.slice(6) ?? 0);
const bus = +process.env.BUS_WAIT || busArg || undefined;
const park = new Park({ busWait: bus, busAgain: bus });

// a plain page for health checks (Render pings it to know the server is up)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(park.info()));
});

const wss = new WebSocketServer({
  server,
  maxPayload: 8192,
  // snapshots are repetitive text: a quick compression pass cuts them to about a third
  perMessageDeflate: { zlibDeflateOptions: { level: 1 }, threshold: 512 },
});

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  park.connect(ws);
});

// drop connections that stopped answering
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, 15000);

// a steady 60 ticks a second, catching up if a tick ran late
let next = performance.now();
function loop() {
  const now = performance.now();
  let n = 0;
  while (now >= next && n < 5) {
    park.update();
    next += TICK * 1000;
    n++;
  }
  if (now - next > 250) next = now;
  setTimeout(loop, Math.max(0, next - performance.now()));
}
loop();

server.listen(PORT, () => console.log(`last-ride server on :${PORT}`));
