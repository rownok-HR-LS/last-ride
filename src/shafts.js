// Soft shafts of light (loot beams, lamp cones in the rain) and the night air (mist that hugs the ground and
// glows toward the moon). Shafts are open cones or cylinders drawn additively; their brightness fades along their
// length and toward their silhouette edges, and they melt away when the camera is right inside them.
import * as THREE from 'three';

/**
 * Turn a basic additive material into a soft shaft. bright: 'bottom' (a loot beam rising from the ground) or 'top'
 * (a lamp cone falling from its head). near0/near1: the camera distance over which the shaft fades in.
 */
export function softShaft(mat, { bright = 'bottom', power = 1.8, near0 = 2.5, near1 = 9 } = {}) {
  mat.onBeforeCompile = (sh) => {
    const vars = 'varying float vShaftV;\nvarying float vShaftEdge;\nvarying float vShaftNear;';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${vars}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        mat4 sw = modelMatrix;
        #ifdef USE_INSTANCING
          sw = modelMatrix * instanceMatrix;
        #endif
        #ifdef USE_BATCHING
          sw = modelMatrix * batchingMatrix;
        #endif
        vec4 sp = sw * vec4(position, 1.0);
        vec3 sn = normalize(mat3(sw) * normal);
        vec3 sv = normalize(cameraPosition - sp.xyz);
        vShaftV = uv.y;
        vShaftEdge = abs(dot(sn, sv));
        // fade by how close the camera is to the shaft's centre line (standing inside a wide lamp cone, its walls
        // are metres away but it still fills the view)
        vec3 sc = (sw * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vShaftNear = smoothstep(${near0.toFixed(2)}, ${near1.toFixed(2)}, distance(cameraPosition.xz, sc.xz));`);
    const along = bright === 'top' ? 'vShaftV' : '(1.0 - vShaftV)';
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${vars}`)
      .replace('#include <opaque_fragment>', `diffuseColor.a *= pow(${along}, ${power.toFixed(2)}) * vShaftEdge * vShaftEdge * vShaftNear;\n#include <opaque_fragment>`);
  };
  return mat;
}

let airDone = false;
/**
 * The night air, for every material with fog: besides the usual distance fog, a mist that is thickest at the
 * ground and thins out a few metres up, and fog that brightens toward the moon. Call once before any material
 * is compiled.
 */
export function nightAir(moonDir) {
  if (airDone) return;
  airDone = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = C.fog_pars_vertex.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogWorld;');
  C.fog_vertex = C.fog_vertex.replace('vFogDepth = - mvPosition.z;', 'vFogDepth = - mvPosition.z;\n\tvFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;');
  C.fog_pars_fragment = C.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogWorld;');
  const m = moonDir.clone().normalize();
  C.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	// ground mist: more of it the further you look along the ground, little of it a few metres up
	float mistH = exp( - max( vFogWorld.y, 0.0 ) * 0.32 );
	float mist = ( 1.0 - exp( - vFogDepth * 0.018 ) ) * mistH * 0.6;
	fogFactor = clamp( fogFactor + mist * ( 1.0 - fogFactor ), 0.0, 1.0 );
	// the air glows toward the moon
	vec3 fogDir = normalize( vFogWorld - cameraPosition );
	float toMoon = pow( max( dot( fogDir, vec3( ${m.x.toFixed(3)}, ${m.y.toFixed(3)}, ${m.z.toFixed(3)} ) ), 0.0 ), 6.0 );
	vec3 fogCol = fogColor * ( 1.0 + toMoon * 0.9 ) + vec3( 0.012, 0.014, 0.02 ) * mistH;
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;
}
