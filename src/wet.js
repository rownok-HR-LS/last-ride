// Rain on everything: scenery soaks while it pours, a little darker and much glossier, tops more than sides, the
// undersides of roofs hardly at all. The client sets sceneWet to how hard it is raining (0..1) every frame.

export const sceneWet = { value: 0 };

/** Let a standard material get wet in the rain (once per material). */
export function wetten(mat) {
  if (!mat?.isMeshStandardMaterial || mat.userData.wet) return mat;
  mat.userData.wet = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, renderer) => {
    prev?.call(mat, sh, renderer);
    sh.uniforms.sceneWet = sceneWet;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float sceneWet;')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        #ifndef FLAT_SHADED
        {
          float upw = inverseTransformDirection(normalize(vNormal), viewMatrix).y;
          float soak = sceneWet * (0.55 + 0.45 * max(upw, 0.0)) * (upw < -0.5 ? 0.15 : 1.0);
          roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.28 + 0.05, soak);
          diffuseColor.rgb *= 1.0 - soak * 0.3;
        }
        #endif`);
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${key ? key() : ''}|wet`;
  return mat;
}
