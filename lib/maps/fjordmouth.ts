import { crossing, ellipse, overDeck, path, pt } from './author';
import type { MapDesign, RiverDesign } from './types';

/*
 * FJORDMOUTH  (320 x 280 m, 2 players / 2 enemies)  golden-hour snow coast
 *
 *   x: -160                        0                         +160
 * z-140 +-----------------------------------------------------------+
 *       | ~tarn~    [ W STRONGHOLD ]           [ E STRONGHOLD ]  ### |
 *       | ~~~~  ###    Skarvhall                 Ravnborg       ### |
 *       |      ####        |      ___Kvitåsen___       |   $$ rich  |
 *       | $ Speil          |     /  $$ rich    \      |   Ravnedal |
 *       |~~~~~~~~~\        |    |   (plateau)   |     |            |
 *  FJORD ~~~~~~~~~~>=causeway=========BRIDGE==============FORD====> river
 *       |~~~~~~~~~/,,reeds,,, wrecks  |    wrecks          | Kaldelva
 *       |  ___Vardehaugen___ ,,,,,     |        ___Vakthaugen___  |
 *       | |  (hill) $ Tangen|  $ Bruvollen   $ Brubakken  $ (hill) | |
 *       |  \_______________/           |        \______________/  |
 *       | ####  Granlia                |                          |
 *       |      [LANDING 1]------road------[LANDING 2]              |
 *       |~~~~~~~~~~~~~~~~~~~~~~~ south sea ~~~~~~~~~~~~~~~~~~~~~~~~|
 * z+140 +-----------------------------------------------------------+
 *
 * The Kaldelva runs east to west into the fjord and splits the map. Three
 * crossings: the Ternvik causeway by the mouth (west flank), the steel Kaldelva
 * bridge (main lane, straight into the ramp of Kvitåsen) and Reindeer Ford
 * (slow east flank under the guns of Vakthaugen). The richest seams sit on the
 * enemy side: Kvitåsen's crown and the Ravnedal gully.
 *
 * The two landings mirror each other: a seam by the bridge road (Bruvollen,
 * Brubakken), a watch hill with its own seam on the outer flank (Vardehaugen
 * over the causeway, Vakthaugen over the ford) and a slow flank crossing. The
 * causeway lands in the Ternvik reed flats, so wading the reeds costs the west
 * flank about what the shallow ford costs the east one.
 */

const kaldelva: RiverDesign = {
  path: path(175, -18, 120, -14, 80, -4, 40, 2, 0, -2, -40, -8, -70, -10, -100, -8),
  width: [14, 16, 18, 20, 20, 22, 26, 30],
  depth: 2.2,
};

const ternvik = crossing(kaldelva, { x: -52 }, { id: 'ternvik', name: 'Ternvik Causeway', style: 'causeway', width: 10 });
const kaldelvaBridge = crossing(kaldelva, { x: 5 }, { id: 'kaldelva', name: 'Kaldelva Bridge', style: 'steel', width: 11 });
const reindeer = crossing(kaldelva, { x: 100 }, { id: 'reindeer', name: 'Reindeer Ford', style: 'ford', width: 9 });

export const fjordmouth: MapDesign = {
  id: 'fjordmouth',
  name: 'Fjordmouth',
  tagline: 'Three crossings over the Kaldelva, one hill worth dying for.',
  description:
    'Land on the snow coast and force the Kaldelva. Take the steel bridge for the direct road, or flank by the Ternvik causeway and Reindeer Ford before the enemy digs in on Kvitåsen.',
  biome: 'Golden-hour snow coast',
  features: [
    'Three crossings: causeway, steel bridge, ford',
    'Kvitåsen plateau with a rich crown seam',
    'Twin watch hills: Vakthaugen over the ford, Vardehaugen over the causeway',
  ],
  accent: '#f2b86b',
  bounds: { minX: -160, maxX: 160, minZ: -140, maxZ: 140 },
  capacity: { players: 2, enemies: 2 },
  landings: [pt(-62, 88), pt(62, 88)],
  strongholds: [
    { x: -66, z: -96, facing: 0, radius: 42, name: 'Skarvhall' },
    { x: 70, z: -96, facing: 0, radius: 42, name: 'Ravnborg' },
  ],
  ground: { height: 1.2, roll: 1.1, seed: 1101 },
  plateaus: [
    {
      name: 'Kvitåsen',
      outline: path(-24, -80, 30, -82, 40, -62, 32, -44, -12, -42, -28, -58),
      height: 5,
      cliff: 4,
      ramps: [
        { from: pt(4, -38), to: pt(4, -53), width: 10 },
        { from: pt(34, -86), to: pt(26, -72), width: 9 },
      ],
    },
    {
      // Beacon hill on the fjord point: the western twin of Vakthaugen.
      // Pulled back from x -110/z 30 so its ramp shoulder clears that
      // fixed test waypoint (tests/tactics.test.ts).
      name: 'Vardehaugen',
      outline: path(-94, 34, -128, 30, -142, 46, -128, 66, -98, 62),
      height: 4,
      cliff: 3.5,
      ramps: [
        { from: pt(-98, 20), to: pt(-98, 42), width: 9 },
        { from: pt(-87, 50), to: pt(-101, 48), width: 9 },
      ],
    },
    {
      name: 'Vakthaugen',
      outline: path(84, 30, 124, 28, 136, 48, 122, 66, 92, 62),
      height: 4,
      cliff: 3.5,
      ramps: [
        { from: pt(106, 25), to: pt(106, 38), width: 9 },
        { from: pt(80, 50), to: pt(93, 48), width: 9 },
      ],
    },
  ],
  rivers: [kaldelva],
  lakes: [{ outline: ellipse(-128, -82, 17, 12), depth: 2 }],
  seas: [
    {
      // The fjord opens from the west edge into the river mouth.
      outline: path(-175, -40, -122, -38, -100, -24, -92, -8, -100, 12, -124, 22, -175, 26),
      depth: 4,
    },
    {
      outline: path(-175, 132, -100, 130, -30, 135, 20, 131, 90, 130, 175, 134, 175, 160, -175, 160),
      depth: 3,
    },
  ],
  crossings: [
    ternvik,
    kaldelvaBridge,
    reindeer,
  ],
  marshes: [path(-88, 34, -86, 20, -74, 12, -64, 8, -40, 8, -30, 18, -34, 34, -50, 40, -70, 40)],
  forests: [
    { outline: path(-156, 72, -124, 70, -118, 84, -120, 110, -156, 112), density: 1.4, species: 'spruce' },
    { outline: path(112, -120, 156, -124, 156, -60, 132, -66, 118, -90), density: 1.3, species: 'spruce' },
    { outline: path(-156, -132, -104, -134, -102, -110, -150, -104), density: 1.1, species: 'pine' },
    { outline: path(46, -40, 66, -44, 70, -24, 50, -20), density: 0.9, species: 'birch' },
    { outline: path(-28, 36, -12, 32, -6, 50, -22, 56), density: 0.8, species: 'birch' },
    { outline: path(140, 70, 156, 66, 156, 110, 136, 104), density: 1.2, species: 'mixed' },
  ],
  roads: [
    // A turning yard at the head of the main road, short of the old ±12 span so it
    // doesn't clip the firm yard between the landings.
    { path: path(0, 90, -9, 92, 0, 97, 9, 92, 0, 90), width: 7, surface: 'gravel' },
    { path: [...path(0, 90, 2, 40), ...overDeck(kaldelvaBridge, pt(2, 40)), ...path(5, -30, -24, -34, -44, -62)], width: 7, surface: 'paved' },
    { path: path(5, -30, 42, -36, 50, -62), width: 7, surface: 'paved' },
    { path: [...overDeck(ternvik, pt(-52, 20)), ...path(-60, -40, -66, -60)], width: 6, surface: 'gravel' },
    { path: [...path(84, 62, 78, 40, 96, 12), ...overDeck(reindeer, pt(96, 12)), ...path(96, -40, 86, -64)], width: 6, surface: 'gravel' },
  ],
  ore: [
    { x: -114, z: 44, name: 'Tangen Seam', amount: 48000 },
    { x: -38, z: 46, name: 'Bruvollen Seam', amount: 45000 },
    { x: 34, z: 44, name: 'Brubakken Seam', amount: 45000 },
    { x: 112, z: 48, name: 'Vakthaug Seam', amount: 48000 },
    { x: -112, z: -46, name: 'Speil Seam', amount: 52000 },
    { x: 4, z: -64, name: 'Kvitåsen Gold', amount: 70000, rich: true },
    { x: 124, z: -42, name: 'Ravnedal Gold', amount: 62000, rich: true },
  ],
  landmarks: [
    { x: 6, z: -66, name: 'Kvitåsen', description: 'The white ridge above the bridge. Whoever holds its crown sees both crossings.' },
    { x: 110, z: 52, name: 'Vakthaugen', description: 'A watch hill over Reindeer Ford, reached by two ramps.' },
    { x: -60, z: 26, name: 'Ternvik', description: 'Reed flats where the Kaldelva meets the fjord. The causeway lands in them.' },
    { x: -120, z: 52, name: 'Vardehaugen', description: 'A beacon hill on the fjord point, above the Ternvik reeds.' },
    { x: 60, z: 16, name: 'Kaldelva', description: 'A cold, fast river. Only the bridge, the causeway and the ford cross it.' },
    { x: -128, z: -60, name: 'Speilvatnet', description: 'A mirror tarn below the western stronghold.' },
  ],
  billboards: [
    { x: -106, z: 82, angle: 0.3, size: 'hoarding' },
    { x: 106, z: 82, angle: -0.3, size: 'hoarding' },
    { x: 28, z: 14, angle: 0, size: 'banner' },
    { x: -34, z: 14, angle: 0.1, size: 'banner' },
    { x: 132, z: 14, angle: -0.2, size: 'hoarding' },
    { x: 26, z: -58, angle: 0, size: 'tower' },
    { x: 0, z: 112, angle: 0, size: 'tower' },
  ],
  props: [
    { x: -98, z: -28, kind: 'lighthouse', angle: 0.6, solid: true },
    { x: -146, z: 35, kind: 'fishing_hut', angle: 0.4 },
    { x: -136, z: 6, kind: 'boat', angle: 1.2 },
    { x: 13, z: 34, kind: 'wreck_tank', angle: -0.4 },
    { x: -16, z: -22.5, kind: 'wreck_tank', angle: 0.3 },
    { x: 2, z: -108, kind: 'wreck_plane', angle: 1.9, scale: 0.8 },
    { x: 144, z: 34, kind: 'radio_mast', angle: 0, solid: true },
    { x: 116, z: 16, kind: 'watch_hut', angle: -0.5 },
    { x: -16, z: -66, kind: 'ruin', angle: 0.2, scale: 0.7 },
    { x: -146, z: -22, kind: 'boat', angle: 0.5 },
  ],
  techSites: [
    // Tech sites: mirrored derricks either side of the bridge road, and the
    // field hospital under Kvitåsen's ramp on the far bank.
    { kind: 'derrick', name: 'Bruvoll Derrick', x: -16, z: 24 },
    { kind: 'derrick', name: 'Brubakk Derrick', x: 16, z: 24 },
    { kind: 'fieldHospital', name: 'Kvitåsen Field Hospital', x: 0, z: -26 },
  ],
  palette: {
    snow: '#f7ecd9',
    grass: '#9c9260',
    earth: '#85654a',
    gravel: '#b09e84',
    rock: '#958a80',
    cliff: '#73685f',
    sand: '#e6c998',
    marsh: '#7a7045',
    road: '#a88f70',
    shallow: '#3fa3a3',
    deep: '#124f63',
    foam: '#fbf1e2',
  },
  atmosphere: {
    sun: '#ffc47e',
    sunDirection: [-0.6, 0.33, 0.74],
    sunIntensity: 3,
    sky: '#8fb6da',
    horizon: '#fbc58a',
    bounce: '#7a6a66',
    fog: '#f0cfa2',
    fogDensity: 0.003,
    snowCover: 0.7,
    weather: 'clear',
    grade: 'golden',
    exposure: 1.02,
  },
  shots: [
    { from: [-150, 6, -6], to: [-40, 5, 4], lookAt: [20, 1, -2], seconds: 14 },
    { from: [-60, 30, -20], to: [70, 30, -26], lookAt: [5, 6, -62], seconds: 16 },
    { from: [0, 48, 138], to: [0, 34, 104], lookAt: [0, 0, 0], seconds: 12 },
    { from: [146, 9, 34], to: [92, 7, 28], lookAt: [100, 0, -9], seconds: 12 },
  ],
};
