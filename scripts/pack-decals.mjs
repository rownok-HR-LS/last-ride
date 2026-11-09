// The decal tiles rendered in Blender (scripts/blender/make-decals.py) into one 4 x 4 sheet with alpha.
// Usage: node scripts/pack-decals.mjs <tile folder> [preview.jpg]  ->  public/tex/decals.webp
import sharp from 'sharp';
import { statSync } from 'node:fs';

const [dir, preview] = process.argv.slice(2);
const T = 512;
const tiles = [];
for (let i = 0; i < 16; i++) {
  tiles.push({ input: await sharp(`${dir}/tile_${String(i).padStart(2, '0')}.png`).resize(T, T).toBuffer(), left: (i % 4) * T, top: Math.floor(i / 4) * T });
}
const sheet = sharp({ create: { width: 4 * T, height: 4 * T, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(tiles);
const out = 'public/tex/decals.webp';
await sheet.clone().webp({ quality: 86, alphaQuality: 90 }).toFile(out);
console.log(out, (statSync(out).size / 1024) | 0, 'KB');
if (preview) {
  const png = await sharp(out).png().toBuffer();
  const flat = await sharp({ create: { width: 4 * T, height: 4 * T, channels: 3, background: '#6a665e' } }).composite([{ input: png }]).png().toBuffer();
  await sharp(flat).resize(1024).jpeg().toFile(preview);
}
