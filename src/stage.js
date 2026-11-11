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

/** Resolves once obj's materials can be drawn without a stall (at once if nothing is set up yet). */
export function whenCompiled(obj) {
  if (!renderer) return Promise.resolve();
  return renderer.compileAsync(obj, camera, scene).catch(() => {});
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
