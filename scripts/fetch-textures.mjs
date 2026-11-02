// Downloads the CC0 Poly Haven textures and night sky used by the park (1k JPG maps, 2k HDR sky). Then run
// scripts/webp-textures.mjs: the game loads the maps as WebP.
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const TEXTURES = [
  'rusty_metal_02', 'rust_coarse_01', 'concrete_floor_worn_001', 'cracked_concrete_wall', 'forrest_ground_01',
  'cobblestone_floor_08', 'weathered_planks', 'old_planks_02', 'painted_metal_shutter', 'red_brick_03',
  'corrugated_iron_02', 'damaged_plaster', 'forest_leaves_02', 'withered_grass', 'mud_forest',
];
const MAPS = { Diffuse: 'diff', nor_gl: 'nor', arm: 'arm' };
const HDRI = 'kloppenheim_02';

async function get(url, dest) {
  if (existsSync(dest)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  if (!url.startsWith('https://dl.polyhaven.org/')) throw new Error(`unexpected host ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log('saved', dest);
}

for (const a of TEXTURES) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${a}`)).json();
  await mkdir(`public/tex/${a}`, { recursive: true });
  for (const [key, short] of Object.entries(MAPS)) await get(files[key]['1k'].jpg.url, `public/tex/${a}/${short}.jpg`);
}
const sky = await (await fetch(`https://api.polyhaven.com/files/${HDRI}`)).json();
await get(sky.hdri["2k"].hdr.url, `assets-src/hdri/${HDRI}_2k.hdr`); // then: node scripts/sky.mjs
await writeFile('public/tex/CREDITS.txt', `Textures and HDRI from Poly Haven (https://polyhaven.com), CC0.\n${[...TEXTURES, HDRI].join('\n')}\n`);
