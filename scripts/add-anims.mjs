// Add the animations made in Blender (scripts/blender/make-anims.py, FBX in assets-src/mixamo/made) to the game's
// public/models/anims.glb, through the same FBX2glTF converter as the Mixamo clips (scripts/convert-models.mjs).
// Clips already in the file under the same names are replaced.
// Usage: node scripts/add-anims.mjs [folder]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, meshopt, mergeDocuments, unpartition } from '@gltf-transform/functions';

const SRC = process.argv[2] || 'assets-src/mixamo/made';
const FILE = 'public/models/anims.glb';
const TMP = path.join(tmpdir(), 'lr-fbx-made');
const FBX2GLTF = 'node_modules/fbx2gltf/bin/Windows_NT/FBX2glTF.exe';
mkdirSync(TMP, { recursive: true });
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(FILE);
const files = readdirSync(SRC).filter((f) => f.endsWith('.fbx'));
const names = new Set(files.map((f) => path.basename(f, '.fbx')));
for (const a of doc.getRoot().listAnimations()) if (names.has(a.getName())) a.dispose();
for (const f of files) {
  const clip = path.basename(f, '.fbx');
  const out = path.join(TMP, clip);
  execFileSync(FBX2GLTF, ['--binary', '--input', path.join(SRC, f), '--output', out], { stdio: 'ignore' });
  const add = await io.read(`${out}.glb`);
  for (const m of add.getRoot().listMeshes()) m.dispose();
  for (const s of add.getRoot().listSkins()) s.dispose();
  add.getRoot().listAnimations().forEach((a, i) => a.setName(i ? `${clip}_${i}` : clip));
  mergeDocuments(doc, add);
}
await doc.transform(unpartition(), resample(), dedup(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(FILE, doc);
console.log('added', [...names].join(', '), '|', doc.getRoot().listAnimations().length, 'clips,', Math.round(statSync(FILE).size / 1024), 'KB');
