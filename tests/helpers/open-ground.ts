import type { TerrainMap } from '../../lib/tactical-terrain';
import type { Point } from '../../lib/tactics';

/**
 * The first square of firm, unhurried ground (no water, ford, marsh or road
 * speed-up) on a map, scanning from the north-west, away from `avoid`.
 * Movement tests use it so their expectations do not depend on one map.
 */
export function openGround(
  terrain: TerrainMap,
  size = 70,
  avoid: Point[] = [],
  clearance = 90,
  /** Require exactly unit terrain speed; off, any dry ground will do. */
  firmOnly = true,
): Point {
  const { bounds } = terrain,
    half = size / 2;
  const firm = (x: number, z: number) =>
    terrain.groundAt(x, z) && (!firmOnly || terrain.terrainSpeed(x, z) === 1);
  for (let x = bounds.minX + half + 5; x <= bounds.maxX - half - 5; x += 10)
    for (let z = bounds.minZ + half + 5; z <= bounds.maxZ - half - 5; z += 10) {
      if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < clearance)) continue;
      let clear = true;
      for (let dx = -half; clear && dx <= half; dx += 2.5)
        for (let dz = -half; clear && dz <= half; dz += 2.5)
          clear = firm(x + dx, z + dz);
      if (clear) return { x, z };
    }
  throw new Error('No open ground on this map.');
}
