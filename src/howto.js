// How to play: a tabbed sheet from the title menu. The ride, fighting, ghosts, the rides ghosts can take over,
// items and prizes, the controls (keyboard, touch or controller) and the credits. Names, costs and help lines come
// from the game's own tables (shared/items.js), so the sheet stays right when they change.
import { POWERS, RIDES, ITEMS, PRIZES, WEAPONS } from '../shared/items.js';
import { MAX_REVIVES, FINAL_RIDE_SECONDS, FINAL_RIDE_RESET } from '../shared/constants.js';
import { CREDITS } from './credits.js';
import { icon } from './icons.js';
import { CONTROLS } from './guide.js';
import { keyFor, setBinds, usingPad, usingTouch } from './prompts.js';
import { loadSettings } from './settings.js';

const TABS = [
  ['ride', 'The ride'],
  ['fight', 'Fighting'],
  ['ghost', 'Ghosts'],
  ['rides', 'Rides'],
  ['items', 'Items'],
  ['keys', 'Controls'],
  ['credits', 'Credits'],
];
// remembered while the page is open
let lastTab = 'ride';
let lastMode = null;

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const row = (ico, title, text) => `<li>${icon(ico)}<div><b>${title}</b><span>${text}</span></div></li>`;
const list = (rows) => `<ul class="ht-list">${rows.join('')}</ul>`;
// the touch names read "the left stick"; in a key cap the article goes
const cap = (action, mode) => `<kbd>${esc(keyFor(action, mode).replace(/^(the|a) /, ''))}</kbd>`;
const names = (ids, table) => ids.map((id) => table[id].name).join(', ');

function pages(mode) {
  const k = (a) => cap(a, mode);
  const melee = Object.keys(WEAPONS).filter((w) => WEAPONS[w].type === 'melee');
  const ranged = Object.keys(WEAPONS).filter((w) => WEAPONS[w].type === 'ranged');
  return {
    ride: list([
      row('alive', 'Twenty riders, one way out', 'A tour bus brings twenty riders into Wonderland Park, closed since 1987. Jump off when you like. Online, empty seats go to bots.'),
      row('chest', 'Start with your fists', 'Search stalls, chests and the ground for weapons, healing, occult tools and tickets.'),
      row('storm', 'The storm closes in', `It shrinks the park around the big top, and being outside it hurts. The map (${k('map')}) shows the safe circle.`),
      row('ticket', 'Tickets buy prizes', 'Chests, the ground and every kill give tickets. Spend them at the prize booths.'),
      row('skull', 'The last bus', `When one survivor is left, the last bus comes. Last ${FINAL_RIDE_SECONDS} seconds and you win. If a ghost steals a body, the clock goes back to ${FINAL_RIDE_RESET}.`),
      row('spark', 'Every night is different', 'Storm, drizzle, thick fog, thunder or a clear moon. Under a rare blood moon, ghosts rise faster and their powers cost less.'),
      row('target', 'Earn your way', 'Every ride earns experience. Levels unlock looks and emotes, and three challenges change every day.'),
    ]),
    fight: list([
      row('weapon', 'Swing', `${k('attack')} to swing. Three swings in a row make a combo.`),
      row('spark', 'Heavy swing', `Hold ${k('attack')} to wind up, let go to land it. It hits harder and breaks a block.`),
      row('shield', 'Block and parry', `${k('aim')} to block. Raise it just before a blow lands to parry and stagger the attacker.`),
      row('steps', 'Dodge and slide', `${k('dodge')} to dodge. ${k('slide')} while running to slide under a swing.`),
      row('alive', 'Stamina', 'Swinging and sprinting tire you, and heavy weapons tire you faster. Back off to catch your breath.'),
      row('weapon', 'Melee weapons break', `${esc(names(melee, WEAPONS))}. The whip pulls a rider to you.`),
      row('bow', 'Ranged weapons need ammo', `${esc(names(ranged, WEAPONS))}. ${k('aim')} to aim, ${k('reload')} to reload.`),
      row('target', 'Rarity', 'Weapons come Common, Uncommon, Rare, Epic and Legendary. Rarer ones hit harder, swing faster and last longer.'),
    ]),
    ghost: `${list([
      row('ghost', 'Death is not the end', `You rise as a ghost and fly over the park: ${k('up')} up, ${k('down')} down, ${k('fast')} fast.`),
      row('skull', 'Steal a body', `Land the killing blow on a survivor, with a power or a ride, and you take their body and ride again (${MAX_REVIVES === 2 ? 'twice' : `${MAX_REVIVES} times`} at most).`),
      row('spark', 'Ghost energy', `Powers and rides cost energy, and it fills up again over time. Pick a power with ${k('powers')}, use it with ${k('attack')}.`),
    ])}
      <h4>Powers</h4>${list(Object.entries(POWERS).map(([id, p]) => row(id, `${esc(p.name)} <small>${p.cost} energy${p.unlock ? ` · after ${p.unlock} s as a ghost` : ''}</small>`, esc(p.help))))}
      <h4>Survivors fight back</h4>${list(['holy', 'flare', 'salt', 'relic'].map((id) => row(id, esc(ITEMS[id].name), esc(ITEMS[id].help))))}`,
    rides: `<p class="ht-lead">A ghost can take over a ride: fly up to it and press ${k('interact')}. Most rides flash and make a noise just before they strike, so get clear. Holy water breaks the hold.</p>
      ${list(Object.entries(RIDES).map(([id, r]) => row(id, `${esc(r.name)} <small>${r.cost} energy</small>`, esc(r.help))))}`,
    items: `${list([
      row('bandage', 'Bandage', `Heals ${ITEMS.bandage.heal}, up to ${ITEMS.bandage.cap} health.`),
      row('medkit', 'Medkit', 'Heals you to full. It takes a while, so find cover.'),
      row('soda', 'Shield Soda', `Adds ${ITEMS.soda.shield} shield on top of your health.`),
      ...['holy', 'flare', 'salt', 'relic'].map((id) => row(id, esc(ITEMS[id].name), esc(ITEMS[id].help))),
    ])}
      <p class="ht-lead">Use items with ${k('items')}. At a prize booth, press ${k('prizes')}:</p>
      <ul class="ht-prizes">${PRIZES.map((p) => `<li><span>${esc(p.label)}</span><b>${icon('ticket')} ${p.cost}</b></li>`).join('')}</ul>`,
    keys: `<div class="ht-modes" role="tablist">${[['keys', 'Keyboard & mouse'], ['touch', 'Touch'], ['pad', 'Controller']]
      .map(([m, label]) => `<button class="ht-mode${m === mode ? ' on' : ''}" data-mode="${m}">${label}</button>`).join('')}</div>
      <div class="ht-keys"><div><h4>Survivor</h4>${CONTROLS.alive.map(([a, d]) => `<div class="ht-key">${cap(a, mode)}<span>${esc(d)}</span></div>`).join('')}</div>
      <div><h4>Ghost</h4>${CONTROLS.ghost.map(([a, d]) => `<div class="ht-key">${cap(a, mode)}<span>${esc(d)}</span></div>`).join('')}
      <h4>Any time</h4>${(mode === 'touch' ? [['chat', 'quick chat'], ['<kbd>emote button</kbd>', 'emotes'], ['pause', 'menu']] : [['chat', 'quick chat (hold: emotes)'], ['help', 'controls card'], ['pause', 'menu']])
        .map(([a, d]) => `<div class="ht-key">${a.startsWith('<') ? a : cap(a, mode)}<span>${d}</span></div>`).join('')}</div></div>
      ${mode === 'keys' ? '<p class="ht-lead">Change any key in Settings.</p>' : ''}`,
    credits: `<p class="ht-lead">Last Ride is built from these free models, scans and sounds. Thank you to everyone who made them.</p>
      <ul class="tm-credits">${CREDITS.map((c) => `<li><a href="${c.url}" target="_blank" rel="noopener">${c.what}</a> by ${c.by} (${c.license})</li>`).join('')}</ul>`,
  };
}

/** The sheet, ready to put in the menu's overlay layer; close() is called by Done. */
export function howToPlay(close) {
  try {
    setBinds(loadSettings().keys);
  } catch {
    /* default keys */
  }
  let mode = lastMode || (usingPad() ? 'pad' : usingTouch() || matchMedia('(pointer: coarse)').matches ? 'touch' : 'keys');
  const panel = document.createElement('div');
  panel.className = 'tm-sheet ht';
  panel.innerHTML = `<h2>How to play</h2>
    <nav class="ht-tabs" role="tablist">${TABS.map(([id, label]) => `<button role="tab" data-tab="${id}">${label}</button>`).join('')}</nav>
    <div class="ht-page" role="tabpanel"></div>
    <button class="tm-btn tm-done">Done</button>`;
  const page = panel.querySelector('.ht-page');
  const show = (tab) => {
    lastTab = tab;
    page.innerHTML = pages(mode)[tab];
    page.scrollTop = 0;
    panel.scrollTop = 0;
    for (const b of panel.querySelectorAll('.ht-tabs button')) {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on);
      if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };
  panel.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) show(t.dataset.tab);
    const m = e.target.closest('[data-mode]');
    if (m) {
      mode = lastMode = m.dataset.mode;
      show('keys');
    }
    if (e.target.closest('.tm-done')) close();
  });
  // arrow keys move between tabs
  panel.querySelector('.ht-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex(([id]) => id === lastTab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
    show(next);
    panel.querySelector(`[data-tab="${next}"]`).focus();
  });
  show(lastTab);
  return panel;
}
