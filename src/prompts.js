// What to press, said for whatever the player is holding: the keys they bound, or controller buttons once a
// controller is in use (the last thing touched wins). Prompts, the objective line and the controls card ask here
// instead of naming keys themselves.
import { keyName } from './settings.js';

let pad = false;
let binds = {};

/** The player's key bindings (settings.keys). */
export function setBinds(b) {
  binds = b || {};
}

/** A controller (true) or the keyboard and mouse (false) was used last. */
export function setPad(on) {
  if (pad === on) return;
  pad = on;
  document.body.classList.toggle('pad', on);
}

export function usingPad() {
  return pad;
}

let touch = false;
/** A touch screen with the on-screen controls (touch.js): prompts name those buttons instead of keys. */
export function setTouch(on) {
  touch = on;
}
export function usingTouch() {
  return touch && !pad;
}
const TOUCH = {
  interact: 'E', prizes: 'E', reload: 'R', jump: '⤒', slide: '⤓', up: '⤒', down: '⤓', attack: 'the attack button', aim: 'the aim button',
  cancel: 'the aim button', map: 'Map', weapons: '⇄', powers: '↯', pause: '☰', move: 'the left stick', look: 'drag to look', close: '✕',
};

const PAD = {
  interact: 'X', prizes: 'X', jump: 'A', slide: 'B', dodge: 'LB', reload: 'RB', sprint: 'L3', shoulder: 'R3', map: 'View',
  attack: 'RT', aim: 'LT', cancel: 'LT', move: 'L stick', look: 'R stick', up: 'A', down: 'B', fast: 'L3', powers: 'D-pad',
  weapons: 'Y', items: 'D-pad', pause: 'Start', help: 'H', close: 'B', chat: 'R3',
};
const MOUSE = { attack: 'Click', aim: 'Right-click', cancel: 'Right-click', look: 'Mouse', pause: 'Esc', powers: '1–6', weapons: '1–3', items: '4–0' };
const first = (action) => keyName((binds[action] || [])[0]);

/** The name of what triggers an action, e.g. 'E' or 'X', 'Click' or 'RT', 'WASD' or 'L stick'. */
export function keyOf(action) {
  if (pad) return PAD[action] ?? '?';
  if (touch && TOUCH[action]) return TOUCH[action];
  if (action === 'move') {
    const k = ['forward', 'left', 'back', 'right'].map(first);
    return k.every((x) => x.length === 1) ? k.join('') : 'move keys';
  }
  if (action === 'up') return first('jump');
  if (action === 'down') return first('slide');
  if (action === 'fast') return first('sprint');
  if (action === 'close') return 'Esc';
  return MOUSE[action] ?? first(action);
}

/** keyOf in a key cap, for HUD text. */
export const kbd = (action) => `<kbd>${keyOf(action)}</kbd>`;
