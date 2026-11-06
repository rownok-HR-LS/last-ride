// Paints the textures for the story props that scripts/blender/story-props.py builds: the "MISSING" posters for
// the twenty visitors of 1987, their photos on the memorial at the gate, and the county's CLOSED barricades.
// Usage: node scripts/story-textures.mjs   ->  assets-src/blender/tex/{posters,memorial,barricade}.png
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const OUT = 'assets-src/blender/tex';
mkdirSync(OUT, { recursive: true });

/** The twenty who went in on the last night in 1987 (all made up). */
export const TWENTY = [
  ['Danny Kowalski', 16], ['Lisa Marchetti', 17], ['Tommy Reyes', 15], ['Karen Whitlock', 19],
  ['Mikey Dunn', 14], ['Sarah Lindqvist', 18], ['Jason Pryor', 17], ['Amy Castellano', 16],
  ['Robert Haines', 34], ['Debbie Novak', 21], ['Chris Albright', 17], ['Jenny Tran', 15],
  ['Steve Mahoney', 22], ['Michelle Ortiz', 16], ['Kevin Brandt', 18], ['Tina Faulkner', 17],
  ['Brian Szabo', 20], ['Laura Pembrook', 16], ['Eddie Vance', 19], ['Nicole Hart', 15],
];

let seed = 1987;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Water stains and grime over a w x h area at (x, y). */
function stains(x, y, w, h, n, tone = '90,70,40') {
  let s = '';
  for (let i = 0; i < n; i++) {
    const cx = x + rand() * w;
    const cy = y + rand() * h;
    const r = 10 + rand() * Math.min(w, h) * 0.35;
    const a = (rand() * 180) | 0;
    s += `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * (0.4 + rand() * 0.5)}" transform="rotate(${a} ${cx} ${cy})" fill="url(#stain)" opacity="${0.15 + rand() * 0.3}"/>`;
  }
  return s;
}

/** A face-less head and shoulders: who they were has worn away. */
function figure(cx, top, s, ink, hairKind) {
  const hy = top + 48 * s;
  let hair = '';
  if (hairKind === 0) hair = `<rect x="${cx - 36 * s}" y="${hy - 40 * s}" width="${72 * s}" height="${95 * s}" rx="${34 * s}" fill="${ink}"/>`;
  else if (hairKind === 1) for (let i = 0; i < 9; i++) hair += `<circle cx="${cx + Math.cos(i * 0.7 - 3.6) * 34 * s}" cy="${hy - 6 * s + Math.sin(i * 0.7 - 3.6) * 34 * s}" r="${15 * s}" fill="${ink}"/>`;
  else hair = `<ellipse cx="${cx}" cy="${hy - 14 * s}" rx="${36 * s}" ry="${30 * s}" fill="${ink}"/>`;
  return `${hair}
    <path d="M${cx - 80 * s} ${top + 170 * s} Q${cx - 74 * s} ${hy + 50 * s} ${cx} ${hy + 46 * s} Q${cx + 74 * s} ${hy + 50 * s} ${cx + 80 * s} ${top + 170 * s} Z" fill="${ink}"/>
    <rect x="${cx - 13 * s}" y="${hy + 20 * s}" width="${26 * s}" height="${34 * s}" fill="${ink}"/>
    <ellipse cx="${cx}" cy="${hy}" rx="${29 * s}" ry="${37 * s}" fill="${ink}"/>`;
}

const DEFS = `<defs>
  <radialGradient id="stain"><stop offset="0" stop-color="rgb(120,95,55)" stop-opacity="0.3"/><stop offset="0.6" stop-color="rgb(110,85,45)" stop-opacity="0.2"/><stop offset="1" stop-color="rgb(90,65,30)" stop-opacity="0"/></radialGradient>
  <radialGradient id="vig"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>
  <filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.4  0 0 0 0 0.3  0 0 0 0.22 0"/></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="3"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.35 0"/></filter>
  <filter id="blur"><feGaussianBlur stdDeviation="2.2"/></filter>
</defs>`;

// --- posters: 3 x 2 on one sheet, each 340 x 512 ---------------------------------------------------------------
function poster(px, py, [name, age], i) {
  const W = 340;
  const H = 512;
  const cx = px + W / 2;
  const paper = ['#e9e1c9', '#e4dcc0', '#ece6d2', '#dfd6bb'][i % 4];
  let tabs = '';
  for (let k = 0; k < 8; k++) {
    const tx = px + 10 + k * 40;
    tabs += `<line x1="${tx}" y1="${py + 446}" x2="${tx}" y2="${py + H}" stroke="#8a826c" stroke-width="1" stroke-dasharray="3 3"/>
      <text x="${tx + 26}" y="${py + 506}" transform="rotate(-90 ${tx + 26} ${py + 506})" font-family="Arial" font-size="11" fill="#222">(555) 0187</text>`;
  }
  return `<g>
    <rect x="${px}" y="${py}" width="${W}" height="${H}" fill="${paper}"/>
    <rect x="${px}" y="${py}" width="${W}" height="${H}" filter="url(#paper)"/>
    <text x="${cx}" y="${py + 72}" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="74" fill="#a5181c" letter-spacing="2">MISSING</text>
    <rect x="${cx - 100}" y="${py + 90}" width="200" height="180" fill="#9c9a94"/>
    <g filter="url(#blur)">${figure(cx, py + 104, 0.92, '#3c3b39', i % 3)}</g>
    <rect x="${cx - 100}" y="${py + 90}" width="200" height="180" filter="url(#grain)"/>
    <rect x="${cx - 100}" y="${py + 90}" width="200" height="180" fill="none" stroke="#222" stroke-width="2"/>
    <text x="${cx}" y="${py + 306}" text-anchor="middle" font-family="Arial Black, Arial" font-weight="bold" font-size="28" fill="#1a1a1a">${esc(name.toUpperCase())}</text>
    <text x="${cx}" y="${py + 334}" text-anchor="middle" font-family="Arial" font-size="20" fill="#222">Age ${age}</text>
    <text x="${cx}" y="${py + 366}" text-anchor="middle" font-family="Arial" font-size="17" fill="#222">Last seen at Wonderland Park</text>
    <text x="${cx}" y="${py + 390}" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="19" fill="#222">October 31, 1987</text>
    <text x="${cx}" y="${py + 420}" text-anchor="middle" font-family="Arial" font-size="15" fill="#333">Please call if you have seen them</text>
    ${tabs}
    ${stains(px, py, W, H, 5)}
  </g>`;
}
{
  let body = '';
  for (let i = 0; i < 6; i++) body += poster((i % 3) * 341, Math.floor(i / 3) * 512, TWENTY[[0, 1, 4, 7, 11, 19][i]], i);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${DEFS}<rect width="1024" height="1024" fill="#d8cfb4"/>${body}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`${OUT}/posters.png`);
}

// --- memorial: twenty polaroids (5 x 4, each 204 x 192) and two cards along the bottom ------------------------
function polaroid(px, py, [name], i) {
  const W = 204;
  const H = 192;
  const cx = px + W / 2;
  const skies = [['#c9a46b', '#7d6040'], ['#9fb3b8', '#5b6a5c'], ['#d2a27c', '#6e4a36'], ['#b8b08a', '#5d5a3c']];
  const [sky, gnd] = skies[i % 4];
  const ink = ['#3a2c22', '#2b2622', '#4a3326', '#30302c'][i % 4];
  return `<g>
    <rect x="${px + 4}" y="${py + 4}" width="${W - 8}" height="${H - 8}" fill="#eee8dc"/>
    <clipPath id="ph${i}"><rect x="${px + 16}" y="${py + 14}" width="${W - 32}" height="130"/></clipPath>
    <g clip-path="url(#ph${i})">
      <rect x="${px + 16}" y="${py + 14}" width="${W - 32}" height="130" fill="${sky}"/>
      <rect x="${px + 16}" y="${py + 100}" width="${W - 32}" height="44" fill="${gnd}"/>
      <g filter="url(#blur)">${figure(cx + (rand() - 0.5) * 30, py + 30, 0.62, ink, i % 3)}</g>
      <rect x="${px + 16}" y="${py + 14}" width="${W - 32}" height="130" filter="url(#grain)"/>
      <rect x="${px + 16}" y="${py + 14}" width="${W - 32}" height="130" fill="url(#vig)"/>
      <rect x="${px + 16}" y="${py + 14}" width="${W - 32}" height="130" fill="#e8c890" opacity="0.18"/>
    </g>
    <text x="${cx}" y="${py + 172}" text-anchor="middle" font-family="Segoe Print, Segoe Script, cursive" font-size="17" fill="#26314f">${esc(name.split(' ')[0])}</text>
    ${stains(px + 4, py + 4, W - 8, H - 8, 2)}
  </g>`;
}
{
  let body = '';
  for (let i = 0; i < 20; i++) body += polaroid((i % 5) * 204.8, Math.floor(i / 5) * 192, TWENTY[i], i);
  // the big card: 640 x 256
  body += `<rect x="4" y="772" width="632" height="248" fill="#efe9dc"/>
    <rect x="4" y="772" width="632" height="248" filter="url(#paper)"/>
    <text x="320" y="862" text-anchor="middle" font-family="Segoe Print, Segoe Script, cursive" font-size="64" fill="#2a2a3a">The Twenty</text>
    <text x="320" y="922" text-anchor="middle" font-family="Segoe Print, Segoe Script, cursive" font-size="32" fill="#2a2a3a">October 31, 1987</text>
    <text x="320" y="984" text-anchor="middle" font-family="Segoe Print, Segoe Script, cursive" font-size="30" fill="#7a1a1a">we will never stop looking</text>
    ${stains(4, 772, 632, 248, 6)}`;
  // the small card: a child's crayon note, 384 x 256
  body += `<rect x="644" y="776" width="376" height="244" fill="#f4f1e6"/>
    <line x1="644" y1="830" x2="1020" y2="830" stroke="#9db4d6" stroke-width="2"/>
    <line x1="644" y1="890" x2="1020" y2="890" stroke="#9db4d6" stroke-width="2"/>
    <line x1="644" y1="950" x2="1020" y2="950" stroke="#9db4d6" stroke-width="2"/>
    <text x="832" y="880" text-anchor="middle" font-family="Segoe Print, Comic Sans MS, cursive" font-size="44" fill="#c0282d">COME HOME</text>
    <text x="832" y="940" text-anchor="middle" font-family="Segoe Print, Comic Sans MS, cursive" font-size="34" fill="#2a50a0">MIKEY</text>
    <path d="M700 990 q30 -30 60 0 t60 0 t60 0 t60 0" stroke="#e0a020" stroke-width="5" fill="none"/>
    ${stains(644, 776, 376, 244, 4)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${DEFS}<rect width="1024" height="1024" fill="#3a2e24"/>${body}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`${OUT}/memorial.png`);
}

// --- barricade: stripes along the top (512 x 128), the CLOSED sign below (512 x 256) --------------------------
{
  let stripes = '';
  for (let k = -2; k < 14; k++) stripes += `<polygon points="${k * 48},128 ${k * 48 + 24},128 ${k * 48 + 24 + 128},0 ${k * 48 + 128},0" fill="#b3221e"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${DEFS}
    <rect width="512" height="128" fill="#e6dfcf"/>${stripes}
    <rect width="512" height="128" filter="url(#paper)"/>
    <rect y="128" width="512" height="256" fill="#e9e3d2"/>
    <rect x="10" y="138" width="492" height="236" fill="none" stroke="#b3221e" stroke-width="10"/>
    <text x="256" y="250" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="108" fill="#b3221e" letter-spacing="6">CLOSED</text>
    <text x="256" y="300" text-anchor="middle" font-family="Arial Black, Arial" font-weight="bold" font-size="26" fill="#1c1c1c">BY ORDER OF THE COUNTY</text>
    <text x="256" y="340" text-anchor="middle" font-family="Arial" font-size="22" fill="#1c1c1c">NOV 1987 · NO ENTRY · NO SEARCHING</text>
    <rect y="128" width="512" height="256" filter="url(#paper)"/>
    ${stains(0, 128, 512, 256, 7)}${stains(0, 0, 512, 128, 4)}
    <rect y="384" width="512" height="128" fill="#6b5a44"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`${OUT}/barricade.png`);
}
console.log('story textures ->', OUT);
