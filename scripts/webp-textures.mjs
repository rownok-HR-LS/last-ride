// Re-encodes the Poly Haven JPG maps in public/tex as WebP (about half the size at the same 1k resolution) and
// removes the JPGs. Run it after scripts/fetch-textures.mjs. Normal maps keep more quality: blocky normals show.
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const DIR = 'public/tex';
let before = 0;
let after = 0;
for (const name of readdirSync(DIR)) {
  const dir = path.join(DIR, name);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jpg')) continue;
    const src = path.join(dir, f);
    const out = src.replace(/\.jpg$/, '.webp');
    await sharp(src).webp({ quality: f.startsWith('nor') ? 90 : 80, effort: 6 }).toFile(out);
    before += statSync(src).size;
    after += statSync(out).size;
    unlinkSync(src);
  }
}
console.log(`textures: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
