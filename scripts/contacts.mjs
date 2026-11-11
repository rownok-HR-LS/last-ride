// Headless check of body and car contact (shared/physics.js): runs bot matches and counts shoulder checks, car
// bumps and wall bounces, and the worst overlap left between two living riders after a step.
// Usage: node scripts/contacts.mjs [seed ...]
import { Game } from '../shared/game.js';
import { PLAYER_RADIUS } from '../shared/constants.js';

const seeds = process.argv.slice(2).map(Number);
for (const seed of seeds.length ? seeds : [3, 7, 11]) {
  const g = new Game({ seed });
  g.fillBots(20);
  const dt = 1 / 60;
  const count = {};
  let worst = 0;
  let i = 0;
  for (; i < 60 * 60 * 15 && g.phase !== 'end'; i++) {
    g.update(dt);
    for (const e of g.drainEvents()) if (['shove', 'carbump', 'wallhit', 'bump', 'kill', 'possess'].includes(e.e)) count[e.e] = (count[e.e] || 0) + 1;
    if (i % 6) continue;
    const alive = [...g.players.values()].filter((p) => p.state === 'alive');
    for (let a = 0; a < alive.length; a++) {
      for (let b = a + 1; b < alive.length; b++) {
        const p = alive[a];
        const q = alive[b];
        if (Math.abs(p.y - q.y) < 1.5) worst = Math.max(worst, PLAYER_RADIUS * 1.9 - Math.hypot(p.x - q.x, p.z - q.z));
      }
    }
  }
  console.log(`seed ${seed}: ${Math.round(i / 60)} s, ${g.phase}, ${JSON.stringify(count)}, worst overlap ${Math.max(0, worst).toFixed(3)} m`);
}
