import { crossing, ellipse, overDeck, path, pt } from './author';
import type { MapDesign, RiverDesign } from './types';

/*
 * IRON PASS  (420 x 380 m, 4 players / 3 enemies)  cold dawn, snowy pass
 *
 *   x: -210                          0                           +210
 * z-190 +----------------------------||-------------------------------+
 *       |   [W: Jernvakt]      [C: Stasjonen]  ||    [E: Fjellborg]    |
 *       |^^^^^^^^^^^^/    o tarn                //         /^^^^^^^^^^^^|
 *       |^ Vestkammen ^  GOLD                  //  ramp -> ^ GOLD ^^^^^|
 *       |^^ GOLD ^^^^^^|      wrecks         rail        |^ Østkammen ^|
 *       |^^^^=timber=^^|                      ||         |^^^^^^^^^^^^^|
 *  ~~~~~|~~~~~~~~~~~~~~~~~~~=steel=~~~~~==VIADUCT==~~~~~~FORD~~~~~~~~~~~~|~~ Jernelva
 *       |^^^^^^^^^^^^^^|   $                  ||  %marsh |^^ overlook ^|
 *       |^^^ $ ^^^^^^^^|                      ||    $    |^^^^ $ ^^^^^^|
 *       |^^^^^^/^^^^^^^|                      ||         |^^^^^^/^^^^^^|
 *       |  [L1]            [L2]       yard    ||    [L3]          [L4] |
 * z+190 +----------------------------||-------------------------------+
 *
 * The Iron Pass: a valley between two ridges, split by the Jernelva gorge.
 * The main lane follows the railway over the Jernbru viaduct; the west lane
 * uses Smedsbrua; the east lane wades Malmvadet under the east ridge's guns.
 * Vestkammen, the west ridge, is a full flank: climb at the south, cross the
 * gorge on the timber ridge bridge, and descend by the north ramp at the enemy's
 * door. Østkammen is split by the gorge: its south half overlooks the ford,
 * its north half hides a rich seam reached from the valley.
 */

const jernelva: RiverDesign = {
  path: path(-225, -20, -150, -26, -80, -14, 0, -22, 80, -12, 150, -24, 225, -18),
  width: [16, 16, 18, 20, 18, 16, 16],
  depth: 2.6,
};

const jernbru = crossing(jernelva, { x: 0 }, { id: 'jernbru', name: 'Jernbru Viaduct', style: 'viaduct', width: 12 });
const smedsbrua = crossing(jernelva, { x: -70 }, { id: 'smedsbrua', name: 'Smedsbrua', style: 'steel', width: 10 });
const malmvadet = crossing(jernelva, { x: 88 }, { id: 'malmvadet', name: 'Malmvadet', style: 'ford', width: 10 });
const kammbrua = crossing(jernelva, { x: -166 }, { id: 'kammbrua', name: 'Kammbrua', style: 'timber', width: 8, approach: 6 });

export const ironpass: MapDesign = {
  id: 'ironpass',
  name: 'Iron Pass',
  tagline: 'Hold the viaduct, or take the ridge and come down behind them.',
  description:
    'A railway runs through a snowbound pass. Push over the Jernbru viaduct, force Smedsbrua, wade Malmvadet, or climb Vestkammen and strike the enemy from the ridge.',
  biome: 'Cold dawn mountain pass',
  features: [
    'Railway viaduct over the Jernelva gorge',
    'Vestkammen ridge flank with a ridge-top bridge',
    'Østkammen overlook above the ford',
  ],
  accent: '#9fc4e8',
  bounds: { minX: -210, maxX: 210, minZ: -190, maxZ: 190 },
  capacity: { players: 4, enemies: 3 },
  landings: [pt(-52, 136), pt(52, 136), pt(-150, 136), pt(150, 136)],
  strongholds: [
    { x: 0, z: -144, facing: 0, radius: 44, name: 'Stasjonen' },
    { x: -140, z: -144, facing: 0.3, radius: 44, name: 'Jernvakt' },
    { x: 142, z: -144, facing: -0.3, radius: 44, name: 'Fjellborg' },
  ],
  ground: { height: 1.4, roll: 1.4, seed: 2207 },
  plateaus: [
    {
      name: 'Vestkammen',
      outline: path(-215, -100, -120, -92, -108, -40, -112, 20, -122, 70, -215, 80),
      height: 8,
      cliff: 4,
      ramps: [
        { from: pt(-160, 82), to: pt(-160, 62), width: 10 },
        { from: pt(-176, -106), to: pt(-176, -86), width: 10 },
      ],
    },
    {
      name: 'Østkammen',
      outline: path(120, -95, 215, -105, 215, 75, 125, 65, 112, 10, 110, -50),
      height: 7,
      cliff: 4,
      ramps: [
        { from: pt(170, 78), to: pt(170, 58), width: 10 },
        { from: pt(100, -64), to: pt(122, -64), width: 10 },
      ],
    },
  ],
  rivers: [jernelva],
  lakes: [{ outline: ellipse(-62, -108, 15, 11), depth: 2 }],
  seas: [],
  crossings: [
    jernbru,
    smedsbrua,
    malmvadet,
    kammbrua,
  ],
  marshes: [path(58, 12, 78, 8, 92, 18, 76, 30, 58, 24)],
  forests: [
    { outline: path(-100, 60, -76, 56, -70, 92, -98, 100), density: 1.3, species: 'spruce' },
    { outline: path(78, 64, 104, 60, 108, 96, 84, 100), density: 1.3, species: 'spruce' },
    { outline: path(-205, 90, -175, 96, -178, 186, -205, 186), density: 1.4, species: 'spruce' },
    { outline: path(180, 96, 205, 90, 205, 186, 182, 186), density: 1.4, species: 'spruce' },
    { outline: path(-100, -60, -80, -64, -76, -40, -96, -34), density: 1, species: 'pine' },
    { outline: path(36, -60, 60, -66, 66, -44, 44, -40), density: 1, species: 'pine' },
    { outline: path(-200, 10, -180, 6, -176, 50, -200, 56), density: 0.7, species: 'pine' },
    { outline: path(180, -80, 204, -84, 204, -40, 184, -44), density: 0.7, species: 'pine' },
  ],
  roads: [
    { path: [...path(10, 195, 8, 100, 4, 40), ...overDeck(jernbru, pt(4, 40), 5), ...path(20, -70, 65, -120, 72, -195)], width: 5, surface: 'rail' },
    { path: [...path(-114, 117, -104, 112, -84, 50), ...overDeck(smedsbrua, pt(-84, 50)), ...path(-84, -60, -104, -104)], width: 7, surface: 'gravel' },
    { path: [...path(114, 117, 104, 112, 96, 40), ...overDeck(malmvadet, pt(96, 40)), ...path(90, -56, 106, -106, 122, -124)], width: 7, surface: 'gravel' },
    { path: path(-24, 110, -2, 60, 3, 57), width: 6, surface: 'paved' },
    { path: path(24, 110, 6, 60), width: 6, surface: 'paved' },
    // The ridge road: up the south ramp east of the seam, over Kammbrua, round the
    // gold, down the north ramp and past Jernvakt to meet the Smedsbrua road.
    { path: [...path(-160, 100, -160, 62, -152, 34), ...overDeck(kammbrua, pt(-152, 34)), ...path(-176, -52, -184, -66, -176, -86, -176, -106, -168, -112, -128, -110, -104, -104)], width: 6, surface: 'gravel' },
    { path: path(170, 100, 170, 80), width: 6, surface: 'gravel' },
  ],
  ore: [
    { x: -40, z: 34, name: 'Smedjeløkka', amount: 45000 },
    { x: 50, z: 44, name: 'Skinnemalm', amount: 45000 },
    { x: -168, z: 36, name: 'Vestkamm Seam', amount: 52000 },
    { x: 172, z: 30, name: 'Utsikt Seam', amount: 52000 },
    { x: -30, z: -76, name: 'Jernhjerte Gold', amount: 70000, rich: true },
    { x: 168, z: -58, name: 'Østkammen Gold', amount: 70000, rich: true },
    { x: -160, z: -60, name: 'Kammen Gold', amount: 62000, rich: true },
  ],
  landmarks: [
    { x: 14, z: 6, name: 'Jernbru', description: 'The railway viaduct over the Jernelva gorge. The main road north.' },
    { x: -150, z: 20, name: 'Vestkammen', description: 'The west ridge. A narrow timber bridge crosses its gorge.' },
    { x: 180, z: 40, name: 'Østkammen', description: 'The east ridge overlooks Malmvadet ford.' },
    { x: -62, z: -88, name: 'Kaldtjern', description: 'A frozen tarn below Jernvakt.' },
    { x: 0, z: 100, name: 'Pass Yard', description: 'The railway yard where the landings meet.' },
  ],
  billboards: [
    { x: -104, z: 128, angle: 0.2, size: 'hoarding' },
    { x: 104, z: 128, angle: -0.2, size: 'hoarding' },
    { x: 24, z: 4, angle: 0, size: 'banner' },
    { x: -94, z: 4, angle: 0.1, size: 'banner' },
    { x: -146, z: 44, angle: 0, size: 'tower' },
    { x: 0, z: 150, angle: 0, size: 'tower' },
  ],
  props: [
    { x: 8.25, z: 112, kind: 'rail_wagon', angle: 0.021 },
    { x: 8.59, z: 128, kind: 'rail_wagon', angle: 0.021 },
    { x: 34, z: -85.56, kind: 'rail_wagon', angle: 2.408 },
    { x: -7, z: 120, kind: 'crane', angle: 0, solid: true },
    { x: -8, z: 140, kind: 'fuel_tanks', angle: 0, solid: true },
    { x: -14, z: 6, kind: 'watch_hut', angle: 0.3 },
    { x: -20, z: -50, kind: 'wreck_tank', angle: 2.4 },
    { x: 28, z: -50, kind: 'wreck_tank', angle: -0.6 },
    { x: -52, z: 12, kind: 'wreck_tank', angle: 0.4 },
    { x: 190, z: 46, kind: 'radio_mast', angle: 0, solid: true },
    { x: -188, z: 66, kind: 'ruin', angle: 0.3, scale: 0.7 },
    { x: -12, z: 34, kind: 'statue', angle: 0 },
  ],
  techSites: [
    // Tech sites: mirrored derricks under the flank plateaus; the hospital south
    // of the bridge and the airstrip north of it pull both sides to the centre lane.
    { kind: 'derrick', name: 'Vestskar Derrick', x: -106, z: 20 },
    { kind: 'derrick', name: 'Østskar Derrick', x: 106, z: 20 },
    { kind: 'fieldHospital', name: 'Pass Field Hospital', x: 0, z: 34 },
    { kind: 'airstrip', name: 'Jernvidda Airstrip', x: 0, z: -62 },
  ],
  palette: {
    snow: '#f3eef1',
    grass: '#707a5f',
    earth: '#7d5040',
    gravel: '#948379',
    rock: '#76696a',
    cliff: '#54494b',
    sand: '#bda293',
    marsh: '#626650',
    road: '#8a7870',
    shallow: '#5a86a8',
    deep: '#1a3552',
    foam: '#f2eef4',
  },
  atmosphere: {
    sun: '#ffb49a',
    sunDirection: [0.7, 0.28, -0.4],
    sunIntensity: 2.5,
    sky: '#86a0cc',
    horizon: '#f4a595',
    bounce: '#5d566f',
    fog: '#dcc4cc',
    fogDensity: 0.0036,
    snowCover: 0.85,
    weather: 'snowfall',
    grade: 'dawn',
    exposure: 1,
  },
  shots: [
    { from: [-205, 5, -20], to: [-120, 6, -24], lookAt: [-60, 2, -16], seconds: 14 },
    { from: [40, 16, 70], to: [-30, 14, 40], lookAt: [0, 2, -22], seconds: 14 },
    { from: [8, 40, 185], to: [6, 30, 120], lookAt: [0, 0, -40], seconds: 12 },
    { from: [200, 26, 60], to: [160, 22, 20], lookAt: [88, 0, -12], seconds: 12 },
  ],
};
