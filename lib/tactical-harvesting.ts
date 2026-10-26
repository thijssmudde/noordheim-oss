import { legacyTerrain, type TerrainMap } from './tactical-terrain';
import type { Entity } from './tactics';
import { type Point } from './tactical-terrain';
import {
  insideFootprint,
  productionExit,
  type Footprint,
} from './tactical-placement';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
type WorkPosition = { point: Point; working: boolean };

/** Reserve destinations, not just current positions, so trucks cannot choose the same bay. */
export function harvesterWorkPositions(
  unit: Entity,
  workers: Entity[],
  centre: Point,
  refinery?: Entity,
): WorkPosition[] {
  const forward = refinery
    ? { x: Math.sin(refinery.angle), z: Math.cos(refinery.angle) }
    : { x: 0, z: 1 };
  const blocked = workers
    .filter(
      (e) =>
        e.id !== unit.id && e.kind === 'harvester' && e.hp > 0 && !e.readyAt,
    )
    .flatMap((e) => [
      ...(!e.path.length ? [{ x: e.x, z: e.z }] : []),
      ...(e.path.length ? [e.path[e.path.length - 1]] : []),
    ]);
  const free = (p: Point, gap: number) =>
    blocked.every((q) => distance(p, q) >= gap);
  const current = unit.path.at(-1) ?? unit;
  const working: Point[] = [];
  if (refinery) {
    const dock = productionExit(refinery);
    for (const side of [0, -4.8, 4.8])
      working.push({
        x: dock.x + forward.z * side,
        z: dock.z - forward.x * side,
      });
  } else {
    // Keep an existing isolated approach, including harvesters from older operations.
    if (distance(current, centre) <= 4.5)
      working.push({ x: current.x, z: current.z });
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      working.push({
        x: centre.x + Math.sin(angle) * 4.4,
        z: centre.z + Math.cos(angle) * 4.4,
      });
    }
  }
  const preferred = working
    .filter((p) => free(p, 3.3))
    .sort(
      (a, b) =>
        Number(distance(b, current) < 0.01) -
          Number(distance(a, current) < 0.01) ||
        distance(a, unit) - distance(b, unit),
    );
  const waiting: Point[] = [];
  if (refinery) {
    const dock = productionExit(refinery);
    for (let row = 1; row <= 3; row++)
      for (const side of [0, -5.5, 5.5])
        waiting.push({
          x: dock.x + forward.z * side + forward.x * row * 7,
          z: dock.z - forward.x * side + forward.z * row * 7,
        });
  } else {
    for (const radius of [11, 18, 25])
      for (let i = 0; i < 12; i++) {
        const angle = (i * Math.PI) / 6;
        waiting.push({
          x: centre.x + Math.sin(angle) * radius,
          z: centre.z + Math.cos(angle) * radius,
        });
      }
  }
  return [
    ...preferred.map((point) => ({ point, working: true })),
    ...waiting
      .filter((p) => free(p, 5.4))
      .sort((a, b) => distance(a, current) - distance(b, current))
      .map((point) => ({ point, working: false })),
  ];
}

export function clearWorkPosition(
  point: Point,
  obstacles: Footprint[],
  terrain: TerrainMap = legacyTerrain,
) {
  const { groundAt } = terrain;

  return (
    groundAt(point.x, point.z) &&
    !obstacles.some((box) => insideFootprint(point, box, 1))
  );
}
