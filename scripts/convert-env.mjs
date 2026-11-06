// Shrinks environment models (Poly Haven glTF, Sketchfab GLB) into web GLBs in public/models/env:
// merged by material, simplified toward a triangle budget, textures to WebP, meshopt-compressed.
// usage: node scripts/convert-env.mjs [name ...]   (names from the ENV table below)
import { readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { ENV } from './convert-env-table.mjs';
import { dedup, prune, textureCompress, meshopt, weld, flatten, join, simplify, metalRough } from '@gltf-transform/functions';

export { ENV };

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
mkdirSync('public/models/env', { recursive: true });

function tris(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
}

/**
 * When seams (texture and normal splits) stop the careful simplifier short of the budget, finish with a rough pass
 * that ignores them: each part gets its share of the budget. Fine for props seen from a few metres away.
 */
function sloppy(doc, budget, error = 0.02) {
  const total = tris(doc);
  if (total <= budget * 1.3) return;
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      const pos = p.getAttribute('POSITION');
      if (!idx || !pos || p.getMode() !== 4) continue;
      const count = idx.getCount();
      const target = Math.max(36, Math.floor(((count / 3) * budget) / total) * 3);
      if (target >= count) continue;
      const verts = new Float32Array(pos.getCount() * 3);
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) verts.set(pos.getElement(i, v), i * 3);
      const [out] = MeshoptSimplifier.simplifySloppy(new Uint32Array(idx.getArray()), verts, 3, null, target, Math.max(0.02, error));
      if (out.length >= 36) idx.setArray(pos.getCount() > 65535 ? out : new Uint16Array(out));
    }
  }
}

function sourceFile(src) {
  const full = path.join('assets-src', src);
  if (full.endsWith('.glb') || full.endsWith('.gltf')) return full;
  const f = readdirSync(full).find((x) => x.endsWith('.gltf') || x.endsWith('.glb'));
  return path.join(full, f);
}

for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ENV)) {
  if (!existsSync(path.join('assets-src', ENV[name][0]))) {
    console.log(name.padEnd(26), 'not downloaded yet');
    continue;
  }
  const [src, budget, tex, keepNodes, error = 0.02] = ENV[name];
  // a Blender atlas bake of the model (scripts/bake-atlases.mjs) stands in for its source when there is one
  const baked = path.join('assets-src', 'blender', 'baked', name + '.glb');
  const doc = await io.read(existsSync(baked) ? baked : sourceFile(src));
  for (const a of doc.getRoot().listAnimations()) a.dispose();
  const before = tris(doc);
  await doc.transform(metalRough(), dedup(), ...(keepNodes ? [] : [flatten(), join()]), weld({ tolerance: 0.0001 }));
  const ratio = Math.min(1, budget / Math.max(1, tris(doc)));
  if (ratio < 1) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
  // (never on a baked atlas: it tears the UV seams; atlas-bake.py cuts those down in Blender before baking)
  if (!existsSync(baked)) sloppy(doc, budget, name.endsWith('_far') ? error : 0.02);
  await doc.transform(
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 80 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = `public/models/env/${name}.glb`;
  await io.write(out, doc);
  console.log(name.padEnd(26), `${Math.round(before)} -> ${Math.round(tris(doc))} tris`, `${Math.round(statSync(out).size / 1024)} KB`);
}
