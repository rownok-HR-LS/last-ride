// Breakable props: each prop model (from the pre-compression copy in assets-src/webp-originals) is decoded to a
// plain GLB, cut into chunks in Blender (scripts/blender/fracture.py) and packed (welded, meshopt) into
// public/models/env/broken/<model>.glb. The chunks carry geometry and material names only; the game paints them
// with the whole prop's own materials (src/debris.js).
// Usage: node scripts/fracture-props.mjs [model ...]
import { mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, prune, meshopt, quantize } from '@gltf-transform/functions';
import { BREAKABLE_MODELS } from '../shared/map.js';

const BLENDER = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const ORIG = 'assets-src/webp-originals/public/models/env';
const OUT = 'public/models/env/broken';
const TMP = path.join(tmpdir(), 'lr-fracture');
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const models = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BREAKABLE_MODELS);
for (const name of models) {
  const cfg = BREAKABLE_MODELS[name];
  // 1. plain: no compression, no textures (Blender only needs shapes, UVs and material names)
  const doc = await io.read(`${ORIG}/${name}.glb`);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const ext of doc.getRoot().listExtensionsUsed()) if (/meshopt|quantization|texture/i.test(ext.extensionName)) ext.dispose();
  const plain = path.join(TMP, `${name}.glb`);
  await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(plain, doc);
  // 2. cut
  const cut = path.join(TMP, `${name}_chunks.glb`);
  const log = execFileSync(BLENDER, ['--background', '--factory-startup', '--python', 'scripts/blender/fracture.py', '--', plain, cut, String(cfg.chunks), String(cfg.seed ?? 7)], { encoding: 'utf8', maxBuffer: 64 << 20 });
  console.log(log.split('\n').find((l) => l.startsWith('FRACTURE')) || log.slice(-800));
  // 3. pack
  const out = await io.read(cut);
  await out.transform(weld(), prune(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await io.write(`${OUT}/${name}.glb`, out);
  console.log(`${name}: ${(statSync(`${OUT}/${name}.glb`).size / 1024) | 0} KB`);
}
