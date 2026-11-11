// Ties the simulation to the renderer: input, camera, characters, effects, audio and HUD.
import * as THREE from 'three';
import { Game } from '../shared/game.js';
import { dirFromAngles } from '../shared/rng.js';
import { rayWorld, lineOfSight } from '../shared/collide.js';
import { MAX_PLAYERS, OUTFITS } from '../shared/constants.js';
import {
  WEAPONS, WEAPON_IDS, FISTS, POWERS, RIDES, HEAVY, RARITIES, PRIZES,
} from '../shared/items.js';
import { FERRIS, REGIONS, trackAt, pathDistance, PARK_EDGE, BREAKABLES } from '../shared/map.js';
import { shatter, stepDebris, debrisCount } from './debris.js';
import { buildWorld, buildSky, groundRain, SKY_SCALE } from './world.js';
import { Rain, sheltered } from './rain.js';
import { Rides } from './rides.js';
import { Character, Corpse, nameTag, setCharacterRim } from './characters.js';
import { loadRagdolls, stepRagdolls } from './ragdoll.js';
import { FX } from './fx.js';
import { LootView } from './loot.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { createPost, SSR } from './post.js';
import { ringTex } from './textures.js';
import { Guide } from './guide.js';
import { Intro } from './intro.js';
import { cullInstances, setCullScale, mergeBatches, setPropHidden } from './cull.js';
import { freed } from './ktx.js';
import { setStage, whenCompiled, needsCompile, watchAdds } from './stage.js';
import { ShadowProxy } from './shadowproxy.js';
import { Bus } from './bus.js';
import { Projectiles } from './projectiles.js';
import { weaponModel, projectileModel, itemModel } from './weapons.js';
import * as audio from './audio.js';
import { windTime } from './wind.js';
import { motionTime, windAmp, NIGHT_WIND } from './motion.js';
import { sceneWet } from './wet.js';
import { PauseMenu } from './menu.js';
import { loadSettings } from './settings.js';
import { Touch, isTouch } from './touch.js';
import { Pads } from './gamepad.js';
import { lookItem } from '../shared/looks.js';
import { CHAT_LINES, NIGHTS } from '../shared/constants.js';
import { loadProgress, award } from './progress.js';
import { setBinds } from './prompts.js';
import { updateLampLight } from './lamplight.js';

const FEMALE = new Set(OUTFITS.filter((o) => o.voice === 'f').map((o) => o.id));

const STEP = 1 / 60;
const PRIZE_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'];
const tmpV = new THREE.Vector3();
const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const tmpV2 = new THREE.Vector3();

function nearestRegion(x, z) {
  let best = REGIONS[0];
  let bd = Infinity;
  for (const r of REGIONS) {
    const d = Math.hypot(r.x - x, r.z - z);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best.name;
}

/** What killed you, as the death card says it. */
function killCause(how) {
  const OTHER = {
    fists: 'bare hands', trap: 'a bear trap', cursed: 'a cursed chest', ferris: 'a Ferris wheel gondola', coaster: 'the roller coaster',
    car: 'a bumper car', storm: 'the storm', fall: 'the fall', gondola: 'a Ferris wheel gondola', firework: 'a firework', fireworks: 'a firework',
  };
  return OTHER[how] || (WEAPONS[how] ? `a ${WEAPONS[how].name}` : how || 'something in the dark');
}

/**
 * Where a ray first meets the tour bus's body (a box 2.8 x 3.3 x 11 m round it, turned with it), or Infinity. A ray
 * that starts inside the box (stepping out of the door) doesn't count.
 */
function rayBus(bus, ox, oy, oz, dx, dy, dz, maxT) {
  const c = Math.cos(bus.yaw || 0);
  const s = Math.sin(bus.yaw || 0);
  // into the bus's own frame (three.js turns local (x, z) to world by the yaw)
  const px = ox - bus.x;
  const pz = oz - bus.z;
  const o = [px * c - pz * s, oy - (bus.y || 0), px * s + pz * c];
  const d = [dx * c - dz * s, dy, dx * s + dz * c];
  const lo = [-1.4, 0, -5.6];
  const hi = [1.4, 3.3, 5.6];
  if (o.every((v, i) => v > lo[i] && v < hi[i])) return Infinity;
  let t0 = 0;
  let t1 = maxT;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return Infinity;
      continue;
    }
    let a = (lo[i] - o[i]) / d[i];
    let b = (hi[i] - o[i]) / d[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** The night's wind: eases toward its strength and plays the baked cloth motion faster when it blows harder. */
function blowWind(dt, target) {
  windAmp.value += (target - windAmp.value) * Math.min(1, dt * 0.4);
  motionTime.value = (motionTime.value + dt * (0.55 + 0.45 * windAmp.value)) % 10000;
}

export class Client {
  /**
   * How a dying rider falls (Corpse/ragdoll): from the pose their character is in, carrying on how they moved,
   * thrown away from whoever killed them, hardest by a bumper car, a blast or a flung gondola.
   */
  /** Show a prop as broken (hidden, not blocking) or whole again. */
  syncProp(id, broken) {
    this.brokenProps ||= new Set();
    if (broken === this.brokenProps.has(id)) return;
    if (broken) this.brokenProps.add(id);
    else this.brokenProps.delete(id);
    setPropHidden(id, broken);
    // (online, the prediction walks through what the server says is broken)
    BREAKABLES[id].col.off = broken;
  }

  /** Match the props to the ride's list of broken ones (a new ride starts with everything whole again). */
  syncBroken(snap) {
    const now = snap.broken || [];
    const key = now.length ? now.join(',') : '';
    if (key === this.brokenKey) return;
    this.brokenKey = key;
    const set = new Set(now);
    for (const id of [...(this.brokenProps || [])]) if (!set.has(id)) this.syncProp(id, false);
    for (const id of set) this.syncProp(id, true);
  }

  deathFall(e, v) {
    const c = this.chars.get(e.victim);
    if (!c?.char || !c.char.root.visible) return null;
    const killer = e.killer != null && e.killer !== e.victim ? this.game.players.get(e.killer) : null;
    let dx = 0;
    let dz = 0;
    if (killer) {
      dx = c.char.root.position.x - killer.x;
      dz = c.char.root.position.z - killer.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
    }
    const how = String(e.how || '');
    const type = WEAPONS[how]?.type;
    const [h, up] = how === 'car' ? [8, 4] : how === 'coaster' ? [9, 4] : how === 'gondola' || how === 'fling' ? [5, 3]
      : /rocket|grenade|firework|launcher|blast|bomb|mortar|cannon/i.test(how) ? [7, 5]
        : how === 'fists' || type === 'melee' ? [3.5, 1.2] : type ? [2.2, 0.4] : [1, 0.5];
    const vel = c.vel || [0, 0, 0];
    return { from: c.char, push: { x: dx * h, y: up, z: dz * h }, vel: { x: vel[0], y: Math.max(vel[1], -4), z: vel[2] } };
  }

  /** The living riders and moving bumper cars near loose bodies, for shoving them about. */
  bodyPushers(snap, dt) {
    const riders = [];
    for (const p of snap.players || []) if (p.state === 'alive') riders.push(p);
    const prev = (this.carPrev ||= []);
    const cars = (snap.cars || []).map((c, i) => {
      const pp = prev[i];
      const v = pp && dt > 0 ? { vx: (c.x - pp.x) / dt, vz: (c.z - pp.z) / dt } : { vx: 0, vz: 0 };
      prev[i] = { x: c.x, z: c.z };
      // (a car that jumped across the arena between frames isn't moving that fast)
      if (Math.hypot(v.vx, v.vz) > 30) v.vx = v.vz = 0;
      return { x: c.x, y: c.y, z: c.z, ...v };
    });
    return { riders, cars };
  }

  /**
   * opts.attract: build the park and show it under the title screen (no match yet); start(profile) begins one.
   */
  constructor(container, profile, settings = loadSettings(), opts = {}) {
    this.profile = profile;
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    // PCF from the start: three swaps the removed soft mode for PCF only at the first shadow pass, and any shader
    // built before that expected the wrong kind of shadow texture (those draws failed and riders vanished)
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // neutral tone mapping keeps the sodium lamps orange and the night deep instead of washing everything out
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2500);
    const sky = buildSky(scene, renderer);
    this.moonLight = sky.moonLight;
    this.moonDir = sky.moonDir;
    this.hemi = sky.hemi;
    const world = buildWorld(scene);
    this.lamps = world.lamps;
    this.rides = new Rides(scene);
    this.fx = new FX(scene);
    this.lootView = new LootView(scene);
    this.bus = new Bus(scene);
    this.rain = new Rain(scene);
    // per rider: how soaked and how bloodied they are (drives their look)
    this.bodyFx = new Map();
    // lightning: the next strike's countdown, and the flickers of the current one
    this.weather = { nextBolt: 7, bolt: null, flash: 0 };
    this.driver = new Character('eric');
    scene.add(this.driver.root);
    this.projectiles = new Projectiles(scene, this.fx);
    this.post = createPost(renderer, scene, this.camera);

    this.hudRoot = document.createElement('div');
    this.hudRoot.className = 'hud';
    container.appendChild(this.hudRoot);
    this.hud = new Hud(this.hudRoot, {
      onPower: (id) => this.selectPower(id),
      onClosePrizes: () => this.closePrizes(),
    });
    this.dmgLayer = document.createElement('div');
    this.dmgLayer.className = 'dmg-numbers';
    this.hudRoot.appendChild(this.dmgLayer);
    this.dmgNums = [];
    // the one you are fighting: their name and a slim health bar over their head
    this.foeBar = document.createElement('div');
    this.foeBar.className = 'foe-bar';
    this.foeBar.style.display = 'none';
    this.foeBar.innerHTML = '<div class="fb-name"><i class="fb-lock"></i><span></span></div><div class="fb-track"><div class="fb-chip"></div><div class="fb-hp"></div></div><div class="fb-sh"><div></div></div>';
    this.dmgLayer.appendChild(this.foeBar);

    this.input = new Input(renderer.domElement);
    this.guide = new Guide(this.hudRoot);
    this.chars = new Map();
    this.corpses = [];
    this.prev = new Map();
    this.kick = 0;
    this.kickYaw = 0;
    this.shotPulse = 0;
    this.muzzleLight = new THREE.PointLight('#ffb060', 0, 9, 2);
    scene.add(this.muzzleLight);

    // ghost power target ring
    this.targetRing = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: ringTex(), color: '#7dffd8', transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.renderOrder = 4;
    this.targetRing.visible = false;
    scene.add(this.targetRing);
    this.revealMat = new THREE.SpriteMaterial({ color: '#ff2a4a', depthTest: false, transparent: true, toneMapped: false });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.applySettings(settings);
    this.pauseMenu = new PauseMenu(container, {
      settings,
      onChange: (s) => this.applySettings(s),
      onResume: () => this.resume(),
      onQuit: () => location.reload(),
    });
    // phones and tablets get on-screen controls
    if (isTouch()) this.touch = new Touch(container, this);
    this.input.onUnlock = () => this.pause();
    this.input.onEscape = () => (this.pauseMenu.open ? this.resume() : this.pause());
    this.attract = !!opts.attract;
    if (this.attract) {
      this.input.enabled = false;
      this.hudRoot.style.display = 'none';
    } else this.newMatch();
    this.last = performance.now();
    this.acc = 0;
    this.time = 0;
    this.running = true;
    this.paused = false;
    this.pads = new Pads(this);
    // sound captions: important sounds near you, written on screen with where they come from
    audio.onCue((name, pos, opt) => this.caption(name, pos, opt));
    // Compile the park's shaders in the background (stage.js) before the first frame, and anything that arrives
    // later before it is shown: three.js would otherwise compile each on first sight and freeze the page meanwhile
    // (seconds at a time under the title while the scenery, rides and riders stream in).
    setStage(this.renderer, this.camera, this.scene);
    this.ready = whenCompiled(this.scene).then(() => {
      this.compiled = true;
      // the physics engine for ragdolls comes in once the menu is up (deaths fall back to animations until then)
      setTimeout(() => loadRagdolls(), 1500);
      // models that arrive later inside groups already in the park (far versions, ride parts, effects) don't pass
      // through scene.add: build their shaders in the background as soon as they're added (watchAdds), so the
      // first frame that shows them doesn't stall while the driver builds them
      watchAdds(this.scene);
      // scenery that shares a material is drawn together (cull.js mergeBatches): once the park has loaded, and again
      // for whatever arrived later. ?nomerge leaves it all separate (the baking tools want the plain batches).
      if (!/[?&]nomerge/.test(location.search)) {
        const merge = () => mergeBatches(this.scene, (bm) => whenCompiled(bm)).then((n) => {
          this.mergedDraws = (this.mergedDraws || 0) + n;
        }).catch((e) => console.warn('merge', e));
        setTimeout(merge, 8000);
        setTimeout(merge, 40000);
      }
    });
    const addNow = this.scene.add.bind(this.scene);
    // still scenery hands its moonlight shadow to one simplified stand-in (src/shadowproxy.js)
    this.shadowProxy = new ShadowProxy(this, this.moonLight);
    const sceneAdd = (o) => {
      addNow(o);
      this.shadowProxy.adopt(o);
    };
    const sceneRemove = this.scene.remove.bind(this.scene);
    const waiting = new Set();
    this.scene.add = (...objs) => {
      for (const o of objs) {
        if (!o?.isObject3D || !needsCompile(o)) {
          sceneAdd(o);
          continue;
        }
        waiting.add(o);
        whenCompiled(o).then(() => {
          if (!waiting.delete(o)) return; // taken away again before it was ready
          sceneAdd(o);
        });
      }
      return this.scene;
    };
    this.scene.remove = (...objs) => {
      for (const o of objs) waiting.delete(o);
      return sceneRemove(...objs);
    };
    const loop = (now) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.pads.poll(dt);
      // the graphics card was reset: nothing can be drawn until the browser hands the context back
      if (this.gpuLost) return;
      // nothing to draw until the shaders are in (the title's still picture covers it meanwhile)
      if (!this.compiled) return;
      if (!this.paused && !document.hidden) this.adaptQuality(dt);
      if (this.attract) this.attractFrame(dt);
      else if (!this.paused) this.frame(this.slowmo > 0 && !this.online ? ((this.slowmo -= dt), dt * 0.35) : dt);
    };
    requestAnimationFrame(loop);
    this.watchContext();
    // pay for first uses now, under the title, instead of in the first fight
    setTimeout(() => this.warmUp(), 500);
  }

  /**
   * A graphics driver can reset the WebGL context (a laptop switching GPUs, a phone reclaiming memory, a driver
   * update). Ask the browser to give it back, keep the sim waiting, and draw again once it does: three.js uploads
   * every texture and shader again on its own. If it never comes back, offer a reload (an online rider's ticket is
   * kept through it, so they land back in their own body).
   */
  watchContext() {
    const canvas = this.renderer.domElement;
    const note = document.createElement('div');
    note.className = 'gpu-reset';
    note.innerHTML = '<b>The picture went out</b><span>Your graphics card reset. Getting the park back…</span><button class="ticket" hidden>Reload the park</button>';
    note.querySelector('button').addEventListener('click', () => location.reload());
    this.container.appendChild(note);
    let timer = 0;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.gpuLost = true;
      note.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(() => {
        note.querySelector('span').textContent = 'It is not coming back by itself.';
        note.querySelector('button').hidden = false;
      }, 6000);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      clearTimeout(timer);
      this.gpuLost = false;
      this.last = performance.now();
      note.classList.remove('show');
      note.querySelector('button').hidden = true;
      note.querySelector('span').textContent = 'Your graphics card reset. Getting the park back…';
      // the textures' data was let go once on the graphics card (ktx.js): they can't be sent again, so start over
      // (an online ride carries on after a reload)
      if (freed.any) {
        location.reload();
        return;
      }
      this.warmUp();
    });
  }

  /**
   * The first hit flash, splash or damage number used to cost a frame of its own (a texture upload, a shader, a
   * first layout). Set each off once out of sight, upload every texture in the park and compile every material.
   */
  warmUp() {
    const r = this.renderer;
    this.fx.strike(0, -60, 0, 1, 0, true, false);
    this.fx.strike(0, -60, 0, 1, 0, false, true);
    this.fx.footSplash(0, -60, 0, 0, 0, 1, true, true);
    this.fx.impact(0, -60, 0, 'head');
    this.fx.sparkle(0, -60, 0);
    const seen = new Set();
    this.scene.traverse((o) => {
      const mats = !o.material ? [] : Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of ['map', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          const t = m[k];
          if (t && !seen.has(t) && t.image) {
            seen.add(t);
            r.initTexture(t);
          }
        }
      }
    });
    r.compile(this.scene, this.camera);
    // the fight HUD's first layout
    const fb = this.foeBar;
    const was = fb.style.display;
    fb.style.display = '';
    fb.getBoundingClientRect();
    fb.style.display = was;
    const el = document.createElement('div');
    el.className = 'dmg big';
    el.textContent = '0';
    el.style.visibility = 'hidden';
    this.dmgLayer.appendChild(el);
    el.getBoundingClientRect();
    el.remove();
  }

  /**
   * Dynamic resolution: if frames are slow (a big screen or a weaker GPU), render a little smaller so the game
   * stays smooth; go back up when there is headroom.
   */
  adaptQuality(dt) {
    if (this.settings.quality !== 'auto') return;
    this.frameAvg = (this.frameAvg ?? 1 / 60) * 0.95 + dt * 0.05;
    this.qualityT = (this.qualityT ?? 0) + dt;
    if (this.qualityT < 2) return;
    this.qualityT = 0;
    const base = Math.min(window.devicePixelRatio, 1.5);
    let k = this.quality ?? 1;
    // Lowering the resolution only helps when the graphics card is the bottleneck. If the last step down did not
    // make frames meaningfully faster, the processor is the limit: put the sharpness back and stop trying for a while.
    if (this.lastDrop && this.time - this.lastDrop.at < 5) {
      const helped = this.frameAvg < this.lastDrop.before * 0.9;
      const was = this.lastDrop;
      this.lastDrop = null;
      if (!helped) {
        this.noDropUntil = this.time + 45;
        // the processor is the limit: draw less often and less far instead (once)
        if (!this.cpuSave) {
          this.cpuSave = true;
          this.shadowEvery = 4;
          setCullScale(0.7);
        }
        k = was.k;
        this.quality = k;
        this.renderer.setPixelRatio(base * k);
        this.post.setPixelRatio(base * k);
        this.resize();
        return;
      }
    }
    // already as soft as it goes and still slow: drop the costly effects too (once)
    if (this.frameAvg > 1 / 45 && k <= 0.55 && !this.autoFxOff && this.time > (this.noDropUntil ?? 0)) {
      this.autoFxOff = true;
      this.setEffects(false);
      return;
    }
    if (this.frameAvg > 1 / 50 && k > 0.55 && this.time > (this.noDropUntil ?? 0)) {
      this.lastDrop = { k, before: this.frameAvg, at: this.time };
      k -= 0.1;
    } else if (this.frameAvg < 1 / 75 && k < 1) k += 0.1;
    else return;
    this.quality = Math.round(k * 10) / 10;
    this.renderer.setPixelRatio(base * this.quality);
    this.post.setPixelRatio(base * this.quality);
    this.resize();
  }

  /** Leave the title screen and begin a match in the park that is already built. */
  /** Leave the title screen for a ride: offline against bots, or online when given the server's ride (a NetGame). */
  start(profile, game = null) {
    this.profile = profile;
    this.attract = false;
    if (this.showChar) this.scene.remove(this.showChar.root);
    this.showChar = null;
    this.input.enabled = true;
    this.hudRoot.style.display = '';
    this.newMatch(game);
  }

  /** The rider waiting under the lamp on the title screen. */
  showcase(outfit, look = null) {
    if (this.showChar) this.scene.remove(this.showChar.root);
    this.showChar = new Character(outfit, 7);
    this.showChar.wear(look);
    this.showChar.setLook(0.55, 0);
    this.scene.add(this.showChar.root);
  }

  /**
   * Title screen: the empty park at night in the rain, the camera drifting slowly up the midway toward the big
   * top, lightning now and then, and the chosen rider standing under a lamp in the foreground.
   */
  attractFrame(dt) {
    this.time += dt;
    const t = this.time;
    const cam = this.camera;
    // a slow handheld sway, never far enough to lose the rider
    const sway = Math.sin(t * 0.07);
    // on a tall (phone) screen the menu fills the bottom: turn toward the rider, step back, and keep them high
    const narrow = Math.min(1, Math.max(0, (1.1 - cam.aspect) / 0.6));
    cam.position.set(4.6 + sway * 0.5 - narrow * 1.1, 1.75 + Math.sin(t * 0.11) * 0.08 + narrow * 0.35, 104 + Math.sin(t * 0.045) * 1.2 + narrow * 2.2);
    cam.lookAt(1.6 + sway * 0.3 + narrow * 1.0, 1.5 - narrow * 1.1, 88 + narrow * 8);
    const fov = 48 + narrow * 14;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.updateWeather(dt);
    const flash = this.weather.flash;
    this.hemi.intensity = 1.15 + flash * 1.6;
    if (this.scene.environment) this.scene.environmentIntensity = 0.65 + flash * 0.8;
    this.scene.backgroundIntensity = (0.6 + flash * 1.6) * SKY_SCALE;
    this.moonLight.intensity = 2.1 + flash * 5;
    this.moonLight.position.copy(cam.position).addScaledVector(this.moonDir, 120);
    this.moonLight.target.position.copy(cam.position);
    this.moonLight.target.updateMatrixWorld();
    this.rain.update(dt, cam, { amount: 0.85, flash, bus: null });
    groundRain.time.value = t % 1000;
    windTime.value = t % 1000;
    blowWind(dt, NIGHT_WIND.storm);
    groundRain.amount.value = 0.85;
    sceneWet.value = 0.85;
    this.lamps.update([], t, cam.position.x, cam.position.z, 1);
    updateLampLight([], 1);
    if (this.showChar) {
      const x = 2.5;
      const z = 98.8;
      this.showChar.root.position.set(x, 0, z);
      // turned toward the camera
      this.showChar.animate({ state: 'alive', id: 7, x, y: 0, z, yaw: Math.PI + 0.36, pitch: 0, vx: 0, vy: 0, vz: 0, onGround: true, wpn: null, rarity: 0, flash: 0, hp: 100 }, dt, t, {});
    }
    cullInstances(cam);
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.post.grade.cine.value = 1;
    this.post.setDof(Math.max(2, cam.position.distanceTo(new THREE.Vector3(2.5, 1.4, 98.8))), 0.35);
    this.post.grade.time.value = t;
    this.post.composer.render(dt);
  }

  /** Freeze the match under the pause sign. Online the park carries on without you: the sign goes up, the ride does not stop. */
  pause() {
    const g = this.game;
    if (this.pauseMenu.open || !g || this.hud.prizesOpen || this.hud.mapOpen || this.power) return;
    if (this.online) {
      if (g.phase !== 'end') this.pauseMenu.show(true);
      return;
    }
    if (g.phase !== 'live') return;
    this.paused = true;
    this.pauseMenu.show();
  }

  resume() {
    this.pauseMenu.hide();
    this.paused = false;
    this.last = performance.now();
    this.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
  }

  /**
   * Apply the player's settings (from the settings menu): mouse, keys, volumes and graphics.
   * Fixed quality levels: ultra adds full screen density and finer shadows; high is full sharpness with every effect;
   * medium and low render smaller, thin the rain
   * and lower the shadow detail, and low also drops the ambient occlusion and the wet ground's reflections.
   */
  applySettings(s) {
    this.settings = s;
    document.documentElement.style.setProperty('--hud-zoom', { small: 0.85, large: 1.22 }[s.uiSize] ?? 1);
    this.input.binds = s.keys;
    setBinds(s.keys);
    audio.setVolumes(s.volume);
    // [sharpness, rain, shadow map, effects (ambient shading, wet reflections, lamp glow), edge smoothing, sharpest
    // pixel density, shadows redrawn every Nth frame, how far small props are drawn]. The last two spare the
    // processor, which is what holds a laptop or a phone back (drawing calls, not pixels). Ultra renders at the screen's full density; the others stop at 1.5 (a sharp laptop screen
    // would otherwise cost twice the pixels for little to see).
    const Q = {
      ultra: [1, 1, 4096, true, true, 2, 2, 1.15],
      high: [1, 1, 2048, true, true, 1.5, 2, 1],
      medium: [0.8, 0.7, 1536, true, true, 1.5, 3, 0.85],
      low: [0.62, 0.4, 1024, false, false, 1.5, 4, 0.65],
    }[s.quality];
    // auto starts sharp with everything on, then adapts (see adaptQuality)
    const [res, rain, shadow, fx, smaa, dpr, shadowEvery, reach] = Q || [1, 1, 2048, true, true, 1.5, 2, 1];
    this.shadowEvery = shadowEvery;
    setCullScale(reach);
    this.cpuSave = false;
    const base = Math.min(window.devicePixelRatio, dpr);
    this.quality = res;
    this.renderer.setPixelRatio(base * res);
    this.post.setPixelRatio(base * res);
    this.rain.setDensity(rain);
    this.setEffects(fx);
    this.post.smaa.enabled = smaa;
    this.autoFxOff = false;
    const sh = this.moonLight.shadow;
    if (sh.mapSize.x !== shadow) {
      sh.mapSize.set(shadow, shadow);
      // resize the shadow map in place: throwing it away left frames sampling a missing shadow texture, every lit
      // draw failed and the screen went black after switching to Low, Medium or Ultra
      sh.map?.setSize(shadow, shadow);
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.resize();
  }

  /**
   * The costly screen effects together: ambient shading, wet-ground reflections, the lamps' glow in the fog. The
   * shading pass also draws the scene itself, so it is never switched off: with the effects off it only stops
   * shading (no strength, fewest samples). Switching it off used to leave the Low setting with a black screen.
   */
  setEffects(on) {
    const ao = this.post.ao;
    ao.enabled = true;
    ao.configuration.intensity = on ? 2.6 : 0;
    if (ao.configuration.aoSamples !== (on ? 8 : 4)) ao.configuration.aoSamples = on ? 8 : 4;
    this.post.glow.enabled = on;
    SSR.on = on;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
  }

  newMatch(game = null) {
    for (const c of this.chars.values()) {
      this.scene.remove(c.char.root);
      this.scene.remove(c.tag);
      if (c.reveal) this.scene.remove(c.reveal);
    }
    this.chars.clear();
    // who sits where on the bus: spread out down the coach rather than packed at the front
    this.seatOf = new Map();
    this.seatOrder = [...Array(24).keys()].sort((a, b) => ((a * 7919) % 24) - ((b * 7919) % 24));
    this.online = !!game?.online;
    if (game) {
      this.game = game;
      this.myId = game.myId;
    } else {
      this.game = new Game({ difficulty: this.profile.difficulty });
      const me = this.game.addPlayer({ name: this.profile.name, outfit: this.profile.outfit, look: this.profile.look });
      this.myId = me.id;
      this.game.fillBots(MAX_PLAYERS);
    }
    this.hud.hideEnd = false;
    this.gpuHeals = 0;
    // what this ride earns toward progression (the standings carry the rest)
    this.rideStats = { parries: 0, chests: 0, possessions: 0 };
    this.rideAward = null;
    this.foeUntil = 0;
    this.foeShow = 0;
    this.foeShownId = null;
    this.foeLast = null;
    this.foeBar.style.display = 'none';
    this.lootVer = -1;
    this.camYaw = 0; // behind the bus as it rolls in
    this.camPitch = -0.15;
    this.camDist = 4.2;
    this.fov = 70;
    this.power = null;
    this.shake = 0;
    this.hurt = 0;
    this.wasState = 'bus';
    this.snap = null;
    this.deathCam = null;
    this.afterDeath = null;
    this.hud.endScreen({ phase: 'launch' });
    this.intro?.el.remove();
    this.intro = new Intro(this.hudRoot);
    // warm everything up during the intro, so nothing freezes the first time it comes into view
    for (const ms of [2500, 8000]) setTimeout(() => this.warmUp(), ms);
  }

  /**
   * Draw the whole world once off-screen with culling off: every shader gets compiled and every texture and
   * mesh uploaded to the GPU now, during the intro, instead of as a hitch the first time it comes into view.
   * Weapons, projectiles and items nobody holds yet are included.
   */
  warmUp() {
    const extras = new THREE.Group();
    const all = [
      ...WEAPON_IDS.map((w) => weaponModel(w, 2)),
      ...['bow', 'crossbow', 'darts', 'harpoon', 'fireworks', 'holy', 'flare'].map((k) => projectileModel(k)),
      ...['tickets', 'holy', 'flare', 'salt', 'relic'].map((k) => itemModel(k)),
    ];
    for (const m of all) extras.add(m);
    // in the background (stage.js): weapons, projectiles and items nobody holds yet, and anything new in the park
    whenCompiled(extras);
    whenCompiled(this.scene);
  }

  mySnap() {
    return this.snap?.players.find((p) => p.id === this.myId);
  }

  selectPower(id) {
    const me = this.snap?.me;
    if (!me || me.state !== 'ghost' || me.possess) return;
    // watching a ride you were not on: no powers
    if (me.spectator) return audio.play('deny');
    const P = POWERS[id];
    const wait = Math.ceil((P.unlock || 0) - (me.ghostTime || 0));
    if (wait > 0) {
      audio.play('deny');
      this.hud.toast(`${P.name} unlocks in ${wait}s`);
      return;
    }
    if (me.riseT > 0 || me.ecto < P.cost || (me.cds[id] || 0) > 0) {
      audio.play('deny');
      return;
    }
    this.power = this.power === id ? null : id;
    audio.play('click');
  }

  // ---------------------------------------------------------------- input

  readInput(dt) {
    const inp = this.input;
    const me = this.snap?.me;
    const p = this.mySnap();
    const g = this.game;
    if (inp.actHit('help')) this.guide.showKeys = !this.guide.showKeys;
    if (inp.actHit('map') && g.phase !== 'launch') this.hud.showMap(!this.hud.mapOpen, 'Map');
    if (inp.actHit('mute')) audio.setMuted(!audio.isMuted());
    // quick chat: open the list, pick a line by its number
    const canChat = this.game?.phase !== 'end' && (this.snap?.me?.state === 'alive' || this.snap?.me?.state === 'ghost') && !this.snap?.me?.spectator;
    if (canChat && inp.actHit('chat')) this.chatOpen = !this.chatOpen;
    if (!canChat || this.pauseMenu.open) this.chatOpen = false;
    if (this.chatOpen) {
      if (inp.hit('Escape')) this.chatOpen = false;
      for (let i = 0; i < CHAT_LINES.length; i++) {
        if (inp.hit(`Digit${i + 1}`)) {
          this.say(i);
          // the number was for the chat, not for a weapon or a power
          inp.pressed.delete(`Digit${i + 1}`);
        }
      }
    }
    this.hud.chatWheel(this.chatOpen, (i) => this.say(i));
    // online, the pause sign does not stop the ride: let go of everything while it is up
    if (this.pauseMenu.open) {
      g.setInput(this.myId, { yaw: this.camYaw, pitch: this.camPitch });
      return;
    }

    // look
    const scoped = this.view?.scoped;
    const sens = 0.0022 * (this.settings.sens || 1) * (scoped ? 0.3 : this.aiming ? 0.6 : 1);
    this.camYaw -= inp.dx * sens;
    this.camPitch = Math.max(-1.3, Math.min(1.25, this.camPitch - inp.dy * sens * (this.settings.invertY ? -1 : 1)));

    // the touch stick is analog: a gentle push walks
    const stick = inp.stick;
    const fwd = stick ? -stick.y : (inp.act('forward') ? 1 : 0) - (inp.act('back') ? 1 : 0);
    const side = stick ? stick.x : (inp.act('right') ? 1 : 0) - (inp.act('left') ? 1 : 0);
    const input = { fwd, side, yaw: this.camYaw, pitch: this.camPitch, fire: false, aim: false, jump: inp.act('jump') };
    if (!me || !p) return;

    if (me.state === 'alive') {
      const g0 = me.slots[me.cur];
      const ranged = !!g0 && WEAPONS[g0.w].type === 'ranged';
      // the prize counter: B opens it at a booth; number keys or clicks buy
      if (this.hud.prizesOpen && (me.booth < 0 || inp.hit('Escape') || inp.actHit('prizes'))) this.closePrizes();
      else if (!this.hud.prizesOpen && me.booth >= 0 && inp.actHit('prizes')) {
        this.hud.prizes(true, me, (id) => this.buy(id));
        inp.unlock();
      }
      if (this.hud.prizesOpen) {
        this.hud.prizes(true, me, (id) => this.buy(id));
        PRIZE_KEYS.forEach((k, i) => {
          if (inp.hit(k) && PRIZES[i]) this.buy(PRIZES[i].id);
        });
        g.setInput(this.myId, { ...input, fwd: 0, side: 0 });
        return;
      }
      // right button aims a launcher, or blocks with a melee weapon (no zoom)
      this.aiming = inp.rmb && ranged;
      input.aim = inp.rmb;
      input.fire = inp.lmb && !this.hud.mapOpen;
      if (inp.actHit('dodge')) g.command(this.myId, { c: 'dodge', fwd, side });
      if (!ranged && p.combat) {
        const foe = this.lockTarget(p);
        if (foe && Math.abs(inp.dx) < 4) {
          const want = Math.atan2(-(foe.x - p.x), -(foe.z - p.z));
          const diff = Math.atan2(Math.sin(want - this.camYaw), Math.cos(want - this.camYaw));
          this.camYaw += diff * Math.min(1, dt * 6);
        }
        this.lockOn = foe;
      } else this.lockOn = null;
      // on touch, pushing the stick all the way sprints
      input.sprint = inp.act('sprint') || (!!stick && Math.hypot(stick.x, stick.y) > 0.95);
      if (inp.actHit('slide')) g.command(this.myId, { c: 'slide' });
      if (inp.actHit('shoulder')) this.shoulder = -(this.shoulder || 1);
      const aim = this.aimPoint();
      input.ayaw = aim.yaw;
      input.apitch = aim.pitch;
      input.aimFrom = aim.from;
      if (inp.actHit('reload')) g.command(this.myId, { c: 'reload' });
      if (inp.actHit('interact')) g.command(this.myId, { c: 'interact', id: me.interact?.id });
      for (let i = 0; i < 3; i++) if (inp.hit(`Digit${i + 1}`)) g.command(this.myId, { c: 'slot', i });
      if (inp.wheel) {
        const n = me.slots.length;
        let i = me.cur;
        for (let k = 0; k < n; k++) {
          i = (i + (inp.wheel > 0 ? 1 : n - 1)) % n;
          if (me.slots[i]) break;
        }
        g.command(this.myId, { c: 'slot', i });
      }
      const items = ['bandage', 'medkit', 'soda', 'holy', 'flare', 'salt', 'relic'];
      items.forEach((item, i) => {
        if (inp.hit(`Digit${(i + 4) % 10}`)) g.command(this.myId, { c: 'use', item });
      });
    } else if (me.state === 'ghost') {
      this.aiming = false;
      input.up = (inp.act('jump') ? 1 : 0) - (inp.act('slide') ? 1 : 0);
      input.fast = inp.act('sprint');
      input.jump = false;
      const ids = Object.keys(POWERS);
      for (let i = 0; i < 6; i++) if (inp.hit(`Digit${i + 1}`)) this.selectPower(ids[i]);
      if (inp.actHit('interact')) {
        if (me.possess) g.command(this.myId, { c: 'release' });
        else if (me.ride) {
          if (me.riseT > 0) audio.play('deny');
          g.command(this.myId, { c: 'possess' });
        }
      }
      if (inp.rmbPressed || inp.hit('Escape')) this.power = null;
      const ground = this.groundAim();
      this.ghostAim = ground;
      if (me.possess?.kind === 'ferris') {
        input.fire = inp.lmb && !this.hud.mapOpen;
        input.aimAt = ground ? [ground.x, ground.y, ground.z] : null;
      } else if (this.power && inp.lmbPressed && !this.hud.mapOpen) {
        this.castPower(p, ground);
      }
    } else if (me.state === 'bus') {
      this.aiming = false;
      // the intro can be skipped; once inside the gates, Space or E steps off the bus
      if (this.intro.active && (inp.hit('Enter') || inp.hit('Escape') || inp.actHit('jump'))) this.intro.skip();
      else if (this.snap.bus.open && (inp.actHit('jump') || inp.actHit('interact') || inp.lmbPressed)) g.command(this.myId, { c: 'jump' });
    }
    g.setInput(this.myId, input);
    void dt;
  }

  /** A sound caption, when they are on (settings.captions): what it was and which way, for important sounds nearby. */
  caption(name, pos, opt) {
    if (!this.settings.captions || this.attract) return;
    const LABEL = {
      step: 'Footsteps', fire: 'Shot', impact: 'Fighting', swing: 'Swing', pain: 'A cry', boom: 'Explosion', chest: 'Chest opened',
      possess: 'A ride wakes up', fling: 'Gondola flung', scare: 'Scream', trapSet: 'Trap set', reload: 'Reloading', land: 'Landing',
      block: 'Blocked blow', splash: 'Holy water', burn: 'Burning',
    };
    const label = LABEL[name];
    if (!label) return;
    const cam = this.camera.position;
    const dx = pos[0] - cam.x;
    const dz = pos[2] - cam.z;
    const d = Math.hypot(dx, dz);
    if (d > (name === 'step' ? 24 : name === 'boom' || name === 'fire' ? 60 : 36)) return;
    // which way, from where the camera looks
    const a = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - this.camYaw), Math.cos(Math.atan2(-dx, -dz) - this.camYaw));
    const dir = d < 3 ? 'close' : Math.abs(a) < 0.6 ? 'ahead' : Math.abs(a) > 2.5 ? 'behind' : a > 0 ? 'left' : 'right';
    this.hud.caption(label, dir);
  }

  /** Say a quick-chat line (CHAT_LINES[i]) and close the list. */
  say(i) {
    this.game.command(this.myId, { c: 'say', line: i });
    this.chatOpen = false;
    this.hud.chatWheel(false);
  }

  buy(id) {
    this.game.command(this.myId, { c: 'buy', prize: id });
    this.hud.prizeKey = null;
  }

  closePrizes() {
    this.hud.prizes(false);
  }

  /** The enemy a melee fighter is squaring up to: the closest one within 5 m and roughly in front of the camera. */
  lockTarget(p) {
    let best = null;
    let bestD = 5;
    const fx = -Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    for (const q of this.snap.players) {
      if (q.id === this.myId || q.state !== 'alive') continue;
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d >= bestD || Math.abs(q.y - p.y) > 2) continue;
      if ((dx * fx + dz * fz) / (d || 1) < Math.cos(1.3)) continue;
      best = q;
      bestD = d;
    }
    return best;
  }

  /**
   * Shots travel along the camera ray, starting level with the player, so they land exactly on the crosshair.
   * (The server checks the start point is close to the player and not through a wall.)
   */
  aimPoint() {
    const cam = this.camera;
    const dir = cam.getWorldDirection(tmpV);
    const from = tmpV2.copy(cam.position).addScaledVector(dir, this.view?.scoped ? 0.3 : this.camDistNow + 0.2);
    return { yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(Math.max(-1, Math.min(1, dir.y))), from: [from.x, from.y, from.z] };
  }

  groundAim() {
    const cam = this.camera;
    const dir = cam.getWorldDirection(tmpV);
    const w = rayWorld(cam.position.x, cam.position.y, cam.position.z, dir.x, dir.y, dir.z, 400);
    if (!w) return null;
    return { x: cam.position.x + dir.x * w.t, y: cam.position.y + dir.y * w.t, z: cam.position.z + dir.z * w.t };
  }

  scareTarget(p) {
    const cam = this.camera;
    const dir = cam.getWorldDirection(tmpV);
    let best = null;
    let bestA = 0.3;
    for (const q of this.snap.players) {
      if (q.state !== 'alive') continue;
      if (Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) > POWERS.scare.range) continue;
      tmpV2.set(q.x - cam.position.x, q.y + 1.1 - cam.position.y, q.z - cam.position.z).normalize();
      const a = Math.acos(Math.min(1, tmpV2.dot(dir)));
      if (a < bestA) {
        bestA = a;
        best = q;
      }
    }
    return best;
  }

  castPower(p, ground) {
    const id = this.power;
    if (id === 'scare') {
      const t = this.scareTarget(p);
      if (!t) return audio.play('deny');
      this.game.command(this.myId, { c: 'power', id, target: t.id });
      this.power = null;
      return;
    }
    if (!ground) return audio.play('deny');
    const P = POWERS[id];
    if (id !== 'storm' && Math.hypot(ground.x - p.x, ground.z - p.z) > P.range) return audio.play('deny');
    if (id === 'storm' && this.snap.zone.state !== 'wait') {
      this.hud.toast('The storm can only be dragged before it starts closing');
      return audio.play('deny');
    }
    this.game.command(this.myId, { c: 'power', id, x: ground.x, y: ground.y, z: ground.z });
    this.power = null;
  }

  // ---------------------------------------------------------------- events

  name(id) {
    return this.game.players.get(id)?.name ?? '???';
  }

  handleEvents(events) {
    const me = this.myId;
    for (const e of events) {
      if (e.id === me && this.rideStats) {
        if (e.e === 'parry') this.rideStats.parries++;
        else if (e.e === 'chest') this.rideStats.chests++;
        else if (e.e === 'possess') this.rideStats.possessions++;
      }
      const ch = e.id !== undefined ? this.chars.get(e.id) : null;
      const pl = e.id !== undefined ? this.game.players.get(e.id) : null;
      const pos = pl ? [pl.x, pl.y + 1, pl.z] : null;
      switch (e.e) {
        case 'swing':
          ch?.char.event(e, this.time);
          audio.play('swing', e.id === me ? null : pos, { w: e.w, heavy: e.heavy, female: FEMALE.has(pl?.outfit) });
          if (e.id === me) this.lastCombat = this.time;
          break;
        case 'fire': {
          ch?.char.event(e, this.time);
          audio.play('fire', e.id === me ? null : pos, { kind: e.kind, self: e.id === me });
          if (e.kind === 'fireworks') {
            const from = ch ? ch.char.muzzle(new THREE.Vector3()) : new THREE.Vector3(...e.o);
            this.fx.muzzle(from, true);
            this.flashLight(from);
            if (e.id === me) this.shake = Math.max(this.shake, 0.3);
          }
          if (e.id === me && (e.kind === 'crossbow' || e.kind === 'harpoon' || e.kind === 'bow')) {
            this.kick += 0.02;
            this.shotPulse = 1;
          }
          break;
        }
        case 'stick':
          this.projectiles.stick(e);
          audio.play('stick', [e.x, e.y, e.z]);
          if (e.on === null) this.fx.impact(e.x, e.y, e.z, 'world');
          break;
        case 'block':
          ch?.char.event(e, this.time);
          audio.play('block', pos, { broke: e.broke });
          if (pl) this.fx.sparkle(pl.x, pl.y + 1.3, pl.z, '#fff2c0', e.broke ? 20 : 8);
          this.strikeFx(pl, this.game.players.get(e.by), !!e.broke, true);
          if (e.by === me) {
            this.hud.hitMarker(false);
            this.combatWord(pl, e.broke ? 'GUARD BROKEN' : 'BLOCKED', e.broke ? 'broke' : 'blocked');
            this.impact(false);
          } else if (e.id === me) this.combatWord(pl, e.broke ? 'GUARD BROKEN' : 'BLOCKED', e.broke ? 'broke' : 'blocked');
          break;
        case 'parry': {
          // the guard went up just in time: a ringing clang, a shower of sparks, and the attacker reels back open
          ch?.char.event({ e: 'block' }, this.time);
          this.chars.get(e.by)?.char.event({ e: 'hit', heavy: true, victim: true }, this.time);
          audio.play('block', pos, { parry: true });
          if (pl) this.fx.sparkle(pl.x, pl.y + 1.4, pl.z, '#ffe08a', 26);
          if (e.id === me) {
            this.combatWord(pl, 'PARRY', 'parry');
            this.slowmo = 0.25;
            this.shake = Math.max(this.shake, 0.3);
            this.impact(true);
          } else if (e.by === me) {
            this.combatWord(this.game.players.get(e.by), 'PARRIED', 'parried');
            this.shake = Math.max(this.shake, 0.45);
            this.impact(true, true);
          }
          break;
        }
        case 'break':
          audio.play('break', pos);
          if (e.id === me) this.hud.toast(`Your ${WEAPONS[e.w].name} broke!`);
          break;
        case 'dodge':
          ch?.char.event(e, this.time);
          audio.play('dodge', pos);
          if (pl) this.fx.dust(pl.x, pl.y + 0.05, pl.z);
          break;
        case 'slide':
          ch?.char.event(e, this.time);
          audio.play('slide', pos, { self: e.id === me });
          if (pl) this.fx.dust(pl.x, pl.y + 0.05, pl.z);
          break;
        case 'dodged':
          if (e.id === me) this.hud.toast('Dodged!');
          break;
        case 'splash':
          audio.play('splash', [e.x, e.y, e.z]);
          for (let i = 0; i < 24; i++) this.fx.add.spawn(e.x, e.y + 0.2, e.z, (Math.random() - 0.5) * 6, Math.random() * 4 + 1, (Math.random() - 0.5) * 6, new THREE.Color('#9fd8ff'), 0.25, 0.6, 9, 1);
          this.fx.ring(e.x, e.y + 0.1, e.z, e.r, '#9fd8ff');
          break;
        case 'burn':
          audio.play('burn', pos);
          if (pl) this.fx.sparkle(pl.x, pl.y + 1, pl.z, '#9fd8ff', 30);
          if (e.id === me) this.hud.banner('HOLY WATER!', 'You are burning: no powers or rides for a moment', 2.5, 'danger');
          else if (e.by === me) this.hud.toast(`You burned ${this.name(e.id)}'s ghost!`);
          break;
        case 'flare':
          audio.play('flare', [e.x, e.y, e.z]);
          break;
        case 'salt':
          audio.play('salt', [e.x, e.y, e.z]);
          break;
        case 'relic':
          audio.play('relic', pos);
          if (pl) this.fx.sparkle(pl.x, pl.y + 1.5, pl.z, '#ffd76a', 30);
          if (e.id === me) this.hud.banner('BLESSED RELIC', 'Ghost attacks can\'t hurt you, and ghosts that come close burn', 2.5, 'alive');
          break;
        case 'bought':
          if (e.id === me) {
            audio.play('bought');
            this.hud.toast(`Won: ${e.label}`);
          }
          break;
        case 'say': {
          const text = CHAT_LINES[e.line];
          if (!text || !pl) break;
          audio.play('click', e.id === me ? null : pos);
          const el = document.createElement('div');
          el.className = `say-bubble ${e.id === me ? 'mine' : ''}`;
          el.textContent = text;
          this.dmgLayer.appendChild(el);
          // (removes any earlier bubble of theirs still showing)
          this.bubbles = (this.bubbles || []).filter((b) => {
            if (b.id !== e.id) return true;
            b.el.remove();
            return false;
          });
          this.bubbles.push({ id: e.id, el, t: 3.2 });
          const meP = this.game.players.get(me);
          if (e.id !== me && (!meP || Math.hypot(pl.x - meP.x, pl.z - meP.z) > 35)) this.hud.feed(`<b>${esc(pl.name)}</b>: ${esc(text)}`, 'say');
          break;
        }
        case 'hit':
          this.chars.get(e.id)?.char.hit();
          if (e.id === me || e.by === me) this.lastCombat = this.time;
          // every hit leaves blood on the one taking it
          if (e.id !== undefined) {
            const fx = this.bodyFx.get(e.id) || { wet: 0, blood: 0 };
            fx.blood = Math.min(1, fx.blood + e.amt / 90);
            this.bodyFx.set(e.id, fx);
          }
          if (e.how === 'fists' || WEAPONS[e.how]?.type === 'melee') {
            const heavy = e.amt > 40;
            this.chars.get(e.id)?.char.event({ e: 'hit', heavy, victim: true }, this.time);
            this.chars.get(e.by)?.char.event({ e: 'hit', heavy }, this.time);
            if (e.by === me || e.id === me) {
              this.shake = Math.max(this.shake, heavy ? 0.45 : 0.22);
              this.impact(heavy, e.id === me);
            }
            // a white-hot flash where it lands, blood thrown on along the line of the blow
            const by = this.game.players.get(e.by);
            this.strikeFx(pl, e.fx != null ? { x: e.fx, z: e.fz } : by, heavy, false);
            // it lands on the ground around them, flung away from the blow
            if (pl && pl.onGround) {
              const a = e.fx != null ? Math.atan2(pl.x - e.fx, pl.z - e.fz) : Math.random() * 6.28;
              const d = 0.4 + Math.random() * (heavy ? 1.2 : 0.6);
              this.fx.blood(pl.x + Math.sin(a) * d, pl.y, pl.z + Math.cos(a) * d, heavy ? 1.1 : 0.55 + Math.random() * 0.3);
            }
          }
          if (e.how === 'fists' || WEAPONS[e.how]?.type === 'melee') {
            audio.play('impact', e.by === me || e.id === me ? null : pos, { w: e.how, heavy: e.amt > 40 });
            // the one taking the blow cries out (most of the time; a grunt on every hit gets tiring)
            if (pl && e.id !== me && Math.random() < 0.6) audio.play('pain', pos, { female: FEMALE.has(pl.outfit) });
          } else if (WEAPONS[e.how] && pl) this.fx.impact(pl.x, pl.y + 1.2, pl.z, e.head ? 'head' : 'player');
          if (e.id === me) {
            this.hurt = Math.min(1, this.hurt + e.amt / 50);
            audio.play('hurt', null, { female: FEMALE.has(pl?.outfit) });
            if (e.fx !== null) {
              const a = Math.atan2(e.fx - pl.x, e.fz - pl.z);
              this.hud.damageFrom(-(a - (this.camYaw + Math.PI)));
            }
          }
          if (e.by === me && e.id !== me) {
            this.hud.hitMarker(e.head);
            this.foeId = e.id;
            this.foeUntil = this.time + 3;
            audio.play('hit', null, { head: e.head });
            this.damageNumber(pl, e.amt, e.head, e.shield);
          }
          break;
        case 'kill': {
          if (e.steal) this.bodyFx.set(e.killer, { ...(this.bodyFx.get(e.victim) || { wet: 0, blood: 0 }) });
          if (e.killer === me && (e.how === 'fists' || WEAPONS[e.how]?.type === 'melee')) this.slowmo = 0.3;
          this.hud.kill(this.snap || {}, e, (id) => this.name(id));
          const v = this.game.players.get(e.victim);
          if (v) this.fx.ecto(v.x, v.y - 1.2, v.z, 24);
          if (v && !e.steal) {
            const fx = this.bodyFx.get(v.id) || { wet: 0, blood: 0 };
            this.corpses.push(new Corpse(v.outfit, v.x, v.y - 1.2, v.z, v.yaw, this.scene, { seed: v.id, ...fx, wear: v.look }, this.deathFall(e, v)));
            // a pool spreads out under the body
            this.fx.blood(v.x, v.y - 1.2, v.z, 1.9 + Math.random() * 0.6, 0.35);
          }
          if (e.victim === me) {
            audio.play('death', null, { female: FEMALE.has(v?.outfit) });
            const k = e.killer != null ? this.game.players.get(e.killer) : null;
            // the death camera: who did it, with what, and how much fight they had left
            this.deathCam = { t: 0, dur: 4.2, killer: e.killer, x: v.x, y: v.y - 1.2, z: v.z, yaw: v.yaw };
            this.slowmo = 0.7;
            this.hud.deathCard({
              killer: k ? this.name(e.killer) : null,
              cause: killCause(e.how),
              hp: k && k.state === 'alive' ? Math.max(1, Math.round(k.hp + k.shield)) : null,
              ghost: !!k && (k.state === 'ghost' || e.steal),
              steal: e.steal,
            });
            this.afterDeath = e.steal
              ? ['YOUR BODY WAS STOLEN', `${this.name(e.killer)} took it. Haunt them back!`, 4]
              : ['YOU DIED', 'Now haunt them. Land a killing blow to steal a body and come back.', 4.5];
            this.power = null;
          } else if (e.killer === me) {
            if (e.steal) {
              audio.play('steal');
              this.hud.banner('BODY STOLEN!', `You are back in ${this.name(e.victim)}'s body. Ghosts can't hurt you for 12s.`, 4, 'alive');
            } else {
              audio.play('kill');
              this.hud.eliminated(this.name(e.victim));
            }
          }
          break;
        }
        case 'busJump':
          if (pl) this.fx.dust(e.x, 0.1, e.z);
          audio.play('hiss', [e.x, 1, e.z]);
          if (e.id === me) this.hud.banner(nearestRegion(e.x, e.z).toUpperCase(), '', 2.5);
          break;
        case 'chest':
          this.fx.sparkle(e.x, e.y + 0.5, e.z);
          audio.play('chest', [e.x, e.y, e.z]);
          break;
        case 'pickup':
          if (e.id === me) {
            audio.play('pickup');
            this.hud.toast(e.label);
          }
          break;
        case 'full':
          if (e.id === me) this.hud.toast(`${e.label} is full`);
          break;
        case 'reload':
          audio.play('reload', e.id === me ? null : pos);
          break;
        case 'possess':
          audio.play('possess', pos);
          if (pl) this.fx.ecto(pl.x, pl.y - 1, pl.z, 30);
          break;
        case 'fling':
          audio.play('fling', e.from);
          break;
        case 'boom': {
          this.fx.explosion(e.x, e.y, e.z, e.r, e.kind);
          audio.play('boom', [e.x, e.y, e.z], { kind: e.kind });
          const p = this.mySnap();
          if (p) this.shake = Math.max(this.shake, Math.max(0, 1 - Math.hypot(p.x - e.x, p.z - e.z) / 30));
          break;
        }
        case 'snap':
          audio.play('snap', [e.x, e.y, e.z]);
          if (e.id === me) this.hud.banner('BEAR TRAP!', 'Stuck for a moment', 1.5, 'danger');
          break;
        case 'trapSet':
          if (this.snap?.me?.state === 'ghost') audio.play('trapSet', [e.x, e.y, e.z]);
          break;
        case 'scare':
          if (e.id === me) {
            this.hud.scare();
            audio.play('scream');
            this.shake = 1;
          } else if (e.by === me) this.hud.toast(`Scared ${this.name(e.id)}! Everyone can see them`);
          break;
        case 'steps':
          audio.play('steps', [e.x, e.y, e.z]);
          break;
        case 'blackout':
          audio.play('blackout', [e.x, 2, e.z]);
          break;
        case 'storm':
          audio.play('storm');
          this.hud.feed('The ghosts dragged the storm!', 'steal');
          break;
        case 'bump':
          audio.play('honk', [e.x, 1, e.z]);
          break;
        // bodies and cars meeting (shared/physics.js contacts)
        case 'shove':
          this.chars.get(e.id)?.char.hit();
          audio.play('impact', [e.x, e.y, e.z]);
          if (e.id === me) this.hud.toast?.('Shoved!');
          break;
        // breakable props (shared/game.js): a blow that doesn't break it kicks up dust; one that does, the pieces fly
        case 'prophit': {
          const b = BREAKABLES[e.id];
          if (b) {
            this.fx.dust(b.x, Math.min(1, b.h / 2), b.z);
            audio.play('block', [b.x, 1, b.z]);
          }
          break;
        }
        case 'propbreak': {
          const b = BREAKABLES[e.id];
          if (!b) break;
          this.syncProp(e.id, true);
          shatter(this.scene, e.id, e.dx || 0, e.dz || 0, e.f || 3);
          this.fx.dust(b.x, 0.4, b.z);
          this.fx.dust(b.x, Math.min(1.2, b.h / 2), b.z);
          audio.play('impact', [b.x, 1, b.z], { w: 'sledge', heavy: true });
          break;
        }
        case 'carbump':
          audio.play('impact', [e.x, 1, e.z]);
          if (e.hard > 0.4) audio.play('honk', [e.x, 1, e.z]);
          break;
        case 'wallhit':
          this.chars.get(e.id)?.char.hit();
          audio.play('impact', [e.x, e.y, e.z]);
          break;
        case 'zone':
          if (e.state === 'shrink') this.hud.toast('The storm is closing in!');
          break;
        case 'final': {
          audio.play('final');
          audio.setMusicIntensity(1);
          const who = e.survivor === me ? 'You are the last one alive. Survive!' : `${this.name(e.survivor)} is the last one alive. Steal their body!`;
          this.hud.banner('THE FINAL RIDE', who, 4, 'danger');
          break;
        }
        case 'end':
          audio.setMusicIntensity(0);
          if (e.winner === me) audio.play('win');
          this.hud.banner(e.winner === me ? 'YOU SURVIVED' : 'RIDE OVER', `${this.name(e.winner)} survived the Last Ride`, 4);
          break;
        case 'live':
          this.hud.banner('THE DOORS ARE OPEN', `Jump off whenever you like · tonight: ${(NIGHTS[this.snap?.night] || NIGHTS.storm).name}`, 3);
          break;
        default:
      }
    }
  }

  /** A brief flash of light from a muzzle (one shared light: only the nearest shot matters). */
  flashLight(pos) {
    const d = pos.distanceTo(this.camera.position);
    if (d > 40 || (this.muzzleLight.intensity > 5 && d > this.muzzleLightD)) return;
    this.muzzleLight.position.copy(pos);
    this.muzzleLight.intensity = 45;
    this.muzzleLightD = d;
  }

  damageNumber(p, amt, head, shield) {
    if (!p) return;
    const el = document.createElement('div');
    el.className = `dmg ${head ? 'head' : ''} ${shield ? 'shield' : ''} ${amt >= 30 ? 'big' : ''}`;
    el.textContent = amt;
    this.dmgLayer.appendChild(el);
    this.dmgNums.push({ el, x: p.x + (Math.random() - 0.5) * 0.6, y: p.y + 2, z: p.z, t: 0.9 });
  }

  /**
   * Camera motion blur: the grade pass smears each pixel back toward where its point was a frame ago. Off in
   * cinematics, through camera cuts (a jump of more than a few metres), and when the player turns it off.
   */
  updateMotionBlur(dt) {
    const g = this.post.grade;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const vp = (this.mbVP ??= new THREE.Matrix4()).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const moved = this.mbPos ? cam.position.distanceTo(this.mbPos) : 99;
    const on = this.settings.motionBlur !== false && !this.cine && !this.deathCam && moved < 3 && dt > 0;
    // a 60 fps shutter: slower frames would otherwise smear more
    g.blur.value = on ? Math.min(1, (1 / 60) / dt) * 0.6 : 0;
    g.prevViewProj.value.copy(this.mbPrev ?? vp);
    g.invViewProj.value.copy(vp).invert();
    (this.mbPrev ??= new THREE.Matrix4()).copy(vp);
    (this.mbPos ??= new THREE.Vector3()).copy(cam.position);
  }

  /**
   * Safety net for lit draws failing (WebGL logs "Mismatch between texture format and sampler type"; riders vanish).
   * The known cause, shaders built for the removed soft shadow mode, is fixed by asking for PCF from the start; if it
   * ever happens again, rebuilding the shaders clears it: toggling the moon's shadow changes every lit program.
   * Checked every two seconds (reading the GL error stalls the GPU a little), at most three repairs a match.
   */
  checkGpu() {
    if (this.gpuHeal === 'off') {
      this.moonLight.castShadow = true;
      this.gpuHeal = null;
      return;
    }
    this.gpuTick = (this.gpuTick || 0) + 1;
    if (this.gpuTick % 120 || (this.gpuHeals || 0) >= 3) return;
    const gl = this.renderer.getContext();
    if (gl.getError() !== gl.INVALID_OPERATION) return;
    this.gpuHeals = (this.gpuHeals || 0) + 1;
    console.warn('graphics state repaired (lit draws were failing)');
    this.moonLight.castShadow = false;
    this.gpuHeal = 'off';
  }

  /** A word over a fighter: BLOCKED, PARRY, GUARD BROKEN. */
  combatWord(p, text, cls) {
    if (!p) return;
    const el = document.createElement('div');
    el.className = `dmg word ${cls}`;
    el.textContent = text;
    this.dmgLayer.appendChild(el);
    this.dmgNums.push({ el, x: p.x, y: p.y + 2.25, z: p.z, t: 1.1 });
  }

  /**
   * Where a rider's eyes go: yours follow the camera; anyone else watches the nearest living rider in front of them
   * (within 9 m), held for a moment so heads don't flick between people.
   */
  lookTarget(p, snap) {
    if (p.id === this.myId) {
      const d = this.camera.getWorldDirection(this.tmpLook || (this.tmpLook = new THREE.Vector3()));
      return { x: p.x + d.x * 20, y: this.camera.position.y + d.y * 20, z: p.z + d.z * 20 };
    }
    const c = this.chars.get(p.id);
    if (!c) return null;
    if (c.lookUntil > this.time) {
      const q = snap.players.find((o) => o.id === c.lookId);
      if (q && q.state === 'alive') return { x: q.x, y: q.y + 1.6, z: q.z };
    }
    let best = null;
    let bd = 81;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    for (const q of snap.players) {
      if (q.id === p.id || q.state !== 'alive') continue;
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd && d2 > 0.04 && dx * fx + dz * fz > -0.2 * Math.sqrt(d2)) {
        bd = d2;
        best = q;
      }
    }
    c.lookId = best ? best.id : null;
    c.lookUntil = this.time + 0.8 + Math.random() * 0.8;
    return best ? { x: best.x, y: best.y + 1.6, z: best.z } : null;
  }

  /** The flash, sparks and blood of a melee blow on p, struck from 'from' (anything with x and z). */
  strikeFx(p, from, heavy, blocked) {
    if (!p) return;
    let dx = from ? p.x - from.x : Math.random() - 0.5;
    let dz = from ? p.z - from.z : Math.random() - 0.5;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // contact is on the near side of the body, chest high
    this.fx.strike(p.x - dx * 0.3, p.y + (heavy ? 1.35 : 1.2), p.z - dz * 0.3, dx, dz, heavy, blocked);
  }

  /** The camera jolts toward a blow you land and away from one you take. heavy: a bigger jolt. */
  impact(heavy, taken = false) {
    this.pads?.rumble(heavy || taken);
    this.punch = Math.max(this.punch || 0, heavy ? 1 : 0.6);
    this.kick += (taken ? -1 : 1) * (heavy ? 0.035 : 0.02) * (this.settings.shake ?? 1);
    this.kickYaw += (Math.random() - 0.5) * (heavy ? 0.05 : 0.025);
  }

  // ---------------------------------------------------------------- per-frame

  frame(dt) {
    this.time += dt;
    this.readInput(dt);
    this.input.endFrame();

    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 4) {
      // remember where everyone was, so frames between sim ticks can be drawn in between
      for (const p of this.game.players.values()) {
        const pv = this.prev.get(p.id) || {};
        pv.x = p.x;
        pv.y = p.y;
        pv.z = p.z;
        pv.yaw = p.yaw;
        this.prev.set(p.id, pv);
      }
      this.game.update(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === 4) this.acc = 0;

    this.snap = this.game.snapshot(this.myId, this.lootVer);
    const snap = this.snap;
    // smooth motion on high refresh screens: draw everyone part-way between the last two sim ticks
    const alpha = Math.min(1, this.acc / STEP);
    for (const p of snap.players) {
      const pv = this.prev.get(p.id);
      if (!pv || Math.hypot(p.x - pv.x, p.z - pv.z) > 4) continue;
      p.x = pv.x + (p.x - pv.x) * alpha;
      p.y = pv.y + (p.y - pv.y) * alpha;
      p.z = pv.z + (p.z - pv.z) * alpha;
      // ghosts and bus riders face the camera; survivors turn their bodies in the sim (toward where they run)
      if (p.id === this.myId && (p.state === 'ghost' || p.state === 'bus')) p.yaw = this.camYaw;
      else p.yaw = pv.yaw + Math.atan2(Math.sin(p.yaw - pv.yaw), Math.cos(p.yaw - pv.yaw)) * alpha;
    }
    if (snap.loot) {
      this.lootView.sync(snap.loot);
      this.lootVer = snap.lootVer;
    }
    this.handleEvents(this.game.drainEvents());

    const me = snap.me;
    if (me && me.state !== this.wasState) {
      if (me.state === 'ghost') audio.play('ghost');
      if (this.wasState === 'ghost' && me.state === 'alive') this.power = null;
      this.wasState = me.state;
    }
    if (!me || me.state !== 'ghost' || me.possess) this.power = null;

    this.updateCharacters(snap, dt);
    // loose bodies can be shoved by riders walking into them and by bumper cars
    const near = this.corpses.length || debrisCount() ? this.bodyPushers(snap, dt) : null;
    this.corpses = this.corpses.filter((c) => c.update(dt, near));
    stepRagdolls(dt);
    stepDebris(dt, near);
    this.syncBroken(snap);
    this.rides.update(snap, dt, this.time);
    this.fx.update(dt, this.time, snap.zone);
    this.lootView.update(this.time, this.camera.position, this.intro.active, this.camera.getWorldDirection(this.lootDir ??= new THREE.Vector3()));
    this.projectiles.update(snap, dt, this.time, this.camera.position);
    this.updateWeather(dt);
    this.updateCamera(snap, dt);
    // tonight's rain, easing and thickening over a few minutes between its low and its high
    const night = NIGHTS[snap.night] || NIGHTS.storm;
    this.night = night;
    const rainAmount = night.rain[0] + (night.rain[1] - night.rain[0]) * (0.5 + Math.sin(this.time * 0.05) * 0.5);
    this.rain.update(dt, this.camera, { amount: rainAmount, flash: this.weather.flash, bus: snap.bus });
    groundRain.time.value = this.time % 1000;
    windTime.value = this.time % 1000;
    blowWind(dt, NIGHT_WIND[snap.night] ?? NIGHT_WIND.storm);
    groundRain.amount.value = rainAmount;
    // (on a dry night the park is still wet from the rain before)
    sceneWet.value = Math.max(rainAmount, 0.35);
    this.rainAmount = rainAmount;
    // only the plants, trees and props in view (and close by, for shadows) get drawn
    cullInstances(this.camera);
    // the night mist is thicker out in the woods than inside the lit park
    const out = Math.max(Math.abs(this.camera.position.x), Math.abs(this.camera.position.z)) - PARK_EDGE;
    this.scene.fog.density = (0.0068 + Math.min(1, Math.max(0, out / 120)) * 0.003) * (this.night?.fog ?? 1);
    this.lamps.update(snap.blackouts, this.time, this.camera.position.x, this.camera.position.z, this.intro.power(snap));
    updateLampLight(snap.blackouts, this.intro.power(snap));
    this.bus.update(snap.bus, true, dt, { cabin: this.cine ? this.cine.cabin : 0 });
    // the tour's driver never leaves his seat
    const ds = this.bus.driverSeat(this.driverPos || (this.driverPos = new THREE.Vector3()));
    this.driver.root.position.copy(ds);
    this.driver.animate({ state: 'alive', x: ds.x, y: ds.y, z: ds.z, yaw: snap.bus.yaw, vx: 0, vy: 0, vz: 0, onGround: true, wpn: null, rarity: 0 }, dt, this.time, { seat: 'drive' });
    this.updateTargeting(snap);
    this.updateAudio(snap);
    this.updateDamageNumbers(dt);
    this.updateFoeBar(snap, dt);
    this.updateBubbles(snap, dt);

    // HUD
    const p = this.mySnap();
    const g = me?.slots?.[me.cur];
    const wdef = g ? WEAPONS[g.w] : FISTS;
    const melee = wdef.type === 'melee';
    let spreadDeg = 0;
    let charge = 0;
    if (me?.state === 'alive') {
      if (!melee) {
        spreadDeg = this.aiming ? 0.4 : 1.6;
        if (p && Math.hypot(p.vx, p.vz) > 1.5) spreadDeg *= 1.8;
        if (p && !p.onGround) spreadDeg *= 2;
        if (wdef.draw) charge = me.charge / (wdef.draw * RARITIES[g.rarity].speed);
      } else if (me.charge > 0) charge = Math.min(1, me.charge / HEAVY.fullT);
    }
    const focal = window.innerHeight / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    this.view = {
      camYaw: this.camYaw,
      power: this.power,
      scoped: this.view?.scoped,
      spreadPx: Math.max(4, Math.tan((spreadDeg * Math.PI) / 360) * focal) + this.shotPulse * 8,
      inRange: this.targetInRange,
      scareTarget: this.scareName,
      melee: melee && me?.state === 'alive',
      charge,
    };
    this.view.scoped = false;
    this.hudRoot.classList.toggle('cinematic', this.intro.active);
    // while the death camera runs, the card saying who did it is the only thing on screen
    this.hudRoot.classList.toggle('dying', !!this.deathCam);
    this.hud.update(snap, dt, this.view);
    this.touch?.update();
    this.hud.scoreboard(snap, this.input.down('Tab'));
    this.guide.update(snap, this);
    // the ride is over: add up what it earned, once, for the results sign
    if (snap.phase === 'end' && snap.standings && !this.rideAward) {
      const mine = snap.standings.find((s) => s.id === this.myId);
      if (mine) this.rideAward = award(loadProgress(), { ...this.rideStats, place: mine.place, of: snap.standings.length, kills: mine.kills, ghostKills: mine.ghostKills, revives: mine.revives, dmg: mine.dmg, alive: mine.alive });
    }
    this.hud.endScreen(snap, () => (this.online ? this.onAgain?.() : this.newMatch()), () => location.reload(), this.rideAward);

    // post
    this.hurt = Math.max(0, this.hurt - dt * 0.8);
    const lowHp = p && p.state === 'alive' && p.hp < 30 ? 0.35 + Math.sin(this.time * 6) * 0.1 : 0;
    const gu = this.post.grade;
    // ghost vision fades in once the death camera has played (you see your death as the living did)
    gu.ghost.value += ((me?.state === 'ghost' && !this.deathCam ? 1 : 0) - gu.ghost.value) * Math.min(1, dt * 3);
    this.hudRoot.classList.toggle('deathcam', !!this.deathCam);
    let dark = 0;
    if (p && p.state === 'alive') {
      for (const b of snap.blackouts) if (Math.hypot(p.x - b.x, p.z - b.z) < b.r) dark = Math.max(dark, Math.min(1, b.t, (b.dur - b.t) * 2));
    }
    gu.dark.value += (dark - gu.dark.value) * Math.min(1, dt * 4);
    gu.hurt.value = Math.max(this.hurt, lowHp);
    const outside = p && p.state === 'alive' && Math.hypot(p.x - snap.zone.cx, p.z - snap.zone.cz) > snap.zone.r && snap.zone.state !== 'idle';
    gu.storm.value += ((outside ? 1 : 0) - gu.storm.value) * Math.min(1, dt * 3);
    gu.time.value = this.time;

    // the moon never moves: re-render its shadow map every other frame (moving people lag by one frame at most)
    this.renderer.shadowMap.autoUpdate = false;
    this.shadowTick = ((this.shadowTick || 0) + 1) % (this.shadowEvery || 2);
    if (this.shadowTick === 0 || this.cine) this.renderer.shadowMap.needsUpdate = true;
    gu.cine.value = this.cine ? 1 : 0;
    if (this.cine) gu.hurt.value = gu.storm.value = 0;
    // the death camera holds focus on your killer; the rest of the world goes soft
    else if (this.deathCam) this.post.setDof(this.deathFocus || 6, 0.45);
    else this.post.setDof(10, 0);

    this.updateMotionBlur(dt);
    this.post.composer.render(dt);
    this.checkGpu();
  }

  updateCharacters(snap, dt) {
    const meP = this.mySnap();
    const ghostView = (!meP || meP.state === 'ghost' || snap.phase === 'end') && !this.deathCam;
    const seen = new Set();
    for (let p of snap.players) {
      seen.add(p.id);
      let c = this.chars.get(p.id);
      if (!c) {
        const char = new Character(p.outfit, p.id);
        char.wear(p.look);
        const style = lookItem('tag', p.look?.tag);
        const tag = nameTag(p.name, style.color, style.glow);
        this.scene.add(char.root, tag);
        c = { char, tag, reveal: null };
        this.chars.set(p.id, c);
      }
      const ch = c.char;
      // riders sit in their seats on the bus until they step off
      let seat = null;
      if (p.state === 'bus' && snap.phase !== 'end') {
        if (!this.seatOf.has(p.id)) this.seatOf.set(p.id, this.seatOrder[this.seatOf.size]);
        const at = this.bus.seat(this.seatOf.get(p.id), c.seatPos || (c.seatPos = new THREE.Vector3()));
        if (at) seat = { ...p, x: at.x, y: at.y, z: at.z, yaw: snap.bus.yaw, vx: 0, vy: 0, vz: 0, onGround: true };
      }
      if (seat) p = seat;
      const hidden = (p.state === 'bus' && !seat) || (p.id === this.myId && this.view?.scoped);
      // (tracked for everyone, seen or not) out in the rain they soak through in under half a minute; under a roof (or on the bus) they slowly dry
      if (p.state === 'alive') {
        const fx = this.bodyFx.get(p.id) || { wet: 0, blood: 0 };
        const covered = seat || sheltered(p.x, p.y + 1.6, p.z, snap.bus);
        fx.wet = covered ? Math.max(0, fx.wet - dt / 90) : Math.min(1, fx.wet + (dt / 25) * (this.rainAmount || 0));
        this.bodyFx.set(p.id, fx);
        ch.setLook(fx.wet, fx.blood);
      }
      // skip characters that cannot be seen: far into the fog, or behind the camera
      const cdx = p.x - this.camera.position.x;
      const cdz = p.z - this.camera.position.z;
      const cd = Math.hypot(cdx, cdz);
      const fwdX = -Math.sin(this.camYaw);
      const fwdZ = -Math.cos(this.camYaw);
      const behind = !seat && cd > 8 && (cdx * fwdX + cdz * fwdZ) / cd < -0.35;
      const culled = cd > 130 || behind;
      ch.root.visible = !hidden && !culled;
      // ghosts are see-through wisps: the simplified body is plenty for them unless one is right in your face
      ch.detail(Math.hypot(cd, p.y - this.camera.position.y) + (p.state === 'ghost' && p.id !== this.myId ? 18 : 0));
      if (culled) {
        c.tag.visible = false;
        if (c.reveal) c.reveal.visible = false;
        continue;
      }
      // only nearby characters cast shadows
      const shadow = cd < 22 && p.state !== 'ghost';
      if (ch.shadowOn !== shadow) {
        ch.shadowOn = shadow;
        ch.model.traverse((o) => {
          if (o.isMesh && o.material !== ch.ghostMat) o.castShadow = shadow;
        });
      }
      ch.root.position.set(p.x, p.y, p.z);
      // how they're moving, so a death carries it on (ragdolls)
      if (p.state === 'alive') c.vel = [p.vx || 0, p.vy || 0, p.vz || 0];
      let ghostOpacity = 1;
      if (p.state === 'ghost') {
        // survivors only catch a faint shimmer, brighter for a moment after a ghost uses a power
        ghostOpacity = ghostView || p.exposed ? 0.9 : 0.12 + Math.min(1, p.flash / 1.6) * 0.75;
        // your own wraith sits right in front of the camera: keep it faint and its mist thin so it doesn't block the view
        const mine = p.id === this.myId;
        if (mine) ghostOpacity = 0.35;
        // black mist trailing behind the wraith
        if (Math.random() < (mine ? 0.06 : ghostView ? 0.5 : 0.15 + p.flash * 0.3)) this.fx.mist(p.x, p.y + 0.6, p.z);
        if (p.possess === 'coaster' || p.possess === 'car') ch.root.position.y -= 0.4;
      }
      // far-away characters animate at a lower rate (nobody can tell, and it saves a lot of CPU)
      const every = p.id === this.myId || cd < 30 ? 1 : cd < 70 ? 2 : 4;
      c.adt = (c.adt || 0) + dt;
      c.tick = ((c.tick || 0) + 1) % every;
      if (c.tick !== 0) continue;
      ch.animate(p, c.adt, this.time, { ghostOpacity, eyes: ghostView || p.flash > 0, lastShotAt: this.time - (snap.time - p.lastShot), seat: seat ? (p.id % 3 ? 'sit' : 'sit2') : null, lookAt: cd < 25 ? this.lookTarget(p, snap) : null });
      c.adt = 0;
      // a landing you can hear and see: the thud, a splash or a puff of dirt, and for you the camera takes the drop
      if (ch.landed > 3 && cd < 32) {
        const hard = Math.min(1, (ch.landed - 3) / 12);
        audio.play('land', p.id === this.myId ? null : [p.x, p.y, p.z]);
        const stone = pathDistance(p.x, p.z) < 0;
        const wet = sheltered(p.x, p.y + 1.6, p.z, snap.bus) ? 0 : this.rainAmount || 0;
        if (wet > 0.1) for (const s of [-1, 1]) this.fx.footSplash(p.x + Math.cos(p.yaw) * 0.14 * s, p.y, p.z - Math.sin(p.yaw) * 0.14 * s, p.vx, p.vz, Math.min(1, wet * (1 + hard)), true, stone);
        if (!stone && hard > 0.25) this.fx.dust(p.x, p.y, p.z);
        if (p.id === this.myId) {
          this.landDip = Math.max(this.landDip || 0, 0.25 + hard * 0.75);
          if (hard > 0.4) this.shake = Math.max(this.shake, hard * 0.35);
        }
      }
      // footsteps: stone on the walkways, softer on dirt and grass
      if (ch.step && cd < 28) {
        const surface = pathDistance(p.x, p.z) < 0 ? 'stone' : 'dirt';
        const wet = sheltered(p.x, p.y + 1.6, p.z, snap.bus) ? 0 : this.rainAmount || 0;
        audio.play('step', p.id === this.myId ? null : [p.x, p.y, p.z], { surface, run: Math.hypot(p.vx, p.vz) > 4, self: p.id === this.myId, wet });
        // and you can see it: water kicked up from the foot coming down (left, right, left...)
        if (wet > 0.1 && cd < 18 && p.state !== 'ghost') {
          c.foot = -(c.foot || 1);
          const side = c.foot * 0.12;
          const fx = Math.cos(p.yaw) * side;
          const fz = -Math.sin(p.yaw) * side;
          this.fx.footSplash(p.x + fx, p.y, p.z + fz, p.vx, p.vz, wet, Math.hypot(p.vx, p.vz) > 4, surface === 'stone');
        }
      }
      ch.root.updateMatrixWorld();
      // name tags
      const dist = meP ? Math.hypot(p.x - meP.x, p.z - meP.z) : 0;
      const showTag = p.id !== this.myId && !hidden && !seat && !(p.id === this.foeShownId && this.foeShow > 0.3) && (p.state === 'ghost' ? (ghostView || p.exposed) && dist < 40 : dist < (ghostView ? 35 : 22));
      c.tag.visible = showTag;
      c.tag.material.depthTest = !ghostView;
      // names fade in as people come close (ghosts read them from further off)
      c.tag.material.opacity = Math.min(1, Math.max(0, ((ghostView ? 35 : 22) - dist) / 7));
      c.tag.position.set(p.x, p.y + (p.state === 'ghost' ? 2.6 : 2.35), p.z);
      // revealed by a jump scare: a red beacon everyone can see through walls
      if (p.revealed && p.state === 'alive') {
        if (!c.reveal) {
          c.reveal = new THREE.Sprite(this.revealMat);
          c.reveal.scale.set(0.9, 0.9, 1);
          c.reveal.renderOrder = 11;
          this.scene.add(c.reveal);
        }
        c.reveal.visible = Math.floor(this.time * 5) % 2 === 0;
        c.reveal.position.set(p.x, p.y + 3.1, p.z);
      } else if (c.reveal) c.reveal.visible = false;
    }
    for (const [id, c] of this.chars) {
      if (seen.has(id)) continue;
      this.scene.remove(c.char.root, c.tag);
      if (c.reveal) this.scene.remove(c.reveal);
      this.chars.delete(id);
    }
  }

  updateCamera(snap, dt) {
    const cam = this.camera;
    const p = this.mySnap();
    const me = snap.me;
    const baseFov = this.settings.fov || 72;
    let fov = baseFov;
    this.shake = Math.max(0, this.shake - dt * 1.5);
    this.kick *= Math.exp(-dt * 9);
    this.kickYaw *= Math.exp(-dt * 9);
    this.punch = (this.punch || 0) * Math.exp(-dt * 12);
    this.shotPulse = Math.max(0, this.shotPulse - dt * 6);
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 900);
    const shakeK = this.settings.shake ?? 1;
    const shake = this.shake * this.shake * 0.4 * shakeK;

    this.cine = this.intro.update(snap, cam);
    // indoors (the shot up the bus aisle) there is no open sky: the cabin light does the lighting
    const inside = this.cine?.interior ? 1 : 0;
    // lightning floods the sky (only a glimmer of it reaches inside)
    const flash = this.weather.flash * (1 - inside * 0.75);
    this.hemi.intensity = 1.15 - inside * 0.95 + flash * 1.6;
    if (this.scene.environment) this.scene.environmentIntensity = 0.65 - inside * 0.5 + flash * 0.8;
    this.scene.backgroundIntensity = (0.6 * (this.night?.sky ?? 1) + flash * 1.6) * SKY_SCALE;
    this.moonLight.intensity = (2.1 - inside * 1.7) * (this.night?.moon ?? 1) + flash * 5;
    setCharacterRim(1 - inside);
    if (this.cine) {
      this.camDistNow = 4;
      // cuts change lens at once
      fov = this.fov = this.cine.fov;
      this.post.setDof(this.cine.focus, this.cine.aperture);
    } else if (this.deathCam) {
      // you fell: from just behind your body the view turns to whoever did it, and slowly pushes in
      const d = this.deathCam;
      d.t += dt;
      const k = d.killer != null ? this.game.players.get(d.killer) : null;
      const u = Math.min(1, d.t / d.dur);
      const ease = u * u * (3 - 2 * u);
      let lx = d.x;
      let ly = d.y + 0.6;
      let lz = d.z;
      let dx = Math.sin(d.yaw);
      let dz = Math.cos(d.yaw);
      if (k && Math.hypot(k.x - d.x, k.z - d.z) > 0.5) {
        lx = k.x;
        ly = k.y + (k.state === 'ghost' ? 0.5 : 1.35);
        lz = k.z;
        const l = Math.hypot(d.x - k.x, d.z - k.z);
        dx = (d.x - k.x) / l;
        dz = (d.z - k.z) / l;
      }
      // a little off to the side, low, drifting closer
      const back = 2.8 - ease * 1.1;
      const side = 0.9 - ease * 0.5;
      cam.position.set(d.x + dx * back - dz * side, d.y + 1.25 + ease * 0.25, d.z + dz * back + dx * side);
      cam.lookAt(lx, ly, lz);
      fov = this.fov = 52 - ease * 8;
      this.deathFocus = Math.hypot(lx - cam.position.x, ly - cam.position.y, lz - cam.position.z);
      if (d.t >= d.dur) {
        this.deathCam = null;
        this.hud.deathCard(null);
        if (this.afterDeath) this.hud.banner(...this.afterDeath, 'ghost');
        this.afterDeath = null;
      }
    } else if (!p || (p.state === 'bus' && snap.phase !== 'end')) {
      // riding the bus: orbit it with the mouse
      const b = snap.bus;
      // close and low enough to pass under the gate sign, pulled in when something stands in the way
      const [fx, fy, fz] = dirFromAngles(this.camYaw, Math.min(0.15, this.camPitch - 0.18));
      let bd = 9.5;
      const rl = Math.hypot(fx, fy - 0.12, fz);
      const hit = rayWorld(b.x, 2.6, b.z, -fx / rl, (-fy + 0.12) / rl, -fz / rl, bd * rl + 0.5);
      if (hit) bd = Math.max(3, (hit.t - 0.5) / rl);
      cam.position.set(b.x - fx * bd, 2.6 - fy * bd + bd * 0.12, b.z - fz * bd);
      cam.lookAt(b.x, 2.2, b.z);
      this.camDistNow = 4;
    } else if (snap.phase === 'end' && snap.winner) {
      const w = snap.players.find((q) => q.id === snap.winner) || p;
      const a = this.time * 0.25;
      cam.position.set(w.x + Math.sin(a) * 7, w.y + 3.5, w.z + Math.cos(a) * 7);
      cam.lookAt(w.x, w.y + 1.4, w.z);
    } else if (me?.possess?.kind === 'coaster') {
      // ride up front
      const t = trackAt(snap.coaster.s + 1.5);
      cam.position.set(t.x, t.y + 2.3, t.z);
      cam.lookAt(t.x + t.tx * 10, t.y + 2.0 + t.ty * 10, t.z + t.tz * 10);
      fov = 85;
    } else {
      const scoped = this.view?.scoped;
      const ghost = p.state === 'ghost';
      const car = me?.possess?.kind === 'car';
      const meleeCam = !ghost && !car && !this.aiming;
      // in a fight the camera pulls out and over the shoulder so the one you are fighting stays in view
      const fight = meleeCam && this.lockOn ? 1 : 0;
      this.fightCam = (this.fightCam ?? 0) + (fight - (this.fightCam ?? 0)) * Math.min(1, dt * 4);
      const fc = this.fightCam;
      let dist = car ? 7 : ghost ? 4.4 : this.aiming ? 1.8 : 3.7 + fc * 0.9;
      let side = ghost || car ? 0 : (this.aiming ? 0.62 : meleeCam ? 0.62 + fc * 0.5 : 0.75) * (this.shoulder || 1);
      const up = car ? 1.8 : 0.32 + fc * 0.25;
      // smooth the pivot so landing, stepping and sliding don't jerk the camera
      // a landing pushes the camera down for a moment (springing back as landDip fades)
      this.landDip = (this.landDip || 0) * Math.exp(-dt * 7);
      const targetY = p.y + (ghost ? 1.3 : p.slide ? 1.0 : this.lockOn ? 1.45 : 1.6) - this.landDip * 0.32;
      if (!this.pivot || Math.hypot(this.pivot.x - p.x, this.pivot.z - p.z) > 3) this.pivot = new THREE.Vector3(p.x, targetY, p.z);
      const follow = 1 - Math.exp(-dt * 16);
      this.pivot.x += (p.x - this.pivot.x) * follow;
      this.pivot.z += (p.z - this.pivot.z) * follow;
      this.pivot.y += (targetY - this.pivot.y) * Math.min(1, dt * 14);
      const pivot = this.pivot;
      const [fx, fy, fz] = dirFromAngles(this.camYaw + this.kickYaw, Math.min(1.35, this.camPitch + this.kick));
      const rx = Math.cos(this.camYaw);
      const rz = -Math.sin(this.camYaw);
      if (scoped) {
        dist = 0;
        side = 0;
        fov = 16;
      } else if (this.aiming) fov = 55;
      else if (p.slide) fov = baseFov + 10;
      else if (p.sprint) fov = baseFov + 7;
      if (!ghost && !scoped) {
        // keep the camera out of walls
        const dx = -fx * dist + rx * side;
        const dy = -fy * dist + up;
        const dz = -fz * dist + rz * side;
        const len = Math.hypot(dx, dy, dz);
        const hit = rayWorld(pivot.x, pivot.y, pivot.z, dx / len, dy / len, dz / len, len + 0.35);
        // the tour bus too: step off beside it and the camera over your shoulder would sit inside its dark cabin
        const busT = snap.bus ? rayBus(snap.bus, pivot.x, pivot.y, pivot.z, dx / len, dy / len, dz / len, len + 0.35) : Infinity;
        const t = Math.min(hit ? hit.t : Infinity, busT);
        let k = 1;
        if (t < Infinity) k = Math.max(0.12, (t - 0.35) / len);
        // ease back out after a wall, snap in when blocked
        const ck = this.camK ?? 1;
        this.camK = ck + (k - ck) * Math.min(1, dt * (k < ck ? 30 : 5));
        dist *= this.camK;
        side *= this.camK;
      }
      this.camDistNow = dist;
      cam.position.set(pivot.x - fx * dist + rx * side, pivot.y - fy * dist + (scoped ? 0.05 : up), pivot.z - fz * dist + rz * side);
      if (cam.position.y < 0.3) cam.position.y = 0.3;
      // in a fight, tilt the view down a little so you see both fighters' feet
      this.frameTilt = (this.frameTilt ?? 0) + ((this.lockOn ? 0.13 : 0) - (this.frameTilt ?? 0)) * Math.min(1, dt * 5);
      cam.lookAt(cam.position.x + fx, cam.position.y + fy - this.frameTilt, cam.position.z + fz);
    }
    if (shake > 0) {
      cam.position.x += (Math.random() - 0.5) * shake;
      cam.position.y += (Math.random() - 0.5) * shake;
    }
    if (me?.shakeT > 0) cam.rotation.z += Math.sin(this.time * 40) * 0.02;
    this.fov += (fov - this.fov) * Math.min(1, dt * 10);
    // a blow lands: the lens punches in for an instant
    const punchFov = this.fov - (this.punch || 0) * 4.5 * shakeK;
    if (Math.abs(cam.fov - punchFov) > 0.01) {
      cam.fov = punchFov;
      cam.updateProjectionMatrix();
    }
    // shadows follow the camera, reaching out ahead of where you look (most of what you see is in front of you)
    const focus = p && p.state !== 'bus' ? new THREE.Vector3(p.x, 0, p.z) : new THREE.Vector3(snap.bus.x, 0, snap.bus.z);
    focus.x -= Math.sin(this.camYaw || 0) * 16;
    focus.z -= Math.cos(this.camYaw || 0) * 16;
    // ...and move in whole shadow-map texels, so shadow edges hold still instead of crawling as you walk
    const sh = this.moonLight.shadow;
    const texel = (sh.camera.right - sh.camera.left) / sh.mapSize.x;
    const right = (this.shRight ??= new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.moonDir).normalize());
    const up = (this.shUp ??= new THREE.Vector3().crossVectors(this.moonDir, right).normalize());
    const a = Math.round(focus.dot(right) / texel) * texel;
    const b = Math.round(focus.dot(up) / texel) * texel;
    const c = focus.dot(this.moonDir);
    focus.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(this.moonDir, c);
    this.moonLight.position.copy(focus).addScaledVector(this.moonDir, 120);
    this.moonLight.target.position.copy(focus);
  }

  updateTargeting(snap) {
    const me = snap.me;
    const p = this.mySnap();
    const ring = this.targetRing;
    ring.visible = false;
    this.scareName = null;
    this.targetInRange = true;
    if (!me || me.state !== 'ghost' || !p) return;
    let radius = 0;
    let range = Infinity;
    if (me.possess?.kind === 'ferris') {
      radius = RIDES.ferris.radius;
      range = RIDES.ferris.range;
      const g = this.ghostAim;
      if (g) {
        this.targetInRange = Math.hypot(g.x - FERRIS.x, g.z - FERRIS.z) <= range;
        ring.visible = true;
        ring.position.set(g.x, g.y + 0.08, g.z);
        ring.scale.set(radius * 2, radius * 2, 1);
        ring.material.color.set(this.targetInRange ? '#ff5a7a' : '#666');
      }
      return;
    }
    if (!this.power) return;
    if (this.power === 'scare') {
      const t = this.scareTarget(p);
      this.scareName = t ? t.name : null;
      if (t) {
        ring.visible = true;
        ring.position.set(t.x, t.y + 0.08, t.z);
        ring.scale.set(2, 2, 1);
        ring.material.color.set('#ff3a6a');
      }
      return;
    }
    const P = POWERS[this.power];
    radius = { trap: 0.9, cursed: P.radius || 1, steps: 1.5, blackout: P.radius || 20, storm: 6 }[this.power] || 1;
    const g = this.ghostAim;
    if (!g) return;
    this.targetInRange = this.power === 'storm' || Math.hypot(g.x - p.x, g.z - p.z) <= P.range;
    ring.visible = true;
    ring.position.set(g.x, g.y + 0.08, g.z);
    ring.scale.set(radius * 2, radius * 2, 1);
    ring.material.color.set(this.targetInRange ? '#7dffd8' : '#ff4a4a');
  }

  updateAudio(snap) {
    const cam = this.camera;
    // ears face wherever the camera looks (the cinematic points it anywhere)
    const look = cam.getWorldDirection(this.tmpDir || (this.tmpDir = new THREE.Vector3()));
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, look.x, look.y, look.z);
    if (!this.occlusionSet) {
      // a sound is muffled when a wall stands between it and the camera
      this.occlusionSet = true;
      audio.setOcclusion((x, y, z) => !lineOfSight(cam.position.x, cam.position.y, cam.position.z, x, y + 0.3, z));
    }
    const c = snap.coaster;
    const t = trackAt(c.s);
    audio.loop('coaster', c.running ? 1.2 : 0, [t.x, t.y, t.z]);
    const p = this.mySnap();
    audio.loop('bus', snap.bus.v > 0.5 || snap.phase === 'launch' ? 0.9 : 0, [snap.bus.x, 1, snap.bus.z]);
    const outside = p && p.state === 'alive' && snap.zone.state !== 'idle' && Math.hypot(p.x - snap.zone.cx, p.z - snap.zone.cz) > snap.zone.r;
    audio.loop('stormDrone', outside ? 0.6 : 0);
    // the score: tension when someone's near (or you're dead), combat while you fight, danger when you're hurt,
    // finale for the last ride
    let nearest = Infinity;
    if (p) {
      for (const q of snap.players) {
        if (q.id === this.myId || q.state !== 'alive') continue;
        nearest = Math.min(nearest, Math.hypot(q.x - p.x, q.z - p.z));
      }
    }
    const aliveMe = p?.state === 'alive';
    const live = snap.phase === 'live';
    const hpNow = (snap.me?.hp ?? 100) + (snap.me?.shield ?? 0);
    const combat = Math.max(0, 1 - (this.time - (this.lastCombat ?? -99)) / 4);
    audio.setScore({
      tension: !live ? 0 : aliveMe ? Math.max(0, Math.min(1, (30 - nearest) / 20)) : 0.55,
      combat: aliveMe ? combat : 0,
      danger: aliveMe && live ? Math.max(Math.min(1, (45 - hpNow) / 35), nearest < 4 ? 0.5 : 0) : 0,
      finale: snap.finalT > 0 ? 1 : live && snap.zone.idx >= 4 ? 0.5 : 0,
    });
    // out of breath, or badly hurt: you can hear yourself
    audio.loop('breath', aliveMe && ((snap.me?.stam ?? 100) < 22 || hpNow < 30) ? 0.5 : 0);
    // the coaster train clacks over the rail joints, faster as it picks up speed
    if (c.running && Math.abs(c.v) > 2) {
      this.clackT = (this.clackT ?? 0) - 1 / 60;
      if (this.clackT <= 0) {
        this.clackT = Math.max(0.07, 3.2 / Math.abs(c.v));
        audio.play('clack', [t.x, t.y, t.z]);
      }
    }
    // a possessed bumper car crackles with stolen power
    const car = snap.cars.find((k) => k.driver != null);
    audio.loop('carHum', car ? 0.6 : 0, car ? [car.x, 1, car.z] : null);
    // the rain: a hiss all around outside, a patter on the roof and windows under cover
    const cp = cam.position;
    const under = this.cine?.interior || sheltered(cp.x, cp.y, cp.z, snap.bus) || (p && sheltered(p.x, p.y + 1.6, p.z, null));
    // between walls everything rings a little longer
    audio.setRoom(under ? 1 : 0);
    audio.loop('rain', (this.rainAmount || 0) * (under ? 0.05 : 0.18));
    audio.loop('rainIn', (this.rainAmount || 0) * (under ? 0.22 : 0));
    // the night around the park: now and then something out in the dark
    if (snap.phase === 'live') {
      this.nextAmbient = (this.nextAmbient ?? 4) - 1 / 60;
      if (this.nextAmbient <= 0) {
        this.nextAmbient = 5 + Math.random() * 9;
        const r = Math.random();
        const a = Math.random() * Math.PI * 2;
        const d = 25 + Math.random() * 45;
        const at = [cam.position.x + Math.cos(a) * d, 6, cam.position.z + Math.sin(a) * d];
        if (r < 0.4) audio.play('creak', at);
        else if (r < 0.6) audio.play('crow', at);
        else if (r < 0.75) audio.play('owl', at);
        else audio.play('twig', [cam.position.x + Math.cos(a) * 12, 0.5, cam.position.z + Math.sin(a) * 12]);
      }
    }
  }

  /** Lightning: a few flickers, then the thunder arrives later the further off the strike was (sound covers ~343 m/s). */
  updateWeather(dt) {
    const w = this.weather;
    // tonight's lightning (none on a foggy or clear night; the title screen keeps the storm)
    const bolts = this.attract ? [12, 34] : this.night ? this.night.bolts : [12, 34];
    w.nextBolt -= bolts ? dt : 0;
    if (bolts && w.nextBolt <= 0) {
      w.nextBolt = bolts[0] + Math.random() * (bolts[1] - bolts[0]);
      const km = 0.4 + Math.random() * 3.6;
      const k = Math.min(1, Math.max(0.25, 1.2 / km));
      w.bolt = { t: 0, k, pulses: [[0, 1, 0.07], [0.12 + Math.random() * 0.08, 0.55, 0.05], [0.3 + Math.random() * 0.15, 0.85, 0.14]] };
      setTimeout(() => audio.play(km < 1.3 ? 'thunderNear' : 'thunder', null, { km }), (km / 0.343) * 1000);
    }
    w.flash = 0;
    if (w.bolt) {
      const b = w.bolt;
      b.t += dt;
      for (const [t0, a, decay] of b.pulses) if (b.t >= t0) w.flash += a * Math.exp(-(b.t - t0) / decay);
      w.flash *= b.k;
      if (b.t > 1.5) w.bolt = null;
    }
  }

  /**
   * The bar over whoever you are fighting: shown while you are locked on to them, or for 3 s after you hit them.
   * Damage shows as a pale chip that drains a moment later, so each blow reads as a bite out of the bar.
   */
  updateFoeBar(snap, dt) {
    const bar = this.foeBar;
    const meP = this.mySnap();
    const id = this.lockOn ? this.lockOn.id : this.time < (this.foeUntil || 0) ? this.foeId : null;
    const p = id != null && meP && meP.state === 'alive' ? snap.players.find((q) => q.id === id) : null;
    const show = !!p && p.state === 'alive' && Math.hypot(p.x - meP.x, p.z - meP.z) < 30;
    this.foeShow = Math.max(0, Math.min(1, (this.foeShow || 0) + (show ? dt * 8 : -dt * 4)));
    if (!show) {
      bar.style.opacity = this.foeShow;
      if (this.foeShow <= 0) bar.style.display = 'none';
      if (this.foeShow <= 0 || !this.foeLast) return;
    }
    const q = show ? p : this.foeLast;
    if (show) {
      if (this.foeShownId !== p.id) {
        this.foeShownId = p.id;
        this.foeChip = p.hp;
        bar.querySelector('.fb-name span').textContent = p.name;
      }
      if (p.hp > this.foeChip) this.foeChip = p.hp;
      if (p.hp < (this.foeLast?.id === p.id ? this.foeLast.hp : p.hp)) this.foeDropAt = this.time;
      if (this.time - (this.foeDropAt || 0) > 0.45) this.foeChip += (p.hp - this.foeChip) * Math.min(1, dt * 7);
      this.foeLast = { id: p.id, x: p.x, y: p.y, z: p.z, hp: p.hp, shield: p.shield };
      bar.style.display = '';
      bar.style.opacity = this.foeShow;
      bar.classList.toggle('locked', !!this.lockOn && this.lockOn.id === p.id);
      bar.querySelector('.fb-hp').style.width = `${Math.max(0, p.hp)}%`;
      bar.querySelector('.fb-chip').style.width = `${Math.max(0, this.foeChip)}%`;
      bar.querySelector('.fb-sh div').style.width = `${Math.max(0, p.shield)}%`;
      bar.querySelector('.fb-sh').style.display = p.shield > 0 ? '' : 'none';
    }
    tmpV.set(q.x, q.y + 2.1, q.z).project(this.camera);
    if (tmpV.z > 1) {
      bar.style.display = 'none';
      return;
    }
    bar.style.transform = `translate(${((tmpV.x + 1) / 2) * window.innerWidth}px, ${((1 - tmpV.y) / 2) * window.innerHeight}px) translate(-50%, -100%)`;
  }

  updateBubbles(snap, dt) {
    if (!this.bubbles?.length) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.bubbles = this.bubbles.filter((b) => {
      b.t -= dt;
      const p = snap.players.find((q) => q.id === b.id);
      if (b.t <= 0 || !p) {
        b.el.remove();
        return false;
      }
      tmpV.set(p.x, p.y + (p.state === 'ghost' ? 2.5 : 2.35), p.z).project(this.camera);
      const off = tmpV.z > 1;
      b.el.style.display = off ? 'none' : '';
      if (!off) b.el.style.transform = `translate(${((tmpV.x + 1) / 2) * w}px, ${((1 - tmpV.y) / 2) * h}px) translate(-50%, -100%)`;
      b.el.style.opacity = Math.min(1, b.t * 2);
      return true;
    });
  }

  updateDamageNumbers(dt) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.dmgNums.length - 1; i >= 0; i--) {
      const d = this.dmgNums[i];
      d.t -= dt;
      d.y += dt * 1.2;
      tmpV.set(d.x, d.y, d.z).project(this.camera);
      if (d.t <= 0 || tmpV.z > 1) {
        d.el.remove();
        this.dmgNums.splice(i, 1);
        continue;
      }
      d.el.style.transform = `translate(${((tmpV.x + 1) / 2) * w}px, ${((1 - tmpV.y) / 2) * h}px) translate(-50%, -50%)`;
      d.el.style.opacity = Math.min(1, d.t * 2);
    }
  }
}

