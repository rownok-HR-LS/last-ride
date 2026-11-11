// Moving attractions: Ferris wheel, roller coaster, bumper cars, carousel, Free Fall, plus ghost hazards
// (flung gondolas, bear traps, phantom footprints, blackout domes).
import * as THREE from 'three';
import { FERRIS, CAROUSEL, TRACK, TRACK_SUPPORTS, FREEFALL, trackAt } from '../shared/map.js';
import { RIDES } from '../shared/items.js';
import { Builder, mat } from './world.js';
import { ringTex } from './textures.js';
import { loadModel, mergeStatic } from './models.js';
import { kitPart } from './kit.js';
import { windAmp } from './motion.js';

/** Copy a geometry with plain float attributes (compressed int16 ones clamp when transformed). */
function floatGeo(src) {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) {
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (src.index) g.setIndex(src.index.clone());
  for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  return g;
}

function m(key) {
  return mat(key);
}

function gondolaMesh(color) {
  const g = new THREE.Group();
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.9, 1.2, 12, 1, true), (() => { const g = m(color).clone(); g.side = THREE.DoubleSide; return g; })());
  cup.position.y = -1.6;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 12), m('dark'));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.2;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.6, 12), m('awning'));
  roof.position.y = -0.2;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 5), m('iron'));
  rod.position.y = -0.6;
  g.add(cup, floor, roof, rod);
  for (const c of g.children) c.castShadow = true;
  return g;
}

function carMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.55, 18), m(color));
  body.scale.z = 1.25;
  body.position.y = 0.45;
  const bumper = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.16, 8, 24), m('rubber'));
  bumper.rotation.x = Math.PI / 2;
  bumper.scale.y = 1.25;
  bumper.position.y = 0.3;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.4), m('dark'));
  seat.position.set(0, 0.95, 0.45);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 6, 14), m('iron'));
  wheel.position.set(0, 1.05, -0.35);
  wheel.rotation.x = 1.1;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4.8, 5), m('iron'));
  pole.position.set(0, 3.1, 0.75);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), m('bulbCyan'));
  spark.position.set(0, 5.55, 0.75);
  const eyes = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.05), m('bulb'));
  eyes.position.set(0, 0.5, -1.36);
  g.add(body, bumper, seat, wheel, pole, spark, eyes);
  for (const c of g.children) c.castShadow = true;
  g.userData.eyes = eyes;
  return g;
}

function horseMesh(color) {
  const g = new THREE.Group();
  const mt = m(color);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.0, 4, 8), mt);
  body.rotation.z = Math.PI / 2;
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 4, 8), mt);
  neck.position.set(0.62, 0.38, 0);
  neck.rotation.z = -0.6;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.25, 0.24), mt);
  head.position.set(0.95, 0.62, 0);
  head.rotation.z = -0.3;
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), m('bulbRed'));
  eye.position.set(1.0, 0.7, 0.13);
  const eye2 = eye.clone();
  eye2.position.z = -0.13;
  g.add(body, neck, head, eye, eye2);
  for (const [x, a] of [[0.4, 0.5], [-0.4, -0.5]]) {
    for (const z of [-0.15, 0.15]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.7, 5), mt);
      leg.position.set(x + a * 0.3, -0.45, z);
      leg.rotation.z = a;
      g.add(leg);
    }
  }
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.5), m('gold'));
  saddle.position.y = 0.33;
  g.add(saddle);
  return g;
}

export class Rides {
  constructor(scene) {
    this.scene = scene;
    this.buildFerris();
    this.buildCoaster();
    this.buildCars();
    this.buildCarousel();
    this.buildFreefall();
    this.buildHazards();
    this.upgradeFerris().catch((e) => console.warn('ferris model', e));
    this.upgradeTrain().catch((e) => console.warn('coaster car model', e));
    this.upgradeCarousel().catch((e) => console.warn('carousel model', e));
    this.upgradeCars().catch((e) => console.warn('dodgem model', e));
    this.upgradeFreefall().catch((e) => console.warn('free fall seats', e));
  }

  /**
   * The real carousel (Enkarra, CC-BY): just the ride (its plaza, lamps and grass stay behind), aged and grimy,
   * scaled onto the platform the map reserves. The horses on their poles still bob as it turns.
   */
  async upgradeCarousel() {
    const src = await loadModel('carousel_real');
    const model = src.clone(true);
    const keep = /^(uv|Static_base|group|locatord+)$/;
    let root = null;
    model.traverse((o) => {
      if (o.name === 'RootNode') root = o;
    });
    for (const ch of [...root.children]) if (!keep.test(ch.name)) root.remove(ch);
    const gray = new THREE.Color('#777068');
    const aged = new Map();
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      // forty years of weather: faded paint, dirt, dead bulbs (one aged copy per original material)
      if (!aged.has(o.material)) {
        const m = o.material.clone();
        m.color.lerp(gray, 0.4).multiplyScalar(0.62);
        m.roughness = Math.max(m.roughness ?? 0.8, 0.75);
        m.metalness = Math.min(m.metalness ?? 0, 0.3);
        if (m.emissive) m.emissiveIntensity = 0.15;
        aged.set(o.material, m);
      }
      o.material = aged.get(o.material);
    });
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const k = (CAROUSEL.r * 2) / Math.max(size.x, size.z);
    model.scale.setScalar(k);
    model.position.set(-c.x * k, -box.min.y * k, -c.z * k);
    const g = this.carousel;
    for (const ch of [...g.children]) g.remove(ch);
    g.add(model);
    // dozens of parts into a few draw calls: the frame as one piece per material, each horse as its own
    const horses = [];
    model.traverse((o) => {
      if (/^locator[1-6]$/.test(o.name)) horses.push(o);
    });
    mergeStatic(model, horses);
    for (const h of horses) mergeStatic(h);
    // horses ride up and down from where the model left them
    this.horses = [];
    model.traverse((o) => {
      if (/^locator[1-6]$/.test(o.name)) {
        o.userData.y0 = o.position.y;
        o.userData.amp = 0.35 / k;
        this.horses.push(o);
      }
    });
  }

  /** Bumper cars (zj24, CC-BY): the real car body on every car, still lighting up green when a ghost drives. */
  async upgradeCars() {
    const src = await loadModel('dodgem');
    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    // long along z like the game's cars; about 2.7 m nose to tail
    const k = 2.7 / Math.max(size.x, size.z);
    const turn = size.x > size.z ? Math.PI / 2 : 0;
    // a far version (Blender Decimate, about an eighth of the triangles) for cars seen from across the park
    const far = await loadModel('dodgem_far').catch(() => null);
    const place = (from) => {
      const m2 = from.clone(true);
      m2.scale.setScalar(k);
      m2.rotation.y = turn;
      const off = new THREE.Vector3(-c.x * k, -box.min.y * k, -c.z * k).applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
      m2.position.copy(off);
      mergeStatic(m2);
      return m2;
    };
    for (const car of this.cars) {
      for (const ch of [...car.children]) if (ch !== car.userData.eyes) car.remove(ch);
      if (far) {
        const lod = new THREE.LOD();
        lod.addLevel(place(src), 0);
        lod.addLevel(place(far), 26);
        car.add(lod);
      } else car.add(place(src));
      car.userData.eyes.position.set(0, 0.45, -1.38);
    }
  }

  /**
   * Swap the simple wheel for the Pripyat Ferris wheel scan (Yarik16, CC-BY): the A-frame stays put, the wheel
   * turns on the hub, and one of its cabins becomes the template for every gondola (also the ones ghosts fling).
   */
  async upgradeFerris() {
    const src = await loadModel('ferris');
    const F = FERRIS;
    const model = src.clone(true);
    model.updateMatrixWorld(true);
    const kindOf = (o) => {
      for (let n = o; n; n = n.parent) {
        if (/^(wood|other|ladder|legs|bolts)/i.test(n.name)) return 'frame';
        if (/^cab/i.test(n.name)) return 'cab';
      }
      return 'wheel';
    };
    const parts = { frame: [], wheel: [], cab: new Map() };
    model.traverse((o) => {
      if (!o.isMesh) return;
      const g = floatGeo(o.geometry).applyMatrix4(o.matrixWorld);
      const k = kindOf(o);
      if (k === 'cab') {
        let cabNode = o;
        while (cabNode.parent && !/^cab/i.test(cabNode.name)) cabNode = cabNode.parent;
        if (!parts.cab.has(cabNode)) parts.cab.set(cabNode, []);
        parts.cab.get(cabNode).push([g, o.material]);
      } else parts[k].push([g, o.material]);
    });
    // hub = centre of the wheel; ring = where the cabins hang from
    const wb = new THREE.Box3();
    for (const [g] of parts.wheel) wb.union(g.boundingBox || (g.computeBoundingBox(), g.boundingBox));
    const hub = wb.getCenter(new THREE.Vector3());
    const cabs = [...parts.cab.values()].map((list) => {
      const b = new THREE.Box3();
      for (const [g] of list) {
        g.computeBoundingBox();
        b.union(g.boundingBox);
      }
      return { list, b, top: new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2) };
    });
    const ring = cabs.reduce((s, c) => s + Math.hypot(c.top.x - hub.x, c.top.y - hub.y), 0) / cabs.length;
    const k = F.r / ring;
    // the frame is stretched up or down so its feet reach the ground under our hub height
    let frameMin = Infinity;
    for (const [g] of parts.frame) {
      g.computeBoundingBox();
      frameMin = Math.min(frameMin, g.boundingBox.min.y);
    }
    const ky = F.hubY / ((hub.y - frameMin) * k);
    const toLocal = (g, sy = 1) => g.translate(-hub.x, -hub.y, -hub.z).scale(k, k * sy, k);
    const mesh = (g, mat) => {
      const o = new THREE.Mesh(g, mat);
      o.castShadow = true;
      o.receiveShadow = true;
      return o;
    };
    const frame = new THREE.Group();
    frame.position.set(F.x, F.hubY, F.z);
    for (const [g, mat] of parts.frame) frame.add(mesh(toLocal(g, ky), mat));
    mergeStatic(frame);
    this.scene.add(frame);
    // the turning wheel: drop the stand-in rims and spokes, keep the bulbs
    for (const c of [...this.wheel.children]) if (!c.isInstancedMesh) this.wheel.remove(c);
    for (const [g, mat] of parts.wheel) this.wheel.add(mesh(toLocal(g), mat));
    mergeStatic(this.wheel);
    this.ferrisBase?.removeFromParent();
    // gondola template: the first cabin, hanging from its top
    const c0 = cabs[0];
    this.cabTemplate = () => {
      const grp = new THREE.Group();
      for (const [g, mat] of c0.list) grp.add(mesh(g.clone().translate(-c0.top.x, -c0.top.y, -c0.top.z).scale(k, k, k), mat));
      mergeStatic(grp);
      return grp;
    };
    for (const old of this.gondolas) this.scene.remove(old);
    this.gondolas = [];
    for (let i = 0; i < F.n; i++) {
      const g = this.cabTemplate();
      this.scene.add(g);
      this.gondolas.push(g);
    }
  }

  /** Rusty abandoned coaster cars (Matt-AeroLab, CC-BY) instead of the boxes. */
  async upgradeTrain() {
    const src = await loadModel('coaster_car');
    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    // the model is long along x; the train runs along z
    const k = 2.4 / size.x;
    for (const car of this.train) {
      for (const ch of [...car.children]) car.remove(ch);
      const m2 = src.clone(true);
      m2.scale.setScalar(k);
      m2.rotation.y = Math.PI / 2;
      m2.position.set(c.z * k, -box.min.y * k, -c.x * k);
      car.add(m2);
    }
  }


  buildFerris() {
    const F = FERRIS;
    const B = new Builder();
    const P = { x: F.x, z: F.z, rot: 0 };
    // A-frame legs front and back
    for (const sz of [-3, 3]) {
      for (const sx of [-9, 9]) {
        const len = Math.hypot(sx, F.hubY);
        const ang = Math.atan2(sx, F.hubY);
        B.add('iron', new THREE.CylinderGeometry(0.28, 0.45, len, 8), P, sx / 2, F.hubY / 2, sz, 0, 0, ang);
      }
      B.box('iron', P, 0, 7, sz, 13, 0.3, 0.3);
    }
    B.box('concrete', P, 0, 0.22, 0, 9, 0.45, 6);
    B.cyl('gold', P, 0, F.hubY, 0, 1.0, 1.0, 7, 16, Math.PI / 2);
    this.ferrisBase = new THREE.Group();
    B.build(this.ferrisBase);
    this.scene.add(this.ferrisBase);

    const wheel = new THREE.Group();
    wheel.position.set(F.x, F.hubY, F.z);
    const rimGeo = new THREE.TorusGeometry(F.r, 0.22, 6, 72);
    for (const z of [-1.4, 1.4]) {
      const rim = new THREE.Mesh(rimGeo, m('#3a2a4a'));
      rim.position.z = z;
      wheel.add(rim);
      const inner = new THREE.Mesh(new THREE.TorusGeometry(F.r * 0.55, 0.15, 6, 48), m('#3a2a4a'));
      inner.position.z = z;
      wheel.add(inner);
    }
    const spokeGeo = new THREE.CylinderGeometry(0.1, 0.1, F.r, 5);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      for (const z of [-1.4, 1.4]) {
        const s = new THREE.Mesh(spokeGeo, m('iron'));
        s.position.set(Math.cos(a) * F.r * 0.5, Math.sin(a) * F.r * 0.5, z);
        s.rotation.z = a - Math.PI / 2;
        wheel.add(s);
      }
    }
    // bulbs on the rim
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 4), new THREE.MeshBasicMaterial({ toneMapped: false }), 96);
    const mm = new THREE.Matrix4();
    // most bulbs died years ago
    const cols = [new THREE.Color('#1a1412'), new THREE.Color('#ffa850').multiplyScalar(1.6), new THREE.Color('#1a1412'), new THREE.Color('#2a1a14')];
    for (let i = 0; i < 96; i++) {
      const a = (i / 48) * Math.PI * 2;
      mm.makeTranslation(Math.cos(a) * (F.r + 0.3), Math.sin(a) * (F.r + 0.3), i < 48 ? 1.6 : -1.6);
      bulbs.setMatrixAt(i, mm);
      bulbs.setColorAt(i, cols[(i * 7) % 4]);
    }
    wheel.add(bulbs);
    this.scene.add(wheel);
    this.wheel = wheel;
    this.gondolas = [];
    const colors = ['#e2384f', '#2f9be0', '#f2b632', '#8e44d6', '#2fbf87', '#f0702c'];
    for (let i = 0; i < F.n; i++) {
      const g = gondolaMesh(colors[i % colors.length]);
      this.scene.add(g);
      this.gondolas.push(g);
    }
  }

  buildCoaster() {
    const pts = TRACK.pts;
    const left = [];
    const right = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const tx = b[0] - a[0];
      const tz = b[2] - a[2];
      const l = Math.hypot(tx, tz) || 1;
      const rx = -tz / l;
      const rz = tx / l;
      left.push(new THREE.Vector3(a[0] + rx * 0.55, a[1] + 0.2, a[2] + rz * 0.55));
      right.push(new THREE.Vector3(a[0] - rx * 0.55, a[1] + 0.2, a[2] - rz * 0.55));
    }
    // plain stand-ins for the track and supports until the Blender model (kit_coaster, via kit.js) is in
    const stand = new THREE.Group();
    stand.name = 'coasterStandIn';
    if (!this.scene.getObjectByName('kit')) this.scene.add(stand);
    const railMat = m('iron');
    for (const side of [left, right]) {
      const curve = new THREE.CatmullRomCurve3(side, true);
      const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, n * 2, 0.09, 6, true), railMat);
      rail.castShadow = true;
      stand.add(rail);
    }
    const spine = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1] - 0.15, p[2])), true), n * 2, 0.22, 6, true),
      m('#e2384f'),
    );
    spine.castShadow = true;
    stand.add(spine);
    // ties
    const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.1, 0.22), m('woodDark'), Math.ceil(TRACK.len));
    const o = new THREE.Object3D();
    let k = 0;
    for (let s = 0; s < TRACK.len - 0.5 && k < ties.count; s += 1, k++) {
      const t = trackAt(s);
      o.position.set(t.x, t.y + 0.08, t.z);
      o.lookAt(t.x + t.tx, t.y + 0.08 + t.ty, t.z + t.tz);
      o.updateMatrix();
      ties.setMatrixAt(k, o.matrix);
    }
    ties.count = k;
    ties.castShadow = true;
    stand.add(ties);
    // supports
    const B = new Builder();
    for (const s of TRACK_SUPPORTS) {
      B.cyl('#3a2a4a', { x: s.x, z: s.z }, 0, s.h / 2, 0, 0.18, 0.3, s.h, 6);
      B.cyl('concrete', { x: s.x, z: s.z }, 0, 0.2, 0, 0.5, 0.6, 0.4, 8);
    }
    B.build(stand);
    // train
    this.train = [];
    for (let i = 0; i < 4; i++) {
      const car = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 2.2), m(i === 0 ? '#2b1838' : '#e2384f'));
      body.position.y = 0.6;
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 0.5), m('dark'));
      seat.position.set(0, 1.1, 0.5);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 2.25), m('gold'));
      trim.position.y = 1.0;
      car.add(body, seat, trim);
      if (i === 0) {
        const skull = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), m('cream'));
        skull.position.set(0, 1.0, -1.1);
        const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), m('bulbRed'));
        e1.position.set(0.18, 1.08, -1.52);
        const e2 = e1.clone();
        e2.position.x = -0.18;
        car.add(skull, e1, e2);
      }
      for (const c of car.children) c.castShadow = true;
      this.scene.add(car);
      this.train.push(car);
    }
  }

  buildCars() {
    const colors = ['#e2384f', '#2f9be0', '#f2b632', '#8e44d6', '#2fbf87', '#f0702c', '#ff4fd8', '#4ff3ff'];
    this.cars = colors.map((c) => {
      const mesh = carMesh(c);
      this.scene.add(mesh);
      return mesh;
    });
  }

  buildCarousel() {
    const C = CAROUSEL;
    const g = new THREE.Group();
    g.position.set(C.x, 0, C.z);
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(C.r, C.r, 0.45, 40), m('woodDark'));
    plat.position.y = 0.22;
    plat.receiveShadow = true;
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(C.r + 0.05, C.r + 0.05, 0.3, 40, 1, true), m('gold'));
    skirt.position.y = 0.3;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 5.6, 16), m('tentPurple'));
    column.position.y = 3.0;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(C.r + 0.6, 3, 40, 1, true), m('tentRed'));
    roof.position.y = 7.6;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(C.r + 0.4, C.r + 0.4, 0.7, 40, 1, true), m('gold'));
    rim.position.y = 5.95;
    g.add(plat, skirt, column, roof, rim);
    for (const c of g.children) c.castShadow = true;
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ toneMapped: false }), 40);
    const mm = new THREE.Matrix4();
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      mm.makeTranslation(Math.cos(a) * (C.r + 0.5), 5.6, Math.sin(a) * (C.r + 0.5));
      bulbs.setMatrixAt(i, mm);
      bulbs.setColorAt(i, new THREE.Color(i % 5 === 0 ? '#ffa850' : '#1a1412').multiplyScalar(i % 5 === 0 ? 1.6 : 1));
    }
    g.add(bulbs);
    this.horses = [];
    const colors = ['#efe4d2', '#2b1838', '#8e44d6', '#e2384f'];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rad = i % 2 ? 6.6 : 4.6;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.4, 6), m('gold'));
      pole.position.set(Math.cos(a) * rad, 3.0, Math.sin(a) * rad);
      const h = horseMesh(colors[i % colors.length]);
      h.position.set(Math.cos(a) * rad, 1.6, Math.sin(a) * rad);
      h.rotation.y = -a;
      g.add(pole, h);
      this.horses.push(h);
    }
    this.scene.add(g);
    this.carousel = g;
  }

  buildFreefall() {
    // the seat ring climbs and drops the tower; a plain ring stands in until the Blender seats have loaded
    this.freefallSeat = new THREE.Group();
    this.freefallSeat.position.set(FREEFALL.x, 40, FREEFALL.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.45, 8, 24), m('#e2384f'));
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = true;
    this.freefallSeat.add(ring);
    this.scene.add(this.freefallSeat);
  }

  /** Twelve outward-facing seats with shoulder harnesses round a red ring (scripts/blender/build-rides.py). */
  async upgradeFreefall() {
    const seats = await kitPart(Builder, 'freefall_seats');
    const g = this.freefallSeat;
    for (const ch of [...g.children]) {
      g.remove(ch);
      ch.geometry?.dispose();
    }
    g.add(seats);
  }

  buildHazards() {
    this.flying = [];
    this.warnings = [];
    this.warnMat = new THREE.MeshBasicMaterial({ map: ringTex(), color: '#ff3355', transparent: true, depthWrite: false, toneMapped: false });
    this.trapMeshes = new Map();
    this.trapGeo = (() => {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 14), m('rust'));
      g.add(base);
      for (const s of [-1, 1]) {
        const jaw = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 4, 14, Math.PI), m('metal'));
        jaw.rotation.set(Math.PI / 2 - s * 0.5, 0, 0);
        jaw.position.y = 0.05;
        g.add(jaw);
        for (let i = 0; i < 6; i++) {
          const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 4), m('metal'));
          const a = (i / 5) * Math.PI;
          tooth.position.set(Math.cos(a) * 0.4, 0.12, s * Math.sin(a) * 0.15);
          g.add(tooth);
        }
      }
      return g;
    })();
    this.stepMat = new THREE.MeshBasicMaterial({ color: '#7dffcf', transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false });
    this.stepGeo = new THREE.CircleGeometry(0.16, 8);
    this.stepMarks = [];
    this.domes = [];
    this.domeMat = new THREE.MeshBasicMaterial({ color: '#05020a', transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
  }

  update(snap, dt, time) {
    // Ferris wheel
    const F = FERRIS;
    this.wheel.rotation.z = snap.ferris.angle;
    this.gondolas.forEach((g, i) => {
      const a = snap.ferris.angle + (i / F.n) * Math.PI * 2;
      g.position.set(F.x + Math.cos(a) * F.r, F.hubY + Math.sin(a) * F.r, F.z);
      // the empty cabins rock in the wind: a creak on a still night, swinging in a thunderstorm
      const gust = 0.6 + 0.4 * Math.sin(time * 0.35 + i * 0.7);
      g.rotation.z = Math.sin(time * 1.3 + i) * (snap.ferris.driver ? 0.25 : 0.012 + 0.1 * windAmp.value * gust);
    });

    // coaster train
    const s = snap.coaster.s;
    this.train.forEach((car, k) => {
      const t = trackAt(s - k * 2.6);
      car.position.set(t.x, t.y + 0.1, t.z);
      car.lookAt(t.x - t.tx, t.y + 0.1 - t.ty, t.z - t.tz);
    });

    // bumper cars
    snap.cars.forEach((c, i) => {
      const mesh = this.cars[i];
      mesh.position.set(c.x, c.y, c.z);
      mesh.rotation.y = c.yaw;
      mesh.userData.eyes.material = c.driver ? m('bulbGreen') : m('bulb');
    });

    // carousel spins slowly; horses bob
    this.carousel.rotation.y = time * 0.18;
    this.horses.forEach((h, i) => {
      const y0 = h.userData.y0 ?? 1.6;
      h.position.y = y0 + Math.sin(time * 1.6 + i * 1.3) * (h.userData.amp ?? 0.35);
    });
    this.freefallSeat.position.y = 30 + Math.sin(time * 0.25) * 12;

    // gondolas flung by ghosts
    while (this.flying.length < snap.gondolas.length) {
      const g = this.cabTemplate ? this.cabTemplate() : gondolaMesh('#2fbf87');
      this.scene.add(g);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.warnMat);
      w.rotation.x = -Math.PI / 2;
      w.renderOrder = 2;
      this.scene.add(w);
      this.flying.push(g);
      this.warnings.push(w);
    }
    this.flying.forEach((g, i) => {
      const fl = snap.gondolas[i];
      const w = this.warnings[i];
      g.visible = !!fl;
      w.visible = !!fl;
      if (!fl) return;
      const u = Math.min(1, fl.u);
      g.position.set(
        fl.from[0] + (fl.to[0] - fl.from[0]) * u,
        fl.from[1] + (fl.to[1] + 2.2 - fl.from[1]) * u + 14 * 4 * u * (1 - u),
        fl.from[2] + (fl.to[2] - fl.from[2]) * u,
      );
      g.rotation.set(u * 7, u * 3, u * 5);
      const R = RIDES.ferris.radius * 2;
      w.scale.set(R, R, 1);
      w.position.set(fl.to[0], fl.to[1] + 0.06, fl.to[2]);
      w.material.opacity = 0.5 + Math.sin(time * 18) * 0.4;
    });

    // bear traps (visible to ghosts, or survivors who are right on top of them)
    const seen = new Set();
    for (const t of snap.traps) {
      seen.add(t.id);
      let mesh = this.trapMeshes.get(t.id);
      if (!mesh) {
        mesh = this.trapGeo.clone();
        this.scene.add(mesh);
        this.trapMeshes.set(t.id, mesh);
      }
      mesh.position.set(t.x, t.y + 0.03, t.z);
    }
    for (const [id, mesh] of this.trapMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(mesh);
      this.trapMeshes.delete(id);
    }

    // phantom footprints, drawn for ghosts only
    let k = 0;
    for (const st of snap.steps) {
      if (!st.ghost) continue;
      for (let j = 0; j < 4; j++) {
        let mk = this.stepMarks[k];
        if (!mk) {
          mk = new THREE.Mesh(this.stepGeo, this.stepMat);
          mk.rotation.x = -Math.PI / 2;
          this.scene.add(mk);
          this.stepMarks.push(mk);
        }
        const side = j % 2 ? 0.18 : -0.18;
        mk.visible = true;
        mk.position.set(st.x - st.dx * j * 0.7 - st.dz * side, st.y + 0.05, st.z - st.dz * j * 0.7 + st.dx * side);
        k++;
      }
    }
    for (; k < this.stepMarks.length; k++) this.stepMarks[k].visible = false;

    // blackout domes and dead lamps
    while (this.domes.length < snap.blackouts.length) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.domeMat);
      this.scene.add(d);
      this.domes.push(d);
    }
    this.domes.forEach((d, i) => {
      const b = snap.blackouts[i];
      d.visible = !!b;
      if (!b) return;
      const grow = Math.min(1, (b.dur - b.t) * 3) * Math.min(1, b.t * 2);
      d.scale.setScalar(b.r * Math.max(0.05, grow));
      d.position.set(b.x, 0, b.z);
    });
  }
}

