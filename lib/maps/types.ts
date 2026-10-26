/**
 * Hand-built battlefields. A map is authored data: outlines, paths and slots in
 * metres. `compileMap` in `./compile.ts` turns one design into the pure query
 * functions (`terrainAt`, `heightAt`, `groundAt`, ...) that the Convex
 * simulation, placement rules, pathfinding, minimap and renderer all share.
 *
 * Coordinates: x runs west to east, z runs north (negative) to south
 * (positive). Commanders land in the south; hostile strongholds hold the north.
 */
export type Point = { x: number; z: number };

/** The hand-built maps, in menu order. */
export const mapIds = [
  'fjordmouth',
  'ironpass',
  'glaciercrown',
  'skerryharbour',
  'nordlys',
] as const;
export type MapId = (typeof mapIds)[number];
/** Procedural maps retired with MAP_VERSION 8; old saved rows may still carry them. */
export const legacyMapIds = [
  'skerry',
  'frostgate',
  'amberfen',
  'cinderreach',
] as const;
export type LegacyMapId = (typeof legacyMapIds)[number];
/** Any map id a stored sector or lobby may carry. */
export type StoredMapId = MapId | LegacyMapId;
export type Polygon = Point[];

export type CrossingStyle =
  | 'steel'
  | 'suspension'
  | 'timber'
  | 'pontoon'
  | 'causeway'
  | 'viaduct'
  | 'ford';

/** A crossing over a river segment. Length spans the water plus both banks. */
export type CrossingDesign = Point & {
  id: string;
  name: string;
  style: CrossingStyle;
  /** Deck heading in radians; 0 runs north-south (along z). */
  angle: number;
  width: number;
  length: number;
};

/** A walkable slope from `from` (low end) to `to` (on the plateau). */
export type RampDesign = { from: Point; to: Point; width: number };

export type PlateauDesign = {
  name?: string;
  outline: Polygon;
  /** Height above the surrounding ground, in metres. */
  height: number;
  /** Width of the impassable cliff band on the rim, in metres. */
  cliff: number;
  ramps: RampDesign[];
};

export type RiverDesign = {
  path: Point[];
  /** Full water width in metres (may vary: one entry per path point, or one number). */
  width: number | number[];
  depth: number;
};

export type WaterBodyDesign = { outline: Polygon; depth: number };

export type ForestDesign = {
  outline: Polygon;
  /** Trees per 100 m²; 1.5 is a dense stand. */
  density: number;
  species?: 'spruce' | 'birch' | 'pine' | 'mixed';
};

export type RoadDesign = {
  path: Point[];
  width: number;
  surface: 'gravel' | 'paved' | 'rail';
};

export type OreDesign = Point & {
  name: string;
  /** Credits in the seam. Home seams beside each landing are added by the compiler. */
  amount: number;
  /** Rich seams glow gold and are guarded by a sentry at world generation. */
  rich?: boolean;
};

export type LandmarkDesign = Point & { name: string; description: string };

/** Sponsor billboards: rendered with active sponsor names, rotating; never block movement. */
export type BillboardDesign = Point & {
  angle: number;
  size: 'hoarding' | 'tower' | 'banner';
  /** Uniform size multiplier; the landing billboards stand larger. */
  scale?: number;
};

/** Decorative set pieces (non-blocking unless `solid`). Kinds map to GLBs in public/models/props. */
export type PropKind =
  | 'lighthouse'
  | 'ruin'
  | 'windmill'
  | 'radio_mast'
  | 'wreck_tank'
  | 'wreck_plane'
  | 'fishing_hut'
  | 'boat'
  | 'crane'
  | 'fuel_tanks'
  | 'rail_wagon'
  | 'statue'
  | 'watch_hut';
export type PropDesign = Point & {
  kind: PropKind;
  angle: number;
  scale?: number;
  solid?: boolean;
};

/** Neutral tech sites (lib/tactical-sites.ts): capturable bonus structures. */
export type TechSiteKind = 'derrick' | 'fieldHospital' | 'airstrip';
export type TechSiteDesign = Point & {
  kind: TechSiteKind;
  name: string;
  /** Heading of the model in radians; 0 faces south (+z). */
  angle?: number;
  /** A side's own derrick, held from the start: `landing-<slot>` or a hostile army. */
  home?: string;
};

export type StrongholdDesign = Point & {
  /** Heading (radians) from the stronghold toward the player's landings. */
  facing: number;
  /** Radius of the ground the hostile base may occupy. */
  radius: number;
  name: string;
};

export type SurfacePalette = {
  snow: string;
  grass: string;
  earth: string;
  gravel: string;
  rock: string;
  cliff: string;
  sand: string;
  marsh: string;
  road: string;
  shallow: string;
  deep: string;
  foam: string;
};

export type AtmosphereDesign = {
  /** Sun colour and direction (vector toward the sun, y up). */
  sun: string;
  sunDirection: [number, number, number];
  sunIntensity: number;
  sky: string;
  horizon: string;
  /** Hemisphere ground bounce colour. */
  bounce: string;
  fog: string;
  fogDensity: number;
  /** 0 no snow on ground, 1 fully snow-covered lowland. */
  snowCover: number;
  weather: 'clear' | 'snowfall' | 'blizzard' | 'aurora' | 'embers';
  /** Colour grading target: amber golden hour, rose dawn, violet dusk, grey-green overcast, cyan arctic. */
  grade: 'golden' | 'dawn' | 'dusk' | 'overcast' | 'arctic';
  exposure: number;
};

/** A slow cinematic dolly for the home screen's live attract mode. */
export type CameraShot = {
  from: [number, number, number];
  to: [number, number, number];
  lookAt: [number, number, number];
  seconds: number;
};

export type MapDesign = {
  id: MapId;
  name: string;
  tagline: string;
  description: string;
  biome: string;
  features: string[];
  accent: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  capacity: { players: number; enemies: number };
  /** Player landing zones in fill order; at least `capacity.players`. */
  landings: Point[];
  /** Hostile bases in fill order; at least `capacity.enemies`. */
  strongholds: StrongholdDesign[];
  /** Rolling lowland: mean height and gentle noise amplitude. */
  ground: { height: number; roll: number; seed: number };
  plateaus: PlateauDesign[];
  rivers: RiverDesign[];
  lakes: WaterBodyDesign[];
  /** Open sea regions; the sea is impassable and never buildable. */
  seas: WaterBodyDesign[];
  crossings: CrossingDesign[];
  marshes: Polygon[];
  forests: ForestDesign[];
  roads: RoadDesign[];
  ore: OreDesign[];
  landmarks: LandmarkDesign[];
  billboards: BillboardDesign[];
  props: PropDesign[];
  /** Two to four tech sites on contested ground, mirrored where the landings are. */
  techSites: TechSiteDesign[];
  palette: SurfacePalette;
  atmosphere: AtmosphereDesign;
  shots: CameraShot[];
};

export type Terrain =
  | 'land'
  | 'plateau'
  | 'shore'
  | 'bank'
  | 'marsh'
  | 'ford'
  | 'ramp'
  | 'bridge'
  | 'road'
  | 'river'
  | 'lake'
  | 'cliff'
  | 'sea'
  | 'void';

/** Water surfaces render at this height; beds lie below it and dry ground above. */
export const WATER_LEVEL = 0;

/**
 * The compiled map every consumer shares. The simulation only relies on the
 * query functions, `baseAt`, `bounds` and `riverBridges`; the renderer reads
 * `design` for water, forests, roads, props, billboards, palette and light.
 * Every function is pure and deterministic: the Convex tick and the browser
 * must agree to the centimetre.
 */
export type CompiledMap = {
  mapId: MapId;
  design: MapDesign;
  layoutVersion: 8;
  /** Kept for old call sites; hand-built maps never rescale. */
  scale: 1;
  bounds: MapDesign['bounds'];
  landmarks: LandmarkDesign[];
  baseAt: (slot: number) => Point;
  strongholdAt: (slot: number) => StrongholdDesign;
  terrainAt: (x: number, z: number) => Terrain;
  heightAt: (x: number, z: number) => number;
  /** Ground troops can stand here. */
  groundAt: (x: number, z: number) => boolean;
  /** Ground speed multiplier; zero is impassable. */
  terrainSpeed: (x: number, z: number) => number;
  /** Firm, dry, level ground for foundations. */
  buildableAt: (x: number, z: number) => boolean;
  /** Open water or a ford: decoration keeps off it. */
  wetAt: (x: number, z: number) => boolean;
  riverBridges: () => CrossingDesign[];
  /** Home ore beside a landing: the same offset for every landing. */
  homeOreAt: (slot: number) => Point;
  /** Spacing of the ground routing grid in metres; larger maps route coarser. */
  navigationStep: number;
  /** Bake the whole 1 m lattice (idempotent) and return it, e.g. for terrain meshes. */
  grid: () => TerrainGrid;
};

export type TerrainGrid = {
  /** Lattice points per row (x) and per column (z); spacing is one metre. */
  width: number;
  depth: number;
  minX: number;
  minZ: number;
  heights: Float32Array;
  /** Index into `TERRAIN_CODES` (lib/maps/compile.ts). */
  terrain: Uint8Array;
};
