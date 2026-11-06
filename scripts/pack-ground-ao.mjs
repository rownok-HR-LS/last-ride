// Turn Blender's ground occlusion bake (scripts/blender/bake-ground-ao.py) into the game's texture: grey, a light
// blur to settle grass speckle, a curve that deepens the soft halos round walls and tents (at night they would
// barely read otherwise), WebP. Usage: node scripts/pack-ground-ao.mjs <bake.png>  ->  public/tex/ground_ao.webp
import sharp from 'sharp';
import { statSync } from 'node:fs';

const src = process.argv[2];
const out = 'public/tex/ground_ao.webp';
const { data, info } = await sharp(src).greyscale().blur(1.2).raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i++) data[i] = Math.round(Math.pow(data[i] / 255, 1.7) * 255);
await sharp(data, { raw: { width: info.width, height: info.height, channels: 1 } }).webp({ quality: 82 }).toFile(out);
console.log(out, info.width, 'px', (statSync(out).size / 1024) | 0, 'KB');
