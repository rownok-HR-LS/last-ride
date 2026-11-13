// A fade to and from black between screens (the title, the bus stop, a ride, the results), instead of hard cuts.
let el = null;

function overlay() {
  if (!el) {
    el = document.createElement('div');
    el.className = 'screen-fade';
    document.body.appendChild(el);
  }
  return el;
}

/** Fade the screen to the given darkness (0 clear, 1 black) over ms; resolves when it gets there. */
export function fadeTo(dark, ms) {
  const o = overlay();
  o.style.transitionDuration = `${ms}ms`;
  // (read once, so the browser starts from where it is now)
  o.getBoundingClientRect();
  o.style.opacity = String(dark);
  return new Promise((r) => setTimeout(r, ms));
}

/** To black. */
export const fadeOut = (ms = 280) => fadeTo(1, ms);
/** Back from black. */
export const fadeIn = (ms = 650) => fadeTo(0, ms);

/** To black, then reload the page (back to the title). */
export function fadeReload(ms = 320) {
  fadeOut(ms).then(() => location.reload());
}
