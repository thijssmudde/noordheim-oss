import { createSampler, crossingDeck, DECK_HEIGHT, TERRAIN_CODES } from '../../../lib/maps/compile';
import type { CompiledMap, CrossingDesign, MapDesign, Terrain } from '@/lib/maps/types';

/**
 * The renderer's view of a compiled map: a 1 m lattice of *natural* ground
 * heights. Crossings are removed so bridge decks do not become dams in the
 * terrain mesh; the decks are drawn as models on top.
 */
export type WorldGrid = {
  width: number;
  depth: number;
  minX: number;
  minZ: number;
  /** Natural ground heights, row-major (x fastest), one metre apart. */
  heights: Float32Array;
  /** Terrain code per lattice point, index into TERRAIN_CODES. */
  terrain: Uint8Array;
};

export const TERRAIN_INDEX = Object.fromEntries(
  TERRAIN_CODES.map((t, i) => [t, i]),
) as Record<Terrain, number>;

type WithGrid = CompiledMap & {
  grid?: () => {
    width: number;
    depth: number;
    minX: number;
    minZ: number;
    heights: Float32Array;
    terrain: Uint8Array;
  };
};

const grids = new WeakMap<MapDesign, WorldGrid>();

export function worldGrid(map: CompiledMap): WorldGrid {
  const cached = grids.get(map.design);
  if (cached) return cached;
  const source = (map as WithGrid).grid?.();
  const { bounds } = map;
  const minX = source?.minX ?? Math.floor(bounds.minX),
    minZ = source?.minZ ?? Math.floor(bounds.minZ);
  const width = source?.width ?? Math.ceil(bounds.maxX) - minX + 1,
    depth = source?.depth ?? Math.ceil(bounds.maxZ) - minZ + 1;
  const heights = new Float32Array(width * depth);
  const terrain = new Uint8Array(width * depth);
  let natural: ReturnType<typeof createSampler> | null = null;
  for (let iz = 0; iz < depth; iz++)
    for (let ix = 0; ix < width; ix++) {
      const i = iz * width + ix;
      const x = minX + ix,
        z = minZ + iz;
      let code = source ? source.terrain[i] : TERRAIN_INDEX[map.terrainAt(x, z)];
      let h = source ? source.heights[i] : map.heightAt(x, z);
      if (code === TERRAIN_INDEX.bridge || code === TERRAIN_INDEX.ford) {
        natural ??= createSampler({ ...map.design, crossings: [] });
        const p = natural(x, z);
        if (code === TERRAIN_INDEX.bridge) {
          h = p.height;
          code = TERRAIN_INDEX[p.terrain];
        }
      }
      heights[i] = h;
      terrain[i] = code;
    }
  const grid = { width, depth, minX, minZ, heights, terrain };
  grids.set(map.design, grid);
  return grid;
}

/** Bilinear natural height; outside the lattice the nearest edge value. */
export function gridHeight(grid: WorldGrid, x: number, z: number) {
  const fx = Math.min(grid.width - 1.001, Math.max(0, x - grid.minX)),
    fz = Math.min(grid.depth - 1.001, Math.max(0, z - grid.minZ));
  const ix = Math.floor(fx),
    iz = Math.floor(fz);
  const tx = fx - ix,
    tz = fz - iz;
  const h = grid.heights,
    w = grid.width;
  const a = h[iz * w + ix],
    b = h[iz * w + ix + 1],
    c = h[(iz + 1) * w + ix],
    d = h[(iz + 1) * w + ix + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

export function gridTerrain(grid: WorldGrid, x: number, z: number): Terrain {
  const ix = Math.round(x - grid.minX),
    iz = Math.round(z - grid.minZ);
  if (ix < 0 || iz < 0 || ix >= grid.width || iz >= grid.depth) return 'void';
  return TERRAIN_CODES[grid.terrain[iz * grid.width + ix]];
}

/** Deterministic pseudo-random sequence so dressing matches across clients. */
export function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** Smooth 2D value noise in [0, 1]. */
export function noise2(x: number, z: number) {
  const hash = (a: number, b: number) => {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const ix = Math.floor(x),
    iz = Math.floor(z);
  const fx = x - ix,
    fz = z - iz;
  const u = fx * fx * (3 - 2 * fx),
    v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz),
    b = hash(ix + 1, iz),
    c = hash(ix, iz + 1),
    d = hash(ix + 1, iz + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/**
 * Where a bridge model stands. Models are authored with the deck DECK_HEIGHT
 * above their origin at the waterline; a deck the simulation raises (a gorge
 * bridge from rim to rim) is lifted and pitched to the same line.
 */
export function bridgePlacement(map: CompiledMap, c: CrossingDesign) {
  const deck = crossingDeck(map, c);
  return { y: deck.lift, pitch: -Math.atan(deck.slope) };
}

/** Gap between trestle bents under a raised deck, in metres. */
const BENT_SPACING = 5;
/** A raised deck needs bents once it stands this far over the ground below. */
const BENT_CLEARANCE = 1.5;

/**
 * Trestle bents that carry a raised deck down to the gorge floor: one every
 * few metres along the span, from the natural ground up to the deck.
 */
export function bridgeBents(map: CompiledMap, grid: WorldGrid, c: CrossingDesign) {
  const deck = crossingDeck(map, c);
  if (c.style === 'ford' || deck.lift < BENT_CLEARANCE) return [];
  const sin = Math.sin(c.angle),
    cos = Math.cos(c.angle);
  const span = c.length / 2 - 0.5;
  const bents: { along: number; ground: number; top: number }[] = [];
  const count = Math.floor((2 * span) / BENT_SPACING);
  for (let i = 0; i <= count; i++) {
    const along = -span + ((2 * span) / count) * i;
    const top = deck.north + deck.slope * (along + span) - DECK_HEIGHT;
    const ground = gridHeight(grid, c.x + sin * along, c.z + cos * along);
    if (top - ground >= BENT_CLEARANCE) bents.push({ along, ground, top });
  }
  return bents;
}
