// Compresses static prop downloads (assets-src/props, git-ignored) into web GLBs in public/models.
import { statSync } from 'node:fs';
import sharp from 'sharp';
import { MeshoptEncoder } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, meshopt, weld, flatten, join } from '@gltf-transform/functions';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['bus']) {
  const doc = await io.read(`assets-src/props/${name}.glb`);
  for (const a of doc.getRoot().listAnimations()) a.dispose();
  await doc.transform(
    dedup(),
    flatten(),
    join(),
    weld(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = `public/models/${name}.glb`;
  await io.write(out, doc);
  console.log(name, `${Math.round(statSync(out).size / 1024)} KB`);
}
