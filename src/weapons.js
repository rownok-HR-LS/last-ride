// 3D models for the melee and ranged weapons, projectiles and occult tools (built from simple shapes and photo textures).
import * as THREE from 'three';
import { RARITIES } from '../shared/items.js';
import { pbr } from './textures.js';

const cache = new Map();
function mat(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}
const photo = (name, color, rough, metal) => mat(`photo:${name}:${color}`, () => {
  const t = pbr(name);
  return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, color, roughness: rough, metalness: metal });
});
const plain = (color, rough = 0.6, metal = 0, emissive = null) => mat(`plain:${color}:${rough}:${metal}:${emissive}`, () => new THREE.MeshStandardMaterial({
  color, roughness: rough, metalness: metal, ...(emissive ? { emissive, emissiveIntensity: 0.6 } : {}),
}));
const WOOD = () => photo('weathered_planks', '#a88b6c', 0.85, 0);
const STEEL = () => plain('#8c9096', 0.35, 0.9);
const RUST = () => photo('rusty_metal_02', '#b0a59a', 0.7, 0.6);
const BLACK = () => plain('#18171a', 0.6, 0.2);

function cyl(r, len, m, x, y, z, rx = 0, rz = 0, r2 = r, seg = 10) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), m);
  o.position.set(x, y, z);
  o.rotation.set(rx, 0, rz);
  return o;
}
function box(w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  return o;
}
function band(rarity, y, r = 0.022, axis = 'y') {
  const c = RARITIES[rarity].color;
  const o = cyl(r, 0.03, plain(c, 0.4, 0.3, c), 0, axis === 'y' ? y : 0, axis === 'y' ? 0 : y, axis === 'y' ? 0 : Math.PI / 2);
  return o;
}

/**
 * How a weapon is held. 'hand': gripped in the right hand, the handle along +y from the grip (melee, darts).
 * 'aim': like a rifle, pointing along -z from the grip. 'bow': in the left hand, the string toward +z.
 */
export const GRIP = {
  mallet: 'hand', spike: 'hand', lever: 'hand', sledge: 'hand', crowbar: 'hand', machete: 'hand', axe: 'hand', chainsaw: 'hand',
  darts: 'hand', bow: 'bow', crossbow: 'aim', harpoon: 'aim', fireworks: 'aim',
};

export function weaponModel(w, rarity = 0) {
  const g = new THREE.Group();
  const add = (...o) => g.add(...o);
  switch (w) {
    case 'mallet': {
      // carnival whack-a-mole mallet: wooden handle, padded red head
      add(cyl(0.017, 0.55, WOOD(), 0, 0.16, 0));
      add(cyl(0.075, 0.22, plain('#b8242a', 0.75), 0, 0.46, 0, 0, Math.PI / 2, 0.075, 16));
      add(cyl(0.077, 0.02, plain('#f2c53a', 0.6), 0.1, 0.46, 0, 0, Math.PI / 2, 0.077, 16));
      add(cyl(0.077, 0.02, plain('#f2c53a', 0.6), -0.1, 0.46, 0, 0, Math.PI / 2, 0.077, 16));
      add(band(rarity, -0.08));
      break;
    }
    case 'spike': {
      // cotton-candy stand spike: a long steel skewer with a sticky pink tuft
      add(cyl(0.02, 0.16, plain('#d9cfc0', 0.8), 0, 0, 0));
      add(cyl(0.006, 0.62, STEEL(), 0, 0.39, 0, 0, 0, 0.0015));
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), plain('#e98ab8', 0.95));
      tuft.scale.set(1, 0.6, 1);
      tuft.position.y = 0.12;
      add(tuft);
      add(band(rarity, -0.09));
      break;
    }
    case 'lever': {
      // a ride's brake lever, torn off: steel bar with a red ball knob
      add(cyl(0.016, 0.85, RUST(), 0, 0.3, 0));
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), plain('#c22a22', 0.35, 0.1));
      knob.position.y = 0.74;
      add(knob);
      add(box(0.06, 0.03, 0.03, RUST(), 0, -0.12, 0));
      add(band(rarity, 0.06));
      break;
    }
    case 'sledge': {
      // strongman game hammer
      add(cyl(0.02, 0.9, WOOD(), 0, 0.32, 0));
      add(box(0.26, 0.1, 0.1, RUST(), 0, 0.8, 0));
      add(box(0.02, 0.11, 0.11, plain('#c22a22', 0.5), 0.12, 0.8, 0));
      add(box(0.02, 0.11, 0.11, plain('#c22a22', 0.5), -0.12, 0.8, 0));
      add(band(rarity, -0.08));
      break;
    }
    case 'crowbar': {
      add(cyl(0.012, 0.72, RUST(), 0, 0.26, 0, 0, 0, 0.012, 6));
      add(cyl(0.012, 0.14, RUST(), 0.04, 0.66, 0, 0, -0.9, 0.012, 6));
      add(cyl(0.01, 0.06, RUST(), 0.035, -0.11, 0, 0, 0.5, 0.006, 6));
      add(band(rarity, 0.02, 0.015));
      break;
    }
    case 'machete': {
      add(box(0.028, 0.14, 0.03, BLACK(), 0, 0, 0));
      const blade = box(0.005, 0.46, 0.06, STEEL(), 0, 0.3, 0.008);
      add(blade);
      add(box(0.006, 0.08, 0.075, STEEL(), 0, 0.5, 0.014, 0.35));
      add(band(rarity, -0.08, 0.02));
      break;
    }
    case 'axe': {
      // red fire axe
      add(cyl(0.018, 0.82, WOOD(), 0, 0.3, 0));
      add(box(0.03, 0.09, 0.16, plain('#a3221d', 0.45, 0.4), 0, 0.66, 0.06));
      add(box(0.012, 0.12, 0.03, STEEL(), 0, 0.66, 0.15));
      add(box(0.024, 0.04, 0.1, plain('#a3221d', 0.45, 0.4), 0, 0.66, -0.06, 0.25));
      add(band(rarity, -0.08));
      break;
    }
    case 'chainsaw': {
      add(box(0.1, 0.17, 0.26, plain('#d4651c', 0.55, 0.1), 0, 0.02, 0.08));
      add(box(0.02, 0.06, 0.48, STEEL(), 0, 0.02, -0.28));
      add(box(0.03, 0.07, 0.03, BLACK(), 0, 0.13, 0.1));
      add(cyl(0.012, 0.12, BLACK(), 0, 0.14, 0.02, Math.PI / 2));
      add(band(rarity, 0.2, 0.03, 'z'));
      break;
    }
    case 'darts': {
      // three darts held together, points out of the thumb side of the fist
      const d = new THREE.Group();
      d.rotation.x = Math.PI / 2;
      for (const [x, y] of [[0, 0], [0.018, 0.012], [-0.016, 0.014]]) {
        d.add(cyl(0.004, 0.13, STEEL(), x, y, -0.03, Math.PI / 2, 0, 0.001));
        d.add(cyl(0.008, 0.06, plain(RARITIES[rarity].color, 0.5), x, y, 0.05, Math.PI / 2));
        d.add(box(0.03, 0.002, 0.04, plain('#f2f0e8', 0.8), x, y, 0.1));
      }
      add(d);
      break;
    }
    case 'bow': {
      // recurve hunting bow, held at the grip; limbs up and down, string toward the archer
      const limb = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.012, 6, 24, 1.7), WOOD());
      limb.rotation.set(0, Math.PI / 2, Math.PI - 0.85);
      limb.position.z = 0.5;
      add(limb);
      add(cyl(0.022, 0.12, BLACK(), 0, 0, 0));
      const top = new THREE.Vector3(0, Math.sin(0.85) * 0.62, 0.5 - Math.cos(0.85) * 0.62);
      const string = new THREE.BufferGeometry().setFromPoints([top, new THREE.Vector3(0, -top.y, top.z)]);
      add(new THREE.Line(string, new THREE.LineBasicMaterial({ color: '#d8d0c0' })));
      add(band(rarity, 0.07, 0.024));
      break;
    }
    case 'crossbow': {
      add(box(0.05, 0.06, 0.62, WOOD(), 0, 0.02, -0.12));
      const prod = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.012, 6, 20, 1.6), STEEL());
      prod.rotation.set(Math.PI / 2, 0, Math.PI / 2 - 0.8 + Math.PI);
      prod.position.set(0, 0.05, -0.12);
      add(prod);
      add(box(0.03, 0.09, 0.04, BLACK(), 0, -0.04, 0.03));
      add(cyl(0.005, 0.4, STEEL(), 0, 0.075, -0.2, Math.PI / 2));
      add(band(rarity, -0.3, 0.03, 'z'));
      break;
    }
    case 'harpoon': {
      add(cyl(0.035, 0.7, plain('#2d4a3a', 0.5, 0.5), 0, 0.04, -0.2, Math.PI / 2));
      add(cyl(0.008, 0.3, STEEL(), 0, 0.04, -0.68, Math.PI / 2, 0, 0.002));
      add(box(0.035, 0.1, 0.045, BLACK(), 0, -0.04, 0.03));
      add(box(0.04, 0.05, 0.2, BLACK(), 0, 0.02, 0.18));
      add(band(rarity, -0.05, 0.04, 'z'));
      break;
    }
    case 'fireworks': {
      // a cardboard firework tube on the shoulder
      add(cyl(0.06, 0.95, plain('#a8201c', 0.85), 0, 0.06, -0.15, Math.PI / 2, 0, 0.06, 14));
      for (const z of [-0.5, -0.3, 0.1]) add(cyl(0.062, 0.04, plain('#f2c53a', 0.8), 0, 0.06, z, Math.PI / 2, 0, 0.062, 14));
      add(box(0.03, 0.1, 0.04, BLACK(), 0, -0.04, 0.03));
      add(band(rarity, 0.25, 0.064, 'z'));
      break;
    }
    default:
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = false;
  });
  return g;
}

/** Projectiles in flight and stuck in things, pointing along -z. */
export function projectileModel(kind) {
  const g = new THREE.Group();
  switch (kind) {
    case 'bow':
    case 'crossbow': {
      const len = kind === 'bow' ? 0.75 : 0.4;
      g.add(cyl(0.006, len, WOOD(), 0, 0, 0, Math.PI / 2));
      g.add(cyl(0.016, 0.06, STEEL(), 0, 0, -len / 2 - 0.02, -Math.PI / 2, 0, 0.001));
      g.add(box(0.002, 0.03, 0.08, plain('#c43a2a', 0.8), 0, 0.012, len / 2 - 0.05));
      g.add(box(0.03, 0.002, 0.08, plain('#c43a2a', 0.8), 0, 0, len / 2 - 0.05));
      break;
    }
    case 'darts': {
      g.add(cyl(0.004, 0.08, STEEL(), 0, 0, -0.05, Math.PI / 2, 0, 0.001));
      g.add(cyl(0.008, 0.06, plain('#e0b030', 0.5), 0, 0, 0.02, Math.PI / 2));
      g.add(box(0.03, 0.002, 0.04, plain('#f2f0e8', 0.8), 0, 0, 0.07));
      break;
    }
    case 'harpoon': {
      g.add(cyl(0.01, 1.0, STEEL(), 0, 0, 0, Math.PI / 2));
      g.add(cyl(0.03, 0.12, STEEL(), 0, 0, -0.55, -Math.PI / 2, 0, 0.001));
      break;
    }
    case 'fireworks': {
      g.add(cyl(0.035, 0.4, plain('#e83a2a', 0.7), 0, 0, 0, Math.PI / 2));
      g.add(cyl(0.035, 0.12, plain('#f2c53a', 0.7), 0, 0, -0.26, -Math.PI / 2, 0, 0.001));
      break;
    }
    case 'holy': {
      const bottle = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshStandardMaterial({
        color: '#9fd8ff', roughness: 0.1, metalness: 0, transparent: true, opacity: 0.75, emissive: '#2a6aa8', emissiveIntensity: 0.6,
      }));
      bottle.scale.set(1, 1.3, 1);
      g.add(bottle, cyl(0.02, 0.06, plain('#d8d0c0', 0.5), 0, 0.09, 0));
      break;
    }
    case 'flare': {
      g.add(cyl(0.018, 0.22, plain('#c4221a', 0.6), 0, 0, 0, Math.PI / 2));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffd0b0', toneMapped: false })));
      g.children[1].position.z = -0.12;
      break;
    }
    default:
      g.add(box(0.05, 0.05, 0.2, STEEL(), 0, 0, 0));
  }
  return g;
}

/** Small models for occult loot and tickets lying on the floor. */
export function itemModel(kind) {
  const g = new THREE.Group();
  if (kind === 'tickets') {
    // a fan of orange carnival tickets
    for (let i = 0; i < 4; i++) g.add(box(0.12, 0.004, 0.05, plain('#f08a2a', 0.8), (i - 1.5) * 0.02, i * 0.005, 0, 0, i * 0.25));
  } else if (kind === 'holy' || kind === 'flare') {
    g.add(projectileModel(kind));
    if (kind === 'flare') g.rotation.x = Math.PI / 2;
  } else if (kind === 'salt') {
    g.add(cyl(0.06, 0.16, plain('#2a4a8c', 0.6), 0, 0.08, 0), cyl(0.06, 0.03, plain('#d8d8d8', 0.4, 0.6), 0, 0.17, 0));
  } else if (kind === 'relic') {
    // a tarnished gold reliquary cross
    const gold = plain('#c9a14a', 0.35, 0.9, '#3a2a08');
    g.add(box(0.03, 0.3, 0.03, gold, 0, 0.15, 0), box(0.18, 0.03, 0.03, gold, 0, 0.21, 0));
  }
  return g;
}
