// Dev tool: pictures of placed props from close by, on the title screen, for checking a model before and after it is
// changed (textures shrunk, mesh simplified). With the scratchpad receiver running, in the dev console:
//   await (await import('/src/tools/props.js')).props(['bench', 'boxes'], 'before')
// Each is posted as prop_<tag>_<model>.jpg, seen from dist metres (default 3.5) at eye height. 'ferris' frames the wheel.
import { DECOR, FERRIS } from '../../shared/map.js';
import { cullInstances } from '../cull.js';

export async function props(models, tag, { dist = 3.5, post = 'http://127.0.0.1:5299/' } = {}) {
  const c = window.__lr;
  const cam = c.camera;
  const out = {};
  for (const name of models) {
    let at;
    let from;
    if (name === 'ferris') {
      at = [FERRIS.x, FERRIS.hubY * 0.55, FERRIS.z];
      from = [FERRIS.x + 30, 1.7, FERRIS.z + 22];
    } else {
      // the one nearest the middle of the park, looked at from its front
      const d = DECOR.filter((e) => e.model === name).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
      if (!d) continue;
      const r = d.rot || 0;
      at = [d.x, (d.y || 0) + 0.6, d.z];
      from = [d.x + Math.sin(r) * dist, (d.y || 0) + 1.6, d.z + Math.cos(r) * dist];
    }
    for (let i = 0; i < 4; i++) c.attractFrame(1 / 60);
    cam.position.set(...from);
    cam.lookAt(...at);
    cam.fov = 50;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    cullInstances(cam, true);
    c.post.setDof?.(10, 0);
    c.post.composer.render();
    const blob = await new Promise((res) => c.renderer.domElement.toBlob(res, 'image/jpeg', 0.92));
    out[name] = (await fetch(`${post}?n=prop_${tag}_${name}&ext=jpg`, { method: 'POST', body: blob })).status;
  }
  return out;
}
