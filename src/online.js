// The online ride from the browser's side: the bus stop sign while you wait, boarding when the bus leaves,
// watching a ride already under way, and back to the stop afterwards.
import { Connection, NetGame, serverUrl } from './net.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clock = (s) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export class Online {
  constructor(app, client, profile) {
    this.app = app;
    this.client = client;
    this.profile = profile;
    this.mode = 'lobby';
    this.status = null;
    this.sign = document.createElement('div');
    this.sign.className = 'lobby-layer';
    app.appendChild(this.sign);
  }

  /** Connect and get in line for the next bus. */
  async join() {
    this.show('Calling the park…', '', '');
    try {
      this.conn = new Connection(serverUrl());
      await this.conn.opened;
    } catch {
      this.lost('The park is not answering', 'The ride server could be asleep or offline. Give it a minute and try again, or take a practice ride.');
      return;
    }
    const h = this.conn.handlers;
    h.lobby = (m) => {
      this.status = m;
      this.render();
    };
    h.start = (m) => this.board(new NetGame(this.conn, m.id, this.profile), 'ride');
    h.watch = () => this.board(new NetGame(this.conn, null, this.profile), 'watch');
    h.over = () => {
      // watchers go straight back in line; riders read their results first
      if (this.mode === 'watch') this.toLobby();
      else this.mode = 'ended';
    };
    h.close = () => this.lost('Lost the line to the park', 'The connection dropped. Head back to the menu to ride again.');
    this.conn.send({ t: 'join', name: this.profile.name, outfit: this.profile.outfit });
    this.client.onAgain = () => this.again();
    this.render();
  }

  /** The bus left with you on it (or you are watching): start once the first update is in. */
  board(game, mode) {
    this.mode = mode;
    const go = () => {
      if (!game.ready) return setTimeout(go, 30);
      this.sign.classList.remove('show');
      this.client.hudRoot.style.visibility = '';
      this.client.start(this.profile, game);
    };
    go();
  }

  /** "Ride again" on the results sign. */
  again() {
    this.conn.send({ t: 'again' });
    this.client.hud.hideEnd = true;
    this.toLobby();
  }

  toLobby() {
    this.mode = 'lobby';
    // the last ride's HUD has no business behind the bus stop sign
    if (this.client.game) this.client.hudRoot.style.visibility = 'hidden';
    this.render();
  }

  render() {
    const m = this.status;
    if (this.mode !== 'lobby' || !m) return;
    const others = Math.max(0, m.waiting - 1);
    if (m.busIn != null) {
      this.show('The bus leaves in', clock(m.busIn), `${others ? `${others} other rider${others > 1 ? 's' : ''} waiting` : 'You are first in line'} · bots fill the empty seats · ${m.online} in the park`);
    } else if (m.ride) {
      // a ride is under way (you just finished yours, or you will board after it)
      this.show(m.ride.phase === 'end' ? 'The ride is over' : 'A ride is under way', m.ride.phase === 'end' ? '…' : `${m.ride.alive} alive`, `The next bus leaves when it is over · ${m.online} in the park`);
    } else this.show('Waiting for the bus', '…', `${m.online} in the park`);
  }

  show(title, big, info) {
    if (!this.sign.querySelector('.lobby-sign')) {
      this.sign.innerHTML = `<div class="sign lobby-sign">
        <div class="bulbs"></div>
        <div class="lb-kicker">Midnight Wonderland Tours · bus stop</div>
        <h3 class="lb-title"></h3>
        <div class="lb-big"></div>
        <p class="fine center lb-info"></p>
        <button class="ticket dark lb-leave">Leave the stop</button>
      </div>`;
      this.sign.querySelector('.lb-leave').addEventListener('click', () => location.reload());
    }
    this.sign.querySelector('.lb-title').textContent = title;
    this.sign.querySelector('.lb-big').textContent = big;
    this.sign.querySelector('.lb-info').innerHTML = esc(info);
    this.sign.classList.add('show');
  }

  lost(title, info) {
    this.mode = 'lost';
    this.sign.innerHTML = `<div class="sign lobby-sign">
      <div class="bulbs"></div>
      <h3>${esc(title)}</h3>
      <p class="fine center">${esc(info)}</p>
      <button class="ticket lb-leave">Back to the menu</button>
    </div>`;
    this.sign.querySelector('.lb-leave').addEventListener('click', () => location.reload());
    this.sign.classList.add('show');
    document.exitPointerLock?.();
  }
}
