// The online ride from the browser's side: the bus stop sign while you wait, boarding when the bus leaves,
// watching a ride already under way, and back to the stop afterwards.
import { NetGame, connect, wakeServer } from './net.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** How long a sleeping server gets to wake before we give up, and how long a dropped rider keeps trying. */
const WAKE_FOR = 100000;
const RETURN_FOR = 30000;
/** This tab's ticket, kept through a page refresh (sessionStorage is per tab; main.js reads it on load). */
const TICKET_KEY = 'last-ride-ticket';

function keepTicket(ticket) {
  try {
    if (ticket) sessionStorage.setItem(TICKET_KEY, JSON.stringify({ ticket, at: Date.now() }));
    else sessionStorage.removeItem(TICKET_KEY);
  } catch {
    /* private mode: no refresh-proofing */
  }
}

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
    // leaving the page mid-ride (a refresh): the clock for coming back starts now
    addEventListener('pagehide', () => {
      if (this.mode === 'ride' && this.ticket) keepTicket(this.ticket);
    });
  }

  /**
   * Connect and get in line for the next bus. A server that was asleep gets up to WAKE_FOR to wake: we keep knocking
   * and keep trying, and say so, instead of giving up at the first refusal.
   */
  async join(resume = null) {
    this.show(resume ? 'Back to your ride…' : 'Calling the park…', '', '');
    const t0 = Date.now();
    const waited = () => `${Math.round((Date.now() - t0) / 1000)}s`;
    // the count keeps ticking while a knock is out (one can take ten seconds against a sleeping host)
    let waking = false;
    const ticker = setInterval(() => {
      if (waking) this.sign.querySelector('.lb-big').textContent = waited();
    }, 1000);
    let conn = null;
    while (!conn) {
      try {
        conn = await connect(8000);
      } catch {
        if (Date.now() - t0 > WAKE_FOR) {
          clearInterval(ticker);
          this.lost('The park is not answering', 'The ride server is offline right now. Try again in a few minutes, or take a practice ride.');
          return;
        }
        waking = true;
        this.show('Waking the park', waited(), 'The ride server naps when nobody is around. It usually wakes within a minute.');
        await Promise.all([wakeServer(10000), sleep(1500)]);
      }
    }
    clearInterval(ticker);
    this.wire(conn);
    // after a refresh mid-ride the ticket takes your rider back from the bot (or, if the ride is gone, gets in line)
    if (resume) conn.send({ t: 'rejoin', ticket: resume, name: this.profile.name, outfit: this.profile.outfit, look: this.profile.look });
    else conn.send({ t: 'join', name: this.profile.name, outfit: this.profile.outfit, look: this.profile.look });
    this.client.onAgain = () => this.again();
    this.render();
  }

  /** Listen on a (new) line. */
  wire(conn) {
    this.conn = conn;
    const h = conn.handlers;
    h.lobby = (m) => {
      this.status = m;
      this.render();
    };
    h.start = (m) => {
      if (m.ticket) {
        this.ticket = m.ticket;
        keepTicket(m.ticket);
      }
      // back in your own body after a dropped line: the ride never stopped
      if (m.back && this.net && this.net.myId === m.id) {
        this.net.rebind(conn);
        this.mode = 'ride';
        this.banner(null);
        return;
      }
      this.net = new NetGame(conn, m.id, this.profile);
      this.board(this.net, 'ride');
    };
    h.watch = () => {
      this.ticket = null;
      keepTicket(null);
      this.banner(null);
      this.net = new NetGame(conn, null, this.profile);
      this.board(this.net, 'watch');
    };
    h.rejoinFail = () => {
      // the ride ended while we were away (or the server restarted): back to the stop
      this.ticket = null;
      keepTicket(null);
      this.banner(null);
      this.toLobby();
    };
    h.over = () => {
      this.ticket = null;
      keepTicket(null);
      // watchers go straight back in line; riders read their results first
      if (this.mode === 'watch') this.toLobby();
      else this.mode = 'ended';
    };
    h.close = () => this.dropped();
  }

  /**
   * The line dropped (a phone changing networks, a Wi-Fi blip, a server restart). Mid-ride a bot keeps your rider
   * going while we call back for up to RETURN_FOR, then you take it back where it stands.
   */
  async dropped() {
    if (this.calling) return;
    this.calling = true;
    const riding = this.mode === 'ride' && this.ticket;
    const t0 = Date.now();
    while (Date.now() - t0 < RETURN_FOR) {
      this.banner(riding ? 'Connection lost · a bot is holding your rider · reconnecting…' : 'Connection lost · reconnecting…');
      try {
        const conn = await connect(6000);
        this.wire(conn);
        if (riding) conn.send({ t: 'rejoin', ticket: this.ticket, name: this.profile.name, outfit: this.profile.outfit, look: this.profile.look });
        else {
          conn.send({ t: 'join', name: this.profile.name, outfit: this.profile.outfit, look: this.profile.look });
          this.banner(null);
          if (this.mode !== 'ride') this.toLobby();
        }
        this.calling = false;
        return;
      } catch {
        await sleep(1500);
      }
    }
    this.calling = false;
    this.banner(null);
    this.lost('Lost the line to the park', 'We could not get back through. Check your connection and ride again from the menu.');
  }

  /** A slim strip at the top of the screen while the line is down (null hides it). */
  banner(text) {
    if (!this.strip) {
      this.strip = document.createElement('div');
      this.strip.className = 'net-banner';
      this.app.appendChild(this.strip);
    }
    this.strip.textContent = text || '';
    this.strip.classList.toggle('show', !!text);
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
