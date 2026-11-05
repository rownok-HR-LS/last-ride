// Particles, tracers, muzzle flashes, explosions and the storm wall.
import * as THREE from 'three';
import { glow } from './textures.js';

const PVERT = `
  attribute float size; attribute float alpha; attribute vec3 tint;
  varying float vA; varying vec3 vC;
  void main(){
    vA = alpha; vC = tint;
    vec4 mv = modelViewMatrix * vec4(position,1.0);
    gl_PointSize = size * (320.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const PFRAG = `
  uniform sampler2D map; varying float vA; varying vec3 vC;
  void main(){
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vC * t.rgb, t.a * vA);
  }`;

class Particles {
  constructor(scene, max, additive) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('tint', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo = g;
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: glow() } },
      vertexShader: PVERT,
      fragmentShader: PFRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, color, size, life, grav = 0, drag = 0, grow = 0) {
    let i = this.n;
    if (i >= this.max) i = Math.floor(Math.random() * this.max);
    else this.n++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.grow[i] = grow;
    this.alpha[i] = 1;
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[j * 3 + k];
            this.vel[i * 3 + k] = this.vel[j * 3 + k];
            this.col[i * 3 + k] = this.col[j * 3 + k];
          }
          this.size[i] = this.size[j];
          this.life[i] = this.life[j];
          this.maxLife[i] = this.maxLife[j];
          this.grav[i] = this.grav[j];
          this.drag[i] = this.drag[j];
          this.grow[i] = this.grow[j];
        }
        i--;
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.3;
      }
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, t * 2.5);
    }
    this.geo.setDrawRange(0, this.n);
    for (const a of ['position', 'tint', 'size', 'alpha']) this.geo.attributes[a].needsUpdate = true;
  }
}

const C = (hex) => new THREE.Color(hex);
const rnd = (a = 1) => (Math.random() * 2 - 1) * a;

/** An irregular splash of blood: a main blot with ragged lobes and flicked droplets (alpha only). */
function splatTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  const blob = (x, y, r) => {
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const rr = r * (0.75 + Math.random() * 0.4);
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.fill();
  };
  blob(S / 2, S / 2, S * 0.2);
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = S * (0.12 + Math.random() * 0.14);
    blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.05 + Math.random() * 0.07));
  }
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = S * (0.25 + Math.random() * 0.22);
    blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.006 + Math.random() * 0.014));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const BLOOD_MAX = 220;

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.add = new Particles(scene, 2500, true);
    this.norm = new Particles(scene, 1200, false);
    this.tracers = [];
    this.flashes = [];
    this.rings = [];
    // storm wall
    this.stormMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform float time; varying vec2 vUv; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          // a curtain, not clouds: fine vertical streaks drifting upward, a glowing skirt where it meets the
          // ground, thinning out with height; violet-crimson like the storm on the map and the screen tint
          float up = vUv.y;
          vec2 p = vec2(vUv.x * 220.0, up * 2.5 - time * 0.22);
          float streak = n(p) * 0.6 + n(vec2(p.x * 2.6, p.y * 1.8 - time * 0.35)) * 0.4;
          float curtain = smoothstep(0.35, 0.95, streak);
          float skirt = exp(-up * 7.0);
          float height = smoothstep(0.8, 0.12, up);
          vec3 col = mix(vec3(0.05, 0.01, 0.05), vec3(0.24, 0.04, 0.19), curtain) + vec3(0.32, 0.07, 0.25) * skirt;
          float a = (0.12 + curtain * 0.18 + skirt * 0.3) * height;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.storm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 140, 96, 1, true), this.stormMat);
    this.storm.position.y = 60;
    this.storm.renderOrder = 3;
    scene.add(this.storm);
    this.nextRing = new THREE.Mesh(
      new THREE.RingGeometry(0.995, 1, 128),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.nextRing.rotation.x = -Math.PI / 2;
    this.nextRing.position.y = 0.15;
    scene.add(this.nextRing);
    this.flashTex = glow();
    // blood left on the ground: wet and dark, it stays for the match
    this.bloodMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: '#3a0202', alphaMap: splatTexture(), transparent: true, depthWrite: false, roughness: 0.6, metalness: 0, envMapIntensity: 0.06,
        polygonOffset: true, polygonOffsetFactor: -2,
      }),
      BLOOD_MAX,
    );
    this.bloodMesh.count = 0;
    this.bloodMesh.receiveShadow = true;
    this.bloodMesh.frustumCulled = false;
    this.bloodMesh.renderOrder = 1;
    scene.add(this.bloodMesh);
    this.pools = []; // { i, x, y, z, rot, size, grow }
    this.bloodI = 0;
  }

  /** Blood on the ground at (x, y, z): size in metres; grow > 0 spreads it slowly (a body bleeding out). */
  blood(x, y, z, size, grow = 0) {
    const i = this.bloodI;
    this.bloodI = (this.bloodI + 1) % BLOOD_MAX;
    this.bloodMesh.count = Math.max(this.bloodMesh.count, i + 1);
    const p = { i, x, y: y + 0.015 + (i % 7) * 0.0006, z, rot: Math.random() * Math.PI * 2, size: grow ? size * 0.2 : size, end: size, grow };
    this.pools = this.pools.filter((q) => q.i !== i);
    this.pools.push(p);
    this.placeBlood(p);
  }

  placeBlood(p) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p.x, p.y, p.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot),
      new THREE.Vector3(p.size, 1, p.size),
    );
    this.bloodMesh.setMatrixAt(p.i, m);
    this.bloodMesh.instanceMatrix.needsUpdate = true;
  }

  tracer(from, to, color = '#ffe39a') {
    let t = this.tracers.find((x) => x.life <= 0);
    if (!t) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, toneMapped: false }));
      line.frustumCulled = false;
      this.scene.add(line);
      t = { line, life: 0 };
      this.tracers.push(t);
    }
    const a = t.line.geometry.attributes.position;
    a.setXYZ(0, from.x, from.y, from.z);
    a.setXYZ(1, to[0], to[1], to[2]);
    a.needsUpdate = true;
    t.line.material.color.set(color).multiplyScalar(2);
    t.line.visible = true;
    t.life = 0.07;
  }

  muzzle(pos, big = false) {
    let f = this.flashes.find((x) => x.life <= 0);
    if (!f) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: '#ffd27a', blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      this.scene.add(s);
      f = { s, life: 0 };
      this.flashes.push(f);
    }
    f.s.position.copy(pos);
    const k = (big ? 1.4 : 0.8) * (0.8 + Math.random() * 0.4);
    f.s.scale.set(k, k, 1);
    f.s.material.rotation = Math.random() * 6;
    f.s.visible = true;
    f.life = 0.05;
  }

  impact(x, y, z, kind) {
    if (kind === 'player') {
      for (let i = 0; i < 10; i++) this.norm.spawn(x, y, z, rnd(2.5), rnd(2) + 1, rnd(2.5), C('#5a0606'), 0.28, 0.45, 9, 2);
    } else if (kind === 'head') {
      for (let i = 0; i < 18; i++) this.norm.spawn(x, y, z, rnd(3), rnd(3) + 2, rnd(3), C('#6a0808'), 0.34, 0.55, 9, 2);
      this.norm.spawn(x, y, z, 0, 0.3, 0, C('#3a0404'), 1.2, 0.8, 0, 2, 1.5);
    } else {
      for (let i = 0; i < 4; i++) this.add.spawn(x, y, z, rnd(2), rnd(2) + 1, rnd(2), C('#ffcf8a'), 0.18, 0.25, 9, 1);
      this.norm.spawn(x, y, z, rnd(0.3), 0.5, rnd(0.3), C('#5a4d63'), 0.5, 0.6, -0.2, 1, 1.5);
    }
  }

  /** Wispy black smoke for the wraiths. */
  mist(x, y, z) {
    this.norm.spawn(x + rnd(0.3), y + rnd(0.5), z + rnd(0.3), rnd(0.3), 0.4 + Math.random() * 0.4, rnd(0.3), C('#050406'), 0.9, 1.4, -0.2, 1, 1.2);
  }

  /** A small dark scorch where a bullet hit the world, facing back toward the shooter. */
  bulletHole(from, end) {
    if (!this.holes) {
      this.holes = [];
      this.holeMat = new THREE.MeshBasicMaterial({ map: glow(), color: '#000000', transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
      this.holeGeo = new THREE.PlaneGeometry(0.16, 0.16);
      this.holeI = 0;
    }
    let h = this.holes[this.holeI];
    if (!h) {
      h = new THREE.Mesh(this.holeGeo, this.holeMat);
      this.scene.add(h);
      this.holes[this.holeI] = h;
    }
    this.holeI = (this.holeI + 1) % 80;
    const dx = end[0] - from[0];
    const dy = end[1] - from[1];
    const dz = end[2] - from[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    h.position.set(end[0] - (dx / l) * 0.02, end[1] - (dy / l) * 0.02, end[2] - (dz / l) * 0.02);
    h.lookAt(end[0] - dx, end[1] - dy, end[2] - dz);
  }

  explosion(x, y, z, r, kind) {
    const fire = kind === 'cursed' ? C('#b45cff') : C('#ff8a3a');
    const party = ['#ff4f6a', '#ffb52e', '#45c75e', '#3d8dff', '#b45cff', '#ffffff'];
    for (let i = 0; i < 60; i++) {
      const s = 4 + Math.random() * r * 2;
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 1.2;
      this.add.spawn(x, y + 0.5, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 2, Math.sin(a) * Math.cos(e) * s, kind === 'firework' ? C(party[i % party.length]) : fire, 0.7, 0.6 + Math.random() * 0.4, 6, 2.5);
    }
    for (let i = 0; i < 26; i++) {
      this.norm.spawn(x + rnd(r * 0.6), y + 0.5 + Math.random() * 2, z + rnd(r * 0.6), rnd(1.5), 1 + Math.random() * 2, rnd(1.5), C(kind === 'cursed' ? '#2a1838' : '#3a3240'), 2.5, 1.6 + Math.random(), -0.3, 1.2, 2.2);
    }
    this.ring(x, y + 0.1, z, r, kind === 'cursed' ? '#c070ff' : '#ffb060');
  }

  ring(x, y, z, r, color) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    this.scene.add(m);
    this.rings.push({ m, life: 0.5, max: 0.5, r });
  }

  cannon(pos) {
    for (let i = 0; i < 40; i++) {
      this.norm.spawn(pos.x + rnd(1), pos.y + rnd(1), pos.z + rnd(1), rnd(4), Math.random() * 6, rnd(4) + 2, C('#c9bfd6'), 2.2, 1.5 + Math.random(), -0.5, 1.5, 2.5);
    }
    const conf = ['#ff4f6a', '#ffb52e', '#45c75e', '#3d8dff', '#b45cff', '#ffffff'];
    for (let i = 0; i < 60; i++) {
      this.add.spawn(pos.x, pos.y, pos.z, rnd(8), 6 + Math.random() * 10, rnd(8) + 4, C(conf[i % conf.length]), 0.3, 2 + Math.random(), 4, 1.2);
    }
  }

  ecto(x, y, z, n = 10) {
    for (let i = 0; i < n; i++) this.add.spawn(x + rnd(0.6), y + Math.random() * 1.6, z + rnd(0.6), rnd(0.6), 0.8 + Math.random(), rnd(0.6), C('#7dffd8'), 0.45, 1 + Math.random(), -0.4, 1);
  }

  sparkle(x, y, z, color = '#ffd27a', n = 12) {
    for (let i = 0; i < n; i++) this.add.spawn(x + rnd(0.5), y + Math.random() * 0.8, z + rnd(0.5), rnd(2), 2 + Math.random() * 2, rnd(2), C(color), 0.3, 0.7, 5, 1);
  }

  dust(x, y, z) {
    // wet earth kicked up: a dull grey-brown (a purple-grey here read as lavender clouds on the grass)
    for (let i = 0; i < 12; i++) this.norm.spawn(x + rnd(0.6), y + 0.1, z + rnd(0.6), rnd(3), Math.random(), rnd(3), C('#4f4a42'), 0.75, 0.7, 0, 3, 1.5);
  }

  update(dt, time, zone) {
    for (const p of this.pools) {
      if (!p.grow || p.size >= p.end) continue;
      p.size = Math.min(p.end, p.size + p.grow * dt);
      this.placeBlood(p);
    }
    this.add.update(dt);
    this.norm.update(dt);
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07);
      if (t.life <= 0) t.line.visible = false;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) f.s.visible = false;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const u = 1 - r.life / r.max;
      r.m.scale.setScalar(0.3 + u * r.r * 1.3);
      r.m.material.opacity = Math.max(0, 1 - u);
      if (r.life <= 0) {
        this.scene.remove(r.m);
        r.m.geometry.dispose();
        r.m.material.dispose();
        this.rings.splice(i, 1);
      }
    }
    this.stormMat.uniforms.time.value = time;
    if (zone) {
      const r = Math.max(0.5, zone.r);
      this.storm.scale.set(r, 1, r);
      this.storm.position.x = zone.cx;
      this.storm.position.z = zone.cz;
      this.storm.visible = zone.state !== 'idle';
      this.nextRing.visible = zone.state === 'wait';
      const nr = Math.max(0.5, zone.nr);
      this.nextRing.scale.set(nr, nr, 1);
      this.nextRing.position.x = zone.nx;
      this.nextRing.position.z = zone.nz;
    }
  }
}
