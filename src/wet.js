// Rain on everything: scenery soaks while it pours, a little darker and much glossier, tops more than sides, the
// undersides of roofs hardly at all. The client sets sceneWet to how hard it is raining (0..1) every frame.
//
// The same pass grounds everything in the park's baked occlusion (public/tex/ground_ao.webp, baked in Blender):
// the foot of a wall, a booth or a crate darkens where the ground beside it is shaded, fading out over the first
// metre or two, so nothing looks pasted onto the ground. world.js hands the texture over once it has loaded.

import { addLampLight } from './lamplight.js';

export const sceneWet = { value: 0 };
/** The ground's baked occlusion (texture) and whether it is in yet (0 / 1). */
export const groundAO = { map: { value: null }, on: { value: 0 } };

/** Let a standard material get wet in the rain (once per material). */
export function wetten(mat) {
  if (!mat?.isMeshStandardMaterial || mat.userData.wet) return mat;
  mat.userData.wet = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, renderer) => {
    prev?.call(mat, sh, renderer);
    // and lit by the street lamps (baked in Blender)
    addLampLight(sh);
    sh.uniforms.sceneWet = sceneWet;
    sh.uniforms.groundAO = groundAO.map;
    sh.uniforms.groundAOOn = groundAO.on;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 gw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            gw = instanceMatrix * gw;
          #endif
          vGroundW = (modelMatrix * gw).xyz;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float sceneWet;\nuniform sampler2D groundAO;\nuniform float groundAOOn;\nvarying vec3 vGroundW;')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        #ifndef FLAT_SHADED
        {
          vec3 nw = inverseTransformDirection(normalize(vNormal), viewMatrix);
          float upw = nw.y;
          float soak = sceneWet * (0.55 + 0.45 * max(upw, 0.0)) * (upw < -0.5 ? 0.15 : 1.0);
          roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.28 + 0.05, soak);
          diffuseColor.rgb *= 1.0 - soak * 0.3;
          // contact shade: read the ground's occlusion just outside the surface (inside a footprint it is black)
          if (groundAOOn > 0.5 && vGroundW.y < 2.5 && abs(vGroundW.x) < 120.0 && abs(vGroundW.z) < 120.0) {
            vec2 gp = vGroundW.xz + normalize(nw.xz + vec2(1e-4)) * 0.45 * (1.0 - abs(upw));
            float ao = texture2D(groundAO, vec2((gp.x + 120.0) / 240.0, (120.0 - gp.y) / 240.0)).r;
            float fall = exp(-max(vGroundW.y, 0.0) / 0.9);
            diffuseColor.rgb *= mix(1.0, 0.25 + 0.75 * ao, 0.8 * fall);
          }
        }
        #endif`);
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${key ? key() : ''}|wet3`;
  return mat;
}
