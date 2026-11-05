// Realistic characters (Renderpeople scans, CC-BY; rigged on the Mixamo skeleton) with blended animations, weapons and the ghost shimmer.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WEAPONS, FISTS } from '../shared/items.js';
import { weaponModel, GRIP } from './weapons.js';
import { OUTFITS, PLAYER_HEIGHT } from '../shared/constants.js';
import { grimyStripes, glow } from './textures.js';

/** How far out from vertical (seen from the front) a relaxed upper arm may hang. */
const ARM_HANG = 9 * (Math.PI / 180);
const _up = new THREE.Vector3(0, 1, 0);
const _r = new THREE.Vector3();
const _lkUp = new THREE.Vector3(0, 1, 0);
const _lkRight = new THREE.Vector3();
const _lkQ = new THREE.Quaternion();
const _lkP = new THREE.Quaternion();
const _lkW = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _h = new THREE.Vector3();
const _a = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();
const _rq1 = new THREE.Quaternion();
const _rq2 = new THREE.Quaternion();
const _rq3 = new THREE.Quaternion();

/** Swing trails: how many samples the ribbon keeps and how long each lingers (s). */
const TRAIL_N = 14;
const TRAIL_LIFE = 0.12;
const trailMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

/** A ribbon of light behind a swinging weapon's head (drawn in the character's own space). */
function makeTrail() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
  const idx = [];
  for (let i = 0; i < TRAIL_N - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, trailMat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 3;
  return { mesh, samples: [] };
}

const matCache = new Map();
function M(color, opts = {}) {
  const key = `${color}:${JSON.stringify(opts)}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts }));
  return matCache.get(key);
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, material);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

// ------------------------------------------------------------------ shadow wraith (works on skinned meshes)

const GHOST_VERT = `
  #include <common>
  #include <skinning_pars_vertex>
  varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vLocalY;
  void main(){
    #include <skinbase_vertex>
    #include <begin_vertex>
    #include <beginnormal_vertex>
    #include <skinnormal_vertex>
    #include <skinning_vertex>
    vec4 wp = modelMatrix * vec4(transformed, 1.0);
    vN = normalize(mat3(modelMatrix) * objectNormal);
    vV = normalize(cameraPosition - wp.xyz);
    vW = wp.xyz;
    vLocalY = wp.y - modelMatrix[3].y;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const GHOST_FRAG = `
  uniform float opacity; uniform float time; uniform float glow;
  varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vLocalY;
  float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float n3(vec3 p){
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main(){
    // smoke rising through a black silhouette; the legs dissolve into mist
    vec3 q = vW * 3.0 + vec3(0.0, -time * 1.4, 0.0);
    float smoke = n3(q) * 0.6 + n3(q * 2.1 + 7.0) * 0.4;
    float legs = smoothstep(0.15, 1.0, vLocalY);
    float edge = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);
    float body = (0.75 - edge * 0.45) * smoothstep(0.25, 0.6, smoke + legs * 0.45);
    float a = clamp(body * legs + edge * 0.25 * legs, 0.0, 1.0) * opacity;
    vec3 col = vec3(0.012, 0.01, 0.014) + vec3(0.5, 0.06, 0.05) * edge * glow;
    gl_FragColor = vec4(col, a);
  }`;

export function ghostMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { opacity: { value: 1 }, time: { value: 0 }, glow: { value: 0.4 } },
    vertexShader: GHOST_VERT,
    fragmentShader: GHOST_FRAG,
    transparent: true,
    depthWrite: false,
  });
}

/** Two glowing red eyes for the wraith, parented to the head bone. */
function wraithEyes() {
  const g = new THREE.Group();
  const mat = new THREE.SpriteMaterial({ map: glow(), color: '#ff2a1a', blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  for (const x of [-0.035, 0.035]) {
    const s = new THREE.Sprite(mat);
    s.position.set(x, 0.07, 0.09);
    s.scale.setScalar(0.07);
    g.add(s);
  }
  g.visible = false;
  return g;
}

const rimAmount = { value: 1 };
/** Scale the rim light (0 indoors, where the room's own light should do the work). */
export function setCharacterRim(v) {
  rimAmount.value = v;
}

/**
 * What each rider has been through, painted over the scan:
 * - wet: soaked by the rain (darker cloth, a sheen on everything)
 * - blood: builds up with every hit, mostly on the upper body
 * - grime: mud splashed up the legs and shoes, dirty patches elsewhere
 * - tint: a shifted clothing colour (skin is left alone), so two riders from one scan don't look like twins
 * Masks use vBody, the bind-pose position in metres above the feet, so they stay put whatever the pose.
 * Also a cool rim light so distant characters read against the dark park. It's unlit glow, so it fades out within
 * a few metres of the camera: up close it would wash people out into pale, see-through ghosts.
 */
function lookShader(sh) {
  const L = this.userData.look;
  Object.assign(sh.uniforms, { rimAmount, lookWet: L.wet, lookBlood: L.blood, lookGrime: L.grime, lookSeed: L.seed, lookTint: L.tint, lookHit: L.hit || { value: 0 } });
  sh.vertexShader = `attribute vec3 bodyP;\nvarying vec3 vBody;\n${sh.vertexShader}`.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\n  vBody = bodyP;',
  );
  sh.fragmentShader = `uniform float rimAmount; uniform float lookWet; uniform float lookBlood; uniform float lookGrime;
    uniform float lookSeed; uniform vec3 lookTint; uniform float lookHit;
    varying vec3 vBody;
    float lkH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
    float lkN(vec3 p) {
      vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(lkH(i), lkH(i + vec3(1, 0, 0)), f.x), mix(lkH(i + vec3(0, 1, 0)), lkH(i + vec3(1, 1, 0)), f.x), f.y),
        mix(mix(lkH(i + vec3(0, 0, 1)), lkH(i + vec3(1, 0, 1)), f.x), mix(lkH(i + vec3(0, 1, 1)), lkH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
    }
    float lkF(vec3 p) { return lkN(p) * 0.55 + lkN(p * 2.3) * 0.3 + lkN(p * 5.1) * 0.15; }
    vec3 lkHue(vec3 c, float a) {
      const vec3 k = vec3(0.57735);
      float ca = cos(a);
      return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
    }
    float lkMud; float lkBl; float lkSkin;
    ${sh.fragmentShader}`
    .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 c = diffuseColor.rgb;
        float lum = dot(c, vec3(0.299, 0.587, 0.114));
        // judge colours the way they look on screen (gamma space), not in linear light
        vec3 g = sqrt(max(c, 0.0));
        float mx = max(g.r, max(g.g, g.b)), mn = min(g.r, min(g.g, g.b));
        float sat = (mx - mn) / max(mx, 0.001);
        float hue = mx - mn < 0.001 ? 0.0 : mx == g.r ? mod((g.g - g.b) / (mx - mn), 6.0) : mx == g.g ? (g.b - g.r) / (mx - mn) + 2.0 : (g.r - g.g) / (mx - mn) + 4.0;
        // warm tones (every skin colour, but also brown hair and leather): orange-ish hue with some colour in it
        float warm = (1.0 - smoothstep(0.75, 1.1, hue)) * (hue < 5.6 ? 1.0 : 0.0) + smoothstep(5.6, 5.9, hue);
        lkSkin = warm * smoothstep(0.1, 0.22, sat) * smoothstep(0.08, 0.16, mx);
        // clothing: a modest hue turn (never far enough to go green or purple), a lighter or darker dye, and a
        // faint colour cast on greys, whites and blacks so plain shirts, suits and jeans vary too
        vec3 t = lkHue(c, lookTint.x * 0.5) * lookTint.y;
        vec3 tone = vec3(1.0) + vec3(cos(lookTint.x), cos(lookTint.x + 2.1), cos(lookTint.x + 4.2)) * 0.22;
        t = mix(t, vec3(lum) * lookTint.y * tone, 1.0 - smoothstep(0.08, 0.3, sat));
        c = mix(c, max(t, 0.0), (1.0 - lkSkin) * lookTint.z);
        vec3 q = vBody + lookSeed;
        // mud: splashed up from the shoes, patchy, thinning out by the knees
        float n1 = lkF(q * 5.0);
        lkMud = smoothstep(0.6, 0.05, vBody.y + (n1 - 0.5) * 0.35) * smoothstep(0.3, 0.55, lkF(q * 11.0 + 3.0)) * lookGrime;
        c = mix(c, vec3(0.13, 0.095, 0.065) * (0.7 + n1 * 0.6), lkMud * 0.9);
        // grime: dull, dirty patches all over
        c *= 1.0 - lookGrime * 0.3 * smoothstep(0.45, 0.8, lkF(q * 3.0 + 7.0));
        // blood: spatters that spread as it builds up, mostly the chest, arms and face
        float upper = smoothstep(0.75, 1.15, vBody.y);
        float bn = lkF(q * 7.0 + 11.0) + upper * 0.14 - (1.0 - upper) * 0.12;
        float cover = sqrt(lookBlood) * 0.3;
        lkBl = smoothstep(1.02 - cover, 1.06 - cover, bn) * step(0.01, lookBlood);
        c = mix(c, vec3(0.2, 0.015, 0.01) * (0.6 + lkN(q * 40.0) * 0.5), lkBl * 0.92);
        // soaked: water darkens cloth far more than skin
        c *= 1.0 - lookWet * 0.5 * (1.0 - lkSkin * 0.7);
        diffuseColor.rgb = c;
      }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.95, lkMud * (1.0 - lookWet));
      roughnessFactor = mix(roughnessFactor, 0.25, lookWet * 0.9);
      roughnessFactor = mix(roughnessFactor, 0.22, lkBl);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float rimK = pow(1.0 - abs(dot(normalize(-vViewPosition), normal)), 2.5);
      rimK *= rimAmount * smoothstep(5.0, 20.0, length(vViewPosition));
      totalEmissiveRadiance += vec3(0.45, 0.55, 0.7) * rimK * 0.55;
      // struck: a hot flash that hugs the outline, so a hit reads at a glance
      float hitRim = pow(1.0 - abs(dot(normalize(-vViewPosition), normal)), 1.5);
      totalEmissiveRadiance += vec3(1.0, 0.42, 0.3) * lookHit * (0.18 + hitRim * 1.1);`);
}

/** Bake each vertex's bind-pose position (metres above the feet, centred) for the look masks. */
function addBodyCoords(scene, box, k) {
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isSkinnedMesh || o.geometry.attributes.bodyP) return;
    const n = o.geometry.attributes.position.count;
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
      out[i * 3] = (v.x - cx) * k;
      out[i * 3 + 1] = (v.y - box.min.y) * k;
      out[i * 3 + 2] = (v.z - cz) * k;
    }
    o.geometry.setAttribute('bodyP', new THREE.BufferAttribute(out, 3));
  });
}

/** Give a character its own copies of the scan's materials, wired to its look uniforms. */
function wearLook(model, look) {
  const copies = new Map();
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const mine = list.map((m) => {
      if (!copies.has(m)) {
        const c = m.clone();
        c.userData = { look };
        c.onBeforeCompile = lookShader;
        c.customProgramCacheKey = () => 'lr-look';
        copies.set(m, c);
      }
      return copies.get(m);
    });
    o.material = Array.isArray(o.material) ? mine : mine[0];
  });
}

// ------------------------------------------------------------------ model loading

const T = {}; // outfit id -> { scene, scale, clips }
let animSrc = null;
const normBone = (n) => n.replace(/^mixamorig\d*/, 'mixamorig');
const RATE = 30;

/** Rest pose of the skeleton the clips were made on (the first, unsuffixed copy in anims.glb). */
function sourceRig(scene) {
  scene.updateMatrixWorld(true);
  const bones = [];
  const byName = {};
  scene.traverse((o) => {
    const n = normBone(o.name);
    if (!n.startsWith('mixamorig') || /_\d+$/.test(n) || byName[n]) return;
    const parent = byName[normBone(o.parent?.name || '')] ? normBone(o.parent.name) : null;
    const b = {
      name: n, parent, restLocal: o.quaternion.clone(), restLocalPos: o.position.clone(),
      restWorld: o.getWorldQuaternion(new THREE.Quaternion()),
      parentWorld: o.parent ? o.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion(),
      parentMatrix: o.parent ? o.parent.matrixWorld.clone() : new THREE.Matrix4(),
      worldPos: new THREE.Vector3().setFromMatrixPosition(o.matrixWorld),
    };
    byName[n] = b;
    bones.push(b);
  });
  return { bones, byName };
}

/** Bind pose of a character's skeleton, in its scene's space. */
function targetRig(scene) {
  scene.updateMatrixWorld(true);
  let skinned = null;
  scene.traverse((o) => {
    if (o.isSkinnedMesh && !skinned) skinned = o;
  });
  const sk = skinned.skeleton;
  const bind = new Map();
  // bone world matrix at bind time = the mesh's bind matrix (Z-up / centimetre exports have one) x inverse(bone inverse)
  sk.bones.forEach((b, i) => bind.set(b, skinned.bindMatrix.clone().multiply(new THREE.Matrix4().copy(sk.boneInverses[i]).invert())));
  const bones = [];
  const byName = {};
  const quat = (m) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m));
  scene.traverse((o) => {
    if (!bind.has(o)) return;
    const n = o.name;
    const parentBone = bind.has(o.parent) ? o.parent : null;
    const parentMatrix = parentBone ? bind.get(parentBone) : o.parent.matrixWorld.clone();
    const b = {
      name: n, node: o, parent: parentBone ? parentBone.name : null,
      restWorld: quat(bind.get(o)), restWorldPos: new THREE.Vector3().setFromMatrixPosition(bind.get(o)),
      parentWorld: quat(parentMatrix), parentMatrix,
    };
    byName[n] = b;
    bones.push(b);
  });
  return { bones, byName, skinned };
}

/**
 * Re-express a clip made on the source skeleton for the target skeleton: every bone gets the same
 * world-space rotation away from its rest pose. Hip height is scaled to the character; hip drift is removed.
 */
function retarget(clip, src, tgt) {
  const ev = {};
  for (const t of clip.tracks) {
    const [bone, prop] = t.name.split('.');
    if (src.byName[bone] && (prop === 'quaternion' || prop === 'position')) ev[`${bone}.${prop}`] = t.createInterpolant();
  }
  const frames = Math.max(2, Math.round(clip.duration * RATE) + 1);
  const times = new Float32Array(frames);
  const mapped = tgt.bones.filter((b) => src.byName[b.name]);
  const outQ = Object.fromEntries(mapped.map((b) => [b.name, new Float32Array(frames * 4)]));
  // The clips assume a T-pose rest; many models are bound in an A-pose. Swing each arm and leg bone so
  // it points the same way as the source bone at rest (towards the next joint), then retarget.
  if (!tgt.aligned) {
    tgt.aligned = {};
    for (const b of tgt.bones) {
      const s = src.byName[b.name];
      let a = b.restWorld.clone();
      const limb = b.name.match(/^mixamorig(Left|Right)(Shoulder|Arm|ForeArm|Hand|UpLeg|Leg)$/);
      if (s && limb) {
        const next = { Shoulder: 'Arm', Arm: 'ForeArm', ForeArm: 'Hand', Hand: 'HandMiddle1', UpLeg: 'Leg', Leg: 'Foot' }[limb[2]];
        const child = tgt.byName[`mixamorig${limb[1]}${next}`];
        if (child) {
          const ds = src.byName[child.name].worldPos.clone().sub(s.worldPos).normalize();
          const dt = child.restWorldPos.clone().sub(b.restWorldPos).normalize();
          if (ds.lengthSq() > 0.5 && dt.lengthSq() > 0.5) a = new THREE.Quaternion().setFromUnitVectors(dt, ds).multiply(a);
        }
      }
      tgt.aligned[b.name] = a;
    }
  }
  const hipsT = tgt.byName.mixamorigHips;
  const hipsS = src.byName.mixamorigHips;
  const outP = hipsT && hipsS ? new Float32Array(frames * 3) : null;
  const k = hipsT && hipsS ? hipsT.restWorldPos.y / hipsS.worldPos.y : 1;
  const sw = {};
  const tw = {};
  const q = new THREE.Quaternion();
  const d = new THREE.Quaternion();
  const inv = new THREE.Quaternion();
  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration, f / RATE);
    times[f] = t;
    // source world rotations for this frame
    for (const b of src.bones) {
      const it = ev[`${b.name}.quaternion`];
      const local = it ? q.fromArray(it.evaluate(t)) : q.copy(b.restLocal);
      const parent = b.parent ? sw[b.parent] : b.parentWorld;
      sw[b.name] = (sw[b.name] || new THREE.Quaternion()).copy(parent).multiply(local);
    }
    // target: same world delta from rest, converted back to local
    for (const b of tgt.bones) {
      const parent = b.parent ? tw[b.parent] : b.parentWorld;
      const s = src.byName[b.name];
      const w = tw[b.name] || (tw[b.name] = new THREE.Quaternion());
      if (s) {
        d.copy(sw[b.name]).multiply(inv.copy(s.restWorld).invert());
        w.copy(d).multiply(tgt.aligned[b.name]);
        const local = inv.copy(parent).invert().multiply(w);
        local.toArray(outQ[b.name], f * 4);
      } else {
        // not animated: keeps its rest offset from its (possibly animated) parent
        w.copy(parent).multiply(inv.copy(b.parentWorld).invert()).multiply(b.restWorld);
      }
    }
    if (outP) {
      const it = ev['mixamorigHips.position'];
      const p = new THREE.Vector3();
      if (it) p.fromArray(it.evaluate(t)).sub(hipsS.restLocalPos);
      // local offset -> world, keep only the vertical part (no drift), scale to the character
      p.applyQuaternion(hipsS.parentWorld);
      const world = hipsT.restWorldPos.clone().add(new THREE.Vector3(0, p.y * k * hipsScale(hipsS), 0));
      world.applyMatrix4(new THREE.Matrix4().copy(hipsT.parentMatrix).invert());
      world.toArray(outP, f * 3);
    }
  }
  const tracks = mapped.map((b) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, outQ[b.name]));
  if (outP) tracks.push(new THREE.VectorKeyframeTrack('mixamorigHips.position', times, outP));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** World units per local unit of the source hips (the source armature may be scaled). */
function hipsScale(hipsS) {
  return new THREE.Vector3().setFromMatrixScale(hipsS.parentMatrix).y;
}

/**
 * Some models arrive as dozens of skinned parts. Parts that share a material and a skeleton become one
 * mesh, which cuts the draw calls per character a lot.
 */
function mergeSkinned(scene) {
  const groups = new Map();
  scene.traverse((o) => {
    if (!o.isSkinnedMesh || Array.isArray(o.material)) return;
    // parts often carry their own Skeleton object over the same bones
    const key = `${o.material.uuid}:${[...o.skeleton.bones].map((b) => b.uuid).sort().join()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const [first] = list;
    const near = (a, b) => a.elements.every((x, i) => Math.abs(x - b.elements[i]) < 1e-3 * (1 + Math.abs(x)));
    // only parts bound exactly like the first one can share its skeleton
    const compatible = (m) => near(m.bindMatrix, first.bindMatrix)
      && m.skeleton.bones.every((b, i) => {
        const j = first.skeleton.bones.indexOf(b);
        return j >= 0 && near(m.skeleton.boneInverses[i], first.skeleton.boneInverses[j]);
      });
    if (!list.every(compatible)) continue;
    const geos = list.map((m) => {
      const keep = new Set(['position', 'normal', 'uv', 'skinIndex', 'skinWeight']);
      const c = m.geometry.clone();
      // merged buffers must all use the same plain float layout
      for (const n of ['position', 'normal', 'uv']) {
        const at = c.attributes[n];
        if (!at || at.array instanceof Float32Array && !at.isInterleavedBufferAttribute) continue;
        const out = new Float32Array(at.count * at.itemSize);
        for (let i = 0; i < at.count; i++) for (let k = 0; k < at.itemSize; k++) out[i * at.itemSize + k] = at.getComponent(i, k);
        c.setAttribute(n, new THREE.BufferAttribute(out, at.itemSize));
      }
      // each part may number the bones differently: rewrite its indices against the first part's skeleton
      const map = m.skeleton.bones.map((b) => first.skeleton.bones.indexOf(b));
      const si = c.attributes.skinIndex;
      if (si) {
        const out = new Uint16Array(si.count * 4);
        for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) out[i * 4 + k] = Math.max(0, map[si.getComponent(i, k)] ?? 0);
        c.setAttribute('skinIndex', new THREE.BufferAttribute(out, 4));
      }
      const sw = c.attributes.skinWeight;
      if (sw) {
        const w = new Float32Array(sw.count * 4);
        for (let i = 0; i < sw.count; i++) for (let k = 0; k < 4; k++) w[i * 4 + k] = sw.getComponent(i, k);
        c.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
      }
      for (const n of Object.keys(c.attributes)) if (!keep.has(n)) c.deleteAttribute(n);
      for (const n of Object.keys(c.morphAttributes)) delete c.morphAttributes[n];
      return c;
    });
    const indexed = geos.every((g) => g.index);
    const merged = mergeGeometries(indexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g)));
    if (!merged) continue;
    first.geometry = merged;
    for (const m of list.slice(1)) m.parent.remove(m);
  }
}

/** Load every character and the shared animation set. Call once before creating any Character. */
export async function loadCharacters(onProgress) {
  if (animSrc) return;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let done = 0;
  const total = OUTFITS.length + 1;
  const load = async (url) => {
    const g = await loader.loadAsync(url);
    onProgress?.(++done / total);
    return g;
  };
  const anims = await load('./models/anims.glb');
  // merged clips target suffixed copies of the skeleton (mixamorigHips_3); point them back at the real bones
  const clips = anims.animations.map((c) => {
    c.tracks.forEach((t) => {
      t.name = normBone(t.name).replace(/^(mixamorig[A-Za-z0-9]+?)_\d+\./, '$1.');
    });
    return c;
  });
  // upper-body copies: no hips or legs, so they can play over walking and running
  for (const name of UPPER) {
    const c = clips.find((x) => x.name === name);
    if (!c) continue;
    const tracks = c.tracks.filter((t) => !LOWER_BODY.test(t.name.split('.')[0]));
    clips.push(new THREE.AnimationClip(`${name}_up`, c.duration, tracks));
  }
  animSrc = { clips, rig: sourceRig(anims.scene) };

  await Promise.all(OUTFITS.map(async (o) => {
    const g = await load(`./models/${o.model}.glb`);
    const scene = g.scene;
    scene.traverse((n) => {
      n.name = normBone(n.name);
      if (n.isMesh) {
        n.castShadow = true;
        n.receiveShadow = true;
        n.frustumCulled = false;
        // the park is dark and damp: nothing should look plastic
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        for (const m of mats) {
          m.roughness = Math.max(m.roughness ?? 0.8, 0.65);
          m.metalness = Math.min(m.metalness ?? 0, 0.2);
          if (m.map) m.map.anisotropy = 4;
        }
      }
    });
    // Sketchfab files are saved in whatever pose the author left them; go back to the bind pose
    scene.updateMatrixWorld(true);
    scene.traverse((n) => {
      if (n.isSkinnedMesh) n.skeleton.pose();
    });
    scene.updateMatrixWorld(true);
    mergeSkinned(scene);
    const rig = targetRig(scene);
    const box = new THREE.Box3().setFromObject(scene);
    // size people by where their head is (a hat, hair or a raised arm would throw a bounding box off): the head
    // joint sits at about 86% of a person's height
    const head = scene.getObjectByName('mixamorigHead');
    const headY = head ? head.getWorldPosition(new THREE.Vector3()).y - box.min.y : 0;
    const h = headY > 0 ? headY / 0.86 : box.max.y - box.min.y || 1.8;
    addBodyCoords(scene, box, PLAYER_HEIGHT / h);
    const own = {};
    for (const c of animSrc.clips) {
      const clip = retarget(c, animSrc.rig, rig);
      // retargeting writes every bone; an upper-body clip must leave the hips and legs to the walk cycle
      if (c.name.endsWith('_up')) clip.tracks = clip.tracks.filter((t) => !LOWER_BODY.test(t.name.split('.')[0]));
      own[c.name] = clip;
    }
    // feet on the ground, whatever the author used as the origin
    T[o.id] = { scene, scale: PLAYER_HEIGHT / h, footY: -box.min.y, clips: own };
  }));
}

// ------------------------------------------------------------------ character

const FADE = 0.18;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v6 = new THREE.Vector3();
const _v7 = new THREE.Vector3();
const _e1 = new THREE.Euler();

/** Directional locomotion (strafing in a fight or aiming): walk / run / sprint clips that match those speeds. */
const RIFLE_SET = {
  walk: { forward: 'walk_forward', backward: 'walk_backward', left: 'walk_left', right: 'walk_right' },
  run: { forward: 'run_forward', backward: 'run_backward', left: 'run_left', right: 'run_right' },
  sprint: 'sprint_forward',
};

/** Bones the walk cycle owns (upper-body clips leave these alone). */
const LOWER_BODY = /(Hips|UpLeg|Leg|Foot|Toe)/;

/** Clips that play on the upper body only (an _up copy without the hips and legs is made at load). */
const UPPER = ['m_idle', 'fight_idle', 'm_light', 'm_light2', 'm_heavy', 'm_block', 'm_block_hit', 'm_stagger', 'punch', 'punch2', 'punch_hook', 'punch_upper', 'throw', 'bow_draw',
  'gs_idle', 'gs_combo', 'gs_down', 'gs_power', 'gs_block', 'gs_block_hit', 'gs_hit', 'react_left', 'react_right', 'react_gut', 'head_hit_big', 'mc_combo3'];
/** The big two-handed weapons fight with the great-sword set: both hands on the haft, the weight behind each swing. */
const TWO_HANDED = new Set(['sledge', 'axe', 'lever']);
/** Cuts that live inside a longer clip (the great-sword combo holds three slashes). */
const CLIP_OF = { gs_c1: 'gs_combo', gs_c2: 'gs_combo', gs_c3: 'gs_down', mc_c1: 'mc_combo3', mc_c2: 'mc_combo3', mc_c3: 'mc_combo3' };
const REACTS = ['react_left', 'react_right', 'react_gut'];
/** Seconds into each attack clip: [start, impact, end, windup hold for heavy swings]. */
export const CUTS = {
  m_light: [0.45, 1.0, 1.45, 0.75],
  m_light2: [0.55, 1.03, 1.5, 0.8],
  m_heavy: [0.05, 0.85, 1.3, 0.45],
  punch: [0.1, 0.37, 0.7, 0.25],
  punch2: [0.6, 1.0, 1.3, 0.8],
  punch_hook: [0.6, 0.97, 1.35, 0.75],
  punch_upper: [0.2, 0.5, 0.85, 0.35],
  // great sword: impacts measured at the hand's fastest moment
  gs_c1: [0.25, 0.7, 1.15, 0.5],
  gs_c2: [1.2, 1.67, 2.1, 1.45],
  gs_c3: [0.12, 0.53, 0.95, 0.35],
  gs_power: [0.0, 0.73, 1.3, 0.48],
  // one-handed weapons: a three-hit combo that flows from each strike into the next
  mc_c1: [0.45, 0.93, 1.3, 0.7],
  mc_c2: [1.3, 1.73, 2.1, 1.5],
  mc_c3: [2.1, 2.63, 3.2, 2.35],
  gs_block: [0, 0.5, 0.96],
  gs_block_hit: [0, 0.3, 0.8],
  gs_hit: [0, 0.3, 0.8],
  react_left: [0, 0.25, 0.7],
  react_right: [0, 0.3, 0.8],
  react_gut: [0, 0.3, 0.85],
  head_hit_big: [0, 0.3, 0.8],
  m_block: [0, 0.5, 1.0],
  m_block_hit: [0, 0.6, 1.2],
  m_stagger: [0, 0.6, 1.5],
  throw: [2.0, 2.4, 2.8],
  bow_draw: [0.05, 0.55, 0.6],
  slide: [0.1, 0.4, 0.72], // [drop starts, flat on the ground, starts getting up]
  jump_down: [0.33], // the feet touch down (before that the legs are still tucked in the air)
};

/** Small seeded random numbers, so a rider looks the same every time it's built (corpse, stolen body, rejoin). */
function seeded(seed) {
  let s = Math.floor(Math.abs(seed) * 2654435761) % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export class Character {
  /** seed: anything numeric that identifies the rider (a player id); it picks their clothing colour, size and dirt. */
  constructor(outfit, seed = Math.random() * 1e6) {
    const tpl = T[outfit] || T[OUTFITS[0].id];
    const r = seeded(seed + 1);
    this.root = new THREE.Group();
    this.model = SkeletonUtils.clone(tpl.scene);
    // nobody is quite the same size: a few percent taller or shorter, broader or slighter
    const tall = 0.95 + r() * 0.1;
    const broad = 0.95 + r() * 0.1;
    this.model.scale.set(tpl.scale * tall * broad, tpl.scale * tall, tpl.scale * tall * broad);
    this.baseY = tpl.footY * tpl.scale * tall;
    this.look = {
      wet: { value: 0 },
      blood: { value: 0 },
      grime: { value: 0.35 + r() * 0.6 },
      seed: { value: r() * 50 },
      hit: { value: 0 },
      // hue turn, value scale, how much of the cloth it applies to (some riders keep their scan's colours)
      tint: { value: new THREE.Vector3((r() - 0.5) * 3.2, 0.62 + r() * 0.55, r() < 0.15 ? 0 : 0.6 + r() * 0.4) },
    };
    wearLook(this.model, this.look);
    this.model.rotation.y = Math.PI; // Mixamo faces +z, the game faces -z
    this.root.add(this.model);
    this.clips = tpl.clips;
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    this.current = null;
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name.replace('mixamorig', '')] = o;
    });
    this.hand = this.bones.RightHand;
    this.wKey = null;
    this.weapon = null;
    this.upName = null;
    this.upFade = null;
    this.upW = 0;
    this.combo = 0;
    this.hitstop = 0;
    this.staggerAt = null;
    this.recoil = 0;
    this.lastState = null;

    // parachute: a stained circus canopy
    const chute = new THREE.Group();
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.6),
      new THREE.MeshStandardMaterial({ map: grimyStripes('#4e1a1c', '#8c836c', 12, 9), side: THREE.DoubleSide, roughness: 0.9 }),
    );
    canopy.scale.y = 0.55;
    canopy.position.y = 3.9;
    chute.add(canopy);
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pts.push(new THREE.Vector3(0, 1.9, 0), new THREE.Vector3(Math.cos(a) * 1.75, 4.2, Math.sin(a) * 1.75));
    }
    chute.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#8a8478' })));
    chute.visible = false;
    this.root.add(chute);
    this.chute = chute;

    this.solidMats = new Map();
    this.model.traverse((o) => {
      if (o.isMesh) this.solidMats.set(o, o.material);
    });
    this.ghostMat = ghostMaterial();
    this.eyes = wraithEyes();
    if (this.bones.Head) this.bones.Head.add(this.eyes);
    this.w = {};
    this.vf = 0;
    this.vs = 0;
    this.phase = 0;
    this.over = null;
    this.fadingOver = null;
    this.overW = 0;
    this.flinch = 0;
    this.isGhost = false;
  }

  action(name) {
    if (!this.actions[name]) {
      const clip = this.clips[name];
      if (!clip) return null;
      this.actions[name] = this.mixer.clipAction(clip);
    }
    return this.actions[name];
  }

  play(name, fade = FADE, { once = false, speed = 1 } = {}) {
    if (this.current === name) {
      this.actions[name].timeScale = speed;
      return;
    }
    const next = this.action(name);
    if (!next) return;
    next.reset();
    next.timeScale = speed;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (this.current && this.actions[this.current] && fade > 0) next.crossFadeFrom(this.actions[this.current], fade, false);
    else if (this.current && this.actions[this.current]) this.actions[this.current].stop();
    next.play();
    this.current = name;
  }

  setWeapon(w, rarity) {
    const key = w && w !== 'fists' ? `${w}:${rarity}` : null;
    if (key === this.wKey) return;
    this.wKey = key;
    if (this.weapon) this.root.remove(this.weapon);
    this.weapon = null;
    if (!key) return;
    this.weapon = weaponModel(w, rarity);
    // melee weapons are modelled upright: the head is at the top of their length
    this.weaponLen = new THREE.Box3().setFromObject(this.weapon).max.y;
    this.weapon.userData.grip = GRIP[w];
    this.root.add(this.weapon);
    if (this.isGhost) this.weapon.visible = false;
  }

  /** World transform of a weapon -> local to the character root. */
  setWeaponWorld(q, pos) {
    this.root.updateWorldMatrix(true, false);
    const rq = this.root.getWorldQuaternion(_q1);
    this.weapon.quaternion.copy(rq.invert().multiply(q));
    this.weapon.position.copy(this.root.worldToLocal(pos));
  }

  /**
   * Melee weapons sit in the right fist and follow the animation: the handle runs across the palm
   * (pinky to index knuckle) and the edge leads with the fingers. Launchers point where you aim.
   */
  placeWeapon(yaw, pitch) {
    if (!this.weapon) return;
    const grip = this.weapon.userData.grip;
    const b = this.bones;
    if (grip === 'hand' && b.RightHandIndex1 && b.RightHandPinky1 && b.RightHandMiddle1) {
      const hand = _v1.setFromMatrixPosition(b.RightHand.matrixWorld);
      const idx = _v2.setFromMatrixPosition(b.RightHandIndex1.matrixWorld);
      const pk = _v3.setFromMatrixPosition(b.RightHandPinky1.matrixWorld);
      const mid = _v4.setFromMatrixPosition(b.RightHandMiddle1.matrixWorld);
      const y = idx.sub(pk).normalize();
      const f = mid.clone().sub(hand);
      const z = f.clone().addScaledVector(y, -f.dot(y)).normalize();
      const x = _v5.crossVectors(y, z);
      const q = _q2.setFromRotationMatrix(_m1.makeBasis(x, y, z));
      const pos = hand.addScaledVector(f, 0.75);
      this.setWeaponWorld(q, pos);
      return;
    }
    const hand = grip === 'bow' ? b.LeftHand : b.RightHand;
    if (!hand) return;
    const q = _q2.setFromEuler(_e1.set(pitch, yaw, 0, 'YXZ'));
    const pos = _v1.setFromMatrixPosition(hand.matrixWorld).add(_v2.set(0, -0.02, 0.02).applyQuaternion(q));
    this.setWeaponWorld(q, pos);
  }

  /** How soaked (0..1) and how bloodied (0..1) the rider is now. */
  setLook(wet, blood) {
    this.look.wet.value = wet;
    this.look.blood.value = blood;
  }

  applyGhost(on) {
    this.isGhost = on;
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      if (on) {
        if (!this.solidMats.has(o)) this.solidMats.set(o, o.material);
        o.material = this.ghostMat;
        o.castShadow = false;
      } else if (this.solidMats.has(o)) {
        o.material = this.solidMats.get(o);
        o.castShadow = true;
      }
    });
    if (this.weapon) this.weapon.visible = !on;
  }

  /** Something the sim told us about this character (a swing, a block, a dodge, a throw). */
  event(e, time) {
    if (e.e === 'swing') this.combo = e.heavy ? 0 : e.combo || 0;
    // a hit freezes both fighters for a few frames
    if (e.e === 'hit' || e.e === 'block') this.hitstop = e.heavy ? 0.09 : 0.06;
    if (e.e === 'hit' && e.victim) {
      const r = REACTS[Math.floor(Math.random() * REACTS.length)];
      this.hitClip = this.clips[r] ? (e.heavy ? 'react_gut' : r) : e.heavy ? (this.clips.hit_body ? 'hit_body' : 'm_stagger') : this.clips.hit_head ? 'hit_head' : 'm_stagger';
      // a quick reaction in the shoulders and head for any blow that doesn't stagger
      this.reactAt = time;
      this.reactClip = this.twoHanded && this.clips.gs_hit ? 'gs_hit' : this.clips[r] ? (e.heavy ? 'head_hit_big' : r) : null;
    }
    if (e.e === 'block') this.blockHitAt = time;
    if (e.e === 'dodge') this.dodgeDir = e.dir;
    if (e.e === 'fire' && (e.kind === 'darts' || e.kind === 'holy' || e.kind === 'flare')) this.throwAt = time;
  }

  /** Which upper-body clip to show right now, and at what time in it. */
  upperBody(p, time) {
    const w = p.wpn;
    const def = w === 'fists' ? FISTS : WEAPONS[w];
    if (!def) return null;
    const two = TWO_HANDED.has(w) && !!this.clips.gs_combo;
    this.twoHanded = two;
    const at = (name, u) => {
      const c = CUTS[name];
      return { name, t: c ? c[0] + (c[2] - c[0]) * u : u };
    };
    // a swing: windup to the impact frame by hitAt, then the follow-through
    if (p.atk && def.type === 'melee') {
      const fists = w === 'fists';
      // combo: forehand, backhand, then an overhead finisher
      const name = two
        ? p.atk.heavy ? 'gs_power' : ['gs_c1', 'gs_c2', 'gs_c3'][this.combo]
        : p.atk.heavy ? (fists ? (this.clips.punch_upper ? 'punch_upper' : 'punch2') : 'm_heavy') : fists ? ['punch2', this.clips.punch_hook ? 'punch_hook' : 'punch', this.clips.punch_upper ? 'punch_upper' : 'punch2'][this.combo] : this.clips.mc_combo3 ? ['mc_c1', 'mc_c2', 'mc_c3'][this.combo] : ['m_light', 'm_light2', 'm_heavy'][this.combo];
      const c = CUTS[name];
      const u = Math.min(1, p.atk.u);
      const from = p.atk.heavy ? c[3] : c[0];
      const t = u < def.hitAt ? from + (c[1] - from) * (u / def.hitAt) : c[1] + (c[2] - c[1]) * ((u - def.hitAt) / (1 - def.hitAt));
      return { name: CLIP_OF[name] || name, t };
    }
    // charging a heavy swing: wind up and hold
    if (p.charge > 0 && def.type === 'melee' && !def.auto) {
      const name = w === 'fists' ? 'punch2' : two ? 'gs_power' : 'm_heavy';
      const c = CUTS[name];
      return { name, t: c[0] + (c[3] - c[0]) * Math.min(1, p.charge / 0.3) };
    }
    if (p.charge > 0 && w === 'bow') return at('bow_draw', Math.min(1, p.charge / def.draw));
    if (time - (this.blockHitAt ?? -9) < 0.35) return at(two ? 'gs_block_hit' : 'm_block_hit', (time - this.blockHitAt) / 0.35);
    if (p.blocking) return at(two ? 'gs_block' : 'm_block', 0.5);
    // taking a blow: the shoulders and head snap away from it
    if (this.reactClip && !p.stagger && time - (this.reactAt ?? -9) < 0.45) return at(this.reactClip, (time - this.reactAt) / 0.45);
    if (time - (this.throwAt ?? -9) < 0.5) return at('throw', (time - this.throwAt) / 0.5);
    // in a fight the legs strafe with the directional clips while the arms hold a guard
    const guard = def.type === 'melee' && p.combat ? (w === 'fists' && this.clips.fight_idle ? 'fight_idle' : two ? 'gs_idle' : 'm_idle') : null;
    if (p.stagger) {
      if (this.staggerAt === null) this.staggerAt = time;
      return at('m_stagger', Math.min(1, (time - this.staggerAt) / 0.7));
    }
    this.staggerAt = null;
    if (guard) return { name: guard, t: time % this.clips[guard].duration };
    return null;
  }

  /**
   * Blend tree: idle, plus walk / run / sprint in four directions weighted by the
   * smoothed local velocity, all kept in step. Melee weapons and fists use the axe-fighter set, launchers the
   * rifle set. Jumps, slides, dodges, reloads and heals play on top; swings, blocks and throws play on the upper body.
   */
  animate(p, dt, time, opts = {}) {
    const ghost = p.state === 'ghost';
    if (ghost !== this.isGhost) this.applyGhost(ghost);
    const w = ghost ? null : p.wpn;
    this.setWeapon(w, p.rarity);
    this.chute.visible = false;
    this.ghostMat.uniforms.time.value = time;
    if (ghost) {
      this.ghostMat.uniforms.opacity.value = opts.ghostOpacity ?? 1;
      this.ghostMat.uniforms.glow.value = 0.3 + Math.min(1, (p.flash || 0) / 1.6) * 1.2 + (p.burning ? 1.5 : 0);
    }
    // lean into turns and into speeding up / slowing down, pivoting at the feet
    const yawRate = this.prevYaw === undefined ? 0 : Math.atan2(Math.sin(p.yaw - this.prevYaw), Math.cos(p.yaw - this.prevYaw)) / Math.max(dt, 1e-3);
    this.prevYaw = p.yaw;
    const spd = Math.hypot(p.vx, p.vz);
    const acc = this.prevSpd === undefined ? 0 : (spd - this.prevSpd) / Math.max(dt, 1e-3);
    this.prevSpd = spd;
    const leaning = !ghost && p.onGround && !p.combat;
    const rollGoal = leaning ? Math.max(-0.2, Math.min(0.2, yawRate * spd * 0.022)) : 0;
    const fakeSlide = !ghost && p.slide && !this.clips.slide;
    const pitchGoal = fakeSlide ? 0.42 : leaning ? Math.max(-0.12, Math.min(0.12, -acc * 0.012 - spd * 0.008)) : 0;
    const lk = 1 - Math.exp(-dt * (p.slide ? 14 : 8));
    this.roll = (this.roll || 0) + (rollGoal - (this.roll || 0)) * lk;
    this.pitchLean = (this.pitchLean || 0) + (pitchGoal - (this.pitchLean || 0)) * lk;
    this.root.rotation.set(this.pitchLean, p.yaw, this.roll, 'YXZ');
    // landing: remember how fast we came down; the client reads 'landed' (m/s) for the thud, the splash and the camera
    this.landed = 0;
    if (!ghost && p.state === 'alive') {
      if (!p.onGround) this.fallV = Math.min(this.fallV || 0, p.vy);
      else if (this.wasAir) {
        this.landed = -(this.fallV || 0);
        // a real drop: the knees take it (a standing landing plays the clip; a running one dips the body)
        if (this.landed > 3) {
          this.landT = Math.min(0.45, 0.2 + this.landed * 0.018);
          this.landDip = Math.min(0.16, this.landed * 0.011);
        }
        this.fallV = 0;
      }
      this.wasAir = !p.onGround;
    } else this.wasAir = false;
    this.landT = Math.max(0, (this.landT || 0) - dt);
    this.landDip = (this.landDip || 0) * Math.exp(-dt * 9);
    this.model.position.y = this.baseY + (ghost ? 0.25 + Math.sin(time * 1.6 + p.id) * 0.12 : -this.landDip);
    this.recoil = Math.max(0, this.recoil - dt * 7);
    this.flinch = Math.max(0, this.flinch - dt * 5);
    const melee = !!w && (w === 'fists' || WEAPONS[w]?.type === 'melee');
    const ranged = !!w && !melee;

    // smoothed velocity in the character's own frame
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const k = 1 - Math.exp(-dt * 10);
    this.vf += (p.vx * fx + p.vz * fz - this.vf) * k;
    this.vs += (p.vx * -fz + p.vz * fx - this.vs) * k;
    const speed = ghost ? 0 : Math.hypot(this.vf, this.vs);
    const recentShot = time - (opts.lastShotAt ?? -9) < 1.2;

    // full-body overrides
    let over = null;
    let overSpeed = 1;
    if (!ghost) {
      // sitting on the tour bus (riders) or behind its wheel (the driver)
      if (opts.seat && this.clips[opts.seat]) over = opts.seat;
      else if (p.stagger && speed < 4 && this.clips[this.hitClip || 'm_stagger']) {
        over = this.hitClip || 'm_stagger';
        overSpeed = 1.4;
      } else if (p.dodge && this.clips[`dodge_${this.dodgeDir || 'backward'}`]) {
        over = `dodge_${this.dodgeDir || 'backward'}`;
        overSpeed = 2.6;
      } else if (p.slide) {
        over = this.clips.slide ? 'slide' : 'idle_crouching';
        // while still fast, linger in the low skid; once slow, get up
        const c = CUTS.slide;
        const t = this.clips.slide ? this.action('slide').time : 0;
        overSpeed = t > c[1] && t < c[2] && speed > 4.5 ? 0.45 : 1;
      } else if (!p.onGround) over = p.vy > 1 ? 'jump_up' : 'jump_loop';
      else if (this.landT > 0 && speed < 3.2 && this.clips.jump_down) {
        over = 'jump_down';
        overSpeed = 1.25;
      }
      else if (speed < 0.6 && p.using) over = 'drink';
      else if (speed < 0.6 && p.reloading) {
        over = 'reload';
        overSpeed = 1.4;
      }
    }
    if (over !== this.over) {
      if (this.over) this.fadingOver = this.over;
      this.over = over;
      if (over) {
        const a = this.action(over);
        a.reset();
        a.setLoop(THREE.LoopRepeat, Infinity);
        // the slide clip starts as the feet go out, not at the run-up
        if (over === 'jump_down') {
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
          a.time = CUTS.jump_down ? CUTS.jump_down[0] : 0;
        }
        if (over === 'slide') {
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
          a.time = CUTS.slide ? CUTS.slide[0] : 0;
        }
        a.play();
      }
    }
    this.overW += ((over ? 1 : 0) - this.overW) * Math.min(1, dt * (over?.startsWith('dodge') || over === 'slide' || over === 'idle_crouching' || over === 'jump_down' || this.over === 'jump_down' ? 22 : 9));

    // locomotion targets
    // out of combat the body faces where it runs: plain walk / run / sprint cycles
    const free = !ghost && !p.combat;
    const set = RIFLE_SET;
    const aimIdle = ranged && (p.aim || recentShot);
    const idleClip = free ? (this.clips.breath_idle ? 'breath_idle' : 'u_idle') : aimIdle ? 'idle_aiming' : 'idle';
    const move = Math.min(1, speed / 1.0);
    const n = speed > 0.01 ? speed : 1;
    const dirW = {
      forward: Math.max(0, this.vf / n),
      backward: Math.max(0, -this.vf / n),
      right: Math.max(0, this.vs / n),
      left: Math.max(0, -this.vs / n),
    };
    const sum = dirW.forward + dirW.backward + dirW.right + dirW.left || 1;
    for (const d in dirW) dirW[d] /= sum;
    const target = {};
    target[idleClip] = 1 - move;
    let natural;
    if (free) {
      const run = Math.min(1, Math.max(0, (speed - 2.2) / 2.2));
      const sprint = Math.min(1, Math.max(0, (speed - 5.4) / 1.4));
      target.u_walk = move * (1 - run);
      target.u_run = move * run * (1 - sprint);
      target.u_sprint = move * run * sprint;
      natural = 1.73 * (1 - run) + (5.76 * (1 - sprint) + 7.2 * sprint) * run;
    } else {
      const run = Math.min(1, Math.max(0, (speed - 3.4) / 1.8));
      const sprint = Math.min(1, Math.max(0, (speed - 6.3) / 1.3)) * dirW.forward;
      const add = (name, v) => {
        target[name] = (target[name] || 0) + v;
      };
      for (const d in dirW) {
        add(set.walk[d], move * (1 - run) * dirW[d]);
        add(set.run[d], move * run * dirW[d] * (d === 'forward' ? 1 - sprint / Math.max(dirW.forward, 1e-3) : 1));
      }
      add(set.sprint, move * run * sprint);
      natural = 1.5 * (1 - run) + (4.2 * (1 - sprint) + 6.4 * sprint) * run;
    }
    const rate = speed > 0.3 ? Math.max(0.6, Math.min(1.8, speed / natural)) : 1;

    // cycle phase shared by every moving clip so feet stay in step while blending
    let durSum = 0;
    let wSum = 0;
    for (const [name, wt] of Object.entries(target)) {
      if (name === idleClip || wt < 0.001 || !this.clips[name]) continue;
      durSum += this.clips[name].duration * wt;
      wSum += wt;
    }
    const cycle = wSum > 0 ? durSum / wSum : 1;
    const before = this.phase;
    this.phase = (this.phase + (dt * rate) / cycle) % 1;
    // a foot lands twice per cycle
    this.step = !ghost && !p.slide && p.onGround && speed > 0.8 && (this.phase < before || (before < 0.5 && this.phase >= 0.5));

    const names = new Set([...Object.keys(this.w), ...Object.keys(target)]);
    for (const name of names) {
      const goal = (target[name] || 0) * (1 - this.overW);
      const wt = (this.w[name] || 0) + (goal - (this.w[name] || 0)) * Math.min(1, dt * 10);
      this.w[name] = wt;
      const a = this.action(name);
      if (!a) continue;
      if (wt < 0.002) {
        if (a.isRunning()) a.stop();
        continue;
      }
      if (!a.isRunning()) a.play();
      a.setEffectiveWeight(wt);
      if (name.endsWith('idle') || name.startsWith('idle')) a.timeScale = 1;
      else {
        a.timeScale = 0;
        a.time = this.phase * a.getClip().duration;
      }
    }
    if (this.over) {
      const a = this.action(this.over);
      a.timeScale = overSpeed;
      a.setEffectiveWeight(this.overW);
    }
    if (this.fadingOver) {
      // an override that just ended fades out; one replaced by another stops at once
      const a = this.action(this.fadingOver);
      if (this.over || this.overW < 0.01) {
        a.stop();
        this.fadingOver = null;
      } else a.setEffectiveWeight(this.overW);
    }

    // upper-body layer: a heavy weight so it wins over the legs' clips for the spine and arms
    const up = ghost || this.over ? null : this.upperBody(p, time);
    const upName = up ? `${up.name}_up` : null;
    if (upName !== this.upName) {
      if (this.upName && !upName) this.upFade = this.upName;
      else if (this.upName) this.action(this.upName)?.stop();
      this.upName = upName;
      if (upName) {
        const a = this.action(upName);
        if (a) {
          a.reset();
          a.timeScale = 0;
          a.play();
          if (this.upFade === upName) this.upFade = null;
        }
      }
    }
    this.upW += ((upName ? 30 : 0) - this.upW) * Math.min(1, dt * 22);
    if (upName) {
      const a = this.action(upName);
      if (a) {
        a.time = Math.min(up.t, a.getClip().duration - 0.001);
        a.setEffectiveWeight(this.upW);
      }
    } else if (this.upFade) {
      const a = this.action(this.upFade);
      if (this.upW < 0.05) {
        a?.stop();
        this.upFade = null;
      } else a?.setEffectiveWeight(this.upW);
    }
    this.hitstop = Math.max(0, this.hitstop - dt);
    this.look.hit.value *= Math.exp(-dt * 16);
    this.mixer.update(this.hitstop > 0 ? 0 : dt);
    // the clips were made for a narrower body: at rest and on the move the arms stick out from the scanned
    // riders' sides, so bring them in to a natural hang (not while a swing, block or guard owns the arms)
    if (!ghost && p.state === 'alive' && !this.over && !upName) this.relaxArms(p.combat ? 0.5 : 1);

    // aim pitch bends the spine so a launcher follows the crosshair; hits kick it back
    if (!ghost && p.state === 'alive') {
      const bend = ranged ? Math.max(-0.9, Math.min(0.9, p.pitch)) / 3 : 0;
      for (const b of ['Spine', 'Spine1', 'Spine2']) {
        const bone = this.bones[b];
        if (bone) bone.rotateX(-bend - this.recoil * 0.05 + this.flinch * 0.12);
      }
      this.model.updateMatrixWorld(true);
      this.placeWeapon(p.yaw, p.pitch + this.recoil * 0.08);
      this.updateTrail(p, dt, melee && w !== 'fists' && !!p.atk && p.atk.u > 0.22 && p.atk.u < 0.85 && this.hitstop <= 0);
    }
    this.headLook(p, dt, ghost || p.state !== 'alive' || !!this.over || !!opts.seat ? null : opts.lookAt);
    // the wraith's eyes burn when it uses a power (and always for other ghosts)
    this.eyes.visible = ghost && (opts.eyes ?? true);
    if (this.eyes.visible && this.bones.Head) {
      const s = new THREE.Vector3();
      this.bones.Head.getWorldScale(s);
      this.eyes.scale.setScalar(1 / (s.x || 1));
    }
  }

  /**
   * Turn the head (and a little of the neck) toward a point: someone close by, or where the player is looking.
   * Eases in and out, and only within what a neck can do; behind the shoulder it gives up and faces front.
   */
  headLook(p, dt, at) {
    const { Neck, Head } = this.bones;
    if (!Head) return;
    let gy = 0;
    let gp = 0;
    if (at) {
      const dx = at.x - p.x;
      const dz = at.z - p.z;
      const rel = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - p.yaw), Math.cos(Math.atan2(-dx, -dz) - p.yaw));
      if (Math.abs(rel) < 2) {
        gy = Math.max(-1.05, Math.min(1.05, rel));
        gp = Math.max(-0.45, Math.min(0.35, Math.atan2(at.y - (p.y + 1.6), Math.hypot(dx, dz) || 1)));
      }
    }
    const k = 1 - Math.exp(-dt * 7);
    this.lookYaw = (this.lookYaw || 0) + (gy - (this.lookYaw || 0)) * k;
    this.lookPitch = (this.lookPitch || 0) + (gp - (this.lookPitch || 0)) * k;
    if (Math.abs(this.lookYaw) < 0.003 && Math.abs(this.lookPitch) < 0.003) return;
    // turn about the world's up and the body's right, shared between neck and head
    _lkRight.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    for (const [bone, share] of [[Neck, 0.4], [Head, 0.6]]) {
      if (!bone) continue;
      _lkQ.setFromAxisAngle(_lkUp, this.lookYaw * share);
      _lkP.setFromAxisAngle(_lkRight, this.lookPitch * share);
      _lkQ.multiply(_lkP);
      // world-space turn into the bone's parent space: local = parent^-1 * turn * parent * local
      bone.parent.getWorldQuaternion(_lkW);
      bone.quaternion.premultiply(_lkW).premultiply(_lkQ).premultiply(_lkW.invert());
      bone.updateMatrixWorld(true);
    }
  }

  /**
   * Swing each upper arm in toward the body until it hangs no more than ARM_HANG out from vertical (seen from the
   * front). w: how much of the correction to apply.
   */
  relaxArms(w) {
    const b = this.bones;
    if (!b.LeftArm || !b.RightArm || !b.LeftForeArm || !b.RightForeArm || !b.Hips) return;
    this.model.updateMatrixWorld(true);
    const right = _r.set(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(_rq1));
    right.y = 0;
    right.normalize();
    const fwd = _f.crossVectors(right, _up).normalize();
    b.Hips.getWorldPosition(_h);
    for (const [arm, fore] of [[b.LeftArm, b.LeftForeArm], [b.RightArm, b.RightForeArm]]) {
      arm.getWorldPosition(_a);
      fore.getWorldPosition(_d);
      _d.sub(_a).normalize();
      // which way is "away from the body" for this arm
      const s = Math.sign(_s.copy(_a).sub(_h).dot(right)) || 1;
      const side = _s.copy(right).multiplyScalar(s);
      const out = _d.dot(side);
      const down = -_d.y;
      const ang = Math.atan2(out, down);
      if (ang <= ARM_HANG) continue;
      const to = ang - (ang - ARM_HANG) * w;
      const r = Math.hypot(out, down);
      _t.copy(fwd).multiplyScalar(_d.dot(fwd)).addScaledVector(side, r * Math.sin(to)).addScaledVector(_up, -r * Math.cos(to)).normalize();
      // the world turn from where the arm points to where it should, applied in the arm's own space
      _rq2.setFromUnitVectors(_d, _t);
      arm.parent.getWorldQuaternion(_rq1);
      _rq3.copy(_rq1).invert().multiply(_rq2).multiply(_rq1);
      arm.quaternion.premultiply(_rq3);
      arm.updateMatrixWorld(true);
    }
  }

  /**
   * The swing trail: while a melee swing is in its fast part, sample the weapon's head and the middle of its
   * length each frame; the ribbon between them fades out over a few frames, brightest at the newest sample.
   */
  updateTrail(p, dt, on) {
    const T = (this.trail ??= makeTrail());
    if (!T.mesh.parent) this.root.add(T.mesh);
    for (const s of T.samples) s.age += dt;
    if (on && this.weapon && this.weaponLen > 0.3) {
      this.weapon.updateWorldMatrix(true, false);
      const L = this.weaponLen;
      T.samples.unshift({ tip: this.weapon.localToWorld(new THREE.Vector3(0, L, 0)), mid: this.weapon.localToWorld(new THREE.Vector3(0, L * 0.72, 0)), age: 0, heavy: !!p.atk?.heavy });
    }
    T.samples = T.samples.filter((s) => s.age < TRAIL_LIFE).slice(0, TRAIL_N);
    const n = T.samples.length;
    T.mesh.visible = n >= 2;
    if (n < 2) return;
    const pos = T.mesh.geometry.attributes.position;
    const col = T.mesh.geometry.attributes.color;
    this.root.updateWorldMatrix(true, false);
    const inv = _m2.copy(this.root.matrixWorld).invert();
    for (let i = 0; i < TRAIL_N; i++) {
      const sm = T.samples[Math.min(i, n - 1)];
      const a = _v6.copy(sm.tip).applyMatrix4(inv);
      const b = _v7.copy(sm.mid).applyMatrix4(inv);
      pos.setXYZ(i * 2, a.x, a.y, a.z);
      pos.setXYZ(i * 2 + 1, b.x, b.y, b.z);
      // fades with age and toward the old end; heavy swings burn a little brighter
      const fade = (1 - sm.age / TRAIL_LIFE) * (1 - i / n);
      const k = i < n ? fade * fade * (sm.heavy ? 0.32 : 0.22) : 0;
      col.setXYZ(i * 2, k, k * 0.9, k * 0.78);
      col.setXYZ(i * 2 + 1, 0, 0, 0);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  /** A quick upper-body jerk when hit. */
  hit() {
    this.flinch = 1;
    this.look.hit.value = 1;
  }

  /** World position of a launcher's mouth (where projectiles appear to leave). */
  muzzle(out) {
    if (!this.weapon) return out.set(0, 1.4, 0).applyMatrix4(this.root.matrixWorld);
    out.set(0, 0.05, -0.5);
    return this.weapon.localToWorld(out);
  }

  dispose() {
    this.mixer.stopAllAction();
  }
}

/** A body left behind where a survivor died (when nobody stole it). Plays a death animation, then sinks away. */
export class Corpse {
  /** look: { seed, wet, blood } of the rider who fell, so the body keeps their clothes, dirt and blood. */
  constructor(outfit, x, y, z, yaw, scene, look = null) {
    this.char = new Character(outfit, look?.seed);
    if (look) this.char.setLook(look.wet, Math.min(1, look.blood + 0.25));
    this.char.root.position.set(x, y, z);
    this.char.root.rotation.y = yaw;
    const deaths = ['death_from_the_front', 'death_from_the_back', 'death_from_front_headshot'];
    this.char.play(deaths[Math.floor(Math.random() * deaths.length)], 0, { once: true });
    this.t = 0;
    this.scene = scene;
    scene.add(this.char.root);
  }

  update(dt) {
    this.t += dt;
    this.char.mixer.update(dt);
    if (this.t > 9) this.char.root.position.y -= dt * 0.3;
    if (this.t > 13) {
      this.scene.remove(this.char.root);
      this.char.dispose();
      return false;
    }
    return true;
  }
}

// ------------------------------------------------------------------ name tags

export function nameTag(text, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '600 30px "Barlow Condensed", "Rubik", sans-serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  text = String(text).toUpperCase();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // a soft shadow rather than a hard outline
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.45, 0.36, 1);
  sprite.renderOrder = 10;
  return sprite;
}
