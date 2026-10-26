import { expect, test } from 'vitest';
import { terrainFor } from '../lib/tactical-terrain';
import { MAPS, mapFor, mapIds } from '../lib/maps';
import { clampPose } from '../lib/tactical-camera';
import { FogGrid } from '../lib/tactical-fog';
import { type MapId } from '../lib/battlefields';
import {
  groundSegmentCost,
  withRoutingBudget,
} from '../lib/tactical-navigation';
import { productionExit } from '../lib/tactical-placement';
import {
  findPath,
  issueOrder,
  joinBattle,
  movementObstacles,
  newBattle,
  purchase,
  tickBattle,
} from '../lib/tactics';

test('map sizes and routing grids stay inside the operating envelope', () => {
  const size = (id: MapId) => {
    const { minX, maxX, minZ, maxZ } = MAPS[id].bounds;
    return [maxX - minX, maxZ - minZ];
  };
  expect(size('fjordmouth')).toEqual([320, 280]);
  for (const id of ['ironpass', 'glaciercrown', 'skerryharbour'] as const)
    expect(size(id)).toEqual([420, 380]);
  expect(size('nordlys')).toEqual([720, 620]);
  for (const id of mapIds) {
    const map = mapFor(id);
    const [w, d] = size(id);
    // Larger maps route on a coarser grid, so A* stays within its node budget.
    expect((w / map.navigationStep) * (d / map.navigationStep)).toBeLessThan(
      25000,
    );
    expect(map.scale).toBe(1);
  }
});

test.each(mapIds)(
  '%s supports a full roster against every army, each in its own stronghold',
  (mapId) => {
    const { players, enemies } = MAPS[mapId].capacity;
    const b = newBattle(1000, {
      seed: 947,
      mapId,
      enemyCount: enemies,
      playerSlots: players,
    });
    const terrain = terrainFor(b),
      obstacles = movementObstacles(b);
    for (let army = 0; army < enemies; army++) {
      const hold = terrain.strongholdAt(army);
      const owned = b.entities.filter((e) => e.owner === `hostile-${army + 1}`);
      for (const kind of [
        'hq',
        'factory',
        'barracks',
        'reactor',
        'refinery',
        'airfield',
      ]) {
        const building = owned.find((e) => e.kind === kind)!;
        expect(building, `${army + 1}/${kind}`).toBeDefined();
        expect(
          Math.hypot(building.x - hold.x, building.z - hold.z),
        ).toBeLessThanOrEqual(hold.radius);
      }
      const ore = b.deposits!.find((d) => d.name === `${hold.name} ore`)!;
      expect(ore).toBeDefined();
      expect(Math.hypot(ore.x - hold.x, ore.z - hold.z)).toBeLessThanOrEqual(
        hold.radius + 12,
      );
      const from = terrain.baseAt(0);
      const path = withRoutingBudget(
        () =>
          findPath(
            from,
            productionExit(owned.find((e) => e.kind === 'hq')!),
            false,
            obstacles,
            terrain,
          ),
        Infinity,
      );
      expect(path.length).toBeGreaterThan(0);
      let previous = from;
      for (const next of path) {
        expect(
          Number.isFinite(
            groundSegmentCost(previous, next, obstacles, terrain),
          ),
        ).toBe(true);
        previous = next;
      }
    }
    for (let i = 0; i < players; i++)
      joinBattle(b, { id: `p${i}`, name: `P${i}`, culture: 'neutral' }, 1000);
    expect(b.commanders).toHaveLength(players);
    expect(() =>
      joinBattle(b, { id: 'late', name: 'Late', culture: 'neutral' }, 1000),
    ).toThrow('Every landing zone');
    for (const commander of b.commanders) {
      const home = b.entities.find(
        (e) => e.owner === commander.id && e.kind === 'hq',
      )!;
      expect(home.x).toBe(terrain.baseAt(commander.slot).x);
      expect(home.z).toBe(terrain.baseAt(commander.slot).z);
      expect(terrain.groundAt(home.x, home.z)).toBe(true);
    }
  },
  30000,
);

test('commands, construction, camera and explored fog work at the far edge of the largest map', () => {
  const b = newBattle(1000, {
    seed: 0,
    mapId: 'nordlys',
    enemyCount: 8,
    playerSlots: 8,
  });
  for (let i = 0; i < 7; i++)
    joinBattle(b, { id: `a${i}`, name: `A${i}`, culture: 'neutral' }, 1000);
  joinBattle(b, { id: 'p', name: 'P', culture: 'neutral' }, 1000);
  const terrain = terrainFor(b);
  const ranger = b.entities.find(
    (e) => e.owner === 'p' && e.kind === 'ranger',
  )!;
  expect(ranger.x).toBeGreaterThan(300);
  const destination = { x: ranger.x + 15, z: ranger.z };
  issueOrder(b, 'p', [ranger.id], 'move', destination);
  const oldX = ranger.x;
  tickBattle(b, 1250);
  expect(ranger.x).toBeGreaterThan(oldX);
  const home = terrain.baseAt(b.commanders.find((c) => c.id === 'p')!.slot);
  expect(() =>
    purchase(b, 'p', 'reactor', 1250, {
      position: { x: home.x + 12, z: home.z + 6 },
      rotation: 0,
    }),
  ).not.toThrow();
  expect(clampPose({ ...home, distance: 66 }, terrain.bounds)).toMatchObject(
    home,
  );
  const fog = new FogGrid(undefined, terrain.bounds);
  fog.update(b.entities, 'p', 1);
  expect(fog.sight(home)).toBe('visible');
  const restored = new FogGrid(fog.explored(), terrain.bounds);
  expect(restored.sight(home)).toBe('explored');
  expect(fog.sight({ x: home.x + 70, z: home.z })).toBe('hidden');
});

test('every Nordlys landing walks under 100 m to a first expansion lighter than the river seams', () => {
  const design = MAPS.nordlys;
  const terrain = terrainFor({ mapId: 'nordlys' });
  const map = mapFor('nordlys');
  const seams = design.ore.filter((o) => o.z < 120);
  const expansions = design.ore.filter((o) => o.z >= 120);
  expect(expansions).toHaveLength(4);
  for (const o of expansions) {
    expect(map.terrainAt(o.x, o.z)).toBe('land');
    expect(o.amount).toBeLessThan(Math.min(...seams.map((s) => s.amount)));
  }
  const walks = design.landings.map((l) =>
    Math.min(
      ...expansions.map((o) => {
        const route = withRoutingBudget(() => findPath(l, o, false, [], terrain), 1e9);
        expect(route.length).toBeGreaterThan(0);
        let walked = 0,
          at = l;
        for (const p of route) {
          walked += Math.hypot(p.x - at.x, p.z - at.z);
          at = p;
        }
        return walked;
      }),
    ),
  );
  for (const walk of walks) expect(walk).toBeLessThan(100);
  // Mirrored landings walk the same distance, so no slot starts ahead.
  for (let i = 0; i < walks.length; i += 2)
    expect(Math.abs(walks[i] - walks[i + 1])).toBeLessThan(1);
});
