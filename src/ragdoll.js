// Ragdolls: a rider who dies goes limp and falls the way the blow sent them, over railings and down steps, and
// can be kicked about afterwards by riders walking into them and bumper cars. Browser only (the server never knows):
// the Rapier physics engine (@dimforge/rapier3d-compat), loaded after the menu. Each body is eleven capsules
// (pelvis, chest, head, upper and lower arms and legs) joined at the skeleton's joints, knees and elbows bending one
// way only; the park's colliders (shared/map.js COLLIDERS) are added to the physics world around each death as needed.
// The capsules then drive the skinned skeleton: each bone's world rotation follows its capsule.
import * as THREE from 'three';
import { COLLIDERS } from '../shared/map.js';
import { GRAVITY, PLAYER_RADIUS } from '../shared/constants.js';
import { CAR_RADIUS } from '../shared/physics.js';

let R = null;
let world = null;
let loading = null;
const added = new Set();
const live = new Set();
/** How many bodies may be loose at once (more fall back to the death animations). */
const MAX = 10;
/** Physics groups: the park (1) collides with everything, ragdoll parts (2) only with the park. */
const PARK = (0x0001 << 16) | 0xffff;
const LIMB = (0x0002 << 16) | 0x0001;

/** Start loading the physics engine (once); resolves when ragdolls can be made, or quietly fails. */
export function loadRagdolls() {
  loading ??= import('@dimforge/rapier3d-compat')
    .then(async (m) => {
      const RAPIER = m.default ?? m;
      await RAPIER.init();
      R = RAPIER;
      world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
      world.timestep = 1 / 60;
      // the park's ground
      world.createCollider(R.ColliderDesc.cuboid(400, 0.5, 400).setTranslation(0, -0.5, 0).setFriction(0.9).setCollisionGroups(PARK));
    })
    .catch((e) => {
      console.warn('ragdolls unavailable', e);
      loading = Promise.resolve();
    });
  return loading;
}

/** The physics world for other loose things (src/debris.js), once it's in: { R, world, addPark } or null. */
export function physics() {
  return world ? { R, world, addPark } : null;
}
/** How many other loose things are in the world (the world keeps stepping while there are any). */
export const physicsUsers = { debris: 0 };

/** Can a body go limp now? */
export function ragdollReady() {
  return !!world && live.size < MAX;
}

/** Bring the park's walls, props and steps within r metres of (x, z) into the physics world. */
function addPark(x, z, r) {
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const c of COLLIDERS) {
    if (added.has(c)) continue;
    const rad = c.k === 'cyl' ? c.r : Math.hypot(c.hx, c.hz);
    if (Math.hypot(c.x - x, c.z - z) > r + rad) continue;
    added.add(c);
    const h = (c.y1 - c.y0) / 2;
    if (!(h > 0.01)) continue;
    const desc = c.k === 'cyl' ? R.ColliderDesc.cylinder(h, c.r) : R.ColliderDesc.cuboid(c.hx, h, c.hz);
    q.setFromAxisAngle(up, c.rot || 0);
    desc.setTranslation(c.x, c.y0 + h, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.8).setCollisionGroups(PARK);
    world.createCollider(desc);
  }
}

// the body: [part, bone, bone it reaches to, radius, parent part, joint]
const PARTS = [
  ['pelvis', 'Hips', 'Spine1', 0.14, null, null],
  ['chest', 'Spine1', 'Neck', 0.15, 'pelvis', 'ball'],
  ['head', 'Head', null, 0.11, 'chest', 'ball'],
  ['armL', 'LeftArm', 'LeftForeArm', 0.055, 'chest', 'ball'],
  ['foreL', 'LeftForeArm', 'LeftHand', 0.05, 'armL', 'elbow'],
  ['armR', 'RightArm', 'RightForeArm', 0.055, 'chest', 'ball'],
  ['foreR', 'RightForeArm', 'RightHand', 0.05, 'armR', 'elbow'],
  ['thighL', 'LeftUpLeg', 'LeftLeg', 0.08, 'pelvis', 'ball'],
  ['shinL', 'LeftLeg', 'LeftFoot', 0.065, 'thighL', 'knee'],
  ['thighR', 'RightUpLeg', 'RightLeg', 0.08, 'pelvis', 'ball'],
  ['shinR', 'RightLeg', 'RightFoot', 0.065, 'thighR', 'knee'],
];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);

/** A limp body for a character (Character from characters.js), posed as it is now. */
export class Ragdoll {
  /**
   * push: the velocity the death gives the body (m/s, world), on top of how it was already moving (vel).
   */
  constructor(char, push, vel) {
    this.char = char;
    const bones = char.bones;
    char.model.updateMatrixWorld(true);
    const root = bones.Hips;
    addPark(root.getWorldPosition(_a).x, _a.z, 14);
    this.parts = [];
    const byName = {};
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(char.root.getWorldQuaternion(_q));
    for (const [name, boneName, toName, radius, parentName, joint] of PARTS) {
      const bone = bones[boneName];
      if (!bone) throw new Error(`ragdoll: no ${boneName}`);
      bone.getWorldPosition(_a);
      // where the part reaches to: the next bone, or (for the head) its top
      let to = toName && bones[toName];
      if (!to && boneName === 'Head') to = Object.values(bones).find((b) => b.parent === bone && /HeadTop|Head_end|HeadTop_End/i.test(b.name));
      if (to) to.getWorldPosition(_b);
      else _b.copy(_a).add(new THREE.Vector3(0, 0.24, 0));
      const len = Math.max(0.06, _a.distanceTo(_b));
      const dir = _v.subVectors(_b, _a).normalize();
      const rot = new THREE.Quaternion().setFromUnitVectors(_yAxis, dir);
      const mid = new THREE.Vector3().addVectors(_a, _b).multiplyScalar(0.5);
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(mid.x, mid.y, mid.z)
          .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
          .setLinearDamping(0.25)
          .setAngularDamping(1.4)
          .setCcdEnabled(name === 'pelvis' || name === 'chest' || name === 'head'),
      );
      world.createCollider(
        R.ColliderDesc.capsule(Math.max(0.01, len / 2 - radius * 0.6), radius).setDensity(name === 'chest' || name === 'pelvis' ? 1100 : 900).setFriction(0.9).setRestitution(0.05).setCollisionGroups(LIMB),
        body,
      );
      const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
      const part = { name, bone, body, radius, len, off: rot.clone().invert().multiply(boneQ), start: _a.clone() };
      if (name === 'pelvis') part.posOff = _a.clone().sub(mid).applyQuaternion(rot.clone().invert());
      byName[name] = part;
      this.parts.push(part);
      if (!parentName) continue;
      // the joint, where this bone starts, in both bodies' own frames
      const parent = byName[parentName];
      const p1 = toLocal(parent.body, _a);
      const p2 = toLocal(body, _a);
      let data;
      if (joint === 'ball') data = R.JointData.spherical(p1, p2);
      else {
        // knees and elbows: a hinge across the body's side-to-side line, bending one way
        const side = new THREE.Vector3().crossVectors(dir, fwd);
        if (side.lengthSq() < 1e-4) side.set(1, 0, 0).applyQuaternion(char.root.getWorldQuaternion(_q2));
        side.normalize();
        data = R.JointData.revoluteWithAxes(p1, p2, toLocalDir(parent.body, side), toLocalDir(body, side));
        data.limitsEnabled = true;
        data.limits = joint === 'knee' ? [-2.3, 0.05] : [-0.05, 2.4];
      }
      world.createImpulseJoint(data, parent.body, body, true);
    }
    // the blow and the motion it caught them in, plus a little tumble
    const spin = (Math.random() - 0.5) * 3;
    for (const p of this.parts) {
      const k = p.name === 'chest' || p.name === 'head' ? 1.15 : p.name.startsWith('shin') ? 0.75 : 1;
      p.body.setLinvel({ x: vel.x + push.x * k, y: vel.y + push.y * k, z: vel.z + push.z * k }, true);
      p.body.setAngvel({ x: spin * 0.3, y: spin, z: spin * 0.2 }, true);
    }
    this.byName = byName;
    live.add(this);
  }

  /** Pose the skeleton from the bodies. */
  apply() {
    for (const p of this.parts) {
      const t = p.body.translation();
      const r = p.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      if (p.posOff) {
        _v.copy(p.posOff).applyQuaternion(_q).add(_a.set(t.x, t.y, t.z));
        p.bone.parent.updateWorldMatrix(true, false);
        p.bone.position.copy(p.bone.parent.worldToLocal(_v));
      }
      // world rotation = body * offset; local = parent^-1 * world
      _q.multiply(p.off);
      p.bone.parent.getWorldQuaternion(_q2);
      p.bone.quaternion.copy(_q2.invert().multiply(_q));
      p.bone.updateMatrixWorld(true);
    }
  }

  /** Riders walking into the body and bumper cars driving through it shove it about. */
  kick(riders, cars) {
    for (const p of this.parts) {
      const t = p.body.translation();
      for (const q of riders) {
        if (t.y < q.y - 0.1 || t.y > q.y + 1.8) continue;
        const dx = t.x - q.x;
        const dz = t.z - q.z;
        const d = Math.hypot(dx, dz);
        if (d > PLAYER_RADIUS + p.radius || d < 1e-4) continue;
        // feet catch the body and drag it a little, never at the rider's full speed (you'd step over it)
        const into = Math.max(0.6, (q.vx * dx + q.vz * dz) / d);
        const v = p.body.linvel();
        const now = (v.x * dx + v.z * dz) / d;
        const want = into * 0.6;
        if (now >= want) continue;
        const m = p.body.mass();
        const k = (want - now) * m;
        p.body.applyImpulse({ x: (dx / d) * k, y: k * 0.4, z: (dz / d) * k }, true);
      }
      for (const c of cars) {
        const sp = Math.hypot(c.vx || 0, c.vz || 0);
        if (t.y > c.y + 1.1) continue;
        const dx = t.x - c.x;
        const dz = t.z - c.z;
        const d = Math.hypot(dx, dz);
        if (d > CAR_RADIUS + p.radius || d < 1e-4) continue;
        // the bumper flings it to about the car's own speed (out of the way, a short hop), not further
        const m = p.body.mass();
        const v = p.body.linvel();
        const wx = (dx / d) * 1.5 + (c.vx || 0) * 1.1;
        const wz = (dz / d) * 1.5 + (c.vz || 0) * 1.1;
        const wl = Math.hypot(wx, wz);
        const cap = Math.min(1, 11 / (wl || 1));
        const ux = wx * cap;
        const uz = wz * cap;
        const along = (v.x * ux + v.z * uz) / (Math.hypot(ux, uz) || 1);
        if (along >= Math.hypot(ux, uz) * 0.95) continue;
        const lift = Math.min(3, 0.6 + sp * 0.2);
        p.body.applyImpulse({ x: (ux - v.x) * m, y: Math.max(0, lift - v.y) * m, z: (uz - v.z) * m }, true);
      }
    }
  }

  /** Has it come to rest? */
  get still() {
    return this.parts.every((p) => p.body.isSleeping() || Math.hypot(...Object.values(p.body.linvel())) < 0.05);
  }

  dispose() {
    if (!live.delete(this)) return;
    for (const p of this.parts) world.removeRigidBody(p.body);
  }
}

/** Step the physics world (fixed steps) and pose every loose body. */
let acc = 0;
export function stepRagdolls(dt) {
  if (!world || (!live.size && !physicsUsers.debris)) return;
  acc = Math.min(acc + dt, 3 / 60);
  while (acc >= 1 / 60) {
    world.step();
    acc -= 1 / 60;
  }
  for (const r of live) r.apply();
}

function toLocal(body, p) {
  const t = body.translation();
  const r = body.rotation();
  _q.set(r.x, r.y, r.z, r.w).invert();
  const v = new THREE.Vector3(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(_q);
  return { x: v.x, y: v.y, z: v.z };
}

function toLocalDir(body, d) {
  const r = body.rotation();
  _q.set(r.x, r.y, r.z, r.w).invert();
  const v = d.clone().applyQuaternion(_q);
  return { x: v.x, y: v.y, z: v.z };
}
