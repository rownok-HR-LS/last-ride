// Moving scares inside the walk-in buildings: when a living rider comes close, a skeleton tucked up under the Tunnel's
// ceiling drops on its chain and swings, a coffin lid creaks open and slams, a stalled ride car jolts along its
// track, the Funhouse fortune teller's head snaps round. Each motion was keyed in Blender and recorded
// (scripts/blender/build-scares.py -> public/models/motion/scares.json); the moving pieces are kit parts
// (scripts/blender/build-kit.py), drawn apart from the merged kit so they can move. Looks and sound only: every
// browser plays them by the same rule (a rider within reach, the scare rested), so riders see and hear the same
// thing, and the noise gives away whoever set it off.
import * as THREE from 'three';
import { PROPS } from '../shared/map.js';
import { kitPart } from './kit.js';
import * as audio from './audio.js';

/**
 * kind (shared/map.js inside()) -> the piece that moves, its recorded motion, its pivot in the prop's own space, where
 * the piece sits from that pivot, how near a rider sets it off (m) and the sounds along the way ([frame, sound]).
 */
const KINDS = {
  skeleton: { part: 'skeleton', anim: 'skeleton', pivot: [0, 4.2, 0], offset: [0, -4.2, 0], radius: 3.2, sounds: [[0, 'clack'], [10, 'clack'], [22, 'clack']] },
  coffin: { part: 'coffin_lid', anim: 'coffin_lid', pivot: [-0.31, 0.45, 0], offset: [0, 0, 0], radius: 2.6, sounds: [[2, 'creak'], [126, 'snap']] },
  ridecar: { part: 'ridecar', anim: 'ridecar', pivot: [0, 0, 0], offset: [0, 0, 0], radius: 2.8, sounds: [[0, 'clack'], [24, 'creak']] },
  fortune: { part: 'fortune_head', anim: 'fortune_head', pivot: [0, 1.6, -0.12], offset: [0, 0, 0], radius: 3.4, sounds: [[8, 'creak']], turns: true },
};
/** Seconds a scare rests after playing before it can go off again. */
const REST = 14;
const scares = [];
let fps = 30;
const _a = new THREE.Quaternion();
const _b = new THREE.Quaternion();

function pose(s, f) {
  const A = s.anim;
  const i = Math.min(A.frames, Math.max(0, Math.floor(f)));
  const j = Math.min(A.frames, i + 1);
  const u = Math.min(1, Math.max(0, f - i));
  const p = A.pos[i];
  const q = A.pos[j];
  s.pivot.position.set(s.at[0] + p[0] + (q[0] - p[0]) * u, s.at[1] + p[1] + (q[1] - p[1]) * u, s.at[2] + p[2] + (q[2] - p[2]) * u);
  s.pivot.quaternion.copy(_a.fromArray(A.quat[i])).slerp(_b.fromArray(A.quat[j]), u);
  // (recorded turning one way: mirrored when the rider is on the other side)
  if (s.mirror) {
    s.pivot.quaternion.y *= -1;
    s.pivot.quaternion.z *= -1;
    s.pivot.position.x = 2 * s.at[0] - s.pivot.position.x;
  }
}

/** Every scare in the park, as one group to add to the scene. Builder: the world's merged builder. */
export async function buildScares(Builder) {
  const data = await fetch('./models/motion/scares.json').then((r) => r.json());
  fps = data.fps;
  const group = new THREE.Group();
  group.name = 'scares';
  // (they move: they keep their own shadows, src/shadowproxy.js)
  group.userData.moves = true;
  for (const [kind, K] of Object.entries(KINDS)) {
    const spots = PROPS.filter((p) => p.type === 'interior' && p.kind === kind);
    const anim = data.scares[K.anim];
    if (!spots.length || !anim) continue;
    const part = await kitPart(Builder, K.part);
    part.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    for (const p of spots) {
      const root = new THREE.Group();
      root.position.set(p.x, 0, p.z);
      root.rotation.y = p.rot || 0;
      const pivot = new THREE.Group();
      const piece = part.clone();
      piece.position.fromArray(K.offset);
      pivot.add(piece);
      root.add(pivot);
      group.add(root);
      const s = { K, anim, pivot, at: K.pivot, x: p.x, z: p.z, rot: p.rot || 0, t: -1, rest: Math.random() * 4, sound: 0, mirror: false };
      pose(s, 0);
      scares.push(s);
    }
  }
  return group;
}

/** Run the scares: riders = the snapshot's players. */
export function updateScares(dt, riders) {
  for (const s of scares) {
    if (s.t < 0) {
      s.rest -= dt;
      if (s.rest > 0) continue;
      const r2 = s.K.radius * s.K.radius;
      let near = null;
      for (const p of riders) {
        if (p.state !== 'alive' || p.y > 3) continue;
        const dx = p.x - s.x;
        const dz = p.z - s.z;
        if (dx * dx + dz * dz < r2) {
          near = p;
          break;
        }
      }
      if (!near) continue;
      // which side of it they are on (in its own frame): a head turns that way
      s.mirror = !!s.K.turns && (near.x - s.x) * Math.cos(s.rot) - (near.z - s.z) * Math.sin(s.rot) < 0;
      s.t = 0;
      s.sound = 0;
    }
    const f = s.t * fps;
    while (s.sound < s.K.sounds.length && s.K.sounds[s.sound][0] <= f) {
      audio.play(s.K.sounds[s.sound][1], [s.x, 1.5, s.z]);
      s.sound++;
    }
    pose(s, f);
    s.t += dt;
    if (s.t * fps >= s.anim.frames) {
      pose(s, s.anim.frames);
      s.t = -1;
      s.rest = REST;
    }
  }
}
