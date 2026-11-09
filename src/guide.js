// Tells the player what to do next: an objective line, on-screen markers, a ghost tutorial and a controls card.
import * as THREE from 'three';
import { icon as svgIcon } from './icons.js';
import { keyOf, usingPad, usingTouch } from './prompts.js';
import { FERRIS, STATION, PRIZE_BOOTHS } from '../shared/map.js';

const TUT_KEY = 'last-ride-ghost-tutorial';
const v = new THREE.Vector3();

/** The controls card: [action (see prompts.js), what it does]; the key or button is named for what is in use. */
const CONTROLS = {
  alive: [
    ['move', 'move'], ['sprint', 'sprint'], ['slide', 'slide (while running)'], ['jump', 'jump'], ['attack', 'swing (hold: heavy)'], ['aim', 'block / aim (just before a hit: parry)'],
    ['dodge', 'dodge'], ['interact', 'pick up / open'], ['reload', 'reload'], ['weapons', 'weapons'], ['items', 'heal, shield, holy water, flare, salt, relic'],
    ['prizes', 'prize counter'], ['map', 'map'],
  ],
  ghost: [
    ['move', 'fly'], ['up', 'up'], ['down', 'down'], ['fast', 'fly fast'], ['powers', 'pick a power'], ['attack', 'use power'],
    ['cancel', 'cancel'], ['interact', 'possess ride'], ['map', 'map'],
  ],
};

function loadTut() {
  try {
    return localStorage.getItem(TUT_KEY) === 'done' ? 99 : 0;
  } catch {
    return 0;
  }
}

export class Guide {
  constructor(root) {
    this.root = root;
    this.obj = document.createElement('div');
    this.obj.className = 'objective';
    this.layer = document.createElement('div');
    this.layer.className = 'markers';
    this.keys = document.createElement('div');
    this.keys.className = 'keys-card';
    this.lock = document.createElement('div');
    this.lock.className = 'lock-hint';
    root.append(this.layer, this.obj, this.keys, this.lock);
    this.markers = [];
    this.tut = loadTut();
    this.tutStart = null;
    this.lastKeys = '';
    this.lastObj = '';
    // the controls card waits for H; a small reminder shows instead
    this.showKeys = false;
  }

  marker(i) {
    let m = this.markers[i];
    if (!m) {
      m = document.createElement('div');
      m.className = 'marker';
      m.innerHTML = '<i></i><span></span>';
      this.layer.append(m);
      this.markers[i] = m;
    }
    m.style.display = '';
    return m;
  }

  /** Place a marker at a world point, pinned to the screen edge when off-screen. */
  place(i, camera, x, y, z, icon, label, cls) {
    const m = this.marker(i);
    v.set(x, y, z).project(camera);
    const behind = v.z > 1;
    let sx = v.x;
    let sy = v.y;
    if (behind) {
      sx = -sx;
      sy = -sy;
    }
    const edge = behind || Math.abs(sx) > 0.92 || Math.abs(sy) > 0.85;
    if (edge) {
      const k = Math.max(Math.abs(sx) / 0.92, Math.abs(sy) / 0.85, 1e-3);
      sx /= k;
      sy /= k;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    m.style.transform = `translate(${((sx + 1) / 2) * w}px, ${((1 - sy) / 2) * h}px) translate(-50%, -50%)`;
    m.className = `marker ${cls || ''} ${edge ? 'edge' : ''}`;
    if (m.firstChild.dataset.i !== icon) {
      m.firstChild.dataset.i = icon;
      m.firstChild.innerHTML = svgIcon(icon);
    }
    m.lastChild.textContent = label;
  }

  setObjective(title, sub = '') {
    const html = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`;
    if (html === this.lastObj) return;
    // a new title gets the explanation for a few seconds; after that only the title stays
    const fresh = !this.lastObj.startsWith(`<b>${title}</b>`);
    this.lastObj = html;
    this.obj.innerHTML = html;
    if (fresh) {
      this.obj.classList.remove('settled');
      clearTimeout(this.settleT);
      this.settleT = setTimeout(() => this.obj.classList.add('settled'), 7000);
    }
    this.obj.classList.remove('pop');
    void this.obj.offsetWidth;
    this.obj.classList.add('pop');
  }

  update(snap, client) {
    const me = snap.me;
    const p = client.mySnap();
    const cam = client.camera;
    let n = 0;
    const dist = (x, z) => (p ? Math.round(Math.hypot(x - p.x, z - p.z)) : 0);

    // mouse lock hint (pointer lock is blocked inside some embedded browsers)
    const needLock = snap.phase !== 'end' && !client.input.touch && !client.input.locked && !client.hud.mapOpen && !client.pauseMenu?.open && me && me.state !== 'bus';
    this.lock.classList.toggle('show', needLock);
    if (needLock) {
      this.lock.innerHTML = client.input.lockFailed
        ? '<b>Mouse lock is blocked in this window</b><span>Open <u>http://localhost:5200</u> in Chrome to aim properly. Until then, hold a mouse button to look around.</span>'
        : '<b>Click to play</b><span>Your mouse will lock to aim. Press Esc to free it.</span>';
    }

    this.obj.style.display = client.hud.mapOpen ? 'none' : '';
    if (!me || !p) return;
    if (me.spectator) {
      this.setObjective('Watching this ride', `${snap.alive} still alive. You board the next bus when it ends. Fly with ${keyOf('move')}, ${keyOf('up')} goes up, ${keyOf('down')} goes down, ${keyOf('fast')} is fast.`);
      return;
    }
    const ghost = me.state === 'ghost';
    const zone = snap.zone;

    if (snap.phase === 'end') this.setObjective('Ride over', 'Check the results');
    else if (me.state === 'bus') {
      if (snap.bus.open) this.setObjective('Jump off the bus', usingTouch()
        ? 'Tap Jump off where you want to start. The bus stops at Free Fall. Tap Map to see the route.'
        : `Press ${keyOf('jump')} where you want to start. The bus stops at Free Fall. Open the map (${keyOf('map')}) to see the route.`);
      else this.setObjective('Midnight Wonderland Tours', 'The doors open once you are through the gates');
    }
    else if (!ghost) {
      const cx = zone.state === 'wait' ? zone.nx : zone.cx;
      const cz = zone.state === 'wait' ? zone.nz : zone.cz;
      const r = zone.state === 'wait' ? zone.nr : zone.r;
      const outside = zone.state !== 'idle' && Math.hypot(p.x - cx, p.z - cz) > r;
      const armed = me.slots.some(Boolean);
      let booth = null;
      let bd = 90;
      for (const b of PRIZE_BOOTHS) {
        const d = Math.hypot(b.x - p.x, b.z - p.z);
        if (d < bd) {
          bd = d;
          booth = b;
        }
      }
      if (outside) {
        const inStorm = Math.hypot(p.x - zone.cx, p.z - zone.cz) > zone.r;
        this.setObjective(inStorm ? 'Get out of the storm!' : 'Move into the safe zone', inStorm ? 'The storm hurts every second. Follow the marker.' : 'The storm is coming. Follow the marker before it closes.');
        const k = r / Math.max(1, Math.hypot(p.x - cx, p.z - cz));
        const tx = cx + (p.x - cx) * k * 0.8;
        const tz = cz + (p.z - cz) * k * 0.8;
        this.place(n++, cam, tx, p.y + 1.5, tz, 'storm', `${dist(tx, tz)} m`, 'zone');
      } else if (!armed) {
        this.setObjective('Find a weapon', `You only have your fists. Look for glowing weapons and gold chests, walk up and press ${keyOf('interact')}.`);
        const near = this.nearestLoot(client, p, (l) => l.kind === 'chest' || l.kind === 'weapon');
        if (near) this.place(n++, cam, near.x, near.y + 1, near.z, near.kind === 'chest' ? 'chest' : 'weapon', `${dist(near.x, near.z)} m`, near.kind === 'weapon' ? `r${near.rarity}` : 'chest');
      } else if (me.tickets >= 30 && booth) {
        this.setObjective(`Spend your tickets · ${svgIcon('ticket')} ${me.tickets}`, `A Prize Counter sells chainsaws, crossbows and blessed relics. Walk up and press ${keyOf('prizes')}.`);
        this.place(n++, cam, booth.x, 4.5, booth.z, 'ticket', `Prize Counter · ${dist(booth.x, booth.z)} m`, 'chest');
      } else if (p.hp < 60 && (me.items.bandage || me.items.medkit)) {
        this.setObjective('Heal up', usingTouch() ? `Use your ${me.items.medkit ? 'medkit' : 'bandage'} (tap it in your items) somewhere safe` : `Press ${me.items.medkit ? '5 for a medkit' : '4 for a bandage'} somewhere safe`);
      } else if (p.shield < 50 && me.items.soda) {
        this.setObjective('Drink a shield soda', usingTouch() ? 'Tap the soda in your items' : 'Press 6');
      } else {
        this.setObjective(`Survive · ${snap.alive} riders left`, 'Take out other riders. Watch for red warning circles, traps and possessed rides.');
      }
    } else {
      this.ghostObjective(snap, me, p, client);
      // ghosts see the rides and nearby survivors
      if (!me.possess) {
        if (!snap.ferris.driver) this.place(n++, cam, FERRIS.x, FERRIS.hubY, FERRIS.z, 'ferris', `Ferris wheel · ${dist(FERRIS.x, FERRIS.z)} m`, 'ride');
        if (!snap.coaster.running) this.place(n++, cam, STATION.x, 3, STATION.z, 'coaster', snap.coaster.cd > 0 ? `Coaster ${Math.ceil(snap.coaster.cd)}s` : `Coaster · ${dist(STATION.x, STATION.z)} m`, 'ride');
        let car = null;
        let cd = Infinity;
        for (const c of snap.cars) {
          if (c.driver) continue;
          const d = Math.hypot(c.x - p.x, c.z - p.z);
          if (d < cd) {
            cd = d;
            car = c;
          }
        }
        if (car) this.place(n++, cam, car.x, car.y + 1.5, car.z, 'car', `Bumper car · ${Math.round(cd)} m`, 'ride');
      }
      const living = snap.players
        .filter((q) => q.state === 'alive')
        .map((q) => ({ q, d: Math.hypot(q.x - p.x, q.z - p.z) }))
        .filter((o) => o.d < 90)
        .sort((a, b) => a.d - b.d)
        .slice(0, 4);
      for (const { q, d } of living) {
        this.place(n++, cam, q.x, q.y + 2.4, q.z, q.protected ? 'shield' : 'target', `${q.name} · ${Math.round(q.hp + q.shield)} HP · ${Math.round(d)} m`, 'prey');
      }
    }
    for (let i = n; i < this.markers.length; i++) this.markers[i].style.display = 'none';

    // controls card
    const set = ghost ? 'ghost' : me.state === 'alive' ? 'alive' : null;
    const keys = set && this.showKeys ? set : '';
    // (drawn again when the player switches between the keyboard and a controller)
    const drawn = `${keys}|${usingPad()}`;
    if (drawn !== this.lastKeys) {
      this.lastKeys = drawn;
      this.keys.innerHTML = keys
        ? `${CONTROLS[keys].map(([k, d]) => `<div><kbd>${keyOf(k)}</kbd><span>${d}</span></div>`).join('')}<div class="dim">H hides this</div>`
        : set ? '<div class="keys-hint"><kbd>H</kbd><span>Controls</span></div>' : '';
      this.keys.classList.toggle('show', !!set);
      this.keys.classList.toggle('mini', !keys);
    }
  }

  nearestLoot(client, p, pred) {
    let best = null;
    let bd = 70;
    for (const e of client.lootView.items.values()) {
      const l = e.data;
      if (!l || !pred(l) || l.cursed) continue;
      const d = Math.hypot(l.x - p.x, l.z - p.z);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    return best;
  }

  ghostObjective(snap, me, p, client) {
    const revives = me.revivesLeft > 0 ? `${me.revivesLeft} revive${me.revivesLeft > 1 ? 's' : ''} left` : 'no revives left';
    if (this.tut < 99) {
      if (this.tutStart === null) this.tutStart = { t: snap.time, x: p.x, z: p.z, ecto: me.ecto };
      const usedPower = Object.values(me.cds).some((c) => c > 0);
      if (this.tut === 0 && (Math.hypot(p.x - this.tutStart.x, p.z - this.tutStart.z) > 12 || snap.time - this.tutStart.t > 10)) this.tut = 1;
      if (this.tut === 1 && usedPower) this.tut = 2;
      if (this.tut === 2 && me.possess) this.tut = 3;
      if (this.tut === 3 && !me.possess) this.finishTut();
    }
    // keys and buttons named for whatever the player is holding (see prompts.js)
    const gh = svgIcon('ghost');
    const trap = usingPad() ? '↑' : '1';
    const use = usingPad() ? `press ${keyOf('attack')} on` : usingTouch() ? 'tap attack on' : 'click';
    const lets = `${keyOf('interact')} lets go.`;
    const step = {
      0: [`${gh} Fly as a ghost`, `Fly with ${keyOf('move')}. ${keyOf('up')} goes up, ${keyOf('down')} goes down, ${keyOf('fast')} flies fast. Walls can't stop you.`],
      1: me.riseT > 0
        ? [`${gh} Rising from the grave… ${Math.ceil(me.riseT)}s`, `Then pick the Bear Trap (${trap}) and ${use} the ground in front of a survivor.`]
        : [`${gh} Use a power`, `Pick the Bear Trap (${trap}), then ${use} the ground in front of a survivor (${svgIcon('target')} markers).`],
      2: [`${gh} Possess a ride`, `Rides hit hardest. Fly to a ${svgIcon('ferris')} ${svgIcon('coaster')} ${svgIcon('car')} marker and press ${keyOf('interact')}.`],
      3: [`${gh} You control the ride!`, me.possess?.kind === 'ferris' ? `Aim at a survivor and ${use} to fling a gondola. ${lets}` : me.possess?.kind === 'car' ? `Drive into survivors. ${lets}` : 'Hold on. Anyone on the track gets hit.'],
    }[this.tut];
    if (step) this.setObjective(step[0], step[1]);
    else this.setObjective(`${gh} Steal a body · ${revives}`, me.revivesLeft > 0 ? `Land the final hit on a survivor (${svgIcon('target')}) with a power or a ride to come back in their body.` : 'Lost soul: you can still haunt the survivors.');
  }

  finishTut() {
    this.tut = 99;
    try {
      localStorage.setItem(TUT_KEY, 'done');
    } catch {
      /* storage unavailable */
    }
  }
}

