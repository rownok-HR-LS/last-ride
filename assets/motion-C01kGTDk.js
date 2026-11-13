import{$ as e,$n as t,Dt as n,Et as r,Ft as i,Nt as a,W as o,_ as s,br as c,ir as l,l as u,tt as d,u as f,xr as p,zt as m}from"./three.core-ChwQ_ZRW.js";var h=`modulepreload`,g=function(e,t){return new URL(e,t).href},_={},v=function(e){return e.pathname.endsWith(`.css`)},y=function(e,t,n){if(t in e)return e[t];let r=n();if(!r){e[t]=void 0;return}let i=r.then(()=>{e[t]=void 0},n=>{throw e[t]=void 0,n});return e[t]=i,i},b=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e,i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?new URL(import.meta.resolve(e)):new URL(e,import.meta.url)}r=o(t.map(t=>{t=g(t,n);let r=s(t),i=v(r);return y(_,r.href,()=>{if(e===void 0){e={all:new Set,styles:new Set};let t=document.getElementsByTagName(`link`);for(let n=t.length-1;n>=0;n--){let r=t[n];e.all.add(r.href),r.rel===`stylesheet`&&e.styles.add(r.href)}}if((i?e.styles:e.all).has(r.href))return;let t=document.createElement(`link`);if(t.rel=i?`stylesheet`:h,i||(t.as=`script`),t.crossOrigin=``,t.href=r.href,a&&t.setAttribute(`nonce`,a),document.head.appendChild(t),i)return new Promise((e,n)=>{t.addEventListener(`load`,e),t.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${r}`)))})})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},x={value:0};function S(e,t){let n=e.onBeforeCompile;e.onBeforeCompile=(r,i)=>{n?.call(e,r,i),r.uniforms.windTime=x,r.uniforms.windAmp=w,r.vertexShader=r.vertexShader.replace(`#include <common>`,`#include <common>
uniform float windTime;
uniform float windAmp;`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
        {
          vec3 wp = position;
          #ifdef USE_INSTANCING
            wp = (instanceMatrix * vec4(position, 1.0)).xyz;
          #endif
          #ifdef USE_BATCHING
            wp = (batchingMatrix * vec4(position, 1.0)).xyz;
          #endif
          // neighbours move together, gusts roll across the park
          float ph = wp.x * 0.35 + wp.z * 0.27;
          float gust = 0.55 + 0.45 * sin(windTime * 0.33 + wp.x * 0.015 + wp.z * 0.01);
          float sw = (sin(windTime * 1.5 + ph) * 0.65 + sin(windTime * 3.4 + ph * 1.7) * 0.35) * gust;
          // harder in a storm, barely on a still night
          float k = max(position.y, 0.0) * ${t.toFixed(4)} * (0.3 + 0.7 * windAmp);
          transformed.x += sw * k;
          transformed.z += sw * k * 0.55;
        }`)};let r=e.customProgramCacheKey?.bind(e);return e.customProgramCacheKey=()=>`${r?r():``}|sway${t}`,e}var C={value:0},w={value:.6},T={storm:1,thunder:1.25,drizzle:.6,fog:.18,moon:.3},E=new Map;function D(e){return E.has(e)||E.set(e,Promise.all([fetch(`./models/motion/${e}.json`).then(e=>e.json()),new l().loadAsync(`./models/motion/${e}.png`)]).then(([e,t])=>(t.colorSpace=``,t.magFilter=i,t.minFilter=i,t.generateMipmaps=!1,e.tex=t,e.count=e.verts.length/3,e))),E.get(e)}function O(e,t,n=new r,{phase:i=0,ampFloor:a=0}={}){e.userData.moves=!0;let o=e.onBeforeCompile;e.onBeforeCompile=(r,s)=>{o?.call(e,r,s),Object.assign(r.uniforms,{motionTex:{value:t.tex},motionInfo:{value:new p(t.count,t.frames+1,t.frames,t.range)},motionFps:{value:t.fps},motionToLocal:{value:n},motionTime:C,windAmp:w,motionPhase:{value:i},motionFloor:{value:a}}),r.vertexShader=r.vertexShader.replace(`#include <common>`,`#include <common>
        attribute float motionId;
        uniform sampler2D motionTex;
        uniform vec4 motionInfo; // columns, rows, frames, range
        uniform float motionFps, motionTime, windAmp, motionPhase, motionFloor;
        uniform mat3 motionToLocal;
        vec3 motionAt(float u, float row) {
          return texture2D(motionTex, vec2(u, (row + 0.5) / motionInfo.y)).rgb * 2.0 - 1.0;
        }`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
        if (motionId > 0.5) {
          float u = (motionId - 0.5) / motionInfo.x;
          vec3 wp = position;
          float ph = motionPhase * motionInfo.z;
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
          float k = max(windAmp, motionFloor) * gust;
          // the settled shape leans with the wind too: limp on a still night, blown out in a storm
          vec3 off = (motionAt(u, 0.0) * min(1.0, 0.35 + k) + flutter * k) * motionInfo.w;
          transformed += motionToLocal * off;
        }`)};let s=e.customProgramCacheKey?.bind(e);return e.customProgramCacheKey=()=>`${s?s():``}|motion:${t.name}`,e}function k(e){let t=new f;return t.setAttribute(`position`,new o(e.verts,3)),t.setAttribute(`motionId`,new o(Array.from({length:e.count},(e,t)=>t+1),1)),e.uvs&&t.setAttribute(`uv`,new o(e.uvs,2)),t.setIndex(e.tris),t.computeVertexNormals(),t}function A(e,t,n){let r=e.attributes.position,i=new Float32Array(r.count),a=new c,o=0;for(let e=0;e<r.count;e++){a.fromBufferAttribute(r,e).applyMatrix4(n);let s=225e-6,c=0;for(let e=0;e<t.count;e++){let n=a.x-t.verts[e*3],r=a.y-t.verts[e*3+1],i=a.z-t.verts[e*3+2],o=n*n+r*r+i*i;o<s&&(s=o,c=e+1)}i[e]=c,c&&o++}return e.setAttribute(`motionId`,new u(i,1)),o}var j=[`#e2384f`,`#2f9be0`,`#f2b632`,`#8e44d6`,`#2fbf87`,`#f0702c`];async function M(e){if(!e.length)return null;let t=await D(`pennant`),n=k(t),r=O(new a({side:2,roughness:.8}),t),i=e.length*12*5,o=new d(n,r,i);o.name=`bunting`;let c=new m,l=new m,u=new s,f=0;for(let t of e){c.position.set(t.x,0,t.z),c.rotation.set(0,(t.x+t.z)%6.28,0),c.updateMatrix();for(let e=0;e<12;e++){let t=e*2*Math.PI/12;for(let n=0;n<5;n++){let r=(n+.5)/5,i=t+r*2*Math.PI/12,a=4.03;l.position.set(Math.cos(i)*a,2.3-Math.sin(r*Math.PI)*.35,Math.sin(i)*a),l.rotation.set(0,-(i+Math.PI/2),0),l.updateMatrix(),o.setMatrixAt(f,l.matrix.premultiply(c.matrix)),o.setColorAt(f,u.set(j[(e*5+n)%j.length]).multiplyScalar(.8)),f++}}}return o.instanceMatrix.needsUpdate=!0,o.computeBoundingSphere(),o.receiveShadow=!0,o.userData.moves=!0,o}function N(r,i){let a=[];for(let o of new Set(r.map(e=>e.key))){let s=r.filter(e=>e.key===o),c=i(o).clone();c.onBeforeCompile=e=>{e.uniforms.windTime=x,e.uniforms.windAmp=w,e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
attribute vec2 aSway;
uniform float windTime;
uniform float windAmp;`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
          {
            float s = sin(3.14159 * aSway.x);
            float ph = aSway.y * 1.7;
            float k = s * (0.35 + 0.85 * windAmp);
            transformed += vec3(sin(windTime * 1.6 + ph) * 0.16, (sin(windTime * 2.1 + ph * 1.3) - 1.0) * 0.06, cos(windTime * 1.3 + ph) * 0.16) * k;
          }`)},c.customProgramCacheKey=()=>`lightStrings`;let l=new d(new t(.09,7,5),c,s.length),u=new Float32Array(s.length*2),f=new n;s.forEach((e,t)=>{l.setMatrixAt(t,f.makeTranslation(e.x,e.y,e.z)),u[t*2]=e.t,u[t*2+1]=e.strand}),l.geometry.setAttribute(`aSway`,new e(u,2)),l.computeBoundingSphere(),l.name=`lightStrings`,a.push(l)}return a}export{D as a,C as c,x as d,b as f,N as i,w as l,A as n,k as o,M as r,O as s,T as t,S as u};