// Pre-recorded storm motion (scripts/blender/bake-motion.py): Blender simulated the cloth once in a gusting wind;
// the game plays it back in the vertex shader. Each piece is a texture of per-vertex offsets (row 0: the settled
// shape, always on; rows 1..frames: the flutter, scaled by the night's wind) and a .json with the rest shape.
// Pieces: the bunting pennants round the game tents, and the police tape's runs between its stakes.
//
// The night sets windAmp (0 still .. 1 a storm, a little over in a thunderstorm), which also speeds the playback and
// sways the plants harder (src/wind.js); the Ferris wheel's gondolas rock with it (src/rides.js).
import * as THREE from 'three';

/** Seconds of playback: the client advances it faster in a stronger wind. */
export const motionTime = { value: 0 };
/** How hard the wind blows tonight (eased toward each night's value by the client). */
export const windAmp = { value: 0.6 };
/** Wind per night (shared/constants.js NIGHTS). */
export const NIGHT_WIND = { storm: 1, thunder: 1.25, drizzle: 0.6, fog: 0.18, moon: 0.3 };

const cache = new Map();

/** The piece's rest shape and its motion texture. */
export function loadMotion(name) {
  if (!cache.has(name)) {
    cache.set(name, Promise.all([
      fetch(`./models/motion/${name}.json`).then((r) => r.json()),
      new THREE.TextureLoader().loadAsync(`./models/motion/${name}.png`),
    ]).then(([info, tex]) => {
      tex.colorSpace = THREE.NoColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      info.tex = tex;
      info.count = info.verts.length / 3;
      return info;
    }));
  }
  return cache.get(name);
}

/**
 * Make mat play back motion m. Geometry using it carries a 'motionId' attribute: 0 for vertices that keep still,
 * otherwise 1 + the vertex's column in the motion. toLocal turns the motion's offsets (model space) into the
 * geometry's own space (for models whose positions were packed with a scale).
 */
export function motionMaterial(mat, m, toLocal = new THREE.Matrix3()) {
  // (it moves, so it keeps casting its own shadow: src/shadowproxy.js)
  mat.userData.moves = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, renderer) => {
    prev?.call(mat, sh, renderer);
    Object.assign(sh.uniforms, {
      motionTex: { value: m.tex },
      motionInfo: { value: new THREE.Vector4(m.count, m.frames + 1, m.frames, m.range) },
      motionFps: { value: m.fps },
      motionToLocal: { value: toLocal },
      motionTime,
      windAmp,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float motionId;
        uniform sampler2D motionTex;
        uniform vec4 motionInfo; // columns, rows, frames, range
        uniform float motionFps, motionTime, windAmp;
        uniform mat3 motionToLocal;
        vec3 motionAt(float u, float row) {
          return texture2D(motionTex, vec2(u, (row + 0.5) / motionInfo.y)).rgb * 2.0 - 1.0;
        }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (motionId > 0.5) {
          float u = (motionId - 0.5) / motionInfo.x;
          vec3 wp = position;
          float ph = 0.0;
          #ifdef USE_INSTANCING
            wp = (instanceMatrix * vec4(position, 1.0)).xyz;
            // each copy starts somewhere else in the loop, so neighbours don't flap in step
            ph = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453) * motionInfo.z;
          #endif
          float f = mod(motionTime * motionFps + ph, motionInfo.z);
          float f0 = floor(f);
          vec3 flutter = mix(motionAt(u, 1.0 + f0), motionAt(u, 1.0 + mod(f0 + 1.0, motionInfo.z)), f - f0);
          // gusts roll across the park, as in the plants' sway
          float gust = 0.6 + 0.4 * sin(motionTime * 0.35 + wp.x * 0.015 + wp.z * 0.01);
          float k = windAmp * gust;
          // the settled shape leans with the wind too: limp on a still night, blown out in a storm
          vec3 off = (motionAt(u, 0.0) * min(1.0, 0.35 + k) + flutter * k) * motionInfo.w;
          transformed += motionToLocal * off;
        }`);
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${key ? key() : ''}|motion:${m.name}`;
  return mat;
}

/** A geometry of the piece's own rest shape (for pieces the game draws itself, like the pennants). */
export function motionGeometry(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.verts, 3));
  g.setAttribute('motionId', new THREE.Float32BufferAttribute(Array.from({ length: m.count }, (_, i) => i + 1), 1));
  g.setIndex(m.tris);
  g.computeVertexNormals();
  return g;
}

/**
 * Tie an existing model's vertices to motion m: each vertex within 1.5 cm of one of the motion's rest vertices
 * moves with it (toModel takes the geometry's positions into the motion's space); the rest keep still.
 */
export function attachMotion(geo, m, toModel) {
  const p = geo.attributes.position;
  const ids = new Float32Array(p.count);
  const v = new THREE.Vector3();
  let tied = 0;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(toModel);
    let best = 0.015 * 0.015;
    let id = 0;
    for (let j = 0; j < m.count; j++) {
      const dx = v.x - m.verts[j * 3];
      const dy = v.y - m.verts[j * 3 + 1];
      const dz = v.z - m.verts[j * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) {
        best = d;
        id = j + 1;
      }
    }
    ids[i] = id;
    if (id) tied++;
  }
  geo.setAttribute('motionId', new THREE.BufferAttribute(ids, 1));
  return tied;
}

const BALLOONS = ['#e2384f', '#2f9be0', '#f2b632', '#8e44d6', '#2fbf87', '#f0702c'];

/**
 * The bunting round each game tent's eave (where scripts/blender/build-kit.py used to hang it still): twelve loops
 * of five pennants, sagging between the guy-rope points, every pennant flapping on its own.
 */
export async function bunting(tents) {
  if (!tents.length) return null;
  const m = await loadMotion('pennant');
  const geo = motionGeometry(m);
  const mat = motionMaterial(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), m);
  const loops = 12;
  const per = 5;
  const n = tents.length * loops * per;
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = 'bunting';
  const tent = new THREE.Object3D();
  const flag = new THREE.Object3D();
  const col = new THREE.Color();
  let k = 0;
  for (const p of tents) {
    tent.position.set(p.x, 0, p.z);
    tent.rotation.set(0, (p.x + p.z) % 6.28, 0);
    tent.updateMatrix();
    for (let i = 0; i < loops; i++) {
      const a0 = (i * 2 * Math.PI) / loops;
      for (let j = 0; j < per; j++) {
        const t = (j + 0.5) / per;
        const a = a0 + (t * 2 * Math.PI) / loops;
        const r = 3.95 + 0.08;
        flag.position.set(Math.cos(a) * r, 2.3 - Math.sin(t * Math.PI) * 0.35, Math.sin(a) * r);
        // the pennant's top edge runs along the eave
        flag.rotation.set(0, -(a + Math.PI / 2), 0);
        flag.updateMatrix();
        mesh.setMatrixAt(k, flag.matrix.premultiply(tent.matrix));
        mesh.setColorAt(k, col.set(BALLOONS[(i * per + j) % BALLOONS.length]).multiplyScalar(0.8));
        k++;
      }
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  mesh.userData.moves = true;
  return mesh;
}
