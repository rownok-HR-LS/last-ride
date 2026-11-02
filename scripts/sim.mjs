// Headless match: 20 bots, logs the flow of the game.
import { Game } from '../shared/game.js';

const g = new Game({ seed: +(process.argv[2] || 7) });
g.fillBots(20);
const dt = 1 / 60;
const counts = {};
let t0 = Date.now();
let lastLog = 0;
for (let i = 0; i < 60 * 60 * 15 && g.phase !== 'end'; i++) {
  g.update(dt);
  for (const e of g.drainEvents()) {
    counts[e.e] = (counts[e.e] || 0) + 1;
    if (e.e === 'kill') {
      const k = g.players.get(e.killer);
      const v = g.players.get(e.victim);
      console.log(`${g.time.toFixed(1)}s  ${k ? k.name : 'storm'} -> ${v.name} (${e.how})${e.steal ? '  STOLE BODY' : ''}`);
      counts['how_' + e.how] = (counts['how_' + e.how] || 0) + 1;
    }
    if (e.e === 'final' || e.e === 'end' || e.e === 'possess') console.log(g.time.toFixed(1) + 's', JSON.stringify(e));
  }
  if (g.time - lastLog > 30) {
    lastLog = g.time;
    console.log(`-- t=${g.time.toFixed(0)} living=${g.living()} zone r=${g.zone.r.toFixed(0)} ${g.zone.state} loot=${g.loot.size}`);
  }
}
console.log('phase', g.phase, 'time', g.time.toFixed(1), 'wall ms', Date.now() - t0);
console.log(counts);
console.log(g.standings().slice(0, 5));
