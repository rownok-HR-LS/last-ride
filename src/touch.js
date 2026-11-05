// Phone and tablet controls: a stick that appears under the left thumb, drag anywhere on the right to look,
// and a fan of buttons for the right thumb. Buttons press the same keys the keyboard does, so everything else
// (bindings, the HUD, online play) works unchanged. Weapon slots, items and ghost powers in the HUD can be tapped.

/** Does this device have a touch screen as its main pointer? */
export const isTouch = () => matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);

const STICK_R = 56;
const LOOK_GAIN = 1.7;

// [id, label, what it presses, which states show it]
const BUTTONS = [
  ['attack', '⚔', 'lmb', 'alive'],
  ['block', '🛡', 'rmb', 'alive'],
  ['jump', '⤒', 'jump', 'alive'],
  ['dodge', '↯', 'dodge', 'alive'],
  ['slide', '⤓', 'slide', 'alive'],
  ['use', 'E', 'interact', 'alive'],
  ['reload', 'R', 'reload', 'alive'],
  ['swap', '⇄', 'wheel', 'alive'],
  ['prizes', '🎟', 'prizes', 'booth'],
  ['cast', '✦', 'lmb', 'ghost'],
  ['up', '⤒', 'jump', 'ghost'],
  ['down', '⤓', 'slide', 'ghost'],
  ['fast', '»', 'sprint', 'ghost'],
  ['haunt', 'E', 'interact', 'ghost'],
  ['off', 'Jump off', 'jump', 'bus'],
];

export class Touch {
  constructor(root, client) {
    this.client = client;
    this.input = client.input;
    this.input.touch = true;
    document.body.classList.add('touch');
    this.el = document.createElement('div');
    this.el.className = 'touch-ui hidden';
    this.el.innerHTML = `
      <div class="t-stick"><i></i></div>
      <div class="t-top"><button data-t="menu">☰</button><button data-t="map">Map</button></div>
      <div class="t-pad">${BUTTONS.map(([id, label, , when]) => `<button class="tb tb-${id}" data-b="${id}" data-when="${when}">${label}</button>`).join('')}</div>
      <div class="t-turn">Turn your phone sideways to ride</div>`;
    root.appendChild(this.el);
    this.stickEl = this.el.querySelector('.t-stick');
    this.knob = this.stickEl.querySelector('i');
    this.stickId = null;
    this.lookId = null;
    this.held = new Map();
    this.bind();
  }

  /** Which key codes an action presses (the player's own bindings). */
  keys(action) {
    return this.input.binds[action] || [];
  }

  down(what) {
    const inp = this.input;
    if (what === 'lmb') {
      inp.lmb = true;
      inp.lmbPressed = true;
    } else if (what === 'rmb') {
      inp.rmb = true;
      inp.rmbPressed = true;
    } else if (what === 'wheel') inp.wheel += 1;
    else {
      const k = this.keys(what)[0];
      if (!k) return;
      if (!inp.keys.has(k)) inp.pressed.add(k);
      inp.keys.add(k);
    }
  }

  up(what) {
    const inp = this.input;
    if (what === 'lmb') inp.lmb = false;
    else if (what === 'rmb') inp.rmb = false;
    else if (what !== 'wheel') inp.keys.delete(this.keys(what)[0]);
  }

  /** A one-off key press (a HUD slot, the map). */
  tap(code) {
    this.input.pressed.add(code);
  }

  bind() {
    const canvas = this.client.renderer.domElement;
    const opts = { passive: false };
    // the first touch goes full screen and holds the phone sideways where the browser allows it
    const full = () => {
      if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    };
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      full();
      // a tap skips the intro
      if (this.client.intro?.active) this.tap('Enter');
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.42 && this.stickId === null) {
          this.stickId = t.identifier;
          this.origin = { x: t.clientX, y: t.clientY };
          this.stickEl.style.left = `${t.clientX}px`;
          this.stickEl.style.top = `${t.clientY}px`;
          this.stickEl.classList.add('on');
          this.moveStick(t);
        } else if (this.lookId === null) {
          this.lookId = t.identifier;
          this.last = { x: t.clientX, y: t.clientY };
        }
      }
    }, opts);
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this.stickId) this.moveStick(t);
        else if (t.identifier === this.lookId) {
          this.input.dx += (t.clientX - this.last.x) * LOOK_GAIN;
          this.input.dy += (t.clientY - this.last.y) * LOOK_GAIN;
          this.last = { x: t.clientX, y: t.clientY };
        }
      }
    }, opts);
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stickId) {
          this.stickId = null;
          this.input.stick = null;
          this.stickEl.classList.remove('on');
        } else if (t.identifier === this.lookId) this.lookId = null;
      }
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);

    // the buttons: held while the finger stays down; sliding the look finger off a button still looks
    const pad = this.el.querySelector('.t-pad');
    pad.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const b = document.elementFromPoint(t.clientX, t.clientY)?.closest('[data-b]');
        if (!b) continue;
        const what = BUTTONS.find((x) => x[0] === b.dataset.b)[2];
        this.held.set(t.identifier, { what, b, x: t.clientX, y: t.clientY });
        b.classList.add('down');
        this.down(what);
        if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(8);
      }
    }, opts);
    pad.addEventListener('touchmove', (e) => {
      e.preventDefault();
      // the attack and block buttons also aim: drag from them to turn
      for (const t of e.changedTouches) {
        const h = this.held.get(t.identifier);
        if (!h) continue;
        this.input.dx += (t.clientX - h.x) * LOOK_GAIN;
        this.input.dy += (t.clientY - h.y) * LOOK_GAIN;
        h.x = t.clientX;
        h.y = t.clientY;
      }
    }, opts);
    const release = (e) => {
      for (const t of e.changedTouches) {
        const h = this.held.get(t.identifier);
        if (!h) continue;
        this.held.delete(t.identifier);
        h.b.classList.remove('down');
        this.up(h.what);
      }
    };
    pad.addEventListener('touchend', release);
    pad.addEventListener('touchcancel', release);

    this.el.querySelector('.t-top').addEventListener('click', (e) => {
      const t = e.target.closest('[data-t]')?.dataset.t;
      if (t === 'map') this.tap(this.keys('map')[0]);
      if (t === 'menu') this.client.pauseMenu.open ? this.client.resume() : this.client.pause();
    });
    // weapon slots and items in the HUD; the minimap opens the big map
    this.client.hudRoot.addEventListener('click', (e) => {
      if (e.target.closest('.minimap')) return this.tap(this.keys('map')[0]);
      const k = e.target.closest('[data-key]')?.dataset.key;
      if (k) this.tap(k);
    });
  }

  moveStick(t) {
    let x = t.clientX - this.origin.x;
    let y = t.clientY - this.origin.y;
    const d = Math.hypot(x, y);
    if (d > STICK_R) {
      // the stick follows a thumb that wanders too far
      this.origin.x += (x / d) * (d - STICK_R);
      this.origin.y += (y / d) * (d - STICK_R);
      this.stickEl.style.left = `${this.origin.x}px`;
      this.stickEl.style.top = `${this.origin.y}px`;
      x = (x / d) * STICK_R;
      y = (y / d) * STICK_R;
    }
    this.knob.style.transform = `translate(${x}px, ${y}px)`;
    this.input.stick = { x: x / STICK_R, y: y / STICK_R };
  }

  /** Show the buttons that fit what you are doing (alive, ghost, on the bus). */
  update() {
    const c = this.client;
    const me = c.snap?.me;
    const hide = !!(c.attract || !me || c.snap.phase === 'end' || c.pauseMenu.open || c.hud.prizesOpen);
    this.el.classList.toggle('hidden', hide);
    if (hide) return;
    const state = me.spectator ? 'watch' : me.state;
    const key = `${state}:${me.booth >= 0}`;
    if (key === this.shown) return;
    this.shown = key;
    for (const b of this.el.querySelectorAll('[data-b]')) {
      const w = b.dataset.when;
      b.hidden = !(w === state || (w === 'booth' && state === 'alive' && me.booth >= 0) || (state === 'watch' && ['up', 'down', 'fast'].includes(b.dataset.b)));
    }
  }
}
