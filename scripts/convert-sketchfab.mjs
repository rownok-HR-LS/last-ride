// Converts the Sketchfab character downloads (assets-src/sketchfab, git-ignored) into small web GLBs.
// They are rigged on Mixamo, Renderpeople or Character Creator skeletons; this strips their own animations,
// renames the bones to the plain Mixamo names our clips target, merges parts that share a material, and shrinks textures.
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import draco3d from 'draco3dgltf';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, weld, join, flatten, palette, metalRough, transformPrimitive, simplify, simplifyPrimitive, quantize, reorder } from '@gltf-transform/functions';
import { mat4 } from 'gl-matrix';
const { multiply, invert } = mat4;

const SRC = 'assets-src/sketchfab';
const OUT = 'public/models';
const MIXAMO = new Set([
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToe_End',
]);

/** Props baked into a model that the game replaces (its own guns). Matched by material name. */
const DROP = { swat: ['lambert1.003', 'material', 'material_11', 'material_12', 'material_13', 'patch'] }; // only checked on rigid parts
/** Files holding several people: written out as name_0, name_1... one person each. */
const SPLIT = { bgpeople: 4 };
/** Models saved facing away from the camera: turned round (radians about the vertical). */
const TURN = { spice: Math.PI };
/** Dense Character Creator models are cut down harder than the light Renderpeople scans (default ratio 0.6). */
const SIMPLIFY = {
  oldlady: { ratio: 0.12, error: 0.02 },
  spice: { ratio: 0.2, error: 0.01 },
  sweater: { ratio: 0.25, error: 0.01 },
  balthazar: { ratio: 0.3, error: 0.01 },
  jaxon: { ratio: 0.2, error: 0.01 },
};
/** Extra simplification for hair-card materials on hair-heavy models. */
const HAIR = { spice: { ratio: 0.3, error: 0.06 }, oldlady: { ratio: 0.35, error: 0.06 } };
/** Mesh parts (by mesh name) a model is better off without, skinned or not: the stray hair wisps are megabytes. */
const DROP_MESH = { oldlady: [/Wisps_Transparency/] };

/**
 * Rigid parts (a vest, badges) that hang off the scene root would stay frozen while the body moves.
 * Skin each one fully to the bone nearest its centre, keeping it exactly where it sits now.
 */
function bindRigid(doc, name) {
  const root = doc.getRoot();
  const parentOf = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
  const ref = root.listNodes().find((n) => n.getSkin() && n.getMesh());
  if (!ref) return;
  const skin = ref.getSkin();
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  const refWorld = ref.getWorldMatrix();
  for (const n of root.listNodes()) {
    const mesh = n.getMesh();
    if (!mesh || n.getSkin()) continue;
    for (const prim of mesh.listPrimitives()) {
      if ((DROP[name] || []).includes(prim.getMaterial()?.getName())) prim.dispose();
    }
    if (!mesh.listPrimitives().length) {
      n.dispose();
      continue;
    }
    const M = n.getWorldMatrix();
    // centre of the part in world space
    const pos = mesh.listPrimitives()[0].getAttribute('POSITION');
    const c = [0, 0, 0];
    const t = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, t);
      c[0] += M[0] * t[0] + M[4] * t[1] + M[8] * t[2] + M[12];
      c[1] += M[1] * t[0] + M[5] * t[1] + M[9] * t[2] + M[13];
      c[2] += M[2] * t[0] + M[6] * t[1] + M[10] * t[2] + M[14];
    }
    c.forEach((v, i) => (c[i] = v / pos.getCount()));
    let best = 0;
    let bestD = Infinity;
    joints.forEach((j, i) => {
      if (!/Spine|Hips|Neck|Head|Shoulder|Arm|Leg/.test(j.getName())) return;
      const w = j.getWorldMatrix();
      const d = Math.hypot(w[12] - c[0], w[13] - c[1], w[14] - c[2]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    // v_mesh = inv(refWorld) * inv(IBM_j) * inv(boneWorld_j) * M * v, so skinning puts it back where it is
    const ib = Array.from(ibm.getElement(best, []));
    const X = invert([], refWorld);
    multiply(X, X, invert([], ib));
    multiply(X, X, invert([], joints[best].getWorldMatrix()));
    multiply(X, X, M);
    for (const prim of mesh.listPrimitives()) {
      transformPrimitive(prim, X);
      const n4 = prim.getAttribute('POSITION').getCount();
      const J = doc.createAccessor().setType('VEC4').setArray(new Uint16Array(n4 * 4).map((_, i) => (i % 4 ? 0 : best)));
      const W = doc.createAccessor().setType('VEC4').setArray(new Float32Array(n4 * 4).map((_, i) => (i % 4 ? 0 : 1)));
      prim.setAttribute('JOINTS_0', J).setAttribute('WEIGHTS_0', W);
    }
    n.setSkin(skin);
    // same place in the tree as the other skinned parts, so they all share one bind matrix
    parentOf.get(n)?.removeChild(n);
    parentOf.get(ref)?.addChild(n);
    n.setTranslation(ref.getTranslation()).setRotation(ref.getRotation()).setScale(ref.getScale());
    console.log(`  bound ${n.getName()} to ${joints[best].getName()}`);
  }
}

const isIdentity = (M) => M.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-6);

/**
 * Character Creator and similar exports keep a Z-up / centimetre fix on nodes three.js ignores when it binds and
 * poses a skeleton (on the mesh node, or above the skeleton), so bodies come out lying down, giant or stretched and
 * retargeted clips twist. Work out the file's mesh-to-world fix X from a torso joint (jointWorld x IBM), snapped to
 * an axis rotation and a uniform scale (that's what these fixes are; snapping ignores any lean in the rest pose),
 * then move the vertices and bind matrices by X and hang the skeleton straight off the scene. The body keeps its
 * true bind pose (T or A), in one upright, metre-scale space, even when the file rests mid-animation.
 * Files that already work that way (Renderpeople, Mixamo) come out unchanged.
 * turn: extra rotation about the vertical (radians) for a model saved facing backwards.
 */
function uprightSkins(root, turn = 0) {
  const R = [Math.cos(turn), 0, -Math.sin(turn), 0, 0, 1, 0, 0, Math.sin(turn), 0, Math.cos(turn), 0, 0, 0, 0, 1];
  const parentOf = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
  const scene = root.listScenes()[0];
  for (const skin of root.listSkins()) {
    const joints = skin.listJoints();
    const ibm = skin.getInverseBindMatrices();
    const meshes = root.listNodes().filter((n) => n.getSkin() === skin && n.getMesh());
    // which joints actually carry vertices, and how much
    const load = new Array(joints.length).fill(0);
    for (const node of meshes) {
      for (const prim of node.getMesh().listPrimitives()) {
        const J = prim.getAttribute('JOINTS_0');
        const W = prim.getAttribute('WEIGHTS_0');
        if (!J || !W) continue;
        const a = [];
        const w = [];
        for (let v = 0; v < J.getCount(); v++) {
          J.getElement(v, a);
          W.getElement(v, w);
          for (let k = 0; k < 4; k++) load[a[k]] += w[k];
        }
      }
    }
    // the torso joint with the most weight fixes X
    let t = -1;
    joints.forEach((j, i) => {
      if (load[i] > 0 && /Spine|Hips|Waist|Pelvis|Chest/.test(j.getName()) && (t < 0 || load[i] > load[t])) t = i;
    });
    if (t < 0) t = load.indexOf(Math.max(...load));
    const raw = multiply([], joints[t].getWorldMatrix(), ibm.getElement(t, []));
    const s = Math.cbrt(Math.abs(raw[0] * (raw[5] * raw[10] - raw[6] * raw[9]) - raw[4] * (raw[1] * raw[10] - raw[2] * raw[9]) + raw[8] * (raw[1] * raw[6] - raw[2] * raw[5])));
    const X = raw.map((v, i) => (i % 4 === 3 || i >= 12 ? v : Math.round(v / s) * s));
    X[3] = 0; X[7] = 0; X[11] = 0; X[15] = 1;
    // keep that joint's bind position landing on its rest position
    const bindPos = invert([], ibm.getElement(t, [])).slice(12, 15);
    const restPos = joints[t].getWorldMatrix().slice(12, 15);
    for (let k = 0; k < 3; k++) X[12 + k] = restPos[k] - (X[k] * bindPos[0] + X[4 + k] * bindPos[1] + X[8 + k] * bindPos[2]);
    const F = multiply([], R, X);
    // stand the body over the origin (a file can hold several people placed apart)
    const at = [F[0] * bindPos[0] + F[4] * bindPos[1] + F[8] * bindPos[2] + F[12], 0, F[2] * bindPos[0] + F[6] * bindPos[1] + F[10] * bindPos[2] + F[14]];
    F[12] -= at[0];
    F[14] -= at[2];
    const settled = isIdentity(F) && meshes.every((n) => isIdentity(n.getWorldMatrix()));
    if (settled) continue;
    for (const node of meshes) {
      for (const prim of node.getMesh().listPrimitives()) transformPrimitive(prim, F);
      node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    }
    // bind pose in world: F x inverse(IBM) for joints that carry vertices; the rest are bound where they rest
    const bind = joints.map((j, i) => (load[i] > 0 ? multiply([], F, invert([], ibm.getElement(i, []))) : multiply([], R, j.getWorldMatrix())));
    joints.forEach((j, i) => ibm.setElement(i, invert([], bind[i])));
    // three.js poses the top joint as if nothing sat above it: give it its world matrix and put it at the root
    const set = new Set(joints);
    joints.forEach((j, i) => {
      const parent = parentOf.get(j);
      if (!parent || set.has(parent)) return;
      parent.removeChild(j);
      scene.addChild(j);
      j.setMatrix(bind[i]);
    });
  }
}

export const CAST = ['eric', 'claudia', 'nathan', 'carla', 'sophia', 'manuel'];

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
mkdirSync(OUT, { recursive: true });

/** Renderpeople and Character Creator bone names -> Mixamo names. */
const FINGERS = { thumb: 'Thumb', index: 'Index', middle: 'Middle', mid: 'Middle', ring: 'Ring', pinky: 'Pinky' };
const LIMB = /Shoulder|Arm|Hand|Leg|Foot|Toe/;
const RP = {
  hip: 'Hips', spine_01: 'Spine', spine_02: 'Spine1', spine_03: 'Spine2', neck: 'Neck', head: 'Head', head_end: 'HeadTop_End',
  shoulder: 'Shoulder', upperarm: 'Arm', lowerarm: 'ForeArm', hand: 'Hand', upperleg: 'UpLeg', lowerleg: 'Leg', foot: 'Foot', ball: 'ToeBase',
};
const CC = {
  Hip: 'Hips', Waist: 'Spine', Spine01: 'Spine1', Spine02: 'Spine2', NeckTwist01: 'Neck', Head: 'Head',
  Clavicle: 'Shoulder', Upperarm: 'Arm', Forearm: 'ForeArm', Hand: 'Hand', Thigh: 'UpLeg', Calf: 'Leg', Foot: 'Foot', ToeBase: 'ToeBase',
};
const SIDE = { l: 'Left', r: 'Right', L: 'Left', R: 'Right' };

function otherRig(s) {
  // Renderpeople: hip, upperarm_l, index_02_r (Nathan carries an rp_..._walking_ prefix)
  const r = s.replace(/^rp_[a-z]+_(rigged|animated)_\d{3}(_[a-z]+)?_/, '');
  let m = r.match(/^(thumb|index|middle|ring|pinky)_0(\d)_(l|r)$/);
  if (m) return `mixamorig${SIDE[m[3]]}Hand${FINGERS[m[1]]}${m[2]}`;
  m = r.match(/^([a-z0-9_]+?)(?:_(l|r))?$/);
  if (m && RP[m[1]] && (m[2] ? LIMB.test(RP[m[1]]) : !LIMB.test(RP[m[1]]))) return `mixamorig${m[2] ? SIDE[m[2]] : ''}${RP[m[1]]}`;
  // Character Creator: CC_Base_L_Upperarm, CC_Base_R_Mid2
  m = s.match(/^CC_Base_(?:(L|R)_)?([A-Za-z0-9]+)$/);
  if (m) {
    const side = m[1] ? SIDE[m[1]] : '';
    if (CC[m[2]] && (side ? LIMB.test(CC[m[2]]) : !LIMB.test(CC[m[2]]))) return `mixamorig${side}${CC[m[2]]}`;
    const f = m[2].match(/^(Thumb|Index|Mid|Ring|Pinky)(\d)$/);
    if (f && side) return `mixamorig${side}Hand${FINGERS[f[1].toLowerCase()]}${f[2]}`;
  }
  return null;
}

/** 'mixamorig:LeftHand_011' -> 'mixamorigLeftHand'; bare Mixamo names get the prefix; other rigs are mapped. */
function boneName(n) {
  const base = n.replace(/_\d+$/, '');
  const other = otherRig(base);
  if (other) return other;
  let s = base.replace(/^mixamorig\d*:?/, 'mixamorig');
  const finger = /^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)\d$/.test(s);
  if (!s.startsWith('mixamorig') && (MIXAMO.has(s) || finger)) s = `mixamorig${s}`;
  return s;
}

for (const name of process.argv.slice(2).length ? process.argv.slice(2) : CAST) for (let part = 0; part < (SPLIT[name] || 1); part++) {
  const outName = SPLIT[name] ? `${name}_${part}` : name;
  const doc = await io.read(path.join(SRC, `${name}.glb`));
  const root = doc.getRoot();
  for (const a of root.listAnimations()) a.dispose();
  if (SPLIT[name]) {
    // keep one person: their skinned mesh only (the others, and any scenery, go)
    const people = root.listNodes().filter((n) => n.getSkin() && n.getMesh());
    for (const n of root.listNodes()) if (n.getMesh() && n !== people[part]) n.setMesh(null);
    // and the other people's skeletons, or their bones (same names) get mixed up with this one's
    const mine = people[part].getSkin();
    const keep = new Set(mine.listJoints());
    for (const sk of root.listSkins()) {
      if (sk === mine) continue;
      for (const j of sk.listJoints()) if (!keep.has(j)) j.dispose();
      sk.dispose();
    }
  }
  bindRigid(doc, name);
  for (const mesh of root.listMeshes()) {
    if (!(DROP_MESH[name] || []).some((re) => re.test(mesh.getName()))) continue;
    for (const prim of mesh.listPrimitives()) prim.dispose();
  }
  // Character Creator files carry hundreds of facial blend shapes; the game never uses them
  for (const mesh of root.listMeshes()) {
    mesh.setWeights([]);
    for (const prim of mesh.listPrimitives()) {
      for (const t of prim.listTargets()) {
        for (const sem of t.listSemantics()) t.getAttribute(sem).dispose();
        t.dispose();
      }
    }
  }
  for (const node of root.listNodes()) node.setName(boneName(node.getName()));
  await doc.transform(
    metalRough(), // three.js no longer reads the old spec-gloss materials
    dedup(),
    flatten(),
    join({ keepNamed: false }),
    weld(),
    prune(),
    palette({ min: 2 }),
    // very dense scans and sculpts are cut down to a game-friendly triangle count
    simplify({ simplifier: MeshoptSimplifier, ...(SIMPLIFY[name] || { ratio: 0.6, error: 0.004 }) }),
    // single-material scans keep 2k detail; multi-part Character Creator models use 1k colour per part and 512
    // for their normal, roughness and other maps (fine detail nobody sees at play distance)
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: root.listMaterials().length > 2 ? [1024, 1024] : [2048, 2048], quality: 85 }),
    ...(root.listMaterials().length > 2 ? [textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(?!baseColor)/, resize: [512, 512], quality: 85 })] : []),
    prune(), // simplify and texture compression leave the old buffers behind
    // no meshopt here: quantising gives every part its own bind matrices, which stops the game
    // from merging the parts into a few draw calls
  );
  // hair and beard cards are megabytes of tiny strips; thin them much harder than the body
  if (HAIR[name]) {
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        if (/Transparen|Hair|Beard|Wisp/i.test(prim.getMaterial()?.getName() || '')) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ...HAIR[name] });
      }
    }
    await doc.transform(prune());
  }
  uprightSkins(root, TURN[name] || 0);
  // squeeze everything but the positions (quantised positions would give every part its own bind matrices and stop
  // the game merging them), then Meshopt-compress the buffers; the game's loader decodes it
  await doc.transform(
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern: /^(NORMAL|TANGENT|TEXCOORD_d+|WEIGHTS_d+)$/, quantizeNormal: 10, quantizeTexcoord: 14, quantizeWeight: 8 }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const out = path.join(OUT, `${outName}.glb`);
  await io.write(out, doc);
  // Some index buffers left over from simplify only become orphans once written; read back and drop them.
  const clean = await io.read(out);
  const croot = clean.getRoot();
  for (const acc of croot.listAccessors()) if (acc.listParents().every((p) => p === croot)) acc.dispose();
  await io.write(out, clean);
  const prims = root.listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0);
  console.log(outName, `${Math.round(statSync(out).size / 1024)} KB`, `primitives ${prims}`, `materials ${root.listMaterials().length}`);
}
