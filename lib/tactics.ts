import { crossingBounds } from './tactical-terrain';
import {
  DEFAULT_MAP_ID,
  isMapId,
  MAPS,
  type MapId,
  type StoredMapId,
} from './maps';
import {
  terrainFor,
  defaultTerrain,
  type TerrainMap,
} from './tactical-terrain';
import {
  buildAreas,
  OUTPOST_BUILD_RADIUS,
  footprint,
  footprintSamples,
  footprintsOverlap,
  hasExit,
  insideFootprint,
  ORE_CLEARANCE,
  productionExit,
  STRUCTURE_GAP,
  snapPlacement,
  segmentIntersectsFootprint,
  type Footprint,
  type Placement,
  type PlaceableKind,
} from './tactical-placement';
import {
  groundNavigation,
  groundSegmentCost,
  simplifyGroundPath,
  sharedCorridors,
  takeRouteSearch,
  withRoutingBudget,
  routeSearchDeferred,
  beginRouteRequest,
  ROUTE_SEARCH_BUDGET,
} from './tactical-navigation';
import { formationDestinations, formationRadius } from './tactical-formation';
import {
  clearWorkPosition,
  harvesterWorkPositions,
} from './tactical-harvesting';
import {
  columnsFor,
  difficultyFor,
  guardsFor,
  operationRandom,
  productionFor,
  veterancyFor,
  DIFFICULTIES,
  type Difficulty,
} from './tactical-difficulty';
import { generateWorld } from './tactical-world';
import {
  DEFAULT_SKIRMISH_MODE,
  skirmishName,
  skirmishRules,
  type SkirmishMode,
} from './skirmish-modes';
import {
  CARRIER_SPEED,
  FLAG_ALERT_MS,
  FLAG_OFFSET,
  FLAG_RADIUS,
  PICKUP_RADIUS,
  PICKUP_SECONDS,
  RETURN_SECONDS,
  carrierOf,
  flagHome,
  flagSpot,
  flagState,
  type Flag,
} from './tactical-flags';
export {
  CARRIER_SPEED,
  FLAG_RADIUS,
  PICKUP_RADIUS,
  PICKUP_SECONDS,
  RETURN_SECONDS,
  carrierOf,
  flagHome,
  flagState,
  type Flag,
  type FlagState,
} from './tactical-flags';
import { TacticalSpatialIndex } from './tactical-spatial';
import {
  advanceKinematics,
  createKinematicState,
  routeTail,
  turnToward,
  type Drive,
  type Mobility,
} from './tactical-kinematics';
import { CULTURES, doctrineOf, type Culture, type Doctrine } from './cultures';
import {
  advanceSuperweapons,
  frozen,
  isSuperweapon,
  raiseWeatherMasts,
  revealed,
  strikeDamage,
  strikeSpeed,
  superweaponLock,
  type Strike,
  type SuperweaponCharge,
} from './tactical-superweapons';
import {
  SITE_RULES,
  TECH_SITES,
  createSites,
  planFlight,
  reconPosition,
  reconSees,
  siteFootprint,
  siteReach,
  siteSees,
  siteSpec,
  type ReconFlight,
  type SiteTeam,
  type TechSite,
} from './tactical-sites';
export {
  SITE_RULES,
  TECH_SITES,
  captureShare,
  reconPosition,
  reconSees,
  siteFootprint,
  siteSpec,
  techSiteKinds,
  type ReconFlight,
  type TechSite,
  type TechSiteKind,
} from './tactical-sites';
export const TACTICAL_TICK_MS = 250;
export const TRAINING_QUEUE_LIMIT = 100;
/** Field units per commander, excluding harvesters. */
export const COMMAND_LIMIT = 80;
/** Harvesters each completed refinery supports; the first eight come with the command station. */
export const HARVESTER_LIMIT = 8;
export const SELECTION_LIMIT = COMMAND_LIMIT + HARVESTER_LIMIT;
export const CONSTRUCTION_QUEUE_LIMIT = 5;
/** Measured operating envelope; existing armies survive reductions in the limits. */
export const BATTLE_ENTITY_LIMIT = 512;
export const ALLIED_ARMY_BUDGET = 160;
export const STRUCTURE_LIMIT = 128;
/** Reach of the aid station's and field workshop's recovery, in metres. */
export const AURA_RADIUS = 45;
export const commandLimit = (b: Pick<Battle, 'playerSlots' | 'commanders'>) =>
  Math.min(
    COMMAND_LIMIT,
    Math.floor(
      ALLIED_ARMY_BUDGET / Math.max(1, b.playerSlots ?? 1, b.commanders.length),
    ),
  );
/** Eight harvesters per completed refinery, and eight before the first one stands. */
export const harvesterLimit = (b: Pick<Battle, 'entities'>, owner: string) => {
  let refineries = 0;
  for (const e of b.entities)
    if (e.owner === owner && e.kind === 'refinery' && e.hp > 0 && !e.readyAt)
      refineries++;
  return HARVESTER_LIMIT * Math.max(1, refineries);
};
/**
 * Battlefield space each surviving hostile army keeps for its home guard and a
 * minimum column. Allied construction and training stop short of it, so a full
 * lobby can never starve the garrisons into silence.
 */
export const hostileReserve = (
  b: Pick<Battle, 'entities' | 'difficulty' | 'enemyCount'>,
) =>
  Math.min(
    HOSTILE_ARMY_BUDGET(b),
    hostileArmies(b).length * (hostileGuards(b) + 6),
  );
export const battleHasRoom = (
  b: Pick<Battle, 'entities' | 'battlefieldFull' | 'difficulty' | 'enemyCount'>,
  team: Entity['team'] = 'blue',
) => {
  if (b.battlefieldFull === true) return false;
  let living = 0,
    hostile = 0;
  for (const e of b.entities) {
    if (e.hp <= 0) continue;
    living++;
    if (e.team === 'red' && isUnit(e.kind)) hostile++;
  }
  if (team === 'red') return living < BATTLE_ENTITY_LIMIT;
  return (
    living + Math.max(0, hostileReserve(b) - hostile) < BATTLE_ENTITY_LIMIT
  );
};
export const STARTING_CREDITS = DIFFICULTIES.normal.credits;
export const CREDIT_CAP = 60000;
export const OPERATION_MINUTES = 45;
export const MAP_VERSION = 9;
/** Logged when a sector from before the hand-built maps is closed. */
export const RETIRED_MAP_EVENT =
  'This operation was retired with the old battlefields.';
/** Shared, deterministic rules for Noordheim's cooperative tactical sectors. */
import { baseAt, insideSector, type Point } from './tactical-terrain';
export {
  SECTOR,
  baseAt,
  buildableAt,
  groundAt,
  heightAt,
  insideSector,
  terrainAt,
  terrainSpeed,
  type Point,
  type Terrain,
} from './tactical-terrain';
export type ArmorClass = 'infantry' | 'vehicle' | 'air' | 'structure';
export type UnitCategory = 'infantry' | 'vehicle' | 'air';
export type Versus = Record<ArmorClass, number>;
export type Producer =
  | 'barracks'
  | 'factory'
  | 'airfield'
  | 'camp'
  | 'armory'
  | 'depot'
  | 'watchtower';
/** Every structure that trains troops, and so can hold a rally point. */
export const PRODUCERS: readonly Producer[] = [
  'barracks',
  'factory',
  'airfield',
  'camp',
  'armory',
  'depot',
  'watchtower',
];
export const isProducer = (kind: string): kind is Producer =>
  (PRODUCERS as readonly string[]).includes(kind);
type UnitSpec = {
  name: string;
  role: string;
  category: UnitCategory;
  armor: ArmorClass;
  producer: Producer;
  tier: 1 | 2 | 3;
  /** Signature equipment: only commanders of this faction can field it. */
  faction?: Culture;
  hp: number;
  damage: number;
  range: number;
  minRange?: number;
  speed: number;
  cost: number;
  seconds: number;
  power: number;
  vision?: number;
  cargo?: number;
  load?: number;
  versus: Versus;
  model: string;
  /** How the hull moves: see lib/tactical-kinematics.ts. */
  drive: Drive;
  /** Maximum hull yaw rate, rad/s. Infantry turn near-instantly, heavy armour slowly. */
  turn: number;
  /** Acceleration, m/s²; braking is 1.5x stronger. */
  accel: number;
  /** A yawing turret aims, so the hull keeps its heading while fighting. */
  turret?: boolean;
};
const none: Versus = { infantry: 0, vehicle: 0, air: 0, structure: 0 };
export const TACTICAL_UNITS = {
  ranger: {
    name: 'Jæger patrol',
    role: 'Northern infantry',
    category: 'infantry',
    armor: 'infantry',
    producer: 'barracks',
    tier: 1,
    hp: 160,
    damage: 22,
    range: 13,
    speed: 6,
    cost: 100,
    seconds: 8,
    power: 0,
    versus: { infantry: 1, vehicle: 0.35, air: 0.5, structure: 0.3 },
    model: 'ranger',
    drive: 'foot',
    turn: 14,
    accel: 30,
  },
  rocket: {
    name: 'Rocket Jæger',
    role: 'Anti-armor and anti-air infantry',
    category: 'infantry',
    armor: 'infantry',
    producer: 'barracks',
    tier: 1,
    hp: 150,
    damage: 34,
    range: 16,
    speed: 5.5,
    cost: 160,
    seconds: 10,
    power: 0,
    versus: { infantry: 0.45, vehicle: 1.3, air: 1.2, structure: 0.9 },
    model: 'rocket',
    drive: 'foot',
    turn: 12,
    accel: 26,
  },
  harvester: {
    name: 'Malm harvester',
    role: 'Collects ore and delivers it to a refinery',
    category: 'vehicle',
    armor: 'vehicle',
    producer: 'factory',
    tier: 1,
    hp: 700,
    damage: 0,
    range: 0,
    speed: 6.5,
    cost: 350,
    seconds: 16,
    power: 1,
    cargo: 500,
    load: 45,
    versus: none,
    model: 'harvester',
    drive: 'wheels',
    turn: 1.6,
    accel: 6,
  },
  lynx: {
    name: 'Lynx IFV',
    role: 'Fast reconnaissance',
    category: 'vehicle',
    armor: 'vehicle',
    producer: 'factory',
    tier: 1,
    hp: 460,
    damage: 36,
    range: 18,
    speed: 10,
    cost: 220,
    seconds: 14,
    power: 1,
    versus: { infantry: 1.25, vehicle: 0.6, air: 0.8, structure: 0.4 },
    model: 'lynx',
    drive: 'wheels',
    turn: 2.8,
    accel: 12,
    turret: true,
  },
  tank: {
    name: 'Stridsvagn',
    role: 'Main battle tank',
    category: 'vehicle',
    armor: 'vehicle',
    producer: 'factory',
    tier: 2,
    hp: 1100,
    damage: 90,
    range: 22,
    speed: 5,
    cost: 480,
    seconds: 22,
    power: 2,
    versus: { infantry: 0.55, vehicle: 1, air: 0, structure: 1 },
    model: 'tank',
    drive: 'tracks',
    turn: 1.9,
    accel: 8,
    turret: true,
  },
  howitzer: {
    name: 'Archer howitzer',
    role: 'Long-range artillery · cannot fire close',
    category: 'vehicle',
    armor: 'vehicle',
    producer: 'factory',
    tier: 2,
    hp: 520,
    damage: 120,
    range: 38,
    minRange: 12,
    speed: 4.5,
    cost: 560,
    seconds: 24,
    power: 2,
    versus: { infantry: 0.9, vehicle: 0.8, air: 0, structure: 1.5 },
    model: 'howitzer',
    drive: 'wheels',
    turn: 1.9,
    accel: 6,
    turret: true,
  },
  jotun: {
    name: 'Jotun heavy tank',
    role: 'Tier 3 breakthrough armor',
    category: 'vehicle',
    armor: 'vehicle',
    producer: 'factory',
    tier: 3,
    hp: 2200,
    damage: 150,
    range: 24,
    speed: 4,
    cost: 950,
    seconds: 34,
    power: 3,
    versus: { infantry: 0.6, vehicle: 1.2, air: 0, structure: 1.2 },
    model: 'jotun',
    drive: 'tracks',
    turn: 1.3,
    accel: 5,
    turret: true,
  },
  drone: {
    name: 'Hugin drone',
    role: 'Air reconnaissance',
    category: 'air',
    armor: 'air',
    producer: 'airfield',
    tier: 1,
    hp: 230,
    damage: 27,
    range: 18,
    speed: 13,
    cost: 260,
    seconds: 16,
    power: 1,
    vision: 46,
    versus: { infantry: 1, vehicle: 0.6, air: 0.7, structure: 0.3 },
    model: 'drone',
    drive: 'air',
    turn: 3.5,
    accel: 14,
  },
  gunship: {
    name: 'Valkyrie gunship',
    role: 'Tier 3 attack helicopter',
    category: 'air',
    armor: 'air',
    producer: 'airfield',
    tier: 3,
    hp: 900,
    damage: 95,
    range: 22,
    speed: 11,
    cost: 850,
    seconds: 30,
    power: 2,
    vision: 40,
    versus: { infantry: 1.2, vehicle: 1, air: 0.5, structure: 0.8 },
    model: 'gunship',
    drive: 'air',
    turn: 2.0,
    accel: 9,
  },
  // Faction signature troops. Each trains at its faction's own structure.
  raider: {
    name: 'Fjord raider',
    role: 'Fjordborn ski infantry · satchel charges',
    category: 'infantry',
    armor: 'infantry',
    producer: 'camp',
    tier: 1,
    faction: 'fjordborn',
    hp: 140,
    damage: 30,
    range: 10,
    speed: 7.5,
    cost: 130,
    seconds: 8,
    power: 0,
    versus: { infantry: 1.2, vehicle: 0.3, air: 0.3, structure: 0.7 },
    model: 'raider',
    drive: 'foot',
    turn: 14,
    accel: 32,
  },
  snowmobile: {
    name: 'Varg snowmobile',
    role: 'Fjordborn raiding snowmobile · fastest ground unit',
    category: 'vehicle',
    armor: 'vehicle',
    producer: 'camp',
    tier: 2,
    faction: 'fjordborn',
    hp: 460,
    damage: 42,
    range: 16,
    speed: 13,
    cost: 360,
    seconds: 17,
    power: 1,
    versus: { infantry: 1.15, vehicle: 0.55, air: 0.4, structure: 0.7 },
    model: 'snowmobile',
    drive: 'wheels',
    turn: 3.2,
    accel: 14,
    turret: true,
  },
  sapper: {
    name: 'Sapper',
    role: 'Ironclad demolition infantry · breaks structures',
    category: 'infantry',
    armor: 'infantry',
    producer: 'armory',
    tier: 1,
    faction: 'ironclad',
    hp: 200,
    damage: 28,
    range: 11,
    speed: 5,
    cost: 170,
    seconds: 11,
    power: 0,
    versus: { infantry: 0.7, vehicle: 0.6, air: 0.2, structure: 1.8 },
    model: 'sapper',
    drive: 'foot',
    turn: 12,
    accel: 24,
  },
  mortar: {
    name: 'Mjølnir siege mortar',
    role: 'Ironclad bunker-buster · cannot fire close',
    category: 'vehicle',
    armor: 'vehicle',
    producer: 'armory',
    tier: 2,
    faction: 'ironclad',
    hp: 800,
    damage: 140,
    range: 32,
    minRange: 10,
    speed: 3.8,
    cost: 620,
    seconds: 26,
    power: 2,
    versus: { infantry: 1.1, vehicle: 0.7, air: 0, structure: 1.6 },
    model: 'mortar',
    drive: 'tracks',
    turn: 1.4,
    accel: 5,
  },
  militia: {
    name: 'Hearth militia',
    role: 'Hearthkin volunteers · cheap and quick to raise',
    category: 'infantry',
    armor: 'infantry',
    producer: 'depot',
    tier: 1,
    faction: 'hearthkin',
    hp: 120,
    damage: 16,
    range: 12,
    speed: 6,
    cost: 60,
    seconds: 5,
    power: 0,
    versus: { infantry: 0.9, vehicle: 0.3, air: 0.3, structure: 0.35 },
    model: 'militia',
    drive: 'foot',
    turn: 14,
    accel: 30,
  },
  bulwark: {
    name: 'Bulwark plough tank',
    role: 'Hearthkin armored tractor · soaks fire for the column',
    category: 'vehicle',
    armor: 'vehicle',
    producer: 'depot',
    tier: 2,
    faction: 'hearthkin',
    hp: 1500,
    damage: 40,
    range: 14,
    speed: 4.5,
    cost: 420,
    seconds: 20,
    power: 2,
    versus: { infantry: 0.9, vehicle: 0.7, air: 0, structure: 0.6 },
    model: 'bulwark',
    drive: 'tracks',
    turn: 1.5,
    accel: 5,
    turret: true,
  },
  marksman: {
    name: 'Ember marksman',
    role: 'Ashwalker sniper · outranges every rifle',
    category: 'infantry',
    armor: 'infantry',
    producer: 'watchtower',
    tier: 1,
    faction: 'ashwalkers',
    hp: 120,
    damage: 60,
    range: 24,
    speed: 5.5,
    cost: 200,
    seconds: 12,
    power: 0,
    vision: 34,
    versus: { infantry: 1.5, vehicle: 0.2, air: 0.3, structure: 0.2 },
    model: 'marksman',
    drive: 'foot',
    turn: 12,
    accel: 26,
  },
  fenrir: {
    name: 'Fenrir scout car',
    role: 'Ashwalker forward observer · long sight, flare launcher',
    category: 'vehicle',
    armor: 'vehicle',
    producer: 'watchtower',
    tier: 2,
    faction: 'ashwalkers',
    hp: 380,
    damage: 34,
    range: 18,
    speed: 12,
    cost: 300,
    seconds: 15,
    power: 1,
    vision: 44,
    versus: { infantry: 1.1, vehicle: 0.5, air: 0.6, structure: 0.4 },
    model: 'fenrir',
    drive: 'wheels',
    turn: 3.0,
    accel: 13,
    turret: true,
  },
} as const satisfies Record<string, UnitSpec>;
type BuildingSpec = {
  name: string;
  role: string;
  hp: number;
  cost: number;
  seconds: number;
  power: number;
  provides?: number;
  tier: 1 | 2 | 3;
  requires?: string;
  /** Signature structure: only commanders of this faction can build it. */
  faction?: Culture;
  vision?: number;
  attack?: { damage: number; range: number; minRange?: number; versus: Versus };
  model: string;
};
export const TACTICAL_BUILDINGS = {
  hq: {
    name: 'Command station',
    role: 'Northern command · +12 power',
    hp: 3500,
    cost: 0,
    seconds: 0,
    power: 0,
    provides: 12,
    tier: 1,
    vision: 36,
    model: 'hq',
  },
  reactor: {
    name: 'Geothermal plant',
    role: '+12 grid power',
    hp: 900,
    cost: 160,
    seconds: 10,
    power: 0,
    provides: 12,
    tier: 1,
    model: 'reactor',
  },
  refinery: {
    name: 'Ore refinery',
    role: 'Harvester drop-off · includes a harvester',
    hp: 1100,
    cost: 450,
    seconds: 14,
    power: 2,
    tier: 1,
    requires: 'reactor',
    model: 'refinery',
  },
  barracks: {
    name: 'Jæger hall',
    role: 'Trains infantry',
    hp: 1000,
    cost: 300,
    seconds: 11,
    power: 1,
    tier: 1,
    requires: 'reactor',
    model: 'barracks',
  },
  factory: {
    name: 'Vehicle works',
    role: 'Builds vehicles and harvesters',
    hp: 1400,
    cost: 600,
    seconds: 17,
    power: 3,
    tier: 1,
    requires: 'refinery',
    model: 'factory',
  },
  outpost: {
    name: 'Forward outpost',
    role: `${OUTPOST_BUILD_RADIUS}m build radius · +4 power · long sight`,
    hp: 700,
    cost: 250,
    seconds: 10,
    power: 0,
    provides: 4,
    tier: 1,
    vision: OUTPOST_BUILD_RADIUS,
    model: 'outpost',
  },
  turret: {
    name: 'Bofors sentry',
    role: 'Automated anti-air and perimeter defense',
    hp: 800,
    cost: 200,
    seconds: 8,
    power: 2,
    tier: 1,
    requires: 'barracks',
    attack: {
      damage: 48,
      range: 24,
      versus: { infantry: 1, vehicle: 0.7, air: 1, structure: 0.5 },
    },
    model: 'turret',
  },
  airfield: {
    name: 'Air base',
    role: 'Builds drones and gunships',
    hp: 1200,
    cost: 700,
    seconds: 18,
    power: 3,
    tier: 2,
    requires: 'factory',
    model: 'airfield',
  },
  lab: {
    name: 'Research station',
    role: 'Upgrades and Tier 3 clearance',
    hp: 1000,
    cost: 800,
    seconds: 21,
    power: 4,
    tier: 2,
    requires: 'factory',
    model: 'lab',
  },
  battery: {
    name: 'Coastal battery',
    role: 'Long-range artillery defense',
    hp: 1500,
    cost: 650,
    seconds: 15,
    power: 3,
    tier: 2,
    requires: 'factory',
    attack: {
      damage: 130,
      range: 40,
      minRange: 10,
      versus: { infantry: 0.8, vehicle: 1, air: 0, structure: 1.2 },
    },
    model: 'battery',
  },
  // Expansion structures: concrete instead of research.
  bunker: {
    name: 'Pillbox',
    role: 'Machine-gun bunker · shreds infantry',
    hp: 900,
    cost: 150,
    seconds: 7,
    power: 1,
    tier: 1,
    requires: 'barracks',
    attack: {
      damage: 32,
      range: 18,
      versus: { infantry: 1.5, vehicle: 0.25, air: 0, structure: 0.15 },
    },
    model: 'bunker',
  },
  hospital: {
    name: 'Aid station',
    role: `Idle infantry within ${AURA_RADIUS}m recover 3% health per second`,
    hp: 900,
    cost: 300,
    seconds: 11,
    power: 1,
    tier: 1,
    requires: 'barracks',
    model: 'hospital',
  },
  flak: {
    name: 'Flak tower',
    role: 'Twin autocannon tower · anti-air only',
    hp: 1000,
    cost: 350,
    seconds: 11,
    power: 2,
    tier: 2,
    requires: 'factory',
    attack: {
      damage: 70,
      range: 30,
      versus: { infantry: 0.15, vehicle: 0.15, air: 1.5, structure: 0 },
    },
    model: 'flak',
  },
  radar: {
    name: 'Radar mast',
    role: 'Long-range sight · reveals the approaches',
    hp: 800,
    cost: 400,
    seconds: 12,
    power: 3,
    tier: 2,
    requires: 'factory',
    vision: 72,
    model: 'radar',
  },
  plant: {
    name: 'Thermal power station',
    role: '+30 grid power',
    hp: 1200,
    cost: 550,
    seconds: 17,
    power: 0,
    provides: 30,
    tier: 2,
    requires: 'reactor',
    model: 'plant',
  },
  workshop: {
    name: 'Field workshop',
    role: `Idle vehicles and aircraft within ${AURA_RADIUS}m repair 2% health per second`,
    hp: 1100,
    cost: 450,
    seconds: 14,
    power: 2,
    tier: 2,
    requires: 'factory',
    model: 'workshop',
  },
  // Faction signature structures. Each trains its faction's two signature troops.
  camp: {
    name: 'Strandhogg raiding camp',
    role: 'Fjordborn raiding lodge · trains raiders and snowmobiles',
    hp: 1000,
    cost: 400,
    seconds: 12,
    power: 2,
    tier: 1,
    requires: 'reactor',
    faction: 'fjordborn',
    model: 'camp',
  },
  armory: {
    name: 'Bergverk armory',
    role: 'Ironclad bunker forge · trains sappers and siege mortars',
    hp: 1600,
    cost: 450,
    seconds: 14,
    power: 2,
    tier: 1,
    requires: 'reactor',
    faction: 'ironclad',
    model: 'armory',
  },
  depot: {
    name: 'Lade storehouse',
    role: 'Hearthkin supply depot · trains militia and plough tanks',
    hp: 1000,
    cost: 350,
    seconds: 11,
    power: 1,
    tier: 1,
    requires: 'reactor',
    faction: 'hearthkin',
    model: 'depot',
  },
  watchtower: {
    name: 'Varde watchtower',
    role: 'Ashwalker fire-watch · trains marksmen and scout cars · long sight',
    hp: 800,
    cost: 350,
    seconds: 11,
    power: 1,
    tier: 1,
    requires: 'reactor',
    faction: 'ashwalkers',
    vision: 48,
    model: 'watchtower',
  },
  // Superweapons: one faction-locked Tier 3 structure per commander, and the
  // garrison's Weather Mast. Their weapons are tuned in SUPERWEAPONS below.
  boathouse: {
    name: 'Naust storm-boat house',
    role: 'Fjordborn superweapon · Skerry Strike lands a veteran raiding party',
    hp: 1800,
    cost: 2600,
    seconds: 50,
    power: 8,
    tier: 3,
    requires: 'lab',
    faction: 'fjordborn',
    model: 'boathouse',
  },
  cannon: {
    name: 'Fjell railway gun',
    role: 'Ironclad superweapon · the Mountain Gun shells any scouted ground',
    hp: 2400,
    cost: 3000,
    seconds: 55,
    power: 10,
    tier: 3,
    requires: 'lab',
    faction: 'ironclad',
    model: 'cannon',
  },
  airstrip: {
    name: 'Vinterveg airstrip',
    role: 'Hearthkin superweapon · Winter Convoy repairs, pays and rallies the column',
    hp: 1800,
    cost: 2500,
    seconds: 50,
    power: 8,
    tier: 3,
    requires: 'lab',
    faction: 'hearthkin',
    model: 'airstrip',
  },
  launcher: {
    name: 'Brann rocket battery',
    role: 'Ashwalker superweapon · Firestorm reveals and burns a wide area',
    hp: 1600,
    cost: 2800,
    seconds: 50,
    power: 8,
    tier: 3,
    requires: 'lab',
    faction: 'ashwalkers',
    model: 'launcher',
  },
  weathermast: {
    name: 'Weather Mast',
    role: 'Garrison superweapon · calls a freezing blizzard on the strongest allied position',
    hp: 2200,
    cost: 0,
    seconds: 0,
    power: 0,
    tier: 3,
    vision: 30,
    model: 'weathermast',
  },
} as const satisfies Record<string, BuildingSpec>;
/**
 * Superweapon knobs, keyed by the structure that fires them. `chargeSeconds`
 * runs from completion, pauses while the owner's grid is short and restarts on
 * launch (the Weather Mast's comes from DIFFICULTIES). Every weapon telegraphs
 * a ring for `telegraphSeconds` before it lands, and none ever hurts the
 * coalition that fired it. `radius` is the effect area in metres.
 */
export const SUPERWEAPONS = {
  boathouse: {
    weapon: 'Skerry Strike',
    chargeSeconds: 195,
    telegraphSeconds: 4,
    radius: 12,
    /** The landing party: signature troops and two tanks. */
    party: { raider: 6, snowmobile: 2, tank: 2 },
    /** Veterans deal this much more damage and take this much of it. */
    veteranDamage: 1.25,
    veteranArmor: 0.8,
  },
  cannon: {
    weapon: 'Mountain Gun',
    chargeSeconds: 210,
    telegraphSeconds: 4,
    radius: 24,
    /** Damage at the centre, falling linearly to `edge` of it at the rim. */
    damage: 3000,
    edge: 0.3,
  },
  airstrip: {
    weapon: 'Winter Convoy',
    chargeSeconds: 180,
    telegraphSeconds: 4,
    radius: 40,
    credits: 1000,
    /** Speed and fire-rate multiplier for allied troops under the drop. */
    boost: 1.3,
    boostSeconds: 30,
  },
  launcher: {
    weapon: 'Firestorm',
    chargeSeconds: 200,
    telegraphSeconds: 4,
    radius: 30,
    damage: 150,
    burnDps: 30,
    burnSeconds: 45,
    revealRadius: 60,
    revealSeconds: 60,
    /** Speed multiplier for hostile infantry wading through the fire. */
    infantrySlow: 0.3,
  },
  weathermast: {
    weapon: 'Blizzard',
    telegraphSeconds: 4,
    radius: 28,
    damage: 140,
    freezeSeconds: 6,
    /** The blizzard aims at the richest allied cluster on this grid. */
    clusterCell: 24,
  },
} as const;
/** Most of a command station's health one strike may take, burning included. */
export const SUPERWEAPON_HQ_CAP = 0.7;
/** Every commander hears when a superweapon is this close to ready. */
export const SUPERWEAPON_WARNING_SECONDS = 60;
/**
 * Research projects. Tier 1 projects run at the command station; the research
 * station handles Tier 2 and, after Tier 3 clearance, the Tier 3 branches.
 * Every effect is applied by the rules below; `requires` chains a project
 * behind another one. Prices are deliberately steep: a commander cannot
 * afford the whole tree in one operation and must choose a doctrine.
 */
export const RESEARCH = {
  // Tier 1 · command station
  clearance2: {
    name: 'Tier 2 clearance',
    role: 'Unlocks armor, artillery, the air base and the research station',
    at: 'hq',
    cost: 900,
    seconds: 36,
    tier: 1,
  },
  logistics: {
    name: 'Convoy logistics',
    role: 'Harvesters carry 20% more ore and drive 15% faster',
    at: 'hq',
    cost: 700,
    seconds: 28,
    tier: 1,
  },
  // Tier 2 · research station
  drills: {
    name: 'Hardened drills',
    role: 'Harvesters load ore 50% faster',
    at: 'lab',
    cost: 1000,
    seconds: 32,
    tier: 2,
  },
  turbines: {
    name: 'Turbine upgrade',
    role: '+6 power from every geothermal plant',
    at: 'lab',
    cost: 800,
    seconds: 28,
    tier: 2,
  },
  ammunition: {
    name: 'Armor-piercing rounds',
    role: '+20% infantry damage',
    at: 'lab',
    cost: 1100,
    seconds: 36,
    tier: 2,
  },
  shells: {
    name: 'Tungsten shells',
    role: '+20% vehicle, aircraft and defense damage',
    at: 'lab',
    cost: 1400,
    seconds: 44,
    tier: 2,
  },
  composite: {
    name: 'Composite armor',
    role: 'Vehicles take 20% less damage',
    at: 'lab',
    cost: 1400,
    seconds: 44,
    tier: 2,
  },
  plates: {
    name: 'Ceramic plates',
    role: 'Infantry take 20% less damage',
    at: 'lab',
    cost: 1100,
    seconds: 36,
    tier: 2,
  },
  clearance3: {
    name: 'Tier 3 clearance',
    role: 'Unlocks heavy armor, gunships and Tier 3 research',
    at: 'lab',
    cost: 2400,
    seconds: 72,
    tier: 2,
    requires: 'clearance2',
  },
  // Tier 3 · research station, after Tier 3 clearance
  uranium: {
    name: 'Depleted uranium sabots',
    role: 'Stridsvagn and Jotun deal 25% more damage to vehicles and structures',
    at: 'lab',
    cost: 2200,
    seconds: 56,
    tier: 3,
    requires: 'shells',
  },
  avionics: {
    name: 'Advanced avionics',
    role: 'Aircraft take 20% less damage and fly 15% faster',
    at: 'lab',
    cost: 2000,
    seconds: 52,
    tier: 3,
  },
  ballistics: {
    name: 'Ballistic computers',
    role: 'Howitzers, siege mortars and coastal batteries reach 15% farther',
    at: 'lab',
    cost: 1800,
    seconds: 48,
    tier: 3,
  },
} as const satisfies Record<
  string,
  {
    name: string;
    role: string;
    at: 'hq' | 'lab';
    cost: number;
    seconds: number;
    tier: 1 | 2 | 3;
    requires?: string;
  }
>;
/** Research tiers in display order; the tech tree dialog and manuals group projects by these. */
export const RESEARCH_TIERS: Record<1 | 2 | 3, ResearchKey[]> = {
  1: ['clearance2', 'logistics'],
  2: [
    'drills',
    'turbines',
    'ammunition',
    'plates',
    'shells',
    'composite',
    'clearance3',
  ],
  3: ['uranium', 'avionics', 'ballistics'],
};
export type UnitKind = keyof typeof TACTICAL_UNITS;
export type BuildingKind = keyof typeof TACTICAL_BUILDINGS;
/** Widened views for rules that read optional fields such as minRange, provides or attack. */
const UNITS: Record<UnitKind, UnitSpec> = TACTICAL_UNITS;
const BUILDINGS: Record<BuildingKind, BuildingSpec> = TACTICAL_BUILDINGS;
export type EntityKind = UnitKind | BuildingKind;
export type ResearchKey = keyof typeof RESEARCH;
export type OrderKind =
  | 'move'
  | 'attackMove'
  | 'attack'
  | 'hold'
  | 'stop'
  | 'harvest';
export type Entity = Point & {
  id: string;
  kind: EntityKind;
  owner: string;
  team: 'blue' | 'red';
  hp: number;
  angle: number;
  path: Point[];
  order: OrderKind;
  orderAt?: number;
  target?: string;
  readyAt: number;
  firedAt: number;
  shotX: number;
  shotZ: number;
  /** Current ground speed, m/s; absent when standing still. */
  v?: number;
  /** Group pace, m/s: a formation moves at its slowest member's speed. */
  pace?: number;
  /** Ore carried by a harvester. */
  cargo?: number;
  /** Where a production structure sends new units. */
  rally?: Point;
  /** Winter Convoy: faster and quicker to fire until then. */
  boostUntil?: number;
  /** Blizzard: frozen in place until then. */
  frozenUntil?: number;
  /** Landed by a Skerry Strike: hits harder and shrugs off more. */
  veteran?: boolean;
};
export type Commander = {
  id: string;
  name: string;
  culture: string;
  slot: number;
  credits: number;
  /** Completed research keys. Optional for sectors created before research existed. */
  research?: string[];
  researching?: { key: string; readyAt: number };
  /** Prepaid projects waiting behind the active research, in order. Plain strings so a queue saved before a release retired a project still loads; unknown keys are dropped. */
  researchQueue?: string[];
  /** Lifetime ore delivered, used for income rates. */
  harvested?: number;
  /** Personal defeat is permanent, even if surviving allies later win. */
  eliminatedAt?: number;
  /** Ironclad only: hex bitset of ground ever scouted, for the Mountain Gun. */
  scouted?: string;
};
export type TacticalEvent = {
  at: number;
  text: string;
  kind: 'info' | 'combat' | 'success';
};
export type Capture = Point & { name: string; progress: number };
export type Deposit = Point & {
  id: string;
  name: string;
  amount: number;
  capacity: number;
};
/** One unit in progress at one production building. */
export type TrainingLine = {
  /** Building id; empty while the unit waits for a replacement building. */
  producer: string;
  readyAt: number;
};
export type TrainingOrder = {
  id: string;
  owner: string;
  kind: UnitKind;
  remaining: number;
  total: number;
  /** Soonest unit in progress; 0 while the batch waits for a free production building. */
  readyAt: number;
  /** Every completed production building trains its own unit; optional for older sectors. */
  lines?: TrainingLine[];
};
export type Battle = {
  /** Query-only capacity signal: fog-filtered clients cannot count hidden entities. */
  battlefieldFull?: boolean;
  entities: Entity[];
  /** Optional for sectors created before separate troop production. */
  training?: TrainingOrder[];
  /** Hostile production lines, kept apart from allied queues and never sent to clients. */
  hostileTraining?: TrainingOrder[];
  commanders: Commander[];
  /** Retired capture points; always empty on current operations. */
  objectives: Capture[];
  /** One flag per army, hostile and allied. Capturing an army's flag collapses it. */
  flags?: Flag[];
  /** Neutral tech sites on contested ground; optional for sectors stored before them. */
  sites?: TechSite[];
  /** Recon planes in the air from captured airstrips. */
  recon?: ReconFlight[];
  /** Optional for sectors created before ore harvesting. */
  deposits?: Deposit[];
  /** Superweapon charges and launched strikes; outside the fog, so every commander sees them. */
  superweapons?: SuperweaponCharge[];
  strikes?: Strike[];
  events: TacticalEvent[];
  status: 'active' | 'victory' | 'defeat';
  tickAt: number;
  startedAt: number;
  nextWaveAt: number;
  wave: number;
  serial: number;
  mapVersion?: number;
  /** Retired procedural ids remain on old rows; those sectors are closed on their next update. */
  mapId?: StoredMapId;
  /** Persisted once per operation; omitted only on legacy sectors. */
  seed?: number;
  difficulty?: Difficulty;
  enemyCount?: number;
  /** Immutable geography for this operation; missing on existing fixed-size saves. */
  mapScale?: number;
  playerSlots?: number;
  /** Match enrollment metadata; legacy shared sectors can still accept late joiners. */
  mode?: 'solo' | 'coop';
  openEnrollment?: boolean;
  /** Skirmish mission (lib/skirmish-modes.ts); omitted for standard rules and older saves. */
  skirmish?: SkirmishMode;
  /** Each hostile army's credits, under a mode that funds the garrison; never sent to clients. */
  garrisonFunds?: Record<string, number>;
};
export const unitKinds = Object.keys(TACTICAL_UNITS) as UnitKind[];
export const buildingKinds = Object.keys(TACTICAL_BUILDINGS) as BuildingKind[];
export const researchKeys = Object.keys(RESEARCH) as ResearchKey[];
export const UNIT_CATEGORIES: UnitCategory[] = ['infantry', 'vehicle', 'air'];
export const isUnit = (kind: EntityKind): kind is UnitKind =>
  kind in TACTICAL_UNITS;
export const isAir = (kind: EntityKind) =>
  isUnit(kind) && TACTICAL_UNITS[kind].category === 'air';
export const isHarvester = (kind: EntityKind) => kind === 'harvester';
/** The faction that owns a signature blueprint, or undefined for shared equipment. */
export const factionOf = (kind: EntityKind): Culture | undefined =>
  (spec(kind) as { faction?: Culture }).faction;
/** A faction's own structure and the troops it trains there. */
export function signatureOf(culture: Culture) {
  return {
    structure: buildingKinds.find(
      (k) => factionOf(k) === culture && !isSuperweapon(k),
    )!,
    troops: unitKinds.filter((k) => factionOf(k) === culture),
    superweapon: buildingKinds.find(
      (k) => factionOf(k) === culture && isSuperweapon(k),
    )!,
  };
}
/** Every blueprint a commander of this culture may ever build: shared kit plus their signature kit. */
export const rosterOf = (culture: string | undefined) =>
  ([...buildingKinds, ...unitKinds] as EntityKind[]).filter(
    (k) => k !== 'weathermast' && (!factionOf(k) || factionOf(k) === culture),
  );
export const cultureOf = (b: Battle, owner: string) =>
  b.commanders.find((c) => c.id === owner)?.culture;
export const inRoster = (b: Battle, owner: string, kind: EntityKind) =>
  kind !== 'weathermast' &&
  !skirmishRules(b).locked.includes(kind) &&
  (!factionOf(kind) || factionOf(kind) === cultureOf(b, owner));
/** Research the battle's skirmish mode offers at all. */
export const inResearchRoster = (b: Battle, key: ResearchKey) =>
  !skirmishRules(b).lockedResearch.includes(key);
/** The structure a blueprint needs first, under the battle's skirmish mode. */
export const requirementOf = (b: Battle, kind: BuildingKind) =>
  (skirmishRules(b).requires[kind] ?? BUILDINGS[kind].requires) as
    | BuildingKind
    | undefined;
/** Living foundations count, including construction sites. Troops do not keep a base alive. */
export const hasLivingBuildings = (b: Battle, owner?: string) =>
  b.entities.some(
    (e) =>
      e.team === 'blue' &&
      e.hp > 0 &&
      !isUnit(e.kind) &&
      (owner === undefined || e.owner === owner),
  );
/** Any living structure or troop of this owner, including construction sites. */
export const hasLivingForces = (b: Pick<Battle, 'entities'>, owner: string) =>
  b.entities.some((e) => e.owner === owner && e.hp > 0);
/** The flag an army plants in front of its command station. */
export const flagOf = (b: Pick<Battle, 'flags'>, owner: string) =>
  b.flags?.find((f) => f.owner === owner);
/**
 * Why a commander is out, if they are: their flag was captured, or nothing of
 * theirs is left to defend it. Operations without flags keep the old rule: the
 * last building lost.
 */
function eliminationCause(b: Battle, owner: string) {
  const flag = flagOf(b, owner);
  if (!flag)
    return hasLivingBuildings(b, owner) ? undefined : 'all buildings lost';
  if (flag.capturedAt !== undefined) return 'flag captured';
  return hasLivingForces(b, owner) ? undefined : 'all forces lost';
}
export function commanderEliminated(b: Battle, owner: string) {
  const c = b.commanders.find((c) => c.id === owner);
  return !!c && (c.eliminatedAt !== undefined || !!eliminationCause(b, owner));
}
/** Every commander is out: the operation is lost (true for an empty roster). */
export const alliesDefeated = (b: Battle) =>
  b.commanders.every((c) => commanderEliminated(b, c.id));
function eliminateCommanders(b: Battle, now: number) {
  for (const c of b.commanders) {
    const cause = c.eliminatedAt === undefined && eliminationCause(b, c.id);
    if (!cause) continue;
    c.eliminatedAt = now;
    delete c.researching;
    c.researchQueue = [];
    b.training = b.training?.filter((q) => q.owner !== c.id);
    for (const e of b.entities.filter((e) => e.owner === c.id)) {
      e.path = [];
      e.order = 'hold';
      delete e.target;
    }
    logEvent(b, now, `${c.name} eliminated: ${cause}.`, 'combat');
  }
}

export const categoryOf = (kind: UnitKind) => TACTICAL_UNITS[kind].category;
export const armorOf = (kind: EntityKind): ArmorClass =>
  isUnit(kind) ? TACTICAL_UNITS[kind].armor : 'structure';
export const spec = (kind: EntityKind) =>
  isUnit(kind) ? TACTICAL_UNITS[kind] : TACTICAL_BUILDINGS[kind];
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.z - b.z);
/**
 * Ore grows richer, and more dangerous, the farther it lies from the southern landing zones.
 * A harvester cycle (load, drive, unload) moves about 500 credits per half minute, so a
 * home seam feeds two harvesters for roughly eight minutes, a shore field three for a
 * quarter hour, and the northern seams carry the late game.
 */
export const SEAM_CREDITS = {
  home: 16000,
  shore: 45000,
  northern: 60000,
  garrison: 50000,
};
/** Fixed deposits only for migrating pre-seed sectors; new operations use generateWorld. */
export function sectorDeposits(): Deposit[] {
  const list: Deposit[] = [];
  let n = 0;
  const add = (name: string, x: number, z: number, amount: number) =>
    list.push({ id: `d${++n}`, name, x, z, amount, capacity: amount });
  for (let slot = 0; slot < 8; slot++) {
    const base = baseAt(slot);
    add(
      `Landing zone ${slot + 1} ore`,
      base.x - 20,
      base.z - 16,
      SEAM_CREDITS.home,
    );
  }
  for (const x of [-125, -65, 0, 65, 125])
    add('Shore field', x, 14, SEAM_CREDITS.shore);
  for (const x of [-115, -45, 45, 115])
    add('Northern seam', x, -58, SEAM_CREDITS.northern);
  add('Garrison seam', 75, -82, SEAM_CREDITS.garrison);
  return list;
}
/** Faction rules for a commander; the garrison and legacy commanders play by the neutral set. */
export const doctrineFor = (b: Battle, owner: string): Doctrine =>
  doctrineOf(b.commanders.find((c) => c.id === owner)?.culture);
export const visionOf = (kind: EntityKind, scale = 1) =>
  ((spec(kind) as { vision?: number }).vision ?? (isUnit(kind) ? 32 : 30)) *
  scale;
const spots = (eye: Entity, entity: Point, scale = 1) =>
  eye.team === 'blue' &&
  eye.hp > 0 &&
  eye.readyAt === 0 &&
  distance(eye, entity) < visionOf(eye.kind, scale);
/** Whether any coalition member can see the entity; the AI garrison reacts to this. */
export function visibleToBlue(entity: Entity, entities: Entity[], b?: Battle) {
  return (
    entity.team === 'blue' ||
    (!!b && revealed(b, entity)) ||
    reconSpots(b, entity) ||
    entities.some((e) => spots(e, entity, b ? visionScaleFor(b, e.owner) : 1))
  );
}
/**
 * What one commander is told about tech sites and recon flights: every site's
 * holder and capture state (sites are landmarks), never the garrison's
 * detachment orders; coalition planes, and hostile ones their troops can see.
 */
export function sitesFor(b: Battle, owner: string) {
  const scale = visionScaleFor(b, owner);
  return {
    sites: (b.sites ?? []).map(({ squad: _squad, ...site }) => site),
    recon: (b.recon ?? []).filter((f) => {
      if (f.team === 'blue') return true;
      const at = reconPosition(f, b.tickAt);
      return b.entities.some((e) => e.owner === owner && spots(e, at, scale));
    }),
  };
}
/** A coalition recon plane overhead, or a coalition-held tech site, sees the entity. */
const reconSpots = (
  b: Pick<Battle, 'recon' | 'sites' | 'tickAt'> | undefined,
  p: Point,
) =>
  !!b?.recon?.some((f) => f.team === 'blue' && reconSees(f, b.tickAt, p)) ||
  !!b?.sites?.some((s) => siteSees(s, 'blue', p));
/** Whether one commander's own troops and structures can see the entity. Allies are always shown. */
export function visibleTo(
  owner: string,
  entity: Entity,
  entities: Entity[],
  b?: Battle,
) {
  const scale = b ? visionScaleFor(b, owner) : 1;
  return (
    entity.team === 'blue' ||
    // An enemy running off with an allied flag is always on the map.
    !!b?.flags?.some((f) => f.team === 'blue' && carrierOf(f) === entity.id) ||
    // A Firestorm lights its ground up for the whole coalition.
    (!!b && revealed(b, entity)) ||
    reconSpots(b, entity) ||
    entities.some((e) => e.owner === owner && spots(e, entity, scale))
  );
}
const key = (p: Point) => `${p.x},${p.z}`;
const neighbors = [
  { x: 2, z: 0 },
  { x: -2, z: 0 },
  { x: 0, z: 2 },
  { x: 0, z: -2 },
  { x: 2, z: 2 },
  { x: 2, z: -2 },
  { x: -2, z: 2 },
  { x: -2, z: -2 },
];
class Frontier {
  private heap: { k: string; p: Point; f: number }[] = [];
  get size() {
    return this.heap.length;
  }
  push(k: string, p: Point, f: number) {
    const h = this.heap;
    h.push({ k, p, f });
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (h[parent].f <= h[i].f) break;
      [h[parent], h[i]] = [h[i], h[parent]];
      i = parent;
    }
  }
  pop() {
    const h = this.heap,
      top = h[0],
      last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1,
          r = l + 1;
        let m = i;
        if (l < h.length && h[l].f < h[m].f) m = l;
        if (r < h.length && h[r].f < h[m].f) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }
}
/**
 * A* across bridges, fords and ramps; no corner cutting into water or cliffs.
 * Marsh and fords cost extra so routes skirt them unless the detour is longer.
 */
export function findPath(
  from: Point,
  to: Point,
  air = false,
  obstacles: Footprint[] = [],
  terrain: TerrainMap = defaultTerrain,
): Point[] {
  beginRouteRequest();
  if (!insideSector(to, terrain.bounds)) return [];
  if (air) return [{ x: to.x, z: to.z }];
  // Older operations can contain units inside a legacy fixed pad; let them exit.
  const blockers = obstacles.some((box) => insideFootprint(from, box, 1))
    ? obstacles.filter((box) => !insideFootprint(from, box, 1))
    : obstacles;
  // Clear, full-speed ground needs no grid detour, including between-cell redirects.
  const direct = groundSegmentCost(from, to, blockers, terrain);
  if (Number.isFinite(direct) && direct <= distance(from, to) + 0.001)
    return [{ x: to.x, z: to.z }];
  const routes = sharedCorridors(blockers, terrain);
  for (const route of routes) {
    if (distance(from, route.from) > 24 || distance(to, route.to) > 24)
      continue;
    if (distance(from, route.from) < 0.001 && distance(to, route.to) < 0.001)
      return route.path.map((p) => ({ x: p.x, z: p.z }));
    if (
      !Number.isFinite(
        groundSegmentCost(from, route.from, blockers, terrain),
      ) ||
      !Number.isFinite(groundSegmentCost(route.to, to, blockers, terrain))
    )
      continue;
    return [route.from, ...route.path, { x: to.x, z: to.z }]
      .filter((p, i, points) => distance(i ? points[i - 1] : from, p) > 0.001)
      .map((p) => ({ x: p.x, z: p.z }));
  }
  if (!takeRouteSearch()) return [];
  const { speedAt, passable, clearEdge } = groundNavigation(blockers, terrain);
  const step = terrain.navigationStep;
  const cell = (v: number) => Math.round(v / step) * step;
  const directions = neighbors.map((p) => ({
    x: (p.x * step) / 2,
    z: (p.z * step) / 2,
  }));
  if (!passable(to.x, to.z)) return [];
  // A unit can be between grid cells when a new order arrives near a wall.
  const anchor = (p: Point) =>
    [{ x: 0, z: 0 }, ...directions]
      .map((d) => ({ x: cell(p.x) + d.x, z: cell(p.z) + d.z }))
      .filter(
        (q) =>
          passable(q.x, q.z) &&
          !blockers.some((box) => segmentIntersectsFootprint(p, q, box)) &&
          [0.25, 0.5, 0.75].every(
            (t) => speedAt(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t) > 0,
          ),
      )
      .sort((a, b) => distance(a, p) - distance(b, p))[0];
  const start = anchor(from),
    end = anchor(to);
  if (!start || !end) return [];
  const endKey = key(end);
  const open = new Frontier(),
    costs = new Map([[key(start), 0]]),
    closed = new Set<string>(),
    came = new Map<string, Point>();
  open.push(key(start), start, distance(start, end));
  let iterations = 0;
  while (open.size && iterations++ < 30000) {
    const { k, p: current } = open.pop();
    if (closed.has(k)) continue;
    closed.add(k);
    if (k === endKey) {
      const path = [end];
      let c = current;
      while (came.has(key(c))) {
        c = came.get(key(c))!;
        path.unshift(c);
      }
      if (distance(from, start) < 0.001) path.shift();
      // Targets can be full entities; stored waypoints contain coordinates only.
      path.push({ x: to.x, z: to.z });
      // Keep turning points only; subscriptions need not transmit every A* cell.
      const turns = path.filter((p, i) => {
        if (i === 0 || i === path.length - 1) return true;
        const a = path[i - 1],
          c = path[i + 1];
        return (
          Math.abs((p.x - a.x) * (c.z - p.z) - (p.z - a.z) * (c.x - p.x)) >
          0.001
        );
      });
      const result = simplifyGroundPath(from, turns, blockers, terrain);
      if (routes.length >= 128) routes.shift();
      routes.push({
        from: { x: from.x, z: from.z },
        to: { x: to.x, z: to.z },
        path: result,
      });
      return result.map((p) => ({ x: p.x, z: p.z }));
    }
    const base = costs.get(k)!;
    for (const d of directions) {
      const p = { x: current.x + d.x, z: current.z + d.z },
        pk = key(p);
      if (closed.has(pk)) continue;
      if (
        !passable(p.x, p.z) ||
        !passable(current.x + d.x, current.z) ||
        !passable(current.x, current.z + d.z) ||
        !clearEdge(current, p)
      )
        continue;
      const next = base + Math.hypot(d.x, d.z) / speedAt(p.x, p.z);
      if (next < (costs.get(pk) ?? Infinity)) {
        costs.set(pk, next);
        came.set(pk, current);
        open.push(pk, p, next + distance(p, end));
      }
    }
  }
  return [];
}
export function makeEntity(
  b: Battle,
  kind: EntityKind,
  owner: string,
  team: Entity['team'],
  p: Point,
  readyAt = 0,
): Entity {
  const e: Entity = {
    id: `u${++b.serial}`,
    kind,
    owner,
    team,
    x: p.x,
    z: p.z,
    hp: spec(kind).hp,
    angle: team === 'blue' ? Math.PI : 0,
    path: [],
    order: isUnit(kind) ? (kind === 'harvester' ? 'harvest' : 'stop') : 'hold',
    readyAt,
    firedAt: 0,
    shotX: p.x,
    shotZ: p.z,
  };
  if (kind === 'harvester') e.cargo = 0;
  return e;
}
/** Public force counts without exposing positions through fog of war. */
export function enemyForces(b: Pick<Battle, 'entities'>) {
  const enemies = b.entities.filter((e) => e.team === 'red' && e.hp > 0);
  return {
    armies: new Set(enemies.map((e) => e.owner)).size,
    buildings: enemies.filter((e) => !isUnit(e.kind)).length,
    units: enemies.filter((e) => isUnit(e.kind)).length,
    headquarters: enemies.filter((e) => e.kind === 'hq').length,
  };
}
export function newBattle(
  now: number,
  options: {
    seed?: number;
    difficulty?: Difficulty;
    mapId?: MapId;
    enemyCount?: number;
    playerSlots?: number;
    skirmish?: SkirmishMode;
  } = {},
): Battle {
  const seed = (options.seed ?? now) >>> 0;
  const mapVersion = MAP_VERSION;
  const mapId = options.mapId ?? DEFAULT_MAP_ID;
  if (!isMapId(mapId))
    throw new Error(`Unknown battlefield: ${String(mapId)}.`);
  const { name, capacity } = MAPS[mapId];
  const difficulty = options.difficulty ?? 'normal';
  const enemyCount = options.enemyCount ?? 1;
  if (
    !Number.isInteger(enemyCount) ||
    enemyCount < 1 ||
    enemyCount > capacity.enemies
  )
    throw new Error(`${name} holds between 1 and ${capacity.enemies} enemies.`);
  const playerSlots = options.playerSlots ?? 1;
  if (
    !Number.isInteger(playerSlots) ||
    playerSlots < 1 ||
    playerSlots > capacity.players
  )
    throw new Error(`${name} holds between 1 and ${capacity.players} players.`);
  // Hand-built maps are drawn in metres and never rescale.
  const mapScale = 1;
  const skirmish = options.skirmish ?? DEFAULT_SKIRMISH_MODE;
  const world = generateWorld(
    seed,
    difficulty,
    terrainFor({ mapId }),
    enemyCount,
    skirmish,
  );
  const b: Battle = {
    entities: [],
    training: [],
    commanders: [],
    objectives: world.objectives,
    flags: world.flags.map((f, i) => ({
      id: `f${i + 1}`,
      owner: f.owner,
      team: 'red' as const,
      name: f.name,
      x: f.x,
      z: f.z,
      radius: FLAG_RADIUS,
      progress: 0,
      state: 'home' as const,
      homeX: f.x,
      homeZ: f.z,
    })),
    deposits: world.deposits,
    sites: createSites(world.sites),
    recon: [],
    events: [],
    status: 'active',
    tickAt: now,
    startedAt: now,
    nextWaveAt: now + DIFFICULTIES[difficulty].firstWaveMs,
    wave: 0,
    serial: 0,
    mapVersion,
    mapId,
    seed,
    difficulty,
    enemyCount,
    mapScale,
    playerSlots,
  };
  if (skirmish !== DEFAULT_SKIRMISH_MODE) b.skirmish = skirmish;
  for (const { kind, angle, owner, ...position } of world.placements) {
    const e = makeEntity(b, kind, owner, 'red', position);
    e.angle = angle;
    b.entities.push(e);
  }
  const { garrison, homeDerricks } = skirmishRules(b);
  if (garrison)
    b.garrisonFunds = Object.fromEntries(
      hostileArmies(b).map((owner) => [owner, garrison.credits]),
    );
  // Each army starts on its own derrick, when the mode hands them out.
  for (const site of b.sites ?? [])
    if (homeDerricks && site.home?.startsWith('hostile-'))
      holdHomeSite(b, site, 'red', site.home, now);
  raiseWeatherMasts(b);
  return b;
}
/** A side's own derrick, held from the start without a capture line in the log. */
function holdHomeSite(
  b: Battle,
  site: TechSite,
  team: SiteTeam,
  holder: string,
  now: number,
) {
  site.team = team;
  site.holder = holder;
  site.heldAt = now;
  site.progress = 0;
  site.pulseAt = now + TECH_SITES.derrick.pulseSeconds * 1000;
}
/** Starting credits for a commander: the difficulty's, scaled by the skirmish mode. */
export const startingCredits = (b: Pick<Battle, 'difficulty' | 'skirmish'>) =>
  Math.round((difficultyFor(b).credits * skirmishRules(b).creditScale) / 50) *
  50;
/** What a derrick pays per pulse under the battle's skirmish mode. */
export const derrickIncome = (b: Pick<Battle, 'skirmish'>) =>
  skirmishRules(b).derrickIncome;
/** A site's bonus for the log and its description for the HUD, with the mode's derrick pay. */
export function siteBonusText(
  b: Pick<Battle, 'skirmish'>,
  site: Pick<TechSite, 'kind'>,
) {
  const spec = TECH_SITES[site.kind];
  if (site.kind !== 'derrick' || derrickIncome(b) === TECH_SITES.derrick.income)
    return { bonus: spec.bonus, description: spec.description };
  const { pulseSeconds } = TECH_SITES.derrick,
    income = derrickIncome(b);
  return {
    bonus: `+${income} credits every ${pulseSeconds} s`,
    description: `Pays its holder ${income} credits every ${pulseSeconds} seconds.`,
  };
}
export function logEvent(
  b: Battle,
  at: number,
  text: string,
  kind: TacticalEvent['kind'] = 'info',
) {
  b.events = [{ at, text, kind }, ...b.events].slice(0, 16);
}
/** What a commander pays for a blueprint under their doctrine. */
export function priceOf(b: Battle, owner: string, kind: EntityKind) {
  const d = doctrineFor(b, owner),
    base = spec(kind).cost;
  const scale = !isUnit(kind)
    ? d.structureCost
    : categoryOf(kind) === 'infantry'
      ? d.infantryCost
      : 1;
  return Math.round((base * scale) / 5) * 5;
}
/** How long a commander's troop or structure takes under their doctrine and research. */
/** A commander's first foundations rise quickly: until three structures stand, construction is this much shorter. */
export const EARLY_BUILD_SCALE = 0.6;
export const EARLY_BUILD_COUNT = 3;
export function buildSeconds(b: Battle, owner: string, kind: EntityKind) {
  const seconds = spec(kind).seconds;
  if (!isUnit(kind)) {
    let standing = 0;
    for (const e of b.entities)
      if (
        e.owner === owner &&
        e.hp > 0 &&
        !e.readyAt &&
        !isUnit(e.kind) &&
        e.kind !== 'hq'
      )
        standing++;
    return standing < EARLY_BUILD_COUNT
      ? Math.max(1, Math.round(seconds * EARLY_BUILD_SCALE))
      : seconds;
  }
  return Math.max(1, Math.round(seconds * doctrineFor(b, owner).training));
}
/** Ore a commander's harvesters carry per trip. */
export const harvesterCapacity = (b: Battle, owner: string) => {
  const c = commanderOf(b, owner);
  return Math.round(
    UNITS.harvester.cargo! *
      doctrineOf(c?.culture).cargo *
      (hasResearch(c, 'logistics') ? 1.2 : 1),
  );
};
export function joinBattle(
  b: Battle,
  commander: Omit<Commander, 'slot' | 'credits'>,
  now: number,
) {
  if (b.commanders.some((c) => c.id === commander.id)) return;
  const landings = terrainFor(b).design.landings.length;
  if (b.commanders.length >= landings)
    throw new Error(
      'Every landing zone on this battlefield is taken. Join the next operation when it ends.',
    );
  if (b.entities.filter((e) => e.hp > 0).length + 4 > BATTLE_ENTITY_LIMIT)
    throw new Error('Battlefield full. Join a new operation.');
  // Landings fill in the map's order, so a solo commander takes the best one.
  const slot = Array.from({ length: landings }, (_, i) => i).find(
      (i) => !b.commanders.some((c) => c.slot === i),
    )!,
    c: Commander = {
      ...commander,
      slot,
      credits: startingCredits(b),
      research: [],
      harvested: 0,
    };
  b.commanders.push(c);
  const terrain = terrainFor(b);
  const base = terrain.baseAt(slot);
  b.entities.push(makeEntity(b, 'hq', c.id, 'blue', base));
  // The commander's flag stands in open ground just ahead of the command station.
  const hqBox = footprint('hq', base, Math.PI);
  const home = terrain.homeOreAt(slot);
  const spot = flagSpot(
    terrain,
    base,
    Math.PI,
    (p) =>
      !insideFootprint(p, hqBox, FLAG_RADIUS + 1) &&
      distance(p, home) >= FLAG_RADIUS + 8,
  ) ?? { x: base.x, z: base.z - FLAG_OFFSET };
  (b.flags ??= []).push({
    id: `f-${c.id}`,
    owner: c.id,
    team: 'blue',
    name: c.name,
    ...spot,
    radius: FLAG_RADIUS,
    progress: 0,
    state: 'home',
    homeX: spot.x,
    homeZ: spot.z,
  });
  // The starting patrol musters in front of the command station, clear of its foundation.
  const station = footprint('hq', base, Math.PI);
  const muster = station.minZ - 5;
  b.entities.push(
    makeEntity(b, 'ranger', c.id, 'blue', { x: base.x - 3, z: muster }),
  );
  b.entities.push(
    makeEntity(b, 'ranger', c.id, 'blue', { x: base.x + 1, z: muster }),
  );
  b.entities.push(
    makeEntity(b, 'lynx', c.id, 'blue', { x: base.x + 6, z: muster - 1 }),
  );
  if (skirmishRules(b).homeDerricks)
    for (const site of b.sites ?? [])
      if (site.home === `landing-${slot}` && !site.team)
        holdHomeSite(b, site, 'blue', c.id, now);
  logEvent(b, now, `${c.name} deployed to the southern shore.`);
}
export const hasResearch = (c: Commander | undefined, k: ResearchKey) =>
  !!c?.research?.includes(k);
const commanderOf = (b: Pick<Battle, 'commanders'>, owner: string) =>
  b.commanders.find((c) => c.id === owner);
/**
 * Speed multiplier for one troop: doctrine, then the research that applies to
 * its category, then the flag it may be carrying. Client prediction passes the
 * same snapshot, so a slowed carrier renders where the server puts it.
 */
export function speedScaleFor(
  b: Pick<Battle, 'commanders'> & {
    flags?: Flag[];
    strikes?: Strike[];
    tickAt?: number;
  },
  e: Pick<Entity, 'kind' | 'owner'> &
    Partial<Pick<Entity, 'id' | 'team' | 'x' | 'z' | 'boostUntil'>>,
) {
  const c = commanderOf(b, e.owner);
  let scale = doctrineOf(c?.culture).speed;
  if (!isUnit(e.kind)) return scale;
  scale *= strikeSpeed(b, e);
  if (e.id !== undefined && b.flags?.some((f) => carrierOf(f) === e.id))
    scale *= CARRIER_SPEED;
  if (isHarvester(e.kind)) {
    if (hasResearch(c, 'logistics')) scale *= 1.15;
  } else if (isAir(e.kind)) {
    if (hasResearch(c, 'avionics')) scale *= 1.15;
  }
  return scale;
}
/** Sight multiplier for everything a commander fields; radar masts add sight as structures. */
export function visionScaleFor(b: Pick<Battle, 'commanders'>, owner: string) {
  return doctrineOf(commanderOf(b, owner)?.culture).vision;
}
const ARTILLERY: readonly EntityKind[] = ['howitzer', 'mortar', 'battery'];
/** Weapon range multiplier: ballistic computers reach farther with every artillery piece. */
export function rangeScaleFor(
  b: Pick<Battle, 'commanders'>,
  e: Pick<Entity, 'kind' | 'owner'>,
) {
  return ARTILLERY.includes(e.kind) &&
    hasResearch(commanderOf(b, e.owner), 'ballistics')
    ? 1.15
    : 1;
}
/**
 * Fraction of full health an idle troop recovers per second: infantry beside a
 * completed allied aid station, vehicles and aircraft beside a field workshop.
 */
export function regenRateFor(
  b: Pick<Battle, 'entities'>,
  e: Pick<Entity, 'kind' | 'team' | 'x' | 'z'>,
) {
  if (e.team !== 'blue' || !isUnit(e.kind)) return 0;
  const infantry = categoryOf(e.kind) === 'infantry';
  const near = b.entities.some(
    (s) =>
      s.team === 'blue' &&
      s.kind === (infantry ? 'hospital' : 'workshop') &&
      s.hp > 0 &&
      !s.readyAt &&
      distance(s, e) <= AURA_RADIUS,
  );
  return near ? (infantry ? 0.03 : 0.02) : 0;
}
export function tierOf(b: Battle, owner: string): 1 | 2 | 3 {
  const c = b.commanders.find((c) => c.id === owner);
  return hasResearch(c, 'clearance3')
    ? 3
    : hasResearch(c, 'clearance2')
      ? 2
      : 1;
}
export function powerFor(b: Battle, owner: string) {
  const c = b.commanders.find((c) => c.id === owner),
    turbines = hasResearch(c, 'turbines') ? 6 : 0;
  let capacity = 0,
    used = 0;
  for (const e of b.entities) {
    if (e.owner !== owner || e.hp <= 0) continue;
    if (!isUnit(e.kind)) {
      if (e.readyAt === 0)
        capacity +=
          (BUILDINGS[e.kind].provides ?? 0) +
          (e.kind === 'reactor' ? turbines : 0);
      used += TACTICAL_BUILDINGS[e.kind].power;
    } else if (!e.readyAt) used += TACTICAL_UNITS[e.kind].power;
  }
  return { capacity, used };
}
/** Lock message that says where the missing clearance is researched. */
const clearanceLock = (needed: 1 | 2 | 3, have: 1 | 2 | 3) =>
  `Requires Tier ${needed} clearance · ${
    have === 1
      ? 'select your command station and research Tier 2 (also in the Research tab)'
      : 'build a research station and research Tier 3 (also in the Research tab)'
  }`;
const completed = (b: Battle, owner: string, kind: BuildingKind) =>
  b.entities.some(
    (e) => e.owner === owner && e.kind === kind && e.hp > 0 && !e.readyAt,
  );
/** Why a blueprint is locked for this commander, or null when the tech tree allows it. */
export function availability(
  b: Battle,
  owner: string,
  kind: EntityKind,
): string | null {
  const tier = tierOf(b, owner);
  const faction = factionOf(kind);
  if (faction && faction !== cultureOf(b, owner))
    return `${CULTURES[faction].name} signature equipment`;
  const superweapon = superweaponLock(b, owner, kind);
  if (superweapon) return superweapon;
  const mode = skirmishRules(b);
  if (mode.locked.includes(kind)) return skirmishLock(b);
  if (isUnit(kind)) {
    const s = TACTICAL_UNITS[kind];
    if (!completed(b, owner, s.producer))
      return `Requires ${TACTICAL_BUILDINGS[s.producer].name}`;
    if (s.tier > tier) return clearanceLock(s.tier, tier);
    return null;
  }
  const s = BUILDINGS[kind];
  if (kind === 'hq') return 'Each commander has one command station';
  if (!battleHasRoom(b))
    return 'Battlefield full. Wait for space before building';
  if (
    b.entities.filter((e) => e.owner === owner && e.hp > 0 && !isUnit(e.kind))
      .length >= STRUCTURE_LIMIT
  )
    return `Structure limit reached (${STRUCTURE_LIMIT}). Sell a building to make room`;
  if (
    !b.entities.some(
      (e) => e.owner === owner && e.hp > 0 && !e.readyAt && !isUnit(e.kind),
    )
  )
    return 'Requires a completed building';
  const requires = requirementOf(b, kind);
  if (requires && !completed(b, owner, requires))
    return `Requires ${TACTICAL_BUILDINGS[requires].name}`;
  if (s.tier > tier) return clearanceLock(s.tier, tier);
  return null;
}
/** Why a blueprint or project the skirmish mode leaves out cannot be ordered. */
const skirmishLock = (b: Pick<Battle, 'skirmish'>) =>
  `Not in ${skirmishName(b)}: there is no ore to mine`;
/** Queued projects wait for their research building if it needs replacing. */
export function researchBlockReason(
  b: Battle,
  owner: string,
  k: ResearchKey,
): string | null {
  const c = b.commanders.find((c) => c.id === owner),
    r = RESEARCH[k];
  if (!c) return 'Deploy to this sector first';
  if (skirmishRules(b).lockedResearch.includes(k)) return skirmishLock(b);
  if (!completed(b, owner, r.at))
    return `Requires ${TACTICAL_BUILDINGS[r.at].name}`;
  if (k === 'clearance3' && !hasResearch(c, 'clearance2'))
    return 'Requires Tier 2 clearance · select your command station and research it first';
  if (r.tier > tierOf(b, owner)) return clearanceLock(r.tier, tierOf(b, owner));
  const requires = (r as { requires?: ResearchKey }).requires;
  if (requires && !hasResearch(c, requires))
    return `Requires ${RESEARCH[requires].name} · research it first`;
  return null;
}
export function researchAvailability(
  b: Battle,
  owner: string,
  k: ResearchKey,
): string | null {
  const c = b.commanders.find((c) => c.id === owner);
  if (hasResearch(c, k)) return 'Researched';
  if (c?.researching?.key === k) return 'Research in progress';
  if (c?.researchQueue?.includes(k)) return 'Already queued';
  return researchBlockReason(b, owner, k);
}
function startNextResearch(b: Battle, c: Commander, now: number) {
  // Projects retired by a release are dropped from saved queues instead of blocking them.
  while (c.researchQueue?.length && !(c.researchQueue[0] in RESEARCH))
    c.researchQueue.shift();
  const key = c.researchQueue?.[0] as ResearchKey | undefined;
  if (c.researching || !key || researchBlockReason(b, c.id, key)) return;
  c.researchQueue!.shift();
  c.researching = { key, readyAt: now + RESEARCH[key].seconds * 1000 };
}
export function research(
  b: Battle,
  owner: string,
  k: ResearchKey,
  now: number,
) {
  if (b.status !== 'active') throw new Error('This operation has ended.');
  if (!(k in RESEARCH)) throw new Error('Unknown research.');
  const reason = researchAvailability(b, owner, k);
  if (reason) throw new Error(`${reason}.`);
  const c = b.commanders.find((c) => c.id === owner)!,
    r = RESEARCH[k];
  if (c.credits < r.cost) throw new Error('Insufficient sector credits.');
  c.credits -= r.cost;
  (c.researchQueue ??= []).push(k);
  startNextResearch(b, c, now);
}
export function cancelResearch(
  b: Battle,
  owner: string,
  key?: ResearchKey,
  now = b.tickAt,
) {
  if (b.status !== 'active') throw new Error('This operation has ended.');
  const c = b.commanders.find((c) => c.id === owner),
    target = key ?? c?.researching?.key,
    index = c?.researchQueue?.findIndex((k) => k === target) ?? -1;
  if (!c || !target || (c.researching?.key !== target && index < 0))
    throw new Error('Nothing to cancel: research is no longer in your queue.');
  const refund = RESEARCH[target as ResearchKey]?.cost ?? 0;
  if (c.researching?.key === target) delete c.researching;
  else c.researchQueue!.splice(index, 1);
  c.credits += refund;
  startNextResearch(b, c, now);
  return refund;
}
/** The same placement checks drive the ghost preview and authoritative mutation. */
export function placementError(
  b: Battle,
  owner: string,
  kind: PlaceableKind,
  placement: Placement,
): string | null {
  const terrain = terrainFor(b);
  const { buildableAt, groundAt, terrainAt, heightAt } = terrain;

  const p = placement.position,
    rotation = placement.rotation;
  if (
    !Number.isFinite(p.x) ||
    !Number.isFinite(p.z) ||
    !Number.isInteger(rotation) ||
    rotation < 0 ||
    rotation > 3
  )
    return 'Choose a valid position and rotation.';
  const structures = b.entities.filter((e) => !isUnit(e.kind) && e.hp > 0),
    own = structures.filter((e) => e.owner === owner && !e.readyAt);
  if (!own.length) return 'You need a completed building to construct here.';
  const position = snapPlacement(p),
    angle = (rotation * Math.PI) / 2,
    box = footprint(kind, position, angle);
  if (
    !buildAreas(b.entities, owner).some(
      (area) => distance(area, position) <= area.radius,
    )
  ) {
    if (kind !== 'outpost')
      return 'Build near your completed structures, or extend with a Forward outpost.';
    if (
      !b.entities.some(
        (e) =>
          e.owner === owner && spots(e, position, doctrineFor(b, owner).vision),
      )
    )
      return 'Scout this location with your troops before placing a Forward outpost.';
  }
  const foundation = footprintSamples(box);
  // Player foundations can prepare gentle marsh and dry banks as well as ordinary land.
  if (
    foundation.some(
      (p) =>
        !buildableAt(p.x, p.z) &&
        !(
          ['marsh', 'bank'].includes(terrainAt(p.x, p.z)) &&
          heightAt(p.x, p.z) >= 0
        ),
    )
  )
    return 'The entire foundation must be on firm, dry land.';
  const heights = foundation.map((p) => heightAt(p.x, p.z));
  if (Math.max(...heights) - Math.min(...heights) > 1.5)
    return 'This slope is too steep for the foundation.';
  if (
    terrain
      .riverBridges()
      .some((crossing) => footprintsOverlap(box, crossingBounds(crossing)))
  )
    return 'Keep bridge approaches clear.';
  if (
    (b.flags ?? []).some(
      (f) =>
        f.capturedAt === undefined &&
        insideFootprint(flagHome(f), box, f.radius),
    )
  )
    return 'Keep flag zones clear.';
  if (
    (b.sites ?? []).some((site) =>
      footprintsOverlap(box, siteFootprint(site), SITE_CLEARANCE),
    )
  )
    return 'Keep tech sites clear.';

  if (
    (b.deposits ?? []).some(
      (d) => d.amount > 0 && insideFootprint(d, box, ORE_CLEARANCE),
    )
  )
    return 'Keep foundations off the ore field.';
  for (
    let slot = 0;
    (b.openEnrollment ?? !b.mode) && slot < terrain.design.landings.length;
    slot++
  ) {
    if (b.commanders.some((c) => c.slot === slot)) continue;
    const base = terrain.baseAt(slot);
    if (
      footprintsOverlap(
        box,
        {
          minX: base.x - 7,
          maxX: base.x + 9,
          minZ: base.z - 12,
          maxZ: base.z + 5,
        },
        1,
      )
    )
      return 'This landing zone is reserved for another commander.';
  }
  if (
    structures.some((e) =>
      footprintsOverlap(
        box,
        footprint(e.kind as BuildingKind, e, e.angle),
        STRUCTURE_GAP,
      ),
    )
  )
    return `Leave at least ${STRUCTURE_GAP}m between structures.`;
  if (
    structures.some(
      (e) =>
        hasExit(e.kind as BuildingKind) &&
        insideFootprint(productionExit(e), box, 3),
    )
  )
    return 'Keep the production exit clear.';
  if (
    b.entities.some(
      (e) =>
        e.hp > 0 &&
        isUnit(e.kind) &&
        !isAir(e.kind) &&
        insideFootprint(
          e,
          box,
          TACTICAL_UNITS[e.kind].category === 'infantry' ? 1 : 2,
        ),
    )
  )
    return 'Move ground units out of the foundation.';
  if (hasExit(kind)) {
    const exit = productionExit({ ...position, kind, angle });
    const apron = {
      minX: exit.x - 2,
      maxX: exit.x + 2,
      minZ: exit.z - 2,
      maxZ: exit.z + 2,
    };
    if (
      footprintSamples(apron).some((p) => !groundAt(p.x, p.z)) ||
      structures.some((e) =>
        footprintsOverlap(
          apron,
          footprint(e.kind as BuildingKind, e, e.angle),
          1,
        ),
      )
    )
      return kind === 'factory'
        ? 'Rotate or move the factory to leave a clear vehicle exit.'
        : 'Rotate or move the structure to leave a clear exit.';
  }
  return null;
}
/**
 * Foundations troops must walk around. The same array is returned while no
 * structure has appeared, moved or fallen, so the navigation grid, its edge
 * checks and the shared corridors keyed on it survive from one update to the
 * next instead of being rebuilt every 250 ms.
 */
const obstacleCache = new Map<string, Footprint[]>();
export function movementObstacles(
  b: Pick<Battle, 'entities' | 'sites'>,
): Footprint[] {
  // Tech sites never move or fall; they key the cache by where they stand.
  let key = '';
  for (const s of b.sites ?? []) key += `site:${s.x},${s.z},${s.angle};`;
  const buildings: Entity[] = [];
  for (const e of b.entities)
    if (!isUnit(e.kind) && e.hp > 0) {
      buildings.push(e);
      key += `${e.kind}:${e.x},${e.z},${e.angle};`;
    }
  const cached = obstacleCache.get(key);
  if (cached) return cached;
  const obstacles = [
    ...(b.sites ?? []).map(siteFootprint),
    ...buildings.map((e) => footprint(e.kind as BuildingKind, e, e.angle)),
  ];
  if (obstacleCache.size >= 8)
    obstacleCache.delete(obstacleCache.keys().next().value!);
  obstacleCache.set(key, obstacles);
  return obstacles;
}
/** Candidate spawn spots around an exit, nearest first, out to a 12m ring. */
const spawnOffsets: [number, number][] = (() => {
  const list: [number, number][] = [];
  for (let dx = -12; dx <= 12; dx += 3)
    for (let dz = -12; dz <= 12; dz += 3) list.push([dx, dz]);
  return list.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
})();
function spawnNear(b: Battle, exit: Point, air: boolean): Point | null {
  const { groundAt } = terrainFor(b);

  if (air) return insideSector(exit, terrainFor(b).bounds) ? exit : null;
  const obstacles = movementObstacles(b);
  for (const [dx, dz] of spawnOffsets) {
    const p = { x: exit.x + dx, z: exit.z + dz };
    if (
      groundAt(p.x, p.z) &&
      !obstacles.some((o) => insideFootprint(p, o, 1)) &&
      !b.entities.some(
        (e) =>
          e.hp > 0 &&
          !e.readyAt &&
          isUnit(e.kind) &&
          !isAir(e.kind) &&
          distance(e, p) < 2,
      )
    )
      return p;
  }
  return null;
}
function producerFor(b: Battle, owner: string, kind: UnitKind) {
  return b.entities.find(
    (e) =>
      e.owner === owner &&
      e.hp > 0 &&
      e.kind === TACTICAL_UNITS[kind].producer &&
      !e.readyAt,
  );
}
function unitSpawn(
  b: Battle,
  owner: string,
  kind: UnitKind,
  producer = producerFor(b, owner, kind),
) {
  if (!producer) return null;
  const position = spawnNear(b, productionExit(producer), isAir(kind));
  return position ? { producer, position } : null;
}
/** Move already-paid legacy orders out of the battlefield without losing progress. */
export function migrateTraining(b: Battle) {
  b.training ??= [];
  const legacy = b.entities
    .filter((e) => e.team === 'blue' && isUnit(e.kind) && e.readyAt > 0)
    .sort((a, z) => a.readyAt - z.readyAt);
  for (const e of legacy) {
    b.training.push({
      id: e.id,
      owner: e.owner,
      kind: e.kind as UnitKind,
      remaining: 1,
      total: 1,
      readyAt: b.training.some(
        (q) =>
          q.owner === e.owner &&
          categoryOf(q.kind) === categoryOf(e.kind as UnitKind),
      )
        ? 0
        : e.readyAt,
    });
  }
  if (legacy.length) {
    const ids = new Set(legacy.map((e) => e.id));
    b.entities = b.entities.filter((e) => !ids.has(e.id));
  }
}
export function trainingCount(
  b: Battle,
  owner: string,
  category?: UnitCategory,
) {
  return (b.training ?? []).reduce(
    (n, q) =>
      n +
      (q.owner === owner && (!category || categoryOf(q.kind) === category)
        ? q.remaining
        : 0),
    0,
  );
}
export const trainingHead = (
  b: Battle,
  owner: string,
  category: UnitCategory,
) =>
  (b.training ?? []).find(
    (q) => q.owner === owner && categoryOf(q.kind) === category,
  );
export function fieldCount(b: Battle, owner: string) {
  let units = 0,
    harvesters = 0;
  for (const e of b.entities) {
    if (e.owner !== owner || e.hp <= 0 || !isUnit(e.kind) || e.readyAt)
      continue;
    if (isHarvester(e.kind)) harvesters++;
    else units++;
  }
  return { units, harvesters };
}
/** Harvesters in the field plus those still on order; the cap covers both. */
export function harvesterCount(b: Battle, owner: string) {
  const queued = (b.training ?? []).reduce(
    (n, q) => n + (q.owner === owner && isHarvester(q.kind) ? q.remaining : 0),
    0,
  );
  return fieldCount(b, owner).harvesters + queued;
}
/** Why this many harvesters cannot be ordered right now, or null when they fit under the cap. */
export function harvesterOrderReason(
  b: Battle,
  owner: string,
  quantity = 1,
): string | null {
  const limit = harvesterLimit(b, owner),
    room = limit - harvesterCount(b, owner);
  if (room <= 0)
    return `Harvester limit reached (${limit}) — each refinery supports ${HARVESTER_LIMIT}`;
  if (quantity > room)
    return `Only ${room} more harvester${room === 1 ? '' : 's'} allowed — choose a smaller batch`;
  return null;
}
/** Orders can be purchased while deployment is blocked; nothing is lost. */
export function trainingBlockReason(
  b: Battle,
  owner: string,
  kind: UnitKind,
  producer?: Entity,
): string | null {
  const s = TACTICAL_UNITS[kind],
    own = b.entities.filter((e) => e.owner === owner && e.hp > 0 && !e.readyAt);
  if (!own.some((e) => e.kind === 'hq')) return 'Waiting for a command station';
  if (!own.some((e) => e.kind === s.producer))
    return `Waiting for ${TACTICAL_BUILDINGS[s.producer].name}`;
  const count = fieldCount(b, owner);
  if (!battleHasRoom(b))
    return `Waiting for battlefield space (${BATTLE_ENTITY_LIMIT} entities)`;
  if (isHarvester(kind) && count.harvesters >= harvesterLimit(b, owner))
    return `Waiting for harvester space (${harvesterLimit(b, owner)} deployed)`;
  if (!isHarvester(kind) && count.units >= commandLimit(b))
    return `Waiting for army space (${commandLimit(b)} deployed)`;
  const power = powerFor(b, owner);
  if (power.used + s.power > power.capacity) return 'Waiting for grid power';
  if (!unitSpawn(b, owner, kind, producer))
    return 'Move troops away from the production exit';
  return null;
}
/**
 * Hands each idle production building the next unit from the oldest order it can
 * train, so more buildings mean more output. A unit whose building fell keeps its
 * progress and moves to the next idle one.
 */
function staffTraining(b: Battle, owner: string, now: number) {
  const orders = (b.training ?? []).filter((q) => q.owner === owner);
  if (!orders.length) return;
  const standing = b.entities.filter(
    (e) => e.owner === owner && e.hp > 0 && !e.readyAt && isProducer(e.kind),
  );
  const standingIds = new Set(standing.map((e) => e.id));
  const busy = new Set<string>();
  for (const q of orders) {
    // Older sectors ran a single timer per category; keep it as an unassigned unit.
    q.lines ??= q.readyAt ? [{ producer: '', readyAt: q.readyAt }] : [];
    for (const line of q.lines)
      if (standingIds.has(line.producer) && !busy.has(line.producer))
        busy.add(line.producer);
      else line.producer = '';
  }
  const idle = (kind: UnitKind) =>
    standing.find(
      (e) => e.kind === TACTICAL_UNITS[kind].producer && !busy.has(e.id),
    );
  for (const q of orders) {
    const lines = q.lines!;
    for (const line of lines) {
      if (line.producer) continue;
      const producer = idle(q.kind);
      if (!producer) break;
      line.producer = producer.id;
      busy.add(producer.id);
    }
    while (lines.length < q.remaining) {
      const producer = idle(q.kind);
      if (!producer) break;
      lines.push({
        producer: producer.id,
        readyAt: now + buildSeconds(b, owner, q.kind) * 1000,
      });
      busy.add(producer.id);
    }
    q.readyAt = lines.length ? Math.min(...lines.map((l) => l.readyAt)) : 0;
  }
}
/** Fresh troops fan out around the rally point instead of stacking on one spot. */
function rallySlot(
  b: Battle,
  owner: string,
  goal: Point,
  air: boolean,
  obstacles: Footprint[],
): Point {
  const { groundAt } = terrainFor(b);

  const taken = (p: Point) =>
    b.entities.some(
      (e) =>
        e.owner === owner &&
        e.hp > 0 &&
        !e.readyAt &&
        isUnit(e.kind) &&
        isAir(e.kind) === air &&
        distance(e.path.length ? e.path[e.path.length - 1] : e, p) < 2,
    );
  for (const [dx, dz] of spawnOffsets) {
    const p = { x: goal.x + dx, z: goal.z + dz };
    if (
      groundAt(p.x, p.z) &&
      (air || !obstacles.some((o) => insideFootprint(p, o, 1))) &&
      !taken(p)
    )
      return p;
  }
  return goal;
}
function deployUnit(
  b: Battle,
  owner: string,
  kind: UnitKind,
  producer: Entity,
  position: Point,
  now: number,
) {
  const unit = makeEntity(b, kind, owner, producer.team, position);
  unit.angle = producer.angle;
  if (!isHarvester(kind)) {
    // Roll out to the rally point, or clear the apron so the next unit can deploy.
    const exit = productionExit(producer);
    const goal = producer.rally ?? {
      x: exit.x + Math.sin(producer.angle) * 10,
      z: exit.z + Math.cos(producer.angle) * 10,
    };
    const obstacles = movementObstacles(b);
    const path = findPath(
      unit,
      rallySlot(b, owner, goal, isAir(kind), obstacles),
      isAir(kind),
      obstacles,
      terrainFor(b),
    );
    // A spent routing allowance must not strand a new unit on the production exit.
    if (!path.length && routeSearchDeferred()) return undefined;
    if (path.length) {
      unit.order = 'move';
      unit.orderAt = now;
      unit.path = path;
    }
  }
  b.entities.push(unit);
  return unit;
}
function advanceTraining(b: Battle, now: number) {
  if (!b.training?.length) return;
  for (const c of b.commanders) {
    staffTraining(b, c.id, now);
    let deployed = false;
    for (const q of b.training.filter((q) => q.owner === c.id))
      for (const line of q.lines ?? []) {
        if (line.readyAt > now || !line.producer) continue;
        const producer = b.entities.find((e) => e.id === line.producer)!;
        if (trainingBlockReason(b, c.id, q.kind, producer)) continue;
        const spawn = unitSpawn(b, c.id, q.kind, producer)!;
        if (!deployUnit(b, c.id, q.kind, producer, spawn.position, now))
          continue;
        logEvent(b, now, `${spec(q.kind).name} ready.`);
        q.remaining--;
        q.lines = q.lines!.filter((l) => l !== line);
        deployed = true;
      }
    if (!deployed) continue;
    b.training = b.training.filter((q) => q.owner !== c.id || q.remaining > 0);
    // The freed buildings start their next unit straight away.
    staffTraining(b, c.id, now);
  }
}
export function cancelTraining(
  b: Battle,
  owner: string,
  id: string,
  now: number,
) {
  if (b.status !== 'active') throw new Error('This operation has ended.');
  migrateTraining(b);
  const c = b.commanders.find((c) => c.id === owner),
    q = b.training!.find((q) => q.id === id && q.owner === owner);
  if (!c || !q) throw new Error('This troop order is no longer in your queue.');
  const refund = q.remaining * priceOf(b, owner, q.kind);
  c.credits += refund;
  b.training = b.training!.filter((entry) => entry.id !== id);
  staffTraining(b, owner, now);
  return refund;
}
export function purchase(
  b: Battle,
  owner: string,
  kind: EntityKind,
  now: number,
  placement?: Placement,
  quantity = 1,
) {
  migrateTraining(b);
  const c = b.commanders.find((c) => c.id === owner),
    own = b.entities.filter((e) => e.owner === owner && e.hp > 0),
    s = spec(kind);
  if (commanderEliminated(b, owner))
    throw new Error('Your operation is over: you have been eliminated.');
  if (!c || !own.some((e) => !isUnit(e.kind)))
    throw new Error('Deploy a command station first.');
  if (kind === 'hq') throw new Error('Each commander has one command station.');
  if (b.status !== 'active') throw new Error('This operation has ended.');
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > TRAINING_QUEUE_LIMIT
  )
    throw new Error(`Choose between 1 and ${TRAINING_QUEUE_LIMIT} troops.`);
  const locked = availability(b, owner, kind);
  if (locked) throw new Error(`${locked}.`);
  if (isUnit(kind)) {
    if (placement)
      throw new Error('Units deploy from their production building.');
    const capped =
      isHarvester(kind) && harvesterOrderReason(b, owner, quantity);
    if (capped) throw new Error(`${capped}.`);
    if (trainingCount(b, owner) + quantity > TRAINING_QUEUE_LIMIT)
      throw new Error(`Troop queue full (${TRAINING_QUEUE_LIMIT}).`);
    const price = priceOf(b, owner, kind);
    if (c.credits < price * quantity)
      throw new Error('Insufficient sector credits for this batch.');
    const q: TrainingOrder = {
      id: `q${++b.serial}`,
      owner,
      kind,
      remaining: quantity,
      total: quantity,
      readyAt: 0,
      lines: [],
    };
    c.credits -= price * quantity;
    b.training!.push(q);
    staffTraining(b, owner, now);
    return q.id;
  }
  if (quantity !== 1) throw new Error('Place one structure at a time.');
  if (!battleHasRoom(b))
    throw new Error('Battlefield full. Wait for space before building.');
  if (own.filter((e) => !isUnit(e.kind)).length >= STRUCTURE_LIMIT)
    throw new Error(
      `Structure limit reached (${STRUCTURE_LIMIT}). Sell a building to make room.`,
    );
  const price = priceOf(b, owner, kind);
  if (c.credits < price) throw new Error('Insufficient sector credits.');
  if (own.filter((e) => e.readyAt > 0).length >= CONSTRUCTION_QUEUE_LIMIT)
    throw new Error(`Construction queue full (${CONSTRUCTION_QUEUE_LIMIT}).`);
  const power = powerFor(b, owner);
  if (s.power > 0 && power.used + s.power > power.capacity)
    throw new Error('Build a Geothermal plant for more power.');
  if (!placement) throw new Error('Choose where to place this structure.');
  const reason = placementError(b, owner, kind, placement);
  if (reason) throw new Error(reason);
  const position = snapPlacement(placement.position),
    angle = (placement.rotation * Math.PI) / 2;
  // Construction runs independently from the troop queues.
  const start = Math.max(now, ...own.map((e) => e.readyAt));
  c.credits -= price;
  const entity = makeEntity(
    b,
    kind,
    owner,
    'blue',
    position,
    start + buildSeconds(b, owner, kind) * 1000,
  );
  entity.angle = angle;
  b.entities.push(entity);
  return entity.id;
}
/** Structures under construction refund fully; finished ones return half their cost. */
export function sellStructure(
  b: Battle,
  owner: string,
  id: string,
  now: number,
) {
  if (b.status !== 'active') throw new Error('This operation has ended.');
  const c = b.commanders.find((c) => c.id === owner),
    e = b.entities.find((e) => e.id === id);
  if (!c || !e || e.owner !== owner || isUnit(e.kind) || e.hp <= 0)
    throw new Error('Select one of your structures to sell.');
  if (e.kind === 'hq') throw new Error('The command station cannot be sold.');
  const cost = priceOf(b, owner, e.kind);
  const refund = e.readyAt > 0 ? cost : Math.floor(cost / 2);
  c.credits = Math.min(CREDIT_CAP, c.credits + refund);
  b.entities = b.entities.filter((entry) => entry.id !== id);
  logEvent(
    b,
    now,
    `${TACTICAL_BUILDINGS[e.kind].name} ${e.readyAt > 0 ? 'cancelled' : 'sold'} for ₭ ${refund}.`,
  );
  return refund;
}
/** Every building kind that trains troops of this category. */
export const producerKindsFor = (category: UnitCategory): Producer[] => [
  ...new Set(
    unitKinds
      .filter((k) => TACTICAL_UNITS[k].category === category)
      .map((k) => TACTICAL_UNITS[k].producer),
  ),
];
/** Point every completed building that trains this category at one rally point. */
export function setCategoryRally(
  b: Battle,
  owner: string,
  category: UnitCategory,
  point: Point,
) {
  const kinds: string[] = producerKindsFor(category);
  const buildings = b.entities.filter(
    (e) =>
      e.owner === owner && e.hp > 0 && !e.readyAt && kinds.includes(e.kind),
  );
  if (!buildings.length)
    throw new Error('Build a production structure for these troops first.');
  for (const e of buildings) setRally(b, owner, e.id, point);
  return buildings.length;
}
export function setRally(b: Battle, owner: string, id: string, point: Point) {
  const { groundAt } = terrainFor(b);

  if (b.status !== 'active') throw new Error('This operation has ended.');
  const e = b.entities.find((e) => e.id === id);
  if (
    !e ||
    e.owner !== owner ||
    isUnit(e.kind) ||
    e.hp <= 0 ||
    e.readyAt > 0 ||
    !isProducer(e.kind)
  )
    throw new Error('Select one of your completed production structures.');
  if (!groundAt(point.x, point.z))
    throw new Error('Choose land or a bridge inside the sector.');
  e.rally = { x: point.x, z: point.z };
}
function approach(from: Point, target: Entity): Point {
  if (isUnit(target.kind)) return { x: target.x, z: target.z };
  return approachBox(from, footprint(target.kind, target, target.angle));
}
/** Where a troop stands to fire on a structure: just outside it, on its own side. */
function approachBox(from: Point, box: Footprint): Point {
  const gap = 3;
  const x = Math.max(box.minX - gap, Math.min(box.maxX + gap, from.x)),
    z = Math.max(box.minZ - gap, Math.min(box.maxZ + gap, from.z));
  if (!insideFootprint({ x, z }, box, 2)) return { x, z };
  return { x, z: box.maxZ + gap };
}
function pathToTarget(
  e: Entity,
  target: Entity,
  obstacles: Footprint[],
  terrain: TerrainMap = defaultTerrain,
) {
  return findPath(e, approach(e, target), isAir(e.kind), obstacles, terrain);
}
/** Where a harvester stands while loading, spread around the seam so several can work it. */
function loadingPoint(from: Point, d: Deposit): Point {
  const dx = from.x - d.x,
    dz = from.z - d.z,
    len = Math.hypot(dx, dz) || 1;
  return { x: d.x + (dx / len) * 3, z: d.z + (dz / len) * 3 };
}
export function nearestDeposit(b: Battle, from: Point, maxDistance = 130) {
  let best: Deposit | undefined,
    bestDistance = maxDistance;
  for (const d of b.deposits ?? []) {
    if (d.amount <= 0) continue;
    const dist = distance(from, d);
    if (dist < bestDistance) {
      best = d;
      bestDistance = dist;
    }
  }
  return best;
}
export function validateOrder(
  b: Battle,
  owner: string,
  ids: string[],
  order: OrderKind,
  point?: Point,
  targetId?: string,
) {
  const { groundAt } = terrainFor(b);

  if (b.status !== 'active') throw new Error('This operation has ended.');
  if (commanderEliminated(b, owner))
    throw new Error('Your operation is over: you have been eliminated.');
  if (
    !ids.length ||
    ids.length > SELECTION_LIMIT ||
    new Set(ids).size !== ids.length
  )
    throw new Error(`Select up to ${SELECTION_LIMIT} units.`);
  const selected = ids.map((id) => b.entities.find((e) => e.id === id));
  if (
    selected.some(
      (e) =>
        !e ||
        e.owner !== owner ||
        !isUnit(e.kind) ||
        e.hp <= 0 ||
        e.readyAt > 0,
    )
  )
    throw new Error('You can only command your deployed units.');
  if (selected.some((e) => isHarvester(e!.kind)))
    throw new Error('Harvesters work the ore fields on their own.');
  if (selected.some((e) => flagCarriers(b).has(e!.id)))
    throw new Error('Flag carriers run home on their own.');
  const target = targetId
    ? b.entities.find((e) => e.id === targetId)
    : undefined;
  // Tech sites are landmarks: who holds one is never hidden.
  const site =
    order === 'attack' && targetId
      ? b.sites?.find((s) => s.id === targetId)
      : undefined;
  if (site && site.team !== 'red')
    throw new Error('Only enemy-held tech sites can be attacked.');
  if (
    order === 'attack' &&
    !site &&
    (!target || target.team === 'blue' || !visibleTo(owner, target, b.entities))
  )
    throw new Error('Select a visible hostile target.');
  const deposit =
    order === 'harvest' && targetId
      ? (b.deposits ?? []).find((d) => d.id === targetId)
      : undefined;
  if (order === 'harvest' && targetId && !deposit)
    throw new Error('Choose an ore field to harvest.');
  if (order === 'harvest' && !targetId && !point)
    throw new Error('Choose an ore field to harvest.');
  if (
    (order === 'move' || order === 'attackMove') &&
    (!point || !groundAt(point.x, point.z))
  )
    throw new Error('Choose land or a bridge inside the sector.');
  return { selected, target, deposit, site };
}
export function issueOrder(
  b: Battle,
  owner: string,
  ids: string[],
  order: OrderKind,
  point?: Point,
  targetId?: string,
  issuedAt = b.tickAt,
  routing?: {
    obstacles: Footprint[];
    destinations?: Map<string, Point>;
    pace?: Map<string, number>;
  },
) {
  const { selected, target, deposit, site } = validateOrder(
    b,
    owner,
    ids,
    order,
    point,
    targetId,
  );
  const obstacles =
    routing?.obstacles ??
    movementObstacles({
      ...b,
      entities: b.entities.filter((e) => visibleTo(owner, e, b.entities)),
    });
  // Advance copies first: formation matching must use where the squad is now.
  const starts = selected.map((entity) => {
    const e = entity!;
    const start = { ...e, path: e.path.map((p) => ({ x: p.x, z: p.z })) };
    const elapsed = Math.min(
      2,
      Math.max(
        0,
        (issuedAt - Math.max(b.tickAt, e.orderAt ?? b.tickAt)) / 1000,
      ),
    );
    if (elapsed && (e.order === 'move' || !e.firedAt || e.firedAt < b.tickAt))
      walk(
        start,
        elapsed,
        obstacles,
        doctrineFor(b, start.owner).speed,
        terrainFor(b),
      );
    return start;
  });
  const destinations =
    routing?.destinations ??
    (point && !target && (order === 'move' || order === 'attackMove')
      ? formationDestinations(starts, point, obstacles, terrainFor(b))
      : undefined);
  const pace =
    routing?.pace ?? (destinations ? groupPace(b, starts) : undefined);
  // Calculate all paths before applying any command, so rejected orders are atomic.
  const plans = selected.map((entity, i) => {
    const e = entity!,
      start = starts[i];
    const harvester = isHarvester(e.kind);
    let kind: OrderKind = order;
    if (harvester && (order === 'attack' || order === 'attackMove'))
      kind = 'move';
    if (!harvester && order === 'harvest') kind = 'move';
    if (kind === 'harvest') {
      const seam = deposit ?? nearestDeposit(b, point ?? start);
      if (!seam) throw new Error('No ore remains within reach.');
      const path =
        (start.cargo ?? 0) >= harvesterCapacity(b, start.owner)
          ? []
          : findPath(
              start,
              loadingPoint(start, seam),
              false,
              obstacles,
              terrainFor(b),
            );
      return { e, path, start, kind, target: seam.id };
    }
    const destination =
      kind === 'attack'
        ? site
          ? approachBox(start, siteFootprint(site))
          : approach(start, target!)
        : order === 'harvest'
          ? (deposit ?? point)!
          : target
            ? approach(start, target)
            : point;
    const dest = destinations?.get(e.id) ?? destination;
    const path =
      kind === 'hold' || kind === 'stop'
        ? []
        : findPath(start, dest!, isAir(e.kind), obstacles, terrainFor(b));
    if (
      kind !== 'hold' &&
      kind !== 'stop' &&
      !path.length &&
      distance(start, dest!) > 2
    )
      throw new Error('No route to that position.');
    return {
      e,
      path,
      start,
      kind,
      target: kind === 'attack' ? (site?.id ?? target!.id) : undefined,
    };
  });
  for (const { e, path, start, kind, target: t } of plans) {
    e.x = start.x;
    e.z = start.z;
    e.angle = start.angle;
    // Momentum carries into a redirect; a halt or an empty route drops it.
    if (path.length && start.v) e.v = start.v;
    else delete e.v;
    const together = pace?.get(e.id);
    if (together && path.length && (kind === 'move' || kind === 'attackMove'))
      e.pace = together;
    else delete e.pace;
    e.order = kind;
    e.orderAt = issuedAt;
    e.path = path;
    if (t) e.target = t;
    else delete e.target;
  }
}
/**
 * A formation marches at its slowest member's speed so it arrives together.
 * Ground and air keep separate paces; a group of one kind at one speed needs none.
 */
function groupPace(b: Pick<Battle, 'commanders'>, members: Entity[]) {
  const pace = new Map<string, number>();
  for (const air of [false, true]) {
    const group = members.filter(
      (e) => isUnit(e.kind) && isAir(e.kind) === air,
    );
    if (group.length < 2) continue;
    const speeds = group.map(
      (e) => UNITS[e.kind as UnitKind].speed * speedScaleFor(b, e),
    );
    const slowest = Math.min(...speeds);
    if (speeds.every((s) => s === slowest)) continue;
    for (const e of group) pace.set(e.id, slowest);
  }
  return pace;
}
export type PendingBattleOrder = {
  owner: string;
  ids: string[];
  order: OrderKind;
  point?: Point;
  target?: string;
  destinations?: { id: string; point: Point }[];
};
/** Route a full formation in bounded slices. Nearby troops share corridors; distant
 * squads continue on later ticks, retaining their own final formation positions. */
export function applyBattleOrder(b: Battle, intent: PendingBattleOrder) {
  // Troops that fell, or picked up a flag, since the order was queued drop out of it.
  const carriers = flagCarriers(b);
  intent.ids = intent.ids.filter(
    (id) =>
      !carriers.has(id) && b.entities.some((e) => e.id === id && e.hp > 0),
  );
  if (!intent.ids.length) return [];
  const { selected, target } = validateOrder(
    b,
    intent.owner,
    intent.ids,
    intent.order,
    intent.point,
    intent.target,
  );
  const obstacles = movementObstacles({
    ...b,
    entities: b.entities.filter((e) =>
      visibleTo(intent.owner, e, b.entities, b),
    ),
  });
  if (
    !intent.destinations &&
    intent.point &&
    !target &&
    (intent.order === 'move' || intent.order === 'attackMove')
  )
    intent.destinations = [
      ...formationDestinations(
        selected as Entity[],
        intent.point,
        obstacles,
        terrainFor(b),
      ),
    ].map(([id, point]) => ({ id, point }));
  const destinations = intent.destinations
    ? new Map(intent.destinations.map((p) => [p.id, p.point]))
    : undefined;
  // The whole formation, not just this slice, sets the pace.
  const pace = intent.destinations
    ? groupPace(
        b,
        intent.destinations
          .map((p) => b.entities.find((e) => e.id === p.id))
          .filter((e): e is Entity => !!e && e.hp > 0),
      )
    : undefined;
  const errors = new Set<string>();
  let completed = 0;
  withRoutingBudget(() => {
    for (const id of intent.ids) {
      beginRouteRequest();
      try {
        issueOrder(
          b,
          intent.owner,
          [id],
          intent.order,
          intent.point,
          intent.target,
          b.tickAt,
          { obstacles, destinations, pace },
        );
      } catch (error) {
        if (routeSearchDeferred()) break;
        errors.add((error as Error).message);
      }
      completed++;
    }
  });
  intent.ids = intent.ids.slice(completed);
  return [...errors];
}
/** Kinematic limits for one troop: its drive, turn rate and acceleration, capped by any group pace. */
export function mobilityFor(
  e: Pick<Entity, 'kind' | 'pace'>,
  scale = 1,
): Mobility | null {
  if (!isUnit(e.kind)) return null;
  const s = UNITS[e.kind],
    speed = s.speed * scale;
  return {
    speed: e.pace && e.pace < speed ? e.pace : speed,
    turn: s.turn,
    accel: s.accel,
    drive: s.drive,
  };
}
/** A troop that has stopped carries no speed or group pace into its next order. */
function settle(e: Entity) {
  delete e.v;
  delete e.pace;
}
/**
 * Follow the approved route with the unit's turn rate, acceleration and
 * braking (see tactical-kinematics). The position stays on the route; the
 * hull sweeps round corners and heavy hulls slow or pivot to line up.
 */
function walk(
  e: Entity,
  dt: number,
  obstacles: Footprint[],
  scale = 1,
  terrain: TerrainMap = defaultTerrain,
) {
  const mobility = mobilityFor(e, scale);
  if (!mobility) return;
  const air = mobility.drive === 'air';
  const blocked = (from: Point, to: Point) =>
    obstacles.some(
      (box) =>
        !insideFootprint(from, box, 1) &&
        segmentIntersectsFootprint(from, to, box),
    );
  if (!air && e.path.length && blocked(e, e.path[0])) {
    const replacement = findPath(
      e,
      e.path[e.path.length - 1],
      false,
      obstacles,
      terrain,
    );
    if (!replacement.length) {
      if (!routeSearchDeferred()) {
        e.path = [];
        settle(e);
      }
      return;
    }
    e.path = replacement;
  }
  if (!e.path.length) {
    settle(e);
    return;
  }
  const state = createKinematicState(e.x, e.z, e.angle, e.v ?? 0);
  state.tail = routeTail(e.path, 0);
  advanceKinematics(
    state,
    e.path,
    mobility,
    dt,
    air ? null : terrain.terrainSpeed,
    air ? undefined : (from, to) => !blocked(from, to),
  );
  e.x = state.x;
  e.z = state.z;
  e.angle = state.angle;
  if (state.index) e.path.splice(0, state.index);
  // A segment newly crossed by a foundation halts the troop; the next update re-routes it.
  if (!e.path.length || state.halted) {
    if (e.path.length) delete e.v;
    else settle(e);
  } else e.v = state.v;
}
const SEPARATION_CELL = 8;
const REJOIN_AHEAD = 2;
/** Marchers look this far past bumping distance for a stationary troop to steer round. */
const AVOID_AHEAD = 4;
/** A detour passes a stationary troop at this multiple of bumping distance. */
const DETOUR_CLEARANCE = 1.15;
/** Fine ground check for the short detour a shoved troop takes back to its route. */
function clearShortLeg(
  from: Point,
  to: Point,
  obstacles: Footprint[],
  terrain: TerrainMap,
) {
  if (obstacles.some((box) => segmentIntersectsFootprint(from, to, box)))
    return false;
  const steps = Math.max(1, Math.ceil(distance(from, to) / 0.2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (
      !terrain.groundAt(
        from.x + (to.x - from.x) * t,
        from.z + (to.z - from.z) * t,
      )
    )
      return false;
  }
  return true;
}
/** At most this far per update, so shoving reads as a nudge rather than a jump. */
const SEPARATION_STEP = 0.5;
/** Bodies ease apart once closer than this share of their combined formation radii. */
const SEPARATION_SHARE = 0.75;
/**
 * Friendly ground troops that overlap ease apart; vehicles on the move pass
 * through one another. Moving troops flow around
 * stationary ones (which keep their exact slots); two movers share the push;
 * harvesters and troops on hold never yield. A troop whose destination is
 * occupied stops at the edge of the occupant instead of shoving forever.
 * One pass per update over an 8 m hash, no pathfinding.
 */
export function separateTroops(
  b: Battle,
  obstacles: Footprint[],
  terrain: TerrainMap = terrainFor(b),
) {
  const troops: Entity[] = [];
  const cells = new Map<number, number[]>();
  for (const e of b.entities) {
    if (!isUnit(e.kind) || isAir(e.kind) || e.readyAt || e.hp <= 0) continue;
    const key =
      Math.floor(e.x / SEPARATION_CELL) * 65536 +
      Math.floor(e.z / SEPARATION_CELL);
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = []));
    cell.push(troops.length);
    troops.push(e);
  }
  if (troops.length < 2) return;
  const shiftX = new Float64Array(troops.length),
    shiftZ = new Float64Array(troops.length);
  const radius = troops.map((e) => formationRadius(e.kind));
  const detoured = new Uint8Array(troops.length);
  /** Insert a waypoint beside `still` when `mover`'s next leg runs through it. */
  const detour = (mover: Entity, still: Entity, least: number, i: number) => {
    const next = mover.path[0],
      leg = distance(mover, next),
      goal = mover.path[mover.path.length - 1];
    // One detour at a time, and none in the last approach: a formation's
    // neighbours are already parked there and the slots are spaced for it.
    if (
      leg < least * 2 ||
      distance(mover, goal) < least * 3 ||
      mover.path.length > 24
    )
      return false;
    const ux = (next.x - mover.x) / leg,
      uz = (next.z - mover.z) / leg;
    const rx = still.x - mover.x,
      rz = still.z - mover.z;
    const along = rx * ux + rz * uz,
      lateral = -rx * uz + rz * ux;
    if (along <= 0 || along > leg + least * 0.5 || Math.abs(lateral) >= least)
      return false;
    const clearance = least * DETOUR_CLEARANCE;
    // Already rounding this troop, or its final stop is taken (handled below).
    if (Math.abs(distance(next, still) - clearance) < 0.3) return false;
    if (distance(mover.path.at(-1)!, still) < least) return false;
    const side = lateral > 0 ? -1 : lateral < 0 ? 1 : i % 2 ? 1 : -1;
    const waypoint = {
      x: still.x - uz * side * clearance,
      z: still.z + ux * side * clearance,
    };
    if (
      !clearShortLeg(mover, waypoint, obstacles, terrain) ||
      !clearShortLeg(waypoint, next, obstacles, terrain)
    )
      return false;
    mover.path.unshift(waypoint);
    return true;
  };
  const yields = (e: Entity) =>
    !isHarvester(e.kind) && e.order !== 'hold' ? 1 : 0;
  for (let i = 0; i < troops.length; i++) {
    const a = troops[i],
      cx = Math.floor(a.x / SEPARATION_CELL),
      cz = Math.floor(a.z / SEPARATION_CELL);
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const cell = cells.get(gx * 65536 + gz);
        if (!cell) continue;
        for (const j of cell) {
          if (j <= i) continue;
          const c = troops[j];
          if (c.team !== a.team) continue;
          const least = (radius[i] + radius[j]) * SEPARATION_SHARE;
          let dx = a.x - c.x,
            dz = a.z - c.z;
          const d = Math.hypot(dx, dz);
          if (d >= least + AVOID_AHEAD) continue;
          const aMoving = a.path.length > 0,
            cMoving = c.path.length > 0;
          // Vehicles drive through each other: steering round a crowd of hulls
          // jams it. Parked vehicles still ease apart below.
          if (
            (aMoving || cMoving) &&
            categoryOf(a.kind as UnitKind) === 'vehicle' &&
            categoryOf(c.kind as UnitKind) === 'vehicle'
          )
            continue;
          // Steer round a stationary friend before bumping into it.
          if (aMoving && !cMoving && !detoured[i] && yields(a))
            detoured[i] = detour(a, c, least, i) ? 1 : 0;
          else if (cMoving && !aMoving && !detoured[j] && yields(c))
            detoured[j] = detour(c, a, least, j) ? 1 : 0;
          if (d >= least) continue;
          // A mover whose destination is taken halts beside the occupant.
          // Harvesters own reserved work bays and always finish their approach.
          if (
            aMoving &&
            !cMoving &&
            !isHarvester(a.kind) &&
            distance(a.path.at(-1)!, c) < least
          ) {
            if (distance(a, a.path.at(-1)!) < least * 2) {
              a.path = [];
              settle(a);
            }
          } else if (
            cMoving &&
            !aMoving &&
            !isHarvester(c.kind) &&
            distance(c.path.at(-1)!, a) < least
          ) {
            if (distance(c, c.path.at(-1)!) < least * 2) {
              c.path = [];
              settle(c);
            }
          }
          let wa = yields(a) * (aMoving || !cMoving ? 1 : 0),
            wc = yields(c) * (cMoving || !aMoving ? 1 : 0);
          if (!wa && !wc) continue;
          const total = wa + wc;
          wa /= total;
          wc /= total;
          if (d < 1e-6) {
            // Exactly stacked: split along a direction fixed by list order.
            const turn = (i * 2.399963) % (Math.PI * 2);
            dx = Math.sin(turn);
            dz = Math.cos(turn);
          } else {
            dx /= d;
            dz /= d;
          }
          const push = Math.min(least - d, SEPARATION_STEP * 2);
          shiftX[i] += dx * push * wa;
          shiftZ[i] += dz * push * wa;
          shiftX[j] -= dx * push * wc;
          shiftZ[j] -= dz * push * wc;
        }
      }
  }
  for (let i = 0; i < troops.length; i++) {
    let sx = shiftX[i],
      sz = shiftZ[i];
    if (!sx && !sz) continue;
    const e = troops[i];
    // A marcher is steered aside, never shoved back along its leg: in marsh or
    // fords its stride is shorter than the shove, and a parked friend would
    // pin it in place for good.
    if (e.path.length) {
      // A turning point within one shove counts as passed; aiming at it would
      // swing the marcher's heading round with every nudge.
      if (
        e.path.length > 1 &&
        distance(e, e.path[0]) < SEPARATION_STEP &&
        clearShortLeg(e, e.path[1], obstacles, terrain)
      )
        e.path.shift();
      const next = e.path[0],
        leg = distance(e, next);
      if (leg > 1e-6) {
        const ux = (next.x - e.x) / leg,
          uz = (next.z - e.z) / leg,
          back = sx * ux + sz * uz;
        if (back < 0) {
          const size = Math.hypot(sx, sz);
          sx -= back * ux;
          sz -= back * uz;
          // Head-on: slip past on a side fixed by list order.
          if (Math.hypot(sx, sz) < size * 0.25) {
            const side = i % 2 ? 1 : -1;
            sx = -uz * side * size;
            sz = ux * side * size;
          }
        }
      }
    }
    const length = Math.hypot(sx, sz);
    if (length > SEPARATION_STEP) {
      sx *= SEPARATION_STEP / length;
      sz *= SEPARATION_STEP / length;
    }
    const to = { x: e.x + sx, z: e.z + sz };
    if (!terrain.groundAt(to.x, to.z) || !insideSector(to, terrain.bounds))
      continue;
    if (
      obstacles.some(
        (box) => insideFootprint(to, box) && !insideFootprint(e, box),
      )
    )
      continue;
    // A shoved marcher rejoins its validated leg a couple of metres ahead,
    // so the detour is short enough to check finely against water and walls.
    let rejoin: Point | undefined;
    if (e.path.length) {
      const next = e.path[0],
        leg = distance(e, next);
      if (leg > REJOIN_AHEAD) {
        const t = REJOIN_AHEAD / leg;
        rejoin = { x: e.x + (next.x - e.x) * t, z: e.z + (next.z - e.z) * t };
      }
      if (!clearShortLeg(to, rejoin ?? next, obstacles, terrain)) continue;
    }
    e.x = to.x;
    e.z = to.z;
    if (rejoin) e.path.unshift(rejoin);
  }
}
function attackOf(e: Entity) {
  if (isUnit(e.kind)) {
    const s = UNITS[e.kind];
    return s.damage > 0 ? s : null;
  }
  return BUILDINGS[e.kind].attack ?? null;
}
/** How long a hostile unit waits before retrying a hunt whose path could not be found. */
const HUNT_RETRY_MS = 2000;
/** The nearest allied entity a hostile unit can damage; structures are hunted before units. */
export function huntTarget(
  b: Pick<Battle, 'entities'>,
  e: Entity,
  attack: { versus: Versus },
) {
  let prey: Entity | undefined,
    best = Infinity;
  for (const t of b.entities) {
    if (
      t.team === e.team ||
      t.hp <= 0 ||
      t.readyAt > 0 ||
      attack.versus[armorOf(t.kind)] <= 0
    )
      continue;
    if (prey && isUnit(t.kind) && !isUnit(prey.kind)) continue;
    const d = distance(e, t);
    if (prey && !isUnit(t.kind) && isUnit(prey.kind)) best = Infinity;
    if (d < best) {
      best = d;
      prey = t;
    }
  }
  return prey;
}
function canEngage(
  e: Entity,
  attack: { range: number; minRange?: number; versus: Versus },
  t: Entity,
) {
  if (t.team === e.team || t.hp <= 0 || t.readyAt > 0) return false;
  if (attack.versus[armorOf(t.kind)] <= 0) return false;
  const d = distance(e, t);
  return d <= attack.range && d >= (attack.minRange ?? 0);
}
/** A troop's or structure's weapon with the owner's range research applied. */
export function attackFor(b: Pick<Battle, 'commanders'>, e: Entity) {
  const attack = attackOf(e);
  if (!attack) return null;
  const scale = rangeScaleFor(b, e);
  return scale === 1 ? attack : { ...attack, range: attack.range * scale };
}
/**
 * Rock-paper-scissors damage with research bonuses; wall time never comes from
 * clients. Hostile troops have no research: they harden with every column that
 * has marched, per the difficulty's veterancy.
 */
export function damageAgainst(
  b: Pick<Battle, 'commanders' | 'difficulty' | 'wave'> & { tickAt?: number },
  attacker: Entity,
  target: Pick<Entity, 'kind' | 'owner' | 'veteran'>,
  attack: { damage: number; versus: Versus },
) {
  return damageAgainstArmor(
    b,
    attacker,
    armorOf(target.kind),
    target.owner,
    attack,
    target,
  );
}
/** The same, against an armor class rather than an entity (tech sites are structures). */
function damageAgainstArmor(
  b: Pick<Battle, 'commanders' | 'difficulty' | 'wave'> & { tickAt?: number },
  attacker: Entity,
  armor: ArmorClass,
  owner: string,
  attack: { damage: number; versus: Versus },
  target: Pick<Entity, 'veteran'> = {},
) {
  let amount = attack.damage * attack.versus[armor];
  const c = commanderOf(b, attacker.owner);
  if (isUnit(attacker.kind)) {
    const kind = attacker.kind;
    if (categoryOf(kind) === 'infantry') {
      if (hasResearch(c, 'ammunition')) amount *= 1.2;
    } else if (hasResearch(c, 'shells')) amount *= 1.2;
    if (
      (kind === 'tank' || kind === 'jotun') &&
      (armor === 'vehicle' || armor === 'structure') &&
      hasResearch(c, 'uranium')
    )
      amount *= 1.25;
  } else {
    if (hasResearch(c, 'shells')) amount *= 1.2;
    amount *= doctrineOf(c?.culture).defenseDamage;
  }
  if (attacker.team === 'red') amount *= veterancyFor(b);
  amount *= strikeDamage(b, attacker, target);
  const victim = commanderOf(b, owner);
  if (armor === 'vehicle' && hasResearch(victim, 'composite')) amount *= 0.8;
  if (armor === 'infantry' && hasResearch(victim, 'plates')) amount *= 0.8;
  if (armor === 'air' && hasResearch(victim, 'avionics')) amount *= 0.8;
  return amount;
}
function harvest(
  b: Battle,
  e: Entity,
  dt: number,
  now: number,
  obstacles: Footprint[],
) {
  const s = UNITS.harvester,
    c = b.commanders.find((c) => c.id === e.owner),
    doctrine = doctrineOf(c?.culture),
    capacity = harvesterCapacity(b, e.owner);
  e.cargo ??= 0;
  const approachWork = (centre: Point, refinery?: Entity) => {
    for (const site of harvesterWorkPositions(
      e,
      b.entities,
      centre,
      refinery,
    )) {
      if (!clearWorkPosition(site.point, obstacles, terrainFor(b))) continue;
      const destination = e.path.at(-1);
      if (destination && distance(destination, site.point) < 0.01) return site;
      if (!e.path.length && distance(e, site.point) < 0.01) return site;
      const path = findPath(e, site.point, false, obstacles, terrainFor(b));
      if (!path.length) continue;
      e.path = path;
      return site;
    }
    // Wait where we are if both working bays and the surrounding holding area are full.
    e.path = [];
    return undefined;
  };
  const chosen = (b.deposits ?? []).find(
    (d) => d.id === e.target && d.amount > 0,
  );
  if (e.cargo < capacity) {
    const seam = chosen ?? nearestDeposit(b, e);
    if (!seam) {
      if (e.cargo <= 0) {
        // After the last delivery, clear the unloading bay before going idle.
        if (e.path.length) {
          walk(e, dt, obstacles, speedScaleFor(b, e), terrainFor(b));
          if (e.path.length) return;
        }
        e.order = 'stop';
        e.path = [];
        delete e.target;
        logEvent(b, now, `${s.name} idle: no ore remains within reach.`);
        return;
      }
    } else {
      e.target = seam.id;
      const site = approachWork(seam);
      if (!site) return;
      // Finish the approved approach before loading; clients animate that full route.
      if (site.working && !e.path.length && distance(e, site.point) < 0.01) {
        e.path = [];
        e.angle = Math.atan2(seam.x - e.x, seam.z - e.z);
        const rate =
          s.load! * (hasResearch(c, 'drills') ? 1.5 : 1) * doctrine.load;
        const take = Math.min(rate * dt, capacity - e.cargo, seam.amount);
        e.cargo += take;
        // The garrison's harvester is scenery: it never empties a seam players could win.
        if (e.team === 'blue') seam.amount -= take;
        if (seam.amount <= 0.5) {
          seam.amount = 0;
          logEvent(b, now, `${seam.name} is exhausted.`, 'info');
        }
        return;
      }
      walk(e, dt, obstacles, speedScaleFor(b, e), terrainFor(b));
      return;
    }
  }
  // Full, or the field ran dry with cargo aboard: deliver to the nearest refinery.
  const refinery = b.entities
    .filter(
      (r) =>
        r.owner === e.owner && r.kind === 'refinery' && r.hp > 0 && !r.readyAt,
    )
    .sort((a, z) => distance(e, a) - distance(e, z))[0];
  if (!refinery) {
    e.path = [];
    return;
  }
  const site = approachWork(productionExit(refinery), refinery);
  if (!site) return;
  if (site.working && !e.path.length && distance(e, site.point) < 0.01) {
    if (c) {
      c.credits = Math.min(CREDIT_CAP, c.credits + e.cargo);
      c.harvested = (c.harvested ?? 0) + e.cargo;
    }
    e.cargo = 0;
    e.path = [];
    e.angle = Math.atan2(refinery.x - e.x, refinery.z - e.z);
    if (!nearestDeposit(b, e)) {
      for (const turnout of harvesterWorkPositions(
        e,
        b.entities,
        productionExit(refinery),
        refinery,
      )) {
        if (
          turnout.working ||
          !clearWorkPosition(turnout.point, obstacles, terrainFor(b))
        )
          continue;
        const path = findPath(
          e,
          turnout.point,
          false,
          obstacles,
          terrainFor(b),
        );
        if (path.length) {
          e.path = path;
          break;
        }
      }
    }
    return;
  }
  walk(e, dt, obstacles, speedScaleFor(b, e), terrainFor(b));
}
const COLUMN_MINIMUM = { easy: 3, normal: 4, hard: 5, brutal: 6 } as const;
/** Counterattacks start as patrols and grow into combined-arms columns over the operation. */
export function waveComposition(
  wave: number,
  difficulty: Difficulty = 'normal',
  seed = 0,
): UnitKind[] {
  const rules = DIFFICULTIES[difficulty];
  wave += rules.escalation;
  const list: UnitKind[] = [];
  // Each arm joins at its wave and keeps growing to a cap; late columns are combined-arms.
  const arms: [UnitKind, number, number, number, number][] = [
    // kind, first wave, initial count, waves per extra unit, cap
    ['ranger', 0, 2, 2, 6],
    ['rocket', 3, 1, 1, 4],
    ['lynx', 3, 1, 6, 2],
    ['tank', 5, 1, 2, 4],
    ['drone', 6, 1, 4, 2],
    ['howitzer', 8, 1, 3, 3],
    ['gunship', 10, 1, 2, 3],
    ['jotun', 12, 1, 3, 3],
  ];
  for (const [kind, from, initial, every, cap] of arms) {
    if (wave < from) continue;
    const count = Math.min(cap, initial + Math.floor((wave - from) / every));
    for (let i = 0; i < count; i++) list.push(kind);
  }
  const random = operationRandom(seed ^ Math.imul(wave, 0x45d9f3b));
  // Alternate light unit roles without introducing armor before the selected escalation.
  const varied = list.map((kind) =>
    kind === 'ranger' && wave >= 3 && random() < 0.25
      ? ('rocket' as const)
      : kind,
  );
  // A patrol must be large enough to register against the starting escort.
  const minimum = COLUMN_MINIMUM[difficulty];
  const count = Math.max(minimum, Math.round(varied.length * rules.waveScale));
  return Array.from({ length: count }, (_, i) => varied[i % varied.length]);
}
export const FIRST_WAVE_MS = DIFFICULTIES.normal.firstWaveMs,
  WAVE_INTERVAL_MS = DIFFICULTIES.normal.waveIntervalMs;
/** Every hostile army whose command station still stands; a headless army neither trains nor attacks. */
export function hostileArmies(b: Pick<Battle, 'entities'>) {
  return [
    ...new Set(
      b.entities
        .filter((e) => e.team === 'red' && e.kind === 'hq' && e.hp > 0)
        .map((e) => e.owner),
    ),
  ];
}
const hostileHq = (b: Battle, owner: string) =>
  b.entities.find((e) => e.owner === owner && e.kind === 'hq' && e.hp > 0)!;
/** Total hostile troops across all armies, in the field and on order. */
export const HOSTILE_ARMY_BUDGET = (b: Pick<Battle, 'enemyCount'>) => {
  const enemies = b.enemyCount ?? 1;
  // Past four garrisons the budget grows fast enough for twice the columns in the field.
  return enemies <= 4 ? 100 + 4 * (enemies - 1) : 112 + 20 * (enemies - 4);
};
export const hostileGuards = (b: Pick<Battle, 'difficulty' | 'enemyCount'>) =>
  guardsFor(b);
const hostileSeconds = (b: Battle, kind: UnitKind) =>
  Math.max(1, Math.round(TACTICAL_UNITS[kind].seconds * productionFor(b)));
/** A hostile army's production building for a troop; a compact base without a barracks musters infantry at its command station. */
function hostileProducer(b: Battle, owner: string, kind: UnitKind) {
  const standing = (building: EntityKind) =>
    b.entities.find(
      (e) => e.owner === owner && e.kind === building && e.hp > 0 && !e.readyAt,
    );
  return (
    standing(TACTICAL_UNITS[kind].producer) ??
    (categoryOf(kind) === 'infantry' ? standing('hq') : undefined)
  );
}
const hostileTrainable = (b: Battle, owner: string, kind: UnitKind) =>
  !!hostileProducer(b, owner, kind);
/** Where an army gathers: a little forward of its command station's dispatch exit. */
function musterPoint(b: Battle, hq: Entity): Point {
  const { groundAt } = terrainFor(b);
  const exit = productionExit(hq);
  const forward = {
    x: exit.x + Math.sin(hq.angle) * 6,
    z: exit.z + Math.cos(hq.angle) * 6,
  };
  return groundAt(forward.x, forward.z) ? forward : exit;
}
/** Troops standing by at home: trained, not yet sent, and within reach of the command station. */
export function hostileMustered(b: Battle, owner: string) {
  const hq = hostileHq(b, owner);
  return b.entities.filter(
    (e) =>
      e.owner === owner &&
      e.hp > 0 &&
      !e.readyAt &&
      isUnit(e.kind) &&
      !isHarvester(e.kind) &&
      (e.order === 'stop' || e.order === 'move') &&
      distance(e, hq) < 60 &&
      // A carrier running a flag home is not waiting for the next column.
      !b.flags?.some((f) => carrierOf(f) === e.id) &&
      // Nor is a detachment on its way to a tech site.
      !onSiteDuty(b, e.id),
  );
}
const hostileHead = (b: Battle, owner: string, category: UnitCategory) =>
  (b.hostileTraining ?? []).find(
    (q) => q.owner === owner && categoryOf(q.kind) === category,
  );
/**
 * Hostile armies keep their production lines busy. Each raises a home guard first,
 * then trains the next counterattack column; nothing is conjured onto the map.
 * An army whose column already stands ready waits for its turn to march.
 */
function planHostileProduction(b: Battle, now: number) {
  const armies = hostileArmies(b);
  // A headless army's remaining orders are abandoned.
  const queue = (b.hostileTraining = (b.hostileTraining ?? []).filter((q) =>
    armies.includes(q.owner),
  ));
  if (!armies.length) return;
  const fielded = b.entities.filter(
    (e) => e.team === 'red' && isUnit(e.kind) && e.hp > 0,
  ).length;
  let budget =
    HOSTILE_ARMY_BUDGET(b) -
    fielded -
    queue.reduce((n, q) => n + q.remaining, 0);
  const guards = hostileGuards(b);
  for (const [index, owner] of armies.entries()) {
    // Each production line refills on its own, so slow armor never idles the barracks.
    const pending = queue.filter((q) => q.owner === owner);
    const busy = new Set(pending.map((q) => categoryOf(q.kind)));
    if (busy.size === UNIT_CATEGORIES.length) continue;
    const mustered = hostileMustered(b, owner).length + pending.length;
    const column = waveComposition(b.wave + 1, b.difficulty, b.seed);
    const wanted: UnitKind[] =
      mustered < guards
        ? (() => {
            const random = operationRandom(
              (b.seed ?? 0) ^ Math.imul(index + 1, 0x85ebca6b) ^ b.serial,
            );
            const kinds = ['ranger', 'rocket', 'lynx'] as const;
            return Array.from(
              { length: guards - mustered },
              () => kinds[Math.floor(random() * kinds.length)],
            );
          })()
        : mustered - guards >= column.length
          ? []
          : column.slice(0, column.length - (mustered - guards));
    const orders = wanted
      .filter(
        (kind) =>
          !busy.has(categoryOf(kind)) && hostileTrainable(b, owner, kind),
      )
      .slice(
        0,
        Math.max(
          0,
          Math.min(
            budget,
            Math.floor(HOSTILE_ARMY_BUDGET(b) / armies.length) -
              b.entities.filter(
                (e) => e.owner === owner && isUnit(e.kind) && e.hp > 0,
              ).length,
          ),
        ),
      );
    for (const kind of orders)
      queue.push({
        id: `h${++b.serial}`,
        owner,
        kind,
        remaining: 1,
        total: 1,
        readyAt: 0,
      });
    budget -= orders.length;
    for (const category of UNIT_CATEGORIES) {
      const head = hostileHead(b, owner, category);
      if (head) startHostileOrder(b, head, now);
    }
  }
}
/** Bank credits for a hostile army, when the skirmish mode funds the garrison. */
function fundGarrison(b: Battle, owner: string, credits: number) {
  if (!b.garrisonFunds) return;
  b.garrisonFunds[owner] = Math.min(
    CREDIT_CAP,
    (b.garrisonFunds[owner] ?? 0) + credits,
  );
}
/**
 * Start a hostile order's clock. A funded garrison pays the troop's price
 * first, and until it can the order waits unstarted (false); an army with
 * credits to spare pays double to rush it through in half the time.
 */
function startHostileOrder(b: Battle, q: TrainingOrder, now: number) {
  if (q.readyAt) return true;
  const funds = b.garrisonFunds,
    { garrison } = skirmishRules(b);
  let seconds = hostileSeconds(b, q.kind as UnitKind);
  if (funds && garrison) {
    const price = TACTICAL_UNITS[q.kind as UnitKind].cost,
      banked = funds[q.owner] ?? 0;
    if (banked < price) return false;
    const rush = banked >= price * 2 + garrison.rushReserve;
    funds[q.owner] = banked - (rush ? price * 2 : price);
    if (rush) seconds = Math.max(1, Math.round(seconds / 2));
  }
  q.readyAt = now + seconds * 1000;
  return true;
}
/** Finished hostile troops roll out of their barracks, works or air base and walk to the muster point. */
function advanceHostileTraining(b: Battle, now: number) {
  for (const owner of hostileArmies(b)) {
    const hq = hostileHq(b, owner);
    for (const category of UNIT_CATEGORIES) {
      // Orders whose production building is gone die with it.
      b.hostileTraining = b.hostileTraining!.filter(
        (q) => q.owner !== owner || hostileTrainable(b, owner, q.kind),
      );
      const q = hostileHead(b, owner, category);
      if (!q) continue;
      if (!startHostileOrder(b, q, now) || q.readyAt > now) continue;
      if (
        !battleHasRoom(b, 'red') ||
        b.entities.filter((e) => e.team === 'red' && isUnit(e.kind) && e.hp > 0)
          .length >= HOSTILE_ARMY_BUDGET(b)
      )
        continue;
      const producer = hostileProducer(b, owner, q.kind)!;
      const position = spawnNear(b, productionExit(producer), isAir(q.kind));
      if (!position) continue;
      producer.rally ??= musterPoint(b, hq);
      if (!deployUnit(b, owner, q.kind, producer, position, now)) continue;
      q.remaining--;
      if (!q.remaining)
        b.hostileTraining = b.hostileTraining!.filter(
          (entry) => entry.id !== q.id,
        );
      const next = hostileHead(b, owner, category);
      if (next) startHostileOrder(b, next, now);
    }
  }
}
/**
 * When an army has a column standing beyond its home guard, it marches on an
 * allied base. Nothing counts down for the players: the departure depends on
 * what the garrison has actually trained, paced by the difficulty's cadence.
 */
function launchCounterattack(b: Battle, now: number, obstacles: Footprint[]) {
  if (now < b.nextWaveAt) return;
  const armies = hostileArmies(b);
  if (!armies.length) return;
  const nextWave = b.wave + 1;
  // Nothing ready, or no route: look again shortly instead of waiting a whole cadence.
  b.nextWaveAt = now + 10000;
  const random = operationRandom(
    (b.seed ?? 0) ^ Math.imul(nextWave, 0x9e3779b9),
  );
  const rules = difficultyFor(b);
  /**
   * A commander's flag, which the column marches on to carry it off; on harder
   * settings sometimes the refineries, plants and outposts that feed the base.
   */
  const strike = ():
    | { owner: string; entity?: Entity; flag?: Flag }
    | undefined => {
    const commanders = b.commanders.filter(
      (c) => !commanderEliminated(b, c.id),
    );
    const victim = commanders[Math.floor(random() * commanders.length)];
    if (!victim) return undefined;
    if (random() < rules.raids) {
      const economy = b.entities.filter(
        (e) =>
          e.owner === victim.id &&
          e.hp > 0 &&
          !e.readyAt &&
          (e.kind === 'refinery' ||
            e.kind === 'outpost' ||
            e.kind === 'reactor'),
      );
      if (economy.length)
        return {
          owner: victim.id,
          entity: economy[Math.floor(random() * economy.length)],
        };
    }
    const flag = flagOf(b, victim.id);
    if (flag && flag.capturedAt === undefined)
      return { owner: victim.id, flag };
    const entity =
      b.entities.find((e) => e.owner === victim.id && e.kind === 'hq') ??
      b.entities.find((e) => e.owner === victim.id && !isUnit(e.kind));
    return entity && { owner: victim.id, entity };
  };
  const guards = hostileGuards(b),
    minimum = COLUMN_MINIMUM[b.difficulty ?? 'normal'];
  // The army with the largest ready column marches; the home guard nearest the station stays.
  const ready = armies
    .map((owner) => {
      const hq = hostileHq(b, owner);
      const mustered = hostileMustered(b, owner).sort(
        (a, z) => distance(z, hq) - distance(a, hq),
      );
      return {
        owner,
        column: mustered.slice(0, Math.max(0, mustered.length - guards)),
      };
    })
    .filter((army) => army.column.length >= minimum)
    .sort((a, z) => z.column.length - a.column.length);
  // Harder settings march several armies on one cadence, each choosing its own target.
  let marched = 0;
  for (const army of ready) {
    if (marched >= columnsFor(b)) break;
    const target = strike();
    if (!target) return;
    const lead = army.column[0];
    const path = target.entity
      ? pathToTarget(lead, target.entity, obstacles, terrainFor(b))
      : findPath(
          lead,
          grabSpot(target.flag!, lead),
          false,
          obstacles,
          terrainFor(b),
        );
    if (!path.length) continue;
    // Establish one reachable approach; the rest route over subsequent updates.
    // Requiring the whole column to route at once can exceed the work allowance.
    for (const e of army.column) {
      e.order = 'attackMove';
      e.orderAt = now - HUNT_RETRY_MS;
      e.path = e === lead ? path : [];
      if (target.entity) e.target = target.entity.id;
      else delete e.target;
    }
    marched++;
    const victim =
      b.commanders.find((c) => c.id === target.owner)?.name ??
      'the landing zones';
    const aim = target.entity ? spec(target.entity.kind).name : 'flag';
    logEvent(
      b,
      now,
      marched === 1
        ? `Enemy column ${nextWave} has left its base, advancing on ${victim}'s ${aim}.`
        : `Another column joins wave ${nextWave}, advancing on ${victim}'s ${aim}.`,
      'combat',
    );
  }
  if (!marched) return;
  b.wave = nextWave;
  b.nextWaveAt = now + rules.waveIntervalMs;
}
/** Troops that can pick up, carry or return a flag: living ground troops, never aircraft or harvesters. */
const holdsGround = (e: Entity) =>
  e.hp > 0 &&
  !e.readyAt &&
  isUnit(e.kind) &&
  !isAir(e.kind) &&
  !isHarvester(e.kind);
/** A standing spot inside a flag's home zone, spread per troop so a column fans out over it. */
function zoneSpot(flag: Flag, e: { id: string }): Point {
  return spreadAround(flagHome(flag), e, flag.radius * 0.2, flag.radius * 0.55);
}
/** A spot `min`..`max` metres from `p`, fixed per troop. */
function spreadAround(p: Point, e: { id: string }, min: number, max: number) {
  let h = 0;
  for (let i = 0; i < e.id.length; i++)
    h = (Math.imul(h, 31) + e.id.charCodeAt(i)) | 0;
  const angle = ((h >>> 0) % 360) * (Math.PI / 180),
    r = min + (((h >>> 9) % 100) / 100) * (max - min);
  return { x: p.x + Math.sin(angle) * r, z: p.z + Math.cos(angle) * r };
}
/** Where a raider stands to take a flag: close enough to the flag itself to pick it up. */
const grabSpot = (flag: Flag, e: { id: string }) =>
  spreadAround(flag, e, 0.5, PICKUP_RADIUS * 0.6);
/** Troops carrying a flag, mapped to the team whose flag they carry. */
function flagCarriers(b: Pick<Battle, 'flags'>) {
  const carriers = new Map<string, Flag>();
  for (const f of b.flags ?? []) {
    const id = carrierOf(f);
    if (id) carriers.set(id, f);
  }
  return carriers;
}
/**
 * Where a hostile column goes once it has nothing else to do: a carrier runs
 * for home, raiders near a carrier escort it, and the rest make for the
 * nearest allied flag still standing or lying on the field. Undefined: hunt.
 */
function raidGoal(
  b: Battle,
  e: Entity,
  carriers: Map<string, Flag>,
): { point: Point; slack: number } | undefined {
  const own = flagOf(b, e.owner);
  if (carriers.has(e.id))
    return own && own.capturedAt === undefined
      ? { point: zoneSpot(own, e), slack: own.radius * 0.5 }
      : undefined;
  let escort: Entity | undefined,
    near: number = difficultyFor(b).flagReach;
  for (const [id, f] of carriers) {
    if (f.team === e.team) continue;
    const c = b.entities.find((t) => t.id === id && t.team === e.team);
    if (c && distance(c, e) < near) {
      near = distance(c, e);
      escort = c;
    }
  }
  if (escort) return { point: spreadAround(escort, e, 3, 7), slack: 10 };
  let goal: Flag | undefined,
    best = Infinity;
  for (const f of b.flags ?? []) {
    if (f.team === e.team || f.capturedAt !== undefined) continue;
    if (f.team === 'blue' && commanderEliminated(b, f.owner)) continue;
    // A flag already on its way to our lines needs an escort, not a second raid.
    if (carrierOf(f)) continue;
    const d = distance(e, f);
    if (d < best) {
      best = d;
      goal = f;
    }
  }
  if (goal) return { point: grabSpot(goal, e), slack: PICKUP_RADIUS * 0.8 };
  // Every allied flag is on the move: fall in behind the nearest carrier.
  for (const [id, f] of carriers) {
    if (f.team === e.team) continue;
    const c = b.entities.find((t) => t.id === id && t.team === e.team);
    if (c && distance(c, e) < best) {
      best = distance(c, e);
      escort = c;
    }
  }
  return escort && { point: spreadAround(escort, e, 3, 7), slack: 10 };
}
/** The home guard of a hostile army falls back onto its flag zone. */
function defendFlag(b: Battle, flag: Flag, obstacles: Footprint[]) {
  const terrain = terrainFor(b),
    home = flagHome(flag);
  for (const e of b.entities) {
    if (
      e.owner !== flag.owner ||
      !holdsGround(e) ||
      (e.order !== 'stop' && e.order !== 'move') ||
      distance(e, home) <= flag.radius * 0.8 ||
      distance(e, home) > 90
    )
      continue;
    const path = findPath(e, zoneSpot(flag, e), false, obstacles, terrain);
    if (!path.length) continue;
    e.order = 'move';
    e.path = path;
  }
}
/** Walkable ground nearest `p`, for a flag dropped by a troop on a ford or bridge edge. */
function groundNear(b: Battle, p: Point): Point {
  const { groundAt } = terrainFor(b);
  if (groundAt(p.x, p.z)) return { x: p.x, z: p.z };
  for (let r = 1; r <= 12; r++)
    for (let a = 0; a < 16; a++) {
      const x = p.x + Math.sin((a / 16) * Math.PI * 2) * r,
        z = p.z + Math.cos((a / 16) * Math.PI * 2) * r;
      if (groundAt(x, z)) return { x, z };
    }
  return { x: p.x, z: p.z };
}
const flagLabel = (f: Flag) =>
  f.team === 'blue' ? `Your flag (${f.name})` : `${f.name}'s flag`;
function sendHome(f: Flag) {
  const home = flagHome(f);
  f.x = home.x;
  f.z = home.z;
  f.state = 'home';
  delete f.carrier;
  delete f.pickupBy;
  delete f.pickupProgress;
  delete f.droppedAt;
}
function dropFlag(b: Battle, f: Flag, at: Point, now: number) {
  const spot = groundNear(b, at);
  f.x = spot.x;
  f.z = spot.z;
  f.state = 'dropped';
  f.droppedAt = now;
  delete f.carrier;
  delete f.pickupBy;
  delete f.pickupProgress;
  logEvent(
    b,
    now,
    `${flagLabel(f)} dropped. ${f.team === 'blue' ? 'Touch it to return it.' : 'Pick it up again.'}`,
    f.team === 'blue' ? 'combat' : 'info',
  );
}
/** A carrier fell this update: its flag drops where it stood. Runs before the dead are cleared. */
function dropFallenFlags(b: Battle, now: number) {
  for (const f of b.flags ?? []) {
    const id = carrierOf(f);
    if (!id) continue;
    const carrier = b.entities.find((e) => e.id === id);
    if (!carrier || carrier.hp <= 0) dropFlag(b, f, carrier ?? f, now);
  }
}
/** The flag zone a carrier scores in: its own army's, or in co-op any standing allied commander's. */
function scoringZone(b: Battle, carrier: Entity) {
  return (b.flags ?? []).find(
    (f) =>
      f.capturedAt === undefined &&
      f.team === carrier.team &&
      (carrier.team === 'blue'
        ? !commanderEliminated(b, f.owner)
        : f.owner === carrier.owner) &&
      distance(carrier, flagHome(f)) <= f.radius,
  );
}
/** A flag brought home: its army collapses, every structure and troop at once. */
function captureFlag(b: Battle, flag: Flag, now: number) {
  sendHome(flag);
  flag.capturedAt = now;
  flag.progress = 0;
  flag.contested = false;
  for (const e of b.entities) if (e.owner === flag.owner) e.hp = 0;
  // Flags the collapsing army was carrying fall where their carriers stood.
  dropFallenFlags(b, now);
  b.entities = b.entities.filter((e) => e.hp > 0);
  b.training = b.training?.filter((q) => q.owner !== flag.owner);
  b.hostileTraining = b.hostileTraining?.filter((q) => q.owner !== flag.owner);
  logEvent(
    b,
    now,
    flag.team === 'red'
      ? `Flag captured: ${flag.name}. Its army collapses.`
      : `Flag captured: ${flag.name}. Their forces collapse.`,
    flag.team === 'red' ? 'success' : 'combat',
  );
}
/**
 * Carry the flag. An opposing ground troop at a home or dropped flag for
 * PICKUP_SECONDS takes it; the carrier scores by entering its own side's flag
 * zone, and the flag's army collapses. A dropped flag returns home when one of
 * its owner's troops touches it, or by itself after RETURN_SECONDS.
 */
function advanceFlags(
  b: Battle,
  now: number,
  dt: number,
  obstacles: Footprint[],
) {
  const carrying = new Set(flagCarriers(b).keys());
  const byId = new Map(b.entities.map((e) => [e.id, e]));
  const eliminated = (e: Entity) =>
    e.team === 'blue' && commanderEliminated(b, e.owner);
  for (const flag of b.flags ?? []) {
    // Rows stored before carrying existed: the flag stands on its pole.
    flag.homeX ??= flag.x;
    flag.homeZ ??= flag.z;
    flag.state ??= 'home';
    if (flag.capturedAt !== undefined) continue;
    if (flag.team === 'blue' && commanderEliminated(b, flag.owner)) {
      if (flag.state !== 'home') sendHome(flag);
      continue;
    }
    const home = flagHome(flag);
    // Enemy ground troops at the pole: raise the alarm; a hostile home guard falls back.
    if (
      (flag.alertAt === undefined || now - flag.alertAt >= FLAG_ALERT_MS) &&
      b.entities.some(
        (e) =>
          e.team !== flag.team &&
          holdsGround(e) &&
          distance(e, home) <= flag.radius,
      )
    ) {
      flag.alertAt = now;
      logEvent(
        b,
        now,
        flag.team === 'blue'
          ? `Your flag is under attack: ${flag.name}'s zone.`
          : `Closing on ${flag.name}'s flag.`,
        flag.team === 'blue' ? 'combat' : 'info',
      );
      if (flag.team === 'red') defendFlag(b, flag, obstacles);
    }
    if (flag.state === 'carried') {
      const carrier = byId.get(flag.carrier ?? '');
      if (!carrier || carrier.hp <= 0) {
        dropFlag(b, flag, carrier ?? flag, now);
        continue;
      }
      flag.x = carrier.x;
      flag.z = carrier.z;
      if (scoringZone(b, carrier)) captureFlag(b, flag, now);
      continue;
    }
    if (flag.state === 'dropped') {
      const rescuer = b.entities.find(
        (e) =>
          e.team === flag.team &&
          holdsGround(e) &&
          !eliminated(e) &&
          distance(e, flag) <= PICKUP_RADIUS,
      );
      if (rescuer || now - (flag.droppedAt ?? now) >= RETURN_SECONDS * 1000) {
        sendHome(flag);
        logEvent(
          b,
          now,
          `${flagLabel(flag)} returned${rescuer ? '' : ' on its own'}.`,
          flag.team === 'blue' ? 'success' : 'info',
        );
        continue;
      }
    }
    // Pickup: one opposing troop at a time, which must stay at the flag.
    const able = (e: Entity | undefined): e is Entity =>
      !!e &&
      e.team !== flag.team &&
      holdsGround(e) &&
      !eliminated(e) &&
      !carrying.has(e.id) &&
      distance(e, flag) <= PICKUP_RADIUS;
    let taker = flag.pickupBy ? byId.get(flag.pickupBy) : undefined;
    if (able(taker)) flag.pickupProgress = (flag.pickupProgress ?? 0) + dt;
    else {
      taker = undefined;
      let best = Infinity;
      for (const e of b.entities)
        if (able(e) && distance(e, flag) < best) {
          best = distance(e, flag);
          taker = e;
        }
      flag.pickupProgress = dt;
    }
    if (!taker) {
      delete flag.pickupBy;
      delete flag.pickupProgress;
      continue;
    }
    flag.pickupBy = taker.id;
    if (flag.pickupProgress < PICKUP_SECONDS - 1e-6) continue;
    flag.state = 'carried';
    flag.carrier = taker.id;
    flag.x = taker.x;
    flag.z = taker.z;
    delete flag.pickupBy;
    delete flag.pickupProgress;
    delete flag.droppedAt;
    carrying.add(taker.id);
    logEvent(
      b,
      now,
      flag.team === 'blue'
        ? `Your flag has been taken! ${spec(taker.kind).name} is carrying ${flag.name}'s flag.`
        : `${flag.name}'s flag taken! Bring it home.`,
      flag.team === 'blue' ? 'combat' : 'success',
    );
    // A carrier is scored the moment it stands in a scoring zone.
    if (scoringZone(b, taker)) captureFlag(b, flag, now);
  }
}
/** The flag zone a carrier runs for: its own, or in co-op the nearest standing allied one. */
function homeZoneFor(b: Battle, carrier: Entity) {
  const own = flagOf(b, carrier.owner);
  if (own && own.capturedAt === undefined) return own;
  if (carrier.team !== 'blue') return undefined;
  let best: Flag | undefined,
    near = Infinity;
  for (const f of b.flags ?? []) {
    if (
      f.team !== 'blue' ||
      f.capturedAt !== undefined ||
      commanderEliminated(b, f.owner)
    )
      continue;
    const d = distance(carrier, flagHome(f));
    if (d < near) {
      near = d;
      best = f;
    }
  }
  return best;
}
/**
 * A carrier leaves the fight: it runs for its home zone on its own, on either
 * side, and takes no orders until the flag is scored or dropped.
 */
function carriersRunHome(b: Battle, now: number, obstacles: Footprint[]) {
  const terrain = terrainFor(b);
  const byId = new Map(b.entities.map((e) => [e.id, e]));
  for (const [id, f] of flagCarriers(b)) {
    const c = byId.get(id);
    if (!c || c.team === f.team) continue;
    const zone = homeZoneFor(b, c);
    if (!zone) continue;
    const end = c.path[c.path.length - 1];
    if (
      c.order === 'move' &&
      end &&
      distance(end, flagHome(zone)) < zone.radius
    )
      continue;
    const path = findPath(c, zoneSpot(zone, c), false, obstacles, terrain);
    if (!path.length) continue;
    c.order = 'move';
    c.orderAt = now;
    c.path = path;
    delete c.target;
    delete c.pace;
  }
}
/** Whether this update is one the AI reconsiders its flag duties on. */
const onCadence = (every: number, now: number, dt: number) =>
  !every || Math.floor(now / every) !== Math.floor((now - dt * 1000) / every);
/**
 * Hostile flag play (carriers run home in carriersRunHome). When an allied
 * troop carries a hostile flag, the nearest troops of that army (and
 * any hostile troop within reach) hunt it; a dropped hostile flag is
 * retrieved. Harder settings reach farther, send more and react sooner.
 */
function hostileFlagTactics(
  b: Battle,
  now: number,
  dt: number,
  obstacles: Footprint[],
) {
  const terrain = terrainFor(b),
    rules = difficultyFor(b);
  const carriers = flagCarriers(b);
  const byId = new Map(b.entities.map((e) => [e.id, e]));
  // Hunters whose carrier fell go back to what they were doing.
  for (const e of b.entities) {
    if (e.team !== 'red' || e.order !== 'attack') continue;
    const t = e.target ? byId.get(e.target) : undefined;
    if (t && t.hp > 0 && carriers.has(t.id)) continue;
    const hq = b.entities.find(
      (h) => h.owner === e.owner && h.kind === 'hq' && h.hp > 0,
    );
    // Far from home it rejoins the raid; near home it guards again.
    e.order = !hq || distance(e, hq) > 60 ? 'attackMove' : 'stop';
    e.orderAt = now - HUNT_RETRY_MS;
    e.path = [];
    delete e.target;
  }
  if (!onCadence(rules.flagDutyMs, now, dt)) return;
  for (const f of b.flags ?? []) {
    if (f.team !== 'red' || f.capturedAt !== undefined) continue;
    const state = flagState(f);
    if (state === 'home') continue;
    const carrier = state === 'carried' ? byId.get(f.carrier ?? '') : undefined;
    if (state === 'carried' && !carrier) continue;
    const where: Point = carrier ?? f;
    const crew = b.entities
      .filter((e) => {
        if (
          e.team !== 'red' ||
          e.hp <= 0 ||
          e.readyAt ||
          !isUnit(e.kind) ||
          isHarvester(e.kind) ||
          carriers.has(e.id)
        )
          return false;
        // Its own army answers from farther away than a passing column.
        const reach = rules.flagReach * (e.owner === f.owner ? 1 : 0.6);
        if (distance(e, where) > reach) return false;
        if (!carrier) return holdsGround(e);
        const attack = attackOf(e);
        return !!attack && attack.versus[armorOf(carrier.kind)] > 0;
      })
      .sort((a, z) => distance(a, where) - distance(z, where))
      .slice(0, rules.flagHunters);
    for (const e of crew) {
      if (carrier) {
        if (e.order === 'attack' && e.target === carrier.id) continue;
        e.order = 'attack';
        e.orderAt = now;
        e.target = carrier.id;
        e.path = [];
        delete e.pace;
        continue;
      }
      const end = e.path[e.path.length - 1];
      if (distance(e, f) <= PICKUP_RADIUS * 0.8) continue;
      if (e.order === 'move' && end && distance(end, f) <= PICKUP_RADIUS * 0.8)
        continue;
      const path = findPath(e, grabSpot(f, e), false, obstacles, terrain);
      if (!path.length) continue;
      e.order = 'move';
      e.orderAt = now;
      e.path = path;
      delete e.target;
      delete e.pace;
    }
  }
}
/*
 * Tech sites (lib/tactical-sites.ts). Infantry take a site by holding its ring
 * uncontested; the holding side draws the bonus; fire knocks a site back to
 * neutral, never to ruin. The garrison sends small detachments to take them.
 */
/** Foundations keep this clear of a tech site's structure, so its ring stays reachable. */
export const SITE_CLEARANCE = 4;
/** Whether a hostile troop is detached to a tech site, and so not waiting for a column. */
const onSiteDuty = (b: Pick<Battle, 'sites'>, id: string) =>
  !!b.sites?.some((s) => s.squad?.includes(id));
/** The site a troop can fire on: an enemy-held one in reach that it was sent against or is sweeping past. */
function siteInRange(
  b: Pick<Battle, 'sites'>,
  e: Entity,
  attack: { range: number; minRange?: number; versus: Versus },
) {
  if (!isUnit(e.kind) || attack.versus.structure <= 0) return undefined;
  if (e.order !== 'attackMove' && e.order !== 'attack') return undefined;
  for (const site of b.sites ?? []) {
    if (!site.team || site.team === e.team || site.hp <= 0) continue;
    if (e.order === 'attack' && e.target !== site.id) continue;
    const reach = siteReach(site, e);
    if (reach <= attack.range && distance(site, e) >= (attack.minRange ?? 0))
      return site;
  }
  return undefined;
}
/** The commander or hostile army a held site works for; another ally takes over from a fallen holder. */
function siteBeneficiary(b: Battle, site: TechSite) {
  if (site.team === 'red') {
    const armies = hostileArmies(b);
    return armies.includes(site.holder ?? '') ? site.holder : armies[0];
  }
  const living = b.commanders.filter((c) => !commanderEliminated(b, c.id));
  return (living.find((c) => c.id === site.holder) ?? living[0])?.id;
}
const siteHolderName = (b: Battle, site: TechSite) =>
  site.team === 'red'
    ? 'the enemy'
    : (b.commanders.find((c) => c.id === site.holder)?.name ?? 'the coalition');
/** Where an airstrip's recon plane circles: the holder's air rally, any rally, or the map centre. */
function reconGoal(
  b: Battle,
  site: TechSite,
  holder: string | undefined,
): Point {
  if (site.team === 'blue' && holder) {
    const producers = b.entities.filter(
      (e) => e.owner === holder && e.hp > 0 && !e.readyAt && e.rally,
    );
    const rally = (producers.find((e) => e.kind === 'airfield') ?? producers[0])
      ?.rally;
    if (rally) return rally;
  }
  const { minX, maxX, minZ, maxZ } = terrainFor(b).bounds;
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}
function captureSite(
  b: Battle,
  site: TechSite,
  team: SiteTeam,
  holder: string,
  now: number,
) {
  const was = site.team;
  site.team = team;
  site.holder = holder;
  site.heldAt = now;
  site.progress = 0;
  delete site.capturing;
  delete site.contested;
  site.pulseAt =
    site.kind === 'derrick'
      ? now + TECH_SITES.derrick.pulseSeconds * 1000
      : site.kind === 'airstrip'
        ? now + TECH_SITES.airstrip.firstPlaneSeconds * 1000
        : undefined;
  if (site.pulseAt === undefined) delete site.pulseAt;
  if (team === 'blue')
    logEvent(
      b,
      now,
      `${site.name} captured by ${siteHolderName(b, site)}: ${siteBonusText(b, site).bonus}.`,
      'success',
    );
  else
    logEvent(
      b,
      now,
      was === 'blue'
        ? `${site.name} lost to the enemy.`
        : `The enemy has taken ${site.name}.`,
      'combat',
    );
}
/** A site shot down to 0 HP is knocked back to neutral at full strength. */
function revertSite(b: Battle, site: TechSite, now: number) {
  const was = site.team;
  site.hp = siteSpec(site).hp;
  site.progress = 0;
  delete site.team;
  delete site.holder;
  delete site.heldAt;
  delete site.pulseAt;
  delete site.capturing;
  delete site.contested;
  if (was)
    logEvent(
      b,
      now,
      was === 'blue'
        ? `${site.name} knocked out. It reverts to neutral.`
        : `${site.name} knocked out. The enemy has lost it.`,
      was === 'blue' ? 'combat' : 'success',
    );
}
/** A held site's bonus for this update. */
function siteBonus(b: Battle, site: TechSite, now: number, dt: number) {
  const holder = siteBeneficiary(b, site);
  if (site.kind === 'fieldHospital') {
    const { healRadius, healPerSecond } = TECH_SITES.fieldHospital;
    for (const e of b.entities) {
      if (
        e.team !== site.team ||
        e.hp <= 0 ||
        e.readyAt ||
        !isUnit(e.kind) ||
        categoryOf(e.kind) !== 'infantry'
      )
        continue;
      const max = spec(e.kind).hp;
      if (e.hp < max && distance(e, site) <= healRadius)
        e.hp = Math.min(max, e.hp + max * healPerSecond * dt);
    }
    return;
  }
  if (site.pulseAt === undefined || site.pulseAt > now || !holder) return;
  if (site.kind === 'derrick') {
    const { pulseSeconds, hostileHasteSeconds } = TECH_SITES.derrick;
    const income = derrickIncome(b);
    site.pulseAt += pulseSeconds * 1000;
    if (site.pulseAt <= now) site.pulseAt = now + pulseSeconds * 1000;
    if (site.team === 'blue') {
      const c = b.commanders.find((c) => c.id === holder);
      if (c)
        c.credits = Math.max(
          c.credits,
          Math.min(CREDIT_CAP, c.credits + income),
        );
    } else if (b.garrisonFunds)
      // A funded garrison banks the oil money like a commander.
      fundGarrison(b, holder, income / difficultyFor(b).production);
    else
      for (const q of b.hostileTraining ?? [])
        if (q.owner === holder && q.readyAt > now)
          q.readyAt = Math.max(now, q.readyAt - hostileHasteSeconds * 1000);
    return;
  }
  site.pulseAt = now + TECH_SITES.airstrip.planeSeconds * 1000;
  (b.recon ??= []).push(
    planFlight(
      site,
      reconGoal(b, site, holder),
      terrainFor(b).bounds,
      now,
      `r${++b.serial}`,
      site.team!,
      holder,
    ),
  );
  if (site.team === 'blue')
    logEvent(b, now, `Recon plane up from ${site.name}.`);
}
/**
 * Capture, knock-out and bonuses. A side whose infantry stand in a site's ring
 * with no enemy ground troops inside counts up to `captureSeconds` and takes
 * it; enemy troops in the ring pause the count; an empty ring (or the holder
 * back in it) drains the count.
 */
function advanceSites(b: Battle, now: number, dt: number) {
  if (b.recon?.length) b.recon = b.recon.filter((f) => f.goneAt > now);
  if (!b.sites?.length) return;
  const eliminated = new Set(
    b.commanders.filter((c) => commanderEliminated(b, c.id)).map((c) => c.id),
  );
  for (const site of b.sites) {
    if (site.hp <= 0) revertSite(b, site, now);
    const ground = { blue: 0, red: 0 };
    const infantry = {
      blue: new Map<string, number>(),
      red: new Map<string, number>(),
    };
    for (const e of b.entities) {
      if (!holdsGround(e) || eliminated.has(e.owner)) continue;
      if (distance(e, site) > SITE_RULES.captureRadius) continue;
      ground[e.team]++;
      if (categoryOf(e.kind as UnitKind) === 'infantry')
        infantry[e.team].set(e.owner, (infantry[e.team].get(e.owner) ?? 0) + 1);
    }
    const taker = (['blue', 'red'] as const).find(
      (team) => team !== site.team && infantry[team].size,
    );
    const opposed = ground.blue > 0 && ground.red > 0;
    if (opposed && (taker || site.progress > 0)) site.contested = true;
    else delete site.contested;
    if (opposed) {
      // Contested: the count holds where it is.
    } else if (taker) {
      if (site.capturing !== taker) {
        site.capturing = taker;
        site.progress = 0;
        if (
          site.team === 'blue' &&
          (site.alertAt === undefined ||
            now - site.alertAt >= SITE_RULES.alertMs)
        ) {
          site.alertAt = now;
          logEvent(
            b,
            now,
            `${site.name} is being taken by the enemy!`,
            'combat',
          );
        }
      }
      site.progress = Math.min(SITE_RULES.captureSeconds, site.progress + dt);
      if (site.progress >= SITE_RULES.captureSeconds - 1e-6) {
        // The army with the most infantry in the ring holds it.
        const holder = [...infantry[taker]].sort((a, z) => z[1] - a[1])[0][0];
        captureSite(b, site, taker, holder, now);
      }
    } else if (site.progress > 0) {
      site.progress = Math.max(
        0,
        site.progress - SITE_RULES.drainPerSecond * dt,
      );
      if (!site.progress) delete site.capturing;
    }
    if (site.team) siteBonus(b, site, now, dt);
  }
  // Troops sent against a site stand down once it is no longer the enemy's.
  for (const e of b.entities) {
    if (e.order !== 'attack' || !e.target?.startsWith('site-')) continue;
    const site = b.sites.find((s) => s.id === e.target);
    if (site?.team && site.team !== e.team) continue;
    e.order = 'stop';
    e.path = [];
    delete e.target;
  }
}
/** Seconds between a detachment's checks that its troops still stand in the ring. */
const SITE_GUARD_MS = 3000;
/**
 * The garrison contests tech sites. Every `siteDutyMs` an army with troops to
 * spare beyond its home guard sends `siteSquad` infantry to the nearest site it
 * does not hold quietly; the detachment takes the site and stays to guard it.
 * A column about to march is never stripped below its minimum.
 */
function hostileSiteTactics(
  b: Battle,
  now: number,
  dt: number,
  obstacles: Footprint[],
) {
  const rules = difficultyFor(b),
    mode = skirmishRules(b);
  if (!b.sites?.length || !rules.siteSquad) return;
  const squad = rules.siteSquad + mode.siteSquadBonus;
  const terrain = terrainFor(b);
  const byId = new Map(b.entities.map((e) => [e.id, e]));
  const ring = SITE_RULES.captureRadius;
  const spot = (site: TechSite, e: Entity) =>
    spreadAround(site, e, 7, ring * 0.7);
  for (const site of b.sites) {
    if (!site.squad) continue;
    site.squad = site.squad.filter((id) => {
      const e = byId.get(id);
      return !!e && e.hp > 0;
    });
    if (!site.squad.length) {
      delete site.squad;
      continue;
    }
    if (!onCadence(SITE_GUARD_MS, now, dt)) continue;
    // Guards drawn off by a fight walk back into the ring.
    for (const id of site.squad) {
      const e = byId.get(id)!;
      if (
        e.order !== 'stop' ||
        e.path.length ||
        distance(e, site) <= ring * 0.9
      )
        continue;
      const path = findPath(e, spot(site, e), false, obstacles, terrain);
      if (!path.length) continue;
      e.order = 'move';
      e.orderAt = now;
      e.path = path;
    }
  }
  if (!onCadence(Math.round(rules.siteDutyMs * mode.siteDutyScale), now, dt))
    return;
  // Where sites are the economy, a detachment may draw on part of the home guard.
  const guards = Math.ceil(hostileGuards(b) * (1 - mode.siteGuardShare)),
    minimum = COLUMN_MINIMUM[b.difficulty ?? 'normal'];
  const armies = hostileArmies(b);
  // The mode's priority kinds rank first: a detachment goes for oil before a hospital.
  const rank = (s: TechSite) => {
    const i = mode.sitePriority.indexOf(s.kind);
    return i < 0 ? mode.sitePriority.length : i;
  };
  // One detachment per duty: the open site nearest any hostile command station.
  const open = b.sites
    .filter((s) => !s.squad?.length && (s.team !== 'red' || s.contested))
    .map((site) => {
      const hq = armies
        .map((owner) => hostileHq(b, owner))
        .sort((a, z) => distance(a, site) - distance(z, site))[0];
      return { site, hq };
    })
    .filter((o) => o.hq)
    .sort(
      (a, z) =>
        rank(a.site) - rank(z.site) ||
        distance(a.site, a.hq) - distance(z.site, z.hq),
    );
  for (const { site, hq } of open) {
    const mustered = hostileMustered(b, hq.owner);
    const spare = mustered.length - guards - squad;
    if (spare < 0 || (now >= b.nextWaveAt - 15000 && spare < minimum)) continue;
    const infantry = mustered
      .filter(
        (e) => holdsGround(e) && categoryOf(e.kind as UnitKind) === 'infantry',
      )
      .sort((a, z) => distance(a, site) - distance(z, site));
    if (infantry.length < squad) continue;
    const sent: string[] = [];
    // A rare, bounded dispatch gets its own search allowance, so a crowded
    // muster ground (a Weather Mast beside the exit) cannot send it short.
    withRoutingBudget(() => {
      for (const e of infantry) {
        if (sent.length >= squad) break;
        const path = findPath(e, spot(site, e), false, obstacles, terrain);
        if (!path.length) continue;
        e.order = 'move';
        e.orderAt = now;
        e.path = path;
        delete e.target;
        delete e.pace;
        sent.push(e.id);
      }
    }, squad);
    if (!sent.length) continue;
    site.squad = sent;
    return;
  }
}
/** Server-authoritative simulation. Wall time is never supplied by clients. */
export function tickBattle(b: Battle, now: number) {
  return withRoutingBudget(() => advanceBattle(b, now));
}
function advanceBattle(b: Battle, now: number) {
  if (b.status !== 'active') return;
  // Sectors from before the hand-built maps have no battlefield left to load.
  if ((b.mapVersion ?? 0) < MAP_VERSION) {
    b.status = 'defeat';
    b.tickAt = now;
    logEvent(b, now, RETIRED_MAP_EVENT, 'info');
    return;
  }
  const dt = Math.min(2, Math.max(0, (now - b.tickAt) / 1000));
  if (!dt) return;
  b.tickAt = now;
  b.deposits ??= sectorDeposits();
  migrateTraining(b);
  eliminateCommanders(b, now);
  for (const e of b.entities)
    if (e.hp > 0 && e.readyAt && e.readyAt <= now) {
      e.readyAt = 0;
      logEvent(b, now, `${spec(e.kind).name} ready.`);
      if (e.kind === 'refinery' && e.team === 'blue' && skirmishRules(b).ore) {
        const position = spawnNear(b, productionExit(e), false);
        if (
          !battleHasRoom(b) ||
          fieldCount(b, e.owner).harvesters >= harvesterLimit(b, e.owner)
        )
          logEvent(
            b,
            now,
            `Refinery online; no room for an additional harvester.`,
          );
        else if (position) {
          deployUnit(b, e.owner, 'harvester', e, position, now);
          logEvent(b, now, 'Malm harvester delivered with the refinery.');
        }
      }
    }
  for (const c of b.commanders) {
    if (c.eliminatedAt !== undefined) continue;
    if (c.researching && c.researching.readyAt <= now) {
      c.research = [...(c.research ?? []), c.researching.key];
      logEvent(
        b,
        now,
        `${RESEARCH[c.researching.key as ResearchKey]?.name ?? 'Research'} complete.`,
        'success',
      );
      delete c.researching;
    }
    startNextResearch(b, c, now);
  }
  advanceTraining(b, now);
  planHostileProduction(b, now);
  advanceHostileTraining(b, now);
  const powerOk = new Map<string, boolean>();
  for (const c of b.commanders) {
    const power = powerFor(b, c.id);
    powerOk.set(c.id, power.used <= power.capacity);
    if (b.entities.some((e) => e.owner === c.id && e.kind === 'hq'))
      c.credits = Math.max(c.credits, Math.min(CREDIT_CAP, c.credits + dt));
  }
  const { garrison } = skirmishRules(b);
  if (garrison && b.garrisonFunds)
    for (const owner of hostileArmies(b))
      fundGarrison(
        b,
        owner,
        (garrison.stipend * dt) / difficultyFor(b).production,
      );
  const obstacles = movementObstacles(b);
  const eliminated = new Set(
    b.commanders.filter((c) => c.eliminatedAt !== undefined).map((c) => c.id),
  );
  const spatial = new TacticalSpatialIndex(b.entities);
  const byId = new Map(b.entities.map((e) => [e.id, e]));
  // A troop running off with its own side's flag is everyone's first target.
  const carriers = flagCarriers(b);
  const urgent = (e: Entity, t: Entity) => carriers.get(t.id)?.team === e.team;
  // Rotate routing priority so a blocked unit cannot monopolize every tick's searches.
  const offset =
    b.entities.length > 128
      ? (ROUTE_SEARCH_BUDGET * Math.floor(now / TACTICAL_TICK_MS)) %
        b.entities.length
      : 0;
  const turn = [...b.entities.slice(offset), ...b.entities.slice(0, offset)];
  for (const e of turn) {
    try {
      if (e.hp <= 0 || e.readyAt || eliminated.has(e.owner)) continue;
      const stepDt = Math.min(dt, Math.max(0, (now - (e.orderAt ?? 0)) / 1000));
      if (frozen(e, now)) continue;
      // Medics and workshops restore troops that stand still and out of the fight,
      // whatever order brought them there (an attack-move arrival stays 'attackMove').
      if (
        e.team === 'blue' &&
        !e.path.length &&
        e.order !== 'harvest' &&
        (!e.firedAt || now - e.firedAt > 5000) &&
        e.hp < spec(e.kind).hp
      ) {
        const rate = regenRateFor(b, e);
        if (rate)
          e.hp = Math.min(spec(e.kind).hp, e.hp + spec(e.kind).hp * rate * dt);
      }
      if (isHarvester(e.kind)) {
        if (e.order === 'harvest') harvest(b, e, stepDt, now, obstacles);
        else if (e.order === 'move') {
          walk(e, stepDt, obstacles, speedScaleFor(b, e), terrainFor(b));
          if (!e.path.length) e.order = 'stop';
        } else if (nearestDeposit(b, e)) {
          // Idle harvesters go back to work by themselves once ore is within reach.
          e.order = 'harvest';
          delete e.target;
        }
        continue;
      }
      const attack = attackFor(b, e);
      if (!attack) continue;
      const candidate = e.target ? byId.get(e.target) : undefined;
      const requested =
        candidate && candidate.hp > 0 && !candidate.readyAt
          ? candidate
          : undefined;
      let enemy: Entity | undefined;
      if (requested && canEngage(e, attack, requested)) enemy = requested;
      else {
        let best = Infinity,
          priority = false;
        for (const t of spatial.near(e, attack.range)) {
          if (!canEngage(e, attack, t)) continue;
          const d = distance(e, t),
            first = urgent(e, t);
          if ((first && !priority) || (first === priority && d < best)) {
            best = d;
            enemy = t;
            priority = first;
          }
        }
      }
      const hasPower = e.team === 'red' || powerOk.get(e.owner) !== false;
      // With no troop or structure to shoot, an enemy-held tech site in reach.
      const site = enemy ? undefined : siteInRange(b, e, attack);
      // Troops fire on the move. Only fighting orders hold position for a target
      // in range; a plain move, or an attack on a target still out of reach,
      // keeps walking while the guns work.
      const holds =
        (!!enemy &&
          (e.order === 'attackMove' ||
            e.order === 'stop' ||
            e.order === 'hold' ||
            (e.order === 'attack' && enemy === requested))) ||
        !!site;
      if (!holds) {
        if (
          e.order === 'attack' &&
          requested &&
          (!e.path.length || distance(e.path[e.path.length - 1], requested) > 8)
        )
          e.path = pathToTarget(e, requested, obstacles, terrainFor(b));
        if (e.order === 'stop' && isUnit(e.kind)) {
          let threat: Entity | undefined,
            best = 28,
            priority = false;
          for (const t of spatial.near(e, 28)) {
            if (
              t.team === e.team ||
              t.hp <= 0 ||
              t.readyAt > 0 ||
              attack.versus[armorOf(t.kind)] <= 0
            )
              continue;
            const d = distance(e, t),
              first = urgent(e, t);
            if ((first && !priority) || (first === priority && d < best)) {
              best = d;
              threat = t;
              priority = first;
            }
          }
          if (!threat) e.path = [];
          else if (
            !e.path.length ||
            distance(e.path[e.path.length - 1], threat) > 6
          )
            e.path = pathToTarget(e, threat, obstacles, terrainFor(b));
        }
        // Counterattack columns never go idle: once they have arrived, or their
        // target is gone, they hunt the nearest allied structure, then the last
        // units. The garrison (order 'stop') keeps guarding the hostile base.
        if (
          e.team === 'red' &&
          e.order === 'attackMove' &&
          !e.path.length &&
          now - (e.orderAt ?? 0) >= HUNT_RETRY_MS
        ) {
          // With the target gone, the column goes after the nearest allied
          // flag, escorts a carrier home, or carries one itself; only
          // without flags in play does it hunt.
          const goal = requested ? undefined : raidGoal(b, e, carriers);
          if (goal) {
            if (distance(e, goal.point) > goal.slack) {
              e.orderAt = now;
              e.path = findPath(e, goal.point, false, obstacles, terrainFor(b));
            }
          } else {
            const prey = requested ?? huntTarget(b, e, attack);
            if (prey) {
              e.orderAt = now;
              e.path = pathToTarget(e, prey, obstacles, terrainFor(b));
            }
          }
        }
        walk(e, stepDt, obstacles, speedScaleFor(b, e), terrainFor(b));
        if (e.order === 'move' && !e.path.length) e.order = 'stop';
      }
      if (enemy) {
        const facing = Math.atan2(enemy.x - e.x, enemy.z - e.z);
        if (!isUnit(e.kind)) e.angle = facing;
        else if (holds || !e.path.length) {
          // Standing to fight: turreted hulls stay put while the turret aims;
          // everything else swings round at its own turn rate.
          delete e.v;
          if (!UNITS[e.kind].turret)
            e.angle = turnToward(e.angle, facing, UNITS[e.kind].turn * stepDt);
        }
        if (hasPower) {
          enemy.hp -= damageAgainst(b, e, enemy, attack) * stepDt;
          e.firedAt = now;
          e.shotX = enemy.x;
          e.shotZ = enemy.z;
        }
      } else if (site) {
        delete e.v;
        if (!UNITS[e.kind as UnitKind].turret)
          e.angle = turnToward(
            e.angle,
            Math.atan2(site.x - e.x, site.z - e.z),
            UNITS[e.kind as UnitKind].turn * stepDt,
          );
        if (hasPower) {
          site.hp -=
            damageAgainstArmor(b, e, 'structure', site.holder ?? '', attack) *
            stepDt;
          e.firedAt = now;
          e.shotX = site.x;
          e.shotZ = site.z;
        }
      }
    } finally {
      spatial.update(e);
    }
  }
  // A fallen command station no longer takes its force with it: the flag is
  advanceSuperweapons(b, now, dt, (owner) => powerOk.get(owner) !== false);
  // the objective. Without it the army cannot train or build new foundations.
  for (const dead of b.entities.filter((e) => e.hp <= 0))
    logEvent(
      b,
      now,
      `${dead.team === 'blue' ? 'Allied' : 'Hostile'} ${spec(dead.kind).name} destroyed.`,
      'combat',
    );
  dropFallenFlags(b, now);
  b.entities = b.entities.filter((e) => e.hp > 0);
  separateTroops(b, obstacles);
  advanceFlags(b, now, dt, obstacles);
  advanceSites(b, now, dt);
  // Flag and site duties route on their own allowance, like a column's launch.
  withRoutingBudget(() => {
    carriersRunHome(b, now, obstacles);
    hostileFlagTactics(b, now, dt, obstacles);
    hostileSiteTactics(b, now, dt, obstacles);
  }, ROUTE_SEARCH_BUDGET + 1);
  eliminateCommanders(b, now);
  // Retired capture data can remain in old saves, but has no gameplay effect.
  b.objectives = [];
  // A busy update must not starve the launch: the leads route on their own allowance.
  withRoutingBudget(
    () => launchCounterattack(b, now, obstacles),
    Math.max(ROUTE_SEARCH_BUDGET, columnsFor(b)),
  );
  const hostileFlags = (b.flags ?? []).filter((f) => f.team === 'red');
  if (b.commanders.length && alliesDefeated(b)) {
    b.status = 'defeat';
    logEvent(
      b,
      now,
      hostileFlags.length
        ? 'Every allied flag has fallen. Operation ended.'
        : 'All allied buildings lost. Operation ended.',
      'combat',
    );
  } else if (
    hostileFlags.length
      ? hostileFlags.every((f) => f.capturedAt !== undefined)
      : !b.entities.some((e) => e.team === 'red' && e.hp > 0)
  ) {
    b.status = 'victory';
    logEvent(
      b,
      now,
      hostileFlags.length
        ? 'Every enemy flag captured. The fjord is ours.'
        : 'All enemy forces destroyed. The fjord is ours.',
      'success',
    );
  } else if (now - b.startedAt > OPERATION_MINUTES * 60 * 1000) {
    b.status = 'defeat';
    logEvent(
      b,
      now,
      `The ${OPERATION_MINUTES}-minute operation window has closed.`,
      'combat',
    );
  }
}
