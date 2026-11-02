// AI for bot survivors (loot, fight, dodge rides, follow the storm) and bot ghosts (haunt with powers).
import { EYE_HEIGHT, LANDING_GRACE } from './constants.js';
import {
  WEAPONS, RIDES, POWERS, ITEMS, AMMO, PRIZES, RARITIES, HEAVY, THROW, STAMINA, weaponDef,
} from './items.js';
import { CHEST_SPOTS, LOOT_SPOTS, PRIZE_BOOTHS, FERRIS, STATION, TRACK, trackAt, PARK_EDGE, BUS_ROUTE, busAt } from './map.js';
import { lineOfSight } from './collide.js';
import { findPath } from './nav.js';
import { anglesTo, angleDiff, pick } from './rng.js';

const LOW_TRACK = [];
for (let s = 0; s < TRACK.len; s += 3) {
  const t = trackAt(s);
  if (t.y < 3) LOW_TRACK.push({ s, x: t.x, y: t.y, z: t.z });
}

/**
 * skill: random range per bot. react: seconds before the first shot at a new target.
 * err: starting aim error (radians). wobble: constant jitter. humanRange: how far away bots notice human players.
 */
export const DIFFICULTY = {
  easy: { skill: [0.1, 0.35], react: 0.9, err: 0.5, wobble: 0.1, humanRange: 28 },
  normal: { skill: [0.3, 0.6], react: 0.55, err: 0.34, wobble: 0.06, humanRange: 40 },
  hard: { skill: [0.55, 0.9], react: 0.3, err: 0.22, wobble: 0.035, humanRange: 55 },
};

/**
 * How each bot likes to fight. weight: share of bots. loot: seconds after landing spent looting before picking fights
 * (unless provoked or someone walks right up). range: how far they go after someone. guard: how often they block or
 * parry a swing they read. dodge: how often they dodge a heavy. press: how readily they step in without an opening.
 * retreat: health at which they back off to heal. vulture: they go for the hurt and for people already fighting.
 */
export const PERSONAS = {
  brawler: { weight: 0.35, loot: 50, range: 22, guard: 0.35, dodge: 0.25, press: 0.75, retreat: 25, vulture: false },
  duelist: { weight: 0.4, loot: 80, range: 15, guard: 0.8, dodge: 0.5, press: 0.3, retreat: 50, vulture: false },
  opportunist: { weight: 0.25, loot: 90, range: 22, guard: 0.5, dodge: 0.6, press: 0.45, retreat: 55, vulture: true },
};

function pickPersona(rand) {
  let r = rand();
  for (const [id, P] of Object.entries(PERSONAS)) {
    r -= P.weight;
    if (r <= 0) return id;
  }
  return 'duelist';
}

export function createBrain(rand, difficulty = 'normal') {
  const D = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const persona = pickPersona(rand);
  return {
    rand,
    D,
    persona,
    P: PERSONAS[persona],
    skill: D.skill[0] + rand() * (D.skill[1] - D.skill[0]),
    think: rand() * 0.3,
    path: null,
    goal: null,
    goalKind: null,
    goalId: null,
    repathT: 0,
    enemy: null,
    seenT: 0,
    react: 0,
    errYaw: 0,
    errPitch: 0,
    strafe: rand() < 0.5 ? -1 : 1,
    strafeT: 0,
    stuckT: 0,
    lastX: 0,
    lastZ: 0,
    jump: false,
    flee: null,
    fleeT: 0,
    ghostGoal: null,
    ghostPlan: null,
    target: null,
    flingT: 0,
  };
}

function toLocal(wx, wz, yaw) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return { fwd: -(wx * s + wz * c), side: wx * c - wz * s };
}

function setGoal(b, x, z, kind, id = null) {
  b.goal = [x, z];
  b.goalKind = kind;
  b.goalId = id;
  b.path = null;
  b.repathT = 0;
}

export function updateBot(game, p, dt) {
  const b = p.brain;
  if (p.state === 'bus') {
    if (!p.target) {
      // aim for loot somewhere along the route, so the riders spread out
      const near = [...CHEST_SPOTS, ...LOOT_SPOTS].filter((s) => {
        for (let d = BUS_ROUTE.gateS; d < BUS_ROUTE.len; d += 6) {
          const q = busAt(d);
          if (Math.hypot(q.x - s.x, q.z - s.z) < 35) return true;
        }
        return false;
      });
      const spot = pick(game.rand, near.length ? near : LOOT_SPOTS);
      game.command(p.id, { c: 'land', x: spot.x, z: spot.z });
    }
    if (game.phase !== 'live' || !p.target) return;
    // get off once the bus is as close to the target as it will get (or close enough)
    const d = Math.hypot(game.bus.x - p.target.x, game.bus.z - p.target.z);
    if (d < 14 || (b.busD !== undefined && d > b.busD + 0.3 && b.busD < 45)) game.command(p.id, { c: 'jump' });
    b.busD = Math.min(b.busD ?? Infinity, d);
    return;
  }
  if (p.state === 'alive') survivor(game, p, b, dt);
  else ghost(game, p, b, dt);
}

// ------------------------------------------------------------------ survivors

/** Best slot for this distance: ranged when they are far and we have ammo, otherwise the best melee. */
function bestSlot(p, dist) {
  let best = -1;
  let bestScore = -Infinity;
  p.slots.forEach((g, i) => {
    if (!g) return;
    const def = WEAPONS[g.w];
    let score;
    if (def.type === 'ranged') {
      const loaded = (def.mag ? g.mag : 0) + p.ammo[def.ammo] > 0;
      if (!loaded) return;
      score = dist > 9 ? 3 + g.rarity * 0.2 : -2;
    } else score = (dist > 9 ? 0 : 2) + def.dmg / 15 + g.rarity * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Best weapon a rider carries, as a rough number (melee damage per hit, ranged counts for more). */
function gearScore(p) {
  let best = 4;
  for (const g of p.slots) {
    if (!g) continue;
    const def = WEAPONS[g.w];
    const v = def.type === 'melee' ? def.dmg * RARITIES[g.rarity].dmg : p.ammo[def.ammo] > 0 || g.mag > 0 ? 34 : 0;
    best = Math.max(best, v);
  }
  return best;
}

/** They look like they'd win: much better armed, or a lot healthier. */
function outclassed(p, q) {
  return gearScore(q) > gearScore(p) * 1.35 || q.hp + q.shield > p.hp + p.shield + 35;
}

/** A real weapon in hand: any ranged weapon with ammo, or melee that hits for 15 or more. */
function wellArmed(p) {
  return p.slots.some((g) => g && (WEAPONS[g.w].type === 'melee' ? WEAPONS[g.w].dmg * RARITIES[g.rarity].dmg >= 15 : p.ammo[WEAPONS[g.w].ammo] > 0 || g.mag > 0));
}

function hasHeal(p) {
  return p.items.medkit > 0 || p.items.bandage > 0 || p.items.soda > 0;
}

function armed(p) {
  return p.slots.some((g) => g && (WEAPONS[g.w].type === 'melee' || p.ammo[WEAPONS[g.w].ammo] > 0 || g.mag > 0));
}

function weaponValue(p, w, rarity) {
  const def = WEAPONS[w];
  if (def.type === 'ranged') return 1.5 + rarity * 0.3 + (p.ammo[def.ammo] > 0 ? 1 : 0);
  return def.dmg / 12 + rarity * 0.4;
}

/** Loot worth walking to, scored by value / distance. */
function pickLoot(game, p) {
  let best = null;
  let bestScore = 0;
  const emptySlot = p.slots.some((s) => !s);
  const worst = Math.min(...p.slots.map((s) => (s ? weaponValue(p, s.w, s.rarity) : -1)));
  const hasMelee = p.slots.some((s) => s && WEAPONS[s.w].type === 'melee');
  // early on, leave things someone else is closer to (except brawlers, who'll fight for them)
  const yieldLoot = p.brain && p.brain.persona !== 'brawler' && p.landedAt !== null && game.time - p.landedAt < p.brain.P.loot;
  const rivals = yieldLoot ? [...game.players.values()].filter((q) => q !== p && q.state === 'alive' && Math.hypot(q.x - p.x, q.z - p.z) < 60) : [];
  for (const l of game.loot.values()) {
    const d = Math.hypot(l.x - p.x, l.z - p.z);
    if (d > 55 || Math.abs(l.y - p.y) > 3) continue;
    if (rivals.some((q) => Math.hypot(l.x - q.x, l.z - q.z) < Math.min(d, 12))) continue;
    let v = 0;
    if (l.kind === 'chest') v = 4;
    else if (l.kind === 'weapon') {
      const def = WEAPONS[l.w];
      if (p.slots.some((s) => s && s.w === l.w && s.rarity >= l.rarity)) continue;
      const val = weaponValue(p, l.w, l.rarity);
      if (!hasMelee && def.type === 'melee') v = 5 + val * 0.3;
      else if (emptySlot) v = 2.5 + val * 0.3;
      else if (val > worst + 0.8) v = 1.2 + val * 0.2;
    } else if (l.kind === 'ammo') {
      const uses = p.slots.some((s) => s && WEAPONS[s.w].ammo === l.ammo);
      if (uses && p.ammo[l.ammo] < AMMO[l.ammo].max * 0.6) v = 1.5;
    } else if (l.kind === 'tickets') v = 1.2;
    else if (l.kind === 'item') {
      if (p.items[l.item] < ITEMS[l.item].max) v = ITEMS[l.item].occult ? 0.7 : l.item === 'medkit' || p.items[l.item] < 2 ? 1.6 : 0.8;
    }
    if (v <= 0) continue;
    const score = v / (d + 6);
    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  }
  return best;
}

/** The best prize we can afford and want right now. */
function wantedPrize(p) {
  for (const pr of PRIZES) {
    if (pr.cost > p.tickets) continue;
    const g = pr.give;
    if (g.weapon && p.slots.some((s) => s && s.w === g.weapon)) continue;
    if (g.item && p.items[g.item] >= ITEMS[g.item].max) continue;
    if (g.weapon || pr.cost >= 30) return pr;
  }
  return null;
}

function zoneGoal(game, p) {
  const zn = game.zone;
  if (zn.state === 'idle') return null;
  const cx = zn.state === 'wait' ? zn.nx : zn.cx;
  const cz = zn.state === 'wait' ? zn.nz : zn.cz;
  const r = zn.state === 'wait' ? zn.nr : zn.r;
  const d = Math.hypot(p.x - cx, p.z - cz);
  const outsideNow = Math.hypot(p.x - zn.cx, p.z - zn.cz) > zn.r - 2;
  if (d < Math.max(r * 0.85, 3) && !outsideNow) return null;
  const k = Math.max(0, r * 0.5) / Math.max(d, 1);
  return [cx + (p.x - cx) * k, cz + (p.z - cz) * k];
}

function hazards(game, p, b) {
  // flying gondolas
  for (const g of game.gondolas) {
    const d = Math.hypot(p.x - g.to[0], p.z - g.to[2]);
    if (d < RIDES.ferris.radius + 2.5) return [p.x - g.to[0] || 1, p.z - g.to[2]];
  }
  // the coaster coming down the track
  const c = game.coaster;
  if (c.running) {
    for (let k = 0; k < 14; k++) {
      const t = trackAt(c.s + k * 3);
      if (Math.abs(t.y - p.y) > 2.6) continue;
      const d = Math.hypot(p.x - t.x, p.z - t.z);
      if (d < 4) return [-t.tz * Math.sign((p.x - t.x) * -t.tz + (p.z - t.z) * t.tx || 1), t.tx * Math.sign((p.x - t.x) * -t.tz + (p.z - t.z) * t.tx || 1)];
    }
  }
  // possessed bumper cars
  for (const car of game.cars) {
    if (!car.driver) continue;
    const dx = p.x - car.x;
    const dz = p.z - car.z;
    const d = Math.hypot(dx, dz);
    if (d > 10) continue;
    const toward = car.vx * dx + car.vz * dz;
    if (toward <= 0) continue;
    // step sideways out of its path
    return [-car.vz * b.strafe, car.vx * b.strafe];
  }
  return null;
}

/** Launch angle to hit a point dx away (horizontal) and dy up with speed v under gravity g (the flat shot). */
function ballistic(dx, dy, v, g) {
  if (g < 0.01) return Math.atan2(dy, dx);
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
  if (disc < 0) return Math.PI / 4;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * dx));
}

/** Ghost-fighting: holy water at a possessed ride or a close ghost, salt or the relic when haunted. */
function useOccult(game, p, b) {
  if (p.fireT > 0) return null;
  let near = null;
  let nd = 22;
  for (const g of game.players.values()) {
    if (g.state !== 'ghost' || g.burnT > 0) continue;
    const s = game.ghostSpot(g);
    const d = Math.hypot(s.x - p.x, s.z - p.z);
    if (d < nd && (g.possess || g.exposedT > 0 || d < 8)) {
      nd = d;
      near = { g, s };
    }
  }
  if (!near) return null;
  if (p.items.relic > 0 && p.hp < 55 && b.rand() < 0.4) return { item: 'relic' };
  if (p.items.holy > 0 && near.g.possess?.kind === 'car' && nd < 16) return { item: 'holy', at: near.s };
  if (p.items.salt > 0 && nd < 10 && b.rand() < 0.2) return { item: 'salt' };
  if (p.items.flare > 0 && b.rand() < 0.05) return { item: 'flare', at: { x: p.x, y: p.y, z: p.z } };
  return null;
}

function survivor(game, p, b, dt) {
  b.think -= dt;
  b.strafeT -= dt;
  b.repathT -= dt;
  b.fleeT -= dt;
  b.holdT = Math.max(0, (b.holdT || 0) - dt);
  b.guardT = Math.max(0, (b.guardT || 0) - dt);
  b.backT = Math.max(0, (b.backT || 0) - dt);
  b.retreatT = Math.max(0, (b.retreatT || 0) - dt);
  const eyeY = p.y + EYE_HEIGHT;

  if (b.think <= 0) {
    b.think = 0.25 + b.rand() * 0.1;
    // pick an enemy we can see
    const P = b.P;
    let best = null;
    let bestD = 60;
    // fresh off the bus, most riders loot first and only fight what walks right up to them
    const settling = p.landedAt !== null && game.time - p.landedAt < P.loot;
    for (const q of game.players.values()) {
      if (q === p || q.state !== 'alive') continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      // nobody gets jumped right after landing, unless they started the fight
      const provoked = p.lastHitBy === q.id && game.time - p.lastHitAt < 8;
      if (!provoked && q.landedAt !== null && game.time - q.landedAt < LANDING_GRACE) continue;
      if (!provoked && (b.spared?.[q.id] ?? -99) > game.time) continue;
      const busy = game.time - (q.lastHitAt ?? -99) < 4;
      const easy = q.hp + q.shield < 55 || busy;
      if (!provoked && settling && d > 4 && !(P.vulture && easy)) continue;
      // with only fists or a poor weapon, keep looting rather than start something
      if (!provoked && d > 4 && !wellArmed(p) && !(P.vulture && easy)) continue;
      // careful riders size each other up and leave someone clearly stronger alone
      if (!provoked && b.persona !== 'brawler' && d > 4 && outclassed(p, q)) continue;
      // hurt, or just out of a fight: patch up and pick over the body before looking for the next one
      const worn = p.hp + p.shield < (b.persona === 'brawler' ? 35 : 65) || game.time - (b.wonAt ?? -99) < 8;
      if (!provoked && worn && d > 4 && q.id !== b.enemy) continue;
      // vultures leave healthy riders who aren't in a fight alone, unless they get close
      if (!provoked && P.vulture && !easy && d > 8) continue;
      const range = q.revealT > 0 ? 70 : q.bot ? P.range : Math.max(P.range, b.D.humanRange);
      if (!provoked && (d > range || d > bestD + (q.id === b.enemy ? 8 : 0))) continue;
      // facing matters at range
      const ang = Math.abs(angleDiff(p.yaw, anglesTo(p.x, 0, p.z, q.x, 0, q.z).yaw));
      if (d > 22 && ang > 1.2 && q.revealT <= 0 && q.id !== b.enemy) continue;
      if (!lineOfSight(p.x, eyeY, p.z, q.x, q.y + 1.2, q.z)) continue;
      best = q;
      bestD = d - (q.id === b.enemy ? 8 : 0) - (P.vulture && easy ? 12 : 0);
    }
    // unarmed bots only pick fights they are dragged into
    if (best && !armed(p) && p.lastHitBy !== best.id) best = null;
    const prev = b.enemy;
    b.enemy = best ? best.id : null;
    if (b.enemy && b.enemy !== prev) {
      b.react = b.D.react + (1 - b.skill) * 0.5 + b.rand() * 0.3;
      b.errYaw = (b.rand() < 0.5 ? -1 : 1) * (0.5 + b.rand() * 0.5) * b.D.err;
      b.errPitch = (b.rand() - 0.5) * b.D.err * 0.5;
    }

    // badly hurt: back off and patch up (when there is something to heal with, or they are clearly winning)
    const foe = b.enemy ? game.players.get(b.enemy) : null;
    if (foe && b.retreatT <= 0 && p.hp + p.shield < P.retreat && (hasHeal(p) || foe.hp + foe.shield > p.hp + p.shield + 15)) {
      b.retreatT = 2.5 + b.rand() * 2;
    }
    // they're running for it: only brawlers and vultures chase a beaten rider down; the rest let them go for a while
    if (foe && !P.vulture && b.persona !== 'brawler' && p.lastHitBy !== foe.id) {
      const fd = Math.hypot(foe.x - p.x, foe.z - p.z);
      const away = ((foe.x - p.x) * foe.vx + (foe.z - p.z) * foe.vz) / (fd || 1);
      if (fd > 10 && away > 2.5) {
        (b.spared ||= {})[foe.id] = game.time + 15;
        b.enemy = null;
      }
    }
    // now and then step in without waiting for an opening
    b.commit = b.rand() < P.press * (0.5 + b.skill * 0.5);

    const flee = hazards(game, p, b);
    if (flee) {
      b.flee = flee;
      b.fleeT = 0.7;
    }

    const occ = useOccult(game, p, b);
    if (occ) b.occult = occ;

    const enemy = b.enemy ? game.players.get(b.enemy) : null;
    if (!enemy) {
      // heal up when safe
      if (!p.use) {
        if (p.hp < 50 && p.items.medkit > 0) game.command(p.id, { c: 'use', item: 'medkit' });
        else if (p.hp < 70 && p.items.bandage > 0) game.command(p.id, { c: 'use', item: 'bandage' });
        else if (p.shield < 50 && p.items.soda > 0) game.command(p.id, { c: 'use', item: 'soda' });
      }
      const g = p.slots[p.cur];
      if (g && g.mag !== undefined && g.mag < WEAPONS[g.w].mag) game.command(p.id, { c: 'reload' });
      // hold the best melee weapon while travelling
      const melee = bestSlot(p, 0);
      if (melee >= 0 && melee !== p.cur) game.command(p.id, { c: 'slot', i: melee });
      // spend tickets at a prize counter when we can afford something good
      const prize = wantedPrize(p);
      if (prize && game.boothNear(p) >= 0) game.command(p.id, { c: 'buy', prize: prize.id });
      const zg = zoneGoal(game, p);
      if (zg) {
        if (b.goalKind !== 'zone' || Math.hypot(zg[0] - b.goal[0], zg[1] - b.goal[1]) > 10) setGoal(b, zg[0], zg[1], 'zone');
      } else if (prize && b.goalKind !== 'booth') {
        let booth = null;
        let bd = 70;
        for (const bo of PRIZE_BOOTHS) {
          const d = Math.hypot(bo.x - p.x, bo.z - p.z);
          if (d < bd) {
            bd = d;
            booth = bo;
          }
        }
        if (booth) setGoal(b, booth.x, booth.z, 'booth');
      } else if (b.goalKind !== 'booth' || !prize) {
        const fake = game.steps.find((s) => Math.hypot(s.x - p.x, s.z - p.z) < 30);
        if (fake && b.goalKind !== 'steps' && b.rand() < 0.5) setGoal(b, fake.x, fake.z, 'steps');
        else if (b.goalKind !== 'loot' || !game.loot.has(b.goalId)) {
          const l = pickLoot(game, p);
          if (l) setGoal(b, l.x, l.z, 'loot', l.id);
          else if (!b.goal || b.goalKind !== 'wander') {
            // roam the part of the park we're already in (heading for the middle would pile everyone up there);
            // once the storm has closed in, roam inside the circle instead
            const zn = game.zone;
            const a = b.rand() * Math.PI * 2;
            const local = Math.hypot(p.x - zn.cx, p.z - zn.cz) < zn.r * 0.75;
            const [ox, oz, rr] = local ? [p.x, p.z, 30] : [zn.cx, zn.cz, Math.min(zn.r * 0.6, 40)];
            const r = rr * (0.3 + b.rand() * 0.7);
            const lim = PARK_EDGE - 6;
            setGoal(b, Math.max(-lim, Math.min(lim, ox + Math.cos(a) * r)), Math.max(-lim, Math.min(lim, oz + Math.sin(a) * r)), 'wander');
          }
        }
      }
    } else {
      p.use && game.command(p.id, { c: 'slot', i: p.cur });
      const d = Math.hypot(enemy.x - p.x, enemy.z - p.z);
      const slot = bestSlot(p, d);
      if (slot >= 0 && slot !== p.cur && !p.atk && p.charge <= 0) game.command(p.id, { c: 'slot', i: slot });
      if (!armed(p)) {
        const l = pickLoot(game, p);
        if (l) setGoal(b, l.x, l.z, 'loot', l.id);
      }
    }
  }

  // arrive at loot or a booth
  if (b.goalKind === 'loot') {
    const l = game.loot.get(b.goalId);
    if (!l) b.goal = null;
    else if (Math.hypot(l.x - p.x, l.z - p.z) < 1.6) {
      if (l.kind === 'chest' || l.kind === 'weapon') game.command(p.id, { c: 'interact', id: l.id });
      b.goal = null;
      b.goalKind = null;
    }
  } else if (b.goal && Math.hypot(b.goal[0] - p.x, b.goal[1] - p.z) < (b.goalKind === 'booth' ? 3.5 : 2)) {
    if (b.goalKind === 'booth') {
      const prize = wantedPrize(p);
      if (prize) game.command(p.id, { c: 'buy', prize: prize.id });
    }
    b.goal = null;
    b.goalKind = null;
  }

  // path following
  let wx = 0;
  let wz = 0;
  if (b.goal) {
    if (!b.path || b.repathT <= 0) {
      b.path = findPath(p.x, p.z, b.goal[0], b.goal[1]);
      b.repathT = 2.5 + b.rand();
      if (!b.path) {
        b.goal = null;
        b.goalKind = null;
      }
    }
    if (b.path && b.path.length) {
      const w = b.path[0];
      const dx = w[0] - p.x;
      const dz = w[1] - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.1 && b.path.length > 1) b.path.shift();
      if (d > 0.01) {
        wx = dx / d;
        wz = dz / d;
      }
    }
  }

  const enemy = b.enemy ? game.players.get(b.enemy) : null;
  // still settling in and not after anyone: give other riders a wide berth instead of brushing past them
  if (!enemy && p.landedAt !== null && game.time - p.landedAt < b.P.loot) {
    for (const q of game.players.values()) {
      if (q === p || q.state !== 'alive') continue;
      const dx = p.x - q.x;
      const dz = p.z - q.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 7) {
        wx += (dx / d) * (1 - d / 7) * 1.6;
        wz += (dz / d) * (1 - d / 7) * 1.6;
      }
    }
    const l = Math.hypot(wx, wz);
    if (l > 1) {
      wx /= l;
      wz /= l;
    }
  }
  let yaw = p.yaw;
  let pitch = 0;
  let fire = false;
  let aim = false;
  if (b.occult) {
    // face where the tool should go, then use it
    const o = b.occult;
    b.occult = null;
    if (o.at) {
      const dx = Math.hypot(o.at.x - p.x, o.at.z - p.z);
      yaw = anglesTo(p.x, 0, p.z, o.at.x, 0, o.at.z).yaw;
      pitch = ballistic(Math.max(1, dx), o.at.y - eyeY, THROW.speed, THROW.grav) - 0.12;
      game.setInput(p.id, { fwd: 0, side: 0, yaw, pitch });
    }
    game.command(p.id, { c: 'use', item: o.item });
  } else if (enemy && enemy.state === 'alive') {
    const dist = Math.hypot(enemy.x - p.x, enemy.z - p.z);
    const g = p.slots[p.cur];
    const def = weaponDef(g);
    b.react -= dt;
    // the aim error shrinks the longer we track a target
    b.errYaw *= Math.max(0, 1 - dt * (0.4 + b.skill * 1.1));
    b.errPitch *= Math.max(0, 1 - dt * (0.4 + b.skill * 1.1));
    const wobble = b.D.wobble * (1 - b.skill * 0.5) * (1 + Math.hypot(enemy.vx, enemy.vz) / 6);
    let tx = enemy.x;
    let tz = enemy.z;
    let wantPitch = 0;
    if (def.type === 'ranged') {
      // lead the target by the flight time and lob for gravity
      const flight = dist / def.speed;
      const lead = flight * (0.4 + b.skill * 0.6);
      tx = enemy.x + enemy.vx * lead;
      tz = enemy.z + enemy.vz * lead;
      const dh = Math.hypot(tx - p.x, tz - p.z);
      wantPitch = ballistic(Math.max(1, dh), enemy.y + 1.1 - eyeY, def.speed, def.grav) + b.errPitch;
    }
    const a = anglesTo(p.x, eyeY, p.z, tx, enemy.y + 1.15, tz);
    const wantYaw = a.yaw + (def.type === 'ranged' ? b.errYaw : b.errYaw * 0.3) + (b.rand() - 0.5) * wobble;
    const turn = (3 + b.skill * 5) * dt;
    yaw = p.yaw + Math.max(-turn, Math.min(turn, angleDiff(p.yaw, wantYaw)));
    pitch = p.pitch + Math.max(-turn, Math.min(turn, wantPitch - p.pitch));
    const off = Math.abs(angleDiff(yaw, a.yaw));

    if (b.strafeT <= 0) {
      b.strafe = -b.strafe;
      b.strafeT = 0.5 + b.rand() * 1.2;
      b.jump = def.type === 'ranged' && b.rand() < 0.1;
    }
    const fx = (enemy.x - p.x) / (dist || 1);
    const fz = (enemy.z - p.z) / (dist || 1);

    if (def.type === 'melee') {
      const P = b.P;
      const eDef = weaponDef(enemy.slots[enemy.cur]);
      const theirReach = eDef.reach + 0.5;
      const reach = def.reach * 0.85;
      const ea = enemy.atk;
      b.swingCd = Math.max(0, (b.swingCd || 0) - dt);

      // read their swing. A quick one can only be blocked; a heavy is slow enough to dodge, or to parry by
      // raising the guard just before it lands. Sharper bots notice sooner.
      // a heavy being charged is the tell: decide now what to do when it comes
      if (enemy.charge > 0 && dist < theirReach + 1.5) {
        if (!b.ready) {
          const r = b.rand();
          const sharp = 0.5 + b.skill * 0.7;
          b.ready = r < P.dodge * sharp ? 'dodge' : r < (P.dodge + P.guard * 0.8) * sharp ? 'parry' : r < 0.85 ? 'back' : 'none';
          if (b.ready === 'parry' || b.ready === 'dodge') b.guardT = 0;
        }
        if (b.ready === 'back') b.backT = Math.max(b.backT, 0.2);
      } else if (!ea || !ea.heavy) b.ready = null;
      if (ea && ea.heavy && ea !== b.seenAtk && b.ready && dist < theirReach + 0.8) {
        b.seenAtk = ea;
        const hitIn = ea.T * eDef.hitAt - ea.t;
        const lead = 0.04 + b.rand() * (0.08 + (1 - b.skill) * 0.2);
        if (b.ready === 'dodge' && p.stam > STAMINA.dodge * 0.6) b.plan = { act: 'dodge', at: game.time + Math.max(0, hitIn - 0.15) };
        else if (b.ready === 'parry') b.plan = { act: 'guard', at: game.time + Math.max(0, hitIn - lead), until: game.time + hitIn + 0.2 };
        else if (b.ready === 'back') b.plan = { act: 'back', at: game.time, until: game.time + hitIn + 0.15 };
        b.ready = null;
      }
      if (ea && ea !== b.seenAtk && dist < theirReach + 0.8) {
        b.seenAtk = ea;
        const hitIn = ea.T * eDef.hitAt - ea.t;
        const see = 0.1 + (1 - b.skill) * 0.22 + b.rand() * 0.1;
        const r = b.rand();
        if (see < hitIn) {
          if (ea.heavy && r < P.dodge * (0.6 + b.skill * 0.6) && p.stam > STAMINA.dodge) {
            b.plan = { act: 'dodge', at: game.time + see };
          } else if (r < P.guard * (0.45 + b.skill * 0.55)) {
            // aim for the moment just before impact (a parry); timing gets sloppier with less skill
            const lead = 0.06 + b.rand() * (0.1 + (1 - b.skill) * 0.3);
            b.plan = { act: 'guard', at: game.time + Math.max(see, hitIn - lead), until: game.time + hitIn + 0.25 };
          } else if (dist > reach * 0.6 && r < P.guard + 0.25) {
            b.plan = { act: 'back', at: game.time + see, until: game.time + hitIn + 0.15 };
          }
        } else if (b.guardT > 0) b.guardT = Math.max(b.guardT, 0.3);
      }
      if (b.plan && game.time >= b.plan.at) {
        const pl = b.plan;
        b.plan = null;
        if (pl.act === 'dodge') game.command(p.id, { c: 'dodge', fwd: -0.6, side: b.strafe });
        else if (pl.act === 'guard') b.guardT = Math.max(b.guardT, pl.until - game.time);
        else b.backT = Math.max(b.backT, pl.until - game.time);
      }

      // openings: they whiffed, are staggered, just finished a combo, are out of breath or busy healing
      const opening = enemy.staggerT > 0 || (ea && !ea.hit && dist > theirReach - 0.2) || enemy.use
        || (!ea && enemy.charge <= 0 && game.time - (enemy.lastSwingEnd ?? -9) < 0.35) || enemy.stam < 15;
      const retreating = b.retreatT > 0;
      const go = !retreating && (opening || b.commit);
      if (!retreating && b.react <= 0 && b.swingCd <= 0 && dist < reach + 0.4 && off < 0.5 && !p.atk && p.staggerT <= 0 && (go || dist < reach * 0.6)) {
        // heavy into a blocker or when they are staggered, otherwise quick swings
        if (b.holdT <= 0 && p.charge <= 0 && p.stam > def.stam && !p.prevFire && b.guardT <= 0.05) {
          // click for quick combos; hold through a swing to follow up with a heavy (it breaks blocks)
          const heavy = !def.auto && (enemy.blocking || enemy.staggerT > 0.3 || b.rand() < 0.12 + b.skill * 0.1);
          b.holdT = heavy ? def.swing + HEAVY.fullT * (0.5 + b.rand() * 0.5) : 0.04;
          b.guardT = 0;
          // a short combo, then step back out and read the fight again
          b.combo = (b.combo || 0) + 1;
          if (b.combo >= 1 + Math.floor(b.rand() * (1 + b.skill * 2.5))) {
            b.combo = 0;
            b.swingCd = (1 - b.skill * 0.5) * (0.5 + b.rand() * 0.6) + (heavy ? def.swing : 0);
            if (P.press < 0.6) b.backT = Math.max(b.backT, 0.35 + b.rand() * 0.3);
          }
        }
      }
      // careful fighters keep their guard up while waiting just outside reach
      if (!go && !p.atk && b.holdT <= 0 && dist < theirReach + 0.6 && enemy.charge <= 0 && p.stam > 30 && b.rand() < P.guard * dt * 3) {
        b.guardT = Math.max(b.guardT, 0.4 + b.rand() * 0.4);
      }
      aim = b.guardT > 0 && !p.atk && b.holdT <= 0;
      fire = def.auto ? dist < reach + 0.4 && off < 0.6 && b.react <= 0 && !retreating : b.holdT > 0;
      if (retreating) {
        // heal once there's room, otherwise keep backing off with the guard up when they're close
        if (dist > 11 && !p.use && hasHeal(p)) {
          const item = p.hp < 60 && p.items.medkit > 0 ? 'medkit' : p.items.bandage > 0 && p.hp < 75 ? 'bandage' : p.items.soda > 0 ? 'soda' : null;
          if (item) game.command(p.id, { c: 'use', item });
        }
        if (dist < theirReach + 1) b.guardT = Math.max(b.guardT, 0.2);
      }
      if (b.goalKind !== 'zone' || !b.goal) {
        // footwork: hold just outside their reach, step in on an opening, back out after a combo
        const spacing = Math.max(theirReach, reach) + 0.3;
        const tired = p.stam < 20;
        let push;
        if (retreating) push = dist < 16 ? -1 : 0;
        else if (b.backT > 0 || tired) push = -0.8;
        else if (go) push = dist > reach * 0.8 ? 1 : -0.2;
        else push = dist > spacing + 0.6 ? 0.85 : dist < spacing - 0.4 ? -0.6 : 0;
        const circle = retreating ? 0.4 : dist < spacing + 2 ? 0.6 : 0.15;
        wx = fx * push + -fz * b.strafe * circle;
        wz = fz * push + fx * b.strafe * circle;
      }
    } else {
      // ranged: hold a distance, aim, shoot (bows: draw, then loose when lined up)
      aim = dist > 10;
      const tol = Math.max(0.03, Math.atan2(0.6, dist));
      const lined = b.react <= 0 && off < tol * 2.5;
      if (def.draw) {
        const full = def.draw * RARITIES[g.rarity].speed;
        fire = p.charge < full * (0.75 + b.skill * 0.25) || !lined;
        if (p.charge <= 0 && !lined) fire = false;
      } else fire = lined && !p.prevFire;
      if (b.goalKind !== 'zone' || !b.goal) {
        const pref = 22;
        const push = dist > pref * 1.4 ? 0.8 : dist < 8 ? -0.9 : 0;
        wx = fx * push + -fz * b.strafe * 0.9;
        wz = fz * push + fx * b.strafe * 0.9;
      }
    }
  } else if (Math.hypot(wx, wz) > 0) {
    yaw = Math.atan2(-wx, -wz);
  }

  if (b.fleeT > 0 && b.flee) {
    const l = Math.hypot(b.flee[0], b.flee[1]) || 1;
    wx = b.flee[0] / l;
    wz = b.flee[1] / l;
  }

  // stuck: jump, then try a detour
  const moving = Math.hypot(wx, wz) > 0.1;
  b.stuckT += dt;
  let jump = false;
  if (b.stuckT > 0.8) {
    const prog = Math.hypot(p.x - b.lastX, p.z - b.lastZ);
    if (moving && prog < 0.6) {
      jump = true;
      b.repathT = 0;
      if (b.goal && prog < 0.2) {
        b.goal = [b.goal[0] + (b.rand() - 0.5) * 6, b.goal[1] + (b.rand() - 0.5) * 6];
      }
    }
    b.stuckT = 0;
    b.lastX = p.x;
    b.lastZ = p.z;
  }
  if (b.jump) {
    jump = true;
    b.jump = false;
  }

  const loc = toLocal(wx, wz, yaw);
  game.setInput(p.id, { fwd: loc.fwd, side: loc.side, yaw, pitch, fire, aim, jump });
}

// ------------------------------------------------------------------ ghosts

function chooseVictim(game, p, b) {
  let best = null;
  let bestScore = Infinity;
  // how many other ghosts are already on each survivor: the haunting spreads out instead of piling on
  const hunted = {};
  for (const g of game.players.values()) {
    if (g !== p && g.state === 'ghost' && g.brain?.target != null) hunted[g.brain.target] = (hunted[g.brain.target] || 0) + 1;
  }
  for (const q of game.players.values()) {
    if (q.state !== 'alive') continue;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    let score = d + q.hp * 0.25 + q.shield * 0.15 + (hunted[q.id] || 0) * 18;
    if (!q.bot) score += 25; // spread the haunting around
    if (q.revealT > 0) score -= 20;
    if (q.id === b.target) score -= 15;
    if (score < bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
}

function ghost(game, p, b, dt) {
  b.think -= dt;
  const pos = p.possess;
  let gx = p.x;
  let gy = p.y;
  let gz = p.z;
  let fast = false;
  let fire = false;
  let aimAt = null;

  if (b.think <= 0) {
    b.think = 0.9 + b.rand() * 0.6;
    const v = chooseVictim(game, p, b);
    b.target = v ? v.id : null;
    if (!pos && v) planGhost(game, p, b, v);
  }
  const v = b.target ? game.players.get(b.target) : null;

  if (pos?.kind === 'car') {
    const car = game.cars[pos.car];
    if (!v || Math.hypot(v.x - car.x, v.z - car.z) > 60) {
      game.command(p.id, { c: 'release' });
    } else {
      const dx = v.x + v.vx * 0.3 - car.x;
      const dz = v.z + v.vz * 0.3 - car.z;
      const yaw = Math.atan2(-dx, -dz);
      game.setInput(p.id, { fwd: 1, side: 0, yaw, pitch: 0 });
      return;
    }
  } else if (pos?.kind === 'ferris') {
    b.flingT -= dt;
    const inRange = v && Math.hypot(v.x - FERRIS.x, v.z - FERRIS.z) < RIDES.ferris.range - 4;
    if (!inRange || p.ecto < RIDES.ferris.cost - 1) {
      if (b.flingT < -3 || !inRange) game.command(p.id, { c: 'release' });
    } else if ((p.cds.fling || 0) <= 0 && b.flingT <= 0) {
      const lead = RIDES.ferris.warn * (0.4 + b.rand() * 0.6);
      game.command(p.id, { c: 'power', id: 'fling', x: v.x + v.vx * lead, z: v.z + v.vz * lead });
      b.flingT = 1.5 + b.rand() * 2;
    }
    void fire;
    void aimAt;
    game.setInput(p.id, { yaw: p.yaw, pitch: 0 });
    return;
  } else if (pos?.kind === 'coaster') {
    game.setInput(p.id, { yaw: p.yaw, pitch: 0 });
    return;
  }

  const plan = b.ghostPlan;
  if (plan) {
    gx = plan.x;
    gy = plan.y;
    gz = plan.z;
    const d = Math.hypot(p.x - gx, p.z - gz);
    fast = d > 25;
    if (d < plan.reach && Math.abs(p.y - gy) < 4) {
      if (plan.kind === 'possess') game.command(p.id, { c: 'possess' });
      else game.command(p.id, plan.cmd);
      b.ghostPlan = null;
    }
    plan.t -= dt;
    if (plan.t <= 0) b.ghostPlan = null;
  } else if (v) {
    // drift around the victim, high enough to watch
    const a = game.time * 0.4 + p.id;
    gx = v.x + Math.cos(a) * 9;
    gz = v.z + Math.sin(a) * 9;
    gy = v.y + 5;
    fast = Math.hypot(p.x - gx, p.z - gz) > 30;
  } else {
    gy = 8;
  }

  const dx = gx - p.x;
  const dy = gy - p.y;
  const dz = gz - p.z;
  const d = Math.hypot(dx, dz);
  const yaw = d > 0.5 ? Math.atan2(-dx, -dz) : p.yaw;
  const fwd = d > 1.5 ? 1 : d / 1.5;
  game.setInput(p.id, { fwd, side: 0, up: Math.max(-1, Math.min(1, dy / 3)), yaw, pitch: 0, fast });
}

function planGhost(game, p, b, v) {
  if (b.ghostPlan) return;
  const r = b.rand();
  const dv = Math.hypot(v.x - p.x, v.z - p.z);
  const T = 12;

  // Ferris wheel when the victim is in throwing range
  if (!game.ferris.driver && p.ecto >= 60 && Math.hypot(v.x - FERRIS.x, v.z - FERRIS.z) < RIDES.ferris.range - 10 && r < 0.5) {
    b.ghostPlan = { kind: 'possess', x: FERRIS.x, y: FERRIS.hubY - 6, z: FERRIS.z + 4, reach: 10, t: T };
    return;
  }
  // coaster when the victim stands near a low stretch of track
  if (!game.coaster.running && game.coaster.cd <= 0 && p.ecto >= RIDES.coaster.cost) {
    const near = LOW_TRACK.some((t) => Math.hypot(t.x - v.x, t.z - v.z) < 7 && Math.abs(t.y - v.y) < 2.5);
    if (near) {
      b.ghostPlan = { kind: 'possess', x: STATION.x, y: 2, z: STATION.z, reach: 6, t: T };
      return;
    }
  }
  // a bumper car close to the victim
  if (p.ecto >= RIDES.car.cost + 5 && r < 0.6) {
    let best = null;
    let bestD = 45;
    game.cars.forEach((c) => {
      if (c.driver) return;
      const d = Math.hypot(c.x - v.x, c.z - v.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    });
    if (best) {
      b.ghostPlan = { kind: 'possess', x: best.x, y: best.y + 1.5, z: best.z, reach: 3.5, t: T };
      return;
    }
  }
  if (dv > 30) return;
  const ahead = (k) => [v.x + v.vx * k, v.z + v.vz * k];
  const cmd = (id, x, z, extra = {}) => ({ c: 'power', id, x, y: v.y, z, ...extra });
  const spend = (id) => p.ecto >= POWERS[id].cost && (p.cds[id] || 0) <= 0;
  if (spend('scare') && r < 0.25) {
    b.ghostPlan = { kind: 'cmd', cmd: { c: 'power', id: 'scare', target: v.id }, x: v.x, y: v.y + 3, z: v.z, reach: 8, t: 6 };
  } else if (spend('trap') && Math.hypot(v.vx, v.vz) > 2 && r < 0.6) {
    const [x, z] = ahead(1.3);
    b.ghostPlan = { kind: 'cmd', cmd: cmd('trap', x, z), x, y: v.y + 4, z, reach: 12, t: 5 };
  } else if (spend('cursed') && r < 0.7) {
    const [x, z] = ahead(2.5);
    b.ghostPlan = { kind: 'cmd', cmd: cmd('cursed', x + 2, z + 2), x, y: v.y + 4, z, reach: 12, t: 5 };
  } else if (spend('blackout') && r < 0.78) {
    b.ghostPlan = { kind: 'cmd', cmd: cmd('blackout', v.x, v.z), x: v.x, y: v.y + 6, z: v.z, reach: 40, t: 5 };
  } else if (spend('storm') && game.zone.state === 'wait' && r < 0.86) {
    b.ghostPlan = { kind: 'cmd', cmd: cmd('storm', v.x, v.z), x: p.x, y: p.y, z: p.z, reach: 999, t: 2 };
  } else if (spend('steps') && r < 0.95) {
    const x = v.x + (b.rand() - 0.5) * 20;
    const z = v.z + (b.rand() - 0.5) * 20;
    b.ghostPlan = { kind: 'cmd', cmd: cmd('steps', x, z), x, y: v.y + 4, z, reach: 40, t: 4 };
  }
}
