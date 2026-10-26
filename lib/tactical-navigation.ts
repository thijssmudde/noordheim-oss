import { legacyTerrain, type TerrainMap } from './tactical-terrain';
import { type Point } from './tactical-terrain';
import {
  insideFootprint,
  segmentIntersectsFootprint,
  type Footprint,
} from './tactical-placement';

/** Reuse grid collision checks across troops routing through the same snapshot. */
const grids = new WeakMap<Footprint[], WeakMap<TerrainMap, GroundNavigation>>();
type Corridor = { from: Point; to: Point; path: Point[] };
const corridors = new WeakMap<Footprint[], WeakMap<TerrainMap, Corridor[]>>();
/** Reuse a squad's long route; only its short entry and exit legs differ. */
export function sharedCorridors(obstacles: Footprint[], terrain: TerrainMap) {
  let maps = corridors.get(obstacles);
  if (!maps) corridors.set(obstacles, (maps = new WeakMap()));
  let routes = maps.get(terrain);
  if (!routes) maps.set(terrain, (routes = []));
  return routes;
}

let searchesLeft = Infinity;
let deferred = false;
export const routeSearchDeferred = () => deferred;
export const beginRouteRequest = () => {
  deferred = false;
};
/** Fixed work allowance, independent of host speed or Convex's frozen Date.now(). */
export const ROUTE_SEARCH_BUDGET = 3;
export function withRoutingBudget<T>(
  fn: () => T,
  searches = ROUTE_SEARCH_BUDGET,
): T {
  const previous = searchesLeft;
  searchesLeft = searches;
  try {
    return fn();
  } finally {
    searchesLeft = previous;
  }
}
export function takeRouteSearch() {
  if (searchesLeft <= 0) {
    deferred = true;
    return false;
  }
  searchesLeft--;
  return true;
}
class GroundNavigation {
  private speeds = new Map<string, number>();
  private cells = new Map<string, boolean>();
  private edges = new Map<string, boolean>();
  private buckets = new Map<string, Footprint[]>();

  constructor(
    obstacles: Footprint[],
    private terrain: TerrainMap,
  ) {
    for (const box of obstacles)
      for (
        let x = Math.floor((box.minX - 1) / 16);
        x <= Math.floor((box.maxX + 1) / 16);
        x++
      )
        for (
          let z = Math.floor((box.minZ - 1) / 16);
          z <= Math.floor((box.maxZ + 1) / 16);
          z++
        ) {
          const key = `${x},${z}`;
          const bucket = this.buckets.get(key) ?? [];
          bucket.push(box);
          this.buckets.set(key, bucket);
        }
  }

  speedAt = (x: number, z: number): number => {
    // Off-grid endpoints need their exact terrain classification.
    if (!Number.isInteger(x * 2) || !Number.isInteger(z * 2))
      return this.terrain.terrainSpeed(x, z);
    const key = `${x},${z}`;
    let speed = this.speeds.get(key);
    if (speed === undefined)
      this.speeds.set(key, (speed = this.terrain.terrainSpeed(x, z)));
    return speed;
  };

  passable = (x: number, z: number): boolean => {
    const key = `${x},${z}`;
    let clear = this.cells.get(key);
    if (clear === undefined) {
      const nearby =
        this.buckets.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`) ?? [];
      clear =
        this.speedAt(x, z) > 0 &&
        !nearby.some((box) => insideFootprint({ x, z }, box, 1));
      this.cells.set(key, clear);
    }
    return clear;
  };

  /**
   * A grid edge is clear when no foundation crosses it and the ground between
   * its two cells is walkable. Scaled battlefields space cells several metres
   * apart, so a cliff line or beck thinner than a step must be sampled, not
   * inferred from the cell centres.
   */
  clearEdge = (from: Point, to: Point): boolean => {
    const a = `${from.x},${from.z}`,
      b = `${to.x},${to.z}`;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    let clear = this.edges.get(key);
    if (clear === undefined) {
      clear = true;
      for (
        let x = Math.floor(Math.min(from.x, to.x) / 16);
        clear && x <= Math.floor(Math.max(from.x, to.x) / 16);
        x++
      )
        for (
          let z = Math.floor(Math.min(from.z, to.z) / 16);
          clear && z <= Math.floor(Math.max(from.z, to.z) / 16);
          z++
        )
          clear = !(this.buckets.get(`${x},${z}`) ?? []).some((box) =>
            segmentIntersectsFootprint(from, to, box),
          );
      const samples = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 2);
      for (let i = 1; clear && i < samples; i++) {
        const t = i / samples;
        clear =
          this.speedAt(
            from.x + (to.x - from.x) * t,
            from.z + (to.z - from.z) * t,
          ) > 0;
      }
      this.edges.set(key, clear);
    }
    return clear;
  };
}

/** Obstacle arrays are immutable snapshots; a new foundation gets a new grid. */
export function groundNavigation(obstacles: Footprint[], terrain: TerrainMap) {
  let maps = grids.get(obstacles);
  if (!maps) grids.set(obstacles, (maps = new WeakMap()));
  let grid = maps.get(terrain);
  if (!grid)
    maps.set(terrain, (grid = new GroundNavigation(obstacles, terrain)));
  return grid;
}

/** Travel cost along a straight segment; infinity means it crosses blocked ground. */
export function groundSegmentCost(
  from: Point,
  to: Point,
  obstacles: Footprint[] = [],
  terrain: TerrainMap = legacyTerrain,
) {
  const { terrainSpeed } = terrain;

  if (obstacles.some((box) => segmentIntersectsFootprint(from, to, box)))
    return Infinity;
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(length * 2));
  let cost = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const speed = terrainSpeed(
      from.x + (to.x - from.x) * t,
      from.z + (to.z - from.z) * t,
    );
    if (!speed) return Infinity;
    cost += (i === 0 || i === steps ? 0.5 : 1) / speed;
  }
  return (cost * length) / steps;
}

/** Pull a grid route taut without cutting across water, foundations or costly marsh. */
export function simplifyGroundPath(
  from: Point,
  path: Point[],
  obstacles: Footprint[],
  terrain: TerrainMap = legacyTerrain,
) {
  const points = [from, ...path];
  const costs = [0];
  for (let i = 1; i < points.length; i++)
    costs.push(
      costs[i - 1] +
        groundSegmentCost(points[i - 1], points[i], obstacles, terrain),
    );
  const result: Point[] = [];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    for (let i = points.length - 1; i > next; i--) {
      const direct = groundSegmentCost(
        points[anchor],
        points[i],
        obstacles,
        terrain,
      );
      if (
        Number.isFinite(direct) &&
        direct <= (costs[i] - costs[anchor]) * 1.02 + 0.01
      ) {
        next = i;
        break;
      }
    }
    const p = points[next];
    if (
      Math.hypot(p.x - points[anchor].x, p.z - points[anchor].z) > 1e-6 ||
      next === points.length - 1
    )
      result.push({ x: p.x, z: p.z });
    anchor = next;
  }
  return result;
}
