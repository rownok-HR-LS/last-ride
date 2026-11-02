// Downloads CC0 Poly Haven models (1k glTF) into assets-src/polyhaven (git-ignored).
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const POLYHAVEN = [
  'fern_02', 'shrub_02', 'shrub_03', 'shrub_04', 'dry_branches_medium_01', 'tree_stump_01', 'tree_stump_02',
  'rock_moss_set_01', 'rock_moss_set_02', 'dead_tree_trunk', 'dead_tree_trunk_02', 'root_cluster_01',
];

async function get(url, dest) {
  if (existsSync(dest)) return;
  if (!url.startsWith('https://dl.polyhaven.org/')) throw new Error(`unexpected host ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

for (const name of process.argv.slice(2).length ? process.argv.slice(2) : POLYHAVEN) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${name}`)).json();
  const g = files.gltf['1k'].gltf;
  const dir = `assets-src/polyhaven/${name}`;
  await get(g.url, `${dir}/${path.basename(new URL(g.url).pathname)}`);
  for (const [rel, f] of Object.entries(g.include || {})) await get(f.url, `${dir}/${rel}`);
  console.log('got', name);
}
