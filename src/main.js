// Title screen: the park itself, live in the rain, your rider standing under a lamp, and a clean panel to ride
// from: your name and level, Ride online, Practice, your earned looks, settings, and today's challenges.
// The world is built while you choose, so boarding the bus starts the ride straight away.
import { OUTFITS } from '../shared/constants.js';
import { loadCharacters, whenAllRiders, whenRider } from './characters.js';
import { initAudio } from './audio.js';
import { CREDITS } from './credits.js';
import { loadSettings } from './settings.js';
import { settingsBoard } from './menu.js';
import { loadProgress, saveProgress, levelOf, dailies, looksFor } from './progress.js';

const app = document.getElementById('app');
let parkInfo = Promise.resolve(null);
// knock on the ride server's door right away: the free host sleeps when nobody plays and takes most of a minute to
// wake, so by the time you have picked a rider it is usually up (the online sign keeps knocking if it is not)
{
  const ws = new URLSearchParams(location.search).get('server') || import.meta.env.VITE_SERVER_URL;
  // (its answer says how many are in the park, for the Ride online button)
  if (ws) parkInfo = fetch(ws.replace(/^ws/, 'http'), { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
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
  const progress = loadProgress();
  const el = document.createElement('div');
  el.className = 'title2 modern';
  el.innerHTML = `
    <div class="t-still"></div>
    <div class="t-logo">
      <div class="t-name">Last Ride</div>
      <div class="t-sub">Midnight Wonderland Tours · closed 1987</div>
      <div class="t-load"><div class="t-bar"><i></i></div><span class="t-tip"></span></div>
    </div>
    <div class="tm-rider">
      <div class="tm-rider-pick">
        <button class="tm-arrow tm-prev" aria-label="Previous rider">‹</button>
        <div><b class="t-rider-name"></b><small class="tm-count"></small></div>
        <button class="tm-arrow tm-next" aria-label="Next rider">›</button>
      </div>
      <span class="t-rider-blurb"></span>
    </div>
    <div class="tm-panel">
      <div class="tm-who">
        <input class="t-nick" maxlength="16" placeholder="Your name" aria-label="Your name" />
        <div class="tm-level"><b class="tm-lv"></b><div class="tm-xp"><i></i></div><small class="tm-xp-n"></small></div>
      </div>
      <button class="tm-play t-play" disabled>Loading the park…</button>
      <div class="tm-practice-row">
        <button class="tm-btn t-practice" disabled>Practice</button>
        <div class="tm-seg t-diff">${['easy', 'normal', 'hard'].map((d) => `<button data-d="${d}">${d[0].toUpperCase()}${d.slice(1)}</button>`).join('')}</div>
      </div>
      <div class="tm-row">
        <button class="tm-btn tm-looks">Looks</button>
        <button class="tm-btn t-settings">Settings</button>
        <button class="tm-btn tm-how">How to play</button>
      </div>
      <div class="tm-daily"><h4>Today</h4><ul></ul></div>
    </div>
    <div class="menu-layer t-settings-layer"></div>`;
  app.appendChild(el);

  const nick = el.querySelector('.t-nick');
  nick.value = profile.name;
  const play = el.querySelector('.t-play');
  const practice = el.querySelector('.t-practice');
  const riderName = el.querySelector('.t-rider-name');
  const riderBlurb = el.querySelector('.t-rider-blurb');
  const layer = el.querySelector('.t-settings-layer');
  let client = null;
  let ridersReady = false;

  // your level and today's challenges
  const showProgress = () => {
    const l = levelOf(progress.xp);
    el.querySelector('.tm-lv').textContent = `Level ${l.level}`;
    el.querySelector('.tm-xp i').style.width = `${l.need ? Math.round((l.into / l.need) * 100) : 100}%`;
    el.querySelector('.tm-xp-n').textContent = l.need ? `${l.into} / ${l.need} XP` : 'Max level';
    el.querySelector('.tm-daily ul').innerHTML = dailies(progress).map((d) => `<li class="${d.done ? 'done' : ''}">
      <span>${d.text}</span><b>${d.done ? 'Done' : d.unit === 's' ? `${Math.floor(d.have / 60)} / ${d.goal / 60} min` : `${d.have} / ${d.goal}`}</b>
      <i style="width:${Math.round((d.have / d.goal) * 100)}%"></i></li>`).join('');
  };
  showProgress();

  // the rider carousel
  const showRider = () => {
    const i = OUTFITS.findIndex((x) => x.id === profile.outfit);
    const o = OUTFITS[i];
    riderName.textContent = o.name;
    riderBlurb.textContent = o.blurb;
    el.querySelector('.tm-count').textContent = `${i + 1} / ${OUTFITS.length}`;
    // a rider still loading in the background shows as soon as it is in
    if (ridersReady) {
      const id = profile.outfit;
      whenRider(id).then(() => profile.outfit === id && client?.showcase(id, profile.look));
    }
  };
  const turn = (d) => {
    const i = OUTFITS.findIndex((x) => x.id === profile.outfit);
    profile.outfit = OUTFITS[(i + d + OUTFITS.length) % OUTFITS.length].id;
    showRider();
  };
  el.querySelector('.tm-prev').addEventListener('click', () => turn(-1));
  el.querySelector('.tm-next').addEventListener('click', () => turn(1));
  addEventListener('keydown', (e) => {
    if (!el.isConnected || e.target === nick || layer.classList.contains('show')) return;
    if (e.code === 'ArrowLeft') turn(-1);
    else if (e.code === 'ArrowRight') turn(1);
  });
  const showDiff = () => el.querySelectorAll('[data-d]').forEach((b) => b.classList.toggle('on', b.dataset.d === profile.difficulty));
  el.querySelector('.t-diff').addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    profile.difficulty = b.dataset.d;
    showDiff();
  });
  showRider();
  showDiff();

  const closeLayer = () => layer.classList.remove('show');
  el.querySelector('.t-settings').addEventListener('click', () => {
    layer.replaceChildren(settingsBoard(settings, {
      onChange: (s) => client?.applySettings(s),
      onBack: closeLayer,
    }));
    layer.classList.add('show');
  });

  // the locker: earned looks, picked here, worn on the ride (and shown on your rider right away)
  const KIND = { trail: 'Swing trail', tag: 'Name tag', dye: 'Clothing dye' };
  const swatch = (kind, x) => {
    if (kind === 'trail') return `rgb(${x.rgb.map((v) => Math.round(Math.pow(v, 1 / 2.2) * 255)).join(',')})`;
    if (kind === 'tag') return x.color;
    return x.rgb ? `rgb(${x.rgb.map((v) => Math.round(v * 255)).join(',')})` : 'linear-gradient(135deg, #6b5a4a, #3a4a5a)';
  };
  const openLooks = () => {
    const all = looksFor(progress);
    const panel = document.createElement('div');
    panel.className = 'tm-sheet';
    panel.innerHTML = `<h2>Looks</h2><p class="tm-fine">Earned by levelling up. Only how you look: no look makes you stronger.</p>
      ${Object.entries(all).map(([kind, list]) => `<h4>${KIND[kind]}</h4><div class="tm-tiles">${list.map((x) => `<button class="tm-tile ${progress.look[kind] === x.id ? 'on' : ''}" data-kind="${kind}" data-look="${x.id}" ${x.earned ? '' : 'disabled'}>
          <i style="background:${swatch(kind, x)}"></i><span>${x.name}</span><small>${x.earned ? (progress.look[kind] === x.id ? 'Wearing' : 'Wear') : `Level ${x.level}`}</small></button>`).join('')}</div>`).join('')}
      <button class="tm-btn tm-done">Done</button>`;
    panel.addEventListener('click', (e) => {
      const t = e.target.closest('[data-look]');
      if (t && !t.disabled) {
        progress.look[t.dataset.kind] = t.dataset.look;
        profile.look = { ...progress.look };
        saveProgress(progress);
        client?.showChar?.wear(profile.look);
        openLooks();
      } else if (e.target.closest('.tm-done')) closeLayer();
    });
    layer.replaceChildren(panel);
    layer.classList.add('show');
  };
  el.querySelector('.tm-looks').addEventListener('click', openLooks);

  // how to play, and the credits
  el.querySelector('.tm-how').addEventListener('click', () => {
    const panel = document.createElement('div');
    panel.className = 'tm-sheet';
    panel.innerHTML = `<h2>How the ride works</h2>
      <p>Twenty riders get off the bus in a park that closed in 1987. Loot bats, axes and crossbows from the stalls
      and chests and fight. The storm closes in around the big top; the last one standing leaves on the last bus.</p>
      <p>The dead come back as ghosts. They haunt with the rides, traps and blackouts, and a ghost who lands the
      killing blow steals that body and rides again (twice at most).</p>
      <p>Every ride earns experience. Levels unlock looks; three challenges change every day.</p>
      <h4>Credits</h4><ul class="tm-credits">${CREDITS.map((c) => `<li><a href="${c.url}" target="_blank" rel="noopener">${c.what}</a> by ${c.by} (${c.license})</li>`).join('')}</ul>
      <button class="tm-btn tm-done">Done</button>`;
    panel.querySelector('.tm-done').addEventListener('click', closeLayer);
    layer.replaceChildren(panel);
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
  // the weapons, loot and chests modelled in Blender
  const weapons = import('./weapons.js').then((m) => m.preloadWeapons());
  const clientModule = import('./client.js');
  // the bus driver is one of the riders, so the park is built once they are all in
  await Promise.all([fonts, bus, textures, riders, trees, weapons]);
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
  play.innerHTML = 'Ride online <small>Public ride · the bus leaves every half minute</small>';
  // how many are in the park right now (from the server's wake-up answer)
  parkInfo.then((info) => {
    if (info && typeof info.online === 'number' && !play.disabled) {
      play.querySelector('small').textContent = info.online ? `${info.online} in the park · the bus leaves every half minute` : 'Nobody in the park yet · bots fill the seats';
    }
  });

  const start = async (online, resume = null) => {
    if (play.disabled) return;
    // sound (and the music box) starts right here, on the press itself: a browser only lets a page start audio
    // during a click or key press, and waiting for the riders first could take longer than it allows
    initAudio();
    play.disabled = true;
    practice.disabled = true;
    profile.name = nick.value.trim().slice(0, 16) || 'Rider';
    saveProfile(profile);
    // everyone on the bus needs their model (usually long in by now)
    (online ? play : practice).textContent = 'Boarding…';
    await whenAllRiders();
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
  let resumed = false;
  try {
    const t = JSON.parse(sessionStorage.getItem('last-ride-ticket') || 'null');
    if (t && Date.now() - t.at < 30000) {
      resumed = true;
      start(true, t.ticket);
    }
  } catch {
    /* no session storage */
  }
  // an invite link (?ride): straight to the bus stop, where the friend who sent it is waiting
  if (!resumed && new URLSearchParams(location.search).has('ride')) {
    history.replaceState(null, '', location.pathname + location.search.replace(/[?&]ride(=[^&]*)?/, '').replace(/^&/, '?'));
    start(true);
  }
  practice.addEventListener('click', () => start(false));
  nick.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') start(true);
  });
}

title();
