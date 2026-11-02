// Movement for survivors (walk/jump/glide), ghosts (free flight through walls) and bumper cars.
import {
  PLAYER_RADIUS, PLAYER_HEIGHT, STEP_HEIGHT, GRAVITY, JUMP_SPEED, GHOST_MAX_Y, MAP_HALF, GLIDE_FALL,
} from './constants.js';
import { pushOut, groundAt, ceilingAt } from './collide.js';
import { PARK_EDGE } from './map.js';

const LIMIT = PARK_EDGE - 0.6;

function clampToPark(b, r) {
  const lim = LIMIT - r;
  b.x = Math.max(-lim, Math.min(lim, b.x));
  b.z = Math.max(-lim, Math.min(lim, b.z));
}

/** Convert a camera-relative stick (fwd, side) into a world direction for yaw. */
export function wishDir(fwd, side, yaw) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  let wx = -sin * fwd + cos * side;
  let wz = -cos * fwd - sin * side;
  const len = Math.hypot(wx, wz);
  if (len > 1) {
    wx /= len;
    wz /= len;
  }
  return [wx, wz];
}

/**
 * Walk/jump step for a survivor. b: { x, y, z, vx, vy, vz, onGround }.
 * glide: parachute (slow constant fall, no jump).
 */
export function stepWalker(b, wx, wz, speed, jump, dt, glide = false, accelOverride = 0, human = false) {
  if (human && b.onGround && !accelOverride) steerHuman(b, wx, wz, speed, dt);
  else {
    // snappy (fighting stance), a little air control, knockback survives in the air (or a slow slide when knocked back)
    const accel = accelOverride || (b.onGround ? 34 : glide ? 8 : 14);
    const dvx = wx * speed - b.vx;
    const dvz = wz * speed - b.vz;
    const dl = Math.hypot(dvx, dvz);
    const maxStep = accel * dt;
    if (dl > maxStep) {
      b.vx += (dvx / dl) * maxStep;
      b.vz += (dvz / dl) * maxStep;
    } else {
      b.vx += dvx;
      b.vz += dvz;
    }
  }

  if (glide) b.vy = -GLIDE_FALL;
  else if (b.onGround && jump) {
    b.vy = JUMP_SPEED;
    b.onGround = false;
  } else b.vy -= GRAVITY * dt;

  const dist = Math.hypot(b.vx, b.vy, b.vz) * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.3));
  const sdt = dt / steps;
  let landed = false;
  for (let i = 0; i < steps; i++) {
    b.x += b.vx * sdt;
    b.z += b.vz * sdt;
    pushOut(b, PLAYER_RADIUS, PLAYER_HEIGHT, b.onGround ? STEP_HEIGHT : 0.12);
    clampToPark(b, PLAYER_RADIUS);

    const ny = b.y + b.vy * sdt;
    if (b.vy > 0) {
      const ceil = ceilingAt(b.x, b.z, PLAYER_RADIUS * 0.8, b.y, ny + PLAYER_HEIGHT);
      if (ceil < Infinity) {
        b.y = Math.min(ny, ceil - PLAYER_HEIGHT);
        b.vy = 0;
      } else b.y = ny;
    } else b.y = ny;

    // ground: anything walkable under the feet (step-ups snap instantly)
    const reach = b.onGround ? 0.56 : Math.max(0.05, -b.vy * sdt + 0.05);
    const g = groundAt(b.x, b.z, PLAYER_RADIUS * 0.6, Math.max(b.y, b.y - b.vy * sdt), reach);
    if (b.y <= g + 0.001 || (b.onGround && b.vy <= 0 && b.y - g < 0.35)) {
      if (b.vy <= 0) {
        b.y = g;
        if (!b.onGround) landed = true;
        b.vy = 0;
        b.onGround = true;
      }
    } else b.onGround = false;
  }
  return landed;
}

/**
 * How a person on foot really moves: speed builds up over a few strides and bleeds off when you stop,
 * direction swings round in an arc (wider the faster you go), sharp turns cost speed, and reversing
 * means skidding to a stop first.
 */
function steerHuman(b, wx, wz, speed, dt) {
  const cur = Math.hypot(b.vx, b.vz);
  const wl = Math.hypot(wx, wz);
  let dx = cur > 0.01 ? b.vx / cur : wx;
  let dz = cur > 0.01 ? b.vz / cur : wz;
  let s = cur;
  if (wl < 0.1) s = Math.max(0, cur - 28 * dt);
  else {
    const tx = wx / wl;
    const tz = wz / wl;
    if (cur < 0.4) {
      dx = tx;
      dz = tz;
      s = Math.min(speed, cur + 24 * dt);
    } else {
      const ang = Math.acos(Math.max(-1, Math.min(1, dx * tx + dz * tz)));
      if (ang > 2.5 && cur > 4) {
        // reversing at speed: plant the feet and skid
        s = Math.max(0, cur - 34 * dt);
        if (s < 0.6) {
          dx = tx;
          dz = tz;
        }
      } else {
        const rate = (18 - 8 * Math.min(1, cur / 7.2)) * dt;
        const k = ang > 1e-4 ? Math.min(1, rate / ang) : 1;
        // rotate the heading toward the wish (slerp in 2D)
        const side = dx * tz - dz * tx >= 0 ? 1 : -1;
        const turn = ang * k * side;
        const c = Math.cos(turn);
        const sn = Math.sin(turn);
        const ndx = dx * c - dz * sn;
        const ndz = dx * sn + dz * c;
        dx = ndx;
        dz = ndz;
        const want = speed * (ang > 0.8 ? 1 - Math.min(0.2, (ang - 0.8) * 0.3) : 1);
        // the last bit of speed (into a sprint) comes slower than the first
        const up = s < 5 ? 24 : 12;
        s = s < want ? Math.min(want, s + up * dt) : Math.max(want, s - 20 * dt);
      }
    }
  }
  b.vx = dx * s;
  b.vz = dz * s;
}

/** Ghost free flight: through walls, clamped above the ground and inside the park. */
export function stepGhost(b, wx, wy, wz, speed, dt) {
  const k = Math.min(1, 7 * dt);
  b.vx += (wx * speed - b.vx) * k;
  b.vy += (wy * speed - b.vy) * k;
  b.vz += (wz * speed - b.vz) * k;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  b.y = Math.max(0.3, Math.min(GHOST_MAX_Y, b.y));
  const lim = MAP_HALF - 2;
  b.x = Math.max(-lim, Math.min(lim, b.x));
  b.z = Math.max(-lim, Math.min(lim, b.z));
}

export const CAR_RADIUS = 1.15;

/**
 * Bumper car driven by a ghost: turns toward the stick direction and accelerates.
 * car: { x, y, z, vx, vz, yaw }. Returns true if it slammed into a wall.
 */
export function stepCar(car, wx, wz, speed, dt) {
  const want = Math.hypot(wx, wz);
  if (want > 0.1) {
    const target = Math.atan2(-wx, -wz);
    let d = target - car.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    car.yaw += Math.max(-4 * dt, Math.min(4 * dt, d));
  }
  const fx = -Math.sin(car.yaw);
  const fz = -Math.cos(car.yaw);
  const thrust = want > 0.1 ? speed : 0;
  const k = Math.min(1, 2.4 * dt);
  car.vx += (fx * thrust - car.vx) * k;
  car.vz += (fz * thrust - car.vz) * k;
  const bx = car.x;
  const bz = car.z;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
  const body = { x: car.x, y: car.y, z: car.z };
  const hit = pushOut(body, CAR_RADIUS, 1.2, 0.3);
  clampToPark(body, CAR_RADIUS);
  car.x = body.x;
  car.z = body.z;
  car.y = groundAt(car.x, car.z, 0.5, car.y, 0.3);
  if (hit) {
    // bounce off the wall
    const mx = (car.x - bx) / dt;
    const mz = (car.z - bz) / dt;
    car.vx = mx * 0.4 - (car.vx - mx) * 0.3;
    car.vz = mz * 0.4 - (car.vz - mz) * 0.3;
  }
  return hit;
}
