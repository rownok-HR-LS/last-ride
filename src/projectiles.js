// Arrows, bolts, darts, harpoons, firework rockets and thrown flasks in flight; ones stuck in walls;
// burning flares (with a small pool of real lights) and salt circles on the ground.
import * as THREE from 'three';
import { projectileModel } from './weapons.js';
import { glow, ringTex } from './textures.js';

const FWD = new THREE.Vector3(0, 0, -1);
const dir = new THREE.Vector3();
const col = (c) => new THREE.Color(c);
const rnd = (s) => (Math.random() - 0.5) * s;
const STUCK_MAX = 60;

export class Projectiles {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.live = new Map(); // projectile id -> mesh
    this.stuck = [];
    // one light shared by the nearest burning flare (a fixed count keeps shaders from recompiling)
    this.flareLights = [0].map(() => {
      const l = new THREE.PointLight('#ff3a2a', 0, 26, 1.4);
      scene.add(l);
      return l;
    });
    this.flareGlow = new Map();
    this.glowMat = new THREE.SpriteMaterial({ map: glow(), color: '#ff5a3a', blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.salts = new Map();
    this.saltMat = new THREE.MeshBasicMaterial({ map: ringTex(), color: '#f4f1ea', transparent: true, depthWrite: false, opacity: 0.85 });
  }

  update(snap, dt, time, cam) {
    // in flight
    const seen = new Set();
    for (const p of snap.projs) {
      seen.add(p.id);
      let m = this.live.get(p.id);
      if (!m) {
        m = projectileModel(p.kind);
        m.userData.kind = p.kind;
        this.scene.add(m);
        this.live.set(p.id, m);
      }
      m.position.set(p.x, p.y, p.z);
      dir.set(p.vx, p.vy, p.vz).normalize();
      if (p.kind === 'holy') m.rotation.x += dt * 12;
      else m.quaternion.setFromUnitVectors(FWD, dir);
      // trails: sparks behind rockets and flares
      if (p.kind === 'fireworks') {
        for (let i = 0; i < 3; i++) this.fx.add.spawn(p.x + rnd(0.1), p.y + rnd(0.1), p.z + rnd(0.1), -dir.x * 3 + rnd(2), -dir.y * 3 + rnd(2), -dir.z * 3 + rnd(2), col(i ? '#ffb040' : '#fff0c0'), 0.25, 0.4, 2, 1);
      } else if (p.kind === 'flare') this.fx.add.spawn(p.x, p.y, p.z, rnd(1), rnd(1), rnd(1), col('#ff4a2a'), 0.3, 0.3, 0, 1);
    }
    for (const [id, m] of this.live) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      this.live.delete(id);
    }

    // flares: a red glow on the ground, the nearest two get real light
    const fseen = new Set();
    for (const f of snap.flares) {
      fseen.add(f.id);
      let g = this.flareGlow.get(f.id);
      if (!g) {
        g = new THREE.Sprite(this.glowMat);
        g.scale.setScalar(1.6);
        this.scene.add(g);
        this.flareGlow.set(f.id, g);
      }
      const flick = 0.85 + Math.sin(time * 37 + f.id) * 0.1 + Math.random() * 0.1;
      g.position.set(f.x, f.y + 0.15, f.z);
      g.scale.setScalar(1.4 * flick);
      if (Math.random() < 0.6) this.fx.add.spawn(f.x, f.y + 0.1, f.z, rnd(0.8), 1 + Math.random() * 1.5, rnd(0.8), col('#ff5a2a'), 0.25, 0.5, -1, 1);
      if (Math.random() < 0.15) this.fx.norm.spawn(f.x, f.y + 0.3, f.z, rnd(0.3), 0.8, rnd(0.3), col('#5a2a2a'), 1.2, 2, -0.1, 1, 1.5);
    }
    for (const [id, g] of this.flareGlow) {
      if (fseen.has(id)) continue;
      this.scene.remove(g);
      this.flareGlow.delete(id);
    }
    const near = [...snap.flares].sort((a, b) => Math.hypot(a.x - cam.x, a.z - cam.z) - Math.hypot(b.x - cam.x, b.z - cam.z));
    this.flareLights.forEach((l, i) => {
      const f = near[i];
      l.intensity = f ? 70 * (0.85 + Math.random() * 0.15) * Math.min(1, f.t) : 0;
      if (f) l.position.set(f.x, f.y + 0.6, f.z);
    });

    // salt circles fade as they wear away
    const sseen = new Set();
    for (const s of snap.salts) {
      sseen.add(s.id);
      let m = this.salts.get(s.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.saltMat.clone());
        m.rotation.x = -Math.PI / 2;
        m.renderOrder = 2;
        this.scene.add(m);
        this.salts.set(s.id, m);
      }
      m.position.set(s.x, s.y + 0.04, s.z);
      m.scale.set(s.r * 2.1, s.r * 2.1, 1);
      m.material.opacity = 0.85 * Math.min(1, s.t / 3);
    }
    for (const [id, m] of this.salts) {
      if (sseen.has(id)) continue;
      this.scene.remove(m);
      this.salts.delete(id);
    }

    // stuck arrows fall out after a while
    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const s = this.stuck[i];
      s.t -= dt;
      if (s.t <= 0) {
        this.scene.remove(s.m);
        this.stuck.splice(i, 1);
      }
    }
  }

  /** An arrow, bolt, dart or harpoon left where it hit (skipped when it hit a person: they move). */
  stick(e) {
    if (e.on !== null || e.kind === 'fireworks') return;
    const m = projectileModel(e.kind);
    dir.set(e.vx, e.vy, e.vz).normalize();
    m.quaternion.setFromUnitVectors(FWD, dir);
    // bury the tip a little
    m.position.set(e.x, e.y, e.z).addScaledVector(dir, e.kind === 'bow' ? 0.2 : 0.08);
    this.scene.add(m);
    this.stuck.push({ m, t: 25 });
    if (this.stuck.length > STUCK_MAX) this.scene.remove(this.stuck.shift().m);
  }
}
