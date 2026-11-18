// Packs the neon tube models (scripts/blender/neon.py -> assets-src/blender/neon/neon_<slug>.glb) for the game:
// welded, simplified a little (the tubes are thin; the simplifier keeps their shape), quantised and meshopt-compressed
// into public/models/neon/. Usage: node scripts/pack-neon.mjs
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, quantize, meshopt, prune, dedup } from '@gltf-transform/functions';

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const SRC = 'assets-src/blender/neon';
const OUT = 'public/models/neon';
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(SRC).filter((n) => n.endsWith('.glb'))) {
  const doc = await io.read(`${SRC}/${f}`);
  await doc.transform(dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.6, error: 0.0004 }), prune(), quantize({ quantizePosition: 14 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(`${OUT}/${f}`, doc);
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  console.log(`${OUT}/${f}: ${Math.round(tris)} tris, ${Math.round(statSync(`${OUT}/${f}`).size / 1024)} KB`);
}
