// Authoritative match simulation. Runs in the browser for offline play and, later, on the game server.
// Clients send continuous input (setInput) plus one-shot commands (command), and read snapshot(viewerId).
import { cleanLook, botLook } from './looks.js';
import {
  MAX_PLAYERS, PLAYER_RADIUS, EYE_HEIGHT, RUN_SPEED, AIM_SPEED, SPRINT_SPEED, COMBAT_SPEED, MAX_HP, MAX_SHIELD, MAX_REVIVES, REVIVE_HP, REVIVE_PROTECT, GHOST_RISE,
  GHOST_SPEED, GHOST_FAST, ECTO_MAX, ECTO_REGEN, ECTO_START, GHOST_FLASH, LAUNCH_SECONDS,
  FINAL_RIDE_SECONDS, FINAL_RIDE_RESET, END_SCREEN_SECONDS, BUS_SPEED, OUTFITS, BOT_NAMES, CHAT_LINES, CHAT_GAP, NIGHTS } from './constants.js';
import { rng, dirFromAngles, pick, angleDiff } from './rng.js';
import {
  WEAPONS, FISTS, RARITIES, AMMO, ITEMS, POWERS, RIDES, PRIZES, TICKETS, STAMINA, HEAVY, DODGE, SLIDE, BLOCK, PARRY, THROW, COMBO, IMPACT, ASSIST,
  rollWeapon, rollFloor, weaponLabel, weaponDef, makeWeapon,
} from './items.js';
import {
  LOOT_SPOTS, CHEST_SPOTS, PRIZE_BOOTHS, FERRIS, STATION, CAR_SPAWNS, TRACK, trackAt, PARK_EDGE, BUS_ROUTE, busAt,
  BREAKABLES, BREAKABLE_MODELS,
} from './map.js';
import { rayWorld, rayPlayer, groundAt, lineOfSight } from './collide.js';
import { stepWalker, stepGhost, stepCar, wishDir, CAR_RADIUS, bodyContact, carContact, carsCollide } from './physics.js';
import { createBrain, updateBot } from './bots.js';

const DEG = Math.PI / 180;
const BOOTH_REACH = 4.4;
const emptyAmmo = () => ({ darts: 0, arrows: 0, bolts: 0, harpoons: 0, rockets: 0 });
const emptyItems = () => ({ bandage: 0, medkit: 0, soda: 0, holy: 0, flare: 0, salt: 0, relic: 0 });
const GHOST_HOWS = new Set(['trap', 'cursed', 'ferris', 'coaster', 'car']);

export const ZONE_PHASES = [
  { wait: 100, shrink: 40, r: 95, dps: 1 },
  { wait: 55, shrink: 30, r: 60, dps: 2 },
  { wait: 40, shrink: 25, r: 36, dps: 4 },
  { wait: 30, shrink: 20, r: 18, dps: 7 },
  { wait: 25, shrink: 20, r: 7, dps: 10 },
  { wait: 20, shrink: 25, r: 0, dps: 16 },
];

function blankInput() {
  return { fwd: 0, side: 0, up: 0, yaw: 0, pitch: 0, ayaw: 0, apitch: 0, fire: false, aim: false, jump: false, fast: false, sprint: false, aimAt: null, aimFrom: null };
}

function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

export class Game {
  constructor({ seed = (Date.now() & 0xffffffff), difficulty = 'normal' } = {}) {
    this.difficulty = ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal';
    this.rand = rng(seed);
    this.time = 0;
    this.phase = 'launch';
    this.launchIn = LAUNCH_SECONDS;
    // tonight's weather (see NIGHTS)
    {
      const ids = Object.keys(NIGHTS);
      let r = this.rand() * ids.reduce((n, id) => n + NIGHTS[id].weight, 0);
      this.night = ids.find((id) => (r -= NIGHTS[id].weight) < 0) || 'storm';
    }
    this.players = new Map();
    this.nextId = 1;
    this.loot = new Map();
    this.nextLoot = 1;
    this.lootVer = 0;
    this.traps = [];
    this.steps = [];
    this.blackouts = [];
    this.projs = [];
    this.nextProj = 1;
    this.flares = [];
    // breakable props: their health this ride, and which are broken (their colliders are switched off)
    this.propHp = BREAKABLES.map((b) => BREAKABLE_MODELS[b.model].hp);
    this.broken = new Set();
    for (const b of BREAKABLES) b.col.off = false;
    this.salts = [];
    this.gondolas = [];
    this.ferris = { angle: 0, driver: null };
    this.coaster = { s: 0, v: 0, dist: 0, running: false, driver: null, cd: 0, hits: new Map() };
    this.bus = { s: 0, v: 0, x: 0, z: 0, dx: 0, dz: -1, yaw: 0 };
    this.placeBus();
    this.cars = CAR_SPAWNS.map((c) => ({ x: c.x, y: 0.18, z: c.z, yaw: c.yaw, vx: 0, vz: 0, driver: null, t: 0, hits: new Map() }));
    this.zone = { cx: 0, cz: 0, r: 175, sx: 0, sz: 0, sr: 175, nx: 0, nz: 0, nr: 175, idx: 0, state: 'idle', t: 0 };
    this.events = [];
    this.finalT = null;
    this.winner = null;
    this.lastDeath = null;
    this.endT = 0;
    this.botNames = [...BOT_NAMES];
    this.spawnLoot();
  }

  // ---------------------------------------------------------------- players

  addPlayer({ name, outfit, bot = false, look = null }) {
    if (this.players.size >= MAX_PLAYERS) return null;
    const id = this.nextId++;
    if (bot) {
      const i = Math.floor(this.rand() * this.botNames.length);
      name = this.botNames.splice(i, 1)[0] || `Bot ${id}`;
      outfit = pick(this.rand, OUTFITS).id;
    }
    const p = {
      id, name: cleanName(name) || `Rider ${id}`, outfit: OUTFITS.some((o) => o.id === outfit) ? outfit : OUTFITS[0].id, bot,
      // earned looks (cosmetic): trail colour, name tag, clothing dye
      look: bot ? botLook(this.rand) : cleanLook(look),
      state: 'bus', x: this.bus.x, y: 1.4, z: this.bus.z, vx: 0, vy: 0, vz: 0, onGround: false,
      yaw: this.rand() * Math.PI * 2, pitch: 0,
      hp: MAX_HP, shield: 0,
      // nobody starts armed: bare fists until you find something
      slots: [null, null, null], cur: 0,
      ammo: emptyAmmo(), items: emptyItems(), tickets: 0,
      fireT: 0, reloadT: 0, reloadDur: 0, use: null, lastShot: -9, prevFire: false,
      stam: STAMINA.max, stamT: 0, atk: null, charge: 0, blocking: false, blockAt: -9, staggerT: 0,
      dodgeT: 0, dodgeCd: 0, dodgeX: 0, dodgeZ: 0, slideT: 0, slideCd: 0, slideV: 0, slideX: 0, slideZ: 0, iframeT: 0, wardT: 0, burnT: 0, exposedT: 0,
      combo: 0, lastSwingEnd: -9, queued: false, knockT: 0, lungeT: 0, lungeSpeed: 0, lungeX: 0, lungeZ: 0,
      revivesUsed: 0, ecto: ECTO_START, cds: {}, flashT: 0, possess: null,
      rootT: 0, shakeT: 0, slowT: 0, revealT: 0, protT: 0, riseT: 0,
      kills: 0, ghostKills: 0, revives: 0, dmg: 0, deaths: 0, diedAt: null, aliveTime: 0,
      target: null, launchAt: null, flight: null,
      input: blankInput(), brain: bot ? createBrain(this.rand, this.difficulty) : null,
      landedAt: null, lastHitBy: null, lastHitAt: -99, sprint: false,
    };
    this.players.set(id, p);
    this.events.push({ e: 'join', id });
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.release(p);
    if (p.state !== 'ghost' && this.phase === 'live') this.dropAll(p);
    this.players.delete(id);
    this.checkFinal();
  }

  /** Someone left mid-ride (online): a bot takes over their rider where they stand. */
  toBot(id) {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    p.bot = true;
    p.brain = createBrain(this.rand, this.difficulty);
    delete p.queue;
    p.input = blankInput();
  }

  /** A rider who dropped out and came back takes their body back from the bot (online). */
  toHuman(id) {
    const p = this.players.get(id);
    if (!p || !p.bot) return false;
    p.bot = false;
    delete p.brain;
    p.input = blankInput();
    p.queue = [];
    p.starved = 0;
    return true;
  }

  fillBots(count = MAX_PLAYERS) {
    while (this.players.size < count) this.addPlayer({ bot: true });
  }

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p) return;
    const i = p.input;
    i.fwd = Math.max(-1, Math.min(1, +input.fwd || 0));
    i.side = Math.max(-1, Math.min(1, +input.side || 0));
    i.up = Math.max(-1, Math.min(1, +input.up || 0));
    i.yaw = +input.yaw || 0;
    i.pitch = Math.max(-1.5, Math.min(1.5, +input.pitch || 0));
    // shots may aim a little off the body yaw (third-person camera looks over the shoulder)
    i.ayaw = Number.isFinite(+input.ayaw) && input.ayaw !== undefined ? +input.ayaw : i.yaw;
    i.apitch = Number.isFinite(+input.apitch) && input.apitch !== undefined ? Math.max(-1.5, Math.min(1.5, +input.apitch)) : i.pitch;
    i.fire = !!input.fire;
    i.aim = !!input.aim;
    i.jump = !!input.jump;
    i.fast = !!input.fast;
    i.sprint = !!input.sprint;
    i.aimAt = Array.isArray(input.aimAt) ? input.aimAt.map(Number) : null;
    i.aimFrom = Array.isArray(input.aimFrom) && input.aimFrom.length === 3 ? input.aimFrom.map(Number) : null;
  }

  living() {
    let n = 0;
    for (const p of this.players.values()) if (p.state !== 'ghost') n++;
    return n;
  }

  // ---------------------------------------------------------------- loot

  addLoot(l) {
    l.id = this.nextLoot++;
    if (l.y === undefined) l.y = groundAt(l.x, l.z, 0.2, 2.2, 0);
    this.loot.set(l.id, l);
    this.lootVer++;
    return l;
  }

  removeLoot(id) {
    if (this.loot.delete(id)) this.lootVer++;
  }

  spawnLoot() {
    for (const s of LOOT_SPOTS) {
      const r = rollFloor(this.rand);
      this.addLoot({ ...r, x: s.x, z: s.z });
      const ammo = r.kind === 'weapon' ? WEAPONS[r.w].ammo : null;
      if (ammo) this.addLoot({ kind: 'ammo', ammo, count: AMMO[ammo].pickup, x: s.x + 0.9, z: s.z + 0.4 });
    }
    for (const c of CHEST_SPOTS) this.addLoot({ kind: 'chest', x: c.x, z: c.z, rot: c.rot });
  }

  scatter(x, y, z, entries) {
    const n = entries.length;
    entries.forEach((e, i) => {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + this.rand();
      const r = n > 1 ? 0.9 + this.rand() * 0.5 : 0;
      const lx = x + Math.cos(a) * r;
      const lz = z + Math.sin(a) * r;
      this.addLoot({ ...e, x: lx, z: lz, y: groundAt(lx, lz, 0.2, y + 0.4, 0) });
    });
  }

  dropAll(p) {
    const drops = [];
    for (const g of p.slots) if (g) drops.push({ kind: 'weapon', ...g });
    for (const [ammo, count] of Object.entries(p.ammo)) if (count > 0) drops.push({ kind: 'ammo', ammo, count });
    for (const [item, count] of Object.entries(p.items)) if (count > 0) drops.push({ kind: 'item', item, count });
    if (p.tickets > 0) drops.push({ kind: 'tickets', count: p.tickets });
    p.slots = [null, null, null];
    p.ammo = emptyAmmo();
    p.items = emptyItems();
    p.tickets = 0;
    if (drops.length) this.scatter(p.x, p.y, p.z, drops);
  }

  // ---------------------------------------------------------------- commands

  command(id, cmd) {
    const p = this.players.get(id);
    if (!p || !cmd || this.phase === 'end') return;
    switch (cmd.c) {
      case 'land':
        // where a rider means to get off (bots use it to time their jump)
        if (p.state === 'bus') {
          const lim = PARK_EDGE - 4;
          p.target = { x: Math.max(-lim, Math.min(lim, +cmd.x || 0)), z: Math.max(-lim, Math.min(lim, +cmd.z || 0)) };
        }
        break;
      case 'jump':
        // the doors only open once the bus is inside the gates
        if (p.state === 'bus' && this.phase === 'live') this.leaveBus(p);
        break;
      case 'slot':
        if (p.state === 'alive' && cmd.i >= 0 && cmd.i < 3 && cmd.i !== p.cur) {
          p.cur = cmd.i | 0;
          p.reloadT = 0;
          p.use = null;
          p.atk = null;
          p.charge = 0;
          p.fireT = Math.max(p.fireT, 0.25);
        }
        break;
      case 'reload':
        if (p.state === 'alive') this.startReload(p);
        break;
      case 'use':
        if (p.state === 'alive') this.startUse(p, cmd.item);
        break;
      case 'slide':
        if (p.state === 'alive') this.slide(p);
        break;
      case 'dodge':
        if (p.state === 'alive') this.dodge(p, +cmd.fwd || 0, +cmd.side || 0);
        break;
      case 'interact':
        if (p.state === 'alive') this.interact(p, cmd.id);
        break;
      case 'buy':
        if (p.state === 'alive') this.buy(p, cmd.prize);
        break;
      case 'possess':
        if (p.state === 'ghost') this.possess(p);
        break;
      case 'release':
        if (p.state === 'ghost') this.release(p);
        break;
      case 'power':
        if (p.state === 'ghost') this.usePower(p, cmd);
        break;
      case 'say': {
        // quick chat: one of the fixed lines, not too often
        const line = cmd.line | 0;
        if (line < 0 || line >= CHAT_LINES.length || this.time - (p.saidAt ?? -99) < CHAT_GAP) break;
        p.saidAt = this.time;
        this.events.push({ e: 'say', id: p.id, line });
        break;
      }
      default:
    }
  }

  startReload(p) {
    const g = p.slots[p.cur];
    if (!g || p.reloadT > 0) return;
    const def = WEAPONS[g.w];
    if (!def.mag || g.mag >= def.mag || p.ammo[def.ammo] <= 0) return;
    p.reloadDur = def.reload * RARITIES[g.rarity].speed;
    p.reloadT = p.reloadDur;
    p.use = null;
    this.events.push({ e: 'reload', id: p.id, w: g.w });
  }

  startUse(p, item) {
    const def = ITEMS[item];
    if (!def || p.items[item] <= 0 || p.use) return;
    if (def.occult) {
      // occult tools are instant
      if (p.fireT > 0 || p.staggerT > 0) return;
      p.items[item]--;
      p.fireT = 0.5;
      p.atk = null;
      p.charge = 0;
      p.lastShot = this.time;
      if (def.throw) this.throwItem(p, item);
      else if (item === 'salt') {
        this.salts.push({ id: this.nextProj++, x: p.x, y: p.y, z: p.z, r: def.radius, t: def.dur, dur: def.dur });
        this.events.push({ e: 'salt', id: p.id, x: p.x, y: p.y, z: p.z, r: def.radius });
      } else if (item === 'relic') {
        p.wardT = def.dur;
        this.events.push({ e: 'relic', id: p.id });
      }
      return;
    }
    if (def.heal && p.hp >= def.cap) return;
    if (def.shield && p.shield >= MAX_SHIELD) return;
    p.use = { item, t: def.time, dur: def.time };
    p.reloadT = 0;
    p.atk = null;
    p.charge = 0;
    this.events.push({ e: 'use', id: p.id, item });
  }

  /** A quick dash with a moment of invulnerability to melee. Direction is relative to where you face. */
  dodge(p, fwd, side) {
    if (p.dodgeCd > 0 || p.staggerT > 0 || !p.onGround || p.stam < STAMINA.dodge * 0.5 || p.rootT > 0) return;
    if (Math.hypot(fwd, side) < 0.1) fwd = -1; // no direction: hop back
    const [wx, wz] = wishDir(fwd, side, p.yaw);
    p.dodgeX = wx;
    p.dodgeZ = wz;
    p.dodgeT = DODGE.time;
    p.iframeT = DODGE.iframes;
    p.dodgeCd = DODGE.time + DODGE.cd;
    this.spendStam(p, STAMINA.dodge);
    p.atk = null;
    p.charge = 0;
    p.use = null;
    p.slideT = 0;
    const dir = Math.abs(fwd) >= Math.abs(side) ? (fwd > 0 ? 'forward' : 'backward') : side > 0 ? 'right' : 'left';
    this.events.push({ e: 'dodge', id: p.id, dir });
  }

  /** Drop into a slide from a run (press again to get up early). */
  slide(p) {
    if (p.slideT > 0) {
      p.slideT = 0;
      return;
    }
    const v = Math.hypot(p.vx, p.vz);
    if (p.slideCd > 0 || !p.onGround || v < SLIDE.min || p.staggerT > 0 || p.dodgeT > 0 || p.knockT > 0 || p.rootT > 0) return;
    if (p.blocking || p.use || p.stam < SLIDE.stam * 0.5) return;
    p.slideX = p.vx / v;
    p.slideZ = p.vz / v;
    p.slideV = Math.min(SLIDE.max, v + SLIDE.boost);
    p.slideT = SLIDE.time;
    p.charge = 0;
    this.spendStam(p, SLIDE.stam);
    this.events.push({ e: 'slide', id: p.id });
  }

  spendStam(p, n) {
    p.stam = Math.max(0, p.stam - n);
    p.stamT = STAMINA.delay;
  }

  /** The loot or chest a survivor would interact with right now. */
  interactTarget(p) {
    let best = null;
    let bestD = 2.4;
    const [fx, , fz] = dirFromAngles(p.input.yaw, 0);
    for (const l of this.loot.values()) {
      const dx = l.x - p.x;
      const dz = l.z - p.z;
      if (Math.abs(l.y - p.y) > 1.6) continue;
      const d = Math.hypot(dx, dz);
      if (d > 2.4) continue;
      // prefer things in front of you
      const score = d - (d > 0.01 ? ((dx * fx + dz * fz) / d) * 0.6 : 0) - (l.kind === 'chest' ? 0.3 : 0);
      if (score < bestD) {
        bestD = score;
        best = l;
      }
    }
    return best;
  }

  /** Index of the prize counter a survivor is standing at, or -1. */
  boothNear(p) {
    return PRIZE_BOOTHS.findIndex((b) => Math.hypot(b.x - p.x, b.z - p.z) < BOOTH_REACH && Math.abs(p.y) < 1.5);
  }

  interact(p, lootId) {
    let l = lootId ? this.loot.get(lootId) : null;
    if (l && (Math.hypot(l.x - p.x, l.z - p.z) > 2.6 || Math.abs(l.y - p.y) > 1.6)) l = null;
    if (!l) l = this.interactTarget(p);
    if (!l) return;
    if (l.kind === 'chest') return this.openChest(p, l);
    if (l.kind === 'weapon') {
      this.equip(p, { w: l.w, rarity: l.rarity, dura: l.dura, mag: l.mag });
      this.removeLoot(l.id);
      return;
    }
    this.takeStack(p, l, true);
  }

  /** Put a weapon in a free slot, or swap it for the one in your hands. */
  equip(p, g) {
    const def = WEAPONS[g.w];
    const w = makeWeapon(g.w, g.rarity);
    if (g.dura !== undefined && def.type === 'melee') w.dura = g.dura;
    if (g.mag !== undefined && def.mag) w.mag = g.mag;
    let slot = p.slots.findIndex((s) => !s);
    if (slot < 0) {
      slot = p.cur;
      this.addLoot({ kind: 'weapon', ...p.slots[slot], x: p.x, z: p.z, y: p.y });
    }
    p.slots[slot] = w;
    if (!p.slots[p.cur] || slot === p.cur) p.cur = slot;
    p.reloadT = 0;
    p.atk = null;
    p.charge = 0;
    this.events.push({ e: 'pickup', id: p.id, label: weaponLabel(g.w, g.rarity), rarity: g.rarity });
  }

  /** Pick up ammo, tickets or items; returns true if anything was taken. */
  takeStack(p, l, loud) {
    if (l.kind === 'tickets') {
      p.tickets += l.count;
      this.removeLoot(l.id);
      this.events.push({ e: 'pickup', id: p.id, label: `🎟 ${l.count} tickets`, tickets: true });
      return true;
    }
    let room;
    let label;
    if (l.kind === 'ammo') {
      room = AMMO[l.ammo].max - p.ammo[l.ammo];
      label = AMMO[l.ammo].name;
    } else {
      room = ITEMS[l.item].max - p.items[l.item];
      label = ITEMS[l.item].name;
    }
    const take = Math.min(room, l.count);
    if (take <= 0) {
      if (loud) this.events.push({ e: 'full', id: p.id, label });
      return false;
    }
    if (l.kind === 'ammo') p.ammo[l.ammo] += take;
    else p.items[l.item] += take;
    l.count -= take;
    if (l.count <= 0) this.removeLoot(l.id);
    else this.lootVer++;
    this.events.push({ e: 'pickup', id: p.id, label: `${label} ×${take}` });
    return true;
  }

  openChest(p, chest) {
    this.removeLoot(chest.id);
    if (chest.cursed) {
      const owner = this.players.get(chest.owner);
      this.events.push({ e: 'boom', kind: 'cursed', x: chest.x, y: chest.y + 0.5, z: chest.z, r: POWERS.cursed.radius });
      this.blast(chest.x, chest.y, chest.z, POWERS.cursed.radius, POWERS.cursed.dmg, owner, 'cursed');
      return;
    }
    const w = rollWeapon(this.rand, true);
    const ammo = WEAPONS[w.w].ammo;
    const item = pick(this.rand, ['bandage', 'soda', 'soda', 'medkit', 'holy', 'flare', 'salt']);
    const drops = [{ kind: 'weapon', ...w }, { kind: 'item', item, count: ITEMS[item].pickup }];
    if (ammo) drops.push({ kind: 'ammo', ammo, count: AMMO[ammo].pickup * 2 });
    this.scatter(chest.x, chest.y, chest.z, drops);
    p.tickets += TICKETS.chest;
    this.events.push({ e: 'chest', id: p.id, x: chest.x, y: chest.y, z: chest.z, tickets: TICKETS.chest });
  }

  buy(p, id) {
    const prize = PRIZES.find((q) => q.id === id);
    if (!prize || this.boothNear(p) < 0) return;
    if (p.tickets < prize.cost) {
      this.events.push({ e: 'full', id: p.id, label: 'Not enough tickets' });
      return;
    }
    const g = prize.give;
    if (g.item && p.items[g.item] >= ITEMS[g.item].max) {
      this.events.push({ e: 'full', id: p.id, label: ITEMS[g.item].name });
      return;
    }
    p.tickets -= prize.cost;
    if (g.weapon) this.equip(p, { w: g.weapon, rarity: g.rarity });
    if (g.item) p.items[g.item] = Math.min(ITEMS[g.item].max, p.items[g.item] + g.count);
    if (g.ammo) p.ammo[g.ammo] = Math.min(AMMO[g.ammo].max, p.ammo[g.ammo] + g.count);
    this.events.push({ e: 'bought', id: p.id, label: prize.label });
  }

  // ---------------------------------------------------------------- damage

  damage(t, amount, by, how, head = false) {
    if (t.state !== 'alive' || amount <= 0 || this.phase === 'end') return;
    if ((t.protT > 0 || t.wardT > 0) && GHOST_HOWS.has(how)) return;
    // damage dealt counts what the blow actually took (a 999 finisher on someone with 10 left is 10)
    const took = Math.min(amount, t.hp + t.shield);
    const fromShield = Math.min(t.shield, amount);
    t.shield -= fromShield;
    t.hp -= amount - fromShield;
    if (by && by !== t) {
      t.lastHitBy = by.id;
      t.lastHitAt = this.time;
    }
    if (by && by !== t) by.dmg += took;
    this.events.push({
      e: 'hit', id: t.id, by: by ? by.id : null, amt: Math.round(amount), head, shield: fromShield > 0, how,
      fx: by ? by.x : null, fz: by ? by.z : null,
    });
    if (t.hp <= 0) this.kill(t, by && by !== t ? by : null, how);
  }

  blast(x, y, z, radius, dmg, by, how) {
    for (const b of BREAKABLES) {
      if (this.broken.has(b.id)) continue;
      const d = Math.hypot(b.x - x, b.h / 2 - y, b.z - z) - Math.min(b.w, b.d) / 2;
      if (d > radius) continue;
      const k = Math.max(d, 0.3);
      this.hitProp(b.id, dmg * 1.5 * (1 - Math.max(0, d) / radius * 0.5), by, (b.x - x) / k, (b.z - z) / k, 7);
    }
    for (const q of this.players.values()) {
      if (q.state !== 'alive') continue;
      const d = Math.hypot(q.x - x, q.y + 0.9 - y, q.z - z);
      if (d > radius) continue;
      this.damage(q, dmg * (1 - (d / radius) * 0.5), by, how);
      const k = 9 / Math.max(d, 0.6);
      q.vx += ((q.x - x) / Math.max(d, 0.1)) * k;
      q.vz += ((q.z - z) / Math.max(d, 0.1)) * k;
      q.vy = Math.max(q.vy, 6);
      q.onGround = false;
    }
  }

  kill(v, k, how) {
    v.hp = 0;
    v.deaths++;
    v.diedAt = this.time;
    v.use = null;
    v.reloadT = 0;
    this.lastDeath = v.id;
    const steal = !!k && k.state === 'ghost' && k.revivesUsed < MAX_REVIVES;
    const weapon = how === 'fists' || WEAPONS[how] ? how : null;
    if (k) {
      if (k.state === 'ghost') k.ghostKills++;
      else {
        k.kills++;
        // a bot that just won a fight takes a breather before looking for the next one
        if (k.brain) k.brain.wonAt = this.time;
      }
      k.tickets += TICKETS.kill;
    }
    if (steal) {
      this.release(k);
      Object.assign(k, {
        state: 'alive', x: v.x, y: v.y, z: v.z, vx: 0, vy: 0, vz: 0, onGround: v.onGround, yaw: v.yaw,
        hp: REVIVE_HP, shield: 0, slots: v.slots, cur: v.cur, ammo: v.ammo, items: v.items, tickets: k.tickets + v.tickets,
        reloadT: 0, use: null, rootT: 0, shakeT: 0, slowT: 0, revealT: 0, flashT: 0, protT: REVIVE_PROTECT,
        stam: STAMINA.max, atk: null, charge: 0, staggerT: 0, dodgeT: 0, slideT: 0, iframeT: 0, wardT: 0, burnT: 0, exposedT: 0,
      });
      k.revivesUsed++;
      k.revives++;
      v.slots = [null, null, null];
      v.ammo = emptyAmmo();
      v.items = emptyItems();
      v.tickets = 0;
    } else this.dropAll(v);
    Object.assign(v, {
      state: 'ghost', y: v.y + 1.2, vx: 0, vy: 0, vz: 0, ecto: ECTO_START, cds: {}, possess: null,
      flashT: 2, rootT: 0, shakeT: 0, slowT: 0, revealT: 0, shield: 0, protT: 0, riseT: GHOST_RISE,
      atk: null, charge: 0, blocking: false, blockAt: -9, staggerT: 0, dodgeT: 0, slideT: 0, iframeT: 0, wardT: 0, burnT: 0, exposedT: 0,
    });
    this.events.push({ e: 'kill', killer: k ? k.id : null, victim: v.id, how, weapon, steal });
    if (steal && this.finalT !== null) {
      this.finalT = FINAL_RIDE_RESET;
      this.events.push({ e: 'final', t: this.finalT, survivor: k.id });
    }
    this.checkFinal();
  }

  checkFinal() {
    if (this.phase !== 'live') return;
    const n = this.living();
    if (n === 0) {
      this.end(this.players.get(this.lastDeath));
      return;
    }
    if (n === 1 && this.finalT === null && this.players.size > 1) {
      this.finalT = FINAL_RIDE_SECONDS;
      const s = [...this.players.values()].find((p) => p.state !== 'ghost');
      this.events.push({ e: 'final', t: this.finalT, survivor: s.id });
    }
  }

  end(winner) {
    if (this.phase === 'end') return;
    this.phase = 'end';
    this.winner = winner ? winner.id : null;
    this.endT = END_SCREEN_SECONDS;
    this.events.push({ e: 'end', winner: this.winner });
  }

  /** Final standings: winner first, then by score. */
  standings() {
    const score = (p) => p.kills * 100 + p.ghostKills * 100 + p.revives * 60 + p.dmg * 0.2;
    return [...this.players.values()]
      .sort((a, b) => (b.id === this.winner) - (a.id === this.winner) || score(b) - score(a))
      .map((p, i) => ({
        place: i + 1, id: p.id, name: p.name, bot: p.bot, kills: p.kills, ghostKills: p.ghostKills,
        revives: p.revives, dmg: Math.round(p.dmg), state: p.state, alive: Math.round(p.aliveTime),
      }));
  }

  // ---------------------------------------------------------------- melee

  /** The enemy a swing should go for: the closest one near the crosshair and within lunge range. */
  meleeTarget(p, def) {
    const yaw = p.input.yaw;
    const [fx, , fz] = dirFromAngles(yaw, 0);
    let best = null;
    let bestScore = Infinity;
    for (const q of this.players.values()) {
      if (q === p || q.state !== 'alive') continue;
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > def.reach + ASSIST.extra || Math.abs(q.y - p.y) > 1.8) continue;
      const cos = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      if (cos < Math.cos(ASSIST.angle * DEG)) continue;
      if (!lineOfSight(p.x, p.y + 1.2, p.z, q.x, q.y + 1.2, q.z)) continue;
      const score = d + (1 - cos) * 4;
      if (score < bestScore) {
        bestScore = score;
        best = q;
      }
    }
    return best;
  }

  startSwing(p, heavy, power = 1) {
    const g = p.slots[p.cur];
    const def = weaponDef(g);
    const rar = RARITIES[g ? g.rarity : 0];
    // quick swings in a row chain into a combo; the third is a finisher
    p.combo = !heavy && this.time - (p.lastSwingEnd ?? -9) < COMBO.window ? (p.combo + 1) % 3 : 0;
    const finisher = !heavy && p.combo === 2 && !def.auto;
    const T = def.swing * rar.speed * (heavy ? HEAVY.slow : finisher ? 1.15 : 1);
    this.spendStam(p, def.stam * (heavy ? STAMINA.heavyMul : 1));
    // aim assist: turn toward the enemy near the crosshair and lunge in if they are just out of reach
    const t = this.meleeTarget(p, def);
    let yaw = p.input.yaw;
    if (t) {
      yaw = Math.atan2(-(t.x - p.x), -(t.z - p.z));
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      const gap = d - def.reach * 0.75;
      if (gap > 0.2 && p.onGround) {
        p.lungeT = 0.14;
        p.lungeSpeed = Math.min(ASSIST.lunge, gap) / 0.14;
        p.lungeX = (t.x - p.x) / d;
        p.lungeZ = (t.z - p.z) / d;
      }
    }
    p.atk = { heavy, finisher, power, t: 0, T, hit: false, yaw, stop: 0 };
    p.lastShot = this.time;
    p.use = null;
    this.events.push({ e: 'swing', id: p.id, w: g ? g.w : 'fists', heavy, combo: p.combo, T });
  }

  /** The swing connects: hit up to two survivors in front, within reach. */
  meleeHit(p) {
    const g = p.slots[p.cur];
    const def = weaponDef(g);
    const rar = RARITIES[g ? g.rarity : 0];
    const { heavy, finisher, power } = p.atk;
    const how = g ? g.w : 'fists';
    const [fx, , fz] = dirFromAngles(p.atk.yaw, 0);
    const hits = [];
    for (const q of this.players.values()) {
      if (q === p || q.state !== 'alive') continue;
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > def.reach + PLAYER_RADIUS + 0.35 || Math.abs(q.y - p.y) > 1.8) continue;
      const cos = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      // anyone touching you counts even if a little to the side
      const half = (d < 1.1 ? 85 : Math.max(def.arc, 80) / 2) * DEG;
      if (cos < Math.cos(half)) continue;
      if (!lineOfSight(p.x, p.y + 1.2, p.z, q.x, q.y + 1.2, q.z)) continue;
      hits.push({ q, d, dx, dz });
    }
    hits.sort((a, b) => a.d - b.d);
    let landed = false;
    let parried = false;
    // props in the arc take the blow too (heavier weapons and swings break them sooner)
    {
      const dmg = def.dmg * rar.dmg * (heavy ? def.heavy * (HEAVY.minMul + (1 - HEAVY.minMul) * power) : finisher ? COMBO.finisher : 1);
      for (const b of BREAKABLES) {
        if (this.broken.has(b.id)) continue;
        const dx = b.x - p.x;
        const dz = b.z - p.z;
        const d = Math.hypot(dx, dz);
        const size = Math.min(b.w, b.d) / 2;
        if (d > def.reach + size + 0.3 || p.y > b.h + 0.5) continue;
        const cos = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
        if (cos < Math.cos((d < size + 0.9 ? 80 : Math.max(def.arc, 70) / 2) * DEG)) continue;
        this.hitProp(b.id, dmg, p, dx / (d || 1), dz / (d || 1), heavy ? 5 : 3);
        landed = true;
      }
    }
    for (const { q, d, dx, dz } of hits.slice(0, 2)) {
      if (q.iframeT > 0) {
        this.events.push({ e: 'dodged', id: q.id, by: p.id });
        continue;
      }
      let dmg = def.dmg * rar.dmg * (heavy ? def.heavy * (HEAVY.minMul + (1 - HEAVY.minMul) * power) : finisher ? COMBO.finisher : 1);
      const nx = dx / (d || 1);
      const nz = dz / (d || 1);
      // blocking: the attacker has to be in front of you
      const [qfx, , qfz] = dirFromAngles(q.yaw, 0);
      const facing = -(nx * qfx + nz * qfz) > Math.cos((BLOCK.arc / 2) * DEG);
      let blocked = false;
      let broke = false;
      if (q.blocking && facing && this.time - q.blockAt <= PARRY.window) {
        // parried: the guard went up just in time; the blow glances off and the attacker is thrown open
        p.staggerT = Math.max(p.staggerT, PARRY.stagger);
        this.spendStam(p, PARRY.stam);
        p.vx = -nx * PARRY.push;
        p.vz = -nz * PARRY.push;
        p.knockT = IMPACT.slide;
        parried = true;
        this.events.push({ e: 'parry', id: q.id, by: p.id });
        landed = true;
        continue;
      }
      if (q.blocking && facing) {
        blocked = true;
        this.spendStam(q, dmg * STAMINA.blockPerDmg * (heavy ? 1.6 : 1));
        broke = q.stam <= 0 || heavy;
        if (broke) q.blocking = false;
        dmg *= broke ? 0.6 : BLOCK.light;
        this.events.push({ e: 'block', id: q.id, by: p.id, broke });
      }
      // knockback and stagger: a quick hit nudges, a finisher shoves, a heavy launches
      const kind = heavy ? IMPACT.heavy : finisher ? IMPACT.finisher : IMPACT.light;
      const push = (blocked && !broke ? 0.35 : 1) * kind.push * (def.shove && heavy ? 1.3 : 1) * (0.7 + def.knock / 10);
      q.vx = nx * push;
      q.vz = nz * push;
      q.slideT = 0;
      q.knockT = IMPACT.slide * (blocked && !broke ? 0.5 : 1) * (heavy ? 1.4 : 1);
      if (heavy && (!blocked || broke)) {
        q.vy = Math.max(q.vy, kind.hop);
        q.onGround = false;
      }
      // a big two-handed swing already under way rides through a light hit
      const qdef = weaponDef(q.slots[q.cur]);
      // (a heavy still being charged has no such protection: quick weapons can catch it)
      const poised = qdef.poise && !heavy && !blocked && q.atk && !q.atk.hit;
      if (poised) {
        q.vx *= 0.3;
        q.vz *= 0.3;
        q.knockT *= 0.3;
      } else if (!blocked || broke) {
        q.staggerT = Math.max(q.staggerT, kind.stagger * (broke ? 1.3 : 1));
        q.charge = 0;
        if (q.atk && !q.atk.hit) q.atk = null;
        q.use = null;
      }
      this.damage(q, dmg, p, how, false);
      landed = true;
    }
    if (parried) {
      p.atk = null;
      p.charge = 0;
      p.queued = false;
    } else if (landed) {
      // hit-stop: the swing hangs for a moment on impact
      p.atk.stop = heavy ? 0.09 : 0.05;
      if (g && g.dura !== undefined) {
        g.dura -= heavy ? 2 : 1;
        if (g.dura <= 0) {
          p.slots[p.cur] = null;
          this.events.push({ e: 'break', id: p.id, w: g.w });
        }
      }
    } else if (!parried) this.events.push({ e: 'whiff', id: p.id, w: how });
  }

  // ---------------------------------------------------------------- ranged

  /** Fire a projectile along the aim ray (passed by the client so it leaves along the crosshair). */
  fireProjectile(p, kind, speed, grav, extra = {}) {
    let ox = p.x;
    let oy = p.y + (p.slideT > 0 ? 1.0 : EYE_HEIGHT);
    let oz = p.z;
    const af = p.input.aimFrom;
    if (af && af.every(Number.isFinite) && Math.hypot(af[0] - ox, af[1] - oy, af[2] - oz) < 3.5 && lineOfSight(ox, oy, oz, af[0], af[1], af[2])) {
      [ox, oy, oz] = af;
    }
    let spread = (p.input.aim ? 0.4 : 1.6) * DEG;
    if (Math.hypot(p.vx, p.vz) > 1.5) spread *= 1.8;
    if (!p.onGround) spread *= 2;
    if (p.shakeT > 0) spread += 4 * DEG;
    const r = Math.sqrt(this.rand()) * spread;
    const a = this.rand() * Math.PI * 2;
    const [dx, dy, dz] = dirFromAngles(p.input.ayaw + Math.cos(a) * r, p.input.apitch + Math.sin(a) * r + (extra.lift || 0));
    const pr = {
      id: this.nextProj++, kind, owner: p.id, x: ox, y: oy, z: oz, vx: dx * speed, vy: dy * speed, vz: dz * speed, grav, t: 0, ...extra,
    };
    this.projs.push(pr);
    this.events.push({ e: 'fire', id: p.id, kind, o: [ox, oy, oz] });
    return pr;
  }

  shoot(p, g, draw = 1) {
    const def = WEAPONS[g.w];
    const rar = RARITIES[g.rarity];
    if (def.mag) g.mag--;
    else p.ammo[def.ammo]--;
    p.fireT = def.rof;
    p.lastShot = this.time;
    p.use = null;
    const k = def.draw ? 0.35 + 0.65 * draw : 1;
    this.fireProjectile(p, g.w, def.speed * (def.draw ? 0.5 + 0.5 * draw : 1), def.grav, {
      dmg: def.dmg * rar.dmg * k, head: def.head, blast: def.blast || 0, pull: def.pull || 0,
    });
  }

  throwItem(p, item) {
    this.fireProjectile(p, item, THROW.speed, THROW.grav, { lift: 0.12 });
  }

  /** Move projectiles; they hit the world or a survivor along the way. */
  updateProjectiles(dt) {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const pr = this.projs[i];
      pr.t += dt;
      pr.vy -= pr.grav * dt;
      const len = Math.hypot(pr.vx, pr.vy, pr.vz) * dt;
      const dx = (pr.vx * dt) / len;
      const dy = (pr.vy * dt) / len;
      const dz = (pr.vz * dt) / len;
      const w = rayWorld(pr.x, pr.y, pr.z, dx, dy, dz, len);
      let maxT = w ? w.t : len;
      let victim = null;
      let head = false;
      const occult = pr.kind === 'holy' || pr.kind === 'flare';
      if (!occult) {
        for (const q of this.players.values()) {
          if (q.state !== 'alive' || (q.id === pr.owner && pr.t < 0.25)) continue;
          if (Math.abs(q.x - pr.x) > maxT + 2 || Math.abs(q.z - pr.z) > maxT + 2) continue;
          const h = rayPlayer(pr.x, pr.y, pr.z, dx, dy, dz, q.x, q.y, q.z, maxT, q.slideT > 0);
          if (h) {
            maxT = h.t;
            victim = q;
            head = h.head;
          }
        }
      }
      pr.x += dx * maxT;
      pr.y += dy * maxT;
      pr.z += dz * maxT;
      const done = victim || w || pr.t > 6 || pr.y < -2;
      if (!done) continue;
      this.projs.splice(i, 1);
      this.impact(pr, victim, head, w);
    }
  }

  impact(pr, victim, head, w) {
    const owner = this.players.get(pr.owner) || null;
    const at = { x: pr.x, y: pr.y, z: pr.z };
    // a shot into a breakable prop
    if (!victim && w?.c?.brk != null && !pr.blast && pr.kind !== 'holy' && pr.kind !== 'flare') {
      const v = Math.hypot(pr.vx, pr.vz) || 1;
      this.hitProp(w.c.brk, pr.dmg || 10, owner, pr.vx / v, pr.vz / v, 2.5);
    }
    if (pr.kind === 'holy') {
      this.splash(at, owner);
      return;
    }
    if (pr.kind === 'flare') {
      const def = ITEMS.flare;
      const y = w && !w.ground ? pr.y : groundAt(pr.x, pr.z, 0.1, pr.y + 0.3, 0);
      this.flares.push({ id: pr.id, x: pr.x, y, z: pr.z, r: def.radius, t: def.dur, dur: def.dur });
      this.events.push({ e: 'flare', x: pr.x, y, z: pr.z });
      return;
    }
    if (pr.blast) {
      this.events.push({ e: 'boom', kind: 'firework', x: pr.x, y: pr.y, z: pr.z, r: pr.blast });
      this.blast(pr.x, pr.y, pr.z, pr.blast, pr.dmg, owner, pr.kind);
      return;
    }
    // arrows, bolts, darts and harpoons stick where they land
    this.events.push({ e: 'stick', kind: pr.kind, x: pr.x, y: pr.y, z: pr.z, vx: pr.vx, vy: pr.vy, vz: pr.vz, on: victim ? victim.id : null });
    if (!victim) return;
    if (pr.pull && owner) {
      // the harpoon yanks its victim toward the shooter
      const d = Math.hypot(owner.x - victim.x, owner.z - victim.z) || 1;
      victim.vx += ((owner.x - victim.x) / d) * pr.pull;
      victim.vz += ((owner.z - victim.z) / d) * pr.pull;
      victim.vy = Math.max(victim.vy, 3);
      victim.onGround = false;
    }
    this.damage(victim, pr.dmg * (head ? pr.head : 1), owner, pr.kind, head);
  }

  // ---------------------------------------------------------------- occult

  /** Where a ghost really is: a possessed ride carries it. */
  ghostSpot(g) {
    if (g.possess?.kind === 'car') {
      const c = this.cars[g.possess.car];
      return { x: c.x, y: c.y + 1, z: c.z };
    }
    if (g.possess?.kind === 'coaster') {
      const t = trackAt(this.coaster.s);
      return { x: t.x, y: t.y + 1, z: t.z };
    }
    if (g.possess?.kind === 'ferris') return { x: FERRIS.x, y: 2, z: FERRIS.z }; // the wheel's base
    return g;
  }

  splash(at, owner) {
    const def = ITEMS.holy;
    this.events.push({ e: 'splash', x: at.x, y: at.y, z: at.z, r: def.radius });
    for (const g of this.players.values()) {
      if (g.state !== 'ghost') continue;
      const s = this.ghostSpot(g);
      // possessed rides are big: holy water anywhere on them counts
      const r = def.radius + (g.possess ? (g.possess.kind === 'ferris' ? 10 : 2) : 0);
      if (Math.hypot(s.x - at.x, (s.y - at.y) * 0.6, s.z - at.z) > r) continue;
      this.burn(g, owner);
    }
  }

  burn(g, by) {
    const def = ITEMS.holy;
    if (g.burnT > 1) return;
    this.release(g);
    g.burnT = def.burn;
    g.ecto = Math.max(0, g.ecto - def.ecto);
    g.exposedT = Math.max(g.exposedT, def.burn);
    this.events.push({ e: 'burn', id: g.id, by: by ? by.id : null });
  }

  inSalt(x, y, z, pad = 0) {
    return this.salts.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + pad && Math.abs(y - s.y) < 6);
  }

  // ---------------------------------------------------------------- ghosts

  rideNear(p) {
    if (!this.ferris.driver && Math.hypot(p.x - FERRIS.x, p.z - FERRIS.z) < RIDES.ferris.reach) return { kind: 'ferris' };
    if (!this.coaster.running && Math.hypot(p.x - STATION.x, p.z - STATION.z) < RIDES.coaster.reach) {
      return { kind: 'coaster', ready: this.coaster.cd <= 0 };
    }
    let best = null;
    let bestD = RIDES.car.reach;
    this.cars.forEach((c, i) => {
      if (c.driver) return;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < bestD && p.y < c.y + 6) {
        bestD = d;
        best = { kind: 'car', car: i };
      }
    });
    return best;
  }

  possess(p) {
    if (p.possess || p.riseT > 0 || p.burnT > 0) return;
    const r = this.rideNear(p);
    if (!r) return;
    if (r.kind === 'ferris') {
      this.ferris.driver = p.id;
      p.possess = { kind: 'ferris' };
    } else if (r.kind === 'coaster') {
      if (!r.ready || p.ecto < RIDES.coaster.cost) return;
      p.ecto -= RIDES.coaster.cost;
      Object.assign(this.coaster, { running: true, driver: p.id, owner: p.id, dist: 0, v: 0 });
      this.coaster.hits.clear();
      p.possess = { kind: 'coaster' };
    } else {
      if (p.ecto < RIDES.car.cost) return;
      p.ecto -= RIDES.car.cost;
      const c = this.cars[r.car];
      c.driver = p.id;
      c.t = RIDES.car.dur;
      c.hits.clear();
      p.possess = { kind: 'car', car: r.car };
    }
    p.flashT = GHOST_FLASH;
    this.events.push({ e: 'possess', id: p.id, kind: r.kind });
  }

  release(p) {
    if (!p.possess) return;
    const k = p.possess.kind;
    if (k === 'ferris' && this.ferris.driver === p.id) this.ferris.driver = null;
    if (k === 'coaster' && this.coaster.driver === p.id) this.coaster.driver = null;
    if (k === 'car') {
      const c = this.cars[p.possess.car];
      if (c && c.driver === p.id) {
        c.driver = null;
        p.y = c.y + 2;
      }
    }
    p.possess = null;
    this.events.push({ e: 'release', id: p.id, kind: k });
  }

  spend(p, cost, cdKey, cd) {
    if (p.riseT > 0 || p.burnT > 0 || p.ecto < cost || (p.cds[cdKey] || 0) > 0) return false;
    p.ecto -= cost;
    p.cds[cdKey] = cd;
    p.flashT = GHOST_FLASH;
    return true;
  }

  usePower(p, cmd) {
    const x = +cmd.x;
    const z = +cmd.z;
    const hasPoint = Number.isFinite(x) && Number.isFinite(z);
    if (cmd.id === 'fling') {
      if (p.possess?.kind !== 'ferris' || !hasPoint) return;
      const R = RIDES.ferris;
      if (Math.hypot(x - FERRIS.x, z - FERRIS.z) > R.range || this.inSalt(x, 0, z, 1)) return;
      if (!this.spend(p, R.cost, 'fling', R.cd)) return;
      // the gondola currently at the bottom of the wheel is the one that flies
      const a = this.ferris.angle;
      const from = [FERRIS.x + Math.sin(a) * 4, FERRIS.hubY - FERRIS.r * 0.6, FERRIS.z];
      const y = groundAt(x, z, 0.5, 30, 0);
      this.gondolas.push({ from, to: [x, y, z], t: 0, T: R.warn, owner: p.id });
      this.events.push({ e: 'fling', id: p.id, from, to: [x, y, z], T: R.warn });
      return;
    }
    const def = POWERS[cmd.id];
    if (!def || p.possess) return;
    // a new ghost starts with the simple powers; the rest come with time spent haunting
    if ((p.ghostTime || 0) < (def.unlock || 0)) return;
    if (cmd.id === 'scare') {
      const t = this.players.get(cmd.target);
      if (!t || t.state !== 'alive') return;
      if (Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z) > def.range + 1 || this.inSalt(t.x, t.y, t.z)) return;
      if (!this.spend(p, def.cost, 'scare', def.cd)) return;
      t.revealT = def.reveal;
      t.shakeT = def.shake;
      t.slowT = def.shake;
      this.events.push({ e: 'scare', id: t.id, by: p.id });
      return;
    }
    if (!hasPoint) return;
    if (cmd.id !== 'storm' && Math.hypot(x - p.x, z - p.z) > def.range + 2) return;
    if (cmd.id === 'storm' && this.zone.state !== 'wait') return;
    if (cmd.id !== 'storm' && cmd.id !== 'blackout' && this.inSalt(x, +cmd.y || 0, z, 0.5)) return;
    if (!this.spend(p, def.cost, cmd.id, def.cd)) return;
    const y = groundAt(x, z, 0.3, Math.max(0.5, +cmd.y || 0) + 0.6, 0);
    if (cmd.id === 'trap') {
      const mine = this.traps.filter((t) => t.owner === p.id);
      if (mine.length >= def.max) this.traps.splice(this.traps.indexOf(mine[0]), 1);
      this.traps.push({ id: this.nextLoot++, x, y, z, owner: p.id, armed: 0.6 });
      this.events.push({ e: 'trapSet', id: p.id, x, y, z });
    } else if (cmd.id === 'cursed') {
      const mine = [...this.loot.values()].filter((l) => l.cursed && l.owner === p.id);
      if (mine.length >= def.max) this.removeLoot(mine[0].id);
      this.addLoot({ kind: 'chest', cursed: true, owner: p.id, x, y, z, rot: this.rand() * Math.PI * 2 });
    } else if (cmd.id === 'steps') {
      const a = this.rand() * Math.PI * 2;
      this.steps.push({ x, y, z, dx: Math.cos(a), dz: Math.sin(a), t: def.dur, owner: p.id, k: 0 });
      this.events.push({ e: 'steps', x, y, z });
    } else if (cmd.id === 'blackout') {
      this.blackouts.push({ x, z, r: def.radius, t: def.dur, dur: def.dur });
      this.events.push({ e: 'blackout', x, z, r: def.radius });
    } else if (cmd.id === 'storm') {
      this.pullStorm(x, z, def.shift);
      this.events.push({ e: 'storm', x, z, id: p.id });
    }
  }

  // ---------------------------------------------------------------- zone

  clampNext() {
    const zn = this.zone;
    const lim = Math.max(0, PARK_EDGE - 10 - zn.nr * 0.7);
    zn.nx = Math.max(-lim, Math.min(lim, zn.nx));
    zn.nz = Math.max(-lim, Math.min(lim, zn.nz));
    const maxOff = Math.max(0, zn.r - zn.nr);
    const dx = zn.nx - zn.cx;
    const dz = zn.nz - zn.cz;
    const d = Math.hypot(dx, dz);
    if (d > maxOff) {
      zn.nx = zn.cx + (dx / d) * maxOff;
      zn.nz = zn.cz + (dz / d) * maxOff;
    }
  }

  planZone() {
    const zn = this.zone;
    const ph = ZONE_PHASES[zn.idx];
    zn.nr = ph.r;
    const a = this.rand() * Math.PI * 2;
    const off = this.rand() * Math.max(0, zn.r - zn.nr) * 0.8;
    zn.nx = zn.cx + Math.cos(a) * off;
    zn.nz = zn.cz + Math.sin(a) * off;
    this.clampNext();
    zn.state = 'wait';
    zn.t = ph.wait;
  }

  pullStorm(x, z, shift) {
    // the storm moves toward the spot, so the safe circle slides away from it
    const zn = this.zone;
    let dx = zn.nx - x;
    let dz = zn.nz - z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    zn.nx += dx * shift;
    zn.nz += dz * shift;
    this.clampNext();
  }

  updateZone(dt) {
    const zn = this.zone;
    if (zn.state === 'idle' || zn.state === 'done') return;
    zn.t -= dt;
    if (zn.state === 'wait' && zn.t <= 0) {
      zn.state = 'shrink';
      zn.sx = zn.cx;
      zn.sz = zn.cz;
      zn.sr = zn.r;
      zn.t = ZONE_PHASES[zn.idx].shrink;
      this.events.push({ e: 'zone', state: 'shrink' });
    } else if (zn.state === 'shrink') {
      const T = ZONE_PHASES[zn.idx].shrink;
      const u = Math.min(1, 1 - zn.t / T);
      zn.cx = zn.sx + (zn.nx - zn.sx) * u;
      zn.cz = zn.sz + (zn.nz - zn.sz) * u;
      zn.r = zn.sr + (zn.nr - zn.sr) * u;
      if (zn.t <= 0) {
        if (zn.idx + 1 < ZONE_PHASES.length) {
          zn.idx++;
          this.planZone();
          this.events.push({ e: 'zone', state: 'wait' });
        } else zn.state = 'done';
      }
    }
  }

  zoneDps() {
    const zn = this.zone;
    if (zn.state === 'idle') return 0;
    return ZONE_PHASES[zn.state === 'wait' && zn.idx > 0 ? zn.idx - 1 : zn.idx].dps;
  }

  // ---------------------------------------------------------------- tick

  update(dt) {
    this.time += dt;
    // time spent as a ghost (over the whole ride): the stronger powers unlock with it (POWERS[...].unlock)
    for (const p of this.players.values()) if (p.state === 'ghost') p.ghostTime = (p.ghostTime || 0) + dt;
    if (this.phase === 'end') {
      this.endT -= dt;
      this.updateRides(dt);
      for (const p of this.players.values()) {
        if (p.queue) this.feed(p, dt, p.state === 'ghost');
        else if (p.state === 'ghost') this.updateGhost(p, dt);
      }
      return;
    }
    if (this.phase === 'launch') {
      // the intro: the bus rolls up the road and reaches the gate as the countdown ends
      this.launchIn -= dt;
      this.bus.s = BUS_ROUTE.gateS * Math.min(1, 1 - this.launchIn / LAUNCH_SECONDS);
      this.bus.v = BUS_ROUTE.gateS / LAUNCH_SECONDS;
      this.placeBus();
      for (const p of this.players.values()) {
        if (p.bot) updateBot(this, p, dt);
        if (p.queue) this.feed(p, dt, false);
        if (p.state === 'bus') this.rideBus(p);
      }
      if (this.launchIn <= 0) this.startLive();
      return;
    }
    for (const p of this.players.values()) if (p.bot) updateBot(this, p, dt);
    this.updateBus(dt);
    for (const p of this.players.values()) {
      if (p.queue) this.feed(p, dt, true);
      else this.stepPlayer(p, dt);
    }
    this.collideBodies(dt);
    this.updateRides(dt);
    this.updateHazards(dt);
    if (this.zone.state === 'idle' && this.time >= this.zoneStartAt) {
      this.zone.idx = 0;
      this.planZone();
    }
    this.updateZone(dt);
    if (this.finalT !== null && this.phase === 'live') {
      this.finalT -= dt;
      if (this.finalT <= 0) {
        const s = [...this.players.values()].find((p) => p.state !== 'ghost');
        this.end(s);
      }
    }
  }

  stepPlayer(p, dt) {
    if (p.state === 'bus') this.rideBus(p);
    else if (p.state === 'alive') this.updateLiving(p, dt);
    else this.updateGhost(p, dt);
  }

  /**
   * Online riders send numbered inputs. Each one moves the rider exactly one step, the same step their browser
   * already predicted, so the two agree. A late input means a tick standing still and two steps on the next;
   * a credit that grows by one a tick keeps anyone from moving faster than the clock.
   */
  feed(p, dt, move) {
    const q = p.queue;
    p.credit = Math.min(8, (p.credit ?? 3) + 1);
    let n = q.length > 3 ? 2 : q.length ? 1 : 0;
    // too far behind (a stall, a burst): skip the stale movement, keep the commands
    while (q.length > 12) {
      const old = q.shift();
      for (const c of old.cmds) this.command(p.id, c);
      p.ack = old.seq;
    }
    if (!n) {
      // nothing from them for a while (a hidden tab, a dropped line): let go of everything and carry on
      if (++p.starved > 20) {
        if (p.starved === 21) this.setInput(p.id, { yaw: p.input.yaw, pitch: p.input.pitch });
        if (move) this.stepPlayer(p, dt);
      }
      return;
    }
    p.starved = 0;
    for (; n > 0 && p.credit >= 1 && q.length; n--) {
      const it = q.shift();
      for (const c of it.cmds) this.command(p.id, c);
      this.setInput(p.id, it.input);
      p.ack = it.seq;
      p.credit--;
      if (move) this.stepPlayer(p, dt);
    }
  }

  startLive() {
    this.phase = 'live';
    this.zone.state = 'idle';
    this.zoneStartAt = this.time + 20;
    this.events.push({ e: 'live' });
  }

  placeBus() {
    const b = busAt(this.bus.s);
    const ahead = busAt(this.bus.s + 4);
    this.bus.x = b.x;
    this.bus.z = b.z;
    this.bus.dx = ahead.x - b.x;
    this.bus.dz = ahead.z - b.z;
    const l = Math.hypot(this.bus.dx, this.bus.dz) || 1;
    this.bus.dx /= l;
    this.bus.dz /= l;
    this.bus.yaw = Math.atan2(-this.bus.dx, -this.bus.dz);
  }

  /** Inside the park the bus keeps driving; at the end of the route everyone still aboard is put off. */
  updateBus(dt) {
    const b = this.bus;
    if (b.s >= BUS_ROUTE.len) {
      b.v = 0;
      for (const p of this.players.values()) if (p.state === 'bus') this.leaveBus(p);
      return;
    }
    b.v = BUS_SPEED * Math.min(1, (BUS_ROUTE.len - b.s) / 15 + 0.15);
    b.s = Math.min(BUS_ROUTE.len, b.s + b.v * dt);
    this.placeBus();
  }

  rideBus(p) {
    const b = this.bus;
    p.x = b.x;
    p.y = 1.4;
    p.z = b.z;
    p.vx = b.dx * b.v;
    p.vz = b.dz * b.v;
    p.vy = 0;
    p.yaw = p.input.yaw;
    p.pitch = p.input.pitch;
  }

  /** Step off through the side door, keeping some of the bus's speed. */
  leaveBus(p) {
    const b = this.bus;
    const side = this.rand() < 0.5 ? -1 : 1;
    p.state = 'alive';
    p.x = b.x - b.dz * 2.1 * side - b.dx * (this.rand() * 6 - 3);
    p.z = b.z + b.dx * 2.1 * side - b.dz * (this.rand() * 6 - 3);
    p.y = 0.6;
    p.vx = b.dx * b.v * 0.45 - b.dz * side * 2;
    p.vz = b.dz * b.v * 0.45 + b.dx * side * 2;
    p.vy = 3.5;
    p.onGround = false;
    p.landedAt = this.time;
    this.events.push({ e: 'busJump', id: p.id, x: p.x, z: p.z });
  }

  updateLiving(p, dt) {
    const i = p.input;
    if (this.phase === 'live') p.aliveTime += dt;
    p.pitch = i.pitch;
    p.rootT = Math.max(0, p.rootT - dt);
    p.shakeT = Math.max(0, p.shakeT - dt);
    p.slowT = Math.max(0, p.slowT - dt);
    p.revealT = Math.max(0, p.revealT - dt);
    p.protT = Math.max(0, p.protT - dt);
    p.wardT = Math.max(0, p.wardT - dt);
    p.staggerT = Math.max(0, p.staggerT - dt);
    p.dodgeT = Math.max(0, p.dodgeT - dt);
    p.dodgeCd = Math.max(0, p.dodgeCd - dt);
    p.slideCd = Math.max(0, p.slideCd - dt);
    p.iframeT = Math.max(0, p.iframeT - dt);
    p.fireT -= dt;

    const g = p.slots[p.cur];
    const def = weaponDef(g);
    const melee = def.type === 'melee';
    const free = p.staggerT <= 0 && p.dodgeT <= 0 && !p.use;

    // stamina comes back after a short pause, slower while blocking
    if (p.stamT > 0) p.stamT -= dt;
    else p.stam = Math.min(STAMINA.max, p.stam + STAMINA.regen * (p.blocking ? 0.35 : 1) * dt);

    // block with the right button while holding a melee weapon (or fists)
    const wasBlocking = p.blocking;
    p.blocking = melee && i.aim && free && !p.atk && p.charge <= 0 && p.onGround && p.stam > 0;
    // when the guard went up (for parries); it only counts if it had been down a moment first
    if (p.blocking && !wasBlocking) p.blockAt = this.time - (p.blockEndAt ?? -9) > PARRY.rearm ? this.time : -9;
    else if (!p.blocking && wasBlocking) p.blockEndAt = this.time;

    // movement
    const busy = p.atk || p.charge > 0 || p.blocking;
    // Fighting or aiming: face the camera and strafe. Otherwise the body turns toward where it runs.
    p.combat = !!(busy || i.aim || i.fire || p.use || this.time - p.lastShot < 1.2);
    const [mx, mz] = wishDir(i.fwd, i.side, i.yaw);
    const moving = Math.hypot(mx, mz) > 0.1;
    if (p.atk) p.yaw = p.atk.yaw; // aim assist may have turned the swing toward an enemy
    else if (p.slideT > 0) p.yaw += Math.max(-20 * dt, Math.min(20 * dt, angleDiff(p.yaw, Math.atan2(-p.slideX, -p.slideZ))));
    else if (p.combat) p.yaw += Math.max(-16 * dt, Math.min(16 * dt, angleDiff(p.yaw, i.yaw)));
    else if (Math.hypot(p.vx, p.vz) > 0.5 && p.dodgeT <= 0 && p.knockT <= 0) {
      // the body follows the way it is actually moving (it carves round, it does not snap)
      p.yaw += Math.max(-18 * dt, Math.min(18 * dt, angleDiff(p.yaw, Math.atan2(-p.vx, -p.vz))));
    } else if (moving) p.yaw += Math.max(-14 * dt, Math.min(14 * dt, angleDiff(p.yaw, Math.atan2(-mx, -mz))));
    p.sprint = i.sprint && moving && !p.combat && p.slideT <= 0;
    let speed = i.aim ? AIM_SPEED : p.sprint ? SPRINT_SPEED : p.combat ? COMBAT_SPEED : RUN_SPEED;
    if (p.blocking) speed = RUN_SPEED * BLOCK.speed;
    else if (p.atk) speed *= 0.35;
    else if (busy) speed *= 0.6;
    if (p.slowT > 0) speed *= 0.75;
    if (p.use) speed *= 0.5;
    if (p.staggerT > 0) speed *= 0.4;
    const rooted = p.rootT > 0;
    if (p.slideT > 0) {
      // sliding: momentum carries you, the stick only bends the line, friction slows you down
      p.slideT -= dt;
      if (moving) {
        const cur = Math.atan2(p.slideX, p.slideZ);
        const a = cur + Math.max(-SLIDE.steer * dt, Math.min(SLIDE.steer * dt, angleDiff(cur, Math.atan2(mx, mz))));
        p.slideX = Math.sin(a);
        p.slideZ = Math.cos(a);
      }
      p.slideV -= SLIDE.friction * dt;
      const bx = p.x;
      const bz = p.z;
      // jumping out of a slide keeps the speed
      stepWalker(p, p.slideX, p.slideZ, p.slideV, i.jump && !rooted, dt, false, 400);
      const moved = Math.hypot(p.x - bx, p.z - bz);
      if (p.slideV < SLIDE.end || !p.onGround || moved < p.slideV * dt * 0.4) p.slideT = 0;
      if (p.slideT <= 0) p.slideCd = SLIDE.cd;
    } else if (p.dodgeT > 0) stepWalker(p, p.dodgeX, p.dodgeZ, DODGE.speed, false, dt);
    else if (p.lungeT > 0) {
      p.lungeT -= dt;
      stepWalker(p, p.lungeX, p.lungeZ, p.lungeSpeed, false, dt);
    } else if (p.knockT > 0) {
      // knocked back: slide out with little control
      p.knockT -= dt;
      const vx = p.vx;
      const vz = p.vz;
      const ex = p.x + vx * dt;
      const ez = p.z + vz * dt;
      stepWalker(p, 0, 0, 0, false, dt, false, p.tumbleT > 0 ? 4 : 16);
      // a rider sent tumbling bounces off the wall they hit instead of stopping dead against it
      const bx = p.x - ex;
      const bz = p.z - ez;
      const bl = Math.hypot(bx, bz);
      if (p.tumbleT > 0 && bl > 0.02 && Math.hypot(vx, vz) > 5) {
        const nx = bx / bl;
        const nz = bz / bl;
        const vn = vx * nx + vz * nz;
        if (vn < 0) {
          p.vx = (vx - 2 * vn * nx) * 0.5;
          p.vz = (vz - 2 * vn * nz) * 0.5;
          this.events.push({ e: 'wallhit', id: p.id, x: p.x, y: p.y + 1, z: p.z });
          // (the wall's damage goes to whoever sent them flying)
          this.damage(p, Math.min(8, -vn * 0.7), this.players.get(p.tumbleBy) || null, 'car');
        }
      }
    } else {
      const [wx, wz] = rooted ? [0, 0] : wishDir(i.fwd, i.side, i.yaw);
      stepWalker(p, wx, wz, speed, i.jump && !rooted && !busy, dt, false, 0, !p.combat);
    }

    // healing
    if (p.use) {
      p.use.t -= dt;
      if (p.use.t <= 0) {
        const it = ITEMS[p.use.item];
        if (p.items[p.use.item] > 0) {
          p.items[p.use.item]--;
          if (it.heal) p.hp = Math.min(it.cap, p.hp + it.heal);
          if (it.shield) p.shield = Math.min(MAX_SHIELD, p.shield + it.shield);
          this.events.push({ e: 'healed', id: p.id, item: p.use.item });
        }
        p.use = null;
      }
    }

    // a swing in progress lands partway through
    if (p.atk) {
      if (p.atk.stop > 0) p.atk.stop -= dt;
      else p.atk.t += dt;
      if (!p.atk.hit && p.atk.t >= p.atk.T * def.hitAt) {
        p.atk.hit = true;
        this.meleeHit(p);
      }
      if (p.atk && p.atk.t >= p.atk.T) {
        const light = !p.atk.heavy;
        p.atk = null;
        p.lastSwingEnd = this.time;
        // still holding the button after a quick swing: wind up a heavy one
        if (light && i.fire && melee && !def.auto && !p.queued) p.charge = 0.001;
      }
    }

    if (melee) {
      const pressed = i.fire && !p.prevFire;
      if (def.auto) {
        // the chainsaw cuts for as long as you hold it
        if (i.fire && free && !p.atk && !p.blocking && p.stam > 0) this.startSwing(p, false);
      } else {
        // a click swings at once; a click late in a swing queues the next combo hit
        if (pressed && p.atk && p.atk.t > p.atk.T * 0.3) p.queued = true;
        if (!free) {
          p.charge = 0;
          p.queued = false;
        } else if (!p.atk && !p.blocking) {
          if (p.charge > 0) {
            if (i.fire && p.stam > 0) {
              p.charge += dt;
              if (p.charge >= HEAVY.fullT + 0.8) {
                p.charge = 0;
                this.startSwing(p, true, 1);
              }
            } else {
              const t = p.charge;
              p.charge = 0;
              if (t >= HEAVY.minT) this.startSwing(p, true, Math.min(1, t / HEAVY.fullT));
            }
          } else if ((pressed || p.queued) && p.stam > 0) {
            p.queued = false;
            this.startSwing(p, false);
          }
        }
      }
    } else {
      // ranged
      if (p.reloadT > 0) {
        p.reloadT -= dt;
        if (p.reloadT <= 0 && g) {
          const take = Math.min(def.mag - g.mag, p.ammo[def.ammo]);
          g.mag += take;
          p.ammo[def.ammo] -= take;
          p.reloadT = 0;
        }
      }
      const loaded = def.mag ? g.mag > 0 : p.ammo[def.ammo] > 0;
      if (def.draw) {
        // draw the bow while the button is held, loose on release
        if (i.fire && loaded && free && p.fireT <= 0) p.charge = Math.min(def.draw * RARITIES[g.rarity].speed, p.charge + dt);
        else if (!i.fire && p.charge > 0) {
          const draw = p.charge / (def.draw * RARITIES[g.rarity].speed);
          p.charge = 0;
          if (draw > 0.18 && loaded && free) this.shoot(p, g, draw);
        } else if (!free) p.charge = 0;
      } else if (i.fire && !p.prevFire && free && p.fireT <= 0 && p.reloadT <= 0) {
        if (loaded) this.shoot(p, g);
        else this.startReload(p);
      }
      if (def.mag && g.mag <= 0 && p.reloadT <= 0 && p.fireT <= -0.15 && p.ammo[def.ammo] > 0) this.startReload(p);
    }
    p.prevFire = i.fire;

    // auto pickup of ammo, tickets and items
    for (const l of this.loot.values()) {
      if (l.kind !== 'ammo' && l.kind !== 'item' && l.kind !== 'tickets') continue;
      if (Math.abs(l.x - p.x) > 1.5 || Math.abs(l.z - p.z) > 1.5 || Math.abs(l.y - p.y) > 1.2) continue;
      this.takeStack(p, l, false);
    }

    // storm
    const zn = this.zone;
    if (Math.hypot(p.x - zn.cx, p.z - zn.cz) > zn.r) this.damage(p, this.zoneDps() * dt, null, 'storm');
  }

  updateGhost(p, dt) {
    const i = p.input;
    p.yaw = i.yaw;
    p.pitch = i.pitch;
    p.burnT = Math.max(0, p.burnT - dt);
    p.exposedT = Math.max(0, p.exposedT - dt);
    // a burning or exposed ghost cannot gather ectoplasm
    if (p.burnT <= 0 && p.exposedT <= 0) p.ecto = Math.min(ECTO_MAX, p.ecto + ECTO_REGEN * dt);
    p.flashT = Math.max(0, p.flashT - dt);
    p.riseT = Math.max(0, p.riseT - dt);
    for (const k in p.cds) p.cds[k] = Math.max(0, p.cds[k] - dt);
    const pos = p.possess;
    if (pos?.kind === 'car') {
      const c = this.cars[pos.car];
      const [wx, wz] = wishDir(i.fwd, i.side, i.yaw);
      stepCar(c, wx, wz, RIDES.car.speed, dt);
      this.keepOutOfSalt(c, 1.4);
      p.x = c.x;
      p.y = c.y + 1.1;
      p.z = c.z;
      c.t -= dt;
      if (c.t <= 0) this.release(p);
      return;
    }
    if (pos?.kind === 'coaster') {
      const t = trackAt(this.coaster.s);
      p.x = t.x;
      p.y = t.y + 1.2;
      p.z = t.z;
      return;
    }
    if (pos?.kind === 'ferris') {
      // hover by the hub while aiming flings
      const dx = p.x - FERRIS.x;
      const dz = p.z - FERRIS.z;
      if (Math.hypot(dx, dz) > RIDES.ferris.reach) {
        this.release(p);
        return;
      }
      if (i.fire && i.aimAt && !p.prevFire) this.usePower(p, { id: 'fling', x: i.aimAt[0], z: i.aimAt[2] });
      p.prevFire = i.fire;
    }
    const [wx, wz] = wishDir(i.fwd, i.side, i.yaw);
    stepGhost(p, wx, i.up, wz, (i.fast ? GHOST_FAST : GHOST_SPEED) * (p.burnT > 0 ? 0.6 : 1), dt);
    this.keepOutOfSalt(p);
  }

  /** Salt circles push ghosts (and the rides they drive) back out. */
  keepOutOfSalt(b, pad = 0.6) {
    for (const s of this.salts) {
      const dx = b.x - s.x;
      const dz = b.z - s.z;
      const d = Math.hypot(dx, dz);
      const r = s.r + pad;
      if (d >= r || Math.abs(b.y - s.y) > 6) continue;
      if (d > 0.01) {
        b.x = s.x + (dx / d) * r;
        b.z = s.z + (dz / d) * r;
      } else b.x = s.x + r;
    }
  }

  /**
   * Bodies are solid: living riders push each other apart and a sprint into someone is a shoulder check (they're
   * shoved and staggered for a moment, no damage); bumper cars are solid to riders, and a parked one can be nudged.
   */
  collideBodies(dt) {
    const alive = [];
    for (const p of this.players.values()) {
      if (p.state === 'alive') alive.push(p);
      p.shoveCd = Math.max(0, (p.shoveCd || 0) - dt);
      p.tumbleT = Math.max(0, (p.tumbleT || 0) - dt);
    }
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const hit = bodyContact(alive[i], alive[j], true);
        if (hit && !hit.by.shoveCd) this.shove(hit);
      }
    }
    for (const p of alive) for (const c of this.cars) if (!c.driver || Math.hypot(c.vx, c.vz) < 4) carContact(p, c, true);
  }

  /** A shoulder check: the one run into stumbles away, the one who ran in loses most of their speed. */
  shove({ by, to, nx, nz, speed }) {
    by.shoveCd = 0.6;
    by.vx *= 0.45;
    by.vz *= 0.45;
    if (to.iframeT > 0 || to.dodgeT > 0) return;
    const k = Math.min(9, speed * 0.9 + 2);
    to.vx = nx * k + to.vx * 0.3;
    to.vz = nz * k + to.vz * 0.3;
    to.vy = Math.max(to.vy, 2.2);
    to.onGround = false;
    to.knockT = Math.max(to.knockT, 0.3);
    to.staggerT = Math.max(to.staggerT, 0.4);
    to.charge = 0;
    to.blocking = false;
    this.events.push({ e: 'shove', id: to.id, by: by.id, x: to.x, y: to.y + 1, z: to.z });
  }

  /** Damage a breakable prop; it breaks at 0. dx, dz: which way the blow went; force: how hard the pieces fly. */
  hitProp(id, amount, by, dx, dz, force) {
    if (this.broken.has(id) || this.phase === 'end') return;
    this.propHp[id] -= amount;
    if (this.propHp[id] <= 0) this.breakProp(id, dx, dz, force, by);
    else {
      const b = BREAKABLES[id];
      this.events.push({ e: 'prophit', id, x: b.x, z: b.z });
    }
  }

  /** A prop breaks: it stops blocking, the pieces fly (src/debris.js), and some leave something behind. */
  breakProp(id, dx, dz, force, by = null) {
    if (this.broken.has(id)) return;
    const b = BREAKABLES[id];
    this.broken.add(id);
    b.col.off = true;
    this.events.push({ e: 'propbreak', id, x: b.x, z: b.z, dx: +dx.toFixed(2), dz: +dz.toFixed(2), f: +force.toFixed(1), by: by ? by.id : null });
    if (this.rand() < BREAKABLE_MODELS[b.model].loot) {
      const roll = this.rand();
      const item = pick(this.rand, ['bandage', 'bandage', 'soda', 'soda', 'flare', 'salt']);
      const drop = roll < 0.25 ? { kind: 'tickets', count: 3 + Math.floor(this.rand() * 4) } : { kind: 'item', item, count: ITEMS[item].pickup };
      this.scatter(b.x, 0, b.z, [drop]);
    }
  }

  updateRides(dt) {
    const f = this.ferris;
    f.angle += (f.driver ? 0.28 : 0.05) * dt;

    // coaster
    const c = this.coaster;
    c.cd = Math.max(0, c.cd - dt);
    if (c.running) {
      const total = TRACK.len * RIDES.coaster.laps;
      const left = total - c.dist;
      const vmax = RIDES.coaster.speed;
      if (left < 40) c.v = Math.max(4, Math.min(c.v, vmax * (left / 40)));
      else c.v = Math.min(vmax, c.v + 14 * dt);
      c.dist += c.v * dt;
      c.s = c.dist % TRACK.len;
      const owner = this.players.get(c.owner);
      for (let k = 0; k < 4; k++) {
        const t = trackAt(c.s - k * 2.6);
        for (const q of this.players.values()) {
          if (q.state !== 'alive') continue;
          if (Math.abs(q.x - t.x) > 2.4 || Math.abs(q.z - t.z) > 2.4) continue;
          if (Math.hypot(q.x - t.x, q.y + 0.9 - (t.y + 0.7), q.z - t.z) > 2.1) continue;
          if ((c.hits.get(q.id) || -9) > this.time - 1) continue;
          c.hits.set(q.id, this.time);
          q.vx += t.tx * 18;
          q.vz += t.tz * 18;
          q.vy = 9;
          q.onGround = false;
          this.damage(q, RIDES.coaster.dmg, owner, 'coaster');
        }
      }
      if (c.dist >= total) {
        c.running = false;
        c.v = 0;
        c.s = 0;
        c.cd = RIDES.coaster.cd;
        const d = this.players.get(c.driver);
        if (d && d.possess?.kind === 'coaster') {
          this.release(d);
          d.x = STATION.x;
          d.z = STATION.z;
        }
        c.driver = null;
      }
    }

    // empty cars roll on when knocked (and slow to a stop); every car bangs off every other
    for (const car of this.cars) {
      if (!car.driver && (Math.hypot(car.vx, car.vz) > 0.05 || car.spin)) stepCar(car, 0, 0, 0, dt);
    }
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i];
        const b = this.cars[j];
        const hard = carsCollide(a, b);
        if (hard > 2 && (a.bumpAt ?? -9) < this.time - 0.25) {
          a.bumpAt = this.time;
          this.events.push({ e: 'carbump', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, hard: Math.min(1, hard / 14) });
        }
      }
    }
    // a bumper car at speed smashes straight through props
    for (const car of this.cars) {
      const sp = Math.hypot(car.vx, car.vz);
      if (sp < 4) continue;
      for (const b of BREAKABLES) {
        if (this.broken.has(b.id) || Math.abs(car.y - 0) > 2) continue;
        const d = Math.hypot(b.x - car.x, b.z - car.z);
        if (d > CAR_RADIUS + Math.min(b.w, b.d) / 2 + 0.3) continue;
        this.breakProp(b.id, car.vx / sp, car.vz / sp, sp * 0.8, this.players.get(car.driver) || null);
      }
    }
    // bumper cars ram survivors
    for (const car of this.cars) {
      if (!car.driver) continue;
      const speed = Math.hypot(car.vx, car.vz);
      if (speed < 4) continue;
      const owner = this.players.get(car.driver);
      for (const q of this.players.values()) {
        if (q.state !== 'alive') continue;
        const d = Math.hypot(q.x - car.x, q.z - car.z);
        if (d > CAR_RADIUS + PLAYER_RADIUS + 0.25 || Math.abs(q.y - car.y) > 1.4) continue;
        if ((car.hits.get(q.id) || -9) > this.time - 0.8) continue;
        car.hits.set(q.id, this.time);
        const nx = (q.x - car.x) / (d || 1);
        const nz = (q.z - car.z) / (d || 1);
        // sent tumbling: up and away, spinning, bouncing off whatever wall they meet (updateLiving)
        q.vx += nx * 11 + car.vx * 0.6;
        q.vz += nz * 11 + car.vz * 0.6;
        q.vy = 7.5;
        q.onGround = false;
        q.knockT = Math.max(q.knockT, 0.9);
        q.tumbleT = 1.1;
        q.tumbleBy = car.driver;
        q.atk = null;
        car.vx *= 0.5;
        car.vz *= 0.5;
        this.events.push({ e: 'bump', x: car.x, z: car.z });
        this.damage(q, RIDES.car.dmg * Math.min(1.2, speed / RIDES.car.speed + 0.3), owner, 'car');
      }
    }
  }

  updateHazards(dt) {
    this.updateProjectiles(dt);
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.t -= dt;
      if (f.t <= 0) this.flares.splice(i, 1);
    }
    for (let i = this.salts.length - 1; i >= 0; i--) {
      const s = this.salts[i];
      s.t -= dt;
      if (s.t <= 0) this.salts.splice(i, 1);
    }
    // flares and relics reveal ghosts; a held relic burns any ghost that comes close
    const wards = [...this.players.values()].filter((q) => q.state === 'alive' && q.wardT > 0);
    if (this.flares.length || wards.length) {
      for (const g of this.players.values()) {
        if (g.state !== 'ghost') continue;
        const s = this.ghostSpot(g);
        if (this.flares.some((f) => Math.hypot(s.x - f.x, s.y - f.y, s.z - f.z) < f.r)) g.exposedT = Math.max(g.exposedT, 0.5);
        for (const q of wards) {
          const d = Math.hypot(s.x - q.x, s.y - q.y - 1, s.z - q.z);
          if (d < 20) g.exposedT = Math.max(g.exposedT, 0.5);
          if (d < ITEMS.relic.radius) this.burn(g, q);
        }
      }
    }
    // gondolas in flight
    for (let i = this.gondolas.length - 1; i >= 0; i--) {
      const g = this.gondolas[i];
      g.t += dt;
      if (g.t < g.T) continue;
      this.gondolas.splice(i, 1);
      const R = RIDES.ferris;
      this.events.push({ e: 'boom', kind: 'gondola', x: g.to[0], y: g.to[1], z: g.to[2], r: R.radius });
      this.blast(g.to[0], g.to[1], g.to[2], R.radius, R.dmg, this.players.get(g.owner), 'ferris');
    }
    // bear traps
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const t = this.traps[i];
      t.armed = Math.max(0, t.armed - dt);
      if (t.armed > 0) continue;
      for (const q of this.players.values()) {
        if (q.state !== 'alive' || Math.abs(q.y - t.y) > 0.8) continue;
        if (Math.hypot(q.x - t.x, q.z - t.z) > 0.9) continue;
        this.traps.splice(i, 1);
        q.rootT = POWERS.trap.root;
        q.vx = 0;
        q.vz = 0;
        this.events.push({ e: 'snap', id: q.id, x: t.x, y: t.y, z: t.z });
        this.damage(q, POWERS.trap.dmg, this.players.get(t.owner), 'trap');
        break;
      }
    }
    // fake footsteps walk along
    for (let i = this.steps.length - 1; i >= 0; i--) {
      const s = this.steps[i];
      s.t -= dt;
      s.x += s.dx * 2.2 * dt;
      s.z += s.dz * 2.2 * dt;
      if (s.t <= 0) this.steps.splice(i, 1);
    }
    for (let i = this.blackouts.length - 1; i >= 0; i--) {
      const b = this.blackouts[i];
      b.t -= dt;
      if (b.t <= 0) this.blackouts.splice(i, 1);
    }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------------------------------------------------------------- snapshot

  /** How one rider looks to everyone else. */
  playerView(p) {
    const g = p.state === 'alive' ? p.slots[p.cur] : null;
    return {
      id: p.id, name: p.name, outfit: p.outfit, look: p.look, bot: p.bot, state: p.state,
      x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, yaw: p.yaw, pitch: p.pitch, onGround: p.onGround, tumble: (p.tumbleT || 0) > 0,
      hp: p.hp, shield: p.shield, wpn: p.state === 'alive' ? (g ? g.w : 'fists') : null, rarity: g ? g.rarity : 0,
      lastShot: p.lastShot, reloading: p.reloadT > 0, using: p.use ? p.use.item : null, aim: p.input.aim,
      slide: p.slideT > 0, sprint: p.sprint, combat: !!p.combat,
      atk: p.atk ? { heavy: p.atk.heavy, u: p.atk.t / p.atk.T, T: p.atk.T } : null, charge: p.charge, blocking: p.blocking,
      stagger: p.staggerT > 0, dodge: p.dodgeT > 0, ward: p.wardT > 0, burning: p.burnT > 0, exposed: p.exposedT > 0,
      flash: p.flashT, possess: p.possess ? p.possess.kind : null, revivesLeft: MAX_REVIVES - p.revivesUsed,
      revealed: p.revealT > 0, rooted: p.rootT > 0, protected: p.protT > 0, kills: p.kills + p.ghostKills,
    };
  }

  /** Everything a client needs to draw the world for one viewer. */
  snapshot(viewerId, knownLootVer = -1) {
    const me = this.players.get(viewerId);
    const ghostView = !me || me.state === 'ghost' || this.phase === 'end';
    const zn = this.zone;
    let alive = 0;
    let ghosts = 0;
    const players = [];
    for (const p of this.players.values()) {
      if (p.state === 'ghost') ghosts++;
      else alive++;
      players.push(this.playerView(p));
    }
    const snap = {
      time: this.time, phase: this.phase, night: this.night, launchIn: this.launchIn, finalT: this.finalT, winner: this.winner, endT: this.endT,
      alive, ghosts, players,
      zone: { cx: zn.cx, cz: zn.cz, r: zn.r, nx: zn.nx, nz: zn.nz, nr: zn.nr, state: zn.state, t: zn.t, idx: zn.idx, dps: this.zoneDps() },
      bus: { x: this.bus.x, z: this.bus.z, yaw: this.bus.yaw, s: this.bus.s, v: this.bus.v, open: this.phase === 'live' && this.bus.s < BUS_ROUTE.len },
      ferris: { angle: this.ferris.angle, driver: this.ferris.driver },
      coaster: { s: this.coaster.s, v: this.coaster.v, running: this.coaster.running, cd: this.coaster.cd },
      cars: this.cars.map((c) => ({ x: c.x, y: c.y, z: c.z, yaw: c.yaw, driver: c.driver, t: c.t })),
      broken: this.broken.size ? [...this.broken] : null,
      gondolas: this.gondolas.map((g) => ({ from: g.from, to: g.to, u: g.t / g.T })),
      blackouts: this.blackouts.map((b) => ({ x: b.x, z: b.z, r: b.r, t: b.t, dur: b.dur })),
      traps: this.traps
        .filter((t) => ghostView || (me && Math.hypot(t.x - me.x, t.z - me.z) < 4))
        .map((t) => ({ id: t.id, x: t.x, y: t.y, z: t.z })),
      steps: this.steps.map((s) => ({ x: s.x, y: s.y, z: s.z, dx: s.dx, dz: s.dz, ghost: ghostView })),
      projs: this.projs.map((q) => ({ id: q.id, kind: q.kind, x: q.x, y: q.y, z: q.z, vx: q.vx, vy: q.vy, vz: q.vz })),
      flares: this.flares.map((f) => ({ id: f.id, x: f.x, y: f.y, z: f.z, r: f.r, t: f.t })),
      salts: this.salts.map((q) => ({ id: q.id, x: q.x, y: q.y, z: q.z, r: q.r, t: q.t, dur: q.dur })),
      lootVer: this.lootVer,
    };
    if (knownLootVer !== this.lootVer) {
      snap.loot = [...this.loot.values()].map((l) => ({
        id: l.id, kind: l.kind, x: l.x, y: l.y, z: l.z, rot: l.rot || 0, w: l.w, rarity: l.rarity, dura: l.dura,
        ammo: l.ammo, item: l.item, count: l.count, cursed: ghostView ? !!l.cursed : false,
      }));
    }
    if (me) {
      const it = me.state === 'alive' ? this.interactTarget(me) : null;
      const ride = me.state === 'ghost' && !me.possess ? this.rideNear(me) : null;
      snap.me = {
        id: me.id, state: me.state, slots: me.slots.map((s) => (s ? { ...s } : null)), cur: me.cur,
        ammo: { ...me.ammo }, items: { ...me.items }, tickets: me.tickets, stam: me.stam, charge: me.charge,
        booth: me.state === 'alive' ? this.boothNear(me) : -1, wardT: me.wardT, burnT: me.burnT,
        reloadT: me.reloadT, reloadDur: me.reloadDur,
        use: me.use ? { ...me.use } : null, ecto: me.ecto, cds: { ...me.cds }, possess: me.possess ? { ...me.possess } : null,
        rootT: me.rootT, shakeT: me.shakeT, protT: me.protT, riseT: me.riseT, revivesLeft: MAX_REVIVES - me.revivesUsed, target: me.target, ghostTime: me.ghostTime || 0,
        carT: me.possess?.kind === 'car' ? this.cars[me.possess.car].t : 0,
        interact: it ? { id: it.id, kind: it.kind, w: it.w, rarity: it.rarity, dura: it.dura, ammo: it.ammo, item: it.item, count: it.count } : null,
        ride,
        kills: me.kills, ghostKills: me.ghostKills, revives: me.revives,
      };
    }
    if (this.phase === 'end') snap.standings = this.standings();
    return snap;
  }
}
