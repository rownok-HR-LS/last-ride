// The perimeter fence as breakable props: the building kit's two fence panels (scripts/blender/build-kit.py) copied
// out as scenery models whose materials are the world's own ('tex:iron', 'tex:plinth', projected at real scale by
// src/models.js), so each 12 m panel can be placed, hidden and broken on its own (shared/map.js, the fence loop).
// Then: node scripts/convert-env.mjs fence_panel_a fence_panel_b, and node scripts/fracture-props.mjs fence_panel_a
// fence_panel_b (which reads its source from assets-src/webp-originals: this writes a copy there too).
import { mkdirSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
mkdirSync('assets-src/webp-originals/public/models/env', { recursive: true });
for (const v of ['a', 'b']) {
  const doc = await io.read(`assets-src/blender/kit/kit_fence_${v}.glb`);
  for (const m of doc.getRoot().listMaterials()) m.setName(`tex:${m.getName()}`);
  await io.write(`assets-src/blender/fence_panel_${v}.glb`, doc);
  await io.write(`assets-src/webp-originals/public/models/env/fence_panel_${v}.glb`, doc);
  console.log(`fence_panel_${v}`);
}
