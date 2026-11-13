// Dev tool: a picture of every landmark (shared/map.js REGIONS) from eye height, on the title screen, for looking the
// park over. With the scratchpad receiver running, in the dev console:
//   await (await import('/src/tools/tour.js')).tour('t1')                 // tour_t1_<n>.jpg
//   await (await import('/src/tools/tour.js')).tour('t1', { dist: 30 })   // stand further back
// Each is taken from dist metres out from the landmark toward the middle of the park, looking at it (lookY up).
import { REGIONS as PLACES, FERRIS } from '../../shared/map.js';
import { cullInstances } from '../cull.js';

export async function tour(tag, { dist = 18, lookY = 4, post = 'http://127.0.0.1:5299/', only = null } = {}) {
  const c = window.__lr;
  const cam = c.camera;
  const out = [];
  for (const [i, p] of PLACES.entries()) {
    if (only && !only.includes(i)) continue;
    const d = Math.hypot(p.x, p.z) || 1;
    // from the middle of the park looking out (the gate: from inside, looking out at it)
    const ux = -p.x / d;
    const uz = -p.z / d;
    const from = [p.x + ux * dist, 1.7, p.z + uz * dist];
    const y = p.name === 'Ferris Wheel' ? FERRIS.hubY * 0.6 : lookY;
    for (let k = 0; k < 4; k++) c.attractFrame(1 / 60);
    cam.position.set(...from);
    cam.lookAt(p.x, y, p.z);
    cam.fov = 60;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    cullInstances(cam, true);
    c.post.setDof?.(10, 0);
    c.post.composer.render();
    const blob = await new Promise((res) => c.renderer.domElement.toBlob(res, 'image/jpeg', 0.88));
    await fetch(`${post}?n=tour_${tag}_${String(i).padStart(2, '0')}&ext=jpg`, { method: 'POST', body: blob });
    out.push(`${i} ${p.name}`);
  }
  return out;
}

/** Pictures from given spots: [[name, [from x, y, z], [look x, y, z]], ...] -> tour_<tag>_<n>.jpg. */
export async function views(list, tag, { fov = 60, post = 'http://127.0.0.1:5299/' } = {}) {
  const c = window.__lr;
  const cam = c.camera;
  const out = [];
  for (const [i, [name, from, at]] of list.entries()) {
    for (let k = 0; k < 4; k++) c.attractFrame(1 / 60);
    cam.position.set(...from);
    cam.lookAt(...at);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    cullInstances(cam, true);
    c.post.setDof?.(10, 0);
    c.post.composer.render();
    const blob = await new Promise((res) => c.renderer.domElement.toBlob(res, 'image/jpeg', 0.88));
    await fetch(`${post}?n=tour_${tag}_${String(i).padStart(2, '0')}&ext=jpg`, { method: 'POST', body: blob });
    out.push(`${i} ${name}`);
  }
  return out;
}
