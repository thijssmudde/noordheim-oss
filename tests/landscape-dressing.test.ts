import { expect, test } from 'vitest';
import { biomeFormations, forestTrees } from '../lib/landscape-dressing';
import { crossingLocal } from '../lib/maps/compile';
import { mapFor, mapIds } from '../lib/maps';

test.each(mapIds)(
  '%s: geological formations follow cliffs and banks and leave crossings and ramps clear',
  (id) => {
    const map = mapFor(id);
    const placements = biomeFormations(map);
    if (map.design.plateaus.length || map.design.rivers.length)
      expect(placements.length).toBeGreaterThan(0);
    for (const p of placements) {
      expect(['bank', 'cliff']).toContain(map.terrainAt(p.x, p.z));
      for (const c of map.riverBridges()) {
        const { across, along } = crossingLocal(c, p.x, p.z);
        expect(
          Math.abs(across) >= c.width / 2 + 6 ||
            Math.abs(along) >= c.length / 2 + 6,
          `${p.name} at ${p.x},${p.z} near ${c.name}`,
        ).toBe(true);
      }
    }
    // Deterministic: the same map dresses identically on server and client.
    expect(biomeFormations(map)).toEqual(placements);
  },
);

test.each(mapIds)(
  '%s: forest trees stand on open dry ground, never on lanes or water',
  (id) => {
    const map = mapFor(id);
    const trees = forestTrees(map);
    expect(trees.length).toBeGreaterThan(20);
    for (const t of trees) {
      expect(['land', 'plateau', 'marsh', 'shore']).toContain(
        map.terrainAt(t.x, t.z),
      );
      expect(t.y).toBeCloseTo(map.heightAt(t.x, t.z), 5);
    }
    expect(forestTrees(map)).toEqual(trees);
  },
);

test('icy maps dress their cliffs with glacial stone, the others with granite', () => {
  const names = (id: (typeof mapIds)[number]) =>
    new Set(biomeFormations(mapFor(id)).map((p) => p.name));
  for (const name of names('glaciercrown'))
    expect(name.startsWith('glacial')).toBe(true);
  for (const name of names('fjordmouth'))
    expect(name.startsWith('granite')).toBe(true);
});
