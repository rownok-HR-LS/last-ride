// Game controllers (the browser's standard mapping: Xbox, PlayStation, Switch Pro, Steam Deck). The controller
// presses the same keys the keyboard does (whatever the player bound them to), the left stick walks like the touch
// stick, the right stick looks, the triggers are the mouse buttons. On menus the D-pad or stick moves between buttons
// and A presses one. Hits rumble.
//
//   A jump · B slide / fly down · X pick up / open (at a booth: prize counter) · Y next weapon · LB dodge · RB reload
//   RT attack · LT aim / block · L3 sprint · R3 swap shoulder · View map · Start pause
//   D-pad: medkit, bandage, shield soda, holy water (as a ghost: powers 1-4; LB, RB powers 5-6)

import { setPad } from './prompts.js';

const DEAD = 0.16;
/** Full right-stick tilt turns this fast (rad/s); the curve keeps small tilts fine for aiming. */
const LOOK = 3.2;
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const axis = (v) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * (Math.abs(v) - DEAD) / (1 - DEAD));

export class Pads {
  /** client: the game client (its input, pause menu and HUD). */
  constructor(client) {
    this.client = client;
    this.prev = [];
    this.held = new Set();
    this.index = null;
    this.menuRepeat = 0;
    addEventListener('gamepadconnected', (e) => {
      this.index = e.gamepad.index;
      if (e.gamepad.mapping === 'standard') this.client.hud?.toast?.('Controller connected');
    });
    addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.index) this.index = null;
      this.release();
    });
  }

  /** The connected controller, if any. */
  pad() {
    if (this.index === null || !navigator.getGamepads) return null;
    const p = navigator.getGamepads()[this.index];
    return p && p.connected ? p : null;
  }

  /** Let go of every key the controller is holding (it was unplugged, or a menu opened). */
  release() {
    const inp = this.client.input;
    for (const code of this.held) inp.keys.delete(code);
    this.held.clear();
    inp.padFire = inp.padAim = false;
    if (this.ownStick) {
      inp.stick = null;
      this.ownStick = false;
    }
  }

  /** Read the controller once a frame, before the game reads its input. */
  poll(dt) {
    const p = this.pad();
    if (!p) return;
    const now = p.buttons.map((b) => b.pressed || b.value > 0.5);
    const hit = (i) => now[i] && !this.prev[i];
    // prompts name controller buttons from the moment it is used
    if (now.some(Boolean) || p.axes.some((v) => Math.abs(v) > 0.4)) setPad(true);
    if (this.inMenu()) {
      this.release();
      this.menu(p, now, hit, dt);
    } else this.play(p, now, hit, dt);
    this.prev = now;
  }

  /** Is a menu or sign up (the title, the pause sign, the bus stop, the results)? */
  inMenu() {
    const c = this.client;
    return c.attract || c.pauseMenu?.open || !!document.querySelector('.lobby-layer.show, .end-sign, .gpu-reset.show') || !!c.hud?.prizesOpen;
  }

  play(p, now, hit, dt) {
    const c = this.client;
    const inp = c.input;
    if (!inp.enabled) return;
    const binds = inp.binds;
    const me = c.snap?.me;
    const key = (action) => (binds[action] || [])[0];
    // held buttons become held keys (so every check the game makes for that action sees them)
    const want = new Map([
      [key('jump'), now[B.A]],
      [key('slide'), now[B.B]],
      // X picks things up; at a prize booth with nothing to pick up it opens the counter
      [key(me?.booth >= 0 && !me?.interact ? 'prizes' : 'interact'), now[B.X]],
      [key('dodge'), now[B.LB]],
      [key('reload'), now[B.RB]],
      [key('sprint'), now[B.L3]],
      [key('shoulder'), now[B.R3]],
      [key('map'), now[B.VIEW]],
    ]);
    // the D-pad picks items alive, powers as a ghost
    const ghost = c.snap?.me?.state === 'ghost';
    const pad = ghost
      ? [[B.UP, 'Digit1'], [B.RIGHT, 'Digit2'], [B.DOWN, 'Digit3'], [B.LEFT, 'Digit4'], [B.LB, 'Digit5'], [B.RB, 'Digit6']]
      : [[B.UP, 'Digit5'], [B.DOWN, 'Digit4'], [B.LEFT, 'Digit6'], [B.RIGHT, 'Digit7']];
    for (const [b, code] of pad) want.set(code, (want.get(code) || false) || now[b]);
    for (const [code, on] of want) {
      if (!code) continue;
      if (on && !this.held.has(code)) {
        this.held.add(code);
        if (!inp.keys.has(code)) inp.pressed.add(code);
        inp.keys.add(code);
      } else if (!on && this.held.has(code)) {
        this.held.delete(code);
        inp.keys.delete(code);
      }
    }
    if (hit(B.Y)) inp.wheel += 1;
    if (hit(B.START)) inp.onEscape?.();
    // triggers are the mouse buttons
    const rt = (p.buttons[B.RT]?.value ?? 0) > 0.35;
    const lt = (p.buttons[B.LT]?.value ?? 0) > 0.35;
    if (rt && !inp.padFire) inp.lmbPressed = true;
    if (lt && !inp.padAim) inp.rmbPressed = true;
    inp.padFire = rt;
    inp.padAim = lt;
    // left stick: walk, like the touch stick (a full push sprints)
    const lx = axis(p.axes[0] || 0);
    const ly = axis(p.axes[1] || 0);
    // (only let go of the stick if the controller was the one holding it: the touch stick shares it)
    if (lx || ly) {
      inp.stick = { x: lx, y: ly };
      this.ownStick = true;
    } else if (this.ownStick) {
      inp.stick = null;
      this.ownStick = false;
    }
    // right stick: look, on a curve so small tilts aim finely
    const rx = axis(p.axes[2] || 0);
    const ry = axis(p.axes[3] || 0);
    const k = (LOOK * dt) / 0.0022;
    inp.dx += Math.sign(rx) * rx * rx * k;
    inp.dy += Math.sign(ry) * ry * ry * k * 0.75;
  }

  /** Move between the visible buttons on a menu; A presses, B backs out. */
  menu(p, now, hit, dt) {
    const v = axis(p.axes[1] || 0);
    const hx = axis(p.axes[0] || 0);
    const dir = now[B.DOWN] || v > 0.6 || now[B.RIGHT] || hx > 0.6 ? 1 : now[B.UP] || v < -0.6 || now[B.LEFT] || hx < -0.6 ? -1 : 0;
    // one step per push; held, it waits a moment and then steps quickly
    let step = false;
    if (!dir) this.menuHeld = false;
    else if (!this.menuHeld) {
      this.menuHeld = true;
      this.menuRepeat = 0.35;
      step = true;
    } else if ((this.menuRepeat -= dt) <= 0) {
      this.menuRepeat = 0.12;
      step = true;
    }
    const buttons = [...document.querySelectorAll('button')].filter((b) => !b.disabled && b.offsetParent !== null && getComputedStyle(b).visibility !== 'hidden');
    if (!buttons.length) return;
    let at = buttons.indexOf(document.activeElement);
    if (step) {
      at = at < 0 ? 0 : (at + dir + buttons.length) % buttons.length;
      buttons[at].focus();
      buttons[at].scrollIntoView?.({ block: 'nearest' });
    }
    if (hit(B.A)) (at >= 0 ? buttons[at] : buttons[0]).click();
    if (hit(B.B) || hit(B.START)) {
      // back out: the pause sign's resume, or the prize counter / settings back button
      const c = this.client;
      if (c.pauseMenu?.open) c.input.onEscape?.();
      else if (c.hud?.prizesOpen) c.closePrizes();
      else document.querySelector('.settings-board .back')?.click();
    }
  }

  /** A short rumble (strong: a heavy blow). */
  rumble(strong = false) {
    const a = this.pad()?.vibrationActuator;
    a?.playEffect?.('dual-rumble', { duration: strong ? 160 : 90, strongMagnitude: strong ? 0.8 : 0.35, weakMagnitude: strong ? 0.6 : 0.5 }).catch?.(() => {});
  }
}
