import { crossing, overDeck, path, pt } from './author';
import type { MapDesign, RiverDesign } from './types';

/*
 * SKERRY HARBOUR  (420 x 380 m, 4 players / 4 enemies)  warm overcast harbour
 *
 *   x: -210                          0                           +210
 * z-190 +-------------------------------------------------------------+
 *       |     [E3]          [E1]            [E2]           [E4]        |
 *       |            GOLD                              GOLD            |
 *       |           /                                      \           |
 *  ~~~~~~~~~~~~~=Nordvollen=~~~~~~~~~ Nordsundet ~~~~~~~~=Tollbrua=~~~~~~~
 *       | W island   ~|        centre island      |~   E island        |
 * light>|  $ mill    ~=susp=--- Kirkeholmen GOLD --=timber=  $  toll   |
 *       |            ~|            ruin           |~                   |
 *  ~~~~~~~=Bryggebrua=~~~~~~~~~~~=Kirkebrua=~~~~~~~~~~~~~~=Flytebrua=~~~~~
 *       |  boathouses        quay  crane   tanks          boathouses   |
 *       |   $          $          $            $                       |
 *       |     [L3]          [L1]            [L2]           [L4]        |
 * z+190 +-------------------------------------------------------------+
 *
 * A harbour town on the southern shore faces a belt of skerries across the
 * Sørsundet. Three bridges reach the islands; two channels split the belt, so
 * Kirkeholmen in the middle is a hub, crossed only by bridges, holding the
 * rich church seam. From the outer islands, Nordvollen causeway and Tollbrua
 * reach the enemy shore. The lighthouse stands on Fyrodden, the west tip.
 */

const sorsundet: RiverDesign = {
  path: path(-225, 62, -140, 56, -60, 66, 20, 58, 100, 64, 180, 54, 225, 60),
  width: 30,
  depth: 3.2,
};
const nordsundet: RiverDesign = {
  path: path(-225, -66, -150, -72, -70, -62, 10, -70, 90, -60, 160, -72, 225, -64),
  width: 30,
  depth: 3.2,
};
const vestlopet: RiverDesign = {
  path: path(-74, 70, -66, 20, -72, -20, -68, -66),
  width: 18,
  depth: 2,
};
const ostlopet: RiverDesign = {
  path: path(72, 70, 66, 20, 74, -20, 70, -66),
  width: 18,
  depth: 2,
};

const bryggebrua = crossing(sorsundet, { x: -140 }, { id: 'bryggebrua', name: 'Bryggebrua', style: 'timber', width: 8 });
const kirkebrua = crossing(sorsundet, { x: 0 }, { id: 'kirkebrua', name: 'Kirkebrua', style: 'steel', width: 11 });
const flytebrua = crossing(sorsundet, { x: 140 }, { id: 'flytebrua', name: 'Flytebrua', style: 'pontoon', width: 9 });
const nordvollen = crossing(nordsundet, { x: -120 }, { id: 'nordvollen', name: 'Nordvollen', style: 'causeway', width: 10 });
const tollbrua = crossing(nordsundet, { x: 120 }, { id: 'tollbrua', name: 'Tollbrua', style: 'steel', width: 10 });
const vestlopetSpan = crossing(vestlopet, { z: 0 }, { id: 'vestlopet', name: 'Vestløpet Span', style: 'suspension', width: 9 });
const ostlopetBridge = crossing(ostlopet, { z: 0 }, { id: 'ostlopet', name: 'Østløpet Bridge', style: 'timber', width: 8 });

export const skerryharbour: MapDesign = {
  id: 'skerryharbour',
  name: 'Skerry Harbour',
  tagline: 'Seven bridges, three islands, one harbour to hold.',
  description:
    'Land in the harbour town and push across the sound. Kirkeholmen in the middle is the richest ground, but only its bridges lead there. The outer skerries carry the roads north.',
  biome: 'Overcast harbour skerries',
  features: [
    'Seven bridges between the islands',
    'Kirkeholmen hub with a rich church seam',
    'Fyrodden lighthouse and red boathouses',
  ],
  accent: '#e07a5f',
  bounds: { minX: -210, maxX: 210, minZ: -190, maxZ: 190 },
  capacity: { players: 4, enemies: 4 },
  landings: [pt(-50, 140), pt(50, 140), pt(-150, 140), pt(150, 140)],
  strongholds: [
    { x: -50, z: -146, facing: 0, radius: 44, name: 'Tollstad' },
    { x: 50, z: -146, facing: 0, radius: 44, name: 'Nordhavn' },
    { x: -150, z: -146, facing: 0.2, radius: 44, name: 'Skjærvik' },
    { x: 150, z: -146, facing: -0.2, radius: 44, name: 'Varden' },
  ],
  ground: { height: 1.3, roll: 1, seed: 4409 },
  plateaus: [],
  rivers: [sorsundet, nordsundet, vestlopet, ostlopet],
  lakes: [],
  seas: [],
  crossings: [
    bryggebrua,
    kirkebrua,
    flytebrua,
    vestlopetSpan,
    ostlopetBridge,
    nordvollen,
    tollbrua,
  ],
  marshes: [path(-196, 24, -176, 20, -170, 36, -190, 40)],
  forests: [
    { outline: path(-190, -40, -166, -44, -160, -22, -186, -18), density: 0.9, species: 'birch' },
    { outline: path(166, 20, 190, 16, 196, 36, 170, 40), density: 0.9, species: 'birch' },
    { outline: path(-40, 22, -20, 18, -14, 34, -36, 38), density: 0.7, species: 'birch' },
    { outline: path(-204, 104, -188, 100, -186, 180, -204, 184), density: 1.2, species: 'spruce' },
    { outline: path(188, 100, 204, 104, 204, 184, 186, 180), density: 1.2, species: 'spruce' },
    { outline: path(-112, -104, -90, -108, -86, -186, -110, -186), density: 1.2, species: 'spruce' },
    { outline: path(90, -108, 112, -104, 110, -186, 86, -186), density: 1.2, species: 'spruce' },
  ],
  roads: [
    { path: path(-26, 112, 0, 92), width: 6, surface: 'paved' },
    { path: path(26, 112, 0, 92), width: 6, surface: 'paved' },
    { path: [pt(-146, 104), ...overDeck(bryggebrua, pt(-146, 104)), pt(-140, 30)], width: 6, surface: 'paved' },
    { path: [pt(146, 104), ...overDeck(flytebrua, pt(146, 104)), pt(140, 30)], width: 6, surface: 'paved' },
    { path: [...path(-140, 30, -140, 0), ...overDeck(vestlopetSpan, pt(-140, 0)), ...path(0, 0), ...overDeck(ostlopetBridge, pt(0, 0)), ...path(140, 0, 140, 30)], width: 7, surface: 'gravel' },
    { path: [pt(0, 92), ...overDeck(kirkebrua, pt(0, 92)), pt(0, 0)], width: 7, surface: 'paved' },
    { path: [pt(-140, 0), ...overDeck(nordvollen, pt(-140, 0)), pt(-136, -122)], width: 6, surface: 'gravel' },
    { path: [pt(140, 0), ...overDeck(tollbrua, pt(140, 0)), pt(136, -122)], width: 6, surface: 'gravel' },
  ],
  ore: [
    { x: 0, z: -14, name: 'Kirkegull', amount: 75000, rich: true },
    { x: -150, z: -16, name: 'Fyrodden Seam', amount: 52000 },
    { x: 150, z: -16, name: 'Tollbod Seam', amount: 52000 },
    { x: 0, z: 116, name: 'Kaimalm', amount: 45000 },
    { x: -100, z: 104, name: 'Naustmalm', amount: 45000 },
    { x: 100, z: 104, name: 'Bryggemalm', amount: 45000 },
    { x: -100, z: -100, name: 'Skjærgull', amount: 62000, rich: true },
    { x: 100, z: -100, name: 'Vardegull', amount: 62000, rich: true },
  ],
  landmarks: [
    { x: 16, z: -30, name: 'Kirkeholmen', description: 'The church island. Only bridges reach it, and it holds the richest seam.' },
    { x: -190, z: 4, name: 'Fyrodden', description: 'The lighthouse point at the west tip of the skerries.' },
    { x: 160, z: 28, name: 'Tollboden', description: 'The old customs island on the eastern skerry.' },
    { x: -10, z: 96, name: 'Harbour Quay', description: 'Cranes and fuel tanks line the harbour front.' },
  ],
  billboards: [
    { x: -100, z: 124, angle: 0, size: 'hoarding' },
    { x: 100, z: 124, angle: 0, size: 'hoarding' },
    { x: 22, z: 80, angle: 0, size: 'banner' },
    { x: -26, z: -24, angle: 0, size: 'tower' },
    { x: -76, z: 90, angle: 0.2, size: 'banner' },
    { x: 76, z: 90, angle: -0.2, size: 'banner' },
  ],
  props: [
    { x: -196, z: -4, kind: 'lighthouse', angle: 0, solid: true },
    { x: -100, z: 61, kind: 'boat', angle: 1.4 },
    { x: 60, z: 61, kind: 'boat', angle: 1.7 },
    { x: -20, z: -66, kind: 'boat', angle: 1.5 },
    { x: 180, z: 56, kind: 'boat', angle: 1.6 },
    { x: -112, z: 86, kind: 'fishing_hut', angle: 0 },
    { x: -94, z: 88, kind: 'fishing_hut', angle: 0.05 },
    { x: 112, z: 88, kind: 'fishing_hut', angle: -0.05 },
    { x: 94, z: 88, kind: 'fishing_hut', angle: 0 },
    { x: -28, z: 90, kind: 'crane', angle: 0, solid: true },
    { x: 40, z: 96, kind: 'fuel_tanks', angle: 0, solid: true },
    { x: 24, z: 16, kind: 'ruin', angle: 0.3 },
    { x: 150, z: 22, kind: 'watch_hut', angle: 0 },
    { x: -160, z: 14, kind: 'windmill', angle: 0.4, solid: true },
    { x: 10, z: 30, kind: 'wreck_tank', angle: 2.8 },
  ],
  techSites: [
    // Tech sites: mirrored derricks on the outer islands; hospital and airstrip
    // on Kirkeholmen's centre line, either side of the Kirkegull seam.
    { kind: 'derrick', name: 'Fyrodden Derrick', x: -135, z: 15 },
    { kind: 'derrick', name: 'Tollbod Derrick', x: 135, z: 15 },
    { kind: 'fieldHospital', name: 'Kirkeholmen Field Hospital', x: 0, z: 22 },
    { kind: 'airstrip', name: 'Kirkeholmen Airstrip', x: 0, z: -40 },
  ],
  palette: {
    snow: '#dde2e1',
    grass: '#5d7c4c',
    earth: '#4e4a3f',
    gravel: '#868b88',
    rock: '#5a5f63',
    cliff: '#3f4448',
    sand: '#aeaa9b',
    marsh: '#4c5c3c',
    road: '#6f7372',
    shallow: '#4f7f88',
    deep: '#17313b',
    foam: '#e3eaec',
  },
  atmosphere: {
    sun: '#e9eff2',
    sunDirection: [-0.3, 0.78, 0.45],
    sunIntensity: 1.8,
    sky: '#8d9ba5',
    horizon: '#bfc8cc',
    bounce: '#56605c',
    fog: '#a9b4b8',
    fogDensity: 0.005,
    snowCover: 0.12,
    weather: 'clear',
    grade: 'overcast',
    exposure: 1,
  },
  shots: [
    { from: [-150, 8, 84], to: [-40, 8, 84], lookAt: [0, 2, 60], seconds: 14 },
    { from: [-205, 12, 20], to: [-180, 10, -24], lookAt: [-196, 6, -4], seconds: 12 },
    { from: [-40, 30, -30], to: [40, 30, -30], lookAt: [0, 2, -10], seconds: 14 },
    { from: [0, 50, 188], to: [0, 36, 150], lookAt: [0, 0, 20], seconds: 12 },
  ],
};
