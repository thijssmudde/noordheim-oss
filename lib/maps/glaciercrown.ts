import { ellipse, path, pt } from './author';
import type { MapDesign } from './types';

/*
 * GLACIER CROWN  (420 x 380 m, 4 players / 4 enemies)  bright blizzard ice
 *
 *   x: -210                          0                           +210
 * z-190 +-------------------------------------------------------------+
 *       |     [E3]          [E1]            [E2]           [E4]        |
 *       |  GOLD \             \              /             / GOLD      |
 *       |  flank  \     ooo     \  ______  /      ooo      /  flank    |
 *       |          |  ooooooo    /        \   ooooooo     |            |
 *       |          | Vestisen   |  ^^^^^^^ |  Østisen     |            |
 *       |   lane   |  ooooooo $ | ^ KRONEN^| $ ooooooo    |   lane     |
 *       |          |  ooooooo   |  ^GOLD^^ |   ooooooo    |            |
 *       |          |    ooo      \ ^^^^^^^ /     ooo      |            |
 *       |  $       /              \______ /                \      $    |
 *       |         /    $         /        \         $       \          |
 *       |     [L3]          [L1]            [L2]           [L4]        |
 * z+190 +-------------------------------------------------------------+
 *
 * King of the hill. Isbrekrona, a frozen plateau in the centre, is climbed by
 * four diagonal ramps, two from each side; on its top the smaller Kronen crown
 * holds the richest seam in the game, reached by two narrow ramps east and
 * west. Two frozen lakes split each side into a wide outer flank and a tight
 * inner lane. Every army starts the same distance from the crown.
 */

const R = 0.7071;
const CROWN = { x: 0, z: 0 };
const outerRamp = (sx: number, sz: number) => ({
  from: pt(CROWN.x + sx * R * 72, CROWN.z + sz * R * 72),
  to: pt(CROWN.x + sx * R * 50, CROWN.z + sz * R * 50),
  width: 11,
});

export const glaciercrown: MapDesign = {
  id: 'glaciercrown',
  name: 'Glacier Crown',
  tagline: 'Whoever holds the crown holds the gold.',
  description:
    'A frozen plateau rises between the armies with the richest seam in the north on its crown. Climb the ramps and hold it, or starve the enemy on the flanks around the frozen lakes.',
  biome: 'Blizzard-edged glacier',
  features: [
    'Central plateau with four ramps',
    'Kronen: a crown seam on the summit',
    'Frozen lakes split the flanks',
  ],
  accent: '#8fd3f0',
  bounds: { minX: -210, maxX: 210, minZ: -190, maxZ: 190 },
  capacity: { players: 4, enemies: 4 },
  landings: [pt(-50, 140), pt(50, 140), pt(-150, 140), pt(150, 140)],
  strongholds: [
    { x: -50, z: -140, facing: 0, radius: 44, name: 'Isvakt' },
    { x: 50, z: -140, facing: 0, radius: 44, name: 'Kaldborg' },
    { x: -150, z: -140, facing: 0.2, radius: 44, name: 'Frostheim' },
    { x: 150, z: -140, facing: -0.2, radius: 44, name: 'Snøfell' },
  ],
  ground: { height: 1.3, roll: 1.2, seed: 3313 },
  plateaus: [
    {
      name: 'Isbrekrona',
      outline: ellipse(CROWN.x, CROWN.z, 62, 58, 16, 0.04),
      height: 7,
      cliff: 4,
      ramps: [outerRamp(-1, 1), outerRamp(1, 1), outerRamp(-1, -1), outerRamp(1, -1)],
    },
    {
      name: 'Kronen',
      outline: ellipse(CROWN.x, CROWN.z, 22, 20, 10, 0.03),
      height: 3,
      cliff: 3,
      ramps: [
        { from: pt(-28, 0), to: pt(-12, 0), width: 8 },
        { from: pt(28, 0), to: pt(12, 0), width: 8 },
      ],
    },
  ],
  rivers: [],
  lakes: [
    { outline: ellipse(-128, 0, 26, 40, 14, 0.06), depth: 2.5 },
    { outline: ellipse(128, 0, 26, 40, 14, 0.06), depth: 2.5 },
  ],
  seas: [],
  crossings: [],
  marshes: [path(-146, 48, -112, 46, -104, 60, -140, 64), path(112, -46, 146, -48, 140, -64, 104, -60)],
  forests: [
    { outline: path(-112, 118, -88, 116, -86, 178, -112, 180), density: 1.1, species: 'pine' },
    { outline: path(88, 116, 112, 118, 112, 180, 86, 178), density: 1.1, species: 'pine' },
    { outline: path(-14, 170, 14, 170, 14, 186, -14, 186), density: 0.8, species: 'pine' },
    { outline: path(-112, -118, -88, -116, -86, -178, -112, -180), density: 1.1, species: 'pine' },
    { outline: path(88, -116, 112, -118, 112, -180, 86, -178), density: 1.1, species: 'pine' },
    { outline: path(-208, -20, -196, -24, -194, 20, -208, 24), density: 0.8, species: 'spruce' },
    { outline: path(196, -24, 208, -20, 208, 24, 194, 20), density: 0.8, species: 'spruce' },
  ],
  roads: [
    { path: path(-44, 108, -51, 52), width: 7, surface: 'gravel' },
    { path: path(44, 108, 51, 52), width: 7, surface: 'gravel' },
    { path: path(-44, -108, -51, -52), width: 7, surface: 'gravel' },
    { path: path(44, -108, 51, -52), width: 7, surface: 'gravel' },
    { path: path(-160, 106, -178, 40, -178, -40, -160, -106), width: 6, surface: 'gravel' },
    { path: path(160, 106, 178, 40, 178, -40, 160, -106), width: 6, surface: 'gravel' },
  ],
  ore: [
    { x: 0, z: 0, name: 'Kronegull', amount: 78000, rich: true },
    { x: -42, z: -8, name: 'Isbre West', amount: 52000 },
    { x: 42, z: 8, name: 'Isbre East', amount: 52000 },
    { x: -80, z: 72, name: 'Vestlia', amount: 45000 },
    { x: 80, z: 72, name: 'Østlia', amount: 45000 },
    { x: -192, z: 58, name: 'Vestkant', amount: 48000 },
    { x: 192, z: 58, name: 'Østkant', amount: 48000 },
    { x: -192, z: -62, name: 'Frostgull', amount: 62000, rich: true },
    { x: 192, z: -62, name: 'Snøgull', amount: 62000, rich: true },
  ],
  landmarks: [
    { x: 0, z: 34, name: 'Isbrekrona', description: 'The glacier plateau at the heart of the field. Four ramps climb it.' },
    { x: 0, z: 10, name: 'Kronen', description: 'The crown of the glacier and its richest seam.' },
    { x: -128, z: 54, name: 'Vestisen', description: 'A frozen lake. The ice will not hold armour.' },
    { x: 128, z: -54, name: 'Østisen', description: 'The eastern frozen lake splits the flank.' },
  ],
  billboards: [
    { x: -75, z: 100, angle: 0, size: 'hoarding' },
    { x: 75, z: 100, angle: 0, size: 'hoarding' },
    { x: 0, z: 76, angle: 0, size: 'tower' },
    { x: -74, z: 40, angle: 0.4, size: 'banner' },
    { x: 74, z: 40, angle: -0.4, size: 'banner' },
    { x: 40, z: -20, angle: 0, size: 'tower' },
  ],
  props: [
    { x: -80, z: 10, kind: 'wreck_plane', angle: 2.2, scale: 0.9 },
    { x: -62, z: 62, kind: 'watch_hut', angle: 0.8 },
    { x: 62, z: -62, kind: 'watch_hut', angle: -2.4 },
    { x: -60, z: 38, kind: 'wreck_tank', angle: 0.6 },
    { x: 70, z: -30, kind: 'wreck_tank', angle: -2.2 },
    { x: 0, z: 118, kind: 'statue', angle: 0 },
  ],
  techSites: [
    // Tech sites: mirrored derricks in the gaps between the crown and the tarns;
    // hospital and airstrip on the crown itself, replacing the ruin and the mast.
    { kind: 'derrick', name: 'Vestbre Derrick', x: -95, z: 0 },
    { kind: 'derrick', name: 'Østbre Derrick', x: 95, z: 0 },
    { kind: 'fieldHospital', name: 'Crown Field Hospital', x: 0, z: 36 },
    { kind: 'airstrip', name: 'Crown Airstrip', x: 0, z: -36 },
  ],
  palette: {
    snow: '#f5fafd',
    grass: '#8aa0ad',
    earth: '#687887',
    gravel: '#a6bccb',
    rock: '#7995ab',
    cliff: '#86c4e6',
    sand: '#d2e2ec',
    marsh: '#96b9cc',
    road: '#9aa9b5',
    shallow: '#8fe0ef',
    deep: '#2584b3',
    foam: '#ffffff',
  },
  atmosphere: {
    sun: '#f2faff',
    sunDirection: [-0.45, 0.62, 0.5],
    sunIntensity: 2.6,
    sky: '#98cdf0',
    horizon: '#e2f3fb',
    bounce: '#6f93b8',
    fog: '#d2eaf5',
    fogDensity: 0.0045,
    snowCover: 1,
    weather: 'blizzard',
    grade: 'arctic',
    exposure: 1.1,
  },
  shots: [
    { from: [-130, 22, 96], to: [130, 22, 96], lookAt: [0, 8, 0], seconds: 18 },
    { from: [-205, 6, 70], to: [-165, 6, -30], lookAt: [-128, 0, 0], seconds: 14 },
    { from: [0, 16, 46], to: [0, 14, 28], lookAt: [0, 10, 0], seconds: 10 },
    { from: [0, 60, 188], to: [0, 42, 150], lookAt: [0, 4, 0], seconds: 12 },
  ],
};
