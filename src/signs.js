// Hanging ride signs: a post with an arm at each ride's entrance and the ride's name painted on a board that hangs
// from two chains (scripts/blender/build-kit.py signpost / signboard). The board swings and twists on its hook in the
// wind, harder in a storm (src/motion.js windAmp), each in its own rhythm.
import * as THREE from 'three';
import { FERRIS, STATION, CAROUSEL, FREEFALL, PROPS } from '../shared/map.js';
import { kitPart } from './kit.js';
import { signTex } from './textures.js';
import { motionTime, windAmp } from './motion.js';

/** The pivot of the board, on the post's arm (kit coordinates). */
const PIVOT = new THREE.Vector3(1.15, 3.3, 0);

/** Where each ride's sign stands: beside it, toward the middle of the park, facing the way people come. */
function spots() {
  const out = [];
  const add = (name, x, z, r) => {
    const d = Math.hypot(x, z) || 1;
    // in front of the ride, toward the park's centre, and a little to the side of its approach
    const px = x - (x / d) * (r + 3.5) + (z / d) * 2.2;
    const pz = z - (z / d) * (r + 3.5) - (x / d) * 2.2;
    out.push({ name, x: px, z: pz, face: Math.atan2(-x / d, -z / d) });
  };
  add('FERRIS WHEEL', FERRIS.x, FERRIS.z, 12);
  add('LOOP-DE-LOOP', STATION.x, STATION.z, 4);
  add('CAROUSEL', CAROUSEL.x, CAROUSEL.z, CAROUSEL.r);
  if (FREEFALL) add('FREE FALL', FREEFALL.x, FREEFALL.z, 3);
  for (const a of PROPS.filter((p) => p.type === 'arena')) add('BUMPER CARS', a.x, a.z, 9);
  return out;
}

/** The signs, as one group to add to the scene. Builder: the world's merged builder (kit parts use it). */
export async function buildSigns(Builder) {
  const [post, board] = await Promise.all([kitPart(Builder, 'signpost'), kitPart(Builder, 'signboard')]);
  const group = new THREE.Group();
  group.name = 'signs';
  spots().forEach((s, i) => {
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    // the arm points along the board's face, so the name reads from the path
    g.rotation.y = s.face + Math.PI / 2;
    g.add(post.clone());
    const pivot = new THREE.Group();
    pivot.position.copy(PIVOT);
    const b = board.clone();
    pivot.add(b);
    // the ride's name on both faces of the board
    const { texture: tex } = signTex(s.name, { color: '#e8c25a' });
    const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, transparent: true });
    for (const side of [1, -1]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.36), face);
      plane.position.set(0, -0.95, side * 0.034);
      if (side < 0) plane.rotation.y = Math.PI;
      pivot.add(plane);
    }
    // swing about the hook (along the board's face) and twist a little, each sign in its own time
    const phase = i * 1.7;
    const swing = b.children.find((o) => o.isMesh) || b;
    swing.onBeforeRender = () => {
      const t = motionTime.value;
      const gust = 0.6 + 0.4 * Math.sin(t * 0.37 + phase);
      const k = 0.06 + 0.32 * windAmp.value * gust;
      pivot.rotation.x = Math.sin(t * 1.7 + phase) * k;
      pivot.rotation.y = Math.sin(t * 0.9 + phase * 1.3) * k * 0.4;
    };
    g.add(pivot);
    group.add(g);
  });
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  // the boards swing: they keep their own shadows (src/shadowproxy.js)
  group.userData.moves = true;
  return group;
}
