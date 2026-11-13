// The Midnight Wonderland Tours coach (LAZ 695 model by Alt, CC-BY) with working headlights: beams you can see in
// the mist, dust drifting through them, a body that rocks on the old road and a flickering cabin light.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ktx2 } from './ktx.js';
import { glow } from './textures.js';

const LENGTH = 10.8; // metres

/**
 * The bus as a box the trees are not drawn inside (src/trees.js gives their materials these planes, kept where the
 * bus is by Bus.update): the roadside crowns reach over the road, and a branch through the cabin showed in the
 * intro's shot up the aisle. A point is cut only when it is inside all six (clipIntersection). Until the bus is
 * placed every plane keeps everything.
 */
export const busClip = Array.from({ length: 6 }, () => new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e6));
/** The box in the body's own frame: [normal pointing out, distance out from the middle]. */
const CLIP_BOX = [[1, 0, 0, 1.4], [-1, 0, 0, 1.4], [0, 1, 0, 3.5], [0, -1, 0, 0.1], [0, 0, 1, LENGTH / 2 + 0.15], [0, 0, -1, LENGTH / 2 + 0.15]];
function placeClip(body, on) {
  for (let i = 0; i < 6; i++) {
    const [x, y, z, d] = CLIP_BOX[i];
    const p = busClip[i];
    if (!on) p.set(p.normal.set(0, 1, 0), 1e6);
    else p.set(p.normal.set(x, y, z), -d).applyMatrix4(body.matrixWorld);
  }
}
// the model's nose points along +z; the game's yaw 0 faces -z
const MODEL_YAW = Math.PI;
const BEAM = 22; // how far the visible beams reach (m)
/** Cabin floor height above the road (m). */
const FLOOR = 1.3;
/** Passenger seats [x, z] in the coach's own frame (front is -z): double seats down the left, a shorter run on the right. */
const SEATS = [];
for (const z of [-2.95, -2.05, -1.15, -0.25, 0.65, 1.55, 2.45, 3.35]) SEATS.push([-1.0, z], [-0.55, z]);
for (const z of [-1.75, -0.85, 0.05, 0.95]) SEATS.push([1.0, z], [0.55, z]);
/** The driver's seat, front left behind the wheel. */
const DRIVER = [-0.72, -4.15];
const MOTES = 260;

/** A soft cone of light in the air: bright near the lamp, fading with distance and toward its edges. */
function beamMesh(x) {
  const geo = new THREE.CylinderGeometry(0.18, 3.6, BEAM, 28, 1, true);
  geo.translate(0, -BEAM / 2, 0);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color('#ffe9c4') }, strength: { value: 0.16 }, time: { value: 0 } },
    vertexShader: `
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        vAlong = clamp(-position.z / ${BEAM.toFixed(1)}, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color; uniform float strength; uniform float time;
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        // seen side-on the cone is thin at its rim and full through its middle
        float face = pow(abs(dot(vN, vV)), 1.6);
        float fade = pow(1.0 - vAlong, 1.7) * smoothstep(0.0, 0.05, vAlong);
        // mist drifting through the beam
        float mist = 0.8 + 0.2 * sin(vAlong * 23.0 - time * 1.3) * sin(vAlong * 9.0 + time * 0.7);
        gl_FragColor = vec4(color * face * fade * mist * strength, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, 1.0, -LENGTH / 2 - 0.15);
  m.rotation.x = -0.05; // dipped toward the road
  m.renderOrder = 2;
  m.frustumCulled = false;
  return m;
}

let busModel = null;
/** Load the bus model once. The loading screen waits on this, so the intro never shows riders without their bus. */
export function preloadBus() {
  return (busModel ||= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2()).loadAsync('./models/bus.glb').then((g) => {
    // The model's windows are refracting glass (transmission). Any transmissive material in view makes three.js
    // draw every solid thing in the scene a second time, every frame, to see through it: the bus is nearly always
    // on screen, so that doubled the park's draw calls. Plain see-through glass looks the same at night.
    g.scene.traverse((o) => {
      const mats = !o.material ? [] : Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!(m.transmission > 0)) continue;
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.32;
        m.depthWrite = false;
        m.roughness = Math.min(m.roughness ?? 0.1, 0.12);
        m.metalness = 0;
      }
    });
    return g;
  }));
}

export class Bus {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    // the body rocks on its springs; lights and beams ride with it
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.lights = [];
    // headlights: one wide beam (every light costs frame time) and two glowing lenses
    const spot = new THREE.SpotLight('#fff1d0', 110, 45, 0.6, 0.6, 1.2);
    spot.position.set(0, 1.0, -LENGTH / 2);
    spot.target.position.set(0, 0, -LENGTH / 2 - 20);
    this.body.add(spot, spot.target);
    this.lights.push(spot);
    this.beams = [];
    for (const side of [-0.8, 0.8]) {
      const lens = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: '#fff3d8', blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      lens.position.set(side, 1.0, -LENGTH / 2 - 0.1);
      lens.scale.setScalar(1.3);
      this.body.add(lens);
      const beam = beamMesh(side);
      this.body.add(beam);
      this.beams.push(beam);
    }
    // tail lights
    for (const side of [-1.05, 1.05]) {
      const tail = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: '#ff2a1a', blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      tail.position.set(side, 1.05, LENGTH / 2 + 0.05);
      tail.scale.setScalar(0.7);
      this.body.add(tail);
    }
    // a tired fluorescent tube over the aisle (off once the tour is over)
    this.cabin = new THREE.PointLight('#ffd6a0', 0, 9, 1.4);
    this.cabin.position.set(0, 2.95, -0.8); // just under the roof, over the aisle
    this.body.add(this.cabin);
    // dust hanging in the air, lit where the beams cross it
    const pos = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) this.respawnMote(pos, i, Math.random());
    const dust = new THREE.BufferGeometry();
    dust.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dust, new THREE.PointsMaterial({
      map: glow(), color: '#fff0d0', size: 0.06, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.dust.frustumCulled = false;
    this.body.add(this.dust);
    this.time = 0;
    preloadBus().then((g) => {
      const m = g.scene;
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      const k = LENGTH / Math.max(size.x, size.z);
      m.scale.setScalar(k);
      m.rotation.y = MODEL_YAW;
      const c = box.getCenter(new THREE.Vector3());
      // turned half round, so the centre offset flips sign on x and z
      m.position.set(c.x * k, -box.min.y * k, c.z * k);
      m.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          // grime it up a little: it is an old coach that drives at night
          mat.roughness = Math.max(mat.roughness ?? 0.6, 0.55);
          if (/glass/i.test(mat.name)) {
            mat.transparent = true;
            mat.opacity = 0.55;
            mat.color?.multiplyScalar(0.5);
          }
        }
      });
      this.body.add(m);
    });
  }

  /** Put mote i somewhere in the air ahead of the bus (depth u: 0 at the lamps, 1 at the far end of the beams). */
  respawnMote(pos, i, u) {
    const spread = 0.4 + u * 3.2;
    pos[i * 3] = (Math.random() * 2 - 1) * spread;
    pos[i * 3 + 1] = 0.2 + Math.random() * (0.8 + u * 1.8);
    pos[i * 3 + 2] = -LENGTH / 2 - 0.5 - u * BEAM;
  }

  /** World position of passenger seat i (null when there are not enough seats). */
  seat(i, out = new THREE.Vector3()) {
    const s = SEATS[i];
    if (!s) return null;
    return this.body.localToWorld(out.set(s[0], FLOOR, s[1]));
  }

  /** World position of the driver's seat. */
  driverSeat(out = new THREE.Vector3()) {
    return this.body.localToWorld(out.set(DRIVER[0], FLOOR, DRIVER[1]));
  }

  /** How bright the cabin light is (0..1), set once the camera has chosen its shot (the intro's aisle shot turns it on). */
  cabinLight(level) {
    this.cabin.intensity = level * 3.2 * (this.flick ?? 1);
  }

  update(bus, visible, dt = 0) {
    this.root.visible = visible;
    this.root.position.set(bus.x, 0.05, bus.z);
    this.root.rotation.y = bus.yaw;
    if (!visible) {
      placeClip(this.body, false);
      return;
    }
    this.time += dt;
    const t = this.time;
    const moving = Math.min(1, (bus.v || 0) / 6);
    // springs: a slow wallow, a quicker shudder from the potholes, the engine idling underneath
    this.body.rotation.z = (Math.sin(t * 1.3) * 0.011 + Math.sin(t * 3.7 + 1) * 0.004) * moving + Math.sin(t * 31) * 0.0008;
    this.body.rotation.x = (Math.sin(t * 0.9 + 2) * 0.006 + Math.sin(t * 5.3) * 0.002) * moving;
    this.body.position.y = (Math.abs(Math.sin(t * 6.1)) * 0.012 + Math.max(0, Math.sin(t * 1.7)) * 0.01) * moving;
    this.root.updateMatrixWorld(true);
    placeClip(this.body, true);
    for (const b of this.beams) b.material.uniforms.time.value = t;
    // a failing tube: mostly on, now and then it sags (not out: in the intro the riders went black and seemed to vanish)
    this.flick = Math.sin(t * 13) * Math.sin(t * 7.3) > 0.88 ? 0.6 : 1;
    // the bus drives through still air, so the dust streams back past the lamps
    const pos = this.dust.geometry.attributes.position;
    const a = pos.array;
    const v = bus.v || 0;
    for (let i = 0; i < MOTES; i++) {
      a[i * 3 + 2] += v * dt;
      a[i * 3 + 1] += Math.sin(t * 0.7 + i) * 0.03 * dt;
      if (a[i * 3 + 2] > -LENGTH / 2 - 0.3) this.respawnMote(a, i, 0.9 + Math.random() * 0.1);
    }
    pos.needsUpdate = true;
  }
}
