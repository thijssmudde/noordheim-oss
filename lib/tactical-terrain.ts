import {
  DEFAULT_MAP_ID,
  mapFor,
  type CompiledMap,
  type CrossingDesign,
  type LandmarkDesign,
  type Point,
  type Terrain,
} from './maps';

/**
 * The battlefield geography shared by the Convex simulation, placement,
 * pathfinding, the minimap and the renderer. Every operation plays one of the
 * hand-built maps in `lib/maps`; this module picks the compiled map for a
 * battle and keeps a few small helpers that do not depend on a map.
 */
export type { Point, Terrain, CompiledMap };
export type { CrossingStyle } from './maps';
export { TERRAIN_SPEED } from './maps';
export type RiverCrossing = CrossingDesign;
export type MapLandmark = LandmarkDesign;
export type TerrainMap = CompiledMap;
export type SectorBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

/** The default map, for callers without a battle (previews, tests, fixtures). */
export const defaultTerrain: TerrainMap = mapFor(DEFAULT_MAP_ID);
/** Older name for `defaultTerrain`; prefer `terrainFor(battle)` with a battle. */
export const legacyTerrain = defaultTerrain;
/** Bounds of the default map; with a battle, use `terrainFor(battle).bounds`. */
export const SECTOR: SectorBounds = defaultTerrain.bounds;

/** The compiled map a battle plays on. Old or unknown ids fall back to the default map. */
export function terrainFor(battle: { mapId?: string }): TerrainMap {
  return mapFor(battle.mapId);
}

export const insideSector = (p: Point, bounds: SectorBounds = SECTOR) =>
  Number.isFinite(p.x) &&
  Number.isFinite(p.z) &&
  p.x >= bounds.minX &&
  p.x <= bounds.maxX &&
  p.z >= bounds.minZ &&
  p.z <= bounds.maxZ;

/** Conservative reservation around a rotated deck and both approaches. */
export function crossingBounds(b: CrossingDesign) {
  const c = Math.abs(Math.cos(b.angle)),
    s = Math.abs(Math.sin(b.angle));
  const w = b.width / 2 + 2.5,
    l = b.length / 2 + 6;
  const dx = c * w + s * l,
    dz = s * w + c * l;
  return { minX: b.x - dx, maxX: b.x + dx, minZ: b.z - dz, maxZ: b.z + dz };
}

/** Default-map queries for callers without a battle; prefer `terrainFor(battle)`. */
export const {
  baseAt,
  buildableAt,
  groundAt,
  heightAt,
  terrainAt,
  terrainSpeed,
} = defaultTerrain;
