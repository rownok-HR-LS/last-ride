// DOM heads-up display: vitals, weapons, ghost powers, minimap, landing map, kill feed, banners, end screen.
import { kbd, usingPad } from './prompts.js';

/** With a controller, items and ghost powers sit on the D-pad (and the bumpers): see gamepad.js. */
const PAD_ITEM = { medkit: '↑', bandage: '↓', soda: '←', holy: '→' };
const PAD_POWER = ['↑', '→', '↓', '←', 'LB', 'RB'];
import {
  WEAPONS, RARITIES, AMMO, ITEMS, POWERS, POWER_IDS, RIDES, PRIZES, weaponLabel,
} from '../shared/items.js';
import { MAP_HALF, MAX_REVIVES } from '../shared/constants.js';
import { COLLIDERS, REGIONS, FERRIS, TRACK, BUS_ROUTE } from '../shared/map.js';
import { groundTex } from './textures.js';
import { icon } from './icons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (t) => {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const ITEM_ICON = Object.fromEntries(['bandage', 'medkit', 'soda', 'holy', 'flare', 'salt', 'relic'].map((k) => [k, icon(k)]));
const POWER_ICON = Object.fromEntries(['trap', 'cursed', 'steps', 'blackout', 'scare', 'storm'].map((k) => [k, icon(k)]));
const HOW = { storm: 'the storm', trap: 'a bear trap', cursed: 'cursed loot', ferris: 'a flying gondola', coaster: 'the coaster', car: 'a bumper car' };

/**
 * Pre-rendered top-down park map, drawn like a modern tactical map: the ground photo darkened and drained, a faint
 * 25 m grid, structures as light outlines, the landmarks in muted colour and the area names in condensed caps.
 */
function renderMapImage(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.filter = 'grayscale(0.7) brightness(0.45) contrast(1.15)';
  ctx.drawImage(groundTex().image, 0, 0, size, size);
  ctx.filter = 'none';
  ctx.fillStyle = 'rgba(12, 16, 24, 0.35)';
  ctx.fillRect(0, 0, size, size);
  const k = size / (MAP_HALF * 2);
  const tx = (v) => (v + MAP_HALF) * k;
  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let g = -MAP_HALF; g <= MAP_HALF; g += 25) {
    ctx.beginPath();
    ctx.moveTo(tx(g), 0);
    ctx.lineTo(tx(g), size);
    ctx.moveTo(0, tx(g));
    ctx.lineTo(size, tx(g));
    ctx.stroke();
  }
  for (const col of COLLIDERS) {
    const flat = col.y1 < 0.6 && col.y0 < 0.1 && col.hx > 3;
    const high = col.y0 > 2;
    ctx.fillStyle = flat ? 'rgba(230,220,200,0.12)' : high ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.10)';
    ctx.strokeStyle = flat || high ? 'transparent' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1, size / 640);
    if (col.k === 'cyl') {
      if (col.r < 0.5) continue;
      ctx.beginPath();
      ctx.arc(tx(col.x), tx(col.z), col.r * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.save();
      ctx.translate(tx(col.x), tx(col.z));
      ctx.rotate(-col.rot);
      ctx.fillRect(-col.hx * k, -col.hz * k, col.hx * 2 * k, col.hz * 2 * k);
      ctx.strokeRect(-col.hx * k, -col.hz * k, col.hx * 2 * k, col.hz * 2 * k);
      ctx.restore();
    }
  }
  // the big top in muted red and cream
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(216,205,184,0.8)' : 'rgba(150,40,52,0.85)';
    ctx.beginPath();
    ctx.moveTo(tx(0), tx(0));
    ctx.arc(tx(0), tx(0), 15 * k, (i / 16) * Math.PI * 2, ((i + 1) / 16) * Math.PI * 2);
    ctx.fill();
  }
  // roller coaster track
  ctx.strokeStyle = 'rgba(214,80,96,0.75)';
  ctx.lineWidth = Math.max(1.2, 0.35 * k);
  ctx.beginPath();
  TRACK.pts.forEach((pt, i) => (i ? ctx.lineTo(tx(pt[0]), tx(pt[2])) : ctx.moveTo(tx(pt[0]), tx(pt[2]))));
  ctx.closePath();
  ctx.stroke();
  // ferris wheel
  ctx.strokeStyle = 'rgba(214,112,200,0.8)';
  ctx.lineWidth = Math.max(1.2, 0.5 * k);
  ctx.beginPath();
  ctx.moveTo(tx(FERRIS.x - FERRIS.r), tx(FERRIS.z));
  ctx.lineTo(tx(FERRIS.x + FERRIS.r), tx(FERRIS.z));
  ctx.stroke();
  // darker toward the edges
  const vg = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, size, size);
  if (size >= 400) {
    ctx.font = `600 ${Math.round(size / 50)}px "Barlow Condensed", "Rubik", sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(size / 300)}px`;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 5;
    ctx.fillStyle = 'rgba(240,232,218,0.88)';
    for (const r of REGIONS) ctx.fillText(r.name.toUpperCase(), tx(r.x), tx(r.z));
    ctx.shadowBlur = 0;
  }
  return c;
}

export class Hud {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    root.innerHTML = `
      <div class="hud-top-left"><canvas class="minimap" width="190" height="190"></canvas><div class="mini-zone"></div></div>
      <div class="hud-top-right">
        <div class="counts"><span class="c-alive" title="Survivors">👤 0</span><span class="c-ghosts" title="Ghosts">👻 0</span><span class="c-kills" title="Kills">💀 0</span></div>
        <div class="zone-info"></div>
        <div class="feed"></div>
      </div>
      <div class="crosshair"><i></i><i></i><i></i><i></i><b></b><u class="charge"></u></div>
      <div class="hitmark"></div>
      <div class="dmg-dir"></div>
      <div class="prompt"></div>
      <div class="progress"><div class="bar"></div><span></span></div>
      <div class="banner"><div class="big"></div><div class="small"></div></div>
      <div class="final-ride"></div>
      <div class="toast"></div>
      <div class="elim"></div>
      <div class="living-ui">
        <div class="vitals">
          <div class="revives"></div>
          <div class="bar shield"><div></div><span></span></div>
          <div class="bar hp"><div></div><span></span></div>
          <div class="bar stam"><div></div></div>
        </div>
        <div class="tickets"></div>
        <div class="weapons"></div>
        <div class="items"></div>
      </div>
      <div class="ghost-ui">
        <div class="ghost-title">👻 GHOST <span class="g-revives"></span></div>
        <div class="ecto"><div></div><span></span></div>
        <div class="powers"></div>
        <div class="ghost-hint"></div>
      </div>
      <div class="scope"></div>
      <div class="scare"><svg viewBox="0 0 200 200"><defs><radialGradient id="sg" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#f4f1e8"/><stop offset="1" stop-color="#6a6070"/></radialGradient></defs>
        <ellipse cx="100" cy="95" rx="70" ry="85" fill="url(#sg)"/>
        <ellipse cx="72" cy="80" rx="18" ry="24" fill="#000"/><ellipse cx="128" cy="80" rx="18" ry="24" fill="#000"/>
        <circle cx="72" cy="84" r="5" fill="#ff2030"/><circle cx="128" cy="84" r="5" fill="#ff2030"/>
        <path d="M60 135 Q100 185 140 135 Q100 160 60 135Z" fill="#200"/>
        <path d="M66 138 l6 12 l6 -10 l6 12 l6 -11 l6 12 l6 -12 l6 11 l6 -12 l6 12 l6 -11 l6 12 l4 -9" stroke="#eee" stroke-width="3" fill="none"/></svg></div>
      <div class="bigmap"><div class="bigmap-inner"><canvas width="640" height="640"></canvas><div class="bigmap-title"></div></div></div>
      <div class="prizes"></div>
      <div class="scoreboard"></div>
      <div class="endscreen"></div>
      <div class="help"></div>
    `;
    this.mini = $('.minimap', root).getContext('2d');
    this.miniImg = renderMapImage(1024);
    this.bigCanvas = $('.bigmap canvas', root);
    this.big = this.bigCanvas.getContext('2d');
    this.bigImg = renderMapImage(640);
    this.bigCanvas.addEventListener('click', (e) => {
      const r = this.bigCanvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * MAP_HALF * 2 - MAP_HALF;
      const z = ((e.clientY - r.top) / r.height) * MAP_HALF * 2 - MAP_HALF;
      this.h.onMapClick?.(x, z);
    });
    this.feedItems = [];
    this.lastKey = {};
    this.toastT = 0;
    this.bannerT = 0;
    this.hitT = 0;
    this.dirs = [];
    this.selectedPower = null;
    // power buttons are clickable too
    $('.powers', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-power]');
      if (b) this.h.onPower?.(b.dataset.power);
    });
  }

  set(sel, html) {
    if (this.lastKey[sel] === html) return;
    this.lastKey[sel] = html;
    $(sel, this.root).innerHTML = html;
  }

  toast(text) {
    const t = $('.toast', this.root);
    t.textContent = text;
    t.classList.add('show');
    this.toastT = 2.2;
  }

  /** The card under the death camera: who, with what, how much they had left (null hides it). */
  deathCard(info) {
    let card = $('.death-card', this.root);
    if (!card) {
      card = document.createElement('div');
      card.className = 'death-card sign';
      this.root.appendChild(card);
    }
    if (!info) {
      card.classList.remove('show');
      return;
    }
    const who = info.killer
      ? `<div class="dc-label">${info.ghost ? 'Taken by the ghost of' : 'Killed by'}</div><div class="dc-name">${esc(info.killer)}</div>`
      : '<div class="dc-label">The park took you</div>';
    const how = `<div class="dc-how">with ${esc(info.cause)}${info.hp != null ? ` · they had <b>${info.hp}</b> left` : ''}</div>`;
    card.innerHTML = `<div class="bulbs"></div>${who}${how}${info.steal ? '<div class="dc-how">and now they wear your body</div>' : ''}`;
    card.classList.remove('show');
    void card.offsetWidth;
    card.classList.add('show');
  }

  banner(big, small = '', dur = 3, cls = '') {
    const b = $('.banner', this.root);
    $('.big', b).textContent = big;
    $('.small', b).textContent = small;
    b.className = `banner show ${cls}`;
    this.bannerT = dur;
  }

  feed(html, cls = '') {
    const el = document.createElement('div');
    el.className = `feed-item ${cls}`;
    el.innerHTML = html;
    $('.feed', this.root).prepend(el);
    this.feedItems.push({ el, t: 6 });
    if (this.feedItems.length > 6) {
      const old = this.feedItems.shift();
      old.el.remove();
    }
  }

  kill(snap, ev, names) {
    const k = names(ev.killer);
    const v = names(ev.victim);
    let html;
    if (!ev.killer) html = `<b class="v">${esc(v)}</b> was taken by ${HOW[ev.how] || ev.how}`;
    else if (ev.steal) html = `${icon('ghost')} <b class="k">${esc(k)}</b> stole <b class="v">${esc(v)}</b>'s body <span class="how">${HOW[ev.how] || ev.how}</span>`;
    else html = `<b class="k">${esc(k)}</b> <span class="how">${WEAPONS[ev.how] ? WEAPONS[ev.how].name.split(' ').pop() : ev.how === 'fists' ? 'Fists' : HOW[ev.how] || ev.how}</span> <b class="v">${esc(v)}</b>`;
    const me = snap.me?.id;
    this.feed(html, ev.killer === me ? 'mine' : ev.victim === me ? 'me-dead' : ev.steal ? 'steal' : '');
  }

  /** Your kill: a short banner low in the middle with who it was. */
  eliminated(name) {
    const el = $('.elim', this.root);
    el.innerHTML = `<small>Eliminated</small><b>${icon('skull')}${esc(name)}</b>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  hitMarker(head) {
    const h = $('.hitmark', this.root);
    h.className = `hitmark show ${head ? 'head' : ''}`;
    this.hitT = 0.18;
  }

  damageFrom(angle) {
    const el = document.createElement('div');
    el.className = 'dir';
    el.style.transform = `rotate(${angle}rad)`;
    $('.dmg-dir', this.root).append(el);
    this.dirs.push({ el, t: 1 });
  }

  scare() {
    const s = $('.scare', this.root);
    s.classList.remove('show');
    void s.offsetWidth;
    s.classList.add('show');
  }

  showMap(on, title = '') {
    $('.bigmap', this.root).classList.toggle('show', on);
    this.set('.bigmap-title', title);
    this.mapOpen = on;
  }

  update(snap, dt, view) {
    const me = snap.me;
    const root = this.root;
    const ghost = me && me.state === 'ghost';
    root.classList.toggle('is-ghost', !!ghost);
    root.classList.toggle('is-watching', !!me?.spectator);
    root.classList.toggle('is-living', !!me && me.state === 'alive');
    root.classList.toggle('pre-land', !!me && me.state === 'bus');

    // timers
    if ((this.toastT -= dt) <= 0) $('.toast', root).classList.remove('show');
    if ((this.bannerT -= dt) <= 0) $('.banner', root).classList.remove('show');
    if ((this.hitT -= dt) <= 0) $('.hitmark', root).classList.remove('show');
    for (let i = this.feedItems.length - 1; i >= 0; i--) {
      const f = this.feedItems[i];
      if ((f.t -= dt) <= 0) {
        f.el.remove();
        this.feedItems.splice(i, 1);
      }
    }
    for (let i = this.dirs.length - 1; i >= 0; i--) {
      const d = this.dirs[i];
      d.t -= dt;
      d.el.style.opacity = Math.max(0, d.t);
      if (d.t <= 0) {
        d.el.remove();
        this.dirs.splice(i, 1);
      }
    }

    this.set('.c-alive', `${icon('alive')}<b>${snap.alive}</b>`);
    this.set('.c-ghosts', `${icon('ghost')}<b>${snap.ghosts}</b>`);
    if (me) this.set('.c-kills', `${icon('skull')}<b>${me.kills + me.ghostKills}</b>`);

    // storm
    const z = snap.zone;
    let zt = '';
    if (snap.phase === 'launch') zt = 'Arriving at Wonderland Park…';
    else if (z.state === 'idle') zt = 'Storm gathering…';
    else if (z.state === 'wait') zt = `${icon('storm')}Storm moves in <b>${fmt(z.t)}</b>`;
    else if (z.state === 'shrink') zt = `${icon('storm', 'warn')}<span class="warn">Storm closing <b>${fmt(z.t)}</b></span>`;
    else zt = `${icon('storm', 'warn')}<span class="warn">Storm closed</span>`;
    this.set('.zone-info', zt);

    // final ride
    const fr = $('.final-ride', root);
    if (snap.finalT !== null && snap.phase === 'live') {
      fr.classList.add('show');
      const surv = snap.players.find((p) => p.state !== 'ghost');
      this.set('.final-ride', `<div class="fr-title">The final ride</div><div class="fr-time">${Math.ceil(snap.finalT)}</div><div class="fr-sub">${surv ? `${esc(surv.name)} must survive` : ''}</div>`);
    } else fr.classList.remove('show');

    if (me && me.state === 'alive') this.updateLiving(snap, me, view);
    if (ghost) this.updateGhost(snap, me, view);

    // prompt
    let prompt = '';
    if (me?.state === 'alive' && me.interact) {
      const it = me.interact;
      let label;
      if (it.kind === 'chest') label = 'Open chest';
      else if (it.kind === 'weapon') label = `Pick up <b style="color:${RARITIES[it.rarity].color}">${weaponLabel(it.w, it.rarity)}</b>`;
      else if (it.kind === 'ammo') label = `Take ${AMMO[it.ammo].name} ×${it.count}`;
      else if (it.kind === 'tickets') label = `Take ${it.count} tickets`;
      else label = `Take ${ITEMS[it.item].name} ×${it.count}`;
      prompt = `${kbd('interact')} ${label}`;
    } else if (me?.state === 'alive' && me.booth >= 0 && !this.prizesOpen) {
      prompt = `${kbd('prizes')} Prize counter <span class="dim">· ${me.tickets} tickets</span>`;
    } else if (ghost && me.ride && !me.possess) {
      const R = RIDES[me.ride.kind];
      const cost = me.ride.kind === 'ferris' ? `${R.cost} per gondola` : `${R.cost} ecto`;
      prompt = me.ride.kind === 'coaster' && !me.ride.ready
        ? `Coaster recharging… ${Math.ceil(snap.coaster.cd)}s`
        : me.riseT > 0 ? `Still rising from the grave… ${Math.ceil(me.riseT)}s` : `${kbd('interact')} Possess <b>${R.name}</b> <span class="dim">(${cost})</span>`;
    } else if (ghost && me.possess) {
      const k = me.possess.kind;
      prompt = k === 'ferris' ? `${kbd('attack')} fling a gondola · ${kbd('interact')} let go`
        : k === 'car' ? `Drive with ${kbd('move')} and ram survivors · ${Math.ceil(me.carT)}s · ${kbd('interact')} let go`
          : 'Riding the coaster… hold on!';
    } else if (ghost && view.power) {
      const P = POWERS[view.power];
      prompt = view.power === 'scare'
        ? (view.scareTarget ? `${kbd('attack')} scare <b>${esc(view.scareTarget)}</b>` : 'Aim at a nearby survivor')
        : `${kbd('attack')} ${P.name} · ${kbd('cancel')} cancel${view.inRange ? '' : ' <b class="warn">(too far)</b>'}`;
    }
    this.set('.prompt', prompt);
    $('.prompt', root).classList.toggle('show', !!prompt);

    // progress bar (reload / heal)
    const prog = $('.progress', root);
    if (me?.state === 'alive' && (me.reloadT > 0 || me.use)) {
      const u = me.use ? 1 - me.use.t / me.use.dur : 1 - me.reloadT / me.reloadDur;
      $('.bar', prog).style.width = `${Math.round(u * 100)}%`;
      this.set('.progress span', me.use ? `Using ${ITEMS[me.use.item].name}` : 'Reloading');
      prog.classList.add('show');
    } else prog.classList.remove('show');

    // crosshair spread
    const ch = $('.crosshair', root);
    ch.style.setProperty('--gap', `${view.spreadPx}px`);
    ch.style.setProperty('--charge', view.charge || 0);
    ch.classList.toggle('melee', !!view.melee);
    ch.classList.toggle('charging', (view.charge || 0) > 0);
    ch.classList.toggle('hide', !!view.scoped || !me || me.state === 'bus');
    $('.scope', root).classList.toggle('show', !!view.scoped);

    this.drawMinimap(snap, view);
    if (this.mapOpen) this.drawBigMap(snap, view);
  }

  updateLiving(snap, me) {
    const p = snap.players.find((q) => q.id === me.id);
    if (!p) return;
    $('.vitals .hp div', this.root).style.width = `${Math.max(0, p.hp)}%`;
    $('.vitals .shield div', this.root).style.width = `${Math.max(0, p.shield)}%`;
    this.set('.vitals .hp span', `${Math.ceil(Math.max(0, p.hp))}`);
    this.set('.vitals .shield span', p.shield > 0 ? `${Math.ceil(p.shield)}` : '');
    let rev = '';
    for (let i = 0; i < MAX_REVIVES; i++) rev += `<i class="${i < me.revivesLeft ? 'on' : ''}" title="Revives left">${icon('skull')}</i>`;
    this.set('.revives', rev);
    const st = $('.vitals .stam', this.root);
    st.firstChild.style.width = `${Math.round(me.stam)}%`;
    st.classList.toggle('low', me.stam < 25);
    this.set('.tickets', me.tickets ? `${icon('ticket')}<b>${me.tickets}</b>` : '');
    const slots = me.slots.map((s, i) => {
      if (!s) return `<div class="slot empty ${i === me.cur ? 'cur' : ''}" data-key="Digit${i + 1}"><kbd>${i + 1}</kbd>${i === me.cur ? '<div class="gn">Fists</div>' : ''}</div>`;
      const def = WEAPONS[s.w];
      const col = RARITIES[s.rarity].color;
      let info;
      if (def.type === 'melee') {
        // durability: how many hits are left before it breaks
        const max = Math.round(def.dura * RARITIES[s.rarity].dura);
        const u = Math.max(0, s.dura / max);
        info = `<div class="dura ${u < 0.25 ? 'low' : ''}"><i style="width:${Math.round(u * 100)}%"></i></div>`;
      } else info = `<div class="ga">${def.mag ? `${s.mag}<small>/${me.ammo[def.ammo]}</small>` : me.ammo[def.ammo]}</div>`;
      return `<div class="slot ${i === me.cur ? 'cur' : ''}" style="--rc:${col}" data-key="Digit${i + 1}"><kbd>${i + 1}</kbd><div class="gn">${def.name}</div><div class="gr">${RARITIES[s.rarity].name}</div>${info}</div>`;
    });
    this.set('.weapons', slots.join(''));
    const items = Object.keys(ITEMS).map((k) => `<div class="item ${me.items[k] ? '' : 'none'} ${ITEMS[k].occult ? 'occult' : ''}" data-key="Digit${ITEMS[k].key}" title="${esc(ITEMS[k].help || ITEMS[k].name)}"><kbd>${usingPad() ? PAD_ITEM[k] ?? '' : ITEMS[k].key}</kbd>${ITEM_ICON[k]}<b>${me.items[k]}</b></div>`).filter((h, i) => me.items[Object.keys(ITEMS)[i]]);
    this.set('.items', items.join(''));
  }

  updateGhost(snap, me, view) {
    $('.ecto div', this.root).style.width = `${me.ecto}%`;
    this.set('.ecto span', `Ecto ${Math.floor(me.ecto)}`);
    this.set('.g-revives', me.revivesLeft > 0 ? `· ${me.revivesLeft} revive${me.revivesLeft > 1 ? 's' : ''} left` : '· lost soul');
    const html = POWER_IDS.map((id) => {
      const P = POWERS[id];
      const cd = me.cds[id] || 0;
      const ok = me.ecto >= P.cost && cd <= 0 && me.riseT <= 0 && !me.possess;
      return `<div class="power ${ok ? '' : 'off'} ${view.power === id ? 'sel' : ''}" data-power="${id}" title="${esc(P.help)}">
        <kbd>${usingPad() ? PAD_POWER[P.key - 1] ?? '' : P.key}</kbd><div class="pi">${POWER_ICON[id]}</div><div class="pn">${P.name}</div><div class="pc">${P.cost}</div>
        ${cd > 0 ? `<div class="pcd">${Math.ceil(cd)}</div>` : ''}</div>`;
    }).join('');
    this.set('.powers', html);
    let hint;
    if (me.riseT > 0) hint = `Rising from the grave… powers in ${Math.ceil(me.riseT)}s`;
    else if (me.revivesLeft > 0) hint = 'Land the killing blow on a survivor to steal their body.';
    else hint = 'Lost soul: no revives left, but you can still haunt.';
    this.set('.ghost-hint', hint);
  }

  drawMinimap(snap, view) {
    const ctx = this.mini;
    const W = 190;
    const me = snap.players.find((p) => p.id === snap.me?.id);
    const cx = me ? me.x : 0;
    const cz = me ? me.z : 0;
    const scale = 1.25; // px per metre
    const k = this.miniImg.width / (MAP_HALF * 2);
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#120a1a';
    ctx.fillRect(0, 0, W, W);
    const view2 = W / scale;
    ctx.drawImage(this.miniImg, (cx - view2 / 2 + MAP_HALF) * k, (cz - view2 / 2 + MAP_HALF) * k, view2 * k, view2 * k, 0, 0, W, W);
    const tx = (x) => W / 2 + (x - cx) * scale;
    const tz = (z) => W / 2 + (z - cz) * scale;
    this.drawZone(ctx, snap.zone, tx, tz, scale);
    this.drawMarkers(ctx, snap, tx, tz, scale, view);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
    // compass yaw
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', W / 2, 12);
  }

  drawZone(ctx, z, tx, tz, scale) {
    if (z.state === 'idle') return;
    ctx.save();
    ctx.fillStyle = 'rgba(150,40,200,0.35)';
    ctx.beginPath();
    ctx.rect(-2000, -2000, 4000, 4000);
    ctx.arc(tx(z.cx), tz(z.cz), Math.max(0, z.r * scale), 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#d070ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tx(z.cx), tz(z.cz), Math.max(0, z.r * scale), 0, Math.PI * 2);
    ctx.stroke();
    if (z.state === 'wait') {
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(tx(z.nx), tz(z.nz), Math.max(0, z.nr * scale), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawMarkers(ctx, snap, tx, tz, scale, view) {
    const me = snap.players.find((p) => p.id === snap.me?.id);
    const ghostView = !me || me.state === 'ghost';
    // gondola warnings
    for (const g of snap.gondolas) {
      ctx.strokeStyle = '#ff3355';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tx(g.to[0]), tz(g.to[2]), Math.max(3, RIDES.ferris.radius * scale), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of snap.players) {
      if (p.id === snap.me?.id) continue;
      const d = me ? Math.hypot(p.x - me.x, p.z - me.z) : 0;
      if (p.state === 'ghost') {
        if (!ghostView) continue;
        ctx.fillStyle = 'rgba(125,255,216,0.7)';
        ctx.beginPath();
        ctx.arc(tx(p.x), tz(p.z), 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.state === 'alive' && (p.revealed || (ghostView && d < 70))) {
        ctx.fillStyle = p.revealed ? (Math.floor(snap.time * 6) % 2 ? '#ff2040' : '#ffd0d8') : '#ff5a6a';
        ctx.beginPath();
        ctx.arc(tx(p.x), tz(p.z), p.revealed ? 4.5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (me && me.state === 'bus') {
      // the rest of the bus route, and the bus on it
      ctx.strokeStyle = 'rgba(255,225,79,0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      let first = true;
      BUS_ROUTE.pts.forEach((pt, i) => {
        if (BUS_ROUTE.cum[i] < Math.max(snap.bus.s, BUS_ROUTE.gateS - 20)) return;
        if (first) ctx.moveTo(tx(pt[0]), tz(pt[1]));
        else ctx.lineTo(tx(pt[0]), tz(pt[1]));
        first = false;
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffe14f';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🚌', tx(snap.bus.x), tz(snap.bus.z) + 5);
    }
    if (me) {
      ctx.save();
      ctx.translate(tx(me.x), tz(me.z));
      ctx.rotate(-view.camYaw);
      ctx.fillStyle = me.state === 'ghost' ? '#7dffd8' : '#ffe14f';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 2);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  drawBigMap(snap, view) {
    const ctx = this.big;
    const W = 640;
    ctx.clearRect(0, 0, W, W);
    ctx.drawImage(this.bigImg, 0, 0);
    const scale = W / (MAP_HALF * 2);
    const tx = (x) => (x + MAP_HALF) * scale;
    this.drawZone(ctx, snap.zone, tx, tx, scale);
    this.drawMarkers(ctx, snap, tx, tx, scale, view);
  }

  scoreboard(snap, show) {
    const sb = $('.scoreboard', this.root);
    sb.classList.toggle('show', show);
    if (!show) return;
    const rows = [...snap.players]
      .sort((a, b) => (a.state === 'ghost') - (b.state === 'ghost') || b.kills - a.kills)
      .map((p) => `<tr class="${p.id === snap.me?.id ? 'me' : ''} ${p.state === 'ghost' ? 'ghost' : ''}"><td>${icon(p.state === 'ghost' ? 'ghost' : 'alive')}</td><td>${esc(p.name)}${p.bot ? ' <span class="dim">bot</span>' : ''}</td><td>${p.kills}</td><td>${icon('skull').repeat(p.revivesLeft)}</td></tr>`)
      .join('');
    this.set('.scoreboard', `<table><tr><th></th><th>Rider</th><th>Kills</th><th>Revives</th></tr>${rows}</table>`);
  }

  /**
   * The end of the ride: the camera circles the winner for a moment, then the results go up on a worn park sign,
   * with your own ticket stub (place, kills, ghost kills, bodies stolen, damage, time survived) and the standings.
   */
  endScreen(snap, onAgain, onMenu) {
    const el = $('.endscreen', this.root);
    if (snap.phase !== 'end' || !snap.standings || this.hideEnd) {
      el.classList.remove('show');
      clearTimeout(this.endTimer);
      this.endTimer = null;
      return;
    }
    if (el.classList.contains('show') || this.endTimer) return;
    const st = snap.standings;
    const win = st[0];
    const mine = st.find((s) => s.id === snap.me?.id);
    const meWon = win && mine && win.id === mine.id;
    const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const rows = st.slice(0, 10)
      .map((s) => `<tr class="${s.id === mine?.id ? 'me' : ''}"><td>${s.place}</td><td>${esc(s.name)}</td><td>${s.kills}</td><td>${s.ghostKills}</td><td>${s.revives}</td><td>${clock(s.alive)}</td></tr>`)
      .join('');
    const stub = mine
      ? `<div class="end-stub">
          <div class="stub-place"><small>you placed</small><b>${mine.place}</b><small>of ${st.length}</small></div>
          <div class="stub-stats">
            <span><b>${mine.kills}</b> kills</span><span><b>${mine.ghostKills}</b> as a ghost</span>
            <span><b>${mine.revives}</b> bodies stolen</span><span><b>${mine.dmg}</b> damage</span><span><b>${clock(mine.alive)}</b> survived</span>
          </div>
        </div>`
      : '';
    el.innerHTML = `<div class="sign end-sign">
      <div class="bulbs"></div>
      <div class="end-kicker">${meWon ? 'Midnight Wonderland Tours' : 'The last bus has left'}</div>
      <h2>${meWon ? 'You rode the last bus out' : `${esc(win ? win.name : 'Nobody')} rode it out`}</h2>
      ${stub}
      <table class="end-board"><tr><th>#</th><th>Rider</th><th>Kills</th><th>Ghost</th><th>Stolen</th><th>Survived</th></tr>${rows}</table>
      <div class="board-buttons"><button class="ticket again">Ride again <small>admit one</small></button><button class="ticket dark menu">Main menu</button></div>
    </div>`;
    $('.again', el).addEventListener('click', onAgain);
    $('.menu', el).addEventListener('click', onMenu);
    // let the camera circle the winner first
    this.endTimer = setTimeout(() => {
      this.endTimer = null;
      el.classList.add('show');
    }, 2500);
  }

  /** The prize counter menu: number keys or clicks buy. */
  prizes(show, me, onBuy) {
    const el = $('.prizes', this.root);
    this.prizesOpen = show;
    el.classList.toggle('show', show);
    if (!show || !me) return;
    const key = `${me.tickets}`;
    if (key === this.prizeKey && el.innerHTML) return;
    this.prizeKey = key;
    // a worn park sign like the menus: the prizes as torn tickets with their price punched in
    el.innerHTML = `<div class="sign prize-card"><div class="bulbs"></div><h2>Prize Counter</h2>
      <div class="have">${icon('ticket')} <b>${me.tickets}</b> tickets</div>
      ${PRIZES.map((p, i) => `<button class="prize ${me.tickets >= p.cost ? '' : 'off'}" data-prize="${p.id}"><kbd>${i + 1}</kbd><span>${esc(p.label)}</span><b>${p.cost}</b></button>`).join('')}
      <p class="fine center">Kills give 20 tickets, chests 6<span class="keys-only"> · ${kbd('close')} to close</span></p>
      <button class="ticket dark p-close">Close</button></div>`;
    el.querySelectorAll('.prize').forEach((b) => b.addEventListener('click', () => onBuy(b.dataset.prize)));
    // a way out on touch screens, where there is no B or Esc
    el.querySelector('.p-close').addEventListener('click', () => this.h.onClosePrizes?.());
  }

  help(show) {
    const el = $('.help', this.root);
    el.classList.toggle('show', show);
    if (!show) return;
    el.innerHTML = `<div class="help-card"><h3>Controls</h3>
      <div class="cols"><div><h4>Survivor</h4>
      <p><kbd>WASD</kbd> move · <kbd>Space</kbd> jump · <kbd>Mouse</kbd> look</p>
      <p><kbd>Click</kbd> swing · <kbd>Hold click</kbd> heavy swing · <kbd>Right click</kbd> block (aim with a launcher)</p>
      <p><kbd>V</kbd> dodge · <kbd>E</kbd> pick up / open · <kbd>R</kbd> reload · <kbd>B</kbd> prize counter</p>
      <p><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> weapons · <kbd>4</kbd> bandage · <kbd>5</kbd> medkit · <kbd>6</kbd> shield soda</p>
      <p><kbd>7</kbd> holy water · <kbd>8</kbd> flare · <kbd>9</kbd> salt · <kbd>0</kbd> relic (against ghosts)</p></div>
      <div><h4>Ghost</h4>
      <p><kbd>WASD</kbd> fly · <kbd>Space</kbd>/<kbd>Ctrl</kbd> up/down · <kbd>Shift</kbd> fast</p>
      <p><kbd>1</kbd>–<kbd>6</kbd> pick a power, <kbd>click</kbd> to use</p>
      <p><kbd>E</kbd> possess a ride (Ferris wheel, coaster station, bumper car)</p>
      <p>Land the killing blow to steal a survivor's body.</p></div></div>
      <p class="dim"><kbd>M</kbd> map · <kbd>Tab</kbd> scoreboard · <kbd>H</kbd> this help · <kbd>Esc</kbd> free the mouse</p>
      <h4>Controller</h4>
      <p class="dim"><kbd>L stick</kbd> move (push all the way to sprint) · <kbd>R stick</kbd> look · <kbd>RT</kbd> attack · <kbd>LT</kbd> block / aim · <kbd>A</kbd> jump · <kbd>B</kbd> slide · <kbd>X</kbd> pick up · <kbd>Y</kbd> next weapon · <kbd>LB</kbd> dodge · <kbd>RB</kbd> reload · <kbd>D-pad</kbd> medkit, bandage, soda, holy water (as a ghost: powers) · <kbd>View</kbd> map · <kbd>Start</kbd> pause</p></div>`;
  }
}

