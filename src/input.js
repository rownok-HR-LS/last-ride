// Keyboard and mouse. Pointer lock when available, drag-to-look otherwise.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed since last frame
    this.dx = 0;
    this.dy = 0;
    this.lmb = false;
    this.rmb = false;
    this.lmbPressed = false;
    this.rmbPressed = false;
    this.wheel = 0;
    this.locked = false;
    this.enabled = true;
    this.sens = 0.0022;
    this.invertY = false;
    // action id -> key codes (see settings.js ACTIONS); set by the client from the player's settings
    this.binds = {};

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.locked) this.onEscape?.();
      if (!this.enabled || e.target.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Tab', 'Space', 'ControlLeft'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.lmb = this.rmb = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked && canvas.requestPointerLock) {
        try {
          const r = canvas.requestPointerLock({ unadjustedMovement: true });
          if (r && r.catch) {
            r.catch(() => {
              // some browsers reject the raw-input option; try plain lock before giving up
              const r2 = canvas.requestPointerLock();
              if (r2 && r2.catch) r2.catch(() => { this.lockFailed = true; });
            });
          }
        } catch {
          /* drag-look fallback */
        }
      }
      if (e.button === 0) {
        this.lmb = true;
        this.lmbPressed = true;
      }
      if (e.button === 2) {
        this.rmb = true;
        this.rmbPressed = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      // Esc in pointer lock frees the mouse before any key event arrives: that is the player asking to pause
      if (was && !this.locked) this.onUnlock?.();
      if (this.locked) this.lockFailed = false;
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockFailed = true;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      // without pointer lock, look around while a button is held
      if (this.locked || this.lmb || this.rmb) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
    });
    canvas.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
  }

  down(code) {
    return this.enabled && this.keys.has(code);
  }

  hit(code) {
    return this.enabled && this.pressed.has(code);
  }

  /** Is a bound action held (any of its keys)? */
  act(action) {
    return (this.binds[action] || []).some((k) => this.down(k));
  }

  /** Was a bound action pressed this frame? */
  actHit(action) {
    return (this.binds[action] || []).some((k) => this.hit(k));
  }

  /** Call once per frame after reading. */
  endFrame() {
    this.pressed.clear();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.lmbPressed = false;
    this.rmbPressed = false;
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
