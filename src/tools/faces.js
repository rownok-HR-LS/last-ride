// Dev tool: close-ups of riders' faces on the title screen, for checking the eyelids and hair. With the scratchpad
// receiver running, in the dev console:
//   await (await import('/src/tools/faces.js')).faces(['eric', 'carla'], 'tag')      // ?eyes=1 holds the lids shut
// Each is posted as face_<tag>_<id>.jpg. side: 0 front, 1 three-quarter, 2 back.
export async function faces(ids, tag, { dist = 0.5, side = 0, post = 'http://127.0.0.1:5299/' } = {}) {
  const c = window.__lr;
  const V = c.camera.position.constructor;
  const Q = c.camera.quaternion.constructor;
  const out = {};
  for (const id of ids) {
    document.querySelector(`.tm-pol[data-id="${id}"]`)?.click();
    await new Promise((r) => setTimeout(r, 2500));
    for (let i = 0; i < 30; i++) c.attractFrame(1 / 60);
    const root = c.showChar.root;
    root.updateMatrixWorld(true);
    let head = null;
    root.traverse((o) => {
      if (o.isBone && !head && /head$/i.test(o.name)) head = o;
    });
    const hp = new V();
    head.getWorldPosition(hp);
    const q = root.getWorldQuaternion(new Q());
    // the riders face +z in their own space, and the menu turns them toward the camera
    const ang = side === 2 ? 0 : side === 1 ? Math.PI * 0.75 : Math.PI;
    const dir = new V(Math.sin(ang), 0, Math.cos(ang)).applyQuaternion(q);
    const cam = c.camera;
    cam.position.copy(hp).addScaledVector(dir, dist);
    cam.position.y += 0.07;
    cam.lookAt(hp.x, hp.y + 0.07, hp.z);
    cam.fov = 22;
    cam.updateProjectionMatrix();
    c.post.setDof?.(dist, 0);
    c.post.composer.render();
    const cv = c.renderer.domElement;
    const k = document.createElement('canvas');
    k.width = 420;
    k.height = Math.round((420 * cv.height) / cv.width);
    k.getContext('2d').drawImage(cv, 0, 0, k.width, k.height);
    const blob = await new Promise((r) => k.toBlob(r, 'image/jpeg', 0.9));
    out[id] = (await fetch(`${post}?n=face_${tag}_${id}&ext=jpg`, { method: 'POST', body: blob })).status;
  }
  return out;
}
