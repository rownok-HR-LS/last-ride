// The Blender kits (scripts/blender/build-kit.py, build-rides.py) into the game: welded and meshopt-compressed.
// Usage: node scripts/pack-kit.mjs  (reads assets-src/blender/kit and assets-src/blender/rides, writes public/models/kit)
import { readdirSync, statSync } from 'node:fs';
import { MeshoptEncoder } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, prune, meshopt } from '@gltf-transform/functions';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
for (const dir of ['assets-src/blender/kit', 'assets-src/blender/rides']) {
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.glb'))) {
    const doc = await io.read(`${dir}/${f}`);
    await doc.transform(weld(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await io.write(`public/models/kit/${f}`, doc);
    console.log(f, (statSync(`public/models/kit/${f}`).size / 1024) | 0, 'KB');
  }
}
