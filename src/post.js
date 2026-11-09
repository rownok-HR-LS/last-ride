// Post-processing: ambient occlusion (N8AO) so things sit in their corners and on the ground, bloom for the neon,
// then a grading pass for ghost vision, blackouts and damage, plus depth of field and a film look for the opening
// cinematic.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { N8AOPass } from 'n8ao';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { lampGlow } from './lamplight.js';
import { ssr } from './ssr.js';

/** Reflections in the wet ground on or off (the quality setting can turn them off). */
export const SSR = { on: true };

/** How strongly the lamps glow in the fog (scaled by tonight's fog thickness). Tuned by eye. */
export const GLOW = { value: 0.35 };

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    texel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    near: { value: 0.1 },
    far: { value: 1000 },
    focus: { value: 10 }, // metres
    aperture: { value: 0 }, // 0 = everything sharp
    cine: { value: 0 }, // film look for cutscenes
    ghost: { value: 0 },
    dark: { value: 0 },
    hurt: { value: 0 },
    storm: { value: 0 },
    time: { value: 0 },
    // camera motion blur: where each pixel was last frame (0 strength = off)
    blur: { value: 0 },
    invViewProj: { value: new THREE.Matrix4() },
    prevViewProj: { value: new THREE.Matrix4() },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    #include <packing>
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 texel; uniform float near; uniform float far;
    uniform float focus; uniform float aperture; uniform float cine;
    uniform float ghost; uniform float dark; uniform float hurt; uniform float storm; uniform float time;
    uniform float blur; uniform mat4 invViewProj; uniform mat4 prevViewProj;
    varying vec2 vUv;

    float viewDepth(vec2 uv) {
      return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far);
    }
    // the image averaged over a small box (four taps)
    vec3 soft(vec2 p, vec2 t) {
      return (texture2D(tDiffuse, p + t).rgb + texture2D(tDiffuse, p - t).rgb
        + texture2D(tDiffuse, p + vec2(t.x, -t.y)).rgb + texture2D(tDiffuse, p + vec2(-t.x, t.y)).rgb) * 0.25;
    }
    // blur radius in pixels for something at depth d (a thin-lens circle of confusion)
    float coc(float d) {
      return clamp(abs(d - focus) / max(d, 0.1) * aperture * 14.0, 0.0, 14.0);
    }

    void main(){
      vec2 uv = vUv;
      // ghost vision wobbles a little
      uv += ghost * 0.0025 * vec2(sin(uv.y*30.0 + time*2.0), cos(uv.x*25.0 + time*1.7));
      vec4 c = texture2D(tDiffuse, uv);
      if (blur > 0.0) {
        // camera motion blur: find where this pixel's point was on screen last frame and smear along the way
        float zd = texture2D(tDepth, uv).x;
        vec4 wp = invViewProj * vec4(uv * 2.0 - 1.0, zd * 2.0 - 1.0, 1.0);
        wp /= wp.w;
        vec4 pp = prevViewProj * wp;
        vec2 prevUv = pp.xy / pp.w * 0.5 + 0.5;
        vec2 vel = (uv - prevUv) * blur;
        float vl = length(vel);
        // the faster the turn the stronger, capped; tiny motions stay sharp
        vel *= min(vl, 0.035) / max(vl, 1e-5) * smoothstep(0.0015, 0.006, vl);
        if (dot(vel, vel) > 0.0) {
          vec3 acc = c.rgb;
          for (int i = 1; i < 7; i++) acc += texture2D(tDiffuse, uv - vel * (float(i) / 6.0 - 0.5)).rgb;
          c.rgb = acc / 7.0;
        }
      }
      if (aperture > 0.0) {
        // depth of field: gather a disc of samples, each weighted by its own blur so sharp things don't bleed
        float r = coc(viewDepth(uv));
        if (r > 0.5) {
          vec3 acc = c.rgb;
          float wsum = 1.0;
          for (int i = 1; i < 24; i++) {
            float fi = float(i);
            float a = fi * 2.39996;
            vec2 o = vec2(cos(a), sin(a)) * sqrt(fi / 23.0) * r * texel;
            float w = smoothstep(0.0, 1.0, coc(viewDepth(uv + o)) / r + 0.2);
            acc += texture2D(tDiffuse, uv + o).rgb * w;
            wsum += w;
          }
          c.rgb = acc / wsum;
        }
      }
      float v = distance(vUv, vec2(0.5));
      if (cine > 0.0) {
        // lens: colour fringing that grows toward the frame edges. It's taken from a softened image, so fine texture
        // (gravel, leaves) doesn't split into pink and green specks; only big edges pick up a fringe.
        vec2 dir = (vUv - 0.5) * cine * 0.004 * smoothstep(0.2, 0.7, v);
        vec2 t2 = texel * 1.5;
        vec3 here = soft(uv, t2);
        c.r = max(0.0, c.r + soft(uv + dir, t2).r - here.r);
        c.b = max(0.0, c.b + soft(uv - dir, t2).b - here.b);
      }
      float l = dot(c.rgb, vec3(0.299,0.587,0.114));
      vec3 g = vec3(l*0.55, l*1.05, l*0.95) + vec3(0.0,0.03,0.04);
      c.rgb = mix(c.rgb, g, ghost * 0.75);
      // blackout: crushing darkness with a small circle of sight
      c.rgb *= mix(1.0, 0.12 + 0.6*smoothstep(0.45, 0.05, v), dark);
      c.rgb = mix(c.rgb, vec3(0.5,0.1,0.6), storm * 0.25);
      c.rgb = mix(c.rgb, vec3(0.7,0.0,0.05), hurt * smoothstep(0.25, 0.75, v) * 0.8);
      // horror grade: drained colour, cold shadows, crushed vignette, film grain
      float lum = dot(c.rgb, vec3(0.299,0.587,0.114));
      c.rgb = mix(c.rgb, vec3(lum), 0.15 * (1.0 - ghost));
      // contrast, cold shadows and grain in display space (in linear light they crush the night to pure black)
      vec3 d = pow(max(c.rgb, 0.0), vec3(1.0 / 2.2));
      d += vec3(-0.012, 0.0, 0.02) * (1.0 - smoothstep(0.0, 0.35, lum));
      // film: teal shadows, warm highlights, a little more contrast
      d += cine * (vec3(-0.02, 0.005, 0.025) * (1.0 - smoothstep(0.0, 0.4, lum)) + vec3(0.03, 0.012, -0.02) * smoothstep(0.35, 0.9, lum));
      d = (d - 0.5) * (1.1 + cine * 0.05) + 0.5;
      d *= 1.0 - smoothstep(0.6 - cine * 0.15, 1.0, v) * (0.22 + cine * 0.2);
      float n = fract(sin(dot(vUv * (time + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
      d += (n - 0.5) * (0.014 + cine * 0.03);
      c.rgb = pow(max(d, 0.0), vec3(2.2));
      gl_FragColor = c;
    }`,
};

/**
 * Light from the street lamps scattering in the damp night air: a halo round each head and a glow that hangs in the
 * fog between them, even against the sky. For each pixel the view ray's single scattering from the eight nearest
 * working lamps is summed in closed form (the integral of 1/d^2 along a line is an arctangent), so no ray marching.
 */
const GlowShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    invViewProj: { value: new THREE.Matrix4() },
    camPos: { value: new THREE.Vector3() },
    lamps: { value: lampGlow.lamps },
    amount: { value: 0 },
    tint: { value: new THREE.Color('#ff9a4a') },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform mat4 invViewProj; uniform vec3 camPos;
    uniform vec4 lamps[8]; uniform float amount; uniform vec3 tint;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (amount > 0.0) {
        float zd = texture2D(tDepth, vUv).x;
        vec4 wp = invViewProj * vec4(vUv * 2.0 - 1.0, zd * 2.0 - 1.0, 1.0);
        wp /= wp.w;
        vec3 ray = wp.xyz - camPos;
        float t = length(ray);
        vec3 dir = ray / max(t, 1e-4);
        // the sky: the air goes on a long way
        if (zd > 0.99999) t = 220.0;
        float s = 0.0;
        for (int i = 0; i < 8; i++) {
          vec4 L = lamps[i];
          if (L.w <= 0.0) continue;
          vec3 o = L.xyz - camPos;
          float b = dot(o, dir);
          float h = sqrt(max(dot(o, o) - b * b, 0.0144));
          // light that travels far through fog is mostly lost on the way: each lamp keeps a halo, the dark between stays
          s += L.w * (atan((t - b) / h) - atan(-b / h)) / h * exp(-0.16 * h);
        }
        c.rgb += tint * s * amount;
      }
      gl_FragColor = c;
    }`,
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  // renders the scene and darkens creases, corners and contact with the ground (half resolution, denoised)
  const ao = new N8AOPass(scene, camera, size.x, size.y);
  Object.assign(ao.configuration, {
    aoRadius: 2.2, distanceFalloff: 1.2, intensity: 2.6, aoSamples: 8, denoiseSamples: 4, denoiseRadius: 10, halfRes: true, gammaCorrection: false,
  });
  ao.autosetGamma = false;
  // its transparency mode re-renders the whole scene twice more each frame; mist, glow and glass do fine without it
  ao.autoDetectTransparency = false;
  ao.configuration.transparencyAware = false;
  composer.addPass(ao);
  // keep a half-size copy of this frame (light, and distance from the camera in alpha) for the ground's reflections
  // next frame (ssr.js); it leaves the image itself alone
  const keep = new THREE.WebGLRenderTarget(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1), {
    type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  const keepQuad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tColor: { value: null }, tDepth: { value: null }, near: { value: camera.near }, far: { value: camera.far } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `#include <packing>
      uniform sampler2D tColor; uniform sampler2D tDepth; uniform float near; uniform float far; varying vec2 vUv;
      void main() {
        float zd = texture2D(tDepth, vUv).x;
        float z = zd > 0.99999 ? 1e5 : -perspectiveDepthToViewZ(zd, near, far);
        gl_FragColor = vec4(texture2D(tColor, vUv).rgb, z);
      }`,
    depthTest: false,
    depthWrite: false,
  }));
  class KeepPass extends Pass {
    constructor() {
      super();
      this.needsSwap = false;
    }
    render(r, writeBuffer, readBuffer) {
      const u = keepQuad.material.uniforms;
      u.tColor.value = readBuffer.texture;
      u.tDepth.value = ao.beautyRenderTarget.depthTexture;
      u.near.value = camera.near;
      u.far.value = camera.far;
      const was = r.getRenderTarget();
      r.setRenderTarget(keep);
      keepQuad.render(r);
      r.setRenderTarget(was);
      camera.updateMatrixWorld();
      ssr.view.value.copy(camera.matrixWorldInverse);
      ssr.proj.value.copy(camera.projectionMatrix);
      ssr.tex.value = keep.texture;
      ssr.on.value = SSR.on ? 1 : 0;
    }
  }
  const glow = new ShaderPass(GlowShader);
  const glowVP = new THREE.Matrix4();
  const baseRender = glow.render.bind(glow);
  glow.render = (...args) => {
    // how much the air scatters goes with how thick tonight's fog is (scene.fog is a FogExp2)
    const fogK = scene.fog ? scene.fog.density / 0.0068 : 0;
    glow.uniforms.amount.value = GLOW.value * fogK;
    camera.updateMatrixWorld();
    glow.uniforms.invViewProj.value.copy(glowVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)).invert();
    glow.uniforms.camPos.value.setFromMatrixPosition(camera.matrixWorld);
    baseRender(...args);
  };
  glow.uniforms.tDepth.value = ao.beautyRenderTarget.depthTexture;
  composer.addPass(glow);
  // (after the glow, so the halos and light cones are in the copy the puddles mirror)
  composer.addPass(new KeepPass());
  const bloom =new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.42, 0.5, 0.86);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  grade.uniforms.near.value = camera.near;
  grade.uniforms.far.value = camera.far;
  // depth of field reads the scene depth the AO pass rendered
  grade.uniforms.tDepth.value = ao.beautyRenderTarget.depthTexture;
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  // smooth edges: rendering through the composer loses the canvas's own anti-aliasing
  const smaa = new SMAAPass(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio());
  composer.addPass(smaa);
  const texel = () => {
    const t = composer.renderTarget1;
    grade.uniforms.texel.value.set(1 / t.width, 1 / t.height);
    // the AO pass swaps its targets when resized
    grade.uniforms.tDepth.value = ao.beautyRenderTarget.depthTexture;
    glow.uniforms.tDepth.value = ao.beautyRenderTarget.depthTexture;
  };
  texel();
  return {
    composer,
    ao,
    // the lamps' glow in the fog reads depth from the AO pass: switch them together
    glow,
    smaa,
    grade: grade.uniforms,
    setPixelRatio(r) {
      composer.setPixelRatio(r);
      const sz = renderer.getSize(new THREE.Vector2());
      keep.setSize(Math.max(1, (sz.x * r) >> 1), Math.max(1, (sz.y * r) >> 1));
      texel();
    },
    setSize(w, h) {
      composer.setSize(w, h);
      keep.setSize(Math.max(1, (w * renderer.getPixelRatio()) >> 1), Math.max(1, (h * renderer.getPixelRatio()) >> 1));
      bloom.resolution.set(w / 2, h / 2);
      texel();
    },
    /** Depth of field: sharp at focus metres, blurrier the bigger aperture is (0 turns it off). */
    setDof(focus, aperture) {
      grade.uniforms.focus.value = focus;
      grade.uniforms.aperture.value = aperture;
    },
  };
}
