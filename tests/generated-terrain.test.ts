import { expect, test } from 'vitest';
import { defaultTerrain, terrainFor } from '../lib/tactical-terrain';
import { MAPS, mapFor, mapIds } from '../lib/maps';
import {
  newBattle,
  joinBattle,
  tickBattle,
  MAP_VERSION,
  RETIRED_MAP_EVENT,
} from '../lib/tactics';

const signature = (map: ReturnType<typeof mapFor>) => {
  const { minX, maxX, minZ, maxZ } = map.bounds;
  const samples = [];
  for (let z = minZ; z <= maxZ; z += 10)
    for (let x = minX; x <= maxX; x += 10)
      samples.push([map.terrainAt(x, z), Math.round(map.heightAt(x, z) * 100)]);
  return JSON.stringify(samples);
};

test('each battlefield compiles once and every operation on it shares the same geography', () => {
  for (const id of mapIds) {
    const map = terrainFor({ mapId: id });
    expect(map).toBe(mapFor(id));
    const before = signature(map);
    for (const other of mapIds) signature(terrainFor({ mapId: other }));
    expect(signature(terrainFor({ mapId: id }))).toBe(before);
  }
  expect(new Set(mapIds.map((id) => signature(mapFor(id)))).size).toBe(
    mapIds.length,
  );
  // Retired or missing ids resolve to the default battlefield.
  expect(terrainFor({ mapId: 'skerry' })).toBe(defaultTerrain);
  expect(terrainFor({})).toBe(defaultTerrain);
  expect(defaultTerrain.mapId).toBe('fjordmouth');
});

test('landings fill in the map order, stay unique, and a full roster is refused', () => {
  for (const mapId of mapIds) {
    const players = MAPS[mapId].capacity.players;
    const b = newBattle(1000, { seed: 4, mapId, playerSlots: players });
    for (let i = 0; i < players; i++)
      joinBattle(b, { id: `p${i}`, name: `P${i}`, culture: 'neutral' }, 1000);
    expect(b.commanders.map((c) => c.slot)).toEqual(
      Array.from({ length: players }, (_, i) => i),
    );
    const first = b.commanders[0].slot;
    joinBattle(b, { id: 'p0', name: 'P0', culture: 'neutral' }, 1000);
    expect(b.commanders[0].slot).toBe(first);
    expect(() =>
      joinBattle(b, { id: 'late', name: 'Late', culture: 'neutral' }, 1000),
    ).toThrow('Every landing zone');
    // Each commander's headquarters stands on its own landing.
    for (const c of b.commanders) {
      const hq = b.entities.find((e) => e.owner === c.id && e.kind === 'hq')!;
      expect(hq).toMatchObject(MAPS[mapId].landings[c.slot]);
    }
  }
});

test('sectors from before the hand-built maps end gracefully on their next update', () => {
  const b = newBattle(1000, { seed: 9 });
  joinBattle(b, { id: 'p', name: 'P', culture: 'neutral' }, 1000);
  const old = { ...structuredClone(b), mapVersion: 7, mapId: 'skerry' as const };
  expect(() => tickBattle(old, 2000)).not.toThrow();
  expect(old.status).toBe('defeat');
  expect(old.events[0].text).toBe(RETIRED_MAP_EVENT);
  // A legacy row without any version is retired the same way.
  const ancient = { ...structuredClone(b), mapVersion: undefined };
  tickBattle(ancient, 2000);
  expect(ancient.status).toBe('defeat');
  // Current operations keep running.
  tickBattle(b, 2000);
  expect(b.status).toBe('active');
  expect(b.mapVersion).toBe(MAP_VERSION);
});
