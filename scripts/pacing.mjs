// Pacing report: survivors left every 30 s, who kills whom each minute (survivors, ghosts, the world), body steals
// and ghost power use. usage: node scripts/pacing.mjs [matches=20]
import { Game } from '../shared/game.js';

const N = +(process.argv[2] || 20);
const kills = {}; const steals = {}; const powers = {}; const surv = {}; let ends = []; const finalStart = [];
for (let seed = 1; seed <= N; seed++) {
  const g = new Game({ seed }); g.fillBots(20);
  let liveT = null;
  for (let i = 0; i < 60 * 60 * 12 && g.phase !== 'end'; i++) {
    g.update(1 / 60);
    if (g.phase === 'live' && liveT === null) liveT = g.time;
    if (liveT !== null && i % 1800 === 0) { const b = Math.round((g.time - liveT) / 30) * 30; (surv[b] ||= []).push(g.living()); }
    for (const e of g.drainEvents()) {
      const t = g.time - (liveT ?? 0); const b = Math.floor(t / 60) * 60;
      if (e.e === 'kill') {
        const k = e.killer != null ? g.players.get(e.killer) : null;
        const kind = !k ? 'world:' + e.how : (k.state === 'ghost' || e.steal) ? 'ghost:' + e.how : 'survivor';
        (kills[b] ||= {})[kind] = ((kills[b] ||= {})[kind] || 0) + 1;
        if (e.steal) steals[b] = (steals[b] || 0) + 1;
      }
      if (['trapSet', 'blackout', 'scare', 'storm', 'steps', 'possess', 'fling'].includes(e.e) || (e.e === 'boom' && e.kind === 'cursed')) powers[e.e] = (powers[e.e] || 0) + 1;
      if (e.e === 'final' && !finalStart[seed]) finalStart[seed] = t;
    }
  }
  ends.push(g.time - liveT);
}
console.log('match length avg', (ends.reduce((a, b) => a + b) / N).toFixed(0), 'final countdown starts avg', (finalStart.filter(Boolean).reduce((a, b) => a + b, 0) / finalStart.filter(Boolean).length).toFixed(0));
console.log('survivors alive by time:'); for (const k of Object.keys(surv).sort((a, b) => a - b)) console.log('  ', k, (surv[k].reduce((a, b) => a + b) / surv[k].length).toFixed(1), `(n=${surv[k].length})`);
console.log('kills per minute bucket (all matches):'); for (const k of Object.keys(kills).sort((a, b) => a - b)) console.log('  ', k, JSON.stringify(kills[k]), 'steals', steals[k] || 0);
console.log('power uses', powers);
