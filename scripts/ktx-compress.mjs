// GPU-compressed textures (KTX2 / Basis Universal) for the game: the GLB models' textures and the park's tiling photo
// materials (public/tex/<name>/{diff,nor,arm}). In video memory they stay compressed (about a quarter to an eighth of
// plain RGBA); each machine's GPU format is picked when they load (src/ktx.js).
//   everything -> ETC1S (normal maps at a finer quality): files stay near WebP size, which UASTC would triple
// Needs KTX-Software's `ktx` (C:\Program Files\KTX-Software\bin). The originals are kept once in
// assets-src/webp-originals so a re-run starts from them, not from a compressed copy.
// tex-half: a half-size copy of each photo material in public/tex/<name>/half/, for phones and the Low setting
// (src/textures.js picks it).
// Usage: node scripts/ktx-compress.mjs [models|tex|tex-half|all] [file filter]
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { listTextureSlots } from '@gltf-transform/functions';

const KTX = 'C:/Program Files/KTX-Software/bin/ktx.exe';
const ORIG = 'assets-src/webp-originals';
const TMP = path.join(tmpdir(), 'lr-ktx');
const RIDERS = new Set(['balthazar', 'businessman', 'carla', 'claudia', 'eric', 'manuel', 'nathan', 'oldlady', 'sophia', 'spice', 'bgpeople_0', 'bgpeople_1', 'bgpeople_2', 'bgpeople_3']);
const [what = 'all', filter = ''] = process.argv.slice(2);
mkdirSync(TMP, { recursive: true });
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** Encode one image (any format sharp reads) to KTX2 bytes. */
let n = 0;
async function encode(bytes, { srgb, normal = false, quality = 128, flip = false, scale = 1 }) {
  const id = `${process.pid}_${n++}`;
  const png = path.join(TMP, `${id}.png`);
  const out = path.join(TMP, `${id}.ktx2`);
  let img = sharp(bytes).ensureAlpha();
  if (flip) img = img.flip();
  const meta = await sharp(bytes).metadata();
  // block compression wants sides that are multiples of 4
  const w = Math.max(4, Math.round((meta.width * scale) / 4) * 4);
  const h = Math.max(4, Math.round((meta.height * scale) / 4) * 4);
  if (w !== meta.width || h !== meta.height) img = img.resize(w, h, { fit: 'fill' });
  await img.png().toFile(png);
  // say how the PNG's values are meant, or data (normals, roughness) gets "converted" from sRGB and spoilt
  const args = ['create', '--format', srgb ? 'R8G8B8A8_SRGB' : 'R8G8B8A8_UNORM', '--assign-tf', srgb ? 'srgb' : 'linear', '--generate-mipmap',
    '--encode', 'basis-lz', '--clevel', '2', '--qlevel', String(quality)];
  // (not --normal-mode: that stores X in rgb and Y in alpha, which three.js's normal maps don't read)
  args.push(png, out);
  execFileSync(KTX, args, { stdio: 'pipe' });
  const data = readFileSync(out);
  rmSync(png);
  rmSync(out);
  return data;
}

const kb = (b) => `${Math.round(b / 1024)} KB`;
let before = 0;
let after = 0;

async function model(file) {
  const keep = path.join(ORIG, file);
  if (!existsSync(keep)) {
    mkdirSync(path.dirname(keep), { recursive: true });
    copyFileSync(file, keep);
  }
  const doc = await io.read(keep);
  const rider = RIDERS.has(path.basename(file, '.glb'));
  let done = 0;
  for (const t of doc.getRoot().listTextures()) {
    const mime = t.getMimeType();
    if (mime === 'image/ktx2' || !t.getImage()) continue;
    const slots = listTextureSlots(t);
    const normal = slots.some((s) => /normal/i.test(s));
    const colour = slots.some((s) => /baseColor|emissive|diffuse/i.test(s));
    // the riders' faces are looked at from close up: a finer quality for them
    const data = await encode(t.getImage(), { srgb: colour && !normal, normal, quality: rider || normal ? 220 : 128 });
    t.setImage(data).setMimeType('image/ktx2');
    if (t.getURI()) t.setURI(t.getURI().replace(/\.\w+$/, '.ktx2'));
    done++;
  }
  if (!done) return;
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_texture_webp' && !doc.getRoot().listTextures().some((t) => t.getMimeType() === 'image/webp')) e.dispose();
  await io.write(file, doc);
  const a = statSync(keep).size;
  const b = statSync(file).size;
  before += a;
  after += b;
  console.log(`${file}: ${done} textures, ${kb(a)} -> ${kb(b)}`);
}

async function photoTextures(half = false) {
  for (const name of readdirSync('public/tex')) {
    const dir = `public/tex/${name}`;
    if (!statSync(dir).isDirectory()) continue;
    for (const [file, srgb, normal] of [['diff', true, false], ['nor', false, true], ['arm', false, false]]) {
      const src = `${dir}/${file}.webp`;
      const keep = path.join(ORIG, src);
      if (!existsSync(keep)) {
        if (!existsSync(src)) continue;
        mkdirSync(path.dirname(keep), { recursive: true });
        copyFileSync(src, keep);
      }
      // TextureLoader flipped these on upload; a compressed texture can't be, so flip the picture instead
      const data = await encode(readFileSync(keep), { srgb, normal, quality: normal ? 220 : 128, flip: true, scale: half ? 0.5 : 1 });
      if (half) mkdirSync(`${dir}/half`, { recursive: true });
      writeFileSync(half ? `${dir}/half/${file}.ktx2` : `${dir}/${file}.ktx2`, data);
      before += statSync(keep).size;
      after += data.length;
    }
    console.log(`${dir}: done`);
  }
}

if (what === 'models' || what === 'all') {
  const files = [
    ...readdirSync('public/models').filter((f) => f.endsWith('.glb')).map((f) => `public/models/${f}`),
    ...readdirSync('public/models/env').filter((f) => f.endsWith('.glb')).map((f) => `public/models/env/${f}`),
  ].filter((f) => f.includes(filter) && !/anims|weapons/.test(f));
  for (const f of files) await model(f);
}
if (what === 'tex' || what === 'all') await photoTextures();
if (what === 'tex-half' || what === 'all') await photoTextures(true);
console.log(`total ${kb(before)} -> ${kb(after)}`);

// the decal sheet and the horizon strip (colour with alpha), flipped like the photo textures
if (what === 'sheets' || what === 'all') {
  for (const name of ['decals', 'horizon']) {
    // pack-decals / pack-horizon write a fresh WebP into public/tex; it moves to the originals once encoded
    const fresh = `public/tex/${name}.webp`;
    const keep = path.join(ORIG, fresh);
    if (existsSync(fresh)) {
      mkdirSync(path.dirname(keep), { recursive: true });
      copyFileSync(fresh, keep);
      rmSync(fresh);
    }
    const data = await encode(readFileSync(keep), { srgb: true, quality: 160, flip: true });
    writeFileSync(`public/tex/${name}.ktx2`, data);
    console.log(`${name}: ${kb(statSync(keep).size)} -> ${kb(data.length)}`);
  }
}
