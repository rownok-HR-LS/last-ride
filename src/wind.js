// The wind in the plants: grass, ferns, bushes and tree crowns sway, more the higher up they are, in slow gusts.
// The client advances windTime every frame; the night's wind (motion.js windAmp) sets how hard they move.

import { windAmp } from './motion.js';

export const windTime = { value: 0 };

/**
 * Make a material sway. amp: how far a vertex moves per unit of height above the model's base (in the model's own
 * units, so instance scale carries through: a 1-unit tree scaled to 15 m sways 15 times as far).
 */
export function sway(mat, amp) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, renderer) => {
    prev?.call(mat, sh, renderer);
    sh.uniforms.windTime = windTime;
    sh.uniforms.windAmp = windAmp;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float windTime;\nuniform float windAmp;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 wp = position;
          #ifdef USE_INSTANCING
            wp = (instanceMatrix * vec4(position, 1.0)).xyz;
          #endif
          // neighbours move together, gusts roll across the park
          float ph = wp.x * 0.35 + wp.z * 0.27;
          float gust = 0.55 + 0.45 * sin(windTime * 0.33 + wp.x * 0.015 + wp.z * 0.01);
          float sw = (sin(windTime * 1.5 + ph) * 0.65 + sin(windTime * 3.4 + ph * 1.7) * 0.35) * gust;
          // harder in a storm, barely on a still night
          float k = max(position.y, 0.0) * ${amp.toFixed(4)} * (0.3 + 0.7 * windAmp);
          transformed.x += sw * k;
          transformed.z += sw * k * 0.55;
        }`);
  };
  // shaders with and without the sway must not share a compiled program
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${key ? key() : ''}|sway${amp}`;
  return mat;
}
