// Bake the park's trees into one model file (public/models/trees.glb) so the game needn't ship the tree generator
// and its textures, or grow trees on the player's machine while loading.
// To re-bake: run the dev server and the scratchpad receiver, open the game, and in the console run
//   await (await import('/src/tools/bake-trees.js')).bake('http://127.0.0.1:5299/?n=trees_raw&ext=glb')
// then: node scripts/pack-trees.mjs <that file>   (WebP textures, meshopt geometry -> public/models/trees.glb)
import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { DEAD, LIVING, BARK_TINT } from '../trees.js';

function grow(name, seed, tweak, lite, needles) {
  const tree = new Tree();
  tree.loadPreset(name);
  const o = tree.options;
  o.seed = seed;
  if (!needles) o.leaves.count = 0; // long dead
  tweak(o);
  if (lite) {
    // far away: fewer, chunkier sections, no twigs, sparser needles
    o.branch.levels = Math.min(o.branch.levels, 2);
    for (const k of Object.keys(o.branch.sections)) o.branch.sections[k] = Math.max(3, Math.round(o.branch.sections[k] * 0.5));
    for (const k of Object.keys(o.branch.segments)) o.branch.segments[k] = Math.max(3, Math.round(o.branch.segments[k] * 0.6));
    if (needles) {
      o.leaves.count = Math.max(4, Math.round(o.leaves.count * 0.45));
      o.leaves.size *= 1.35;
    }
  }
  tree.generate();
  const geo = tree.branchesMesh.geometry;
  geo.computeBoundingBox();
  const bb = geo.boundingBox.clone();
  const h = bb.max.y - bb.min.y || 1;
  // 1 m tall with the base at y = 0 (the needles move with the branches)
  const norm = (g) => g.translate(0, -bb.min.y, 0).scale(1 / h, 1 / h, 1 / h);
  norm(geo);
  const src = tree.branchesMesh.material;
  const parts = [new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    name: `bark_${o.bark.type}`,
    color: BARK_TINT[o.bark.type] || '#6e665e',
    map: src.map, normalMap: src.normalMap, roughnessMap: src.roughnessMap, aoMap: src.aoMap,
    roughness: 1, metalness: 0,
  }))];
  if (needles && tree.leavesMesh.geometry.attributes.position) {
    const lsrc = tree.leavesMesh.material;
    parts.push(new THREE.Mesh(norm(tree.leavesMesh.geometry), new THREE.MeshStandardMaterial({
      name: 'needles', color: '#3b4a36', map: lsrc.map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, metalness: 0,
    })));
  }
  return parts;
}

/** Grow every variant (detailed and light), name them full|lite _ dead|living _ index _ part, and post the GLB. */
export async function bake(postTo) {
  const root = new THREE.Group();
  for (const lite of [false, true]) {
    for (const [kind, list, needles] of [['dead', DEAD, false], ['living', LIVING, true]]) {
      list.forEach(([n, s, t], i) => {
        grow(n, s, t, lite, needles).forEach((m, j) => {
          m.name = `${lite ? 'lite' : 'full'}_${kind}_${i}_${j}`;
          root.add(m);
        });
      });
    }
  }
  // textures must have decoded before the exporter draws them
  const imgs = new Set();
  root.traverse((m) => {
    if (!m.isMesh) return;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) if (m.material[k]?.image) imgs.add(m.material[k].image);
  });
  await Promise.all([...imgs].map((im) => im.decode?.().catch(() => {})));
  const glb = await new GLTFExporter().parseAsync(root, { binary: true });
  if (postTo) await fetch(postTo, { method: 'POST', body: glb });
  let tris = 0;
  root.traverse((m) => m.isMesh && (tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3));
  return { meshes: root.children.length, bytes: glb.byteLength, tris };
}
