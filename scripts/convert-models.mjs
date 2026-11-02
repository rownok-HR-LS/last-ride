// Converts the Mixamo FBX downloads (assets-src/mixamo, git-ignored) into small web GLBs in public/models.
// Characters: skinned mesh only, textures shrunk to 1024 WebP, meshopt-compressed.
// Animations: every clip merged into one anims.glb, resampled and compressed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { MeshoptEncoder } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress, meshopt, mergeDocuments, weld, unpartition } from '@gltf-transform/functions';

const SRC = 'assets-src/mixamo';
const OUT = 'public/models';
const TMP = path.join(tmpdir(), 'lr-fbx');
const FBX2GLTF = 'node_modules/fbx2gltf/bin/Windows_NT/FBX2glTF.exe';
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

function fbxToGlb(file, name) {
  const out = path.join(TMP, name);
  execFileSync(FBX2GLTF, ['--binary', '--input', file, '--output', out], { stdio: 'ignore' });
  return `${out}.glb`;
}

const kb = (f) => `${Math.round(statSync(f).size / 1024)} KB`;

// ------------------------------------------------------------------ characters
const only = process.argv[2]; // 'anims' to redo just the animations
for (const f of only === 'anims' ? [] : readdirSync(SRC).filter((f) => f.endsWith('.fbx'))) {
  const name = path.basename(f, '.fbx');
  const doc = await io.read(fbxToGlb(path.join(SRC, f), name));
  for (const a of doc.getRoot().listAnimations()) a.dispose();
  await doc.transform(
    weld(),
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = path.join(OUT, `${name}.glb`);
  await io.write(out, doc);
  console.log('character', name, kb(out));
}

// ------------------------------------------------------------------ animations
const animDir = path.join(SRC, 'anims');
let merged = null;
for (const f of readdirSync(animDir).filter((f) => f.endsWith('.fbx'))) {
  const clip = path.basename(f, '.fbx').replace(/\s+/g, '_');
  const doc = await io.read(fbxToGlb(path.join(animDir, f), `anim_${clip}`));
  // keep the skeleton and the clip, drop any mesh that came along
  for (const m of doc.getRoot().listMeshes()) m.dispose();
  for (const s of doc.getRoot().listSkins()) s.dispose();
  const anims = doc.getRoot().listAnimations();
  anims.forEach((a, i) => a.setName(i ? `${clip}_${i}` : clip));
  if (!merged) merged = doc;
  else mergeDocuments(merged, doc);
}
await merged.transform(unpartition(), resample(), dedup(), prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const animOut = path.join(OUT, 'anims.glb');
await io.write(animOut, merged);
console.log('animations', merged.getRoot().listAnimations().map((a) => a.getName()).join(', '), kb(animOut));
