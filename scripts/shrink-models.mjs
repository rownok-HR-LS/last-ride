// Smaller downloads for the heaviest models, without a visible change:
//   anims.glb   the animations: keyframes packed with meshopt's filters (rotations as compact quaternions)
//   riders      normals, texture coordinates and bone weights packed into small integers (KHR_mesh_quantization),
//               positions left as they are (the skeletons bind to exact positions; see scripts/atlas-riders.mjs)
//   bus.glb     the bus body simplified to about half its triangles (still far more than a 4 cm screen pixel shows)
// The originals are kept once in assets-src/glb-originals, so a re-run always starts from them.
// Usage: node scripts/shrink-models.mjs
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { meshopt, prune, quantize, reorder, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const ORIG = 'assets-src/glb-originals';
mkdirSync(ORIG, { recursive: true });
const RIDERS = ['balthazar', 'businessman', 'carla', 'claudia', 'eric', 'manuel', 'nathan', 'oldlady', 'sophia', 'spice', 'bgpeople_0', 'bgpeople_1', 'bgpeople_2', 'bgpeople_3'];

/** Read the original (saving it the first time), run fn on it, write it back to public/models. */
async function shrink(name, fn) {
  const pub = `public/models/${name}.glb`;
  const orig = `${ORIG}/${name}.glb`;
  if (!existsSync(pub)) return;
  if (!existsSync(orig)) copyFileSync(pub, orig);
  const doc = await io.read(orig);
  await fn(doc);
  await io.write(pub, doc);
  const a = statSync(orig).size;
  const b = statSync(pub).size;
  console.log(`${name}.glb ${Math.round(a / 1024)} -> ${Math.round(b / 1024)} kB`);
  return [a, b];
}

const sizes = [];
sizes.push(await shrink('anims', (doc) => doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'high' }))));
for (const r of RIDERS) {
  sizes.push(await shrink(r, async (doc) => {
    await doc.transform(
      reorder({ encoder: MeshoptEncoder, target: 'size' }),
      quantize({ pattern: /^(NORMAL|TANGENT|TEXCOORD_\d+|WEIGHTS_\d+)$/, quantizeNormal: 10, quantizeTexcoord: 14, quantizeWeight: 8 }),
      prune(),
    );
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  }));
}
sizes.push(await shrink('bus', (doc) => doc.transform(
  weld({ tolerance: 0.0001 }),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.002, lockBorder: true }),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
)));
const [a, b] = sizes.filter(Boolean).reduce(([x, y], [p, q]) => [x + p, y + q], [0, 0]);
console.log(`total ${(a / 1048576).toFixed(1)} -> ${(b / 1048576).toFixed(1)} MB`);
