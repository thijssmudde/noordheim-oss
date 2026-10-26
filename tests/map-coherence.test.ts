import { describe, expect, test } from 'vitest';
import { MAPS, mapFor, mapIds, type Point } from '../lib/maps';
import {
  BANK_WIDTH,
  createSampler,
  crossingDeck,
  crossingLocal,
  LANDING_PAD,
  polygonDistance,
  polylineDistance,
} from '../lib/maps/compile';
import type {
  BillboardDesign,
  CrossingDesign,
  MapDesign,
  PropDesign,
  PropKind,
} from '../lib/maps/types';

/**
 * Scene coherence for the hand-built maps: the things a player sees must make
 * physical sense. Billboards and props keep clear of each other, of lanes,
 * crossings, seams, bases and forests; posters face the default camera (which
 * looks north from the south); every crossing lands on walkable ground at deck
 * height at both ends and spans its water gap without running into terrain.
 */

/** Footprint radius per prop kind at scale 1, measured from the GLBs plus a margin. */
const PROP_RADIUS: Record<PropKind, number> = {
  lighthouse: 4.5,
  ruin: 7,
  windmill: 6,
  radio_mast: 8.5,
  wreck_tank: 4.5,
  wreck_plane: 11.5,
  fishing_hut: 5,
  boat: 4.5,
  crane: 7,
  fuel_tanks: 7,
  rail_wagon: 6.5,
  statue: 2.5,
  watch_hut: 3,
};
/** Half-width and half-depth of a billboard's footprint (frame, posts and lamps). */
const BOARD_HALF: Record<BillboardDesign['size'], { w: number; d: number; lift: number; h: number }> = {
  hoarding: { w: 5.5, d: 1.2, lift: 2.4, h: 5 },
  tower: { w: 3.2, d: 1.2, lift: 4, h: 11 },
  banner: { w: 6.5, d: 1, lift: 1.4, h: 3 },
};
/** Gap kept between two pieces of decoration. */
const GAP = 2;
/** Deck ends and their approaches: how far beyond each end the ground must stay walkable. */
const APPROACH = 6;

type Shape = { label: string; outline: Point[]; kind: 'board' | 'prop'; prop?: PropDesign; board?: BillboardDesign };

const densify = (poly: Point[], step = 1) => {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
};
const disc = (c: Point, r: number, n = 16) =>
  Array.from({ length: n }, (_, i) => ({
    x: c.x + Math.cos((i / n) * Math.PI * 2) * r,
    z: c.z + Math.sin((i / n) * Math.PI * 2) * r,
  }));
/** Rectangle with local half extents, rotated like the renderer: local +z faces (sin a, cos a). */
const rect = (c: Point, angle: number, hw: number, hd: number, offsetD = 0) => {
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  return (
    [
      [-hw, -hd + offsetD],
      [hw, -hd + offsetD],
      [hw, hd + offsetD],
      [-hw, hd + offsetD],
    ] as const
  ).map(([lx, lz]) => ({ x: c.x + lx * cos + lz * sin, z: c.z - lx * sin + lz * cos }));
};

/** Long, narrow props get an oriented box (hull along local z); the rest a disc. */
const PROP_BOX: Partial<Record<PropKind, { w: number; d: number }>> = {
  boat: { w: 2, d: 4.6 },
  rail_wagon: { w: 2.2, d: 6.7 },
};
function propOutline(p: PropDesign) {
  const s = p.scale ?? 1;
  const box = PROP_BOX[p.kind];
  return box ? rect(p, p.angle, box.w * s, box.d * s) : disc(p, PROP_RADIUS[p.kind] * s);
}

/** A rail wagon may stand on the track it is aligned with. */
function onItsTrack(prop: PropDesign | undefined, road: MapDesign['roads'][number]) {
  if (prop?.kind !== 'rail_wagon' || road.surface !== 'rail') return false;
  for (let i = 1; i < road.path.length; i++) {
    const a = road.path[i - 1],
      b = road.path[i];
    const heading = Math.atan2(b.x - a.x, b.z - a.z);
    const skew = Math.abs(Math.sin(heading - prop.angle));
    if (skew < 0.05 && polylineDistance([a, b], road.width, prop.x, prop.z).distance < 0.3) return true;
  }
  return false;
}

function shapesOf(design: MapDesign): Shape[] {
  return [
    ...design.billboards.map((b) => ({
      label: `${b.size} billboard ${b.x},${b.z}`,
      outline: densify(rect(b, b.angle, BOARD_HALF[b.size].w, BOARD_HALF[b.size].d)),
      kind: 'board' as const,
      board: b,
    })),
    ...design.props.map((p) => ({
      label: `${p.kind} ${p.x},${p.z}`,
      outline: densify(propOutline(p)),
      kind: 'prop' as const,
      prop: p,
    })),
  ];
}

/** Points covering a shape: its outline and a grid inside it. */
function coverage(shape: Shape) {
  const xs = shape.outline.map((p) => p.x),
    zs = shape.outline.map((p) => p.z);
  const inner: Point[] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1)
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 1)
      if (polygonDistance(shape.outline, x, z) > 0) inner.push({ x, z });
  return [...shape.outline, ...inner];
}

/** Clearance between two shapes; negative when they overlap. */
function between(a: Point[], b: Point[]) {
  let best = Infinity;
  for (const p of a) best = Math.min(best, -polygonDistance(b, p.x, p.z));
  for (const p of b) best = Math.min(best, -polygonDistance(a, p.x, p.z));
  return best;
}

/** A crossing's deck plus its approaches (and a shoulder either side). */
const crossingZone = (c: CrossingDesign) => rect(c, c.angle, c.width / 2 + 2, c.length / 2 + APPROACH + 2);

const at = (c: CrossingDesign, along: number) => ({
  x: c.x + Math.sin(c.angle) * along,
  z: c.z + Math.cos(c.angle) * along,
});

describe.each(mapIds)('%s', (id) => {
  const design = MAPS[id];
  const map = mapFor(id);
  const natural = createSampler({ ...design, crossings: [] });
  const shapes = shapesOf(design);
  const covered = new Map(shapes.map((s) => [s, coverage(s)]));

  test('decoration keeps clear of other decoration', () => {
    const problems: string[] = [];
    shapes.forEach((a, i) => {
      for (const b of shapes.slice(i + 1)) {
        const d = between(a.outline, b.outline);
        if (d < GAP) problems.push(`${a.label} and ${b.label}: ${d.toFixed(1)} m apart`);
      }
    });
    expect(problems).toEqual([]);
  });

  test('decoration keeps off lanes, crossings, ramps, seams and bases', () => {
    const problems: string[] = [];
    const ramps = design.plateaus.flatMap((p) =>
      p.ramps.map((r) => {
        const angle = Math.atan2(r.to.x - r.from.x, r.to.z - r.from.z);
        const length = Math.hypot(r.to.x - r.from.x, r.to.z - r.from.z);
        return rect({ x: (r.from.x + r.to.x) / 2, z: (r.from.z + r.to.z) / 2 }, angle, r.width / 2 + 3, length / 2 + 6);
      }),
    );
    for (const shape of shapes) {
      const points = covered.get(shape)!;
      for (const road of design.roads) {
        if (onItsTrack(shape.prop, road)) continue;
        const d = Math.min(...points.map((p) => polylineDistance(road.path, road.width, p.x, p.z).distance));
        if (d < road.width / 2 + 1.5) problems.push(`${shape.label} on a ${road.surface} lane (${d.toFixed(1)} m from its axis)`);
      }
      for (const c of design.crossings)
        if (between(shape.outline, densify(crossingZone(c))) < 0 && shape.prop?.kind !== 'boat')
          problems.push(`${shape.label} on ${c.name} or its approach`);
      for (const c of design.crossings)
        if (shape.prop?.kind === 'boat' && between(shape.outline, densify(crossingZone(c))) < 2)
          problems.push(`${shape.label} moored under ${c.name}`);
      ramps.forEach((r, i) => {
        if (between(shape.outline, densify(r)) < 0) problems.push(`${shape.label} on ramp ${i}`);
      });
      for (const o of design.ore) {
        const d = Math.min(...points.map((p) => Math.hypot(p.x - o.x, p.z - o.z)));
        if (d < (o.rich ? 13 : 11)) problems.push(`${shape.label} in ${o.name} (${d.toFixed(1)} m)`);
      }
      design.landings.forEach((l, slot) => {
        const d = Math.min(...points.map((p) => Math.hypot(p.x - l.x, p.z - l.z)));
        if (d < 35) problems.push(`${shape.label} on landing ${slot + 1}'s build pad (${d.toFixed(1)} m)`);
        const ore = map.homeOreAt(slot);
        const e = Math.min(...points.map((p) => Math.hypot(p.x - ore.x, p.z - ore.z)));
        if (e < 11) problems.push(`${shape.label} in landing ${slot + 1}'s home ore`);
      });
      for (const s of design.strongholds) {
        const d = Math.min(...points.map((p) => Math.hypot(p.x - s.x, p.z - s.z)));
        if (d < s.radius + 2) problems.push(`${shape.label} inside ${s.name}`);
      }
      const flags = (design as { flags?: Point[] }).flags ?? [];
      for (const f of flags) {
        const d = Math.min(...points.map((p) => Math.hypot(p.x - f.x, p.z - f.z)));
        if (d < 14) problems.push(`${shape.label} on a flag zone`);
      }
      for (const forest of design.forests) {
        const clearance = shape.kind === 'board' ? 4 : 1;
        const d = Math.max(...points.map((p) => polygonDistance(forest.outline, p.x, p.z)));
        if (d > -clearance) problems.push(`${shape.label} in a ${forest.species ?? 'spruce'} forest`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('decoration stands on sensible, level ground', () => {
    const problems: string[] = [];
    const lanes = new Set(['road', 'bridge', 'ramp', 'ford', 'cliff', 'void']);
    for (const shape of shapes) {
      const points = covered.get(shape)!;
      if (shape.prop?.kind === 'boat') {
        const dry = points.filter((p) => !map.wetAt(p.x, p.z) || map.terrainAt(p.x, p.z) === 'ford');
        if (dry.length) problems.push(`${shape.label} has ${dry.length} dry points under its hull`);
        continue;
      }
      const onTrack = design.roads.some((road) => onItsTrack(shape.prop, road));
      const bad = points.filter((p) => {
        const t = map.terrainAt(p.x, p.z);
        return map.wetAt(p.x, p.z) || (lanes.has(t) && !(onTrack && t === 'road'));
      });
      if (bad.length)
        problems.push(
          `${shape.label} over ${[...new Set(bad.map((p) => map.terrainAt(p.x, p.z)))].join('/')} (${bad.length} points)`,
        );
      const heights = points.map((p) => map.heightAt(p.x, p.z));
      const range = Math.max(...heights) - Math.min(...heights);
      const limit = shape.kind === 'board' ? 1.2 : 2;
      if (range > limit) problems.push(`${shape.label} straddles ${range.toFixed(1)} m of relief`);
    }
    expect(problems).toEqual([]);
  });

  test('billboards face the camera with a clear view', () => {
    const problems: string[] = [];
    for (const shape of shapes) {
      const b = shape.board;
      if (!b) continue;
      // The poster's front faces (sin a, cos a); the camera looks north from the south (+z).
      if (Math.cos(b.angle) < Math.cos(Math.PI / 3)) problems.push(`${shape.label} faces away from the camera`);
      const { w, lift } = BOARD_HALF[b.size];
      const view = rect(b, b.angle, w - 0.5, 8, 9.5);
      for (const other of shapes)
        if (other !== shape && between(densify(view), other.outline) < 0)
          problems.push(`${shape.label} is hidden behind ${other.label}`);
      // Trees stand 10-15 m tall and the play camera looks down ~50 degrees: no forest
      // (or its feathered edge) in the 15 m in front of the poster.
      const lawn = densify(rect(b, b.angle, w, 7, 8));
      for (const forest of design.forests)
        if (lawn.some((p) => polygonDistance(forest.outline, p.x, p.z) > -3))
          problems.push(`${shape.label} is screened by a ${forest.species ?? 'spruce'} forest in front of it`);
      const base = map.heightAt(b.x, b.z);
      for (const p of coverage({ ...shape, outline: densify(view) }))
        if (map.heightAt(p.x, p.z) > base + lift) {
          problems.push(`${shape.label} looks into rising ground at ${p.x.toFixed(0)},${p.z.toFixed(0)}`);
          break;
        }
    }
    expect(problems).toEqual([]);
  });

  test('crossings land on walkable ground at deck height and span only their gap', () => {
    const problems: string[] = [];
    for (const c of design.crossings) {
      const deck = (along: number) => {
        const p = at(c, along);
        return map.heightAt(p.x, p.z);
      };
      const ends = [-1, 1].map((sign) => deck(sign * (c.length / 2 - 0.5)));
      // Both ends meet the ground just beyond them, and the approach stays walkable and gentle.
      [-1, 1].forEach((sign, k) => {
        const end = ends[k];
        for (let d = 0.5; d <= APPROACH; d += 0.5) {
          const p = at(c, sign * (c.length / 2 + d));
          const ground = natural(p.x, p.z);
          const t = ground.terrain;
          if (t === 'cliff' || t === 'void' || t === 'river' || t === 'lake' || t === 'sea') {
            problems.push(`${c.name} ${sign < 0 ? 'north' : 'south'} approach runs into ${t} ${d} m past the deck`);
            break;
          }
          for (const across of [-c.width / 2 + 0.5, 0, c.width / 2 - 0.5]) {
            const q = { x: p.x + Math.cos(c.angle) * across, z: p.z - Math.sin(c.angle) * across };
            if (!map.groundAt(q.x, q.z)) {
              problems.push(`${c.name} ${sign < 0 ? 'north' : 'south'} approach blocked ${d} m past the deck`);
              break;
            }
          }
          if (Math.abs(ground.height - end) > 0.8 + d * 0.15) {
            problems.push(
              `${c.name} ${sign < 0 ? 'north' : 'south'} end at ${end.toFixed(1)} m meets ground at ${ground.height.toFixed(1)} m ${d} m out`,
            );
            break;
          }
        }
      });
      if (c.style === 'ford') continue;
      // The deck clears the ground under it (it never runs into a bank or cliff).
      for (let along = -c.length / 2; along <= c.length / 2; along += 0.5) {
        const p = at(c, along);
        const under = natural(p.x, p.z);
        const top = map.heightAt(p.x, p.z);
        if (under.height > top + 0.35) {
          problems.push(`${c.name} deck is buried in ${under.terrain} at ${along.toFixed(1)} m (${under.height.toFixed(1)} over ${top.toFixed(1)})`);
          break;
        }
      }
      // Level-ish deck: a bridge is not a ramp.
      const pitch = Math.abs(ends[1] - ends[0]) / c.length;
      if (pitch > 0.08) problems.push(`${c.name} deck pitches ${(pitch * 100).toFixed(0)} %`);
      // The deck is not much longer than the water it spans.
      let wet = 0;
      for (let along = -c.length / 2; along <= c.length / 2; along += 0.5) {
        const p = at(c, along);
        const t = natural(p.x, p.z).terrain;
        if (t === 'river' || t === 'lake' || t === 'sea') wet += 0.5;
      }
      if (c.length - wet > 2 * (BANK_WIDTH + 8))
        problems.push(`${c.name} is ${c.length} m long over ${wet} m of water`);
    }
    // Crossings and their approaches keep apart.
    design.crossings.forEach((a, i) => {
      for (const b of design.crossings.slice(i + 1))
        if (between(densify(crossingZone(a)), densify(crossingZone(b))) < 0) problems.push(`${a.name} overlaps ${b.name}`);
    });
    expect(problems).toEqual([]);
  });

  test('roads and railways run along the decks they cross', () => {
    const problems: string[] = [];
    for (const road of design.roads) {
      const points: Point[] = [];
      for (let i = 1; i < road.path.length; i++) {
        const a = road.path[i - 1],
          b = road.path[i];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
        for (let k = 0; k <= n; k++) points.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
      }
      for (const c of design.crossings) {
        const local = points.map((p) => {
          const dx = p.x - c.x,
            dz = p.z - c.z;
          return {
            across: dx * Math.cos(c.angle) - dz * Math.sin(c.angle),
            along: dx * Math.sin(c.angle) + dz * Math.cos(c.angle),
          };
        });
        const onDeck = local.filter((l) => Math.abs(l.along) <= c.length / 2);
        if (!onDeck.some((l) => Math.abs(l.across) <= c.width / 2)) continue;
        const worst = Math.max(...onDeck.map((l) => Math.abs(l.across)));
        const allowed = Math.max(0, (c.width - road.width) / 2) + 0.5;
        if (worst > allowed)
          problems.push(`${road.surface} road leaves ${c.name}'s deck sideways (${worst.toFixed(1)} m off its axis)`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('roads that lead to a crossing reach its deck', () => {
    const problems: string[] = [];
    for (const road of design.roads)
      for (const end of [road.path[0], road.path[road.path.length - 1]])
        for (const c of design.crossings) {
          const deckEnds = [-1, 1].map((sign) => at(c, (sign * c.length) / 2));
          const gap = Math.min(...deckEnds.map((e) => Math.hypot(e.x - end.x, e.z - end.z)));
          const reaches = road.path.some((p, i) => {
            if (i === 0) return false;
            const q = road.path[i - 1];
            for (let t = 0; t <= 1; t += 0.02) {
              const x = q.x + (p.x - q.x) * t,
                z = q.z + (p.z - q.z) * t;
              const dx = x - c.x,
                dz = z - c.z;
              const along = dx * Math.sin(c.angle) + dz * Math.cos(c.angle);
              const across = dx * Math.cos(c.angle) - dz * Math.sin(c.angle);
              if (Math.abs(along) <= c.length / 2 && Math.abs(across) <= c.width / 2) return true;
            }
            return false;
          });
          const junction = design.roads.some(
            (other) => other !== road && polylineDistance(other.path, other.width, end.x, end.z).distance < other.width / 2 + 0.5,
          );
          if (gap < 16 && !reaches && !junction)
            problems.push(`${road.surface} road ending at ${end.x},${end.z} stops ${gap.toFixed(0)} m short of ${c.name}`);
        }
    expect(problems).toEqual([]);
  });

  test('every road ends somewhere: a road, crossing, ramp foot, landing, stronghold or the map edge', () => {
    const problems: string[] = [];
    const { minX, maxX, minZ, maxZ } = design.bounds;
    const ramps = design.plateaus.flatMap((p) => p.ramps);
    const pads = [
      ...design.landings.map((l) => ({ ...l, radius: LANDING_PAD.flat })),
      ...design.strongholds,
    ];
    for (const road of design.roads)
      for (const end of [road.path[0], road.path[road.path.length - 1]]) {
        const joins = design.roads.some(
          (other) => other !== road && polylineDistance(other.path, other.width, end.x, end.z).distance <= other.width / 2 + 0.5,
        );
        const crosses = design.crossings.some((c) => {
          const { across, along } = crossingLocal(c, end.x, end.z);
          return Math.abs(across) <= c.width / 2 && Math.abs(along) <= c.length / 2 + APPROACH;
        });
        const climbs = ramps.some((r) => Math.hypot(r.from.x - end.x, r.from.z - end.z) <= r.width / 2);
        const arrives = pads.some((p) => Math.hypot(p.x - end.x, p.z - end.z) <= p.radius);
        const leaves = Math.min(end.x - minX, maxX - end.x, end.z - minZ, maxZ - end.z) <= 6;
        if (!joins && !crosses && !climbs && !arrives && !leaves)
          problems.push(`${road.surface} road ends at ${end.x},${end.z} in the middle of nowhere`);
      }
    expect(problems).toEqual([]);
  });

  test('decoration stays inside the diorama', () => {
    const { minX, maxX, minZ, maxZ } = design.bounds;
    for (const shape of shapes)
      for (const p of shape.outline)
        expect(
          p.x > minX + 2 && p.x < maxX - 2 && p.z > minZ + 2 && p.z < maxZ - 2,
          `${shape.label} hangs over the diorama edge`,
        ).toBe(true);
  });

  test('crossingDeck describes the deck the simulation walks on', () => {
    for (const c of design.crossings) {
      if (c.style === 'ford') continue;
      const deck = crossingDeck(map, c);
      for (let along = -c.length / 2 + 1; along <= c.length / 2 - 1; along += 1) {
        const p = at(c, along);
        const expected = deck.north + deck.slope * (along + c.length / 2 - 0.5);
        expect(Math.abs(map.heightAt(p.x, p.z) - expected), `${c.name} at ${along}`).toBeLessThan(0.25);
      }
    }
  });

  test('every crossing is centred over water', () => {
    for (const c of design.crossings)
      expect(natural(c.x, c.z).terrain, `${c.name} centre over water`).toMatch(/river|lake|sea/);
  });
});

describe('the coherence checks catch the reported cases', () => {
  test('a watch hut behind a banner on the Iron Pass riverbank', () => {
    const design = MAPS.ironpass;
    const shapes = shapesOf({
      ...design,
      billboards: [{ x: 24, z: 4, angle: 0, size: 'banner' }],
      props: [{ x: 20, z: 6, kind: 'watch_hut', angle: 0 }],
    });
    expect(between(shapes[0].outline, shapes[1].outline)).toBeLessThan(GAP);
  });

  test('Kammbrua is a rim-height gorge bridge the renderer must lift', () => {
    const map = mapFor('ironpass');
    const kammbrua = map.design.crossings.find((c) => c.id === 'kammbrua')!;
    const deck = crossingDeck(map, kammbrua);
    // Rendering the deck at water level would drive it into both gorge walls.
    expect(deck.lift).toBeGreaterThan(7);
    expect(Math.abs(deck.slope)).toBeLessThan(0.08);
  });
});
