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
/** How far batches are drawn, as a share of each one's own reach (the graphics settings turn it down). */
let reach = 1;
export function setCullScale(s) {
  if (s === reach) return;
  reach = s;
  lastPos.set(1e9, 0, 0);
}

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
    if (b.merged) {
      cullMerged(b, px, py, pz);
      continue;
    }
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
      const lim = maxDist * reach + r[i];
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

/** Put every copy of every culled batch back in its buffer (for tools that need the whole park, e.g. baking). */
export function restoreAllInstances() {
  for (const b of batches) {
    if (b.merged) {
      for (let i = 0; i < b.n; i++) b.mesh.setVisibleAt(b.ids[i], true);
      b.shown.fill(1);
      continue;
    }
    const { mesh, all, colors, n } = b;
    mesh.instanceMatrix.array.set(all.subarray(0, n * 16));
    if (colors) mesh.instanceColor.array.set(colors.subarray(0, n * 3));
    mesh.count = n;
    mesh.visible = n > 0;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ merging batches that share a material

/** One merged batch: whether each copy is drawn, by the same rules as its batch had. */
function cullMerged(b, px, py, pz) {
  const { mesh, ids, cx, cy, cz, r, maxD, nearD, minD, lodD, shown, n } = b;
  let any = false;
  for (let i = 0; i < n; i++) {
    const dx = cx[i] - px;
    const dy = cy[i] - py;
    const dz = cz[i] - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    let vis = true;
    const lim = maxD[i] * reach + r[i];
    if (d2 > lim * lim) vis = false;
    else if (minD[i] || lodD[i]) {
      const g2 = dx * dx + dz * dz;
      if (g2 < minD[i] * minD[i] || (lodD[i] && g2 > lodD[i] * lodD[i])) vis = false;
    }
    if (vis) {
      const nr = nearD[i] + r[i];
      if (d2 > nr * nr) {
        sphere.center.set(cx[i], cy[i], cz[i]);
        sphere.radius = r[i] + 3;
        if (!frustum.intersectsSphere(sphere)) vis = false;
      }
    }
    if (vis) any = true;
    if ((shown[i] === 1) !== vis) {
      shown[i] = vis ? 1 : 0;
      mesh.setVisibleAt(ids[i], vis);
    }
  }
  mesh.visible = any;
}

/** What batches must agree on to be drawn together: the material, the vertex layout, colours and shadows. */
function mergeKey(b) {
  const m = b.mesh;
  const g = m.geometry;
  const attrs = Object.entries(g.attributes).map(([k, a]) => `${k}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.array.constructor.name}`).sort().join(',');
  return [m.material.uuid, attrs, g.index ? 'i' : 'n', b.colors ? 'c' : '', m.castShadow, m.receiveShadow, Object.keys(g.morphAttributes).length].join('|');
}

/**
 * Draw every set of culled batches that share a material as one THREE.BatchedMesh: one draw call per material
 * instead of one per model (the forest's 57 tree parts become 3). Each copy keeps its own distance limits and
 * hand-over to its far version. The merged mesh's shaders are built in the background (build) before it replaces
 * the batches, so the swap doesn't stall. Returns how many draw calls it saves.
 */
export async function mergeBatches(scene, build) {
  const groups = new Map();
  const ident = new THREE.Matrix4();
  for (const b of batches) {
    if (b.merged || b.taken || !b.mesh.parent || b.mesh.material.userData?.moves || Array.isArray(b.mesh.material)) continue;
    b.mesh.updateWorldMatrix(true, false);
    if (!b.mesh.matrixWorld.equals(ident)) continue;
    const k = mergeKey(b);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  let saved = 0;
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    let nInst = 0;
    let nVert = 0;
    let nIdx = 0;
    for (const b of list) {
      nInst += b.n;
      nVert += b.mesh.geometry.attributes.position.count;
      nIdx += b.mesh.geometry.index ? b.mesh.geometry.index.count : 0;
    }
    const first = list[0].mesh;
    const bm = new THREE.BatchedMesh(nInst, nVert, Math.max(nIdx, 1), first.material);
    bm.name = `merged:${first.material.name || first.material.type}`;
    bm.castShadow = first.castShadow;
    bm.receiveShadow = first.receiveShadow;
    bm.sortObjects = false;
    // (the culling below already leaves out what's off screen)
    bm.perObjectFrustumCulled = false;
    const e = { merged: true, mesh: bm, n: nInst, ids: new Int32Array(nInst), cx: new Float32Array(nInst), cy: new Float32Array(nInst), cz: new Float32Array(nInst), r: new Float32Array(nInst), maxD: new Float32Array(nInst), nearD: new Float32Array(nInst), minD: new Float32Array(nInst), lodD: new Float32Array(nInst), shown: new Uint8Array(nInst).fill(1) };
    let k = 0;
    for (const b of list) {
      const gid = bm.addGeometry(b.mesh.geometry);
      for (let i = 0; i < b.n; i++, k++) {
        const id = bm.addInstance(gid);
        bm.setMatrixAt(id, m.fromArray(b.all, i * 16));
        if (b.colors) bm.setColorAt(id, col.fromArray(b.colors, i * 3));
        e.ids[k] = id;
        e.cx[k] = b.cx[i];
        e.cy[k] = b.cy[i];
        e.cz[k] = b.cz[i];
        e.r[k] = b.r[i];
        e.maxD[k] = b.maxDist;
        e.nearD[k] = b.near;
        e.minD[k] = b.minDist;
        e.lodD[k] = b.lodMax || 0;
      }
    }
    bm.computeBoundingSphere();
    bm.computeBoundingBox();
    for (const b of list) b.taken = true;
    if (build) await build(bm, scene);
    // swap: the merged mesh in, the separate batches out
    scene.add(bm);
    for (const b of list) {
      b.mesh.parent?.remove(b.mesh);
      const i = batches.indexOf(b);
      if (i >= 0) batches.splice(i, 1);
    }
    batches.push(e);
    saved += list.length - 1;
  }
  lastPos.set(1e9, 0, 0);
  return saved;
}
