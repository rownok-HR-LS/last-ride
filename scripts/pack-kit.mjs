// The Blender kits (scripts/blender/build-kit.py, build-rides.py) and the weapons (build-weapons.py) into the game:
// welded and meshopt-compressed.
// Usage: node scripts/pack-kit.mjs  (assets-src/blender/{kit,rides} -> public/models/kit, assets-src/blender/weapons -> public/models)
import { readdirSync, statSync, existsSync } from 'node:fs';
import { MeshoptEncoder } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, prune, meshopt } from '@gltf-transform/functions';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const jobs = [['assets-src/blender/kit', 'public/models/kit'], ['assets-src/blender/rides', 'public/models/kit'], ['assets-src/blender/weapons', 'public/models'], ['assets-src/blender/crate', 'public/models/env']];
for (const [dir, out] of jobs) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.glb'))) {
    const doc = await io.read(`${dir}/${f}`);
    await doc.transform(weld(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await io.write(`${out}/${f}`, doc);
    console.log(f, (statSync(`${out}/${f}`).size / 1024) | 0, 'KB');
  }
}
