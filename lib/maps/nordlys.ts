import { crossing, ellipse, overDeck, path, pt } from './author';
import type { MapDesign, RiverDesign } from './types';

/*
 * NORDLYS VALLEY  (720 x 620 m, 8 players / 8 enemies)  violet dusk, aurora
 *
 *   x: -360                               0                               +360
 * z-310 +------------------------------------------------------------------+
 *       |  [E7]      [E5]       [E3]      [E1]  [E2]      [E4]   [E6]  [E8] |
 *       |                 ooo           ^^^^^^^^^           ooo            |
 *       |     GOLD       Speil     GOLD ^ GOLD ^ GOLD    Speil      GOLD    |
 *       | ----------------------------- north road ------------------------ |
 *  ~~~~~F~~~~~~~~=~~~~~~~~~=~~~~~~~~~~=NORDLYSBRUA=~~~=~~~~~~~~=~~~~~~~=~~F~~~
 *       |     $   %marsh                                 %marsh      $     |
 *       | ----------------------------- valley road ------------------------ |
 *       |     ^^^ Reinheia ^^^      $          $      ^^^ Østheia ^^^      |
 *       |      ^^^^^^ $ ^^^^^^   ***            ***   ^^^^^^ $ ^^^^^^      |
 *       |        $               $                $               $        |
 *       |    Vestfoten      Vestglenna        Østglenna       Østfoten     |
 *       |  [L7]    [L5]    [L3]    [L1]     [L2]    [L4]    [L6]    [L8]   |
 * z+310 +------------------------------------------------------------------+
 *
 * The big one. Eight landings line the southern valley floor; eight hostile
 * strongholds hold the northern slopes. The Nordlyselva meanders the whole
 * length and is crossed eight times: two flank fords and six bridges, with
 * the Nordlysbrua suspension bridge in the centre. Two heaths in the south
 * give each wing high ground to hold; Nordlystoppen in the north holds the
 * aurora seam, the richest ground on the map, under the enemy's guns.
 * Each pair of landings shares a first expansion about 80-90 m up the
 * valley: Vestfoten and Østfoten at the foot of the heaths, Vestglenna and
 * Østglenna in the glades between the forests. They hold less than any seam
 * at the river, so the gold line stays the prize.
 */

const elva: RiverDesign = {
  path: path(-380, -40, -290, -20, -200, -50, -110, -25, -20, -45, 70, -15, 160, -45, 250, -20, 330, -40, 380, -30),
  width: [22, 24, 24, 26, 26, 26, 24, 24, 22, 22],
  depth: 2.6,
};

const vestvad = crossing(elva, { x: -300 }, { id: 'vestvad', name: 'Vestvadet', style: 'ford', width: 10 });
const reinbrua = crossing(elva, { x: -210 }, { id: 'reinbrua', name: 'Reinbrua', style: 'timber', width: 8 });
const jernbrua = crossing(elva, { x: -115 }, { id: 'jernbrua', name: 'Jernbrua', style: 'steel', width: 11 });
const nordlysbrua = crossing(elva, { x: -20 }, { id: 'nordlysbrua', name: 'Nordlysbrua', style: 'suspension', width: 11 });
const flotbrua = crossing(elva, { x: 70 }, { id: 'flotbrua', name: 'Flotbrua', style: 'pontoon', width: 9 });
const steinvollen = crossing(elva, { x: 160 }, { id: 'steinvollen', name: 'Steinvollen', style: 'causeway', width: 10 });
const kobberbrua = crossing(elva, { x: 255 }, { id: 'kobberbrua', name: 'Kobberbrua', style: 'steel', width: 10 });
const ostvad = crossing(elva, { x: 330 }, { id: 'ostvad', name: 'Østvadet', style: 'ford', width: 10 });

const heath = (sign: 1 | -1) => ({
  name: sign < 0 ? 'Reinheia' : 'Østheia',
  outline: path(
    sign * 270, 60,
    sign * 170, 55,
    sign * 155, 100,
    sign * 180, 150,
    sign * 265, 150,
  ),
  height: 6,
  cliff: 4,
  ramps: [
    { from: pt(sign * 215, 160), to: pt(sign * 215, 138), width: 10 },
    { from: pt(sign * 215, 46), to: pt(sign * 215, 68), width: 10 },
  ],
});

export const nordlys: MapDesign = {
  id: 'nordlys',
  name: 'Nordlys Valley',
  tagline: 'Eight crossings under the northern lights.',
  description:
    'A long valley at dusk with the aurora overhead. Eight crossings over the Nordlyselva, two heaths to hold in the south, and Nordlystoppen in the north with the richest seam in the valley.',
  biome: 'Aurora dusk valley',
  features: [
    'Eight crossings over the Nordlyselva',
    'Reinheia and Østheia heaths',
    'Nordlystoppen with the aurora seam',
  ],
  accent: '#b48cf2',
  bounds: { minX: -360, maxX: 360, minZ: -310, maxZ: 310 },
  capacity: { players: 8, enemies: 8 },
  landings: [
    pt(-45, 235),
    pt(45, 235),
    pt(-135, 235),
    pt(135, 235),
    pt(-225, 235),
    pt(225, 235),
    pt(-315, 235),
    pt(315, 235),
  ],
  strongholds: [
    { x: -45, z: -205, facing: 0, radius: 44, name: 'Lysborg' },
    { x: 45, z: -250, facing: 0, radius: 44, name: 'Stjernevakt' },
    { x: -135, z: -250, facing: 0, radius: 44, name: 'Mørkfjell' },
    { x: 135, z: -205, facing: 0, radius: 44, name: 'Kaldhall' },
    { x: -225, z: -205, facing: 0.1, radius: 44, name: 'Ulvedal' },
    { x: 225, z: -250, facing: -0.1, radius: 44, name: 'Isvarde' },
    { x: -315, z: -250, facing: 0.2, radius: 44, name: 'Vestvarde' },
    { x: 315, z: -205, facing: -0.2, radius: 44, name: 'Østvarde' },
  ],
  ground: { height: 1.4, roll: 1.5, seed: 5519 },
  plateaus: [
    heath(-1),
    heath(1),
    {
      name: 'Nordlystoppen',
      outline: ellipse(0, -130, 60, 38, 14, 0.05),
      height: 8,
      cliff: 4,
      ramps: [
        { from: pt(0, -84), to: pt(0, -106), width: 10 },
        { from: pt(-68, -130), to: pt(-44, -130), width: 10 },
        { from: pt(68, -130), to: pt(44, -130), width: 10 },
      ],
    },
  ],
  rivers: [elva],
  lakes: [
    { outline: ellipse(-180, -122, 30, 20), depth: 2.2 },
    { outline: ellipse(180, -122, 30, 20), depth: 2.2 },
  ],
  seas: [],
  crossings: [vestvad, reinbrua, jernbrua, nordlysbrua, flotbrua, steinvollen, kobberbrua, ostvad],
  marshes: [
    path(-150, 4, -104, 0, -92, 16, -140, 22),
    path(136, -18, 184, -22, 190, -6, 146, -2),
  ],
  forests: [
    { outline: path(-100, 180, -80, 176, -76, 300, -102, 302), density: 1.3, species: 'spruce' },
    { outline: path(80, 176, 100, 180, 102, 302, 76, 300), density: 1.3, species: 'spruce' },
    { outline: path(-10, 262, 10, 262, 12, 304, -12, 304), density: 1, species: 'birch' },
    { outline: path(-350, 90, -300, 80, -290, 150, -350, 160), density: 1.2, species: 'pine' },
    { outline: path(300, 80, 350, 90, 350, 160, 290, 150), density: 1.2, species: 'pine' },
    { outline: path(-120, 90, -80, 84, -76, 130, -116, 136), density: 1, species: 'mixed' },
    { outline: path(80, 84, 120, 90, 116, 136, 76, 130), density: 1, species: 'mixed' },
    { outline: path(-100, -150, -80, -160, -76, -200, -96, -206), density: 1.1, species: 'spruce' },
    { outline: path(80, -160, 100, -150, 96, -206, 76, -200), density: 1.1, species: 'spruce' },
    { outline: path(-356, -120, -300, -126, -296, -80, -356, -100), density: 1.2, species: 'spruce' },
    { outline: path(300, -126, 356, -120, 356, -100, 296, -80), density: 1.2, species: 'spruce' },
  ],
  roads: [
    { path: path(-355, 30, -100, 30, 100, 30, 355, 30), width: 7, surface: 'gravel' },
    { path: path(-355, -80, 355, -80), width: 7, surface: 'gravel' },
    // Each landing road runs on over its crossing to the north road.
    { path: [...path(-310, 200, -300, 30), ...overDeck(vestvad, pt(-300, 30)), pt(-287, -80)], width: 6, surface: 'gravel' },
    { path: [...path(-215, 200, -215, 30), ...overDeck(reinbrua, pt(-215, 30)), pt(-221, -80)], width: 6, surface: 'gravel' },
    { path: [...path(-130, 200, -118, 30), ...overDeck(jernbrua, pt(-118, 30)), pt(-100, -80)], width: 6, surface: 'gravel' },
    { path: [...path(-42, 200, -22, 30), ...overDeck(nordlysbrua, pt(-22, 30)), pt(-28, -80)], width: 7, surface: 'paved' },
    { path: [...path(48, 200, 66, 30), ...overDeck(flotbrua, pt(66, 30)), pt(92, -80)], width: 6, surface: 'gravel' },
    { path: [...path(140, 200, 158, 30), ...overDeck(steinvollen, pt(158, 30)), pt(148, -80)], width: 6, surface: 'gravel' },
    { path: [...path(215, 200, 215, 40, 252, 30), ...overDeck(kobberbrua, pt(252, 30)), pt(240, -80)], width: 6, surface: 'gravel' },
    { path: [...path(310, 200, 328, 30), ...overDeck(ostvad, pt(328, 30)), pt(320, -80)], width: 6, surface: 'gravel' },
  ],
  ore: [
    { x: -262, z: 14, name: 'Vestlia', amount: 48000 },
    { x: -62, z: 62, name: 'Dalmalm', amount: 48000 },
    { x: 60, z: 62, name: 'Lysmalm', amount: 48000 },
    { x: 272, z: 14, name: 'Østlia', amount: 48000 },
    { x: -238, z: 106, name: 'Reinheia Seam', amount: 55000 },
    { x: 238, z: 106, name: 'Østheia Seam', amount: 55000 },
    // First expansions, one per pair of landings, lighter than every seam further north.
    { x: -270, z: 170, name: 'Vestfoten', amount: 45000 },
    { x: -90, z: 156, name: 'Vestglenna', amount: 45000 },
    { x: 90, z: 156, name: 'Østglenna', amount: 45000 },
    { x: 270, z: 170, name: 'Østfoten', amount: 45000 },
    { x: 0, z: -134, name: 'Nordlysgull', amount: 80000, rich: true },
    { x: -262, z: -100, name: 'Ulvegull', amount: 70000, rich: true },
    { x: -100, z: -104, name: 'Mørkgull', amount: 70000, rich: true },
    { x: 100, z: -104, name: 'Kaldgull', amount: 70000, rich: true },
    { x: 262, z: -100, name: 'Isgull', amount: 70000, rich: true },
  ],
  landmarks: [
    { x: 22, z: -114, name: 'Nordlystoppen', description: 'The aurora summit. Its seam is the richest in the valley.' },
    { x: -236, z: 88, name: 'Reinheia', description: 'The western heath, climbed from the valley road and from the landings.' },
    { x: 236, z: 88, name: 'Østheia', description: 'The eastern heath, mirror of Reinheia.' },
    { x: 0, z: 14, name: 'Nordlyselva', description: 'The valley river. Eight crossings, and each one matters.' },
    { x: -180, z: -92, name: 'Speiltjern', description: 'Twin tarns below the northern strongholds.' },
  ],
  billboards: [
    { x: -178, z: 172, angle: 0, size: 'hoarding' },
    { x: 178, z: 172, angle: 0, size: 'hoarding' },
    { x: -270, z: 214, angle: 0.1, size: 'hoarding' },
    { x: 270, z: 214, angle: -0.1, size: 'hoarding' },
    { x: 6, z: -2, angle: 0, size: 'banner' },
    { x: -142, z: 42, angle: 0, size: 'banner' },
    { x: 30, z: -142, angle: 0, size: 'tower' },
  ],
  props: [
    { x: -26, z: -142, kind: 'radio_mast', angle: 0, solid: true },
    { x: 0, z: 130, kind: 'statue', angle: 0 },
    { x: -166, z: 12, kind: 'wreck_plane', angle: 0.7 },
    { x: -34, z: 14, kind: 'wreck_tank', angle: 2.5 },
    { x: -10, z: 18, kind: 'wreck_tank', angle: -0.3 },
    { x: 60, z: -60, kind: 'wreck_tank', angle: 3 },
    { x: -284, z: 12, kind: 'watch_hut', angle: 0 },
    { x: 344, z: 2, kind: 'watch_hut', angle: -0.4 },
    { x: -250, z: 130, kind: 'windmill', angle: 0.4, solid: true },
    { x: 250, z: 130, kind: 'ruin', angle: -0.4 },
    { x: -180, z: -122, kind: 'boat', angle: 0.8 },
    { x: 0, z: 150, kind: 'fuel_tanks', angle: 0, solid: true },
    { x: -106, z: 152, kind: 'watch_hut', angle: 0.3 },
    { x: 106, z: 152, kind: 'watch_hut', angle: -0.3 },
    { x: -288, z: 180, kind: 'wreck_tank', angle: 0.9 },
    { x: 288, z: 180, kind: 'wreck_tank', angle: -0.9 },
  ],
  techSites: [
    // Tech sites: mirrored derricks on the heaths above the river; the hospital
    // on the valley floor and the airstrip below the northern crown.
    { kind: 'derrick', name: 'Reinheia Derrick', x: -150, z: 8 },
    { kind: 'derrick', name: 'Østheia Derrick', x: 150, z: 8 },
    { kind: 'fieldHospital', name: 'Valley Field Hospital', x: 0, z: 45 },
    { kind: 'airstrip', name: 'Nordlys Airstrip', x: 0, z: -76 },
  ],
  palette: {
    snow: '#e6e0f0',
    grass: '#6c786f',
    earth: '#665d69',
    gravel: '#8a8595',
    rock: '#6d6878',
    cliff: '#4c4758',
    sand: '#b3a9b8',
    marsh: '#4e5550',
    road: '#7c7584',
    shallow: '#5d6f9a',
    deep: '#1d2340',
    foam: '#e9e4f5',
  },
  atmosphere: {
    sun: '#ff9e7a',
    // High enough that shadows stay short: the night is dark, the battlefield is readable.
    sunDirection: [0.74, 0.5, -0.2],
    sunIntensity: 2,
    sky: '#3b3566',
    horizon: '#c77d8e',
    bounce: '#4a4466',
    fog: '#5d5877',
    fogDensity: 0.0022,
    snowCover: 0.8,
    weather: 'aurora',
    grade: 'dusk',
    exposure: 1.12,
  },
  shots: [
    { from: [-350, 10, 0], to: [-150, 10, -10], lookAt: [0, 4, -30], seconds: 18 },
    { from: [-90, 40, -60], to: [90, 40, -60], lookAt: [0, 8, -130], seconds: 16 },
    { from: [0, 80, 300], to: [0, 60, 220], lookAt: [0, 20, -200], seconds: 14 },
    { from: [-300, 20, 170], to: [-240, 18, 124], lookAt: [-215, 6, 100], seconds: 12 },
    { from: [120, 14, 20], to: [30, 12, 20], lookAt: [-20, 2, -45], seconds: 12 },
  ],
};
