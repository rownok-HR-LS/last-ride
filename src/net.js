// Online play. NetGame stands in for the match simulation when the real one runs on the game server: the client
// calls the same few things it calls offline (setInput, command, update, snapshot, drainEvents, players, phase).
// Your own rider is predicted here, so moving, dodging and swinging answer at once; the server's word is taken
// whenever an update arrives, and the inputs it has not seen yet are played again on top. Everyone else is drawn
// a tenth of a second in the past, smoothly between the server's updates.
import { Game } from '../shared/game.js';
import { TICK, INTERP, pack, packInput } from '../shared/net.js';
import { stepGhost, wishDir } from '../shared/physics.js';
import { GHOST_SPEED, GHOST_FAST } from '../shared/constants.js';

/** Commands that change how you move, so they are predicted as well as sent. */
const PREDICT_CMDS = new Set(['dodge', 'slide', 'slot', 'reload', 'use']);
/** Your own events that the prediction makes at once (the server's copies are then skipped). */
const OWN_EVENTS = new Set(['swing', 'dodge', 'slide', 'reload', 'use', 'fire']);
const ANGLES = new Set(['yaw', 'pitch', 'angle']);
const SKIP_SELF = new Set(['input', 'brain', 'flight']);

/** Where the game server is: ?server=… for testing, the address baked into the build, or this machine. */
export function serverUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
  return `ws://${location.hostname || 'localhost'}:8090`;
}

/**
 * Knock on the server's door over plain HTTP. A free host puts the server to sleep when nobody plays and wakes it
 * on the first request, which can take most of a minute: knocking while the title screen loads means it is
 * usually up by the time you press Ride online. Resolves true once it answers (false after timeoutMs).
 */
export async function wakeServer(timeoutMs = 12000) {
  const http = serverUrl().replace(/^ws/, 'http');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(http, { signal: ctl.signal, cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Open a line, giving up after ms (a sleeping server can hold a connection open for a long time). */
export async function connect(ms = 8000) {
  const conn = new Connection(serverUrl());
  let timer;
  try {
    await Promise.race([conn.opened, new Promise((_, no) => (timer = setTimeout(() => no(new Error('slow')), ms)))]);
    return conn;
  } catch (err) {
    conn.close();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** The line to the server: JSON messages in and out, handlers by message type. */
export class Connection {
  constructor(url) {
    this.handlers = {};
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      this.handlers[m.t]?.(m);
    };
    this.opened = new Promise((ok, fail) => {
      this.ws.onopen = () => ok();
      this.ws.onerror = () => fail(new Error('no server'));
    });
    this.ws.onclose = () => this.handlers.close?.();
    // how long a message takes there and back
    this.rtt = 0.1;
    this.handlers.pong = (m) => (this.rtt = this.rtt * 0.7 + ((performance.now() - m.at) / 1000) * 0.3);
    this.pinger = setInterval(() => this.send({ t: 'ping', at: performance.now() }), 2000);
  }

  get open() {
    return this.ws.readyState === 1;
  }

  send(m) {
    if (this.open) this.ws.send(typeof m === 'string' ? m : pack(m));
  }

  close() {
    clearInterval(this.pinger);
    this.handlers.close = null;
    this.ws.close();
  }
}

const lerp = (a, b, k) => a + (b - a) * k;
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/** Which numbers are smoothed between updates (counts and health are not: they would show fractions). */
const SMOOTH = {
  top: ['launchIn', 'endT', 'finalT'],
  player: ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch'],
  zone: ['cx', 'cz', 'r', 'nx', 'nz', 'nr', 't'],
  bus: ['x', 'z', 'yaw', 's', 'v'],
  ferris: ['angle'],
  coaster: ['s', 'v'],
  car: ['x', 'y', 'z', 'yaw'],
  gondola: ['u'],
  proj: ['x', 'y', 'z'],
};

/** b, with the listed numbers moved part of the way back toward a (big jumps are teleports and are not smoothed). */
function mix(a, b, k, keys) {
  if (!a) return { ...b };
  const o = { ...b };
  for (const key of keys) {
    const x = a[key];
    const y = b[key];
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    if (ANGLES.has(key)) o[key] = lerpAngle(x, y, k);
    else if (Math.abs(y - x) < 12) o[key] = lerp(x, y, k);
  }
  return o;
}

function mixList(as, bs, k, keys, byId = true) {
  if (!as) return bs.map((b) => ({ ...b }));
  const old = byId ? new Map(as.map((a) => [a.id, a])) : null;
  return bs.map((b, i) => mix(byId ? old.get(b.id) : as[i], b, k, keys));
}

/** A free camera ghost for watching a ride you were not on (the server does not know it exists). */
function spectator(profile) {
  return {
    id: -1, name: profile?.name || 'You', outfit: profile?.outfit, bot: false, state: 'ghost',
    x: 0, y: 14, z: 60, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: -0.2, onGround: false, hp: 0, shield: 0, flash: 0,
  };
}

const SPECTATOR_ME = {
  id: -1, state: 'ghost', spectator: true, slots: [null, null, null], cur: 0, ammo: {}, items: {}, tickets: 0, stam: 100, charge: 0,
  booth: -1, wardT: 0, burnT: 0, reloadT: 0, reloadDur: 0, use: null, ecto: 0, cds: {}, possess: null, rootT: 0, shakeT: 0, protT: 0,
  riseT: 0, revivesLeft: 0, target: null, carT: 0, interact: null, ride: null, kills: 0, ghostKills: 0, revives: 0,
};

export class NetGame {
  /** myId: your rider on the server, or null to watch the ride as a ghost. */
  constructor(conn, myId, profile) {
    this.online = true;
    this.conn = conn;
    this.watching = myId == null;
    this.myId = this.watching ? -1 : myId;
    this.snaps = [];
    this.latest = null;
    this.view = null;
    this.players = new Map();
    this.phase = 'launch';
    this.rt = null;
    // your input and commands, numbered, until the server says it has used them
    this.input = {};
    this.cmds = [];
    this.seq = 0;
    this.pending = [];
    this.outbox = [];
    this.loot = new Map();
    this.lootVer = 0;
    this.lootGhost = null;
    this.events = [];
    this.queued = [];
    // the prediction: a private copy of the park with only you moving in it
    const g = new Game({ seed: 1 });
    g.damage = () => {};
    g.meleeHit = () => {};
    g.kill = () => {};
    g.loot.clear();
    g.players.clear();
    this.pred = g;
    this.me = null;
    this.predicting = false;
    this.offset = { x: 0, y: 0, z: 0 };
    this.corrections = [];
    this.spec = this.watching ? spectator(profile) : null;
    conn.handlers.s = (m) => this.receive(m);
  }

  get ready() {
    return !!this.view;
  }

  /**
   * Carry on over a new line after the old one dropped. Inputs the old server copy never saw are dropped too (the
   * bot was steering meanwhile): the next update puts you where the server has you.
   */
  rebind(conn) {
    this.conn = conn;
    conn.handlers.s = (m) => this.receive(m);
    this.pending = [];
    this.outbox = [];
    this.cmds = [];
  }

  // ---------------------------------------------------------------- what the client calls

  setInput(id, input) {
    this.input = input;
  }

  command(id, cmd) {
    if (!this.watching && cmd) this.cmds.push(cmd);
  }

  /** One sim step: record (and predict) your input for it, and move the clock others are drawn at. */
  update(dt) {
    const entry = { seq: ++this.seq, input: { ...this.input }, cmds: this.cmds };
    this.cmds = [];
    if (!this.watching) {
      this.pending.push(entry);
      if (this.pending.length > 240) this.pending.shift();
      this.outbox.push(packInput(entry.seq, entry.input, entry.cmds));
      if (this.predicting) this.step(entry, true);
    } else this.flySpectator(dt);
    const k = Math.exp(-dt * 10);
    this.offset.x *= k;
    this.offset.y *= k;
    this.offset.z *= k;
    this.advanceClock(dt);
    this.view = this.buildView();
    this.players = new Map(this.view.players.map((p) => [p.id, p]));
    this.phase = this.view.phase;
  }

  snapshot(viewerId, knownLootVer) {
    // send what this frame produced
    if (this.outbox.length) {
      this.conn.send({ t: 'in', s: this.outbox });
      this.outbox = [];
    }
    const v = this.view;
    const out = { ...v, players: v.players.map((p) => ({ ...p })) };
    const ghostView = !v.me || v.me.state === 'ghost' || v.phase === 'end';
    if (ghostView !== this.lootGhost) {
      this.lootGhost = ghostView;
      this.lootVer++;
    }
    out.lootVer = this.lootVer;
    if (knownLootVer !== this.lootVer) out.loot = [...this.loot.values()].map((l) => (ghostView ? { ...l } : { ...l, cursed: false }));
    return out;
  }

  /** Events whose moment has come at the time others are drawn at (yours straight away). */
  drainEvents() {
    const out = this.events;
    this.events = [];
    const me = this.myId;
    const keep = [];
    for (const e of this.queued) {
      const mine = e.id === me || e.by === me || e.victim === me || e.killer === me;
      if (mine || e.at <= this.rt + 1e-3) out.push(e);
      else keep.push(e);
    }
    this.queued = keep;
    return out;
  }

  // ---------------------------------------------------------------- from the server

  receive(m) {
    const snap = m.snap;
    snap.recv = performance.now();
    if (m.loot) {
      if (m.loot.full) {
        this.loot.clear();
        for (const l of m.loot.full) this.loot.set(l.id, l);
      } else {
        for (const l of m.loot.add) this.loot.set(l.id, l);
        for (const id of m.loot.del) this.loot.delete(id);
      }
      this.lootVer++;
    }
    for (const e of m.ev || []) {
      // your own swings and dodges already happened here
      if (this.predicting && e.id === this.myId && OWN_EVENTS.has(e.e)) continue;
      this.queued.push(e);
    }
    this.snaps.push(snap);
    while (this.snaps.length > 2 && this.snaps[1].time < snap.time - 1) this.snaps.shift();
    this.latest = snap;
    if (m.self) this.reconcile(m.self, m.ack | 0, snap);
    if (!this.view) {
      this.rt = snap.time - INTERP;
      this.view = this.buildView();
      this.players = new Map(this.view.players.map((p) => [p.id, p]));
      this.phase = snap.phase;
    }
  }

  /** Take the server's word for where you are, then play the inputs it has not used yet on top. */
  reconcile(self, ack, snap) {
    this.pending = this.pending.filter((p) => p.seq > ack);
    const before = this.predicting && this.me ? { x: this.me.x, y: this.me.y, z: this.me.z } : null;
    const P = this.me || { input: {} };
    // switched-off flags are left out of messages: anything missing is off
    for (const k in P) if (!SKIP_SELF.has(k) && !(k in self)) P[k] = false;
    Object.assign(P, self);
    this.me = P;
    const g = this.pred;
    g.time = snap.time;
    g.phase = snap.phase;
    g.zone = { ...snap.zone };
    g.salts = snap.salts.map((s) => ({ ...s }));
    g.players.clear();
    g.players.set(P.id, P);
    // the others stand where the server last saw them (aim assist and lunges pick from these)
    for (const q of snap.players) if (q.id !== P.id) g.players.set(q.id, { ...q, input: {} });
    this.predicting = snap.phase === 'live' && (P.state === 'alive' || (P.state === 'ghost' && !P.possess));
    if (!this.predicting) return;
    for (const e of this.pending) this.step(e, false);
    if (before) {
      const dx = before.x - P.x;
      const dy = before.y - P.y;
      const dz = before.z - P.z;
      // how far off the prediction was (for testing: window.__lr.game.corrections)
      this.corrections.push(Math.hypot(dx, dy, dz));
      if (this.corrections.length > 300) this.corrections.shift();
      // small differences are eased out over a few frames; big ones (a knockback you did not see coming) snap
      if (Math.hypot(dx, dy, dz) < 3) {
        this.offset.x += dx;
        this.offset.y += dy;
        this.offset.z += dz;
      } else this.offset = { x: 0, y: 0, z: 0 };
    }
  }

  step(entry, live) {
    const g = this.pred;
    const P = this.me;
    for (const c of entry.cmds) if (PREDICT_CMDS.has(c.c)) g.command(P.id, c);
    g.setInput(P.id, entry.input);
    g.time += TICK;
    if (P.state === 'alive') g.updateLiving(P, TICK);
    else if (P.state === 'ghost' && !P.possess) g.updateGhost(P, TICK);
    g.projs.length = 0;
    const ev = g.drainEvents();
    if (live) for (const e of ev) if (e.id === P.id && OWN_EVENTS.has(e.e)) this.events.push(e);
  }

  flySpectator(dt) {
    const s = this.spec;
    const i = this.input;
    s.yaw = i.yaw || 0;
    s.pitch = i.pitch || 0;
    const [wx, wz] = wishDir(i.fwd || 0, i.side || 0, s.yaw);
    stepGhost(s, wx, i.up || 0, wz, i.fast ? GHOST_FAST : GHOST_SPEED, dt);
  }

  // ---------------------------------------------------------------- drawing time

  /** Others are drawn INTERP behind the newest update; the clock eases back on course if it drifts. */
  advanceClock(dt) {
    const L = this.latest;
    if (!L) return;
    const target = L.time - INTERP + Math.min(0.25, (performance.now() - L.recv) / 1000);
    this.rt = this.rt === null || Math.abs(this.rt + dt - target) > 0.3 ? target : this.rt + dt + (target - this.rt - dt) * 0.08;
    this.rt = Math.min(this.rt, L.time);
  }

  buildView() {
    const L = this.latest;
    const rt = this.rt ?? L.time;
    let a = L;
    let b = L;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].time <= rt) {
        a = this.snaps[i];
        b = this.snaps[i + 1] || a;
        break;
      }
      a = b = this.snaps[i];
    }
    const k = b.time > a.time ? Math.min(1, (rt - a.time) / (b.time - a.time)) : 1;
    const v = mix(a, b, k, SMOOTH.top);
    v.time = rt;
    v.players = mixList(a.players, b.players, k, SMOOTH.player);
    v.zone = mix(a.zone, b.zone, k, SMOOTH.zone);
    v.bus = mix(a.bus, b.bus, k, SMOOTH.bus);
    v.ferris = mix(a.ferris, b.ferris, k, SMOOTH.ferris);
    v.coaster = mix(a.coaster, b.coaster, k, SMOOTH.coaster);
    v.cars = mixList(a.cars, b.cars, k, SMOOTH.car, false);
    v.gondolas = mixList(a.gondolas.length === b.gondolas.length ? a.gondolas : null, b.gondolas, k, SMOOTH.gondola, false);
    v.projs = mixList(a.projs, b.projs, k, SMOOTH.proj);
    // you: the latest word from the server, with the predicted movement on top
    v.me = this.watching ? { ...SPECTATOR_ME } : L.me ? { ...L.me } : undefined;
    if (this.predicting && this.me) {
      const P = this.me;
      const mine = this.pred.playerView(P);
      mine.x += this.offset.x;
      mine.y += this.offset.y;
      mine.z += this.offset.z;
      const i = v.players.findIndex((p) => p.id === P.id);
      if (i >= 0) v.players[i] = mine;
      if (v.me) {
        v.me.stam = P.stam;
        v.me.charge = P.charge;
      }
    }
    if (this.watching) v.players.push({ ...this.spec });
    return v;
  }
}
