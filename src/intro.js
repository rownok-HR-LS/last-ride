// The opening cinematic: the tour bus drives through the woods to the park while captions tell the story.
// Shot like film: long lenses, slow eased moves, a handheld drift, depth of field and a sound bed of engine, wind
// and wildlife. It runs during the sim's 'launch' phase (the bus reaches the gate as it ends) and can be skipped.
import * as THREE from 'three';
import { LAUNCH_SECONDS } from '../shared/constants.js';
import * as audio from './audio.js';

/** [start time (s), line]. Times are seconds into the intro. */
const LINES = [
  [1.5, 'Nineteen eighty-seven. Wonderland Park closed its gates for good, after its final night.'],
  [7.5, 'Twenty visitors went in that night. None of them came out.'],
  [13, 'Nobody bought the land. Nobody tore it down. And every year, on the same night, the lights come back on.'],
  [20.5, 'Tonight, Midnight Wonderland Tours sold exactly twenty tickets.'],
  [25.5, 'Only one rider leaves on the last bus. The rest stay. Forever.'],
];

/** One-off sounds: [time, name]. */
const CUES = [[3.2, 'owl'], [9.8, 'twig'], [15.5, 'owl'], [19.2, 'crow'], [21.2, 'power']];

const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * Shots. at: start (s). fov: lens (smaller = longer lens). shake: handheld amount. aperture: depth of field.
 * cam(u, b, A): u = eased progress through the shot, b = bus now, A = bus at the start of the shot. Positions are
 * given in a bus frame [forward, right, up] via b.at / A.at, or in world space.
 */
const SHOTS = [
  {
    // a long lens low in the trees: the headlights come out of the dark and grow
    at: 0, fov: 26, shake: 0.35, aperture: 0.55,
    cam: (u, b, A) => ({ pos: A.at(66 - u * 2, -4.6 + u * 0.4, 0.9 + u * 0.2), look: b.at(5, 0, 1.4) }),
  },
  {
    // down by the front wheel, riding along: tyres on the broken road, the beams cutting the mist
    at: 6.5, fov: 46, shake: 0.6, aperture: 1.0,
    cam: (u, b) => ({ pos: b.at(1.6 + u * 0.8, 2.15, 0.55), look: b.at(14, 0.2, 0.7), focus: 3.2 }),
  },
  {
    // inside, creeping up the aisle past the other riders toward the driver
    at: 11.5, fov: 50, shake: 0.9, aperture: 0.12, cabin: 1, interior: 1,
    cam: (u, b) => ({ pos: b.at(-2.6 + u * 1.4, 0.05, 2.85), look: b.at(16, -0.4, 2.45), focus: 5 }),
  },
  {
    // a drone high over the road, sinking as the treeline opens toward the park
    at: 16.5, fov: 38, shake: 0.12, aperture: 0.25,
    cam: (u, b) => ({ pos: b.at(-24 + u * 7, 3 - u * 1.5, 19 - u * 6), look: b.at(20, 0, 0) }),
  },
  {
    // inside the gates, low: the lights stutter on as the bus pulls up
    at: 21, fov: 34, shake: 0.4, aperture: 0.5,
    cam: (u, b) => ({ pos: [-3.5 + u * 1.2, 1.4 + u * 0.2, 74 + u * 5], look: [b.x * 0.3, 4.6 - u * 0.8, b.z], focus: 36 }),
  },
  {
    // behind the bus as it passes under the arch, craning up to the sign
    at: 25.5, fov: 48, shake: 0.3, aperture: 0.3,
    cam: (u, b) => ({ pos: b.at(-12 - u * 3, 1.1, 3.2 + u * 4.5), look: b.at(16, 0, 2.4 + u * 3) }),
  },
];

function frame(bus) {
  const fx = -Math.sin(bus.yaw);
  const fz = -Math.cos(bus.yaw);
  const rx = Math.cos(bus.yaw);
  const rz = -Math.sin(bus.yaw);
  return {
    x: bus.x,
    z: bus.z,
    at: (f, r, y) => [bus.x + fx * f + rx * r, y, bus.z + fz * f + rz * r],
  };
}

export class Intro {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'intro';
    this.el.innerHTML = `<div class="fade"></div><div class="bar top"></div><div class="bar bottom"></div>
      <div class="subtitle"></div><div class="intro-title"><b>LAST RIDE</b><span>Midnight Wonderland Tours · 20 seats</span></div>
      <div class="skip">Press <kbd>Enter</kbd> to skip</div>`;
    root.append(this.el);
    this.sub = this.el.querySelector('.subtitle');
    this.title = this.el.querySelector('.intro-title');
    this.fade = this.el.querySelector('.fade');
    this.done = false;
    this.spoken = -1;
    this.cued = 0;
    this.shot = -1;
    this.anchor = null;
    this.look = new THREE.Vector3();
    this.result = { fov: 50, focus: 10, aperture: 0, cabin: 0 };
  }

  get active() {
    return !this.done;
  }

  skip() {
    this.done = true;
    this.el.classList.remove('show');
    audio.loop('introPad', 0);
    audio.loop('wind', 0);
  }

  /**
   * Drive the camera, captions and sound. Returns the lens settings while the cinematic owns the camera,
   * otherwise null.
   */
  update(snap, camera) {
    if (this.done) return null;
    if (snap.phase !== 'launch') {
      this.skip();
      return null;
    }
    const elapsed = LAUNCH_SECONDS - snap.launchIn;
    this.el.classList.add('show');
    // fade up from black
    this.fade.style.opacity = String(Math.max(0, 1 - elapsed / 2.2));
    // captions
    let line = -1;
    LINES.forEach(([t], i) => {
      if (elapsed >= t) line = i;
    });
    if (line !== this.spoken) {
      this.spoken = line;
      if (line >= 0) {
        this.sub.textContent = LINES[line][1];
        this.sub.classList.remove('in');
        void this.sub.offsetWidth;
        this.sub.classList.add('in');
      }
    }
    this.title.classList.toggle('show', elapsed > 26.5);
    // sound bed: wind in the trees and a low drone, swelling as the park wakes up
    audio.loop('wind', 0.16);
    audio.loop('introPad', 0.1 + Math.min(1, Math.max(0, (elapsed - 18) / 8)) * 0.12);
    while (this.cued < CUES.length && elapsed >= CUES[this.cued][0]) {
      const [, name] = CUES[this.cued++];
      const b = snap.bus;
      // wildlife off in the woods, the power coming on at the gate
      audio.play(name, name === 'power' ? [0, 6, 108] : [b.x + (Math.random() < 0.5 ? -30 : 30), 8, b.z - 20]);
    }
    // camera
    let k = 0;
    SHOTS.forEach((s, i) => {
      if (elapsed >= s.at) k = i;
    });
    const s = SHOTS[k];
    if (k !== this.shot) {
      this.shot = k;
      this.anchor = frame(snap.bus);
    }
    const end = k + 1 < SHOTS.length ? SHOTS[k + 1].at : LAUNCH_SECONDS;
    const u = ease((elapsed - s.at) / (end - s.at));
    const b = frame(snap.bus);
    const { pos, look, focus } = s.cam(u, b, this.anchor);
    // handheld: a slow drift and a little breathing, never a jitter
    const h = s.shake;
    const n = (a, f) => Math.sin(elapsed * f + a) * 0.6 + Math.sin(elapsed * f * 2.3 + a * 1.7) * 0.4;
    camera.position.set(pos[0] + n(1, 0.7) * 0.04 * h, pos[1] + n(2, 0.9) * 0.035 * h, pos[2] + n(3, 0.6) * 0.04 * h);
    const dist = Math.hypot(look[0] - pos[0], look[1] - pos[1], look[2] - pos[2]);
    const wob = 0.006 * h * dist;
    camera.lookAt(this.look.set(look[0] + n(4, 0.5) * wob, look[1] + n(5, 0.8) * wob, look[2] + n(6, 0.55) * wob));
    // a slight dutch tilt that sways with the hand
    camera.rotateZ(n(7, 0.4) * 0.006 * h);
    const r = this.result;
    r.fov = s.fov;
    r.aperture = s.aperture;
    r.focus = focus ?? Math.hypot(snap.bus.x - pos[0], 1.5 - pos[1], snap.bus.z - pos[2]);
    r.cabin = s.cabin || 0;
    r.interior = s.interior || 0;
    return r;
  }

  /** How bright the park lamps are: dark until the bus nears, then they flicker on. */
  power(snap) {
    if (snap.phase !== 'launch') return 1;
    const elapsed = LAUNCH_SECONDS - snap.launchIn;
    if (elapsed < 21.2) return 0;
    const k = Math.min(1, (elapsed - 21.2) / 2.5);
    return k < 1 && Math.sin(elapsed * 40) > 0.2 ? 0.1 : k;
  }
}
