import { afterEach, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { readFileSync, statSync } from 'node:fs';
import {
  BATTLEFIELDS,
  capacityLabel,
  mapIds,
  type MapId,
} from '../lib/battlefields';
import { MAPS } from '../lib/maps';
import { terrainFor } from '../lib/tactical-terrain';
import { withRoutingBudget } from '../lib/tactical-navigation';
import {
  findPath,
  isUnit,
  joinBattle,
  newBattle,
  purchase,
  makeEntity,
  tickBattle,
  type BuildingKind,
} from '../lib/tactics';
import {
  footprint,
  footprintSamples,
  hasExit,
  productionExit,
} from '../lib/tactical-placement';
import { difficultyKeys } from '../lib/tactical-difficulty';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';

const maps = mapIds;
const modules = import.meta.glob('../convex/**/*.ts');
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

test('every map has its own geography, name, capacity and card', () => {
  const signatures = maps.map((mapId) => {
    const map = terrainFor({ mapId });
    expect(map.mapId).toBe(mapId);
    const samples = [];
    for (let z = -120; z < 120; z += 8)
      for (let x = -140; x < 140; x += 8)
        samples.push([map.terrainAt(x, z), map.heightAt(x, z)]);
    return JSON.stringify(samples);
  });
  expect(new Set(signatures).size).toBe(maps.length);
  for (const mapId of maps) {
    const field = BATTLEFIELDS[mapId];
    expect(field.name).toBe(MAPS[mapId].name);
    expect(field.capacity).toEqual(MAPS[mapId].capacity);
    expect(field.features.length).toBeGreaterThanOrEqual(3);
  }
  expect(capacityLabel('fjordmouth')).toBe('2 players · up to 2 enemies');
  expect(capacityLabel('nordlys')).toBe('8 players · up to 8 enemies');
  // Old rows still render with the default card.
  expect(BATTLEFIELDS.skerry).toBe(BATTLEFIELDS.fjordmouth);
});

test.each(maps)(
  '%s supports all difficulties, a full roster, every army, resources and reachable production exits',
  (mapId) => {
    const { players, enemies } = MAPS[mapId].capacity;
    for (const difficulty of difficultyKeys)
      for (const enemyCount of new Set([1, enemies]))
        for (const seed of [difficulty === 'easy' ? 0 : 947]) {
          const battle = newBattle(1000, {
            seed,
            difficulty,
            enemyCount,
            mapId,
            playerSlots: players,
          });
          const label = `${mapId}/${difficulty}/${enemyCount}/${seed}`;
          const terrain = terrainFor(battle);
          expect(battle.mapId).toBe(mapId);
          expect(battle.entities.filter((e) => e.kind === 'hq')).toHaveLength(
            enemyCount,
          );
          expect(battle.deposits).toHaveLength(
            MAPS[mapId].landings.length + MAPS[mapId].ore.length + enemyCount,
          );
          const buildings = battle.entities.filter((e) => !isUnit(e.kind));
          const boxes = buildings.map((e) =>
            footprint(e.kind as BuildingKind, e, e.angle),
          );
          for (const box of boxes)
            expect(
              footprintSamples(box).every((p) => terrain.buildableAt(p.x, p.z)),
              label,
            ).toBe(true);
          for (const entity of buildings.filter((e) =>
            hasExit(e.kind as BuildingKind),
          )) {
            expect(
              withRoutingBudget(
                () =>
                  findPath(
                    terrain.baseAt(0),
                    productionExit(entity),
                    false,
                    boxes,
                    terrain,
                  ),
                Infinity,
              ).length,
              label,
            ).toBeGreaterThan(0);
          }
          for (const deposit of battle.deposits!)
            expect(
              withRoutingBudget(
                () =>
                  findPath(terrain.baseAt(0), deposit, false, boxes, terrain),
                Infinity,
              ).length,
              `${label}/${deposit.id}`,
            ).toBeGreaterThan(0);
          for (let i = 0; i < players; i++)
            joinBattle(
              battle,
              { id: `p${i}`, name: `P${i}`, culture: 'fjordborn' },
              1000,
            );
          expect(new Set(battle.commanders.map((c) => c.slot)).size).toBe(
            players,
          );
          expect(
            battle.entities
              .filter((e) => e.team === 'blue')
              .every((e) => terrain.groundAt(e.x, e.z)),
            label,
          ).toBe(true);
          // Columns are trained, not conjured: run the sector up to the first cadence.
          for (let t = 3000; t < battle.nextWaveAt; t += 2000)
            tickBattle(battle, t);
          tickBattle(battle, battle.nextWaveAt);
          expect(battle.wave, label).toBe(1);
          expect(
            battle.entities.some(
              (e) =>
                e.team === 'red' && e.order === 'attackMove' && e.path.length,
            ),
            label,
          ).toBe(true);
        }
  },
  120000,
);

test('map selection survives solo launch, lobby host changes, shared state and server ticks', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const t = convexTest(schema, modules);
  const alice = 'a'.repeat(64),
    bob = 'b'.repeat(64);
  for (const [token, name] of [
    [alice, 'Alice'],
    [bob, 'Bob'],
  ])
    await t.mutation(api.players.connect, { token, name });
  for (const mapId of maps) {
    const sectorId = await t.mutation(api.operations.solo, {
      token: alice,
      difficulty: 'easy',
      mapId,
    });
    expect((await t.query(api.tactics.state, { token: alice }))?.mapId).toBe(
      mapId,
    );
    await t.mutation(internal.tactics.tick, { id: sectorId, expected: 1000 });
    expect((await t.run((ctx) => ctx.db.get(sectorId)))?.mapId).toBe(mapId);
    await t.mutation(api.operations.withdraw, { token: alice, sectorId });
  }
  const lobbyId = await t.mutation(api.operations.createLobby, {
    token: alice,
    difficulty: 'normal',
    maxPlayers: 4,
    mapId: 'ironpass',
  });
  await expect(
    t.mutation(api.operations.solo, {
      token: bob,
      difficulty: 'easy',
      mapId: 'unknown' as MapId,
    }),
  ).rejects.toThrow();
  const room = (await t.query(api.operations.overview, { token: alice }))
    .lobby!;
  expect(room.mapId).toBe('ironpass');
  expect(room.maxPlayers).toBe(4);
  await t.mutation(api.operations.joinLobby, { token: bob, code: room.code });
  await expect(
    t.mutation(api.operations.configureLobby, {
      token: bob,
      lobbyId,
      difficulty: 'normal',
      maxPlayers: 2,
      mapId: 'nordlys',
    }),
  ).rejects.toThrow('Only the host');
  await t.mutation(api.operations.configureLobby, {
    token: alice,
    lobbyId,
    difficulty: 'normal',
    maxPlayers: 4,
    enemyCount: 4,
    mapId: 'glaciercrown',
  });
  // The small starter map clamps the lobby to its two landings and two strongholds.
  await t.mutation(api.operations.configureLobby, {
    token: alice,
    lobbyId,
    difficulty: 'normal',
    maxPlayers: 4,
    enemyCount: 4,
    mapId: 'fjordmouth',
  });
  expect(
    (await t.query(api.operations.overview, { token: alice })).lobby,
  ).toMatchObject({ mapId: 'fjordmouth', maxPlayers: 2, enemyCount: 2 });
  await t.mutation(api.operations.configureLobby, {
    token: alice,
    lobbyId,
    difficulty: 'normal',
    maxPlayers: 2,
    enemyCount: 3,
    mapId: 'skerryharbour',
  });
  // An older client changing difficulty must not reset the chosen map.
  await t.mutation(api.operations.configureLobby, {
    token: alice,
    lobbyId,
    difficulty: 'hard',
    maxPlayers: 2,
  });
  const sectorId = await t.mutation(api.operations.startLobby, {
    token: alice,
    lobbyId,
  });
  for (const token of [alice, bob])
    expect(await t.query(api.tactics.state, { token })).toMatchObject({
      id: sectorId,
      mapId: 'skerryharbour',
      enemyCount: 3,
    });
  await t.mutation(internal.tactics.tick, { id: sectorId, expected: 1000 });
  expect(
    (await t.query(api.operations.overview, { token: bob })).battle?.mapId,
  ).toBe('skerryharbour');
});

test('every map has real loadable, bounded GLB assets and web artwork', () => {
  for (const mapId of maps) {
    const biome = BATTLEFIELDS[mapId];
    expect(statSync(`public${biome.image}`).size).toBeLessThan(1_000_000);
    for (const name of new Set([...biome.trees, ...biome.rocks, biome.scrub])) {
      const file = readFileSync(`public/models/landscape/${name}.glb`);
      expect(file.toString('utf8', 0, 4)).toBe('glTF');
      expect(file.length).toBeLessThan(
        /spruce|birch/.test(name) ? 800_000 : 600_000,
      );
      const json = JSON.parse(
        file.toString('utf8', 20, 20 + file.readUInt32LE(12)),
      );
      expect(json.meshes).toHaveLength(1);
      expect(json.meshes[0].primitives).toHaveLength(1);
      expect(json.meshes[0].primitives[0].attributes.COLOR_0).toBeDefined();
    }
  }
});

// Exercise the economy through real construction and continuous simulation on every biome.
test.each(maps)(
  '%s supports refinery construction and repeated ore deliveries',
  (mapId) => {
    const battle = newBattle(1000, { seed: 0, difficulty: 'easy', mapId });
    joinBattle(
      battle,
      { id: 'miner', name: 'Miner', culture: 'fjordborn' },
      1000,
    );
    battle.commanders[0].credits = 10000;
    battle.entities = battle.entities.filter((e) => !isUnit(e.kind));
    battle.nextWaveAt = 1e9;
    const home = terrainFor(battle).baseAt(battle.commanders[0].slot);
    battle.entities.push(
      makeEntity(battle, 'reactor', 'miner', 'blue', {
        x: home.x + 16,
        z: home.z + 2,
      }),
    );
    purchase(battle, 'miner', 'refinery', 1000, {
      position: { x: home.x - 18, z: home.z + 10 },
      rotation: 2,
    });
    tickBattle(battle, 21000);
    const harvester = battle.entities.find(
      (e) => e.owner === 'miner' && e.kind === 'harvester',
    );
    expect(harvester).toBeDefined();
    for (let time = 22000; time <= 150000; time += 1000)
      tickBattle(battle, time);
    expect(battle.commanders[0].harvested).toBeGreaterThanOrEqual(1000);
    expect(battle.deposits!.some((d) => d.amount < d.capacity)).toBe(true);
    expect(terrainFor(battle).groundAt(harvester!.x, harvester!.z)).toBe(true);
  },
);
