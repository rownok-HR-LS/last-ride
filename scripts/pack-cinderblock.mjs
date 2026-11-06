// The Blender-made cinder block (scripts/blender/make-cinderblock.py) as one of the game's PBR texture sets.
// Usage: node scripts/pack-cinderblock.mjs <bake folder>  ->  public/tex/cinder_block/{diff,nor,arm}.webp
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const dir = process.argv[2];
mkdirSync('public/tex/cinder_block', { recursive: true });
for (const [name, q] of [['diff', 86], ['nor', 92], ['arm', 88]]) {
  await sharp(`${dir}/${name}.png`).removeAlpha().webp({ quality: q }).toFile(`public/tex/cinder_block/${name}.webp`);
}
console.log('public/tex/cinder_block');
