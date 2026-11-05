// Pack the baked trees (see src/tools/bake-trees.js): textures to 512 px WebP, geometry meshopt-compressed.
// Usage: node scripts/pack-trees.mjs <trees_raw.glb>   ->  public/models/trees.glb
import { MeshoptEncoder } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, meshopt } from '@gltf-transform/functions';
import sharp from 'sharp';
import { statSync } from 'node:fs';

const src = process.argv[2];
if (!src) {
  console.error('node scripts/pack-trees.mjs <trees_raw.glb>');
  process.exit(1);
}
const out = 'public/models/trees.glb';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
console.log('textures', doc.getRoot().listTextures().map((t) => `${t.getName() || '?'} ${t.getMimeType()} ${(t.getImage()?.byteLength / 1024) | 0}KB`).join(', '));
await doc.transform(
  dedup(),
  prune(),
  // trees are seen from a few metres out at the closest: 512 px is plenty
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 82 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(out, doc);
console.log(out, (statSync(src).size / 1048576).toFixed(1), 'MB ->', (statSync(out).size / 1048576).toFixed(2), 'MB');
