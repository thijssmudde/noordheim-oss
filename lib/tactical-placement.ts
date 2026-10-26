import type { BuildingKind, Entity, Point } from './tactics';

export type Footprint = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};
export type Placement = { position: Point; rotation: number };
export type PlaceableKind = Exclude<BuildingKind, 'hq'>;
/** Ordinary structures extend the perimeter a little; the command station and outposts extend it far.
 * Radii grew with the diorama buildings (footprints about 1.5x), so a base still fits. */
export const BUILD_RADIUS = 40;
export const OUTPOST_BUILD_RADIUS = 68;
export const BUILD_RADIUS_BY_KIND: Partial<Record<BuildingKind, number>> = {
  hq: 60,
  outpost: OUTPOST_BUILD_RADIUS,
};
/** Minimum clear ground between two foundations, so bases can pack tightly. */
export const STRUCTURE_GAP = 0.25;
/** Foundations stay this far from an ore seam so harvesters can still reach it. */
export const ORE_CLEARANCE = 4;
export const buildRadius = (kind: BuildingKind): number =>
  BUILD_RADIUS_BY_KIND[kind] ?? BUILD_RADIUS;
/** Model-space bounds (glTF: +Z is the front) of the diorama buildings from
 * art/blender/diorama_buildings.py, including their yards, aprons and docking bays. */
export const BUILDING_FOOTPRINTS: Record<BuildingKind, Footprint> = {
  hq: { minX: -6.5, maxX: 6.9, minZ: -5.6, maxZ: 6.0 },
  reactor: { minX: -4.4, maxX: 4.8, minZ: -4.4, maxZ: 4.4 },
  // The harvester unloading bay faces the exit.
  refinery: { minX: -6.3, maxX: 6.3, minZ: -6.9, maxZ: 5.7 },
  // The vehicle apron and gantry crane run out in front of the hangar door.
  factory: { minX: -6.8, maxX: 6.3, minZ: -7.4, maxZ: 10.7 },
  barracks: { minX: -6.2, maxX: 6.2, minZ: -5.0, maxZ: 5.8 },
  airfield: { minX: -7.1, maxX: 7.2, minZ: -5.6, maxZ: 5.6 },
  lab: { minX: -5.3, maxX: 5.5, minZ: -4.9, maxZ: 5.3 },
  outpost: { minX: -3.6, maxX: 3.6, minZ: -3.6, maxZ: 3.6 },
  // Gun emplacements rotate while aiming; reserve their full sweep.
  turret: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
  battery: { minX: -5.5, maxX: 5.5, minZ: -5.5, maxZ: 5.5 },
  // Expansion structures: static emplacements, masts and sheds.
  bunker: { minX: -4.3, maxX: 4.3, minZ: -4.3, maxZ: 4.3 },
  flak: { minX: -4.3, maxX: 4.3, minZ: -4.3, maxZ: 4.3 },
  radar: { minX: -4.3, maxX: 4.1, minZ: -4.1, maxZ: 4.1 },
  plant: { minX: -5.6, maxX: 5.9, minZ: -5.6, maxZ: 5.6 },
  workshop: { minX: -5.6, maxX: 5.8, minZ: -5.6, maxZ: 5.6 },
  hospital: { minX: -5.4, maxX: 6.1, minZ: -4.6, maxZ: 4.6 },
  // Faction structures. The raiding camp's yard, fire pit and lean-to face the exit.
  camp: { minX: -6.0, maxX: 5.6, minZ: -5.3, maxZ: 5.9 },
  armory: { minX: -5.7, maxX: 5.9, minZ: -6.2, maxZ: 5.4 },
  depot: { minX: -5.4, maxX: 5.4, minZ: -5.4, maxZ: 5.4 },
  watchtower: { minX: -4.4, maxX: 4.5, minZ: -4.4, maxZ: 4.4 },
  // Superweapons. The railway gun's carriage and track run front to back.
  boathouse: { minX: -6.4, maxX: 6.4, minZ: -6.4, maxZ: 6.6 },
  cannon: { minX: -5.0, maxX: 5.0, minZ: -8.4, maxZ: 8.4 },
  airstrip: { minX: -7.1, maxX: 7.1, minZ: -6.6, maxZ: 6.6 },
  launcher: { minX: -5.7, maxX: 5.7, minZ: -5.7, maxZ: 5.7 },
  weathermast: { minX: -5.0, maxX: 5.0, minZ: -5.0, maxZ: 5.0 },
};
/** Completed, living structures each supply an independent construction area. */
export function buildAreas(entities: Entity[], owner: string) {
  return entities
    .filter(
      (e) =>
        e.owner === owner &&
        e.hp > 0 &&
        !e.readyAt &&
        e.kind in BUILDING_FOOTPRINTS,
    )
    .map((e) => ({
      id: e.id,
      kind: e.kind as BuildingKind,
      x: e.x,
      z: e.z,
      radius: buildRadius(e.kind as BuildingKind),
    }));
}
const rotating = new Set<BuildingKind>(['turret', 'battery']);
/** Distance from a structure's centre to where its units appear or harvesters dock. */
export const PRODUCTION_EXITS: Partial<Record<BuildingKind, number>> = {
  hq: 8.5,
  factory: 12.5,
  barracks: 7.5,
  airfield: 7.5,
  refinery: 8,
  camp: 8,
  armory: 7.5,
  depot: 7.5,
  watchtower: 6.5,
};
/** Quarter-metre placement lets players use the smaller foundation clearance. */
export const snapPlacement = (p: Point): Point => ({
  x: Math.round(p.x * 4) / 4,
  z: Math.round(p.z * 4) / 4,
});
export function footprint(
  kind: BuildingKind,
  p: Point,
  angle: number,
): Footprint {
  const b = BUILDING_FOOTPRINTS[kind],
    c = rotating.has(kind) ? 1 : Math.cos(angle),
    s = rotating.has(kind) ? 0 : Math.sin(angle);
  const corners = [
    [b.minX, b.minZ],
    [b.minX, b.maxZ],
    [b.maxX, b.minZ],
    [b.maxX, b.maxZ],
  ].map(([x, z]) => ({ x: p.x + x * c + z * s, z: p.z - x * s + z * c }));
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    maxX: Math.max(...corners.map((p) => p.x)),
    minZ: Math.min(...corners.map((p) => p.z)),
    maxZ: Math.max(...corners.map((p) => p.z)),
  };
}
export function insideFootprint(p: Point, b: Footprint, margin = 0) {
  return (
    p.x >= b.minX - margin &&
    p.x <= b.maxX + margin &&
    p.z >= b.minZ - margin &&
    p.z <= b.maxZ + margin
  );
}
export function footprintsOverlap(a: Footprint, b: Footprint, gap = 0) {
  return (
    a.minX < b.maxX + gap &&
    a.maxX > b.minX - gap &&
    a.minZ < b.maxZ + gap &&
    a.maxZ > b.minZ - gap
  );
}
export function footprintSamples(b: Footprint): Point[] {
  const samples: Point[] = [],
    nx = Math.ceil(b.maxX - b.minX),
    nz = Math.ceil(b.maxZ - b.minZ);
  for (let x = 0; x <= nx; x++)
    for (let z = 0; z <= nz; z++)
      samples.push({
        x: b.minX + ((b.maxX - b.minX) * x) / nx,
        z: b.minZ + ((b.maxZ - b.minZ) * z) / nz,
      });
  return samples;
}
export const hasExit = (kind: BuildingKind) => kind in PRODUCTION_EXITS;
export function productionExit(
  e: Pick<Entity, 'x' | 'z' | 'angle' | 'kind'>,
): Point {
  const d = PRODUCTION_EXITS[e.kind as BuildingKind] ?? 8;
  return { x: e.x + Math.sin(e.angle) * d, z: e.z + Math.cos(e.angle) * d };
}

/** Slab intersection also catches long compressed path segments through a building. */
export function segmentIntersectsFootprint(
  from: Point,
  to: Point,
  box: Footprint,
  margin = 1,
) {
  let near = 0,
    far = 1;
  for (const [a, b, min, max] of [
    [from.x, to.x, box.minX - margin, box.maxX + margin],
    [from.z, to.z, box.minZ - margin, box.maxZ + margin],
  ]) {
    const delta = b - a;
    if (Math.abs(delta) < 1e-8) {
      if (a < min || a > max) return false;
      continue;
    }
    const t1 = (min - a) / delta,
      t2 = (max - a) / delta;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    if (near > far) return false;
  }
  return true;
}
