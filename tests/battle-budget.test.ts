import { expect, test } from 'vitest';
import { FrameBudget, renderTier } from '../lib/frame-budget';
import { TacticalSpatialIndex } from '../lib/tactical-spatial';
import { withRoutingBudget } from '../lib/tactical-navigation';
import { terrainFor } from '../lib/tactical-terrain';
import {
  BATTLE_ENTITY_LIMIT,
  STRUCTURE_LIMIT,
  commandLimit,
  harvesterLimit,
  HOSTILE_ARMY_BUDGET,
  newBattle,
  joinBattle,
  makeEntity,
  tickBattle,
  purchase,
  availability,
  isUnit,
  placementError,
  sellStructure,
  trainingBlockReason,
  findPath,
  type Battle,
} from '../lib/tactics';

function operation(slots = 1) {
  const b = newBattle(1000, {
    seed: 947,
    enemyCount: 8,
    playerSlots: slots,
    mapId: 'nordlys',
  });
  joinBattle(b, { id: 'p', name: 'Player', culture: 'neutral' }, 1000);
  b.commanders[0].credits = 60000;
  const home = terrainFor(b).baseAt(b.commanders[0].slot);
  b.entities.push(
    makeEntity(b, 'barracks', 'p', 'blue', { x: home.x + 18, z: home.z }),
  );
  return b;
}

test('lobby capacity reserves a bounded allied army', () => {
  for (let players = 1; players <= 8; players++) {
    const b = { playerSlots: players, commanders: [] };
    expect(commandLimit(b) * players).toBeLessThanOrEqual(160);
  }
  expect(commandLimit({ playerSlots: 1, commanders: [] })).toBe(80);
  expect(commandLimit({ playerSlots: 8, commanders: [] })).toBe(20);
});

test('each completed refinery supports eight more harvesters', () => {
  const b = operation();
  const home = terrainFor(b).baseAt(b.commanders[0].slot);
  expect(harvesterLimit(b, 'p')).toBe(8);
  const refinery = (dx: number) => {
    const e = makeEntity(b, 'refinery', 'p', 'blue', {
      x: home.x + dx,
      z: home.z + 20,
    });
    e.readyAt = 0;
    b.entities.push(e);
    return e;
  };
  refinery(0);
  expect(harvesterLimit(b, 'p')).toBe(8);
  const second = refinery(14);
  expect(harvesterLimit(b, 'p')).toBe(16);
  refinery(28).readyAt = Date.now() + 60_000;
  expect(harvesterLimit(b, 'p')).toBe(16);
  second.hp = 0;
  expect(harvesterLimit(b, 'p')).toBe(8);
});

test('fog-filtered clients retain the authoritative battlefield-full reason', () => {
  const b = operation();
  b.battlefieldFull = true;
  expect(trainingBlockReason(b, 'p', 'ranger')).toContain('battlefield space');
  expect(() =>
    purchase(b, 'p', 'reactor', 1000, {
      position: { x: 0, z: 40 },
      rotation: 0,
    }),
  ).toThrow('Battlefield full');
});

test('a full army keeps paid orders queued, then deploys after casualties', () => {
  const b = operation(8),
    home = terrainFor(b).baseAt(b.commanders[0].slot);
  for (let i = 3; i < commandLimit(b); i++)
    b.entities.push(
      makeEntity(b, 'ranger', 'p', 'blue', { x: home.x + i, z: home.z - 20 }),
    );
  purchase(b, 'p', 'ranger', 1000);
  expect(trainingBlockReason(b, 'p', 'ranger')).toContain('army space');
  b.training![0].lines![0].readyAt = 1000;
  tickBattle(b, 1250);
  expect(b.training).toHaveLength(1);
  b.entities.find((e) => e.owner === 'p' && e.kind === 'ranger')!.hp = 0;
  tickBattle(b, 1500);
  expect(b.training).toHaveLength(0);
});

test.each([24, 64, 127])(
  'a commander with %i structures can keep building up to 128',
  (count) => {
    const b = operation(),
      home = terrainFor(b).baseAt(b.commanders[0].slot),
      structures = () =>
        b.entities.filter(
          (e) => e.owner === 'p' && e.hp > 0 && !isUnit(e.kind),
        );
    while (structures().length < count)
      b.entities.push(makeEntity(b, 'reactor', 'p', 'blue', home));
    expect(availability(b, 'p', 'reactor')).toBeNull();
    const candidates = [];
    for (let x = home.x - 40; x <= home.x + 40; x += 2)
      for (let z = home.z - 40; z <= home.z + 40; z += 2)
        candidates.push({ position: { x, z }, rotation: 0 });
    const site = candidates.find((p) => !placementError(b, 'p', 'reactor', p));
    expect(site).toBeDefined();
    const id = purchase(b, 'p', 'reactor', 1000, site);
    expect(structures()).toHaveLength(count + 1);
    expect(b.entities.find((e) => e.id === id)!.readyAt).toBeGreaterThan(1000);
    if (count === 127) {
      expect(availability(b, 'p', 'reactor')).toContain(
        'Structure limit reached (128)',
      );
      expect(() => purchase(b, 'p', 'reactor', 1000, site)).toThrow(
        'Structure limit reached (128)',
      );
      sellStructure(b, 'p', id, 1000);
      expect(availability(b, 'p', 'reactor')).toBeNull();
      purchase(b, 'p', 'reactor', 1000, site);
      expect(structures()).toHaveLength(128);
    }
  },
);

test('global and structure limits close production, refinery and building loopholes without deleting old armies', () => {
  const b = operation(),
    home = terrainFor(b).baseAt(b.commanders[0].slot);
  while (
    b.entities.filter((e) => e.owner === 'p' && e.kind === 'reactor').length <
    STRUCTURE_LIMIT
  )
    b.entities.push(makeEntity(b, 'reactor', 'p', 'blue', home));
  expect(() =>
    purchase(b, 'p', 'reactor', 1000, { position: home, rotation: 0 }),
  ).toThrow('Structure limit');
  const refinery = makeEntity(b, 'refinery', 'p', 'blue', home, 1100);
  b.entities.push(refinery);
  while (b.entities.length < BATTLE_ENTITY_LIMIT)
    b.entities.push(makeEntity(b, 'reactor', 'p', 'blue', home));
  expect(trainingBlockReason(b, 'p', 'ranger')).toContain('battlefield space');
  tickBattle(b, 1250);
  expect(b.entities).toHaveLength(BATTLE_ENTITY_LIMIT);
  expect(b.entities.filter((e) => e.kind === 'harvester')).toHaveLength(0);
  expect(() =>
    joinBattle(b, { id: 'new', name: 'New', culture: 'neutral' }, 1250),
  ).toThrow('Battlefield full');
  expect(HOSTILE_ARMY_BUDGET(b)).toBe(192);
});

test('routing budgets reset between updates and cached routes cannot be consumed by a walking unit', () => {
  const from = { x: -15, z: 30 },
    to = { x: -15, z: -60 },
    obstacles: [] = [];
  expect(
    withRoutingBudget(() => findPath(from, to, false, obstacles), 0),
  ).toEqual([]);
  const path = withRoutingBudget(() => findPath(from, to, false, obstacles), 1);
  expect(path.length).toBeGreaterThan(0);
  const original = structuredClone(path);
  path.shift();
  expect(
    withRoutingBudget(() => findPath(from, to, false, obstacles), 0),
  ).toEqual(original);
});

test('combat buckets immediately track units crossing a bucket boundary', () => {
  const b = { serial: 0 } as Battle;
  const e = makeEntity(b, 'ranger', 'p', 'blue', { x: 31, z: 0 });
  const index = new TacticalSpatialIndex([e]);
  e.x = 65;
  index.update(e);
  expect([...index.near({ x: 65, z: 0 }, 1)]).toContain(e);
  expect([...index.near({ x: 0, z: 0 }, 1)]).not.toContain(e);
});

test('frame quality responds to sustained load, ignores background pauses and recovers slowly', () => {
  const budget = new FrameBudget();
  budget.sample(1);
  expect(budget.quality).toBe(1);
  for (let i = 0; i < 240; i++) budget.sample(1 / 30);
  expect(budget.quality).toBe(0.55);
  expect(renderTier(budget.quality)).toMatchObject({
    ambientOcclusion: false,
    shadowEvery: 3,
  });
  for (let i = 0; i < 120; i++) budget.sample(1 / 60);
  expect(budget.quality).toBe(0.55);
  for (let i = 0; i < 3600; i++) budget.sample(1 / 60);
  expect(budget.quality).toBe(1);
  expect(renderTier(budget.quality)).toMatchObject({
    ambientOcclusion: true,
    shadowEvery: 1,
    dpr: 1,
  });
});

test('a tier that fails right after stepping up waits longer before the next try', () => {
  const budget = new FrameBudget();
  // Heavy only at the best tier: 40 fps at 1, 60 fps below it.
  const run = (seconds: number) => {
    const changes: number[] = [];
    for (let t = 0; t < seconds * 60; t++) {
      const before = budget.quality;
      budget.sample(budget.quality === 1 ? 1 / 40 : 1 / 60);
      if (budget.quality !== before) changes.push(budget.quality);
    }
    return changes;
  };
  // Every try of the best tier fails within a window, so the retries spread out.
  const changes = run(300);
  expect(changes[0]).toBe(0.85);
  const tries = changes.filter((q) => q === 1).length;
  expect(tries).toBeGreaterThan(0);
  expect(tries).toBeLessThan(6);
});
