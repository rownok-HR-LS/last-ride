// Broken props: when a crate, a board or a barricade breaks (shared/game.js breakProp), the whole model is hidden
// and its pieces (cut in Blender by scripts/fracture-props.mjs, painted with the prop's own materials) fly the way
// the blow went, tumble and pile up in the physics world the ragdolls use; riders and bumper cars kick them about.
// After 18 s they stop moving and sink away. Without the physics engine they just arc and drop to the ground.
import * as THREE from 'three';
import { physics, physicsUsers } from './ragdoll.js';
import { brokenPieces, BREAK_PLACES } from './models.js';
import { BREAKABLES, BREAKABLE_MODELS } from '../shared/map.js';
import { PLAYER_RADIUS } from '../shared/constants.js';
import { CAR_RADIUS } from '../shared/physics.js';

/** Pieces collide with the park (1) and each other (4), not with ragdoll limbs (2). */
const DEBRIS = (0x0004 << 16) | 0x0005;
/** At most this many pieces at once (the oldest go first). */
const MAX = 160;
const LIFE = 18;
const pieces = [];
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/** Up to ~40 corner points of a piece (its hull, for the physics engine), in the piece's own frame. */
function hullPoints(group) {
  const pts = [];
  for (const m of group.children) {
    const a = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(a.count / 24));
    for (let i = 0; i < a.count; i += step) pts.push(a.getX(i), a.getY(i), a.getZ(i));
  }
  return new Float32Array(pts);
}

/** Break prop id into pieces, thrown along (dx, dz) with force (m/s). */
export async function shatter(scene, id, dx, dz, force) {
  const b = BREAKABLES[id];
  const place = BREAK_PLACES.get(id);
  if (!b || !place) return;
  const chunks = await brokenPieces(place.file, BREAKABLE_MODELS[b.model].inside).catch((e) => {
    console.warn('pieces', e);
    return null;
  });
  if (!chunks) return;
  const P = physics();
  place.matrix.decompose(_p, _q, _s);
  if (P) P.addPark(b.x, b.z, 10);
  const rnd = () => Math.random() - 0.5;
  for (const ch of chunks) {
    const g = new THREE.Group();
    for (const part of ch.parts) {
      const geo = part.geometry.clone();
      geo.scale(_s.x, _s.y, _s.z);
      const m = new THREE.Mesh(geo, part.material);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    const wc = ch.center.clone().applyMatrix4(place.matrix);
    g.position.copy(wc);
    g.quaternion.copy(_q);
    scene.add(g);
    // outward from the prop's middle, the way the blow went, and up
    let ox = wc.x - b.x;
    let oz = wc.z - b.z;
    const ol = Math.hypot(ox, oz) || 1;
    ox /= ol;
    oz /= ol;
    const k = 0.55 + Math.random() * 0.6;
    const v = {
      x: dx * force * k + ox * force * 0.35 + rnd() * 1.5,
      y: 1 + force * (0.2 + Math.random() * 0.35),
      z: dz * force * k + oz * force * 0.35 + rnd() * 1.5,
    };
    const spin = { x: rnd() * 9, y: rnd() * 9, z: rnd() * 9 };
    let body = null;
    if (P) {
      body = P.world.createRigidBody(
        P.R.RigidBodyDesc.dynamic().setTranslation(wc.x, wc.y, wc.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }).setLinearDamping(0.25).setAngularDamping(0.5),
      );
      const desc = P.R.ColliderDesc.convexHull(hullPoints(g)) || P.R.ColliderDesc.ball(0.15);
      P.world.createCollider(desc.setDensity(450).setFriction(0.85).setRestitution(0.12).setCollisionGroups(DEBRIS), body);
      body.setLinvel(v, true);
      body.setAngvel(spin, true);
      physicsUsers.debris++;
    }
    pieces.push({ g, body, t: 0, v, spin, scene });
  }
  while (pieces.length > MAX) remove(pieces.shift());
}

function remove(p) {
  if (p.body) {
    physics()?.world.removeRigidBody(p.body);
    physicsUsers.debris--;
    p.body = null;
  }
  p.scene.remove(p.g);
  for (const m of p.g.children) m.geometry.dispose();
}

/** Move the pieces (the physics world itself is stepped by stepRagdolls); near: riders and cars that kick them. */
export function stepDebris(dt, near) {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    p.t += dt;
    if (p.body) {
      const t = p.body.translation();
      const r = p.body.rotation();
      p.g.position.set(t.x, t.y, t.z);
      p.g.quaternion.set(r.x, r.y, r.z, r.w);
      if (near && p.t < LIFE) kick(p, t, near);
      if (p.t >= LIFE) {
        // settled where it lies; from here it only sinks away
        physics()?.world.removeRigidBody(p.body);
        physicsUsers.debris--;
        p.body = null;
      }
    } else if (p.t < LIFE) {
      // no physics engine: a simple arc down to the ground
      p.v.y -= 15 * dt;
      p.g.position.x += p.v.x * dt;
      p.g.position.y += p.v.y * dt;
      p.g.position.z += p.v.z * dt;
      if (p.g.position.y < 0.08) {
        p.g.position.y = 0.08;
        p.v.x *= 0.5;
        p.v.z *= 0.5;
        p.v.y = Math.abs(p.v.y) * 0.25;
        p.spin.x *= 0.5;
        p.spin.z *= 0.5;
      }
      p.g.rotation.x += p.spin.x * dt * 0.3;
      p.g.rotation.z += p.spin.z * dt * 0.3;
    }
    if (p.t > LIFE) p.g.position.y -= dt * 0.35;
    if (p.t > LIFE + 2.5) {
      remove(p);
      pieces.splice(i, 1);
    }
  }
}

function kick(p, t, near) {
  for (const q of near.riders) {
    const dx = t.x - q.x;
    const dz = t.z - q.z;
    const d = Math.hypot(dx, dz);
    if (d > PLAYER_RADIUS + 0.25 || d < 1e-4 || t.y > q.y + 1.2) continue;
    const into = Math.max(0.8, (q.vx * dx + q.vz * dz) / d);
    const m = p.body.mass();
    p.body.applyImpulse({ x: (dx / d) * into * m * 0.5, y: into * m * 0.3, z: (dz / d) * into * m * 0.5 }, true);
  }
  for (const c of near.cars) {
    const sp = Math.hypot(c.vx || 0, c.vz || 0);
    if (sp < 1 || t.y > c.y + 1.1) continue;
    const dx = t.x - c.x;
    const dz = t.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d > CAR_RADIUS + 0.2 || d < 1e-4) continue;
    const m = p.body.mass();
    const v = p.body.linvel();
    if ((v.x * c.vx + v.z * c.vz) / sp > sp) continue;
    p.body.applyImpulse({ x: (c.vx * 1.1 - v.x) * m, y: Math.min(3, sp * 0.25) * m, z: (c.vz * 1.1 - v.z) * m }, true);
  }
}

/** Any pieces about? (the client then gathers who can kick them) */
export function debrisCount() {
  return pieces.length;
}
