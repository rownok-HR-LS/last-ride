// Removes animation clips the game never plays from public/models/anims.glb (checked against src/ and shared/,
// including names the code builds: dodge_<dir>, the u_ walk set, RIFLE_SET). Usage: node scripts/prune-anims.mjs name ...
import { statSync } from 'node:fs';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, meshopt, resample } from '@gltf-transform/functions';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const FILE = 'public/models/anims.glb';
const drop = new Set(process.argv.slice(2));
const before = statSync(FILE).size;
const doc = await io.read(FILE);
let gone = 0;
for (const a of doc.getRoot().listAnimations()) {
  if (drop.has(a.getName())) {
    a.dispose();
    gone++;
  }
}
await doc.transform(resample({ tolerance: 1e-3 }), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(FILE, doc);
console.log(`removed ${gone} clips, ${doc.getRoot().listAnimations().length} left, ${Math.round(before / 1024)} KB -> ${Math.round(statSync(FILE).size / 1024)} KB`);
