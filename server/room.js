// The one public ride. Riders wait at the stop; the bus leaves on a timer with everyone waiting aboard and bots in
// the empty seats. Whoever turns up while a ride is on watches it as a ghost and boards the next bus.
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

/** A rider's own full state, for the browser to predict its own movement from. */
function selfState(p) {
  const o = {};
  for (const k in p) if (k !== 'brain' && k !== 'input' && k !== 'flight' && k !== 'queue') o[k] = p[k];
  return o;
}

export class Room {
  constructor({ busWait = BUS_WAIT, busAgain = BUS_AGAIN } = {}) {
    this.busWait = busWait;
    this.busAgain = busAgain;
    this.conns = new Set();
    this.game = null;
    this.busIn = null;
    this.tick = 0;
    this.events = [];
    this.lootSent = new Map();
    this.nextConn = 1;
    this.lastStatus = 0;
    // a private ticket per rider per ride, so a browser that lost its line can take its rider back
    this.tickets = new Map();
  }

  // ---------------------------------------------------------------- connections

  connect(ws) {
    const c = { ws, id: this.nextConn++, name: 'Rider', outfit: OUTFITS[0].id, joined: false, ready: false, pid: null, watching: false, fullLoot: true };
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
    this.send(c, { t: 'hello', players: this.humans() });
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
        console.log(`rider ${c.id} (${c.name}) joined, ${this.game ? 'watching' : 'waiting'}`);
        if (this.game) this.watch(c);
        else this.busIn ??= this.busWait;
        this.status(true);
        break;
      case 'rejoin': {
        // back after a dropped line: the ticket gets you your rider back (the bot steering it lets go)
        if (c.joined) return;
        const tk = this.tickets.get(String(m.ticket ?? ''));
        const p = tk && this.game && tk.game === this.game ? this.game.players.get(tk.pid) : null;
        if (!p) {
          this.send(c, { t: 'rejoinFail' });
          this.message(c, { t: 'join', name: m.name, outfit: m.outfit });
          return;
        }
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
        this.game.toHuman(p.id);
        c.pid = p.id;
        console.log(`rider ${c.id} (${c.name}) is back as ${p.id}`);
        this.send(c, { t: 'start', id: p.id, ticket: m.ticket, back: true });
        this.status(true);
        break;
      }
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
      case 'ping':
        this.send(c, { t: 'pong', at: m.at });
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
    this.status(true);
  }

  /** Turned up mid-ride: watch as a ghost (the browser flies the camera; the park does not know you are there). */
  watch(c) {
    c.watching = true;
    c.fullLoot = true;
    this.send(c, { t: 'watch' });
  }

  humans() {
    let n = 0;
    for (const c of this.conns) if (c.joined) n++;
    return n;
  }

  send(c, msg) {
    if (c.ws.readyState === 1) c.ws.send(typeof msg === 'string' ? msg : pack(msg));
  }

  // ---------------------------------------------------------------- the bus stop

  /** Who is waiting, and when the bus leaves (every second, or at once when something changed). */
  status(now = false) {
    const t = Date.now();
    if (!now && t - this.lastStatus < 1000) return;
    this.lastStatus = t;
    const line = [...this.conns].filter((c) => c.ready && c.pid === null);
    const waiting = line.length;
    // who is in line (first few), so the stop can show names
    const names = line.slice(0, 8).map((c) => c.name || 'Rider');
    const g = this.game;
    const msg = pack({
      t: 'lobby', busIn: this.busIn, waiting, names, online: this.humans(),
      ride: g ? { phase: g.phase, alive: g.living(), riders: [...g.players.values()].filter((p) => !p.bot).length } : null,
    });
    for (const c of this.conns) if (c.joined && c.pid === null) this.send(c, msg);
  }

  startRide() {
    const riders = [...this.conns].filter((c) => c.ready && c.pid === null);
    this.busIn = null;
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
      this.send(c, { t: 'start', id: p.id, ticket });
    }
    // more riders than seats wait for the next one
    for (const c of riders.slice(MAX_PLAYERS)) this.watch(c);
    this.game.fillBots(MAX_PLAYERS);
    console.log(`bus left with ${riders.length} rider(s)`);
  }

  endRide() {
    this.game = null;
    this.graceUntil = 0;
    this.tickets = new Map();
    console.log('ride over');
    for (const c of this.conns) {
      if (c.pid !== null || c.watching) this.send(c, { t: 'over' });
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
      if (!waiting) this.busIn = null;
      else {
        if (this.busIn === null) this.busIn = this.busWait;
        this.busIn -= TICK;
        if (this.busIn <= 0) this.startRide();
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
      this.send(c, { t: 's', snap, ack: p?.ack ?? 0, self: p ? selfState(p) : null, loot, ev: events });
    }
  }
}
