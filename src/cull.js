// Per-instance culling for the big instanced batches (forest, grass, ground plants). Each batch covers the whole
// map, so three.js can only draw all of it or none of it; here every few frames the copies that are in front of the
// camera and close enough are packed to the front of the instance buffer and only those are drawn.
import * as THREE from 'three';

const batches = [];
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const sphere = new THREE.Sphere();
const lastPos = new THREE.Vector3(1e9, 0, 0);
const lastDir = new THREE.Vector3();
const dir = new THREE.Vector3();
let frame = 0;
let lastFov = 0;

/**
 * Hand an instanced mesh over to the culler once its matrices (and colours) are final.
 * maxDist: never drawn further away than this (m). near: always kept within this distance, even behind the
 * camera, so nearby things still cast shadows into view. minDist: only drawn beyond this (the far, lighter
 * version of something that has a detailed one up close).
 */
export function cullable(mesh, maxDist, near = 25, minDist = 0) {
  const n = mesh.count;
  if (!n) return;
  const all = mesh.instanceMatrix.array.slice(0, n * 16);
  const colors = mesh.instanceColor ? mesh.instanceColor.array.slice(0, n * 3) : null;
  const geo = mesh.geometry;
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  const bs = geo.boundingSphere;
  const cx = new Float32Array(n);
  const cy = new Float32Array(n);
  const cz = new Float32Array(n);
  const r = new Float32Array(n);
  const m = new THREE.Matrix4();
  const c = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    m.fromArray(all, i * 16);
    c.copy(bs.center).applyMatrix4(m);
    cx[i] = c.x;
    cy[i] = c.y;
    cz[i] = c.z;
    r[i] = bs.radius * m.getMaxScaleOnAxis();
  }
  // draw calls only for what is left; three keeps its whole-batch sphere for its own (coarse) test
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  batches.push({ mesh, all, colors, cx, cy, cz, r, n, maxDist, near, minDist });
}

/** Refit every batch to the camera. Cheap enough to run every few frames; skipped while the view is still. */
/** Limit a batch registered with cullable to within lodMax metres (measured flat, like minDist). */
export function lodLimit(mesh, lodMax) {
  const b = batches.find((x) => x.mesh === mesh);
  if (b) b.lodMax = lodMax;
}

export function cullInstances(camera, force = false) {
  frame++;
  camera.updateMatrixWorld();
  camera.getWorldDirection(dir);
  const moved = camera.position.distanceToSquared(lastPos) > 0.25 || dir.dot(lastDir) < 0.9995 || camera.fov !== lastFov;
  if (!force && (!moved || frame % 2)) return;
  lastPos.copy(camera.position);
  lastDir.copy(dir);
  lastFov = camera.fov;
  projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);
  const px = camera.position.x;
  const py = camera.position.y;
  const pz = camera.position.z;
  for (const b of batches) {
    const { mesh, all, colors, cx, cy, cz, r, n, maxDist, near, minDist } = b;
    const min2 = minDist * minDist;
    const out = mesh.instanceMatrix.array;
    const outC = colors ? mesh.instanceColor.array : null;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const dx = cx[i] - px;
      const dy = cy[i] - py;
      const dz = cz[i] - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const lim = maxDist + r[i];
      if (d2 > lim * lim) continue;
      // switch over by the trunk's distance, not the crown's, so near and far versions hand over cleanly
      if (minDist || b.lodMax) {
        const gx = cx[i] - px;
        const gz = cz[i] - pz;
        const g2 = gx * gx + gz * gz;
        if (g2 < min2 || (b.lodMax && g2 > b.lodMax * b.lodMax)) continue;
      }
      const nr = near + r[i];
      if (d2 > nr * nr) {
        sphere.center.set(cx[i], cy[i], cz[i]);
        sphere.radius = r[i] + 3;
        if (!frustum.intersectsSphere(sphere)) continue;
      }
      for (let j = 0; j < 16; j++) out[k * 16 + j] = all[i * 16 + j];
      if (outC) for (let j = 0; j < 3; j++) outC[k * 3 + j] = colors[i * 3 + j];
      k++;
    }
    mesh.count = k;
    mesh.visible = k > 0;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, k * 16);
    mesh.instanceMatrix.needsUpdate = true;
    if (outC) {
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, k * 3);
      mesh.instanceColor.needsUpdate = true;
    }
  }
}
