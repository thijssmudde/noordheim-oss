import {
  WATER_LEVEL,
  type CompiledMap,
  type CrossingDesign,
  type MapDesign,
  type Point,
  type TerrainGrid,
  type Polygon,
  type Terrain,
} from './types';

/**
 * Turns an authored `MapDesign` into the shared query API.
 *
 * The analytic sampler below classifies one point and finds its ground height
 * from the design's outlines and paths. Queries never call it directly: the
 * map is baked lazily, 32 m chunk by chunk, into a 1 m lattice (terrain codes
 * and heights). `terrainAt` reads the nearest lattice point and `heightAt`
 * interpolates the four around it. Only integer-safe arithmetic, square roots
 * and the authored crossing angles are involved, so the Convex server and the
 * browser bake identical grids.
 */

/** Ground speed multiplier per terrain; zero means impassable for ground units. */
export const TERRAIN_SPEED: Record<Terrain, number> = {
  land: 1,
  plateau: 1,
  shore: 1,
  bank: 1,
  bridge: 1,
  road: 1.1,
  ramp: 0.8,
  marsh: 0.55,
  ford: 0.45,
  river: 0,
  lake: 0,
  cliff: 0,
  sea: 0,
  void: 0,
};

/** Foundations need firm, dry, level ground; roads stay open as lanes. */
export const BUILDABLE_TERRAIN: ReadonlySet<Terrain> = new Set<Terrain>([
  'land',
  'plateau',
]);
export const WET_TERRAIN: ReadonlySet<Terrain> = new Set<Terrain>([
  'river',
  'lake',
  'sea',
  'ford',
]);

export const TERRAIN_CODES: readonly Terrain[] = [
  'land',
  'plateau',
  'shore',
  'bank',
  'marsh',
  'ford',
  'ramp',
  'bridge',
  'road',
  'river',
  'lake',
  'cliff',
  'sea',
  'void',
];
const CODE = Object.fromEntries(TERRAIN_CODES.map((t, i) => [t, i])) as Record<
  Terrain,
  number
>;
const SPEED_BY_CODE = TERRAIN_CODES.map((t) => TERRAIN_SPEED[t]);
const BUILDABLE_BY_CODE = TERRAIN_CODES.map((t) => BUILDABLE_TERRAIN.has(t));
const WET_BY_CODE = TERRAIN_CODES.map((t) => WET_TERRAIN.has(t));

/** Flat ground reserved around every landing and stronghold. */
export const LANDING_PAD = { flat: 44, blend: 60 };
/** Width of the gravel strip beside rivers where nothing is built. */
export const BANK_WIDTH = 3;
/** Width of the beach rim around lakes and seas. */
export const SHORE_WIDTH = 5;
/** Height of dry ground right at the water's edge. */
const EDGE_HEIGHT = 0.35;
/** Dry ground eases down to the waterline over this distance. */
const WATER_EASE = 12;
/** Bridge decks stand this far above the water. */
export const DECK_HEIGHT = 0.6;
/** Steepest rise between neighbouring lattice points that still takes a foundation. */
const MAX_BUILD_STEP = 0.45;
const CHUNK = 32;
/** Embankment shoulders beside a ramp below the plateau rim. */
const RAMP_SHOULDER = 2.5;
/** Ramps lower than this may be stepped off sideways. */
const RAMP_STEP = 0.7;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function hash(ix: number, iz: number, seed: number) {
  let h =
    Math.imul(ix | 0, 374761393) ^
    Math.imul(iz | 0, 668265263) ^
    Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth value noise in [-1, 1]. */
function valueNoise(x: number, z: number, seed: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  const fx = x - ix,
    fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx),
    sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed),
    b = hash(ix + 1, iz, seed),
    c = hash(ix, iz + 1, seed),
    d = hash(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz) * 2 - 1;
}

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
const boxOf = (points: Point[], pad: number): Box => ({
  minX: Math.min(...points.map((p) => p.x)) - pad,
  maxX: Math.max(...points.map((p) => p.x)) + pad,
  minZ: Math.min(...points.map((p) => p.z)) - pad,
  maxZ: Math.max(...points.map((p) => p.z)) + pad,
});
const inBox = (b: Box, x: number, z: number) =>
  x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;

/** Signed distance to a polygon outline: positive inside, negative outside. */
export function polygonDistance(poly: Polygon, x: number, z: number) {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j],
      b = poly[i];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x)
      inside = !inside;
    const ex = b.x - a.x,
      ez = b.z - a.z;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? clamp01(((x - a.x) * ex + (z - a.z) * ez) / len2) : 0;
    const dx = x - (a.x + ex * t),
      dz = z - (a.z + ez * t);
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  const d = Math.sqrt(best);
  return inside ? d : -d;
}

export const insidePolygon = (poly: Polygon, x: number, z: number) =>
  polygonDistance(poly, x, z) > 0;

/** Distance to a polyline and the interpolated width at the nearest point. */
export function polylineDistance(
  path: Point[],
  widths: number | number[],
  x: number,
  z: number,
) {
  let best = Infinity,
    width = typeof widths === 'number' ? widths : widths[0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    const ex = b.x - a.x,
      ez = b.z - a.z;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? clamp01(((x - a.x) * ex + (z - a.z) * ez) / len2) : 0;
    const dx = x - (a.x + ex * t),
      dz = z - (a.z + ez * t);
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      if (typeof widths !== 'number')
        width = lerp(widths[i - 1] ?? widths[0], widths[i] ?? widths[0], t);
    }
  }
  return { distance: Math.sqrt(best), width };
}

/** Local coordinates of a point relative to a crossing deck (across, along). */
export function crossingLocal(c: CrossingDesign, x: number, z: number) {
  const dx = x - c.x,
    dz = z - c.z,
    cos = Math.cos(c.angle),
    sin = Math.sin(c.angle);
  return { across: dx * cos - dz * sin, along: dx * sin + dz * cos };
}
export function onCrossing(c: CrossingDesign, x: number, z: number) {
  const { across, along } = crossingLocal(c, x, z);
  return Math.abs(across) <= c.width / 2 && Math.abs(along) <= c.length / 2;
}

type Probe = { terrain: Terrain; height: number };

/** The analytic, unbaked sampler. Exported for tests and tooling only. */
export function createSampler(design: MapDesign) {
  const { bounds, ground } = design;
  const seed = ground.seed | 0;
  const pads = [
    ...design.landings.map((p) => ({ ...p, flat: LANDING_PAD.flat })),
    ...design.strongholds.map((p) => ({
      x: p.x,
      z: p.z,
      flat: Math.max(LANDING_PAD.flat, p.radius),
    })),
  ];
  const seas = design.seas.map((w) => ({
    ...w,
    box: boxOf(w.outline, SHORE_WIDTH + WATER_EASE),
  }));
  const lakes = design.lakes.map((w) => ({
    ...w,
    box: boxOf(w.outline, SHORE_WIDTH + WATER_EASE),
  }));
  const rivers = design.rivers.map((r) => {
    const widest =
      typeof r.width === 'number' ? r.width : Math.max(...r.width);
    return { ...r, box: boxOf(r.path, widest / 2 + BANK_WIDTH + WATER_EASE) };
  });
  const plateaus = design.plateaus.map((p) => ({
    ...p,
    box: boxOf(
      [...p.outline, ...p.ramps.flatMap((r) => [r.from, r.to])],
      p.cliff + 16,
    ),
    ramps: p.ramps.map((r) => {
      const ex = r.to.x - r.from.x,
        ez = r.to.z - r.from.z;
      const length = Math.hypot(ex, ez);
      return { ...r, ux: ex / length, uz: ez / length, length };
    }),
  }));
  const marshes = design.marshes.map((outline) => ({
    outline,
    box: boxOf(outline, 1),
  }));
  const roads = design.roads.map((r) => ({ ...r, box: boxOf(r.path, r.width) }));
  const crossings = design.crossings.map((c) => ({
    c,
    box: boxOf([c], c.width / 2 + c.length / 2 + 1),
  }));

  /** Rolling lowland, flattened into pads around every landing and stronghold. */
  function lowland(x: number, z: number) {
    let h =
      ground.height +
      ground.roll *
        (valueNoise(x / 46, z / 46, seed) * 0.7 +
          valueNoise(x / 17 + 31.7, z / 17 - 11.3, seed + 7) * 0.3);
    for (const pad of pads) {
      const dx = x - pad.x,
        dz = z - pad.z;
      const d2 = dx * dx + dz * dz;
      const outer = pad.flat + (LANDING_PAD.blend - LANDING_PAD.flat);
      if (d2 < outer * outer)
        h = lerp(ground.height, h, smooth(pad.flat, outer, Math.sqrt(d2)));
    }
    return h;
  }

  const probe: Probe = { terrain: 'land', height: 0 };
  /** Plateau rise and class at a point, before water; stacked plateaus add up. */
  function relief(x: number, z: number) {
    let lift = 0;
    let kind: Terrain | undefined;
    for (const plateau of plateaus) {
      if (!inBox(plateau.box, x, z)) continue;
      const s = polygonDistance(plateau.outline, x, z);
      let rise = 0;
      let here: Terrain | undefined;
      if (s >= plateau.cliff) {
        rise = plateau.height;
        here = 'plateau';
      } else if (s >= 0) {
        rise = (plateau.height * s) / plateau.cliff;
        here = 'cliff';
      }
      for (const ramp of plateau.ramps) {
        const px = x - ramp.from.x,
          pz = z - ramp.from.z;
        const along = px * ramp.ux + pz * ramp.uz;
        if (along < 0 || along > ramp.length) continue;
        const lateral = Math.abs(px * ramp.uz - pz * ramp.ux);
        const slope = plateau.height * (along / ramp.length);
        if (lateral <= ramp.width / 2) {
          rise = slope;
          here = 'ramp';
          break;
        }
        // Walls of the cutting where the ramp climbs through the plateau.
        if (s >= 0 && lateral <= ramp.width / 2 + plateau.cliff) {
          rise = lerp(slope, rise, (lateral - ramp.width / 2) / plateau.cliff);
          here = 'cliff';
        } else if (
          // Below the rim the ramp runs on an embankment with steep shoulders.
          s < 0 &&
          slope > RAMP_STEP &&
          lateral <= ramp.width / 2 + RAMP_SHOULDER
        ) {
          rise = lerp(slope, 0, (lateral - ramp.width / 2) / RAMP_SHOULDER);
          here = 'cliff';
        }
      }
      if (here) {
        lift += rise;
        kind = here;
      }
    }
    return { lift, kind };
  }

  function natural(x: number, z: number): Probe {
    if (
      x < bounds.minX ||
      x > bounds.maxX ||
      z < bounds.minZ ||
      z > bounds.maxZ
    ) {
      probe.terrain = 'void';
      probe.height = WATER_LEVEL - 1;
      return probe;
    }
    // Distance from the nearest water edge, and the rim terrain it implies.
    let edge = Infinity;
    let rim: Terrain = 'shore';
    for (const [kind, bodies] of [
      ['sea', seas],
      ['lake', lakes],
    ] as const) {
      for (const body of bodies) {
        if (!inBox(body.box, x, z)) continue;
        const s = polygonDistance(body.outline, x, z);
        if (s > 0) {
          probe.terrain = kind;
          probe.height = WATER_LEVEL - 0.3 - body.depth * smooth(0, 16, s);
          return probe;
        }
        if (-s < edge) {
          edge = -s;
          rim = 'shore';
        }
      }
    }
    for (const river of rivers) {
      if (!inBox(river.box, x, z)) continue;
      const { distance, width } = polylineDistance(
        river.path,
        river.width,
        x,
        z,
      );
      const hw = width / 2;
      if (distance < hw) {
        const r = distance / hw;
        probe.terrain = 'river';
        probe.height = WATER_LEVEL - 0.25 - river.depth * (1 - r * r);
        return probe;
      }
      if (distance - hw < edge) {
        edge = distance - hw;
        rim = 'bank';
      }
    }
    const rimWidth = rim === 'bank' ? BANK_WIDTH : SHORE_WIDTH;
    const { lift, kind } = relief(x, z);
    let h = lowland(x, z);
    if (kind === 'plateau' || kind === 'cliff') {
      // High ground meets water in a sheer wall, never a walkable step.
      if (edge < rimWidth) {
        probe.terrain = 'cliff';
        probe.height = lerp(EDGE_HEIGHT, h + lift, smooth(0, rimWidth, edge));
        return probe;
      }
      probe.terrain = kind;
      probe.height = h + lift;
      return probe;
    }
    if (edge < rimWidth + WATER_EASE) {
      if (edge < rimWidth) {
        probe.terrain = rim;
        probe.height = lerp(
          WATER_LEVEL - 0.1,
          EDGE_HEIGHT,
          smooth(0, rimWidth * 0.6, edge),
        );
        return probe;
      }
      h = lerp(EDGE_HEIGHT, h, smooth(rimWidth, rimWidth + WATER_EASE, edge));
    }
    if (kind === 'ramp') {
      probe.terrain = 'ramp';
      probe.height = h + lift;
      return probe;
    }
    for (const marsh of marshes) {
      if (!inBox(marsh.box, x, z)) continue;
      const s = polygonDistance(marsh.outline, x, z);
      if (s > 0) {
        probe.terrain = 'marsh';
        probe.height = Math.max(EDGE_HEIGHT * 0.5, h - 0.35 * smooth(0, 5, s));
        return probe;
      }
    }
    probe.terrain = 'land';
    probe.height = h;
    return probe;
  }

  /** Decks run straight between the ground at both ends, never below the water. */
  const decks = crossings.map(({ c }) => {
    const sin = Math.sin(c.angle),
      cos = Math.cos(c.angle);
    const end = (sign: number) =>
      natural(c.x + sin * sign * (c.length / 2), c.z + cos * sign * (c.length / 2))
        .height;
    return { south: end(1), north: end(-1) };
  });

  /** Classifies one point and finds its ground height: crossings and roads over nature. */
  function sample(x: number, z: number): Probe {
    for (let i = 0; i < crossings.length; i++) {
      const { c, box } = crossings[i];
      if (!inBox(box, x, z)) continue;
      const { across, along } = crossingLocal(c, x, z);
      if (Math.abs(across) > c.width / 2 || Math.abs(along) > c.length / 2)
        continue;
      const under = natural(x, z);
      if (c.style === 'ford') {
        probe.terrain = 'ford';
        probe.height = Math.max(WATER_LEVEL - 0.3, under.height);
      } else {
        const deck = lerp(
          decks[i].north,
          decks[i].south,
          along / c.length + 0.5,
        );
        probe.terrain = 'bridge';
        probe.height = Math.max(WATER_LEVEL + DECK_HEIGHT, deck);
      }
      return probe;
    }
    const p = natural(x, z);
    if (
      p.terrain === 'land' ||
      p.terrain === 'plateau' ||
      p.terrain === 'marsh' ||
      p.terrain === 'shore' ||
      p.terrain === 'bank'
    )
      for (const road of roads) {
        if (!inBox(road.box, x, z)) continue;
        if (
          polylineDistance(road.path, road.width, x, z).distance <=
          road.width / 2
        ) {
          p.terrain = 'road';
          break;
        }
      }
    return p;
  }
  return sample;
}

/** Older name: the grid is part of `CompiledMap` now. */
export type CompiledMapWithGrid = CompiledMap;

/** Home ore sits north-west of every landing, toward the front, at the same offset. */
export const HOME_ORE_OFFSET = { x: -22, z: -18 };

/** Pure: the same design always compiles to the same answers. */
export function compileMap(design: MapDesign): CompiledMapWithGrid {
  const sample = createSampler(design);
  const { bounds } = design;
  const minX = Math.floor(bounds.minX),
    minZ = Math.floor(bounds.minZ);
  const width = Math.ceil(bounds.maxX) - minX + 1,
    depth = Math.ceil(bounds.maxZ) - minZ + 1;
  const heights = new Float32Array(width * depth);
  const terrain = new Uint8Array(width * depth);
  const chunksX = Math.ceil(width / CHUNK),
    chunksZ = Math.ceil(depth / CHUNK);
  const baked = new Uint8Array(chunksX * chunksZ);
  let bakedCount = 0;

  function bakeChunk(cx: number, cz: number) {
    const x0 = cx * CHUNK,
      z0 = cz * CHUNK;
    const x1 = Math.min(width, x0 + CHUNK),
      z1 = Math.min(depth, z0 + CHUNK);
    for (let iz = z0; iz < z1; iz++)
      for (let ix = x0; ix < x1; ix++) {
        const p = sample(minX + ix, minZ + iz);
        const i = iz * width + ix;
        heights[i] = p.height;
        terrain[i] = CODE[p.terrain];
      }
    baked[cz * chunksX + cx] = 1;
    bakedCount++;
  }
  /** Lattice index of a point, baking its chunk on first touch. */
  function at(ix: number, iz: number) {
    const c = ((iz / CHUNK) | 0) * chunksX + ((ix / CHUNK) | 0);
    if (!baked[c]) bakeChunk((ix / CHUNK) | 0, (iz / CHUNK) | 0);
    return iz * width + ix;
  }
  const outside = (x: number, z: number) =>
    !(x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ);
  const code = (x: number, z: number) => {
    if (outside(x, z)) return CODE.void;
    return terrain[at(Math.round(x - minX), Math.round(z - minZ))];
  };
  const lattice = (ix: number, iz: number) =>
    heights[
      at(
        ix < 0 ? 0 : ix >= width ? width - 1 : ix,
        iz < 0 ? 0 : iz >= depth ? depth - 1 : iz,
      )
    ];
  const heightAt = (x: number, z: number) => {
    if (outside(x, z)) return WATER_LEVEL - 1;
    const fx = x - minX,
      fz = z - minZ;
    const ix = Math.floor(fx),
      iz = Math.floor(fz);
    const tx = fx - ix,
      tz = fz - iz;
    return lerp(
      lerp(lattice(ix, iz), lattice(ix + 1, iz), tx),
      lerp(lattice(ix, iz + 1), lattice(ix + 1, iz + 1), tx),
      tz,
    );
  };
  const buildableAt = (x: number, z: number) => {
    if (!BUILDABLE_BY_CODE[code(x, z)]) return false;
    const ix = Math.round(x - minX),
      iz = Math.round(z - minZ);
    const h = lattice(ix, iz);
    return (
      Math.abs(lattice(ix + 1, iz) - h) <= MAX_BUILD_STEP &&
      Math.abs(lattice(ix - 1, iz) - h) <= MAX_BUILD_STEP &&
      Math.abs(lattice(ix, iz + 1) - h) <= MAX_BUILD_STEP &&
      Math.abs(lattice(ix, iz - 1) - h) <= MAX_BUILD_STEP
    );
  };
  const grid = (): TerrainGrid => {
    if (bakedCount < baked.length)
      for (let cz = 0; cz < chunksZ; cz++)
        for (let cx = 0; cx < chunksX; cx++)
          if (!baked[cz * chunksX + cx]) bakeChunk(cx, cz);
    return { width, depth, minX, minZ, heights, terrain };
  };
  const landings = design.landings;
  const strongholds = design.strongholds;
  return {
    mapId: design.id,
    design,
    layoutVersion: 8,
    scale: 1,
    bounds,
    landmarks: design.landmarks,
    baseAt: (slot) => {
      const p = landings[((slot % landings.length) + landings.length) % landings.length];
      return { x: p.x, z: p.z };
    },
    strongholdAt: (slot) =>
      strongholds[((slot % strongholds.length) + strongholds.length) % strongholds.length],
    terrainAt: (x, z) => TERRAIN_CODES[code(x, z)],
    heightAt,
    groundAt: (x, z) => SPEED_BY_CODE[code(x, z)] > 0,
    terrainSpeed: (x, z) => SPEED_BY_CODE[code(x, z)],
    buildableAt,
    wetAt: (x, z) => WET_BY_CODE[code(x, z)],
    riverBridges: () => design.crossings,
    homeOreAt: (slot) => {
      const p = landings[((slot % landings.length) + landings.length) % landings.length];
      return { x: p.x + HOME_ORE_OFFSET.x, z: p.z + HOME_ORE_OFFSET.z };
    },
    navigationStep: Math.max(
      2,
      Math.round(
        2 *
          Math.sqrt(
            ((bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ)) /
              (300 * 260),
          ),
      ),
    ),
    grid,
  };
}

/**
 * A crossing deck's surface heights, for renderers: the deck runs straight from
 * `north` (along = -length/2) to `south` (+length/2). `lift` is how far the deck
 * stands above the usual low deck (water level + DECK_HEIGHT), e.g. a gorge
 * bridge landing on the rims; `slope` is rise per metre from north to south.
 */
export function crossingDeck(map: Pick<CompiledMap, 'heightAt'>, c: CrossingDesign) {
  const sin = Math.sin(c.angle),
    cos = Math.cos(c.angle);
  const at = (along: number) => map.heightAt(c.x + sin * along, c.z + cos * along);
  const span = c.length / 2 - 0.5;
  const north = at(-span),
    south = at(span);
  const mid = (north + south) / 2;
  return {
    north,
    south,
    mid,
    slope: (south - north) / (2 * span),
    lift: Math.max(0, mid - (WATER_LEVEL + DECK_HEIGHT)),
  };
}
