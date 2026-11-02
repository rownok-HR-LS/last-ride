// What the game server and the browser agree on: timings and how messages are packed.

/** The park runs at 60 ticks a second; riders hear about it 20 times a second. */
export const TICK = 1 / 60;
export const SNAP_EVERY = 3;
/** The first bus waits this long for riders; after a ride ends, the next one leaves sooner. */
export const BUS_WAIT = 30;
export const BUS_AGAIN = 20;
/** How far behind the server other riders are drawn, so their motion is smooth between updates. */
export const INTERP = 0.1;

/** Smaller messages: numbers to the millimetre, and switched-off flags left out (they read back as undefined). */
export function pack(msg) {
  return JSON.stringify(msg, (k, v) => {
    if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 1000) / 1000;
    if (v === false) return undefined;
    return v;
  });
}

/** Input travels as a short array: [seq, fwd, side, up, yaw, pitch, ayaw, apitch, flags, aimAt, aimFrom, commands]. */
const FLAGS = ['fire', 'aim', 'jump', 'fast', 'sprint'];

export function packInput(seq, i, cmds) {
  let f = 0;
  FLAGS.forEach((k, b) => {
    if (i[k]) f |= 1 << b;
  });
  const r4 = (v) => Math.round((+v || 0) * 1e4) / 1e4;
  const r2 = (a) => (a ? a.map((v) => Math.round(v * 100) / 100) : 0);
  return [seq, i.fwd || 0, i.side || 0, i.up || 0, r4(i.yaw), r4(i.pitch), r4(i.ayaw ?? i.yaw), r4(i.apitch ?? i.pitch), f, r2(i.aimAt), r2(i.aimFrom), cmds?.length ? cmds : 0];
}

export function unpackInput(a) {
  if (!Array.isArray(a) || a.length < 12) return null;
  const input = { fwd: a[1], side: a[2], up: a[3], yaw: a[4], pitch: a[5], ayaw: a[6], apitch: a[7], aimAt: a[9] || null, aimFrom: a[10] || null };
  FLAGS.forEach((k, b) => {
    input[k] = !!(a[8] & (1 << b));
  });
  return { seq: a[0] | 0, input, cmds: Array.isArray(a[11]) ? a[11].slice(0, 6) : [] };
}
