// Prints a GLB's skins, bone names, meshes and size, to check whether it fits the Mixamo animations.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
const doc = await io.read(process.argv[2]);
const r = doc.getRoot();
console.log('skins', r.listSkins().map((s) => `${s.getName()}:${s.listJoints().length}`).join(' '));
const joints = r.listSkins()[0]?.listJoints().map((j) => j.getName()) || [];
console.log('joints', joints.slice(0, 70).join(', '));
console.log('meshes', r.listMeshes().map((m) => `${m.getName()}(${m.listPrimitives().length})`).join(' '));
console.log('anims', r.listAnimations().map((a) => a.getName()).join(' '));
console.log('textures', r.listTextures().length, r.listTextures().map((t) => t.getSize()?.join('x')).slice(0, 8).join(' '));
