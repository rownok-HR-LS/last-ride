// Packs the blackout cloud (scripts/blender/blackout-cloud.py) for the game: quantised and meshopt-compressed into
// public/models/blackout_cloud.glb. Usage: node scripts/pack-blackout.mjs
import { statSync } from 'node:fs';
import { MeshoptEncoder } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, quantize, meshopt, prune } from '@gltf-transform/functions';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read('assets-src/blender/blackout_cloud.glb');
await doc.transform(weld(), prune(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write('public/models/blackout_cloud.glb', doc);
console.log(`public/models/blackout_cloud.glb ${Math.round(statSync('public/models/blackout_cloud.glb').size / 1024)} KB`);
