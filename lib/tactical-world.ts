class LayoutError extends Error {}
import {
  crossingBounds,
  defaultTerrain,
  type Point,
  type TerrainMap,
} from './tactical-terrain';
import type { BuildingKind, Capture, Deposit, EntityKind } from './tactics';
import {
  BUILDING_FOOTPRINTS,
  footprint,
  footprintSamples,
  footprintsOverlap,
  hasExit,
  insideFootprint,
  productionExit,
  type Footprint,
} from './tactical-placement';
import { groundNavigation, groundSegmentCost } from './tactical-navigation';
import { FLAG_RADIUS, flagSpot } from './tactical-flags';
import {
  SITE_RULES,
  siteFootprint,
  type TechSiteDesign,
} from './tactical-sites';
import {
  DEFAULT_SKIRMISH_MODE,
  SKIRMISH_MODES,
  type SkirmishMode,
} from './skirmish-modes';
import {
  DIFFICULTIES,
  operationRandom,
  type Difficulty,
} from './tactical-difficulty';

type Placement = Point & { kind: EntityKind; angle: number; owner: string };
type Area = { minX: number; maxX: number; minZ: number; maxZ: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
/** Credits in the seam beside every landing. */
export const HOME_ORE = 16000;

/** Flood the actual ground rules once; candidate sites must belong to the landing component. */

export function generateWorld(
  seed: number,
  difficulty: Difficulty,
  terrain: TerrainMap = defaultTerrain,
  enemyCount = 1,
  skirmish: SkirmishMode = DEFAULT_SKIRMISH_MODE,
) {
  const { enemies } = terrain.design.capacity;
  if (!Number.isInteger(enemyCount) || enemyCount < 1 || enemyCount > enemies)
    throw new Error(
      `${terrain.design.name} holds between 1 and ${enemies} enemies.`,
    );
  // Deterministic and pure: the home screen's attract loop (and the art review)
  // restage the same skirmish every half minute, and charting it costs tens of
  // milliseconds of route validation, a visible hitch. Hand out copies.
  const key = `${seed}:${difficulty}:${enemyCount}:${skirmish}`;
  const cached = charted.get(terrain)?.get(key);
  if (cached) return structuredClone(cached);
  const generateLayout = createLayoutGenerator(terrain);
  for (let attempt = 0; attempt < 16; attempt++) {
    let world: ReturnType<typeof generateLayout>;
    try {
      world = generateLayout(
        (seed + Math.imul(attempt, 0x9e3779b9)) >>> 0,
        difficulty,
        enemyCount,
        skirmish,
      );
    } catch (error) {
      if (!(error instanceof LayoutError)) throw error;
      continue;
    }
    let worlds = charted.get(terrain);
    if (!worlds) charted.set(terrain, (worlds = new Map()));
    if (worlds.size >= 4) worlds.delete(worlds.keys().next().value!);
    worlds.set(key, structuredClone(world));
    return world;
  }
  throw new Error('Could not chart a clear operation. Please deploy again.');
}
/** Recently charted worlds per terrain (a few each), handed out as copies. */
const charted = new WeakMap<
  TerrainMap,
  Map<string, ReturnType<ReturnType<typeof createLayoutGenerator>>>
>();

function createLayoutGenerator(terrain: TerrainMap) {
  const {
    groundAt,
    heightAt,
    buildableAt,
    baseAt,
    bounds: SECTOR,
    design,
  } = terrain;
  const landings = design.landings.map((_, slot) => baseAt(slot));
  const step = terrain.navigationStep;
  const cell = (v: number) => Math.round(v / step) * step;
  const origin = { x: cell(baseAt(0).x), z: cell(baseAt(0).z) };
  let connectedGround: Set<string> | undefined;
  const groundLinks = new Map<string, string[]>();
  const groundPoints = new Map<string, Point>();
  function reachable(p: Point) {
    if (!connectedGround) {
      const visited = new Set<string>();
      const queue = [origin];
      visited.add(`${queue[0].x},${queue[0].z}`);
      for (let i = 0; i < queue.length; i++) {
        const from = queue[i];
        const links: string[] = [];
        groundLinks.set(`${from.x},${from.z}`, links);
        groundPoints.set(`${from.x},${from.z}`, from);
        for (const [dx, dz] of [
          [step, 0],
          [-step, 0],
          [0, step],
          [0, -step],
        ]) {
          const next = { x: from.x + dx, z: from.z + dz };
          const key = `${next.x},${next.z}`;
          if (
            !groundAt(next.x, next.z) ||
            !groundAt(from.x + dx / 2, from.z + dz / 2)
          )
            continue;
          links.push(key);
          if (!visited.has(key)) {
            visited.add(key);
            queue.push(next);
          }
        }
      }
      connectedGround = visited;
    }
    return connectedGround.has(`${cell(p.x)},${cell(p.z)}`);
  }

  /** Check the completed layout too: a legal foundation must not seal a route. */
  function validateRoutes(goals: Point[], foundations: Footprint[]) {
    const blocked = new Set<string>();
    for (const [key, p] of groundPoints)
      if (foundations.some((box) => insideFootprint(p, box, 1)))
        blocked.add(key);
    const navigation = groundNavigation([...foundations], terrain);
    const base = origin,
      start = `${base.x},${base.z}`;
    const queue = [start],
      visited = new Set(queue);
    for (let i = 0; i < queue.length; i++)
      for (const next of groundLinks.get(queue[i]) ?? [])
        if (
          !blocked.has(next) &&
          !visited.has(next) &&
          navigation.clearEdge(
            groundPoints.get(queue[i])!,
            groundPoints.get(next)!,
          )
        ) {
          visited.add(next);
          queue.push(next);
        }
    for (const goal of goals) {
      let found = false;
      for (let dx = -2; dx <= 2 && !found; dx += 2)
        for (let dz = -2; dz <= 2 && !found; dz += 2) {
          const p = {
            x: cell(goal.x) + (dx * step) / 2,
            z: cell(goal.z) + (dz * step) / 2,
          };
          found =
            visited.has(`${p.x},${p.z}`) &&
            Number.isFinite(groundSegmentCost(p, goal, foundations, terrain));
        }
      if (!found)
        throw new LayoutError('A foundation blocks a strategic route.');
    }
  }

  /**
   * Whether a derrick at `p` stands like a hand-placed tech site: dry footing
   * off every crossing and ramp, an open capture ring, clear of decoration and
   * of every other site's ring.
   */
  function derrickFits(p: Point, sites: readonly Point[]) {
    const box = siteFootprint({ kind: 'derrick', ...p, angle: 0 });
    if (!footprintSamples(box).every((q) => groundAt(q.x, q.z))) return false;
    const apron = {
      minX: box.minX - 2,
      maxX: box.maxX + 2,
      minZ: box.minZ - 2,
      maxZ: box.maxZ + 2,
    };
    if (
      footprintSamples(apron).some((q) =>
        ['bridge', 'ford', 'ramp'].includes(terrain.terrainAt(q.x, q.z)),
      ) ||
      terrain
        .riverBridges()
        .some((b) => footprintsOverlap(apron, crossingBounds(b)))
    )
      return false;
    let open = 0,
      samples = 0;
    for (let r = 2; r <= SITE_RULES.captureRadius; r += 2)
      for (let a = 0; a < 24; a++) {
        samples++;
        const angle = (a / 24) * Math.PI * 2;
        if (groundAt(p.x + Math.sin(angle) * r, p.z + Math.cos(angle) * r))
          open++;
      }
    if (open / samples <= 0.85) return false;
    if (
      [...design.props, ...design.billboards].some((d) =>
        footprintsOverlap(
          box,
          { minX: d.x, maxX: d.x, minZ: d.z, maxZ: d.z },
          4,
        ),
      )
    )
      return false;
    return (
      reachable(p) &&
      sites.every((s) => distance(s, p) > SITE_RULES.captureRadius * 2)
    );
  }
  /** The nearest spot within a few metres of a seam where a derrick fits, or none. */
  function derrickNear(seam: Point, sites: readonly Point[]) {
    for (let r = 0; r <= 12; r += 2)
      for (let a = 0; a < (r ? 16 : 1); a++) {
        const angle = (a / 16) * Math.PI * 2;
        const p = {
          x: Math.round(seam.x + Math.sin(angle) * r),
          z: Math.round(seam.z + Math.cos(angle) * r),
        };
        if (derrickFits(p, sites)) return p;
      }
    return undefined;
  }

  /** Seeded strategic layout on a hand-built map. No client-only positions. */

  function generateLayout(
    seed: number,
    difficulty: Difficulty,
    enemyCount: number,
    skirmish: SkirmishMode,
  ) {
    const random = operationRandom(seed),
      rules = DIFFICULTIES[difficulty],
      { ore } = SKIRMISH_MODES[skirmish].rules;
    const placements: Placement[] = [],
      objectives: Capture[] = [],
      deposits: Deposit[] = [];
    const foundations: Footprint[] = [],
      exits: Point[] = [],
      flags: (Point & { owner: string; name: string })[] = [];
    const pick = <T>(list: readonly T[]) =>
      list[Math.floor(random() * list.length)];
    const integer = (min: number, max: number) =>
      min + Math.floor(random() * (max - min + 1));
    const areaNear = (p: Point, radius: number): Area => ({
      minX: Math.max(SECTOR.minX + 9, p.x - radius),
      maxX: Math.min(SECTOR.maxX - 9, p.x + radius),
      minZ: Math.max(SECTOR.minZ + 9, p.z - radius),
      maxZ: Math.min(SECTOR.maxZ - 9, p.z + radius),
    });
    function site(area: Area, valid: (p: Point) => boolean): Point {
      const accepts = (p: Point) =>
        buildableAt(p.x, p.z) && reachable(p) && valid(p);
      for (let i = 0; i < 700; i++) {
        const p = {
          x: integer(Math.ceil(area.minX), Math.floor(area.maxX)),
          z: integer(Math.ceil(area.minZ), Math.floor(area.maxZ)),
        };
        if (accepts(p)) return p;
      }
      // Bounded deterministic fallback for awkward lake, brook and cliff combinations.
      for (let z = Math.ceil(area.minZ); z <= area.maxZ; z += 2)
        for (let x = Math.ceil(area.minX); x <= area.maxX; x += 2)
          if (accepts({ x, z })) return { x, z };
      throw new LayoutError('No clear ground for this operation layout.');
    }
    const open = (p: Point, radius: number) =>
      foundations.every((box) => !insideFootprint(p, box, radius)) &&
      exits.every((exit) => distance(exit, p) >= radius + 3);
    function deposit(
      name: string,
      area: Area,
      capacity: number,
      extra = (_p: Point) => true,
    ) {
      const p = site(
        area,
        (p) =>
          open(p, 8) &&
          extra(p) &&
          Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6).every(
            (angle) =>
              groundAt(p.x + Math.sin(angle) * 4, p.z + Math.cos(angle) * 4),
          ) &&
          deposits.every((d) => distance(d, p) >= 19) &&
          sites.every((s) => distance(s, p) >= SITE_RULES.captureRadius + 12) &&
          flags.every((f) => distance(f, p) >= FLAG_RADIUS + 8) &&
          objectives.every((o) => distance(o, p) >= 15),
      );
      const d = {
        ...p,
        name,
        id: `d${deposits.length + 1}`,
        amount: capacity,
        capacity,
      };
      deposits.push(d);
      return d;
    }
    let owner = 'hostile-1';
    function place(
      kind: EntityKind,
      area: Area,
      angles?: number[],
      within: (p: Point) => boolean = () => true,
    ) {
      const building = kind in BUILDING_FOOTPRINTS;
      const choices =
        angles ??
        (building
          ? [pick([0, Math.PI / 2, Math.PI, Math.PI * 1.5])]
          : [random() * Math.PI * 2]);
      for (const [i, angle] of choices.entries()) {
        try {
          return placeAt(kind, area, angle, within);
        } catch (error) {
          if (!(error instanceof LayoutError) || i === choices.length - 1)
            throw error;
        }
      }
      throw new LayoutError('No angle fits this structure.');
    }
    function placeAt(
      kind: EntityKind,
      area: Area,
      angle: number,
      within: (p: Point) => boolean,
    ) {
      const building = kind in BUILDING_FOOTPRINTS;
      const p = site(area, (p) => {
        if (!within(p)) return false;
        if (
          landings.some((home) => distance(home, p) < 55) ||
          (kind === 'hq' &&
            placements.some((e) => e.kind === 'hq' && distance(e, p) < 45)) ||
          placements.some((e) => distance(e, p) < 3) ||
          deposits.some((d) => distance(d, p) < (building ? 10 : 6)) ||
          objectives.some((o) => distance(o, p) < (building ? 10 : 4))
        )
          return false;
        if (!building) return open(p, 2);
        const box = footprint(kind as BuildingKind, p, angle);
        if (
          terrain
            .riverBridges()
            .some((b) => footprintsOverlap(box, crossingBounds(b)))
        )
          return false;
        if (
          foundations.some((other) => footprintsOverlap(box, other, 3)) ||
          placements.some((e) => insideFootprint(e, box, 2)) ||
          deposits.some((d) => insideFootprint(d, box, 6)) ||
          objectives.some((o) => insideFootprint(o, box, 6)) ||
          flags.some((f) => insideFootprint(f, box, FLAG_RADIUS + 2)) ||
          sites.some((s) =>
            footprintsOverlap(box, siteFootprint(s), SITE_RULES.captureRadius),
          ) ||
          exits.some((exit) => insideFootprint(exit, box, 3))
        )
          return false;
        if (
          !footprintSamples(box).every(
            (q) =>
              buildableAt(q.x, q.z) &&
              Math.abs(heightAt(q.x, q.z) - heightAt(p.x, p.z)) < 1.5,
          )
        )
          return false;
        if (hasExit(kind as BuildingKind)) {
          const exit = productionExit({ ...p, kind, angle });
          if (
            !groundAt(exit.x, exit.z) ||
            !reachable(exit) ||
            !open(exit, 3) ||
            deposits.some((d) => distance(d, exit) < 7)
          )
            return false;
          // Keep the entire apron traversable, not just its endpoint.
          for (let t = 0.5; t <= 1; t += 0.1)
            if (!groundAt(p.x + (exit.x - p.x) * t, p.z + (exit.z - p.z) * t))
              return false;
        }
        return true;
      });
      const entity = { ...p, kind, angle, owner };
      placements.push(entity);
      if (building) {
        foundations.push(footprint(kind as BuildingKind, p, angle));
        if (hasExit(kind as BuildingKind)) exits.push(productionExit(entity));
      }
      return entity;
    }
    // Tech sites keep their capture rings clear of hostile foundations and seams.
    const sites: (TechSiteDesign & { angle: number })[] = design.techSites.map(
      (d) => ({ ...d, angle: d.angle ?? 0 }),
    );
    if (ore) {
      // Fair home income: every landing gets the same seam at the same offset.
      design.landings.forEach((_, slot) => {
        const p = terrain.homeOreAt(slot);
        deposits.push({
          ...p,
          name: `Landing zone ${slot + 1} ore`,
          id: `d${deposits.length + 1}`,
          amount: HOME_ORE,
          capacity: HOME_ORE,
        });
      });
      // The design's expedition seams, exactly where they were drawn.
      for (const seam of design.ore)
        deposits.push({
          x: seam.x,
          z: seam.z,
          name: seam.name,
          id: `d${deposits.length + 1}`,
          amount: seam.amount,
          capacity: seam.amount,
        });
    } else {
      // Without ore every seam is a derrick: each landing's own, held from the
      // start, then the expedition seams wherever a derrick fits nearby.
      design.landings.forEach((_, slot) => {
        const p = derrickNear(terrain.homeOreAt(slot), sites);
        if (!p)
          throw new Error(
            `${design.name} has no ground for landing ${slot + 1}'s derrick.`,
          );
        sites.push({
          kind: 'derrick',
          name: `Landing zone ${slot + 1} Derrick`,
          ...p,
          angle: 0,
          home: `landing-${slot}`,
        });
      });
      for (const seam of design.ore) {
        const p = derrickNear(seam, sites);
        if (p)
          sites.push({
            kind: 'derrick',
            name: seam.name.replace(/ (Seam|Gold)$/, '') + ' Derrick',
            ...p,
            angle: 0,
          });
      }
    }
    const stations: Placement[] = [];
    for (let enemy = 0; enemy < enemyCount; enemy++) {
      owner = `hostile-${enemy + 1}`;
      const hold = terrain.strongholdAt(enemy);
      const inside = (margin: number) => (p: Point) =>
        distance(p, hold) <= hold.radius - margin;
      const area = areaNear(hold, hold.radius);
      // Production faces the landings; the other quarter turns are fallbacks.
      const front = Math.round(hold.facing / (Math.PI / 2)) * (Math.PI / 2);
      const facing = [
        front,
        front + Math.PI / 2,
        front - Math.PI / 2,
        front + Math.PI,
      ];
      const ahead = (p: Point) =>
        (p.x - hold.x) * Math.sin(hold.facing) +
          (p.z - hold.z) * Math.cos(hold.facing) >=
        -hold.radius * 0.2;
      const hq = place('hq', areaNear(hold, hold.radius * 0.35), facing);
      stations.push(hq);
      // The army's flag stands in open ground just ahead of its command station.
      const flag = flagSpot(
        terrain,
        hq,
        hq.angle,
        (p) =>
          reachable(p) &&
          !foundations.some((box) =>
            insideFootprint(p, box, FLAG_RADIUS + 1),
          ) &&
          exits.every((exit) => distance(exit, p) >= FLAG_RADIUS + 2) &&
          deposits.every((d) => distance(d, p) >= FLAG_RADIUS + 8),
      );
      if (!flag) throw new LayoutError('No open ground for a flag.');
      flags.push({ ...flag, owner, name: hold.name });
      // Without ore the garrison keeps no refinery either.
      for (const kind of [
        'factory',
        'barracks',
        'airfield',
        ...(ore ? (['refinery'] as const) : []),
      ] as const)
        place(kind, area, facing, inside(6));
      place('reactor', area, undefined, inside(4));
      if (ore)
        deposit(
          `${hold.name} ore`,
          areaNear(hold, hold.radius + 12),
          integer(60, 78) * 1000,
          (p) => distance(p, hold) <= hold.radius + 12,
        );
      else
        sites.push({
          kind: 'derrick',
          name: `${hold.name} Derrick`,
          ...site(
            areaNear(hold, hold.radius + 12),
            (p) =>
              distance(p, hold) <= hold.radius + 12 &&
              derrickFits(p, sites) &&
              exits.every((exit) => distance(exit, p) >= 12) &&
              flags.every((f) => distance(f, p) >= FLAG_RADIUS + 12) &&
              foundations.every(
                (box) =>
                  !footprintsOverlap(
                    box,
                    siteFootprint({ kind: 'derrick', ...p, angle: 0 }),
                    4,
                  ),
              ),
          ),
          angle: 0,
          home: owner,
        });
      for (let i = 0; i < rules.defenses; i++)
        place(
          (['turret', 'bunker', 'battery', 'flak'] as const)[i % 4],
          areaNear(hold, hold.radius + 6),
          undefined,
          (p) => distance(p, hold) <= hold.radius + 6 && ahead(p),
        );
    }
    // Rich seams are guarded by the nearest army; a derrick's sentry stands off its capture ring.
    const guard = ore ? 16 : 32;
    for (const seam of design.ore.filter((o) => o.rich)) {
      owner = stations.reduce((nearest, station) =>
        distance(station, seam) < distance(nearest, seam) ? station : nearest,
      ).owner;
      place(
        'turret',
        areaNear(seam, guard),
        undefined,
        (p) => distance(p, seam) <= guard,
      );
    }
    validateRoutes(
      [...objectives, ...deposits, ...exits, ...flags, ...sites],
      foundations,
    );
    return { objectives, deposits, placements, flags, sites };
  }

  return generateLayout;
}
