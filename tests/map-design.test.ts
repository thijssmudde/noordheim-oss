import { describe, expect, test } from 'vitest';
import { MAPS, mapFor, mapIds, type CompiledMap, type Point } from '../lib/maps';
import { createSampler } from '../lib/maps/compile';

/**
 * Validation for the hand-built maps: every landing has room to build, every
 * objective is reachable on foot, crossings really cross, decoration keeps to
 * dry ground and the landings are fair.
 */
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** Flood fill of walkable ground on a 2 m grid from the first landing. */
function walkable(map: CompiledMap) {
  const { minX, maxX, minZ, maxZ } = map.bounds;
  const step = 2;
  const w = Math.floor((maxX - minX) / step) + 1,
    d = Math.floor((maxZ - minZ) / step) + 1;
  const seen = new Uint8Array(w * d);
  const start = map.baseAt(0);
  const sx = Math.round((start.x - minX) / step),
    sz = Math.round((start.z - minZ) / step);
  const queue = [sz * w + sx];
  seen[queue[0]] = 1;
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    const cx = c % w,
      cz = (c / w) | 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx,
        nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
      const n = nz * w + nx;
      if (seen[n]) continue;
      const x = minX + nx * step,
        z = minZ + nz * step;
      if (
        !map.groundAt(x, z) ||
        !map.groundAt(x - (dx * step) / 2, z - (dz * step) / 2)
      )
        continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return (p: Point) => {
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const cx = Math.round((p.x - minX) / step) + dx,
          cz = Math.round((p.z - minZ) / step) + dz;
        if (cx >= 0 && cz >= 0 && cx < w && cz < d && seen[cz * w + cx])
          return true;
      }
    return false;
  };
}

describe.each(mapIds)('%s', (id) => {
  const design = MAPS[id];
  const map = mapFor(id);

  test('bakes quickly', () => {
    const started = performance.now();
    map.grid();
    const ms = performance.now() - started;
    console.info(`${id}: baked ${design.bounds.maxX - design.bounds.minX} x ${design.bounds.maxZ - design.bounds.minZ} m in ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(600);
  });

  test('has the slots, dressing and camera work its capacity promises', () => {
    expect(design.landings.length).toBeGreaterThanOrEqual(design.capacity.players);
    expect(design.strongholds.length).toBeGreaterThanOrEqual(design.capacity.enemies);
    expect(design.billboards.length).toBeGreaterThanOrEqual(4);
    expect(design.billboards.length).toBeLessThanOrEqual(8);
    expect(design.shots.length).toBeGreaterThanOrEqual(3);
    expect(design.shots.length).toBeLessThanOrEqual(5);
    expect(design.landmarks.length).toBeGreaterThanOrEqual(3);
    expect(design.ore.some((o) => o.rich)).toBe(true);
  });

  test('every landing has a clear, level build pad', () => {
    for (const landing of design.landings) {
      // A 30 m radius of buildable ground for the starting base...
      for (let r = 0; r <= 30; r += 3)
        for (let a = 0; a < 24; a++) {
          const x = landing.x + Math.cos((a / 24) * Math.PI * 2) * r,
            z = landing.z + Math.sin((a / 24) * Math.PI * 2) * r;
          expect(map.buildableAt(x, z), `${id} landing ${landing.x},${landing.z} at ${x.toFixed(0)},${z.toFixed(0)}`).toBe(true);
        }
      // ...inside a 60 x 60 m pad that is almost entirely buildable.
      let clear = 0,
        total = 0;
      for (let dx = -30; dx <= 30; dx += 2)
        for (let dz = -30; dz <= 30; dz += 2) {
          total++;
          if (map.buildableAt(landing.x + dx, landing.z + dz)) clear++;
        }
      expect(clear / total).toBeGreaterThan(0.95);
    }
  });

  test('every stronghold has room for a base', () => {
    for (const s of design.strongholds) {
      let clear = 0,
        total = 0;
      for (let dx = -s.radius; dx <= s.radius; dx += 2)
        for (let dz = -s.radius; dz <= s.radius; dz += 2) {
          if (dx * dx + dz * dz > s.radius * s.radius) continue;
          total++;
          if (map.buildableAt(s.x + dx, s.z + dz)) clear++;
        }
      expect(clear / total, s.name).toBeGreaterThan(0.8);
    }
  });

  test('every landing reaches every stronghold, seam and landing on foot', () => {
    const reach = walkable(map);
    for (const p of [
      ...design.landings,
      ...design.strongholds,
      ...design.ore,
      ...design.landings.map((_, slot) => map.homeOreAt(slot)),
    ])
      expect(reach(p), `${id}: ${JSON.stringify(p)}`).toBe(true);
  });

  test('crossings span water and land on dry ground at both ends', () => {
    const dry = createSampler({ ...design, crossings: [] });
    for (const c of design.crossings) {
      const sin = Math.sin(c.angle),
        cos = Math.cos(c.angle);
      const at = (along: number) => ({
        x: c.x + sin * along,
        z: c.z + cos * along,
      });
      let water = false;
      for (let along = -c.length / 2; along <= c.length / 2; along += 0.5) {
        const p = at(along);
        expect(map.groundAt(p.x, p.z), `${c.name} deck`).toBe(true);
        const t = dry(p.x, p.z).terrain;
        if (t === 'river' || t === 'lake' || t === 'sea') water = true;
      }
      expect(water, `${c.name} crosses water`).toBe(true);
      for (const end of [-1, 1]) {
        const p = at(end * (c.length / 2 + 1.5));
        expect(map.groundAt(p.x, p.z), `${c.name} end ${end}`).toBe(true);
        expect(map.wetAt(p.x, p.z), `${c.name} end ${end}`).toBe(false);
      }
    }
  });

  test('ore, landmarks, billboards and props keep to sensible ground', () => {
    const solid = (p: Point) => {
      const t = map.terrainAt(p.x, p.z);
      return !map.wetAt(p.x, p.z) && t !== 'cliff' && t !== 'void';
    };
    for (const o of design.ore) {
      expect(solid(o), o.name).toBe(true);
      for (let a = 0; a < 12; a++)
        expect(
          map.groundAt(o.x + Math.sin((a * Math.PI) / 6) * 4, o.z + Math.cos((a * Math.PI) / 6) * 4),
          `${o.name} rim`,
        ).toBe(true);
    }
    for (const l of design.landmarks) expect(solid(l), l.name).toBe(true);
    for (const b of design.billboards) {
      const t = map.terrainAt(b.x, b.z);
      expect(solid(b), `billboard ${b.x},${b.z}`).toBe(true);
      expect(['road', 'bridge', 'ramp', 'ford'], `billboard ${b.x},${b.z} on a lane`).not.toContain(t);
    }
    for (const p of design.props) {
      if (p.kind === 'boat') expect(map.wetAt(p.x, p.z), `boat ${p.x},${p.z}`).toBe(true);
      else expect(solid(p), `${p.kind} ${p.x},${p.z}`).toBe(true);
    }
  });

  test('landings are fair', () => {
    const nearest = design.landings
      .slice(0, design.capacity.players)
      .map((l) => Math.min(...design.strongholds.slice(0, design.capacity.enemies).map((s) => distance(l, s))));
    const mean = nearest.reduce((a, b) => a + b, 0) / nearest.length;
    for (const d of nearest) expect(Math.abs(d - mean) / mean).toBeLessThanOrEqual(0.15);
    // Home ore sits at the same offset from every landing, on buildable ground.
    design.landings.forEach((landing, slot) => {
      const ore = map.homeOreAt(slot);
      expect(ore.x - landing.x).toBe(map.homeOreAt(0).x - design.landings[0].x);
      expect(ore.z - landing.z).toBe(map.homeOreAt(0).z - design.landings[0].z);
      expect(map.buildableAt(ore.x, ore.z)).toBe(true);
    });
  });

  test('strongholds stay apart and inside the map', () => {
    const { minX, maxX, minZ } = design.bounds;
    design.strongholds.forEach((s, i) => {
      expect(s.x - s.radius).toBeGreaterThanOrEqual(minX);
      expect(s.x + s.radius).toBeLessThanOrEqual(maxX);
      expect(s.z - s.radius).toBeGreaterThanOrEqual(minZ);
      for (const other of design.strongholds.slice(i + 1))
        expect(distance(s, other)).toBeGreaterThan(s.radius + other.radius);
    });
  });

  test('compiles deterministically', () => {
    const again = createSampler(design);
    for (let i = 0; i < 400; i++) {
      const x = design.bounds.minX + ((i * 37.13) % (design.bounds.maxX - design.bounds.minX)),
        z = design.bounds.minZ + ((i * 91.7) % (design.bounds.maxZ - design.bounds.minZ));
      const rx = Math.round(x),
        rz = Math.round(z);
      const p = again(rx, rz);
      expect(map.terrainAt(rx, rz)).toBe(p.terrain);
      expect(map.heightAt(rx, rz)).toBeCloseTo(p.height, 4);
    }
  });
});
