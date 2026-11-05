// Title screen: the park itself, live in the rain behind a worn ticket-booth sign where you pick your rider.
// The world is built while you choose, so boarding the bus starts the ride straight away.
import { OUTFITS } from '../shared/constants.js';
import { loadCharacters, whenAllRiders, whenRider } from './characters.js';
import { initAudio } from './audio.js';
import { CREDITS } from './credits.js';
import { loadSettings } from './settings.js';
import { settingsBoard } from './menu.js';
import { loadProgress } from './progress.js';

const app = document.getElementById('app');
// knock on the ride server's door right away: the free host sleeps when nobody plays and takes most of a minute to
// wake, so by the time you have picked a rider it is usually up (the online sign keeps knocking if it is not)
{
  const ws = new URLSearchParams(location.search).get('server') || import.meta.env.VITE_SERVER_URL;
  if (ws) fetch(ws.replace(/^ws/, 'http'), { cache: 'no-store' }).catch(() => {});
}
/** Shown while the park loads. */
const TIPS = [
  'Hold attack to wind up a heavy swing. Let go to land it.',
  'Raise your guard just before a blow lands to parry and stagger the attacker.',
  'The dead come back as ghosts. Land the killing blow on a survivor to steal their body.',
  'Ghosts can take over the Ferris wheel, the roller coaster and the bumper cars.',
  'Holy water burns ghosts. A circle of salt keeps them out.',
  'The storm closes in around the big top. Stay inside the circle.',
  'Tickets buy prizes at the booths: a chainsaw, a legendary crossbow, medkits and more.',
  'Heavy weapons hit harder but tire you faster. Watch your stamina.',
];
const PROFILE_KEY = 'last-ride-profile';

function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (p && typeof p.name === 'string') return { difficulty: 'normal', ...p };
  } catch {
    /* storage unavailable */
  }
  return { name: '', outfit: OUTFITS[0].id, difficulty: 'normal' };
}

function saveProfile(p) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

async function title() {
  const profile = loadProfile();
  // the looks you have earned and picked ride with you (other riders see them online)
  profile.look = loadProgress().look;
  const settings = loadSettings();
  if (!OUTFITS.some((o) => o.id === profile.outfit)) profile.outfit = OUTFITS[0].id;
  const el = document.createElement('div');
  el.className = 'title2';
  el.innerHTML = `
    <div class="t-still"></div>
    <div class="t-logo">
      <div class="t-name">Last Ride</div>
      <div class="t-sub">Midnight Wonderland Tours · closed 1987</div>
      <div class="t-load"><div class="t-bar"><i></i></div><span class="t-tip"></span></div>
    </div>
    <div class="t-rider"><b class="t-rider-name"></b><span class="t-rider-blurb"></span></div>
    <div class="sign t-panel">
      <div class="bulbs"></div>
      <h3>Name on your ticket</h3>
      <input class="t-nick" maxlength="16" placeholder="Rider" />
      <h3>Who rides tonight</h3>
      <div class="choices t-outfits">${OUTFITS.map((o) => `<button class="choice" data-id="${o.id}">${o.name}</button>`).join('')}</div>
      <h3>Practice riders</h3>
      <div class="choices t-diff">${['easy', 'normal', 'hard'].map((d) => `<button class="choice" data-d="${d}">${d[0].toUpperCase()}${d.slice(1)}</button>`).join('')}</div>
      <div class="stack">
        <button class="ticket t-play" disabled>Loading the park…</button>
        <button class="ticket cream t-practice" disabled>Practice <small>offline vs bots</small></button>
        <button class="ticket cream t-settings">Settings</button>
      </div>
      <p class="fine center">Online: one public ride. The bus leaves every half minute with everyone waiting, and bots take the empty seats.</p>
      <details class="t-more"><summary>How the ride works · credits</summary>
        <p>Survivors loot bats, axes and crossbows and fight; the last one standing leaves on the last bus.
        The dead come back as ghosts, haunt with rides, traps and blackouts, and a ghost who lands the killing blow
        steals that body (twice at most).</p>
        <ul>${CREDITS.map((c) => `<li><a href="${c.url}" target="_blank" rel="noopener">${c.what}</a> by ${c.by} (${c.license})</li>`).join('')}</ul>
      </details>
    </div>
    <div class="menu-layer t-settings-layer"></div>`;
  app.appendChild(el);

  const nick = el.querySelector('.t-nick');
  nick.value = profile.name;
  const play = el.querySelector('.t-play');
  const practice = el.querySelector('.t-practice');
  const riderName = el.querySelector('.t-rider-name');
  const riderBlurb = el.querySelector('.t-rider-blurb');
  let client = null;
  let ridersReady = false;

  const showRider = () => {
    const o = OUTFITS.find((x) => x.id === profile.outfit);
    el.querySelectorAll('[data-id]').forEach((b) => b.classList.toggle('on', b.dataset.id === profile.outfit));
    riderName.textContent = o.name;
    riderBlurb.textContent = o.blurb;
    // a rider still loading in the background shows as soon as it is in
    if (ridersReady) {
      const id = profile.outfit;
      whenRider(id).then(() => profile.outfit === id && client?.showcase(id, profile.look));
    }
  };
  const showDiff = () => el.querySelectorAll('[data-d]').forEach((b) => b.classList.toggle('on', b.dataset.d === profile.difficulty));
  el.querySelector('.t-outfits').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    profile.outfit = b.dataset.id;
    showRider();
  });
  el.querySelector('.t-diff').addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    profile.difficulty = b.dataset.d;
    showDiff();
  });
  showRider();
  showDiff();

  const layer = el.querySelector('.t-settings-layer');
  el.querySelector('.t-settings').addEventListener('click', () => {
    layer.replaceChildren(settingsBoard(settings, {
      onChange: (s) => client?.applySettings(s),
      onBack: () => layer.classList.remove('show'),
    }));
    layer.classList.add('show');
  });

  // load everything the park needs, then build it behind the sign
  // relative to the page, so it works under the GitHub Pages sub-path too
  el.querySelector('.t-still').style.backgroundImage = 'url(./title_still.webp)';
  const bar = el.querySelector('.t-bar i');
  const step = (what, u) => {
    play.textContent = what;
    if (u !== undefined) bar.style.width = `${Math.round(u * 100)}%`;
  };
  // a tip every few seconds while it loads
  const tipEl = el.querySelector('.t-tip');
  let tip = Math.floor(Math.random() * TIPS.length);
  const nextTip = () => {
    tipEl.textContent = TIPS[tip++ % TIPS.length];
  };
  nextTip();
  const tipTimer = setInterval(nextTip, 4500);
  // the riders, the fonts, the bus and the ground textures all download at once
  step('Loading the park…', 0);
  // your rider and the bus driver first; the other riders load while you are on the menu
  const riders = loadCharacters((u) => step(`Loading the park… ${Math.round(u * 100)}%`, u * 0.9), [profile.outfit, 'eric']);
  const fonts = Promise.all([document.fonts.load('80px Rye'), document.fonts.load('900 80px Cinzel'), document.fonts.load('600 20px "Barlow Condensed"')]).catch(() => {
    /* fall back to Impact */
  });
  // the bus carries everyone in the opening shots, so it has to be there from the first frame
  const bus = import('./bus.js').then((m) => m.preloadBus()).catch((e) => console.warn('bus model', e));
  // the signs paint over the rust photo, so make sure the textures are in first
  const textures = import('./textures.js').then((tex) => {
    ['rusty_metal_02', 'damaged_plaster', 'forrest_ground_01', 'cobblestone_floor_08'].forEach((n) => tex.pbr(n));
    return tex.texturesReady();
  });
  // the trees come baked (growing them here took seconds), and the park is planted from them
  const trees = import('./trees.js').then((m) => m.preloadTrees());
  const clientModule = import('./client.js');
  // the bus driver is one of the riders, so the park is built once they are all in
  await Promise.all([fonts, bus, textures, riders, trees]);
  const { Client } = await clientModule;
  client = new Client(app, profile, settings, { attract: true });
  window.__lr = client;
  // the canvas goes under the sign
  app.insertBefore(client.renderer.domElement, app.firstChild);
  ridersReady = true;
  client.showcase(profile.outfit, profile.look);
  // the still of the park fades into the live one, and the loading line goes
  step('', 1);
  clearInterval(tipTimer);
  requestAnimationFrame(() => el.classList.add('ready'));
  play.disabled = false;
  practice.disabled = false;
  play.innerHTML = 'Ride online <small>admit one</small>';

  const start = async (online, resume = null) => {
    if (play.disabled) return;
    play.disabled = true;
    practice.disabled = true;
    profile.name = nick.value.trim().slice(0, 16) || 'Rider';
    saveProfile(profile);
    // everyone on the bus needs their model (usually long in by now)
    (online ? play : practice).textContent = 'Boarding…';
    await whenAllRiders();
    initAudio();
    el.remove();
    if (!online) return client.start(profile);
    // wait at the bus stop over the live park, then board when the bus leaves
    const { Online } = await import('./online.js');
    const ride = new Online(app, client, profile);
    if (import.meta.env.DEV) window.__online = ride;
    ride.join(resume);
  };
  play.addEventListener('click', () => start(true));
  // came back from a refresh in the middle of a ride: straight back to your rider
  try {
    const t = JSON.parse(sessionStorage.getItem('last-ride-ticket') || 'null');
    if (t && Date.now() - t.at < 30000) start(true, t.ticket);
  } catch {
    /* no session storage */
  }
  practice.addEventListener('click', () => start(false));
  nick.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') start(true);
  });
}

title();
