// Splits the 2k night-sky HDR (6.7 MB) into what the game actually needs:
// - sky_bg.jpg: the visible sky at full 2k (sharp stars), stored as value / SKY_SCALE in sRGB; the game multiplies
//   it back up with backgroundIntensity
// - sky_env.hdr: a 512x256 copy for image-based lighting (it is blurred into a PMREM anyway)
// Town lights on the horizon are clamped to SKY_SCALE first, as the game always did (bloom made them huge blobs).
// usage: node scripts/sky.mjs
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import sharp from 'sharp';

export const SKY_SCALE = 2.5;
const SRC = 'assets-src/hdri/kloppenheim_02_2k.hdr';
const OUT = 'public/hdri';

const buf = readFileSync(SRC);
const loader = new HDRLoader().setDataType(THREE.FloatType);
const { width: W, height: H, data } = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const px = (x, y, c) => Math.min(SKY_SCALE, data[(y * W + x) * 4 + c]);

// background: linear / scale, then the sRGB curve, 8 bits
const srgb = (l) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
const bg = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    for (let c = 0; c < 3; c++) bg[(y * W + x) * 3 + c] = Math.round(Math.min(1, srgb(px(x, y, c) / SKY_SCALE)) * 255);
  }
}
await sharp(bg, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toFile(`${OUT}/sky_bg.jpg`);

// lighting: box-filter down to 512x256 and write a flat (uncompressed) Radiance file
const w = 512;
const h = 256;
const fx = W / w;
const fy = H / h;
const rgbe = Buffer.alloc(w * h * 4);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const sum = [0, 0, 0];
    let n = 0;
    for (let yy = Math.floor(y * fy); yy < Math.floor((y + 1) * fy); yy++) {
      for (let xx = Math.floor(x * fx); xx < Math.floor((x + 1) * fx); xx++) {
        for (let c = 0; c < 3; c++) sum[c] += px(xx, yy, c);
        n++;
      }
    }
    const v = sum.map((s) => s / n);
    const m = Math.max(...v);
    const i = (y * w + x) * 4;
    if (m < 1e-32) continue;
    const e = Math.ceil(Math.log2(m) + 1e-9);
    const k = 256 / Math.pow(2, e);
    rgbe[i] = Math.min(255, Math.floor(v[0] * k));
    rgbe[i + 1] = Math.min(255, Math.floor(v[1] * k));
    rgbe[i + 2] = Math.min(255, Math.floor(v[2] * k));
    rgbe[i + 3] = e + 128;
  }
}
writeFileSync(`${OUT}/sky_env.hdr`, Buffer.concat([Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`), rgbe]));
const kb = (f) => `${Math.round(statSync(f).size / 1024)} KB`;
console.log(`sky_bg.jpg ${kb(`${OUT}/sky_bg.jpg`)}, sky_env.hdr ${kb(`${OUT}/sky_env.hdr`)}`);
