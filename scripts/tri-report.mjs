// Triangles and size per scenery model: node scripts/tri-report.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const rows = [];
for (const dir of ['public/models/env', 'public/models']) {
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.glb'))) {
    const file = path.join(dir, f);
    const doc = await io.read(file);
    let tris = 0;
    const mats = new Set();
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
      if (p.getMaterial()) mats.add(p.getMaterial().getName());
    }
    rows.push([file, Math.round(tris / 1000), (statSync(file).size / 1e6).toFixed(1), [...mats].slice(0, 4).join(',')]);
  }
}
rows.sort((a, b) => b[1] - a[1]);
for (const r of rows.slice(0, 25)) console.log(r[1] + 'k', r[2] + 'MB', r[0], r[3]);
