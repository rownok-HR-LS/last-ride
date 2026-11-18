// Paints the artwork for the themed buildings that scripts/blender/themed.py builds: hand-painted 1980s carnival
// fronts (the Tunnel of Terror's graveyard mural and monster eyes, the Funhouse's sunburst and hypnotic spirals, the
// Arcade's marquee and game posters) and the dressing inside them (scenery flats, cobwebs and bats for the tunnel,
// dizzy wall panels for the funhouse, cosmic carpet and posters for the arcade). Everything is faded, chipped and
// water-stained: the park closed in 1987.
// Usage: node scripts/themed-textures.mjs  ->  assets-src/blender/tex/themed_*.png
import { DEFS, age, svg, saver } from './paintkit.mjs';

let seed = 31;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const R = (a, b) => a + rand() * (b - a);

const save = saver('themed_');

/** A crooked tombstone outline at x (bottom y), w wide, h tall. */
function tomb(x, y, w, h, fill, tilt = 0) {
  return `<g transform="rotate(${tilt} ${x} ${y})"><path d="M${x - w / 2} ${y} L${x - w / 2} ${y - h + w / 2} A${w / 2} ${w / 2} 0 0 1 ${x + w / 2} ${y - h + w / 2} L${x + w / 2} ${y} Z" fill="${fill}"/></g>`;
}
/** A bat silhouette centred at (x, y), s wide. */
function bat(x, y, s, fill) {
  const k = s / 100;
  return `<path transform="translate(${x - 50 * k} ${y - 20 * k}) scale(${k})" d="M50 18 C46 10 42 8 38 12 C30 4 18 2 0 10 C10 14 14 22 12 30 C20 24 28 26 32 34 C38 28 44 28 50 36 C56 28 62 28 68 34 C72 26 80 24 88 30 C86 22 90 14 100 10 C82 2 70 4 62 12 C58 8 54 10 50 18 Z" fill="${fill}"/>`;
}
/** A bare, twisted tree from (x, y) up h. */
function deadTree(x, y, h, fill) {
  let s = `<path d="M${x - h * 0.06} ${y} Q${x - h * 0.02} ${y - h * 0.5} ${x - h * 0.12} ${y - h} L${x - h * 0.08} ${y - h} Q${x + h * 0.04} ${y - h * 0.5} ${x + h * 0.06} ${y} Z" fill="${fill}"/>`;
  for (let i = 0; i < 9; i++) {
    const t = 0.3 + i * 0.075;
    const bx = x - h * 0.04 * t;
    const by = y - h * t;
    const dir = i % 2 ? 1 : -1;
    const len = h * (0.35 - t * 0.2);
    s += `<path d="M${bx} ${by} Q${bx + dir * len * 0.5} ${by - len * 0.5} ${bx + dir * len} ${by - len * 0.3}" stroke="${fill}" stroke-width="${h * 0.018 * (1.2 - t)}" fill="none" stroke-linecap="round"/>`;
  }
  return s;
}
/** Dripping paint letters (text plus drips below it). */
function drippy(text, x, y, size, fill, id) {
  let d = '';
  const n = Math.round(text.length * 1.6);
  for (let i = 0; i < n; i++) {
    const dx = x - text.length * size * 0.29 + rand() * text.length * size * 0.58;
    const len = R(size * 0.15, size * 0.75);
    d += `<path d="M${dx - 4} ${y - 4} L${dx - 3} ${y + len} Q${dx} ${y + len + 9} ${dx + 3} ${y + len} L${dx + 4} ${y - 4} Z" fill="${fill}"/>`;
  }
  return `<g>${d}<text x="${x}" y="${y}" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="${size}" fill="${fill}" letter-spacing="3">${text}</text></g>`;
}

// ------------------------------------------------------------------ Tunnel of Terror: the mural between the doors
async function tunnelMural() {
  const W = 2048;
  const H = 1024;
  let s = DEFS(1);
  s += `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#160a24"/><stop offset="0.7" stop-color="#3a1640"/><stop offset="1" stop-color="#5a1c2a"/></linearGradient>`;
  s += `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  // a huge sick moon with a face in it
  s += `<circle cx="${W * 0.5}" cy="330" r="250" fill="#e8d98a" opacity="0.95"/><circle cx="${W * 0.5}" cy="330" r="250" fill="#b8a050" opacity="0.25" filter="url(#grain1)"/>`;
  s += `<ellipse cx="${W * 0.44}" cy="300" rx="36" ry="48" fill="#3a2a10" opacity="0.6"/><ellipse cx="${W * 0.56}" cy="300" rx="36" ry="48" fill="#3a2a10" opacity="0.6"/>`;
  s += `<path d="M${W * 0.4} 410 Q${W * 0.5} 470 ${W * 0.6} 410" stroke="#3a2a10" stroke-width="14" fill="none" opacity="0.6"/>`;
  // bats against the moon
  for (let i = 0; i < 14; i++) s += bat(R(W * 0.3, W * 0.7), R(120, 560), R(60, 150), '#120614');
  // hills, a haunted house on the right, dead trees on the left
  s += `<path d="M0 760 Q300 640 640 720 T1300 700 T2048 690 L2048 1024 L0 1024 Z" fill="#1c0d18"/>`;
  s += `<path d="M1540 720 L1540 480 L1600 420 L1660 480 L1660 520 L1780 440 L1900 520 L1900 720 Z" fill="#0c050c"/><rect x="1588" y="360" width="24" height="70" fill="#0c050c"/>`;
  for (const [x, y] of [[1570, 560], [1620, 610], [1700, 580], [1820, 600], [1860, 650]]) s += `<rect x="${x}" y="${y}" width="26" height="36" fill="#f2c64a" opacity="0.85"/>`;
  s += deadTree(260, 780, 520, '#0c050c') + deadTree(520, 760, 340, '#0c050c');
  // the graveyard in front
  for (let i = 0; i < 16; i++) s += tomb(R(80, W - 80), R(880, 990), R(70, 130), R(110, 200), i % 3 ? '#4a4252' : '#3a3442', R(-12, 12));
  // skeleton hands reaching out of the ground
  for (const x of [700, 1180, 1420]) {
    s += `<g stroke="#e8e0cc" stroke-width="10" stroke-linecap="round"><path d="M${x} 1010 L${x} 930"/><path d="M${x} 930 L${x - 26} 880"/><path d="M${x} 930 L${x - 8} 868"/><path d="M${x} 930 L${x + 12} 870"/><path d="M${x} 930 L${x + 30} 886"/></g>`;
  }
  // the dare, dripping
  s += drippy('DARE YOU ENTER?', W / 2, 860, 128, '#c8241c', 1);
  // a painted frame, the peeling and the grime of thirty-nine winters
  s += `<rect x="12" y="12" width="${W - 24}" height="${H - 24}" fill="none" stroke="#7a1c1c" stroke-width="22"/>`;
  s += age(W, H, 1);
  await save('tunnel_mural', W, H, s);
}

/** The monster's eye: a yellow iris with a slit pupil, bloodshot white (mapped onto a half sphere). */
async function monsterEye() {
  const S = 512;
  let s = DEFS(2);
  s += `<radialGradient id="iris" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffe14a"/><stop offset="0.7" stop-color="#e08a12"/><stop offset="1" stop-color="#5a2006"/></radialGradient>`;
  s += `<rect width="${S}" height="${S}" fill="#e9dcc4"/>`;
  for (let i = 0; i < 26; i++) {
    const a = R(0, Math.PI * 2);
    const r0 = R(150, 200);
    s += `<path d="M${S / 2 + Math.cos(a) * 250} ${S / 2 + Math.sin(a) * 250} Q${S / 2 + Math.cos(a + 0.2) * 210} ${S / 2 + Math.sin(a + 0.2) * 210} ${S / 2 + Math.cos(a) * r0} ${S / 2 + Math.sin(a) * r0}" stroke="#b01818" stroke-width="${R(2, 5)}" fill="none" opacity="0.8"/>`;
  }
  s += `<circle cx="${S / 2}" cy="${S / 2}" r="150" fill="url(#iris)"/>`;
  s += `<ellipse cx="${S / 2}" cy="${S / 2}" rx="26" ry="120" fill="#120608"/>`;
  s += `<ellipse cx="${S / 2 - 50}" cy="${S / 2 - 60}" rx="30" ry="18" fill="#fff" opacity="0.7"/>`;
  s += age(S, S, 2, false);
  await save('tunnel_eye', S, S, s);
}

/** Two tall warning posters for the ends of the tunnel's front. */
async function tunnelPosters() {
  const W = 1024;
  const H = 1024;
  let s = DEFS(3);
  const poster = (x, title, lines, bg) => {
    let p = `<rect x="${x + 10}" y="10" width="492" height="1004" fill="${bg}"/>`;
    // a grinning skull
    const cx = x + 256;
    p += `<ellipse cx="${cx}" cy="330" rx="150" ry="165" fill="#ece3cf"/><rect x="${cx - 90}" y="420" width="180" height="110" rx="30" fill="#ece3cf"/>`;
    p += `<ellipse cx="${cx - 60}" cy="320" rx="46" ry="54" fill="#140808"/><ellipse cx="${cx + 60}" cy="320" rx="46" ry="54" fill="#140808"/>`;
    p += `<path d="M${cx} 380 L${cx - 22} 430 L${cx + 22} 430 Z" fill="#140808"/>`;
    for (let i = 0; i < 6; i++) p += `<rect x="${cx - 78 + i * 27}" y="470" width="18" height="44" fill="#140808"/>`;
    p += `<text x="${cx}" y="150" text-anchor="middle" font-family="Impact, Arial Black" font-size="96" fill="#f0d24a">${title}</text>`;
    lines.forEach((l, i) => { p += `<text x="${cx}" y="${660 + i * 92}" text-anchor="middle" font-family="Impact, Arial Black" font-size="74" fill="#ece3cf">${l}</text>`; });
    return p;
  };
  s += poster(0, 'WARNING', ['NOT FOR THE', 'WEAK OF', 'HEART'], '#5a0e10');
  s += poster(512, 'NO', ['REFUNDS', 'NO EXITS', 'NO ESCAPE'], '#2a0c34');
  s += age(W, H, 3);
  await save('tunnel_posters', W, H, s);
}

// ------------------------------------------------------------------ Funhouse: the sunburst crown and the spirals
async function funhouseRays() {
  const W = 2048;
  const H = 1024;
  let s = DEFS(4);
  s += `<rect width="${W}" height="${H}" fill="#f2b632"/>`;
  const cx = W / 2;
  const cy = H * 1.02;
  for (let i = 0; i < 28; i++) {
    const a0 = Math.PI + (i / 28) * Math.PI;
    const a1 = Math.PI + ((i + 0.5) / 28) * Math.PI;
    s += `<path d="M${cx} ${cy} L${cx + Math.cos(a0) * 2400} ${cy + Math.sin(a0) * 2400} L${cx + Math.cos(a1) * 2400} ${cy + Math.sin(a1) * 2400} Z" fill="#c94f7c"/>`;
  }
  // stars and polka dots
  const star = (x, y, r, fill) => {
    let p = '';
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = k % 2 ? r * 0.45 : r;
      p += `${k ? 'L' : 'M'}${x + Math.cos(a) * rr} ${y + Math.sin(a) * rr} `;
    }
    return `<path d="${p}Z" fill="${fill}" stroke="#5a1430" stroke-width="5"/>`;
  };
  for (let i = 0; i < 18; i++) s += star(R(80, W - 80), R(60, H - 260), R(26, 60), i % 2 ? '#fff4c8' : '#5ad0e8');
  // the grinning sun in the middle, behind the clown's head
  s += `<circle cx="${cx}" cy="${H - 60}" r="300" fill="#ffd34a" stroke="#5a1430" stroke-width="10"/>`;
  s += `<text x="${cx}" y="${H * 0.36}" text-anchor="middle" font-family="Segoe Print, Comic Sans MS, cursive" font-weight="bold" font-size="88" fill="#5a1430">• LAUGH TILL YOU DROP •</text>`;
  s += age(W, H, 4);
  await save('funhouse_rays', W, H, s);
}

async function spiral() {
  const S = 1024;
  let s = DEFS(5);
  s += `<rect width="${S}" height="${S}" fill="#f4ecd8"/>`;
  // an Archimedean spiral band, two arms
  for (const arm of [0, Math.PI]) {
    let d = '';
    for (let t = 0; t <= 6 * Math.PI; t += 0.05) {
      const r = 8 + t * 26;
      d += `${t ? 'L' : 'M'}${S / 2 + Math.cos(t + arm) * r} ${S / 2 + Math.sin(t + arm) * r} `;
    }
    s += `<path d="${d}" stroke="#c42a3a" stroke-width="44" fill="none" stroke-linecap="round"/>`;
  }
  s += `<circle cx="${S / 2}" cy="${S / 2}" r="500" fill="none" stroke="#2a1640" stroke-width="28"/>`;
  s += age(S, S, 5);
  await save('spiral', S, S, s);
}

/** The Funhouse's front panels: a stretched jester, a mirror-warped lady, and the low "step right up" boards. */
async function funhousePanels() {
  const W = 1024;
  const H = 1024;
  let s = DEFS(6);
  // two tall panels (each 256 x 1024) on the left half, two low boards (512 x 256) stacked on the right
  const tall = (x, bg, fg, label) => {
    let p = `<rect x="${x}" y="0" width="256" height="1024" fill="${bg}"/>`;
    // a figure stretched tall and thin, as in a funhouse mirror
    p += `<ellipse cx="${x + 128}" cy="190" rx="52" ry="110" fill="#f3d9b8"/>`;
    p += `<path d="M${x + 80} 140 L${x + 128} 40 L${x + 176} 140 Z" fill="${fg}"/><circle cx="${x + 128}" cy="36" r="16" fill="#ffd34a"/>`;
    p += `<circle cx="${x + 108}" cy="180" r="10" fill="#1a0a14"/><circle cx="${x + 148}" cy="180" r="10" fill="#1a0a14"/><circle cx="${x + 128}" cy="215" r="14" fill="#d8202c"/>`;
    p += `<path d="M${x + 96} 250 Q${x + 128} 285 ${x + 160} 250" stroke="#1a0a14" stroke-width="7" fill="none"/>`;
    p += `<path d="M${x + 70} 310 L${x + 186} 310 L${x + 170} 760 L${x + 86} 760 Z" fill="${fg}"/>`;
    for (let k = 0; k < 6; k++) p += `<circle cx="${x + 128}" cy="${360 + k * 66}" r="13" fill="#ffd34a"/>`;
    p += `<path d="M${x + 96} 760 L${x + 86} 930 L${x + 60} 960 L${x + 112} 960 L${x + 116} 760 Z M${x + 140} 760 L${x + 144} 960 L${x + 196} 960 L${x + 170} 930 L${x + 160} 760 Z" fill="#2a1640"/>`;
    p += `<text x="${x + 128}" y="1010" text-anchor="middle" font-family="Impact, Arial Black" font-size="44" fill="#fff4c8">${label}</text>`;
    return p;
  };
  s += tall(0, '#2a7ab0', '#c94f7c', 'HA HA!');
  s += tall(256, '#6a2a8a', '#f2b632', 'HEE HEE!');
  const board = (y, bg, text, sub) => `<rect x="512" y="${y}" width="512" height="256" fill="${bg}"/>
    <rect x="530" y="${y + 18}" width="476" height="220" fill="none" stroke="#fff4c8" stroke-width="8" stroke-dasharray="22 12"/>
    <text x="768" y="${y + 130}" text-anchor="middle" font-family="Impact, Arial Black" font-size="74" fill="#fff4c8">${text}</text>
    <text x="768" y="${y + 196}" text-anchor="middle" font-family="Segoe Print, Comic Sans MS, cursive" font-weight="bold" font-size="40" fill="#ffd34a">${sub}</text>`;
  s += board(0, '#c42a3a', 'STEP RIGHT UP', 'one ticket · all ages');
  s += board(256, '#2a8a5a', 'LAFFS GALORE', 'the tilted room!');
  s += board(512, '#2a1640', 'MIRROR MAZE', 'find your way out');
  s += board(768, '#d07a1a', 'NO RUNNING', 'management');
  s += age(W, H, 6);
  await save('funhouse_panels', W, H, s);
}

/** Inside the Funhouse: four dizzy wall panels (stripes, a warped checker, a giant eye, a melting clock). */
async function funhouseWalls() {
  const W = 2048;
  const H = 1024;
  let s = DEFS(7);
  // 1: candy stripes on a tilt
  s += `<g><clipPath id="c1"><rect x="0" y="0" width="512" height="1024"/></clipPath><g clip-path="url(#c1)">`;
  for (let i = -20; i < 40; i++) s += `<rect x="${i * 60}" y="-300" width="30" height="1700" fill="${i % 2 ? '#d8202c' : '#f4ecd8'}" transform="rotate(25 256 512)"/>`;
  s += `</g></g>`;
  // 2: a checkerboard pulled into a whirlpool
  s += `<rect x="512" y="0" width="512" height="1024" fill="#f4ecd8"/>`;
  for (let r = 0; r < 14; r++) {
    for (let a = 0; a < 16; a++) {
      if ((r + a) % 2) continue;
      const r0 = r * 40;
      const r1 = r0 + 40;
      const t0 = (a / 16) * Math.PI * 2 + r * 0.22;
      const t1 = ((a + 1) / 16) * Math.PI * 2 + r * 0.22;
      const cx = 768;
      const cy = 512;
      s += `<path d="M${cx + Math.cos(t0) * r0} ${cy + Math.sin(t0) * r0} L${cx + Math.cos(t0) * r1} ${cy + Math.sin(t0) * r1} L${cx + Math.cos(t1) * r1} ${cy + Math.sin(t1) * r1} L${cx + Math.cos(t1) * r0} ${cy + Math.sin(t1) * r0} Z" fill="#1a0a14"/>`;
    }
  }
  // 3: a giant eye watching you
  s += `<rect x="1024" y="0" width="512" height="1024" fill="#5ad0e8"/>`;
  s += `<ellipse cx="1280" cy="512" rx="230" ry="140" fill="#f4ecd8" stroke="#1a0a14" stroke-width="14"/><circle cx="1280" cy="512" r="96" fill="#2a8a5a"/><circle cx="1280" cy="512" r="44" fill="#1a0a14"/>`;
  for (let i = 0; i < 9; i++) s += `<path d="M${1080 + i * 50} 400 L${1070 + i * 52} 330" stroke="#1a0a14" stroke-width="10" stroke-linecap="round"/>`;
  s += `<text x="1280" y="900" text-anchor="middle" font-family="Impact, Arial Black" font-size="78" fill="#1a0a14">I SEE YOU</text>`;
  // 4: a melting clock on purple
  s += `<rect x="1536" y="0" width="512" height="1024" fill="#6a2a8a"/>`;
  s += `<path d="M1600 300 Q1792 200 1984 300 Q2000 520 1900 640 Q1880 820 1840 900 Q1820 700 1760 660 Q1650 600 1600 300 Z" fill="#f2b632" stroke="#1a0a14" stroke-width="10"/>`;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    s += `<rect x="${1790 + Math.cos(a) * 140}" y="${430 + Math.sin(a) * 110}" width="8" height="26" fill="#1a0a14"/>`;
  }
  s += `<path d="M1792 440 L1792 360 M1792 440 L1860 480" stroke="#1a0a14" stroke-width="12" stroke-linecap="round"/>`;
  s += age(W, H, 7);
  await save('funhouse_walls', W, H, s);
}

// ------------------------------------------------------------------ Tunnel of Terror inside: cut-out scenery flats
async function tunnelFlats() {
  const W = 2048;
  const H = 1024;
  let s = DEFS(8);
  // four cut-outs on clear, each 512 wide: a graveyard row, a haunted house, a dead tree, a grinning devil
  s += `<g>`;
  for (let i = 0; i < 5; i++) s += tomb(60 + i * 95, 1000, 86, R(220, 330), i % 2 ? '#6a6272' : '#5a5262', R(-10, 10));
  s += `<path d="M0 1024 L0 960 Q256 900 512 960 L512 1024 Z" fill="#2a1c18"/>`;
  for (let i = 0; i < 5; i++) s += `<text x="${60 + i * 95}" y="${880 + (i % 2) * 20}" text-anchor="middle" font-family="Georgia" font-size="30" fill="#2a2430">RIP</text>`;
  // house
  s += `<path d="M600 1024 L600 520 L760 360 L920 520 L920 1024 Z" fill="#2a1630"/><path d="M640 520 L760 410 L880 520 Z" fill="#3a2040"/>`;
  for (const [x, y] of [[650, 600], [810, 600], [650, 760], [810, 760]]) s += `<rect x="${x}" y="${y}" width="60" height="90" fill="#f2c64a"/><rect x="${x + 28}" y="${y}" width="4" height="90" fill="#2a1630"/>`;
  s += `<rect x="730" y="880" width="60" height="144" fill="#0c050c"/>`;
  // tree
  s += deadTree(1280, 1024, 900, '#1c0d12');
  // devil
  s += `<path d="M1536 1024 L1580 640 Q1792 460 2004 640 L2048 1024 Z" fill="#9a1414"/>`;
  s += `<path d="M1610 600 Q1600 420 1680 380 Q1660 500 1700 560 Z M1974 600 Q1984 420 1904 380 Q1924 500 1884 560 Z" fill="#e8e0cc"/>`;
  s += `<path d="M1680 700 L1760 740 L1690 760 Z M1904 700 L1824 740 L1894 760 Z" fill="#ffe14a"/>`;
  s += `<path d="M1660 840 Q1792 960 1924 840 Q1792 900 1660 840 Z" fill="#1a0606"/>`;
  for (let k = 0; k < 6; k++) s += `<path d="M${1690 + k * 40} 860 L${1700 + k * 40} 890 L${1710 + k * 40} 862 Z" fill="#e8e0cc"/>`;
  s += `</g>`;
  s += `<g style="mix-blend-mode:multiply" opacity="0.5">${age(W, H, 8, false)}</g>`;
  await save('tunnel_flats', W, H, s, true);
}

/** A cobweb (white on clear), for the tunnel's corners. */
async function cobweb() {
  const S = 512;
  let s = '';
  const spokes = 9;
  for (let k = 0; k < spokes; k++) {
    const a = (k / (spokes - 1)) * (Math.PI / 2);
    s += `<path d="M0 0 L${Math.cos(a) * 520} ${Math.sin(a) * 520}" stroke="#e8e8e8" stroke-width="2.5" opacity="0.85"/>`;
  }
  for (let r = 50; r < 500; r += R(36, 52)) {
    let d = '';
    for (let k = 0; k < spokes; k++) {
      const a = (k / (spokes - 1)) * (Math.PI / 2);
      const rr = r * R(0.92, 1.04);
      const sag = k ? `Q${Math.cos(a - 0.1) * rr * 0.9} ${Math.sin(a - 0.1) * rr * 0.9} ` : 'M';
      d += `${sag}${Math.cos(a) * rr} ${Math.sin(a) * rr} `;
    }
    s += `<path d="${d}" stroke="#e8e8e8" stroke-width="2" fill="none" opacity="0.75"/>`;
  }
  await save('cobweb', S, S, s, true);
}

async function bats() {
  const S = 512;
  let s = '';
  for (let i = 0; i < 4; i++) s += bat(128 + (i % 2) * 256, 128 + Math.floor(i / 2) * 256, 220, '#100810');
  await save('bats', S, S, s, true);
}

// ------------------------------------------------------------------ Arcade: the marquee, posters and carpet
async function arcadeMarquee() {
  const W = 2048;
  const H = 512;
  let s = DEFS(9);
  s += `<linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a0a3a"/><stop offset="0.6" stop-color="#8a1a6a"/><stop offset="1" stop-color="#f2702c"/></linearGradient>`;
  s += `<linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dff6ff"/><stop offset="0.48" stop-color="#5ab8e8"/><stop offset="0.52" stop-color="#1a3a6a"/><stop offset="1" stop-color="#f0a0ff"/></linearGradient>`;
  s += `<rect width="${W}" height="${H}" fill="url(#dusk)"/>`;
  // a grid running to the horizon and a striped sun
  s += `<circle cx="${W / 2}" cy="360" r="170" fill="#ffb03a"/>`;
  for (let i = 0; i < 6; i++) s += `<rect x="${W / 2 - 180}" y="${300 + i * 22}" width="360" height="${4 + i * 2}" fill="#8a1a6a"/>`;
  s += `<rect x="0" y="380" width="${W}" height="132" fill="#12062a"/>`;
  for (let i = -20; i <= 20; i++) s += `<path d="M${W / 2 + i * 30} 380 L${W / 2 + i * 220} 512" stroke="#e83ad8" stroke-width="3"/>`;
  for (let k = 0; k < 5; k++) s += `<path d="M0 ${392 + k * k * 6} L${W} ${392 + k * k * 6}" stroke="#e83ad8" stroke-width="3"/>`;
  s += `<text x="${W / 2}" y="290" text-anchor="middle" font-family="Impact, Arial Black" font-style="italic" font-size="250" fill="url(#chrome)" stroke="#12062a" stroke-width="10" letter-spacing="18">ARCADE</text>`;
  s += `<text x="${W * 0.12}" y="120" text-anchor="middle" font-family="Arial Black" font-size="60" fill="#ffe14a" transform="rotate(-12 ${W * 0.12} 120)">25¢</text>`;
  s += `<text x="${W * 0.88}" y="120" text-anchor="middle" font-family="Arial Black" font-size="54" fill="#5ad0e8" transform="rotate(12 ${W * 0.88} 120)">HI-SCORE</text>`;
  s += age(W, H, 9);
  await save('arcade_marquee', W, H, s);
}

/** Four game posters (each 512 x 1024) for the walls inside and outside. */
async function arcadePosters() {
  const W = 2048;
  const H = 1024;
  let s = DEFS(10);
  const invader = (x, y, k, fill) => {
    const rows = ['00100000100', '00010001000', '00111111100', '01101110110', '11111111111', '10111111101', '10100000101', '00011011000'];
    let p = '';
    rows.forEach((row, r) => [...row].forEach((c, i) => { if (c === '1') p += `<rect x="${x + i * k}" y="${y + r * k}" width="${k}" height="${k}" fill="${fill}"/>`; }));
    return p;
  };
  const poster = (x, bg, title, sub, art) => `<rect x="${x}" y="0" width="512" height="1024" fill="${bg}"/>${art}
    <text x="${x + 256}" y="130" text-anchor="middle" font-family="Impact, Arial Black" font-style="italic" font-size="62" fill="#ffe14a" stroke="#12062a" stroke-width="4">${title}</text>
    <text x="${x + 256}" y="960" text-anchor="middle" font-family="Arial Black" font-size="25" fill="#f4ecd8">${sub}</text>
    <rect x="${x + 12}" y="12" width="488" height="1000" fill="none" stroke="#f4ecd8" stroke-width="6"/>`;
  let a1 = '';
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a1 += invader(70 + i * 140, 260 + j * 150, 11, ['#5aff7a', '#5ad0e8', '#ff5ad8'][j]);
  a1 += `<path d="M236 820 L256 760 L276 820 Z M216 820 L296 820 L296 840 L216 840 Z" fill="#f4ecd8"/>`;
  s += poster(0, '#0a0a2a', 'GALAXY RAIDERS', 'DEFEND EARTH · 1 OR 2 PLAYERS', a1);
  let a2 = `<path d="M512 1024 L768 420 L1024 1024 Z" fill="#2a2a3a"/>`;
  for (let k = 0; k < 8; k++) a2 += `<rect x="${762}" y="${460 + k * 70}" width="12" height="${20 + k * 6}" fill="#f4ecd8"/>`;
  a2 += `<rect x="690" y="700" width="156" height="90" rx="20" fill="#e8202c"/><circle cx="715" cy="795" r="20" fill="#111"/><circle cx="821" cy="795" r="20" fill="#111"/>`;
  s += poster(512, '#e83ad8', 'NEON RACER', 'TURBO · TIME TRIAL', a2);
  let a3 = `<path d="M1180 760 Q1230 520 1340 470 Q1300 560 1380 600 Q1450 520 1430 420 Q1530 520 1500 760 Z" fill="#2a8a3a"/>`;
  a3 += `<path d="M1300 470 L1270 380 L1330 450 Z M1390 450 L1430 380 L1420 470 Z" fill="#e8e0cc"/><circle cx="1350" cy="520" r="14" fill="#ffe14a"/>`;
  a3 += `<path d="M1420 600 Q1520 560 1560 640 Q1500 620 1440 660 Z" fill="#f2702c"/>`;
  s += poster(1024, '#3a1a0a', "DRAGON'S KEEP", 'SLAY THE BEAST · 3 LIVES', a3);
  let a4 = '';
  for (let i = 0; i < 6; i++) for (let j = 0; j < 9; j++) if (rand() < 0.55) a4 += `<rect x="${1600 + i * 64}" y="${220 + j * 64}" width="56" height="56" fill="${['#ff5a5a', '#5ad0e8', '#ffe14a', '#5aff7a', '#c45aff'][(i + j) % 5]}"/>`;
  s += poster(1536, '#12062a', 'PIXEL PANIC', 'STACK · CLEAR · PANIC!', a4);
  s += age(W, H, 10);
  await save('arcade_posters', W, H, s);
}

/** Signs for the arcade: tokens, the high-score board, and the rules (one sheet, 1024 x 1024: four 512 x 512). */
async function arcadeSigns() {
  const S = 1024;
  let s = DEFS(11);
  s += `<rect x="0" y="0" width="512" height="512" fill="#12062a"/><text x="256" y="200" text-anchor="middle" font-family="Impact, Arial Black" font-size="120" fill="#ffe14a">TOKENS</text><text x="256" y="330" text-anchor="middle" font-family="Arial Black" font-size="90" fill="#5ad0e8">4 for $1</text><circle cx="256" cy="430" r="44" fill="#d8b24a" stroke="#8a6a1a" stroke-width="8"/>`;
  s += `<rect x="512" y="0" width="512" height="512" fill="#0a0a0a"/><text x="768" y="90" text-anchor="middle" font-family="Courier New, monospace" font-weight="bold" font-size="58" fill="#5aff7a">HIGH SCORES</text>`;
  [['DAN', '98450'], ['LIS', '87210'], ['TOM', '76300'], ['KAR', '61050'], ['???', '00000']].forEach(([n, v], i) => { s += `<text x="560" y="${180 + i * 66}" font-family="Courier New, monospace" font-weight="bold" font-size="52" fill="${i === 4 ? '#ff3a3a' : '#5aff7a'}">${i + 1}. ${n}  ${v}</text>`; });
  s += `<rect x="0" y="512" width="512" height="512" fill="#f4ecd8"/><text x="256" y="640" text-anchor="middle" font-family="Arial Black" font-size="56" fill="#c42a3a">NO FOOD</text><text x="256" y="710" text-anchor="middle" font-family="Arial Black" font-size="56" fill="#c42a3a">OR DRINKS</text><text x="256" y="830" text-anchor="middle" font-family="Arial" font-size="40" fill="#222">near the machines</text><text x="256" y="960" text-anchor="middle" font-family="Arial" font-size="32" fill="#555">— the management</text>`;
  s += `<rect x="512" y="512" width="512" height="512" fill="#e8202c"/><text x="768" y="720" text-anchor="middle" font-family="Impact, Arial Black" font-size="110" fill="#fff">INSERT</text><text x="768" y="850" text-anchor="middle" font-family="Impact, Arial Black" font-size="110" fill="#ffe14a">COIN</text>`;
  s += age(S, S, 11);
  await save('arcade_signs', S, S, s);
}

/** 1980s cinema carpet: dark blue with neon squiggles, triangles and planets (tiles). */
async function carpet() {
  const S = 1024;
  let s = DEFS(12);
  s += `<rect width="${S}" height="${S}" fill="#141a3a"/>`;
  const cols = ['#e83ad8', '#5ad0e8', '#ffe14a', '#5aff7a', '#f2702c'];
  for (let i = 0; i < 70; i++) {
    const x = R(0, S);
    const y = R(0, S);
    const c = cols[i % cols.length];
    const k = i % 4;
    if (k === 0) s += `<path d="M${x} ${y} q20 -30 40 0 t40 0 t40 0" stroke="${c}" stroke-width="9" fill="none" stroke-linecap="round"/>`;
    else if (k === 1) s += `<path d="M${x} ${y} l30 -50 l30 50 Z" fill="none" stroke="${c}" stroke-width="8"/>`;
    else if (k === 2) s += `<circle cx="${x}" cy="${y}" r="${R(14, 30)}" fill="${c}"/><ellipse cx="${x}" cy="${y}" rx="50" ry="10" fill="none" stroke="${c}" stroke-width="5"/>`;
    else s += `<rect x="${x}" y="${y}" width="16" height="16" fill="${c}" transform="rotate(45 ${x} ${y})"/>`;
  }
  // worn paths and stains
  s += `<rect width="${S}" height="${S}" filter="url(#grain12)"/><rect width="${S}" height="${S}" fill="#000" opacity="0.18"/>`;
  await save('carpet', S, S, s);
}

/** The gums and teeth of the tunnel's monster mouths: wet dark red with veins; bone white with stains. */
async function flesh() {
  const S = 512;
  let s = DEFS(13);
  s += `<rect width="${S}" height="${S}" fill="#7a1418"/>`;
  for (let i = 0; i < 40; i++) {
    const x = R(0, S);
    const y = R(0, S);
    s += `<path d="M${x} ${y} q${R(-60, 60)} ${R(-60, 60)} ${R(-120, 120)} ${R(-120, 120)}" stroke="#3a0408" stroke-width="${R(2, 6)}" fill="none" opacity="0.7"/>`;
  }
  s += `<rect width="${S}" height="${S}" filter="url(#grain13)"/>`;
  await save('flesh', S, S, s);
}

await tunnelMural();
await monsterEye();
await tunnelPosters();
await funhouseRays();
await spiral();
await funhousePanels();
await funhouseWalls();
await tunnelFlats();
await cobweb();
await bats();
await arcadeMarquee();
await arcadePosters();
await arcadeSigns();
await carpet();
await flesh();
