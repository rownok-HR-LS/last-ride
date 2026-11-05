// A rider's progress, kept in this browser (no accounts): experience and level, the looks they have earned and
// picked, personal bests, and three daily challenges. A ride's results come in through award(); the end screen
// shows what it earned.
import { LOOK_KINDS, cleanLook } from '../shared/looks.js';

const KEY = 'last-ride-progress';
export const MAX_LEVEL = 30;

/** Experience to go from level n to n + 1: the first levels come every ride or two, later ones slower. */
export const toNext = (n) => 400 + 150 * (n - 1);

/** Daily challenges: progress adds up over the day, across rides. */
const DAILIES = [
  { id: 'kills', text: 'Land 5 kills', goal: 5, stat: 'kills' },
  { id: 'steal', text: 'Steal a body as a ghost', goal: 1, stat: 'revives' },
  { id: 'survive', text: 'Survive 10 minutes in total', goal: 600, stat: 'alive', unit: 's' },
  { id: 'parry', text: 'Parry 3 blows', goal: 3, stat: 'parries' },
  { id: 'chests', text: 'Open 8 chests', goal: 8, stat: 'chests' },
  { id: 'possess', text: 'Possess 2 rides as a ghost', goal: 2, stat: 'possessions' },
  { id: 'top3', text: 'Finish in the top 3', goal: 1, stat: 'top3' },
  { id: 'damage', text: 'Deal 1,500 damage', goal: 1500, stat: 'dmg' },
  { id: 'ghostkills', text: 'Kill 2 survivors as a ghost', goal: 2, stat: 'ghostKills' },
];
const DAILY_XP = 250;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** Three challenges for a date, the same for everyone on that day. */
function dailyIds(date) {
  let h = 2166136261;
  for (const ch of date) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const pool = DAILIES.map((d) => d.id);
  const out = [];
  while (out.length < 3) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    out.push(pool.splice(h % pool.length, 1)[0]);
  }
  return out;
}

function fresh() {
  return { xp: 0, look: cleanLook(null), bests: { rides: 0, wins: 0, place: null, kills: 0, alive: 0, totalKills: 0 }, daily: null, seenLevel: 1 };
}

export function loadProgress() {
  let p;
  try {
    p = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    p = null;
  }
  p = { ...fresh(), ...(p || {}) };
  p.bests = { ...fresh().bests, ...p.bests };
  p.look = cleanLook(p.look);
  // a new day brings new challenges
  const d = today();
  if (!p.daily || p.daily.date !== d) p.daily = { date: d, ids: dailyIds(d), prog: {}, done: [] };
  // never wear something not (or no longer) earned
  const lvl = levelOf(p.xp).level;
  for (const [kind, list] of Object.entries(LOOK_KINDS)) if ((list.find((x) => x.id === p.look[kind])?.level ?? 1) > lvl) p.look[kind] = list[0].id;
  return p;
}

export function saveProgress(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode: progress lasts this visit */
  }
}

/** { level, into (xp into this level), need (xp this level takes) } for a total. */
export function levelOf(xp) {
  let level = 1;
  let left = xp;
  while (level < MAX_LEVEL && left >= toNext(level)) {
    left -= toNext(level);
    level++;
  }
  return { level, into: level >= MAX_LEVEL ? 0 : left, need: level >= MAX_LEVEL ? 0 : toNext(level) };
}

/** The day's three challenges with their progress: [{ id, text, goal, have, done }]. */
export function dailies(p) {
  return p.daily.ids.map((id) => {
    const d = DAILIES.find((x) => x.id === id);
    const have = Math.min(d.goal, p.daily.prog[id] || 0);
    return { ...d, have, done: p.daily.done.includes(id) };
  });
}

/** Every look with whether it is earned at this level. */
export function looksFor(p) {
  const { level } = levelOf(p.xp);
  return Object.fromEntries(Object.entries(LOOK_KINDS).map(([kind, list]) => [kind, list.map((x) => ({ ...x, earned: x.level <= level }))]));
}

/**
 * A ride is over. stats: { place, of, kills, ghostKills, revives, dmg, alive (s), parries, chests, possessions }.
 * Adds the experience, the challenges and the bests to p (and saves it); returns what to show on the results.
 */
export function award(p, stats) {
  const before = levelOf(p.xp);
  const lines = [];
  const add = (label, xp) => xp > 0 && lines.push({ label, xp: Math.round(xp) });
  add('Took the ride', 50);
  add(`Survived ${Math.floor(stats.alive / 60)}:${String(stats.alive % 60).padStart(2, '0')}`, stats.alive);
  add(`${stats.kills} kill${stats.kills === 1 ? '' : 's'}`, stats.kills * 75);
  add(`${stats.ghostKills} as a ghost`, stats.ghostKills * 60);
  add(`${stats.revives} bod${stats.revives === 1 ? 'y' : 'ies'} stolen`, stats.revives * 80);
  add(`${stats.dmg} damage`, stats.dmg * 0.5);
  add(stats.place === 1 ? 'Rode the last bus out' : `Placed ${stats.place} of ${stats.of}`, stats.place === 1 ? 400 : stats.place <= 3 ? 200 : stats.place <= 10 ? 80 : 0);
  // the day's challenges
  const finished = [];
  const tally = { ...stats, top3: stats.place <= 3 ? 1 : 0 };
  for (const d of dailies(p)) {
    if (d.done) continue;
    p.daily.prog[d.id] = (p.daily.prog[d.id] || 0) + (tally[d.stat] || 0);
    if (p.daily.prog[d.id] >= d.goal) {
      p.daily.done.push(d.id);
      finished.push(d.text);
      add(`Daily: ${d.text}`, DAILY_XP);
    }
  }
  const gained = lines.reduce((n, l) => n + l.xp, 0);
  p.xp += gained;
  const after = levelOf(p.xp);
  // what the new levels unlocked
  const unlocks = [];
  for (const [kind, list] of Object.entries(LOOK_KINDS)) for (const x of list) if (x.level > before.level && x.level <= after.level) unlocks.push({ kind, ...x });
  // personal bests
  const b = p.bests;
  const records = [];
  b.rides++;
  b.totalKills += stats.kills;
  if (stats.place === 1) b.wins++;
  if (b.place === null || stats.place < b.place) {
    if (b.place !== null) records.push(`Best finish: ${stats.place}`);
    b.place = stats.place;
  }
  if (stats.kills > b.kills) {
    if (b.rides > 1) records.push(`Most kills in a ride: ${stats.kills}`);
    b.kills = stats.kills;
  }
  if (stats.alive > b.alive) {
    if (b.rides > 1) records.push(`Longest survival: ${Math.floor(stats.alive / 60)}:${String(stats.alive % 60).padStart(2, '0')}`);
    b.alive = stats.alive;
  }
  saveProgress(p);
  return { lines, gained, before, after, unlocks, finished, records };
}
