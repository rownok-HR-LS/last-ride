// Weapons (melee and ranged, no guns), rarities, ammo, healing and occult items, ghost powers, prizes and loot tables.
import { weighted } from './rng.js';

/** dmg: damage multiplier. speed: swing / reload time multiplier. dura: durability multiplier. */
export const RARITIES = [
  { id: 'common', name: 'Common', color: '#a3a8b0', dmg: 1, speed: 1, dura: 1 },
  { id: 'uncommon', name: 'Uncommon', color: '#45c75e', dmg: 1.07, speed: 0.96, dura: 1.15 },
  { id: 'rare', name: 'Rare', color: '#3d8dff', dmg: 1.14, speed: 0.92, dura: 1.3 },
  { id: 'epic', name: 'Epic', color: '#b45cff', dmg: 1.22, speed: 0.88, dura: 1.45 },
  { id: 'legendary', name: 'Legendary', color: '#ffb52e', dmg: 1.3, speed: 0.84, dura: 1.6 },
];

/**
 * Melee: dmg per light hit, heavy = damage multiplier of a fully charged swing, reach (m), arc (degrees),
 * swing = seconds for a light swing (the hit lands at hitAt of it), stam = stamina per light swing,
 * dura = hits before it breaks, knock = shove speed on hit. auto: keeps cutting while the button is held.
 * poise: big two-handed swings carry on through light hits (only a heavy hit or a parry stops them).
 *
 * Ranged: ammo type, speed (m/s) and grav of the projectile, dmg, head multiplier, rof between shots,
 * mag + reload for launchers, draw = seconds to fully draw a bow (damage and speed scale with the draw).
 */
export const WEAPONS = {
  // theme-park junk
  mallet: { type: 'melee', name: 'Whack-a-Mole Mallet', dmg: 16, heavy: 2.3, reach: 2.0, arc: 100, swing: 0.31, hitAt: 0.4, stam: 9, dura: 40, knock: 4 },
  spike: { type: 'melee', name: 'Cotton-Candy Spike', dmg: 18, heavy: 2.1, reach: 2.2, arc: 55, swing: 0.32, hitAt: 0.4, stam: 10, dura: 26, knock: 1.5 },
  lever: { type: 'melee', name: 'Ride Lever Bar', dmg: 18, heavy: 2, reach: 2.3, arc: 100, swing: 0.42, hitAt: 0.4, stam: 13, dura: 34, knock: 4, poise: true },
  sledge: { type: 'melee', name: 'Strongman Sledgehammer', dmg: 30, heavy: 1.9, reach: 2.5, arc: 110, swing: 0.7, hitAt: 0.4, stam: 22, dura: 18, knock: 8, poise: true },
  // horror classics
  crowbar: { type: 'melee', name: 'Crowbar', dmg: 21, heavy: 2, reach: 2.0, arc: 90, swing: 0.38, hitAt: 0.4, stam: 12, dura: 40, knock: 3 },
  machete: { type: 'melee', name: 'Machete', dmg: 23, heavy: 2, reach: 2.1, arc: 100, swing: 0.34, hitAt: 0.4, stam: 12, dura: 26, knock: 2 },
  axe: { type: 'melee', name: 'Fire Axe', dmg: 27, heavy: 2, reach: 2.3, arc: 90, swing: 0.52, hitAt: 0.4, stam: 16, dura: 22, knock: 4.5, poise: true },
  chainsaw: { type: 'melee', name: 'Chainsaw', dmg: 10, heavy: 1, reach: 2.2, arc: 60, swing: 0.16, hitAt: 0.5, stam: 2, dura: 70, knock: 0.8, auto: true, prize: true, poise: true },
  // rare, slow or loud ranged weapons
  darts: { type: 'ranged', name: 'Carnival Darts', ammo: 'darts', speed: 34, grav: 9, dmg: 18, head: 1.8, rof: 0.42, thrown: true },
  bow: { type: 'ranged', name: 'Hunting Bow', ammo: 'arrows', speed: 62, grav: 9, dmg: 58, head: 2, rof: 0.35, draw: 0.85 },
  crossbow: { type: 'ranged', name: 'Crossbow', ammo: 'bolts', speed: 80, grav: 6, dmg: 68, head: 2, rof: 0.3, mag: 1, reload: 1.9 },
  harpoon: { type: 'ranged', name: 'Harpoon Launcher', ammo: 'harpoons', speed: 46, grav: 7, dmg: 45, head: 1.6, rof: 0.3, mag: 1, reload: 2.6, pull: 9 },
  fireworks: { type: 'ranged', name: 'Firework Launcher', ammo: 'rockets', speed: 27, grav: 2.5, dmg: 58, head: 1, rof: 0.9, mag: 3, reload: 2.8, blast: 3.6 },
};
export const WEAPON_IDS = Object.keys(WEAPONS);

/** Bare hands: always there when the selected slot is empty. A heavy punch is a shove. */
export const FISTS = { type: 'melee', name: 'Fists', dmg: 7, heavy: 1.3, reach: 1.7, arc: 100, swing: 0.3, hitAt: 0.4, stam: 6, dura: Infinity, knock: 2, shove: 10 };

export const STAMINA = {
  max: 100,
  regen: 32, // per second
  delay: 0.7, // seconds after spending before it regenerates
  heavyMul: 2, // a heavy swing costs this many light swings
  dodge: 28,
  blockPerDmg: 0.9, // stamina lost per point of damage blocked
};
/** Heavy swings: hold the button at least minT, full power at fullT. */
/** Heavy swings: keep holding after a swing to charge; full power after fullT seconds of charging. */
/** slow: a released heavy takes this much longer than a light swing, so it can be read and dodged or parried. */
export const HEAVY = { minT: 0.15, fullT: 0.6, minMul: 0.7, slow: 1.4 };
/** Light-swing combos: a third quick hit in a row is a stronger finisher. */
export const COMBO = { window: 0.6, finisher: 1.35 };
/** Knockback (m/s) and how long the victim is staggered (s). */
export const IMPACT = {
  light: { push: 2.2, stagger: 0.3 }, finisher: { push: 3.6, stagger: 0.45 }, heavy: { push: 6, stagger: 0.7, hop: 2 }, slide: 0.24,
};
/** Aim assist: swings turn toward an enemy this far off the crosshair (degrees) and lunge up to lunge m closer. */
export const ASSIST = { angle: 45, extra: 1.6, lunge: 1.0 };
export const DODGE = { speed: 11, time: 0.32, iframes: 0.24, cd: 0.55 };
/**
 * Slide: from a run (at least min m/s) drop and skid feet first with a little extra speed (boost), up to max m/s.
 * Friction bleeds it off (m/s²) until it falls below end or time runs out; steer (rad/s) bends it a little.
 */
export const SLIDE = { min: 4, boost: 1.5, max: 9.5, friction: 6, end: 2.4, time: 1.1, steer: 1.4, stam: 12, cd: 0.4 };
/** Block: frontal arc (degrees), how much damage gets through, how slow you move. */
export const BLOCK = { arc: 120, light: 0.2, heavy: 0.45, speed: 0.6 };
/**
 * Parry: a guard raised at most window seconds before the hit lands takes nothing and staggers the attacker
 * (stagger s, and they lose stam). The guard has to have been down for rearm s first, so mashing block doesn't work.
 */
export const PARRY = { window: 0.2, rearm: 0.4, stagger: 0.85, stam: 20, push: 2.5 };

export const AMMO = {
  darts: { name: 'Darts', pickup: 8, max: 30, color: '#e8d27a' },
  arrows: { name: 'Arrows', pickup: 8, max: 36, color: '#b98a5a' },
  bolts: { name: 'Bolts', pickup: 5, max: 20, color: '#79c6e8' },
  harpoons: { name: 'Harpoons', pickup: 3, max: 9, color: '#9be879' },
  rockets: { name: 'Rockets', pickup: 3, max: 9, color: '#e86a5a' },
};
export const AMMO_IDS = Object.keys(AMMO);

/**
 * Consumables. Healing (keys 4-6) and occult tools against ghosts (keys 7-0).
 * Holy water and flares are thrown; salt is poured at your feet; the relic is held up.
 */
export const ITEMS = {
  bandage: { name: 'Bandage', key: '4', heal: 15, cap: 75, time: 3, max: 10, pickup: 5, color: '#f2e6d8' },
  medkit: { name: 'Medkit', key: '5', heal: 100, cap: 100, time: 7, max: 3, pickup: 1, color: '#ff5a6a' },
  soda: { name: 'Shield Soda', key: '6', shield: 50, time: 4, max: 4, pickup: 2, color: '#4fb8ff' },
  holy: { name: 'Holy Water', key: '7', occult: true, throw: true, max: 3, pickup: 1, color: '#9fd8ff', radius: 3.6, burn: 8, ecto: 40, help: 'Throw it at a ghost or a possessed ride: burns the ghost and breaks the possession.' },
  flare: { name: 'Flare', key: '8', occult: true, throw: true, max: 3, pickup: 2, color: '#ff4a3a', radius: 20, dur: 25, help: 'Throw it: lights the area and reveals ghosts nearby.' },
  salt: { name: 'Salt', key: '9', occult: true, max: 2, pickup: 1, color: '#f4f1ea', radius: 3.4, dur: 30, help: 'Pour a circle at your feet. Ghosts cannot cross it or use powers inside.' },
  relic: { name: 'Blessed Relic', key: '0', occult: true, max: 1, pickup: 1, color: '#ffd76a', dur: 15, radius: 4.5, help: 'Hold it up: ghost attacks can\'t hurt you and nearby ghosts burn.' },
};
export const ITEM_IDS = Object.keys(ITEMS);
/** Seconds to drink / bandage; occult tools are instant. */
export const THROW = { speed: 18, grav: 14 };

export function weaponDef(w) {
  return w ? WEAPONS[w.w] : FISTS;
}

export function weaponLabel(w, rarity) {
  return `${RARITIES[rarity].name} ${WEAPONS[w].name}`;
}

/** A fresh weapon as it lies on the floor or sits in a slot. */
export function makeWeapon(w, rarity) {
  const def = WEAPONS[w];
  const out = { w, rarity };
  if (def.type === 'melee') out.dura = Math.round(def.dura * RARITIES[rarity].dura);
  if (def.mag) out.mag = def.mag;
  return out;
}

// ------------------------------------------------------------------ ghost powers

export const POWERS = {
  trap: { key: '1', name: 'Bear Trap', cost: 35, cd: 6, range: 16, max: 2, dmg: 15, root: 1.3, help: 'Hidden jaws: damage and root a survivor.' },
  cursed: { key: '2', name: 'Cursed Loot', cost: 35, cd: 10, range: 16, max: 2, dmg: 35, radius: 3.6, help: 'A fake chest that explodes when opened.' },
  steps: { key: '3', name: 'Fake Footsteps', cost: 10, cd: 8, range: 45, dur: 6, help: 'Phantom footsteps to lure survivors.' },
  blackout: { key: '4', name: 'Blackout', cost: 40, cd: 20, range: 70, radius: 22, dur: 12, help: 'Kill the lights in an area.' },
  scare: { key: '5', name: 'Jump Scare', cost: 30, cd: 12, range: 12, reveal: 6, shake: 2.2, help: 'Scare a survivor in your sights. Reveals them to everyone.' },
  storm: { key: '6', name: 'Storm Pull', cost: 50, cd: 30, range: 300, shift: 14, help: 'Drag the storm toward a spot.' },
};
export const POWER_IDS = Object.keys(POWERS);

export const RIDES = {
  ferris: { name: 'Ferris Wheel', cost: 35, cd: 3, range: 80, reach: 18, dmg: 45, radius: 4.6, warn: 1.25, help: 'Fling gondolas at survivors.' },
  coaster: { name: 'Roller Coaster', cost: 60, cd: 28, reach: 12, dmg: 100, speed: 32, laps: 2, help: 'Send the train screaming around the track.' },
  car: { name: 'Bumper Car', cost: 45, reach: 6, dur: 12, dmg: 30, speed: 14, help: 'Ram survivors with a bumper car.' },
};

// ------------------------------------------------------------------ prize counter

/** Tickets earned. */
export const TICKETS = { kill: 20, chest: 6, floor: [4, 10] };

/** What the prize counters sell, for tickets. */
export const PRIZES = [
  { id: 'chainsaw', label: 'Chainsaw', cost: 60, give: { weapon: 'chainsaw', rarity: 4 } },
  { id: 'crossbow', label: 'Legendary Crossbow', cost: 45, give: { weapon: 'crossbow', rarity: 4, ammo: 'bolts', count: 10 } },
  { id: 'relic', label: 'Blessed Relic', cost: 40, give: { item: 'relic', count: 1 } },
  { id: 'sledge', label: 'Epic Sledgehammer', cost: 30, give: { weapon: 'sledge', rarity: 3 } },
  { id: 'holy', label: 'Holy Water ×2', cost: 16, give: { item: 'holy', count: 2 } },
  { id: 'medkit', label: 'Medkit', cost: 15, give: { item: 'medkit', count: 1 } },
  { id: 'soda', label: 'Shield Soda ×2', cost: 12, give: { item: 'soda', count: 2 } },
];

// ------------------------------------------------------------------ loot tables

const MELEE_WEIGHTS = [['mallet', 16], ['spike', 13], ['lever', 13], ['crowbar', 16], ['machete', 12], ['axe', 9], ['sledge', 6]];
const RANGED_WEIGHTS = [['darts', 10], ['bow', 6], ['crossbow', 4], ['harpoon', 3], ['fireworks', 2]];
const FLOOR_RARITY = [[0, 40], [1, 30], [2, 18], [3, 9], [4, 3]];
const CHEST_RARITY = [[0, 8], [1, 30], [2, 33], [3, 21], [4, 8]];

/** Ranged weapons are rare: about one floor weapon in five. */
export function rollWeapon(rand, chest = false) {
  const ranged = rand() < (chest ? 0.32 : 0.2);
  const w = weighted(rand, ranged ? RANGED_WEIGHTS : MELEE_WEIGHTS);
  return makeWeapon(w, weighted(rand, chest ? CHEST_RARITY : FLOOR_RARITY));
}

export function rollFloor(rand) {
  const r = rand();
  if (r < 0.46) return { kind: 'weapon', ...rollWeapon(rand) };
  if (r < 0.6) {
    const ammo = weighted(rand, [['darts', 3], ['arrows', 3], ['bolts', 2], ['harpoons', 1], ['rockets', 1]]);
    return { kind: 'ammo', ammo, count: AMMO[ammo].pickup };
  }
  if (r < 0.7) return { kind: 'tickets', count: TICKETS.floor[0] + Math.floor(rand() * (TICKETS.floor[1] - TICKETS.floor[0] + 1)) };
  if (r < 0.8) {
    const item = weighted(rand, [['holy', 4], ['flare', 4], ['salt', 3]]);
    return { kind: 'item', item, count: ITEMS[item].pickup };
  }
  const item = weighted(rand, [['bandage', 5], ['medkit', 1.5], ['soda', 3]]);
  return { kind: 'item', item, count: ITEMS[item].pickup };
}
