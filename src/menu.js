// Menus in the park's own signage: the settings board (graphics, sound, mouse, keys) and the pause sign.
import { ACTIONS, DEFAULTS, keyName, saveSettings } from './settings.js';

const QUALITY = [['auto', 'Auto'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
const VOLUMES = [['master', 'Master'], ['music', 'Music box'], ['effects', 'Fighting & effects'], ['ambience', 'Rain & the night']];

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Fill a slider's track up to its value (the CSS paints --fill). */
function fill(input) {
  const k = (input.value - input.min) / (input.max - input.min);
  input.style.setProperty('--fill', `${Math.round(k * 100)}%`);
}

/**
 * The settings board. Changes apply at once: onChange(settings) is called with the whole settings object
 * (already saved). onBack closes it.
 */
export function settingsBoard(settings, { onChange, onBack }) {
  const s = settings;
  const board = el(`<div class="sign settings-board">
    <div class="bulbs"></div>
    <h2>Settings</h2>
    <h3>Picture</h3>
    <div class="choices quality">${QUALITY.map(([id, n]) => `<button class="choice" data-q="${id}">${n}</button>`).join('')}</div>
    <p class="fine q-note"></p>
    <h3>Sound</h3>
    ${VOLUMES.map(([id, n]) => `<label class="row">${n}<input type="range" min="0" max="1" step="0.05" data-vol="${id}"><output></output></label>`).join('')}
    <h3>Mouse</h3>
    <label class="row">Sensitivity<input type="range" min="0.3" max="2.5" step="0.05" data-sens><output></output></label>
    <label class="row">Look<span class="choices"><button class="choice" data-inv="0">Normal</button><button class="choice" data-inv="1">Inverted</button></span><span></span></label>
    <h3>Camera</h3>
    <label class="row">Field of view<input type="range" min="60" max="95" step="1" data-fov><output></output></label>
    <label class="row">Camera shake<input type="range" min="0" max="1" step="0.05" data-shake><output></output></label>
    <h3>Keys</h3>
    <div class="keys">${ACTIONS.map(([id, n]) => `<span>${n}</span><button class="key" data-act="${id}"></button>`).join('')}</div>
    <p class="fine">Click a key, then press the new one. Esc cancels. Number keys pick weapons, items and powers.</p>
    <div class="board-buttons"><button class="ticket cream reset">Reset</button><button class="ticket back">Back</button></div>
  </div>`);
  const notes = {
    auto: 'Sharpness adapts to keep the game smooth.',
    high: 'Full sharpness, every effect. Needs a strong graphics card.',
    medium: 'A little softer, lighter rain, simpler shadows.',
    low: 'For older computers: softer picture, light rain, no ambient shadowing.',
  };
  const changed = () => {
    saveSettings(s);
    onChange(s);
    show();
  };
  const show = () => {
    board.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === s.quality));
    board.querySelector('.q-note').textContent = notes[s.quality];
    board.querySelectorAll('[data-vol]').forEach((i) => {
      i.value = s.volume[i.dataset.vol];
      fill(i);
      i.nextElementSibling.textContent = `${Math.round(s.volume[i.dataset.vol] * 100)}`;
    });
    const sens = board.querySelector('[data-sens]');
    sens.value = s.sens;
    fill(sens);
    sens.nextElementSibling.textContent = `${Number(s.sens).toFixed(2)}×`;
    const fov = board.querySelector('[data-fov]');
    fov.value = s.fov ?? 72;
    fill(fov);
    fov.nextElementSibling.textContent = `${fov.value}°`;
    const shake = board.querySelector('[data-shake]');
    shake.value = s.shake ?? 1;
    fill(shake);
    shake.nextElementSibling.textContent = `${Math.round(shake.value * 100)}`;
    board.querySelectorAll('[data-inv]').forEach((b) => b.classList.toggle('on', (b.dataset.inv === '1') === !!s.invertY));
    board.querySelectorAll('[data-act]').forEach((b) => {
      if (!b.classList.contains('listen')) b.textContent = [...new Set((s.keys[b.dataset.act] || []).map(keyName))].slice(0, 2).join(' / ') || '—';
    });
  };
  board.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.q) {
      s.quality = t.dataset.q;
      changed();
    } else if (t.dataset.inv) {
      s.invertY = t.dataset.inv === '1';
      changed();
    } else if (t.dataset.act) {
      // listen for the next key
      board.querySelectorAll('.key.listen').forEach((k) => k.classList.remove('listen'));
      t.classList.add('listen');
      t.textContent = 'press a key…';
      const take = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        window.removeEventListener('keydown', take, true);
        t.classList.remove('listen');
        if (ev.code !== 'Escape') {
          // a key does one thing: take it off any other action first
          for (const [id, codes] of Object.entries(s.keys)) s.keys[id] = codes.filter((c) => c !== ev.code);
          s.keys[t.dataset.act] = [ev.code, ...(s.keys[t.dataset.act] || []).filter((c) => c !== ev.code)].slice(0, 2);
        }
        changed();
      };
      window.addEventListener('keydown', take, true);
    } else if (t.classList.contains('reset')) {
      const d = structuredClone(DEFAULTS);
      Object.assign(s, { quality: d.quality, volume: d.volume, sens: d.sens, invertY: d.invertY, keys: d.keys });
      changed();
    } else if (t.classList.contains('back')) onBack();
  });
  board.addEventListener('input', (e) => {
    const i = e.target;
    if (i.dataset.vol) s.volume[i.dataset.vol] = Number(i.value);
    else if (i.dataset.sens !== undefined) s.sens = Number(i.value);
    else if (i.dataset.fov !== undefined) s.fov = Number(i.value);
    else if (i.dataset.shake !== undefined) s.shake = Number(i.value);
    else return;
    changed();
  });
  show();
  return board;
}

/** The pause sign over a frozen park: resume, settings, or leave. */
export class PauseMenu {
  constructor(root, { settings, onChange, onResume, onQuit }) {
    this.root = root;
    this.opts = { settings, onChange, onResume, onQuit };
    this.layer = el('<div class="menu-layer"></div>');
    root.appendChild(this.layer);
    this.open = false;
  }

  /** online: the ride carries on behind the sign. */
  show(online = false) {
    this.online = online;
    this.open = true;
    this.layer.classList.add('show');
    this.main();
  }

  hide() {
    this.open = false;
    this.layer.classList.remove('show');
    this.layer.innerHTML = '';
  }

  main() {
    const sign = el(`<div class="sign pause-sign">
      <div class="bulbs"></div>
      <h2>${this.online ? 'Menu' : 'Ride Paused'}</h2>
      <p class="fine center">${this.online ? 'The ride goes on without you. Stay sharp.' : 'The park waits. It always has.'}</p>
      <div class="stack">
        <button class="ticket resume">Back on the ride <small>admit one</small></button>
        <button class="ticket cream settings">Settings</button>
        <button class="ticket dark quit">Leave the park</button>
      </div>
    </div>`);
    sign.querySelector('.resume').addEventListener('click', () => this.opts.onResume());
    sign.querySelector('.settings').addEventListener('click', () => this.settings());
    sign.querySelector('.quit').addEventListener('click', () => this.opts.onQuit());
    this.layer.replaceChildren(sign);
  }

  settings() {
    this.layer.replaceChildren(settingsBoard(this.opts.settings, { onChange: this.opts.onChange, onBack: () => this.main() }));
  }
}
