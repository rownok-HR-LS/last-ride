// The scenery models scripts/convert-env.mjs builds (and scripts/bake-atlases.mjs bakes).
/**
 * name -> [source file, triangle budget, texture size, keep separate nodes (for rides with moving parts),
 * simplifier error allowed (default 0.02; dense scans need more to reach their budget)]
 */
export const ENV = {
  fern_02: ['polyhaven/fern_02', 1200, 512],
  shrub_02: ['polyhaven/shrub_02', 1500, 512],
  shrub_03: ['polyhaven/shrub_03', 1500, 512],
  shrub_04: ['polyhaven/shrub_04', 1500, 512],
  dry_branches_medium_01: ['polyhaven/dry_branches_medium_01', 1200, 512],
  tree_stump_01: ['polyhaven/tree_stump_01', 2500, 512],
  tree_stump_02: ['polyhaven/tree_stump_02', 2500, 512],
  rock_moss_set_01: ['polyhaven/rock_moss_set_01', 5000, 1024],
  rock_moss_set_02: ['polyhaven/rock_moss_set_02', 5000, 1024],
  dead_tree_trunk: ['polyhaven/dead_tree_trunk', 3000, 1024],
  dead_tree_trunk_02: ['polyhaven/dead_tree_trunk_02', 4000, 1024],
  root_cluster_01: ['polyhaven/root_cluster_01', 4000, 512],
  // Sketchfab (CC-BY): rides, booths and clutter
  carousel_rides: ['sketchfab-env/sf_670b5427693348d7994f7cacc42abdd8.glb', 45000, 1024],
  rocket_ride: ['sketchfab-env/sf_c49d9161ec834ce3adf92e5380a037ec.glb', 6000, 1024],
  kiosk: ['sketchfab-env/sf_882bfc1b677f48eb82d6dc9f7516c299.glb', 2000, 1024],
  ferris: ['sketchfab-env/sf_8e2be4f8958246aea77c868b42bdde6b.glb', 70000, 1024, true],
  carousel: ['sketchfab-env/sf_ac5a9ac7bb074ea0a94201ee7c97141b.glb', 45000, 1024],
  coaster_car: ['sketchfab-env/sf_e557ecfcacb74d148ca25422d7685331.glb', 8000, 1024],
  tent_small: ['sketchfab-env/sf_5fc4e54d982f4d47bf7590e184c675ec.glb', 12000, 1024],
  bigtop: ['sketchfab-env/sf_8908c5144b9349c4a98c89895bd3c26a.glb', 40000, 2048],
  boxes: ['sketchfab-env/sf_72a4804f8a4d4de18e59abb60b81c54f.glb', 3500, 1024],
  dumpsters: ['sketchfab-env/sf_3836ff67877248c2a820e6a969984aac.glb', 6000, 1024],
  crates_barrels: ['sketchfab-env/sf_5ae3c72285474862a89d69c2f2ad2246.glb', 8000, 1024],
  old_fence: ['sketchfab-env/sf_3a98eabc0aa9475db5fcf7fab235751b.glb', 1000, 1024],
  street_fences: ['sketchfab-env/sf_0953ef9c6e9b4a099daf53f91d29cf09.glb', 1500, 1024],
  trash_bags: ['sketchfab-env/sf_cd134204748b4e28a9e3494638cc595f.glb', 4000, 1024],
  bench: ['sketchfab-env/sf_01a5b64427984632bb44242da3813bb1.glb', 3000, 1024],
  shack_caretaker: ['sketchfab-env/sf_ca47bd3814be4da4b9689d0fd14ae184.glb', 2500, 2048],
  gun_targets: ['sketchfab-env/sf_eb9fbe283faa41ef8685359a0769d303.glb', 2500, 1024],
  rocket_kiddie: ['sketchfab-env/sf_1e2cc6a66e354a868b10c52d11fc15fd.glb', 8000, 1024],
  ice_freezer: ['sketchfab-env/sf_ef3e64b3f227470495fc836f1ff451e8.glb', 1000, 1024],
  vending_news: ['sketchfab-env/sf_29cca5a8e99e438c8fb644d1aea3587e.glb', 1000, 1024],
  shack_open: ['sketchfab-env/sf_4698d6d9b2c444dca5cc78637e0dfd90.glb', 2000, 2048],
  vending_drinks: ['sketchfab-env/sf_d0b81fdb4e514859bfcc95165144e8c7.glb', 1500, 1024],
  vending_coffee: ['sketchfab-env/sf_eb605bea59574e43a6abc4109798d36d.glb', 4000, 1024],
  tires_shed: ['sketchfab-env/sf_2a28b29867b24980b19aa6b97defc3b2.glb', 20000, 2048],
  vending_gum: ['sketchfab-env/sf_deb39ed682764137935248808465c61e.glb', 1600, 1024],
  shed_worn: ['sketchfab-env/sf_be6edd62e55a4f9a99da940fc164a5b9.glb', 2100, 1024],
  ticket_booth: ['sketchfab-env/sf_8ff9678d9c534855bd9ce70ed3591931.glb', 6000, 1024],
  // realism pass 2 (CC-BY): real rides, scanned ruins and street furniture
  carousel_real: ['sketchfab-env/sf_ab3bd8f68e3b4ab787961e77eafec4b2.glb', 70000, 1024, true],
  dodgem: ['sketchfab-env/sf_5e2c5bfed4f643f6bb1a65cbfcda2b60.glb', 6000, 1024, false, 0.2],
  light_poles: ['sketchfab-env/sf_7166d53851a54d2fb2bdbf2695694e10.glb', 4000, 1024, true],
  welcome_sign: ['sketchfab-env/sf_fef3e02d052a489db9c3a9548ac4aa4e.glb', 40000, 1024, false, 0.08],
  graffiti_shop: ['sketchfab-env/sf_40bbfd989b864ea8809ab5a6156cb200.glb', 14000, 2048, false, 0.05],
  clown_statue: ['sketchfab-env/sf_af4c9e73aa9b4e42a4842653a36d2b02.glb', 5000, 1024],
  popcorn_cart: ['sketchfab-env/sf_30e6c59907754093bf4d48a94fea0888.glb', 8000, 1024, true],
  chainlink: ['sketchfab-env/sf_35adb2f2461c4d30bc94e803bb50de50.glb', 1500, 1024],
  victorian: ['sketchfab-env/sf_07d00daba8ea42608cc0c1f440507705.glb', 25000, 1024, false, 0.15],
  storefront: ['sketchfab-env/sf_0fc0da9dddd040c38864635bc21e82c1.glb', 24000, 2048, false, 0.1],
  warehouse: ['sketchfab-env/sf_0dafa7aaadfd4666bb4a32776c84b14e.glb', 15000, 1024, false, 0.08],
  clown_face: ['sketchfab-env/sf_d9b1f6085753403f91ff2a7bab0c0ab3.glb', 30000, 1024, false, 0.05],
  gargoyle: ['sketchfab-env/sf_73479897896947e19a0d21b61534ac4d.glb', 6000, 1024],
  roof_kit: ['sketchfab-env/sf_6dfa32e7ec614362a29fd950b87212ca.glb', 4000, 1024],
  // story props modelled in Blender from code (scripts/blender/story-props.py, our own)
  memorial: ['blender/memorial.glb', 6000, 1024],
  missing_board: ['blender/missing_board.glb', 1000, 1024],
  barricade: ['blender/barricade.glb', 600, 512],
  plush: ['blender/plush.glb', 4500, 256, true],
  police_tape: ['blender/police_tape.glb', 400, 512],
  evidence: ['blender/evidence.glb', 1200, 512],
  pram: ['blender/pram.glb', 2500, 256],
  tour_board: ['blender/tour_board.glb', 200, 1024],
};

/**
 * Far versions for the distance switch (src/models.js FAR_MODELS): name -> share of the full version's triangle
 * budget. Made with Blender's Decimate by scripts/bake-atlases.mjs, then built like any model as <name>_far.
 */
export const FAR = {
  popcorn_cart: 0.2, tent_small: 0.2, crates_barrels: 0.25, trash_bags: 0.25, boxes: 0.3, bench: 0.3,
  rocket_kiddie: 0.2, clown_statue: 0.2, shed_worn: 0.35, vending_news: 0.3, ice_freezer: 0.3,
  dodgem: 0.6,
};
for (const [n, k] of Object.entries(FAR)) ENV[`${n}_far`] = [ENV[n][0], Math.round(ENV[n][1] * k), 256, false, 0.08];
