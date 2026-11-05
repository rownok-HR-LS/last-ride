// Line icons for the HUD (24 px grid, drawn with the current text colour), in place of emoji.
const P = {
  alive: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21v-1.5A5.5 5.5 0 0 1 10.5 14h3a5.5 5.5 0 0 1 5.5 5.5V21"/>',
  ghost: '<path d="M5 21V11a7 7 0 0 1 14 0v10l-2.4-1.8L14.3 21 12 19.2 9.7 21l-2.3-1.8z"/><circle cx="9.5" cy="11" r="1"/><circle cx="14.5" cy="11" r="1"/>',
  skull: '<path d="M12 3a7.5 7.5 0 0 0-7.5 7.5c0 2.6 1.2 4.4 3 5.5V20h9v-4c1.8-1.1 3-2.9 3-5.5A7.5 7.5 0 0 0 12 3z"/><circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/><path d="M10.5 20v-2.5M13.5 20v-2.5"/>',
  storm: '<path d="M20 8a8 4 0 1 0-6 3.9M4 12a8 4 0 0 0 12 3.4M7 18a6 3 0 0 0 10 0"/>',
  ticket: '<path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h18v-2a2 2 0 0 1 0-4 2 2 0 0 0 0-4V6H3z" transform="translate(0 -1)"/><path d="M14 5v2M14 10v2M14 15v2"/>',
  bandage: '<rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-35 12 12)"/><path d="M10.5 11.5h.01M13.5 12.5h.01M12 10h.01M12 14h.01"/>',
  medkit: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M12 10.5v6M9 13.5h6"/>',
  soda: '<path d="M8 4h8l-1 3H9zM8.5 7h7l-.8 13H9.3z"/><path d="M9 12h6"/>',
  holy: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M12 10.5v6M9.5 13h5"/>',
  flare: '<path d="M8 21l7-11"/><path d="M15 10l2-3M17 4l1-2M20 7l2-1M14 5l-1-2M19.5 10.5l2 .5"/>',
  salt: '<path d="M8 9h8l1 12H7zM9 9l.8-4h4.4L15 9"/><path d="M11 6.5h.01M13 6.5h.01"/>',
  relic: '<path d="M12 2v20M7 7h10"/><circle cx="12" cy="7" r="9" opacity=".25"/>',
  trap: '<path d="M3 13a9 9 0 0 0 18 0"/><path d="M3 13l2.5-3 2 3 2.5-3 2 3 2-3 2.5 3 2-3L21 13"/><path d="M12 22v-3"/>',
  cursed: '<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M12 9v12M3 13h18M12 9C10 4 6 5 7.5 8 8.5 9 12 9 12 9zm0 0c2-5 6-4 4.5-1C15.5 9 12 9 12 9z"/>',
  steps: '<path d="M7 17c-2 0-3-2-3-5s1-6 3-6 2 3 2 5-1 6-2 6zM17 21c-1 0-2-4-2-6s0-5 2-5 3 3 3 6-1 5-3 5z"/>',
  blackout: '<path d="M9 18h6M10 21h4M8.5 14.5A6 6 0 1 1 15.5 14.5c-.8.7-1.5 1.7-1.5 3.5h-4c0-1.8-.7-2.8-1.5-3.5z"/><path d="M3 3l18 18"/>',
  scare: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.3"/><circle cx="15" cy="10" r="1.3"/><ellipse cx="12" cy="16" rx="2" ry="2.6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/>',
  chest: '<path d="M3 10a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10H3z"/><path d="M3 12h18M11 12v3h2v-3"/>',
  weapon: '<path d="M14 4l6 6-2 2-6-6zM12 6L4 20M15 3c3 0 6 3 6 6"/>',
  ferris: '<circle cx="12" cy="10" r="7"/><circle cx="12" cy="10" r="1.5"/><path d="M12 3v14M5 10h14M7 5l10 10M17 5L7 15M8 21l4-9 4 9"/>',
  coaster: '<path d="M2 18c3 0 3-10 6-10s3 8 6 8 3-12 8-12"/><path d="M2 21h20"/>',
  car: '<path d="M4 16v-4l2-4h12l2 4v4zM3 16h18v2H3z"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
};

/** An inline SVG icon by name (falls back to the name itself as text). */
export function icon(name, cls = '') {
  const p = P[name];
  if (!p) return name;
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
