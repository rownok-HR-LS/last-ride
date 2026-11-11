// The moonlight's shadow stand-in (scripts/blender/shadow-proxy.py) into the game: welded and meshopt-compressed.
// Usage: node scripts/pack-shadow-proxy.mjs  (assets-src/blender/shadow/shadow_proxy.glb -> public/models)
import { statSync } from 'node:fs';
import { MeshoptEncoder } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, prune, quantize, meshopt } from '@gltf-transform/functions';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read('assets-src/blender/shadow/shadow_proxy.glb');
await doc.transform(weld(), prune(), quantize({ quantizePosition: 16 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await io.write('public/models/shadow_proxy.glb', doc);
console.log('shadow_proxy.glb', (statSync('public/models/shadow_proxy.glb').size / 1024) | 0, 'KB');
