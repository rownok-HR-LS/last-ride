// Cuts recorded sounds (assets-src/sfx-src) into small mono MP3s in public/sfx, plus a manifest the game loads.
// Clips are trimmed of silence, faded, peak-normalised; loops get an equal-power crossfade so they repeat seamlessly.
// usage: node scripts/convert-sfx.mjs [name ...]   (names from the SFX table below; none = all)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';

const SRC = 'assets-src/sfx-src';
const OUT = 'public/sfx';
const SR = 44100;

const IMP = 'kenney/impact-sounds/Audio/';
const RPG = 'kenney/rpg-audio/Audio/';
const UI = 'kenney/interface-sounds/Audio/';
const SW = 'oga/swishes/swishes/';
const C = 'commons/';
const O = 'oga2/';
const SPL = O + 'water-splash-slime-sfx/';
const n3 = (pre, count, from = 0) => Array.from({ length: count }, (_, i) => `${pre}_${String(from + i).padStart(3, '0')}.ogg`);

/**
 * name -> { v: variants, each 'file' or ['file', start s, end s], peak (dBFS, default -1),
 * loop (crossfade seconds; the clip repeats), rate (output sample rate), q (LAME VBR quality, higher is smaller) }
 */
export const SFX = {
  // footsteps
  step_dirt: { v: n3(IMP + 'footstep_grass', 5), peak: -3 },
  step_stone: { v: n3(IMP + 'footstep_concrete', 5), peak: -3 },
  // melee
  swish: { v: Array.from({ length: 13 }, (_, i) => `${SW}swish-${i + 1}.wav`) },
  punch: { v: n3(IMP + 'impactPunch_heavy', 5) },
  punch_light: { v: n3(IMP + 'impactPunch_medium', 5) },
  flesh: { v: n3(IMP + 'impactSoft_heavy', 5) },
  slice: { v: [RPG + 'knifeSlice.ogg', RPG + 'knifeSlice2.ogg', RPG + 'chop.ogg'] },
  clang: { v: n3(IMP + 'impactMetal_heavy', 5) },
  clang_light: { v: n3(IMP + 'impactMetal_medium', 5) },
  crack: { v: n3(IMP + 'impactPlank_medium', 5) },
  chainsaw: { v: [[C + 'chainsaw.ogg', 4.3, 6.4]], peak: -2 },
  // ranged and thrown
  thud_wood: { v: n3(IMP + 'impactWood_light', 5) },
  glass: { v: n3(IMP + 'impactGlass_heavy', 5) },
  firework_pop: { v: [[C + 'fireworks.ogg', 6.9, 8.3], [C + 'fireworks.ogg', 14.2, 15.6], [C + 'fireworks.ogg', 20.9, 22.1], [C + 'fireworks.ogg', 50.7, 52.0]] },
  // body
  land: { v: n3(IMP + 'impactSoft_medium', 5) },
  cloth: { v: [RPG + 'cloth1.ogg', RPG + 'cloth2.ogg', RPG + 'cloth3.ogg', RPG + 'cloth4.ogg'] },
  grunt: {
    v: [[C + 'grunts.ogg', 0.4, 0.95], [C + 'grunts.ogg', 1.5, 2.2], [C + 'grunts.ogg', 2.7, 3.4], [C + 'grunts.ogg', 3.9, 4.45],
      [C + 'grunts.ogg', 5.0, 5.6], [C + 'grunts.ogg', 12.3, 13.2], [C + 'grunts.ogg', 21.3, 22.0], [C + 'grunts.ogg', 23.5, 24.2]],
  },
  grunt_death: { v: [[C + 'grunts.ogg', 5.9, 6.85], [C + 'grunts.ogg', 10.0, 11.4], [C + 'grunts.ogg', 15.95, 17.0]] },
  scream: { v: [[C + 'scream.mp3', 0, 3.2]] },
  // pickups, shops, UI
  coins: { v: [RPG + 'handleCoins.ogg', RPG + 'handleCoins2.ogg'] },
  latch: { v: [RPG + 'metalLatch.ogg', RPG + 'metalClick.ogg'] },
  creak: { v: [RPG + 'creak1.ogg', RPG + 'creak2.ogg', RPG + 'creak3.ogg'] },
  ui_click: { v: [UI + 'click_002.ogg', UI + 'click_003.ogg'], peak: -6 },
  ui_error: { v: [UI + 'error_004.ogg'], peak: -6 },
  // the night
  owl: { v: [[C + 'owl.mp3', 0, 7.85]], rate: 32000 },
  crow: { v: [[C + 'crow1.mp3', 0.3, 1.0], [C + 'crow2.mp3', 1.2, 3.45]], rate: 32000 },
  thunder_far: { v: [[C + 'thunder_rain.ogg', 2.2, 12.5]], rate: 32000, q: 6 },
  thunder_near: { v: [[C + 'thunder_close.flac', 6.4, 15.0], [C + 'thunder_close.flac', 20.7, 29.5]], rate: 32000, q: 6 },
  bus_door: { v: [[C + 'bus_door.ogg', 0.1, 4.0]] },
  // loops
  bus_loop: { v: [[C + 'bus_engine.ogg', 4, 15]], loop: 1, rate: 32000, q: 6 },
  rain_loop: { v: [[C + 'thunder_rain2.ogg', 20, 40]], loop: 2, rate: 32000, q: 6 },
  rain_in: { v: [[C + 'rain_window.ogg', 40, 58]], loop: 2, rate: 32000, q: 6 },
  // wet ground: steps through standing water, squelches in mud, splashes
  step_water: { v: [0, 1, 2, 3, 4].map((i) => `${O}footsteps_0/footsteps/water/${i}.ogg`), peak: -3 },
  squelch: { v: ['slime_02', 'slime_05', 'slime_08', 'slime_11'].map((n) => `${SPL}${n}.ogg`), peak: -4 },
  splash: { v: [[O + 'ws.mp3', 0.05, 0.6], [O + 'ws.mp3', 1.25, 1.9], ...['splash_02', 'splash_05', 'splash_09'].map((n) => `${SPL}${n}.ogg`)] },
  // voices: women's pain and death, breathing, the heart
  grunt_f: { v: [[0.45, 1.15], [2.05, 2.65], [3.65, 4.15], [4.95, 5.55], [7.35, 8.05], [9.35, 10.25], [11.65, 12.55]].map(([a, b]) => [O + 'female_hurt_grunts_groans_1.ogg', a, b]) },
  scream_f: { v: [1, 2, 3, 4].map((i) => `${O}female_screams/${i}.ogg`) },
  breath_loop: { v: [[C + 'breath3.ogg', 10, 26]], loop: 1.5, rate: 32000, q: 6 },
  pant: { v: [[O + 'breathing_tired.ogg', 0, 3.1]], rate: 32000 },
  heart_loop: { v: [[O + 'heartbeat_0.wav', 40, 52]], loop: 0.4, rate: 32000, q: 6 },
  // ghosts and the rides they take over
  trap_snap: { v: [[C + 'cabinet.ogg', 0.45, 0.75], [C + 'cabinet.ogg', 6.15, 6.45]] },
  groan: { v: [[C + 'clasp1.ogg', 12.5, 14.9], [C + 'clasp1.ogg', 16.2, 17.6], [C + 'clasp1.ogg', 20.5, 21.9], [C + 'handle_creak.ogg', 0.1, 1.0], [C + 'handle_creak.ogg', 1.3, 2.5]], rate: 32000 },
  power_down: { v: [[O + 'powerdown.wav', 0, 1.65]] },
  charge: { v: [[O + 'charge.wav', 0, 4.0]], rate: 32000 },
  crackle_loop: { v: [[O + 'crackleelectricityloop.wav', 0, 0.5]], loop: 0.08, rate: 32000 },
  whoosh: { v: [[0, 1.85], [1.9, 2.95], [3.0, 3.95], [4.0, 5.05]].map(([a, b]) => [O + 'whoosh2_0.wav', a, b]) },
  moan: { v: [[O + 'ghost.wav', 0.05, 1.85]] },
  // the score's beds
  score_drone: { v: [[O + 'freezer.ogg', 0, 30]], loop: 3, rate: 32000, q: 6 },
  score_dread: { v: [[O + 'evil.ogg', 0, 30]], loop: 2, rate: 32000, q: 6 },
};

function decode(file, start, end) {
  const args = ['-v', 'error'];
  if (start != null) args.push('-ss', String(start), '-to', String(end));
  args.push('-i', path.join(SRC, file), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-');
  const raw = execFileSync(ffmpeg, args, { maxBuffer: 1 << 30 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

/** Drop quiet head and tail (below -45 dB of the peak), keeping a few ms of lead-in. */
function trim(s) {
  let peak = 0;
  for (const x of s) peak = Math.max(peak, Math.abs(x));
  const th = peak * 0.0056;
  let a = 0;
  let b = s.length - 1;
  while (a < b && Math.abs(s[a]) < th) a++;
  while (b > a && Math.abs(s[b]) < th) b--;
  return s.slice(Math.max(0, a - SR * 0.004), Math.min(s.length, b + SR * 0.02));
}

function fade(s, inS, outS) {
  const fi = Math.min(s.length, Math.round(inS * SR));
  const fo = Math.min(s.length, Math.round(outS * SR));
  for (let i = 0; i < fi; i++) s[i] *= i / fi;
  for (let i = 0; i < fo; i++) s[s.length - 1 - i] *= i / fo;
}

/** Fold the last `x` seconds over the start with an equal-power crossfade; the result loops without a seam. */
function makeLoop(s, x) {
  const n = Math.round(x * SR);
  const out = s.slice(0, s.length - n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = s[i] * Math.sin((t * Math.PI) / 2) + s[s.length - n + i] * Math.cos((t * Math.PI) / 2);
  }
  return out;
}

function normalise(s, peakDb) {
  let peak = 0;
  for (const x of s) peak = Math.max(peak, Math.abs(x));
  const k = Math.pow(10, peakDb / 20) / (peak || 1);
  for (let i = 0; i < s.length; i++) s[i] *= k;
}

function encode(s, file, rate, q) {
  const pcm = Buffer.from(s.buffer, s.byteOffset, s.byteLength);
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-ar', String(rate),
    '-c:a', 'libmp3lame', '-q:a', String(q), file], { input: pcm });
}

mkdirSync(OUT, { recursive: true });
const manifestFile = path.join(OUT, 'sfx.json');
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
const want = process.argv.slice(2);
for (const name of want.length ? want : Object.keys(SFX)) {
  const def = SFX[name];
  if (!def) throw new Error(`unknown sound ${name}`);
  for (const f of readdirSync(OUT)) if (f.startsWith(name + '_') && /^\d+\.mp3$/.test(f.slice(name.length + 1))) unlinkSync(path.join(OUT, f));
  let bytes = 0;
  def.v.forEach((v, i) => {
    const [file, start, end] = Array.isArray(v) ? v : [v];
    let s = decode(file, start, end);
    if (def.loop) s = makeLoop(s, def.loop);
    else {
      s = trim(s);
      fade(s, 0.002, Math.min(0.04, (s.length / SR) * 0.2));
    }
    normalise(s, def.peak ?? -1);
    const out = path.join(OUT, `${name}_${i}.mp3`);
    encode(s, out, def.rate || SR, def.q ?? 4);
    bytes += readFileSync(out).length;
  });
  manifest[name] = def.loop ? { n: def.v.length, loop: true } : { n: def.v.length };
  console.log(`${name.padEnd(14)} ${def.v.length} clip(s)  ${(bytes / 1024).toFixed(0)} KB`);
}
for (const k of Object.keys(manifest)) if (!SFX[k]) delete manifest[k];
writeFileSync(manifestFile, JSON.stringify(manifest));
