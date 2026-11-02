// Balance report: plays many headless 20-bot matches and sums up pacing, weapons and how the bots fight.
// usage: node scripts/balance.mjs [matches=10] [firstSeed=1] [difficulty=normal]
import { Game } from '../shared/game.js';
import { WEAPONS } from '../shared/items.js';

const N = +(process.argv[2] || 10);
const SEED = +(process.argv[3] || 1);
const DIFF = process.argv[4] || 'normal';
const dt = 1 / 60;
const S = {
  len: [], firstKill: [], thirdKill: [], fifthKill: [], winnerKills: [], topKills: [], liveAt60: [], liveAt120: [],
  kills: {}, dmg: {}, holdSec: {}, swings: 0, parries: 0, meleeHits: 0, whiffs: 0, blocks: 0, broke: 0, dodges: 0, dodged: 0,
  fired: {}, rangedHits: {}, steals: 0, causes: {}, heavy: 0,
};
const add = (o, k, v = 1) => (o[k] = (o[k] || 0) + v);
const t0 = Date.now();
for (let m = 0; m < N; m++) {
  const g = new Game({ seed: SEED + m, difficulty: DIFF });
  g.fillBots(20);
  const killTimes = [];
  const killsBy = {};
  let liveT = null;
  for (let i = 0; i < 60 * 60 * 15 && g.phase !== 'end'; i++) {
    g.update(dt);
    if (g.phase === 'live' && liveT === null) liveT = g.time;
    // what everyone alive is holding, once a second
    if (liveT !== null && i % 60 === 0) {
      for (const p of g.players.values()) {
        if (p.state !== 'alive') continue;
        const w = p.slots?.[p.cur]?.w || 'fists';
        add(S.holdSec, w);
      }
      const t = g.time - liveT;
      if (Math.abs(t - 60) < 0.5) S.liveAt60.push(g.living());
      if (Math.abs(t - 120) < 0.5) S.liveAt120.push(g.living());
    }
    for (const e of g.drainEvents()) {
      switch (e.e) {
        case 'kill':
          killTimes.push(g.time - (liveT ?? 0));
          add(S.kills, e.how);
          if (e.killer != null) add(killsBy, e.killer);
          if (e.steal) S.steals++;
          add(S.causes, e.killer == null ? 'world:' + e.how : WEAPONS[e.how] || e.how === 'fists' ? 'weapon' : 'other:' + e.how);
          break;
        case 'hit':
          add(S.dmg, e.how, e.amt);
          if (e.how === 'fists' || WEAPONS[e.how]?.type === 'melee') S.meleeHits++;
          else if (WEAPONS[e.how]) add(S.rangedHits, e.how);
          break;
        case 'swing': S.swings++; if (e.heavy) S.heavy++; break;
        case 'whiff': S.whiffs++; break;
        case 'block': S.blocks++; if (e.broke) S.broke++; break;
        case 'dodge': S.dodges++; break;
        case 'parry': S.parries++; break;
        case 'dodged': S.dodged++; break;
        case 'fire': add(S.fired, e.kind); break;
        default:
      }
    }
  }
  S.len.push(g.time - (liveT ?? 0));
  S.firstKill.push(killTimes[0] ?? NaN);
  S.thirdKill.push(killTimes[2] ?? NaN);
  S.fifthKill.push(killTimes[4] ?? NaN);
  S.winnerKills.push(killsBy[g.winner] || 0);
  S.topKills.push(Math.max(0, ...Object.values(killsBy)));
  process.stderr.write(`match ${m + 1}/${N} ${(g.time - liveT).toFixed(0)}s\n`);
}
const avg = (a) => a.filter((x) => !isNaN(x)).reduce((s, x) => s + x, 0) / Math.max(1, a.filter((x) => !isNaN(x)).length);
const r = (x, d = 1) => +x.toFixed(d);
const span = (a) => `${r(avg(a))} (${r(Math.min(...a))}–${r(Math.max(...a))})`;
console.log(`\n${N} matches, seeds ${SEED}..${SEED + N - 1}, ${DIFF}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log('match length s      ', span(S.len));
console.log('first kill s        ', span(S.firstKill));
console.log('3rd / 5th kill s    ', r(avg(S.thirdKill)), '/', r(avg(S.fifthKill)));
console.log('alive at 60 / 120 s ', r(avg(S.liveAt60)), '/', r(avg(S.liveAt120)));
console.log('winner kills        ', span(S.winnerKills), '  top fragger', span(S.topKills));
console.log('body steals / match ', r(S.steals / N));
console.log('death causes        ', S.causes);
console.log('melee: swings', S.swings, 'heavy', S.heavy, 'hits', S.meleeHits, `(${r((S.meleeHits / S.swings) * 100)}%)`, 'whiffs', S.whiffs,
  '| blocks', S.blocks, `(${r((S.blocks / (S.blocks + S.meleeHits)) * 100)}% of connecting swings)`, 'broke', S.broke,
  '| parries', S.parries, '| dodges', S.dodges, 'dodged', S.dodged);
console.log('\nweapon        kills  dmg     held-min  kills/held-min  dmg/held-min  shots  hit%');
const names = new Set([...Object.keys(S.kills), ...Object.keys(S.holdSec), ...Object.keys(S.dmg)].filter((k) => k === 'fists' || WEAPONS[k]));
for (const w of [...names].sort((a, b) => (S.kills[b] || 0) - (S.kills[a] || 0))) {
  const held = (S.holdSec[w] || 0) / 60;
  const shots = S.fired[w] || 0;
  console.log(
    w.padEnd(13), String(S.kills[w] || 0).padStart(5), String(S.dmg[w] || 0).padStart(7), r(held).toString().padStart(9),
    r((S.kills[w] || 0) / Math.max(held, 0.01), 2).toString().padStart(15), r((S.dmg[w] || 0) / Math.max(held, 0.01), 0).toString().padStart(13),
    shots ? String(shots).padStart(6) : '      ', shots ? r(((S.rangedHits[w] || 0) / shots) * 100) : '',
  );
}
