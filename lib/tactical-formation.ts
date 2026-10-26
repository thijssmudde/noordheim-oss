import { defaultTerrain, type TerrainMap } from './tactical-terrain';
import {
  isUnit,
  TACTICAL_UNITS,
  type Entity,
  type EntityKind,
  type Point,
} from './tactics';
import { insideSector } from './tactical-terrain';
import { insideFootprint, type Footprint } from './tactical-placement';
import { groundSegmentCost } from './tactical-navigation';

const airborne = (kind: EntityKind) => kind === 'drone' || kind === 'gunship';
/** Room for the body and a little breathing space, independent of selection rings. */
export const formationRadius = (kind: EntityKind) =>
  isUnit(kind) && TACTICAL_UNITS[kind].category === 'infantry'
    ? 1.2
    : kind === 'jotun' || airborne(kind)
      ? 3.5
      : 2.7;
/** Infantry squads up to this size form a skirmish line. */
const SKIRMISH_LIMIT = 16;
/** Soldiers per skirmish rank. */
const SKIRMISH_WIDTH = 8;
/** Extra elbow room between skirmishers, relative to a compact block. */
const SKIRMISH_SPREAD = 1.35;
const squared = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/** Minimum-cost matching keeps soldiers on their side of the squad when orders change. */
function matchSlots(units: Entity[], slots: Point[]) {
  const n = units.length;
  // Hungarian assignment: potentials and the alternating path for each newly added unit.
  const u = new Float64Array(n + 1),
    v = new Float64Array(n + 1);
  const occupied = new Int32Array(n + 1),
    previous = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    occupied[0] = i;
    let column = 0;
    const best = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[column] = 1;
      const row = occupied[column];
      let delta = Infinity,
        next = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cost = squared(units[row - 1], slots[j - 1]) - u[row] - v[j];
        if (cost < best[j]) {
          best[j] = cost;
          previous[j] = column;
        }
        if (best[j] < delta) {
          delta = best[j];
          next = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[occupied[j]] += delta;
          v[j] -= delta;
        } else best[j] -= delta;
      }
      column = next;
    } while (occupied[column]);
    do {
      const next = previous[column];
      occupied[column] = occupied[next];
      column = next;
    } while (column);
  }
  return new Map(
    Array.from({ length: n }, (_, i) => [
      units[occupied[i + 1] - 1].id,
      slots[i],
    ]),
  );
}

/** Centred, staggered ranks facing travel, with reachable alternatives at shorelines and walls. */
export function formationDestinations(
  units: Entity[],
  destination: Point,
  obstacles: Footprint[],
  terrain: TerrainMap = defaultTerrain,
) {
  const { groundAt } = terrain;

  if (!units.length) return new Map<string, Point>();
  if (units.length === 1)
    return new Map([[units[0].id, { x: destination.x, z: destination.z }]]);
  const ordered = [...units].sort((a, b) => a.id.localeCompare(b.id));
  const centre = ordered.reduce(
    (p, e) => ({ x: p.x + e.x / units.length, z: p.z + e.z / units.length }),
    { x: 0, z: 0 },
  );
  let dx = destination.x - centre.x,
    dz = destination.z - centre.z;
  const length = Math.hypot(dx, dz);
  if (length > 0.01) {
    dx /= length;
    dz /= length;
  } else {
    dx = Math.sin(ordered[0].angle);
    dz = Math.cos(ordered[0].angle);
  }
  const radii = ordered.map((e) => formationRadius(e.kind));
  const largest = Math.max(...radii);
  // A small infantry squad spreads into a loose, staggered skirmish line
  // across the direction of travel; larger bodies keep a compact block.
  const skirmish =
    units.length >= 3 &&
    units.length <= SKIRMISH_LIMIT &&
    ordered.every(
      (e) => isUnit(e.kind) && TACTICAL_UNITS[e.kind].category === 'infantry',
    );
  const spacing = largest * 2 * (skirmish ? SKIRMISH_SPREAD : 1);
  const rows = skirmish
    ? Math.ceil(units.length / SKIRMISH_WIDTH)
    : Math.ceil(units.length / Math.ceil(Math.sqrt(units.length)));
  const columns = Math.ceil(units.length / rows);
  let local = ordered.map((unit, i) => {
    const row = Math.floor(i / columns);
    const count = Math.min(columns, units.length - row * columns);
    const stagger = skirmish && count >= 4 ? (i % 2) * 0.3 : 0;
    return {
      unit,
      x: ((i % columns) - (count - 1) / 2 + (row % 2) * 0.35) * spacing,
      z: -(row * 0.95 + stagger) * spacing,
    };
  });
  if (radii.some((radius) => radius !== largest)) {
    // Pack ranks by actual body size. A heavy tank should widen its own slot,
    // not turn every infantry slot in an 80-unit selection into a tank bay.
    const width = Math.max(
      spacing,
      Math.sqrt(radii.reduce((sum, r) => sum + (2 * r) ** 2, 0)),
    );
    const ranks: { units: Entity[]; width: number; radius: number }[] = [];
    for (const unit of [...ordered].sort(
      (a, b) => formationRadius(b.kind) - formationRadius(a.kind),
    )) {
      const radius = formationRadius(unit.kind);
      let rank = ranks.at(-1);
      if (!rank || rank.width + radius * 2 > width) {
        rank = { units: [], width: 0, radius };
        ranks.push(rank);
      }
      rank.units.push(unit);
      rank.width += radius * 2;
    }
    let depth = 0;
    local = ranks.flatMap((rank, i) => {
      if (i) depth += (ranks[i - 1].radius + rank.radius) * 0.95;
      let across = -rank.width / 2;
      return rank.units.map((unit) => {
        const radius = formationRadius(unit.kind);
        const point = { unit, x: across + radius, z: -depth };
        across += radius * 2;
        return point;
      });
    });
  }
  const mean = local.reduce(
    (p, q) => ({ x: p.x + q.x / units.length, z: p.z + q.z / units.length }),
    { x: 0, z: 0 },
  );
  const world = (x: number, z: number): Point => ({
    x: destination.x + dz * x + dx * z,
    z: destination.z - dx * x + dz * z,
  });
  const clear = (p: Point, air: boolean) =>
    insideSector(p, terrain.bounds) &&
    (air ||
      (groundAt(p.x, p.z) &&
        !obstacles.some((box) => insideFootprint(p, box, 1))));
  const slots: { point: Point; radius: number }[] = [];
  const groups = new Map<string, { units: Entity[]; slots: Point[] }>();
  const reach = Math.max(columns, rows) + 3;
  const alternativesByRadius = new Map<number, Point[]>();
  for (const q of local) {
    const radius = formationRadius(q.unit.kind),
      air = airborne(q.unit.kind);
    const preferred = world(q.x - mean.x, q.z - mean.z);
    const fits = (p: Point) =>
      clear(p, air) &&
      slots.every(
        (s) => squared(s.point, p) >= ((s.radius + radius) * 0.9) ** 2,
      ) &&
      (air ||
        Number.isFinite(groundSegmentCost(destination, p, obstacles, terrain)));
    let slot: Point | undefined = fits(preferred) ? preferred : undefined;
    if (!slot) {
      let alternatives = alternativesByRadius.get(radius);
      if (!alternatives) {
        alternatives = [];
        const step = radius * 2;
        const extent = Math.ceil((reach * spacing) / step);
        for (let x = -extent; x <= extent; x++)
          for (let z = -extent; z <= extent; z++)
            alternatives.push(world(x * step, z * step));
        alternativesByRadius.set(radius, alternatives);
      }
      slot = [...alternatives]
        .sort((a, b) => squared(a, preferred) - squared(b, preferred))
        .find(fits);
    }
    if (!slot)
      throw new Error(
        'Not enough clear ground for this formation. Choose a more open position.',
      );
    slots.push({ point: slot, radius });
    const key = `${radius}:${air}`;
    const group = groups.get(key) ?? { units: [], slots: [] };
    group.units.push(q.unit);
    group.slots.push(slot);
    groups.set(key, group);
  }
  // Match only interchangeable slots: assigning a tank to a soldier's slot
  // would undo the clearance guarantees established during packing.
  return new Map(
    [...groups.values()].flatMap((group) => [
      ...matchSlots(group.units, group.slots),
    ]),
  );
}
