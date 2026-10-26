import { expect, test } from 'vitest';
import { mapFor, mapIds } from '../lib/maps';
import { polylineDistance, crossingLocal, crossingDeck, DECK_HEIGHT } from '../lib/maps/compile';
import { worldGrid, gridHeight, gridTerrain, bridgePlacement, bridgeBents } from '../components/game/world/world-map';
import { plantVegetation } from '../components/game/world/vegetation';
import { buildTerrainTiles } from '../components/game/world/terrain';
import { DeathWatch, shellArc } from '../lib/combat-presentation';
import { newBattle, joinBattle, makeEntity } from '../lib/tactics';

test('the render lattice keeps natural ground under bridge decks', () => {
  for (const id of mapIds) {
    const map = mapFor(id);
    const grid = worldGrid(map);
    for (const c of map.design.crossings) {
      if (c.style === 'ford') continue;
      // The deck centre sits over water: the terrain mesh must dip there, not dam the river.
      expect(gridHeight(grid, c.x, c.z), `${id}/${c.id}`).toBeLessThan(0);
      expect(gridTerrain(grid, c.x, c.z)).not.toBe('bridge');
    }
  }
});

test('bridge models stand on the deck units walk, gorge bridges on trestles', () => {
  for (const id of mapIds) {
    const map = mapFor(id);
    const grid = worldGrid(map);
    for (const c of map.design.crossings) {
      if (c.style === 'ford') continue;
      const deck = crossingDeck(map, c);
      const { y, pitch } = bridgePlacement(map, c);
      // The model's deck runs DECK_HEIGHT over its origin, pitched along its length.
      for (const along of [-c.length / 2 + 0.5, 0, c.length / 2 - 0.5]) {
        const drawn = y + DECK_HEIGHT - Math.tan(pitch) * along;
        const walked = deck.north + deck.slope * (along + c.length / 2 - 0.5);
        expect(Math.abs(drawn - walked), `${id}/${c.id} at ${along}`).toBeLessThan(0.25);
      }
      const bents = bridgeBents(map, grid, c);
      if (deck.lift < 1.5) expect(bents, `${id}/${c.id}`).toEqual([]);
      else {
        // A rim-to-rim deck stands on bents down to the gorge floor, not on thin air.
        expect(bents.length, `${id}/${c.id}`).toBeGreaterThan(2);
        for (const b of bents) expect(b.ground, `${id}/${c.id}`).toBeLessThan(b.top - 1.5);
      }
    }
  }
});

test('trees and rocks stay off roads, crossings, landings and strongholds on every map', () => {
  for (const id of mapIds) {
    const map = mapFor(id);
    const plan = plantVegetation(map, worldGrid(map));
    const trees = Object.values(plan.trees).flat();
    expect(trees.length, id).toBeGreaterThan(100);
    for (const t of trees) {
      for (const road of map.design.roads)
        expect(polylineDistance(road.path, road.width, t.x, t.z).distance).toBeGreaterThan(road.width / 2 + 2);
      for (const c of map.design.crossings) {
        const { across, along } = crossingLocal(c, t.x, t.z);
        expect(Math.abs(across) < c.width / 2 + 2 && Math.abs(along) < c.length / 2 + 2).toBe(false);
      }
      for (const p of map.design.landings) expect(Math.hypot(t.x - p.x, t.z - p.z)).toBeGreaterThan(30);
      expect(['land', 'plateau', 'marsh']).toContain(map.terrainAt(t.x, t.z));
    }
    for (const r of Object.values(plan.rocks).flat())
      expect(['ramp', 'road', 'bridge', 'ford']).not.toContain(map.terrainAt(r.x, r.z));
  }
});

test('vegetation is deterministic, so every client dresses the same map', () => {
  const map = mapFor('fjordmouth');
  const a = plantVegetation(map, worldGrid(map)),
    b = plantVegetation(map, worldGrid(map));
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test('terrain tiles cover the whole map with three resolutions and skirts', () => {
  const map = mapFor('fjordmouth');
  const tiles = buildTerrainTiles(worldGrid(map));
  expect(tiles.length).toBe(Math.ceil(320 / 64) * Math.ceil(280 / 64));
  for (const tile of tiles) {
    const [full, half, quarter] = tile.levels.map((g) => g.index!.count);
    expect(half).toBeLessThan(full * 0.4);
    expect(quarter).toBeLessThan(half * 0.5);
  }
});

test('each visible death is reported once; a replaced snapshot is not a massacre', () => {
  const b = newBattle(1000, { seed: 947, mapId: 'fjordmouth' });
  joinBattle(b, { id: 'p', name: 'P', culture: 'fjordborn' }, 1000);
  const tank = makeEntity(b, 'tank', 'p', 'blue', { x: -60, z: 60 });
  b.entities.push(tank);
  const watch = new DeathWatch();
  b.tickAt = 1250;
  expect(watch.update(b)).toEqual([]);
  b.tickAt = 1500;
  b.entities = b.entities.filter((e) => e.id !== tank.id);
  const deaths = watch.update(b);
  expect(deaths).toHaveLength(1);
  expect(deaths[0]).toMatchObject({ id: tank.id, category: 'vehicle' });
  b.tickAt = 1750;
  expect(watch.update(b)).toEqual([]);
  // Hidden deaths are not shown.
  const hidden = makeEntity(b, 'ranger', 'p', 'blue', { x: -50, z: 60 });
  b.entities.push(hidden);
  b.tickAt = 2000;
  watch.update(b);
  b.entities = b.entities.filter((e) => e.id !== hidden.id);
  b.tickAt = 2250;
  expect(watch.update(b, () => false)).toEqual([]);
  // Most of the army vanishing in one tick is a snapshot swap (fixture, restore).
  for (let i = 0; i < 30; i++) b.entities.push(makeEntity(b, 'ranger', 'p', 'blue', { x: -40 + i, z: 70 }));
  b.tickAt = 2500;
  watch.update(b);
  b.entities = b.entities.slice(0, 2);
  b.tickAt = 2750;
  expect(watch.update(b)).toEqual([]);
});

test('shells arc, bullets fly flat', () => {
  expect(shellArc('artillery', 40)).toBeGreaterThan(8);
  expect(shellArc('rifle', 40)).toBe(0);
  expect(shellArc('cannon', 40)).toBe(0);
});
