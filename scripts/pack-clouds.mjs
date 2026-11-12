// Pack Blender's two cloud renders (scripts/blender/render-clouds.py) into the game's cloud texture:
//   red    the clouds lit by the moon (their brightness, as rendered: display-encoded)
//   green  how much sky they hide
//   blue   the clouds lit from inside by lightning (already scaled by how much cloud there is)
// Usage: node scripts/pack-clouds.mjs <render folder>  ->  public/tex/clouds.webp
import { statSync } from 'node:fs';
import sharp from 'sharp';

const dir = process.argv[2];
const read = async (f) => sharp(`${dir}/${f}`).ensureAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
const moon = await read('clouds_moon.png');
const flash = await read('clouds_flash.png');
const { width, height } = moon.info;
const out = Buffer.alloc(width * height * 3);
let cover = 0;
for (let i = 0, j = 0; i < moon.data.length; i += 4, j += 3) {
  const lum = 0.3 * moon.data[i] + 0.59 * moon.data[i + 1] + 0.11 * moon.data[i + 2];
  const fl = (0.3 * flash.data[i] + 0.59 * flash.data[i + 1] + 0.11 * flash.data[i + 2]) * (flash.data[i + 3] / 255);
  out[j] = Math.round(lum);
  out[j + 1] = moon.data[i + 3];
  out[j + 2] = Math.round(Math.min(255, fl));
  cover += moon.data[i + 3] / 255;
}
await sharp(out, { raw: { width, height, channels: 3 } }).webp({ quality: 90 }).toFile('public/tex/clouds.webp');
console.log(`clouds.webp ${width}px, ${(statSync('public/tex/clouds.webp').size / 1024) | 0} KB, cover ${((cover / (width * height)) * 100).toFixed(0)}%`);
