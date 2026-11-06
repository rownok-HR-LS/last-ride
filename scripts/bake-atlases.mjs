// Bake every multi-material scenery model into one atlas with Blender (scripts/blender/atlas-bake.py), then
// rebuild the game's copies with scripts/convert-env.mjs (which picks up assets-src/blender/baked/<name>.glb).
// Usage: node scripts/bake-atlases.mjs [name ...]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ENV, FAR } from './convert-env-table.mjs';

const BLENDER = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
/**
 * name -> atlas size (big buildings 2048, the rest 1024; convert-env then sizes them for the game), or [size, ao]
 * where ao is how much baked occlusion goes into the colour (default 0.65). Not for models whose textures repeat
 * across big surfaces (the warehouse's bricks): one atlas can't hold that detail.
 */
export const ATLAS = {
  shed_worn: 1024, crates_barrels: 1024, trash_bags: 1024, coaster_car: 1024, bench: 1024, boxes: 1024,
  roof_kit: 1024, shack_open: 1024, popcorn_cart: 1024, tent_small: 1024, rocket_kiddie: 1024, kiosk: 1024,
  vending_news: 1024, ice_freezer: 1024, clown_statue: 1024, victorian: 2048,
  // built from overlapping toy-brick parts: occlusion sees the overlaps as closed and paints them black
  dodgem: [512, 0],
};

mkdirSync('assets-src/blender/baked', { recursive: true });
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ATLAS);
const built = [];
for (const name of names) {
  let src = path.join('assets-src', ENV[name][0]);
  if (!src.endsWith('.glb') && !src.endsWith('.gltf')) src = path.join(src, readdirSync(src).find((f) => /\.gl(b|tf)$/.test(f)));
  if (!existsSync(src)) {
    console.log(name, 'no source');
    continue;
  }
  const out = path.join('assets-src', 'blender', 'baked', name + '.glb');
  const log = execFileSync(BLENDER, ['--background', '--factory-startup', '--python', 'scripts/blender/atlas-bake.py', '--', src, out, ...[ATLAS[name]].flat().map(String)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  console.log(name.padEnd(16), log.split('\n').filter((l) => l.startsWith('ATLAS')).join(' | '));
  // and its far version: Blender's Decimate down to (a little over) the far budget
  if (FAR[name]) {
    const far = path.join('assets-src', 'blender', 'baked', `${name}_far.glb`);
    const tris = Math.round(ENV[`${name}_far`][1] * 1.3);
    const l2 = execFileSync(BLENDER, ['--background', '--factory-startup', '--python', 'scripts/blender/lod.py', '--', out, far, String(tris)], { encoding: 'utf8', maxBuffer: 1 << 26 });
    console.log(`${name}_far`.padEnd(16), l2.split('\n').filter((l) => l.startsWith('LOD')).join(' | '));
    built.push(`${name}_far`);
  }
}
execFileSync('node', ['scripts/convert-env.mjs', ...names, ...built], { stdio: 'inherit' });
