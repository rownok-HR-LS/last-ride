// Floating loot: weapons with rarity beams, ammo, tickets, healing and occult items, and treasure chests.
import * as THREE from 'three';
import { softShaft } from './shafts.js';
import { RARITIES, AMMO, ITEMS } from '../shared/items.js';
import { weaponModel, itemModel as occultModel, GRIP } from './weapons.js';
import { glow } from './textures.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Collapse a little model into one geometry per material (cached by key). Every piece of loot that
 * shares a part is then drawn with one instanced mesh.
 */
const flatCache = new Map();
function flatten(key, make) {
  if (!flatCache.has(key)) {
    const src = make();
    src.updateMatrixWorld(true);
    const byMat = new Map();
    src.traverse((o) => {
      if (!o.isMesh) return;
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
      for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
    });
    const parts = [...byMat].map(([m, gs]) => [mergeGeometries(gs), m]);
    flatCache.set(key, parts);
  }
  return flatCache.get(key);
}

const discMats = new Map();
function discMat(col) {
  if (!discMats.has(col)) discMats.set(col, new THREE.MeshBasicMaterial({ map: glow(), color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
  return discMats.get(col);
}
const beamMats = new Map();

const beamGeo = new THREE.CylinderGeometry(0.06, 0.2, 1, 16, 1, true);
const discGeo = new THREE.CircleGeometry(0.75, 20);

/** A soft shaft of light rising from the loot (see shafts.js). */
function beamMat(color) {
  if (!beamMats.has(color)) {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    beamMats.set(color, softShaft(m, { bright: 'bottom' }));
  }
  return beamMats.get(color);
}

function itemModel(l) {
  const g = new THREE.Group();
  if (l.kind === 'ammo') {
    const col = AMMO[l.ammo].color;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.28, 0.3), new THREE.MeshStandardMaterial({ color: '#3d4a3a' }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.31), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4 }));
    g.add(box, band);
  } else if (l.kind === 'tickets' || ITEMS[l.item]?.occult) {
    const m = occultModel(l.kind === 'tickets' ? 'tickets' : l.item);
    m.scale.setScalar(2.2);
    g.add(m);
  } else if (l.item === 'bandage') {
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.22, 12), new THREE.MeshStandardMaterial({ color: '#f2e6d8' }));
    roll.rotation.z = Math.PI / 2;
    g.add(roll);
  } else if (l.item === 'medkit') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.3), new THREE.MeshStandardMaterial({ color: '#f4f4f4' })));
    for (const [w, h] of [[0.28, 0.08], [0.08, 0.28]]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), new THREE.MeshStandardMaterial({ color: '#ff3a4a', emissive: '#ff3a4a', emissiveIntensity: 0.5 }));
      c.position.z = -0.16;
      g.add(c);
    }
  } else {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.34, 14), new THREE.MeshStandardMaterial({ color: ITEMS.soda.color, emissive: ITEMS.soda.color, emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.3 }));
    g.add(can);
  }
  return g;
}

function chestModel(cursed) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: cursed ? '#4a2a5a' : '#7a4a2a', roughness: 0.8 });
  const gold = new THREE.MeshStandardMaterial({ color: '#e0b040', metalness: 0.8, roughness: 0.3, emissive: '#6a4a10', emissiveIntensity: 0.4 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.65), wood);
  base.position.y = 0.25;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 1.0, 12, 1, false, 0, Math.PI), wood);
  lid.rotation.z = Math.PI / 2;
  lid.rotation.y = Math.PI / 2;
  lid.position.y = 0.5;
  const band1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.67), gold);
  band1.position.set(-0.35, 0.25, 0);
  const band2 = band1.clone();
  band2.position.x = 0.35;
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.05), gold);
  lock.position.set(0, 0.48, -0.34);
  g.add(base, lid, band1, band2, lock);
  return g;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const sc = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
// melee weapons are modelled upright; lay them across the beam
const TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.25);

export class LootView {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
    this.pools = new Map();
  }

  /** One InstancedMesh per (geometry, material) pair. */
  pool(geo, mat) {
    const key = `${geo.uuid}:${mat.uuid}`;
    let p = this.pools.get(key);
    if (!p) {
      const mesh = new THREE.InstancedMesh(geo, mat, 400);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = mat.transparent ? 2 : 0;
      this.scene.add(mesh);
      p = { mesh, n: 0 };
      this.pools.set(key, p);
    }
    return p;
  }

  sync(list) {
    const seen = new Set();
    for (const l of list) {
      seen.add(l.id);
      let e = this.items.get(l.id);
      if (!e) {
        e = { id: l.id };
        this.items.set(l.id, e);
      }
      e.data = l;
    }
    for (const id of this.items.keys()) if (!seen.has(id)) this.items.delete(id);
  }

  add(geo, mat, pos, rot, scale) {
    const p = this.pool(geo, mat);
    if (p.n >= p.mesh.instanceMatrix.count) return;
    m4.compose(pos, rot, scale);
    p.mesh.setMatrixAt(p.n++, m4);
  }

  /** hidden: show nothing (the opening cinematic keeps the park dark and untouched). */
  update(time, cam, hidden = false) {
    for (const p of this.pools.values()) p.n = 0;
    for (const [id, e] of hidden ? [] : this.items) {
      const l = e.data;
      // past the fog nothing is readable anyway
      if (cam && Math.hypot(l.x - cam.x, l.z - cam.z) > 85) continue;
      if (l.kind === 'chest') {
        q.setFromAxisAngle(UP, l.rot || 0);
        for (const [g, m] of flatten(`chest:${l.cursed}`, () => chestModel(l.cursed))) this.add(g, m, v.set(l.x, l.y, l.z), q, sc.set(1, 1, 1));
        const k = 1.5 + Math.sin(time * 3 + id) * 0.15;
        this.add(discGeo, discMat(l.cursed ? '#b45cff' : '#ffd27a'), v.set(l.x, l.y + 0.03, l.z), FLAT, sc.set(k, k, 1));
        continue;
      }
      const bob = (l.kind === 'weapon' ? 0.55 : 0.3) + Math.sin(time * 2 + id) * 0.08;
      q.setFromAxisAngle(UP, time * 1.2 + id);
      if (l.kind === 'weapon') {
        const col = RARITIES[l.rarity].color;
        const upright = GRIP[l.w] === 'hand' && l.w !== 'darts' && l.w !== 'chainsaw';
        const rot = upright ? q.multiply(TILT) : q;
        for (const [g, m] of flatten(`weapon:${l.w}:${l.rarity}`, () => weaponModel(l.w, l.rarity))) this.add(g, m, v.set(l.x, l.y + bob + (upright ? 0.1 : 0), l.z), rot, sc.set(1.3, 1.3, 1.3));
        this.add(discGeo, discMat(col), v.set(l.x, l.y + 0.04, l.z), FLAT, sc.set(1, 1, 1));
        // every weapon gets a light beam so loot is easy to spot in the dark; rarer ones are taller
        const h = 1.4 + l.rarity * 1.4;
        this.add(beamGeo, beamMat(col), v.set(l.x, l.y + h / 2, l.z), q.identity(), sc.set(1, h, 1));
        continue;
      }
      for (const [g, m] of flatten(`item:${l.kind}:${l.ammo}:${l.item}`, () => itemModel(l))) this.add(g, m, v.set(l.x, l.y + bob, l.z), q, sc.set(1, 1, 1));
    }
    for (const p of this.pools.values()) {
      p.mesh.count = p.n;
      p.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
