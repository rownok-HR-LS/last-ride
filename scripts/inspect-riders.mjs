// List a rider model's parts: material, alpha mode, triangles, texture size and UV range. node scripts/inspect-riders.mjs spice oldlady
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
for (const name of process.argv.slice(2)) {
  const doc = await io.read(`public/models/${name}.glb`);
  const root = doc.getRoot();
  console.log(`== ${name}: meshes ${root.listMeshes().length}, skins ${root.listSkins().length}, materials ${root.listMaterials().length}, textures ${root.listTextures().length}`);
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    const m = p.getMaterial();
    const uv = p.getAttribute('TEXCOORD_0');
    let lo = [1e9, 1e9], hi = [-1e9, -1e9];
    if (uv) { const a = []; for (let i = 0; i < uv.getCount(); i++) { uv.getElement(i, a); lo = [Math.min(lo[0], a[0]), Math.min(lo[1], a[1])]; hi = [Math.max(hi[0], a[0]), Math.max(hi[1], a[1])]; } }
    const bc = m?.getBaseColorTexture();
    console.log(`  ${(m?.getName() || '?').slice(0, 22).padEnd(22)} ${m?.getAlphaMode()} tris ${(p.getIndices()?.getCount() / 3) | 0} tex ${bc ? bc.getSize()?.join('x') + ' ' + bc.getMimeType() : '-'} nrm ${m?.getNormalTexture() ? 'y' : '-'} uv [${lo.map((v) => v.toFixed(2))}]..[${hi.map((v) => v.toFixed(2))}]`);
  }
}
