// Paints the artwork for the rides' dressing that scripts/blender/rides-dress.py builds: the coaster station's
// "you must be this tall" clown and its rules, the bumper cars' steel floor with painted one-way arrows and their
// signs, the Free Fall's warnings, and the yellow-and-black hazard stripes. Faded and chipped like the rest.
// Usage: node scripts/rides-textures.mjs  ->  assets-src/blender/tex/rides_*.png
import { DEFS, age, saver } from './paintkit.mjs';

let seed = 77;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const R = (a, b) => a + rand() * (b - a);
const save = saver('rides_');

/** The signs, on one 2048 x 1024 sheet: the height clown (512 x 1024), then six 512 x 512 boards in two columns. */
async function signs() {
  const W = 2048;
  const H = 1024;
  let s = DEFS(1);
  // 1: the height clown, arm out at the line (the line is 1.2 m up a 2.4 m board: halfway)
  s += `<rect x="0" y="0" width="512" height="1024" fill="#f2b632"/>`;
  for (let i = 0; i < 12; i++) s += `<rect x="0" y="${i * 86}" width="512" height="43" fill="#e8a020" opacity="0.6"/>`;
  s += `<circle cx="210" cy="250" r="95" fill="#f3d9b8" stroke="#3a1a0a" stroke-width="8"/>`;
  s += `<path d="M120 200 Q210 60 300 200 Q260 150 210 160 Q160 150 120 200 Z" fill="#d8202c"/>`;
  s += `<circle cx="180" cy="240" r="12" fill="#1a0a14"/><circle cx="240" cy="240" r="12" fill="#1a0a14"/><circle cx="210" cy="275" r="20" fill="#d8202c"/>`;
  s += `<path d="M160 305 Q210 345 260 305" stroke="#1a0a14" stroke-width="9" fill="none"/>`;
  s += `<path d="M140 350 L280 350 L300 820 L120 820 Z" fill="#2a7ab0" stroke="#3a1a0a" stroke-width="8"/>`;
  for (let k = 0; k < 5; k++) s += `<circle cx="210" cy="${400 + k * 80}" r="16" fill="#f4ecd8"/>`;
  s += `<path d="M280 420 L470 512" stroke="#2a7ab0" stroke-width="44" stroke-linecap="round"/><circle cx="478" cy="512" r="28" fill="#f4ecd8"/>`;
  s += `<rect x="0" y="508" width="512" height="10" fill="#d8202c"/>`;
  s += `<path d="M150 820 L130 960 L60 990 L170 990 L190 820 Z M230 820 L250 990 L360 990 L290 960 L270 820 Z" fill="#1a0a14"/>`;
  s += `<text x="256" y="64" text-anchor="middle" font-family="Impact, Arial Black" font-size="50" fill="#d8202c">YOU MUST BE</text>`;
  s += `<text x="256" y="122" text-anchor="middle" font-family="Impact, Arial Black" font-size="50" fill="#d8202c">THIS TALL</text>`;
  s += `<text x="380" y="580" text-anchor="middle" font-family="Arial Black" font-size="34" fill="#1a0a14">TO RIDE</text>`;
  // the boards: [x, y, background, lines, colour]
  const boards = [
    [512, 0, '#f4ecd8', ['KEEP HANDS,', 'ARMS &amp; HEAD', 'INSIDE THE CAR'], '#c42a3a'],
    [512, 512, '#2a8a3a', ['EXIT', '→'], '#f4ecd8'],
    [1024, 0, '#c42a3a', ['NO HEAD-ON', 'BUMPING!'], '#f4ecd8'],
    [1024, 512, '#12062a', ['PAY HERE', '2 TICKETS', 'PER RIDE'], '#ffe14a'],
    [1536, 0, '#f2b632', ['RIDERS MUST', 'BE 48 INCHES', 'TO RIDE'], '#1a0a14'],
    [1536, 512, '#1a1a1a', ['DANGER', 'HIGH VOLTAGE'], '#ffd020'],
  ];
  for (const [x, y, bg, lines, fg] of boards) {
    s += `<rect x="${x}" y="${y}" width="512" height="512" fill="${bg}"/><rect x="${x + 16}" y="${y + 16}" width="480" height="480" fill="none" stroke="${fg}" stroke-width="10"/>`;
    const big = lines.length < 3 ? (Math.max(...lines.map((l) => l.length)) > 8 ? 70 : 110) : 66;
    const top = y + 256 - ((lines.length - 1) * big * 1.1) / 2 + big * 0.35;
    lines.forEach((l, i) => { s += `<text x="${x + 256}" y="${top + i * big * 1.1}" text-anchor="middle" font-family="Impact, Arial Black" font-size="${big}" fill="${fg}">${l}</text>`; });
  }
  // a lightning bolt on the high-voltage board
  s += `<path transform="translate(1600 540) scale(0.45)" d="M200 20 L140 160 L190 160 L150 280 L260 120 L205 120 L250 20 Z" fill="#ffd020"/>`;
  s += age(W, H, 1);
  await save('signs', W, H, s);
}

/** The bumper-car floor: worn steel plates, seams, rust, painted one-way arrows round the track (2048 x 1024 = 26 x 18). */
async function arenaFloor() {
  const W = 2048;
  const H = 1024;
  let s = DEFS(2);
  s += `<rect width="${W}" height="${H}" fill="#4a5058"/>`;
  // tread plate: little raised dashes in a herringbone
  for (let y = 0; y < H; y += 18) {
    for (let x = (y / 18) % 2 ? 9 : 0; x < W; x += 18) s += `<rect x="${x}" y="${y}" width="10" height="3" fill="#5c626a" transform="rotate(${(x + y) % 36 ? 45 : -45} ${x + 5} ${y + 1})"/>`;
  }
  // plate seams every 2 m (157 px across 26 m)
  for (let x = 0; x < W; x += W / 13) s += `<rect x="${x}" y="0" width="4" height="${H}" fill="#2a2e34"/>`;
  for (let y = 0; y < H; y += H / 9) s += `<rect x="0" y="${y}" width="${W}" height="4" fill="#2a2e34"/>`;
  // rust and scuffs
  for (let i = 0; i < 60; i++) s += `<ellipse cx="${R(0, W)}" cy="${R(0, H)}" rx="${R(20, 120)}" ry="${R(10, 60)}" fill="${rand() < 0.5 ? '#7a4a2a' : '#2a2a2a'}" opacity="${R(0.15, 0.45)}"/>`;
  // a painted lane round the floor, and yellow arrows going anticlockwise
  s += `<rect x="260" y="200" width="${W - 520}" height="${H - 400}" rx="180" fill="none" stroke="#e8e0cc" stroke-width="10" stroke-dasharray="60 40" opacity="0.6"/>`;
  const arrow = (x, y, a) => `<g transform="translate(${x} ${y}) rotate(${a})"><path d="M-70 -22 L30 -22 L30 -50 L90 0 L30 50 L30 22 L-70 22 Z" fill="#f2c41a" opacity="0.85"/></g>`;
  for (const [x, y, a] of [[700, 110, 180], [1350, 110, 180], [1940, 512, 270], [1350, 914, 0], [700, 914, 0], [108, 512, 90]]) s += arrow(x, y, a);
  s += `<text x="${W / 2}" y="${H / 2 + 40}" text-anchor="middle" font-family="Impact, Arial Black" font-size="120" fill="#f2c41a" opacity="0.7" letter-spacing="10">THIS WAY ONLY</text>`;
  s += age(W, H, 2);
  await save('arena_floor', W, H, s);
}

/** Yellow and black hazard stripes, worn (a tile). */
async function hazard() {
  const S = 512;
  let s = DEFS(3);
  s += `<rect width="${S}" height="${S}" fill="#1a1a1a"/>`;
  for (let i = -8; i < 8; i++) s += `<path d="M${i * 128} ${S} L${i * 128 + 64} ${S} L${i * 128 + 64 + S} 0 L${i * 128 + S} 0 Z" fill="#f2c41a"/>`;
  s += age(S, S, 3);
  await save('hazard', S, S, s);
}

/** The Free Fall's control desk: a panel of buttons, dials and a key switch (512 x 256). */
async function panel() {
  const W = 512;
  const H = 256;
  let s = DEFS(4);
  s += `<rect width="${W}" height="${H}" fill="#5a6066"/><rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="none" stroke="#2a2e34" stroke-width="6"/>`;
  for (const [x, c, l] of [[90, '#2ad04a', 'UP'], [190, '#e8202c', 'DROP'], [290, '#f2c41a', 'HOLD']]) {
    s += `<circle cx="${x}" cy="120" r="38" fill="#2a2e34"/><circle cx="${x}" cy="120" r="30" fill="${c}"/><text x="${x}" y="200" text-anchor="middle" font-family="Arial Black" font-size="26" fill="#f4ecd8">${l}</text>`;
  }
  s += `<circle cx="410" cy="110" r="52" fill="#f4ecd8" stroke="#2a2e34" stroke-width="8"/><path d="M410 110 L450 80" stroke="#e8202c" stroke-width="6"/>`;
  s += `<text x="410" y="200" text-anchor="middle" font-family="Arial Black" font-size="22" fill="#f4ecd8">HEIGHT</text>`;
  s += age(W, H, 4, false);
  await save('panel', W, H, s);
}

await signs();
await arenaFloor();
await hazard();
await panel();
