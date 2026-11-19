// Softens the Blender footprint (scripts/blender/make-footprint.py) into the game's: its alpha blurred a little so
// the glow has a soft rim, white on clear. Usage: node scripts/pack-footprint.mjs -> public/tex/footprint.png
import sharp from 'sharp';

const SRC = 'assets-src/blender/tex/footprint.png';
const alpha = await sharp(SRC).extractChannel('alpha').blur(2.2).toBuffer();
const meta = await sharp(SRC).metadata();
await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: '#ffffff' } })
  .joinChannel(alpha).png().toFile('public/tex/footprint.png');
console.log(`public/tex/footprint.png ${meta.width}x${meta.height}`);
