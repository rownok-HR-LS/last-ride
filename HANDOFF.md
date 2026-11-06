# LAST RIDE: handoff for a new chat

Paste everything below into the new chat.

---

I'm continuing work on my browser game **Last Ride**. Here is the full context.

## What it is
- An online third-person battle royale (one public online ride, or offline practice vs 19 bots) set in an abandoned, haunted 1987 theme park at night.
- 20 riders arrive on a tour bus. Survivors fight with melee weapons (no guns), rare ranged weapons, and occult tools.
- The dead come back as ghosts. Ghosts use powers and possess rides (Ferris wheel, coaster, bumper cars). A ghost that lands a killing blow steals that body (twice at most).
- Last survivor on the final bus wins.
- The goal is to feel **realistic**: Dying Light-style melee, real human movement, and a scanned, realistic world.

## Where and how to run
- Project: `C:\Users\Rownok\last-ride` (Vite + Three.js r186, plain JS, Node ≥20). Public repo https://github.com/rownok-HR-LS/last-ride (commit with the noreply identity set in the repo).
- Live (2026-11-03): game https://rownok-hr-ls.github.io/last-ride/ (gh-pages branch; update it with `node scripts/deploy-pages.mjs wss://last-ride-server.onrender.com`), server https://last-ride-server.onrender.com (Render workspace "hosting", free plan, Blueprint last-ride-server). The Blueprint uses the public repo URL, not a GitHub connection, so pushing to main does NOT redeploy the server: press Manual sync on the Blueprint in Render. The free server sleeps when idle; the first visitor waits about a minute.
- Dev server: `npm --prefix C:/Users/Rownok/last-ride run dev`, then open http://localhost:5200. The preview entry is named `last-ride` in the gallery's `.claude/launch.json`.
- Balance report over many matches: `node scripts/balance.mjs [matches] [firstSeed]` (about 2 s per match). One match log: `node scripts/sim.mjs <seed>` (a match runs about 3.5–6.5 min).
- Game server: preview entry `last-ride-server` (node --watch server/index.js --bus=6, port 8090; `--bus=N` or BUS_WAIT shortens the wait at the stop). `npm start` runs it for real. The client finds it at `?server=…`, VITE_SERVER_URL (baked in by scripts/deploy-pages.mjs), or ws://<this host>:8090.
- Tests without a browser: `node scripts/roomtest.mjs` (bus stop rules), `node scripts/nettest.mjs` (two riders against a running server), `node scripts/perf.mjs` (server cost per tick).
- Debug handle in the browser: `window.__lr` (the Client). Use `c.paused=true` and `c.frame(1/60)` to step frames.

## Rules I want followed
- Ask before creating a repo or deploying. Commit with my GitHub noreply email.
- Games stay separate from my component-gallery repo and its posts.
- Never create accounts or type passwords for me. Ask me to sign in myself.
- Preview changes in the browser before saying they're done. Ask before anything that's hard to reverse.
- All CC-BY assets must be credited in `src/credits.js`.

## Architecture
**`shared/`** is the authoritative 60 Hz sim, written so it can later run on a Node server:
- `game.js`: Game class; the phases are launch, live and end.
- `bots.js`: survivor and ghost AI.
- `map.js`: layout, colliders, PROPS, DECOR, BUILDINGS, BUS_ROUTE, LAMP_HEAD, LANDMARKS_OUT.
- `physics.js`: stepWalker, steerHuman, slides.
- `items.js`: weapons, STAMINA, HEAVY, COMBO, IMPACT, DODGE, SLIDE, AMMO, ITEMS, PRIZES.
- Also `collide.js`, `nav.js`, `constants.js`.

**`src/`** is the client:
- `client.js`: frame loop, input, camera, events, audio hooks, adaptQuality.
- `characters.js`: Mixamo retargeting, blend tree, upper-body `_up` clips, CUTS timing table, seat/drive overrides.
- `world.js`: ground shader with puddles, lamps, Builder (merged static meshes), materials, props, sky.
- `buildings.js`: dressing for the Funhouse, Tunnel of Terror and Arcade, plus their interiors.
- `rides.js`: Ferris wheel scan, carousel scan, dodgems, coaster car, hazards.
- `trees.js`: EZ-Tree forests with LOD.
- `scatter.js`: Poly Haven plants and rocks, grass.
- `models.js`: loadModel, placeModels (`'model#Node'` picks one part of a model), mergeStatic.
- `cull.js`: per-instance frustum and distance culling.
- `post.js`: N8AO ambient occlusion, bloom, grade shader with depth of field and the `cine` film look.
- `intro.js`: 30 s cinematic with 6 film shots.
- `bus.js`: LAZ 695 bus, headlight beams, dust, cabin light, 24 seats plus the driver seat.
- `audio.js`: recorded samples (public/sfx) with synth fallback; music and ghost effects are synthesized.
- `rain.js`: GPU rain streaks and ground splashes in a box that wraps around the camera; drops are lit by the nearest lamps, the bus headlights and lightning, and are cut out under roofs (buildings, big top, bumper pavilion, coaster station, bus). `sheltered()` is the same test in JS.
- Also `hud.js`, `fx.js` (blood decals and pools), `loot.js`, `projectiles.js`, `weapons.js`, `guide.js`, `credits.js`.

**Asset scripts:**
- `scripts/convert-env.mjs`: ENV table `[src, triBudget, texSize, keepNodes, simplifyError]`; outputs to `public/models/env/*.glb`.
- `scripts/convert-sfx.mjs`: SFX table; cuts `assets-src/sfx-src` into `public/sfx` (MP3 + sfx.json).
- `scripts/convert-models.mjs anims`: merges `assets-src/mixamo/anims/*.fbx` into `public/models/anims.glb`.

## Design decisions (done)
**Weapons**
- No guns. Players start with fists. Melee weapons break; ranged weapons use ammo.
- Melee: mallet, spike, lever, sledge, crowbar, machete, axe, chainsaw.
- Ranged: darts, bow, crossbow, harpoon, fireworks.
- Occult: holy water, flare, salt, relic.
- Tickets buy items at prize counters.

**Combat**
- Instant light swings with a 3-hit combo; hold to charge a heavy.
- RMB blocks; V or Alt dodges; aim assist with lunge; knockback and stagger; hit-stop.

**Movement**
- Human momentum, with the body turning to face its velocity. Combat stance strafes. Shift sprints.
- **C/Ctrl slides** (crouch was removed): from at least 4 m/s, about 6 m, low hitbox, Mixamo "Running Slide" clip.

**Intro**
- The bus drives through the woods; captions only (the TTS voice was removed). Ambient sound bed.
- 20 riders sit in the bus with Mixamo `sit`/`sit2` clips; a driver uses `drive`.
- During the inside shot, the sky light is dimmed and the bus's warm cabin light takes over.

**World realism**
- Sketchfab scans: Pripyat Ferris wheel, carousel, dodgem, Pripyat concrete lamp poles, welcome sign, clown statues, popcorn carts, Victorian house and warehouse past the fence, a giant clown face on the Funhouse, gargoyles on the Tunnel, rooftop vents.
- Wet ground with puddles, blood decals, ambient occlusion, floodlit building fronts.
- Coaster station and bumper pavilion rebuilt. Interiors have a checker floor, mirrors, a dark-ride track and a stalled car.

**Performance**
- Culling, tree LOD and merged meshes. N8AO transparency mode is off, moon shadows update every other frame, and adaptQuality reverts drops that don't help.
- Result: full resolution at about 9–12 ms per frame.

## Asset download methods that work
**Sketchfab** (account scorpiozs, in Chrome extension browser deviceId `971f6613…`)
1. XHR GET `/i/models/{uid}/download` with credentials.
2. Take the smallest `latest.glb` variant and XHR its url, which returns JSON `{url}` (S3).
3. Collect those S3 links into one blob JSON file and download it. Chrome allows one automatic download per tab, so use a new tab per bundle.
4. In Node, fetch the S3 links into `assets-src/sketchfab-env/sf_<uid>.glb`.
5. Run `node scripts/convert-env.mjs <name>`.

**Mixamo** (signed in on extension browser `84d6833d…`; CID `e93ae322-5f54-404c-beb2-86cc1e5b1a79`)
1. POST `/api/v1/animations/export`.
2. Poll `/characters/{CID}/monitor`.
3. Anchor-click `job_result`; the file lands in `~/Downloads`. Use one download per new tab.
4. Move it into `assets-src/mixamo/anims/`.
5. Run `node scripts/convert-models.mjs anims`.

Chrome blocks these sites from posting to localhost, so downloads always go through `~/Downloads`.

## Where I left off
**Analysis results** (in priority order):
1. Sharpness/performance: **done**.
2. Real recorded sounds: **done**.
3. Rain, to match the wet ground: **done**.
4. Character variety and grime (only 6 outfits).
5. Asset size (about 91 MB; compress textures).
6. Gameplay balance:
   - The first kill always lands at about 60 s.
   - Winners get 0–2 kills.
   - The crowbar dominates.
   - Ranged weapons are weak.
   - Bots block about 5% of swings and rarely dodge.

**Sounds (done 2026-10-31)**
- Sources are in `assets-src/sfx-src/` (commons/, kenney/, oga/). `node scripts/convert-sfx.mjs [name]` cuts them with ffmpeg-static into `public/sfx/<name>_<i>.mp3` + `sfx.json` (about 1.2 MB, 31 sounds, 112 takes). The SFX table there sets the clip ranges, peak level and loops.
- `audio.js` loads the bank in `initAudio`; `sample()` picks a random take (never twice in a row) with random pitch and level, routed through `out(pos)`. Every sound falls back to its synth version if the samples aren't loaded. `wind` and `bus` loops use recordings (crossfaded, MP3 padding skipped).
- Recorded: footsteps, swings, impacts (blade/blunt/flesh), blocks, breaks, chainsaw, darts/crossbow/harpoon layers, glass, landing, cloth, pain grunts (also positional for others; female outfits pitch the male takes up, `voice: 'f'` in OUTFITS), death, scream, coins, latches, chest creak, owl, crows, thunder, firework reports, bus door, UI click/error.
- Still synth: music box, ghost powers (possess, fling, blackout, relic, steal), rides (coaster, gondola), UI chimes (hit, kill, win, final).
- Levels were matched by measuring each sample against its synth stand-in (`useSamples(false)` is a debug A/B switch). Gotcha: after a Vite edit the game imports `audio.js?t=…`; a plain `import('/src/audio.js')` from the console gets an uninitialised copy.
- Not used yet (for the rain step): `commons/rain_window.ogg`, `commons/thunder_rain2.ogg`.

**Rain (done 2026-10-31)**
- Client only: `rain.js`, plus `groundRain` in world.js (ripple rings in puddles, ground glossier while it rains). Amount drifts 0.55–0.95 over a few minutes.
- Lightning (`updateWeather` in client.js): a strike every 12–34 s, three flickers that brighten the moon, sky light and sky; thunder follows after distance / 343 m/s (`thunderNear` under 1.3 km).
- Sound: `rain` loop outdoors, `rainIn` (rain on glass) under a roof or inside the bus; the random ambient thunder cue was removed (lightning does it now).
- Cost: no measurable frame time (about 9.5 ms with or without it).
- Also fixed: riders on the bus looked see-through. The characters' unlit blue rim light now fades out within 5–20 m of the camera and is off in the inside-bus shot (`setCharacterRim`).
- Fixed 2026-11-02: the 'cine' lens fringe split fine texture into pink/green specks. It now comes from a softened image and only toward the frame edges (post.js `soft()`).
- Fixed 2026-11-02: the bus model loaded after the intro began (riders floated over the road). main.js now waits on `preloadBus()` before starting the match.

**Combat and bots (done 2026-11-02)**
- New rules: parry (guard raised within 0.2 s of the hit takes nothing and staggers the attacker; the guard must have been down 0.4 s first), poise on sledge, axe, lever and chainsaw (a swing under way rides through light hits), heavies 1.4x slower to land, aim assist 45° and 1 m lunge. Tuning lives in items.js PARRY, HEAVY, ASSIST.
- Bots (bots.js PERSONAS): brawler, duelist and opportunist. They loot first (50/80/90 s), give way on contested loot and keep their distance while settling, avoid fights when poorly armed, hurt or just after a kill, read heavy charges (dodge, parry or step back), block light swings, keep just outside the enemy's reach, punish openings, and retreat to heal.
- LANDING_GRACE is 10 s; the storm's first two phases wait longer (100 s and 55 s).
- 40-match results, before → after: first kill 31 → 34 s, alive at 60 s 7.7 → 16.9, at 2 min 3.3 → 10.1, match 244 → 317 s, melee hit rate 92 → 80%, blocks 6.5 → 22%, about 8 parries and 9 dodges per match. Melee damage per minute held is now 43–78 across weapons (was 12–197 kills spread; the crowbar no longer dominates).
- Ghost and pacing pass (same day): ghosts spread out over survivors instead of piling on (bots.js chooseVictim), traps 15 dmg / 1.3 s root / max 2 / cost 35, cursed loot 35, Ferris gondola 45, fake footsteps 8 s cooldown. Survivors size each other up (`outclassed`), non-brawlers let a fleeing rider go for 15 s, retreat thresholds 25/50/55, chase ranges 22/15/22 m. Sledge 30, axe 27, mallet quicker.
- Measured: ghosts were not the main cause of short matches; survivors killing survivors was. 40 matches now: first kill 43 s, alive at 60 s 18, at 2 min 11.4, match 330 s (about 5.5 min; the 7 min target isn't reached). Melee damage per minute held is 42–69 (crowbar, spike and mallet at the low end).
- `node scripts/pacing.mjs [matches]` prints survivors every 30 s and who kills whom each minute.

**Characters (done 2026-11-02)**
- 14 riders (6 female voices): the 6 Renderpeople scans plus Jungle Jim's Agnes (oldlady), Walter (spice), Balthazar, Victor (businessman) and Dale, Marcus, Denise, Ruth (bgpeople_0..3, split from one "Background People" file). All CC-BY and credited.
- Per-rider look shader (characters.js lookShader): rain soaking, blood that builds with hits (client bodyFx, tracked even off-screen), mud and grime, clothing tint that leaves skin alone (detected in gamma space; hue turn capped), per-rider height and build. Seeded by player id, so corpses and stolen bodies keep the look. Masks use a baked bind-pose body coordinate (bodyP). Riders are sized by head height (head joint ≈ 86% of height), not the bounding box.
- convert-sketchfab.mjs: uprightSkins() puts any rig into one upright, metre-scale space in its true bind pose (derives the file's mesh-to-world fix from a torso joint, snaps it to an axis rotation and uniform scale, centres the body over the hips). SPLIT writes one file per person (bgpeople), TURN faces a backwards model forward (spice), SIMPLIFY sets per-model reduction, DROP_MESH drops parts (Agnes's hair wisps).
- Downloads: Sketchfab is signed in on Chrome "Browser 1" (971f6613). /i/models/<uid>/download gives latest.glb[] with a Sketchfab URL; fetching that URL returns {url} (S3). Save the S3 links as one JSON via a blob download (one download per tab), then fetch them in Node into assets-src/sketchfab.
- Heavy files for the compression pillar: spice 16 MB (beard and sideburn hair cards), oldlady 10 MB (hair). Rejected and removed from public/models: russian, woman, hitman, sweater, jaxon (sources stay in assets-src).

**Loading and presentation (done 2026-11-02)**
- Download 123 MB -> 70 MB: textures as WebP (scripts/webp-textures.mjs, run after fetch-textures), the sky split into sky_bg.jpg + a 512 HDR for lighting (scripts/sky.mjs; source HDR in assets-src/hdri; SKY_SCALE in world.js), riders Meshopt-compressed with every attribute but POSITION quantised (positions stay float so parts can still merge), hair-only simplification (HAIR in convert-sketchfab.mjs), 512 px detail maps on multi-part riders, 1024 px textures on distant scenery. Biggest left: scenery 33 MB (the Victorian house is 4.9 MB of geometry).
- Style kit in style.css ("1987 park signage"): .sign (rusted plate, rivets, procedural grime), .bulbs (marquee with dead and failing bulbs), .ticket (torn admit-one buttons), gauges and choices. Fonts: Rye, Special Elite.
- settings.js (localStorage 'last-ride-settings'): quality auto/high/medium/low, volumes (master, music, effects, ambience: audio.js has an ambience bus), sensitivity, invert Y, key bindings (Input.act/actHit by action id; number keys stay fixed).
- menu.js: settingsBoard (used on the title and in pause) and PauseMenu. Esc or losing the mouse lock mid-match pauses the offline match.
- Death camera (client deathCam + hud.deathCard): 4.2 s from behind your body toward the killer, depth of field, HUD hidden, ghost vision fades in after.
- End screen: winner orbit for 2.5 s, then the results sign with your ticket stub (place, kills, ghost kills, bodies stolen, damage, survived; game tracks aliveTime) and the top 10.
- Title: Client attract mode (opts.attract) renders the park in the rain with the chosen rider under a lamp; the sign picks name, rider and difficulty; Board the bus calls client.start(profile) in the already-built world.

**Score and sound (done 2026-11-03)**
- 17 more recordings (CC0 / public domain / CC-BY, all in credits.js): water steps, mud squelches, splashes, women's grunts and screams, heavy breathing, panting, heartbeat, a cabinet slam (trap), rusty metal groans (rides), power-down, electric charge and crackle, whooshes, a ghost moan, two horror ambiences for the score. 50 sounds, 2.2 MB.
- 3D sound: every positioned sound goes through an HRTF PannerNode facing the camera's look direction; setOcclusion() muffles sounds with a wall in between (lowpass 650 Hz, -5 dB; checked behind the Funhouse); setRoom() raises the echo under a roof.
- Adaptive score (audio.setScore, set every frame in client.updateAudio): tension (nearest rival within 30 m, or being a ghost), combat (your swing or hit in the last 4 s), danger (low health or someone on top of you), finale (last-ride countdown or the last storm circles). Layers: drone bed, pulsing dread, heartbeat that speeds up, drums on the waltz beat in a fight, a formant choir for the finale; the music box gets quieter and more detuned as danger rises. Measured mix: calm -30, tension -28, combat -29, danger -25, finale -28 dB.
- Wet footsteps (water slaps on cobbles, squelch on dirt; dry under a roof), splashes on slides and landings, effort grunts on heavy swings, women use their own pain and death recordings, breathing loop when out of stamina or below 30 health, coaster rail clacks, crackling hum on a possessed bumper car, phantom footsteps made of real steps.

**Online and touch (built and deployed 2026-11-03)**
- One public ride (server/room.js): riders wait at the bus stop; the bus leaves on a timer (30 s the first time, 20 s after a ride) with everyone waiting aboard and bots in the empty seats. Arrivals during a ride watch it as a free-flying ghost (browser-only, the server doesn't know about them; no powers) and board the next bus. Results stay up 12 s online, then everyone who pressed Ride again (and all watchers) is back in line. A rider who disconnects is taken over by a bot (Game.toBot). The ride stops when no human is left.
- Server: Node + ws, 60 Hz tick, snapshots 20 Hz per viewer (game.snapshot plus the rider's full own state, loot as deltas, events stamped with server time). shared/net.js packs messages (mm rounding, false flags dropped; about 2 KB per update after per-message deflate). Health JSON on /. render.yaml is ready (free web service, like LOFICAGE). A match costs about 0.17 ms per tick.
- Inputs are numbered; Game.feed steps an online rider exactly once per input (two per tick when catching up, a credit that grows by one per tick stops speed hacks, 20 ticks without input lets go of everything). That makes the browser's prediction match the server: corrections measured under 1 mm.
- Browser (src/net.js NetGame): stands in for Game. Your rider is predicted with a private Game copy (dodge, slide, slot, reload and use are predicted too; your swings, dodges and shots sound at once and the server's copies are skipped). On each update it takes the server's state and replays unacknowledged inputs; small differences ease out. Others are drawn 0.1 s behind, interpolated (positions and angles only). Events are released when their moment comes (yours at once). src/online.js runs the bus stop sign and boarding. Pause online shows the menu without stopping the ride. Kill slow-motion is off online.
- Touch (src/touch.js, on when the main pointer is coarse): a floating stick on the left (full push sprints), drag on the right to look, a thumb fan (attack, block, jump, dodge, slide, pick up, reload, swap; ghost: cast, up, down, fast, haunt; bus: jump off; prizes near a booth). Weapon slots and items in the HUD are tappable, the minimap opens the map, the ☰ button is the menu. The first touch goes full screen and locks landscape where allowed; portrait asks to turn the phone sideways. The HUD stacks bottom-left on touch.
- Not done: chat and emotes. No lag compensation for melee (you hit where the server sees them).

**Launch polish, round 1 (2026-11-04, committed locally, not deployed)**
- Playtest findings that drove it: HUD clutter and emoji, stiff arms, flat lighting, weak hit feedback, camera hiding the enemy, bus camera in the gate sign, rain in the bus, 66 MB download, ~10 ms frames on an RTX 5060 (6.4 M triangles incl. the shadow pass).
- HUD (style.css "2026 HUD" block, src/icons.js line icons): no boxes, Barlow / Barlow Condensed type, health bottom-left, weapon in hand bottom-right with rarity line, only carried items shown, plain counters, objective as one line whose explanation fades after 7 s, controls card hidden behind H, slim lock pill, round ghost power buttons. Touch layout re-stacked for it.
- Look: src/shafts.js. softShaft() for loot beams and new lamp light cones (fade along, at edges and when the camera is inside). nightAir() patches three's fog chunks: ground mist that thins with height, fog brighter toward the moon. SMAA anti-aliasing after the output pass (the composer had none). Finer grain.
- Characters: relaxArms() brings upper arms in to a 9° hang when no swing/block owns them (the Mixamo clips splayed them 13-38° on the scans). Hit flash (lookHit uniform) on whoever takes a hit. Name tags smaller, condensed caps, fade by distance (22 m alive, 35 m ghost view).
- Combat feel: camera punch (FOV and kick) on hits given and taken, fight framing (pulls out 0.9 m and over the shoulder while locked on), BLOCKED / GUARD BROKEN / PARRY / PARRIED words, bigger damage numbers that pop.
- First minutes: bus camera closer and lower with a wall ray; rain removed above the bus while the camera is inside; landing banner shows only the place name; title subtitle and Practice button fixed.
- Loading: riders, fonts, bus and textures download in parallel. Still to do for speed: simplify the big scanned scenery (Victorian house 4.4 MB, welcome sign 2.8 MB; SOLID-BLACK/WHITE/RED meshes are the top shadow casters), shrink the hair-heavy riders (spice 5.7 MB, oldlady 3.4 MB).
- Test gotcha: screenshots of the hidden pane are often stale; draw frames (c.frame) right before each screenshot. Many Vite hot reloads in one tab can leave WebGL "texture format and sampler type" errors; a full reload clears them.

**Launch polish, round 2 (2026-11-05, committed locally, not deployed)**
- Speed: convert-env.mjs got a sloppy() pass (meshopt simplifySloppy, seams ignored) for props the careful simplifier can't bring to budget. Bumper car 85k -> 33k, clown face 115k -> 30k, welcome sign 103k -> 8k triangles; Agnes, Walter, Victor reduced in convert-sketchfab SIMPLIFY. Busy view 6.4M -> 2.3M triangles (with shadows), ~22 -> ~10 ms/frame on an RTX 5060. `node scripts/tri-report.mjs` lists triangles per model.
- Animations: 13 new Mixamo clips (exported on the user's account, character "Vanguard", saved in assets-src/mixamo/new and copied into anims/). breath_idle is the unarmed idle. Sledge, axe and lever (TWO_HANDED in characters.js) use the great-sword set: gs_idle guard, gs_combo split into cuts gs_c1/gs_c2 (CLIP_OF), gs_down as the finisher, gs_power heavy, gs_block, gs_block_hit; impacts were measured at the right hand's speed peak. Every hit plays a short upper-body reaction (react_left/right/gut, head_hit_big, gs_hit for two-handers); staggers play them full-body.
- Mixamo download method that works now: in the signed-in tab, POST /api/v1/animations/export with preferences { format: 'fbx7_2019', skin: 'false', fps: '30', reducekf: '0' } and gms_hash including overdrive: 0; poll /characters/{CID}/monitor until its job_uuid matches; the S3 link expires within minutes, so download at once: put it in localStorage, open a fresh tab on www.mixamo.com/robots.txt, anchor-click it with a download attribute (one download per tab). The extension hides signed URLs from the transcript, and the S3 bucket blocks page fetches (CORS).
- Round 3 (same day): NeutralToneMapping at 1.15 exposure and grade contrast 1.1 (ACES at 1.4 looked washed out); shafts fade by camera distance to their centre line (camera inside a lamp cone showed a bright band); your own ghost at 0.35 opacity with thin mist; renderMapImage redrawn as a dark tactical plan (drained ground, 25 m grid, outlines, Barlow Condensed labels; the font is loaded in main.js before the HUD draws it).
- Round 4: loading screen (public/title_still.webp, a 1280 px still of the title camera without the rider, set from main.js with a page-relative URL; .t-load bar and TIPS in main.js; .title2.ready fades it into the live park). welcome_sign budget back up to 40k (at 8k the sloppy pass warped its lettering). To regrab the still: run scratchpad shotsrv.cjs (port 5299) and POST canvas.toBlob from the page.
- Round 12: wind (src/wind.js sway(): grass, plants and tree crowns sway by height in gusts; windTime set beside groundRain.time). GPU self-heal (client.checkGpu): a rare state where most lit draws fail with WebGL "Mismatch between texture format and sampler type" and riders vanish. Root cause not found (toggling scene.environment or the moon's castShadow, i.e. rebuilding lit programs, clears it; drawing the scene outside the composer is fine). Repro that worked: start practice, skip the intro, run the sim to the open bus without frames, jump, 100 more sim ticks, teleport, then real-time frames. The client checks gl.getError() every 120 frames and toggles the moon shadow off for one frame (max 3 per match).
- Root cause of the failing lit draws (found in round 14): the renderer asked for PCFSoftShadowMap, which three r186 swaps for PCF only inside the first shadow pass. Programs compiled before that (loading, warm-up, frames without a shadow pass since the shadow map renders every other frame) declared directionalShadowMap as sampler2D, while the shadow depth texture uses compare mode -> every such draw failed. Fixed by setting PCFShadowMap in the constructor; the repro now gives 0 failing draws. checkGpu stays as a safety net.
- Rounds 13-18 (2026-11-05/06): camera motion blur with a setting (post.js, Camera section in settings: FOV, shake, motion blur); the whole park gets wet in the rain (src/wet.js wetten(): glossier and darker, tops more than sides; sceneWet set beside groundRain); melee contact flash (fx.strike: a canvas hit-star sprite, sparks and blood thrown along the blow; client.strikeFx on hit and block); wet footfalls (fx.footSplash: spray plus pooled ripple rings on stone, mud on dirt, from the footstep hook in client); head look (Character.headLook turns neck and head in world space toward opts.lookAt; client.lookTarget: yours follows the camera, others watch the nearest living rider in front within 9 m); landings (Character tracks fall speed into `landed`; the jump_down clip from CUTS.jump_down 0.33 when standing, a body dip when running; client plays the land sound, splash or dust, and dips the camera by landDip). Unused leftovers: audio cases cannon/chute/whoosh and the hidden chute mesh (from the old launch design).
- Reliability and speed (2026-11-06, committed locally): the title knocks on the ride server (HTTP) as it loads and Ride online keeps retrying for 100 s behind "Waking the park"; riders get a private ticket per ride (room.tickets) and a dropped line calls back for 30 s and takes the rider back from the bot ('rejoin', Game.toHuman, NetGame.rebind); an emptied ride waits 35 s (graceUntil) and a lone watcher no longer keeps a bots-only ride alive. Trees are baked (src/tools/bake-trees.js in the dev console, then scripts/pack-trees.mjs) into public/models/trees.glb, so ez-tree is a dev dependency and the client script is 0.73 MB (was 4.8). Only your rider and the driver load before the menu (whenRider / whenAllRiders). The bus glass had transmission, which made three.js draw the whole scene twice every frame: replaced with plain transparent glass (draw calls 1183 -> 619 from the plaza). Loot pools hide when empty and upload only used matrices; placed props are culled by size; Client.warmUp() pre-uploads textures and compiles under the title. Before the menu: 15.5 MB (was 28.8). Still heavy: Walter, Balthazar, Agnes and Victor are 9-31 draw calls each (separate textures per part; an offline texture atlas per rider would make them one), and park textures (5.9 MB WebP) could go KTX2. Server code changed: a deploy needs Render "Manual sync" as well as deploy-pages.
- Rider atlases (2026-11-06): scripts/atlas-riders.mjs folds each heavy rider's solid parts into one 2048 colour atlas (normal maps dropped; positions unquantised so all parts keep one skin and the game's mergeSkinned can join them). Draw calls: Walter 31 -> 14, Balthazar 20 -> 3, Agnes 16 -> 5, Victor 9 -> 2; files 13.3 -> 9.0 MB. Hair and beard stay separate (--clear also folds them, but merged see-through layers blend in another order: Walter's grey beard turned black). Walter's remaining 13 hair/beard materials are the next target (e.g. fold the cards that share a texture, or alpha-hashed hair). scripts/inspect-riders.mjs lists a rider's parts.
- Big round after the audit (2026-11-06/07, committed locally): graphics-reset recovery and refresh-proof rides (ticket in sessionStorage), controller support (src/gamepad.js) with prompts that name buttons (src/prompts.js), one clean death moment, no emoji, progression (src/progress.js in localStorage: XP, 30 levels, dailies, bests; shared/looks.js trails / name tags / dyes sent on join and checked by the server; results panel), a modern main menu (main.js .title2.modern, Looks locker, How to play), ghost powers unlocking by time as a ghost (POWERS[...].unlock, p.ghostTime), quick chat (CHAT_LINES, 'say' command, T / R3 / touch, bubbles), bus-stop names and ?ride invite links, every .sign restyled to the modern glass look, HUD size and sound captions (audio.onCue). Damage dealt no longer counts overkill. Server and shared changed: going live needs Render "Manual sync" plus deploy-pages.
