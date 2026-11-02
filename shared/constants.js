// Tunables shared by the simulation, bots and the client.
export const SIM_HZ = 60;
export const MAX_PLAYERS = 20;

export const MAP_HALF = 120;

export const PLAYER_RADIUS = 0.42;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.58;
export const STEP_HEIGHT = 0.55;
/** Speeds match the animations' own pace so feet don't slide. */
export const RUN_SPEED = 5.2;
export const SPRINT_SPEED = 7.2;
export const AIM_SPEED = 3.4;
/** Strafing in a fighting stance. */
export const COMBAT_SPEED = 3.6;
/** Bots ignore anyone who landed less than this long ago, so everyone gets time to loot. */
export const LANDING_GRACE = 10;
export const GRAVITY = 24;
export const JUMP_SPEED = 8.2;

export const MAX_HP = 100;
export const MAX_SHIELD = 100;
export const MAX_REVIVES = 2;
export const REVIVE_HP = 100;
/** After stealing a body, ghost powers cannot hurt you for this long. */
export const REVIVE_PROTECT = 12;
/** A fresh ghost needs a moment before it can use powers. */
export const GHOST_RISE = 8;

export const GHOST_SPEED = 11;
export const GHOST_FAST = 19;
export const GHOST_MAX_Y = 60;
export const ECTO_MAX = 100;
export const ECTO_REGEN = 3;
export const ECTO_START = 40;
/** Seconds a ghost glows brighter after using a power. */
export const GHOST_FLASH = 1.6;

/** Length of the intro: the bus drives up the road and reaches the park gate when it ends. */
export const LAUNCH_SECONDS = 30;
/** Bus speed inside the park (m/s). */
export const BUS_SPEED = 9;
export const FINAL_RIDE_SECONDS = 20;
export const FINAL_RIDE_RESET = 15;
export const END_SCREEN_SECONDS = 30;

export const GLIDE_FALL = 5.5;
export const GLIDE_SPEED = 9.5;

export const OUTFITS = [
  { id: 'eric', model: 'eric', name: 'Eric', blurb: 'Came for his daughter’s birthday. Lost her by the carousel.' },
  { id: 'claudia', model: 'claudia', voice: 'f', name: 'Claudia', blurb: 'Ran the park office. Knows why it closed.' },
  { id: 'nathan', model: 'nathan', name: 'Nathan', blurb: 'Missed the last bus out of town.' },
  { id: 'carla', model: 'carla', voice: 'f', name: 'Carla', blurb: 'Came to expose the park. Story of a lifetime.' },
  { id: 'sophia', model: 'sophia', voice: 'f', name: 'Sophia', blurb: 'Lost a bet. Spent the night in the park.' },
  { id: 'manuel', model: 'manuel', name: 'Manuel', blurb: 'Night-shift DJ at the bumper cars. The music never stopped.' },
  { id: 'agnes', model: 'oldlady', voice: 'f', name: 'Agnes', blurb: 'Rode this tour in 1987 and came home alone. She bought a second ticket.' },
  { id: 'walter', model: 'spice', name: 'Walter', blurb: 'Ran the shooting gallery until the night it closed. Came back for his last pay.' },
  { id: 'balthazar', model: 'balthazar', name: 'Balthazar', blurb: 'Worked the door at the Funhouse in 1987. Still guarding it.' },
  { id: 'victor', model: 'businessman', name: 'Victor', blurb: 'Bought the land at auction this morning. Wanted to see it at night.' },
  { id: 'dale', model: 'bgpeople_0', name: 'Dale', blurb: 'The old groundskeeper’s son. Followed the lights through the trees.' },
  { id: 'marcus', model: 'bgpeople_1', name: 'Marcus', blurb: 'Hosts a ghost-hunting podcast. Twelve listeners. Tonight he goes live.' },
  { id: 'denise', model: 'bgpeople_2', voice: 'f', name: 'Denise', blurb: 'Won the tickets on a radio phone-in. She never called in.' },
  { id: 'ruth', model: 'bgpeople_3', voice: 'f', name: 'Ruth', blurb: 'Her brother never came home from the park. She brought his photo.' },
];

export const BOT_NAMES = [
  'Cotton Candy', 'Mr. Giggles', 'Tilt-a-Whirl', 'Ringmaster', 'Funnel Cake', 'Pretzel Pete',
  'Skee Ball', 'Captain Crank', 'Popcorn Polly', 'Toffee', 'Big Wheel', 'Loop-de-Loop',
  'Calliope', 'Midway Max', 'Lucky Duck', 'Corn Dog', 'Bumper Bob', 'Haunted Hal',
  'Taffy', 'Sideshow Sam', 'Madame Fortuna', 'Whack-a-Mole', 'Jester', 'Teacup Tina',
];
