import * as THREE from 'three';

// Shaders compiled off the main thread. three.js compiles a material's shader the first time it is drawn, which
// stalls the page for as long as the graphics driver takes (seconds, for a park's worth of new models arriving
// under the title). With the KHR_parallel_shader_compile extension the driver can do that in the background:
// renderer.compileAsync starts it and says when it's done. The client sets this up; anything that brings a lot of
// new materials at once (the building kit) can wait on whenCompiled before showing it.

let renderer = null;
let camera = null;
let scene = null;

export function setStage(r, c, s) {
  renderer = r;
  camera = c;
  scene = s;
}

/** A stand-in for the screen effects' buffers, which the park is really drawn into. */
let offscreen = null;

/**
 * Resolves once obj's materials can be drawn without a stall (at once if nothing is set up yet).
 * three.js builds a different shader for drawing to the screen (tone mapping, sRGB output) than into a buffer; the
 * park is drawn into the screen effects' buffers, so the shaders are built for a buffer too (otherwise anything not
 * already shown on the menu is built a second time, on the spot, the first time it appears).
 */
export function whenCompiled(obj) {
  if (!renderer) return Promise.resolve();
  offscreen ??= new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(offscreen);
  const done = renderer.compileAsync(obj, camera, scene);
  renderer.setRenderTarget(prev);
  return done.catch(() => {});
}

/** Does obj hold a material three.js hasn't built a shader for yet? */
export function needsCompile(obj) {
  if (!renderer) return false;
  const props = renderer.properties;
  let need = false;
  obj.traverse((o) => {
    if (need || !(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!props.get(m).currentProgram) {
        need = true;
        break;
      }
    }
  });
  return need;
}

/**
 * Anything added anywhere under scene from now on gets its shaders built in the background straight away (once per
 * batch of adds), whether or not it's visible yet: a far version or a hidden effect is then ready by the time it
 * first shows. Shaders differ by object (instanced, skinned, shadow-receiving), so this compiles per object rather
 * than trusting that a material has been built once.
 */
export function watchAdds(scene) {
  const add = THREE.Object3D.prototype.add;
  const batch = new Set();
  let queued = false;
  const flush = () => {
    queued = false;
    for (const o of batch) {
      let p = o;
      while (p && p !== scene) p = p.parent;
      if (p === scene) whenCompiled(o);
    }
    batch.clear();
  };
  THREE.Object3D.prototype.add = function (...objs) {
    const out = add.apply(this, objs);
    if (this !== scene && renderer) {
      for (const o of objs) if (o?.isObject3D) batch.add(o);
      if (!queued) {
        queued = true;
        setTimeout(flush, 0);
      }
    }
    return out;
  };
}
