// Reflections in the wet ground (screen space): post.js keeps a half-size copy of each finished frame (light in rgb,
// distance from the camera in alpha) with the camera it was seen from; the ground's shader (world.js) traces its
// mirrored view ray through that copy the next frame, so lamps, neon and lit booths shine back out of the puddles.
import * as THREE from 'three';

export const ssr = {
  tex: { value: null },
  view: { value: new THREE.Matrix4() },
  proj: { value: new THREE.Matrix4() },
  /** 1 once a frame has been kept (and while reflections are on) */
  on: { value: 0 },
};

/** The ground shader's part: call after the puddle code, inside lights_fragment_end. */
export const SSR_GLSL = /* glsl */ `
  if (ssrOn > 0.5) {
    // how mirror-like this bit of ground is: standing water most, wet cobbles and mud a little, more while it rains
    float refl = puddle * 0.95 + (wetG * 0.3 + rainAmt * 0.3 + pathK * 0.2) * (1.0 - puddle);
    vec3 Nw = inverseTransformDirection(normal, viewMatrix);
    vec3 V = normalize(cameraPosition - vLampW);
    vec3 R = reflect(-V, Nw);
    if (refl > 0.02 && R.y > 0.01) {
      vec3 hitCol = vec3(0.0);
      float hit = 0.0;
      float t = 0.25;
      vec2 skyUv = vec2(-1.0);
      for (int i = 0; i < 20; i++) {
        vec3 q = vLampW + R * t;
        vec4 vq = ssrView * vec4(q, 1.0);
        vec4 cq = ssrProj * vq;
        if (cq.w <= 0.0) break;
        vec2 uv = cq.xy / cq.w * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        vec4 s = texture2D(ssrTex, uv);
        // open sky (or fog, glow and light cones, which keep no depth) behind this step
        if (s.a > 1e4) skyUv = uv;
        float dz = -vq.z - s.a;
        if (dz > 0.0 && dz < 0.35 + t * 0.12) {
          hitCol = s.rgb;
          // fade toward the frame's edges, where the copy runs out
          vec2 e = abs(uv * 2.0 - 1.0);
          hit = 1.0 - smoothstep(0.75, 1.0, max(e.x, e.y));
          break;
        }
        t *= 1.28;
      }
      // nothing solid in the way: the ray ends in the sky, the haze and the lamps' glow; mirror that
      if (hit == 0.0 && skyUv.x >= 0.0) {
        hitCol = texture2D(ssrTex, skyUv).rgb;
        vec2 e = abs(skyUv * 2.0 - 1.0);
        hit = 1.0 - smoothstep(0.75, 1.0, max(e.x, e.y));
      }
      float fres = 0.04 + 0.96 * pow(1.0 - max(dot(Nw, V), 0.0), 5.0);
      reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, hitCol, hit * min(1.0, refl * mix(0.45, 1.2, fres)));
    }
  }
`;
