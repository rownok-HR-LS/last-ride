// Export what glows in the park besides the street lamps, for the Blender light bake (scripts/blender/bake-lamplight.py):
// every neon sign (centre, facing, size, colour) and every marquee bulb that still works (its centre and colour).
// In the dev console, with the scratchpad receiver running, on a freshly started dev server:
//   await (await import('/src/tools/export-glows.js')).exportGlows(__lr, 'http://127.0.0.1:5299/?n=glows&ext=json')
import * as THREE from 'three';
import { mat } from '../world.js';

const LIT = { bulb: '#ffb35a', bulbRed: '#ff2a1a', bulbGreen: '#9aff9a' };

export async function exportGlows(client, postTo) {
  const scene = client.scene;
  scene.updateMatrixWorld(true);
  const out = [];
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const byMat = new Map(Object.entries(LIT).map(([k, c]) => [mat(k), c]));
  // the Ferris wheel, the carousel and the Free Fall's seats move: their bulbs can't be baked
  const rides = client.rides || {};
  const movers = new Set([rides.wheel, rides.carousel, rides.freefallSeat, ...(rides.gondolas || []), ...(rides.train || []), ...(rides.cars || [])].filter(Boolean));
  const moving = (o) => {
    for (let a = o; a; a = a.parent) if (movers.has(a) || a.name === 'kit_freefall_seats') return true;
    return false;
  };
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible || moving(o)) return;
    if (o.userData.neon) {
      o.matrixWorld.decompose(p, q, s);
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const w = o.geometry.parameters.width * s.x;
      out.push({ kind: 'neon', x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), nx: +n.x.toFixed(3), ny: +n.y.toFixed(3), nz: +n.z.toFixed(3), w: +w.toFixed(2), h: +(w / 4).toFixed(2), color: o.userData.neon });
      return;
    }
    const color = byMat.get(o.material);
    if (!color) return;
    // merged bulbs: one small sphere each; their vertices cluster round each centre
    const pos = o.geometry.attributes.position;
    const cells = new Map();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const key = `${Math.round(p.x / 0.3)},${Math.round(p.y / 0.3)},${Math.round(p.z / 0.3)}`;
      const c = cells.get(key) || cells.set(key, [0, 0, 0, 0]).get(key);
      c[0] += p.x;
      c[1] += p.y;
      c[2] += p.z;
      c[3]++;
    }
    // a bulb's vertices straddle cells: merge centres closer than 0.3 m into one bulb
    const pts = [...cells.values()].map(([x, y, z, k]) => [x / k, y / k, z / k, k]);
    const merged = [];
    for (const a of pts) {
      const m = merged.find((b) => Math.hypot(b[0] / b[3] - a[0], b[1] / b[3] - a[1], b[2] / b[3] - a[2]) < 0.3);
      if (m) {
        m[0] += a[0] * a[3];
        m[1] += a[1] * a[3];
        m[2] += a[2] * a[3];
        m[3] += a[3];
      } else merged.push([a[0] * a[3], a[1] * a[3], a[2] * a[3], a[3]]);
    }
    for (const [x, y, z, k] of merged) out.push({ kind: 'bulb', x: +(x / k).toFixed(2), y: +(y / k).toFixed(2), z: +(z / k).toFixed(2), color });
  });
  const res = await fetch(postTo, { method: 'POST', body: JSON.stringify(out) });
  return { neon: out.filter((g) => g.kind === 'neon').length, bulbs: out.filter((g) => g.kind === 'bulb').length, status: res.status };
}
