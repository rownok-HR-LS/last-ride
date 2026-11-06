// Turn the lamp-light bake (scripts/blender/bake-lamplight.py) into the game's textures: a light blur to settle the
// path-tracing grain, WebP, and the scale the game needs to read them back.
// Usage: node scripts/pack-lamplight.mjs <bake folder>  ->  public/tex/{ground_light.webp, light_volume.webp, lamplight.json}
import sharp from 'sharp';
import { copyFileSync, statSync } from 'node:fs';

const dir = process.argv[2];
// the ground: 12 cm a pixel, so a pool of lamp light keeps its edge and the shadows across it
await sharp(`${dir}/ground_light.png`).removeAlpha().blur(1.4).webp({ quality: 88 }).toFile('public/tex/ground_light.webp');
// the light grid: 1 m a texel; blur within each 240 px tile only would be exact, but at this blur the seams between
// tiles are a texel wide and fall outside the park's edge
await sharp(`${dir}/light_volume.png`).removeAlpha().blur(0.8).webp({ quality: 92 }).toFile('public/tex/light_volume.webp');
copyFileSync(`${dir}/lamplight.json`, 'public/tex/lamplight.json');
for (const f of ['ground_light.webp', 'light_volume.webp']) console.log(f, (statSync(`public/tex/${f}`).size / 1024) | 0, 'KB');
