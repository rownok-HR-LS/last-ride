// One shared KTX2 decoder for the GPU-compressed textures (scripts/ktx-compress.mjs): the Basis transcoder turns each
// texture into whatever compressed format this machine's GPU takes (BC1/BC3 on desktops, ETC2/ASTC on phones).
// Models start loading before the game's renderer exists, so the GPU's formats are read from a throwaway context.
import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

let loader = null;
export function ktx2() {
  if (loader) return loader;
  loader = new KTX2Loader().setTranscoderPath('./basis/');
  const gl = document.createElement('canvas').getContext('webgl2');
  const exts = new Map();
  const get = (name) => {
    if (!exts.has(name)) exts.set(name, gl?.getExtension(name) || null);
    return exts.get(name);
  };
  loader.detectSupport({ isWebGPURenderer: false, extensions: { has: (n) => !!get(n), get } });
  // our textures are ETC1S: BC7 would hold them at twice the memory of BC1/BC3 for no visible gain
  if (loader.workerConfig.dxtSupported) loader.workerConfig.bptcSupported = false;
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return loader;
}

/** A KTX2 texture that can be used at once: empty until its data arrives (pictures stored flipped, sRGB colour). */
export function compressed(url) {
  const t = new THREE.CompressedTexture([], 0, 0);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  ktx2().load(url, (k) => {
    Object.assign(t, { image: k.image, mipmaps: k.mipmaps, format: k.format, type: k.type, colorSpace: k.colorSpace, minFilter: k.minFilter, magFilter: k.magFilter });
    t.generateMipmaps = false;
    t.needsUpdate = true;
  }, undefined, (e) => console.warn(url, e));
  return t;
}
