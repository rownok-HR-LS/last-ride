// Procedural canvas textures for the stylised park.
import * as THREE from 'three';
import { ktx2, freeAfterUpload } from './ktx.js';
import { rng } from '../shared/rng.js';
import { PATHS, RING, PARK_EDGE } from '../shared/map.js';
import { MAP_HALF } from '../shared/constants.js';

const cache = new Map();

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

function grain(ctx, w, h, amount, seed = 1, alpha = 0.08) {
  const r = rng(seed);
  for (let i = 0; i < amount; i++) {
    ctx.fillStyle = r() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.6})`;
    const s = 1 + r() * 3;
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

/** Stripes. vertical=true gives vertical bands (good for tents). */
export function stripes(a, b, n = 8, vertical = true) {
  return cached(`stripes:${a}:${b}:${n}:${vertical}`, () => {
    const c = canvas(256);
    const ctx = c.getContext('2d');
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? b : a;
      if (vertical) ctx.fillRect((i * 256) / n, 0, 256 / n + 1, 256);
      else ctx.fillRect(0, (i * 256) / n, 256, 256 / n + 1);
    }
    grain(ctx, 256, 256, 1500, n, 0.06);
    return toTexture(c);
  });
}

export function diagonalStripes(a, b) {
  return cached(`diag:${a}:${b}`, () => {
    const c = canvas(256);
    const ctx = c.getContext('2d');
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = b;
    for (let i = -256; i < 512; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 32, 0);
      ctx.lineTo(i + 32 + 256, 256);
      ctx.lineTo(i + 256, 256);
      ctx.fill();
    }
    grain(ctx, 256, 256, 1500, 3, 0.07);
    return toTexture(c);
  });
}

export function bricks(base = '#5a2630', mortar = '#2a1418') {
  return cached(`bricks:${base}`, () => {
    const c = canvas(256);
    const ctx = c.getContext('2d');
    const r = rng(9);
    ctx.fillStyle = mortar;
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 8; y++) {
      for (let x = -1; x < 5; x++) {
        const ox = (y % 2) * 32;
        const l = 0.85 + r() * 0.3;
        ctx.fillStyle = shade(base, l);
        ctx.fillRect(x * 64 + ox + 2, y * 32 + 2, 60, 28);
      }
    }
    // moss streaks
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = `rgba(60,110,60,${0.15 + r() * 0.2})`;
      ctx.fillRect(r() * 256, 200 + r() * 56, 10 + r() * 30, 6);
    }
    grain(ctx, 256, 256, 2500, 4, 0.08);
    return toTexture(c);
  });
}

export function planks(base = '#6b4a32') {
  return cached(`planks:${base}`, () => {
    const c = canvas(256);
    const ctx = c.getContext('2d');
    const r = rng(5);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = shade(base, 0.8 + r() * 0.35);
      ctx.fillRect(0, i * 32, 256, 31);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, i * 32 + 30, 256, 2);
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(r() * 256, i * 32 + r() * 30, 30 + r() * 80, 1);
      }
    }
    grain(ctx, 256, 256, 2000, 6, 0.07);
    return toTexture(c);
  });
}

export function crateTex() {
  return cached('crate', () => {
    const c = canvas(256);
    const ctx = c.getContext('2d');
    ctx.drawImage(planks('#8a6440').image, 0, 0);
    ctx.strokeStyle = '#4a311d';
    ctx.lineWidth = 22;
    ctx.strokeRect(11, 11, 234, 234);
    ctx.beginPath();
    ctx.moveTo(20, 20);
    ctx.lineTo(236, 236);
    ctx.stroke();
    ctx.fillStyle = 'rgba(30,20,10,0.5)';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FRAGILE', 128, 140);
    return toTexture(c);
  });
}

export function checker(a = '#1b1b24', b = '#2a2a38', n = 8) {
  return cached(`checker:${a}:${b}`, () => {
    const c = canvas(256);
    const ctx = c.getContext('2d');
    const s = 256 / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        ctx.fillStyle = (x + y) % 2 ? a : b;
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
    grain(ctx, 256, 256, 2000, 7, 0.06);
    return toTexture(c);
  });
}

export function polka(base, dot) {
  return cached(`polka:${base}:${dot}`, () => {
    const c = canvas(128);
    const ctx = c.getContext('2d');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = dot;
    for (const [x, y] of [[32, 32], [96, 96], [96, 32], [32, 96], [64, 64], [0, 64], [64, 0], [128, 64], [64, 128], [0, 0], [128, 0], [0, 128], [128, 128]]) {
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    return toTexture(c);
  });
}

export function shingles(base = '#2c2238') {
  return cached(`shingles:${base}`, () => {
    const c = canvas(256);
    const ctx = c.getContext('2d');
    const r = rng(11);
    for (let y = 0; y < 8; y++) {
      for (let x = -1; x < 9; x++) {
        ctx.fillStyle = shade(base, 0.8 + r() * 0.4);
        ctx.fillRect(x * 32 + (y % 2) * 16, y * 32, 31, 31);
      }
    }
    grain(ctx, 256, 256, 1500, 12, 0.08);
    return toTexture(c);
  });
}

/** Radial glow for light pools and halos (white, tint with material colour). */
export function glow() {
  return cached('glow', () => {
    const c = canvas(128);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return toTexture(c, { repeat: false });
  });
}

export function ringTex() {
  return cached('ring', () => {
    const c = canvas(256);
    const ctx = c.getContext('2d');
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.stroke();
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 120);
    g.addColorStop(0, 'rgba(255,255,255,0.0)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0.35)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(128, 128, 120, 0, Math.PI * 2);
    ctx.fill();
    return toTexture(c, { repeat: false });
  });
}

/**
 * Old carnival sign: rusted board, chipped painted letters, a frame of mostly dead bulbs.
 * Returns { texture, glow } where glow is an emissive mask for the few bulbs still working.
 */
export function signTex(text, { color = '#c8392b', font = 'Rye, Georgia, serif' } = {}) {
  return cached(`sign:${text}:${color}`, () => {
    const r = rng(text.length * 97 + text.charCodeAt(0));
    const c = canvas(1024, 256);
    const ctx = c.getContext('2d');
    const rust = photoTex('rusty_metal_02').image;
    ctx.fillStyle = '#1a1512';
    ctx.fillRect(0, 0, 1024, 256);
    if (rust && rust.complete && rust.width) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(rust, 0, 0, 1024, 256);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(10,8,6,0.55)';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = '#3a2f26';
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, 1004, 236);
    let size = 150;
    ctx.font = `${size}px ${font}`;
    while (ctx.measureText(text).width > 880 && size > 40) {
      size -= 6;
      ctx.font = `${size}px ${font}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 512, 136);
    // chipped paint and rust runs over the letters
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = r() < 0.7 ? 'rgba(20,14,10,0.85)' : 'rgba(110,60,30,0.6)';
      ctx.fillRect(r() * 1024, r() * 256, 2 + r() * 7, 2 + r() * 5);
    }
    for (let i = 0; i < 26; i++) {
      const x = r() * 1024;
      const g = ctx.createLinearGradient(0, 60, 0, 256);
      g.addColorStop(0, 'rgba(90,40,18,0.5)');
      g.addColorStop(1, 'rgba(90,40,18,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 60 + r() * 60, 3 + r() * 6, 200);
    }
    // bulbs around the frame: mostly dead
    const glowC = canvas(1024, 256);
    const gctx = glowC.getContext('2d');
    gctx.fillStyle = '#000';
    gctx.fillRect(0, 0, 1024, 256);
    const bulb = (x, y) => {
      const lit = r() < 0.18;
      ctx.fillStyle = lit ? '#ffcf8a' : '#2a221c';
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      if (lit) {
        gctx.fillStyle = '#ffb060';
        gctx.beginPath();
        gctx.arc(x, y, 9, 0, Math.PI * 2);
        gctx.fill();
      }
    };
    for (let x = 30; x < 1000; x += 42) {
      bulb(x, 28);
      bulb(x, 228);
    }
    return { texture: toTexture(c, { repeat: false }), glow: toTexture(glowC, { repeat: false }), aspect: 4 };
  });
}

/** The painted park ground: grass, cobbled walkways and the ring road. */
export function groundTex() {
  return cached('ground', () => {
    const S = 2048;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    const r = rng(21);
    const k = S / (MAP_HALF * 2);
    const tx = (x) => (x + MAP_HALF) * k;
    ctx.fillStyle = '#2b3a2c';
    ctx.fillRect(0, 0, S, S);
    // grass blotches
    for (let i = 0; i < 4000; i++) {
      const g = 40 + r() * 30;
      ctx.fillStyle = `rgba(${g - 10},${g + 12},${g},0.18)`;
      ctx.beginPath();
      ctx.arc(r() * S, r() * S, 4 + r() * 22, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = 'rgba(70,52,40,0.22)';
      ctx.beginPath();
      ctx.arc(r() * S, r() * S, 8 + r() * 30, 0, Math.PI * 2);
      ctx.fill();
    }
    // outside the fence: darker dirt
    const e = tx(PARK_EDGE);
    const s0 = tx(-PARK_EDGE);
    ctx.fillStyle = 'rgba(15,12,20,0.55)';
    ctx.fillRect(0, 0, S, s0);
    ctx.fillRect(0, e, S, S - e);
    ctx.fillRect(0, 0, s0, S);
    ctx.fillRect(e, 0, S - e, S);
    // walkways
    const stroke = (pts, w, col) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = w * k;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([x, z], i) => (i ? ctx.lineTo(tx(x), tx(z)) : ctx.moveTo(tx(x), tx(z))));
      ctx.stroke();
    };
    const ring = () => {
      ctx.beginPath();
      ctx.arc(tx(0), tx(0), RING.r * k, 0, Math.PI * 2);
    };
    for (const [extra, col] of [[1.6, '#3b3240'], [0, '#8a7b6c']]) {
      for (const p of PATHS) stroke(p.pts, p.w + extra, col);
      ctx.strokeStyle = col;
      ctx.lineWidth = (RING.w + extra) * k;
      ring();
      ctx.stroke();
    }
    // plaza under the big top
    ctx.fillStyle = '#7d6f62';
    ctx.beginPath();
    ctx.arc(tx(0), tx(0), 18 * k, 0, Math.PI * 2);
    ctx.fill();
    // cobbles
    ctx.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 26000; i++) {
      const x = r() * S;
      const y = r() * S;
      ctx.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.04)';
      ctx.fillRect(x, y, 3 + r() * 4, 3 + r() * 4);
    }
    ctx.globalCompositeOperation = 'source-over';
    // cracks and puddles of slime
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = 'rgba(90,255,150,0.05)';
      ctx.beginPath();
      ctx.ellipse(r() * S, r() * S, 10 + r() * 30, 6 + r() * 16, r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const t = toTexture(c, { repeat: false });
    t.anisotropy = 8;
    return t;
  });
}

export function shade(hex, l) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(l);
  return `#${c.getHexString()}`;
}

// ------------------------------------------------------------------ photo textures (Poly Haven, CC0)

const loader = new THREE.TextureLoader();
const pending = [];

/**
 * Phones, tablets and the Low setting load the half-size copies (public/tex/<name>/half, made by
 * scripts/ktx-compress.mjs tex-half): a quarter of the pixels to download and to keep in graphics memory. Decided
 * once, when the page loads (a change of setting applies from the next start).
 */
const HALF = (() => {
  try {
    const touch = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
    const low = JSON.parse(localStorage.getItem('last-ride-settings') || '{}').quality === 'low';
    return touch || low || /[?&]halftex/.test(location.search);
  } catch {
    return false;
  }
})();

/** Resolves once every photo texture requested so far has loaded. */
export function texturesReady() {
  return Promise.all(pending);
}

/**
 * Diffuse / normal / ARM (ao, roughness, metalness) set from public/tex/<name>/, GPU-compressed (KTX2, made by
 * scripts/ktx-compress.mjs). Each comes back at once as an empty texture that fills in when its data arrives, so
 * materials can be built straight away.
 */
export function pbr(name) {
  return cached(`pbr:${name}`, () => {
    const load = (file, srgb) => {
      let done;
      pending.push(new Promise((res) => (done = res)));
      const t = new THREE.CompressedTexture([], 0, 0);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.flipY = false;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      ktx2().load(`./tex/${name}/${HALF ? 'half/' : ''}${file}.ktx2`, (k) => {
        Object.assign(t, { image: k.image, mipmaps: k.mipmaps, format: k.format, type: k.type, colorSpace: k.colorSpace, minFilter: k.minFilter, magFilter: k.magFilter });
        t.generateMipmaps = false;
        freeAfterUpload(t);
        t.needsUpdate = true;
        done();
      }, undefined, (e) => {
        console.warn(`texture ${name}/${file}`, e);
        done();
      });
      return t;
    };
    return { map: load('diff', true), normalMap: load('nor', false), arm: load('arm', false) };
  });
}

/**
 * A photo texture as a plain picture, for painting into canvases (the signs' rust): the WebP kept for it. Its image
 * is there once texturesReady() has resolved.
 */
export function photoTex(name) {
  return cached(`photo:${name}`, () => {
    let done;
    pending.push(new Promise((res) => (done = res)));
    return loader.load(`./tex/${name}/diff.webp`, done, undefined, done);
  });
}

/** Faded, stained circus canvas stripes. */
export function grimyStripes(a, b, n = 2, seed = 1) {
  return cached(`grimy:${a}:${b}:${n}:${seed}`, () => {
    const c = canvas(512);
    const ctx = c.getContext('2d');
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? b : a;
      ctx.fillRect((i * 512) / n, 0, 512 / n + 1, 512);
    }
    const r = rng(seed * 31 + 7);
    // water stains running down from the top
    for (let i = 0; i < 40; i++) {
      const x = r() * 512;
      const g = ctx.createLinearGradient(0, 0, 0, 200 + r() * 300);
      g.addColorStop(0, 'rgba(40,28,18,0.55)');
      g.addColorStop(1, 'rgba(40,28,18,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 6 + r() * 30, 512);
    }
    // mould and mud blotches
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = r() < 0.5 ? `rgba(30,34,20,${0.1 + r() * 0.25})` : `rgba(55,38,25,${0.1 + r() * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(r() * 512, 280 + r() * 232, 4 + r() * 40, 3 + r() * 18, r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // tears
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = '#0b0807';
      ctx.beginPath();
      const x = r() * 512;
      const y = r() * 512;
      ctx.moveTo(x, y);
      ctx.lineTo(x + 6 + r() * 14, y + 20 + r() * 40);
      ctx.lineTo(x - 4, y + 10 + r() * 30);
      ctx.fill();
    }
    grain(ctx, 512, 512, 9000, seed, 0.1);
    return toTexture(c);
  });
}

/** White-on-black walkway mask for blending the ground textures. */
export function pathMask() {
  return cached('pathMask', () => {
    const S = 1024;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    const k = S / (MAP_HALF * 2);
    const tx = (x) => (x + MAP_HALF) * k;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    ctx.filter = 'blur(3px)';
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const p of PATHS) {
      ctx.lineWidth = p.w * k;
      ctx.beginPath();
      p.pts.forEach(([x, z], i) => (i ? ctx.lineTo(tx(x), tx(z)) : ctx.moveTo(tx(x), tx(z))));
      ctx.stroke();
    }
    ctx.lineWidth = RING.w * k;
    ctx.beginPath();
    ctx.arc(tx(0), tx(0), RING.r * k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(tx(0), tx(0), 18 * k, 0, Math.PI * 2);
    ctx.fill();
    // the walkways are breaking up: grass and mud creep in
    ctx.filter = 'none';
    const r = rng(55);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.2 + r() * 0.5})`;
      ctx.beginPath();
      ctx.arc(r() * S, r() * S, 1 + r() * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    return toTexture(c, { repeat: false, srgb: false });
  });
}
