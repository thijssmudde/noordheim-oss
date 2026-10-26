import { crossingLocal, polygonDistance } from './maps/compile';
import type { CompiledMap, ForestDesign, Point } from './maps/types';

export type LandscapePlacement = {
  name: string;
  x: number;
  z: number;
  y: number;
  scale: number;
  heightScale?: number;
  widthScale?: number;
  angle: number;
};

/** Deterministic 0..1 noise from a position, the same on server and client. */
const jitter = (x: number, z: number, salt = 0) => {
  let h =
    Math.imul(Math.round(x * 16) | 0, 374761393) ^
    Math.imul(Math.round(z * 16) | 0, 668265263) ^
    Math.imul(salt, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const ICE = new Set(['glaciercrown', 'ironpass']);

/** Keeps dressing off every deck, its approaches and a margin either side. */
function nearCrossing(map: CompiledMap, p: Point, margin: number) {
  return map.riverBridges().some((c) => {
    const { across, along } = crossingLocal(c, p.x, p.z);
    return (
      Math.abs(across) < c.width / 2 + margin &&
      Math.abs(along) < c.length / 2 + margin
    );
  });
}
/** Keeps dressing out of ramp mouths so high ground stays readable and open. */
function nearRamp(map: CompiledMap, p: Point, margin: number) {
  return map.design.plateaus.some((plateau) =>
    plateau.ramps.some((r) => {
      const ex = r.to.x - r.from.x,
        ez = r.to.z - r.from.z;
      const length = Math.hypot(ex, ez);
      const along = ((p.x - r.from.x) * ex + (p.z - r.from.z) * ez) / length;
      const lateral = Math.abs((p.x - r.from.x) * ez - (p.z - r.from.z) * ex) / length;
      return (
        along > -margin && along < length + margin && lateral < r.width / 2 + margin
      );
    }),
  );
}

/**
 * Geological accents: boulders along every cliff band and sparse stones along
 * river banks. They follow their substrate and never touch crossings or ramps.
 */
export function biomeFormations(map: CompiledMap): LandscapePlacement[] {
  const result: LandscapePlacement[] = [];
  const ice = ICE.has(map.mapId);
  const { terrainAt, heightAt } = map;
  for (const plateau of map.design.plateaus) {
    const outline = plateau.outline;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i],
        b = outline[(i + 1) % outline.length];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const tx = (b.x - a.x) / length,
        tz = (b.z - a.z) / length;
      for (let d = 2; d < length; d += 5.5) {
        // Step inward (either winding) until the point lies on the cliff band.
        const edge = { x: a.x + tx * d, z: a.z + tz * d };
        let p: Point | undefined;
        for (const side of [1, -1]) {
          const q = {
            x: edge.x - tz * side * (plateau.cliff / 2),
            z: edge.z + tx * side * (plateau.cliff / 2),
          };
          if (polygonDistance(outline, q.x, q.z) > 0) p = q;
        }
        if (!p || terrainAt(p.x, p.z) !== 'cliff') continue;
        if (nearRamp(map, p, 5) || nearCrossing(map, p, 6)) continue;
        const r = jitter(p.x, p.z, 3);
        if (r < 0.2) continue;
        result.push({
          name: ice ? (r > 0.7 ? 'glacial_spires' : 'glacial_scree') : r > 0.6 ? 'granite_1' : 'granite_2',
          x: p.x,
          z: p.z,
          y: map.heightAt(p.x, p.z) - plateau.height * 0.45,
          scale: plateau.height * (0.35 + 0.2 * r),
          widthScale: 1.3 + 0.6 * jitter(p.x, p.z, 5),
          heightScale: 0.8 + 0.4 * r,
          angle: Math.atan2(tx, tz) + (r - 0.5) * 0.6,
        });
      }
    }
  }
  for (const river of map.design.rivers) {
    for (let i = 1; i < river.path.length; i++) {
      const a = river.path[i - 1],
        b = river.path[i];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const tx = (b.x - a.x) / length,
        tz = (b.z - a.z) / length;
      const widthAt = (t: number) =>
        typeof river.width === 'number'
          ? river.width
          : river.width[i - 1] + (river.width[i] - river.width[i - 1]) * t;
      for (let d = 0; d < length; d += 6.3)
        for (const side of [-1, 1]) {
          const hw = widthAt(d / length) / 2;
          const p = {
            x: a.x + tx * d - tz * side * (hw + 1.3),
            z: a.z + tz * d + tx * side * (hw + 1.3),
          };
          const r = jitter(p.x, p.z, side + 9);
          if (r < 0.55 || terrainAt(p.x, p.z) !== 'bank') continue;
          if (nearCrossing(map, p, 8)) continue;
          result.push({
            name: ice ? 'glacial_scree' : 'granite_2',
            x: p.x,
            z: p.z,
            y: heightAt(p.x, p.z) - 0.25,
            scale: 0.8 + 0.5 * r,
            widthScale: 1.4 + 0.6 * jitter(p.x, p.z, 11),
            heightScale: 0.5 + 0.25 * r,
            angle: Math.atan2(tx, tz) + r,
          });
        }
    }
  }
  return result;
}

export type TreePlacement = Point & {
  y: number;
  scale: number;
  angle: number;
  species: NonNullable<ForestDesign['species']>;
};

/**
 * Trees for every authored forest: a jittered grid at the design's density,
 * only on dry, open ground (never on roads, crossings, ramps, water or cliffs).
 */
export function forestTrees(map: CompiledMap): TreePlacement[] {
  const trees: TreePlacement[] = [];
  for (const forest of map.design.forests) {
    const spacing = Math.sqrt(100 / Math.max(0.05, forest.density));
    const xs = forest.outline.map((p) => p.x),
      zs = forest.outline.map((p) => p.z);
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += spacing)
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += spacing) {
        const p = {
          x: x + (jitter(x, z, 1) - 0.5) * spacing * 0.8,
          z: z + (jitter(x, z, 2) - 0.5) * spacing * 0.8,
        };
        if (polygonDistance(forest.outline, p.x, p.z) <= 0) continue;
        const t = map.terrainAt(p.x, p.z);
        if (t !== 'land' && t !== 'plateau' && t !== 'marsh' && t !== 'shore')
          continue;
        const r = jitter(p.x, p.z, 4);
        trees.push({
          ...p,
          y: map.heightAt(p.x, p.z),
          scale: 0.8 + 0.5 * r,
          angle: r * Math.PI * 2,
          species:
            forest.species === 'mixed' || !forest.species
              ? r > 0.5
                ? 'spruce'
                : 'birch'
              : forest.species,
        });
      }
  }
  return trees;
}
