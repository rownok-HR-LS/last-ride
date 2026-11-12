// The park: several rides at once. Each ride (a Room) has its own bus stop; the bus leaves on a short timer with
// everyone waiting aboard and bots in the empty seats. Someone who turns up while every ride is under way gets a
// stop of their own instead of waiting it out as a ghost; an invite link (a ride's code) puts a friend on the same
// ride, watching first if it has already left. Watching a ride under way is a choice at the stop, never forced.
import { randomUUID } from 'node:crypto';
import { Game } from '../shared/game.js';
import { cleanLook } from '../shared/looks.js';
import { MAX_PLAYERS, OUTFITS, END_SCREEN_SECONDS } from '../shared/constants.js';
import { TICK, SNAP_EVERY, BUS_WAIT, BUS_AGAIN, pack, unpackInput } from '../shared/net.js';


const lootView = (l) => ({
  id: l.id, kind: l.kind, x: l.x, y: l.y, z: l.z, rot: l.rot || 0, w: l.w, rarity: l.rarity, dura: l.dura,
  ammo: l.ammo, item: l.item, count: l.count, cursed: !!l.cursed,
});

/** A rider whose line dropped mid-ride has this long to come back before an empty ride is closed. */
const COME_BACK_MS = 35000;

/** Online, the results stay up this long before everyone heads back to the bus stop. */
const RESULTS_FOR = 12;

/** How many rides run at once (Render's free plan has a tenth of a processor; one ride needs about 1% of a fast one). */
const MAX_RIDES = 4;

/** Ride codes for invite links: no 0/O or 1/I to mix up. */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A rider's own full state, for the browser to predict its own movement from. */
function selfState(p) {
  const o = {};
  for (const k in p) if (k !== 'brain' && k !== 'input' && k !== 'flight' && k !== 'queue') o[k] = p[k];
  return o;
}

const send = (c, msg) => {
  if (c.ws.readyState === 1) c.ws.send(typeof msg === 'string' ? msg : pack(msg));
};

export class Park {
  constructor({ busWait = BUS_WAIT, busAgain = BUS_AGAIN, maxRides = MAX_RIDES } = {}) {
    this.busWait = busWait;
    this.busAgain = busAgain;
    this.maxRides = maxRides;
    this.conns = new Set();
    /** code -> Room */
    this.rooms = new Map();
    this.nextConn = 1;
  }

  connect(ws) {
    const c = { ws, id: this.nextConn++, name: 'Rider', outfit: OUTFITS[0].id, joined: false, ready: false, pid: null, watching: false, fullLoot: true, room: null };
    this.conns.add(c);
    ws.on('message', (data) => {
      let m;
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      if (m && typeof m === 'object') this.message(c, m);
    });
    ws.on('close', (code) => {
      console.log(`rider ${c.id} (${c.name}) left, code ${code}`);
      this.leave(c);
    });
    ws.on('error', () => {});
    send(c, { t: 'hello', players: this.humans() });
  }

  message(c, m) {
    switch (m.t) {
      case 'join':
        if (c.joined) return;
        c.joined = true;
        c.ready = true;
        c.name = String(m.name ?? '').slice(0, 16);
        c.outfit = OUTFITS.some((o) => o.id === m.outfit) ? m.outfit : OUTFITS[0].id;
        c.look = cleanLook(m.look);
        this.place(c, m.ride);
        break;
      case 'rejoin': {
        // back after a dropped line: the ticket gets you your rider back (the bot steering it lets go)
        if (c.joined) return;
        const ticket = String(m.ticket ?? '');
        const room = [...this.rooms.values()].find((r) => r.tickets.has(ticket));
        if (!room?.rejoin(c, m, ticket)) {
          send(c, { t: 'rejoinFail' });
          this.message(c, { t: 'join', name: m.name, outfit: m.outfit, look: m.look });
        }
        break;
      }
      case 'watch': {
        // chose to watch a ride under way from the stop: off this stop, into that ride's line for its next bus
        const from = c.room;
        if (!from || from.game || c.pid !== null) return;
        const to = this.watchable(from)[0];
        if (!to) return;
        from.remove(c);
        to.admit(c);
        break;
      }
      case 'ping':
        send(c, { t: 'pong', at: m.at });
        break;
      default:
        c.room?.message(c, m);
    }
  }

  /**
   * Find a joining rider a ride: the invite's ride if there is one, else a bus already counting down with seats
   * left, else a stop nobody is waiting at, else a new stop of their own.
   */
  place(c, code) {
    const rooms = [...this.rooms.values()];
    let room = code ? this.rooms.get(String(code).toUpperCase().slice(0, 8)) : null;
    room ??= rooms.find((r) => !r.game && r.busIn !== null && r.line() < MAX_PLAYERS);
    room ??= rooms.find((r) => !r.game && r.line() === 0);
    room ??= this.newRoom();
    console.log(`rider ${c.id} (${c.name}) joined ride ${room.id}, ${room.game ? 'watching' : 'waiting'}${code ? ' (invited)' : ''}`);
    room.admit(c);
  }

  newRoom() {
    let id;
    do {
      id = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    } while (this.rooms.has(id));
    const room = new Room({ park: this, id, busWait: this.busWait, busAgain: this.busAgain });
    this.rooms.set(id, room);
    return room;
  }

  leave(c) {
    this.conns.delete(c);
    c.room?.leave(c);
  }

  /** May one more bus leave? */
  canStart() {
    let n = 0;
    for (const r of this.rooms.values()) if (r.game) n++;
    return n < this.maxRides;
  }

  /** Rides under way that someone at stop `from` could watch, busiest (most people riding) first. */
  watchable(from = null) {
    return [...this.rooms.values()]
      .filter((r) => r !== from && r.game && r.game.phase !== 'end')
      .sort((a, b) => b.riders() - a.riders());
  }

  humans() {
    let n = 0;
    for (const c of this.conns) if (c.joined) n++;
    return n;
  }

  update() {
    for (const [id, r] of this.rooms) {
      r.update();
      // a stop nobody is at and no ride on: gone
      if (!r.game && r.conns.size === 0) this.rooms.delete(id);
    }
  }

  /** For the health check page. */
  info() {
    const rooms = [...this.rooms.values()];
    const waits = rooms.map((r) => r.busIn).filter((b) => b !== null);
    return { game: 'last-ride', online: this.humans(), riding: rooms.some((r) => r.game), rides: rooms.filter((r) => r.game).length, busIn: waits.length ? Math.min(...waits) : null };
  }
}

/** One ride: its bus stop, and the ride itself once the bus has left. */
export class Room {
  constructor({ park, id, busWait = BUS_WAIT, busAgain = BUS_AGAIN }) {
    this.park = park;
    this.id = id;
    this.busWait = busWait;
    this.busAgain = busAgain;
    this.conns = new Set();
    this.game = null;
    this.busIn = null;
    /** the bus is ready to go but every ride is out: it leaves when one comes back */
    this.held = false;
    this.tick = 0;
    this.events = [];
    this.lootSent = new Map();
    this.lastStatus = 0;
    // a private ticket per rider per ride, so a browser that lost its line can take its rider back
    this.tickets = new Map();
  }

  // ---------------------------------------------------------------- connections

  /** A joined rider arrives here: at the stop, or watching if the ride is under way (in line for the next bus). */
  admit(c) {
    c.room = this;
    c.ready = true;
    c.fullLoot = true;
    this.conns.add(c);
    if (this.game) this.watch(c);
    else this.busIn ??= this.busWait;
    this.status(true);
  }

  /** Off to another ride (only from the stop). */
  remove(c) {
    this.conns.delete(c);
    c.room = null;
    this.status(true);
  }

  /** Back with a ticket: false if that rider is gone. */
  rejoin(c, m, ticket) {
    const tk = this.tickets.get(ticket);
    const p = tk && this.game && tk.game === this.game ? this.game.players.get(tk.pid) : null;
    if (!p) return false;
    // the old line may not have noticed it is dead yet
    for (const o of this.conns) {
      if (o !== c && o.pid === p.id) {
        o.pid = null;
        o.ws.terminate?.();
      }
    }
    c.joined = true;
    c.ready = false;
    c.watching = false;
    c.fullLoot = true;
    c.name = String(m.name ?? '').slice(0, 16);
    c.outfit = OUTFITS.some((o) => o.id === m.outfit) ? m.outfit : OUTFITS[0].id;
    c.room = this;
    this.conns.add(c);
    this.game.toHuman(p.id);
    c.pid = p.id;
    console.log(`rider ${c.id} (${c.name}) is back as ${p.id} on ride ${this.id}`);
    send(c, { t: 'start', id: p.id, ticket, back: true });
    this.status(true);
    return true;
  }

  message(c, m) {
    switch (m.t) {
      case 'again':
        // back to the bus stop after a ride
        if (c.joined && c.pid === null) {
          c.ready = true;
          if (!this.game) this.busIn ??= this.busWait;
          this.status(true);
        }
        break;
      case 'in':
        {
          const p = c.pid !== null ? this.game?.players.get(c.pid) : null;
          if (!p?.queue || !Array.isArray(m.s)) return;
          for (const a of m.s.slice(0, 12)) {
            const i = unpackInput(a);
            if (i && i.seq > (p.queue.at(-1)?.seq ?? p.ack)) p.queue.push(i);
          }
        }
        break;
      case 'leave':
        // walked away on purpose ("Leave the park", "Main menu"): nobody to keep the ride open for
        c.left = true;
        break;
      default:
    }
  }

  leave(c) {
    this.conns.delete(c);
    // a rider who walks away mid-ride is taken over by a bot, so the ride goes on as it was
    if (this.game && c.pid !== null) {
      this.game.toBot(c.pid);
      // and the ride is kept going a while in case they are only reconnecting (not if they said goodbye)
      if (!c.left) this.graceUntil = Date.now() + COME_BACK_MS;
    }
    c.pid = null;
    c.room = null;
    this.status(true);
  }

  /** Watching the ride under way as a ghost (the browser flies the camera; the park does not know you are there). */
  watch(c) {
    c.watching = true;
    c.fullLoot = true;
    send(c, { t: 'watch' });
  }

  /** How many are waiting at this stop. */
  line() {
    let n = 0;
    for (const c of this.conns) if (c.ready && c.pid === null) n++;
    return n;
  }

  /** How many people are riding (not bots). */
  riders() {
    let n = 0;
    for (const c of this.conns) if (c.pid !== null) n++;
    return n;
  }

  // ---------------------------------------------------------------- the bus stop

  /** Who is waiting, and when the bus leaves (every second, or at once when something changed). */
  status(now = false) {
    const t = Date.now();
    if (!now && t - this.lastStatus < 1000) return;
    this.lastStatus = t;
    const line = [...this.conns].filter((c) => c.ready && c.pid === null);
    // who is in line (first few), so the stop can show names
    const names = line.slice(0, 8).map((c) => c.name || 'Rider');
    const g = this.game;
    const msg = pack({
      t: 'lobby', code: this.id, busIn: this.busIn, held: this.held, waiting: line.length, names, online: this.park?.humans() ?? 0,
      watchable: this.game ? 0 : (this.park?.watchable(this).length ?? 0),
      ride: g ? { phase: g.phase, alive: g.living(), riders: [...g.players.values()].filter((p) => !p.bot).length } : null,
    });
    for (const c of this.conns) if (c.joined && c.pid === null) send(c, msg);
  }

  startRide() {
    const riders = [...this.conns].filter((c) => c.ready && c.pid === null);
    this.busIn = null;
    this.held = false;
    if (!riders.length) return;
    this.game = new Game({ difficulty: 'normal' });
    this.tick = 0;
    this.events = [];
    this.lootSent = new Map();
    this.tickets = new Map();
    for (const c of riders.slice(0, MAX_PLAYERS)) {
      const p = this.game.addPlayer({ name: c.name, outfit: c.outfit, look: c.look });
      // a rider fed by the inputs this connection sends (see Game.feed)
      p.queue = [];
      p.ack = 0;
      p.starved = 0;
      c.pid = p.id;
      c.ready = false;
      c.watching = false;
      c.fullLoot = true;
      const ticket = randomUUID();
      this.tickets.set(ticket, { pid: p.id, game: this.game });
      send(c, { t: 'start', id: p.id, ticket });
    }
    // more riders than seats wait for the next one
    for (const c of riders.slice(MAX_PLAYERS)) this.watch(c);
    this.game.fillBots(MAX_PLAYERS);
    console.log(`ride ${this.id}: bus left with ${riders.length} rider(s)`);
  }

  endRide() {
    this.game = null;
    this.graceUntil = 0;
    this.tickets = new Map();
    console.log(`ride ${this.id} over`);
    for (const c of this.conns) {
      if (c.pid !== null || c.watching) send(c, { t: 'over' });
      // watchers never got to ride: they stay first in line
      c.pid = null;
      c.watching = false;
    }
    this.busIn = this.busAgain;
    this.status(true);
  }

  // ---------------------------------------------------------------- the tick

  update() {
    const g = this.game;
    if (!g) {
      // the bus waits at the stop while anyone is ready to ride
      const waiting = [...this.conns].some((c) => c.ready);
      if (!waiting) {
        this.busIn = null;
        this.held = false;
      } else {
        if (this.busIn === null) this.busIn = this.busWait;
        this.busIn = Math.max(0, this.busIn - TICK);
        if (this.busIn <= 0) {
          // every ride is out: this bus goes as soon as one comes back
          if (!this.park || this.park.canStart()) this.startRide();
          else if (!this.held) {
            this.held = true;
            this.status(true);
          }
        }
      }
      this.status();
      return;
    }
    g.update(TICK);
    for (const e of g.drainEvents()) {
      e.at = g.time;
      this.events.push(e);
    }
    this.tick++;
    if (this.tick % SNAP_EVERY === 0) this.broadcast();
    this.status();
    // every rider left: stop the ride (the bots would only fight among themselves, and anyone watching would wait
    // minutes for a bots-only ride to end before boarding). A dropped rider gets a while to come back first.
    const anyone = [...this.conns].some((c) => c.pid !== null) || Date.now() < (this.graceUntil || 0);
    if ((g.phase === 'end' && g.endT <= END_SCREEN_SECONDS - RESULTS_FOR) || !anyone) this.endRide();
  }

  /** What changed among the loot since last time (sent to everyone; ghosts' view of cursed loot is the browser's job). */
  lootDelta() {
    const add = [];
    const del = [];
    const seen = new Set();
    for (const l of this.game.loot.values()) {
      seen.add(l.id);
      const v = lootView(l);
      const j = JSON.stringify(v);
      if (this.lootSent.get(l.id) !== j) {
        this.lootSent.set(l.id, j);
        add.push(v);
      }
    }
    for (const id of this.lootSent.keys()) {
      if (!seen.has(id)) {
        this.lootSent.delete(id);
        del.push(id);
      }
    }
    return { add, del };
  }

  broadcast() {
    const g = this.game;
    const delta = this.lootDelta();
    const events = this.events;
    this.events = [];
    let full = null;
    let watchSnap = null;
    for (const c of this.conns) {
      if (c.pid === null && !c.watching) continue;
      let loot = delta.add.length || delta.del.length ? delta : null;
      if (c.fullLoot) {
        full ??= { full: [...g.loot.values()].map(lootView) };
        loot = full;
        c.fullLoot = false;
      }
      const snap = c.pid !== null ? g.snapshot(c.pid, g.lootVer) : (watchSnap ??= g.snapshot(null, g.lootVer));
      const p = c.pid !== null ? g.players.get(c.pid) : null;
      send(c, { t: 's', snap, ack: p?.ack ?? 0, self: p ? selfState(p) : null, loot, ev: events });
    }
  }
}
