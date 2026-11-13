// Paints the textures for the lived-in dressing that scripts/blender/lived-in.py builds: the torn circus posters
// round the poster columns, and the ride tickets littering the paths.
// Usage: node scripts/lived-in-textures.mjs   ->  assets-src/blender/tex/{posters_torn,tickets}.png
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const OUT = 'assets-src/blender/tex';
mkdirSync(OUT, { recursive: true });

let seed = 4242;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** A ragged edge: a polygon outline of a rectangle whose sides are torn (jitter j px). */
function torn(x, y, w, h, j = 14) {
  const pts = [];
  const side = (x0, y0, x1, y1, n) => {
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push([x0 + (x1 - x0) * t + (rand() - 0.5) * j, y0 + (y1 - y0) * t + (rand() - 0.5) * j]);
    }
  };
  side(x, y, x + w, y, 18);
  side(x + w, y, x + w, y + h, 12);
  side(x + w, y + h, x, y + h, 18);
  side(x, y + h, x, y, 12);
  return pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
}

/** Water stains and grime over the whole sheet. */
function grime(w, h, n) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const cx = rand() * w;
    const cy = rand() * h;
    s += `<ellipse cx="${cx}" cy="${cy}" rx="${20 + rand() * 90}" ry="${30 + rand() * 140}" fill="rgba(60,45,25,${0.08 + rand() * 0.14})"/>`;
  }
  // rain streaks running down
  for (let i = 0; i < n * 3; i++) {
    const x = rand() * w;
    s += `<rect x="${x}" y="${rand() * h * 0.5}" width="${1 + rand() * 3}" height="${60 + rand() * 260}" fill="rgba(40,30,20,${0.05 + rand() * 0.1})"/>`;
  }
  return s;
}

// ---- the poster column wrap: 1024 x 512, round the column left to right (it tiles across the seam)
{
  const W = 1024;
  const H = 512;
  const posters = [
    ['THE AMAZING', 'ZELDA', 'FIRE · KNIVES · FATE', '#c8392b', '#f2e2b8'],
    ['WONDERLAND', 'PARK', 'OPEN TILL MIDNIGHT', '#2b4f8c', '#f6d76a'],
    ['RIDE THE', 'CYCLONE', 'IF YOU DARE', '#1d1d1d', '#e8b33a'],
    ['BOZO\'S', 'BIG TOP', 'TWICE NIGHTLY', '#8e2f6a', '#f4e6c8'],
    ['MIRROR', 'MAZE', 'FIND YOURSELF', '#2f7a5c', '#f1e9d0'],
    ['GHOST', 'TRAIN', 'NOBODY COMES BACK', '#3a2b4a', '#d9c7f0'],
  ];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  // the column's own paint under it all, where the posters have gone
  svg += `<rect width="${W}" height="${H}" fill="#5a6b58"/>`;
  svg += grime(W, H, 18);
  // old layers first (faded, mostly torn away), then the newer ones over them
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < 6; i++) {
      const [a, b, c, bg, fg] = posters[(i + layer * 3) % posters.length];
      const w = 230 + rand() * 60;
      const h = 300 + rand() * 120;
      const x = (i / 6) * W + (rand() - 0.5) * 40 + layer * 80;
      const y = 40 + rand() * 80 - layer * 20;
      const fade = layer === 0 ? 0.55 : 0.85;
      const id = `p${layer}${i}`;
      svg += `<clipPath id="${id}"><polygon points="${torn(x, y, w, h * (layer === 0 ? 0.7 + rand() * 0.3 : 0.55 + rand() * 0.45), 22)}"/></clipPath>`;
      svg += `<g clip-path="url(#${id})" opacity="${fade}">`;
      svg += `<rect x="${x - 20}" y="${y - 20}" width="${w + 40}" height="${h + 40}" fill="${bg}"/>`;
      svg += `<rect x="${x + 10}" y="${y + 10}" width="${w - 20}" height="${h - 20}" fill="none" stroke="${fg}" stroke-width="5"/>`;
      svg += `<text x="${x + w / 2}" y="${y + 70}" font-family="Georgia, serif" font-size="30" fill="${fg}" text-anchor="middle" font-weight="bold">${a}</text>`;
      svg += `<text x="${x + w / 2}" y="${y + 150}" font-family="Georgia, serif" font-size="64" fill="${fg}" text-anchor="middle" font-weight="bold">${b}</text>`;
      svg += `<text x="${x + w / 2}" y="${y + 200}" font-family="Georgia, serif" font-size="19" fill="${fg}" text-anchor="middle">${c}</text>`;
      // a star burst and a date stamp
      svg += `<circle cx="${x + w * 0.5}" cy="${y + 265}" r="34" fill="${fg}" opacity="0.85"/>`;
      svg += `<text x="${x + w * 0.5}" y="${y + 272}" font-family="Georgia, serif" font-size="18" fill="${bg}" text-anchor="middle" font-weight="bold">1987</text>`;
      svg += `</g>`;
    }
  }
  // the paper's own grime over the top, and peeled corners showing the paint
  svg += grime(W, H, 10);
  for (let i = 0; i < 9; i++) {
    svg += `<polygon points="${torn(rand() * W, rand() * H, 40 + rand() * 80, 30 + rand() * 90, 26)}" fill="#55654f" opacity="0.9"/>`;
  }
  svg += `</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`${OUT}/posters_torn.png`);
}

// ---- tickets: 512 x 256, a 4 x 4 grid of 128 x 64 ride tickets (four colours, some stamped, some dirty)
{
  const W = 512;
  const H = 256;
  const cols = [['#c8392b', '#f4e2c0'], ['#e8a33a', '#3a2412'], ['#3d7cc4', '#f2ecd8'], ['#5ea35a', '#1e2a14']];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const [bg, fg] = cols[(r + c) % 4];
      const x = c * 128;
      const y = r * 64;
      svg += `<rect x="${x}" y="${y}" width="128" height="64" fill="${bg}"/>`;
      svg += `<rect x="${x + 5}" y="${y + 5}" width="118" height="54" fill="none" stroke="${fg}" stroke-width="2" stroke-dasharray="4 3"/>`;
      svg += `<text x="${x + 64}" y="${y + 29}" font-family="Arial Black, Arial, sans-serif" font-size="17" fill="${fg}" text-anchor="middle" font-weight="bold">ADMIT ONE</text>`;
      svg += `<text x="${x + 64}" y="${y + 48}" font-family="Courier New, monospace" font-size="11" fill="${fg}" text-anchor="middle">No ${String(10000 + Math.floor(rand() * 89999))}</text>`;
      // mud and a boot print on some
      if (rand() < 0.5) svg += `<ellipse cx="${x + 30 + rand() * 70}" cy="${y + 20 + rand() * 30}" rx="${14 + rand() * 20}" ry="${8 + rand() * 12}" fill="rgba(55,40,25,0.55)"/>`;
      if (rand() < 0.35) svg += `<rect x="${x}" y="${y}" width="128" height="64" fill="rgba(30,20,10,0.35)"/>`;
    }
  }
  svg += `</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`${OUT}/tickets.png`);
}
console.log('lived-in textures written');
