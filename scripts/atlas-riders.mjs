// Fold a rider's many solid-part textures into one atlas so the solid body draws in one call instead of 9-26. Each
// part's texture goes into a square cell, sized by how much it shows (skin and clothes big, teeth, tongue and nails
// small, palette swatches tiny); its UVs are moved into that cell. The game's mergeSkinned then joins every part that
// shares a material into one mesh. Normal and roughness maps are dropped (at night, under rain, a scanned rider's
// colour map carries nearly all of it).
// See-through parts (hair, beard, lashes) are left as they are unless --clear is given: drawn as one mesh, their
// stacked layers blend in a different order and a grey beard came out black.
// Usage: node scripts/atlas-riders.mjs spice oldlady balthazar businessman   (rewrites public/models/<name>.glb)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, dedup, reorder, quantize } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { statSync } from 'node:fs';

const ATLAS = 2048;
const PAD = 4;
const SMALL = /teeth|tongue|nail|eye|cornea|mouth|pocket|button|waistband|belt|cuff|lash/i;

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** Power-of-two squares into a square: split free squares into quarters until one fits. */
function packer(size) {
  const free = [{ x: 0, y: 0, s: size }];
  return (s) => {
    free.sort((a, b) => a.s - b.s);
    const i = free.findIndex((f) => f.s >= s);
    if (i < 0) return null;
    let f = free.splice(i, 1)[0];
    while (f.s > s) {
      const h = f.s / 2;
      free.push({ x: f.x + h, y: f.y, s: h }, { x: f.x, y: f.y + h, s: h }, { x: f.x + h, y: f.y + h, s: h });
      f = { x: f.x, y: f.y, s: h };
    }
    return f;
  };
}

const pow2 = (v) => 2 ** Math.round(Math.log2(Math.max(1, v)));

async function atlas(doc, name) {
  const root = doc.getRoot();
  if (root.listMaterials().some((m) => m.getName().startsWith('atlas_'))) return console.log(`${name}: already folded`);
  const prims = [];
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) prims.push({ prim, mat: prim.getMaterial() });

  for (const group of process.argv.includes('--clear') ? ['solid', 'clear'] : ['solid']) {
    const list = prims.filter(({ mat }) => ((mat?.getAlphaMode() ?? 'OPAQUE') === 'OPAQUE') === (group === 'solid'));
    if (list.length < 2) continue;
    // one cell per (texture, colour factor); each primitive keeps the UV tile it lives in (UDIM-style 1..2, 2..3)
    const cells = new Map();
    for (const it of list) {
      const uv = it.prim.getAttribute('TEXCOORD_0');
      const tex = it.mat?.getBaseColorTexture() ?? null;
      const factor = it.mat?.getBaseColorFactor() ?? [1, 1, 1, 1];
      let lo = [Infinity, Infinity];
      let hi = [-Infinity, -Infinity];
      const a = [0, 0];
      if (uv) {
        for (let i = 0; i < uv.getCount(); i++) {
          uv.getElement(i, a);
          lo = [Math.min(lo[0], a[0]), Math.min(lo[1], a[1])];
          hi = [Math.max(hi[0], a[0]), Math.max(hi[1], a[1])];
        }
      } else lo = hi = [0.5, 0.5];
      const off = [Math.floor((lo[0] + hi[0]) / 2), Math.floor((lo[1] + hi[1]) / 2)];
      if (tex && (lo[0] - off[0] < -0.01 || hi[0] - off[0] > 1.01 || lo[1] - off[1] < -0.01 || hi[1] - off[1] > 1.01)) {
        console.log(`${name}: ${it.mat.getName()} tiles its texture (${lo} .. ${hi}); leaving the ${group} parts alone`);
        cells.clear();
        break;
      }
      it.off = off;
      const key = `${tex ? root.listTextures().indexOf(tex) : 'none'}|${factor.map((v) => v.toFixed(3))}`;
      if (!cells.has(key)) cells.set(key, { tex, factor, users: [], tris: 0, name: it.mat?.getName() ?? '' });
      const c = cells.get(key);
      c.users.push(it);
      c.tris += (it.prim.getIndices()?.getCount() ?? uv?.getCount() ?? 0) / 3;
      it.cell = c;
    }
    if (!cells.size) continue;
    // how big each cell wants to be
    for (const c of cells.values()) {
      const [w, h] = c.tex?.getSize() ?? [4, 4];
      const swatch = Math.max(w, h) <= 64;
      c.want = swatch ? 16 : Math.min(pow2(Math.max(w, h)), SMALL.test(c.name) || c.tris < 300 ? 256 : 1024);
    }
    // shrink the biggest cells until everything fits
    let placed = null;
    for (let tries = 0; tries < 8 && !placed; tries++) {
      const pack = packer(ATLAS);
      const order = [...cells.values()].sort((a, b) => b.want - a.want);
      placed = order.every((c) => (c.at = pack(c.want))) ? order : null;
      if (!placed) {
        const top = Math.max(...order.map((c) => c.want));
        for (const c of order) if (c.want === top && top > 64) c.want /= 2;
      }
    }
    if (!placed) {
      console.log(`${name}: ${group} parts do not fit one atlas; left alone`);
      continue;
    }
    // paint the atlas
    const layers = [];
    for (const c of placed) {
      const inner = c.at.s - 2 * PAD;
      // a texture's colour factor is linear; the image is sRGB: scale by the factor's sRGB value
      const k = c.factor.slice(0, 3).map((v) => Math.pow(v, 1 / 2.2));
      let img;
      if (c.tex) {
        const { data, info } = await sharp(Buffer.from(c.tex.getImage())).ensureAlpha().resize(inner, inner, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
        // the factor's alpha matters too: thin hair layers are made see-through by it, not by their texture
        const mul = [...k, c.factor[3]];
        if (mul.some((v) => v < 0.999)) for (let i = 0; i < data.length; i++) data[i] = Math.round(data[i] * mul[i % 4]);
        img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
      } else {
        img = sharp({ create: { width: inner, height: inner, channels: 4, background: { r: k[0] * 255, g: k[1] * 255, b: k[2] * 255, alpha: c.factor[3] } } });
      }
      const buf = await img.extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, extendWith: 'copy' }).png().toBuffer();
      layers.push({ input: buf, left: c.at.x, top: c.at.y });
    }
    const base = group === 'solid' ? { r: 110, g: 100, b: 92, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 };
    const png = await sharp({ create: { width: ATLAS, height: ATLAS, channels: 4, background: base } }).composite(layers).png().toBuffer();
    const webp = await sharp(png).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toBuffer();
    const tex = doc.createTexture(`atlas_${group}`).setImage(webp).setMimeType('image/webp');
    const anyDouble = list.some(({ mat }) => mat?.getDoubleSided());
    const mat = doc.createMaterial(`atlas_${group}`)
      .setBaseColorTexture(tex)
      .setAlphaMode(group === 'solid' ? 'OPAQUE' : 'BLEND')
      .setDoubleSided(anyDouble)
      .setRoughnessFactor(0.85)
      .setMetallicFactor(0);
    // move every primitive's UVs into its cell (copies: an accessor can be shared)
    for (const it of list) {
      const { at } = it.cell;
      const inner = at.s - 2 * PAD;
      const uv = it.prim.getAttribute('TEXCOORD_0');
      const out = doc.createAccessor().setType('VEC2');
      const n = uv ? uv.getCount() : it.prim.getAttribute('POSITION').getCount();
      const arr = new Float32Array(n * 2);
      const a = [0.5, 0.5];
      for (let i = 0; i < n; i++) {
        if (uv) uv.getElement(i, a);
        const u = Math.min(1, Math.max(0, a[0] - it.off[0]));
        const v = Math.min(1, Math.max(0, a[1] - it.off[1]));
        arr[i * 2] = (at.x + PAD + u * inner) / ATLAS;
        arr[i * 2 + 1] = (at.y + PAD + v * inner) / ATLAS;
      }
      out.setArray(arr);
      if (uv) out.setBuffer(uv.getBuffer());
      else out.setBuffer(root.listBuffers()[0]);
      it.prim.setAttribute('TEXCOORD_0', out).setMaterial(mat);
    }
    console.log(`${name}: ${group} ${list.length} parts, ${cells.size} cells -> one ${ATLAS} atlas (${(webp.length / 1024) | 0} KB)`);
  }
}

for (const name of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  const file = `public/models/${name}.glb`;
  const before = statSync(file).size;
  const doc = await io.read(file);
  await atlas(doc, name);
  // squeeze everything but the positions, as convert-sketchfab does: quantised positions would give every part its
  // own bind matrices, and the game could no longer merge the parts into one mesh
  await doc.transform(
    prune(),
    dedup(),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern: /^(NORMAL|TANGENT|TEXCOORD_\d+|WEIGHTS_\d+)$/, quantizeNormal: 10, quantizeTexcoord: 14, quantizeWeight: 8 }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  // parts that ended up with identical copies of one skin share it again
  const root = doc.getRoot();
  const nodes = root.listNodes();
  const skinKey = (s) => `${s.listJoints().map((j) => nodes.indexOf(j)).join()}|${Array.from(s.getInverseBindMatrices()?.getArray() ?? []).map((v) => v.toFixed(4)).join()}`;
  const firstSkin = new Map();
  for (const n of nodes) {
    const s = n.getSkin();
    if (!s) continue;
    const k = skinKey(s);
    if (!firstSkin.has(k)) firstSkin.set(k, s);
    else n.setSkin(firstSkin.get(k));
  }
  await doc.transform(prune());
  await io.write(file, doc);
  console.log(`${name}: ${(before / 1048576).toFixed(2)} MB -> ${(statSync(file).size / 1048576).toFixed(2)} MB, ${doc.getRoot().listMaterials().length} materials`);
}
