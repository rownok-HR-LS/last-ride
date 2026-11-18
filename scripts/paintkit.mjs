// Painting helpers shared by the texture scripts (themed-textures.mjs, rides-textures.mjs): paint grain, peeling,
// water streaks and a vignette (age), an SVG wrapper, and a saver that writes assets-src/blender/tex/<prefix><name>.png.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const OUT = 'assets-src/blender/tex';
mkdirSync(OUT, { recursive: true });

/** Shared filters: paint grain, peeling (a mask with holes), water streaks, soft blur. */
export const DEFS = (id = 0) => `<defs>
  <filter id="grain${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${7 + id}"/><feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 0 0.15  0 0 0 0.45 0"/></filter>
  <filter id="peel${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="4" seed="${3 + id}"/><feComponentTransfer><feFuncA type="discrete" tableValues="0 0 0 0 0 0 0 0 0 1"/></feComponentTransfer><feColorMatrix values="0 0 0 0 0.36  0 0 0 0 0.33  0 0 0 0 0.29  0 0 0 0.75 0"/></filter>
  <filter id="streak${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.06 0.003" numOctaves="3" seed="${11 + id}"/><feColorMatrix values="0 0 0 0 0.1  0 0 0 0 0.08  0 0 0 0 0.05  0 0 0 0.38 -0.1"/></filter>
  <filter id="soft${id}"><feGaussianBlur stdDeviation="3"/></filter>
  <filter id="glow${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <radialGradient id="vig${id}"><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></radialGradient>
</defs>`;

/** Age over a w x h painted area: grain, streaks, peeled patches showing primer, a dark vignette. */
export const age = (w, h, id = 0, peel = true) => `
  <rect width="${w}" height="${h}" filter="url(#grain${id})"/>
  <rect width="${w}" height="${h}" filter="url(#streak${id})"/>
  ${peel ? `<rect width="${w}" height="${h}" filter="url(#peel${id})"/>` : ''}
  <rect width="${w}" height="${h}" fill="url(#vig${id})"/>`;

export const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`;
export const saver = (prefix) => async (name, w, h, body, alpha = false) => {
  const img = sharp(Buffer.from(svg(w, h, body)));
  await (alpha ? img.png() : img.flatten({ background: '#000' }).png()).toFile(`${OUT}/${prefix}${name}.png`);
  console.log(`${prefix}${name}.png ${w}x${h}`);
};
