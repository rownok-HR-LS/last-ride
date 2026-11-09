// The horizon strip rendered in Blender (scripts/blender/render-horizon.py) into the game: WebP with alpha.
// Usage: node scripts/pack-horizon.mjs <horizon.png>  ->  public/tex/horizon.webp
import sharp from 'sharp';
import { statSync } from 'node:fs';

const out = 'public/tex/horizon.webp';
await sharp(process.argv[2]).webp({ quality: 88, alphaQuality: 80 }).toFile(out);
console.log(out, (statSync(out).size / 1024) | 0, 'KB');
