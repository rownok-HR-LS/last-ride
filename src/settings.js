// Player settings (kept in the browser): graphics quality, volumes, mouse, and key bindings.
const KEY = 'last-ride-settings';

/** Rebindable actions: [id, label, default keys]. The first key is the main binding, the rest are alternatives. */
export const ACTIONS = [
  ['forward', 'Move forward', ['KeyW', 'ArrowUp']],
  ['back', 'Move back', ['KeyS', 'ArrowDown']],
  ['left', 'Move left', ['KeyA', 'ArrowLeft']],
  ['right', 'Move right', ['KeyD', 'ArrowRight']],
  ['jump', 'Jump / fly up', ['Space']],
  ['sprint', 'Sprint', ['ShiftLeft', 'ShiftRight']],
  ['slide', 'Slide / fly down', ['KeyC', 'ControlLeft']],
  ['dodge', 'Dodge', ['KeyV', 'AltLeft']],
  ['interact', 'Pick up / open', ['KeyE', 'KeyF']],
  ['reload', 'Reload', ['KeyR']],
  ['shoulder', 'Swap shoulder', ['KeyQ']],
  ['prizes', 'Prize counter', ['KeyB']],
  ['map', 'Map', ['KeyM']],
  ['chat', 'Quick chat', ['KeyT']],
  ['help', 'Controls help', ['KeyH']],
  ['mute', 'Mute sound', ['KeyN']],
];

/**
 * quality: 'auto' adapts the resolution to keep frames smooth; the fixed levels trade sharpness and effects for speed.
 * Volumes are 0..1: music is the music box, effects are fighting and the HUD, ambience is rain, wind and the night.
 */
export const DEFAULTS = {
  quality: 'auto',
  volume: { master: 0.8, music: 0.6, effects: 1, ambience: 0.9 },
  sens: 1,
  invertY: false,
  // camera: field of view (degrees) and how much it shakes and punches on hits (0 = steady)
  fov: 72,
  shake: 1,
  motionBlur: true,
  // accessibility: how big the HUD panels are, and on-screen captions for important sounds nearby
  uiSize: 'normal',
  captions: false,
  keys: Object.fromEntries(ACTIONS.map(([id, , keys]) => [id, keys])),
};

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) return { ...DEFAULTS, ...s, volume: { ...DEFAULTS.volume, ...s.volume }, keys: { ...DEFAULTS.keys, ...s.keys } };
  } catch {
    /* storage unavailable */
  }
  return structuredClone(DEFAULTS);
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/** A key code as it should read on a keycap. */
export function keyName(code) {
  if (!code) return '—';
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Arrow/, '')
    .replace(/(Left|Right)$/, (m) => (/^(Shift|Control|Alt|Meta)/.test(code) ? '' : m))
    .replace('Control', 'Ctrl')
    .replace('Space', 'Space');
}
