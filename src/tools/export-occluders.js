// Export everything static that should shade the ground (buildings, tents, rides, booths, props, tree trunks and
// branches) as one GLB for Blender to bake the ground's ambient occlusion from (scripts/blender/bake-ground-ao.py).
// Positions only, one grey material; instanced batches stay instanced (EXT_mesh_gpu_instancing).
// In the dev console, with the scratchpad receiver running:
//   await (await import('/src/tools/export-occluders.js')).exportOccluders(__lr, 'http://127.0.0.1:5299/?n=occluders&ext=glb')
// Run it on a freshly started dev server: once cull.js has been hot-reloaded the game holds a different copy of it
// than this import gets, the culled-away copies stay hidden, and the bake misses them.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { restoreAllInstances } from '../cull.js';

export async function exportOccluders(client, postTo) {
  restoreAllInstances();
  const scene = client.scene;
  scene.updateMatrixWorld(true);
  // things that move, or are people, loot or effects: not occluders
  const skipRoots = new Set([client.bus?.root, client.driver?.root, client.showChar?.root].filter(Boolean));
  for (const c of client.chars?.values() || []) skipRoots.add(c.char.root);
  for (const p of client.lootView?.pools?.values() || []) skipRoots.add(p.mesh);
  const skipped = (o) => {
    for (let p = o; p; p = p.parent) if (skipRoots.has(p) || p.name === 'ground' || p.name === 'wilds') return true;
    return false;
  };
  const solid = (m) => m && !m.transparent && !(m.alphaTest > 0) && m.depthWrite !== false && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial);
  const grey = new THREE.MeshStandardMaterial({ color: '#808080' });
  const root = new THREE.Group();
  const geos = new Map();
  const posOnly = (g) => {
    if (!geos.has(g)) {
      const h = new THREE.BufferGeometry();
      h.setAttribute('position', g.attributes.position);
      if (g.index) h.setIndex(g.index);
      geos.set(g, h);
    }
    return geos.get(g);
  };
  let tris = 0;
  let objects = 0;
  scene.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || skipped(o)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some(solid)) return;
    const g = o.geometry;
    const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (!g.boundingSphere) g.computeBoundingSphere();
    // only what stands near enough to the park's ground to shade it
    const near = (m) => {
      _s.copy(g.boundingSphere).applyMatrix4(m);
      return Math.abs(_s.center.x) - _s.radius < REACH && Math.abs(_s.center.z) - _s.radius < REACH;
    };
    let out;
    if (o.isInstancedMesh) {
      const keep = [];
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, _m);
        _w.multiplyMatrices(o.matrixWorld, _m);
        if (near(_w)) keep.push(_m.clone());
      }
      if (!keep.length) return;
      out = new THREE.InstancedMesh(posOnly(g), grey, keep.length);
      keep.forEach((m, i) => out.setMatrixAt(i, m));
      tris += t * keep.length;
    } else {
      if (!near(o.matrixWorld)) return;
      out = new THREE.Mesh(posOnly(g), grey);
      tris += t;
    }
    o.matrixWorld.decompose(out.position, out.quaternion, out.scale);
    root.add(out);
    objects++;
  });
  const glb = await new GLTFExporter().parseAsync(root, { binary: true });
  if (postTo) await fetch(postTo, { method: 'POST', body: glb });
  return { objects, tris: Math.round(tris), mb: +(glb.byteLength / 1048576).toFixed(1) };
}

const _m = new THREE.Matrix4();
const _w = new THREE.Matrix4();
const _s = new THREE.Sphere();
/** The ground runs 120 m each way from the centre; a little beyond that still casts onto its edge. */
const REACH = 135;
