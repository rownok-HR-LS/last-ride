// Sound: recorded samples (public/sfx, cut by scripts/convert-sfx.mjs) for bodies, weapons and the night,
// layered over synthesised ride noises, ghost effects and a detuned music-box waltz. Any sound whose samples
// haven't loaded falls back to its synth version.
let ctx = null;
let master;
let sfx;
let amb;
let musicBus;
let verb;
let verbSend;
let noiseBuf;
const listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
/** Reverb send outdoors and inside a building. */
const ROOM = { open: 0.55, inside: 1.7 };
let occluded = null;
let muted = false;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  // if the browser held the sound back (or paused it with the tab), the next click, tap or key press wakes it
  const wake = () => {
    if (ctx.state === 'suspended') ctx.resume();
  };
  for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, wake, { capture: true });
  master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  sfx = ctx.createGain();
  sfx.connect(master);
  // the night around you (rain, wildlife, thunder) has its own level
  amb = ctx.createGain();
  amb.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0.32;
  musicBus.connect(master);
  applyVolumes();
  // reverb from a generated impulse
  verb = ctx.createConvolver();
  const len = ctx.sampleRate * 2.2;
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  verb.buffer = ir;
  const verbGain = ctx.createGain();
  verbGain.gain.value = 0.35;
  verb.connect(verbGain);
  verbGain.connect(master);
  // how much of each positioned sound reaches the reverb: a little in the open air, a lot between walls
  verbSend = ctx.createGain();
  verbSend.gain.value = ROOM.open;
  verbSend.connect(verb);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  loadSamples();
  startMusic();
}

// ------------------------------------------------------------------ recorded samples

const bank = {}; // name -> AudioBuffer[]
const lastPick = {};

async function loadSamples() {
  try {
    const man = await (await fetch('./sfx/sfx.json')).json();
    const jobs = [];
    for (const [name, { n }] of Object.entries(man)) {
      for (let i = 0; i < n; i++) {
        jobs.push(fetch(`./sfx/${name}_${i}.mp3`)
          .then((r) => r.arrayBuffer())
          .then((b) => ctx.decodeAudioData(b))
          .then((buf) => (bank[name] ||= []).push(buf))
          .catch(() => {}));
      }
    }
    await Promise.all(jobs);
  } catch {
    // no manifest: everything stays synthesised
  }
}

export function samplesLoaded() {
  return Object.keys(bank).length;
}

let samplesOn = true;
/** Debug A/B: false plays every sound as its synth stand-in. */
export function useSamples(on) {
  samplesOn = on;
}

/**
 * Play one random take of a recorded sound into `dest` (never the same take twice in a row).
 * `vary` spreads pitch and level so repeats don't sound machine-gunned. Returns null if not loaded.
 */
function sample(dest, name, t, { vol = 1, rate = 1, vary = 0.06, offset = 0 } = {}) {
  const set = bank[name];
  if (!set?.length || !dest || !samplesOn) return null;
  let i = Math.floor(Math.random() * set.length);
  if (set.length > 1 && i === lastPick[name]) i = (i + 1) % set.length;
  lastPick[name] = i;
  const src = ctx.createBufferSource();
  src.buffer = set[i];
  src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * vary);
  const g = ctx.createGain();
  g.gain.value = vol * (1 - Math.random() * vary * 2);
  src.connect(g);
  g.connect(dest);
  src.start(t, offset);
  return src;
}

const has = (name) => samplesOn && !!bank[name]?.length;

const volumes = { master: 0.8, music: 0.6, effects: 1, ambience: 0.9 };

/** Levels from the settings menu, 0..1 each: master, music, effects, ambience. */
export function setVolumes(v) {
  Object.assign(volumes, v);
  applyVolumes();
}

function applyVolumes() {
  if (!ctx) return;
  master.gain.value = muted ? 0 : volumes.master;
  sfx.gain.value = volumes.effects;
  amb.gain.value = volumes.ambience;
  // the music box was mixed at 0.32 when everything was at full; keep that balance
  musicBus.gain.value = 0.32 * (volumes.music / 0.6);
}

export function setMuted(m) {
  muted = m;
  applyVolumes();
}
export function isMuted() {
  return muted;
}

/** The ears: where they are and which way they face (fx, fy, fz: the look direction). */
export function setListener(x, y, z, fx, fy, fz) {
  listener.x = x;
  listener.y = y;
  listener.z = z;
  const l = Math.hypot(fx, fz) || 1;
  listener.rx = -fz / l;
  listener.rz = fx / l;
  if (!ctx) return;
  const L = ctx.listener;
  const t = ctx.currentTime;
  if (L.positionX) {
    L.positionX.setTargetAtTime(x, t, 0.02);
    L.positionY.setTargetAtTime(y, t, 0.02);
    L.positionZ.setTargetAtTime(z, t, 0.02);
    L.forwardX.setTargetAtTime(fx, t, 0.02);
    L.forwardY.setTargetAtTime(fy, t, 0.02);
    L.forwardZ.setTargetAtTime(fz, t, 0.02);
    L.upX.value = 0;
    L.upY.value = 1;
    L.upZ.value = 0;
  } else {
    L.setPosition(x, y, z);
    L.setOrientation(fx, fy, fz, 0, 1, 0);
  }
}

/** test(x, y, z) -> true when something solid stands between the ears and that point (sounds get muffled). */
export function setOcclusion(test) {
  occluded = test;
}

/** 0 = out in the open, 1 = inside a building: more echo between the walls. */
export function setRoom(k) {
  if (verbSend) verbSend.gain.setTargetAtTime(ROOM.open + (ROOM.inside - ROOM.open) * k, ctx.currentTime, 0.3);
}

/** Output node for a sound at an optional world position. Returns null when inaudible. ambient: the night's bus. */
function out(pos, vol = 1, range = 60, ambient = false) {
  const bus = ambient ? amb : sfx;
  if (!ctx) return null;
  const g = ctx.createGain();
  let gain = vol;
  let pan = 0;
  if (pos) {
    const dx = pos[0] - listener.x;
    const dy = pos[1] - listener.y;
    const dz = pos[2] - listener.z;
    const d = Math.hypot(dx, dy, dz);
    gain *= 1 / (1 + (d / range) * (d / range) * 4);
    if (gain < 0.01) return null;
    pan = Math.max(-1, Math.min(1, ((dx * listener.rx + dz * listener.rz) / Math.max(d, 1)) * 0.8));
  }
  g.gain.value = gain;
  let node = g;
  // through a wall it comes out dull and quieter (not for sounds right next to you)
  if (pos && occluded && Math.hypot(pos[0] - listener.x, pos[2] - listener.z) > 3 && occluded(pos[0], pos[1], pos[2])) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    g.gain.value = gain * 0.55;
    g.connect(lp);
    node = lp;
  }
  if (pos && ctx.createPanner) {
    // true 3D: in front, behind, above (we do the distance falloff ourselves, the panner only places it)
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.rolloffFactor = 0;
    if (p.positionX) {
      p.positionX.value = pos[0];
      p.positionY.value = pos[1];
      p.positionZ.value = pos[2];
    } else p.setPosition(pos[0], pos[1], pos[2]);
    node.connect(p);
    p.connect(bus);
    p.connect(verbSend);
  } else if (pos && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    p.connect(bus);
    p.connect(verbSend);
  } else node.connect(bus);
  return g;
}

function noise(dest, t, dur, { type = 'lowpass', freq = 2000, q = 1, vol = 1, sweepTo = null, attack = 0.002 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

function tone(dest, t, dur, { type = 'sine', freq = 440, to = null, vol = 0.5, attack = 0.005, detune = 0 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  o.detune.value = detune;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}


/** Called with (name, pos, opt) for every sound that has a place in the park, even when muted: sound captions. */
let cueHook = null;
export function onCue(fn) {
  cueHook = fn;
}

export function play(name, pos = null, opt = {}) {
  if (pos && cueHook) cueHook(name, pos, opt);
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  switch (name) {
    case 'step': {
      // a heel strike: soft thud on dirt, a gritty click on cobbles
      const d = out(pos, (opt.self ? 0.22 : 0.35) * (opt.run ? 1.2 : 0.8), 22);
      if (!d) return;
      if (sample(d, opt.surface === 'stone' ? 'step_stone' : 'step_dirt', t, { vol: opt.surface === 'stone' ? 0.9 : 0.5, rate: opt.run ? 1.05 : 0.95, vary: 0.08 })) {
        // the rain has soaked everything: water slaps on the cobbles, mud sucks at the shoes
        const wet = opt.wet ?? 0;
        if (wet > 0.05) {
          if (opt.surface === 'stone') sample(d, 'step_water', t + 0.01, { vol: 0.5 * wet * (opt.run ? 1.3 : 1), rate: 1.05 });
          else sample(d, 'squelch', t + 0.02, { vol: 0.28 * wet, rate: 0.75 + Math.random() * 0.15 });
          if (opt.run && Math.random() < 0.18 * wet) sample(d, 'splash', t + 0.02, { vol: 0.35, rate: 1.3 });
        }
        break;
      }
      if (opt.surface === 'stone') {
        noise(d, t, 0.06, { type: 'bandpass', freq: 2400 + Math.random() * 800, q: 1.2, vol: 0.7 });
        tone(d, t, 0.05, { freq: 110 + Math.random() * 30, to: 60, vol: 0.5 });
      } else {
        noise(d, t, 0.09, { type: 'lowpass', freq: 700 + Math.random() * 300, vol: 0.9 });
        noise(d, t + 0.01, 0.12, { type: 'bandpass', freq: 3200, q: 0.7, vol: 0.12 });
      }
      break;
    }
    case 'swing': {
      // a whoosh through the air: heavier weapons are lower and longer
      const d = out(pos, opt.heavy ? 0.8 : 0.55, 25);
      if (!d) return;
      const big = { sledge: 1, axe: 0.7, lever: 0.6 }[opt.w] || (opt.w === 'fists' ? 0 : 0.3);
      // a grunt of effort behind a heavy swing
      if (opt.heavy) sample(d, opt.female ? 'grunt_f' : 'grunt', t, { vol: 0.35, rate: (opt.female ? 1.08 : 1.12), vary: 0.04 });
      if (opt.w === 'chainsaw') sample(d, 'chainsaw', t, { vol: 0.8, vary: 0.04 });
      // a recorded swish, slowed down for heavy weapons and charged swings
      if (sample(d, 'swish', t + 0.02, { vol: 0.38 + big * 0.1, rate: (1.12 - big * 0.4) * (opt.heavy ? 0.85 : 1), vary: 0.07 })) break;
      noise(d, t, 0.18 + big * 0.12, { type: 'bandpass', freq: 1400 - big * 600, sweepTo: 500 - big * 200, q: 1.4, vol: 0.9, attack: 0.05 });
      if (opt.w === 'chainsaw') tone(d, t, 0.2, { type: 'sawtooth', freq: 95, vol: 0.35, detune: Math.random() * 40 });
      break;
    }
    case 'impact': {
      // blunt thud for clubs, a wet chop for blades
      const d = out(pos, opt.heavy ? 1 : 0.75, 30);
      if (!d) return;
      const blade = ['machete', 'axe', 'spike', 'chainsaw'].includes(opt.w);
      if (has('punch')) {
        // blades bite and cut; clubs and fists land a heavy body blow; both get a wet flesh layer
        if (blade) sample(d, 'slice', t, { vol: 0.8, rate: opt.heavy ? 0.85 : 1 });
        sample(d, opt.heavy || (!blade && opt.w !== 'fists') ? 'punch' : 'punch_light', t, { vol: blade ? 0.6 : 1, rate: opt.heavy ? 0.82 : 0.95 });
        sample(d, 'flesh', t + 0.005, { vol: blade ? 0.8 : 0.5, rate: 0.9 });
        break;
      }
      tone(d, t, 0.14, { freq: opt.heavy ? 95 : 140, to: 45, vol: 1 });
      noise(d, t, blade ? 0.16 : 0.1, { freq: blade ? 3200 : 900, sweepTo: 300, vol: blade ? 0.9 : 1.1 });
      break;
    }
    case 'block': {
      const d = out(pos, 0.8, 30);
      if (!d) return;
      if (opt.parry && sample(d, 'clang', t, { vol: 1, rate: 1.3 })) {
        // a parry rings out brighter and longer than a plain block
        sample(d, 'clang_light', t + 0.01, { vol: 0.6, rate: 1.6 });
        tone(d, t, 0.7, { type: 'triangle', freq: 2100, vol: 0.12 });
        break;
      }
      if (sample(d, opt.broke ? 'clang' : 'clang_light', t, { vol: 0.85 })) {
        if (opt.broke) sample(d, 'crack', t + 0.04, { vol: 0.7, rate: 0.85 });
        break;
      }
      // metal on metal (or wood) ringing out
      [1180, 1730, 2540].forEach((f, i) => tone(d, t, 0.35 - i * 0.08, { type: 'triangle', freq: f, vol: 0.28, detune: Math.random() * 30 }));
      noise(d, t, 0.05, { type: 'highpass', freq: 3000, vol: 0.8 });
      if (opt.broke) tone(d, t + 0.05, 0.4, { type: 'sawtooth', freq: 220, to: 70, vol: 0.4 });
      break;
    }
    case 'break': {
      const d = out(pos, 0.8, 30);
      if (!d) return;
      // the weapon gives out: a splintering crack and a loose rattle
      if (sample(d, 'crack', t, { vol: 1, rate: 0.9 })) {
        sample(d, 'clang_light', t + 0.06, { vol: 0.45, rate: 1.2 });
        break;
      }
      noise(d, t, 0.12, { type: 'highpass', freq: 1500, vol: 1 });
      noise(d, t + 0.04, 0.3, { freq: 900, sweepTo: 200, vol: 0.6 });
      break;
    }
    case 'fire': {
      const d = out(pos, opt.self ? 0.7 : 0.8, opt.kind === 'fireworks' ? 90 : 40);
      if (!d) return;
      // the recorded layer: the shot leaving (a swish), plus a latch for the crossbow and a steel clank for the harpoon
      if (opt.kind !== 'fireworks') sample(d, 'swish', t + 0.01, { vol: 0.25, rate: opt.kind === 'harpoon' ? 0.7 : 1.3 });
      if (opt.kind === 'crossbow') sample(d, 'latch', t, { vol: 0.7, rate: 0.9 });
      if (opt.kind === 'harpoon') sample(d, 'clang_light', t, { vol: 0.5, rate: 0.7 });
      if (opt.kind === 'bow') {
        tone(d, t, 0.18, { type: 'triangle', freq: 180, to: 120, vol: 0.6 });
        noise(d, t, 0.08, { type: 'bandpass', freq: 900, q: 3, vol: 0.5 });
      } else if (opt.kind === 'crossbow') {
        noise(d, t, 0.05, { type: 'highpass', freq: 2000, vol: 0.9 });
        tone(d, t, 0.14, { type: 'triangle', freq: 260, to: 140, vol: 0.6 });
      } else if (opt.kind === 'harpoon') {
        noise(d, t, 0.25, { freq: 1600, sweepTo: 300, vol: 1 });
        tone(d, t, 0.2, { freq: 110, to: 50, vol: 0.8 });
      } else if (opt.kind === 'fireworks') {
        noise(d, t, 0.9, { type: 'bandpass', freq: 2500, sweepTo: 5000, q: 2, vol: 0.7, attack: 0.03 });
        tone(d, t + 0.1, 0.9, { type: 'sine', freq: 1800, to: 2600, vol: 0.12 });
      } else if (!has('swish')) {
        // darts and thrown flasks
        noise(d, t, 0.14, { type: 'bandpass', freq: 1800, sweepTo: 900, q: 2, vol: 0.5, attack: 0.03 });
      }
      break;
    }
    case 'stick': {
      const d = out(pos, 0.5, 25);
      if (!d) return;
      if (sample(d, 'thud_wood', t, { vol: 0.9, rate: 1.1 })) break;
      tone(d, t, 0.08, { freq: 300, to: 120, vol: 0.6 });
      noise(d, t, 0.04, { type: 'highpass', freq: 2200, vol: 0.4 });
      break;
    }
    case 'splash': {
      const d = out(pos, 0.9, 35);
      if (!d) return;
      // glass breaks, holy water hisses
      if (sample(d, 'glass', t, { vol: 0.9 })) {
        noise(d, t + 0.05, 0.6, { type: 'highpass', freq: 3000, sweepTo: 1200, vol: 0.35, attack: 0.05 });
        break;
      }
      [2800, 3600, 4700].forEach((f, i) => tone(d, t + i * 0.015, 0.12, { type: 'triangle', freq: f, vol: 0.2 }));
      noise(d, t, 0.6, { type: 'highpass', freq: 3000, sweepTo: 1200, vol: 0.6, attack: 0.02 });
      break;
    }
    case 'flare': {
      const d = out(pos, 0.7, 40);
      if (!d) return;
      noise(d, t, 1.2, { type: 'bandpass', freq: 3500, q: 0.8, vol: 0.6, attack: 0.05 });
      break;
    }
    case 'salt': {
      const d = out(pos, 0.6, 20);
      if (!d) return;
      noise(d, t, 0.8, { type: 'highpass', freq: 5000, vol: 0.45, attack: 0.1 });
      break;
    }
    case 'relic': {
      const d = out(pos, 0.7, 40);
      if (!d) return;
      // a choir chord
      [392, 494, 587, 784].forEach((f) => tone(d, t, 1.8, { type: 'sine', freq: f, vol: 0.12, attack: 0.3, detune: Math.random() * 10 }));
      break;
    }
    case 'burn': {
      const d = out(pos, 0.9, 50);
      if (!d) return;
      tone(d, t, 0.9, { type: 'sawtooth', freq: 900, to: 180, vol: 0.25 });
      noise(d, t, 0.9, { type: 'bandpass', freq: 1200, sweepTo: 400, q: 3, vol: 0.5 });
      break;
    }
    case 'slide': {
      // skidding on grit: a long scrape that fades as you slow down
      const d = out(pos, opt.self ? 0.45 : 0.6, 25);
      if (!d) return;
      sample(d, 'cloth', t, { vol: 0.5, rate: 0.8 });
      sample(d, 'splash', t + 0.03, { vol: 0.5, rate: 0.8 });
      noise(d, t, 0.75, { type: 'bandpass', freq: 1600, sweepTo: 500, q: 0.9, vol: 0.7, attack: 0.02 });
      noise(d, t, 0.5, { type: 'lowpass', freq: 400, vol: 0.5 });
      break;
    }
    case 'owl': {
      // a tawny owl far off in the trees: a hoot, a pause, a long wavering one
      const d = out(pos, 0.5, 120, true);
      if (!d) return;
      if (sample(d, 'owl', t, { vol: 0.7, vary: 0.03 })) break;
      const hoot = (at, dur, f0) => {
        const o = tone(d, at, dur, { freq: f0, to: f0 * 0.9, vol: 0.35, attack: 0.05 });
        const v = ctx.createOscillator();
        v.frequency.value = 7;
        const vd = ctx.createGain();
        vd.gain.value = 9;
        v.connect(vd);
        vd.connect(o.frequency);
        v.start(at);
        v.stop(at + dur);
      };
      hoot(t, 0.35, 410);
      hoot(t + 0.9, 0.18, 400);
      hoot(t + 1.2, 0.8, 395);
      break;
    }
    case 'crow': {
      const d = out(pos, 0.45, 120, true);
      if (!d) return;
      if (sample(d, 'crow', t, { vol: 0.35, vary: 0.05 })) break;
      for (const at of [0, 0.42, 0.8]) {
        tone(d, t + at, 0.26, { type: 'sawtooth', freq: 620, to: 430, vol: 0.12, attack: 0.02 });
        noise(d, t + at, 0.24, { type: 'bandpass', freq: 1400, q: 3, vol: 0.25, attack: 0.02 });
      }
      break;
    }
    case 'twig': {
      // something stepped on a dry branch, just off the road
      const d = out(pos, 0.7, 90, true);
      if (!d) return;
      noise(d, t, 0.05, { type: 'highpass', freq: 2500, vol: 0.9 });
      noise(d, t + 0.07, 0.04, { type: 'highpass', freq: 3000, vol: 0.6 });
      break;
    }
    case 'creak': {
      // old steel moving in the wind: a slow, groaning bend with a rattle of loose bolts
      const d = out(pos, 0.5, 90, true);
      if (!d) return;
      // half the time a recorded hinge creak slowed right down, so it groans like a big rusted joint
      if (Math.random() < 0.5 && sample(d, 'creak', t, { vol: 0.6, rate: 0.45 + Math.random() * 0.2, vary: 0 })) break;
      const f0 = 140 + Math.random() * 160;
      const dur = 0.9 + Math.random() * 1.2;
      const o = tone(d, t, dur, { type: 'sawtooth', freq: f0, to: f0 * (0.7 + Math.random() * 0.5), vol: 0.06, attack: 0.25 });
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f0 * 3;
      bp.Q.value = 6;
      o.disconnect();
      o.connect(bp);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      bp.connect(g);
      g.connect(d);
      for (let i = 0; i < 3; i++) noise(d, t + dur * (0.5 + Math.random() * 0.5), 0.03, { type: 'highpass', freq: 3500, vol: 0.25 });
      break;
    }
    case 'thunderNear': {
      // a strike close by: the crack, then the roll
      const d = out(null, 0.5, 60, true);
      if (sample(d, 'thunder_near', t, { vol: 0.5 / Math.max(0.5, opt.km || 1), rate: 0.9 + Math.random() * 0.15, vary: 0 })) break;
    }
    // falls through to the rumble when the recording isn't loaded
    case 'thunder': {
      // a storm a long way off: a low rolling rumble
      const d = out(null, 0.5, 60, true);
      if (sample(d, 'thunder_far', t, { vol: opt.km ? Math.min(0.35, 0.6 / opt.km) : 0.25, rate: 0.85 + Math.random() * 0.2, vary: 0 })) break;
      noise(d, t, 3.5, { type: 'lowpass', freq: 160, sweepTo: 60, vol: 0.9, attack: 0.4 });
      noise(d, t + 0.3, 2.5, { type: 'lowpass', freq: 90, vol: 0.6, attack: 0.6 });
      break;
    }
    case 'power': {
      // a breaker thrown somewhere: a heavy clunk, then the mains hum swelling as the lamps warm up
      const d = out(pos, 0.9, 140);
      if (!d) return;
      tone(d, t, 0.4, { freq: 70, to: 40, vol: 0.6 });
      noise(d, t, 0.15, { type: 'lowpass', freq: 600, vol: 0.7 });
      tone(d, t + 0.1, 3.5, { type: 'sawtooth', freq: 60, vol: 0.08, attack: 1.2 });
      tone(d, t + 0.1, 3.5, { type: 'sine', freq: 120, vol: 0.1, attack: 1.2 });
      break;
    }
    case 'dodge': {
      const d = out(pos, 0.4, 20);
      if (!d) return;
      if (sample(d, 'cloth', t, { vol: 0.3, rate: 1.1 })) {
        sample(d, 'swish', t + 0.03, { vol: 0.2, rate: 0.7 });
        break;
      }
      noise(d, t, 0.22, { type: 'bandpass', freq: 700, sweepTo: 300, q: 1.2, vol: 0.6, attack: 0.03 });
      break;
    }
    case 'bought': {
      const d = out(null, 0.5);
      if (sample(d, 'coins', t, { vol: 0.9 })) break;
      [1046, 1318, 1568, 2093].forEach((f, i) => tone(d, t + i * 0.05, 0.3, { type: 'triangle', freq: f, vol: 0.3 }));
      break;
    }
    case 'reload': {
      const d = out(pos, 0.5, 15);
      if (!d) return;
      if (sample(d, 'latch', t, { vol: 0.9 })) {
        sample(d, 'latch', t + 0.35, { vol: 0.8, rate: 1.15 });
        break;
      }
      noise(d, t, 0.05, { type: 'highpass', freq: 3000, vol: 0.6 });
      noise(d, t + 0.35, 0.06, { type: 'highpass', freq: 2500, vol: 0.7 });
      break;
    }
    case 'pickup': {
      const d = out(null, 0.35);
      tone(d, t, 0.12, { type: 'triangle', freq: 880, vol: 0.4 });
      tone(d, t + 0.06, 0.16, { type: 'triangle', freq: 1320, vol: 0.4 });
      break;
    }
    case 'chest': {
      const d = out(pos, 0.6, 25);
      if (!d) return;
      // the lid's hinge creaks open, then the prize chime
      const lid = sample(d, 'creak', t, { vol: 0.5, rate: 1.1 }) ? 0.25 : 0;
      [523, 659, 784, 1046, 1318].forEach((f, i) => tone(d, t + lid + i * 0.06, 0.4, { type: 'triangle', freq: f, vol: lid ? 0.2 : 0.35 }));
      break;
    }
    case 'cannon': {
      const d = out(pos, 1.3, 200);
      if (!d) return;
      noise(d, t, 1.4, { freq: 900, sweepTo: 80, vol: 1.2 });
      tone(d, t, 0.9, { freq: 90, to: 30, vol: 1 });
      break;
    }
    case 'whoosh': {
      const d = out(null, 0.5);
      noise(d, t, 1.6, { type: 'bandpass', freq: 400, sweepTo: 2500, q: 2, vol: 0.6, attack: 0.3 });
      break;
    }
    case 'chute': {
      const d = out(pos, 0.6, 40);
      if (!d) return;
      if (sample(d, 'cloth', t, { vol: 0.4, rate: 0.7 })) break;
      noise(d, t, 0.35, { type: 'bandpass', freq: 600, q: 1.5, vol: 0.9 });
      break;
    }
    case 'land': {
      const d = out(pos, 0.5, 25);
      if (!d) return;
      if (sample(d, 'land', t, { vol: 1, rate: 0.85 })) {
        sample(d, 'splash', t + 0.02, { vol: 0.45, rate: 0.9 });
        break;
      }
      tone(d, t, 0.2, { freq: 120, to: 50, vol: 0.7 });
      break;
    }
    case 'hit': {
      const d = out(null, 0.4);
      tone(d, t, 0.07, { type: 'square', freq: opt.head ? 1700 : 1100, vol: 0.25 });
      if (opt.head) tone(d, t + 0.04, 0.2, { type: 'sine', freq: 2400, vol: 0.3 });
      break;
    }
    case 'pain': {
      // someone else takes a hit and cries out
      const d = out(pos, 0.8, 35);
      if (!d) return;
      sample(d, opt.female ? 'grunt_f' : 'grunt', t + 0.03, { vol: 0.55, vary: 0.05 });
      break;
    }
    case 'hurt': {
      const d = out(null, 0.5);
      if (sample(d, opt.female ? 'grunt_f' : 'grunt', t + 0.02, { vol: 0.5, vary: 0.05 })) {
        noise(d, t, 0.12, { freq: 500, vol: 0.4 });
        break;
      }
      noise(d, t, 0.15, { freq: 600, vol: 0.8 });
      tone(d, t, 0.2, { type: 'sawtooth', freq: 160, to: 90, vol: 0.3 });
      break;
    }
    case 'kill': {
      const d = out(null, 0.5);
      [784, 988, 1175].forEach((f, i) => tone(d, t + i * 0.07, 0.3, { type: 'square', freq: f, vol: 0.18 }));
      break;
    }
    case 'death': {
      const d = out(null, 0.8);
      // the last breath, then the world drains away beneath it
      const voiced = opt.female ? sample(d, 'scream_f', t, { vol: 0.7, rate: 0.95, vary: 0.03 }) : sample(d, 'grunt_death', t, { vol: 0.9, vary: 0.03 });
      tone(d, t, 1.6, { type: 'sawtooth', freq: 300, to: 60, vol: voiced ? 0.15 : 0.4 });
      tone(d, t, 1.6, { type: 'sine', freq: 151, to: 31, vol: 0.5 });
      break;
    }
    case 'steal': {
      const d = out(null, 0.8);
      [220, 330, 440, 660, 880].forEach((f, i) => tone(d, t + i * 0.05, 0.6, { type: 'sawtooth', freq: f, vol: 0.18, detune: 12 }));
      noise(d, t, 0.8, { type: 'bandpass', freq: 3000, sweepTo: 300, q: 3, vol: 0.5 });
      break;
    }
    case 'ghost': {
      const d = out(pos, 0.45, 30);
      if (!d) return;
      if (sample(d, 'moan', t, { vol: 0.8, rate: 0.8 + Math.random() * 0.2 })) break;
      const o = tone(d, t, 1.2, { type: 'sine', freq: 520, to: 340, vol: 0.4, attack: 0.2 });
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 7;
      lg.gain.value = 18;
      lfo.connect(lg);
      lg.connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + 1.3);
      break;
    }
    case 'possess': {
      // a ghost pours itself into the machine: a rush of air, power surging back into dead wiring, old steel groaning
      const d = out(pos, 0.7, 60);
      if (!d) return;
      if (sample(d, 'whoosh', t, { vol: 0.7, rate: 0.7 })) {
        sample(d, 'charge', t + 0.15, { vol: 0.55 });
        sample(d, 'groan', t + 0.4, { vol: 0.6, rate: 0.6 });
        break;
      }
      [110, 138.6, 164.8, 207.7].forEach((f) => tone(d, t, 1.6, { type: 'sawtooth', freq: f, vol: 0.12, attack: 0.3, detune: Math.random() * 20 }));
      break;
    }
    case 'fling': {
      const d = out(pos, 0.8, 80);
      if (!d) return;
      // the wheel wrenches a gondola loose
      sample(d, 'groan', t, { vol: 0.9, rate: 0.5 });
      sample(d, 'whoosh', t + 0.25, { vol: 0.6, rate: 0.6 });
      tone(d, t, 0.5, { type: 'sawtooth', freq: 90, to: 140, vol: 0.25 });
      noise(d, t + 0.1, 1.0, { type: 'bandpass', freq: 300, sweepTo: 1500, q: 2, vol: 0.5, attack: 0.2 });
      break;
    }
    case 'boom': {
      const d = out(pos, 1.2, 90);
      if (!d) return;
      // a real firework report rolling off the buildings, or a gondola smashing into the ground
      const real = opt.kind === 'firework' ? sample(d, 'firework_pop', t, { vol: 1.1, rate: 0.9 })
        : opt.kind === 'gondola' && sample(d, 'clang', t, { vol: 1, rate: 0.6 }) && sample(d, 'crack', t + 0.03, { vol: 0.8, rate: 0.6 });
      noise(d, t, 1.2, { freq: 1200, sweepTo: 60, vol: real ? 0.6 : 1.3 });
      tone(d, t, 0.8, { freq: 70, to: 25, vol: 1 });
      if (opt.kind === 'gondola' && !real) noise(d, t, 0.4, { type: 'highpass', freq: 2500, vol: 0.6 });
      break;
    }
    case 'snap': {
      const d = out(pos, 0.9, 30);
      if (!d) return;
      // the jaws slam shut
      if (sample(d, 'trap_snap', t, { vol: 1, rate: 1.1 })) {
        sample(d, 'clang', t, { vol: 0.6, rate: 1.4 });
        break;
      }
      noise(d, t, 0.12, { type: 'highpass', freq: 3500, vol: 1 });
      tone(d, t, 0.4, { type: 'square', freq: 1800, to: 1200, vol: 0.12 });
      break;
    }
    case 'honk': {
      // a bumper car slams into something: rubber, steel and a spark
      const d = out(pos, 0.7, 40);
      if (!d) return;
      if (sample(d, 'punch', t, { vol: 0.9, rate: 0.7 })) {
        sample(d, 'clang_light', t, { vol: 0.6, rate: 0.8 });
        sample(d, 'charge', t + 0.02, { vol: 0.2, rate: 2.2 });
        break;
      }
      tone(d, t, 0.18, { type: 'square', freq: 392, vol: 0.2 });
      tone(d, t + 0.2, 0.25, { type: 'square', freq: 330, vol: 0.2 });
      break;
    }
    case 'scream': {
      const d = out(null, 1);
      if (sample(d, 'scream', t, { vol: 0.9, rate: 0.9 + Math.random() * 0.15, vary: 0 })) {
        tone(d, t, 0.25, { type: 'square', freq: 60, vol: 0.4 });
        break;
      }
      const o = tone(d, t, 1.2, { type: 'sawtooth', freq: 1100, to: 500, vol: 0.35, attack: 0.02 });
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 11;
      lg.gain.value = 60;
      lfo.connect(lg);
      lg.connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + 1.3);
      noise(d, t, 0.9, { type: 'bandpass', freq: 2500, q: 4, vol: 0.6 });
      tone(d, t, 0.25, { type: 'square', freq: 60, vol: 0.5 });
      break;
    }
    case 'blackout': {
      const d = out(pos, 0.8, 70);
      if (!d) return;
      // the power dies across the area with a last crackle
      if (sample(d, 'power_down', t, { vol: 1, rate: 0.8 })) {
        sample(d, 'charge', t, { vol: 0.25, rate: 1.6 });
        break;
      }
      tone(d, t, 1.2, { type: 'sawtooth', freq: 120, to: 20, vol: 0.3 });
      noise(d, t, 0.2, { type: 'highpass', freq: 4000, vol: 0.4 });
      break;
    }
    case 'steps': {
      const d = out(pos, 0.8, 30);
      if (!d) return;
      // phantom footsteps: real steps, wet, walking along
      if (has('step_stone')) {
        for (let i = 0; i < 8; i++) {
          sample(d, i % 3 ? 'step_stone' : 'step_dirt', t + i * 0.45, { vol: 0.7 });
          sample(d, 'step_water', t + i * 0.45 + 0.01, { vol: 0.35 });
        }
        break;
      }
      for (let i = 0; i < 8; i++) tone(d, t + i * 0.45, 0.12, { freq: 90 + (i % 2) * 15, to: 50, vol: 0.5 });
      break;
    }
    case 'clack': {
      // the coaster train over a rail joint
      const d = out(pos, 0.6, 70);
      if (!d) return;
      sample(d, 'clang_light', t, { vol: 0.5, rate: 0.55, vary: 0.1 });
      sample(d, 'thud_wood', t + 0.01, { vol: 0.6, rate: 0.7 });
      break;
    }
    case 'trapSet': {
      const d = out(pos, 0.3, 15);
      if (!d) return;
      if (sample(d, 'latch', t, { vol: 0.6, rate: 0.8 })) break;
      noise(d, t, 0.08, { type: 'highpass', freq: 3000, vol: 0.5 });
      break;
    }
    case 'storm': {
      const d = out(null, 0.5);
      sample(d, 'thunder_near', t, { vol: 0.35, vary: 0.03 });
      noise(d, t, 2.5, { type: 'lowpass', freq: 300, sweepTo: 900, vol: 0.6, attack: 0.5 });
      break;
    }
    case 'final': {
      const d = out(null, 0.8);
      [261.6, 311.1, 370, 523.2].forEach((f, i) => tone(d, t + i * 0.12, 1.2, { type: 'sawtooth', freq: f, vol: 0.15 }));
      break;
    }
    case 'win': {
      const d = out(null, 0.8);
      [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(d, t + i * 0.13, 0.5, { type: 'square', freq: f, vol: 0.16 }));
      break;
    }
    case 'hiss': {
      // the bus door: air brakes and a hiss
      const d = out(pos, 0.7, 35);
      if (!d) return;
      if (sample(d, 'bus_door', t, { vol: 1.4, vary: 0.03 })) break;
      noise(d, t, 0.6, { type: 'highpass', freq: 2500, sweepTo: 5000, vol: 0.8, attack: 0.01 });
      tone(d, t, 0.2, { type: 'square', freq: 90, to: 60, vol: 0.15 });
      break;
    }
    case 'click': {
      const d = out(null, 0.3);
      if (sample(d, 'ui_click', t, { vol: 0.8, vary: 0.03 })) break;
      tone(d, t, 0.04, { type: 'square', freq: 1400, vol: 0.2 });
      break;
    }
    case 'deny': {
      const d = out(null, 0.3);
      if (sample(d, 'ui_error', t, { vol: 0.8, vary: 0.02 })) break;
      tone(d, t, 0.15, { type: 'square', freq: 180, vol: 0.2 });
      break;
    }
    default:
  }
}

// ------------------------------------------------------------------ continuous loops

const loops = {};
/** Loops that belong to the night rather than the action (they follow the ambience volume). */
const AMBIENT_LOOPS = new Set(['rain', 'rainIn', 'introPad', 'stormDrone']);
const RECORDED_LOOP = {
  bus: 'bus_loop', rain: 'rain_loop', rainIn: 'rain_in',
  breath: 'breath_loop', heart: 'heart_loop', carHum: 'crackle_loop', scoreDrone: 'score_drone', scoreDread: 'score_dread',
};
/** Loops with no synthesised stand-in (silent until their recording loads). */
const RECORDED_ONLY = new Set(['breath', 'heart', 'carHum', 'scoreDrone', 'scoreDread']);
/** Loops that are part of the score (they follow the music volume). */
const MUSIC_LOOPS = new Set(['scoreDrone', 'scoreDread']);

/** Speed up or slow down a recorded loop (a racing heart). */
export function loopRate(name, rate) {
  const l = loops[name];
  if (l?.src) l.src.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.4);
}

/** Fade a named looping sound toward a target volume (e.g. coaster rumble, storm drone). */
export function loop(name, vol, pos = null) {
  if (!ctx) return;
  let l = loops[name];
  const rec = RECORDED_LOOP[name];
  if (l?.synth && has(rec)) {
    // the recording finished loading after the synth stand-in started: crossfade over to it
    l.g.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    const old = l.g;
    setTimeout(() => old.disconnect(), 3000);
    l = loops[name] = null;
  }
  if (!l && rec && has(rec)) {
    if (vol <= 0.001) return;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(AMBIENT_LOOPS.has(name) ? amb : MUSIC_LOOPS.has(name) ? musicBus : sfx);
    const src = ctx.createBufferSource();
    src.buffer = bank[rec][0];
    src.loop = true;
    // skip the MP3 encoder's silent padding so the seam stays tight
    const d = src.buffer.getChannelData(0);
    let a = 0;
    let b = d.length - 1;
    while (a < d.length / 4 && Math.abs(d[a]) < 1e-4) a++;
    while (b > a && Math.abs(d[b]) < 1e-4) b--;
    src.loopStart = a / src.buffer.sampleRate;
    src.loopEnd = (b + 1) / src.buffer.sampleRate;
    src.connect(g);
    src.start(0, src.loopStart + Math.random() * (src.loopEnd - src.loopStart));
    l = loops[name] = { g, src };
  }
  if (!l && RECORDED_ONLY.has(name)) return;
  if (!l) {
    if (vol <= 0.001) return;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(AMBIENT_LOOPS.has(name) ? amb : sfx);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    if (name === 'coaster' || name === 'bus') {
      f.type = 'lowpass';
      f.frequency.value = 260;
    } else {
      f.type = 'lowpass';
      f.frequency.value = 500;
    }
    src.connect(f);
    if (name === 'introPad') {
      // no noise: a low A-minor drone that slowly breathes
      for (const [freq, type, vol] of [[55, 'sine', 0.5], [110, 'triangle', 0.22], [130.8, 'sine', 0.16], [164.8, 'sine', 0.12], [82.4, 'sine', 0.2]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        o.detune.value = (Math.random() - 0.5) * 12;
        const og = ctx.createGain();
        og.gain.value = vol;
        // each voice swells on its own slow cycle
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.05 + Math.random() * 0.08;
        const depth = ctx.createGain();
        depth.gain.value = vol * 0.6;
        lfo.connect(depth);
        depth.connect(og.gain);
        o.connect(og);
        og.connect(g);
        o.start();
        lfo.start();
      }
    } else f.connect(g);
    if (name === 'bus') {
      // the diesel: a rough low growl under the tyre rumble, wavering a little
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 240;
      for (const [freq, vol] of [[34, 0.5], [68.5, 0.32], [102, 0.12]]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = freq;
        const wob = ctx.createOscillator();
        wob.frequency.value = 0.3 + Math.random() * 0.3;
        const wd = ctx.createGain();
        wd.gain.value = freq * 0.03;
        wob.connect(wd);
        wd.connect(o.frequency);
        const og = ctx.createGain();
        og.gain.value = vol;
        o.connect(og);
        og.connect(lp);
        o.start();
        wob.start();
      }
      lp.connect(g);
    }
    src.start();
    l = loops[name] = { g, synth: !!rec };
  }
  let v = vol;
  if (pos) {
    const d = Math.hypot(pos[0] - listener.x, pos[1] - listener.y, pos[2] - listener.z);
    v *= 1 / (1 + (d / 50) * (d / 50) * 4);
  }
  l.g.gain.setTargetAtTime(muted ? 0 : v, ctx.currentTime, 0.15);
}

// ------------------------------------------------------------------ music box waltz

let musicIntensity = 0;
export function setMusicIntensity(v) {
  musicIntensity = v;
}

/**
 * The score under the music box, 0..1 each: tension (someone's near, or you're a ghost), combat (you're fighting),
 * danger (you're badly hurt or about to be), finale (the last ride). The client sets it every frame; it's smoothed here.
 */
const score = { tension: 0, combat: 0, danger: 0, finale: 0 };
const scoreTarget = { tension: 0, combat: 0, danger: 0, finale: 0 };
let choir = null;
export function setScore(s) {
  Object.assign(scoreTarget, s);
}

/** Ease the score toward its targets and drive the layers that aren't on the beat (beds, heart, choir). */
function stepScore(dt) {
  for (const k in score) score[k] += (scoreTarget[k] - score[k]) * Math.min(1, dt * (k === 'combat' ? 3 : 0.8));
  loop('scoreDrone', 0.55 * (1 - score.combat * 0.4) * (1 - score.finale * 0.4));
  loop('scoreDread', Math.min(0.75, score.tension * 0.55 + score.finale * 0.35 + score.danger * 0.2));
  loop('heart', score.danger * 0.28);
  loopRate('heart', 0.85 + score.danger * 0.5 + score.combat * 0.15);
  // a wordless choir for the last ride: an A-minor chord sung through two vowel formants, slowly swelling
  if (score.finale > 0.02 && !choir) {
    choir = ctx.createGain();
    choir.gain.value = 0;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 760;
    f1.Q.value = 4;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1180;
    f2.Q.value = 5;
    f1.connect(choir);
    f2.connect(choir);
    choir.connect(musicBus);
    for (const freq of [110, 220, 261.6, 329.6, 440, 523.2]) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = freq;
        o.detune.value = det + (Math.random() - 0.5) * 6;
        const vib = ctx.createOscillator();
        vib.frequency.value = 4.5 + Math.random();
        const vd = ctx.createGain();
        vd.gain.value = 4;
        vib.connect(vd);
        vd.connect(o.detune);
        o.connect(f1);
        o.connect(f2);
        o.start();
        vib.start();
      }
    }
  }
  if (choir) choir.gain.setTargetAtTime(score.finale * 0.035, ctx.currentTime, 1.2);
}

/** A low drum hit for the fight layer: a pitched-down thump with a skin slap on top. */
function drum(t, vol, low = true) {
  tone(musicBus, t, low ? 0.5 : 0.25, { freq: low ? 72 : 120, to: low ? 38 : 80, vol: vol * 1.3, attack: 0.004 });
  noise(musicBus, t, low ? 0.12 : 0.08, { type: 'lowpass', freq: low ? 500 : 1400, vol: vol * 0.5 });
}

function startMusic() {
  // A-minor waltz, slightly out of tune like a worn music box
  const melody = [
    [69, 2], [72, 1], [76, 2], [74, 1], [72, 2], [71, 1], [69, 3],
    [64, 2], [69, 1], [72, 2], [71, 1], [68, 2], [64, 1], [69, 3],
    [76, 2], [77, 1], [76, 2], [74, 1], [72, 2], [74, 1], [76, 3],
    [72, 2], [71, 1], [69, 2], [68, 1], [69, 3], [0, 3],
  ];
  const bass = [45, 52, 52, 40, 47, 47, 45, 52, 52, 44, 52, 52];
  let step = 0;
  let bassStep = 0;
  let next = ctx.currentTime + 0.5;
  let beatAcc = 0;
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  let lastTick = ctx.currentTime;
  const tick = () => {
    if (!ctx) return;
    stepScore(Math.max(0.01, ctx.currentTime - lastTick));
    lastTick = ctx.currentTime;
    const beat = 0.42 - musicIntensity * 0.12;
    // the box winds down as the danger rises, and the drums take over in a fight
    const boxVol = 1 - score.combat * 0.45 - score.danger * 0.35;
    while (next < ctx.currentTime + 0.6) {
      const [n, len] = melody[step % melody.length];
      if (n) {
        const detune = Math.sin(next * 0.7) * 25;
        tone(musicBus, next, beat * len * 1.4, { type: 'sine', freq: midi(n + 12), vol: 0.22 * boxVol, detune: detune * (1 + score.danger * 2) });
        tone(musicBus, next, beat * len * 0.6, { type: 'triangle', freq: midi(n + 24), vol: 0.05 * boxVol, detune });
      }
      for (let b = 0; b < len; b++) {
        const bn = bass[bassStep % bass.length];
        tone(musicBus, next + b * beat, beat * 0.9, { type: 'triangle', freq: midi(bn), vol: (b === 0 ? 0.16 : 0.07) * boxVol });
        if (score.combat > 0.08) drum(next + b * beat, (b === 0 ? 0.5 : 0.22) * score.combat, b === 0);
        else if (score.finale > 0.3 && b === 0) drum(next, 0.25 * score.finale, true);
        if (musicIntensity > 0.5) noise(musicBus, next + b * beat, 0.08, { type: 'highpass', freq: 6000, vol: 0.12 });
        bassStep++;
      }
      next += beat * len;
      beatAcc += len;
      step++;
    }
    setTimeout(tick, 150);
  };
  tick();
}
