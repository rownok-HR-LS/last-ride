// The wraith's cloak: a dead rider's ghost wears a tattered hooded robe (scripts/blender/build-cloak.py) over its
// black smoke body: a robe fraying into rags below the waist, a hood and cape, ragged forearm sleeves. Each piece
// plays its baked cloth flutter (src/motion.js) and is placed every frame from the skeleton's joints (works for
// every rig: no bone axes involved): the robe hangs from the hips, the hood sits on the head, the sleeves run down
// the forearms. Ash grey cloth, faintly the colour of what the rider wore, glowing red inside and along its edges;
// as faint as the ghost itself to survivors (opacity), brighter when it uses a power (glow).
import * as THREE from 'three';
import { loadMotion, motionGeometry, motionMaterial } from './motion.js';

const PARTS = ['robe_skirt', 'robe_hood', 'robe_sleeve'];
const shapes = {};
let loading = null;

/** Load the cloak's pieces (once). Ghosts appearing before then go without. */
export function loadCloak() {
  loading ??= Promise.all(PARTS.map((n) => loadMotion(n).then((m) => {
    shapes[n] = { m, geo: motionGeometry(m) };
  }))).catch((e) => console.warn('cloak', e));
  return loading;
}
export const cloakReady = () => PARTS.every((n) => shapes[n]);

const VERT = `
  #include <common>
  varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vW;
  void main() {
    #include <begin_vertex>
    vec4 wp = modelMatrix * vec4(transformed, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    vW = wp.xyz;
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const FRAG = `
  uniform float opacity; uniform float glow; uniform vec3 tint; uniform float seed;
  varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vW;
  float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float n3(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    // rotten cloth: moth-eaten holes, more of them toward the hem (v runs 1 at the top to 0 at the bottom)
    vec3 q = vec3(vUv * vec2(22.0, 13.0), seed);
    float n = n3(q) * 0.6 + n3(q * 2.3 + 4.0) * 0.4;
    if (n > 0.74 - (1.0 - vUv.y) * 0.16) discard;
    float edge = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
    // ash grey, faintly the colour of what they wore, dirtier toward the hem
    vec3 ash = mix(vec3(0.34, 0.32, 0.30), tint, 0.3) * (0.6 + 0.5 * n) * mix(0.45, 1.0, vUv.y);
    // the red burns along the edges and fills the inside; a little always, more when it uses a power
    vec3 red = vec3(0.85, 0.09, 0.04) * (0.55 + glow);
    vec3 col = gl_FrontFacing ? ash * 0.8 + red * (edge * 2.0 + 0.05) : red * (0.6 + 0.6 * n);
    // the hem frays into the mist
    float a = (gl_FrontFacing ? 0.9 : 0.8) * opacity * smoothstep(0.02, 0.3, vUv.y + n * 0.25);
    gl_FragColor = vec4(col, a);
  }`;

/** One ghost's cloak; a child of its character's root, so it follows it and hides with it. */
export class Cloak {
  constructor(char, tint = '#555049') {
    this.char = char;
    this.group = new THREE.Group();
    this.group.name = 'cloak';
    this.uniforms = { opacity: { value: 1 }, glow: { value: 0.4 }, tint: { value: new THREE.Color(tint) }, seed: { value: Math.random() * 50 } };
    const phase = Math.random();
    const make = (name) => {
      const { m, geo } = shapes[name];
      const mat = motionMaterial(new THREE.ShaderMaterial({
        // (its own uniforms list: the motion adds its texture to it; the look values are shared)
        uniforms: { ...this.uniforms }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }), m, undefined, { phase, ampFloor: 0.75 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    this.skirt = make('robe_skirt');
    this.hood = make('robe_hood');
    this.sleeves = [make('robe_sleeve'), make('robe_sleeve')];
    this.group.visible = false;
    char.root.add(this.group);
  }

  /** Place the pieces from the joints (call after the skeleton is posed). */
  update(on, opacity, glow) {
    this.group.visible = on;
    if (!on) return;
    this.uniforms.opacity.value = opacity;
    this.uniforms.glow.value = glow;
    const b = this.char.bones;
    const root = this.char.root;
    root.updateMatrixWorld(true);
    const at = (bone, v) => root.worldToLocal(bone.getWorldPosition(v));
    if (b.Hips) {
      at(b.Hips, this.skirt.position);
      this.skirt.position.y += 0.06;
      // a little sway with the body's lean
      this.skirt.quaternion.identity();
    }
    if (b.Head) {
      at(b.Head, this.hood.position);
      this.hood.position.y += 0.06;
      this.hood.quaternion.setFromAxisAngle(_up, this.char.lookYaw || 0);
    }
    [['Left', this.sleeves[0]], ['Right', this.sleeves[1]]].forEach(([side, s]) => {
      const fore = b[`${side}ForeArm`];
      const hand = b[`${side}Hand`];
      if (!fore || !hand) {
        s.visible = false;
        return;
      }
      at(fore, s.position);
      at(hand, _v).sub(s.position).normalize();
      s.quaternion.setFromUnitVectors(_down, _v);
    });
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const m of this.group.children) m.material.dispose();
  }
}

const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3();
