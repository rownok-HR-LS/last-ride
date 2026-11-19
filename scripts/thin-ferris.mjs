// The Ferris wheel's bolts (materials bolts1 / bolts2, about 13k of its 36k triangles) are tiny next to an 18 m
// wheel: this simplifies just them in public/models/env/ferris.glb, leaving the rest of the wheel as it is.
// Usage: node scripts/thin-ferris.mjs [ratio=0.25] [error=0.01]  (run on the file as it comes from git: it simplifies in place)
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, meshopt } from '@gltf-transform/functions';

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const FILE = 'public/models/env/ferris.glb';
const ratio = +(process.argv[2] || 0.25);
const error = +(process.argv[3] || 0.01);
const doc = await io.read(FILE);
let before = 0;
let after = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const p of mesh.listPrimitives()) {
    if (!/^bolts/.test(p.getMaterial()?.getName() || '')) continue;
    const pos = p.getAttribute('POSITION');
    const idx = p.getIndices();
    const f = new Float32Array(pos.getCount() * 3);
    const v = [];
    for (let i = 0; i < pos.getCount(); i++) f.set(pos.getElement(i, v), i * 3);
    const src = Uint32Array.from(idx.getArray());
    // error is relative to this part's size (bolts spread over the whole wheel): small, so each bolt keeps its shape
    // (the rough simplifier: each bolt is made of separate flat faces sharing no corners, which stops the careful one)
    const [out] = MeshoptSimplifier.simplifySloppy(src, f, 3, null, Math.floor((src.length * ratio) / 3) * 3, error);
    before += src.length / 3;
    after += out.length / 3;
    idx.setArray(pos.getCount() > 65535 ? out : Uint16Array.from(out));
  }
}
await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(FILE, doc);
console.log(`bolts: ${before} -> ${after} triangles`);
