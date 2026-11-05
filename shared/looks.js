// Looks a rider earns by levelling up (cosmetic only: nothing here changes how anyone fights). The server checks a
// rider's choices against this list, so a made-up look is just the default one.

/** Swing-trail colours (linear RGB, 0..1). */
export const TRAILS = [
  { id: 'spark', name: 'Spark', level: 1, rgb: [1, 0.9, 0.78] },
  { id: 'blood', name: 'Blood', level: 2, rgb: [1, 0.16, 0.1] },
  { id: 'ecto', name: 'Ectoplasm', level: 4, rgb: [0.3, 1, 0.72] },
  { id: 'seance', name: 'Séance', level: 8, rgb: [0.68, 0.32, 1] },
  { id: 'frost', name: 'Grave frost', level: 13, rgb: [0.45, 0.78, 1] },
  { id: 'gilded', name: 'Gilded', level: 20, rgb: [1, 0.72, 0.18] },
];

/** Name-tag styles: text colour and an optional glow. */
export const TAGS = [
  { id: 'plain', name: 'Plain', level: 1, color: '#ffffff' },
  { id: 'neon', name: 'Neon sign', level: 3, color: '#ff6a7c', glow: '#ff2040' },
  { id: 'brass', name: 'Brass plate', level: 6, color: '#f2c86a', glow: '#8a5a10' },
  { id: 'spirit', name: 'Spirit glow', level: 11, color: '#a6f7e0', glow: '#20e0b0' },
  { id: 'marquee', name: 'Marquee', level: 17, color: '#fff2c0', glow: '#ffb020' },
];

/** Clothing dyes (sRGB colour the clothes are dyed toward; skin is left alone). */
export const DYES = [
  { id: 'own', name: 'As found', level: 1, rgb: null },
  { id: 'midnight', name: 'Midnight', level: 5, rgb: [0.18, 0.22, 0.42] },
  { id: 'crimson', name: 'Crimson', level: 7, rgb: [0.62, 0.08, 0.1] },
  { id: 'moss', name: 'Graveyard moss', level: 10, rgb: [0.24, 0.36, 0.18] },
  { id: 'bone', name: 'Bone white', level: 15, rgb: [0.86, 0.82, 0.72] },
  { id: 'ringmaster', name: 'Ringmaster red', level: 22, rgb: [0.85, 0.12, 0.16] },
];

export const LOOK_KINDS = { trail: TRAILS, tag: TAGS, dye: DYES };

/** A look the server can trust: known ids only, anything else is the default. */
export function cleanLook(look) {
  const out = {};
  for (const [kind, list] of Object.entries(LOOK_KINDS)) {
    const id = look && typeof look[kind] === 'string' ? look[kind] : null;
    out[kind] = list.some((x) => x.id === id) ? id : list[0].id;
  }
  return out;
}

/** The entry for a look id (the default if unknown). */
export function lookItem(kind, id) {
  const list = LOOK_KINDS[kind];
  return list.find((x) => x.id === id) || list[0];
}

/** A random look for a bot (about a third of them wear something), so players see what there is to earn. */
export function botLook(rand) {
  const pick = (list) => (rand() < 0.35 ? list[1 + Math.floor(rand() * (list.length - 1))].id : list[0].id);
  return { trail: pick(TRAILS), tag: TAGS[0].id, dye: pick(DYES) };
}
