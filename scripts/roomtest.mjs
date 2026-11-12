// The bus stop rules without a network: node scripts/roomtest.mjs
import { EventEmitter } from 'node:events';
import { Park } from '../server/room.js';

/** One park per test; `room` is its first (and, until someone is placed elsewhere, only) ride. */
class Room {
  constructor(opts) {
    this.park = new Park(opts);
  }
  connect(ws) {
    this.park.connect(ws);
  }
  get r() {
    return [...this.park.rooms.values()][0];
  }
  get busIn() {
    return this.r?.busIn ?? null;
  }
  get game() {
    return this.r?.game ?? null;
  }
  set graceUntil(v) {
    this.r.graceUntil = v;
  }
}
const ticks = (room, n) => {
  for (let i = 0; i < n; i++) (room.park ?? room).update();
};
function fakeWs(name) {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.got = [];
  ws.send = (s) => ws.got.push(JSON.parse(s));
  ws.say = (m) => ws.emit('message', JSON.stringify(m));
  ws.types = () => ws.got.map((m) => m.t).filter((t) => t !== 's' && t !== 'lobby');
  ws.name = name;
  return ws;
}
const ok = (cond, what) => {
  console.log(cond ? 'ok  ' : 'FAIL', what);
  if (!cond) process.exitCode = 1;
};

const room = new Room({ busWait: 1, busAgain: 1 });
const a = fakeWs('Ana');
const b = fakeWs('Ben');
room.connect(a);
a.say({ t: 'join', name: 'Ana', outfit: 'eric' });
ok(room.busIn === 1, 'the countdown starts as soon as someone waits');
ticks(room, 70);
ok(room.game && a.types().includes('start'), 'the bus leaves on the timer with the waiting rider');
ok(room.game.players.size === 20, 'bots fill the empty seats');
const code = a.got.find((m) => m.t === 'lobby')?.code;
ok(/^[A-Z2-9]{4}$/.test(code ?? ''), `each ride has a code for invite links (${code})`);
room.connect(b);
// Ben has Ana's invite link: he watches her ride, and boards its next bus with her
b.say({ t: 'join', name: 'Ben', outfit: 'carla', ride: code });
ticks(room, 6);
ok(b.types().includes('watch') && b.got.some((m) => m.t === 's' && m.loot?.full), 'an invited friend watches the ride under way, with the full loot list');
const before = a.got.filter((m) => m.t === 's').length;
ticks(room, 60);
ok(a.got.filter((m) => m.t === 's').length - before === 20, 'riders get updates 20 times a second');

// the ride ends
room.game.end(null);
ticks(room, 60 * 13);
ok(!room.game || room.game.phase !== 'end', 'the ride closes after the results');
ok(a.types().includes('over') && b.types().includes('over'), 'everyone hears the ride is over');
// the watcher is in line already; the rider asks to go again
a.say({ t: 'again' });
const startsBefore = (ws) => ws.types().filter((t) => t === 'start').length;
const [sa, sb] = [startsBefore(a), startsBefore(b)];
ticks(room, 70);
ok(startsBefore(a) === sa + 1 && startsBefore(b) === sb + 1, 'both board the next bus');
const humans = [...room.game.players.values()].filter((p) => !p.bot).map((p) => p.name);
ok(humans.length === 2, `two humans aboard (${humans.join(', ')})`);

// someone leaves mid-ride: a bot takes over
const aid = [...room.game.players.values()].find((p) => p.name === 'Ana').id;
a.emit('close', 1001);
ok(room.game.players.get(aid).bot === true, 'a rider who leaves is taken over by a bot');
// and comes back: the ticket from the bus gets the rider back from the bot
const ticketA = a.got.filter((m) => m.t === 'start').at(-1)?.ticket;
ok(!!ticketA, 'each rider gets a private ticket when the bus leaves');
const a2 = fakeWs('Ana again');
room.connect(a2);
a2.say({ t: 'rejoin', ticket: ticketA, name: 'Ana', outfit: 'eric' });
const back = a2.got.find((m) => m.t === 'start');
ok(back?.back && back.id === aid && room.game.players.get(aid).bot === false, 'back with the ticket: the same rider, yours again');
const a3 = fakeWs('Stranger');
room.connect(a3);
a3.say({ t: 'rejoin', ticket: 'made-up', name: 'Eve' });
ok(a3.types().includes('rejoinFail') && !a3.types().includes('watch') && room.park.rooms.size === 2, 'a wrong ticket gets in line like anyone: at a stop of their own, not watching');
a3.emit('close', 1001);
ticks(room, 2);
ok(room.park.rooms.size === 1, 'an empty stop is cleared away');
a2.emit('close', 1001);
b.emit('close', 1001);
ticks(room, 2);
ok(room.game !== null, 'an emptied ride waits a while for riders who are only reconnecting');
room.graceUntil = Date.now() - 1;
ticks(room, 2);
ok(room.game === null, 'then stops when nobody came back');

// several rides at once: a stranger who turns up mid-ride gets a bus of their own
{
  const P = new Park({ busWait: 0.1, busAgain: 0.1, maxRides: 2 });
  const [p1, p2, p3, p4, p5] = ['Pia', 'Quin', 'Rex', 'Sol', 'Tam'].map(fakeWs);
  P.connect(p1);
  p1.say({ t: 'join', name: 'Pia' });
  ticks(P, 10);
  P.connect(p2);
  p2.say({ t: 'join', name: 'Quin' });
  ok(!p2.types().includes('watch') && P.rooms.size === 2, 'a stranger arriving mid-ride gets their own stop, not a ghost');
  P.connect(p3);
  p3.say({ t: 'join', name: 'Rex' });
  ok(P.rooms.size === 2, 'and anyone arriving while that bus counts down boards the same one');
  const stop2 = p2.got.filter((m) => m.t === 'lobby').at(-1);
  ok(stop2.watchable === 1, 'the stop offers the ride under way to watch');
  ticks(P, 10);
  ok([...P.rooms.values()].every((r) => r.game) && p2.types().includes('start') && p3.types().includes('start'), 'both rides run at once');
  ok([...[...P.rooms.values()][1].game.players.values()].filter((p) => !p.bot).length === 2, 'the second bus left with both of them');
  // a third ride is over the limit: that bus waits for one to come back
  P.connect(p4);
  p4.say({ t: 'join', name: 'Sol' });
  ticks(P, 10);
  const r4 = p4.got.filter((m) => m.t === 'lobby').at(-1);
  ok(r4.held && !p4.types().includes('start'), 'over the limit, the bus is held: "all the buses are out"');
  // Tam would rather watch: off the stop, into a running ride's line
  P.connect(p5);
  p5.say({ t: 'join', name: 'Tam' });
  p5.say({ t: 'watch' });
  ticks(P, 4);
  ok(p5.types().includes('watch') && p5.got.some((m) => m.t === 's'), 'watching is a choice at the stop, and it works');
  const tam = [...P.conns].find((c) => c.name === 'Tam');
  const second = [...P.rooms.values()][1];
  ok(tam.room === second, 'the stop offers the busiest ride (two people riding) to watch');
  // the first ride ends (its only rider leaves): Sol's held bus leaves
  const first = [...P.rooms.values()][0];
  p1.emit('close', 1001);
  first.graceUntil = Date.now() - 1;
  ticks(P, 30);
  ok(p4.types().includes('start'), 'when a ride ends, the held bus leaves');
  // the watched ride ends: Tam hears it and boards that ride's next bus with its riders
  second.game.end(null);
  for (let i = 0; i < 60 * 13 && second.game; i++) P.update();
  ok(p5.types().includes('over') && tam.room === second && tam.ready, 'the watcher hears the ride end and is first in line there');
  p2.say({ t: 'again' });
  ticks(P, 30);
  ok(p5.types().includes('start') && p2.types().filter((t) => t === 'start').length === 2, 'and boards its next bus with the riders who go again');
  for (const w of [p2, p3, p4, p5]) w.emit('close', 1001);
  for (const r of P.rooms.values()) r.graceUntil = Date.now() - 1;
  ticks(P, 4);
  ok(P.rooms.size === 0 && P.info().online === 0, 'everyone gone: no rides, no stops');
}

// a late arrival is not kept watching a ride that only bots are left in
const roomW = new Room({ busWait: 0.1, busAgain: 0.1 });
const r1 = fakeWs('Rae');
roomW.connect(r1);
r1.say({ t: 'join', name: 'Rae' });
ticks(roomW, 10);
const code1 = r1.got.find((m) => m.t === 'lobby')?.code;
const w1 = fakeWs('Wes');
roomW.connect(w1);
w1.say({ t: 'join', name: 'Wes', ride: code1 });
ticks(roomW, 2);
r1.emit('close', 1001);
roomW.graceUntil = Date.now() - 1;
ticks(roomW, 2);
ok(roomW.game === null && w1.types().includes('over'), 'when the last rider leaves, the watcher is not kept watching bots');
ticks(roomW, 20);
ok(roomW.game && [...roomW.game.players.values()].some((p) => p.name === 'Wes' && !p.bot), 'and boards the next bus');

// input: one step per input, and no faster than the clock
const room2 = new Room({ busWait: 0.1 });
const c = fakeWs('Cy');
room2.connect(c);
c.say({ t: 'join', name: 'Cy' });
ticks(room2, 10);
const g = room2.game;
const me = [...g.players.values()].find((p) => !p.bot);
const flood = [];
for (let i = 1; i <= 12; i++) flood.push([i, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
c.say({ t: 'in', s: flood });
ticks(room2, 1);
ok(me.ack === 2, `a burst is worked off at most two inputs a tick (ack ${me.ack})`);
ticks(room2, 30);
ok(me.ack === 12, 'and all of it eventually');
